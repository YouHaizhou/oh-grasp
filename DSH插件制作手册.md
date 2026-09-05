# DSH 插件制作手册（给 Agent 用）

> 面向**编写代码的 Agent**。读这份手册后，你应能独立产出符合仓库契约的 DSH 插件：工具插件、服务插件、事件拦截插件。
> 来源：`learn-harness/` 全部笔记（01-08 + 07-精华）。本手册只保留"动手时必须知道"的事实与规则，不含学习铺垫。

---

## 0. 一句话心智模型

**DeepSeek Harness（DSH）= 基于 vendored Cordis 的插件化 Agent 运行时，一切都是插件。**

- 程序没有 `main()`。`cordis.yml` 里的一行 = 一个插件，插件树 = 运行中的应用程序。
- 写插件 = 导出 `apply(ctx)` 函数 + 在 `cordis.yml` 挂一行。
- 五根柱子：**插件即函数 / ctx 是服务仓库 / 注册即 effect / 配置即插件树 / 模型可见 ⇔ 日志可重建**。

---

## 1. 插件的最小形态与导出契约

### 1.1 函数插件（最常见）

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'hello-plugin'          // 显示名，诊断用
export const inject = ['tools']             // 硬依赖：等这些服务就绪才 apply
export function apply(ctx: Context) {
  console.log('[hello-plugin] loaded')
}
```

三种形态：**函数插件**（最常用）、对象插件（有 `apply` 方法的对象）、类插件（`extends Service`，提供服务时才用）。

### 1.2 导出契约（硬规则，违反会被 Loader 丢弃）

| 插件类型 | 导出方式 | 规则 |
|---|---|---|
| 函数插件 | **named export** `name` / `inject` / `Config` / `apply` | **绝不能 `export default`** |
| 服务包 | **default export** 服务类 | 服务类 default 导出 |

> ⚠️ **Postmortem 0001**：函数插件若加了 `export default apply`，Loader 的 `unwrapExports` 会优先取 `.default`，把 `name`/`inject`/`Config` 整个命名空间丢掉，`inject` 失效导致加载崩溃。**函数插件永远只用具名导出。**

### 1.3 依赖注入：inject vs ctx.get

```ts
// 硬依赖：inject 声明，apply 里用 ctx.<name> 属性读
export const inject = ['tools']
export function apply(ctx: Context) {
  ctx.tools.register(...)      // ✅ inject 里的服务用属性
}

// 可选依赖：不用 inject，运行时用 ctx.get 探测
export function apply(ctx: Context) {
  const greeter = ctx.get('greeter')        // 拿不到是 undefined
  console.log(greeter?.greet('x') ?? 'none')
}
```

> ⚠️ **铁律**：可选服务用 `ctx.get(name)`，**不要用 `ctx.<name>` 属性读**。属性代理按"仅祖先" fiber 链解析，穿过 shadow 会失败；`ctx.get()` 是拓扑无关的全局查找。
> ⚠️ 依赖缺失时插件**静默停在 `PENDING`**（不报错、不打日志），进程可能正常退出。诊断：遍历 `ctx.registry` 的 fiber，找 `FiberState.PENDING`。

---

## 2. 写一个工具（最高频任务）

工具 = 模型（AI）可调用的函数。写工具 = `ctx.tools.register(defineTool({...}))`。

### 2.1 最小完整工具

```ts
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'my-tool'
export const inject = ['tools']                 // 等工具注册表就绪

