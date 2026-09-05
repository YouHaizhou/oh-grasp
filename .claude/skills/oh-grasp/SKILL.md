---
name: oh-grasp
description: 为单个 JavaScript 文件生成自包含 HTML 结构图（外部依赖、内部模块、数据流、输入输出、文件作用）。当用户想快速理解一个陌生 JS 文件、或要求画出某文件的依赖/结构图时使用。
---

# oh-grasp — 单文件结构图

给一个 JS 文件产出一张**自包含 HTML 结构图**：外部模块（一个 import 一个）、内部模块、模块间数据流、输入/输出、文件作用。

所有路径相对于**项目根目录**（`E:\Work\project`）。

## 工作流

1. 读 `oh-grasp/prompt.md` 了解产出契约，读 `oh-grasp/schema.json` 了解 JSON IR 字段。
2. 读用户指定的 JS 文件（只读这一个文件，不追 import）。
3. 产出 JSON IR，写到临时文件 `.scratch/oh-grasp-ir.json`。
4. 校验：`node oh-grasp/validate.js .scratch/oh-grasp-ir.json <源文件路径>`。若有错误，按每条 `path: message` 修正 IR 后重跑，直到输出 `OK`。
5. 渲染：`node oh-grasp/render.js .scratch/oh-grasp-ir.json <输出.html>` 生成自包含 HTML。
6. 把输出 HTML 的路径告诉用户。

## 约束

- internal 模块的 `label` 必须用源码中真实存在的标识符（函数/类名），否则校验的存在性检查会报错。
- internal 模块需产出 `description`（概要）+ `detail`（详细介绍）+ `source`（原文源码）。
- 一个 import / require = 一个 external 模块，不要合并。
- 只输出 JSON IR，不输出解释文字（除了把结果路径告诉用户）。
