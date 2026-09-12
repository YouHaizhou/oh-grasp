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
      innerFlow: '内部数据流', boundary: '组间边', members: '成员模块',
      membersExt: '成员直连外部', host: '宿主', dep: '依赖',
      none: '无', dash: '—', feedback: '反馈',
      groupTag: 'GROUP', internalTag: 'INTERNAL', externalTag: 'EXTERNAL',
      edge: '连线', fourParts: '四段说明',
      consumers: '消费者 Consumers', consumersNone: '无（没有模块在 uses 里声明用到它）',
      fp_source: '来源', fp_process: '处理', fp_output: '输出', fp_purpose: '用途',
    },
    en: {
      input: 'Input', output: 'Output',
      deps: 'Dependencies',
      hint: 'Click a module / group for details · scroll to zoom (cursor-anchored) · drag to pan · double-click to reset · dashed ↺ = feedback connection',
      source: 'Source', line: 'line {n}',
      groupMeta: 'group · {n} modules',
      innerFlow: 'Internal data flow', boundary: 'Inter-group edges', members: 'Member modules',
      membersExt: 'Members using external modules', host: 'Host', dep: 'Dependency',
      none: 'None', dash: '—', feedback: 'feedback',
      groupTag: 'GROUP', internalTag: 'INTERNAL', externalTag: 'EXTERNAL',
      edge: 'Connection', fourParts: 'Four-part description',
      consumers: 'Consumers', consumersNone: 'None (no module lists it in uses)',
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
     同一套表示同时给边中点标签（edgeLabel）、端口清单的对端（portListHtml）与侧栏依赖卡片的
     反向索引（consIndex）用：读者学一次规则能用三处（ADR-0011）。
     cap 是**截断预算**（列几项）：3 项以内一律全列——最窄的面也放得下，换成别的上限只会让
     同一个数字在两种面上读法不同；再多才按面宽截断——画布中点标签与端口清单格子窄，用缺省的
     2；侧栏卡片宽，反向索引传 3（ADR-0011 决策三：前 3 个 + `+M`，M = 总数 − 已列数）。 */
  function uniqJoin(items, cap) {
    var out = [];
    (items || []).forEach(function (t) {
      if (t && out.indexOf(t) === -1) out.push(t);
    });
    if (!out.length) return '';
    if (out.length <= 3) return out.join(' · ');
    var keep = cap === undefined ? 2 : cap;
    return out.slice(0, keep).join(' · ') + ' +' + (out.length - keep);
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

  // 一行清单的 HTML：`源 → 内容 → 目标`，箭头方向就是数据流方向。**三个清单共用**（端口清单、
  // 消费者清单、group 弹窗第二段「成员直连外部」）——ADR-0011 的「学一次行语法，用在多处」。
  // 三个参数都收**已转义**的字符串，转义在各自的调用点做（三边的取值路径不同，硬凑进来反而绕）。
  function rowHtml(src, lab, dst) {
    return '<div class="vA-pp-row"><span class="vA-pp-mod">' + src + '</span>' +
      '<span class="vA-pp-arrow">→</span><span class="vA-pp-lab">' + lab + '</span>' +
      '<span class="vA-pp-arrow">→</span><span class="vA-pp-mod">' + dst + '</span></div>';
  }

  // 端口清单的行：`源 → 内容 → 目标`（入端口时对端在左，所以 src/dst 按方向对调）。
  function portListHtml(id, dir, edges, lang, M, G) {
    return portRows(id, dir, edges).map(function (row) {
      var peers = esc(uniqJoin(row.peers.map(function (p) { return unitName(p, lang, M, G); })));
      var self = esc(unitName(id, lang, M, G));
      return dir === 'in'
        ? rowHtml(peers, esc(pick(row.rep, lang)), self)
        : rowHtml(self, esc(pick(row.rep, lang)), peers);
    }).join('');
  }

  /* ---------- 消费者清单 / 反向索引（点依赖卡片弹出）----------
     回答「谁用了这个 external，改了它会炸谁」（ADR-0010 第四个入口 / ADR-0011 决策三）。
     数据源是 internal 模块上的 **`uses` 字段**——票 06 起不再用「具名导入符号匹配」的代理估算：
     那把尺子对 default 导入（node:fs / node:os / node:path …）完全失明，恒 0 行，
     而返回 0 的那几个恰恰是最常用的（round20 开头的更正）。
     `uses` 是消费关系，不是数据流边：外部依赖仍不进 connections（ADR-0011 决策一）。 */
  // 按 id 找模块（找不到回 null——validate 会挡住悬空引用，viewer 这边只保证不抛）。
  function modById(id, modules) {
    var found = null;
    (modules || []).forEach(function (m) { if (m && m.id === id) found = m; });
    return found;
  }

  // 内部模块上的 `uses` 数组：缺席 / 形状坏了都当没有（validate 会挡，viewer 只保证不抛）。
  function usesOf(m) {
    return m && Array.isArray(m.uses) ? m.uses : [];
  }

  /* 消费者清单的行数据。行 = **一个直接声明用到该 external 的 internal 模块**，保 IR 顺序。
     返回 [{ id, label }]。空数组现在只有一个含义：「没有模块声明用到它」——代理时代那种
     「有具名成员但没人命中」与「default 导入看不见」的二分随数据源一起消失。 */
  function consRows(id, modules) {
    return (modules || []).filter(function (m) {
      return m && m.type === 'internal' && usesOf(m).indexOf(id) !== -1;
    }).map(function (m) { return { id: m.id, label: m.label }; });
  }

  // 两个清单的**中间格**都是「该 external 的 `input` 折成一段」（与 group 段同一套读法）；
  // `input` 为空时画「—」——中间格空着会读成一个坏掉的行（同一行的两个名字之间什么都没有），
  // 而「—」说的是「这个 external 没记录到具名成员」（ADR-0006 的空段惯例）。
  function extInputCell(ext, lang) {
    return esc(uniqJoin((ext && ext.input) || []) || tr(lang, 'dash'));
  }

  /* 侧栏依赖卡片的**反向索引**：哪些模块用了它（ADR-0011 决策三）。列的是模块名（源码标识符，
     不译），超过 3 个折成 `前 3 + +M`——侧栏卡片比画布上的标签格宽，所以这里传 cap = 3；共用
     的仍是 `·` 连接与 `+M` 余数记法。 */
  function consIndex(id, modules) {
    return uniqJoin(consRows(id, modules).map(function (r) { return r.label; }), 3);
  }

  // 消费者清单的行：`消费者 → 该 external 的 input → 这个 external`——同一个 `rowHtml`（ADR-0011）。
  // 中间格换成 external 自己的 `input`（与下面「成员直连外部」同一套读法）：行里不再有「命中的
  // 符号」这回事，消费者与依赖的关系就是 `uses` 字段本身。
  // 三样东西（模块名 / 包名 / 具名成员）都不译，所以行文本身与语言无关；`lang` 只有一个去处：
  // `input` 为空时中间格那个「—」要跟着语言（空态占位是 UI 文案，不属于 IR）。
  // 行**不可点**：「清单行可点 + 一层返回」是票 05 的第二片。
  function consListHtml(id, lang, modules, M) {
    var rows = consRows(id, modules);
    if (!rows.length) return '';
    var midCell = extInputCell(modById(id, modules), lang);
    var target = esc(modName(id, M));
    return rows.map(function (r) {
      return rowHtml(esc(r.label), midCell, target);
    }).join('');
  }

  /* ---------- 成员直连外部（group 弹窗第二段）----------
     ADR-0011 决策三：group 弹窗分两段。第一段是组间边（connections 推导，ADR-0006），第二段是
     成员**自己的** `uses` 按 external 归并——两个事实源不互相冒充：成员吃外部依赖这件事在
     connections 里本来就没有（外部依赖不进数据流边），不说出来就等于图在撒谎。 */
  /* 行数据：行 = 一个 external，members = 本组里声明用到它的成员（保 IR 顺序）。
     行序按 external id 排序（而不是成员遍历顺序）：读者在弹窗里是按包名找行的。
     返回 [{ id, members }]。 */
  function extUseRows(memberIds, modules) {
    // 键是 external id（用户数据），普通 {} 会被 "constructor" 这类 id 命中内置属性，故用无原型对象。
    // 成员表用 hasOwnProperty 判「在不在表里」而不是取真值：`memberIds['toString']` 会被原型链命成
    // 真值，一个恰好叫 toString 的模块就会被算进每一组的成员里；只认自有键则与值的形状无关。
    var byId = Object.create(null), out = [];
    (modules || []).forEach(function (m) {
      if (!m || m.type !== 'internal') return;
      if (!memberIds || !Object.prototype.hasOwnProperty.call(memberIds, m.id)) return;
      usesOf(m).forEach(function (x) {
        var row = byId[x];
        if (!row) { row = byId[x] = { id: x, members: [] }; out.push(row); }
        if (row.members.indexOf(m.id) === -1) row.members.push(m.id);
      });
    });
    return out.sort(function (a, b) { return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0); });
  }

  // 行 HTML：`成员们 → 该 external 的 input → external 名`——与端口清单、消费者清单共用 rowHtml
  // （ADR-0011：学一次行语法，用在多处）。成员名是源码标识符、包名不译；一行里成员多时用缺省的 2
  // 折叠（弹窗面窄）。一条 uses 都没有时返回空串，由调用方画「—」（ADR-0006 的空段惯例）。
  function extUseHtml(memberIds, modules, M, lang) {
    return extUseRows(memberIds, modules).map(function (row) {
      var ext = modById(row.id, modules);
      var names = row.members.map(function (id) { return modName(id, M); });
      return rowHtml(esc(uniqJoin(names)), extInputCell(ext, lang), esc(ext ? ext.label : row.id));
    }).join('');
  }

  /* ---------- 叶子弹窗的依赖行（ADR-0011 决策三）----------
     `依赖 <包名 · …> · 宿主 <属性路径 · …>`——两半都是**模块自己的**字段（`uses` / `runtime`），
     照 ADR-0006 的空端口惯例：为空的那一半显式画「—」，静默留白会被读成「这一行本来就不该有」。
     依赖那一半列 external 的 label（包名，绝不译）；查不到的 id 退回 id 本身（validate 会挡悬空）。
     两个标头各用一个键（`dep` / `host`）而**不复用侧栏的 `deps`**：那个键的值是双语的分节标题
     「依赖 Dependencies」，当行内标头用会读成「依赖 Dependencies fs · …」，而 ADR-0011 决策三写的
     是「依赖 … · 宿主 …」（分节标题与行内标头在 IR 外面是两种写法）。 */
  function depsHtml(m, lang, M) {
    var mi = M || {};
    var names = usesOf(m).map(function (id) { return modName(id, mi); });
    // runtime 没有对应的助手：它只有这一处读，多抽一层反而绕（与 usesOf 的三处调用不同）。
    var rt = (m && Array.isArray(m.runtime) ? m.runtime : []);
    return '<div class="vA-depsrow">' +
      '<span class="vA-deps-cap">' + esc(tr(lang, 'dep')) + '</span>' +
      '<span class="vA-deps-val">' + esc(uniqJoin(names) || tr(lang, 'dash')) + '</span>' +
      '<span class="vA-deps-sep">·</span>' +
      '<span class="vA-deps-cap">' + esc(tr(lang, 'host')) + '</span>' +
      '<span class="vA-deps-val">' + esc(uniqJoin(rt) || tr(lang, 'dash')) + '</span>' +
      '</div>';
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
    // 依赖卡片 = 第四个入口（ADR-0010）：点开该 external 的消费者清单。
    // 用 <button type="button"> 与 .vA-mcard 同一个理由——可点就该是可聚焦的真按钮（Esc 那条
    // 故事同理：键盘用户不该被困住）；子元素因此用 <span>（button 的内容模型是短语，不是流）。
    var extRail =
      '<aside class="vA-ext"><div class="vA-sec">' + esc(tr(lang, 'deps')) + '</div>' +
      ext.map(function (m) {
        // 卡片两个方向各一行：`↳` 它提供哪些具名成员，`←` **谁在用它**（反向索引，ADR-0011 决策三）。
        // 没有消费者时显式画「—」而不是省略这一行——ADR-0006 的空段惯例：省掉的那一行读不出
        // 「没人用它」还是「没做这个功能」。
        var idx = consIndex(m.id, ir.modules);
        return '<button type="button" class="vA-extcard" data-id="' + esc(m.id) + '">' +
          '<span class="vA-extname">' + esc(m.label) + '</span>' +
          '<span class="vA-extdesc">' + esc(pick(m.description, lang)) + '</span>' +
          '<span class="vA-extuse">↳ ' + esc((m.input || []).join(', ')) + '</span>' +
          '<span class="vA-extidx">← ' + esc(idx || tr(lang, 'dash')) + '</span></button>';
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

    /* ---------- 一个弹窗：内容只有一个容器（ADR-0010） ----------
       四个入口（点节点 / 点端口 / 点边 / 点依赖卡片）各自产出一份**入口描述**
       { name, kind, html, cls, mount }，剩下的事只有一件：openModal 把外壳画出来——
       标题、kind 标签、× 按钮、`.open`，以及**唯一**的一处 `#detailClose` 绑定。
       入口因此退成一行 `openModal(xxxSpec(...))`。
       - name / kind 收进来的是**未转义原文**，转义在 openModal 里做一次（原来五个地方各 esc 一遍）；
       - cls 是弹窗宽度档（'' / vA-modal-wide / vA-modal-sm）；
       - mount 是「塞进去之后才做得了的事」（子图的缩放控制器、节点选中态、网格卡片的点击），
         没有它这一步的描述就留空。
       弹窗**不**记返回栈：「清单行可点 + 一层返回」是票 05 的第二片（本片刻意不做）。 */
    function openModal(spec) {
      detail.innerHTML = '<div class="vA-modal' + (spec.cls ? ' ' + spec.cls : '') + '">' +
        '<div class="vA-detail-head"><span class="vA-detail-name">' + esc(spec.name) + '</span>' +
        '<span class="vA-detail-kind">' + esc(spec.kind) + '</span>' +
        '<button class="vA-detail-close" id="detailClose">×</button></div>' + spec.html + '</div>';
      detail.classList.add('open');
      detail.querySelector('#detailClose').addEventListener('click', closeDetail);
      if (spec.mount) spec.mount();
    }

    // 内容①：叶子 / 模块详情。kind 取模块**自己的**类型，切语言跟着走。
    // 但 external 那一支今天是**防御性**的：openDetail 的三个调用点（节点点击、组成员网格、
    // 子图节点点击）拿到的 id 全部来自只收 internal 的节点集，所以这里收不到 external id。
    // 留着是因为「按 m.type 取"本来就是对的"——别再退回写死字面量。
    function detailSpec(id) {
      var m = M[id];
      return {
        name: m.label,
        kind: tr(lang, m.type === 'external' ? 'externalTag' : 'internalTag'),
        cls: '',
        html: '<p class="vA-detail-desc">' + esc(pick(m.detail || m.description, lang)) + '</p>' +
          // 依赖行只给 internal（ADR-0011 决策三）：`uses` / `runtime` 是 internal 模块的字段，
          // 给 external 画一行「依赖 — · 宿主 —」是把「它没有这两个字段」说成「它什么都没有」。
          (m.type === 'internal' ? depsHtml(m, lang, M) : '') +
          (m.source ? '<h4>' + esc(tr(lang, 'source')) + (typeof m.sourceLine === 'number' ? ' · ' + esc(fmt(tr(lang, 'line'), m.sourceLine)) : '') + '</h4><pre class="vA-src"><code>' + esc(m.source) + '</code></pre>' : ''),
        mount: function () {
          root.querySelectorAll('.node').forEach(function (g) { g.classList.toggle('sel', g.dataset.id === id); });
        }
      };
    }

    // 内容②③：group 两支——有内边 → 子图 flow；无边 → 成员卡片网格（都带边界两段）。
    function groupSpec(id) {
      var g = G[id];
      var members = ir.modules.filter(function (m) { return m.type === 'internal' && m.group === id; });
      var memberIds = {};
      members.forEach(function (m) { memberIds[m.id] = true; });
      var inner = (ir.connections || []).filter(function (c) { return memberIds[c.from] && memberIds[c.to]; });
      var boundary = (ir.connections || []).filter(function (c) {
        return (memberIds[c.from] && !memberIds[c.to]) || (!memberIds[c.from] && memberIds[c.to]);
      });
      var spec = {
        name: pick(g.label, lang),
        kind: fmt(tr(lang, 'groupMeta'), members.length),
        cls: 'vA-modal-wide',
        html: '<p class="vA-detail-desc">' + esc(pick(g.description, lang)) + '</p>'
      };

      if (inner.length) {
        var innerEdges = aggregateEdges(inner);
        var ids = members.map(function (m) { return m.id; });
        var sub = flowSvg(ids, innerEdges, null, lang);
        spec.html += '<h4>' + esc(tr(lang, 'innerFlow')) + '</h4>' +
          '<div class="vA-flow vA-flow-sub" id="subViewport"><div class="vA-zoom" id="subZoom">' + sub.svg + '</div></div>';
        spec.html += groupSections(boundary, memberIds);
        spec.mount = function () {
          var sCtl = attachFlow(detail.querySelector('#subViewport'), detail.querySelector('#subZoom'), sub.W, sub.H, null);
          detail.querySelectorAll('.node').forEach(function (n) {
            n.addEventListener('click', function () {
              if (sCtl.moved) { sCtl.moved = false; return; }
              openDetail(n.dataset.id);
            });
          });
          // 子图里的边同样可点（子图的边不折叠，每条 conns 长度 1）。
          bindEdges(detail, innerEdges, sCtl);
        };
        return spec;
      }

      var cards = members.map(function (m) {
        return '<button class="vA-mcard" data-id="' + esc(m.id) + '" type="button"><span class="vA-mcard-name">' + esc(m.label) + '</span><span class="vA-mcard-desc">' + esc(pick(m.description, lang)) + '</span></button>';
      }).join('');
      spec.html += '<h4>' + esc(tr(lang, 'members')) + '</h4><div class="vA-mgrid">' + cards + '</div>' +
        groupSections(boundary, memberIds);
      spec.mount = function () {
        detail.querySelectorAll('.vA-mcard').forEach(function (card) {
          card.addEventListener('click', function () { openDetail(card.dataset.id); });
        });
      };
      return spec;
    }

    // 内容④：端口清单（行数 === 盒上那个 `×N`，见内核 portRows / portListHtml）。
    function portSpec(id, kind) {
      var rows = portListHtml(id, kind, topEdges, lang, M, G);
      return {
        name: kind === 'in' ? tr(lang, 'input') : tr(lang, 'output'),
        kind: nameOf(id),
        cls: 'vA-modal-sm',
        html: rows || '<div class="vA-empty">' + esc(tr(lang, 'none')) + '</div>'
      };
    }

    // 内容⑤：点边 → 四段说明。聚合边（conns 多条）列出其下**每条** connection 的四段，
    // 按来源模块分组——组内那些原子 connection 在画布上没有可见的线，这里是它们唯一的
    // 到达路径（ADR-0008）。
    function edgeSpec(e) {
      return {
        name: nameOf(e.from) + ' → ' + nameOf(e.to),
        kind: tr(lang, 'edge'),
        cls: 'vA-modal-wide',
        html: '<h4>' + esc(tr(lang, 'fourParts')) + '</h4>' + fourPartHtml(e, lang, M)
      };
    }

    // 内容⑥：外部依赖的消费者清单（点侧栏依赖卡片）——第四个入口，story 34 / ADR-0011。
    // 「谁用了这个 external」。行数据与行 HTML 都在内核（consRows / consListHtml），这里
    // 只把这份 HTML 塞进弹窗。空清单只剩一种含义：**没有模块在 `uses` 里声明用到它**——
    // 代理时代那句「无具名导入可匹配（default 导入）」随数据源一起删除，default 导入不再失明。
    // 空态仍明说依据（consumersNone）：一句光秃秃的「无」读不出「查过了，就是没有」。
    function consSpec(id) {
      var m = M[id];
      var rows = consListHtml(id, lang, ir.modules, M);
      return {
        name: m.label,                                    // 包名不译（story 7）
        kind: tr(lang, 'externalTag'),
        cls: 'vA-modal-sm',
        html: '<h4>' + esc(tr(lang, 'consumers')) + '</h4>' +
          (rows || '<div class="vA-empty">' + esc(tr(lang, 'consumersNone')) + '</div>')
      };
    }

    // 四个入口各一行。
    function openEdge(e) { if (e) openModal(edgeSpec(e)); }
    function openDetail(id) { openModal(detailSpec(id)); }
    function openGroup(id) { openModal(groupSpec(id)); }
    function openPort(id, kind) { openModal(portSpec(id, kind)); }
    function openConsumers(id) { openModal(consSpec(id)); }
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
    // 第二段：成员直连外部（ADR-0011 决策三）。成员在吃外部依赖这件事 connections 里没有
    // （外部依赖不进数据流边），所以它得单独说；行的形状与消费者清单同一个 rowHtml。
    function extUseBlock(memberIds) {
      var rows = extUseHtml(memberIds, ir.modules, M, lang);
      var head = '<h4>' + esc(tr(lang, 'membersExt')) + '</h4>';
      if (rows) return head + '<div class="vA-boundary">' + rows + '</div>';
      // 一条 uses 都没有时画「—」而不是留白（ADR-0006）：留白读不出「成员没有外部依赖」
      // 还是「这一段没做」。
      return head + '<div class="vA-empty">' + esc(tr(lang, 'dash')) + '</div>';
    }
    // group 弹窗的两段一次给全：两个事实源（组间边 / 成员直连外部）不互相冒充。
    function groupSections(boundary, memberIds) {
      return boundaryBlock(boundary, memberIds) + extUseBlock(memberIds);
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
    // 第四个入口：侧栏依赖卡片 → 该 external 的消费者清单。这张卡片此前**没有任何点击绑定**，
    // 不只是「跳错了地方」。卡片不在画布里，没有拖拽阈值这回事，直接绑。
    root.querySelectorAll('.vA-extcard').forEach(function (c) {
      c.addEventListener('click', function () { openConsumers(c.dataset.id); });
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
      // 消费者清单（点依赖卡片）：行数据 + 行 HTML + 反向索引字符串；数据源是 `module.uses`
      // （票 06 起不再是对导入符号做代理估算）——ADR-0011 决策一/三
      consRows: consRows, consListHtml: consListHtml, consIndex: consIndex,
      // 外部依赖的两个新显示面：group 弹窗第二段「成员直连外部」的行数据/行 HTML、
      // 叶子弹窗的依赖行（ADR-0011 决策三）
      extUseRows: extUseRows, extUseHtml: extUseHtml, depsHtml: depsHtml,
      // 边的可点单元：命中路径 + 中点标签 + hover title 合成同一个带边身份的组（ADR-0010）
      fwdEdgeSvg: fwdEdgeSvg, backEdgeSvg: backEdgeSvg,
      // 四段说明：取值、按来源模块分组的行数据、行 HTML（照 portRows / portListHtml 的分家方式）
      pickPart: pickPart, fourPartRows: fourPartRows, fourPartHtml: fourPartHtml,
    };
  }
})();
