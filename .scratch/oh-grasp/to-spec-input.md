# `/to-spec` 输入：oh-grasp 产物形态重做

给 `/matt-skills-with-to-goal:to-spec` 读的定向文件。

**它不替代 ADR。决策以 `docs/adr/0008`–`0012` 为准**，这里只放两样东西：to-spec 自己猜不出来、或**容易猜错**的（已定死的 route / 实测基线 / 现成 seam / 顺序约束）。

---

## 0. Route 与 tracker（已定，不要重新征询）

- **route = `/to-tickets`**，不是 fork + `/spec-executor`。
- **tracker = 本地文件**：`.scratch/oh-grasp/issues/`，一票一文件，blocking edge 写在票里（无原生 blocking link 可用）。
- 判据：改动面十处以上（`viewer.js` 一处就 >10），且本会话已 21 轮 + 一次压缩 —— **thread 不 coherent**，正是 `/to-tickets` 的两条入口条件。

## 1. 输入地图

| 文件 | 提供什么 |
|---|---|
| `docs/adr/0008-bilingual-artifact.md` | 双语作用域（可译/不可译）、嵌套方向、必填强度、四段说明、切换器、UI 文案表 |
| `docs/adr/0009-routing-and-ports.md` | 虚节点正交折线、侧栏职责、入边端点外移、端口口径（`×N` = 内容种数） |
| `docs/adr/0010-unified-interaction.md` | 统一弹窗四入口、清单行可点 + 一层返回、hover/Esc、**删 B 视图**、铺满 |
| `docs/adr/0011-tracked-external-deps.md` | `module.uses` / `module.runtime`、显示三处、反向索引 |
| `docs/adr/0012-algorithm-docs.md` | 文档分工（**改完代码要跟着改 `docs/algorithms/`**） |
| `docs/grill-with-docs/round16`–`21.md` | 决策的来龙去脉；**round20 开头有一条更正**，解释为什么「消费者数」查不出来 |
| `CONTEXT.md` | 术语表（双语 IR / 四段说明 / 虚节点 / 端口口径 / uses·runtime） |
| `docs/algorithms/*.md` | 当前实现现状：**改哪个函数、复杂度负债在哪** |
| `.scratch/oh-grasp/spec.md` | 旧 spec。story 19 已标作废，viewer 那条已改单界面；**其余部分只反映 ADR-0007 时代** |

## 2. 基线（实测于 `4a36602`，master）

```
$ node --test
# tests 62   # pass 62   # fail 0
```

- **测试命令是 bare `node --test`**（自动发现 `test/`）。
- ⚠️ **`node --test oh-grasp/test/` 在本机不工作** —— node v22.20 把目录参数当模块去 `require`，报 `MODULE_NOT_FOUND: Cannot find module 'E:\Work\project\oh-grasp\test'`。要指定路径就**显式列文件**。执行会话别在这个上面浪费时间。
- 测试用 `require('node:test')` + `node:assert`，无 `package.json`、无测试框架依赖。
- `generated/` 在 `.gitignore` 里（产物不入库）；`oh-grasp/examples/sample.ir.json` **入库**，是测试 fixture。

## 3. 现成的 seam（优先用现成的，别新开）

to-spec 要求「现有 seam 优先于新 seam，且在最高处」。这里**三个都已在用**：

| seam | 接口 | 测试文件 |
|---|---|---|
| 校验 | `validate(ir, source?) → { ok, errors[] }` | `oh-grasp/test/validate.test.js`（314 行） |
| 渲染 | `render(ir) → html` | `oh-grasp/test/render.test.js`（95 行） |
| **布局纯内核** | `require('../viewer.js')` → `{ fitWidth, wrap2, edgeLabel, countPorts, aggregateEdges, components, flowGeometry, gridGeometry }` | `oh-grasp/test/layout.test.js`（156 行） |

**第三条是关键**：`viewer.js:733` 的 `module.exports` 让布局算法在 Node 下可测（DOM 应用被 `typeof document` 门挡住，`viewer.js:285`）。本轮布局改动（虚节点路由、端口口径）**不需要新 seam** —— 它们全都落在已经导出的这几个函数里。新的行为（`pick(field)` 取值、`T` 文案表）建议沿用这个内核导出的路子，而不是新开 seam。

## 4. 范围

**In**

- `schema.json` —— 散文字段改 `{zh, en}`；`connection.description` 四段；新增 `module.uses` / `module.runtime`
- `prompt.md` —— 双语要求、同 label 复用同文、四段写法、`uses`/`runtime` 写法、每段字数指引
- `validate.js` —— 双语必填、四段必填、`uses` 必须是 external id、`runtime` 正则
- `viewer.js` —— 见 §6
- `render.js` —— 见 §6
- `oh-grasp/examples/sample.ir.json` —— fixture 升双语（**必须**，见 §7）
- `docs/algorithms/` —— 跟着代码改（ADR-0012 的约定）

**Out**

- **重新生成 `generated/archify.mjs/` 那份产物 —— 用户手动做**，不在实现范围。实现只负责让工具链能接受新 IR。
- 新平台 adapter（DSH / Codex）、非 JS 文件、项目级文件图 —— 原 spec 已排除。
- 主题/多视图/guided views —— ADR-0010 已删。
- `oh-grasp/fortest/`（scratch 源文件）与 `temp.md`：**未入库、不要提交**。

