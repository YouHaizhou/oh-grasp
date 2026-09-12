'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { validate } = require('../validate.js');

function validIR() {
  return {
    meta: {
      title: 'parser.js',
      subtitle: 'Parses config and processes records.',
      input: ['config.json'],
      output: ['records'],
    },
    modules: [
      { id: 'ext_fs', label: 'fs', type: 'external', description: 'Node filesystem', input: ['readFileSync'] },
      { id: 'parse', label: 'parseConfig', type: 'internal', description: 'Parses raw config into an object', detail: 'Parses raw config text into an object.', source: 'function parseConfig(raw) {\n  return JSON.parse(raw);\n}' },
      { id: 'proc', label: 'processRecords', type: 'internal', description: 'Transforms records', detail: 'Transforms records.', source: 'function processRecords() {}' },
    ],
    connections: [{ from: 'parse', to: 'proc', label: 'config' }],
  };
}

const SOURCE = [
  "const fs = require('fs');",
  'function parseConfig(raw) {',
  '  return JSON.parse(raw);',
  '}',
  'function processRecords() {}',
].join('\n');

test('valid IR passes without source', () => {
  const r = validate(validIR());
  assert.equal(r.ok, true);
  assert.deepEqual(r.errors, []);
});

test('valid IR passes with matching source', () => {
  const r = validate(validIR(), SOURCE);
  assert.equal(r.ok, true);
});

test('non-object IR fails', () => {
  const r = validate('nope');
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.path === '$'));
});

test('missing meta fails with precise path', () => {
  const ir = validIR();
  delete ir.meta;
  const r = validate(ir);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.path === 'meta'));
});

test('missing meta.title fails', () => {
  const ir = validIR();
  delete ir.meta.title;
  const r = validate(ir);
  assert.ok(r.errors.some((e) => e.path === 'meta.title'));
});

test('empty meta.subtitle fails', () => {
  const ir = validIR();
  ir.meta.subtitle = '  ';
  const r = validate(ir);
  assert.ok(r.errors.some((e) => e.path === 'meta.subtitle'));
});

test('non-array meta.input fails', () => {
  const ir = validIR();
  ir.meta.input = 'config.json';
  const r = validate(ir);
  assert.ok(r.errors.some((e) => e.path === 'meta.input'));
});

test('modules not an array fails', () => {
  const ir = validIR();
  ir.modules = 'nope';
  const r = validate(ir);
  assert.ok(r.errors.some((e) => e.path === 'modules'));
});

test('empty modules fails', () => {
  const ir = validIR();
  ir.modules = [];
  const r = validate(ir);
  assert.ok(r.errors.some((e) => e.path === 'modules'));
});

test('module missing id fails with path', () => {
  const ir = validIR();
  delete ir.modules[0].id;
  const r = validate(ir);
  assert.ok(r.errors.some((e) => e.path === 'modules[0].id'));
});

test('module bad type fails', () => {
  const ir = validIR();
  ir.modules[0].type = 'mystery';
  const r = validate(ir);
  assert.ok(r.errors.some((e) => e.path === 'modules[0].type'));
});

test('duplicate module id fails', () => {
  const ir = validIR();
  ir.modules[1].id = 'ext_fs';
  const r = validate(ir);
  assert.ok(r.errors.some((e) => e.path === 'modules[1].id'));
});

test('external module missing input fails', () => {
  const ir = validIR();
  delete ir.modules[0].input;
  const r = validate(ir);
  assert.ok(r.errors.some((e) => e.path === 'modules[0].input'));
});

test('external module input with non-string fails', () => {
  const ir = validIR();
  ir.modules[0].input = ['readFileSync', 42];
  const r = validate(ir);
  assert.ok(r.errors.some((e) => e.path === 'modules[0].input'));
});

test('internal module missing detail fails', () => {
  const ir = validIR();
  delete ir.modules[1].detail;
  const r = validate(ir);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.path === 'modules[1].detail'));
});

test('internal module missing source fails', () => {
  const ir = validIR();
  delete ir.modules[1].source;
  const r = validate(ir);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.path === 'modules[1].source'));
});

test('external module does not require detail or source', () => {
  const ir = validIR();
  delete ir.modules[0].detail;
  delete ir.modules[0].source;
  const r = validate(ir);
  assert.equal(r.ok, true);
});

