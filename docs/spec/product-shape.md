---
status: ready-for-agent
triage-label: ready-for-agent
route: to-tickets
tracker: local-files — .scratch/oh-grasp/issues/（01 到 08，八票，本地文件未入库）
supersedes: .scratch/oh-grasp/spec.md 的产物形态部分（story 19 已作废）
decisions: docs/adr/0008-bilingual-artifact.md, 0009-routing-and-ports.md, 0010-unified-interaction.md, 0011-tracked-external-deps.md, 0012-algorithm-docs.md
---

# oh-grasp 产物形态重做（双语 · 可读路由 · 统一交互）

## Problem Statement

一个开发者拿到 oh-grasp 产出的**文件结构图**，读不懂它。八个具体症状：

1. **连线穿过模块，产生交叉** —— 跨多层的长边是曲线，中段压在中间层的盒体上，线断了。
2. **数据流动读不懂** —— 连线上写着 `rendererPath → renderer script path → commandRender`；另一处 `exitFrom ← subprocess result ← commandRender`。这种写法**第一时间看不懂**，需要有人告诉你「这个数据从哪来、经过什么处理、输出了什么、用于什么」。
3. **整体产物只有英文可读性** —— 上面的病根是：47 条 connection 的 `label` 全是模型写的英文数据名，而所有说明性文字（`description` / `detail` / 输入输出 / 分组描述）**都是中文**。中英混杂，两边都读不顺。用户要求支持中英文两种版本。
4. **连线上的名字看不懂** —— 同 2，`renderer script path` 放在线上，脱离源码读不出意思。
5. **连线的箭头被 group 的输入/输出端点阻挡** —— 入边终点画在盒的上边缘，被后画的盒体/端口圆点盖住。
6. **输入输出和具体内容对不上号** —— 图上标「一个输入」/「无输入」，点开里边却有多个不同输入。端口旁的 `×N` 数的是**连接条数**，而空方向被**整个隐藏**。此外「谁用了 `node:path`、改了它会炸谁」**在图里没有任何答案**——外部依赖根本不在数据模型里。
7. **左右侧空白太多** —— 画布被 `max-width` 卡住，没有铺满界面。
8. **有两个界面** —— 底部能在「流程图」和「文档式表格」之间切换，用户要求**只展示一个界面**。

## Solution

把产物从「一张能看的图」改成「一张读得懂的图」，分五条线：

**一、双语产物。** IR 里的**散文**（说明、描述、标签、四段）全部改存 `{zh, en}`，**名字不译**——内部模块的名字是源码标识符、外部模块的名字是包名，译了就对不上代码。中英两版**都必填**，缺一不出图。切换器在图内顶部，默认中文。

**二、边有四段说明。** 每条 connection 上写死四个字段：`source`（从哪来）/ `process`（经过什么处理）/ `output`（输出了什么）/ `purpose`（用于什么），中英各一套。画布中点只放一句**中文动宾短语**（如「传入渲染器路径」），点开边才看四段。

**三、路由不再穿盒。** 跨多层的长前向边改走**虚节点正交折线**——在层间空隙插无实体的折点，逐层直角穿下，允许边与边交叉但不穿盒体。右侧那条通道**只留给反馈边**，保住「在右侧 = 数据回流」这个语义信号。

**四、端口说人话。** 端口旁的 `×N` 从「连接条数」改成「**不同内容种数**」（按 `zh` 文本去重，切换语言数字不变），代表内容直接画在 `×N` 右侧；**空方向不隐藏，显式标「—」**。

**五、一个界面。** 删掉文档式视图与切换器。内容全部收进**一个统一弹窗**，由四个入口唤起（节点 / 端口 / 边 / 依赖卡片），清单里的行可以点进去看四段说明、并有一层「返回」。外部依赖补进数据模型（`uses` / `runtime`），侧栏卡片给**反向索引**——列出哪些模块用了它。画布去掉 `max-width` 铺满宽度。

## User Stories

### 双语（症状 3）

1. As a developer reading the diagram, I want every explanatory text in Chinese, so that I can understand the file without decoding English data names.
2. As a developer, I want every explanatory text also in English, so that I can share the diagram with a reader who doesn't read Chinese.
3. As a developer, I want to switch the diagram's language from the top of the page, so that I don't have to hunt for the control.
4. As a developer, I want the diagram to open in Chinese by default, so that every fresh open is predictable.
5. As a developer, I want the language choice not to be remembered between opens, so that I'm never surprised by an unexplained English page.
6. As a developer, I want module names to stay in their original form in both languages, so that the name on the diagram is the name I can grep for in the source.
7. As a developer, I want external package names to stay untouched, so that I can copy them into a package manager.
8. As a developer, I want the fixed UI wording (输入 / 输出 / 依赖 / 数据流 / GROUP …) to follow the language too, so that a switched language isn't half-translated.
9. As an agent producing the IR, I want the bilingual requirement to be validated, so that I can't silently ship a half-translated diagram.
10. As a maintainer, I want a missing language to be a hard validation error rather than a fallback, so that "mixed Chinese-English" — the original complaint — cannot come back.

