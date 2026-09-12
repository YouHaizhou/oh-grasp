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
      const prev = g.pos[row[i - 1]], cur = g.pos[row[i]];
      assert.ok(cur.x >= prev.x + 236, 'horizontal gap respected between same-row boxes');
    }
  });
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

// ---- fwdPath / feedbackPath：入边端点外移 ~8px（ADR-0009） ----
test('forward edge lands ~8px above the target box top edge', () => {
  const a = { x: 0, y: 0 }, b = { x: 0, y: 300 };
  const sA = { w: 236, h: 78 }, sB = { w: 236, h: 78 };
  const p = L.fwdPath(a, b, sA, sB);
  assert.ok(p.d.startsWith('M118 78 '), '出边起点仍在源盒底边（只动入端）');
  assert.equal(Number(p.d.slice(p.d.lastIndexOf(' ') + 1)), b.y - 8, '入端 = 目标盒上边缘 - 8px');
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
    'dash', 'members', 'source', 'hint', 'none', 'line', 'groupMeta', 'feedback'];
  keys.forEach((k) => {
    assert.ok(k in L.T.zh, `zh 缺 ${k}`);
    assert.ok(k in L.T.en, `en 缺 ${k}`);
  });
  assert.equal(L.T.zh.input, '输入');
  assert.equal(L.T.zh.output, '输出');
  assert.ok(L.T.zh.deps.indexOf('依赖') === 0, '依赖栏在中文里保留「依赖 Dependencies」的写法');
  assert.equal(L.T.zh.innerFlow, '内部数据流');
  assert.equal(L.T.zh.boundary, '边界数据流');
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
