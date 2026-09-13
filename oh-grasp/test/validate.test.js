'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { validate } = require('../validate.js');

// 基座 fixture：**双语齐全**（契约步起，任何一处缺一种语言都会让约 50 条测试一起变红——
// 那是预期行为，不是各自的回归）。改这里等于改所有派生 fixture，包括 validGroupedIR。
function validIR() {
  return {
    meta: {
      title: 'parser.js',
      subtitle: { zh: '解析配置并处理记录。', en: 'Parses config and processes records.' },
      input: [{ zh: '配置路径', en: 'config path' }],
      output: [{ zh: '记录', en: 'records' }],
    },
    modules: [
      { id: 'ext_fs', label: 'fs', type: 'external', description: { zh: 'Node 文件系统', en: 'Node filesystem' }, input: ['readFileSync'] },
      { id: 'parse', label: 'parseConfig', type: 'internal', description: { zh: '把原始配置解析成对象', en: 'Parses raw config into an object' }, detail: { zh: '把原始配置文本解析成对象。', en: 'Parses raw config text into an object.' }, source: 'function parseConfig(raw) {\n  return JSON.parse(raw);\n}' },
      { id: 'proc', label: 'processRecords', type: 'internal', description: { zh: '转换记录', en: 'Transforms records' }, detail: { zh: '转换记录。', en: 'Transforms records.' }, source: 'function processRecords() {}' },
    ],
    connections: [{
      from: 'parse',
      to: 'proc',
      label: { zh: '传入配置对象', en: 'pass the config object' },
      description: {
        zh: { source: '解析出的配置对象。', process: '原样传出。', output: '一个配置对象。', purpose: '供 processRecords 读 config.source。' },
        en: { source: 'The parsed config object.', process: 'Passed straight through.', output: 'A config object.', purpose: 'So processRecords can read config.source.' },
      },
    }],
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
  ir.connections.push({ from: 'nope', to: 'proc', label: { zh: '悬空', en: 'dangling' }, description: { zh: four('zh'), en: four('en') } });
  const r = validate(ir);
  assert.ok(r.errors.some((e) => e.path === 'connections[1].from'));
});

test('connection to external module fails', () => {
  const ir = validIR();
  ir.connections.push({ from: 'parse', to: 'ext_fs', label: { zh: '指向外部', en: 'to external' }, description: { zh: four('zh'), en: four('en') } });
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
    { id: 'grp_core', label: { zh: '核心处理', en: 'Core processing' }, description: { zh: '解析并处理记录。', en: 'Parses and processes records.' } },
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
  ir.groups.push({ id: 'grp_core', label: { zh: '另一个', en: 'another' }, description: { zh: '另一个分组。', en: 'Another group.' } });
  const r = validate(ir);
  assert.ok(r.errors.some((e) => e.path === 'groups[1].id'));
});

