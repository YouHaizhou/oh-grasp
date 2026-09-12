# 图算法

**要解决的核心问题**：输入是一张**可能有环**（`render → cli_core` 这类回边）、**可能不连通**（`grp_diag` 那片独立区域）、**可能有孤立节点**（没有任何连接的模块）的有向图。输出必须是每个节点的一组二维坐标，且

- 方向感清晰：数据从上游流向下游，读者从上往下看；
- 盒子不重叠；
- 交叉尽量少——交叉是连线图可读性的头号杀手。

这是 Sugiyama 分层布局（分层 → 层内排序 → 坐标分配）的一条**轻量**实现：省掉了坐标分配的细化阶段（如 Brandes-Köpf），用「行内居中」代替。

---

## 1. 三色标记 DFS 找后向边（断环成 DAG）

**问题**：分层布局要求图是 DAG（有向无环）。实际数据流里有环——`commandRender` 调子进程，子进程结果又回到 `cli_core`，图上就是一条 `render → cli_core` 的回边。环不处理，Kahn 会卡住。

**做法**：一趟 DFS，节点三色标记

| 颜色 | 含义 |
|---|---|
| 未访问（undefined） | 还没进过 |
| 灰（1） | 在当前 DFS 栈上（祖先链上） |
| 黑（2） | 子树已走完 |

遍历中遇到一条边指向**灰色**节点 → 它指向自己的祖先 → 这条边就是**后向边**，断掉它图就无环了。指向黑色节点是横叉边/前向边，合法，保留。

`backKey['u|w']` 去重：同一对 (u,w) 之间若有多条平行边（同向多条 connection），只断一次——否则会把不该断的也断掉。所有后向边收进 `back`，剩下的进 `fwd`。

**为什么是这个方案**：线性时间、实现短、且断出来的边**恰好就是读者心里的那些回边**（反馈弧），不需要额外解释。理论最优（最小反馈弧集）是 NP-hard，启发式就够。

**复杂度**：O(V+E)。递归实现——本项目 41 个模块，栈深无虞；若将来模块数上千需要改成显式栈（`components` 已经是显式栈，可参考）。
**位置**：viewer.js:248（后向边判定，在 `flowGeometry` 内）。
**测试**：`test/layout.test.js` —「2-cycle is broken into one DAG edge plus one feedback edge」、「triangle feeds exactly one feedback edge and stays acyclic」、「feedback lane is not included in the layout DAG edges」。

---

## 2. Kahn 拓扑排序 + 最长路分层

**问题**：给 DAG 的每个节点定一个**层号**（= 纵向第几行）。层号决定了全部纵向坐标。

**做法**：入度归零法（Kahn）跑一遍拓扑序；每处理一条 `u → v`，执行

```
layer[v] = max(layer[v], layer[u] + 1)
```

即「v 至少比它的**最深**前驱再深一层」。取 max 而非 min 是关键：取 min 会让节点浮到上面、与另一条路径上的前驱同层甚至更靠上，连线就会横穿。取 max 得到**最长路分层**——每条边都严格向下，从不横穿或上折。

**兜底分支**：理论上 DAG 跑完 Kahn 所有节点都会出队。代码里仍留了「未出队的节点放到最深层 +1」的兜底（viewer.js:276），因为上游的断环若有疏漏（例如自环 `from === to`），Kahn 会静默漏掉节点而不是报错——兜底保证**任何输入都不丢节点**。图上一个位置错了的盒子，好过一个凭空消失的盒子。

**已知低效**（量级无碍，登记在案）：
- 队列用 `Array.shift()` 出队 → O(n) 每次，整体 O(V²)。V = 层数级别的节点数时才需要换成游标队列。
- 兜底分支用 `fin.indexOf(id)` 扫全表 → O(V²)。

**复杂度**：O(V+E)，受上述两处影响。
**位置**：viewer.js:270（分层那一行，在 `flowGeometry` 内）。
**测试**：`test/layout.test.js` —「longest-path layering puts sinks deepest」。

