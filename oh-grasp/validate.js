'use strict';
const fs = require('fs');

function validate(ir, source) {
  const errors = [];

  const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
  const isNonEmptyStr = (x) => typeof x === 'string' && x.trim() !== '';
  const isStrArray = (x) => Array.isArray(x) && x.every((s) => typeof s === 'string');

  if (!isObj(ir)) {
    return { ok: false, errors: [{ path: '$', message: 'IR must be a JSON object' }] };
  }

  // meta
  if (!isObj(ir.meta)) {
    errors.push({ path: 'meta', message: 'meta is required and must be an object' });
  } else {
    for (const f of ['title', 'subtitle']) {
      if (!isNonEmptyStr(ir.meta[f])) {
        errors.push({ path: `meta.${f}`, message: `${f} must be a non-empty string` });
      }
    }
    for (const f of ['input', 'output']) {
      if (!isStrArray(ir.meta[f])) {
        errors.push({ path: `meta.${f}`, message: `${f} must be an array of strings` });
      }
    }
  }

  // groups
  const groupIds = new Set();
  const groupMemberCount = {};
  const groupIndex = {};
  if (ir.groups !== undefined && ir.groups !== null) {
    if (!Array.isArray(ir.groups)) {
      errors.push({ path: 'groups', message: 'groups must be an array when provided' });
    } else {
      ir.groups.forEach((g, i) => {
        const p = `groups[${i}]`;
        if (!isObj(g)) {
          errors.push({ path: p, message: 'must be an object' });
          return;
        }
        for (const f of ['id', 'label', 'description']) {
          if (!isNonEmptyStr(g[f])) {
            errors.push({ path: `${p}.${f}`, message: `${f} must be a non-empty string` });
          }
        }
        if (isNonEmptyStr(g.id)) {
          if (groupIds.has(g.id)) {
            errors.push({ path: `${p}.id`, message: `duplicate group id '${g.id}'` });
          }
          groupIds.add(g.id);
          groupMemberCount[g.id] = 0;
          groupIndex[g.id] = i;
        }
      });
    }
  }

  // modules
  const ids = new Set();
  const internalIds = new Set();
  if (!Array.isArray(ir.modules) || ir.modules.length === 0) {
    errors.push({ path: 'modules', message: 'modules must be a non-empty array' });
  } else {
    ir.modules.forEach((m, i) => {
      const p = `modules[${i}]`;
      if (!isObj(m)) {
        errors.push({ path: p, message: 'must be an object' });
        return;
      }
      for (const f of ['id', 'label', 'description']) {
        if (!isNonEmptyStr(m[f])) {
          errors.push({ path: `${p}.${f}`, message: `${f} must be a non-empty string` });
        }
      }
      if (m.type !== 'external' && m.type !== 'internal') {
        errors.push({ path: `${p}.type`, message: "type must be 'external' or 'internal'" });
      }
      if (isNonEmptyStr(m.id)) {
        if (ids.has(m.id)) {
          errors.push({ path: `${p}.id`, message: `duplicate id '${m.id}'` });
        }
        ids.add(m.id);
      }
      if (m.type === 'internal') {
        if (isNonEmptyStr(m.id)) internalIds.add(m.id);
        for (const f of ['detail', 'source']) {
          if (!isNonEmptyStr(m[f])) {
            errors.push({ path: `${p}.${f}`, message: `internal module requires ${f} as a non-empty string` });
          }
        }
        if (m.sourceLine !== undefined && m.sourceLine !== null && !Number.isInteger(m.sourceLine)) {
          errors.push({ path: `${p}.sourceLine`, message: 'sourceLine must be an integer when provided' });
        }
        if (m.group !== undefined && m.group !== null) {
          if (!isNonEmptyStr(m.group)) {
            errors.push({ path: `${p}.group`, message: 'group must be a non-empty string when provided' });
          } else if (!groupIds.has(m.group)) {
            errors.push({ path: `${p}.group`, message: `references unknown group '${m.group}'` });
          } else {
            groupMemberCount[m.group] += 1;
          }
        }
      } else if (m.type === 'external') {
        if (!isStrArray(m.input)) {
          errors.push({ path: `${p}.input`, message: 'external module requires input as an array of strings' });
        }
      }
    });
  }

  // group membership minimum
  if (Array.isArray(ir.groups)) {
    Object.keys(groupMemberCount).forEach((gid) => {
      if (groupMemberCount[gid] < 2) {
        errors.push({ path: `groups[${groupIndex[gid]}]`, message: `group '${gid}' must contain at least 2 internal modules (has ${groupMemberCount[gid]})` });
      }
    });
  }

  // connections
  if (ir.connections !== undefined && !Array.isArray(ir.connections)) {
    errors.push({ path: 'connections', message: 'connections must be an array' });
  } else if (Array.isArray(ir.connections)) {
    ir.connections.forEach((c, i) => {
      const p = `connections[${i}]`;
      if (!isObj(c)) {
        errors.push({ path: p, message: 'must be an object' });
        return;
      }
      for (const f of ['from', 'to', 'label']) {
        if (!isNonEmptyStr(c[f])) {
          errors.push({ path: `${p}.${f}`, message: `${f} must be a non-empty string` });
        }
      }
      for (const f of ['from', 'to']) {
        const ref = c[f];
        if (!isNonEmptyStr(ref)) continue;
        if (!ids.has(ref)) {
          errors.push({ path: `${p}.${f}`, message: `references unknown module id '${ref}'` });
        } else if (!internalIds.has(ref)) {
          errors.push({ path: `${p}.${f}`, message: `'${f}' must reference an internal module, got '${ref}'` });
        }
      }
    });
  }

  // existence check
  if (source !== undefined && source !== null) {
    if (typeof source !== 'string') {
      errors.push({ path: '$', message: 'source must be a string when provided' });
    } else if (Array.isArray(ir.modules)) {
      ir.modules.forEach((m, i) => {
        if (m && m.type === 'internal' && isNonEmptyStr(m.label) && !identifierExists(source, m.label)) {
          errors.push({ path: `modules[${i}].label`, message: `internal module '${m.label}' not found in source` });
        }
        if (m && m.type === 'internal' && isNonEmptyStr(m.source) && !sourceContains(source, m.source)) {
          errors.push({ path: `modules[${i}].source`, message: `internal module '${m.label}' source not found in the source file` });
        }
      });
    }
  }

  return { ok: errors.length === 0, errors };
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function identifierExists(source, label) {
  return new RegExp('\\b' + escapeRegExp(label) + '\\b').test(source);
}

function normalizeWhitespace(s) {
  return s.replace(/\s+/g, ' ').trim();
}

function sourceContains(source, snippet) {
  return normalizeWhitespace(source).includes(normalizeWhitespace(snippet));
}

module.exports = { validate };

if (require.main === module) {
  const [, , irPath, sourcePath] = process.argv;
  if (!irPath) {
    console.error('Usage: node validate.js <ir.json> [source.js]');
    process.exit(2);
  }
  let ir;
  try {
    ir = JSON.parse(fs.readFileSync(irPath, 'utf8'));
  } catch (e) {
    console.error('cannot parse IR JSON:', e.message);
    process.exit(1);
  }
  const source = sourcePath ? fs.readFileSync(sourcePath, 'utf8') : undefined;
  const r = validate(ir, source);
  if (r.ok) {
    console.log('OK');
  } else {
    for (const e of r.errors) console.log(`${e.path}: ${e.message}`);
    process.exit(1);
  }
}
