# group 输入/输出从边界边推导，废除手写 inputSummary/outputSummary

ADR-0005 曾允许模型给分组手写 `inputSummary`/`outputSummary`（一句话摘要，显示在端口旁）。落地后实测发现系统性脱节：摘要写「子命令名、参数」，端口处从边界边推导出的真实入边却是「renderer invocation ×4」——摘要=模型猜，边=数据真，两者并存必打架，正是「输入/输出判断存在问题」的根因。

改为：group / 叶子的输入/输出**全部从连接图推导**——输入=所有入边 label，输出=所有出边 label，删除 `inputSummary`/`outputSummary` 字段。认知层的「一句话概括」由已有的 `description` 字段承担，I/O 只陈述事实、不再抽象。展示层用「同类 label 去重合并」（如 `renderer invocation ×5`）压掉流水账。

两个连带决策：

1. **external 依赖不进 group 输入**。external 是文件级关注点（侧边 rail 按「一个 import 一张卡」完整覆盖），group 的对外接口仍是组间边界边（ADR-0005 不变）。
2. **空 I/O 优雅兜底**。无组间边的 group 输入/输出显示「—」，不显示空端口或误导性摘要。

不变量收紧为「边必须是真实调用/数据流」，并在 prompt 要求「写全真实组间边」——推导出的 I/O 只和边一样完整，漏边（如 grp_misc_commands 的 `command_* → run_node`）会让 I/O 变空。

（supersedes ADR-0005 中「模型可额外给分组一句 inputSummary/outputSummary」一条，其余不变。）
