'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { render } = require('../render.js');

const IR = {
  meta: {
    title: 'parser.js',
    subtitle: 'Parses config and processes records.',
    input: ['config.json'],
    output: ['records'],
  },
  modules: [
    { id: 'ext_fs', label: 'fs', type: 'external', description: 'Node filesystem', input: ['readFileSync'] },
    { id: 'parse', label: 'parseConfig', type: 'internal', description: 'Parses raw config into an object', detail: 'Parses raw config text into an object.', source: 'function parseConfig(raw) {}' },
    { id: 'proc', label: 'processRecords', type: 'internal', description: 'Transforms records', detail: 'Transforms records.', source: 'function processRecords() {}' },
  ],
  connections: [{ from: 'parse', to: 'proc', label: 'config' }],
};

test('render produces an HTML document', () => {
  const html = render(IR);
  assert.ok(/<!doctype html>/i.test(html));
  assert.ok(/<html[\s>]/i.test(html));
});

test('render is self-contained: no external resources', () => {
  const html = render(IR);
  assert.ok(!/<link\b/i.test(html), 'no external <link>');
  assert.ok(!/<script\b[^>]*\bsrc\s*=/i.test(html), 'no external <script src>');
  assert.ok(!/@import\b/i.test(html), 'no CSS @import');
  assert.ok(!/\bhref\s*=\s*["']https?:/i.test(html), 'no remote href');
  assert.ok(!/\bsrc\s*=\s*["']https?:/i.test(html), 'no remote src');
  assert.ok(!/url\(\s*["']?https?:/i.test(html), 'no remote url()');
});

test('render embeds IR that round-trips', () => {
  const html = render(IR);
  const m = html.match(/<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/);
  assert.ok(m, 'embedded IR script block exists');
  const parsed = JSON.parse(m[1]);
  assert.deepEqual(parsed, IR);
});

test('render output contains every module label', () => {
  const html = render(IR);
  for (const mod of IR.modules) {
    assert.ok(html.includes(mod.label), `missing label ${mod.label}`);
  }
});

test('render output contains client viewer markers', () => {
  const html = render(IR);
  assert.ok(html.includes('flowViewport'), 'Flow viewport marker present');
  assert.ok(html.includes('detailOverlay'), 'detail overlay marker present');
  assert.ok(html.includes('vB-tbl'), 'Index table marker present');
});

test('render ships the ADR-0007 layout system (CSS + viewer kernel)', () => {
  const html = render(IR);
  // 成员网格 / 子图 viewport 的 CSS
  assert.ok(html.includes('.vA-mgrid'), 'member-grid CSS present');
  assert.ok(html.includes('.vA-flow-sub'), 'sub-flow viewport CSS present');
  // viewer 内核含共享布局/反馈标记（内联 JS 源码，非运行时 DOM）
  assert.ok(html.includes('feedbackPath'), 'feedback-arc painter present');
  assert.ok(html.includes('components('), 'WCC splitter present');
  assert.ok(html.includes('↺'), 'feedback glyph present');
});

test('renderer script parses without syntax error', () => {
  const html = render(IR);
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  const renderer = scripts
    .map((m) => ({ attrs: m[1], body: m[2] }))
    .find((s) => !/type\s*=\s*["']application\/json/i.test(s.attrs));
  assert.ok(renderer, 'renderer script block present');
  assert.doesNotThrow(() => new Function(renderer.body));
});

const GROUPED_IR = {
  meta: IR.meta,
  groups: [
    { id: 'grp_core', label: '核心处理', description: '解析并处理记录' },
  ],
  modules: IR.modules.map((m) => (m.type === 'internal' ? { ...m, group: 'grp_core' } : { ...m })),
  connections: IR.connections,
};

test('grouped IR round-trips through render', () => {
  const html = render(GROUPED_IR);
  const m = html.match(/<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/);
  assert.ok(m, 'embedded IR script block exists');
  const parsed = JSON.parse(m[1]);
  assert.deepEqual(parsed, GROUPED_IR);
});

// ---- 双语 fixture（expand 步：{zh,en} 与普通字符串并存） ----
const BI_IR = require('../examples/sample.bilingual.ir.json');

test('bilingual IR round-trips through render', () => {
  const html = render(BI_IR);
  const m = html.match(/<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/);
  assert.ok(m, 'embedded IR script block exists');
  assert.deepEqual(JSON.parse(m[1]), BI_IR);
});

test('render output carries the language switcher', () => {
  const html = render(BI_IR);
  assert.ok(html.includes('id="langZh"'), '中文按钮在产物里');
  assert.ok(html.includes('id="langEn"'), 'EN 按钮在产物里');
  assert.ok(html.includes('.vA-lang-btn'), '切换器样式在产物里');
  assert.ok(!/localStorage/.test(html), '语言不记忆：产物里不出现 localStorage');
});

test('both languages of the prose are embedded in the artifact', () => {
  const html = render(BI_IR);
  assert.ok(html.includes('读取并解析 JSON 配置'), '中文副标题在产物里');
  assert.ok(html.includes('Reads and parses a JSON config'), '英文副标题在产物里');
  assert.ok(html.includes('读取与解析'), '中文分组名在产物里');
  assert.ok(html.includes('Reading and parsing'), '英文分组名在产物里');
  assert.ok(html.includes('配置文件原文'), '中文连线 label 在产物里');
  assert.ok(html.includes('raw config text'), '英文连线 label 在产物里');
  // 名字不译：两种语言下都只有原样的源码标识符 / 包名
  assert.ok(html.includes('readConfig') && html.includes('"fs"'), '模块名与包名原样保留');
});

test('bilingual artifact is self-contained too', () => {
  const html = render(BI_IR);
  assert.ok(!/<link\b/i.test(html), 'no external <link>');
  assert.ok(!/<script\b[^>]*\bsrc\s*=/i.test(html), 'no external <script src>');
  assert.ok(!/url\(\s*["']?https?:/i.test(html), 'no remote url()');
});