### 边四段说明（症状 2、4）

11. As a developer, I want to click a connection and read where its data comes from, so that I understand the flow without opening the source.
12. As a developer, I want that same popup to tell me what processing happens, so that I know what changed between the two modules.
13. As a developer, I want that same popup to tell me what is output, so that I know what the next module receives.
14. As a developer, I want that same popup to tell me what the output is used for, so that I know why the edge exists at all.
15. As a developer, I want each of those four answers to be one sentence, so that I can read them at a glance instead of parsing a paragraph.
16. As a developer, I want the four parts to be available in both languages, so that the explanation is as readable as the rest of the diagram.
17. As a developer, I want the edge midpoint to show a short Chinese verb phrase instead of a raw English data name, so that I can tell what the edge does without clicking.
18. As a developer, I want edges carrying the same content to describe it identically wherever they appear, so that I don't suspect two names of meaning two different things.
19. As a developer, I want a collapsed edge to list its parts when opened, so that I can read atomic explanations that have no visible edge of their own on the canvas.

### 路由与端口（症状 1、5、6）

20. As a developer, I want long connections to never cross module boxes, so that I can follow a line from end to end.
21. As a developer, I want long connections to travel down the gaps between layers, so that the line stays inside the diagram instead of leaving the canvas.
22. As a developer, I want the right-hand lane to hold only feedback edges, so that position alone tells me a connection flows backwards.
23. As a developer, I want incoming arrows to land clear of the port dot and box outline, so that I can see where a line terminates.
24. As a developer, I want the port count to mean "how many distinct kinds of content", so that the number matches what I find when I open it.
25. As a developer, I want a representative content shown next to the port count, so that I know what flows there without opening anything.
26. As a developer, I want that count to stay the same when I switch languages, so that the structure doesn't appear to change.
27. As a developer, I want a direction with no data to show an explicit dash instead of nothing, so that I can tell "no inputs" apart from "the diagram forgot to draw it".
28. As a developer, I want a long edge to still respect module ordering inside each layer, so that the layout doesn't strand it behind unrelated boxes.

### 统一交互（症状 5、8）

29. As a developer, I want one popup component for all detail, so that I learn the interaction once.
30. As a developer, I want to open module detail by clicking a module, so that I can inspect it without leaving the diagram.
31. As a developer, I want to open the connection list by clicking a port, so that I can see exactly which connections make up a count.
32. As a developer, I want to open an edge's four-part explanation by clicking the edge, so that reading the flow is one click.
33. As a developer, I want the clickable area of an edge to include its whole path and its midpoint label, so that I don't have to hit a hairline.
34. As a developer, I want an external dependency's card to open its consumer list, so that I can see who depends on it.
35. As a developer, I want rows inside those lists to be clickable, so that I can reach the four-part explanation for a connection that has no visible edge on the canvas.
36. As a developer, I want a back affordance inside the popup, so that closing a nested view returns me to the list I came from instead of the canvas.
37. As a developer, I want to close the popup with Escape, so that keyboard users aren't trapped.
38. As a developer, I want hovering a module to reveal its full name, so that a name truncated by the box width is still recoverable.
39. As a developer, I want hovering an edge to reveal its midpoint phrase, so that a truncated label is still readable.
40. As a developer, I want hover hints in my current language, so that they match what I'm reading.
41. As a developer, I want only one view of the diagram, so that I don't have to decide which one to use.
42. As a developer, I want the arrow-key and URL-parameter view switching gone, so that the removed view can't be reached by a stale link or an accidental keypress.

### 铺满（症状 7）

43. As a developer, I want the diagram to use the full page width, so that I'm not reading a narrow column with dead margins.
44. As a developer, I want the canvas to fit a short diagram without a large empty band, so that a small sub-diagram doesn't float in whitespace.
45. As a developer, I want the canvas to keep viewport height when the content is tall, so that I can still zoom and pan to see the whole graph.
46. As a developer, I want a small graph to be scaled up to fill the canvas, so that "fit" means fit in both directions.

