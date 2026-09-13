'use strict';
const test = require('node:test');
const assert = require('node:assert');
const L = require('../viewer.js'); // viewer.js 上部为纯内核；Node 下无 document 即跳过 DOM

const SZ = (ids) => ids.reduce((m, id) => ((m[id] = { w: 236, h: 92 }), m), {});

// ---- components：弱连通分量 ----
test('components splits disconnected regions and isolates edgeless nodes', () => {
  const comps = L.components(['a', 'b', 'c', 'd', 'e'], [
    { from: 'a', to: 'b' }, { from: 'c', to: 'd' },
  ]);
  assert.equal(comps.length, 3);
  const edgeful = comps.filter((c) => c.edges.length > 0);
  assert.equal(edgeful.length, 2);
  const iso = comps.filter((c) => c.edges.length === 0);
  assert.deepEqual(iso[0].nodes, ['e'], 'edgeless node is its own component');
});

test('components treat undirected reachability (2-cycle stays one comp)', () => {
  const comps = L.components(['a', 'b'], [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }]);
  assert.equal(comps.length, 1);
  assert.deepEqual(comps[0].nodes.sort(), ['a', 'b']);
});

// ---- flowGeometry：断环成 DAG + 分层 + barycenter ----
test('2-cycle is broken into one DAG edge plus one feedback edge', () => {
  const g = L.flowGeometry(['a', 'b'], [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }], SZ(['a', 'b']));
  assert.equal(g.back.length, 1);
  assert.equal(g.fwd.length, 1);
  assert.equal(g.back[0].from, 'b');
  assert.equal(g.back[0].to, 'a');
});

test('triangle feeds exactly one feedback edge and stays acyclic', () => {
  const g = L.flowGeometry(['a', 'b', 'c'], [
    { from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'a' },
  ], SZ(['a', 'b', 'c']));
  assert.equal(g.back.length, 1);
  assert.equal(g.fwd.length, 2);
  const set = g.fwd.map((e) => e.from + '>' + e.to);
  assert.ok(set.includes('a>b') && set.includes('b>c'), 'remaining edges form a path a→b→c');
});

test('longest-path layering puts sinks deepest', () => {
  const g = L.flowGeometry(['a', 'b', 'c', 'd'], [
    { from: 'a', to: 'b' }, { from: 'a', to: 'c' }, { from: 'b', to: 'd' }, { from: 'c', to: 'd' },
  ], SZ(['a', 'b', 'c', 'd']));
  assert.equal(g.layers.length, 3, 'three layers expected');
  assert.deepEqual(g.layers[0], ['a']);
  assert.ok(g.layers[1].includes('b') && g.layers[1].includes('c'));
  assert.deepEqual(g.layers[2], ['d']);
});

test('feedback lane is not included in the layout DAG edges', () => {
  const g = L.flowGeometry(['a', 'b', 'c'], [
    { from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'b' },
  ], SZ(['a', 'b', 'c']));
  const fwdPairs = g.fwd.map((e) => e.from + '>' + e.to);
  assert.ok(!fwdPairs.includes('c>b'), 'back edge not among forward edges');
});

test('every node gets a position; no same-row box overlaps its row neighbour', () => {
  const ids = ['a', 'b', 'c', 'd'];
  const g = L.flowGeometry(ids, [
    { from: 'a', to: 'c' }, { from: 'b', to: 'd' },
  ], SZ(ids));
  ids.forEach((id) => assert.ok(g.pos[id], `pos for ${id}`));
  g.layers.forEach((row) => {
    for (let i = 1; i < row.length; i++) {
      const prevId = row[i - 1];
      // 间距按前一个条目的**盒宽**算（叶 236 / 组 282）。虚节点没有盒（票 03），宽度按 0 ——
      // 它只要求 HGAP 的间隙。写死 236 的话，层里一旦混进虚节点这条断言就会假报重叠。
      const need = g.sizes[prevId] ? g.sizes[prevId].w : 0;
      assert.ok(g.pos[row[i]].x >= g.pos[prevId].x + need, 'horizontal gap respected between same-row boxes');
    }
  });
});

// ---- 虚节点正交折线：跨层 ≥2 的前向边不穿盒（ADR-0009，推翻 ADR-0007 的「长边走贝塞尔」） ----
// 立体形状：a→b→c→d 四层，外加一条 a→d。a、d 的盒中线在 x 上对齐，而层 1 / 层 2 的盒正压着
// 这条中线——直连（直线或曲线）必穿盒。折线只能先在层间空隙里横向挪到别的列，再逐层竖直穿下。
const LONG_IDS = ['a', 'b', 'c', 'd'];
const LONG_EDGES = [
  { from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'd' }, { from: 'a', to: 'd' },
];
const longG = () => L.flowGeometry(LONG_IDS, LONG_EDGES, SZ(LONG_IDS));

// 折点序列 → 线段（每段取 AABB）；盒 → AABB。同层两盒横向不重叠，所以「不穿盒」可以在
// AABB 上用**严格不等**判：只碰到边界（出边起点在源盒底边、入边终点在目标盒上方）不算穿。
const segOf = (pts) => pts.slice(1).map((p, i) => ({
  x1: Math.min(pts[i].x, p.x), x2: Math.max(pts[i].x, p.x),
  y1: Math.min(pts[i].y, p.y), y2: Math.max(pts[i].y, p.y),
}));
const boxOf = (id, g) => {
  const p = g.pos[id], s = g.sizes[id];
  return { x1: p.x, x2: p.x + s.w, y1: p.y, y2: p.y + s.h };
};
const overlap = (a, b) => a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;
const realIds = (g, li) => g.layers[li].filter((id) => !g.virtual[id]);

// 「中间层不穿盒」的通用断言：对每一层，凡是纵向跨度与该层**行带**相交的段，其横向区间都不得
// 落在该层任一盒的 x 区间内。中间层 = 折线的纵向跨度里除源层 / 目标层以外的那些层。
function assertNoBoxCut(g, longs) {
  const bandOf = (li) => {
    const mem = realIds(g, li);
    const yTop = g.pos[mem[0]].y;
    return { y1: yTop, y2: yTop + Math.max.apply(null, mem.map((id) => g.sizes[id].h)), boxes: mem.map((id) => boxOf(id, g)) };
  };
  longs.forEach((l) => {
    const pts = l.points, segs = segOf(pts);
    const La = layerAtY(g, g.pos[l.from].y), Lb = layerAtY(g, g.pos[l.to].y);
    assert.ok(La >= 0 && Lb - La >= 2, `${l.from}→${l.to} 应该是一条跨层 ≥2 的边，层号要认得出来`);
    let probed = 0;   // 真的被「段 × 盒」检过的对数——0 就说明这条断言是空洞的
    for (let li = La + 1; li < Lb; li++) {
      const band = bandOf(li);
      segs.forEach((s, i) => {
        if (!(s.y1 < band.y2 && band.y1 < s.y2)) return;          // 这一段没落在本层行带里
        band.boxes.forEach((b) => {
          probed++;
          assert.ok(!overlap(s, b),
            `${l.from}→${l.to} 第 ${i} 段（y ${s.y1}..${s.y2}，x ${s.x1}..${s.x2}）穿过了层 ${li} 的盒（x ${b.x1}..${b.x2}）`);
        });
      });
    }
    assert.ok(probed > 0, `${l.from}→${l.to} 没有任何一段落在中间层的行带里——这条断言没检到东西`);
    // 加强版：**任何**盒（含源层 / 目标层）都不被穿过——出边起点在源盒底边、入边终点在目标盒
    // 上方 PORT_GAP，都只碰到边界，严格不等判据下不算穿。
    g.layers.forEach((row, Li) => {
      realIds(g, Li).forEach((id) => {
        const b = boxOf(id, g);
        segs.forEach((s, i) => assert.ok(!overlap(s, b),
          `${l.from}→${l.to} 第 ${i} 段穿过了层 ${Li} 的盒 ${id}`));
      });
    });
  });
}
// 折点落在哪一层：按 pos 的 y 找行（层内所有节点顶对齐）。
const layerAtY = (g, y) => {
  for (let li = 0; li < g.layers.length; li++) if (g.pos[realIds(g, li)[0]].y === y) return li;
  return -1;
};

