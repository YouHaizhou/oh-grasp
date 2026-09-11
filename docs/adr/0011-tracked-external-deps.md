# 外部依赖可追踪：`uses` 与 `runtime`

反馈第 6 条的后半段：「图上标明一个输入/无输入，具体里边有多个不同输入」——这是端口口径的问题（ADR-0009 已答），但它在核查过程中**牵出了一个更大的盲区**：当前 IR 根本不知道「谁用了什么外部依赖」。

## 事实：三个都查不出来

核查 round19 Q6 时我跑了一版代理估算（拿每个 external 的导入符号名去匹配 41 个 internal 模块的源码），结果：

```
 2  node:url
 2  ../renderers/shared/output-path.mjs
 1  node:child_process / node:crypto / ./preview.mjs / …
 0  node:fs / node:os / node:path / scenarios.mjs   ← 全是 default 导入
```

**返回 0 的那四个恰恰是最常用的。** `node:fs` / `node:path` / `node:os` / `scenarios.mjs` 都是 `import fs from 'node:fs'` 这种 default 导入，`input: ["default"]` 里没有符号名可匹配，代理估算对它们**完全失明**。

这不是估算方法的问题，是 **IR 的形状问题**：

- `connections` 只允许 internal ↔ internal（validate 硬拒 external 端点），所以实排的 boundary connection 数是 **0**——外部依赖完全不在数据流里；
- 41 个 internal 模块的字段集里**没有** input / output / uses 这一类字段；
- 14 个 external 模块只带自己的导入符号，**不记录谁用了它**；
- 另有 6 个模块引用 `process.*`，而 `process` 不是 import——它压根不是一个模块。

结果是「改了 `node:path` 会炸谁」这个问题**在图里没有任何答案**。

## 决策一：新增 `module.uses`

internal 模块上标它**直接消费**的 external 模块 id 数组：

```jsonc
{ "id": "mod_render", "type": "internal", "label": "render",
  "uses": ["ext_path", "ext_fs"] }
```

- validate **硬校验**：每个 id 必须存在，且必须是 `type: "external"`；
- 这是**消费关系，不是数据流边**——外部依赖仍然不进 `connections`，ADR-0006 的「数据流只在 internal 之间」不破。

考虑过「放宽 `connections` 允许 external 端点」，否掉：那会让数据流图混进「模块引用了库」这种静态关系，读者分不清哪条线是运行时流动、哪条是编译期依赖。两种关系分开两个字段，画法也能分开。

## 决策二：新增 `module.runtime`

宿主运行时调用，自由字符串数组：

```jsonc
{ "id": "mod_main", "runtime": ["process.exit", "process.cwd", "process.env"] }
```

**值必须是属性路径**——不带括号、不带说明、不加参数。validate 用正则校验（`^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)+$`）。

理由：`process.exit` 与 `process.exit(1)` 是**同一个结构事实**（这个模块会终止进程），参数是细节不是结构；`process.env` 本身是**属性不是调用**，写成 `process.env()` 是不存在的调用形式。不许自然语言描述（`"process.exit(1) 终止进程"`）是因为它是唯一的自由文本字段，自由到不统一就会碎——同一个符号被写成四种样子，反向索引和去重全部对不上。

**命名史**：字段最初叫 `env`。这 6 个模块用的是三样东西——`process.exit`（**副作用**，终止进程）、`process.cwd`（上下文）、`process.env`（环境输入）。叫 `env` 会把「终止进程」归进「环境输入」里，名不副实。改叫 `runtime`（宿主运行时调用，含输入与副作用），弹窗那一节标题标「宿主调用 Host」。

## 决策三：显示三处

| 位置 | 显示什么 |
|---|---|
| group 弹窗 | 分两段：「组间边」（原「边界数据流」）+「成员直连外部」（成员的 `uses` 按 external 归并） |
| 叶子弹窗 | 加一行：`依赖 node:path · 宿主 process.exit` |
| 外部依赖侧栏卡片 | 加**反向索引**：哪些模块用了它 |

反向索引用**前 3 个 + `+M`**（与边中点标签 `a · b +2` 同一套约定），点卡片展开全列。理由：14 张卡片全部列出会让卡片长短悬殊、侧栏变成一堵墙；只给数量（`↳ 8 个模块使用`）则把答案藏起来——读者想知道的是「**谁**在用」，不是「几个」。复用同一套 `+N` 约定，读者学一次规则能用两处。

反向索引是**几乎零成本的高价值**：`node:path` 那张卡片现在只说「path 工具」，读者还是不知道该不该动它；列出消费者，侧栏才开始回答「改了它会影响谁」。而且这个数据**本来就要填**（41 个模块都要过一遍源码标 `uses`），侧栏只是换个方向读同一个字段。

## 决策汇总（supersede 关系）

| 决策 | 来源 | 取代 |
|---|---|---|
| `module.uses` = external id 数组、硬校验 | round18-Q8 | — |
| `module.runtime` = 属性路径数组、正则校验 | round18-Q4、round19-Q5、round20-Q2 | — |
| 外部依赖不进 `connections` | round18-Q8 | — |
| 显示三处（group 弹窗两段 / 叶子依赖行 / 侧栏反向索引） | round19-Q6 | ADR-0006 的「组间边」单段 |
| 反向索引前 3 + `+M`、点开全列 | round20-Q3 | — |

## 代价与已知限制

- **41 个 internal 模块都要过一遍源码才能填准 `uses`**，这是重新生成时主要的工作量来源之一。
- `uses` 是**直接**消费，不传递（A → B → C 不推出 A → C）。要看传递影响得靠人顺着图走——这是刻意的：传递闭包在图上是噪音。
- `runtime` 目前只覆盖 `process.*`。「宿主运行时提供的其他东西」（如 `globalThis`、定时器）没进这个字段，遇到再扩。