---

## 3. 重心法（barycenter）交叉最小化

**问题**：层号定了之后，**同一层内**节点的左右顺序还是任意的。顺序决定交叉数——两个上一层节点各连一个下一层节点，若左右顺序反了，两条线就交叉。

**做法**：把「顺序」当成一个可优化的排列，用重心法迭代下降

- **下行扫描**（层 1 → 最底层）：本层每个节点的权重 = 它在**上一层**所有前驱的**平均位次**。
- **上行扫描**（最底层-1 → 层 0）：本层每个节点的权重 = 它在**下一层**所有后继的**平均位次**。
- 每层按权重排序；上下交替扫 `passes` 遍。

`passes = min(5, max(3, 层数))`：层数少时 3 遍足够收敛，多时不无限加——超过 5 遍的收益通常抵不过布局时间。

**无边节点**（该侧没有前驱/后继）权重取 `(对侧长度 - 1) / 2` ＝ 对侧中点，把它推到中间而不是贴边。

**为什么用重心法**：它是交叉最小化的经典启发式（也是最常用的基线），单遍线性、实现十几行。精确最优同样是 NP-hard。代价是可能收敛到局部最优——但对「层数 ≤5、每层 ≤4 个盒子」的实际图形，局部最优和全局最优基本一致。

**已知低效**：`predsOf`/`succsOf` 每次调用都 `fwd.filter(...)` 扫一遍全边集 → 单次排序 O(V·E)，整体 O(V·E·passes)。修法是预建 `from → edges` / `to → edges` 邻接索引（断环那一步已经有 `adj` 了，复用即可）。

**复杂度**：O(V·E·passes)。
**位置**：viewer.js:285（层内排序 / 重心扫描，在 `flowGeometry` 内）。
**测试**：层内顺序不影响 `flowGeometry` 的接口契约（`layers` 数组本身是返回值，测试断的是分层正确性与不重叠）。

---

## 4. 稳定排序（位次兜底）

**问题**：重心法每遍都要排序。若两个节点权重相等，排序算法若不稳定，顺序会随机抖动——同一份 IR 渲染两次得到不同的图，读者会以为数据变了（也会让测试无法断言）。

**做法**：Schwartzian 变换（`map → sort → map`）把「原下标」显式带进比较键：`sort((a,b) => a.w - b.w || a.i - b.i)`。权重相同则按原顺序（即拓扑序）——**确定的、可复现的结果**。

**为什么不用 `Array.prototype.sort` 的稳定性**：ES2019 起规范确实保证稳定，但依赖它会让「稳定性」变成一条看不见的隐含前提。显式写进比较键，代码自己说明了意图，也不受运行环境差异影响。

**复杂度**：O(n log n)，多一次数组映射的常数开销。
**位置**：viewer.js:287（`stableSort`）。

---

## 5. 弱连通分量分解（迭代 DFS，显式栈）

**问题**：一张 IR 图里可能有好几片互不相连的区域（`grp_diag` 那片就跟主线没有连接）。如果把它们塞进同一套分层，最长路分层会把互不相干的区域强行对齐到同样的层上，横向被拉得极宽——而它们之间根本没关系。

**做法**：按**无向**可达性（弱连通）分解：把每条边当成双向边建邻接表，对每个未访问节点做一次 DFS 收集整片，产出 `{nodes, edges}`（edges 只保留两端都在这片里的）。每片**各自**跑一套 `flowGeometry`，纵向依次堆开（见 geometry.md「区域堆叠」）。

用**显式栈**而不是递归：分量分解可能面对很深的链（400 个模块串成一条链就是 400 层递归），显式栈把这个限制消掉。

**注意**：弱连通（忽略方向）而不是强连通——两个节点只要**任一方向**可达，就该画在同一片里；强连通分解会把 `a→b` 和 `b→a` 分开，那不是我们要的。

