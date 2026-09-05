# oh-grasp — 单文件结构图增强服务

一个轻量、零第三方依赖的「增强服务」项目：给**单个代码文件**生成一张自包含 HTML 结构图（外部依赖、内部模块、数据流、输入输出、文件作用），帮助用户快速建立对陌生大文件的认知。装进 Claude Code 等 agent 平台，靠平台自身的模型去执行。受 Archify 启发，但独立实现。

## Language

**文件结构图 (File structure diagram)**:
本增强服务的唯一产出：针对单个代码文件生成的自包含 HTML 图，展示外部模块（一个 import 即一个）、内部模块及其数据流，并辅以输入/输出/作用说明。

**JSON IR (JSON 中间表示)**:
模型分析文件后产出的结构化数据（针对单文件的裁剪 schema：外部模块、内部模块、连接、摘要）。是校验脚本的输入、viewer 渲染的数据源；取代了 Mermaid。

**增强服务 (Enhancement)**:
一个自包含、零第三方依赖的包（prompt + Node 标准库脚本 + viewer 模板），装进 agent 平台后，给该平台的模型新增一项它原本不擅长的领域能力。
_Avoid_: skill（与 Claude Code 的 Skill 机制撞名）、plugin（与 DSH 插件撞名）

**适配器 (Adapter)**:
把一份增强服务映射到某个平台原生机制的薄层。Claude Code 上落地为 Skill，将来 DSH 上落地为插件。

**校验脚本 (Validation script)**:
用 Node 标准库写的脚本，校验 JSON IR 是否满足 schema（字段齐全、引用有效）与存在性（内部模块在文件中真存在），返回「过/不过 + 错在哪」，供模型自纠。

**查看器 (Viewer)**:
把 JSON IR 渲染成自包含 HTML 的轻量模板，从零实现、仅借鉴 Archify 的输出形态。无 CDN 依赖。

**零依赖 (Zero-dependency)**:
指零第三方包；仅依赖平台/机器自带的 Node 标准库。viewer 亦自包含（无外部字体/CDN）。是贯穿本项目的硬约束。
