# 校验

**要解决的核心问题**：IR 是**模型生成的**。模型会编造——编造不存在的函数名、把源码「差不多」地复述（换个缩进、合并两行）、连一条指向已删除模块的边。validate 的职责是在渲染之前把这些挡掉：**一个编造的漂亮图，比一个报错的丑图危险得多**。

所以校验不只是结构检查（类型对不对），更是**事实检查**（图上说的东西源码里到底有没有）。

---

## 1. 引用完整性（Set 去重 + 存在性 + 类型约束）

**问题**：模块 id 不能重复；`connection.from/to`、`module.group`、`module.uses` 必须指得到；connection 的端点必须是 **internal** 模块，`uses` 的端点必须是 **external** 模块；`module.runtime` 每项必须是属性路径。

**做法**：模块趟边走边建 `Set`（`ids` / `internalIds` / `externalIds`），边查边报；`uses` / `runtime` 另跑一趟（见下）

| 检查 | 目的 |
|---|---|
| id 重复（`Set.has`） | 重复 id 会让 `M[id]` 静默取到后者，节点神秘消失 |
| `group` 指向存在的 group | 悬挂引用 |
| `connection.from/to` 指向存在的模块 | 悬挂引用 |
| `connection.from/to` 必须是 internal | 外部依赖走侧栏（ADR-0006），不进数据流；且外部模块没有 `source`，画成边无从验证 |
| `uses` 指向存在的模块 | 悬挂引用（拼错一个 id 就多出一条查不到的依赖） |
| `uses` 必须指向 **external** | 与上一条镜像：`uses` 是消费关系，不是数据流边（ADR-0011 决策一）；指向内部模块会让同一条关系有两个字段各说各话 |
| `runtime` 每项匹配属性路径正则 | `process.exit(1)` 与 `process.exit` 是同一个结构事实，自由文本不统形就会被写成四种样子，反向索引与去重全部对不上（ADR-0011 决策二） |
| group 至少 2 个成员 | 1 个成员的分组是纯粹的包装，画出来多一层框但零信息 |

**`uses` / `runtime` 为什么另跑一趟**（ADR-0011）：这两个字段引用**其他模块的 id**，而单趟遍历只看得见**前面**声明过的模块——`uses: ["ext_path"]` 指向一个写在 `modules` 数组后面的 external 是完全合法的（validate.js:181–219，与 `groupMemberCount` 的「先收集后检查」同一个形状）。两个字段都可**缺席**：缺席＝没有外部依赖／没有宿主调用，不是错误；这一条由 `oh-grasp/test/validate.test.js` 的「uses and runtime are optional」钉住。

**`runtime` 的正则**：`^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)+$`——**至少一个点**。`process.env` / `process.cwd` / `process.exit` 放行，裸 `process` 被拒（它不是一个调用），`process.exit()` 被拒（括号不是属性路径的一部分）。只在它身上花一条正则，理由不是「它是唯一的自由文本字段」——IR 里自由文本的字段有好几个（`label` / `description` / `source` / `meta.subtitle` / `group.label`…），但那些字段的**取值本来就是散文**，形状自由是它们的本性。`runtime` 是唯一一个「取值本身就是一个**符号串**、却由自由文本承载」的字段：不统形，同一个调用就会被写成 `process.exit` / `process.exit(1)` / `process.exit(1) 终止进程` 四种样子，反向索引与去重全部对不上（ADR-0011 决策二）。

**错误格式**：每条 `{path, message}`，path 是 JSON 路径（如 `connections[3].from`、`modules[3].uses[0]`）——模型收到后能**直接定位**到要改的那一行，而不是重新猜整个文件。

**穷尽报告而非首错退出**：一次跑完收集所有错误。模型改一轮就全部修好，比「改一个跑一次」快得多。

**位置**：validate.js:231（connections）、validate.js:84–219（groups / modules / uses / runtime）。
**测试**：`oh-grasp/test/validate.test.js` —「a module with uses pointing at an external id passes」、「uses referencing an internal module fails (consumption is external-only)」、「uses referencing an unknown module id fails as a dangling reference」、「uses may point at an external declared later in the modules list」、「uses must be an array of strings when provided」、「runtime entries must be property paths: no parentheses, no bare globals」、「runtime entries that are property paths pass」、「runtime must be an array of strings when provided」、「uses and runtime are optional: absence is not an error (expand invariant)」。

---

