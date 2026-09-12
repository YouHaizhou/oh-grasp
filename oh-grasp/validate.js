'use strict';
const fs = require('fs');

function validate(ir, source) {
  const errors = [];

  const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
  const isNonEmptyStr = (x) => typeof x === 'string' && x.trim() !== '';
  const isStrArray = (x) => Array.isArray(x) && x.every((s) => typeof s === 'string');
  // 可译「散文」字段（meta.subtitle / group.label / module.description / connection.label…）：
  // 旧形态是普通字符串，新形态是 {zh, en}（语言在外）。expand 步只要求「至少一种语言非空」；
  // 「两种语言都必填」的收紧不属于本步。名字字段（module.label / id / source / from / to）不走这里。
  const isTranslatable = (x) => isNonEmptyStr(x)
    || (isObj(x) && (isNonEmptyStr(x.zh) || isNonEmptyStr(x.en)));
  // 数组项（meta.input / meta.output）比上面的标量字段更宽：旧 isStrArray 对**普通字符串一律放行**，
  // 空串也放行。expand 步不收口——这一格不能顺手用 isTranslatable，否则就是把校验悄悄收紧了。
  const isTranslatableItem = (x) => typeof x === 'string'
    || (isObj(x) && (isNonEmptyStr(x.zh) || isNonEmptyStr(x.en)));
  const isTranslatableArray = (x) => Array.isArray(x) && x.every((s) => isTranslatableItem(s));
  const PROSE_HINT = 'must be a non-empty string or a {zh, en} object';

  if (!isObj(ir)) {
    return { ok: false, errors: [{ path: '$', message: 'IR must be a JSON object' }] };
  }

  // meta
  if (!isObj(ir.meta)) {
    errors.push({ path: 'meta', message: 'meta is required and must be an object' });
  } else {
    if (!isNonEmptyStr(ir.meta.title)) {
      errors.push({ path: 'meta.title', message: 'title must be a non-empty string' });
    }
    if (!isTranslatable(ir.meta.subtitle)) {
      errors.push({ path: 'meta.subtitle', message: `subtitle ${PROSE_HINT}` });
    }
    for (const f of ['input', 'output']) {
      if (!isTranslatableArray(ir.meta[f])) {
        errors.push({ path: `meta.${f}`, message: `${f} must be an array of strings or {zh, en} objects` });
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
        if (!isNonEmptyStr(g.id)) {
          errors.push({ path: `${p}.id`, message: 'id must be a non-empty string' });
        }
        for (const f of ['label', 'description']) {
          if (!isTranslatable(g[f])) {
            errors.push({ path: `${p}.${f}`, message: `${f} ${PROSE_HINT}` });
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
      // label 是「名字」（源码标识符 / 包名），永远不译，因此只收字符串。
      for (const f of ['id', 'label']) {
        if (!isNonEmptyStr(m[f])) {
          errors.push({ path: `${p}.${f}`, message: `${f} must be a non-empty string` });
        }
      }
      if (!isTranslatable(m.description)) {
        errors.push({ path: `${p}.description`, message: `description ${PROSE_HINT}` });
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
        if (!isTranslatable(m.detail)) {
          errors.push({ path: `${p}.detail`, message: `internal module requires detail as ${PROSE_HINT}` });
        }
        if (!isNonEmptyStr(m.source)) {
          errors.push({ path: `${p}.source`, message: 'internal module requires source as a non-empty string' });
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
      for (const f of ['from', 'to']) {
        if (!isNonEmptyStr(c[f])) {
          errors.push({ path: `${p}.${f}`, message: `${f} must be a non-empty string` });
        }
      }
      if (!isTranslatable(c.label)) {
        errors.push({ path: `${p}.label`, message: `label ${PROSE_HINT}` });
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
