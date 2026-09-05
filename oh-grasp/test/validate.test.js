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
      { id: 'parse', label: 'parseConfig', type: 'internal', description: 'Parses raw config into an object', detail: 'Parses raw config text into an object.', source: 'function parseConfig(raw) {}' },
      { id: 'proc', label: 'processRecords', type: 'internal', description: 'Transforms records', detail: 'Transforms records.', source: 'function processRecords() {}' },
    ],
    connections: [{ from: 'parse', to: 'proc', label: 'config' }],
  };
}

const SOURCE = [
  "const fs = require('fs');",
  'function parseConfig() {}',
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
