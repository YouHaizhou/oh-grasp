# 产物渲染

**要解决的核心问题**：产物必须是一个**自包含 HTML**——双击就能看，不需要服务器、不需要网络、不需要 npm install。这带来两个工程约束：所有资源内联（CSS / JS / 数据），以及**内联的 IR 里含有任意源码文本**。

---

## 1. 注入防护：HTML 转义 + JSON 内联转义

### 空腔一：源码文本进入 HTML

`module.source` 是**任意 JS 源码**，可以含 `<`、`&`、`"`。这些字符直接拼进 SVG/HTML 字符串会破坏结构（`<` 被当成标签开头），甚至注入脚本。

**做法**：`esc()`（viewer.js:9）与 `escapeHtml()`（render.js:5）转义四个字符

```
& → &amp;    < → &lt;    > → &gt;    " → &quot;
```

`&` 必须**第一个**替换——否则后续替换产生的 `&lt;` 会被再次转义成 `&amp;lt;`，页面上显示成字面量 `&lt;`。

### 空腔二：IR JSON 内联进 `<script>`

```html
<script type="application/json" id="oh-grasp-ir">{ …IR… }</script>
```

若 IR 里任何字符串含 `</script>`（源码注释里写一句「见 </script>」就够了），浏览器会在此处**提前闭合** script 标签，后面的 JSON 变成页面文本，整个产物崩掉。

**做法**（render.js:120）：`JSON.stringify(ir, null, 2).replace(/</g, '\\u003c')`

JSON 里 `<` 是合法的转义目标——`<` 与 `<` 在 JSON 语义上完全等价，`JSON.parse` 后得到同一个字符。但**文本上**不再存在 `<`，`</script>` 也就无法形成。

**为什么只转 `<` 不转全部**：`<` 是唯一能开启标签的字符，也是唯一有风险的那个。只转它，JSON 还能保持可读（人打开产物 `view-source` 看 IR 时不会被满屏 `\uXXXX` 淹没）。

**位置**：render.js:120 / viewer.js:9（转义函数本体在 render.js:5 `escapeHtml`）。

---

## 2. 自包含装配（模板拼接）

**问题**：把 CSS、viewer JS、IR JSON 三块拼成一个 HTML 文件。

**做法**：`render.js` 导出一个纯函数 `render(ir) → string`，模板字符串拼装

| 部分 | 来源 | 说明 |
|---|---|---|
| CSS | render.js 内的 `CSS` 常量 | 整块内联，无外链（含 header 里的语言切换器 `.vA-lang`） |
| 底部切换器 | 模板内联 | **待删**（ADR-0008 Q6：删 B 视图） |
| IR | `JSON.stringify` + `<` 转义 | 放进 `<script type="application/json">` |
| viewer | `VIEWER_SRC`（启动时 `readFileSync('viewer.js')`） | 整段内联 |

`render(ir)` 是纯函数（不写文件、不读 stdin），CLI 部分在 `if (require.main === module)` 里——测试可以直接调 `render(ir)` 断言输出字符串包含什么，不需要起进程、不产生临时文件（`oh-grasp/test/render.test.js`）。

**viewer 在启动时读一次**：`const VIEWER_SRC = fs.readFileSync(...)` 在模块顶层。viewer.js 改动后**必须重新渲染产物**才会生效——这是产物是「快照」而非「引用」的必然结果。

**位置**：render.js:118（`render`）、render.js:148（CLI）。

---

## 3. 双模式 viewer（纯内核 / DOM 应用）

**问题**：布局算法（断环、分层、重心法）需要单元测试，但它们在浏览器里跟 DOM 代码混在一个 IIFE 里。在 Node 里跑需要造一套 DOM 桩——慢、脆、和布局的正确性无关。

**做法**：viewer.js 按 `typeof document` 分成两段

```
上部：纯函数内核（无 DOM 依赖） → module.exports 导出，Node 下可 require
下部：if (typeof document !== 'undefined' && document.getElementById) { …DOM 应用… }
```

浏览器里整段执行（两个条件都真）；Node 里 `document` 未定义，下部整段跳过，上部导出可用。