export function apply(ctx: Context) {
  ctx.tools.register(defineTool({
    name: 'read_file',                          // 模型看到的工具名
    description: 'Read a file from disk.',      // 模型决定何时调用的依据
    parameters: {                               // 给模型看的 JSON Schema，自动校验
      path: { type: 'string', required: true, description: 'Absolute path' },
      limit: { type: 'number' },                // 不带 required = 可选
    },
    output: {
      schema: { type: 'string' },               // 规范输出值的 schema
      render: (_args, value) => [{ type: 'text', text: value }],  // 值 → 模型可见内容
    },
    async execute(args, exec) {
      // args 类型由 schema 自动推导；exec.signal 是取消信号（必须遵守）
      return readFile(args.path, { encoding: 'utf8', signal: exec.signal })
    },
  }))
}
```

### 2.2 五个要点（框架义务 vs 你的义务）

1. **参数校验是框架义务**：`parameters` 是 JSON Schema，`defineTool` 自动校验，失败抛 `ToolArgsError (INVALID_ARGS)`，`execute` 根本不会被调用。你自己只检查 DSL 表达不了的约束（非空串、正数、跨字段规则）。
2. **值/呈现分离**：`execute` **只返回规范 JSON 值**（字符串/对象/数组/标量/null），**绝不返回内容块**；模型可见内容由 `output.render` 生成。
3. **`output.render(args, value)` 是纯函数**：直播流和日志重放都要跑它 → **禁止 I/O、禁止读会话状态、禁止时钟/随机**。
4. **遵守 `exec.signal`**：触发即取消。写外部进程/网络/流式工具必须把 signal 转发给底层，自己实现终止。
5. **注册即 effect**：卸载自动注销，不用写注销代码。

### 2.3 execute 契约的硬规则

- 不要改注册的 readonly 定义（热换工具 → dispose 拥有它的 effect，再注册新的）。
- 把 `args` 当只读输入（注册表已冻结快照）；`exec.token`/`callId`/`signal` 派发全程不可变。
- 只返回一个规范 JSON 值，不要让调用方从 prose 里解析 id/字段。
- **抛错或返回非法值 = `isError`**：基础设施失败就 `throw`；领域失败（如进程退出码非零）用规范值表达，交给 render 解释。
- 异步通知用 `exec.agent.inject({ content, source: { kind: 'plugin', plugin: '<name>' } })` 给**下一次**请求追加持久上下文。**它永不唤醒**（空闲 agent 保持空闲），要 try/catch 防 agent 已销毁。

### 2.4 UI 呈现（可选但推荐）

用 `presentCall(args)` / `presentResult(args, { content, isError, meta })` 声明 `card`-tagged 渲染意图：

```
presentCall(args)  → { card: 'terminal', title, cwd }            // shell 命令
                   → { card: 'diff', title, diffs: [{path,oldText,newText}] }  // 改文件
                   → { card: 'generic', title, kind: 'read'|'edit'|'search'|... }  // 默认

presentResult(...) → { card: 'terminal', output, exitCode }
                   → { card: 'diff', diffs }
                   → { card: 'search', shape: 'matches', ... }
```

硬规则：
- **纯函数**：只依赖 `args` + 结果，别读文件/会话状态/时钟。
- **UI 格式化不进模型结果**（diff、相对路径、```console 块都不属于规范值/内容）。
- **card 联合是闭合的**：`card` 标签是判别字段，新增卡片类型会编译报错——想加新卡片必须在同一改动里写它的 UI bridge 分支。
- 不做 UI 呈现 = 回退通用卡片（标题=工具名）。参考实现：`dsh-tool-bash`（terminal）、`dsh-tool-fs`（generic/diff）。

---

## 3. 写一个服务 / 能力（capability seam 三角色）

**只有角色需要独立演化/替换时才拆包。** 简单工具 → 一个包搞定，不拆。

### 3.1 三角色

| 角色 | 干什么 | 例子 |
|---|---|---|
| **Service Definition** | 抽象类 + 类型，注册 `ctx.<key>` | `dsh-shell` |
| **Service Provider** | 继承抽象类，真正实现 | `dsh-bash-local` / `dsh-bash-sandbox` |
| **Consumer** | 消费服务（通常是工具） | `dsh-tool-bash` |

Provider 和 Consumer **互不依赖**，都只依赖 Definition。换实现 = 改 `cordis.yml` 一行，消费者零改动。

### 3.2 Step 1：Service Definition

```ts
// packages/my-cap/my-cap/src/index.ts
import { Service, type Context } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context { myCap: MyCapService }    // 编译期类型合并（不生成代码）
}

export abstract class MyCapService extends Service {
  constructor(ctx: Context) { super(ctx, 'myCap') }
  abstract execute(request: MyCapRequest): Promise<MyCapResult>
}
export interface MyCapRequest { input: string }
export interface MyCapResult { output: string }
export default MyCapService                      // 服务包 default 导出（硬约定）
```

### 3.3 Step 2：Service Provider

```ts
// packages/my-cap/my-cap-local/src/index.ts
import type { Context } from '@deepseek-ai/cordis'
import { MyCapService, type MyCapRequest, type MyCapResult } from '@deepseek-ai/dsh-my-cap'

class MyCapLocal extends MyCapService {
  static inject = ['subprocess']               // Provider 也能依赖下层服务
  static Config = z.object({ timeoutMs: z.number().default(120_000) })  // 可配置项
  constructor(ctx: Context, config: Config) { super(ctx) }              // super 完成注册
  async execute(request: MyCapRequest): Promise<MyCapResult> {
    return { output: request.input.toUpperCase() }
  }
}

export const name = 'my-cap-local'
export function apply(ctx: Context) { ctx.plugin(MyCapLocal) }   // 类插件：挂载即注册
```

