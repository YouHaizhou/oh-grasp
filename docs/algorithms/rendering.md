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

**做法**（render.js:131）：`JSON.stringify(ir, null, 2).replace(/</g, '\\u003c')`

JSON 里 `<` 是合法的转义目标——`<` 与 `<` 在 JSON 语义上完全等价，`JSON.parse` 后得到同一个字符。但**文本上**不再存在 `<`，`</script>` 也就无法形成。

**为什么只转 `<` 不转全部**：`<` 是唯一能开启标签的字符，也是唯一有风险的那个。只转它，JSON 还能保持可读（人打开产物 `view-source` 看 IR 时不会被满屏 `\uXXXX` 淹没）。

**位置**：render.js:131 / viewer.js:9（转义函数本体在 render.js:5 `escapeHtml`）。

---

## 2. 自包含装配（模板拼接）

**问题**：把 CSS、viewer JS、IR JSON 三块拼成一个 HTML 文件。

**做法**：`render.js` 导出一个纯函数 `render(ir) → string`，模板字符串拼装

| 部分 | 来源 | 说明 |
|---|---|---|
| CSS | render.js 内的 `CSS` 常量 | 整块内联，无外链（含 header 里的语言切换器 `.vA-lang`） |
| IR | `JSON.stringify` + `<` 转义 | 放进 `<script type="application/json">` |
| viewer | `VIEWER_SRC`（启动时 `readFileSync('viewer.js')`） | 整段内联 |

`render(ir)` 是纯函数（不写文件、不读 stdin），CLI 部分在 `if (require.main === module)` 里——测试可以直接调 `render(ir)` 断言输出字符串包含什么，不需要起进程、不产生临时文件（`oh-grasp/test/render.test.js`）。

**viewer 在启动时读一次**：`const VIEWER_SRC = fs.readFileSync(...)` 在模块顶层。viewer.js 改动后**必须重新渲染产物**才会生效——这是产物是「快照」而非「引用」的必然结果。

**位置**：render.js:129（`render`）、render.js:159（CLI）。

---

## 3. 双模式 viewer（纯内核 / DOM 应用）

**问题**：布局算法（断环、分层、重心法）需要单元测试，但它们在浏览器里跟 DOM 代码混在一个 IIFE 里。在 Node 里跑需要造一套 DOM 桩——慢、脆、和布局的正确性无关。

**做法**：viewer.js 按 `typeof document` 分成两段

```
上部：纯函数内核（无 DOM 依赖） → module.exports 导出，Node 下可 require
下部：if (typeof document !== 'undefined' && document.getElementById) { …DOM 应用… }
```

浏览器里整段执行（两个条件都真）；Node 里 `document` 未定义，下部整段跳过，上部导出可用。

**导出清单**：`fitWidth, wrap2, pick, pickList, T, tr, fmt, edgeLabel, uniqJoin, countPorts, aggregateEdges, components, flowGeometry, gridGeometry, nodeSvg, fwdPath, feedbackPath, fwdEdgeSvg, backEdgeSvg, unitName, portRows, portListHtml, consRows, consListHtml, consIndex, extUseRows, extUseHtml, depsHtml, pickPart, fourPartRows, fourPartHtml`——即所有纯算法函数与文案表，外加纯字符串的渲染内核（盒体、边、端口清单、消费者清单、成员直连外部、叶子依赖行、四段清单）。**`nodeSvg` / `fwdPath` / `feedbackPath` / `fwdEdgeSvg` / `backEdgeSvg` 本来写在门内**（它们不碰 `document`，只是位置不对），端口口径、外移端点、边的可点结构都落在它们身上，搬出 document 门才断言得到（`render()` 只产 HTML 外壳，从不生成盒体）。端口清单同理：行数据（`portRows`，viewer.js:449）与行 HTML（`portListHtml`，viewer.js:477）都在内核，DOM 门里只剩「把这份 HTML 塞进弹窗 + 绑关闭事件」；四段说明（`pickPart` / `fourPartRows` / `fourPartHtml`）与消费者清单（`consRows` viewer.js:508 / `consListHtml` viewer.js:534，见下）按同样的分家方式处理。**内部助手照旧不出导**：`rowHtml`（三个清单共用的行语法）、`modById`、`modName` 是**上部内核里的**内部助手（定义在 document 门**上方**），只是**不进导出清单**——它们分别被已导出的 `portListHtml` / `consListHtml` / `extUseHtml` 调用，测试从产出它们的清单函数上断。