**导出清单**：`fitWidth, wrap2, pick, pickList, T, tr, fmt, edgeLabel, uniqJoin, countPorts, aggregateEdges, components, flowGeometry, gridGeometry, nodeSvg, fwdPath, feedbackPath, fwdEdgeSvg, backEdgeSvg, unitName, portRows, portListHtml, pickPart, fourPartRows, fourPartHtml`——即所有纯算法函数与文案表，外加纯字符串的渲染内核（盒体、边、端口清单、四段清单）。**`nodeSvg` / `fwdPath` / `feedbackPath` / `fwdEdgeSvg` / `backEdgeSvg` 本来写在门内**（它们不碰 `document`，只是位置不对），端口口径、外移端点、边的可点结构都落在它们身上，搬出 document 门才断言得到（`render()` 只产 HTML 外壳，从不生成盒体）。端口清单同理：行数据（`portRows`）与行 HTML（`portListHtml`）都在内核，DOM 门里只剩「把这份 HTML 塞进弹窗 + 绑关闭事件」；四段说明（`pickPart` / `fourPartRows` / `fourPartHtml`）按同样的分家方式处理。

**一条边 = 一个可点单元**（ADR-0010）：整条边是**一个** `<g class="edge" data-from="…" data-to="…">`，组里依次是

| 子元素 | 作用 |
|---|---|
| `<path>` 可见路径 | 视觉权重不变（`stroke-width="1.5"`，反馈弧照旧橙色虚线） |
| `<path>` 命中路径 | `stroke="transparent" stroke-width="14" pointer-events="stroke"`——把「线」加宽成「带」，鼠标不必压在 1.5px 上 |
| `<rect class="edge-hit-label" fill="#ffffff">` + `<text>` | 中点标签的白底衬 + 描边文字（见 geometry.md §5） |
| `<title>` | 原生 hover 提示，内容是**未截断**的整句（画布上的字仍按 `fitWidth` 截断） |

**为什么身份挂在组上**：命中区、白底衬、文字、hover 提示是四个子元素，点击落在哪一个都该打开同一条边。DOM 门里的 `bindEdges` 因此只做一件事——把 `click` 绑在 `<g class="edge">` 上，用 `data-from|data-to` 回查真实 connection（`conns` 里存的是原始端点，见 graph.md 第 9 节）。`title` 也照此办：`nodeSvg` 的第一条子元素是 `<title>`，所以 hover 一个盒子看到的是**完整名字**（盒里那个是截断过的）。

**语言怎么进去**：语言**不是**内核状态，而是参数。`pick(field, lang)` 收口全部散文字段（`{zh, en}` 按语言取值，旧形态的普通字符串原样返回），`edgeLabel(e, lang)`、`nodeSvg(id, x, y, counts, lang, M, G)`、`flowSvg(ids, edges, counts, lang)`、`portListHtml(id, dir, edges, lang, M, G)`、`fourPartHtml(edge, lang, M)` 逐层把它传下去。`nodeSvg` / `portListHtml` / `fourPartHtml` 额外收模型索引 `M` / `G`（内核不持有模型，测试才好直接喂数据）。DOM 应用把当前语言放在 `state.lang`（不持久化），点 header 的 `#langZh` / `#langEn` 就换值并整页重渲染。`T = {zh, en}` 是查看器固定文案表（输入/输出/依赖/内部数据流/边界数据流/GROUP/INTERNAL/空方向「—」/连线/四段说明/四段字段名/弹窗分节标题/提示行），`tr(lang, key)` 取它，`fmt(tpl, n)` 填 `{n}` 占位——它在内核里，因此「两种语言的键一一对应」可单测。

**这条分界的价值**：`oh-grasp/test/layout.test.js` 的 49 个测试全部直接 `require('../viewer.js')`，零 DOM 依赖、毫秒级。DOM 那一层的正确性由另一套东西兜——`oh-grasp/fortest/smoke-viewer.js` 用最小 DOM 桩跑完整装载路径（见下）。

**分界的边界（诚实的缺口）**：可点边与四段的**数据与字符串**全在内核，所以「边单元长什么样、中点写什么、四段怎么分组」都断言得到；但「点下去真的弹出来」「Esc 真的关得掉」「hover 真的显 title」是**浏览器行为**，内核断言盖不到。这三条目前只有 scratch 冒烟脚本量过（见第 4 节），没有入库的自动缝。

