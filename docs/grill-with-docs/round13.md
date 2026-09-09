Round 1 四题全答了（Q1=a 推导、Q2=b 卡片、Q3=a 具体 label、Q4=a 成员清单），且都命中推荐。frontier 只剩 round12 尾部挂起的那一个待定项——external 依赖进不进 flow。这是最后一个需要你拍的决策，定了就进 /implement。

  ---
  🔥 Round 2 · 1 question（收尾）

  🎯 Q1 - external 依赖算不算 group 的输入（round12 挂起的待定项）
  Q1 选了「从连接图推导」，那「group 消费了 fs / crypto / spawnSync」要不要也进输入？这决定动不动 schema。
  - (a) 进 flow：internal 加 `uses:[external_id]`，或放开 connections 允许 external→internal 边。group 输入 = 组间内部边 + 外部依赖。输入最完整，但要改 schema、作者负担加重、视觉更挤，且侧边 rail 已经按「一个 import 一张卡」完整列过这些依赖，会重复。
  - (b) 不进 flow：external 留在侧边 rail（文件级、一个 import 一张卡），group 输入 = 组间内部数据流。零 schema 改动；「文件依赖」和「组间数据流」两个层次分开，符合 ADR-0005 已定的「group 对外接口 = 组间边界边」。
  - (c) 折中：group 卡加一行「依赖」标注（只列外部模块名，不进边图），需新增 `uses` 字段。信息补全但不搅进边。
  💡 推荐 (b)。ADR-0005 已经把 group 的对外接口定为「组间边界边」，external 是文件级关注点、rail 已完整覆盖；塞进 group 输入会把两个层次搅浑，还动 schema。真到「要看每个 group 各自消费哪些外部模块」再上 (c) 或 (a)。
ans：b。
  ---
  Q1 一定，frontier 关闭。下面这些是我这轮直接做的非决策项（不占问题数，一并列出让你心里有数）：

  1. **子图复用顶层交互**（issue#3）：miniFlowSvg 加滚轮缩放（光标锚点）/拖拽平移/双击复位。
  2. **提示词收紧「写全真实组间边」**：现有 18 条边漏了 grp_misc_commands 的 command_* → run_node 这类真实调用，导致推导 I/O 变空。要求模型「每条真实组间调用/数据流都要写」，同时守住「只写真调用、不编造」。
  3. **label 中点 + 白晕**（issue#5 的展示细节）：边注释挪到边中点、加白底晕圈，超 3 条截「前 2 条 +N」。
  4. **空 I/O 优雅兜底**：无组间边的 group 输入/输出显示「—」，不显示空端口或误导性摘要。