**消费者清单与反向索引的消费者从哪来**（票 06 换源）：`consRows(id, modules)` 产出「谁用了这个 external」的行数据——条件是 internal 模块的 **`uses` 字段里有这个 external id**（ADR-0011 决策一），保 IR 顺序，返回 `[{ id, label }]`。它同时喂两个面：点卡片弹出的清单（`consListHtml`，行是 `消费者 → 该 external 的 input → external`）与侧栏卡片上的**反向索引**（`consIndex`，只有一串消费者名）。

**代理时代的那句话已经过时，留在这里当历史**：票 05 落地的第一版拿「具名导入符号在 `source` 里作为独立标识符出现」当信号（`extSymbols` / `hasSymbol`），那是 `uses` 到位前的代理估算，与 round19 那次估算（`.scratch/count-ext-uses.js`）同一把尺子——它对 default 导入**完全失明**：`node:fs` / `node:os` / `node:path` / `recipes/scenarios.mjs` 都是 `input: ["default"]`，没有符号名可匹配，恒 0 行。票 06 把 `uses` 填进 IR 之后，代理连同它的两个函数一起删除，那个盲区随之消失（`oh-grasp/test/layout.test.js` 的「a default-only external lists its consumers」用 fixture 里的 `node:path` 钉住这一条）。空清单也只剩一种含义：**没有模块在 `uses` 里声明用到它**——空态文案是 `consumersNone`（明说依据），不再有第二句 `consumersBlind`。

**折叠上限按面宽分两档，共用的仍是同一套 `+M` 记法**：`uniqJoin(items, cap)` 的 `cap` 是**截断预算**（列几项），`+M` 的 M = 总数 − 已列数；3 项以内一律全列，与 `cap` 无关——最窄的面也放得下 3 项。全仓只有**五**个调用点，缺省 2 的**四**处都是窄面，唯一传 3 的是侧栏卡片（宽面）：

| 面 | 调用点 | cap |
|---|---|---|
| 画布上边的中点标签 | `edgeLabel` | 缺省 2 |
| 端口清单的对端格 | `portListHtml` | 缺省 2 |
| group 弹窗第二段的成员名 | `extUseHtml` | 缺省 2 |
| 叶子弹窗依赖行的**两半**（依赖 / 宿主） | `depsHtml` 的 `uniqJoin(names)` 与 `uniqJoin(rt)` | 缺省 2 |
| 侧栏依赖卡片的**反向索引** | `consIndex` | **3**（前 3 个 + `+M`，ADR-0011 决策三） |

为什么这四处都走缺省 2：画布与弹窗里的这几格都是**一行文字**，格子窄；侧栏卡片独占一栏，放得下第 3 个名字。

**三个清单的行长一个样，因为它们就是同一个函数**：端口清单、消费者清单、以及 group 弹窗第二段「成员直连外部」的行 markup 都由 `rowHtml(src, lab, dst)`（viewer.js:470）产出，三个参数都收**已转义**的字符串。ADR-0011 的「学一次行语法，用在两处」不是一个说法，是这一个函数（票 06 起是**三**处）；票 05 第二片把「清单行可点」做出来时，改一处就够。

**一条边 = 一个可点单元**（ADR-0010）：整条边是**一个** `<g class="edge" data-from="…" data-to="…">`，组里依次是

| 子元素 | 作用 |
|---|---|
| `<path>` 可见路径 | 视觉权重不变（`stroke-width="1.5"`，反馈弧照旧橙色虚线） |
| `<path>` 命中路径 | `stroke="transparent" stroke-width="14" pointer-events="stroke"`——把「线」加宽成「带」，鼠标不必压在 1.5px 上 |
| `<rect class="edge-hit-label" fill="#ffffff">` + `<text>` | 中点标签的白底衬 + 描边文字（见 geometry.md §5） |
| `<title>` | 原生 hover 提示，内容是**未截断**的整句（画布上的字仍按 `fitWidth` 截断） |

**为什么身份挂在组上**：命中区、白底衬、文字、hover 提示是四个子元素，点击落在哪一个都该打开同一条边。DOM 门里的 `bindEdges` 因此只做一件事——把 `click` 绑在 `<g class="edge">` 上，用 `data-from|data-to` 回查真实 connection（`conns` 里存的是原始端点，见 graph.md 第 9 节）。`title` 也照此办：`nodeSvg` 的第一条子元素是 `<title>`，所以 hover 一个盒子看到的是**完整名字**（盒里那个是截断过的）。