test('a ≥2-layer forward edge becomes an orthogonal polyline, not a curve', () => {
  const g = longG();
  assert.equal(g.longs.length, 1, '只有 a→d 跨层 ≥2，只有它拿到折点几何量');
  assert.equal(g.longs[0].from, 'a');
  assert.equal(g.longs[0].to, 'd');
  const pts = g.longs[0].points;
  assert.ok(pts.length >= 4, '至少三个折：下 → 横向挪位 → 穿层 → … → 到达');
  segOf(pts).forEach((s, i) => assert.ok(s.x1 === s.x2 || s.y1 === s.y2, `第 ${i} 段是斜的，不是正交折线`));
  assert.deepEqual(pts[0], { x: g.pos.a.x + g.sizes.a.w / 2, y: g.pos.a.y + g.sizes.a.h }, '起于源盒底边中点');
  assert.equal(pts[pts.length - 1].x, g.pos.d.x + g.sizes.d.w / 2, '入端 x = 目标盒宽中点');
  assert.equal(pts[pts.length - 1].y, g.pos.d.y - 8, '入端 = 目标盒上边缘 - 8px（与前向边一致）');
  assert.equal(pts[0].x, pts[pts.length - 1].x, '前提：源、目标的中线在 x 上对齐');
  assert.ok(pts.some((p) => p.x !== pts[0].x), '中途确实横向挪开了（否则就是一条直线穿盒）');
  const ys = pts.filter((q, i) => i && q.y === pts[i - 1].y).map((q) => q.y);
  const p = L.fwdPath(g.pos.a, g.pos.d, g.sizes.a, g.sizes.d, pts);
  assert.ok(!/ C /.test(p.d), 'd 里没有贝塞尔段');
  assert.equal((p.d.match(/ L/g) || []).length, pts.length - 1, '折点逐一连成线段');
  assert.ok(ys.indexOf(p.my) !== -1, '中点标签锚在某条水平段的 y 上（水平段都在层间空隙的中线上）');
});

test('no segment of a long forward edge crosses a box in an intermediate layer', () => {
  const g = longG();
  const pts = g.longs[0].points;
  // 前提（否则断言是空的）：层 1、层 2 的盒正压在 a、d 的中线上，直连必穿。
  [1, 2].forEach((li) => {
    assert.ok(realIds(g, li).some((id) => {
      const b = boxOf(id, g);
      return b.x1 <= pts[0].x && pts[0].x <= b.x2;
    }), `层 ${li} 有盒压在中线上`);
  });
  assertNoBoxCut(g, g.longs);
});

test('a one-layer forward edge keeps the cubic bezier; only ≥2 hops go orthogonal', () => {
  const g = L.flowGeometry(['a', 'b'], [{ from: 'a', to: 'b' }], SZ(['a', 'b']));
  assert.deepEqual(g.longs, [], '跨层 1 不产生折点几何量（也不需要虚节点）');
  assert.deepEqual(Object.keys(g.virtual), []);
  const p = L.fwdPath(g.pos.a, g.pos.b, g.sizes.a, g.sizes.b);
  assert.ok(/ C /.test(p.d), '仍然是三次贝塞尔');
  assert.ok(p.d.startsWith('M118 ' + (g.pos.a.y + g.sizes.a.h) + ' '), '出边起点没变（源盒底边中点）');
  assert.equal(Number(p.d.slice(p.d.lastIndexOf(' ') + 1)), g.pos.b.y - 8, '入端仍在目标盒上方 8px');
});

test('virtual nodes take a slot in the layer order but carry no box', () => {
  const g = longG();
  const vids = Object.keys(g.virtual);
  assert.equal(vids.length, 2, 'a→d 跨 3 层，中间两层各插一个虚节点');
  const flat = g.layers.reduce((acc, row) => acc.concat(row), []);
  const rowYs = flat.map((id) => g.pos[id].y);
  vids.forEach((v) => {
    assert.ok(flat.indexOf(v) !== -1, '虚节点进层内序列（因此会被 barycenter 重排）');
    assert.ok(g.pos[v], '虚节点有位次坐标——折线拿它当逐层穿下来的那一列');
    assert.ok(rowYs.indexOf(g.pos[v].y) !== -1, '虚节点落在某一层的行带上');
    assert.strictEqual(g.sizes[v], undefined, '虚节点不进盒尺寸表（那张表是「盒」的表）');
  });
  LONG_IDS.forEach((id) => assert.ok(!g.virtual[id],
    '真实节点不会被标成虚节点——渲染层按 g.virtual 跳过，标错就会少画一个盒'));
  assert.equal(g.fwd.length, 4, 'fwd 仍是 4 条真实边（虚节点不是边）');
  assert.equal(g.back.length, 0);
  // 计数口径的落点：虚节点绝不能成为一个端口单元（countPorts 的单位是「单元 id × 方向」）。
  const counts = L.countPorts(g.fwd.map((e) => ({ from: e.from, to: e.to, conns: [{ label: '流转' }] })));
  assert.deepEqual(Object.keys(counts).sort(), ['a', 'b', 'c', 'd'], '计数表里只有真实单元');
  vids.forEach((v) => assert.strictEqual(counts[v], undefined, '虚节点不会成为一个端口单元'));
});

test('a long forward edge resolves inside the canvas width: the lane stays feedback-only', () => {
  const g = longG();
  const xs = g.longs[0].points.map((q) => q.x);
  assert.ok(Math.min.apply(null, xs) >= 0, '折线不越出画布左侧');
  assert.ok(Math.max.apply(null, xs) <= g.Wc,
    '折线不越出 Wc——长前向边在画布内解决，不借右侧那条 170px 通道（ADR-0009）');
});

// ---- gridGeometry：无连接节点独立带 ----
test('gridGeometry wraps isolated leaves into rows capped near GRID_CAP', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
  const g = L.gridGeometry(ids, SZ(ids));
  assert.equal(g.rows.length, 4, '10 leaves at 236 wide wrap to 4 rows of ≤3');
  assert.equal(Object.keys(g.pos).length, ids.length);
  const ys = Object.keys(g.pos).map((id) => g.pos[id].y);
  assert.ok(new Set(ys).size >= 4, 'later rows sit lower');
});

test('gridGeometry places a single node', () => {
  const g = L.gridGeometry(['a'], SZ(['a']));
  assert.equal(g.rows.length, 1);
  assert.deepEqual(g.pos.a, { x: (940 - 236) / 2, y: 0 });
});

// ---- pick：双语取值（expand 步：新旧两种形态并存） ----
test('pick returns the requested language from a {zh,en} field', () => {
  const f = { zh: '读取配置', en: 'read the config' };
  assert.equal(L.pick(f, 'zh'), '读取配置');
  assert.equal(L.pick(f, 'en'), 'read the config');
});

test('pick returns a legacy plain string unchanged', () => {
  // 单语真实产物（散文字段全是普通 string）照常渲染的机制保证：原样返回，不抛错、不返回 undefined。
  assert.equal(L.pick('读取配置', 'zh'), '读取配置');
  assert.equal(L.pick('读取配置', 'en'), '读取配置');
  assert.equal(L.pick('read the config', 'zh'), 'read the config');
});

