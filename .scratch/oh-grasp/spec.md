# oh-grasp — 单文件结构图增强服务

## Problem Statement

一个开发者落进一个陌生的、体量较大的 JavaScript 文件，需要快速搞清楚：它依赖了哪些外部模块、内部有哪些模块、它们之间怎么通过数据流组合、这个文件的输入输出是什么、它到底是干什么的。现有的 agent 平台（Claude Code 等）能读这个文件，但不会稳定地产出一张干净、可信、经过校验的结构图——要么靠人自己拼，要么接受模型随口画出来的不可靠结果。

## Solution

oh-grasp 是一个轻量、零第三方依赖的「增强服务 (Enhancement)」。装进 agent 平台（第一版：Claude Code）后，它给平台自带的模型新增一项能力：针对单个 JS 文件产出一张自包含的 HTML 文件结构图。

模型分析文件、产出一份经过校验的 **JSON IR**；校验脚本按 schema + 存在性检查它；一个从零实现、仅借鉴 Archify 输出形态的轻量 **viewer** 把 IR 渲染成自包含 HTML。图的内容：外部模块（一个 import 一个）、内部模块及模块间数据流、文件的输入/输出、文件作用。

## User Stories

1. As a developer, I want to install oh-grasp onto my agent platform without installing any additional package or runtime, so that I can use it immediately with zero setup.
2. As a developer, I want to point the agent at a single JavaScript file and ask for its structure diagram, so that I can understand an unfamiliar file on demand.
3. As a developer, I want the diagram to list every external module the file imports (one node per import), so that I can see the file's external surface at a glance.
4. As a developer, I want each external module to show what the file consumes from it, so that I understand why each dependency matters.
5. As a developer, I want the file's internals divided into modules, so that I can see its logical structure rather than a raw function list.
6. As a developer, I want the diagram to show data flow between internal modules, so that I can trace how data moves through the file.
7. As a developer, I want each module to carry a short description, so that I understand its role without reading its code.
8. As a developer, I want the file's purpose stated up front, so that I know in one sentence what the file is for.
9. As a developer, I want the file's inputs and outputs stated explicitly, so that I understand its contract without tracing code.
10. As a developer, I want the result as a single self-contained HTML file, so that I can open it anywhere, offline, with no external network or CDN.
11. As a developer, I want the agent's output to be validated before I see it, so that I'm not shown a diagram with fabricated or dangling modules.
12. As a developer, I want the validation to report exactly what's wrong, so that the agent can self-correct instead of me debugging the diagram.
13. As a developer, I want the enhancement to reuse my platform's own model for the analysis, so that no heavy engine or separate model is shipped.
14. As a developer, I want the enhancement to be written in Node with zero third-party packages, so that it runs anywhere Node runs.
15. As a developer, I want the enhancement to be packaged as a Claude Code skill, so that it integrates with the platform I use first.
16. As an agent (model), I want a clear, unambiguous JSON IR contract to produce, so that I know exactly what shape my analysis must take.
17. As an agent, I want the validation script's error messages to point at specific fields, so that I can fix my output in one pass.
18. As a maintainer, I want the portable layer named "Enhancement" (not "skill"), so that it doesn't collide with Claude Code's native Skill mechanism when we add more platforms.
19. As a developer, I want to switch between a flow diagram and an index table of the same file, so that I can read it either as a graph or as a reference list depending on what I'm doing.
20. As a developer, I want to click an internal module to see its detailed description and real source code in a popup, so that I can inspect a module without leaving the diagram.
21. As a developer, I want each internal module to have both a short summary and a detailed explanation, so that the graph stays clean while the details remain reachable.
22. As a developer, I want to zoom and pan the flow diagram with the mouse (zoom centered on the cursor), so that I can navigate a large graph without scrolling the page.

## Implementation Decisions

