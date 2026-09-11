# 06 — 外部依赖可追踪：`uses` / `runtime` + 反向索引

**What to build:** 让图能回答「谁在用 `node:path`、改了它会炸谁」——这个问题现在**在图里没有任何答案**（`connections` 只允许 internal ↔ internal，外部依赖根本不在数据模型里；default 导入的依赖更是完全失明）。做法是给内部模块加两个字段：`uses`（直接消费了哪些外部模块）与 `runtime`（对宿主运行时的调用，如 `process.exit`）。显示在三个地方：group 弹窗分两段、叶子弹窗加一行依赖、侧栏依赖卡片加**反向索引**。

**Blocked by:** 01（双语字段）、05（group 弹窗分两段的容器）

**Status:** ready-for-agent

- [ ] schema 给 internal 模块加 `uses`（external 模块 id 数组）与 `runtime`（属性路径字符串数组）
- [ ] 校验：`uses` 每项必须存在**且 `type === "external"`**，否则报错（防悬空 / 防指向内部模块）
- [ ] 校验：`runtime` 每项匹配属性路径正则 `^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)+$`——**带括号的 `process.exit()` 必须被拒**（它是唯一自由文本字段，必须统形）
- [ ] `uses` 是**消费关系，不是数据流边**：外部依赖**不进** `connections`
- [ ] group 弹窗分两段：「组间边」+「成员直连外部」（后者把成员 `uses` 按 external 归并）
- [ ] 叶子弹窗加一行依赖：`依赖 node:path · 宿主 process.exit`
- [ ] 侧栏依赖卡片加**反向索引**（哪些模块用了它）：前 3 个 + `+M`，与边中点标签 `a · b +2` **复用同一套约定**；点卡片展开全列
- [ ] 单测覆盖：`uses` 指向 non-external 报错；`runtime` 写成 `process.exit()` 报错
- [ ] `docs/algorithms/validation.md` 同步新增的两条校验

**参考**：ADR-0011；spec User Stories 47–55；`docs/grill-with-docs/round20.md` 开头的更正一节（解释代理估算为何对 default 导入完全失明）。
