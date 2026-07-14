# 青序 LightFlow 三主 Tab：4188 功能排版一致性修正规格

> 参考源：用户指定的 `http://127.0.0.1:4188/`，以及用户提供的「截屏2026-07-13 23.57.45.png」。
>
> 用户确认：不再只复用冰蓝、白卡和亮蓝按钮等视觉语言；首页、AI 助手和“我的”三个主 Tab 均须按 4188 的目录式功能排版重构。保留真实功能、路由、认证、数据和合规边界。

## 1. 问题与结论

上一版的首页把服务组改成紧凑卡片，但仍保留了自定义的分组卡片骨架；AI 助手使用“工作台 + 右侧栏”，`/profile` 使用“个人头部 + 通用入口列表”。三页虽然颜色接近，却没有共享截图中的信息骨架，因此用户看到的功能排版不一致。

本批以截图的**结构**作为基准：六项顶部分类导航、扁平白色工作面板、首行双主入口、分隔线驱动的紧凑次入口、岗位与招聘会的等宽并列面板。不同页面只能替换面板里的真实功能内容，不能另起布局体系。

## 2. 全局结构合同

### 2.1 共同页壳

首页、`/assistant`、`/profile` 都使用同一个 `ReferenceServiceNav`：

- 六项固定标签和顺序：`简历服务`、`岗位信息`、`招聘会`、`打印扫描`、`面试训练`、`政策服务`。
- 桌面端为整行六等分文字导航，底部仅有一条浅色分隔线；不使用胶囊、独立卡片、阴影或大圆角。
- 固定映射为：`简历服务 → #resume`、`岗位信息 → #jobs`、`招聘会 → #job-fairs`、`打印扫描 → #print-scan`、`面试训练 → #interview`、`政策服务 → #policy`；短标签不复用首页长分组标题。
- 从 `/assistant` 与 `/profile` 点击分类时，使用 React Router 的 SPA 导航进入首页对应既有锚点；`HomePage` 挂载/路由 hash 变更后执行一次目标元素的 `scrollIntoView`。禁止 `<a href="/#…">`、`window.location` 或硬刷新，因为认证态仅在当前 React 会话内保持。
- 内容区使用同一冰蓝画布和白色扁平面板；面板之间仅保留截图级留白和细分隔线，不恢复大投影、纸纹、米色或墨青视觉。

### 2.2 面板与入口层级

截图的层级固定为四种，三个页面只能使用这四种：

1. **分组头**：56px 浅蓝图标底、深海军蓝标题、单行说明。
2. **主入口**：桌面两列同高，浅蓝底，亮蓝 56px 图标块，标题、说明与右箭头；最小高度 104px。
3. **次入口**：白底、细分隔线、图标、标题、单行说明与右箭头；最小高度 80px。
4. **并列工作面板**：桌面等宽两列，每个面板内部仍使用上述分组头、主入口和次入口；窄屏依次单列展开。

所有普通触控入口不少于 48px，主操作不少于 56px；390px 宽度不允许横向滚动。

### 2.3 共享排版原语与作用域

三页必须共用 `lf-reference-panel`、`lf-reference-group-head`、`lf-reference-primary`、`lf-reference-secondary` 与 `lf-reference-pair` 五个布局 class，以及同一个页面局部的 `reference-service-nav.css` / `reference-layout.css`。这五个 class 是截图层级的唯一原语，禁止在某一页另造同义的主卡、次卡或侧栏骨架。

共享 CSS 只能以 `.khome`、`.kassist.kassist-lightflow` 或 `.kprofile.kprofile-lightflow` 作为前缀，不得覆盖 `html`、`body`、`:root` 或 `/me/*`。同一 CSS 必须包含桌面六等分导航、390px 三列两行导航、桌面并列工作面板和窄屏单列回退。新增跨页静态守卫必须验证三页同时使用这五个 class 与同一 `ReferenceServiceNav`。

## 3. 各页面内容映射

### 3.1 首页 `/`

首页的 `service-value` Hero、`IdentityPanel`、`ContinuePanel`、真实登录弹窗、顶部终端状态和底部三 Tab 均保持现状，不改文案、位置和业务逻辑。顺序必须保持为 `IdentityPanel → ContinuePanel → ReferenceServiceNav`。

