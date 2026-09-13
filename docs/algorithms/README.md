# oh-grasp 算法文档

记录 oh-grasp **实际落地**的算法：用了什么、解决什么问题、怎么做的、复杂度多少、代码在哪。

## 与 ADR 的分工

| | 记什么 | 位置 |
|---|---|---|
| **ADR** | **为什么这么选** —— 决策、取舍、被否掉的方案 | `docs/adr/` |
| **算法文档**（本目录） | **用了什么、解决什么问题** —— 现状快照 | `docs/algorithms/` |

同一件事不写两遍。想知道「为什么断环用 DFS 后向边而不是别的」，翻 ADR-0007；想知道「断环这一步具体怎么做的、在哪」，翻这里。

行号是快照，会随代码变动而漂移——**以函数名为准**，行号只作定位参考。

## 索引

| 域 | 文件 | 解决的核心问题 |
|---|---|---|
| 文本度量 | [text.md](text.md) | SVG 里画之前不知道文字多宽——不依赖 DOM 的宽度估算与折行 |
| 图算法 | [graph.md](graph.md) | 把一张可能有环、可能不连通的图，变成能画的分层坐标 |
| 几何与路由 | [geometry.md](geometry.md) | 连线怎么弯、标签压线怎么还看得清、多个区域怎么堆 |
| 视图变换 | [viewport.md](viewport.md) | 缩放/平移的手感——指哪放哪，拖拽不误触点击 |
| 校验 | [validation.md](validation.md) | 保证图上的东西和源码对得上（名字真实存在、源码逐字复制） |
| 产物渲染 | [rendering.md](rendering.md) | 自包含 HTML 的注入防护与装配 |

## 一览

| # | 算法 | 域 | 位置 |
|---|---|---|---|
| 1 | `chW` 字符宽度估算 | 文本 | viewer.js:11 |
| 2 | `fitWidth` 单行裁剪 | 文本 | viewer.js:13 |
| 3 | `lineCap` 可容字符数 | 文本 | viewer.js:34 |
| 4 | `wrap2` 两行折行 | 文本 | viewer.js:40 |
| 5 | `cutGuard` 代理对边界修正 | 文本 | viewer.js:26 |
| 6 | 三色标记 DFS 找后向边 | 图 | viewer.js:248 |
| 7 | Kahn 拓扑排序 + 最长路分层 | 图 | viewer.js:270 |
| 8 | 重心法（barycenter）交叉最小化 | 图 | viewer.js:295 |
| 9 | 稳定排序（位次兜底） | 图 | viewer.js:287 |
| 10 | 弱连通分量分解 | 图 | viewer.js:210 |
| 11 | 首适应装箱（first-fit row packing） | 图 | viewer.js:356 |
| 12 | 端口计数（`×N` = 内容种数） | 图 | viewer.js:146 |
| 13 | 标签/对端/反向索引去重 + 截断（`uniqJoin`，cap 按面宽） | 图 | viewer.js:178 |
| 14 | 有序哈希聚合（含 collapse 折叠） | 图 | viewer.js:197 |
| 15 | 三次贝塞尔前向边 | 几何 | viewer.js:664 |
| 16 | 反馈弧复合路径 | 几何 | viewer.js:670 |
| 17 | 行几何（层高 + 行内居中） | 几何 | viewer.js:237 |
| 18 | 区域堆叠 + 尾随网格带 | 几何 | viewer.js:771 |
| 19 | 白描边文字 + 标签白底衬（`paint-order`） | 几何 | viewer.js:696 |
| 20 | SVG marker 箭头（`orient="auto"`） | 几何 | viewer.js:751 |
| 21 | 光标锚定滚轮缩放 | 视图 | viewer.js:898 |
| 22 | 拖拽平移 + 3px 点击阈值 | 视图 | viewer.js:856 |
| 23 | 双击 fit（含缩放钳制） | 视图 | viewer.js:916 |
| 24 | 引用完整性检查 | 校验 | validate.js:221 |
| 25 | 词边界正则存在性检查 | 校验 | validate.js:280 |
| 26 | 空白归一化子串匹配 | 校验 | validate.js:288 |
| 27 | HTML 转义 + JSON 内联转义 | 渲染 | render.js:131 / viewer.js:9 |
| 28 | 双语取值 `pick` / `pickList` | 渲染 | viewer.js:71 |
| 29 | UI 文案表 `T` + `tr` / `fmt` | 渲染 | viewer.js:86 |
| 30 | 端口清单去重（行数 = 内容种数） | 图 | viewer.js:449 |
| 31 | 可点边单元（加宽命中路径 + `<title>` hover 提示） | 几何 | viewer.js:706 / viewer.js:664 |
| 32 | 四段说明清单（按来源模块分组 + 缺段显式「—」） | 图 | viewer.js:643 |
| 33 | 四段说明校验（语言在外、四格在内） | 校验 | validate.js:31 |
| 34 | 消费者清单 / 反向索引（数据源 = `module.uses`，宽面 cap 3） | 图 | viewer.js:508 / viewer.js:524 |
| 35 | `uses` 外键完整性（必须指向存在的 external） | 校验 | validate.js:178 |
| 36 | `runtime` 属性路径正则（拒括号与裸全局） | 校验 | validate.js:194 |
| 37 | 自适应画布（fit 允许放大 + 画布高 = min(内容高, 视口高)） | 视图 | viewer.js:881 / viewer.js:996 |