test('connection with dangling from fails', () => {
  const ir = validIR();
  ir.connections.push({ from: 'nope', to: 'proc', label: 'x' });
  const r = validate(ir);
  assert.ok(r.errors.some((e) => e.path === 'connections[1].from'));
});

test('connection to external module fails', () => {
  const ir = validIR();
  ir.connections.push({ from: 'parse', to: 'ext_fs', label: 'x' });
  const r = validate(ir);
  assert.ok(r.errors.some((e) => e.path === 'connections[1].to'));
});

test('connection missing label fails', () => {
  const ir = validIR();
  ir.connections[0].label = '';
  const r = validate(ir);
  assert.ok(r.errors.some((e) => e.path === 'connections[0].label'));
});

test('internal module missing from source fails existence check', () => {
  const ir = validIR();
  ir.modules[1].label = 'doesNotExist';
  const r = validate(ir, SOURCE);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.path === 'modules[1].label'));
});

test('existence check skipped when source omitted', () => {
  const ir = validIR();
  ir.modules[1].label = 'doesNotExist';
  const r = validate(ir);
  assert.equal(r.ok, true);
});

test('source not a substring of the file fails', () => {
  const ir = validIR();
  ir.modules[1].source = 'function madeUp() { return 42; }';
  const r = validate(ir, SOURCE);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.path === 'modules[1].source'));
});

test('source matching after whitespace normalization passes', () => {
  const ir = validIR();
  ir.modules[1].source = 'function parseConfig(raw) {   return JSON.parse(raw); }';
  const r = validate(ir, SOURCE);
  assert.equal(r.ok, true);
});

test('sourceLine integer passes', () => {
  const ir = validIR();
  ir.modules[1].sourceLine = 2;
  const r = validate(ir, SOURCE);
  assert.equal(r.ok, true);
});

test('sourceLine non-integer fails', () => {
  const ir = validIR();
  ir.modules[1].sourceLine = 'two';
  const r = validate(ir);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.path === 'modules[1].sourceLine'));
});

test('sourceLine optional when omitted', () => {
  const ir = validIR();
  const r = validate(ir, SOURCE);
  assert.equal(r.ok, true);
});

// === grouping ===
function validGroupedIR() {
  const ir = validIR();
  ir.groups = [
    { id: 'grp_core', label: '核心处理', description: '解析并处理记录' },
  ];
  ir.modules[1].group = 'grp_core';
  ir.modules[2].group = 'grp_core';
  return ir;
}

test('grouped IR passes validation', () => {
  const r = validate(validGroupedIR());
  assert.equal(r.ok, true);
});

test('grouped IR passes existence check with abstract group label', () => {
  // group label '核心处理' is not a source identifier, but groups are exempt from the existence check
  const r = validate(validGroupedIR(), SOURCE);
  assert.equal(r.ok, true);
});

test('group missing label fails', () => {
  const ir = validGroupedIR();
  delete ir.groups[0].label;
  const r = validate(ir);
  assert.ok(r.errors.some((e) => e.path === 'groups[0].label'));
});

test('group missing description fails', () => {
  const ir = validGroupedIR();
  delete ir.groups[0].description;
  const r = validate(ir);
  assert.ok(r.errors.some((e) => e.path === 'groups[0].description'));
});

test('duplicate group id fails', () => {
  const ir = validGroupedIR();
  ir.groups.push({ id: 'grp_core', label: '另一个', description: 'x' });
  const r = validate(ir);
  assert.ok(r.errors.some((e) => e.path === 'groups[1].id'));
});

test('group with fewer than 2 members fails', () => {
  const ir = validIR();
  ir.groups = [{ id: 'grp_x', label: 'X', description: 'x' }];
  ir.modules[1].group = 'grp_x';
  const r = validate(ir);
  assert.ok(r.errors.some((e) => e.path === 'groups[0]'));
});

test('internal group referencing unknown group fails', () => {
  const ir = validGroupedIR();
  ir.modules[1].group = 'grp_missing';
  const r = validate(ir);
  assert.ok(r.errors.some((e) => e.path === 'modules[1].group'));
});