登录身份卡之后严格按参考图排列：

1. `ReferenceServiceNav`。
2. 全宽 **AI简历服务** 面板：
   - 第一行只有 `AI简历诊断` 与 `AI简历优化` 两张主入口；
   - 第二行 `简历素材库` 与 `职业规划`；
   - 第三行 `简历打印` 与 `求职材料`。
3. 两列并列：
   - 左列 **岗位信息**：`全部岗位` 主入口，`全职岗位`、`实习岗位`、`兼职信息`、`找企业` 与 `岗位大师` 均保持现有可用路由；其中 `岗位大师` 继续跳转 `/resume/job-fit`，不得在未获用户另行授权时关闭或改为禁用；
   - 右列 **招聘会**：`社会招聘会` 主入口，`校园招聘会` 次主入口，`扫码签到` 次入口，且保留来源平台预约/签到说明。
4. 后续 `打印扫描`、`AI面试训练` 和 `政策服务` 按同一白色面板系统继续排列；现有路由、禁用项、百宝箱、智慧校园和合规脚注不变。

### 3.2 AI 助手 `/assistant`

AI 助手不显示可见的“AI助手”页面标题，也不保留大段营销 Hero 或“左工作台 + 右侧栏”的独立骨架。

在同一顶部分类导航后，内容映射为：

1. 全宽 **当前会话** 面板：保留共享终端自动清场说明、文字/语音模式、真实消息列表、发送框、页内键盘、失败提示和“仅供参考”说明。
2. 模式选择使用截图中的两张主入口样式：`文字对话` 与在可用时的 `语音通话`；不改变 TRTC 懒加载与结束通话逻辑。
3. `快捷任务` 改为分隔线驱动的次入口区；每项仍进入现有真实路由。
4. `大家都在问` 与“结果去哪儿”改为同一紧凑面板中的次入口/说明行；点击问题仍只发送到当前会话，正式材料仍只进入既有功能页生成与保存。

### 3.3 我的 `/profile`

`/profile` 不显示可见的“我的”页面标题；`/me/*` 明细页、订单、资产、支付、认证和 API 均不改。

在同一顶部分类导航后，内容映射为：

1. 全宽 **身份与本次服务** 面板：复用真实登录、退出、设置、通知、服务端统计和本次会话记录；游客仅显示真实可用的登录/体验说明，不伪造资产数量。`ProfileHeader` 仅保留数据与交互，改为 `lf-reference-panel` 骨架，不再输出旧 `p-hero` 视觉结构。
2. 两列并列：
   - **我的资产**：主入口为 `我的简历`；次入口依次保留 `我的文档`、`AI服务记录`、`打印订单`、`我的收藏`、`我的权益`；
   - **常用服务**：主入口为 `AI简历服务`；次入口依次保留 `简历模板`、`文档打印`、`打印扫描`、`扫描文件`、`岗位信息`、`招聘会`、`AI助手`。
3. 全宽 **来源与活动** 面板：按现有 route/tag 各出现一次地保留 `浏览记录`、`外部跳转记录`、`招聘会扫码凭证（建设中）`、`权益活动（/activities?source=fair）`、`权益活动（/activities）`、`求职打印套餐（建设中）`、`AI服务套餐（建设中）`、`政策补贴指引`。两个“权益活动”以路由而非文字去重，不得合并或伪造支付能力。
4. 全宽 **账户与支持** 面板：按现有顺序保留 `消息通知`、`账号设置`、`身份切换`、`帮助中心`、`意见反馈`。

上述映射覆盖当前 `SECTIONS` 的 27 条入口，每条仅出现一次，保留原 `route`、`tag`、登录门槛和建设中状态；不在入口页重建任何资产明细或支付动作。

## 4. 实现边界

### 允许修改

