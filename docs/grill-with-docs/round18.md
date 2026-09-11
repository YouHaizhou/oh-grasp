Round 17 答案收到：**8 题全 a**。加上 16 轮，两轮的决策已经足够落 ADR-0008 了。本轮分两半：**先交你要的算法统计**，再问它和 round17 推开的下游。

---

## 一、算法统计（facts，你要的那份）

扫了 `viewer.js` / `render.js` / `validate.js` 三个文件，按**解决什么问题**归类，共 6 域、20 项。括号里是复杂度，标 ⚠️ 的是值得留意的。

### 1. 文本度量与折行（无 DOM 的宽度估算）

| 算法 | 解决什么问题 | 位置 |
|---|---|---|
| `chW` 字符宽度估算 | SVG 里画之前不知道文字多宽；CJK 按全宽、拉丁按 0.58em 估 | viewer.js:11 |
| `fitWidth` 单行裁剪 | 定宽盒里放不下的名字，截断并预留省略号宽度 | viewer.js:13 |
| `lineCap` 可容字符数 | 从某起点起能塞进一行的字符数（贪心累加） | viewer.js:34 |
| `wrap2` 两行折行 | description 折成至多 2 行，第 2 行仍超宽则截断 | viewer.js:40 |
| `cutGuard` 代理对边界修正 | 切点落在 UTF-16 低半代理上时多留一个码元，避免渲染成 U+FFFD | viewer.js:26 |

### 2. 图算法（宏布局主干）

| 算法 | 解决什么问题 | 位置 |
|---|---|---|
| 三色标记 DFS 找后向边 | 数据流里有环（`render→cli_core`），布局算法只吃 DAG。指向灰色祖先的边 = 后向边，断掉即得 DAG（Sugiyama 第一步） | viewer.js:144 |
| Kahn 拓扑排序 + 最长路分层 | 给每个节点定层号：`layer[v] = max(layer[u]+1)`。⚠️ 队列用 `Array.shift()`（O(n)），兜底分支用 `indexOf` 扫全表（O(V²)），41 个模块量级无碍 | viewer.js:159 |
| 重心法（barycenter）交叉最小化 | 层内排序压交叉：下行按前驱平均位次、上行按后继平均位次，交替扫描 `clamp(3..5, 层数)` 遍 | viewer.js:189 |
| 稳定排序（Schwartzian + 位次兜底） | barycenter 权重相同时保持拓扑序，避免布局抖动 | viewer.js:189 |
| 弱连通分量分解（迭代 DFS，显式栈） | 图里有互不相连的区域（`grp_diag` 那片），必须分开布局再纵向堆叠，否则会被强行拉进同一个分层 | viewer.js:112 |
| 首适应装箱（first-fit row packing） | 无任何连接的散节点没有层可放，按行打包成网格带，行宽封顶 940px | viewer.js:258 |
| 端口计数（O(E) 累加） | group 端口上的 ×N | viewer.js:71 |
| 标签去重 + 截断 | 一条聚合边折了多条 connection，中点只放 ≤3 个不同标签，其余折成 `+N` | viewer.js:85 |
| 有序哈希聚合 | 按 `from\|to` 键把同向 connection 并成一条边，保持首次出现顺序；`collapse` 回调把端点折叠到上一层单元（同一份代码服务顶层与子图） | viewer.js:99 |

### 3. 几何与路由

| 算法 | 解决什么问题 | 位置 |
|---|---|---|
| 三次贝塞尔前向边 | 层间连线：控制点落在两盒中点，竖向拉直 | viewer.js:338 |
| 反馈弧复合路径 | 回边走右侧 170px 通道：贝塞尔出 → 直线竖走 → 贝塞尔入，不与前向边打架 | viewer.js:344 |
| 行几何（层高 = 层内最高节点，行内水平居中） | `row pitch = max(node height) + VGAP`，group(96) 与 leaf(78) 混排时不错位 | viewer.js:226 |
| 区域堆叠 + 尾随网格带 | 每个弱连通分量纵向排开（各包一层 `translate`），散节点网格带收尾 | viewer.js:361 |
| 白描边文字（`paint-order: stroke`） | 边标签压在连线/网格上仍可读 | viewer.js:354 |
| SVG marker 箭头 | 箭头随路径切线自动转向（`orient="auto"`） | viewer.js:332 |

### 4. 视图变换

