🔥 Round 3 · 2 questions（收尾）

  ⚖️ Q1 - 范围：variant B（Index 文档式）这轮动不动
  分组功能要不要同时改 B 变体？
  - (a) 不动 B：本轮只改 Flow 图（A 变体），B 保持现有平铺表格。
  - (b) B 也分组：Index 里内部模块按 group 分段展示（group 作小标题）。
  💡 推荐 (a)。你的痛点是流图排版/连线，B 是文档表格、没有节点拥挤和交叉问题；先聚焦 A，B 的分组是独立小活，别绑进这轮。
ans:a

  🧩 Q2 - group 摘要字段怎么落 schema（避免撞名撞型）
  现有 `input`/`output` 已经被用了两处且都是数组：meta.input/output（文件级，string[]）、external.input（消费成员，string[]）。group 的摘要是一句话，怎么命名/定型？
  - (a) 新增 `inputSummary` / `outputSummary`（字符串，一句话摘要，显示在端口旁）。
  - (b) 复用 `input`/`output` 名但为字符串——和另两处撞名撞型，模型易混。
  - (c) 复用 `input`/`output` 名且为数组——类型一致，但丢掉「一句话」的简洁。
  💡 推荐 (a)。摘要本质是一句话，字符串最贴；用 inputSummary/outputSummary 新名，彻底避开和 meta.input（文件级）、external.input（消费成员）的语义/类型冲突，schema 和 prompt 都清爽。
ans:a