### 外部依赖可追踪（症状 6 后半）

47. As a developer, I want each internal module to record which external modules it consumes, so that I can answer "what does this module depend on" without reading its source.
48. As a developer, I want to see the external dependencies of a group's members grouped together, so that a group's dependency surface is one click away.
49. As a developer, I want each internal module to record its host-runtime calls, so that I know which modules can terminate the process or read the environment.
50. As a developer, I want runtime calls written as plain property paths, so that the same call isn't recorded four different ways.
51. As a developer, I want a dependency's card to list its consumers, so that I can tell what a change to it would affect.
52. As a developer, I want a long consumer list collapsed to the first few with a remainder count, so that the sidebar doesn't turn into a wall.
53. As a developer, I want to expand a collapsed consumer list, so that the full answer is reachable.
54. As an agent producing the IR, I want `uses` validated against real external module ids, so that a typo doesn't produce a dangling dependency.
55. As an agent, I want a malformed runtime path rejected, so that I get a precise error instead of shipping inconsistent free text.

### 维护者

56. As a maintainer, I want the algorithm documentation updated alongside the layout changes, so that the "what runs now" record doesn't drift from the code.
57. As a maintainer, I want the removed view's user story marked obsolete rather than deleted, so that the history shows what was decided against.
58. As a maintainer, I want the four-part and bilingual requirements documented in an ADR, so that a future reader knows why the IR carries duplicate prose.

## Implementation Decisions

决策以 **ADR-0008 至 ADR-0012** 为准，此处只列实现层面的落地形状。改动落在增强服务的四个产物部件（`prompt` / IR `schema` / **校验脚本** / **查看器**）与装配层。

### 数据模型：IR schema

**语言嵌套方向是「语言在外」。** 可译字段从 `string` 变成 `{zh, en}` 对象：

```jsonc
// 可译（散文）
"subtitle":  { "zh": "把 Markdown 渲染成 HTML", "en": "Render Markdown to HTML" }
"label":     { "zh": "参数解析", "en": "Argument parsing" }        // group.label / connection.label
"description": { "zh": "…", "en": "…" }                            // module.description / module.detail
"input":     [ { "zh": "CLI 参数", "en": "CLI arguments" } ]        // meta.input / meta.output 的每个元素

// 不可译（名字，保持 string）
"title":  "archify.mjs"        // 文件名
"label":  "parseArgs"          // internal 模块 = 源码标识符
"label":  "node:fs"            // external 模块 = 包名
"id" / "source" / "sourceLine" / "from" / "to" / "group"   // 全部保持 string
```

**connection 新增 `description`，固定四字段：**

```jsonc
"connections": [{
  "from": "…", "to": "…",
  "label": { "zh": "传入渲染器路径", "en": "pass the renderer path" },
  "description": {
    "zh": { "source": "…", "process": "…", "output": "…", "purpose": "…" },
    "en": { "source": "…", "process": "…", "output": "…", "purpose": "…" }
  }
}]
```

字段名保留 `source` / `process` / `output` / `purpose`：`from` 已被 connection 占用（表示源模块 id），不能挪来表示「数据从哪来」。

**module 新增两个字段（仅 internal）：**

```jsonc
"uses":    ["ext_path", "ext_fs"],              // 该模块直接消费的 external 模块 id
"runtime": ["process.exit", "process.cwd"]      // 宿主运行时调用，只写属性路径
```

`uses` 是**消费关系，不是数据流边**——外部依赖**不进** `connections`（维持 ADR-0006 的「数据流只在 internal 之间」）。`uses` 是**直接**消费，不传递。

### 校验规则

| 规则 | 强度 | 说明 |
|---|---|---|
| 每个可译字段 `zh` 与 `en` **都必填**且非空 | **硬报错** | 不做「缺一种就回退」——静默回退会让中英混杂回来 |
| `connection.description` 四段**都必填**且非空 | **硬报错** | 四段缺一即不完整 |
| 四段每段**长度上限** | **不校验** | 长度是 prompt 的风格指引（约 ≤40 字），不是契约——硬限会逼模型砍掉限定语 |
| `uses[]` 每项必须存在且 `type === "external"` | **硬报错** | 防悬空依赖引用 |
| `runtime[]` 每项匹配属性路径正则 `^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)+$` | **硬报错** | 唯一自由文本字段，必须统形 |
| 同 `label` 复用同一段四段文字 | **不校验** | prompt 要求；允许上下文导致的合理差异 |

**`×N` 的计数口径不在校验范围**——它由查看器从 `connections` 实时算（内容种数，按 `zh` 去重）。