**复杂度**：O(V+E)。`edges.filter` 每个分量扫一遍全边集，分量数为 k 时 O(k·E)（k 通常 ≤3）。
**位置**：viewer.js:210。
**测试**：`test/layout.test.js` —「components splits disconnected regions and isolates edgeless nodes」、「components treat undirected reachability (2-cycle stays one comp)」。

---

## 6. 首适应装箱（first-fit row packing）

**问题**：**没有任何连接**的节点（孤立的模块或分组）不属于任何分量，没有层可放。全堆一行会拉出超宽画布，一个一行又浪费高度。

**做法**：按输入顺序依次装箱——能放进当前行（`curW + HGAP + w <= GRID_CAP`）就放，放不下就换行。行宽上限 `GRID_CAP = 940`。行内按**实际宽度之和**居中（group 282 / leaf 236 混排时按实际叠加，不用「行数 × 最大值」估算）。

行间距 28px（比分层图的 `VGAP = 62` 紧）——网格带里没有连线穿过，不需要留出连线通道。**这是一处待统一的常量**：两处行距都叫「行间空隙」但取值不同，将来若要统一，先确认网格带变疏松不会让散节点区喧宾夺主。

**为什么是首适应而不是最优装箱**：这是「顺序排布」不是「二维装箱」——节点的**先后顺序有意义**（跟 IR 里的顺序一致，读者能预期），不能为了塞得更紧而重排。首适应是保序装箱里最简的一个。

**复杂度**：O(n)。
**位置**：viewer.js:356（`gridGeometry`）。
**测试**：`test/layout.test.js` —「gridGeometry wraps isolated leaves into rows capped near GRID_CAP」、「gridGeometry places a single node」。

---

## 7. 端口计数

**问题**：折叠后 group 盒子上要标 `×N`——这个 N 是多少。

**做法**：遍历所有聚合边，对每条边里的**每条原始 connection**，源 side 记「出」、目标 side 记「入」，但每个方向**按内容去重后才计数**：同向多条 connection 内容相同只算一种。计数单元仍是 connection（真实数据流），不是聚合边——聚合边是渲染层的合并，不该影响计数。

**为什么不是连接条数**：`grp_arg_parse` 的出端口有 12 条连接，其实只有 4 种内容——标 12 会让「点开数得清」落空。**去重键是 label 的 `zh` 文本**（不是连接条数、不是 label id、也不是 en 文本）。按 `zh` 而不是按当前显示语言，是因为按显示语言去重会让切到英文时 `×12` 变成 `×9`，读者会以为结构变了。

同时带出**代表内容**：该方向 IR 顺序第一条 connection 的 label 字段（原样存，渲染时按当前语言 `pick`），由 `nodeSvg` 画在 `×N` 右侧。返回 `{ id: { in, out, inRep, outRep } }`——`in`/`out` 是内容种数，`inRep`/`outRep` 是代表内容的 label 字段。

**点开的清单也用同一把尺子**：`×N` 说「4 种内容」，点开却列 12 行，就是同一处不一致换了个方向——「点开数得清」落空。所以端口清单（`portRows` / `portListHtml`）**分组键与 `countPorts` 完全一致**（`pick(label, 'zh')`），行数因此恒等于 `×N`，切语言行数也不变。组内取 IR 顺序第一条 connection 的 label 当该行内容（与 `inRep`/`outRep` 同一规则）；点开的单元在出方向恒为 `from`、入方向恒为 `to`，唯一在变的是**对端**——对端按首现顺序去重，多个时走 `uniqJoin` 收尾（见第 8 节，与边中点标签同一套表示）。

**复杂度**：O(E)。
**位置**：viewer.js:146（`countPorts`）、viewer.js:449（`portRows`）、viewer.js:477（`portListHtml`）。
**测试**：`test/layout.test.js` —「countPorts counts distinct content kinds per direction, not connections」、「countPorts works on monolingual artifacts (plain-string labels)」（单语产物：普通字符串按 zh 取值就是它本身，所以 N 不变）、「bilingual fixture exercises dedup: kinds < connection count」、「port list rows equal ×N on the bilingual fixture (kinds < connections)」、「port list rows equal ×N on a real-artifact-shaped port (8 connections, 4 kinds)」、「port list rows equal ×N on a monolingual graph (plain-string labels)」、「every port of the bilingual fixture has as many list rows as ×N, in both languages」。