**语言怎么进去**：语言**不是**内核状态，而是参数。`pick(field, lang)` 收口全部散文字段（`{zh, en}` 按语言取值，旧形态的普通字符串原样返回），`edgeLabel(e, lang)`、`nodeSvg(id, x, y, counts, lang, M, G)`、`flowSvg(ids, edges, counts, lang)`、`portListHtml(id, dir, edges, lang, M, G)`、`fourPartHtml(edge, lang, M)` 逐层把它传下去。`nodeSvg` / `portListHtml` / `fourPartHtml` 额外收模型索引 `M` / `G`（内核不持有模型，测试才好直接喂数据）。DOM 应用把当前语言放在 `state.lang`（不持久化），点 header 的 `#langZh` / `#langEn` 就换值并整页重渲染。`T = {zh, en}` 是查看器固定文案表（输入/输出/依赖/内部数据流/组间边/成员直连外部/宿主/叶子依赖行的两个标头 `dep` 与 `host`/GROUP/INTERNAL/EXTERNAL/空方向「—」/连线/四段说明/四段字段名/消费者/消费者空清单一句/提示行），`tr(lang, key)` 取它，`fmt(tpl, n)` 填 `{n}` 占位——它在内核里，因此「两种语言的键一一对应」可单测。**分节标题与行内标头是两个键**：`deps` 的值是双语的「依赖 Dependencies」（侧栏分节标题的写法），行内那一行用 `dep`（「依赖」/「Dependency」），否则会读出「依赖 Dependencies fs · …」。

**这条分界的价值**：`oh-grasp/test/layout.test.js` 的 60 个测试全部直接 `require('../viewer.js')`，零 DOM 依赖、毫秒级。DOM 那一层的正确性由另一套东西兜——`oh-grasp/fortest/smoke-viewer.js` 用最小 DOM 桩跑完整装载路径（见下）。

**分界的边界（诚实的缺口）**：可点边、四段、消费者清单、成员直连外部、叶子依赖行的**数据与字符串**全在内核，所以「边单元长什么样、中点写什么、四段怎么分组、消费者清单有几行、反向索引折了几个」都断言得到；但「点下去真的弹出来」「Esc 真的关得掉」「hover 真的显 title」是**浏览器行为**，内核断言盖不到。这三条目前只有 scratch 冒烟脚本量过（见第 4 节），没有入库的自动缝。

**位置**：viewer.js:730（分界）、viewer.js:1238（导出）。

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

票 05 第一片（四入口收成一个弹窗 + 消费者清单）用同一套手艺另写了一份临时脚本（同样在仓库外、不入库）复量：四个入口各点开一次、`×` / 遮罩空白 / `Esc` 三条关闭路径、子图与成员网格两支行内的点击、真实产物 14 张依赖卡片的消费者行数（并逐张、逐节点、逐端口、逐边点开确认不抛错）。这些同属**浏览器行为**，没有入库的自动缝；入库的只有内核那侧（消费者行数据与行 HTML、文案表成对）。

票 06（`uses` / `runtime` + 反向索引）再复量一次：同一套临时脚本加了五组断言——侧栏卡片的反向索引（4 个消费者折成「前 3 + `+1`」、default 导入照列、「没有消费者」显式「—」）、点卡片的消费者清单（default 导入的 external 也有行）、group 弹窗两段（`组间边` + `成员直连外部`，成员名与包名都对得上）、成员没有 `uses` 时第二段画「—」、叶子弹窗的依赖行（两半各自为空时各画一个「—」）；并对**真实产物**再跑一遍装载与逐分组打开。同属浏览器行为，同样没有入库的自动缝。

---

## 5. 一个弹窗：四入口、一个容器、一条关闭路径（DOM 层）

**问题**：原先四个入口（模块详情 / 组子图 / 组卡片网格 / 端口清单 / 边四段——五个内容形状）各自拼一遍弹窗外壳：标题、kind 标签、`×` 按钮这三段 HTML 抄了五份，`#detailClose` 的 `click` 绑定也抄了五遍；而 ADR-0010 要的第四个入口（点依赖卡片 → 消费者清单）根本没有——仓库里没有消费者清单这个产出，依赖卡片连点击都没绑。另外，弹窗共用同一个 `#detailOverlay`，切换语言会**整页重渲染**——监听器若挂在被换掉的元素上，就会随元素一起消失或越挂越多。

