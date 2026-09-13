'use strict';
const fs = require('fs');

function validate(ir, source) {
  const errors = [];

  const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
  const isNonEmptyStr = (x) => typeof x === 'string' && x.trim() !== '';
  const isStrArray = (x) => Array.isArray(x) && x.every((s) => typeof s === 'string');
  // 可译「散文」字段（meta.subtitle / group.label / module.description / connection.label…）：
  // 语言在外、**双语必填**（ADR-0008 契约步）——必须是 {zh, en} 且两边都非空。
  // 单语产物里那种普通字符串在这里是**错的形态**：它缺了一整种语言，同样报错。
  // 不给「缺一种就回退」留口子——静默回退会让中英混杂原样回来，那正是最初的病根。
  // 名字字段（module.label / id / source / from / to）不走这里，它们永远是 string。
  const isTranslatable = (x) => isObj(x) && isNonEmptyStr(x.zh) && isNonEmptyStr(x.en);
  // 数组项（meta.input / meta.output）与标量字段是同一把尺子：每一项也必须是双语齐全的 {zh, en}。
  // 错误 path 落在**数组**上（`meta.input`），不是某一项——调用点看到的是整份列表不合格。
  const isTranslatableArray = (x) => Array.isArray(x) && x.every((s) => isTranslatable(s));
  const PROSE_HINT = 'must be a {zh, en} object with both languages non-empty';

  // 四段说明（connection.description）：**语言在外、四个固定字段名在内**
  // { zh: { source, process, output, purpose }, en: { … } }（ADR-0008）。
  // 与 translatable 刻意不同形：它的叶子是四个**固定名字**（与用户原话一一对应，不许改名），
  // 不是一段自由散文；单语产物里那种普通字符串在这里是错的形状。
  // 契约步的硬要求：整段 description **必填**，且**两个语言子树都必填**、每个子树四段齐全非空。
  // 半截的 description 比缺席更危险：它会让「用于什么」那一格在画布上静默留白，读者以为那条线没有用途。
  const FOUR_KEYS = ['source', 'process', 'output', 'purpose'];
  const LANGS = ['zh', 'en'];
  function checkFourPart(desc, p, push) {
    // 缺席单独报「必填」，不走下面那条形状消息：形状消息说「必须是个对象」，
    // 读到的人会去改**已经写了但写歪**的那种情况，而这里的问题是**根本没写**。
    // 四段说明是图上唯一不可从源码推出的文字，模型只能靠报错定位——消息说歪了它就只能猜。
    if (desc === undefined || desc === null) {
      push({ path: p, message: 'description is required: every connection needs the four segments in both languages' });
      return;
    }
    if (!isObj(desc)) {
      push({ path: p, message: 'description must be an object {zh: {source, process, output, purpose}, en: {…}}' });
      return;
    }
    if (LANGS.every((lang) => desc[lang] === undefined)) {
      push({ path: p, message: 'description needs both zh and en' });
      return;
    }
    for (const lang of LANGS) {
      if (desc[lang] === undefined) {
        push({ path: `${p}.${lang}`, message: `${lang} is required: the four segments must be present in both languages` });
        continue;
      }
      if (!isObj(desc[lang])) {
        push({ path: `${p}.${lang}`, message: `${lang} must be an object with the four fixed fields (${FOUR_KEYS.join(', ')})` });
        continue;
      }
      for (const k of FOUR_KEYS) {
        if (!isNonEmptyStr(desc[lang][k])) {
          push({ path: `${p}.${lang}.${k}`, message: `${k} must be a non-empty string` });
        }
      }
    }
  }

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
        errors.push({ path: `meta.${f}`, message: `${f} must be an array of {zh, en} objects with both languages non-empty` });
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
  const externalIds = new Set();
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
          errors.push({ path: `${p}.detail`, message: `internal module detail ${PROSE_HINT}` });
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
        if (isNonEmptyStr(m.id)) externalIds.add(m.id);
        if (!isStrArray(m.input)) {
          errors.push({ path: `${p}.input`, message: 'external module requires input as an array of strings' });
        }
      }
    });
  }

  // uses / runtime（ADR-0011）：internal 模块消费了哪些 external、调用了哪些宿主运行时属性。
  // **必须另跑一趟**：单趟遍历看不到**后面**才声明的 external（与下面 groupMemberCount 的
  // 「先收集后检查」同一个理由）。两者都可缺席——缺席＝没有外部依赖／没有宿主调用，不是错误。
  const RUNTIME_PATH = /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)+$/;
  if (Array.isArray(ir.modules)) {
    ir.modules.forEach((m, i) => {
      if (!isObj(m) || m.type !== 'internal') return;
      const p = `modules[${i}]`;
      if (m.uses !== undefined && m.uses !== null) {
        if (!Array.isArray(m.uses)) {
          errors.push({ path: `${p}.uses`, message: 'uses must be an array of strings when provided' });
        } else {
          m.uses.forEach((ref, k) => {
            if (!isNonEmptyStr(ref)) {
              errors.push({ path: `${p}.uses[${k}]`, message: 'uses must be a non-empty module id' });
            } else if (!ids.has(ref)) {
              errors.push({ path: `${p}.uses[${k}]`, message: `references unknown module id '${ref}'` });
            } else if (!externalIds.has(ref)) {
              // 与 connections 的端点约束镜像：那条要求 internal，这条要求 external（ADR-0011）。
              errors.push({ path: `${p}.uses[${k}]`, message: `'uses' must reference an external module, got '${ref}'` });
            }
          });
        }
      }
      if (m.runtime !== undefined && m.runtime !== null) {
        if (!Array.isArray(m.runtime)) {
          errors.push({ path: `${p}.runtime`, message: 'runtime must be an array of strings when provided' });
        } else {
          m.runtime.forEach((path, k) => {
            // 值必须是**属性路径**（`process.exit` / `process.env`）：`process.exit(1)` 与
            // `process.exit` 是同一个结构事实，参数是细节不是结构。
            // 为什么只在它身上花一条正则：IR 里自由文本的字段有好几个（label / description /
            // source / meta.subtitle…），但那些字段的**取值本来就是散文**，形状自由是它们的本性；
            // `runtime` 是唯一「取值本身就是一个符号串、却由自由文本承载」的字段——不统形，
            // 同一个调用就会被写成四种样子，反向索引与去重全部对不上（ADR-0011 决策二）。
            if (!isNonEmptyStr(path) || !RUNTIME_PATH.test(path)) {
              errors.push({ path: `${p}.runtime[${k}]`, message: `runtime entry must be a property path like 'process.exit' (no parentheses, no arguments)` });
            }
          });
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
      // 四段说明：**必填**（契约步）。缺席、半截、单语都由 checkFourPart 报出，path 指到那一格。
      checkFourPart(c.description, `${p}.description`, (e) => errors.push(e));
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