### 查看器

**取值函数**：一个 `pick(field, lang)` 贯穿全部散文字段，切换语言 = 换一个子树。所有读取点必须走它，不留直接取字符串的旁路。

**UI 文案表**：查看器内建 `T = {zh: {…}, en: {…}}`，覆盖那批固定文案（输入 / 输出 / 依赖 / 内部数据流 / 边界数据流 / GROUP / INTERNAL / 空方向「—」 / 提示行 / 弹窗分节标题）。这些不属于 IR。

**语言切换器**：顶部 header 内、标题右侧。默认中文，不记忆（不用 localStorage）。

**路由**：跨层 ≥ 2（`to.layer − from.layer ≥ 2`）的前向边改走虚节点正交折线；虚节点在每对相邻层之间插入一个，横向位置取该层的空隙，**参与层内 barycenter 排序**。允许边与边交叉，只保证不穿盒体。右侧通道**只放反馈边**。

**端口口径**：`×N` 的 N = 该方向上的**不同内容种数**；去重按 `zh` 文本；代表内容取 IR 顺序第一条，画在盒内 `×N` 右侧（用现有 `fitWidth` 截断，**盒高不变**）。空方向显式渲染「—」。

**入边端点**：终点落在端口圆点外缘上方约 8px（反馈弧入端同样处理）。**不动层序**——节点仍盖住边端点，只让箭头落在端口正上方可见。

**统一弹窗**：一个组件、四个入口（节点 / 端口 / 边 / 依赖卡片）。清单行可点，弹窗带**一层返回**（面包屑 `← 返回 参数解析`），回到底层再关才真正关闭。点边命中区 = 整条路径 + 中点标签。hover 用原生 `title`（当前语言：节点全名 / 中点短语）。**加 Esc 关闭**。

**删除**：文档式视图的渲染函数、底部切换器、`?variant=` URL 参数、左右方向键、以及文档式视图的全部 CSS。

**布局与视口**：去掉画布的 `max-width`；画布高度 = `min(内容高度, 视口高度)`（不再写死高度）；`fit()` 允许放大 1~2×（原为 `min(1, …)`，只在缩小方向工作）。缩放仍为光标锚定、缩放范围仍夹在 `[0.4, 3]`。

**外部依赖三处显示**：group 弹窗分两段（「组间边」+「成员直连外部」）；叶子弹窗加一行依赖（`依赖 node:path · 宿主 process.exit`）；侧栏依赖卡片加反向索引（前 3 个 + `+M`，点开全列，与边中点标签 `a · b +2` 同一套约定）。

### prompt

需明确要求：双语都要写（不许只写一种）；**同 `label` 复用同一段四段文字**；四段各一句、每段约 ≤40 字；`uses` 只列**直接**消费的 external id；`runtime` 写属性路径、不带括号、不带参数、不带说明。原 prompt 里「一个 import = 一个外部模块」「只读这一个文件，不追 import」「internal 模块须用源码中真实标识符」全部保留。

### 装配层与自包含约束

查看器源码仍是**内联**进产物 HTML 的（渲染时读入拼进 `<script>`），因此产物必须继续满足**零外部引用**：不引入任何外部 `<link>` / `<script src>` / CDN / 外部字体。新增的双语文案表属于查看器源码的一部分，不引入新资源。

### 文档

`docs/algorithms/` 按 ADR-0012 的约定跟着代码改（行号是快照，以函数名为准）。spec 的 story 19（切换两种视图）保持**标作废但不删**。

## Testing Decisions

**好测试的标准**：只断言**外部行为**，不断言实现细节。三条：

- 校验脚本——给定 IR 返回 `{ok, errors[]}`，断言 ok 与错误 path；
- 渲染——给定 IR 返回 HTML 字符串，断言自包含性与内容存在；
- 查看器纯内核——断言几何/计数函数在给定 IR 下的**返回值**，不断言内部数据结构。

**测试命令是 bare `node --test`**（自动发现 `test/`）。

> ⚠️ **不要用 `node --test <目录>`**：本机 node v22.20 把目录参数当模块去 `require`，报 `MODULE_NOT_FOUND`。要指定路径就显式列文件。

**基线**：`4a36602` 上 **62 passed / 0 failed**。实现过程中应保持这个数目只增不减。

**三个 seam，全部已存在，不新开**（`to-spec` 的要求是「现有 seam 优先、取最高处」）：