**做法**：内容与关闭两根线各管一头，入口退成「产出描述 + 一行打开」

| 线 | 位置 | 干什么 |
|---|---|---|
| 入口描述（内容形状） | DOM 门内，`renderA` 里的 `detailSpec` / `groupSpec` / `portSpec` / `edgeSpec` / `consSpec`（viewer.js:1033 起） | 各产出 `{ name, kind, html, cls, mount }`：标题与 kind 是**未转义原文**，`html` 是内容，`cls` 是三档宽度（`''` / `vA-modal-wide` / `vA-modal-sm`），`mount` 是「塞进去之后才做得了的事」（子图的缩放控制器、节点选中态、网格卡片与子图节点的点击） |
| 容器与关闭 | DOM 门内 `openModal(spec)`（viewer.js:1019） | 拼唯一一份外壳（标题 / kind 标签 / `×`）、`.classList.add('open')`、**唯一一处** `#detailClose` 绑定，然后调 `spec.mount()`。四个入口因此都是**一行**：`openDetail` / `openGroup` / `openPort` / `openEdge` / `openConsumers`（viewer.js:1142–1146） |
| 关闭槽位 | 门内的槽位（但**不在** `renderA` 内） | `closeOverlay`（viewer.js:742）由每次 `renderA` 末尾刷成新的 `closeDetail`（viewer.js:1002）；`document` keydown 监听器在门的自启动 IIFE 里**只注册一次**（不像 `bindEdges` 那样每次 `renderA` 重挂），按 `Esc` 就调 `closeOverlay()`（viewer.js:1229） |

为什么绕这么一圈：`document` 上的 keydown 不能每次重渲染都加一个（切十次语言就有十个监听器），而 `closeDetail` 又必须是最新那棵树上的函数——一个可变槽位是两头都能满足的最小写法。三条关闭路径都落在同一个 `closeDetail` 上：`×`（openModal 里那一处绑定）、点遮罩空白（viewer.js:1192，`e.target === detail`）、`Esc`（槽位）。

**第四个入口的绑定**：`root.querySelectorAll('.vA-extcard')` → `openConsumers(id)`（viewer.js:1209）。卡片是 `<button type="button">`（可聚焦，与 `.vA-mcard` 同一个理由），`data-id` 带的是 external 模块 id；它不在画布里，所以没有拖拽阈值这回事。

**票 06 给「内容形状」加的三处**（ADR-0011 决策三，DOM 门里各只加一行，字符串全在内核）：

| 位置 | 加什么 | 内核函数 |
|---|---|---|
| group 弹窗 | 第一段是原来的组间边（`boundaryBlock`），第二段「成员直连外部」= 成员自己的 `uses` 按 external 归并；两段由一个 `groupSections` 一次给全，成员网格与子图两支都走它。成员一条 `uses` 都没有时第二段画「—」 | `extUseRows` / `extUseHtml` |
| 叶子弹窗 | 一行依赖：`依赖 <包名 · …> · 宿主 <属性路径 · …>`，两半各自为空时各画一个「—」（ADR-0006 的空端口惯例）。**只给 internal 模块画**：`uses` / `runtime` 是 internal 的字段，给 external 画一行「依赖 — · 宿主 —」等于把「它没有这两个字段」说成「它什么都没有」 | `depsHtml` |
| 侧栏依赖卡片 | 第二个方向的一行：`↳` 是「它提供哪些具名成员」，`←` 是「谁在用它」（反向索引，前 3 + `+M`）。没有消费者时画「—」而不是省掉这一行——省掉的那行读不出「没人用它」还是「没做这个功能」 | `consIndex` |

**为什么第二段不塞进组间边**：成员吃外部依赖这件事在 `connections` 里**本来就没有**（外部依赖不进数据流边，ADR-0011 决策一），所以两个事实源分开列、谁也不冒充谁；group 的 I/O 仍只由组间边推导（ADR-0006 不破）。

**拖拽阈值同样适用**：`bindEdges`（viewer.js:1151）先看 `controller.moved`（见 viewport.md 的 3px 阈值）——拖动画布时顺手扫过一条边，不该弹出四段。节点与端口上的 `click` 也照此办。

**本片刻意不做**（票 05 第二片）：清单行可点、一层返回栈、关闭语义随栈变化。所以现在的弹窗**没有**返回槽位，`openModal` 每次都是「替换当前内容」——点清单里的一行还是「没有下一层」这回事。
