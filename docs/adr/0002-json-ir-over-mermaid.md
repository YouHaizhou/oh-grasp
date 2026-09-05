# JSON IR 作为中间产物，Mermaid 退场

模型的中间产出是结构化 **JSON IR**，而非 Mermaid 文本。viewer 需要结构化数据（模块、连接、摘要）来渲染与校验，JSON IR 比 Mermaid 文本 DSL 更适合作为校验脚本的输入与渲染的数据源。Mermaid 曾在讨论中作为候选，现已退出主线。