## 2. 词边界正则存在性检查

**问题**：internal 模块的 `label` 是**源码标识符**（函数名/类名）。模型可能把 `extractQualityArgs` 写成 `extractQualityArg`，或者凭「应该有这么个函数」编一个。图上显示的名字如果源码里没有，这张图就是假的。

**做法**：`new RegExp('\\b' + escapeRegExp(label) + '\\b').test(source)`

两个细节都不能省：

- **`escapeRegExp`**：label 里若含正则元字符（`$`、`.`、`(` 等——`$` 在 jQuery 风格的命名里很常见），不转义会导致正则语法错误或误匹配。
- **`\b` 词边界**：否则 `run` 会被 `run_node` 里的 `run` 命中——**前缀匹配**放过了「名字写短了」这个最常见的编造形式。词边界要求两侧是非标识符字符。

**已知盲区**：词边界挡住前缀匹配，但挡不住**注释或字符串里出现过**同名文字（`// TODO: extractQualityArgs`）。要彻底解决需要真正的语法解析（把源码 parse 成 AST 再找标识符节点），代价远大于收益——注释里出现一个函数名的概率低，且即便发生，图上的名字仍然指向真实存在的东西。

**位置**：validate.js:285（`identifierExists`，由 validate.js:263 的存在性检查块调用）。

---

## 3. 空白归一化子串匹配

**问题**：internal 模块的 `source` 必须是源码的**逐字复制**。但模型复述源码时最常见的失真**不是改字，是改空白**——把两行合成一行、改了缩进、去掉了空行。严格的 `includes` 会因此把「内容其实完全正确」的 source 判为错。

**做法**：两侧都做 `replace(/\s+/g, ' ').trim()` 再 `includes`。即**空白折叠成一个空格**后比较。

**为什么归一化空白是安全的**：空白在 JS 里只有分词作用，`a  b` 和 `a b` 在语法上完全等价（字符串字面量内部的空白除外——那种情况归一化会让**校验放松**而不是收紧，即可能放过一个改动了字符串内容的 source。代价可接受：真正危险的是**改逻辑**，而改逻辑必然伴随非空白字符的变动，会被抓住）。

**与 #2 的分工**：#2 保证**名字对**，#3 保证**正文对**。两条一起，把「模型编造/改写源码」这个最大风险按在 render 之前。

**位置**：validate.js:293（`sourceContains`）。

---

## 4. 可译字段：语言在外、双语必填（契约步）

**问题**：说明性文字要能中英切换，IR 里的**散文**字段（`meta.subtitle` / `meta.input` / `meta.output` / `group.label` / `group.description` / `module.description` / `module.detail` / `connection.label`）存成 `{zh, en}`。中英两版**都必填**——缺一不出图。

**做法**：`isTranslatable(x) = 是对象 且 zh 与 en 都是非空字符串`；列表形态 `isTranslatableArray`（逐项用同一把尺子）。`module.label` / `id` / `source` / `from` / `to` **不走这条**，它们永远是 `string`——名字译了就对不上源码，本文件 #2 的存在性检查也会立刻失效。

**旧形态（普通字符串）为什么也报错**：单语产物里那种普通字符串不是什么「另一种被兼容的形态」，而是**缺了一整种语言**的坏形态。放行它等于给「缺一种就回退」留口子，而静默回退会让中英混杂原样回来——那正是最初的病根（ADR-0008 明确否掉了「至少一种语言、缺另一种则回退并标注」）。

**代价是预期的**：这一条一落地，`generated/` 里那份单语 IR **立刻全线报错**，直到用户手动重新生成。这是 ADR-0008 写明的票价，不是回归。

**错误 path 落在字段上**（如 `meta.subtitle` / `modules[1].detail`）——整份列表不合格时落在数组上（`meta.input`）。模型照着 path 直接定位到要改的那一格。

**位置**：validate.js 顶部的 `isTranslatable` / `isTranslatableArray`（validate.js:15 / validate.js:18）。
**测试**：`oh-grasp/test/validate.test.js` —「a monolingual IR now fails: every prose field needs both languages (contract step)」、「a prose field with only one language now fails with a precise path (contract step)」、「meta.input rejects a plain string item: every item must be bilingual (contract step)」、「an empty prose object fails with a precise path」、「every prose field accepts {zh,en}」、「non-prose items in meta.input still have to be strings or {zh,en}」、「module labels stay string-only: names are never translated」、「the minimal sample fixture is bilingual too」、「bilingual IR passes validation」。

