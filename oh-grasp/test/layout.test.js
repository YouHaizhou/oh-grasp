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

// ---- edgeLabel：聚合去重 / 上限 ----
test('edgeLabel dedupes and truncates at 3 unique labels', () => {
  assert.equal(L.edgeLabel({ conns: [{ label: 'x' }, { label: 'x' }] }), 'x');
  assert.equal(L.edgeLabel({ conns: [{ label: 'a' }, { label: 'b' }] }), 'a · b');
  const many = ['a', 'b', 'c', 'd'].map((label) => ({ label }));
  assert.equal(L.edgeLabel({ conns: many }), 'a · b +2');
  assert.equal(L.edgeLabel({ conns: [] }), '');
});

// ---- countPorts：端口的 ×N 计数 ----
test('countPorts tallies per-direction connection counts', () => {
  const c = L.countPorts([
    { from: 'a', to: 'b', conns: [{}, {}, {}] },
    { from: 'b', to: 'a', conns: [{}] },
  ]);
  assert.deepEqual(c.a, { in: 1, out: 3 });
  assert.deepEqual(c.b, { in: 3, out: 1 });
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
