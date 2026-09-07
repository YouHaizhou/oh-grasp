# oh-grasp

为单个 JavaScript 文件生成**自包含 HTML 结构图**的轻量增强服务：外部依赖、内部模块、模块间数据流、输入/输出、文件作用 —— 一张图看懂一个陌生文件。

**零第三方依赖**：只用 Node 标准库，产出单个 HTML 文件，离线可开，无 CDN、无外部字体。

## 能做什么

把任意一个 JS 文件交给它，得到一张经过校验、可信的结构图：

- **外部模块**：一个 import / require 一个节点，标注从它消费了什么
- **内部模块**：把文件内部逻辑划分成模块，每个带一句话概要 + 详细说明 + 真实源码
- **数据流**：内部模块之间如何通过数据串起来
- **输入 / 输出**：这个文件对外的契约
- **文件作用**：一句话说明它是干什么的

## 两种视图

| 视图 | 说明 |
| --- | --- |
| **Flow** | 分层数据流图。滚轮缩放（以光标为锚点）、拖拽平移、双击复位；点击内部模块弹出「详细说明 + 真实源码」弹窗 |
| **Index** | 文档式表格：外部依赖卡片 + 内部模块职责 / 数据流表 |

## 工作方式

```
JS 文件 → 模型分析 → JSON IR → 校验 → 渲染成自包含 HTML
```

1. 模型读文件，产出 **JSON IR**（字段由 `oh-grasp/schema.json` 定义）
2. `oh-grasp/validate.js` 按 schema + 存在性校验：字段类型、悬空引用、内部模块是否真在源码中存在，报错精确到字段
3. `oh-grasp/render.js` 把 IR 渲染成单个自包含 HTML（内联 CSS / JS，无外部资源）

## 使用（Claude Code）

skill 入口在 `.claude/skills/oh-grasp/SKILL.md`。把它放进你的 Claude Code 后，指向任意 JS 文件即可：

> 帮我用 oh-grasp 分析 `path/to/file.js`

或用 `/oh-grasp` 显式调用。

## 目录结构

```
.claude/skills/oh-grasp/SKILL.md   Claude Code skill 入口
oh-grasp/prompt.md                 模型产出 IR 的契约
oh-grasp/schema.json               JSON IR schema
oh-grasp/validate.js               校验（schema + 存在性）
oh-grasp/render.js                 CLI 渲染器
oh-grasp/viewer.js                 浏览器端 viewer（由 render 内联）
oh-grasp/examples/                 示例（sample.js / IR / HTML）
oh-grasp/test/                     测试
docs/adr/                          架构决策记录
```

## 测试

```
node --test
```

## Roadmap

- 非代码文件（Markdown、配置）
- 项目级文件图（单文件图聚合）+ 排版
- 其他平台 Adapter（DSH、Codex）

## 灵感与独立实现

受 [Archify](https://github.com/tt-a1i/archify)（作者 tt-a1i）启发，但完全独立实现（见 `docs/adr/0003-clean-room-viewer.md`）。

## License

[MIT](./LICENSE)