- **增强服务包的结构**：一个增强服务 = prompt + JSON schema + 校验脚本 + viewer 模板；Claude Code 上以 Skill 落地，可移植层叫 Enhancement，通过 Adapter 映射到各平台。
- **JSON IR schema（单文件裁剪版）**：顶层含 `meta`（标题=文件名、副标题=作用、输入/输出）与模块列表；每个模块含 `id`、`label`、`type`（external / internal）、`description`（概要）；内部模块另含 `detail`（详细介绍）与 `source`（真实源码/签名）；外部模块含 `input`（从它消费什么）；连接（`connections`）表示内部模块间的数据流，每条含 `from`、`to`、`label`。不照搬 Archify 的完整 schema，只保留单文件图需要的字段。
- **校验脚本**：`validate(ir, source?) → { ok, errors[] }`。验 schema（字段齐全、类型正确、connections 引用可解析、无悬空 id）+ 存在性（传入 source 时，internal 模块在 JS 源码里有对应定义）。用 Node 标准库实现，零第三方包。
- **viewer**：从零实现的轻量自包含 HTML，仅借鉴 Archify 的输出形态（配色/布局气质），不复用其代码。内联 CSS/JS，无 CDN、无外部字体，真·离线零依赖。提供两种可切换样式：**Flow**（分层数据流图，内部模块可点击弹出 `detail` + `source` 弹窗，图内支持光标锚点滚轮缩放 + 拖拽平移 + 双击复位）与 **Index**（文档式表格：外部依赖卡片 + 内部模块职责/数据流表）。统一浅色配色。视觉形态经原型（`prototype/viewer-prototype.html`）确认。
- **prompt**：指导模型读 JS 文件、产出 JSON IR 的指令；明确「一个 import = 一个外部模块」「只读这一个文件，不追 import」「内部模块划分 + 数据流」等约束；内部模块需产出 `description`（概要）+ `detail`（详细介绍）+ `source`（原文源码）。
- **语言与平台边界**：v1 只支持 JavaScript 文件；第一平台 Claude Code。零依赖 = 零第三方包 + Node 标准库。
- **命名**：可移植单元叫「增强服务 / Enhancement」，避免与 Claude Code 的「Skill」撞名。

## Testing Decisions

- **好测试的标准**：只测外部行为——`validate` 对合法 IR 返回 ok、对非法 IR 返回带精确 path 的错误；不测校验脚本内部实现细节。
- **主 seam（一个）**：`validate(ir, source?) → { ok, errors[] }`。单元测试覆盖 schema 违规（缺字段、类型错、悬空引用）与存在性违规（内部模块在 source 中不存在）。
- **模型分析（JS→IR）**：golden eval——若干已知 JS 文件，跑模型产出 IR，断言产物通过 `validate` 且关键模块/依赖与预期一致。非单元 seam。
- **viewer 渲染（IR→HTML）**：golden 测试——给定合法 IR，断言产出 HTML 自包含（无外部 `<link>`/`<script src>`/CDN 引用）且包含各模块 label。
- **Prior art**：仓库是全新项目，无既有测试可参照；从零建立测试约定（Node 内置 test runner 或最小测试脚本，保持零依赖）。

## Out of Scope

- 非 JavaScript 文件（Python / TS 等）。
- 非代码文件（Markdown、配置等）——roadmap 后续。
- 项目级文件图（聚合多个单文件图）+ 图内容排版——roadmap 后续。
- DSH、Codex 等其他平台的 Adapter——仅 Claude Code。
- 复用 Archify 的任何代码——明确不复用（见 ADR-0003）。
- Mermaid 输出。
- viewer 的重功能（guided views / overview map / 多主题预设 / delta 比对）。

## Further Notes

- 受 Archify（作者 tt-a1i，独立开源作者）启发，但完全独立实现。
- 未来路线：非代码文件 → 项目文件图（单文件图聚合）+ 排版。
- viewer 的视觉形态是「得亲眼看」的问题：实现时若对样式拿不准，先用一个小原型确认，再落正式 viewer。
- viewer 视觉原型已捕获在 `prototype/viewer` 分支（`oh-grasp/prototype/viewer-prototype.html` 与 `docs/prototype/round*.md`），不进 main。