test('internal group non-string fails', () => {
  const ir = validGroupedIR();
  ir.modules[1].group = 42;
  const r = validate(ir);
  assert.ok(r.errors.some((e) => e.path === 'modules[1].group'));
});

test('removed group summary fields are tolerated (backward compat)', () => {
  // ADR-0006: summaries removed from the contract; viewer derives I/O from edges.
  // Leftover fields from an older IR must not fail validation.
  const ir = validGroupedIR();
  ir.groups[0].inputSummary = '旧版遗留';
  ir.groups[0].outputSummary = 42;
  const r = validate(ir);
  assert.equal(r.ok, true);
});

test('ungrouped leaf alongside grouped modules passes', () => {
  const ir = validGroupedIR();
  ir.modules.push({ id: 'util', label: 'helper', type: 'internal', description: 'Utility', detail: 'Utility.', source: 'function helper() {}' });
  const r = validate(ir);
  assert.equal(r.ok, true);
});

test('no groups is backward compatible', () => {
  const r = validate(validIR());
  assert.equal(r.ok, true);
});

test('groups not an array fails', () => {
  const ir = validIR();
  ir.groups = 'nope';
  const r = validate(ir);
  assert.ok(r.errors.some((e) => e.path === 'groups'));
});

// === 双语（expand 步：新旧两种形态都收，不做「两种语言都必填」的收紧） ===
const BI_IR = require('../examples/sample.bilingual.ir.json');

test('bilingual IR passes validation', () => {
  const r = validate(BI_IR);
  assert.equal(r.ok, true);
  assert.deepEqual(r.errors, []);
});

test('every connection of the bilingual fixture carries the four segments in both languages', () => {
  // 样例是新形态的**演示样板**：中点那句话（label）与点开的四段都得在它身上看得到，
  // 否则「点边读四句」这条能力在仓库里没有任何可见的凭据。
  assert.ok(BI_IR.connections.length >= 4, '样例要有多条 connection 可演示');
  BI_IR.connections.forEach((c, i) => {
    assert.ok(c.description, `connections[${i}] 缺 description`);
    for (const lang of ['zh', 'en']) {
      for (const k of ['source', 'process', 'output', 'purpose']) {
        const v = c.description[lang] && c.description[lang][k];
        assert.ok(typeof v === 'string' && v.trim() !== '',
          `connections[${i}].description.${lang}.${k} 不能为空`);
      }
    }
  });
});

test('monolingual IR keeps passing next to the bilingual one', () => {
  // 旧产物（散文字段全是普通字符串）不受影响 —— expand 步的兼容保证。
  const r = validate(validIR());
  assert.equal(r.ok, true);
});

test('every prose field accepts {zh,en}', () => {
  const ir = validGroupedIR();
  ir.meta.subtitle = { zh: '解析并处理记录', en: 'Parses and processes records' };
  ir.meta.input = [{ zh: '配置路径', en: 'config path' }];
  ir.meta.output = [{ zh: '记录', en: 'records' }];
  ir.groups[0].label = { zh: '核心处理', en: 'Core processing' };
  ir.groups[0].description = { zh: '解析并处理记录', en: 'Parses and processes records' };
  ir.modules[1].description = { zh: '解析配置', en: 'Parses the config' };
  ir.modules[1].detail = { zh: '把原文解析成对象。', en: 'Parses the raw text into an object.' };
  ir.connections[0].label = { zh: '配置对象', en: 'config object' };
  const r = validate(ir);
  assert.equal(r.ok, true);
  assert.deepEqual(r.errors, []);
});

test('a prose field with only one language is tolerated (tightening is the contract step)', () => {
  const ir = validIR();
  ir.meta.subtitle = { zh: '只有中文' };
  ir.modules[1].description = { en: 'english only' };
  const r = validate(ir);
  assert.equal(r.ok, true);
});

test('an empty prose object fails with a precise path', () => {
  const ir = validGroupedIR();
  ir.groups[0].description = {};
  ir.modules[1].detail = { zh: '  ', en: '' };
  ir.connections[0].label = {};
  ir.meta.subtitle = { zh: '', en: '' };
  const r = validate(ir);
  assert.ok(r.errors.some((e) => e.path === 'groups[0].description'));
  assert.ok(r.errors.some((e) => e.path === 'modules[1].detail'));
  assert.ok(r.errors.some((e) => e.path === 'connections[0].label'));
  assert.ok(r.errors.some((e) => e.path === 'meta.subtitle'));
});

