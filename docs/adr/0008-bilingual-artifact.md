# 双语产物：只译散文、双语必填、边四段说明

对「新一版产物」的 8 条反馈里，第 2、3、4 条是同一个病根：**图上的文字看不懂**。

- 连线中点写着 `renderer script path`、`subprocess result`——模型写的原始英文 label，脱离源码读不出意思；
- 反馈原话要的是「介绍这个数据从哪里来，经过什么处理，输出了什么，用于什么」；
- 由此要求整体产物支持中英文两种版本。

查过真实 IR 后确认了缺口的形状：**47 条 connection 的 label 全是英文**，而所有 `description` / `detail` / `meta.input` / `meta.output` / 分组描述**都是中文**。所以中文不是「新增一种语言」，是**补上本来就没写的东西**；英文那边则是把已有的散文字段补成双语。

## 可译与不可译：只有「散文」进双语

凭「这段文字是不是一个**名字**」划线：

| 可译（`{zh, en}`） | 不可译（保持字符串） |
|---|---|
| `meta.subtitle` / `meta.input` / `meta.output` | `meta.title`（是文件名，如 `archify.mjs`） |
| `group.label` / `group.description` | `module.label`（internal 是源码标识符；external 是包名 `node:fs`） |
| `module.description` / `module.detail` | 全部 `id` / `source` / `sourceLine` / `from` / `to` / `group` |
| `connection.label` / `connection.description`（四段） | |

理由是不破 ADR-0004 的不变量：internal 模块的 `label` 必须在源码里真实存在，`source` 必须逐字匹配。**名字一旦翻译，这两条检查立刻失效**——图上的名字就不再是代码里的名字了。

`group.label`（如「参数解析」）是模型起的抽象名而非标识符，可译；`module.description` 一句话的职责描述，可译。

## 嵌套方向：语言在外

```jsonc
"description": { "zh": { … }, "en": { … } }
"label":       { "zh": "参数解析", "en": "Argument parsing" }
```

切换语言 = **换一个子树**，viewer 一个 `pick(field)` 取值函数贯穿全部字段。反过来（字段在外、语言在叶）会让 validate 的「双语必填」必须递归到每个叶子才知道漏了哪个语言的哪一段。

## 双语必填，硬报错

`validate` 缺任一语言即报错，不给出图机会。

考虑过「至少一种语言、缺另一种则回退并标注」，否掉的理由正是病根：**静默回退会把中英混杂原样放回来**。用户要的是两个都能读的版本，不是「凑合能读」的版本。代价是生成字量上升——这是这个决定的票价。

## 边四段说明

反馈原话「从哪里来 / 经过什么处理 / 输出了什么 / 用于什么」，直接落成四个固定字段：

```jsonc
"connection": {
  "from": "…", "to": "…",
  "label": { "zh": "传入渲染器路径", "en": "pass the renderer path" },
  "description": {
    "zh": { "source": "…", "process": "…", "output": "…", "purpose": "…" },
    "en": { "source": "…", "process": "…", "output": "…", "purpose": "…" }
  }
}
```

**字段名保留 `source/process/output/purpose`**，靠嵌套与 `module.source`（源码原文）消歧。`from` 已被 connection 占用（表示源模块 id），不能挪来表示「数据从哪来」；改名成 `origin/how/what/why` 会丢掉字段名与用户原话的一一对应。

**写在每条 connection 上，不建字典。** 顶层那条聚合边点开时，列出其下每条 connection 的四段（按来源模块分组）。原子写在 connection 上，任何出现位置（顶层、子图、端口清单、边界数据流）点开都一致。

**同 label 复用同一段文字**（prompt 要求，validate 不强制）：47 条 connection 只有 20 个不同 label，同一个词写两遍会写出两套说法（`renderer script path` 在一处叫「渲染器脚本路径」、另一处叫「渲染脚本地址」），读者会怀疑它们是不是同一个东西。考虑过在顶层加一张 `flows` 字典让 connection 引用 id——为省 216 句话引入跨表引用不划算。

**长度是风格要求不是契约**：prompt 给指引（每段约 ≤40 字），validate 只查非空。硬校验会逼模型砍掉限定语，而「这个路径来自 CLI 参数」这类前提正是长度的来源——砍掉它就把说明砍成了标签。

## 中点：中文动宾短语

聚合边中点显示一句**中文动宾短语**（如「传入渲染器路径」），延续 ADR-0007 的「≤3 个不同 label 全列、超了折 `+N`」聚合约定，但 label 本身从「数据名」变成「动作」。一句读得懂的短语 + 点开看四段，取代「把四段塞进中点」（必糊）。

## 切换器：顶部 header，默认中文，不记忆

- **位置**：顶部 header 内（标题右侧），不复用被删的底部固定条。语言不改变**看什么**、只改变**文字**，属于阅读偏好而不是导航状态，做成一等公民的固定按钮会稀释它的语义。
- **默认中文**：IR 的母语，也是主要读者的语言；每次打开都可预期。
- **不记忆**（不用 localStorage）：记住之后的第一次打开总有人问「为什么是英文」。

## UI 文案表

viewer 里那批固定文案——`输入` / `输出` / `依赖 Dependencies` / `内部数据流` / `边界数据流` / `GROUP` / `INTERNAL` / `×N` 的说明 / 提示行——**不属于 IR**，在 viewer 内建一张 `T = {zh:{…}, en:{…}}` 表跟着语言切换。这条不受「可译/不可译」划线影响，无论哪种字段方案都要做。

## 决策汇总（supersede 关系）

| 决策 | 来源 | 取代 |
|---|---|---|
| 只译散文、标识符不译 | round18-Q1 | — |
| 语言在外 `{zh, en}` | round18-Q3 | — |
| 双语必填、硬报错 | round17-Q2 | — |
| 四段固定 `source/process/output/purpose`、写在 connection 上 | round17-Q3/Q4、round18-Q2 | — |
| 同 label 复用同一段文字 | round19-Q1 | round17-Q4 的「每条各写、靠自觉一致」 |
| 长度只给 prompt 指引 | round19-Q8 | — |
| 中点为中文动宾短语 | round16-Q3 | ADR-0007「边注释：label = 真实 label 逗号拼接」（`≤3`/`+N` 的聚合约定保留） |
| 切换器在 header、默认中文、不记忆 | round16-Q4、round19-Q4 | — |
| UI 文案表进 viewer | round18-Q1 | — |

## 代价与已知限制

- **这是本项目最大的一次生成**：约 166 条散文字段 × 2 语言 + 47 条 connection 的四段 × 2 语言 + 41 个模块的 `uses`/`runtime`（ADR-0011），量级约 700 句。
- validate 的「双语必填」一上线，`generated/` 里现有的**单语 IR 立刻全线报错**。这是预期行为，不是回归——旧产物在重新生成之前是坏的。