test('pick defaults to zh when the language argument is missing or invalid', () => {
  const f = { zh: '中文', en: 'English' };
  assert.equal(L.pick(f), '中文');
  assert.equal(L.pick(f, undefined), '中文');
  assert.equal(L.pick(f, null), '中文');
  assert.equal(L.pick(f, ''), '中文');
  assert.equal(L.pick(f, 'fr'), '中文');
  assert.equal(L.pick(f, 'ZH'), '中文', '语言码大小写不敏感地落到默认值，而不是取到 undefined');
});

test('pick falls back to whichever language exists instead of returning nothing', () => {
  assert.equal(L.pick({ zh: '只有中文' }, 'en'), '只有中文');
  assert.equal(L.pick({ en: 'only english' }, 'zh'), 'only english');
  assert.equal(L.pick({ zh: '   ', en: 'x' }, 'zh'), 'x', '空白不算有内容');
});

test('pick never throws and never returns undefined for malformed input', () => {
  [undefined, null, 42, true, {}, { zh: '' }, [], { zh: null }].forEach((bad) => {
    assert.strictEqual(L.pick(bad, 'zh'), '', `pick(${JSON.stringify(bad)}) 应为空串`);
    assert.strictEqual(L.pick(bad, 'en'), '', `pick(${JSON.stringify(bad)}, 'en') 应为空串`);
  });
});

test('pickList maps a list of translatable items and drops empties', () => {
  assert.deepEqual(L.pickList([{ zh: '甲', en: 'A' }, { zh: '乙', en: 'B' }], 'en'), ['A', 'B']);
  assert.deepEqual(L.pickList(['旧形态', '另一条'], 'en'), ['旧形态', '另一条']);
  assert.deepEqual(L.pickList([{ zh: '甲' }, { en: 'B' }], 'en'), ['甲', 'B']);
  assert.deepEqual(L.pickList(undefined, 'zh'), []);
});

// ---- edgeLabel：聚合去重 / 上限（label 走 pick，按当前语言去重） ----
test('edgeLabel dedupes and truncates at 3 unique labels', () => {
  assert.equal(L.edgeLabel({ conns: [{ label: 'x' }, { label: 'x' }] }, 'zh'), 'x');
  assert.equal(L.edgeLabel({ conns: [{ label: 'a' }, { label: 'b' }] }, 'zh'), 'a · b');
  const many = ['a', 'b', 'c', 'd'].map((label) => ({ label }));
  assert.equal(L.edgeLabel({ conns: many }, 'zh'), 'a · b +2');
  assert.equal(L.edgeLabel({ conns: [] }, 'zh'), '');
});

test('edgeLabel aggregates per language (labels are prose and go through pick)', () => {
  const conns = [
    { label: { zh: '配置文件原文', en: 'raw config text' } },
    { label: { zh: '配置文件原文', en: 'raw config text' } },
    { label: { zh: '解析后的配置对象', en: 'the parsed config object' } },
  ];
  assert.equal(L.edgeLabel({ conns }, 'zh'), '配置文件原文 · 解析后的配置对象');
  assert.equal(L.edgeLabel({ conns }, 'en'), 'raw config text · the parsed config object');
  const many = ['a', 'b', 'c', 'd'].map((s) => ({ label: { zh: s, en: s.toUpperCase() } }));
  assert.equal(L.edgeLabel({ conns: many }, 'en'), 'A · B +2');
});

// ---- countPorts：端口的 ×N = 该方向「不同内容种数」（ADR-0009，不是连接条数） ----
test('countPorts counts distinct content kinds per direction, not connections', () => {
  const c = L.countPorts([
    { from: 'a', to: 'b', conns: [
      { label: { zh: '配置', en: 'config' } },
      { label: { zh: '配置', en: 'config' } }, // 同一个内容：只算一种
      { label: { zh: '路径', en: 'path' } },
    ] },
    { from: 'b', to: 'a', conns: [{ label: { zh: '结果', en: 'result' } }] },
  ]);
  assert.equal(c.a.out, 2, '3 条连接里只有 2 种内容');
  assert.equal(c.a.in, 1);
  assert.deepEqual(c.b, {
    in: 2, out: 1,
    inRep: { zh: '配置', en: 'config' },   // 代表内容取该方向 IR 顺序第一条
    outRep: { zh: '结果', en: 'result' },
  });
});

test('countPorts works on monolingual artifacts (plain-string labels)', () => {
  const c = L.countPorts([
    { from: 'a', to: 'b', conns: [
      { label: 'renderer script path' },
      { label: 'renderer script path' },
      { label: 'repo root' },
    ] },
  ]);
  assert.equal(c.a.out, 2, '重复的同一句只算一种（旧形态字符串按 zh 取值就是它本身）');
  assert.equal(c.a.outRep, 'renderer script path');
});

test('countPorts survives ids that collide with Object.prototype keys', () => {
  const c = L.countPorts([
    { from: 'constructor', to: '__proto__', conns: [{ label: { zh: '内容' } }] },
  ]);
  assert.equal(c.constructor.out, 1, 'id 叫 constructor 也只是个普通键');
  assert.equal(c['__proto__'].in, 1, 'id 叫 __proto__ 也要能计数');
  assert.equal(Object.prototype.in, undefined, '不能污染 Object.prototype');
});

// ---- fixture：带 group 的双语样例（端口行为全是 group 才有的） ----
const BI_IR = require('../examples/sample.bilingual.ir.json');

// 折叠视图的顶层端口，与 viewer.js DOM 装配同一条链：topOf → aggregateEdges → countPorts。
// 返回 counts（新口径）与 tail（旧口径 = 连接条数），好让两者在同一个 fixture 上对照。
function topPorts(ir) {
  const M = {};
  ir.modules.forEach((m) => (M[m.id] = m));
  const topOf = (m) => m.group || m.id;
  const conns = ir.connections.filter((c) => {
    const fm = M[c.from], tm = M[c.to];
    return fm && tm && fm.type === 'internal' && tm.type === 'internal' && topOf(fm) !== topOf(tm);
  });
  const edges = L.aggregateEdges(conns, (c) => ({ from: topOf(M[c.from]), to: topOf(M[c.to]) }));
  const tail = {};
  edges.forEach((e) => (tail[e.from] = (tail[e.from] || 0) + e.conns.length));
  return { counts: L.countPorts(edges), edges, tail };
}

test('bilingual fixture exercises dedup: kinds < connection count', () => {
  const { counts, tail } = topPorts(BI_IR);
  assert.ok(counts.grp_io, 'fixture 里有带端口的 group');
  assert.ok(tail.grp_io > counts.grp_io.out,
    '出方向：连接条数 ' + tail.grp_io + ' > 内容种数 ' + counts.grp_io.out
    + '（多条连接共享同一 zh 文本，去重真的降了 N）');
  assert.equal(counts.grp_io.in, 0, '入方向没有内容 → 渲染成「—」');
});

test('bilingual fixture writes mid-point labels as action phrases, per language', () => {
  // ADR-0008：中点从「数据名」改成「动作」——`配置文件原文` 一类名词读不出这条线在干什么，
  // 「传入配置文件原文」才是一句话。样例是这条语义在仓库里唯一的演示处。
  const { edges } = topPorts(BI_IR);
  assert.deepEqual(edges.map((e) => L.edgeLabel(e, 'zh')),
    ['传入解析后的配置', '传入解析后的配置', '传入带来源的记录'],
    '同一内容的两条边中点写法一致（同 label 复用同一句话）');
  assert.deepEqual(edges.map((e) => L.edgeLabel(e, 'en')),
    ['pass the parsed config', 'pass the parsed config', 'pass the source-tagged records']);
});