---

## 8. 标签去重 + 截断

**问题**：一条聚合边折了多条 connection，中点位置只能放一小段文字。

**语义（ADR-0008 起）：中点是「动作」，不是「数据名」。** `label` 从「流的是什么」（`renderer script path` / `配置文件原文`）改写成一句**动宾短语**（「传入渲染器路径」/「传入配置文件原文」）——名词读不出这条线在干什么，动作才是一句话。四段说明（从哪来 / 经过什么处理 / 输出了什么 / 用于什么）是**点开才看的数据**，中点只放它的一句摘要（见第 10 节）。

**做法**：按 label 字符串去重（保持首次出现顺序），≤3 个用 ` · ` 连起来；多于 3 个只取前 `cap` 个 + ` +N`（N = 剩余不同标签数，`cap` 缺省 2）。用「不同标签数」而不是「连接数」，是因为 `+N` 要传达「还有 N 种别的东西」，重复的东西不该计数。

这套「去重 + 首现顺序 + `a · b +2`」抽成了 `uniqJoin(items, cap)`：**边中点标签、端口清单的对端、成员直连外部的成员名、叶子弹窗依赖行的两半、侧栏卡片的反向索引共用同一套表示**（读者学一次规则，五个面通用，ADR-0011）。`cap` 是**截断预算**（列几项）：3 项以内一律全列——最窄的面也放得下——再多才按面宽截断：画布与弹窗里的四处用缺省的 2（边中点标签、端口清单的对端、成员直连外部的成员名、叶子弹窗依赖行的两半——都是一行文字，格子窄），反向索引传 3（侧栏卡片宽，ADR-0011 决策三：前 3 个 + `+M`）。`edgeLabel(e, lang)` 现在只是「按语言取值 → `uniqJoin`」。

**去重键是「按当前语言取值之后」的文本**——中点是给人读的，显示哪种语言就按哪种去重。这与 `countPorts` / `portRows` 的 zh 键是两件事，别混：那两处的 N 是**数字**，切语言不能变（所以按 zh 去重，见第 7 节）；中点显示的是**文字**，本来就该跟着语言走。

**注意**：47 条 connection 只有 20 个不同 label（`renderer script path` 一类反复出现），所以去重口径直接决定中点显示什么。

**复杂度**：O(n²)（`indexOf` 查重），n = 该边折的 connection 数（≤12），无碍。
**位置**：viewer.js:178（`uniqJoin`）、viewer.js:190（`edgeLabel`）。
**测试**：`test/layout.test.js` —「edgeLabel dedupes and truncates at 3 unique labels」、「edgeLabel aggregates per language (labels are prose and go through pick)」、「bilingual fixture writes mid-point labels as action phrases, per language」、「port list collapses many peers with the same · / +N convention as edge labels」、「uniqJoin takes a per-surface cap, defaulting to the narrow surface two」。

---

## 9. 有序哈希聚合（含 collapse 折叠）

**问题**：顶层视图里，一个 group 的若干成员各自向另一个 group 的若干成员发数据流——画成 12 条线是灾难。必须合并成一条。

**做法**：以 `from|to` 为键建哈希，**保持首次出现顺序**（JS 对象键的插入序 + 一个 `order` 数组）。每条聚合边携带 `conns` 数组，存**原始** connection——因为弹窗里的端口清单要显示真实模块名，不能显示折叠后的 group 名。

`collapse` 回调把端点映射到上层单元（`member → 所在 group`，未分组的叶子映射到自己）。同一个函数服务两个层级：

| 场景 | collapse |
|---|---|
| 顶层视图 | `member → group` |
| 子图（group 内部） | 不传（成员就是成员） |

