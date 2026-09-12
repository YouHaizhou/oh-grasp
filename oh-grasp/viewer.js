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

  /* ---------- 端口计数（折叠 group 的 ×N） ---------- */
  function countPorts(edges) {
    var c = {};
    edges.forEach(function (e) {
      (e.conns || []).forEach(function () {
        c[e.from] = c[e.from] || { in: 0, out: 0 };
        c[e.to] = c[e.to] || { in: 0, out: 0 };
        c[e.from].out++;
        c[e.to].in++;
      });
    });
    return c;
  }

  /* ---------- 边 label 聚合（label 是可译散文，按语言取值后去重） ---------- */
  function edgeLabel(e, lang) {
    var seen = [];
    (e.conns || []).forEach(function (cn) {
      var l = cn ? pick(cn.label, lang) : '';
      if (l && seen.indexOf(l) === -1) seen.push(l);
    });
    if (!seen.length) return '';
    if (seen.length <= 3) return seen.join(' · ');
    return seen.slice(0, 2).join(' · ') + ' +' + (seen.length - 2);
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
  // 切语言 = 换一个取值子树，立刻重渲染；非法语言忽略。
  function setLang(lang) {
    if (LANGS.indexOf(lang) === -1 || state.lang === lang) return;
    state.lang = lang;
    render();
  }

  /* ---------- 节点盒 ---------- */
  // counts: { id: {in,out} }，仅 group 用（×N 端口标）。lang: 'zh' | 'en'。
  function nodeSvg(id, x, y, counts, lang) {
    var isGrp = !!G[id], m = M[id], g = G[id];
    var w = isGrp ? GW : CW, h = isGrp ? GH : CH;
    // group.label 是模型起的抽象名（可译）；模块 label 是源码标识符 / 包名（绝不译）。
    var name = isGrp ? pick(g.label, lang) : m.label;
    var desc = pick(isGrp ? g.description : m.description, lang);
    var nameFs = 14, descFs = 12;
    var maxW = w - 34;
    var s = '';
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
      var cnt = counts && counts[id] ? counts[id] : { in: 0, out: 0 };
      var cxi = x + w / 2;
      // ADR-0006: 空方向不画空端口 —— 端口只在对应方向真有边时出现（旁标 ×N）。
      if (cnt.in) {
        s += '<circle class="port" data-id="' + esc(id) + '" data-port="in" cx="' + cxi + '" cy="' + y + '" r="6" fill="#ffffff" stroke="#6366f1" stroke-width="1.5"/>';
        s += '<text x="' + (cxi + 9) + '" y="' + (y + 7) + '" font-size="10" fill="#4338ca">×' + cnt.in + '</text>';
      }
      if (cnt.out) {
        s += '<circle class="port" data-id="' + esc(id) + '" data-port="out" cx="' + cxi + '" cy="' + (y + h) + '" r="6" fill="#ffffff" stroke="#6366f1" stroke-width="1.5"/>';
        s += '<text x="' + (cxi + 9) + '" y="' + (y + h - 6) + '" font-size="10" fill="#4338ca">×' + cnt.out + '</text>';
      }
    }
    return s;
  }

  var markerSeq = 0;
  function markerDef(color) {
    var id = 'mk' + (++markerSeq);
    return { id: id, xml: '<marker id="' + id + '" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="' + color + '"/></marker>' };
  }

  /* ---------- 边（前向 + 反馈）路径 ---------- */
  function fwdPath(a, b, sA, sB) {
    var x1 = a.x + sA.w / 2, y1 = a.y + sA.h;
    var x2 = b.x + sB.w / 2, y2 = b.y;
    var my = (y1 + y2) / 2;
    return { d: 'M' + x1 + ' ' + y1 + ' C ' + x1 + ' ' + my + ' ' + x2 + ' ' + my + ' ' + x2 + ' ' + y2, xm: (x1 + x2) / 2, my: my };
  }
  function feedbackPath(a, b, sA, sB, gx) {
    var x1 = a.x + sA.w / 2, y1 = a.y + sA.h;      // 源底（出）
    var x2 = b.x + sB.w / 2, y2 = b.y;             // 目标顶（入）
    var d = 'M' + x1 + ' ' + y1 +
      ' C ' + x1 + ' ' + (y1 + 18) + ' ' + gx + ' ' + (y1 + 18) + ' ' + gx + ' ' + (y1 + 6) +
      ' L ' + gx + ' ' + (y2 - 14) +
      ' C ' + gx + ' ' + (y2 - 6) + ' ' + (x1 + (gx - x1) * 0.4) + ' ' + (y2 - 6) + ' ' + x2 + ' ' + y2;
    return { d: d, mid: (y1 + y2) / 2 };
  }

  function haloText(txt, x, y, anchor) {
    return '<text x="' + x + '" y="' + y + '" text-anchor="' + (anchor || 'middle') + '" font-size="11" fill="#475569" stroke="#ffffff" stroke-width="4" stroke-linejoin="round" paint-order="stroke">' + esc(txt) + '</text>';
  }

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
        var lbl = edgeLabel(e, lang);
        if (!lbl) lbl = tr(lang, 'feedback');
        part += '<path d="' + pa.d + '" fill="none" stroke="#f59e0b" stroke-width="1.5" stroke-dasharray="5 3" marker-end="url(#' + mB.id + ')"/>';
        part += '<text x="' + (g.Wc + g.lane - 10) + '" y="' + pa.mid + '" text-anchor="end" font-size="10" fill="#b45309">↺ ' + esc(fitWidth(lbl, 10, g.lane - 26)) + '</text>';
      });
      // 前向边 path + label
      g.fwd.forEach(function (e) {
        var a = g.pos[e.from], b = g.pos[e.to];
        if (!a || !b) return;
        var p = fwdPath(a, b, g.sizes[e.from], g.sizes[e.to]);
        part += '<path d="' + p.d + '" fill="none" stroke="#b6c2d1" stroke-width="1.5" marker-end="url(#' + mF.id + ')"/>';
        var lbl = edgeLabel(e, lang);
        if (lbl) part += haloText(fitWidth(lbl, 11, 240), p.xm, p.my - 4, 'middle');
      });
      // 节点（盖住边端点与箭头根部）
      g.layers.forEach(function (row) {
        row.forEach(function (id) {
          var p = g.pos[id];
          var kind = G[id] ? 'group' : 'internal';
          part += '<g class="node" data-id="' + esc(id) + '" data-kind="' + kind + '">' + nodeSvg(id, p.x, p.y, counts, lang) + '</g>';
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
          gpart += '<g class="node" data-id="' + esc(id) + '" data-kind="' + kind + '">' + nodeSvg(id, p.x, p.y, counts, lang) + '</g>';
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
    // 顶层单元的显示名：group 抽象名可译，模块名不译。
    function unitName(id) { return G[id] ? pick(G[id].label, lang) : M[id].label; }
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
        return '<div class="vA-bedge"><span class="vA-pp-mod">' + esc(unitName(self.id)) + '</span> <span class="vA-bedge-arrow">' + dir + '</span> <span class="vA-bedge-lab">' + esc(pick(c.label, lang)) + '</span> <span class="vA-bedge-arrow">' + dir + '</span> <span class="vA-pp-mod">' + esc(unitName(other.id)) + '</span></div>';
      }).join('');
    }
    function boundaryBlock(boundary, memberIds) {
      if (boundary.length) return '<h4>' + esc(tr(lang, 'boundary')) + '</h4><div class="vA-boundary">' + bedgeHtml(boundary, memberIds) + '</div>';
      // ADR-0006：无组间边时，输入/输出显示「—」而不是留空区/空端口。
      return '<h4>' + esc(tr(lang, 'boundary')) + '</h4><div class="vA-empty">' + esc(tr(lang, 'input')) + ' ' + esc(tr(lang, 'dash')) + ' · ' + esc(tr(lang, 'output')) + ' ' + esc(tr(lang, 'dash')) + '</div>';
    }
    function openPort(id, kind) {
      var conns = [];
      topEdges.forEach(function (e) {
        if ((kind === 'in' && e.to === id) || (kind === 'out' && e.from === id)) conns = conns.concat(e.conns);
      });
      var rows = conns.map(function (c) {
        return '<div class="vA-pp-row"><span class="vA-pp-mod">' + esc(unitName(c.from)) + '</span><span class="vA-pp-arrow">→</span><span class="vA-pp-lab">' + esc(pick(c.label, lang)) + '</span><span class="vA-pp-arrow">→</span><span class="vA-pp-mod">' + esc(unitName(c.to)) + '</span></div>';
      }).join('');
      detail.innerHTML = '<div class="vA-modal vA-modal-sm">' +
        '<div class="vA-detail-head"><span class="vA-detail-name">' + esc(kind === 'in' ? tr(lang, 'input') : tr(lang, 'output')) + '</span><span class="vA-detail-kind">' + esc(unitName(id)) + '</span><button class="vA-detail-close" id="detailClose">×</button></div>' +
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
      edgeLabel: edgeLabel, countPorts: countPorts,
      aggregateEdges: aggregateEdges,
      components: components, flowGeometry: flowGeometry, gridGeometry: gridGeometry,
    };
  }
})();
