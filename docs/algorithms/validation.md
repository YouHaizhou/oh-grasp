# 校验

**要解决的核心问题**：IR 是**模型生成的**。模型会编造——编造不存在的函数名、把源码「差不多」地复述（换个缩进、合并两行）、连一条指向已删除模块的边。validate 的职责是在渲染之前把这些挡掉：**一个编造的漂亮图，比一个报错的丑图危险得多**。

所以校验不只是结构检查（类型对不对），更是**事实检查**（图上说的东西源码里到底有没有）。

---

## 1. 引用完整性（Set 去重 + 存在性 + 类型约束）

**问题**：模块 id 不能重复；`connection.from/to`、`module.group` 必须指得到；connection 的端点必须是 **internal** 模块。

**做法**：一趟遍历，边走边建 `Set`，边查边报

| 检查 | 目的 |
|---|---|
| id 重复（`Set.has`） | 重复 id 会让 `M[id]` 静默取到后者，节点神秘消失 |
| `group` 指向存在的 group | 悬挂引用 |
| `connection.from/to` 指向存在的模块 | 悬挂引用 |
| `connection.from/to` 必须是 internal | 外部依赖走侧栏（ADR-0006），不进数据流；且外部模块没有 `source`，画成边无从验证 |
| group 至少 2 个成员 | 1 个成员的分组是纯粹的包装，画出来多一层框但零信息 |

**错误格式**：每条 `{path, message}`，path 是 JSON 路径（如 `connections[3].from`）——模型收到后能**直接定位**到要改的那一行，而不是重新猜整个文件。

**穷尽报告而非首错退出**：一次跑完收集所有错误。模型改一轮就全部修好，比「改一个跑一次」快得多。

**位置**：validate.js:124（connections）、validate.js:32-122（groups / modules）。

---

## 2. 词边界正则存在性检查

**问题**：internal 模块的 `label` 是**源码标识符**（函数名/类名）。模型可能把 `extractQualityArgs` 写成 `extractQualityArg`，或者凭「应该有这么个函数」编一个。图上显示的名字如果源码里没有，这张图就是假的。

**做法**：`new RegExp('\\b' + escapeRegExp(label) + '\\b').test(source)`

两个细节都不能省：

- **`escapeRegExp`**：label 里若含正则元字符（`$`、`.`、`(` 等——`$` 在 jQuery 风格的命名里很常见），不转义会导致正则语法错误或误匹配。
- **`\b` 词边界**：否则 `run` 会被 `run_node` 里的 `run` 命中——**前缀匹配**放过了「名字写短了」这个最常见的编造形式。词边界要求两侧是非标识符字符。

**已知盲区**：词边界挡住前缀匹配，但挡不住**注释或字符串里出现过**同名文字（`// TODO: extractQualityArgs`）。要彻底解决需要真正的语法解析（把源码 parse 成 AST 再找标识符节点），代价远大于收益——注释里出现一个函数名的概率低，且即便发生，图上的名字仍然指向真实存在的东西。

**位置**：validate.js:174。

---

## 3. 空白归一化子串匹配

**问题**：internal 模块的 `source` 必须是源码的**逐字复制**。但模型复述源码时最常见的失真**不是改字，是改空白**——把两行合成一行、改了缩进、去掉了空行。严格的 `includes` 会因此把「内容其实完全正确」的 source 判为错。

**做法**：两侧都做 `replace(/\s+/g, ' ').trim()` 再 `includes`。即**空白折叠成一个空格**后比较。

**为什么归一化空白是安全的**：空白在 JS 里只有分词作用，`a  b` 和 `a b` 在语法上完全等价（字符串字面量内部的空白除外——那种情况归一化会让**校验放松**而不是收紧，即可能放过一个改动了字符串内容的 source。代价可接受：真正危险的是**改逻辑**，而改逻辑必然伴随非空白字符的变动，会被抓住）。

**与 #2 的分工**：#2 保证**名字对**，#3 保证**正文对**。两条一起，把「模型编造/改写源码」这个最大风险按在 render 之前。

**位置**：validate.js:182。

---

## 4. 可译字段的两种形态（expand 步）

**问题**：说明性文字要能中英切换，IR 里的**散文**字段（`meta.subtitle` / `meta.input` / `meta.output` / `group.label` / `group.description` / `module.description` / `module.detail` / `connection.label`）从 `string` 变成 `{zh, en}`。但 `generated/` 里那份**单语**产物还得继续能校验、能渲染。

**做法**：`isTranslatable(x) = 非空字符串 || （对象且 zh/en 至少一个非空）`，列表形态用 `isTranslatableArray`（逐项判）。`module.label` / `id` / `source` / `from` / `to` **不走这条**，它们永远是 `string`——名字译了就对不上源码，本文件 #2 的存在性检查也会立刻失效。

**为什么只到「至少一种语言」**：这是 expand 步，只放宽不收口。「`zh` 与 `en` 都必填」是契约步的硬校验，两条刻意分开落地——`validate` 一收紧，`generated/` 里现有的单语 IR 就全线报错，而重新生成是用户手动做的，在实现之后。中间那段窗口里分不清「校验写错了」和「产物还没更新」。

**位置**：validate.js 顶部的 `isTranslatable` / `isTranslatableArray`。

---

## 错误报告契约

```
connections[3].from: 'from' must reference an internal module, got 'ext_fs'
modules[7].label: internal module 'extractQualityArg' not found in source
```

格式统一为 `<JSON 路径>: <一句话说明>`，每行一条，`OK` 表示全通过，退出码 1 表示有错。CLI 与 `validate(ir, source)` 函数共用同一份输出逻辑——测试直接断函数返回的 `errors` 数组，不需要起进程。

**测试**：`oh-grasp/test/validate.test.js`。