**为什么不用 `Map`**：需要序列化/调试友好（对象直接 `console.log` 可读），且键是短字符串、数量小，`Map` 的性能优势无意义。

**关键约束**：`collapse` 只影响**分组键**，`conns` 里始终保留原始 connection。这个约束是踩坑换来的——早期版本把 `conns` 也换成折叠后的端点，导致点端口打开清单时报 `Cannot read properties of undefined`（真实模块 id 被换成了 group id，`M[id]` 取不到）。

**同向自环**：折叠后 `from === to` 的边（组内边在顶层视图下）**不进顶层**，由调用方过滤（viewer.js:957，`renderA` 里折叠时就地丢掉）。

**复杂度**：O(E)。
**位置**：viewer.js:197（`aggregateEdges`）。
**测试**：`test/layout.test.js` —「aggregateEdges merges same-direction connections into one edge」、「aggregateEdges collapse groups parallel member edges, conns keep real endpoints」。

---

## 10. 四段说明：取值与清单（点边弹出）

**问题**：中点只有一句摘要（第 8 节），读者要知道「这条线上流的到底是什么」，得有地方读全。IR 里每条 connection 上写着四段——`source`（从哪来）/ `process`（经过什么处理）/ `output`（输出了什么）/ `purpose`（用于什么），中英各一套（ADR-0008）。

**形态：语言在外、四个固定字段名在内**

```jsonc
"description": { "zh": { "source": …, "process": …, "output": …, "purpose": … }, "en": { … } }
```

字段名固定，**不得改叫 `origin` / `how` / `what` / `why`**：改名会丢掉字段名与用户原话的一一对应；`from` 已被 connection 占用表示源模块 id，也挪不过来。**写在每条 connection 上，不建字典**——这样任何出现位置（顶层聚合边、子图、端口清单）点开都一致。四段是**可选**字段（缺席即不校验形态），「每条 connection 必须四段齐全」是契约步的事。

**三个函数各管一段**（照 `portRows` / `portListHtml` 的分家方式）

| 函数 | 干什么 |
|---|---|
| `pickPart(desc, lang, key)` | 取四段里的**一段**：先当前语言、再默认语言、再另一种语言。缺当前语言的回退与 `pick` 同源，是 expand 期的脚手架——契约步的双语硬校验上线后不可达 |
| `fourPartRows(edge)` | **行数据**：按**来源模块**分组（保 IR 首现顺序），组内保 IR 顺序，每组 `{ id, conns }` |
| `modName(id, M)` | 模块 id → 显示名（用户给的 `label` 原样，名字不译） |
| `fourPartHtml(edge, lang, M)` | **行 HTML**：每组一个来源模块标题 + 组内每条 connection 一段「流向 + 四段」 |

**为什么要按来源模块分组**：顶层视图里，一个 group 的成员各自向另一个 group 发数据流会被折叠成**一条**聚合边（第 9 节）——那些原子 connection 在画布上**没有对应的可见边**，这份清单是它们唯一的到达路径。按来源分组，是因为「谁发出的」是读者找那条线时的第一把钥匙。

**缺 description 时每段显式画「—」**：真实产物此刻 47 条 connection 一条 description 都没有（重新生成是契约步交付之后的事），点开必须不抛错、也不能静默留白——留白会让人以为那条线没有用途。流向那一行照常显示 label。

**清单行故意不可点**：「点开某一条 connection、再退回上一层」属于弹窗合并那一票，不在本步。此处只把四段平铺出来。

**复杂度**：O(E)，E = 该边的 connection 数。
**位置**：viewer.js:609（`pickPart`）、viewer.js:622（`fourPartRows`）、viewer.js:635（`modName`）、viewer.js:643（`fourPartHtml`）。
**测试**：`test/layout.test.js` —「pickPart reads one of the four fixed segments by language」、「fourPartRows groups a folded edge by source module, keeping IR order」、「fourPartHtml lists all four segments of every connection, grouped by source module」、「a connection without a description renders an explicit dash for each segment」。