### 3.4 Step 3：Consumer（通常是工具）

```ts
export const name = 'tool-my-cap'
export const inject = ['tools', 'myCap']       // 依赖工具注册表 + 能力服务
export function apply(ctx: Context) {
  ctx.tools.register(defineTool({
    name: 'my_cap', description: '...',
    parameters: { input: { type: 'string', required: true } },
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] },
    async execute(args) { return (await ctx.myCap.execute({ input: args.input })).output },
  }))
}
```

### 3.5 Step 4：组合

```yaml
- name: '@deepseek-ai/dsh-my-cap-local'
- name: '@deepseek-ai/dsh-tool-my-cap'
```

### 3.6 硬规则

- **不预拆分**：判断标准——"Service Definition 要服务当前所有消费者"；只有一个内部调用者的公共方法也是坏味道（传私有闭包即可）。
- **服务命名**：服务名是全局扁平命名空间，DSH 已占用 `tools`/`llm` 等简洁名，**你自己的服务必须加前缀/命名空间**防冲突。
- **显式 > 隐式**：默认值用显式 `resolve(request): Spec` 步骤，别藏在 `run()` 里写 `?? default`（隐式默认无法被配置层覆盖）。
- **同一 context 只允许一个实现**，加载第二个 provider 会抛错。

---

## 4. 事件与拦截

### 4.1 声明与收发

```ts
// 声明事件（编译期 declaration merging，不生成代码）
declare module '@deepseek-ai/cordis' {
  interface Events { 'stats/report'(name: string, count: number): void }
}
// 发送
this.ctx.emit('stats/report', name, next)
// 监听（ctx.on 是 effect，卸载自动移除）
ctx.on('stats/report', (name, count) => console.log(name, count))
```

事件名约定 `namespace/action`（`tools/result`、`agent/request`）。

### 4.2 五种分发模式（查事件先查模式）

| 模式 | 调用 | 等待 | 顺序 | 返回值 |
|---|---|---|---|---|
| `emit` | `ctx.emit(...)` | 否 | 按注册序 | 无（广播） |
| `parallel` | `await ctx.parallel(...)` | 是 | 并行 | 无 |
| `serial` | `await ctx.serial(...)` | 是 | 按注册序 | 首个非 null/false/undefined 胜出并停止 |
| `bail` | `ctx.bail(...)` | 否 | 按注册序 | serial 同步版 |
| `waterfall` | `ctx.waterfall(...)` | 是 | 按注册序 | 中间件管道 |

### 4.3 waterfall 铁律（拦截引擎）

监听者收到 `(...args, next)`：
- 调 `next()` → 委托下游（可拿到被包装/改写的结果）
- **不调 `next()` 直接 return → 短路（veto，一票否决）**

> ⚠️ **铁律**：**只观察/注释的 waterfall 监听者必须调 `next()`；不调 = 蓄意短路**。忘记 next() 的日志监听者会静默吞掉下游所有人的默认行为——这是新手最大的坑。

权限门是挂在 `tools/pre-execute` 瀑布上的普通插件，返回 typed decision：

```ts
export const name = 'permission-gate'
export function apply(ctx: Context) {
  ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
    if (!(await isAllowed(exec))) return { kind: 'deny', reason: 'Denied by policy.' }  // 短路
    return next()                                                                       // 放行
  })
}
// type PreToolDecision = {kind:'allow'} | {kind:'deny';reason:string} | {kind:'ask';reason?:string}
```

注意：`agent/turn-stopping` 是 **serial 模式，没有 next()**——别把 waterfall 的 next() 习惯套上去。

### 4.4 拦截点地图（想加功能先查这张表）

| 想做什么 | 挂哪个机制 |
|---|---|
| 加模型提供商 | 在 `ctx.llm` 注册适配器 |
| 加模型可调用能力 | 在 `ctx.tools` 注册（schema 自动进提示词组装） |
| 加 shell 执行 | 注册 `ctx.shell` 后端 |
| 加人类命令（/xxx） | 在 `ctx.commands` 注册（不经模型 turn） |
| 加后台任务 | 在 `ctx.jobs` 注册；`job_*` 工具收集/停止 |
| 拦截请求/工具/turn | `agent/*` 或 `tools/*` 事件；`agent/turn-stopping` 停 turn |
| 给模型加上下文 | `agent.inject()`，落入下一次请求 |
| 加 UI/编辑器集成 | 驱动 `ctx.agents`，从 `session/event` 渲染 |
| 加持久会话状态 | 扩展 `SessionEventMap` |
| 把注册限定到单个 agent | 用该 agent 的 `agent.ctx` |