## 待实现

尚未落地的算法（决策已定，见 `docs/adr/0008-*.md`），落地后再补进对应域：

- **虚节点正交路由** —— 跨度 ≥2 的前向边逐层穿盒间空隙（几何域）

（**双语切换**已落地，见 `rendering.md` §3：`pick` 取值 + viewer 内 `T` 文案表 + header 切换器。）
（**端点外移**已落地，见 `geometry.md` §1/§2：入边终点抬到目标盒上边缘上方 `PORT_GAP = 8` px。）
（**可点边 + 四段说明**已落地，见 `rendering.md` §3/§5、`graph.md` §10、`validation.md` §5：一条边是一个 `<g class="edge">`（加宽命中路径 + `<title>`），点开弹四段；`connection.description` 此刻是**可选**字段，`generated/` 里那份产物还没有它——「每条 connection 四段齐全」是契约步的事。）
（**一个弹窗 + 四入口 + 消费者清单**已落地，见 `rendering.md` §3/§5：四个入口共用 `openModal` 一个容器与一条关闭路径，「点依赖卡片 → 消费者清单」是第四个入口；消费者行数据/行 HTML 在内核（`consRows` / `consListHtml`）。）
（**自适应画布**已落地，见 `viewport.md` §3：`fit` 的常数 1 换成 `FIT_MAX = 1.5`（原来只在缩小方向工作），顶层画布高由 fit 回填成 `min(内容高, 视口高)`、宽度上限 `max-width` 已删；同一批还删掉了文档式视图与底部切换器，界面只剩一个。）
（**外部依赖可追踪**已落地，见 `rendering.md` §3/§5 与 `validation.md` §1：internal 模块上的 `uses`（消费了哪些 external）与 `runtime`（宿主运行时调用，只写属性路径）由 validate 硬校验；显示在三处——group 弹窗第二段「成员直连外部」（`extUseHtml`）、叶子弹窗的依赖行（`depsHtml`）、侧栏依赖卡片的**反向索引**（`consIndex`，前 3 个 + `+M`）。消费者清单的数据源**就是 `uses`**：票 05 那版「具名导入符号匹配」的代理估算连同它的盲区（default 导入恒 0 行）已删除——见 `rendering.md` §3 的历史说明。`generated/` 里那份产物还没有这两个字段，填准它们是重新生成时的事。）
（**行号**：本表随改动重核过一轮；此后若代码再变，照 ADR-0012 以**函数名**为准。）

## 已知的复杂度隐患

41 个模块的量级下都无碍，但值得留名：

- Kahn 的队列用 `Array.shift()`（O(n) 出队）、兜底分支用 `indexOf` 扫全表（O(V²)）——见 graph.md
- 重心法的 `predsOf`/`succsOf` 每次调用都 `filter` 一遍全边集，整体 O(V·E·passes)——见 graph.md
