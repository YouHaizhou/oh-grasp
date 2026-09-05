Q1 — oh-grasp 和 Archify 的关系 + 复用策略

  这个 template 是 Archify 的输出，tt-a1i 大概率是你自己。那么 oh-grasp 该拿它怎么办：
  - (a) Archify 是你已有的项目，oh-grasp 复用它那个自包含 viewer 模板（当静态资产打包）+ 自己定义一份裁剪版 JSON schema（只针对单文件），但不搬它的
  CLI/渲染器/checker/delta 那套重型机器；
  - (b) 从零做一套轻量 viewer，只借鉴输出形态；
  - (c) 其他。
ans：tt-a1i是另一个开源作者，archify是他写，我受这个项目的启发，决定做这个grasp的项目，先从b开始。

  🧩 Q2 — 中间产物定案：JSON IR 取代 Mermaid

  管线改为：模型读 JS 文件 → 产出 JSON IR → 校验脚本验 schema + 存在性 → 注入 viewer → 自包含 HTML。Mermaid 退出主线。
ans：采用推荐的
  💡 推荐：采纳。校验脚本从「验 Mermaid 语法」变成「验 JSON
  schema」（更干净、更符合你说的「检验模型输出」）。除非你后面想加个「聊天里快速预览」的可选文本视图——那是后话。

  🎯 Q3 — viewer 原样复用 vs 裁剪

  那个 HTML 是 722KB，带 guided views / overview map / semantic lens / delta 等单文件图用不上的功能；唯一外部依赖是 Google Fonts
  CDN（异步、断网回退系统字体）。
  - (a) 原样复用，只换 JSON；
  - (b) 裁剪成轻量版：去掉用不上的面板、砍掉 Google Fonts 改系统字体，做到真·离线零依赖；
  - (c) 先原样跑通，裁剪留作优化。
ans：我只是说受archify启发，写一个可视化的项目，思路可以参考，代码不准备复用。
  💡 推荐 (c) 先原样跑通再裁剪：先用现成 viewer 把「模型→JSON→注入→HTML」闭环跑通、验证价值，裁剪是纯优化、不阻塞主线。