test('the bilingual fixture reroutes its one ≥2-layer edge clear of the boxes', () => {
  // 真实产物形状上的同一条断言（照 flowSvg 的链路：顶层折叠 → 弱连通分量 → flowGeometry）。
  const { edges } = topPorts(BI_IR);
  const M = {}; BI_IR.modules.forEach((m) => (M[m.id] = m));
  const G = {}; (BI_IR.groups || []).forEach((g) => (G[g.id] = g));
  const comps = L.components(Object.keys(M), edges).filter((c) => c.edges.length > 0);
  assert.equal(comps.length, 1, '前提：fixture 顶层是一整片');
  const sz = {};
  comps[0].nodes.forEach((id) => (sz[id] = G[id] ? { w: 282, h: 96 } : { w: 236, h: 78 }));
  const g = L.flowGeometry(comps[0].nodes, comps[0].edges, sz);
  assert.equal(g.longs.length, 1, 'fixture 里跨层 ≥2 的前向边只有一条');
  assert.equal(g.longs[0].from, 'grp_io');
  assert.equal(g.longs[0].to, 'build_index');
  assert.equal(Object.keys(g.virtual).length, 1, '跨 2 层 → 中间层插一个虚节点');
  assertNoBoxCut(g, g.longs);
});

// ---- nodeSvg：盒体（含端口标注） ----
const GRP_ID = 'grp_x';
const GRP = {
  id: GRP_ID,
  label: { zh: '参数解析', en: 'arg parsing' },
  description: { zh: '把命令行参数解析成配置', en: 'parses argv into config' },
};
const GM = {};                    // group 盒不读 M，给空表即可
const GG = { [GRP_ID]: GRP };

// 取出端口标注那段 <text>（font-size="10"，入端口在前、出端口在后）。
function portTexts(svg) {
  return [...svg.matchAll(/<text x="([\d.]+)" y="([\d.]+)" font-size="10"[^>]*>([^<]*)<\/text>/g)]
    .map((m) => ({ x: Number(m[1]), y: Number(m[2]), t: m[3] }));
}

test('group port prints ×N plus the IR-first representative content', () => {
  const counts = L.countPorts([
    { from: GRP_ID, to: 'leaf', conns: [{ label: { zh: '解析后的配置对象', en: 'the parsed config object' } }] },
    { from: 'other', to: GRP_ID, conns: [
      { label: { zh: '命令行原文', en: 'raw argv' } },
      { label: { zh: '环境变量', en: 'env vars' } },
    ] },
  ]);
  const pts = portTexts(L.nodeSvg(GRP_ID, 0, 0, counts, 'zh', GM, GG));
  assert.deepEqual(pts.map((p) => p.t), ['×2 命令行原文', '×1 解析后的配置对象']);
  assert.ok(pts[0].x > 282 / 2, '代表内容画在端口圆点右侧（盒宽中点之右）');
  assert.ok(pts[0].x + 130 <= 282, '整段按可用宽截断，不出盒（GW = 282）');
});

test('×N is language-invariant while the representative follows the language', () => {
  const counts = L.countPorts([
    { from: 'other', to: GRP_ID, conns: [
      { label: { zh: '同一个内容', en: 'first wording' } },
      { label: { zh: '同一个内容', en: 'second wording' } }, // zh 相同 = 同一种内容，尽管 en 措辞不同
      { label: { zh: '另一个内容', en: 'another thing' } },
    ] },
  ]);
  const zh = portTexts(L.nodeSvg(GRP_ID, 0, 0, counts, 'zh', GM, GG));
  const en = portTexts(L.nodeSvg(GRP_ID, 0, 0, counts, 'en', GM, GG));
  assert.equal(zh[0].t, '×2 同一个内容');
  assert.equal(en[0].t, '×2 first wording', '代表内容跟着显示语言走');
  assert.equal(zh[0].t.match(/×\d+/)[0], en[0].t.match(/×\d+/)[0], '切语言后 N 不变');
});

test('an empty direction renders an explicit dash port instead of no port', () => {
  const svg = L.nodeSvg(GRP_ID, 0, 0, L.countPorts([]), 'zh', GM, GG);
  assert.equal((svg.match(/class="port"/g) || []).length, 2, '两个方向的端口圆点都画出来');
  assert.deepEqual(portTexts(svg).map((p) => p.t), ['—', '—'], '没有数据的方向显式标「—」');
});

test('a long representative is truncated by fitWidth, digits survive', () => {
  const long = '这是一个非常长的代表内容描述文本用来验证单行超宽时会被截断';
  const counts = L.countPorts([
    { from: 'other', to: GRP_ID, conns: [{ label: { zh: long, en: 'long' } }] },
  ]);
  const p = portTexts(L.nodeSvg(GRP_ID, 0, 0, counts, 'zh', GM, GG))[0];
  assert.ok(p.t.startsWith('×1 '), '数字在段首，不会被截掉');
  assert.ok(p.t.endsWith('…'), '超宽时截断加省略号');
  assert.ok(p.t.length < long.length, '确实截短了');
});

// ---- portRows / portListHtml：点开的清单行数 === 盒上的 ×N ----
// 断言的是**行数**（以及行内的数据），不是某段 HTML 文本。
const rowCount = (html) => (html.match(/class="vA-pp-row"/g) || []).length;

test('port list rows equal ×N on the bilingual fixture (kinds < connections)', () => {
  const { counts, edges, tail } = topPorts(BI_IR);
  assert.ok(tail.grp_io > counts.grp_io.out, '前提：该端口连接条数 > 内容种数（去重真的降了 N）');
  const rows = L.portRows('grp_io', 'out', edges);
  assert.equal(rows.length, counts.grp_io.out,
    '行数 === ×N（' + counts.grp_io.out + '），不是连接条数（' + tail.grp_io + '）');
  assert.equal(rows[0].peers.length, 2, '两条聚合边指向两个不同对端，行内对端去重后仍列全');
  assert.deepEqual(rows[0].peers, ['process_records', 'build_index'], '对端按 IR 首现顺序');
});

test('port list rows equal ×N on a real-artifact-shaped port (8 connections, 4 kinds)', () => {
  // grp_arg_parse 出端口的真实形状：12 条连接 / 3 个对端 / 4 种内容。
  const c = (zh, en) => ({ label: { zh, en } });
  const edges = [
    { from: 'grp_x', to: 'g1', conns: [c('quality profile', 'q'), c('quality profile', 'q'), c('quality profile', 'q')] },
    { from: 'grp_x', to: 'g2', conns: [c('quality profile', 'q'), c('repo root', 'r')] },
    { from: 'grp_x', to: 'g3', conns: [c('repo root', 'r'), c('compare options', 'c'), c('migration options', 'm')] },
  ];
  const counts = L.countPorts(edges);
  const rows = L.portRows('grp_x', 'out', edges);
  assert.equal(rows.length, counts.grp_x.out, '行数 === ×N（4）');
  assert.equal(rows.length, 4, '去掉重复内容的连接后是 4 行');
  assert.notEqual(rows.length, 8, '不是 8 行（连接条数会多算）');
  assert.deepEqual(rows[0].peers, ['g1', 'g2'], '同一内容的多条连接并进同一行，对端去重');
  assert.deepEqual(rows[1].peers, ['g2', 'g3']);
  assert.equal(L.pick(rows[0].rep, 'zh'), 'quality profile', '行内内容取该种内容 IR 顺序第一条');
});

test('port list rows equal ×N on a monolingual graph (plain-string labels)', () => {
  // 单语真实产物：label 是普通字符串，pick(x, 'zh') 就是它本身 → 去重键仍然成立。
  const edges = [
    { from: 'grp_x', to: 'g1', conns: [{ label: '读取配置' }, { label: '读取配置' }] },
    { from: 'grp_x', to: 'g2', conns: [{ label: '渲染模板' }, { label: '读取配置' }] },
  ];
  const counts = L.countPorts(edges);
  assert.equal(counts.grp_x.out, 2);
  assert.equal(L.portRows('grp_x', 'out', edges).length, counts.grp_x.out);
});