| seam | 接口 | 覆盖 |
|---|---|---|
| **校验**（主 seam） | `validate(ir, source?) → { ok, errors[] }` | 双语必填、四段必填、`uses` 引用、`runtime` 正则、原有 schema/存在性 |
| **渲染装配** | `render(ir) → html` | 自包含性、双语切换器存在、被删视图**不再**出现 |
| **查看器纯内核** | `require('../viewer.js')` 导出的布局/计数函数 | 虚节点路由、端口口径（`×N` 内容种数）、中点标签聚合、布局几何 |

第三条是关键：查看器上部的布局算法在 Node 下**已经可测**（DOM 应用被 `typeof document` 门挡住）。本轮布局改动**不需要新 seam**。

**Prior art**：三个测试文件已在用（校验 314 行 / 渲染 95 行 / 布局 156 行），用 `require('node:test')` + `node:assert`，无测试框架依赖。新测试沿用同一形状。

**必须新增的测试点**：

1. **切换语言后 `×N` 不变**（按 `zh` 去重是运行时的，最容易写错成按当前语言去重）。
2. **空方向渲染「—」** 而非不渲染端口。
3. **跨层 ≥2 的边不穿盒**——断言折线各段的横向区间不落在中间层任何盒的 x 区间内（纯几何断言，可测）。
4. **`uses` 指向 non-external 时报错**；`runtime` 写 `process.exit()`（带括号）时报错。
5. **缺 `en` 的散文字段报错**，且错误 path 指到具体字段。

**fixture 缺口（重要）**：现有 fixture `oh-grasp/examples/sample.ir.json` 只有 **5 modules / 3 connections / 0 groups**，而本轮改动的大半（端口 `×N`、代表内容、空方向「—」、虚节点、group 弹窗两段、边界数据流清单）**全都是 group 才有的行为**——**零覆盖**。升双语时必须**同时补一个带 group 的 fixture**，否则这些新行为只能靠对真实产物人工看。

**fixture 必须与校验改动同步升级**：fixture 不升双语，校验与渲染测试会全红——那是预期行为，不是回归。

## Out of Scope

- **重新生成 `generated/` 下的真实产物 —— 由用户手动执行**，不在本 spec 的实现范围。实现只负责让工具链能接受并正确渲染新 IR。
- 非 JavaScript 文件（Python / TS 等）、非代码文件（Markdown、配置）。
- 项目级文件图（多个单文件图聚合）+ 图内容排版。
- DSH / Codex 等其他平台的适配器。
- 复用 Archify 的任何代码。
- Mermaid 输出。
- 查看器的重功能（guided views / overview map / 多主题预设 / delta 比对）。
- 视图切换（已删，story 19 作废）。
- 四段说明的**长度硬校验**（刻意不做，见 Implementation Decisions）。
- `uses` 的**传递**闭包（只记直接消费）。
- 已知复杂度负债的修复（Kahn 的 `O(V²)`、barycenter 的 `O(V·E·passes)`）——当前规模无感，不在本轮。

## Further Notes

- **顺序约束（必须遵守）**：校验脚本的「双语必填」硬报错、以及 fixture 升双语，**排在最后一片**。理由：它一落地，`generated/` 里现有的单语 IR 立刻全线报错，而重新生成是用户手动做的、在实现之后。若与工具链改动同批，会留下一段「工具链是好的、产物是坏的」的窗口——无法区分「校验写错了」和「产物还没更新」。
- **route 定为 `/to-tickets`**，不是 fork + `/spec-executor`。判据：改动面十处以上，且规划会话已 21 轮 + 一次压缩，**thread 不 coherent**。
- **tracker 用本地文件**：`.scratch/oh-grasp/issues/`，一票一文件，blocking edge 写在票里。每张票应能被 `/to-goal` 编译成一个干净执行会话的目标。
- **验收条件要能被命令验证**（`node --test` 的红绿 + 断言），因为执行会话是从票编译出来的目标，不是人。
- **生成的量级**：重新生成产物是约 **700 句**（约 166 条散文字段 × 2 语言 + 47 条 connection 的四段 × 2 语言 + 41 个模块的 `uses`/`runtime`）。这是用户的实际工作量，不是「跑个脚本」。
- **v1 spec 保留在 `.scratch/oh-grasp/spec.md` 作为历史**；本文件是 v2，取代它的产物形态部分。
- **scratch 文件不入库**：`oh-grasp/fortest/`（被分析的源文件）与 `temp.md` 保持未跟踪。
- 本轮决策的完整来龙去脉在 `docs/grill-with-docs/round16`–`21.md`；其中 **round20 开头有一条更正**，解释为什么「外部依赖的消费者数」在旧 IR 里根本查不出来——那正是 `uses` 要修的盲区。
