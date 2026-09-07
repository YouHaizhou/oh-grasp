# oh-grasp 分析提示（可移植）

你的任务：读取一个**单个 JavaScript 文件**，产出符合 `schema.json` 的 **JSON IR**（中间表示），供后续校验与渲染。

## 输入

用户指定一个 JS 文件的路径。**只读这一个文件**，不要追着 import / require 去读其它文件。

## 产出：JSON IR

严格按 `schema.json` 的字段产出 JSON，只输出 JSON（可包在一个代码块里，不要带解释文字）。

1. **meta**
   - `title`：文件名（含扩展名）。
   - `subtitle`：一句话说清这个文件是干什么的。
   - `input`：这个文件的输入（数组，可为空）。
   - `output`：这个文件的输出（数组，可为空）。

2. **modules**：把文件拆成模块。
   - **外部模块**：一个 import / require 对应**一个**外部模块，不要合并。`label` 用模块名（如 `react`、`fs`、`./utils`）。`type` = `"external"`。`input` = 从它消费的具名成员（数组，如 `["useState", "useEffect"]`；默认导入或整体引入用 `["default"]`）。`description` = 一句话说明为什么需要它。
   - **内部模块**：文件内的逻辑单元（函数 / 类 / 关键对象）。`label` 用源码里**真实存在的标识符**（函数名/类名），因为校验脚本会检查它是否在源码中存在。`type` = `"internal"`。
     - `description` = 一句话概要（图上显示）。
     - `detail` = 更完整的职责说明（弹窗里显示，比 description 长）。
     - `source` = 该模块的**完整函数体原文**（弹窗里显示，从源文件里原文摘出，含函数体全部内容，不要只给声明行）。
     - `sourceLine` = 该模块定义在源文件中的起始行号（整数，可选，仅展示用）。
   - 每个模块 `id` 唯一，用稳定的小写标识符（如 `ext_react`、`parse_config`）。

3. **connections**：内部模块之间的数据流。每条含 `from`（源 internal 模块 id）、`to`（目标 internal 模块 id）、`label`（流动的数据/含义）。**两端都必须是 internal 模块**。没有数据流可省略该字段。

## 约束

- 不要编造：每个 internal 模块都必须能在源码里找到对应定义（其 `label` 就是那个标识符）。
- `source` 必须从源文件**原文摘出**（可含换行、含完整函数体），不要重写、缩写或只给声明行。
- 一个 import = 一个外部模块。
- 只读这一个文件，不追 import。
