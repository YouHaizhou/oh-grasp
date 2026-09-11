# 01 — 双语取值层：`pick()` + 语言切换器 + UI 文案表

**What to build:** 图上所有说明性文字能中英切换。做法是把**所有散文字段的读取收口到一个取值函数**（`pick(field, lang)`），它同时接受新形态 `{zh, en}` 和旧的普通字符串——因此**现有那份单语真实 IR 照常渲染**。顶部 header 加语言切换器（默认中文、切换即时生效、不记忆）。查看器自带的固定 UI 文案走一张 `T = {zh, en}` 表。IR schema 放宽为两种形态都收。

这一票是宽重构的 **expand** 步：新旧并存，不收口。它不开任何硬校验。

**Blocked by:** None — 可立即开始

**Status:** ready-for-agent

- [ ] `pick()` 从查看器纯内核导出，Node 下可单测：传 `{zh, en}` 按语言返回；传普通 `string` 原样返回（不抛错、不返回 undefined）
- [ ] 查看器内**没有**任何绕开 `pick` 直接取散文字段的旁路——用搜索可断言（散文字段的读取点全部经 `pick`）
- [ ] header 内切换器：切到 EN 后副标题 / 分组名 / 分组描述 / 模块描述 / 模块详情 / 连线标签全部变英文；切回 ZH 复原
- [ ] 默认中文；刷新页面后仍是中文（不记忆，无 localStorage）
- [ ] 固定 UI 文案跟着切换：输入 / 输出 / 依赖 / 内部数据流 / 边界数据流 / GROUP / INTERNAL / 空方向「—」/ 弹窗分节标题 / 提示行
- [ ] 新增一份**双语 fixture**；`node --test` 从 62 起只增不减，全绿
- [ ] **现有单语真实产物仍能正常渲染**（expand 未收口——这条是本票的核心约束，不是附带）

**参考**：ADR-0008；spec `docs/spec/product-shape.md` 的 User Stories 1–10；改动面见 `.scratch/oh-grasp/to-spec-input.md` §6。