---

## 5. 四段说明 `connection.description`（契约步）

**问题**：`connection` 上有一段四段说明——`source`（从哪来）/ `process`（经过什么处理）/ `output`（输出了什么）/ `purpose`（用于什么），中英各一套。它**不是**第 4 节那种可译散文：散文是「一段话换个语言说」，四段是「四个固定格子」。校验口径因此也不同。

```jsonc
"description": { "zh": { "source": …, "process": …, "output": …, "purpose": … }, "en": { … } }
```

**做法**（`checkFourPart`）：**语言在外、四个固定字段名在内**，而且**整段必填、两个语言子树都必填**。

| 输入 | 结果 |
|---|---|
| `description` **缺席**（`undefined` / `null`） | **硬报错** `connections[i].description`：报**必填**、不报「形状不对」——形状消息会把人引去改「写了但写歪」的那种情况，而这里的问题是根本没写。每条 connection 都必须有四段 |
| 整体不是对象（如普通字符串） | `connections[i].description`：形状不对 |
| 两个语言子树都没有（如 `{}`） | `connections[i].description`：zh 与 en 都缺 |
| 只写全了一个语言子树 | `connections[i].description.en`：**缺的那个语言子树**是被指的格 |
| 某个语言子树不是对象 | `connections[i].description.zh`：那一层形状不对 |
| 某语言子树里缺某个固定字段 / 该字段不是非空字符串 | `connections[i].description.zh.process`：**精确到那一格** |

**为什么缺席与半截都硬报错**：半截的 description 比没有更危险——写全了 `source` / `process` 却漏了 `purpose`，画布上那一格会**静默留白**，读者以为那条线没有用途。而缺席同样不可接受：四段说明是这张图存在的理由之一（症状 2「数据流动读不懂」），一条没有四段的边等于没修那个症状。这两个「温和处理」（缺席靠统一的「—」占位、缺一种语言回退另一种）都会把「没写」伪装成「写了」，正是 ADR-0008 否掉的形态。

**与第 4 节的分工**：`translatable` 的叶子是**自由散文**（随便什么非空字符串都行），`description` 的叶子是**四个固定名字**——名字不许改叫 `origin` / `how` / `what` / `why`（会丢掉与用户原话的一一对应），而且单语产物里那种「普通字符串」在这里是**错的形状**，不会被悄悄放行。反过来，`connection.description` 也不该拿 `isTranslatable` 去套：那等于只检查「有字」，四个格子缺一个都发现不了。

**为什么错误路径要精确到那一格**：错在哪一格，模型改哪一格。写成 `connections[3].description: invalid` 会让它重猜整段，而四段说明是这张图上唯一**不可从源码推出**的文字——只能回头问用户，猜不出来。

**长度上限与「同 label 复用」刻意不校验**：四段每段约 ≤40 字是 prompt 的风格指引，硬限会逼模型砍掉限定语（而「这个路径来自 CLI 参数」这类前提正是长度的来源）；「同一个 label 复用同一段文字」也是 prompt 要求——允许上下文导致的合理差异（ADR-0008）。

**位置**：validate.js:29（`checkFourPart`）、validate.js:249（connections 循环里的调用）。
**测试**：`oh-grasp/test/validate.test.js` —「connection description with all four segments in both languages passes」、「a connection without description now fails with the exact path (contract step)」、「connection description missing one segment fails with the exact path」、「connection description with an empty segment fails」、「connection description must be an object, not a plain string」、「an empty connection description fails」、「a description language subtree that is not an object fails at the language」、「one complete language subtree now fails at the missing language (contract step)」、「every connection of the bilingual fixture carries the four segments in both languages」。

---

## 错误报告契约

```
connections[3].from: 'from' must reference an internal module, got 'ext_fs'
modules[3].uses[0]: 'uses' must reference an external module, got 'parse'
modules[3].runtime[0]: runtime entry must be a property path like 'process.exit' (no parentheses, no arguments)
modules[7].label: internal module 'extractQualityArg' not found in source
```

格式统一为 `<JSON 路径>: <一句话说明>`，每行一条，`OK` 表示全通过，退出码 1 表示有错。CLI 与 `validate(ir, source)` 函数共用同一份输出逻辑——测试直接断函数返回的 `errors` 数组，不需要起进程。

**测试**：`oh-grasp/test/validate.test.js`。
