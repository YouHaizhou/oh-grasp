// oh-grasp 客户端 viewer。由 render.js 内联进自包含 HTML，读取嵌入的 JSON IR。
// 布局决策见 docs/adr/0007-layout-system.md（端口为中心的节点盒 + 断环分层宏布局）。
(function () {
  'use strict';

  // 文件布局：上部为纯布局内核（无 DOM 依赖；在 Node 下 require 可作单测 seam），
  // 下部 `typeof document !== 'undefined'` 分支为浏览器端 DOM 应用。
  /* ---------- 文本与尺寸 ---------- */
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  // 估算一个字符的横向占用：CJK 等宽字符按全宽，拉丁按 ~0.58em。
  function chW(ch, fs) { var u = ch.charCodeAt(0); return u > 0x2e7f ? fs : fs * 0.58; }
  // 单行裁剪：超宽时截断并预留省略号宽度。
  function fitWidth(s, fs, maxW) {
    s = String(s); if (!s) return '';
    if (maxW <= 0) return '…';
    var stop = maxW - chW('…', fs);
    var w = 0, i = 0;
    for (; i < s.length; i++) { var a = chW(s[i], fs); if (w + a > stop) break; w += a; }
    if (i >= s.length) return s;
    if (i === 0) i = 1; // 极端窄盒：至少留 1 个字符
    i = cutGuard(s, i);
    return s.slice(0, i) + '…';
  }
  // 截断时别把代理对（emoji / 增补区汉字）从中间切开：若切口恰好落在低半代理上，
  // 说明前一个码元是它配对的 high surrogate —— 多保留一个码元，避免产生孤立代理（渲染成 U+FFFD）。
  function cutGuard(s, i) {
    if (i > 0 && i < s.length) {
      var hi = s.charCodeAt(i - 1), lo = s.charCodeAt(i);
      if (hi >= 0xD800 && hi <= 0xDBFF && lo >= 0xDC00 && lo <= 0xDFFF) i += 1;
    }
    return i;
  }
  // 从 str 起点起能放进一行(maxW)的字符数。
  function lineCap(str, fs, maxW) {
    var w = 0, i = 0;
    for (; i < str.length; i++) { var a = chW(str[i], fs); if (w + a > maxW) break; w += a; }
    return cutGuard(str, i);
  }
  // 把文本折成至多 2 行（第 2 行仍超宽则截断加 …），用于节点盒内的 description。
  function wrap2(s, fs, maxW) {
    s = String(s); if (!s) return ['', ''];
    if (maxW <= 0) return [s.charAt(0), s.length > 1 ? s.charAt(1) : ''];
    var n1 = lineCap(s, fs, maxW);
    var out = [];
    if (n1 >= s.length) { out.push(s); }
    else {
      out.push(s.slice(0, n1));
      var rest = s.slice(n1);
      var n2 = lineCap(rest, fs, maxW);
      if (n2 >= rest.length) out.push(rest);
      else {
        var budget = maxW - chW('…', fs), w = 0, k = 0;
        for (; k < rest.length; k++) { var a = chW(rest[k], fs); if (w + a > budget) break; w += a; }
        k = cutGuard(rest, k);
        out.push((k > 0 ? rest.slice(0, k) : rest.slice(0, 1)) + '…');
      }
    }
    while (out.length < 2) out.push('');
    return out;
  }

  /* ---------- 双语取值：收敛全部「散文」字段的读取 ----------
     语言在外：可译字段是 {zh, en}；旧形态的普通字符串原样返回 —— expand 步下
     单语产物照常渲染。语言一律由调用方传进来（参数），内核不持有语言状态。 */
  var LANGS = ['zh', 'en'];
  var DEFAULT_LANG = 'zh';
  function normLang(lang) { return LANGS.indexOf(lang) !== -1 ? lang : DEFAULT_LANG; }
  // 语言子树里「有内容」的判据与 validate 一致：空白不算内容。
  function hasText(x) { return typeof x === 'string' && x.trim() !== ''; }
  // field: string（旧形态，原样返回）| {zh, en}（按语言取值）。
  function pick(field, lang) {
    if (typeof field === 'string') return field;
    if (!field || typeof field !== 'object') return '';
    var l = normLang(lang);
    if (hasText(field[l])) return field[l];
    if (hasText(field[DEFAULT_LANG])) return field[DEFAULT_LANG];   // 缺当前语言时回退默认语言
    return hasText(field.en) ? field.en : '';
  }
  // 列表形态的可译字段（meta.input / meta.output）：逐项 pick。
  function pickList(arr, lang) {
    if (!Array.isArray(arr)) return [];
    return arr.map(function (x) { return pick(x, lang); }).filter(function (s) { return s !== ''; });
  }

  /* ---------- 查看器固定 UI 文案（不属于 IR，跟着语言切换） ---------- */
  var T = {
    zh: {
      input: '输入', output: '输出',
      deps: '依赖 Dependencies',
      hint: '点击模块/分组查看详情 · 滚轮缩放（光标为锚点）· 拖拽平移 · 双击复位 · 虚线 ↺ 为反向/反馈连接',
      source: '源码 Source', line: '第 {n} 行',
      groupMeta: 'group · {n} 模块',
      innerFlow: '内部数据流', boundary: '边界数据流', members: '成员模块',
      none: '无', dash: '—', feedback: '反馈',
      groupTag: 'GROUP', internalTag: 'INTERNAL',
      edge: '连线', fourParts: '四段说明',
      fp_source: '来源', fp_process: '处理', fp_output: '输出', fp_purpose: '用途',
    },
    en: {
      input: 'Input', output: 'Output',
      deps: 'Dependencies',
      hint: 'Click a module / group for details · scroll to zoom (cursor-anchored) · drag to pan · double-click to reset · dashed ↺ = feedback connection',
      source: 'Source', line: 'line {n}',
      groupMeta: 'group · {n} modules',
      innerFlow: 'Internal data flow', boundary: 'Boundary data flow', members: 'Member modules',
      none: 'None', dash: '—', feedback: 'feedback',
      groupTag: 'GROUP', internalTag: 'INTERNAL',
      edge: 'Connection', fourParts: 'Four-part description',
      fp_source: 'Source', fp_process: 'Process', fp_output: 'Output', fp_purpose: 'Purpose',
    }
  };
  // 取当前语言的 UI 文案；语言非法时按 zh。
  function tr(lang, key) {
    var tbl = T[normLang(lang)];
    return tbl[key] !== undefined ? tbl[key] : T[DEFAULT_LANG][key];
  }
  // 文案里的 {n} 占位替换（如「第 {n} 行」）。
  function fmt(tpl, n) { return String(tpl).replace('{n}', n); }

  /* ---------- 几何常量（节点盒） ---------- */
  var CW = 236, CH = 78;                     // leaf 宽 / 高（内容恒定：名字 + ≤2 行描述）
  var GW = 282, GH = 96;                     // group 宽 / 高（上下端口占位，比 leaf 高）

  var HGAP = 44, VGAP = 62;                  // 行内横距 / 行间纵距
  var PAD_LR = 44, PAD_TOP = 18, REGION_GAP = 40;
  var GRID_CAP = 940;                        // 无连接「独立带」每行封顶宽
  var PORT_GAP = 8;                          // 入边终点离目标盒上边缘的间距（ADR-0009：外移 ~8px）
  var REP_W = 130;                           // 端口代表内容的可用宽（盒内、fitWidth 截断）

  /* ---------- 端口计数（折叠 group 的 ×N） ----------
     ×N 数的是该方向上**不同内容的种数**，不是连接条数（ADR-0009）——12 条连接里可能
     只有 4 种内容，标 12 会让「点开数得清」落空。去重键是 label 的 **zh 文本**：
     按 zh 而不是按当前显示语言，切换语言时 N 才不变（同一个内容在两处写出的 label
     字符串可能不同，zh 是判定「是不是一回事」的锚点）。
     返回 { id: { in, out, inRep, outRep } }：in/out 是两个方向的内容种数，
     inRep/outRep 是各方向 IR 顺序第一条 connection 的 label 字段（原样存，渲染时按
     语言 pick）——代表内容由 nodeSvg 画在 ×N 右侧。
     没有 label 的 connection 贡献不了「内容」，跳过（schema 里 label 必填，正常产物没有）。 */
  // 一个端口的零值：某方向没有内容时用它（N=0 → 「—」）。挪成一处，免得两处字面量各自漂移。
  function emptyPort() { return { in: 0, out: 0, inRep: null, outRep: null }; }

  function countPorts(edges) {
    // c 与 seen 都按**单元 id / label 文本**当键，两者都不受模式约束（schema 只要求 id 非空且唯一），
    // 而 "constructor" / "__proto__" 这类键会让普通 {} 直接命中内置属性——`c['constructor'].out`
    // 是 NaN，写 `__proto__` 更会污染 Object.prototype。所以两张表都用无原型对象。
    var c = Object.create(null), seen = Object.create(null);
    function tally(id, dir, cn) {
      var txt = pick(cn ? cn.label : '', 'zh');
      if (!txt || !id) return;
      var sz = seen[id] || (seen[id] = { in: Object.create(null), out: Object.create(null) });
      if (sz[dir][txt]) return;
      sz[dir][txt] = true;
      if (!c[id]) c[id] = emptyPort();
      c[id][dir]++;
      // 该方向第一条（遍历顺序 = IR 顺序，aggregateEdges 保序）当代表，之后不再覆盖。
      var rk = dir === 'in' ? 'inRep' : 'outRep';
      if (c[id][rk] === null) c[id][rk] = cn.label;
    }
    (edges || []).forEach(function (e) {
      (e.conns || []).forEach(function (cn) {
        tally(e.from, 'out', cn);
        tally(e.to, 'in', cn);
      });
    });
    return c;
  }

  /* ---------- 去重 + 首现顺序 + `a · b +2` 收尾 ----------
     同一套表示同时给边中点标签（edgeLabel）与端口清单的对端（portListHtml）用：
     读者学一次规则能用两处（ADR-0011）。 */
  function uniqJoin(items) {
    var out = [];
    (items || []).forEach(function (t) {
      if (t && out.indexOf(t) === -1) out.push(t);
    });
    if (!out.length) return '';
    if (out.length <= 3) return out.join(' · ');
    return out.slice(0, 2).join(' · ') + ' +' + (out.length - 2);
  }

  /* ---------- 边 label 聚合（label 是可译散文，按语言取值后去重） ---------- */
  function edgeLabel(e, lang) {
    return uniqJoin((e && e.conns || []).map(function (cn) { return cn ? pick(cn.label, lang) : ''; }));
  }

  /* ---------- 边聚合：同向多 connection 并成一条 {from,to,conns} ----------
     collapse(c) 可把端点折叠成上层单元（如 member → 所在 group），返回 {from,to}；
     conns 里始终保留原始 connection（from/to 是真实模块 id），供端口清单展示。 */
  function aggregateEdges(conns, collapse) {
    var byKey = {}, order = [];
    (conns || []).forEach(function (c) {
      if (!c || c.from === undefined || c.to === undefined) return;
      var s = collapse ? collapse(c) : { from: c.from, to: c.to };
      var k = s.from + '|' + s.to;
      if (!byKey[k]) { byKey[k] = { from: s.from, to: s.to, conns: [] }; order.push(byKey[k]); }
      byKey[k].conns.push(c);
    });
    return order;
  }

  /* ---------- 弱连通分量 ---------- */
  function components(ids, edges) {
    var adj = {};
    ids.forEach(function (id) { adj[id] = []; });
    edges.forEach(function (e) {
      if (adj[e.from]) adj[e.from].push(e.to);
      if (adj[e.to]) adj[e.to].push(e.from);
    });
    var visited = {}, comps = [];
    ids.forEach(function (id) {
      if (visited[id]) return;
      visited[id] = true;
      var stack = [id], nodes = [], here = {};
      while (stack.length) {
        var u = stack.pop();
        nodes.push(u); here[u] = true;
        (adj[u] || []).forEach(function (v) {
          if (!visited[v]) { visited[v] = true; stack.push(v); }
        });
      }
      var compEdges = edges.filter(function (e) { return here[e.from] && here[e.to]; });
      comps.push({ nodes: nodes, edges: compEdges });
    });
    return comps;
  }

  /* ---------- 分层布局：断环成 DAG + 层内 barycenter 排序 ----------
     入参 edges 已按「源|目标」聚合（无同向重复）。返回几何。 */
  function flowGeometry(nodes, edges, sizes) {
    // DFS 找后向边（指向灰色祖先的边），断掉它们得到 DAG。
    var adj = {};
    nodes.forEach(function (id) { adj[id] = []; });
    edges.forEach(function (e) { if (adj[e.from]) adj[e.from].push(e); });
    var color = {}, backKey = {}, back = [];
    function dfs(u) {
      color[u] = 1;
      (adj[u] || []).forEach(function (e) {
        var w = e.to;
        if (color[w] === undefined) dfs(w);
        else if (color[w] === 1 && !backKey[u + '|' + w]) { backKey[u + '|' + w] = true; back.push(e); }
      });
      color[u] = 2;
    }
    nodes.forEach(function (u) { if (color[u] === undefined) dfs(u); });
    var backSet = {};
    back.forEach(function (e) { backSet[e.from + '|' + e.to] = true; });
    var fwd = edges.filter(function (e) { return !backSet[e.from + '|' + e.to]; });

    // 对 DAG 做最长路分层（Kahn）。
    var indeg = {}, out = {};
    nodes.forEach(function (id) { indeg[id] = 0; out[id] = []; });
    fwd.forEach(function (e) { out[e.from].push(e.to); indeg[e.to]++; });
    var layer = {};
    nodes.forEach(function (id) { layer[id] = 0; });
    var indeg2 = {};
    nodes.forEach(function (id) { indeg2[id] = indeg[id]; });
    var queue = nodes.filter(function (id) { return indeg[id] === 0; });
    var fin = [];
    while (queue.length) {
      var u = queue.shift(); fin.push(u);
      out[u].forEach(function (v) {
        layer[v] = Math.max(layer[v], layer[u] + 1);
        indeg2[v]--;
        if (indeg2[v] === 0) queue.push(v);
      });
    }
    // 兜底（理论不该触发）
    nodes.forEach(function (id) {
      if (fin.indexOf(id) !== -1) return;
      var mx = 0;
      nodes.forEach(function (n) { if (fin.indexOf(n) !== -1 && layer[n] > mx) mx = layer[n]; });
      layer[id] = mx + 1; fin.push(id);
    });

    // 层内排序：先按拓扑序（fin）稳定分组，再 barycenter 扫描压交叉。
    var layers = [];
    fin.forEach(function (id) { var L = layer[id]; (layers[L] = layers[L] || []).push(id); });

    function stableSort(arr, weight) {
      return arr.map(function (x, i) { return { x: x, w: weight(x), i: i }; })
        .sort(function (a, b) { return a.w - b.w || a.i - b.i; })
        .map(function (o) { return o.x; });
    }
    function predsOf(id) { return fwd.filter(function (e) { return e.to === id; }).map(function (e) { return e.from; }); }
    function succsOf(id) { return fwd.filter(function (e) { return e.from === id; }).map(function (e) { return e.to; }); }
    var passes = Math.min(5, Math.max(3, layers.length));
    for (var p = 0; p < passes; p++) {
      // 下行：按上一层前驱的平均位次排本层
      for (var l = 1; l < layers.length; l++) {
        (function (L) {
          var prev = layers[L - 1];
          var idx = {}; prev.forEach(function (id, i) { idx[id] = i; });
          layers[L] = stableSort(layers[L], function (id) {
            var ps = predsOf(id);
            if (!ps.length) return (prev.length - 1) / 2;
            var sum = 0; ps.forEach(function (q) { sum += idx[q] === undefined ? prev.length / 2 : idx[q]; });
            return sum / ps.length;
          });
        })(l);
      }
      // 上行：按下一层后继的平均位次排本层
      for (var l2 = layers.length - 2; l2 >= 0; l2--) {
        (function (L) {
          var next = layers[L + 1];
          var idx = {}; next.forEach(function (id, i) { idx[id] = i; });
          layers[L] = stableSort(layers[L], function (id) {
            var ss = succsOf(id);
            if (!ss.length) return (next.length - 1) / 2;
            var sum = 0; ss.forEach(function (q) { sum += idx[q] === undefined ? next.length / 2 : idx[q]; });
            return sum / ss.length;
          });
        })(l2);
      }
    }

    // 行几何
    var yTop = [], rowH = [];
    var yc = 0;
    for (var r = 0; r < layers.length; r++) {
      yTop.push(yc);
      var h = 0;
      layers[r].forEach(function (id) { h = Math.max(h, sizes[id].h); });
      rowH.push(h);
      yc += h + VGAP;
    }
    var H = yc - VGAP + (rowH.length ? rowH[rowH.length - 1] : 0);
    // 宽度 = 最宽行
    var Wc = 0;
    layers.forEach(function (row) {
      var w = 0;
      row.forEach(function (id, i) { w += sizes[id].w + (i ? HGAP : 0); });
      Wc = Math.max(Wc, w);
    });
    var pos = {};
    layers.forEach(function (row, L) {
      var rowW = 0;
      row.forEach(function (id, i) { rowW += sizes[id].w + (i ? HGAP : 0); });
      var x = (Wc - rowW) / 2;
      row.forEach(function (id) {
        pos[id] = { x: x, y: yTop[L] };
        x += sizes[id].w + HGAP;
      });
    });
    return { layers: layers, pos: pos, Wc: Wc, H: H, fwd: fwd, back: back, sizes: sizes };
  }

  /* ---------- 独立带：无连接节点包成网格 ---------- */
  function gridGeometry(nodes, sizes) {
    var rows = [], cur = [], curW = 0, target = GRID_CAP;
    nodes.forEach(function (id) {
      var w = sizes[id].w;
      if (cur.length && curW + HGAP + w > target) { rows.push(cur); cur = []; curW = 0; }
      cur.push(id); curW += (cur.length > 1 ? HGAP : 0) + w;
    });
    if (cur.length) rows.push(cur);
    var pos = {}, y = 0;
    rows.forEach(function (row) {
      // 行实际宽度（group 282 / leaf 236 混排时按实际叠加，不用 maxW 估算）
      var W = 0;
      row.forEach(function (id, i) { W += sizes[id].w + (i ? HGAP : 0); });
      var x = (target - W) / 2;
      row.forEach(function (id) {
        pos[id] = { x: x, y: y };
        x += sizes[id].w + HGAP;
      });
      y += Math.max.apply(null, row.map(function (id) { return sizes[id].h; })) + 28;
    });
    return { rows: rows, pos: pos, W: target, H: y - 28 + (rows.length ? Math.max.apply(null, rows[rows.length - 1].map(function (id) { return sizes[id].h; })) : 0) };
  }

  /* ===================================================================
     纯字符串渲染内核：节点盒与边路径。不碰 document，Node 下 require 可单测——
     盒子里画了什么、线接在哪，只有这里的断言能兜住（render() 只产 HTML 外壳）。
     =================================================================== */

  /* ---------- 悬停提示：原生 <title>（ADR-0010） ----------
     hover 只给**当前语言**的一句轻提示：节点显全名、边显中点短语。用原生 title 而不是自绘浮层——
     盒里的名字是 fitWidth 截断过的（`GDX` / 长名），hover 看全名是它的真实用处。 */
  function titleTag(text) { return text ? '<title>' + esc(text) + '</title>' : '<title></title>'; }

  /* ---------- 节点盒 ---------- */
  // id: 单元 id；counts: countPorts 的结果（只对 group 生效）；M / G: 模块 / 分组索引
  // （调用方传进来——内核不持有模型，因此这里能拿测试数据直接调）；lang: 'zh' | 'en'。
  function nodeSvg(id, x, y, counts, lang, M, G) {
    var isGrp = !!G[id], m = M[id], g = G[id];
    var w = isGrp ? GW : CW, h = isGrp ? GH : CH;
    // group.label 是模型起的抽象名（可译）；模块 label 是源码标识符 / 包名（绝不译）。
    var name = isGrp ? pick(g.label, lang) : m.label;
    var desc = pick(isGrp ? g.description : m.description, lang);
    var nameFs = 14, descFs = 12;
    var maxW = w - 34;
    // 返回值会被 flowSvg 包进 `<g class="node">`，所以这条 <title> 就是那个组的 hover 提示。
    var s = titleTag(name);
    if (isGrp) {
      s += '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="12" fill="#eef2ff" stroke="#c7d2fe" stroke-width="1"/>';
      s += '<text x="' + (x + 16) + '" y="' + (y + 18) + '" font-size="8.5" letter-spacing="1.5" fill="#6366f1">' + esc(tr(lang, 'groupTag')) + '</text>';
    } else {
      s += '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="10" fill="#ffffff" stroke="#cbd5e1" stroke-width="1"/>';
      s += '<text x="' + (x + 16) + '" y="' + (y + 18) + '" font-size="8.5" letter-spacing="1.5" fill="#9aa3b2">' + esc(tr(lang, 'internalTag')) + '</text>';
    }
    s += '<text x="' + (x + 16) + '" y="' + (y + 34) + '" font-size="' + nameFs + '" font-weight="600" fill="#1a202c"' +
      (isGrp ? '' : ' font-family="monospace"') + '>' + esc(fitWidth(name, nameFs, maxW)) + '</text>';
    var lines = wrap2(desc, descFs, maxW);
    s += '<text x="' + (x + 16) + '" y="' + (y + 53) + '" font-size="' + descFs + '" fill="#5b6472">' + esc(lines[0]) + '</text>';
    s += '<text x="' + (x + 16) + '" y="' + (y + 69) + '" font-size="' + descFs + '" fill="#5b6472">' + esc(lines[1]) + '</text>';
    if (isGrp) {
      var cnt = (counts && counts[id]) || emptyPort();   // 只读：missing 时借零值，不写回
      var cxi = x + w / 2;
      // 两个方向都画端口：空方向标「—」而不是不画（ADR-0009，取代 ADR-0006 的「空方向不画端口」）。
      s += portMark(id, 'in', cxi, y, cnt.in, cnt.inRep, lang);
      s += portMark(id, 'out', cxi, y + h, cnt.out, cnt.outRep, lang);
    }
    return s;
  }

  /* ---------- 端口圆点 + 标注 ---------- */
  // 圆点画在盒边缘（入 = 顶 `cy = y`、出 = 底 `cy = y + h`）、盒宽中点，`class="port"` 供事件绑定。
  // N > 0 时标注 `×N 代表内容`；N = 0（该方向一条内容都没有）时刻意**不隐藏端口**，显式标「—」
  // ——「这个方向没有数据」和「图漏画了」是两件事，读者分不清就会以为图错了（ADR-0009）。
  // `×N` 与代表内容拼成一段文本交给 fitWidth：整段按 REP_W 截断，数字在段首不会被截掉。
  function portMark(id, dir, cx, cy, n, rep, lang) {
    var s = '<circle class="port" data-id="' + esc(id) + '" data-port="' + dir + '" cx="' + cx + '" cy="' + cy + '" r="6" fill="#ffffff" stroke="#6366f1" stroke-width="1.5"/>';
    var txt = n ? '×' + n : tr(lang, 'dash');
    var body = n ? pick(rep, lang) : '';   // 代表内容跟着显示语言走；N 由 countPorts 按 zh 去重，不变
    if (body) txt += ' ' + body;
    s += '<text x="' + (cx + 9) + '" y="' + (dir === 'in' ? cy + 7 : cy - 6) + '" font-size="10" fill="#4338ca">' + esc(fitWidth(txt, 10, REP_W)) + '</text>';
    return s;
  }

  /* ---------- 端口清单（点端口弹出） ---------- */
  // 单元显示名：group 的抽象名可译，模块名是源码标识符 / 包名，**绝不译**。
  function unitName(id, lang, M, G) {
    return G[id] ? pick(G[id].label, lang) : M[id].label;
  }

  /* 端口清单的行数据。行数 === countPorts 在该方向的种数——两处**同一把键**
     （pick(label, 'zh')），所以点开数得清，且切语言行数不变（去重键不是显示语言）。
     组内取 IR 顺序第一条 connection 的 label 当该行的「内容」（与 ×N 右侧的代表内容同一规则）；
     对端按首现顺序去重，多个时交给 uniqJoin 收尾成 `a · b +2`。
     返回 [{ rep: <原始 label 字段>, peers: [单元 id…] }]，保 IR 顺序。 */
  function portRows(id, dir, edges) {
    // byKey 的键是 label 文本（用户数据），普通 {} 会被 "constructor" 这类文本命中，故用无原型对象。
    var byKey = Object.create(null), order = [];
    (edges || []).forEach(function (e) {
      // 点开的单元在这一端固定不变（出 = from、入 = to），变的只有对端。
      if (dir === 'in' ? e.to !== id : e.from !== id) return;
      var peer = dir === 'in' ? e.from : e.to;
      (e.conns || []).forEach(function (cn) {
        var txt = pick(cn ? cn.label : '', 'zh');
        if (!txt) return;
        var row = byKey[txt];
        if (!row) { row = byKey[txt] = { rep: cn.label, peers: [] }; order.push(row); }
        if (peer && row.peers.indexOf(peer) === -1) row.peers.push(peer);
      });
    });
    return order;
  }

  // 一行的 HTML：`源 → 内容 → 目标`，箭头方向就是数据流方向（入端口时对端在左）。
  function portListHtml(id, dir, edges, lang, M, G) {
    return portRows(id, dir, edges).map(function (row) {
      var peers = esc(uniqJoin(row.peers.map(function (p) { return unitName(p, lang, M, G); })));
      var self = esc(unitName(id, lang, M, G));
      var src = dir === 'in' ? peers : self;
      var dst = dir === 'in' ? self : peers;
      return '<div class="vA-pp-row"><span class="vA-pp-mod">' + src + '</span><span class="vA-pp-arrow">→</span><span class="vA-pp-lab">' + esc(pick(row.rep, lang)) + '</span><span class="vA-pp-arrow">→</span><span class="vA-pp-mod">' + dst + '</span></div>';
    }).join('');
  }

  /* ---------- 四段说明（点边弹出）----------
     IR 里每条 connection 上的四段：source（从哪来）/ process（经过什么处理）/
     output（输出了什么）/ purpose（用于什么），中英各一套（ADR-0008）。四个字段名固定。
     画布中点只放 label 那一句短语，四段是点开才看的数据——两者刻意分开（CONTEXT.md 的 `_Avoid_`：
     别把四段当成「边注释」，注释是图上的文字，四段是 IR 里的数据）。 */
  var FOUR_KEYS = ['source', 'process', 'output', 'purpose'];

  // 一种语言下的一段。缺当前语言时回退默认语言，再回退另一种——与 pick 同一条 expand 期脚手架：
  // 契约步的双语硬校验上线后，这条回退分支不可达（与票 08 对 pick 的记录同源）。
  function pickPart(desc, lang, key) {
    if (!desc || typeof desc !== 'object') return '';
    var order = [normLang(lang), DEFAULT_LANG, 'en'];
    for (var i = 0; i < order.length; i++) {
      var sub = desc[order[i]];
      if (sub && typeof sub === 'object' && hasText(sub[key])) return sub[key];
    }
    return '';
  }

  /* 聚合边的行数据：按**来源模块**分组，组内保 IR 顺序。
     顶层折叠后，组内成员的那些原子 connection 在画布上没有可见的那条线——这份清单是它们
     唯一的到达路径，所以「每条 connection 都要露脸」是这里的硬要求，不是装饰。 */
  function fourPartRows(edge) {
    // 键是模块 id（用户数据），普通 {} 会被 "constructor" 这类 id 命中内置属性，故用无原型对象。
    var bySrc = Object.create(null), out = [];
    ((edge && edge.conns) || []).forEach(function (cn) {
      if (!cn) return;
      var g = bySrc[cn.from];
      if (!g) { g = bySrc[cn.from] = { id: cn.from, conns: [] }; out.push(g); }
      g.conns.push(cn);
    });
    return out;
  }

  // 单元显示名（模块名是源码标识符，不译）。仅用于四段清单里的来源/去向；取不到就退回 id。
  function modName(id, M) {
    var m = M && M[id];
    return m ? m.label : String(id);
  }

  // 四段清单的 HTML：每组一个来源模块标题，组内每条 connection 一段「流向 + 四段」。
  // 缺 description（真实产物此刻就是）时每段显式画「—」——静默留白会让人以为那条线没有用途。
  // 清单行**不可点**：「点开某条 connection」是票 05 的事（弹窗合并 + 一层返回）。
  function fourPartHtml(edge, lang, M) {
    var groups = fourPartRows(edge);
    if (!groups.length) return '<div class="vA-empty">' + esc(tr(lang, 'none')) + '</div>';
    return groups.map(function (g) {
      return '<div class="vA-fp-src">' + esc(modName(g.id, M)) + '</div>' +
        g.conns.map(function (cn) {
          var parts = FOUR_KEYS.map(function (k) {
            var txt = pickPart(cn.description, lang, k);
            return '<div class="vA-fp-part"><span class="vA-fp-cap">' + esc(tr(lang, 'fp_' + k)) + '</span>' +
              '<span class="vA-fp-txt' + (txt ? '' : ' vA-fp-none') + '">' +
              esc(txt || tr(lang, 'dash')) + '</span></div>';
          }).join('');
          return '<div class="vA-fp-conn"><div class="vA-fp-flow">' + esc(pick(cn.label, lang)) +
            ' → ' + esc(modName(cn.to, M)) + '</div>' + parts + '</div>';
        }).join('');
    }).join('');
  }

  /* ---------- 边（前向 + 反馈）路径 ---------- */
  // 入边终点落在目标盒上边缘**上方** PORT_GAP px（即端口圆点外缘之上），箭头才不会被后画的
  // 盒体 / 端口圆点盖住（ADR-0009）。层序不动：节点仍画在边之后，只让箭头露出来。
  function fwdPath(a, b, sA, sB) {
    var x1 = a.x + sA.w / 2, y1 = a.y + sA.h;
    var x2 = b.x + sB.w / 2, y2 = b.y - PORT_GAP;
    var my = (y1 + y2) / 2;
    return { d: 'M' + x1 + ' ' + y1 + ' C ' + x1 + ' ' + my + ' ' + x2 + ' ' + my + ' ' + x2 + ' ' + y2, xm: (x1 + x2) / 2, my: my };
  }
  function feedbackPath(a, b, sA, sB, gx) {
    var x1 = a.x + sA.w / 2, y1 = a.y + sA.h;      // 源底（出）
    var x2 = b.x + sB.w / 2, y2 = b.y - PORT_GAP;  // 目标顶（入）上方 PORT_GAP，与前向边一致
    var d = 'M' + x1 + ' ' + y1 +
      ' C ' + x1 + ' ' + (y1 + 18) + ' ' + gx + ' ' + (y1 + 18) + ' ' + gx + ' ' + (y1 + 6) +
      ' L ' + gx + ' ' + (y2 - 14) +
      ' C ' + gx + ' ' + (y2 - 6) + ' ' + (x1 + (gx - x1) * 0.4) + ' ' + (y2 - 6) + ' ' + x2 + ' ' + y2;
    return { d: d, mid: (y1 + y2) / 2 };
  }

  /* ---------- 边的可点单元（ADR-0010） ----------
     一条边 = 一个 `<g class="edge" data-from data-to>`，里面装三样东西：
       · 可见路径：stroke-width 1.5，**视觉粗细不变**（读者看到的还是那条细线）；
       · 命中路径：同一条 d 再来一遍，描边加宽但透明——细线点不中，命中区靠它；
       · 中点标签：白色底衬矩形 + 文本（底衬既是可读性垫底，也是命中区的一部分）。
     外加 `<title>`：hover 给当前语言的整句（画出来那段可能是 fitWidth 截断过的）。
     边的身份挂在组上：真实浏览器里点命中路径或底衬都会冒泡到同一个组，DOM 层据此认出是哪条边。 */
  var HIT_W = 14;          // 命中路径的描边宽（像素）：够宽好点，又不会被误当成视觉元素
  var EDGE_LABEL_W = 240;  // 前向边中点标签的可用宽（fitWidth 截断）
  function n1(n) { return Math.round(n * 10) / 10; }   // 一位小数：免得浮点噪声写进产物
  // 透明加宽的那条路径。pointer-events="stroke" 让它在没有颜色时也吃点击。
  function hitPath(d) {
    return '<path d="' + d + '" fill="none" stroke="transparent" stroke-width="' + HIT_W + '" pointer-events="stroke"/>';
  }
  // 中点标签：白色底衬按**画出来的那段**文字定宽（截断后），不是按整句——否则底衬会盖住整条边。
  // 文本仍带白色描边（paint-order:stroke），底衬与它叠在一起就是「白底衬」的观感。
  function edgeLabelParts(text, x, y, fs, anchor, fill) {
    var w = 0;
    for (var i = 0; i < text.length; i++) w += chW(text[i], fs);
    var padX = 3;
    var x0 = anchor === 'end' ? x - w : (anchor === 'middle' ? x - w / 2 : x);
    return '<rect class="edge-hit-label" x="' + n1(x0 - padX) + '" y="' + n1(y - fs * 0.85) +
      '" width="' + n1(w + padX * 2) + '" height="' + n1(fs * 1.15) + '" fill="#ffffff" pointer-events="all"/>' +
      '<text x="' + n1(x) + '" y="' + n1(y) + '" text-anchor="' + anchor + '" font-size="' + fs + '" fill="' + fill +
      '" stroke="#ffffff" stroke-width="4" stroke-linejoin="round" paint-order="stroke">' + esc(text) + '</text>';
  }
  function fwdEdgeSvg(e, p, label, markerId) {
    var shown = fitWidth(label, 11, EDGE_LABEL_W);
    var s = '<g class="edge" data-from="' + esc(e.from) + '" data-to="' + esc(e.to) + '">';
    s += '<path d="' + p.d + '" fill="none" stroke="#b6c2d1" stroke-width="1.5" marker-end="url(#' + markerId + ')"/>';
    s += hitPath(p.d);
    if (shown) s += edgeLabelParts(shown, p.xm, p.my - 4, 11, 'middle', '#475569');
    s += titleTag(label);
    return s + '</g>';
  }
  // 反馈弧：标签走右侧车道，右对齐；`↺ ` 前缀标记它是回边（title 里也带，好让 hover 与画面一致）。
  // laneW 是车道宽，标签在这里面 fitWidth 截断。
  function backEdgeSvg(e, d, label, lx, ly, laneW, markerId) {
    var s = '<g class="edge" data-from="' + esc(e.from) + '" data-to="' + esc(e.to) + '">';
    s += '<path d="' + d + '" fill="none" stroke="#f59e0b" stroke-width="1.5" stroke-dasharray="5 3" marker-end="url(#' + markerId + ')"/>';
    s += hitPath(d);
    if (label) s += edgeLabelParts('↺ ' + fitWidth(label, 10, laneW - 26), lx, ly, 10, 'end', '#b45309');
    s += titleTag(label ? '↺ ' + label : '');
    return s + '</g>';
  }

  /* ===================================================================
     以下为浏览器端 DOM 应用（需 #oh-grasp-ir 内嵌 JSON + #root 等骨架）。
     Node 环境（单测 / 语法检查）没有 document，整段跳过。
     =================================================================== */
  if (typeof document !== 'undefined' && document.getElementById) {
    (function () {
      var ir = JSON.parse(document.getElementById('oh-grasp-ir').textContent);
      var M = {};
      ir.modules.forEach(function (m) { M[m.id] = m; });
      var G = {};
      (ir.groups || []).forEach(function (g) { G[g.id] = g; });

  // 语言是阅读偏好，不做持久化，每次打开都是默认中文。
  var state = { lang: DEFAULT_LANG };
  // 当前那一屏的「关弹窗」动作。renderA 每次渲染都换一个新的 overlay，把它的 closeDetail 放这里，
  // 让 document 上的 keydown 只注册一次也能关到最新的那个（见 renderA 末尾与下面的 Esc 分支）。
  var closeOverlay = null;
  // 切语言 = 换一个取值子树，立刻重渲染；非法语言忽略。
  function setLang(lang) {
    if (LANGS.indexOf(lang) === -1 || state.lang === lang) return;
    state.lang = lang;
    render();
  }

  var markerSeq = 0;
  function markerDef(color) {
    var id = 'mk' + (++markerSeq);
    return { id: id, xml: '<marker id="' + id + '" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="' + color + '"/></marker>' };
  }

  // 中点标签的描边白底已并入内核的 edgeLabelParts（票 04）：原先这里另有一个 haloText，
  // 只画字不画底衬，命中区只能落在 1.5px 的线宽上——点不中。函数已删，别再加回来。

  /* ---------- 合成一张完整 flow svg（顶层与子图共用同一内核） ---------- */
  // ids: 单元 id 数组；edges: 已聚合的 {from,to,conns}（子图 conns 长度 1）；
  // counts: 端口 ×N；返回 {svg,W,H,hasBack}。
  function flowSvg(ids, edges, counts, lang) {
    var size = function (id) { return G[id] ? { w: GW, h: GH } : { w: CW, h: CH }; };
    var comps = components(ids, edges);
    var flowComps = comps.filter(function (c) { return c.edges.length > 0; });
    flowComps.sort(function (a, b) { return b.nodes.length - a.nodes.length; });
    var iso = [];
    comps.forEach(function (c) { if (!c.edges.length) iso = iso.concat(c.nodes); });

    var geoms = [];
    var Wmax = 0, cursor = PAD_TOP;
    flowComps.forEach(function (c) {
      var sz = {};
      c.nodes.forEach(function (id) { sz[id] = size(id); });
      var g = flowGeometry(c.nodes, c.edges, sz);
      var lane = g.back.length ? 170 : 0;
      g.lane = lane;
      g.gx = g.Wc + 26;
      g.W = g.Wc + lane;
      g.top = cursor;
      cursor += g.H + REGION_GAP;
      Wmax = Math.max(Wmax, g.W);
      geoms.push(g);
    });
    // 独立带
    var grid = null;
    if (iso.length) {
      var szg = {};
      iso.forEach(function (id) { szg[id] = size(id); });
      grid = gridGeometry(iso, szg);
      grid.W = Math.max(Wmax, GRID_CAP, grid.W);
      grid.top = cursor;
      cursor += grid.H + REGION_GAP;
      Wmax = Math.max(Wmax, grid.W);
    }
    var hasBack = geoms.some(function (g) { return g.back.length > 0; });
    var contentW = Math.max(Wmax, grid ? grid.W : 0);
    var W = contentW + PAD_LR * 2;
    var H = cursor - REGION_GAP + PAD_TOP;

    var mF = markerDef('#b6c2d1');
    var mB = hasBack ? markerDef('#f59e0b') : null;
    var defs = '<defs>' + mF.xml + (mB ? mB.xml : '') + '</defs>';
    var body = '';

    // 弱连通分量各跑一套分层，收进纵向堆叠的独立区（ADR-0007）。
    // 每个区包一层 translate：内部坐标全是该分量局部几何，整区平移到位。
    geoms.forEach(function (g) {
      var part = '';
      // 反馈弧在最底
      g.back.forEach(function (e) {
        var a = g.pos[e.from], b = g.pos[e.to];
        if (!a || !b) return;
        var pa = feedbackPath(a, b, g.sizes[e.from], g.sizes[e.to], g.gx);
        var lbl = edgeLabel(e, lang) || tr(lang, 'feedback');
        part += backEdgeSvg(e, pa.d, lbl, g.Wc + g.lane - 10, pa.mid, g.lane, mB.id);
      });
      // 前向边 path + label
      g.fwd.forEach(function (e) {
        var a = g.pos[e.from], b = g.pos[e.to];
        if (!a || !b) return;
        var p = fwdPath(a, b, g.sizes[e.from], g.sizes[e.to]);
        part += fwdEdgeSvg(e, p, edgeLabel(e, lang), mF.id);
      });
      // 节点最后画（层序不动，见 ADR-0009：入端已外移 PORT_GAP，箭头落在端口圆点上方露出来）
      g.layers.forEach(function (row) {
        row.forEach(function (id) {
          var p = g.pos[id];
          var kind = G[id] ? 'group' : 'internal';
          part += '<g class="node" data-id="' + esc(id) + '" data-kind="' + kind + '">' + nodeSvg(id, p.x, p.y, counts, lang, M, G) + '</g>';
        });
      });
      body += '<g transform="translate(0,' + g.top + ')">' + part + '</g>';
    });
    if (grid) {
      var gpart = '';
      grid.rows.forEach(function (row) {
        row.forEach(function (id) {
          var p = grid.pos[id];
          var kind = G[id] ? 'group' : 'internal';
          gpart += '<g class="node" data-id="' + esc(id) + '" data-kind="' + kind + '">' + nodeSvg(id, p.x, p.y, counts, lang, M, G) + '</g>';
        });
      });
      body += '<g transform="translate(' + ((contentW - grid.W) / 2) + ',' + grid.top + ')">' + gpart + '</g>';
    }

    var svg = '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">' + defs + body + '</svg>';
    return { svg: svg, W: W, H: H, hasBack: hasBack };
  }

  /* ---------- 缩放/平移控制器（顶层与弹窗子图复用） ---------- */
  var active = null;
  document.addEventListener('mousemove', function (e) {
    if (!active || !active.dragging) return;
    var dx = e.clientX - active.sx, dy = e.clientY - active.sy;
    if (Math.abs(dx) + Math.abs(dy) > 3) active.moved = true;
    active.tx = active.ox + dx; active.ty = active.oy + dy;
    active.apply();
  });
  document.addEventListener('mouseup', function () {
    if (active && active.dragging) {
      active.dragging = false;
      if (active.vp) active.vp.classList.remove('dragging');
      active = null;
    }
  });
  function attachFlow(vp, zt, W, H, badge) {
    var c = { scale: 1, tx: 0, ty: 0, moved: false, dragging: false, sx: 0, sy: 0, ox: 0, oy: 0, vp: vp };
    c.apply = function () {
      zt.style.transform = 'translate(' + c.tx + 'px,' + c.ty + 'px) scale(' + c.scale + ')';
      if (badge) badge.textContent = Math.round(c.scale * 100) + '%';
    };
    c.fit = function () {
      var vw = vp.clientWidth || 900, vh = vp.clientHeight || 560;
      var s = Math.min(1, vw / W, vh / H);
      c.scale = s;
      c.tx = (vw - W * s) / 2;
      c.ty = (vh - H * s) / 2;
      c.apply();
    };
    vp.addEventListener('wheel', function (e) {
      e.preventDefault();
      var r = vp.getBoundingClientRect();
      var mx = e.clientX - r.left, my = e.clientY - r.top;
      var ns = Math.min(3, Math.max(0.4, c.scale * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
      c.tx = mx - (mx - c.tx) * (ns / c.scale);
      c.ty = my - (my - c.ty) * (ns / c.scale);
      c.scale = ns;
      c.apply();
    }, { passive: false });
    vp.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      c.dragging = true; c.moved = false;
      c.sx = e.clientX; c.sy = e.clientY; c.ox = c.tx; c.oy = c.ty;
      vp.classList.add('dragging');
      active = c;
      e.preventDefault();
    });
    vp.addEventListener('dblclick', function () { c.fit(); });
    c.fit();
    return c;
  }

  /* ============ A · Flow ============ */
  function renderA(root) {
    var lang = state.lang;
    var io = function (arr) { return pickList(arr, lang).map(function (t) { return '<span class="chip">' + esc(t) + '</span>'; }).join(''); };
    var ext = ir.modules.filter(function (m) { return m.type === 'external'; });
    var head =
      '<header class="vA-head">' +
      '<div class="vA-headrow">' +
      '<div class="vA-headmain">' +
      '<h1 class="vA-title">' + esc(ir.meta.title) + '</h1>' +
      '<p class="vA-sub">' + esc(pick(ir.meta.subtitle, lang)) + '</p>' +
      '</div>' +
      // 语言切换器：标题右侧，默认中文、不记忆（每次打开都是 zh）。
      '<div class="vA-lang" role="group" aria-label="Language">' +
      '<button type="button" class="vA-lang-btn' + (lang === 'zh' ? ' sel' : '') + '" id="langZh" data-lang="zh">中文</button>' +
      '<button type="button" class="vA-lang-btn' + (lang === 'en' ? ' sel' : '') + '" id="langEn" data-lang="en">EN</button>' +
      '</div>' +
      '</div>' +
      '<div class="vA-io">' +
      '<div class="group"><span class="cap">' + esc(tr(lang, 'input')) + '</span>' + io(ir.meta.input) + '</div>' +
      '<div class="group"><span class="cap">' + esc(tr(lang, 'output')) + '</span>' + io(ir.meta.output) + '</div>' +
      '</div></header>';
    var extRail =
      '<aside class="vA-ext"><div class="vA-sec">' + esc(tr(lang, 'deps')) + '</div>' +
      ext.map(function (m) {
        return '<div class="vA-extcard"><div class="vA-extname">' + esc(m.label) + '</div>' +
          '<div class="vA-extdesc">' + esc(pick(m.description, lang)) + '</div>' +
          '<div class="vA-extuse">↳ ' + esc((m.input || []).join(', ')) + '</div></div>';
      }).join('') + '</aside>';

    // 折叠拓扑：group 与未分组叶子当顶层单元；同向连接聚合。
    function topOf(m) { return m.group || m.id; }
    var units = [], seenU = {};
    ir.modules.forEach(function (m) {
      if (m.type !== 'internal') return;
      var t = topOf(m);
      if (!seenU[t]) { seenU[t] = true; units.push(t); }
    });
    // 折叠到顶层单元后，同向多 connection 并成一条（aggregateEdges 同去重逻辑复用）。
    // 折叠只看端点，conns 仍存原始 connection（真实模块 from/to），端口清单据此还原。
    var topConns = [];
    (ir.connections || []).forEach(function (c) {
      var fm = M[c.from], tm = M[c.to];
      if (!fm || !tm || fm.type !== 'internal' || tm.type !== 'internal') return;
      if (topOf(fm) === topOf(tm)) return; // 组内边在折叠视图下自环，不进顶层
      topConns.push(c);
    });
    var topEdges = aggregateEdges(topConns, function (c) {
      return { from: topOf(M[c.from]), to: topOf(M[c.to]) };
    });
    var counts = countPorts(topEdges);

    var flow = flowSvg(units, topEdges, counts, lang);

    root.innerHTML = '<div class="vA">' + head + '<div class="vA-body">' + extRail + '<main class="vA-main">' +
      '<div class="vA-hint">' + esc(tr(lang, 'hint')) + '</div>' +
      '<div class="vA-flow" id="flowViewport"><div class="vA-zoom" id="zoomTarget">' + flow.svg + '</div><div class="vA-zoom-badge" id="zoomBadge">100%</div></div>' +
      '</main></div><div class="vA-overlay" id="detailOverlay"></div></div>';

    var detail = root.querySelector('#detailOverlay');
    var zt = root.querySelector('#zoomTarget'), zb = root.querySelector('#zoomBadge');
    var ctl = attachFlow(root.querySelector('#flowViewport'), zt, flow.W, flow.H, zb);

    function closeDetail() {
      detail.classList.remove('open');
      root.querySelectorAll('.node').forEach(function (g) { g.classList.remove('sel'); });
    }
    // 顶层单元的显示名：group 抽象名可译，模块名不译（实现搬进内核的 unitName）。
    function nameOf(id) { return unitName(id, lang, M, G); }
    // 点边 → 四段说明。第三个弹窗（先照 openDetail / openGroup 的样子写；合并成一个组件是票 05）。
    // 聚合边（conns 多条）列出其下**每条** connection 的四段，按来源模块分组——组内那些原子
    // connection 在画布上没有可见的线，这里是它们唯一的到达路径（ADR-0008）。
    function openEdge(e) {
      if (!e) return;
      detail.innerHTML = '<div class="vA-modal vA-modal-wide">' +
        '<div class="vA-detail-head"><span class="vA-detail-name">' + esc(nameOf(e.from)) + ' → ' + esc(nameOf(e.to)) + '</span>' +
        '<span class="vA-detail-kind">' + esc(tr(lang, 'edge')) + '</span>' +
        '<button class="vA-detail-close" id="detailClose">×</button></div>' +
        '<h4>' + esc(tr(lang, 'fourParts')) + '</h4>' + fourPartHtml(e, lang, M) +
        '</div>';
      detail.classList.add('open');
      detail.querySelector('#detailClose').addEventListener('click', closeDetail);
    }
    // 边在画布上的身份 = from|to（聚合边的端点已折叠成顶层单元，conns 仍指向真实模块）。
    // 命中区是整条路径 + 中点标签的白底衬，两者同在一个 <g class="edge"> 里，所以绑在组上：
    // 真实浏览器里点哪个子元素都冒泡到这同一个组 = 同一条边（ADR-0010）。
    // 子图有自己的一份边与自己的缩放控制器，所以容器与控制器都由调用方传进来。
    function bindEdges(container, edges, controller) {
      var byKey = {};
      edges.forEach(function (e) { byKey[e.from + '|' + e.to] = e; });
      container.querySelectorAll('.edge').forEach(function (g) {
        g.addEventListener('click', function () {
          if (controller.moved) { controller.moved = false; return; }   // 拖拽画布不算点边
          openEdge(byKey[g.dataset.from + '|' + g.dataset.to]);
        });
      });
    }
    function openDetail(id) {
      var m = M[id];
      detail.innerHTML =
        '<div class="vA-modal">' +
        '<div class="vA-detail-head"><span class="vA-detail-name">' + esc(m.label) + '</span><span class="vA-detail-kind">internal</span><button class="vA-detail-close" id="detailClose">×</button></div>' +
        '<p class="vA-detail-desc">' + esc(pick(m.detail || m.description, lang)) + '</p>' +
        (m.source ? '<h4>' + esc(tr(lang, 'source')) + (typeof m.sourceLine === 'number' ? ' · ' + esc(fmt(tr(lang, 'line'), m.sourceLine)) : '') + '</h4><pre class="vA-src"><code>' + esc(m.source) + '</code></pre>' : '') +
        '</div>';
      detail.classList.add('open');
      root.querySelectorAll('.node').forEach(function (g) { g.classList.toggle('sel', g.dataset.id === id); });
      detail.querySelector('#detailClose').addEventListener('click', closeDetail);
    }
    function openGroup(id) {
      var g = G[id];
      var members = ir.modules.filter(function (m) { return m.type === 'internal' && m.group === id; });
      var memberIds = {};
      members.forEach(function (m) { memberIds[m.id] = true; });
      var inner = (ir.connections || []).filter(function (c) { return memberIds[c.from] && memberIds[c.to]; });
      var boundary = (ir.connections || []).filter(function (c) {
        return (memberIds[c.from] && !memberIds[c.to]) || (!memberIds[c.from] && memberIds[c.to]);
      });

      var body;
      if (inner.length) {
        var innerEdges = aggregateEdges(inner);
        var ids = members.map(function (m) { return m.id; });
        var sub = flowSvg(ids, innerEdges, null, lang);
        body = '<div class="vA-flow vA-flow-sub" id="subViewport"><div class="vA-zoom" id="subZoom">' + sub.svg + '</div></div>';
        var modal = '<div class="vA-modal vA-modal-wide">';
        modal += '<div class="vA-detail-head"><span class="vA-detail-name">' + esc(pick(g.label, lang)) + '</span><span class="vA-detail-kind">' + esc(fmt(tr(lang, 'groupMeta'), members.length)) + '</span><button class="vA-detail-close" id="detailClose">×</button></div>';
        modal += '<p class="vA-detail-desc">' + esc(pick(g.description, lang)) + '</p><h4>' + esc(tr(lang, 'innerFlow')) + '</h4>' + body;
        modal += boundaryBlock(boundary, memberIds);
        modal += '</div>';
        detail.innerHTML = modal;
        detail.classList.add('open');
        detail.querySelector('#detailClose').addEventListener('click', closeDetail);
        var sCtl = attachFlow(detail.querySelector('#subViewport'), detail.querySelector('#subZoom'), sub.W, sub.H, null);
        detail.querySelectorAll('.node').forEach(function (n) {
          n.addEventListener('click', function () {
            if (sCtl.moved) { sCtl.moved = false; return; }
            openDetail(n.dataset.id);
          });
        });
        // 子图里的边同样可点（子图的边不折叠，每条 conns 长度 1）。
        bindEdges(detail, innerEdges, sCtl);
      } else {
        var cards = members.map(function (m) {
          return '<button class="vA-mcard" data-id="' + esc(m.id) + '" type="button"><span class="vA-mcard-name">' + esc(m.label) + '</span><span class="vA-mcard-desc">' + esc(pick(m.description, lang)) + '</span></button>';
        }).join('');
        detail.innerHTML = '<div class="vA-modal vA-modal-wide">' +
          '<div class="vA-detail-head"><span class="vA-detail-name">' + esc(pick(g.label, lang)) + '</span><span class="vA-detail-kind">' + esc(fmt(tr(lang, 'groupMeta'), members.length)) + '</span><button class="vA-detail-close" id="detailClose">×</button></div>' +
          '<p class="vA-detail-desc">' + esc(pick(g.description, lang)) + '</p><h4>' + esc(tr(lang, 'members')) + '</h4><div class="vA-mgrid">' + cards + '</div>' +
          boundaryBlock(boundary, memberIds) +
          '</div>';
        detail.classList.add('open');
        detail.querySelector('#detailClose').addEventListener('click', closeDetail);
        detail.querySelectorAll('.vA-mcard').forEach(function (card) {
          card.addEventListener('click', function () { openDetail(card.dataset.id); });
        });
      }
    }
    function bedgeHtml(boundary, memberIds) {
      return boundary.map(function (c) {
        var self = memberIds[c.from] ? M[c.from] : M[c.to];
        var other = memberIds[c.from] ? M[c.to] : M[c.from];
        var dir = memberIds[c.from] ? '→' : '←';
        return '<div class="vA-bedge"><span class="vA-pp-mod">' + esc(nameOf(self.id)) + '</span> <span class="vA-bedge-arrow">' + dir + '</span> <span class="vA-bedge-lab">' + esc(pick(c.label, lang)) + '</span> <span class="vA-bedge-arrow">' + dir + '</span> <span class="vA-pp-mod">' + esc(nameOf(other.id)) + '</span></div>';
      }).join('');
    }
    function boundaryBlock(boundary, memberIds) {
      if (boundary.length) return '<h4>' + esc(tr(lang, 'boundary')) + '</h4><div class="vA-boundary">' + bedgeHtml(boundary, memberIds) + '</div>';
      // ADR-0006：无组间边时，输入/输出显示「—」而不是留空区/空端口。
      return '<h4>' + esc(tr(lang, 'boundary')) + '</h4><div class="vA-empty">' + esc(tr(lang, 'input')) + ' ' + esc(tr(lang, 'dash')) + ' · ' + esc(tr(lang, 'output')) + ' ' + esc(tr(lang, 'dash')) + '</div>';
    }
    function openPort(id, kind) {
      // 行数 === 盒上那个 `×N`（同一把 zh 去重键，见内核 portRows / portListHtml）。
      var rows = portListHtml(id, kind, topEdges, lang, M, G);
      detail.innerHTML = '<div class="vA-modal vA-modal-sm">' +
        '<div class="vA-detail-head"><span class="vA-detail-name">' + esc(kind === 'in' ? tr(lang, 'input') : tr(lang, 'output')) + '</span><span class="vA-detail-kind">' + esc(nameOf(id)) + '</span><button class="vA-detail-close" id="detailClose">×</button></div>' +
        (rows || '<div class="vA-empty">' + esc(tr(lang, 'none')) + '</div>') + '</div>';
      detail.classList.add('open');
      detail.querySelector('#detailClose').addEventListener('click', closeDetail);
    }
    // 语言切换器：立即生效（整页重渲染），不记忆。
    var zhBtn = root.querySelector('#langZh'), enBtn = root.querySelector('#langEn');
    if (zhBtn) zhBtn.addEventListener('click', function () { setLang('zh'); });
    if (enBtn) enBtn.addEventListener('click', function () { setLang('en'); });
    detail.addEventListener('click', function (e) { if (e.target === detail) closeDetail(); });
    root.querySelectorAll('.node').forEach(function (g) {
      g.addEventListener('click', function () {
        if (ctl.moved) { ctl.moved = false; return; }
        if (g.dataset.kind === 'group') openGroup(g.dataset.id);
        else openDetail(g.dataset.id);
      });
    });
    root.querySelectorAll('.port').forEach(function (p) {
      p.addEventListener('click', function (e) {
        e.stopPropagation();
        if (ctl.moved) { ctl.moved = false; return; }
        openPort(p.dataset.id, p.dataset.port);
      });
    });
    bindEdges(root, topEdges, ctl);
    // Esc 关闭弹窗（ADR-0010）。document 上的监听器只注册一次，所以真正的关闭函数走这个槽位——
    // 每次重渲染（切语言）都会换一个新的 #detailOverlay 和新的 closeDetail，不能各挂一个监听器。
    closeOverlay = closeDetail;
  }

  /* ============ B · Index ============ */
  function renderB(root) {
    var ext = ir.modules.filter(function (m) { return m.type === 'external'; });
    var intl = ir.modules.filter(function (m) { return m.type === 'internal'; });
    var ioIn = (ir.meta.input || []).join(' · ') || '—';
    var ioOut = (ir.meta.output || []).join(' · ') || '—';
    var extCards = ext.map(function (m) {
      return '<div class="vB-extcard"><div class="vB-extname">' + esc(m.label) + '</div>' +
        '<div class="vB-extdesc">' + esc(m.description) + '</div>' +
        '<div class="vB-extuse">↳ ' + esc((m.input || []).join(', ')) + '</div></div>';
    }).join('');
    function flowText(m) {
      var inc = ir.connections.filter(function (c) { return c.to === m.id; });
      var out = ir.connections.filter(function (c) { return c.from === m.id; });
      var incS = inc.map(function (c) { return '← ' + c.label + ' (' + M[c.from].label + ')'; }).join(' ');
      var outS = out.map(function (c) { return c.label + ' → ' + M[c.to].label; }).join(' ');
      return [incS, outS].filter(Boolean).join('　') || '—';
    }
    var rows = intl.map(function (m) {
      return '<tr><td class="m">' + esc(m.label) + '</td><td class="d">' + esc(m.description) + '</td><td class="vB-flow">' + esc(flowText(m)) + '</td></tr>';
    }).join('');
    root.innerHTML =
      '<div class="vB">' +
      '<header class="vB-head"><h1 class="vB-title">' + esc(ir.meta.title) + '</h1><p class="vB-sub">' + esc(ir.meta.subtitle) + '</p>' +
      '<dl class="vB-io"><div><dt>输入 Input</dt><dd>' + esc(ioIn) + '</dd></div><div><dt>输出 Output</dt><dd>' + esc(ioOut) + '</dd></div></dl></header>' +
      '<h2>外部依赖 <span>' + ext.length + '</span></h2><div class="vB-ext">' + (extCards || '<div class="vA-empty">无</div>') + '</div>' +
      '<h2>内部模块 <span>' + intl.length + '</span></h2>' +
      '<table class="vB-tbl"><thead><tr><th>模块</th><th>职责</th><th>数据流</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '</div>';
  }

  /* ============ 切换器 ============ */
  var VARIANTS = [
    { key: 'A', name: 'Flow · 数据流图' },
    { key: 'B', name: 'Index · 文档式' }
  ];
  function currentKey() { var m = location.search.match(/variant=([AB])/i); return m ? m[1].toUpperCase() : 'A'; }
  function render() {
    active = null;
    var k = currentKey();
    var root = document.getElementById('root');
    root.innerHTML = '';
    if (k === 'A') renderA(root); else renderB(root);
    var v = VARIANTS.filter(function (x) { return x.key === k; })[0];
    document.getElementById('swlabel').textContent = k + ' — ' + (v ? v.name : '');
  }
  function step(d) {
    var k = currentKey();
    var i = 0;
    VARIANTS.forEach(function (x, idx) { if (x.key === k) i = idx; });
    var n = VARIANTS[(i + d + VARIANTS.length) % VARIANTS.length].key;
    history.replaceState(null, '', '?variant=' + n);
    render();
  }
      document.getElementById('prev').addEventListener('click', function () { step(-1); });
      document.getElementById('next').addEventListener('click', function () { step(1); });
      document.addEventListener('keydown', function (e) {
        // Esc 关弹窗（ADR-0010）：原来只有「点 ×」和「点遮罩空白」，键盘用户被困在弹窗里。
        // 放在输入框判断之前——弹窗里没有输入框，而 Esc 在任何焦点下都该能退出。
        if (e.key === 'Escape' || e.key === 'Esc') {
          if (closeOverlay) closeOverlay();
          return;
        }
        var t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
        if (e.key === 'ArrowLeft') step(-1);
        if (e.key === 'ArrowRight') step(1);
      });
      render();
    })();
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      fitWidth: fitWidth, wrap2: wrap2,
      pick: pick, pickList: pickList, T: T, tr: tr, fmt: fmt,
      edgeLabel: edgeLabel, uniqJoin: uniqJoin, countPorts: countPorts,
      aggregateEdges: aggregateEdges,
      components: components, flowGeometry: flowGeometry, gridGeometry: gridGeometry,
      // 纯字符串渲染内核：盒体、边路径、端口清单（往上搬出 document 门，好让「画了什么」可断言）
      nodeSvg: nodeSvg, fwdPath: fwdPath, feedbackPath: feedbackPath,
      unitName: unitName, portRows: portRows, portListHtml: portListHtml,
      // 边的可点单元：命中路径 + 中点标签 + hover title 合成同一个带边身份的组（ADR-0010）
      fwdEdgeSvg: fwdEdgeSvg, backEdgeSvg: backEdgeSvg,
      // 四段说明：取值、按来源模块分组的行数据、行 HTML（照 portRows / portListHtml 的分家方式）
      pickPart: pickPart, fourPartRows: fourPartRows, fourPartHtml: fourPartHtml,
    };
  }
})();