test('non-prose items in meta.input still have to be strings or {zh,en}', () => {
  const ir = validIR();
  ir.meta.input = [42];
  const r = validate(ir);
  assert.ok(r.errors.some((e) => e.path === 'meta.input'));
});

test('meta.input accepts a plain string item even when empty (expand step does not tighten)', () => {
  // 数组项走的是比标量字段更宽的判据：旧 isStrArray 对普通字符串一律放行，空串也放行。
  // 一旦顺手改用 isTranslatable，校验就被悄悄收紧了——这条把那个边界钉住。
  const ir = validIR();
  ir.meta.input = ['', 'ok'];
  assert.ok(validate(ir).ok);
  // 但空的 {zh,en} 对象项仍然拒——宽容只给旧形态的普通字符串。
  ir.meta.input = [{}];
  assert.ok(validate(ir).errors.some((e) => e.path === 'meta.input'));
});

test('module labels stay string-only: names are never translated', () => {
  // 名字（源码标识符 / 包名）译了就对不上代码，validate 的存在性检查也会立刻失效。
  const ir = validIR();
  ir.modules[1].label = { zh: '解析配置', en: 'parseConfig' };
  ir.modules[0].label = { zh: '文件系统', en: 'fs' };
  const r = validate(ir, SOURCE);
  assert.ok(r.errors.some((e) => e.path === 'modules[1].label'));
  assert.ok(r.errors.some((e) => e.path === 'modules[0].label'));
});

test('internal module source is still copied verbatim, not a {zh,en} pair', () => {
  const ir = validIR();
  ir.modules[1].source = { zh: 'function parseConfig(raw) {}', en: 'function parseConfig(raw) {}' };
  const r = validate(ir, SOURCE);
  assert.ok(r.errors.some((e) => e.path === 'modules[1].source'));
});

// === 四段说明（connection.description）：语言在外、四个固定字段在内（ADR-0008） ===
function four(lang, suffix) {
  return {
    source: lang + '-source' + (suffix || ''),
    process: lang + '-process' + (suffix || ''),
    output: lang + '-output' + (suffix || ''),
    purpose: lang + '-purpose' + (suffix || ''),
  };
}

test('connection description with all four segments in both languages passes', () => {
  const ir = validIR();
  ir.connections[0].description = { zh: four('zh'), en: four('en') };
  const r = validate(ir);
  assert.equal(r.ok, true);
  assert.deepEqual(r.errors, []);
});

test('a connection without description still passes (expand step, not the contract step)', () => {
  // 硬要求（每条 connection 都必须有四段）是契约步的 AC；本步只收「存在时必须完整」。
  const ir = validIR();
  assert.ok(!('description' in ir.connections[0]));
  const r = validate(ir);
  assert.equal(r.ok, true);
});

test('connection description missing one segment fails with the exact path', () => {
  const ir = validIR();
  const zh = four('zh');
  delete zh.process;
  ir.connections[0].description = { zh, en: four('en') };
  const r = validate(ir);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.path === 'connections[0].description.zh.process'),
    '错误 path 要指到缺的那一段：' + JSON.stringify(r.errors));
});

test('connection description with an empty segment fails', () => {
  const ir = validIR();
  const en = four('en');
  en.purpose = '   ';
  ir.connections[0].description = { zh: four('zh'), en };
  const r = validate(ir);
  assert.ok(r.errors.some((e) => e.path === 'connections[0].description.en.purpose'),
    '空白不算内容：' + JSON.stringify(r.errors));
});

test('connection description must be an object, not a plain string', () => {
  // 四段的形态与 translatable（单语产物里那种普通字符串）刻意不同，不能混用。
  const ir = validIR();
  ir.connections[0].description = '这条线从哪来、经过什么、输出什么、用于什么';
  const r = validate(ir);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.path === 'connections[0].description'));
});

test('an empty connection description fails', () => {
  const ir = validIR();
  ir.connections[0].description = {};
  const r = validate(ir);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.path === 'connections[0].description'));
});