test('every port of the bilingual fixture has as many list rows as ×N, in both languages', () => {
  const { counts, edges } = topPorts(BI_IR);
  const M = {}; BI_IR.modules.forEach((m) => (M[m.id] = m));
  const G = {}; (BI_IR.groups || []).forEach((g) => (G[g.id] = g));
  const ids = Object.keys(counts);
  assert.ok(ids.length, 'fixture 有端口可数');
  ids.forEach((id) => {
    ['in', 'out'].forEach((dir) => {
      const n = counts[id][dir];
      const rows = L.portRows(id, dir, edges);
      assert.equal(rows.length, n, id + '/' + dir + '：行数应等于 ×N');
      // 渲染层同一份数据在两种语言下行数一致（去重键是 zh，不是显示语言）。
      const zh = rowCount(L.portListHtml(id, dir, edges, 'zh', M, G));
      const en = rowCount(L.portListHtml(id, dir, edges, 'en', M, G));
      assert.equal(zh, n, id + '/' + dir + '（zh）');
      assert.equal(en, n, id + '/' + dir + '（en）切语言行数不变');
    });
  });
});

test('port list collapses many peers with the same · / +N convention as edge labels', () => {
  assert.equal(L.uniqJoin(['甲', '乙', '丙']), '甲 · 乙 · 丙');
  assert.equal(L.uniqJoin(['甲', '乙', '丙', '丁']), '甲 · 乙 +2', '与边中点标签同一套收尾规则');
  assert.equal(L.uniqJoin(['甲', '甲', '乙']), '甲 · 乙', '重复项只出现一次');
  assert.equal(L.uniqJoin([]), '');
  const peers = ['p1', 'p2', 'p3', 'p4'];
  const edges = peers.map((p) => ({ from: 'grp_x', to: p, conns: [{ label: { zh: '同一种内容', en: 'one kind' } }] }));
  const rows = L.portRows('grp_x', 'out', edges);
  assert.equal(rows.length, 1, '4 个对端 / 同一内容 → 1 行');
  assert.deepEqual(rows[0].peers, peers, '对端全列出（去重，保序）');
  const html = L.portListHtml('grp_x', 'out', edges, 'zh', { p1: { label: 'P一' }, p2: { label: 'P二' }, p3: { label: 'P三' }, p4: { label: 'P四' } }, { grp_x: GRP });
  assert.equal(rowCount(html), 1);
  assert.ok(html.includes('P一 · P二 +2'), '对端多时收尾成 `a · b +2`');
});

test('uniqJoin takes a per-surface cap, defaulting to the narrow surface two', () => {
  // 共用的是 `·` 连接与 `+M` 余数记法（M = 总数 − 已列数），上限按面宽不同：画布中点标签与
  // 端口清单的格子窄，用缺省的 2；侧栏依赖卡片宽，反向索引传 3（ADR-0011）。
  assert.equal(L.uniqJoin(['甲', '乙', '丙', '丁'], 3), '甲 · 乙 · 丙 +1', '宽面：前 3 + +M');
  assert.equal(L.uniqJoin(['甲', '乙', '丙', '丁'], 2), '甲 · 乙 +2', '显式传 2 与缺省同义');
  assert.equal(L.uniqJoin(['甲', '乙', '丙'], 3), '甲 · 乙 · 丙', '三项以内一律全列，与 cap 无关');
  assert.equal(L.uniqJoin(['甲', '乙', '丙', '丁', '戊'], 3), '甲 · 乙 · 丙 +2', 'M = 总数 − 已列数');
  assert.equal(L.uniqJoin([], 3), '');
});

// ---- 四段说明：取值 / 按来源模块分组的行数据 / 行 HTML ----
const BI_M = {};
BI_IR.modules.forEach((m) => (BI_M[m.id] = m));
const biConn = (from, to) => BI_IR.connections.filter((c) => c.from === from && c.to === to)[0];

test('pickPart reads one of the four fixed segments by language', () => {
  const d = {
    zh: { source: '从哪来', process: '经过什么', output: '输出什么', purpose: '用于什么' },
    en: { source: 'where from', process: 'what happens', output: 'what comes out', purpose: 'what for' },
  };
  assert.equal(L.pickPart(d, 'zh', 'source'), '从哪来');
  assert.equal(L.pickPart(d, 'en', 'purpose'), 'what for');
  assert.equal(L.pickPart(d, 'fr', 'output'), '输出什么', '非法语言落回默认语言');
  assert.equal(L.pickPart({ en: { source: 'only english' } }, 'zh', 'source'), 'only english', '缺当前语言时回退');
  assert.equal(L.pickPart(d, 'zh', 'nope'), '', '四段之外没有第五段');
  [undefined, null, '只是一句话', {}, { zh: {} }].forEach((bad) => {
    assert.strictEqual(L.pickPart(bad, 'zh', 'source'), '', `pickPart(${JSON.stringify(bad)}) 应为空串`);
  });
});

test('fourPartRows groups a folded edge by source module, keeping IR order', () => {
  // 顶层折叠后，组内成员的 connection 在画布上没有可见的线——按来源模块分组是它们唯一的到达路径。
  const two = { from: 'grp_io', to: 'out', conns: [biConn('parse_config', 'build_index'), biConn('process_records', 'build_index')] };
  assert.deepEqual(L.fourPartRows(two).map((g) => g.id), ['parse_config', 'process_records'], '按来源模块分组，保 IR 首现顺序');
  assert.equal(L.fourPartRows(two)[0].conns.length, 1);

  const same = { from: 'grp_io', to: 'out', conns: [biConn('parse_config', 'process_records'), biConn('parse_config', 'build_index')] };
  const g = L.fourPartRows(same);
  assert.equal(g.length, 1, '同一个来源模块的多条 connection 归在一组');
  assert.equal(g[0].conns.length, 2, '组内每条 connection 都在');
  assert.deepEqual(L.fourPartRows({ conns: [] }), []);
});

test('fourPartHtml lists all four segments of every connection, grouped by source module', () => {
  const edge = { from: 'grp_io', to: 'build_index', conns: [biConn('parse_config', 'build_index'), biConn('process_records', 'build_index')] };
  const html = L.fourPartHtml(edge, 'zh', BI_M);
  assert.equal((html.match(/class="vA-fp-src"/g) || []).length, 2, '分组数 = 来源模块数');
  assert.ok(html.includes('>parseConfig<') && html.includes('>processRecords<'), '组标题是来源模块名（名字不译）');
  assert.equal((html.match(/class="vA-fp-cap"/g) || []).length, 8, '2 条 connection × 4 段');
  ['来源', '处理', '输出', '用途'].forEach((cap) => assert.ok(html.includes(cap), '缺段标题 ' + cap));
  assert.ok(html.includes(biConn('parse_config', 'build_index').description.zh.source), '段内容是当前语言的原文');

  const en = L.fourPartHtml(edge, 'en', BI_M);
  assert.ok(en.includes(biConn('parse_config', 'build_index').description.en.source), '切语言后四段跟着换');
  assert.ok(!en.includes(biConn('parse_config', 'build_index').description.zh.source), '英文版里不该混进中文段');
  ['Source', 'Process', 'Output', 'Purpose'].forEach((cap) => assert.ok(en.includes(cap), 'en 缺段标题 ' + cap));
});