## 5. 必须写进 spec 的顺序约束

> **validate 的「双语必填」硬校验放在最后一片。**

理由：它一落地，`generated/` 里现有的单语 IR **立刻全线报错**，而重新生成是用户手动做的、在实现之后。若这条校验与工具链改动同批，会留下一段「工具链是好的、产物是坏的」的窗口 —— 无法区分「校验写错了」和「产物还没更新」。切片时把它排在最后（或与重新生成同批）。

同一条约束也适用于 **`sample.ir.json` 升双语**：fixture 不升，`validate`/`render` 测试会全红，那是预期行为不是回归。

## 6. 改动面清单（供切片，**不是**切片方案）

### `viewer.js`

| # | 改动 | 依据 |
|---|---|---|
| 1 | `pick(field)` 取值函数贯穿全部散文字段 | ADR-0008 |
| 2 | UI 文案表 `T = {zh, en}`（输入/输出/依赖/内部数据流/边界数据流/GROUP/INTERNAL 等） | ADR-0008 |
| 3 | 语言切换器（顶部 header，默认中文，不记忆） | ADR-0008 |
| 4 | 虚节点正交折线（跨层 ≥2，参与 barycenter） | ADR-0009 |
| 5 | 端口口径：`×N` = 内容种数（按 `zh` 去重）、代表内容放盒内 | ADR-0009 |
| 6 | 空方向显式标「—」（原为不画端口） | ADR-0009 |
| 7 | 入边端点外移 ~8px（不动层序） | ADR-0009 |
| 8 | 统一弹窗：合并 `openDetail`/`openGroup`，加端口 / 边 / 依赖卡片三个入口 | ADR-0010 |
| 9 | 清单行可点 + 一层返回（面包屑） | ADR-0010 |
| 10 | 点边命中区 = 整条路径 + 中点标签 | ADR-0010 |
| 11 | hover = 原生 `title`（当前语言）+ Esc 关闭 | ADR-0010 |
| 12 | 四段说明展示（聚合边列出其下每条的四段） | ADR-0008 |
| 13 | `uses`/`runtime` 三处显示（group 弹窗两段 / 叶子依赖行 / 侧栏反向索引前 3 + `+M`） | ADR-0011 |
| 14 | **删** `renderB`（`viewer.js:668`）、`VARIANTS`（`:699`）、`?variant=`（`:703`）、方向键（`:716-718`） | ADR-0010 |

### `render.js`

| # | 改动 | 位置 |
|---|---|---|
| 1 | 删 `.vA` 的 `max-width: 1060px` | `render.js:35` |
| 2 | 画布高度 `580px` → `min(内容高, 视口高)` | `render.js:50` |
| 3 | `fit()` 允许放大 1~2×（原 `min(1, …)`） | viewer |
| 4 | **删 `.vB` 全部样式** | `render.js:90` |
| 5 | 删底部切换器 markup | `render.js`（switcher 段） |
| 6 | `VIEWER_SRC` 内联机制不变，注意别引入外部引用 | `render.js:13` |

## 7. 待定 / 风险（写进 spec 的 Risks）

1. **fixture 覆盖严重不足。** `oh-grasp/examples/sample.ir.json` 只有 **5 modules / 3 connections / 0 groups**。而本轮改动的大半（端口口径 ×N、代表内容、空方向「—」、虚节点路由、group 弹窗两段、边界数据流清单）**全都是 group 才有的行为** —— 0 groups 的 fixture 对它们**零覆盖**。升双语时应该顺手补一个带 group 的 fixture，否则新行为只能靠对真实产物人工看。
2. **`countPorts` / `aggregateEdges` / `edgeLabel` 按「连接」计数**，虚节点引入后「段」≠「连接」。ADR-0009 已把这条列为代价，实现时逐个确认数的是哪个。（`aggregateEdges` 历史上出过一次折叠 bug 导致 `openPort` 失效，见 `docs/algorithms/graph.md`。）
3. **`zh` 去重是运行时的**：`×N` 要按 `zh` 文本去重后才计数，且切换语言时数字不能变 —— 测试点应覆盖「切换语言后 N 不变」。
4. **复杂度负债会放大**：`graph.md` 记的 Kahn `O(V²)` 与 barycenter `O(V·E·passes)`。虚节点让层内序列变长，后者会更明显。当前规模（41 节点）无感，不要求修，但别在改布局时误以为它是新引入的。
5. **生成量**：ADR-0008 记的约 700 句。这是用户手动重新生成时的实际工作量，spec 里应说清，别让它看起来是「跑个脚本」。
6. **`docs/algorithms/` 要跟着改**（ADR-0012 的约定），且行号会漂 —— 改函数就同步改文档里的函数名与行号。

## 8. 给 to-spec 的一句话

这份 spec 的读者是**执行会话**（通过 `/to-goal` 从下一张 frontier 票编译出来的目标），不是人。所以验收条件要能被命令验证（`node --test` 的红绿 + 断言），而不是「图看起来对了」。