**位置**：viewer.js:600（分界）、viewer.js:1051（导出）。

---

## 4. 冒烟脚手架（scratch，不入库）

**问题**：`layout.test.js` 盖不到 DOM 层——点击分组、打开端口清单、子图装载这些路径出错时，单测全绿但产物是坏的。

**做法**：`oh-grasp/fortest/smoke-viewer.js` 手写一个最小 DOM 桩（`FakeElement` / `FakeClassList`），用正则扫 `innerHTML` 里出现的标签与属性，构造出可 `querySelector`/`dispatch` 的元素树，然后跑完整 viewer IIFE。

**两个坑（都会让人以为测试写错了）**：

1. **桩里嵌套元素由 `_scan` 创建，`_html` 是空的**。断言必须读 `root.innerHTML`（整串），不能读某个子元素的 `innerHTML`——后者恒为 `''`。
2. **`FakeElement` 没有 `.click()`**。要发事件用 `.dispatch('click', {})`。

**不入库的原因**：它是脚手架的脚手架——为了让一套不严谨的 DOM 桩工作，桩本身需要不少妥协（例如 `clientWidth` 按 id 硬编码）。它的价值是开发时抓回归，不是长期资产；被它抓到的问题都已固化成 `layout.test.js` 里的纯内核断言或 render 层的字符串断言。

**位置**：`oh-grasp/fortest/smoke-viewer.js`。

### 交互行为的覆盖缺口（写在这里，免得下次又以为「有测试」）

可点边那次改动是照上面这条手艺验的：另写了一份临时脚本（在仓库外，**不入库**），用同一套 DOM 桩加了 `data-from` / `data-to` 的抓取，跑通「点边 → 四段弹窗（中/英）」「Esc 关闭」「子图里的边」「反馈弧」「真实产物 47 条无 description 的边条条点得开且不抛错」这五组。结论可信，但**它不是自动缝**——脚本删了就没了，`node --test` 也不会因为 Esc 或 hover 坏掉而变红。这两条（`Esc` 关闭、`<title>` 真机 hover）目前**没有入库的自动覆盖**。

---

## 5. 弹窗与关闭（DOM 层）

**问题**：三个弹窗（模块详情 / 组子图 / 边四段）共用同一个 `#detailOverlay`，而切换语言会**整页重渲染**——监听器若挂在被换掉的元素上，就会随元素一起消失或越挂越多。

**做法**：两根线各管一头

| 线 | 位置 | 干什么 |
|---|---|---|
| 内容 | DOM 门内 | `openEdge(e)` 把四段清单 HTML 塞进 `#detailOverlay` 并 `.classList.add('open')`；`bindEdges(container, edges, controller)` 只管给容器里每个 `<g class="edge">` 挂 `click` |
| 关闭 | 门内的槽位（但**不在** `renderA` 内） | `closeOverlay`（`var closeOverlay = null`）由每次 `renderA` 末尾刷成新的 `closeDetail`；`document` keydown 监听器在门的自启动 IIFE 里**只注册一次**（不像 `bindEdges` 那样每次 `renderA` 重挂），按 `Esc` 就调 `closeOverlay()` |

为什么绕这么一圈：`document` 上的 keydown 不能每次重渲染都加一个（切十次语言就有十个监听器），而 `closeDetail` 又必须是最新那棵树上的函数——一个可变槽位是两头都能满足的最小写法。点弹窗背景（`e.target === detail`）也走同一个 `closeDetail`。

**拖拽阈值同样适用**：`bindEdges` 先看 `controller.moved`（见 viewport.md 的 3px 阈值）——拖动画布时顺手扫过一条边，不该弹出四段。节点与端口上的 `click` 也照此办。

**位置**：viewer.js:612（`closeOverlay` 槽位）、viewer.js:846（`openEdge`）、viewer.js:861（`bindEdges`）、viewer.js:958（背景点击关闭）、viewer.js:973（`renderA` 里绑定边）、viewer.js:976（槽位刷新）、viewer.js:1038（`Esc`）。