test('a connection without a description renders an explicit dash for each segment', () => {
  // 真实产物此刻 47 条 connection 一条 description 都没有（重新生成是契约步交付后的事）：
  // 点开必须不抛错，且缺的段落显式画「—」——静默留白会让人以为那条线没有用途。
  const edge = { from: 'x', to: 'y', conns: [{ from: 'x', to: 'y', label: '裸连接' }] };
  const html = L.fourPartHtml(edge, 'zh', { x: { label: 'X' }, y: { label: 'Y' } });
  assert.equal((html.match(/>—</g) || []).length, 4, '四段各自显式画「—」');
  assert.equal((html.match(/class="vA-fp-cap"/g) || []).length, 4, '连没有 description 也保持四段的结构');
  assert.ok(html.includes('裸连接'), 'label 仍然照常显示');
  assert.deepEqual(L.fourPartHtml({ conns: [] }, 'zh', {}).length > 0, true, '空边也要给个说法，不能返回空串');
});

// ---- consRows / consListHtml / consIndex：依赖卡片的消费者清单与反向索引（票 05 第四入口） ----
// 数据源是 internal 模块上的 `uses`（ADR-0011），不再是「具名导入符号匹配」的代理估算——
// 那把尺子对 default 导入完全失明（round20 开头的更正）。
test('consumer rows are the internal modules whose uses names the external', () => {
  // 样例 fixture 里只有 readConfig 声明消费了 fs。
  assert.deepEqual(L.consRows('ext_fs', BI_IR.modules).map((r) => r.id), ['read_config'],
    '行 = 声明用到它的 internal 模块');
  assert.deepEqual(L.consRows('ext_fs', BI_IR.modules)[0].label, 'readConfig', '行里给的是模块名（不译）');
});

test('a default-only external lists its consumers: the proxy blindness is gone', () => {
  // 旧代理（具名导入符号匹配）对 node:path 这类 default 导入恒 0 行；票 06 之后数据源是 `uses`
  // 字段，盲区随之消失——fixture 的 node:path 正是只有 default 导入的那个。
  assert.deepEqual(BI_IR.modules.filter((m) => m.id === 'ext_path').map((m) => m.input), [['default']],
    '前提：ext_path 只有 default 导入（没有符号名可匹配）');
  assert.deepEqual(L.consRows('ext_path', BI_IR.modules).map((r) => r.id), ['read_config', 'parse_config'],
    'default 导入的 external 照样列得出消费者');
});

test('consumer rows tolerate absent or malformed uses without throwing', () => {
  const mods = [
    { id: 'ext_x', label: 'x', type: 'external', input: ['default'] },
    { id: 'a', label: 'A', type: 'internal' },                        // 没有 uses
    { id: 'b', label: 'B', type: 'internal', uses: 'ext_x' },          // 形状坏了
    { id: 'c', label: 'C', type: 'internal', uses: ['ext_x'] },
    { id: 'ext_y', label: 'y', type: 'external', input: [], uses: ['ext_x'] }, // external 上的 uses 不算数
  ];
  assert.deepEqual(L.consRows('ext_x', mods).map((r) => r.id), ['c'], '只看 internal 模块的 uses 数组');
  assert.deepEqual(L.consRows('ext_nope', mods), []);
  assert.deepEqual(L.consRows('ext_x', undefined), []);
});

test('consumer list HTML uses the port-list row grammar; unknown ids yield an empty list', () => {
  const html = L.consListHtml('ext_fs', 'zh', BI_IR.modules, BI_M);
  assert.equal(rowCount(html), 1, '一行一个消费者');
  assert.ok(html.includes('readConfig') && html.includes('readFileSync') && html.includes('>fs<'),
    '行是 `消费者 → 该 external 的 input → external`');
  const path = L.consListHtml('ext_path', 'zh', BI_IR.modules, BI_M);
  assert.equal(rowCount(path), 2, 'default 导入的 external 也有两行');
  assert.ok(path.includes('>default<'), '中间格是该 external 的 input（与 group 段同一套读法）');
  assert.equal(rowCount(L.consListHtml('ext_fs', 'en', BI_IR.modules, BI_M)), 1, '切语言行数不变');
  assert.strictEqual(L.consListHtml('ext_nope', 'zh', BI_IR.modules, BI_M), '', '未知 id 不抛错、返回空串');
  assert.strictEqual(L.consListHtml('ext_fs', 'zh', [], BI_M), '', '空模块表同理');
});

test('the sidebar reverse index lists consumers with the · / +M convention, capped at three', () => {
  // 反向索引 = 「谁用了它」（ADR-0011 决策三）：侧栏卡片宽，用 uniqJoin 的 cap = 3。
  assert.equal(L.consIndex('ext_fs', BI_IR.modules), 'readConfig');
  assert.equal(L.consIndex('ext_path', BI_IR.modules), 'readConfig · parseConfig');
  const four = [{ id: 'ext_lib', label: 'lib', type: 'external', description: 'x', input: ['default'] }]
    .concat(['A', 'B', 'C', 'D'].map((label) => ({
      id: label.toLowerCase(), label, type: 'internal', uses: ['ext_lib'],
    })));
  assert.equal(L.consIndex('ext_lib', four), 'A · B · C +1',
    '4 个消费者 → 前 3 个 + `+1`（侧栏卡片比标签格宽一档）');
  assert.equal(L.consIndex('ext_none', four), '', '没有消费者就是空串，不抛错');
});

// ---- depsHtml：叶子弹窗的依赖行（ADR-0011 决策三） ----
test('the leaf dependency line reads 依赖 / 宿主, each half falling back to a dash', () => {
  const rc = BI_IR.modules.filter((m) => m.id === 'read_config')[0];
  const zh = L.depsHtml(rc, 'zh', BI_M);
  assert.ok(zh.indexOf('依赖') !== -1, '依赖那一半有标头');
  assert.ok(zh.includes('fs · node:path'), '依赖那一半列 external 的包名（不译），多个用 `·` 收尾');
  assert.ok(zh.includes('宿主') && zh.includes('process.cwd'), '宿主那一半是 runtime 的属性路径');
  // 行内标头**不复用**侧栏那个分节标题键 `deps`（它的值是双语的「依赖 Dependencies」），
  // 否则中文行会读成「依赖 Dependencies fs · …」，与 ADR-0011 写的「依赖 … · 宿主 …」不符。
  assert.ok(zh.indexOf('Dependencies') === -1, '行内标头不带分节标题里的英文');
  const en = L.depsHtml(rc, 'en', BI_M);
  assert.ok(en.indexOf('Dependency') !== -1 && en.indexOf('Host') !== -1, '两半标头跟着语言切换');
  assert.ok(en.indexOf('Dependencies') === -1, 'en 的行内标头与分节标题也不是同一个键');

  // 两半各自为空时显式画「—」（ADR-0006 的空端口惯例）：静默留白会被读成「这行不该有」。
  const bare = L.depsHtml({ id: 'x', label: 'x', type: 'internal' }, 'zh', {});
  assert.equal((bare.match(/>—</g) || []).length, 2, '两半各画一个「—」');
  assert.ok(bare.indexOf('依赖') !== -1 && bare.indexOf('宿主') !== -1, '空的时候标头也还在');

  // uses 指向的 id 在表里查不到（validate 会挡，viewer 不该抛）：退回 id 本身。
  const ghost = L.depsHtml({ id: 'y', label: 'y', type: 'internal', uses: ['ext_ghost'] }, 'zh', {});
  assert.ok(ghost.includes('ext_ghost'));
});

