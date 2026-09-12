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