| 算法 | 解决什么问题 | 位置 |
|---|---|---|
| 光标锚定滚轮缩放 | 以鼠标位置为不动点解平移量：`t' = m − (m − t)·(s'/s)`，缩放时指哪放哪 | viewer.js:484 |
| 拖拽平移 + 3px 点击阈值 | 区分「拖动画布」与「点节点」——拖过就不算点击 | viewer.js:459 |
| 双击 fit | `scale = min(1, vw/W, vh/H)` 居中复位；缩放钳制 [0.4, 3] | viewer.js:476 |
| 一套控制器两处复用 | 顶层画布与弹窗子图共用 `attachFlow` | viewer.js:470 |

### 5. 校验

| 算法 | 解决什么问题 | 位置 |
|---|---|---|
| 引用完整性（Set 去重 + 存在性 + 类型约束） | id 不重复、`from/to/group` 指得到、connection 端点必须是 internal | validate.js:124 |
| 词边界正则存在性检查 | internal 模块的 `label` 必须在源码里真实出现（`\b` + `escapeRegExp`）；保证「图上的名字就是代码里的名字」 | validate.js:174 |
| 空白归一化子串匹配 | internal 模块的 `source` 必须是源码的**逐字复制**（换行/缩进差异不算数） | validate.js:182 |

### 6. 注入防护

| 算法 | 解决什么问题 | 位置 |
|---|---|---|
| HTML 转义 + JSON 内联转义（`<` → `<`） | 自包含 HTML 把 IR 内联进 `<script>`，源码里若含 `</script>` 会提前闭合标签；转义后注入失效 | render.js:114 / viewer.js:9 |

**没被用到的**（列出来免得你以为漏了）：没有文本真实测量（`getBBox`/`measureText` 一次都没用，全靠 `chW` 估算）；没有力导向；没有真正的正交路由（Q6 之后才会有）；没有虚拟节点（Q1 之后才会有）。

---

## 二、Round 18 · 8 questions

🔥 **Round 18** · 8 questions

🧩 **Q1** - **双语字段的作用域：哪些字段变成 `{zh,en}`**
- (a) **只译散文**：`meta.subtitle` / `meta.input` / `meta.output`、`group.label` + `description`、`module.description` / `detail`、`connection.label` + 四段。**标识符一律不译**：`meta.title`（是文件名 `archify.mjs`）、`module.label`（internal 是源码标识符，external 是包名 `node:fs`）、以及全部 id / `source` / `sourceLine` / `from` / `to` / `group`。
- (b) 除 id/source 外全译（含 `meta.title`、`module.label`）。
- (c) 只有模型写的散文译，UI 外壳保持现状。

💡 推荐 (a)。分界线是**这段文字是不是「名字」**——名字译了就对不上源码/包名，validate 的存在性检查也会立刻炸。另外补一句：viewer 里那批固定文案（`输入`/`输出`/`依赖 Dependencies`/`GROUP`/`内部数据流`/`×N` 的标题等）不属于 IR，要在 viewer 内建一张 `T = {zh:{…}, en:{…}}` 的表跟着切换——这条不管选哪个都得做。

ans：a.

🏷️ **Q2** - **四段说明的字段名：`connection.source` 与 `module.source`（源码原文）撞名**
- (a) **保留 `source/process/output/purpose`**，靠嵌套消歧（`connection.description.zh.source`）。注意 `from` 已经归 connection 表示源模块 id 了，**不能**用来表示「数据从哪来」。
- (b) 改名 `origin/how/what/why`。
- (c) 改成 `fromData/processData/outputData/usedFor`。

💡 推荐 (a)。「从哪来 / 经过什么处理 / 输出什么 / 用于什么」正是你反馈原话的四个词，字段名与它一一对应，读 IR 的人不用再翻译一层；嵌套已经把树上的位置说清楚了，撞名只是错觉。改名反而丢掉这层直白。
a
ans：

🧩 **Q3** - **双语的嵌套方向**
- (a) **语言在外**：`description: {zh:{…}, en:{…}}`、`label: {zh:"…", en:"…"}`
- (b) **字段在外**：`description: {source:{zh,en}, process:{zh,en}, …}`

💡 推荐 (a)。切换语言 = 换一个子树，`pick()` 一次取值；validate 的「双语必填」在 (a) 下就是每个字段 `['zh','en']` 循环一遍，在 (b) 下要递归到每个叶子才知道漏了哪个语言的哪一段。

ans：a.

🎯 **Q4** - **`uses` 的覆盖范围：进程级输入无处可放**（Q8 的推论）
事实：6 个 internal 模块引用 `process.*` —— `fail` / `exit_from` / `report_artifact_failure` / `report_compare_failure`（`process.exit`）、`run_node`（`process.cwd` + `process.env`）、`command_demo`（`process.cwd`）。而 `process` **不是 import**，没有 external 模块 id 可引用；`meta.input` 那 3 条又是手写的文件级散文。
- (a) **两个字段**：`uses` 只收 external 模块 id（可硬校验）；进程级输入另立自由字符串数组（如 `env: ["process.argv","process.env"]`）。弹窗第二段分「依赖」「环境」两行。
- (b) **一个数组两种前缀**：`uses: ["ext_path", "env:process.argv"]`。
- (c) 只列 import，忽略进程级输入。