test('a description language subtree that is not an object fails at the language', () => {
  const ir = validIR();
  ir.connections[0].description = { zh: '整段写成一串', en: four('en') };
  const r = validate(ir);
  assert.ok(r.errors.some((e) => e.path === 'connections[0].description.zh'));
});

test('one complete language subtree is tolerated (bilingual-required is the contract step)', () => {
  const ir = validIR();
  ir.connections[0].description = { zh: four('zh') };
  const r = validate(ir);
  assert.equal(r.ok, true);
});

// === uses / runtime：外部依赖与宿主调用（ADR-0011） ===
// 两条字段都**只**标在 internal 模块上，且都可以缺席（缺席＝没有外部依赖／没有宿主调用）。
test('a module with uses pointing at an external id passes', () => {
  const ir = validIR();
  ir.modules[1].uses = ['ext_fs'];
  ir.modules[1].runtime = ['process.exit', 'process.env', 'process.cwd'];
  const r = validate(ir);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.deepEqual(r.errors, []);
});

test('uses referencing an internal module fails (consumption is external-only)', () => {
  const ir = validIR();
  ir.modules[2].uses = ['parse'];
  const r = validate(ir);
  assert.equal(r.ok, false);
  const e = r.errors.find((x) => x.path === 'modules[2].uses[0]');
  assert.ok(e, 'path 要指到具体那一项：' + JSON.stringify(r.errors));
  assert.equal(e.message, "'uses' must reference an external module, got 'parse'",
    '镜像 connections 的同款判决：外部端点不进数据流，内部端点也不进 uses');
});

test('uses referencing an unknown module id fails as a dangling reference', () => {
  const ir = validIR();
  ir.modules[1].uses = ['ext_nope'];
  const r = validate(ir);
  assert.equal(r.ok, false);
  const e = r.errors.find((x) => x.path === 'modules[1].uses[0]');
  assert.ok(e);
  assert.equal(e.message, "references unknown module id 'ext_nope'");
});

test('uses may point at an external declared later in the modules list', () => {
  // 单趟遍历看不到**后面**才声明的 external —— 这条把「先收集后检查」这个顺序要求钉住。
  const ir = validIR();
  ir.modules.push({ id: 'ext_path', label: 'node:path', type: 'external', description: 'path utils', input: ['default'] });
  ir.modules[1].uses = ['ext_path'];
  const r = validate(ir);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
});

test('uses must be an array of strings when provided', () => {
  const ir = validIR();
  ir.modules[1].uses = 'ext_fs';
  assert.ok(validate(ir).errors.some((e) => e.path === 'modules[1].uses'));
  ir.modules[1].uses = ['ext_fs', 42];
  assert.ok(validate(ir).errors.some((e) => e.path === 'modules[1].uses[1]'));
});

test('runtime entries must be property paths: no parentheses, no bare globals', () => {
  // `process.exit()` 与 `process.exit` 是同一个结构事实，参数是细节不是结构（ADR-0011）；
  // 自由文本不统形，同一个符号会被写成四种样子，反向索引和去重全部对不上。
  const bad = ['process.exit()', 'process', 'process.exit(1)', '  ', 'process .exit', 'process.exit;'];
  bad.forEach((v) => {
    const ir = validIR();
    ir.modules[1].runtime = [v];
    const r = validate(ir);
    assert.ok(r.errors.some((e) => e.path === 'modules[1].runtime[0]'),
      `runtime 应拒 ${JSON.stringify(v)}：` + JSON.stringify(r.errors));
  });
});

test('runtime entries that are property paths pass', () => {
  const ir = validIR();
  ir.modules[1].runtime = ['process.env', 'process.cwd', 'process.exit'];
  const r = validate(ir);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
});

test('runtime must be an array of strings when provided', () => {
  const ir = validIR();
  ir.modules[1].runtime = 'process.exit';
  assert.ok(validate(ir).errors.some((e) => e.path === 'modules[1].runtime'));
});

test('uses and runtime are optional: absence is not an error (expand invariant)', () => {
  const ir = validIR();
  assert.ok(!('uses' in ir.modules[1]) && !('runtime' in ir.modules[1]));
  assert.equal(validate(ir).ok, true);
  // 空数组同样是「什么都没有」，不是「字段坏了」。
  ir.modules[1].uses = [];
  ir.modules[1].runtime = [];
  assert.equal(validate(ir).ok, true);
});