### 4.5 三种事件域（选对域是第一步）

1. **会话事件（session/*）**：持久事实，追加进日志，经 `session/event` 广播（`turn/*`、`step/*`、`user/message`、`assistant/*`、`tool/*`）。需要跨重启存活用它。
2. **Agent 事件（agent/*）**：携带活 Agent，观察/拦截在飞工作用它。
3. **能力事件（capability）**：给 seam 挂策略和适配器（`fs/*`、`tools/*`、`telemetry/*`）。

判定：需持久 → session event；观察在飞工作 → agent/*；挂策略 → capability event。

---

## 5. 配置与 Schema

### 5.1 cordis.yml 条目

```yaml
- id: greeter            # 稳定身份：让 Loader 区分"编辑"和"删除+新增"
  name: './greeter.ts'
  config:                # 传给插件的配置（插件 Schema 校验）
    greeting: 'Hi there'
    maxRetries: 5
- id: consumer
  name: './consumer.ts'
  disabled: true         # 保留但不挂载；翻回 false 恢复
```

- **id 很重要**：HMR 按 id 对比差异，没 id 每次编辑都被当"删除+新增"整体重挂。
- **config 由插件 Schema 校验，配错 Fail Loud**（加载失败报精确错误，绝不半配置启动）。
- **`!!js` 只在 `config` 和 `disabled` 字段求值**，其他元数据（name/id/inject）保持字面量：

```yaml
config:
  greeting: !!js process.env.DEMO_GREETING ?? 'Hello'
disabled: !!js process.platform !== 'linux'
```

### 5.2 插件 Config Schema

```ts
export interface Config { enableRunInBackground?: boolean }
export const Config = z.object({
  enableRunInBackground: z.boolean().default(true),
})
export function apply(ctx: Context, config: Config) { ... }   // config 自动注入并校验
```

### 5.3 三层装配（知道你的覆盖写在哪层才生效）

```
空条目列表
  ↑ 每个 bundle 按序插入（dsh-base → dsh-web-app / dsh-headless）
  ↑ profile 的 cordis.patch.yml（用户覆盖）
  ↑ 家目录级 patch
  ↑ 命令行 --patch 覆盖
```

- **patch 语义**：按 `id` 定位一行 → 整行替换 config（不是合并）；或 `insert` 新行。后写赢。
- patch 只能 `disabled: true` 或 `insert`，**不能改名**（`name` 是守卫）。

本地插件挂到 Web UI：

```sh
pnpm dsh web --patch ./scratch-plugin/cordis.yml
```

查看真实启动的插件树：`dsh --profile web --dump-config`。

---

## 6. 硬规则清单（必须逐条遵守）

1. **函数插件用具名导出，绝不能 `export default`**（Postmortem 0001）。
2. **可选服务用 `ctx.get(name)`，不用 `ctx.<name>`**；`inject` 里的服务才用属性读。
3. **waterfall 观察者必须 `next()`**，不调 = 短路。
4. **execute 返回规范 JSON 值，不返回内容块**；模型可见内容归 `output.render`（纯函数）。
5. **遵守 `exec.signal`**；**不要用 `Promise.race`/`withTimeout` 包装器**（底层子进程/socket 会泄漏）。
6. **注册即 effect**；`ctx.effect()` 返回的 disposer **必须原样返回**（包装会破坏基于身份的有序拆解）。
7. **`!!js` 只在 config 和 disabled 生效**。
8. **源码 import 带 `.ts` 扩展名**（`import { x } from './foo.ts'`，编译器重写为 `.js`）。
9. **模型可见 ⇔ 日志可重建**：给模型加新输入必须新增会话事件（或走 `agent.inject()`），不能偷偷塞进请求。
10. **`inject()` 永不唤醒**：可能被取消/dispose 丢弃，可能等好几个边界才被领取。
11. **抛错用 `HarnessError` 子类带稳定 code**，让重试/沙箱/UI 按 `error.code` 分支；别从模型可见文本里 parse 错误。
12. **跨包传 id 用 branded 类型**（`SessionId`/`CallId`/`JobId`），防类别错误（不做运行时校验）。
13. **服务命名加前缀**，避免与 `tools`/`llm` 等冲突。
14. **保留下层 seam 的结构化错误**，别替换成自己的泛化类别（如把 `SandboxUnavailableError` 变 `SEARCH_FAILED`）。
15. **挂在 preset 里的插件按名字回查全局注册表会失效**——必须持有自己的注册对象；preset 文件是输入不是持久化目标。

---

## 7. 验证与自检

### 7.1 组合验证

```sh
# 插件能组合进树？（关键验证）
dsh --profile web --dump-config
# 输出末尾应出现 "# == <插件名>" 分节 + 它的插件行
```

### 7.2 测试要求

- **测试必须走真实 Loader 路径**（手工 `ctx.plugin({...})` 绕过 `unwrapExports`，测不出 default-export 事故）。覆盖率只证明"行跑过"，不证明"功能按交付方式工作"。
- 快照刷新 ≠ 正确性证明；语义上不可能的结果（如 `UNKNOWN_TOOL`）需要独立断言。

### 7.3 模型体验契约（面向模型的包必须写）

只要插件与模型请求相关，包 README 必须以规范章节收尾：每个上下文表面一个 H3，含 `What the model sees` / `Token effect` / `KV Cache effect` 三个 H4。`verify-package-readme-model-experience` 门禁强制执行。

### 7.4 发布前检查

- `pnpm run typecheck` / `lint` / `build` / `hygiene`（knip + publint + 约束 + NodeNext）。
- 测试：`pnpm run test`（覆盖率 100% 门禁）。
- 文档：`pnpm run doc-sync`（双语配对 + 链接校验）。

---

## 8. 速查表

### 8.1 查 API 的正确姿势

| 要查什么 | 去哪查 |
|---|---|
| 服务方法 + 事件签名（带 dispatch mode） | `docs/subsystems/<name>.md` 的 cordis-surface 生成区 |
| 全部配置字段 | `docs/config-catalog.md`（生成） |
| 全部工具 schema | `docs/tool-catalog.md`（生成） |
| Cordis 核心 API | `docs/cordis-api/`（生成） |
| 事件生产者/消费者矩阵 | `docs/event-producer-consumer.md`（生成） |
| 服务/接缝图 | `docs/capability-seams.md`（生成） |

> 生成区勿手改，以源码为准，改代码后 `pnpm run gen-cordis-catalog` 重新生成。

### 8.2 参考实现（生产级，可直接抄）

| 包 | 演示了什么 |
|---|---|
| `packages/shell/tool-bash` | 生产级工具：terminal card、后台任务、流式 producer |
| `packages/fs/tool-fs` | 文件读写：diff card、presentationMeta |
| `packages/fs/tool-fs-search` | 搜索：search card |
| `packages/shell/{shell,bash-local,bash-sandbox}` | capability seam 三角色完整范本 |

### 8.3 术语锚点

| 术语 | 含义 |
|---|---|
| seam | 完整可替换能力 = Definition + Provider + Consumer 三角色 |
| fiber | 已加载插件实例的运行时句柄，状态机 `PENDING→LOADING→ACTIVE→UNLOADING→DISPOSED(↘FAILED)` |
| effect | 可逆注册，插件卸载自动撤销 |
| inject | 硬服务依赖；缺失时插件停在 PENDING |
| turn / step / round | 回合（多 step）/ 步（一次请求+工具）/ 轮（外层策略迭代） |
| waterfall | 中间件式分发；必须 next() 否则短路 |
| Fail Loud | 配置/加载错误立刻报精确错误，绝不半配置静默运行 |
| Code Mode | 模型写程序（Python/TS）执行，`await tools.<name>(args)` 调工具 |

---

## 附：给 Agent 的最小完整交付清单

产出任何一个插件前，确认以下全部满足：

- [ ] 函数插件用具名导出 `name`+`inject`+`Config`+`apply`，无 `export default`（服务包才 default 导出）
- [ ] 工具：`defineTool` 的 `parameters`/`output.schema`/`output.render`/`execute` 四件齐全，`render` 纯函数
- [ ] `execute` 返回规范 JSON 值，遵守 `exec.signal`，错误用 `HarnessError`
- [ ] 服务：Definition（抽象类+类型）→ Provider（继承）→ Consumer（工具）三角色，服务名加前缀
- [ ] 事件监听：waterfall 观察者调 `next()`，选对事件域（持久→session、在飞→agent、策略→capability）
- [ ] import 带 `.ts` 扩展名；可选服务用 `ctx.get`
- [ ] 在 `cordis.yml` 挂载并用 `--dump-config` 验证组合
- [ ] 测试走真实 Loader 路径；面向模型的包写 Model Experience 章节