💡 推荐 (a)。两种东西本来就不同质：external 是包的引用（能校验 id 存在），进程级是宿主环境（只能是自由文本）。分开放，校验强度也就分得开——`uses` 硬校验、`env` 只做字符串类型检查。(b) 把前缀塞进数据里，读 IR 的人得先知道前缀约定。

ans：a.

🧩 **Q5** - **去重的跨语言稳定性**（Q7 的推论）
事实：47 条 connection 只有 **20 个不同 label**（`renderer script path` 一类反复出现），所以去重口径直接决定端口上那个数字。
- (a) 去重按 **zh 文本**：语言无关，切换语言 **×N 不变**。
- (b) 去重按**当前语言文本**：切换语言数字可能变。

💡 推荐 (a)。数字是读者用来建立信任的东西——切一次语言发现 ×3 变成 ×2，第一反应是「图错了」，而不是「翻译撞车了」。(a) 同时也让计数与渲染语言解耦，测试只要一套 fixture。

ans：a.

⚖️ **Q6** - **长边路由：虚节点用到底，还是跨度大了改走侧栏**（Q1 的推论）
事实：顶层最长前向跨度只有 2 层（`arg_parse→render`、`cli_core→render` 这类）；右侧 170px 通道现在**专供反馈边**。
- (a) **一种机制**：所有跨层 ≥2 的前向边走虚节点；右侧通道**永远只留给反馈边**。读者凭「在不在侧栏」就能判断「这是回边」。
- (b) 跨度 ≥3 的前向边也走侧栏，虚节点只管跨度 2。

💡 推荐 (a)。侧栏一旦同时装「回边」和「长前向边」两种东西，它就从**语义信号**退化成**拥堵分流**——读者再也不能靠位置判断方向了。(a) 下虚节点是唯一的长边机制，规则一句话说得完。

ans：a.

👀 **Q7** - **聚合边的四段清单怎么组织**（Q4 的推论）
事实：顶层最大聚合边 = **6 条 connection**（`grp_arg_parse>grp_render`、`grp_misc_commands>grp_cli_core` 各 6 条）。6 条 × 四段 = 一个弹窗里 24 句。
- (a) 按**来源模块分组**：`extractQualityArgs` 一组，下面挂它那几条，每条给四段。
- (b) 平铺成一个列表，逐条给四段。
- (c) 默认折叠成摘要行，点「展开」才看四段。

💡 推荐 (a)。6 条平铺读者对不上号（哪条是哪个函数送的？），按来源分组正好回答「这个函数往外送了哪几样东西」——而这正是你要点开这条边的原因。弹窗过高就滚，不影响信息完整（子图的边通常只有 1 条，形状一样不别扭）。

ans：a.

🏷️ **Q8** - **算法文档的文件夹形态**
`docs/` 下现在有 `adr/`、`spec/`、`grill-with-docs/`，没有算法文档。
- (a) `docs/algorithms/` 下一个 `README.md` 索引 + **每个算法一个文件**（约 20 个小文件）。
- (b) `docs/algorithms/README.md` **一张大表**就够。
- (c) `docs/algorithms/` 下**按问题域分文件**：`text.md` / `graph.md` / `geometry.md` / `viewport.md` / `validation.md` / `rendering.md`，域内列该域的算法，顶层 `README.md` 做索引。

💡 推荐 (c)。上面那份统计天然就分成这 6 域——一域一页正好对应「它们解决的是同一类问题」，读者想查「连线怎么画的」直接翻 `geometry.md`。(a) 会把 `chW`（3 行）这种小事也拆成一个文件，碎； (b) 一张表放不下「为什么用这个算法」的说明。

另外两条我按这个推荐默认写进去了，若不同意现在说：
1. **与 ADR 的分工**：ADR 记「**为什么这么选**」（决策、取舍、被否掉的方案），算法文档记「**用了什么、解决什么问题、复杂度多少、代码在哪**」（现状）。同一件事不写两遍。
2. **只记已落地的**：末尾留一节「待实现」，指回 ADR-0008（虚节点正交路由、双语切换、光标锚定以外的变换），规划本身不写进算法文档，免得它变成许愿池。

ans：c

---

答完这一轮，我就按 Q8 建 `docs/algorithms/` 并落盘那份统计，同时把 round16+17+18 的决策写成 **ADR-0008**，然后进 `/implement`。