- `apps/kiosk/src/components/lightflow/ReferenceServiceNav.tsx`、`reference-service-nav.css` 和 `reference-layout.css`：唯一的三页共享顶部分类导航与五个排版原语。
- 首页页面、服务目录 CSS 与首页静态守卫。
- AI 助手页面、其局部 LightFlow CSS、AI 助手静态守卫。
- Profile 主入口、`ProfileHeader`、`ProfileEntrySection`、`ProfileSessionRecords`、`profileEntries`、其入口 CSS 与 Profile 静态守卫。
- `verify-home-service-desk.mjs`、`verify-lightflow-k2a-ai-career.mjs`、`verify-lightflow-profile-entry.mjs`、`verify-profile-inkpaper-home.mjs` 与新建的 `verify-lightflow-4188-layout-parity.mjs`。这些守卫必须先按新结构 RED，再在保留原有真实性合同的前提下 GREEN；不得删除守卫或放宽原有业务断言来换取通过。
- Kiosk package script、CI 中对应 Kiosk 静态验证、进度与本批规格/计划文档。

### 明确不修改

- `services/api/**`、数据库、终端 Agent、共享 DTO、认证实现、TRTC 调用协议、支付和打印状态机。
- `/me/*` 明细页面与 `me-detail-inkpaper.css`。
- 首页 Hero、登录身份卡、底部三 Tab、既有入口路由、禁用能力、百宝箱和智慧校园的运行时配置逻辑。
- `legacy-miaoda/**`、Admin、Partner。

### 文件质量约束

- 新 CSS 文件每个不超过 300 行；现有 969 行的 `profile-inkpaper.css` 必须改为纯局部聚合入口，并拆为 `profile-lightflow-shell.css`、`profile-lightflow-directory.css` 与 `profile-lightflow-state.css`。Profile 守卫必须读取聚合入口和全部三份分片，逐份检查 `.kprofile.kprofile-lightflow` 作用域及禁止全局选择器；不得触碰 `me-detail-inkpaper.css`。
- 不引入第三方依赖、不新增路由、不复制服务入口数据。
- 共享 React 组件仅承载顶部分类导航；共享 CSS 承载五个排版原语，页面各自的真实业务内容仍保留在原功能域。

## 5. 验收标准

### 结构一致性

- 三页均直接渲染同一个 `ReferenceServiceNav`，并同时使用五个共享排版原语；新跨页守卫固定标签、顺序、desktop 六等分、390px 三列两行、主/次入口高度和并列/单列回退规则。
- 首页的 AI简历、岗位信息、招聘会顺序与用户截图一致；首页 Hero 与登录身份卡的 DOM 和样式合同不变。
- AI 助手不再出现独立侧栏骨架；“当前会话”是全宽白色主面板。
- `/profile` 不再以旧 `p-hero + sec-head` 作为页面排版骨架，但保留真实的 `ProfileHeader` 数据和全部 `SECTIONS` 条目。

### 真实性与合规

- 现有首页、AI 助手、Profile 静态守卫继续覆盖全部真实路由、会话、TRTC、登录、数据概览和 `/me/*` 隔离合同；助手守卫还必须保留路由白名单、`chatWithAssistant`、TRTC 懒加载/挂断与页内键盘。
- 所有岗位投递与招聘会预约仍指向来源平台；不得出现一键投递、平台内预约、候选人推荐或企业收简历能力。
- 不伪造 AI 结果、资产数量、文件、订单、支付状态或设备状态。

### 验证

- 先为共享布局与三页重排新增/收紧静态守卫，确认 RED 后实现 GREEN。
- 运行并在 CI 接线：`verify:home-service-desk`、`verify:lightflow-k2a-ai-career`、`verify:assistant-trtc-guard`、`verify:lightflow-profile-entry`、`verify:profile-inkpaper-home`、`verify:lightflow-k1-public-entry`、`verify:lightflow-k2b-ai-resume` 与新的 `verify:lightflow-4188-layout-parity`，然后运行 Kiosk typecheck、lint、production build 和 `git diff --check`。
- 在 1080×1920、390×844、390×700 依次核对首页、`/assistant`、`/profile`：六项导航、面板顺序、点击入口、无横向溢出、无重复可见页标题、无运行时错误。
- 实现后必须并行完成 Antigravity 前端审查与 Claude 审查；无有效输出不得标为批准。
