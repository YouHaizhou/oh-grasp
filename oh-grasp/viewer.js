// oh-grasp 客户端 viewer。由 render.js 内联进自包含 HTML，读取嵌入的 JSON IR。
(function () {
  'use strict';
  var ir = JSON.parse(document.getElementById('oh-grasp-ir').textContent);
  var M = {};
  ir.modules.forEach(function (m) { M[m.id] = m; });

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function clip(s, n) { s = String(s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

  function flowLayout() {
    var intMods = ir.modules.filter(function (m) { return m.type === 'internal'; });
    var byId = {};
    ir.modules.forEach(function (m) { byId[m.id] = m; });
    var edges = (ir.connections || []).filter(function (c) {
      return byId[c.from] && byId[c.from].type === 'internal' && byId[c.to] && byId[c.to].type === 'internal';
    });
    var adj = {}, indeg = {};
    intMods.forEach(function (m) { adj[m.id] = []; indeg[m.id] = 0; });
    edges.forEach(function (e) { adj[e.from].push(e.to); indeg[e.to]++; });
    var layer = {};
    intMods.forEach(function (m) { layer[m.id] = 0; });
    var indeg2 = {};
    Object.keys(indeg).forEach(function (k) { indeg2[k] = indeg[k]; });
    var queue = intMods.filter(function (m) { return indeg[m.id] === 0; }).map(function (m) { return m.id; });
    var order = [];
    while (queue.length) {
      var id = queue.shift();
      order.push(id);
      adj[id].forEach(function (n) {
        layer[n] = Math.max(layer[n], layer[id] + 1);
        indeg2[n]--;
        if (indeg2[n] === 0) queue.push(n);
      });
    }
    var groups = {};
    order.forEach(function (id) { (groups[layer[id]] = groups[layer[id]] || []).push(id); });
    return { groups: groups, edges: edges };
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

    var fl = flowLayout();
    var groups = fl.groups, edges = fl.edges;
    var CW = 220, CH = 78, PITCH = 150, TOP = 20, W = 720;
    var keys = Object.keys(groups).map(Number).sort(function (a, b) { return a - b; });
    var pos = {};
    keys.forEach(function (L) {
      var ids = groups[L];
      var total = ids.length * CW + (ids.length - 1) * 40;
      var x = (W - total) / 2;
      ids.forEach(function (id) { pos[id] = { x: x, y: TOP + L * PITCH }; x += CW + 40; });
    });
    var H = TOP + (keys.length ? Math.max.apply(null, keys) : 0) * PITCH + CH + 20;
    var svg = '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">';
    svg += '<defs><marker id="arrA" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#b6c2d1"/></marker></defs>';
    edges.forEach(function (e) {
      var a = pos[e.from], b = pos[e.to];
      if (!a || !b) return;
      var x1 = a.x + CW / 2, y1 = a.y + CH, x2 = b.x + CW / 2, y2 = b.y;
      var my = (y1 + y2) / 2;
      svg += '<path d="M' + x1 + ' ' + y1 + ' C ' + x1 + ' ' + my + ' ' + x2 + ' ' + my + ' ' + x2 + ' ' + y2 + '" fill="none" stroke="#b6c2d1" stroke-width="1.5" marker-end="url(#arrA)"/>';
      svg += '<text x="' + (x1 + 12) + '" y="' + (my - 6) + '" text-anchor="start" font-size="11" fill="#64748b">' + esc(e.label) + '</text>';
    });
    keys.forEach(function (L) {
      groups[L].forEach(function (id) {
        var p = pos[id], m = M[id];
        svg += '<g class="node" data-id="' + esc(id) + '">';
        svg += '<rect x="' + p.x + '" y="' + p.y + '" width="' + CW + '" height="' + CH + '" rx="10" fill="#ffffff" stroke="#cbd5e1" stroke-width="1"/>';
        svg += '<circle cx="' + (p.x + CW - 16) + '" cy="' + (p.y + 16) + '" r="8" fill="#f1f5f9" stroke="#cbd5e1"/><text x="' + (p.x + CW - 16) + '" y="' + (p.y + 19) + '" font-size="10" text-anchor="middle" fill="#6366f1">i</text>';
        svg += '<text x="' + (p.x + 14) + '" y="' + (p.y + 20) + '" font-size="9" fill="#9aa3b2" letter-spacing="1.5">INTERNAL</text>';
        svg += '<text x="' + (p.x + 14) + '" y="' + (p.y + 40) + '" font-size="15" font-weight="600" fill="#1a202c" font-family="monospace">' + esc(m.label) + '</text>';
        svg += '<text x="' + (p.x + 14) + '" y="' + (p.y + 60) + '" font-size="12" fill="#5b6472">' + esc(clip(m.description, 26)) + '</text>';
        svg += '</g>';
      });
    });
    svg += '</svg>';

    root.innerHTML = '<div class="vA">' + head + '<div class="vA-body">' + extRail + '<main class="vA-main">' +
      '<div class="vA-hint">点击模块查看详情 · 滚轮缩放（光标为锚点）· 拖拽平移 · 双击复位</div>' +
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
        (m.source ? '<h4>源码 Source</h4><pre class="vA-src"><code>' + esc(m.source) + '</code></pre>' : '') +
        '</div>';
      detail.classList.add('open');
      root.querySelectorAll('.node').forEach(function (g) { g.classList.toggle('sel', g.dataset.id === id); });
      root.querySelector('#detailClose').addEventListener('click', closeDetail);
    }
    detail.addEventListener('click', function (e) { if (e.target === detail) closeDetail(); });
    root.querySelectorAll('.node').forEach(function (g) {
      g.addEventListener('click', function () { if (view && view.moved) { view.moved = false; return; } openDetail(g.dataset.id); });
    });

    var vp = root.querySelector('#flowViewport'), zt = root.querySelector('#zoomTarget'), zb = root.querySelector('#zoomBadge');
    view = { vp: vp, scale: 1, tx: 0, ty: 0, moved: false, dragging: false, sx: 0, sy: 0, ox: 0, oy: 0 };
    view.apply = function () {
      zt.style.transform = 'translate(' + view.tx + 'px,' + view.ty + 'px) scale(' + view.scale + ')';
      zb.textContent = Math.round(view.scale * 100) + '%';
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
    vp.addEventListener('dblclick', function () { view.scale = 1; view.tx = 0; view.ty = 0; view.apply(); });
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
