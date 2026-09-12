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

**做法**（render.js:114）：`JSON.stringify(ir, null, 2).replace(/</g, '\\u003c')`

JSON 里 `<` 是合法的转义目标——`<` 与 `<` 在 JSON 语义上完全等价，`JSON.parse` 后得到同一个字符。但**文本上**不再存在 `<`，`</script>` 也就无法形成。

**为什么只转 `<` 不转全部**：`<` 是唯一能开启标签的字符，也是唯一有风险的那个。只转它，JSON 还能保持可读（人打开产物 `view-source` 看 IR 时不会被满屏 `\uXXXX` 淹没）。

**位置**：render.js:114 / viewer.js:9。

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

**位置**：render.js:112（`render`）、render.js:143（CLI）。

---

## 3. 双模式 viewer（纯内核 / DOM 应用）

**问题**：布局算法（断环、分层、重心法）需要单元测试，但它们在浏览器里跟 DOM 代码混在一个 IIFE 里。在 Node 里跑需要造一套 DOM 桩——慢、脆、和布局的正确性无关。

**做法**：viewer.js 按 `typeof document` 分成两段

```
上部：纯函数内核（无 DOM 依赖） → module.exports 导出，Node 下可 require
下部：if (typeof document !== 'undefined' && document.getElementById) { …DOM 应用… }
```

浏览器里整段执行（两个条件都真）；Node 里 `document` 未定义，下部整段跳过，上部导出可用。

**导出清单**：`fitWidth, wrap2, pick, pickList, T, tr, fmt, edgeLabel, uniqJoin, countPorts, aggregateEdges, components, flowGeometry, gridGeometry, nodeSvg, fwdPath, feedbackPath, unitName, portRows, portListHtml`——即所有纯算法函数与文案表，外加纯字符串的渲染内核（盒体、边路径、端口清单）。**`nodeSvg` / `fwdPath` / `feedbackPath` 本来写在门内**（它们不碰 `document`，只是位置不对），端口口径与外移端点都落在它们身上，搬出 document 门才断言得到（`render()` 只产 HTML 外壳，从不生成盒体）。端口清单同理：行数据（`portRows`）与行 HTML（`portListHtml`）都在内核，DOM 门里只剩「把这份 HTML 塞进弹窗 + 绑关闭事件」。

**语言怎么进去**：语言**不是**内核状态，而是参数。`pick(field, lang)` 收口全部散文字段（`{zh, en}` 按语言取值，旧形态的普通字符串原样返回），`edgeLabel(e, lang)`、`nodeSvg(id, x, y, counts, lang, M, G)`、`flowSvg(ids, edges, counts, lang)`、`portListHtml(id, dir, edges, lang, M, G)` 逐层把它传下去。`nodeSvg` / `portListHtml` 额外收模型索引 `M` / `G`（内核不持有模型，测试才好直接喂数据）。DOM 应用把当前语言放在 `state.lang`（不持久化），点 header 的 `#langZh` / `#langEn` 就换值并整页重渲染。`T = {zh, en}` 是查看器固定文案表（输入/输出/依赖/内部数据流/边界数据流/GROUP/INTERNAL/空方向「—」/弹窗分节标题/提示行），`tr(lang, key)` 取它，`fmt(tpl, n)` 填 `{n}` 占位——它在内核里，因此「两种语言的键一一对应」可单测。

**这条分界的价值**：`oh-grasp/test/layout.test.js` 的 39 个测试全部直接 `require('../viewer.js')`，零 DOM 依赖、毫秒级。DOM 那一层的正确性由另一套东西兜——`oh-grasp/fortest/smoke-viewer.js` 用最小 DOM 桩跑完整装载路径（见下）。

**位置**：viewer.js:483（分界）、viewer.js:897（导出）。

---

## 4. 冒烟脚手架（scratch，不入库）

**问题**：`layout.test.js` 盖不到 DOM 层——点击分组、打开端口清单、子图装载这些路径出错时，单测全绿但产物是坏的。

**做法**：`oh-grasp/fortest/smoke-viewer.js` 手写一个最小 DOM 桩（`FakeElement` / `FakeClassList`），用正则扫 `innerHTML` 里出现的标签与属性，构造出可 `querySelector`/`dispatch` 的元素树，然后跑完整 viewer IIFE。

**两个坑（都会让人以为测试写错了）**：

1. **桩里嵌套元素由 `_scan` 创建，`_html` 是空的**。断言必须读 `root.innerHTML`（整串），不能读某个子元素的 `innerHTML`——后者恒为 `''`。
2. **`FakeElement` 没有 `.click()`**。要发事件用 `.dispatch('click', {})`。

**不入库的原因**：它是脚手架的脚手架——为了让一套不严谨的 DOM 桩工作，桩本身需要不少妥协（例如 `clientWidth` 按 id 硬编码）。它的价值是开发时抓回归，不是长期资产；被它抓到的问题都已固化成 `layout.test.js` 里的纯内核断言或 render 层的字符串断言。

**位置**：`oh-grasp/fortest/smoke-viewer.js`。