// ---- extUseRows / extUseHtml：group 弹窗第二段「成员直连外部」（ADR-0011 决策三） ----
test('member-external rows merge a group members uses by external, ordered by external id', () => {
  const members = { read_config: true, parse_config: true };
  const rows = L.extUseRows(members, BI_IR.modules);
  assert.deepEqual(rows.map((r) => r.id), ['ext_fs', 'ext_path'], '行 = 一个 external，按 id 稳定排序');
  assert.deepEqual(rows[0].members, ['read_config'], '成员保 IR 顺序');
  assert.deepEqual(rows[1].members, ['read_config', 'parse_config'], '两个成员归并到同一行');
  assert.deepEqual(L.extUseRows({ parse_config: true }, BI_IR.modules).map((r) => r.id), ['ext_path'],
    '只看本组成员：组外的消费者不进这一行');
  assert.deepEqual(L.extUseRows({ build_index: true }, BI_IR.modules), [], '成员没声明 uses → 没有行');
  assert.deepEqual(L.extUseRows({}, BI_IR.modules), []);
});

test('member-external HTML reuses the port-list row grammar', () => {
  const html = L.extUseHtml({ read_config: true, parse_config: true }, BI_IR.modules, BI_M);
  assert.equal(rowCount(html), 2, '行数 = 归并后的 external 数');
  assert.ok(html.includes('readConfig'), '成员名在行首（源码标识符，不译）');
  assert.ok(html.includes('readFileSync') && html.includes('>fs<'),
    '行是 `成员们 → 该 external 的 input → external 名`');
  assert.ok(html.includes('>node:path<'), '第二个 external 是包名不译');
  assert.strictEqual(L.extUseHtml({ build_index: true }, BI_IR.modules, BI_M), '',
    '一条 uses 都没有 → 空串（调用方画「—」）');
  // 中间格与消费者清单是同一处（extInputCell）：external 没登记具名成员时画「—」而不是留空。
  const bare = [{ id: 'm1', label: 'M1', type: 'internal', uses: ['ext_e'] }, { id: 'ext_e', label: 'ext', type: 'external', input: [] }];
  assert.ok(L.extUseHtml({ m1: true }, bare, { m1: { label: 'M1' } }, 'zh').includes('>—<'),
    'input 为空 → 中间格画「—」');
});

test('member-external rows collapse many members with the narrow-surface cap of two', () => {
  const many = ['a', 'b', 'c', 'd'].map((id) => ({
    id, label: id.toUpperCase(), type: 'internal', uses: ['ext_x'],
  }));
  const memberIds = { a: true, b: true, c: true, d: true };
  const M = {}; many.forEach((m) => (M[m.id] = m));
  const html = L.extUseHtml(memberIds, many, M);
  assert.ok(html.includes('A · B +2'), '成员名超过 3 个时按缺省的 2 折叠（弹窗面窄，与边中点标签同一套）');
});

test('the proxy-era wording is gone: no consumersBlind, and the empty line names its basis', () => {
  ['consumers', 'consumersNone'].forEach((k) => {
    assert.ok(k in L.T.zh && k in L.T.en, `缺 ${k}`);
  });
  assert.ok(!('consumersBlind' in L.T.zh) && !('consumersBlind' in L.T.en),
    '「无具名导入可匹配」是代理估算的说明，随数据源换到 uses 一起删除');
  assert.equal(L.T.zh.externalTag, 'EXTERNAL');
  assert.equal(L.T.zh.consumers.indexOf('消费者'), 0, '沿用「依赖 Dependencies」的写法');
  assert.notEqual(L.T.zh.consumers, L.T.en.consumers, '分节标题随语言切换');
  assert.notEqual(L.T.zh.consumersNone, '无', '空清单仍明说依据，不是光秃秃的「无」');
  ['zh', 'en'].forEach((lang) => {
    assert.ok(L.T[lang].consumersNone.indexOf('uses') !== -1,
      `${lang} 的空态要说清依据是 uses 字段，不能只说「无」`);
  });
});

// ---- fwdPath / feedbackPath：入边端点外移 ~8px（ADR-0009） ----
test('forward edge lands ~8px above the target box top edge', () => {
  const a = { x: 0, y: 0 }, b = { x: 0, y: 300 };
  const sA = { w: 236, h: 78 }, sB = { w: 236, h: 78 };
  const p = L.fwdPath(a, b, sA, sB);
  assert.ok(p.d.startsWith('M118 78 '), '出边起点仍在源盒底边（只动入端）');
  assert.equal(Number(p.d.slice(p.d.lastIndexOf(' ') + 1)), b.y - 8, '入端 = 目标盒上边缘 - 8px');
});

// ---- 边的可点单元：命中路径 + 中点标签 + <title>，同一个带边身份的组（ADR-0010） ----
// 一条边在浏览器里就是一个 <g class="edge">：细线点不中，所以组里另有一条透明的加宽路径
// 兜住命中区；中点标签的白色底衬也在组里。点哪个子元素都冒泡到同一个组 = 同一条边。
const pathsOf = (svg) => [...svg.matchAll(/<path ([^>]*)\/>/g)].map((m) => m[1]);
const attr = (s, k) => (new RegExp('\\b' + k + '="([^"]*)"').exec(s) || [])[1];

test('a forward edge is one clickable unit: edge identity, hit path, mid label, hover title', () => {
  const a = { x: 0, y: 0 }, b = { x: 0, y: 300 };
  const p = L.fwdPath(a, b, { w: 236, h: 78 }, { w: 236, h: 78 });
  const svg = L.fwdEdgeSvg({ from: 'grp_io', to: 'build_index' }, p, '传入解析后的配置', 'mk1');

  assert.ok(svg.startsWith('<g class="edge"') && svg.endsWith('</g>'), '整条边收进一个可点单元');
  assert.equal(attr(svg, 'data-from'), 'grp_io', '单元带边身份（from）');
  assert.equal(attr(svg, 'data-to'), 'build_index', '单元带边身份（to）');

  const paths = pathsOf(svg);
  assert.equal(paths.length, 2, '一条可见路径 + 一条命中路径');
  assert.deepEqual(paths.map((a2) => attr(a2, 'd')), [p.d, p.d], '命中路径与可见路径是同一条 d');
  assert.equal(attr(paths[0], 'stroke-width'), '1.5', '可见路径的粗细不变（读者看到的还是细线）');
  assert.equal(attr(paths[0], 'stroke'), '#b6c2d1');
  assert.ok(Number(attr(paths[1], 'stroke-width')) >= 10, '命中路径描边加宽到可点范围');
  assert.equal(attr(paths[1], 'stroke'), 'transparent', '命中路径不改变画面，只兜命中');
  assert.ok(/pointer-events="stroke"/.test(paths[1]), '透明路径靠 pointer-events 吃点击');

  assert.ok(svg.includes('<title>传入解析后的配置</title>'), 'hover 用原生 title，内容是当前语言的中点短语');
  assert.ok(svg.includes('>传入解析后的配置</text>'), '中点标签就在同一个单元里');
  assert.ok(/<rect class="edge-hit-label"[^>]*fill="#ffffff"/.test(svg), '中点标签有白色底衬');
});

test('a feedback edge is a clickable unit too, and its title carries the ↺ marker', () => {
  const a = { x: 0, y: 300 }, b = { x: 0, y: 0 };
  const pa = L.feedbackPath(a, b, { w: 236, h: 78 }, { w: 236, h: 78 }, 500);
  const svg = L.backEdgeSvg({ from: 'b', to: 'a' }, pa.d, '传入校验回执', 490, pa.mid, 170, 'mk2');
  assert.equal(attr(svg, 'data-from'), 'b');
  assert.equal(attr(svg, 'data-to'), 'a');
  assert.equal(pathsOf(svg).length, 2, '反馈弧也有命中路径');
  assert.ok(svg.includes('<title>↺ 传入校验回执</title>'));
  assert.ok(svg.includes('>↺ 传入校验回执</text>'));
});

