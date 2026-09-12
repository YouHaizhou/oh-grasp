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
| 6 | 三色标记 DFS 找后向边 | 图 | viewer.js:144 |
| 7 | Kahn 拓扑排序 + 最长路分层 | 图 | viewer.js:159 |
| 8 | 重心法（barycenter）交叉最小化 | 图 | viewer.js:189 |
| 9 | 稳定排序（位次兜底） | 图 | viewer.js:189 |
| 10 | 弱连通分量分解 | 图 | viewer.js:112 |
| 11 | 首适应装箱（first-fit row packing） | 图 | viewer.js:258 |
| 12 | 端口计数（`×N` = 内容种数） | 图 | viewer.js:138 |
| 13 | 标签/对端去重 + 截断（`uniqJoin`） | 图 | viewer.js:167 |
| 14 | 有序哈希聚合（含 collapse 折叠） | 图 | viewer.js:99 |
| 15 | 三次贝塞尔前向边 | 几何 | viewer.js:338 |
| 16 | 反馈弧复合路径 | 几何 | viewer.js:344 |
| 17 | 行几何（层高 + 行内居中） | 几何 | viewer.js:226 |
| 18 | 区域堆叠 + 尾随网格带 | 几何 | viewer.js:361 |
| 19 | 白描边文字（`paint-order`） | 几何 | viewer.js:354 |
| 20 | SVG marker 箭头（`orient="auto"`） | 几何 | viewer.js:332 |
| 21 | 光标锚定滚轮缩放 | 视图 | viewer.js:484 |
| 22 | 拖拽平移 + 3px 点击阈值 | 视图 | viewer.js:459 |
| 23 | 双击 fit（含缩放钳制） | 视图 | viewer.js:476 |
| 24 | 引用完整性检查 | 校验 | validate.js:124 |
| 25 | 词边界正则存在性检查 | 校验 | validate.js:174 |
| 26 | 空白归一化子串匹配 | 校验 | validate.js:182 |
| 27 | HTML 转义 + JSON 内联转义 | 渲染 | render.js:114 / viewer.js:9 |
| 28 | 双语取值 `pick` / `pickList` | 渲染 | viewer.js:71 |
| 29 | UI 文案表 `T` + `tr` / `fmt` | 渲染 | viewer.js:86 |
| 30 | 端口清单去重（行数 = 内容种数） | 图 | viewer.js:431 |

## 待实现

尚未落地的算法（决策已定，见 `docs/adr/0008-*.md`），落地后再补进对应域：

- **虚节点正交路由** —— 跨度 ≥2 的前向边逐层穿盒间空隙（几何域）
- **自适应画布** —— 去掉宽度上限、高度随内容、允许放大（视图域）

（**双语切换**已落地，见 `rendering.md` §3：`pick` 取值 + viewer 内 `T` 文案表 + header 切换器。）
（**端点外移**已落地，见 `geometry.md` §1/§2：入边终点抬到目标盒上边缘上方 `PORT_GAP = 8` px。）

## 已知的复杂度隐患

41 个模块的量级下都无碍，但值得留名：

- Kahn 的队列用 `Array.shift()`（O(n) 出队）、兜底分支用 `indexOf` 扫全表（O(V²)）——见 graph.md
- 重心法的 `predsOf`/`succsOf` 每次调用都 `filter` 一遍全边集，整体 O(V·E·passes)——见 graph.md
