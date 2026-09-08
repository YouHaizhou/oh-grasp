// oh-grasp 客户端 viewer。由 render.js 内联进自包含 HTML，读取嵌入的 JSON IR。
(function () {
  'use strict';
  var ir = JSON.parse(document.getElementById('oh-grasp-ir').textContent);
  var M = {};
  ir.modules.forEach(function (m) { M[m.id] = m; });
  var G = {};
  (ir.groups || []).forEach(function (g) { G[g.id] = g; });

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function clip(s, n) { s = String(s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

  var CW = 220, CH = 78, GW = 260, GH = 96;

  function layeredLayout(nodeIds, edges) {
    var adj = {}, indeg = {};
    nodeIds.forEach(function (id) { adj[id] = []; indeg[id] = 0; });
    edges.forEach(function (e) { adj[e.from].push(e.to); indeg[e.to]++; });
    var layer = {};
    nodeIds.forEach(function (id) { layer[id] = 0; });
    var indeg2 = {};
    nodeIds.forEach(function (id) { indeg2[id] = indeg[id]; });
    var queue = nodeIds.filter(function (id) { return indeg[id] === 0; });
    var order = [], placed = {};
    while (queue.length) {
      var id = queue.shift();
      order.push(id); placed[id] = true;
      adj[id].forEach(function (n) {
        layer[n] = Math.max(layer[n], layer[id] + 1);
        indeg2[n]--;
        if (indeg2[n] === 0) queue.push(n);
      });
    }
    nodeIds.forEach(function (id) {
      if (placed[id]) return;
      var maxL = -1;
      nodeIds.forEach(function (n) { if (placed[n] && layer[n] > maxL) maxL = layer[n]; });
      layer[id] = maxL + 1;
      order.push(id); placed[id] = true;
    });
    var layers = {};
    order.forEach(function (id) { (layers[layer[id]] = layers[layer[id]] || []).push(id); });
    return { layers: layers, order: order };
  }

  function leafNodeSvg(id, x, y) {
    var m = M[id];
    var s = '';
    s += '<rect x="' + x + '" y="' + y + '" width="' + CW + '" height="' + CH + '" rx="10" fill="#ffffff" stroke="#cbd5e1" stroke-width="1"/>';
    s += '<circle cx="' + (x + CW - 16) + '" cy="' + (y + 16) + '" r="8" fill="#f1f5f9" stroke="#cbd5e1"/><text x="' + (x + CW - 16) + '" y="' + (y + 19) + '" font-size="10" text-anchor="middle" fill="#6366f1">i</text>';
    s += '<text x="' + (x + 14) + '" y="' + (y + 20) + '" font-size="9" fill="#9aa3b2" letter-spacing="1.5">INTERNAL</text>';
    s += '<text x="' + (x + 14) + '" y="' + (y + 40) + '" font-size="15" font-weight="600" fill="#1a202c" font-family="monospace">' + esc(m.label) + '</text>';
    s += '<text x="' + (x + 14) + '" y="' + (y + 60) + '" font-size="12" fill="#5b6472">' + esc(clip(m.description, 26)) + '</text>';
    return s;
  }

  function edgeSvg(x1, y1, x2, y2, label, markerId) {
    var my = (y1 + y2) / 2;
    var s = '<path d="M' + x1 + ' ' + y1 + ' C ' + x1 + ' ' + my + ' ' + x2 + ' ' + my + ' ' + x2 + ' ' + y2 + '" fill="none" stroke="#b6c2d1" stroke-width="1.5" marker-end="url(#' + markerId + ')"/>';
    if (label) s += '<text x="' + (x1 + 12) + '" y="' + (my - 6) + '" text-anchor="start" font-size="11" fill="#64748b">' + esc(label) + '</text>';
    return s;
  }

  function miniFlowSvg(members, edges) {
    var MPITCH = 120, MGAP = 24, MPAD = 24, MTOP = 16;
    var ids = members.map(function (m) { return m.id; });
    var ll = layeredLayout(ids, edges);
    var keys = Object.keys(ll.layers).map(Number).sort(function (a, b) { return a - b; });
    var layerW = {};
    keys.forEach(function (L) { layerW[L] = ll.layers[L].length * CW + (ll.layers[L].length - 1) * MGAP; });
    var W = (keys.length ? Math.max.apply(null, keys.map(function (L) { return layerW[L]; })) : 0) + 2 * MPAD;
    var pos = {};
    keys.forEach(function (L) {
      var x = (W - layerW[L]) / 2;
      ll.layers[L].forEach(function (id) { pos[id] = { x: x, y: MTOP + L * MPITCH }; x += CW + MGAP; });
    });
    var H = MTOP + (keys.length ? Math.max.apply(null, keys) : 0) * MPITCH + CH + 16;
    var svg = '<svg class="vA-mini" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '">';
    svg += '<defs><marker id="arrM" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#b6c2d1"/></marker></defs>';
    edges.forEach(function (e) {
      var a = pos[e.from], b = pos[e.to];
      if (!a || !b) return;
      svg += edgeSvg(a.x + CW / 2, a.y + CH, b.x + CW / 2, b.y, e.label, 'arrM');
    });
    keys.forEach(function (L) {
      ll.layers[L].forEach(function (id) {
        var p = pos[id];
        svg += '<g class="node sub" data-id="' + esc(id) + '">' + leafNodeSvg(id, p.x, p.y) + '</g>';
      });
    });
    svg += '</svg>';
    return svg;
  }

  // 缩放/平移状态（仅 A 变体）。document 级监听只绑定一次，操作当前 view。
  var view = null;
  document.addEventListener('mousemove', function (e) {
    if (!view || !view.dragging) return;
    var dx = e.clientX - view.sx, dy = e.clientY - view.sy;
    if (Math.abs(dx) + Math.abs(dy) > 3) view.moved = true;
    view.tx = view.ox + dx; view.ty = view.oy + dy; view.apply();
  });
  document.addEventListener('mouseup', function () {
    if (view && view.dragging) { view.dragging = false; view.vp.classList.remove('dragging'); }
  });

  /* ============ A · Flow ============ */
  function renderA(root) {
    var io = function (arr) { return (arr || []).map(function (t) { return '<span class="chip">' + esc(t) + '</span>'; }).join(''); };
    var ext = ir.modules.filter(function (m) { return m.type === 'external'; });
    var head =
      '<header class="vA-head">' +
      '<h1 class="vA-title">' + esc(ir.meta.title) + '</h1>' +
      '<p class="vA-sub">' + esc(ir.meta.subtitle) + '</p>' +
      '<div class="vA-io">' +
      '<div class="group"><span class="cap">输入</span>' + io(ir.meta.input) + '</div>' +
      '<div class="group"><span class="cap">输出</span>' + io(ir.meta.output) + '</div>' +
      '</div></header>';
    var extRail =
      '<aside class="vA-ext"><div class="vA-sec">依赖 Dependencies</div>' +
      ext.map(function (m) {
        return '<div class="vA-extcard"><div class="vA-extname">' + esc(m.label) + '</div>' +
          '<div class="vA-extdesc">' + esc(m.description) + '</div>' +
          '<div class="vA-extuse">↳ ' + esc((m.input || []).join(', ')) + '</div></div>';
      }).join('') + '</aside>';

    // 折叠拓扑：group 与未分组叶子当顶层节点，边界边聚合。
    function topOf(m) { return m.group || m.id; }
    var intMods = ir.modules.filter(function (m) { return m.type === 'internal'; });
    var grpCount = {};
    intMods.forEach(function (m) { if (m.group) grpCount[m.group] = (grpCount[m.group] || 0) + 1; });
    var topSeen = {}, topNodes = [];
    intMods.forEach(function (m) { var t = topOf(m); if (!topSeen[t]) { topSeen[t] = true; topNodes.push(t); } });
    var edgeMap = {};
    (ir.connections || []).forEach(function (c) {
      var fm = M[c.from], tm = M[c.to];
      if (!fm || !tm || fm.type !== 'internal' || tm.type !== 'internal') return;
      var f = topOf(fm), t = topOf(tm);
      if (f === t) return;
      var key = f + '|' + t;
      if (!edgeMap[key]) edgeMap[key] = { from: f, to: t, conns: [] };
      edgeMap[key].conns.push(c);
    });
    var topEdges = [];
    Object.keys(edgeMap).forEach(function (k) { topEdges.push(edgeMap[k]); });

    var ll = layeredLayout(topNodes, topEdges);
    var layers = ll.layers;
    function nodeSize(id) { return G[id] ? { w: GW, h: GH } : { w: CW, h: CH }; }

    var PITCH = 150, TOP = 24, GAP = 40, PAD = 40;
    var keys = Object.keys(layers).map(Number).sort(function (a, b) { return a - b; });
    var layerW = {};
    keys.forEach(function (L) {
      var ids = layers[L];
      var w = 0;
      ids.forEach(function (id, i) { w += nodeSize(id).w + (i ? GAP : 0); });
      layerW[L] = w;
    });
    var W = (keys.length ? Math.max.apply(null, keys.map(function (L) { return layerW[L]; })) : 0) + 2 * PAD;
    var pos = {};
    keys.forEach(function (L) {
      var ids = layers[L];
      var x = (W - layerW[L]) / 2;
      ids.forEach(function (id) { pos[id] = { x: x, y: TOP + L * PITCH }; x += nodeSize(id).w + GAP; });
    });
    var H = TOP + (keys.length ? Math.max.apply(null, keys) : 0) * PITCH + GH + 20;

    function bottomAnchor(id) { var p = pos[id]; return { x: p.x + nodeSize(id).w / 2, y: p.y + nodeSize(id).h }; }
    function topAnchor(id) { var p = pos[id]; return { x: p.x + nodeSize(id).w / 2, y: p.y }; }

    var svg = '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">';
    svg += '<defs><marker id="arrA" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#b6c2d1"/></marker></defs>';
    topEdges.forEach(function (e) {
      var a = bottomAnchor(e.from), b = topAnchor(e.to);
      var label = e.conns.length === 1 ? e.conns[0].label : e.conns.length + ' 条数据流';
      svg += edgeSvg(a.x, a.y, b.x, b.y, label, 'arrA');
    });
    keys.forEach(function (L) {
      layers[L].forEach(function (id) {
        var p = pos[id];
        if (G[id]) {
          var g = G[id];
          svg += '<g class="node grp" data-id="' + esc(id) + '" data-kind="group">';
          svg += '<rect x="' + p.x + '" y="' + p.y + '" width="' + GW + '" height="' + GH + '" rx="12" fill="#eef2ff" stroke="#c7d2fe" stroke-width="1"/>';
          svg += '<text x="' + (p.x + 14) + '" y="' + (p.y + 20) + '" font-size="9" fill="#6366f1" letter-spacing="1.5">GROUP · ' + grpCount[id] + ' 模块</text>';
          svg += '<text x="' + (p.x + 14) + '" y="' + (p.y + 42) + '" font-size="15" font-weight="600" fill="#1a202c">' + esc(g.label) + '</text>';
          svg += '<text x="' + (p.x + 14) + '" y="' + (p.y + 62) + '" font-size="12" fill="#5b6472">' + esc(clip(g.description, 24)) + '</text>';
          if (g.inputSummary) svg += '<text x="' + (p.x + 14) + '" y="' + (p.y + 82) + '" font-size="11" fill="#4338ca">← ' + esc(clip(g.inputSummary, 16)) + '</text>';
          if (g.outputSummary) svg += '<text x="' + (p.x + GW - 14) + '" y="' + (p.y + 82) + '" text-anchor="end" font-size="11" fill="#4338ca">' + esc(clip(g.outputSummary, 16)) + ' →</text>';
          svg += '<circle class="port" data-id="' + esc(id) + '" data-port="in" cx="' + (p.x + GW / 2) + '" cy="' + p.y + '" r="7" fill="#ffffff" stroke="#6366f1" stroke-width="1.5"/>';
          svg += '<circle class="port" data-id="' + esc(id) + '" data-port="out" cx="' + (p.x + GW / 2) + '" cy="' + (p.y + GH) + '" r="7" fill="#ffffff" stroke="#6366f1" stroke-width="1.5"/>';
          svg += '</g>';
        } else {
          svg += '<g class="node" data-id="' + esc(id) + '" data-kind="internal">' + leafNodeSvg(id, p.x, p.y) + '</g>';
        }
      });
    });
    svg += '</svg>';

    root.innerHTML = '<div class="vA">' + head + '<div class="vA-body">' + extRail + '<main class="vA-main">' +
      '<div class="vA-hint">点击模块/分组查看详情 · 滚轮缩放（光标为锚点）· 拖拽平移 · 双击复位</div>' +
      '<div class="vA-flow" id="flowViewport"><div class="vA-zoom" id="zoomTarget">' + svg + '</div><div class="vA-zoom-badge" id="zoomBadge">100%</div></div>' +
      '</main></div><div class="vA-overlay" id="detailOverlay"></div></div>';

    var detail = root.querySelector('#detailOverlay');
    function closeDetail() {
      detail.classList.remove('open');
      root.querySelectorAll('.node').forEach(function (g) { g.classList.remove('sel'); });
    }
    function openDetail(id) {
      var m = M[id];
      detail.innerHTML =
        '<div class="vA-modal">' +
        '<div class="vA-detail-head"><span class="vA-detail-name">' + esc(m.label) + '</span><span class="vA-detail-kind">internal</span><button class="vA-detail-close" id="detailClose">×</button></div>' +
        '<p class="vA-detail-desc">' + esc(m.detail || m.description) + '</p>' +
        (m.source ? '<h4>源码 Source' + (typeof m.sourceLine === 'number' ? ' · 第 ' + m.sourceLine + ' 行' : '') + '</h4><pre class="vA-src"><code>' + esc(m.source) + '</code></pre>' : '') +
        '</div>';
      detail.classList.add('open');
      root.querySelectorAll('.node').forEach(function (g) { g.classList.toggle('sel', g.dataset.id === id); });
      root.querySelector('#detailClose').addEventListener('click', closeDetail);
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
      var sub = miniFlowSvg(members, inner);
      var bedge = boundary.map(function (c) {
        var self = memberIds[c.from] ? M[c.from] : M[c.to];
        var other = memberIds[c.from] ? M[c.to] : M[c.from];
        var dir = memberIds[c.from] ? '→' : '←';
        return '<div class="vA-bedge">' + esc(self.label) + ' <span class="vA-bedge-arrow">' + dir + '</span> <span class="vA-bedge-lab">' + esc(c.label) + '</span> <span class="vA-bedge-arrow">' + dir + '</span> ' + esc(other.label) + '</div>';
      }).join('');
      detail.innerHTML = '<div class="vA-modal vA-modal-wide">' +
        '<div class="vA-detail-head"><span class="vA-detail-name">' + esc(g.label) + '</span><span class="vA-detail-kind">group · ' + members.length + ' 模块</span><button class="vA-detail-close" id="detailClose">×</button></div>' +
        '<p class="vA-detail-desc">' + esc(g.description) + '</p>' +
        '<h4>内部数据流</h4>' + sub +
        (boundary.length ? '<h4>边界数据流</h4><div class="vA-boundary">' + bedge + '</div>' : '') +
        '</div>';
      detail.classList.add('open');
      detail.querySelector('#detailClose').addEventListener('click', closeDetail);
      detail.querySelectorAll('.node.sub').forEach(function (n) {
        n.addEventListener('click', function () { openDetail(n.dataset.id); });
      });
    }
    function openPort(id, kind) {
      var conns = [];
      topEdges.forEach(function (e) {
        if ((kind === 'in' && e.to === id) || (kind === 'out' && e.from === id)) conns = conns.concat(e.conns);
      });
      var rows = conns.map(function (c) {
        return '<div class="vA-pp-row"><span class="vA-pp-mod">' + esc(M[c.from].label) + '</span><span class="vA-pp-arrow">→</span><span class="vA-pp-lab">' + esc(c.label) + '</span><span class="vA-pp-arrow">→</span><span class="vA-pp-mod">' + esc(M[c.to].label) + '</span></div>';
      }).join('');
      detail.innerHTML = '<div class="vA-modal vA-modal-sm">' +
        '<div class="vA-detail-head"><span class="vA-detail-name">' + (kind === 'in' ? '输入' : '输出') + '</span><span class="vA-detail-kind">' + esc(G[id].label) + '</span><button class="vA-detail-close" id="detailClose">×</button></div>' +
        (rows || '<div class="vA-empty">无</div>') + '</div>';
      detail.classList.add('open');
      detail.querySelector('#detailClose').addEventListener('click', closeDetail);
    }
    detail.addEventListener('click', function (e) { if (e.target === detail) closeDetail(); });
    root.querySelectorAll('.node').forEach(function (g) {
      g.addEventListener('click', function () {
        if (view && view.moved) { view.moved = false; return; }
        if (g.dataset.kind === 'group') openGroup(g.dataset.id);
        else openDetail(g.dataset.id);
      });
    });
    root.querySelectorAll('.port').forEach(function (c) {
      c.addEventListener('click', function (e) {
        e.stopPropagation();
        if (view && view.moved) { view.moved = false; return; }
        openPort(c.dataset.id, c.dataset.port);
      });
    });

    var vp = root.querySelector('#flowViewport'), zt = root.querySelector('#zoomTarget'), zb = root.querySelector('#zoomBadge');
    view = { vp: vp, scale: 1, tx: 0, ty: 0, moved: false, dragging: false, sx: 0, sy: 0, ox: 0, oy: 0 };
    view.apply = function () {
      zt.style.transform = 'translate(' + view.tx + 'px,' + view.ty + 'px) scale(' + view.scale + ')';
      zb.textContent = Math.round(view.scale * 100) + '%';
    };
    view.fit = function () {
      var vw = vp.clientWidth, vh = vp.clientHeight;
      var s = Math.min(1, vw / W, vh / H);
      view.scale = s;
      view.tx = (vw - W * s) / 2;
      view.ty = (vh - H * s) / 2;
      view.apply();
    };
    vp.addEventListener('wheel', function (e) {
      e.preventDefault();
      var r = vp.getBoundingClientRect();
      var mx = e.clientX - r.left, my = e.clientY - r.top;
      var ns = Math.min(3, Math.max(0.4, view.scale * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
      view.tx = mx - (mx - view.tx) * (ns / view.scale);
      view.ty = my - (my - view.ty) * (ns / view.scale);
      view.scale = ns;
      view.apply();
    }, { passive: false });
    vp.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      view.dragging = true; view.moved = false; vp.classList.add('dragging');
      view.sx = e.clientX; view.sy = e.clientY; view.ox = view.tx; view.oy = view.ty;
      e.preventDefault();
    });
    vp.addEventListener('dblclick', function () { view.fit(); });
    view.fit();
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
    view = null;
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