test('the drawn mid label is truncated but the hover title keeps the whole phrase', () => {
  // 截断正是 hover 的用处（与节点盒里显示全名同一条理由，ADR-0010）。
  const a = { x: 0, y: 0 }, b = { x: 0, y: 300 };
  const p = L.fwdPath(a, b, { w: 236, h: 78 }, { w: 236, h: 78 });
  const long = '把解析后的配置对象原样传给下游用来按 id 建立查找索引并保留来源标记';
  const svg = L.fwdEdgeSvg({ from: 'a', to: 'b' }, p, long, 'mk1');
  const drawn = /<text[^>]*>([^<]*)<\/text>/.exec(svg)[1];
  assert.ok(drawn.length < long.length && drawn.endsWith('…'), '画出来的是截断后的一段');
  assert.ok(svg.includes('<title>' + long + '</title>'), 'hover 给完整的那句话');
  const back = /<rect class="edge-hit-label"[^>]*width="([\d.]+)"/.exec(svg);
  assert.ok(Number(back[1]) <= 246, '白底衬按画出来的那段定宽，不按整句（否则会盖住整条边）');
});

test('a node box carries its full name as the native hover title', () => {
  const M = { m1: { id: 'm1', label: 'extractQualityArgs', description: '取质量参数' } };
  const zh = L.nodeSvg('m1', 0, 0, null, 'zh', M, {});
  assert.ok(zh.includes('<title>extractQualityArgs</title>'), '节点 hover 显全名（名字不译）');
});

test('a group hover title follows the display language', () => {
  assert.ok(L.nodeSvg(GRP_ID, 0, 0, null, 'zh', GM, GG).includes('<title>参数解析</title>'));
  assert.ok(L.nodeSvg(GRP_ID, 0, 0, null, 'en', GM, GG).includes('<title>arg parsing</title>'));
});

test('feedback arc inbound endpoint is lifted by the same gap', () => {
  const a = { x: 0, y: 300 }, b = { x: 0, y: 0 };
  const sA = { w: 236, h: 78 }, sB = { w: 236, h: 78 };
  const p = L.feedbackPath(a, b, sA, sB, 500);
  const m = p.d.match(/([-\d.]+) ([-\d.]+)$/); // 弧的最后一个 C 段终点
  assert.equal(Number(m[2]), b.y - 8, '反馈弧入端同样外移 8px');
  assert.equal(Number(m[1]), 118, '入端 x 仍是目标盒宽中点');
});

// ---- aggregateEdges：同向去重 / 折叠 ----
test('aggregateEdges merges same-direction connections into one edge', () => {
  const es = L.aggregateEdges([
    { from: 'a', to: 'b', label: 'x' },
    { from: 'a', to: 'b', label: 'y' },
    { from: 'b', to: 'a', label: 'z' },
  ]);
  assert.equal(es.length, 2);
  const ab = es[0];
  assert.equal(ab.from, 'a');
  assert.equal(ab.to, 'b');
  assert.equal(ab.conns.length, 2);
});

test('aggregateEdges collapse groups parallel member edges, conns keep real endpoints', () => {
  const g = { m1: 'g1', m2: 'g1', n1: 'g2', n2: 'g2' };
  const es = L.aggregateEdges([
    { from: 'm1', to: 'n1', label: 'a' },
    { from: 'm2', to: 'n2', label: 'b' },
    { from: 'm1', to: 'm2', label: 'self' },
  ], (c) => ({ from: g[c.from], to: g[c.to] }));
  const cross = es.filter((e) => e.from !== e.to);
  assert.equal(cross.length, 1, '两成员各自出边折叠成一条组间边');
  assert.equal(cross[0].conns.length, 2);
  assert.equal(cross[0].conns[0].from, 'm1', 'conns 保留原始模块端点');
  assert.equal(cross[0].conns[1].from, 'm2');
});

// ---- 文本宽度 ----
test('fitWidth leaves short text intact and truncates long text with ellipsis', () => {
  assert.equal(L.fitWidth('hi', 12, 100), 'hi');
  const long = '这是一段非常长的中文描述文本，用来验证单行超宽时会被截断并追加省略号。';
  const out = L.fitWidth(long, 12, 120);
  assert.ok(out.length < long.length);
  assert.ok(out.endsWith('…'));
});

test('wrap2 yields at most two lines and clips the second when overlong', () => {
  const one = L.wrap2('短', 12, 100);
  assert.deepEqual(one, ['短', '']);
  const s = 'a'.repeat(400); // 一定会溢出两行
  const two = L.wrap2(s, 12, 100);
  assert.equal(two.length, 2);
  assert.ok(two[1].endsWith('…'));
});

// ---- UI 文案表：查看器固定文案跟着语言切换（不属于 IR） ----
test('UI copy table has the same key set in both languages', () => {
  const zh = Object.keys(L.T.zh).sort();
  const en = Object.keys(L.T.en).sort();
  assert.deepEqual(zh, en, '两种语言的键必须一一对应');
  assert.ok(zh.length >= 12, '文案表应覆盖全部固定文案');
  Object.keys(L.T).forEach((lang) => {
    Object.keys(L.T[lang]).forEach((k) => {
      assert.strictEqual(typeof L.T[lang][k], 'string', `${lang}.${k} 应为字符串`);
      assert.ok(L.T[lang][k].length > 0, `${lang}.${k} 不应为空`);
    });
  });
});

test('UI copy table covers the wording the ticket lists', () => {
  const keys = ['input', 'output', 'deps', 'innerFlow', 'boundary', 'groupTag', 'internalTag',
    'dash', 'members', 'source', 'hint', 'none', 'line', 'groupMeta', 'feedback',
    'membersExt', 'host', 'dep'];
  keys.forEach((k) => {
    assert.ok(k in L.T.zh, `zh 缺 ${k}`);
    assert.ok(k in L.T.en, `en 缺 ${k}`);
  });
  assert.equal(L.T.zh.input, '输入');
  assert.equal(L.T.zh.output, '输出');
  assert.ok(L.T.zh.deps.indexOf('依赖') === 0, '依赖栏在中文里保留「依赖 Dependencies」的写法');
  assert.equal(L.T.zh.innerFlow, '内部数据流');
  // ADR-0011 决策三：group 弹窗的第一段从「边界数据流」改叫「组间边」（原话说的是**同一段**）。
  assert.equal(L.T.zh.boundary, '组间边');
  assert.equal(L.T.zh.membersExt, '成员直连外部');
  assert.equal(L.T.zh.host, '宿主');
  assert.equal(L.T.en.host, 'Host');
  assert.equal(L.T.zh.dash, '—', '空方向的破折号');
  // GROUP / INTERNAL 是 schema 词汇（与 IR 的 type 取值同名），两种语言下保持同一写法。
  assert.equal(L.T.zh.groupTag, 'GROUP');
  assert.equal(L.T.en.groupTag, 'GROUP');
  assert.equal(L.T.zh.internalTag, 'INTERNAL');
  assert.equal(L.T.en.internalTag, 'INTERNAL');
  // 其余固定文案确实换了一门语言。
  ['input', 'output', 'deps', 'innerFlow', 'boundary', 'members', 'source', 'hint', 'none']
    .forEach((k) => assert.notEqual(L.T.en[k], L.T.zh[k], `${k} 应随语言切换`));
});

test('tr resolves UI copy by language with a zh fallback, fmt fills {n}', () => {
  assert.equal(L.tr('en', 'members'), 'Member modules');
  assert.equal(L.tr('zh', 'members'), '成员模块');
  assert.equal(L.tr('nope', 'members'), '成员模块', '非法语言回落到默认语言');
  assert.equal(L.fmt(L.tr('zh', 'line'), 12), '第 12 行');
  assert.equal(L.fmt(L.tr('en', 'line'), 12), 'line 12');
  assert.equal(L.fmt(L.tr('zh', 'groupMeta'), 3), 'group · 3 模块');
  assert.equal(L.fmt(L.tr('en', 'groupMeta'), 3), 'group · 3 modules');
});
