诊断（facts，我的活）

  我读了重跑后的 IR（generated/archify.mjs/oh-grasp-ir.json）和 viewer.js，把这 5 个问题落到具体事实：

  1. **输入/输出判断错，根因是「手写摘要和真实边脱节」**。8 个 group 每个都手写了 inputSummary/outputSummary，但它们和端口处从边界边推导出的真实列表对不上。最典型的 grp_cli_core：摘要写输入「子命令名、参数、图表类型」，但真实入边是 renderer+args、renderer invocation（×4）、subprocess result——没有一条是「子命令名」；摘要写输出「渲染器脚本路径 / 子进程结果 / 退出码」，但真实出边只有「renderer script path」「env vars」两条，「子进程结果/退出码」是 run_node/exit_from 的返回值、根本不是输出。摘要=模型猜，边=数据真，两者并存必打架。
  2. **external 依赖完全不进 flow**。connections 只许 internal→internal，所以「这个 group 消费了 fs / crypto / spawnSync」在折叠后一个都看不到。group 的真实输入里有一大块外部依赖是缺的。
  3. **组内子图大面积空转**。18 条 connection 里只有 3 条是组内的（grp_compare×2、grp_validate_migrate×1），剩下 6 个 group 的「内部数据流」是空的——点开是一堆散落的成员盒子、没有线。这不是模型偷懒：分组是按「功能域」聚的（诊断助手、命令处理器…），而真实调用是「命令处理器 → 各域助手」的星形结构，天然跨组多、组内少。硬要模型补组内边 = 编造。
  4. **badge 相同**：徽标 `GROUP · N 模块` 用的是**成员数**，所以成员数相同的 group 徽标一模一样（grp_cli_core 和 grp_misc_commands 都是「GROUP · 7 模块」，grp_render/grp_arg_parse/grp_validate_migrate 都是「GROUP · 4 模块」）。而组名 label 就在徽标下面一行，徽标纯冗余。
  5. **卡片排版挤**：group 卡 260×96，塞了 5 行——badge、label、description（截到 24 字符）、inputSummary（左下）、outputSummary（右下）。input/output 挤在同一行 y+82，两端往中间一长就重叠；description 截 24 字丢信息。
  6. **边注释不清晰**：聚合边（多条同向）的 label 显示「N 条数据流」——只有个数、没有内容；单条边的 label 是「renderer + args」这种半截短语，且贴在起点 (x+12) 处、压在曲线上，难读、难对应。
  7. **子图无整体操作**：miniFlowSvg 是静态 SVG，顶层有滚轮缩放（光标锚点）/拖拽平移/双击复位，子图一个都没有。

  7、3（子图缩放）这两条是明摆着的修复，我会直接复用顶层交互，不算决策。真正要你拍板的是 1/2/4/5/6 背后的几个方向。

  ---
  🔥 Round 1 · 4 questions

  🎯 Q1 - 输入/输出的来源（根决策，牵动 issue#1 和 #4d）
  group（和叶子）的「输入」「输出」到底从哪里来？
  - (a) 从连接图推导：输入=所有入边 label、输出=所有出边 label，删除手写 inputSummary/outputSummary。摘要永远和边一致、零编造；但多进多出时列表偏「流水账」（如 grp_cli_core 入边有 5 条「renderer invocation」）。
  - (b) 手写摘要 + 推导边并存：保留 inputSummary/outputSummary 作「概览一句话」放卡片，端口/弹窗放推导边。两层分工、摘要不必逐字对应边，但摘要仍可能错（语义无法校验）。
  - (c) 手写摘要为纲、推导边为明细：卡片主打摘要，点开才看真实边。视觉最简，但摘要错误的代价最大（用户第一眼看到的就是错的）。
  💡 推荐 (a)。你 #1 的抱怨正是「判断存在问题」——错就错在摘要这个模型猜。本项目「不编造」是硬约束，I/O 交给边推导就永远对；「一句话概括」这个认知功能由已有的 `description` 字段继续承担，inputSummary/outputSummary 删掉。流水账的问题靠展示层解决（同类 label 去重合并，如「renderer invocation ×5」）。
ans：a。

  🧩 Q2 - group 卡片排版（issue#2 + #4a）
  折叠后的 group 卡片该显示什么、多高？
  - (a) 极简：只组名 label + 成员数小标。description / I/O 全进弹窗。顶层最干净、无重叠，但信息最少。
  - (b) label + description（整句，不截 24）+ 推导出的输入/输出端口。删掉冗余的「GROUP · N 模块」徽标（成员数缩成右上角小标「7 modules」）。卡片加高到放得下 3 行。
  - (c) 维持现状五件套，只把 input/output 从同行改成上下两行。信息最全，但仍是这版的挤。
  💡 推荐 (b)。徽标冗余且相同（你 #4a 的痛）→ 删；description 是你 #4b 的「模块作用」、要整句；I/O 走 Q1 的推导边放端口。顶层图既信息足又不挤。
ans：b

  🧩 Q3 - 边上数据流注释怎么显示（issue#5）
  边上的 label 现在要么「N 条数据流」（只有个数）要么半截短语、还贴在起点压着线。
  - (a) 显示具体内容：每条边把真实 label 逗号拼接（如「renderer + args · renderer invocation」），超 3 条截断为「前 2 条 +N」。label 移到边中点、加白底晕圈保证可读。一眼看清流动什么。
  - (b) 保持聚合、点开才看：默认「N 条数据流」，悬停/点击展开明细列表。顶层最干净，但不动手就永远不知道流动啥（正是你现在的痛）。
  - (c) 只改提示词：要求模型把每条 connection 的 label 写得又短又具体。不动 viewer，但治标不治本——label 再短，聚合边还是「N 条」。
  💡 推荐 (a)。你要的是「看得懂流动啥」，具体 label 直接给；聚合只作兜底（>3 条才「+N」），label 挪到中点 + 白晕解决压线问题。提示词侧的 label 质量可以顺带收紧，但主修是 viewer。
ans：a。

  ⚖️ Q4 - 组内子图空转时怎么呈现（issue#4d 的后半）
  6/8 的 group 内部没有边，点开是一堆散落盒子。怎么处理「组内无边」？
  - (a) 接受稀疏、优雅降级：有组内边就画 flow，无边则退化为「成员清单」——成员网格卡片（含各自 description），不强行画线。诚实、不编造。
  - (b) 提示词要求补足组内数据流：让模型尽量写组成员之间的边。子图会热闹，但多数组内函数真不互相传数据，强补=编造。
  - (c) 折叠子图不单独展示：点 group 不弹子图，改弹「成员清单 + 边界数据流」，组内关系并入边界边一起看。相当于把 (a) 的「成员清单」固定为主形态。
  💡 推荐 (a)。组内边稀疏是真实结构（星形调用，跨组多），不是模型漏写；补边违背「不编造」。有边画边、无边给成员清单，子图交互复用顶层缩放（我直接做，见诊断第 7 条）。
ans：a

  ---
  待定（先不拍，看 Q1 答案再定）：external 依赖是否进 flow（issue#1 的第 2 个事实）——若 Q1 选 (a) 推导，那「group 消费了 fs/spawnSync」也该算输入，可能要给 connections 加 external→internal 边或单独映射，这是 schema 改动，留到下一轮。