test('group with fewer than 2 members fails', () => {
  const ir = validIR();
  ir.groups = [{ id: 'grp_x', label: { zh: 'X', en: 'X' }, description: { zh: '只有一个成员。', en: 'Only one member.' } }];
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
  ir.modules.push({ id: 'util', label: 'helper', type: 'internal', description: { zh: '工具函数', en: 'Utility' }, detail: { zh: '工具函数。', en: 'Utility.' }, source: 'function helper() {}' });
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

// === 双语（契约步：可译字段一律 {zh, en} 且两边都必填，单语产物硬报错） ===
const BI_IR = require('../examples/sample.bilingual.ir.json');
const MIN_IR = require('../examples/sample.ir.json');

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

test('the minimal sample fixture is bilingual too', () => {
  // 全仓唯一的**最小形状** fixture（5 modules / 3 connections / 0 groups）——
  // 它和带 group 的那份分工是「最小 / 带 group」，两份都必须过收紧后的校验。
  assert.equal(MIN_IR.groups, undefined, '这份 fixture 的职责就是零 group');
  const r = validate(MIN_IR);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
});

test('a monolingual IR now fails: every prose field needs both languages (contract step)', () => {
  // 旧形态（散文字段全是普通字符串）在契约步起硬报错——普通字符串缺了一整种语言。
  // 静默回退会让中英混杂原样回来，那正是最初的病根（ADR-0008）。
  const ir = validIR();
  ir.meta.subtitle = 'Parses config and processes records.';
  ir.meta.input = ['config.json'];
  ir.meta.output = ['records'];
  ir.modules[0].description = 'Node filesystem';
  ir.modules[1].description = 'Parses raw config into an object';
  ir.modules[1].detail = 'Parses raw config text into an object.';
  ir.modules[2].description = 'Transforms records';
  ir.modules[2].detail = 'Transforms records.';
  ir.connections[0].label = 'config';
  const r = validate(ir);
  assert.equal(r.ok, false);
  for (const p of ['meta.subtitle', 'meta.input', 'meta.output',
    'modules[0].description', 'modules[1].description', 'modules[1].detail',
    'modules[2].description', 'modules[2].detail', 'connections[0].label']) {
    assert.ok(r.errors.some((e) => e.path === p), `缺 ${p} 的报错：` + JSON.stringify(r.errors));
  }
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

test('a prose field with only one language now fails with a precise path (contract step)', () => {
  const ir = validIR();
  ir.meta.subtitle = { zh: '只有中文' };
  ir.modules[1].description = { en: 'english only' };
  const r = validate(ir);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.path === 'meta.subtitle'), JSON.stringify(r.errors));
  assert.ok(r.errors.some((e) => e.path === 'modules[1].description'), JSON.stringify(r.errors));
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

test('meta.input rejects a plain string item: every item must be bilingual (contract step)', () => {
  // 数组项与标量字段现在同一把尺子——普通字符串（含空串）缺了一整种语言，硬报错。
  const ir = validIR();
  ir.meta.input = ['', 'ok'];
  assert.equal(validate(ir).ok, false);
  assert.ok(validate(ir).errors.some((e) => e.path === 'meta.input'));
  // 空的 {zh,en} 项同样拒。
  ir.meta.input = [{}];
  assert.ok(validate(ir).errors.some((e) => e.path === 'meta.input'));
  // 双语齐全的项放行。
  ir.meta.input = [{ zh: '配置路径', en: 'config path' }];
  assert.equal(validate(ir).ok, true, JSON.stringify(validate(ir).errors));
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

test('a connection without description now fails with the exact path (contract step)', () => {
  // 契约步的硬要求：每条 connection 都必须有四段。缺席不再是「没写」而是「不完整」。
  const ir = validIR();
  delete ir.connections[0].description;
  const r = validate(ir);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.path === 'connections[0].description'),
    '错误 path 要指到缺 description 的那条边：' + JSON.stringify(r.errors));
  // 缺席走「必填」那条消息，不走「形状不对」——形状消息会把人引去改「写了但写歪」的情况，
  // 而这里的问题是根本没写。四段说明只能靠报错定位，消息说歪了模型就只能猜（见 validation.md §5）。
  assert.ok(r.errors.some((e) => e.path === 'connections[0].description' && /is required/.test(e.message)),
    '缺席要走「必填」那条消息：' + JSON.stringify(r.errors));
});

test('a connection with a null description also reports it as required', () => {
  const ir = validIR();
  ir.connections[0].description = null;
  const r = validate(ir);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.path === 'connections[0].description' && /is required/.test(e.message)),
    JSON.stringify(r.errors));
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

test('one complete language subtree now fails at the missing language (contract step)', () => {
  const ir = validIR();
  ir.connections[0].description = { zh: four('zh') };
  const r = validate(ir);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.path === 'connections[0].description.en'),
    'path 要指到缺的那个语言子树：' + JSON.stringify(r.errors));
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
  ir.modules.push({ id: 'ext_path', label: 'node:path', type: 'external', description: { zh: '路径工具', en: 'path utils' }, input: ['default'] });
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
