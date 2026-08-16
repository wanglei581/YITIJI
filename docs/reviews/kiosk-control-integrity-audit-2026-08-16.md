# Kiosk 控件完整性审计（2026-08-16）

> 审计对象：`origin/main` @ `67145a855a6eaaab2b5823182d530f817eee806b`
> （`67145a85 feat(orders): 小程序与一体机共用后台裁定 + M1 渠道字段落地 (#608)`）
>
> **所有结论均对 `origin/main` 验证**，不采信任何工作区检出。方法：`git archive origin/main apps/kiosk services/api packages/shared` 导出只读快照后分析，脚本与命令见 §8。
>
> 本文只审计、不修改任何生产代码。文中不含「已修复」结论。

审计触发诉求（用户原话）：

> 「每个按钮和功能都是正常的，而不是说这个按钮没有的功能，你要连接到一个错误的页面或者错误的一个功能上面去使用，这是不行的。」

---

## 0. 总表

### 0.1 枚举总数核实

任务书给出的规模数字与 `origin/main` 实测对照：

| 项目 | 任务书 | 实测（origin/main） | 说明 |
|------|--------|--------------------|------|
| 页面文件 | 171 | **168**（`pages/**/*.tsx`） | 含 `.ts` 则 192；全 `src` 下 `.tsx` 192、`.tsx+.ts` 302 |
| onClick | 707 | **705**（`onClick=` 属性） | 含注释/字符串中的裸 `onClick` 词则 738 |
| navigate() | 393 | **403**（`navigate(` 出现次数） | 其中字面量目标 294、动态目标 127 |
| 路由定义 | 105 | **105**（`path:` 条目） | 加 `{ index: true }` 首页则 106 个路由节点 |

差异来自计数口径（是否含 `.ts`、是否含注释命中），**不影响任何结论**。可复核命令见 §8。

### 0.2 六类问题统计

| # | 类别 | 数量 | P0 | P1 | P2 | 结论 |
|---|------|------|----|----|----|------|
| 1 | 死按钮 | **5** | 0 | 1 | 4 | 无一处空 handler / `console.log`-only；全部是「看着能点、实际无行为」 |
| 2 | 错误路由 | **10** | 0 | 2 | 8 | **静态目标不存在的路由：0 处**；10 处为「文案承诺 X、实际去 Y」 |
| 3 | 假成功 | **6** | 0 | 3 | 3 | 另有 1 处 P0 级伪造内容位于不可达页（计入 §4 孤儿） |
| 4 | 孤儿路由 | **10** | 0 | 1 | 9 | 另有 4 条为**故意保留**的旧入口重定向别名，不计为缺陷 |
| 5 | 能力断层 | **9** | 0 | 2 | 7 | 前端→后端缺失 **0**；后端 7 个空壳端点 + 2 项真实能力缺口 |
| 6 | 门禁绕过 | **4** | **1** | 1 | 2 | `/smart-campus/service/:key` 缺模块级校验，默认配置下即可深链泄漏 |
| | **合计** | **44** | **1** | **10** | **33** | |

### 0.3 一句话结论

**这套代码的纪律性远高于预期**：705 个 `onClick` 里没有一个是空函数或只打日志，394 个静态跳转目标没有一个指向不存在的路由，合规文案零违规（详见 §3.4）。用户担心的「按钮乱接」不是系统性问题。

真正需要处理的是 **1 个 P0**（智慧校园模块门禁失效，深链可绕过）和 **10 个 P1**，其余 33 项是体验/清理问题。

---

## 1. 死按钮（5 项）

先说重要的阴性结果——以下三类**全站为 0**，已用脚本穷举（§8）：

- 空 handler `onClick={() => {}}` / `onClick={() => undefined}` / `onClick={noop}`：**0 处**
- 只有 `console.log` / `console.warn` 的 handler：**0 处**
- 页面里的 `TODO` / `FIXME` / 假数据占位：**0 处真实待办**（15 处命中全是「**说明本页刻意不放占位**」的注释，例如 `pages/renshi/RegisterPanel.tsx:6`「无线上预约入口时不渲染占位按钮」）

以下 5 项是「视觉上是控件、实际无行为」：

### 1.1 [P1] 首页 AI 接待台的「输入框」根本不是输入框

- **文件**：`apps/kiosk/src/pages/home/HomePage.tsx:145`
- **控件文案**：`例如：我周五参加招聘会，需要准备简历并打印`（灰色占位文字）
- **现象**：
  ```tsx
  <div className="ar-input-row">
    <div className="ar-input-placeholder">例如：我周五参加招聘会，需要准备简历并打印</div>
    <button type="button" className="ar-mic" onClick={() => navigate('/assistant')}>
  ```
  `styles/prototype-v1.css:1138-1155` 把 `.ar-input-row` 渲染成 76px 高、带边框圆角、纸色填充、右侧焊死一个麦克风按钮的容器——**和文本输入框视觉完全一致**。但承载占位文字的是一个纯 `div`，无 `onClick`、无 `role`、无任何 handler。
- **影响**：这是 27 寸触摸屏的**首屏第一交互区**。用户按直觉去点「输入框」正中，无任何反应；只有右侧麦克风图标和下方「让小青安排」按钮能跳转。
- **建议**：把占位行本身改成 `<button>` 跳 `/assistant`（左右两个兄弟控件已经都这么做了）。
- **严重度**：**P1** —— 功能不可用 + 出现在曝光最高的首屏。

### 1.2 [P2] 线下招聘机构页的「全部区域」筛选片是死的

- **文件**：`apps/kiosk/src/pages/offline-agencies/OfflineAgenciesPage.tsx:123-124`
- **控件文案**：`区域` / `全部区域`
- **现象**：`<span className="jf-f-chip on">全部区域</span>` —— `jf-f-chip on` 正是别处**选中态可点**筛选片的类名（`JobsPage.tsx:373`、`JobFairsPage.tsx:262`）。这里却是无 handler 的 `span`，且没有任何兄弟选项；`getOfflineAgencies` 只接受 `keyword`/`page`/`pageSize`（`:75-79`），后端根本没有 region 参数。
- **影响**：用户看到一个「已激活、且无法取消」的区域筛选。
- **建议**：在真实区域筛选上线前移除该标签与筛选片。
- **严重度**：P2。

### 1.3 [P2] 参展企业详情的「数据来源」行带外链图标却不可点

- **文件**：`apps/kiosk/src/pages/job-fairs/components/FairCompanyDetailSections.tsx:183-189`
- **控件文案**：`数据来自合作平台 · 仅供展示参考` + 右侧 `ExternalLinkIcon`
- **现象**：纯 `div`，无 handler；仅在 `company.sourceUrl` 存在时渲染，行尾却挂了一个外链图标。
- **影响**：触摸屏上尾部外链图标强烈暗示可跳转。
- **建议**：去掉图标，或把整行升级为调用 `openApplyQr` 的按钮。
- **严重度**：P2（严格说不算交互控件，置信度较低）。

### 1.4 [P2] 「我的」多张非交互卡片带点按水波纹反馈

- **文件**：`apps/kiosk/src/pages/profile/me/MyBenefitsPage.tsx:126`、`MyAiRecordsPage.tsx:255`、`me/JobAiSessionRecords.tsx:55`
- **现象**：`<Card className="… me-ripple">` 但无 `onClick`。`hooks/useInkRipple.ts:11` 按选择器匹配任意 `pointerdown`，卡片会**明显泛起水波纹**（"点击已生效"的反馈）然后什么都不做。
- **影响**：触控硬件上这读作「按钮坏了」。
- **建议**：从非交互卡片移除 `me-ripple`。
- **严重度**：P2。

### 1.5 [P2] `/ai/plan` 步骤卡带右箭头但不可点

- **文件**：`apps/kiosk/src/pages/ai-plan/AiPlanPage.tsx:208-246`（箭头 `:239-244`）
- **现象**：卡片是纯 `div`，无 `onClick`。`PlanStep.route`（`:9`）已声明并被填充（`/resume/source`、`/jobs`、`/print/upload`），但从未被导航使用，只驱动一个右箭头图标的显示。
- **影响**：目前**该页不可达**（见 §4.2），所以线上无影响。
- **严重度**：P2。

---

## 2. 错误路由（10 项）

### 2.1 关键阴性结果：静态跳转目标 **零** 失效

对 294 个 `navigate('...')` / `<Link to>` / `<Navigate to>` **字面量**目标逐一比对 105 条路由（支持 `:param` 匹配，并按 react-router 规则让静态段优先于动态段）：

> **不存在的目标：0 处。**

补充两点：

1. 兜底路由 `{ path: '*', element: <KioskRouteErrorPage /> }`（`routes/index.tsx:299`）存在，且 `pages/errors/KioskRouteErrorPage.tsx` 是一个正经错误页（「页面不存在 / 当前入口可能已经调整」+「重试页面」+「返回首页」）。**即便真出现坏路由，用户看到的也不是白屏**。
2. `window.open` 全站只有 1 处（`pages/jobs/JobDetailPage.tsx:119`），且受 `lib/url.ts:6 isValidSourceUrl()` 保护（只放行 http/https）。无空 URL 外链。

### 2.2 「文案承诺 X、实际去 Y」（10 项）

这才是用户诉求真正对应的问题——路由存在，但**接到了错误的功能上**。

| # | 文件:行 | 控件文案 | 现在去哪 | 用户会看到 | 建议 | severity |
|---|---------|----------|----------|-----------|------|----------|
| a | `pages/policy/PolicyServiceHubPage.tsx:111-114` | 政策收藏 | `/me/ai-records` + `state:{type:'policy'}` | AI服务记录列表，**看不到任何收藏的政策**。`MyAiRecordsPage` 从不读 `location.state`，state 被静默丢弃；真正的收藏在 `/me/favorites`（该页有政策 tab，`MyFavoritesPage.tsx:29`），政策收藏也确实写在那里（`renshi/PolicyPanel.tsx:98`） | 改 `to: '/me/favorites'`；若要预选政策 tab，`MyFavoritesPage` 需支持 `?tab=`（当前 tab 只存 local state，`:44`） | **P1** |
| b | `pages/interview/InterviewServiceHubPage.tsx:90-99` | 评估历史（"查看历次自我评估报告"） | `/resume/self-assessment/history` | **永远是空列表**。`SelfAssessmentFlow.tsx:465-469` 的 effect 直接 `setHistory([])`，不发任何请求；`services/api/selfAssessment.ts` **根本没有列表端点**（只有 submit / get-by-taskId / print / withdraw / append）。真实记录在 `/me/ai-records` | 指向 `/me/ai-records`；`/resume/self-assessment/history` 删除或降级为重定向。同样问题的次要入口：`SelfAssessmentFlow.tsx:382`「查看历史」 | **P1** |
| c | `pages/print/PrintConfirmPage.tsx:332` + `:199-201` | 返回修改 | `navigate(-1)` | 从收银台回流时退回 **`/print/cashier`（订单支付页）**，而非预览/参数。因为 `PrintCashierPage.tsx:421-422` 的「返回确认」是 **push** 而非 replace。用户无法从这里回到参数编辑；再次点主按钮会重跑 `createPrintJob`（`services/print/printJobsApi.ts:120-140`，无幂等键）产生**重复订单** | 收银台返回改为 replace 或直接导航到参数步；`POST /print/jobs` 增加幂等键 | P2（**不会重复出纸**：agent 领取只取 `payStatus==='paid'`，见 `terminals-agent.service.ts:405,412,436-437`，未支付重复单不会打印） |
| d | `pages/interview/InterviewReportsPage.tsx:82-84` | AI服务记录 | `/profile` | 「我的」总入口页，不是记录页。全站其他 4 处同名按钮都指向 `/me/ai-records` | 改 `/me/ai-records` | P2 |
| e | `pages/policy/PolicyServiceHubPage.tsx:88-90` | 补贴指引 | `/renshi?tab=subsidy` | **subsidy 这个 tab 不存在**。`pages/renshi/shared.ts:14-20` 只定义 `policy \| social \| register \| notice`，未识别值回落 `policy`。于是「补贴指引」和「就业政策」进入完全相同的页面 | 指向 `/renshi?tab=policy` 并预选人群，或新增真实补贴 tab | P2 |
| f | `pages/home/components/ToolboxLaunchModals.tsx:152-154` | 返回首页 | 只 `onClose()` | **停在 `/toolbox` 或 `/smart-campus`**，没回首页。`closeWithCancel`（`:113-116`）只记录 `cancel_external` 事件后关弹窗 | 改文案为「取消」，或让 handler 真的导航到 `/` | P2 |
| g | `pages/profile/me/MyFavoritesPage.tsx:35` | （政策收藏条目） | `/renshi`（无 tab、无 id） | 行里显示的是**具体政策标题**，点进去却是政策总列表，要重新翻找。`me/activityPresentation.ts:36` 有同样回落 | 至少带 `?tab=policy`；理想是补政策详情深链 | P2 |
| h | `pages/job-fairs/FairCompanyDetailPage.tsx:163-170` | 去来源平台投递 | 与「扫码投递」**同一个 handler** `openApplyQr` | 两个按钮行为完全一样。对比 `pages/jobs/JobDetailPage.tsx:112-120` 的正确写法：一体机走二维码、非一体机 `window.open`。在手机/桌面浏览器上，用户点「去来源平台投递」得到一个自己没法扫的二维码 | 复用 `JobDetailPage.openSourcePlatform` 的 `isTerminalKiosk` 分支 | P2（**非合规问题**，文案在白名单内，两条路径都导向站外） |
| i | `services/api/src/ai/llm/llm-chat.service.ts:40` | 简历诊断（AI助手建议 chip） | `/resume/report` | `/resume/report` 是**报告查看页**，不是诊断入口。冷进入时无 taskId，落到「还没有诊断报告 / 请先上传或选择简历」空态（`ResumeReportPage.tsx:166-185`），需再点一次「开始简历诊断」才真正开始 | 改为 `/resume/source`（同一数组第二项已经是它） | P2（空态诚实且可恢复） |
| j | `pages/ai-plan/AiPlanPage.tsx:69-92`（`:71`） | 按这个方案继续 | `/assistant` | 方案第一步明明是「完善并打印简历 → `/resume/source`」，「继续」却把用户送回聊天页 | 该页不可达（§4.2），随页处理 | P2 |

### 2.3 已核查为**安全**的两处（不是缺陷）

- **AI 助手不会跳到不存在的路由。** `AssistantPage.tsx:426` 用 `isAllowedRoute()` 过滤后端返回的 `actions`。虽然该函数只校验**前缀**（`/print/`、`/resume/` 等），理论上放得过 `/print/不存在`，但后端的 `actions` 全部来自 `llm-chat.service.ts:39-51` 的 **静态映射表** `INTENT_ROUTES` / `SKILL_ACTIONS`，**LLM 输出无法注入 route 字段**。逐条核对这些静态 route，除 §2.2(i) 外全部有效。
- **`/print/pickup-claim` 与 `POST /print/jobs/claim-pickup` 均存在且正确。** 路由 `routes/index.tsx:214`，入口 `pages/print-scan/PrintScanHomePage.tsx:258`，端点 `services/api/src/print-jobs/print-jobs.controller.ts:32`。页面还正确区分了 `released`（任务已释放）与未支付（「付款成功后系统才会创建打印任务，不会提前出纸」）。**不是缺失项。**

---

## 3. 假成功（6 项）

### 3.1 [P1] 扫描结果页「登录后管理文件」——虚假留存承诺 + 丢文件

- **文件**：`apps/kiosk/src/pages/scan/ScanResultPage.tsx:155-157`，handler `:76-83`
- **控件文案**：`登录后管理文件` / 副文案 `临时扫描文件有有效期；登录后可在「我的文档」管理`
- **现象**：两处断裂叠加。
  1. 扫描会话用 `getToken()` 创建（`ScanSettingsPage.tsx:103`），未登录时产出的 `FileObject` 写入 `endUserId: null`（`services/api/src/scan-tasks/scan-tasks.service.ts:531`）。`/me/documents` 只查已认证用户资产（`member-assets.service.ts:96` → `files/retention-policy.ts:108-114`），而 **`services/api/src` 全库没有匿名→会员的文件认领机制**（`upload-sessions.service.ts:377` 只绑定手机上传会话）。即：登录之后这个 PDF 也永远不会出现在「我的文档」。
  2. `LoginPage` 用 `navigate(returnTo)` 裸路径返回（`:110,113`），回到 `/scan/result` 时 **router state 已丢失** → `success !== true` → 页面渲染「扫描未完成 / 本次没有生成可用的扫描文件」。
- **影响**：用户点一个承诺"登录后可管理文件"的按钮 → 登录 → 被扔到「扫描失败」错误屏，扫描件丢失且永远不会进「我的文档」。
- **建议**：照抄本仓库已在 `ConvertImagesPage.tsx:172-181` 用过的诚实写法——未登录分支改为「未登录扫描的文件不会进入「我的文档」，请在本次操作内直接打印」，并保持用户停留在结果页；或实现登录后回绑 `fileObject.endUserId` 并恢复 `/scan/result` state。
- **严重度**：**P1**（逼近 P0：§9「不伪造能力」红线 + 用户文件丢失）。

### 3.2 [P1] 格式转换页无条件宣称「PDF 已保存到「我的文档」」

- **文件**：`apps/kiosk/src/pages/print-scan/ConvertImagesPage.tsx:276`
- **控件文案**：`生成后自动进入确认打印；PDF 已保存到「我的文档」。`
- **现象**：**同一屏自相矛盾**。该页 `:179-181` 的提示条已经正确按登录态分流：未登录时显示「未登录状态下转换的 PDF 不会进入「我的文档」…」，`:172-178` 的注释还写明了原因（匿名转换落库 `endUserId` 为空）。但「转换规则」卡片里的这条 bullet 没跟着改，仍无条件断言已保存。
- **影响**：读规则卡的匿名用户以为文件之后能找回。
- **建议**：`:276` 按 `getToken()` 分流，与 `:179-181` 一致。
- **严重度**：**P1**（§9 直接违规，仅因正确提示条同屏而减轻）。

### 3.3 [P1] 手机上传页硬编码终端名

- **文件**：`apps/kiosk/src/pages/upload/PhoneUploadPage.tsx:130-133`（`:132`）
- **控件文案**：`上传目标：就业服务大厅 · 01号机`
- **现象**：字面量。该页全部输入只有 URL fragment 里的 `sessionId`/`token`/`purpose`（`:40-43`），`buildPhoneUploadUrl`（`services/api/uploadSessions.ts:122-131`）也不放别的。**每一台机器、每一个场馆都渲染「就业服务大厅 · 01号机」**。
- **影响**：用户手机上看到一句关于"文件将进入哪台机器"的确定陈述。多机部署或场馆不叫「就业服务大厅」时全是错的，用户可能走到错误的机器前取件。
- **建议**：由 upload-session 创建响应返回终端展示名后渲染；在有真实数据前删掉该行。
- **严重度**：**P1**（面向用户屏幕伪造现实世界状态，§9）。

### 3.4 [P2] 打印完成页在页数未知时宣称「共 0 面已全部打印」

- **文件**：`apps/kiosk/src/pages/print/PrintDonePage.tsx:146-148`、`:263-267`、`:309`
- **控件文案**：`共 0 面已全部打印，请在出纸口取走并核对页数`
- **现象**：类型断裂。本页局部 `interface PrintFile` 声明 `pages: number`（`:11-16`），但真实对象是 `printMaterialSession.ts:9` 的 `PrintFileState`，其 `pages: number | null`。于是 `null * copies * 1 === 0`，而 `totalFaces != null` 为真 → 打印出字面量 0。
  **必现路径（已验证）**：扫描 → 结果页「直接打印」。`ScanProgressPage.tsx:46-56 buildResultFileState` 恒定写 `pages: null`，`ScanResultPage.tsx:70` 原样透传。
- **影响**：成功屏显示「共 0 面已全部打印」，摘要行渲染成「 页 × 1 份」（React 把 `null` 渲染为空）。流程里其他页都处理正确（`PrintConfirmPage.tsx:186`「待识别，以实际打印为准」；`PrintProgressPage.tsx:59`「待识别」）。
- **建议**：`const totalFaces = file?.pages != null && params ? … : null`。
- **严重度**：P2（对实体产出的错误陈述，但纸已在用户手上）。

### 3.5 [P2，位于不可达页] `/ai/plan` 整页伪造 AI 方案

- **文件**：`apps/kiosk/src/pages/ai-plan/AiPlanPage.tsx:19-28`，横幅 `:126`、`:129`
- **控件文案**：`小青已理解你的需求` / `以下方案基于你的情况生成，可点击「调整方案」重新说明`
- **现象**：该文件 **不 import 任何 `services/api`**，全站无网络调用。`plan` 在 `location.state` 缺失时回落 `DEFAULT_PLAN`（`:34-39`），而**全站无任何调用方带 state 导航到此页**（§4.2），因此 100% 的渲染都是这段写死内容：
  ```ts
  const DEFAULT_PLAN: Required<PlanState> = {
    goal: '找到匹配的全职岗位，完善求职材料',
    hasMaterials: ['在读/毕业证明', '个人经历草稿'],
    gaps: ['简历PDF格式文件', '证件照（电子版）'],
  ```
  用户的"目标"和"尚需准备的材料"被凭空编造，还冠以「小青已理解你的需求」。
- **影响**：**当前为 0**（页面不可达）。**若被接上入口即为 P0 级 §9 违规。**
- **建议**：删除页面+路由；或必须先有真实 assistant plan 载荷，缺失时渲染诚实空态。
- **严重度**：P2（现状）/ **P0（若接入）** —— 已在 §4.2 标为 P1 孤儿，优先处理。

### 3.6 [P2，死分支] ProfilePage 保留了已被删除的「假保存」提示

- **文件**：`apps/kiosk/src/pages/profile/ProfilePage.tsx:31`（`IncomingState`）、提示语 `:80`
- **现象**：`ResumeOptimizePage.tsx:169-172` 的注释记载了这次修复：原实现 `navigate('/profile', {state:{savedResumeAdvice}})` 却提示「优化建议已加入本次记录」，用户以为存下了、实际没有，属 §9 违规，**生产方已移除**。但**消费方还在**——`ProfilePage` 仍读该 state 并驱动 toast（`:77-82`）、待办横幅（`:143`）、记录列表（`:155-165`）。
- 死分支里还埋着两个隐患：
  - `components/ProfileSessionRecords.tsx:26-29`：按钮叫「查看记录」，`continuePendingTask` 却导航到 `/resume/source`（上传页）或直接进 `/print/preview`，**从不去它命名的记录**（记录就在同一页上）。
  - `ProfilePage.tsx:107-111`：`printFile` 推 `/print/preview` 时**不带 `fileUrl`**，能穿过预览守卫，最后在 `PrintConfirmPage.tsx:217` 才以「打印文件尚未就绪，无法提交打印」失败（诚实失败，但晚了三屏）。
- **影响**：当前不可达，故为 0。删掉整个死分支可一并消除上述两处。
- **严重度**：P2。

### 3.7 已核查为**正确**的假成功候选（重要阴性结果）

以下都做了「真实请求成功后才显示成功」，或明确按登录态/模式分流，**不是缺陷**：

- 收藏：`favorites/FavoritesProvider.tsx:101-131` 调真实 `POST/DELETE /me/favorites`，乐观更新 + 失败回滚 + 「收藏同步失败，请稍后重试」，登录后与 `getAllMyFavorites` 对账。**教科书式 optimistic-then-reconcile。**
- 权益领取：`activities/BenefitActivityDetailPage.tsx:104-106` 先 `await claimBenefitActivity(...)` 成功再显示「领取成功」，随后重拉；`:212-218` 还诚实写明「抵扣功能尚未开放」。
- 简历「已生成/已导出」：`ResumeOptimizePage.tsx:355-371`、`ResumeGeneratePreviewPage.tsx:346-365`、`JobMaterialLibraryPage.tsx:293-300` 全部以 API 响应落定为前提，mock 模式有独立诚实分支。真实端点 `POST /api/v1/resume/generate/export`（`ai.controller.ts:347`）。
- 职业规划：`CareerPlanPage.tsx:170-182` 按真实登录态区分是否「已存入 AI服务记录」，不做无条件断言。
- 收银台：`PrintCashierPage` / `CashierPaymentPanel` 只在服务端 `payStatus === 'paid'` 或服务端确认的码支付结果后才显示成功；`reconcile` 从不伪造 paid；沙箱标注「非真实收款」且仅 DEV。
- 打印进度：SIM/demo 分支通篇标注「演示模式·非真实打印 / 未建单、未支付、未出纸」，`:381`、`:405` 有直达访问守卫。
- 招聘会「已签到」（`FairMapPage.tsx:169`、`FairCompaniesPage.tsx:11`、`FairStatsPage.tsx:104,208`）全是**参展企业**的后端状态，不是用户本人签到；`JobFairCheckinPage` 明写「本系统不记录签到结果」。
- 扫描结果页 `:165` 甚至主动声明「本页不会伪造"已保存"」。

**合规文案（§2 白名单）零违规**——全库精确扫描：`一键投递` / `立即投递` / `企业收简历` / `候选人管理` **0 命中**；`平台投递` 的 22 处命中经负向后顾断言（`(?<!来源)平台投递`）确认**全部**是白名单短语「去来源平台投递 / 扫码前往来源平台投递」的子串，真实违规 **0**。也没有任何控件会把简历提交给企业。

---

## 4. 孤儿路由（10 项 + 4 项故意保留）

> **方法学更正（重要）**：初版脚本把 `/jobs/online-platforms` 误判为孤儿，因为它先匹配上了 `/jobs/:id`。react-router 实际让**静态段优先于动态段**。修正排序后重跑（`enum3.js`，§8），`/jobs/online-platforms` 确认可达（`pages/jobs/JobsServiceHubPage.tsx:129`，路径：首页 → 岗位信息 → 线上招聘平台）。此类误报已全部消除。

### 4.1 故意保留、**不是缺陷**的旧入口别名（4 条）

`routes/index.tsx:202-204,218` 的 `<Navigate>` 重定向，代码注释（`:215-216`）已说明是旧入口兼容：

- `/print/scan-convert` → `/print-scan/convert`
- `/print/scan-sign` → `/print-scan/sign`
- `/print/scan-feature` → `/print-scan/feature/id-photo`
- `/resume/upload` → `/resume/source`

### 4.2 真实孤儿（10 条）

| 路由 | 实现文件 | 站内入口 | 说明 | severity |
|------|---------|---------|------|----------|
| `/ai/plan` | `pages/ai-plan/AiPlanPage.tsx`（251行） | **无** | 内容整页伪造（§3.5）。概念（助手产出方案→终端确认）是有价值的待实现能力，但**现实现不可复活** | **P1** |
| `/print/params` | `pages/print/PrintParamsPage.tsx`（462行） | **无**（仅 `KioskRoot.tsx:35` 的 actionbar 列表 + 测试夹具） | 参数 UI 已迁入 `PrintPreviewPage`（份数/颜色/双面均在 `:415-450`）。**功能没丢**，但 462 行重复页仍在编译。且 `PrintPrototypeLayout.tsx:7` 的 `PRINT_STEPS = ['上传','材料检查','预览','参数','确认','支付','打印']` 仍向用户承诺一个**永不出现**的「参数」步——预览是 step3，点「确认参数」直接跳 step5，进度条 3→5 跳号 | P2 |
| `/resume/export` | `pages/resume/ResumeExportPage.tsx`（96行） | **无** | **无能力损失**：本身就是永久诚实空态页（「暂无真实输出物」），两个按钮硬编码 `disabled`（`:51,:54`）。真实导出在别处 | P2 |
| `/session-resume` | `pages/session-resume/SessionResumePage.tsx`（225行） | **无**（仅自身登录回跳） | **真实可用但被取代**：调 `getPendingTasks(token)` 并路由到 `/print/cashier`/`/print/progress`。已被首页 `ContinuePanel` 取代 | P2 |
| `/campus/welcome` | `pages/placeholders/CampusWelcomePage.tsx` | **无** | 已被 `/smart-campus/welcome` 取代，页面自己写明「智慧校园迎新服务位于独立专区」（`:14`） | P2 |
| `/campus/freshman-insights` | `pages/placeholders/FreshmanInsightsPage.tsx` | **无** | 同上 | P2 |
| `/smart-campus/freshman-insights` | `pages/smart-campus/FreshmanInsightsPage.tsx` | **无** | `SmartCampusHomePage.tsx:57` 明写「校园大数据本期严格冻结：不在此列出入口」 | P2（门禁问题另见 §6.2） |
| `/notifications` | `pages/placeholders/NotificationsPage.tsx` | **无**（仅自身 `loginFrom`） | 只是 `<MyNotificationsPage loginFrom="/notifications" />` 的壳，真实路由是 `/me/notifications` | P2 |
| `/me/activity/:id` | `pages/placeholders/MeActivityDetailPage.tsx` | **无** | 已核 `me/activityPresentation.ts:19-38 detailRoute()` 的全部返回值（`/jobs/:id`、`/job-fairs/:id`、`/companies/:id`、`/job-fairs/:id/companies/:companyId`、`/offline-agencies`、`/renshi`）——**都有效，但没有一个是 `/me/activity/:id`**。列表点击直达目标内容，跳过详情页 | P2 |
| `/error-offline` | `pages/placeholders/ErrorOfflinePage.tsx` | **无**（仅自身） | 离线态实际由 `components/ServiceReadinessStrip.tsx` 内联呈现；`hooks/useApiReadiness.ts` 只置 `status='unavailable'`，从不路由到此页 | P2 |

### 4.3 曾被怀疑、经核实**不是**孤儿

- **`/member/qr-login`**：由后端下发路径。`services/api/src/member-auth/member-qr-login.service.ts:79` 返回 `` `/member/qr-login?ticketId=…` ``，前端 `buildQrLoginUrl()` 据此生成二维码（`ScanQrLoginPanel.tsx:74`）。路径与路由表**精确一致**。
- **`/upload/phone`**：同理，`services/api/src/upload-sessions/upload-sessions.controller.ts:111` 的 `new URL('/upload/phone', origin)`。
  这两条是**手机侧扫码入口**，不是站内导航目标，设计正确。

---

## 5. 能力断层（9 项）

### 5.1 前端 → 后端：**0 处缺失**（关键阴性结果）

提取 kiosk 全部 API 路径字面量（`call<>()`/`request<>()`/`get()`/`post()`/`` fetch(`${API_BASE_URL}…`) ``/`'/api/v1/…'`），与 `services/api/src` 中 `@Controller` + 方法装饰器组合出的 **440 个端点 / 392 个唯一模式** 逐条比对：

> **99 个唯一前端路径，全部命中真实后端端点。**

首轮 5 条"未匹配"经逐个手工验证均为**嵌套模板字符串的正则解析残留**，端点全部真实存在：`GET /activities`（`benefit-activities.controller.ts:12`）、`GET /companies` `GET /companies/stats` `GET /companies/filters` `GET /companies/:id` `GET /companies/:id/jobs`（`companies.controller.ts:44-90`）、`GET /me/feedback`（`member-feedback.controller.ts:10`）、`GET /me/notifications`（`member-notifications.controller.ts:9`）。

**即：不存在「前端按钮调用了不存在的接口」。**

### 5.2 [P2 ×7] 后端 7 个空壳 kiosk 端点——**有路由无能力，接上就是假成功**

反向核查发现 5 个 controller 已在 `app.module.ts:133-138` **注册生效、无任何 Guard**，但全部返回硬编码值、不碰数据库，且 **kiosk 前端无一处调用**：

| 端点 | 文件 | 返回 |
|------|------|------|
| `GET /api/v1/kiosk/help` | `help/help.controller.ts:5` | `{ data: [] }` |
| `GET /api/v1/kiosk/activities` | `activities/activities.controller.ts:5` | `{ data: [] }` |
| `GET /api/v1/kiosk/activities/:id` | `activities/activities.controller.ts:10` | `{ id }` |
| `GET /api/v1/kiosk/notifications` | `notifications/notifications.controller.ts:5` | `{ data: [], unreadCount: 0 }` |
| `PATCH /api/v1/kiosk/notifications/:id/read` | `notifications/notifications.controller.ts:10` | `{ ok: true }` ← **假成功陷阱** |
| `POST /api/v1/kiosk/session/heartbeat` | `kiosk-session/kiosk-session.controller.ts:5` | `{ ok: true }` ← **假成功陷阱** |
| `POST /api/v1/kiosk/session/extend` | `kiosk-session/kiosk-session.controller.ts:10` | `{ ok: true }` ← **假成功陷阱** |
| `GET /api/v1/kiosk/screensaver-content` | `screensaver/screensaver.controller.ts:5` | `{ data: [] }` |

这些都**影子覆盖**了真正在用的能力：kiosk 实际用 `/me/notifications`、`/activities`、`/terminals/:id/screensaver`；帮助中心是纯静态 FAQ（`HelpCenterPage.tsx` 228 行，无 fetch）；会话超时由 `auth/KioskPrivacyGuard.tsx` + `auth/useIdleLogout.ts` 在前端处理，不打后端心跳。

- **风险**：后续开发者若照名字接上 `/kiosk/notifications` 会得到静默空列表；接上 `/kiosk/session/extend` 会得到**永远成功**的续期假象；`PATCH …/read` 返回 `{ok:true}` 却什么都没标记已读。这正是用户担心的「接到一个错误的功能上」的后端版本。
- **建议**：删除这 5 个空壳 module，或在其上加 `501 Not Implemented`。**不要在澄清前接线。**
- **严重度**：P2 ×7（当前 kiosk 无调用，故不影响线上；但是明确的埋雷 + 未鉴权的活端点）。

### 5.3 [P1] 缺少自我评估历史列表端点

`services/api/kiosk` 侧 `selfAssessment.ts` 只有 submit / get-by-taskId / print / withdraw / append，**没有列表端点**，直接导致 §2.2(b) 的「评估历史」永远为空。属"后端能力缺口"而非前端错误。

### 5.4 [P1] 缺少匿名 → 会员的文件认领机制

`services/api/src` 全库无此能力（`upload-sessions.service.ts:377` 只绑定手机上传会话），直接导致 §3.1 的扫描件永久丢失。

> 按任务书口径，5.3 / 5.4 属 **待实现产品能力**；但因为**前端已经用文案向用户承诺了这两件事**，所以在补齐前必须改文案，不能维持现状。

---

## 6. 门禁绕过（4 项）

### 6.1 [**P0**] `/smart-campus/service/:key` 缺模块级校验——默认配置下深链即泄漏

这是本次审计**唯一的 P0**，也是唯一符合「首页隐藏了入口但深链仍能进」原始描述的问题。

- **路由**：`apps/kiosk/src/routes/index.tsx:196`
  ```tsx
  { path: 'smart-campus/service/:key', element: <SmartCampusGuard><SmartCampusServicePage /></SmartCampusGuard> },
  ```
  **未传 `module` prop。**
- **守卫**：`pages/smart-campus/SmartCampusGuard.tsx:39`
  ```tsx
  const blocked = !config.enabled || (module ? !config.modules[module] : false)
  ```
  没有 `module` 时，**只校验总开关**。
- **首页**：`pages/smart-campus/SmartCampusHomePage.tsx:145`
  ```tsx
  const moduleEntries = ENTRIES.filter((e) => config.modules[e.key])
  ```
  首页**按模块开关逐个过滤**卡片（`:58` luggage、`:59` panorama）。

**展示条件严格强于放行条件**，这正是深链泄漏的定义。

- **不是边缘情况**：`packages/shared/src/types/smartCampus.ts:30-36` 的 `DEFAULT_SMART_CAMPUS_MODULES` **四个模块默认全 false**。因此只要终端把「智慧校园」总开关打开（模块保持默认），首页不显示「行李帮运」「VR校园」，但直接访问 `/smart-campus/service/luggage` 会**完整渲染**该页。
- **泄漏的是实质内容**（已验证 `SmartCampusServicePage.tsx:84-105`）：标题、服务内容（新生行李短驳 / 宿舍楼栋路线指引 / 服务点排队说明 / 异常件现场协助）、**所需材料（「录取通知书 / 学生证」「本人联系电话」「行李件数与目标宿舍楼栋」）**、办理地点。`panorama` 同理。
- **建议**：给模块型 key 传 `module`——在 `SmartCampusServicePage` 内按 `:key` 推导（`luggage`/`panorama` 走模块校验；`campus-card`/`all-in-one`/`campus-network` 属 `SERVICE_ENTRIES`，随总开关即可，见 `SmartCampusHomePage.tsx:64-86`），或拆分路由。
- **严重度**：**P0**。

### 6.2 [P1] `/smart-campus/freshman-insights` 同样缺 `module="bigdata"`

`routes/index.tsx:195` 也没传 `module`。今天**没有内容泄漏**，因为 `pages/smart-campus/FreshmanInsightsPage.tsx:11-16` 本身就是诚实空态。但 `SmartCampusHomePage.tsx:57` 的注释承诺「后端开关亦强制 false，直达 URL 仅见"未开放"」——这个承诺目前**是靠页面碰巧为空实现的，不是靠门禁**。一旦该页接入真实数据即变成第二个 §6.1。

### 6.3 [P2] `useToolboxConfig` 默认 `enabled: true`，与自身注释相悖、fail-open

- **文件**：`apps/kiosk/src/hooks/useToolboxConfig.ts:7-12`
- 注释写：「生产入口必须由 Admin 明确配置，不能因配置为空或请求失败而自动公开尚未单独授权的服务」；代码却是 `DEFAULT_TOOLBOX_CONFIG = { enabled: true, items: [] }`，且 `catch`（`:28-29`）回落同一默认值。
- 无 `terminalId`（`services/api/terminalConfig.ts:24-26` 抛错）或拉取失败时，百宝箱瓦片**仍出现在首页**，点进去是空的「待配置」页。
- **未泄漏未授权服务**（items 为空），但与刻意 fail-closed 的姊妹 hook `useSmartCampusConfig`（初始 OFF、不持久化、失败回 OFF）行为相反。
- **建议**：默认改 `enabled: false`。

### 6.4 [P2] `/campus/*` 占位页不受智慧校园门禁约束

`/campus/welcome`、`/campus/freshman-insights`（`routes/index.tsx:182-189`）注册在 `KioskRoot` 下、**不经 `SmartCampusGuard`**。当前**不构成泄漏**：两页只渲染诚实空态（「当前没有独立迎新招聘内容」/「暂无经核验的校园招聘统计」），零智慧校园内容，且属未设门禁的招聘会域。但它们是孤儿（§4.2），下一个人很可能把它们重新指向真实内容，从而继承这个缺失的门禁。

### 6.5 已核查为**正确**的门禁（阴性结果）

- **`SmartCampusGuard` 本身 fail-closed，正确。** `hooks/useSmartCampusConfig.ts`：初始 `OFF`、不写 `localStorage`、无 `terminalId` → `OFF`、API 失败 → `cached ?? OFF`。loading/unknown/failure 全部阻断。
- **`/smart-campus` 首页路由虽未包 Guard，但不是绕过。** `SmartCampusHomePage.tsx:147` (`config.enabled ? [...] : []`) 与 `:185`（`!config.enabled || cards.length === 0` → 「本机暂未开启智慧校园服务」+返回首页）做了等价自检，与首页展示条件 `HomePage.tsx:520` 精确一致。仅有的残留是关闭态下仍渲染标题/副标题与 `FusionNotice`（`:247`），P2 级观感问题。
- **`/toolbox` 内容无绕过。** `ToolboxZonePage.tsx:85` 的 `items = config.enabled ? … : []`，关闭时显示「待配置」。（默认值问题见 §6.3。）
- **`/contract-review` 三个路由 fail-closed 正确。** `routes/index.tsx:84` `VITE_ENABLE_CONTRACT_REVIEW === 'true'` 严格比较，缺失/空/畸形值一律回落 `<Navigate to="/" replace />`。

---

## 7. 无法静态判定（需运行时验证）

以下**不计入**缺陷统计，属静态分析能力边界，需真机/浏览器验证：

### 7.1 动态路由目标（127 处）

`navigate()` 的模板串与变量目标无法静态断言其运行时值。已做的是**前缀比对**——全部 127 处的静态前缀均落在有效路由模式内，例如：

- `` `/job-fairs/${fairId}/companies/${c.id}` `` → `job-fairs/:id/companies/:companyId` ✓
- `` `/jobs/${job.id}` `` → `jobs/:id` ✓ ｜ `` `/companies/${c.id}` `` → `companies/:id` ✓
- `` `/activities/${item.id}` `` → `activities/:id` ✓ ｜ `` `/me/feedback?...` `` → `me/feedback` ✓
- `` `/resume/optimize?taskId=…` `` → `resume/optimize` ✓ ｜ `` `/assistant?intent=…` `` → `assistant` ✓

**未验证的是 id 变量本身在运行时是否为空**——若 `fairId`/`job.id` 为 `undefined`，URL 会退化成 `/job-fairs/undefined/...`，仍能匹配 `:id` 路由，但详情页会走"未找到"分支。需要真实数据回归。

### 7.2 变量导航（约 25 处）

`navigate(tile.to)`（`HomePage.tsx:530`）、`navigate(action.route)`（`AssistantPage.tsx:579`）、`navigate(cap.to)`（`ResumeServiceHubPage.tsx:217`、`PrintScanHomePage.tsx:325`）、`navigate(returnTo)`（`LoginPage.tsx:110,113`）、`navigate(uploadPath)`（print 流程多处）、`navigate(destination)`（`ContractReviewResultPage.tsx:185,196`）等。已逐一追到其数据源（配置数组/静态映射表）并核对，但**运行时注入值未验证**。

其中 `navigate(returnTo)` 尤其需要运行时验证——§3.1 的扫描件丢失就是它丢失 router state 导致的。

### 7.3 需真机/后端验证的项

- **打印真机链路**：`/print/params` 是否真的从未被任何真机路径进入（本审计只证明代码中无入口）。
- **`/kiosk/*` 空壳端点**是否被 miniapp、admin、partner 或 terminal-agent 调用（本审计只证明 **kiosk 前端**不调用）。
- **`window.location.assign` 外跳**（`ToolboxLaunchModals.tsx:119`）在 Kiosk 全屏模式下的返回行为。
- **§6.1 的 P0**：需在真实终端上以 `enabled:true` + 模块默认 false 的配置，实际访问 `/smart-campus/service/luggage` 确认泄漏（代码层已确证）。
- **触控尺寸**：§9 的 48px 下限在 27 寸屏实际渲染尺寸下的复核（本审计只读 CSS 数值）。

### 7.4 本次未做运行时验证的原因

审计为纯静态只读，未启动 dev server、未连后端、未触碰真机。所有"用户会看到什么"均由代码推导，已尽量标注推导链。

---

## 8. 统计脚本（可复核）

所有脚本写在 scratchpad，**未提交仓库**。先导出只读快照：

```bash
# 0. 必须先 fetch，并对 origin/main 导出快照（不要在任何 worktree 检出上下结论）
cd /Users/wanglei/AI求职打印服务终端
git fetch origin main
git rev-parse origin/main          # 期望 67145a855a6eaaab2b5823182d530f817eee806b
SNAP=/tmp/kiosk-audit && mkdir -p "$SNAP"
git archive origin/main apps/kiosk services/api packages/shared | tar -x -C "$SNAP"
K="$SNAP/apps/kiosk/src"; A="$SNAP/services/api/src"
```

### 8.1 规模核实（§0.1）

```bash
find "$K/pages" -name '*.tsx' | wc -l                            # 168  页面文件
find "$K" -name '*.tsx' | wc -l                                  # 192  全部 tsx
grep -roh 'onClick=' "$K" --include='*.tsx' | wc -l              # 705  onClick 属性
grep -roh 'navigate(' "$K" --include='*.ts' --include='*.tsx' | wc -l   # 403  navigate 调用
grep -c 'path:' "$K/routes/index.tsx"                            # 105  路由定义
```

### 8.2 死按钮（§1）

```bash
# 空 handler —— 期望 0
grep -rnE "onClick=\{\s*\(\)\s*=>\s*\{\s*\}\s*\}|onClick=\{\s*\(\)\s*=>\s*(undefined|null|void 0)\s*\}|onClick=\{\s*noop\s*\}" "$K" --include='*.tsx'
# console.log-only handler —— 期望 0
grep -rnE "onClick=\{\s*\(\)\s*=>\s*console\.(log|warn|info)" "$K" --include='*.tsx'
# 待办/占位
grep -rnE "TODO|FIXME|待实现|未实现|占位|假数据" "$K/pages" --include='*.tsx' --include='*.ts'
```

### 8.3 错误路由 + 孤儿路由（§2/§4）

`enum3.js` —— 关键点：**静态段优先于 `:param`**（否则 `/jobs/online-platforms` 会被 `/jobs/:id` 抢走，导致误报）。

```js
// 解析 routes/index.tsx 的 path: 条目；相对路径补 '/' 前缀
// 候选路由按 (参数个数 asc, 段深度 desc) 排序后再匹配 —— 复刻 react-router 的特异性排序
const cands = uniq.filter(p => p !== '*').map(p => {
  const segs = p.split('/').filter(Boolean)
  return { p, re: toRe(p), params: segs.filter(s => s.startsWith(':')).length, depth: segs.length }
}).sort((a, b) => a.params - b.params || b.depth - a.depth)
const matchRoute = t => cands.find(r => r.re.test(t.split('?')[0].split('#')[0]))

// 错误路由：所有 navigate('...') / to="..." / <Navigate to> 字面量 → 取 matchRoute 为空者
// 孤儿路由：扫描 routes/index.tsx 之外的**全部**字符串字面量（覆盖 to:/route:/path: 等对象属性写法），
//          反查哪些路由从未被任何字面量命中
```

快速等价检查（单条路由）：

```bash
grep -rn "['\"\`]/ai/plan" "$K" --include='*.ts' --include='*.tsx' | grep -v routes/index.tsx   # 期望空
```

### 8.4 能力断层（§5）

```bash
# 后端端点全集：@Controller('x') + @Get/@Post/@Put/@Patch/@Delete('y') 组合 → 440 个 / 392 唯一模式
grep -rnE "@(Controller|Get|Post|Put|Patch|Delete|All)\(" "$A" --include='*.ts'
# 前端 API 路径全集 → 99 唯一
grep -rnE "\b(call|request|get|post|put|patch|del|delete)\s*(<[^>]*>)?\(\s*[\`'\"]/" "$K" --include='*.ts' --include='*.tsx'
grep -rn '\${API_BASE_URL}' "$K" --include='*.ts' --include='*.tsx'
# 比对时注意：嵌套模板串 `${qs({...})}` 会污染朴素正则，5 条"未匹配"需手工确认（本次全部为假阳性）
# 空壳端点复核
grep -rn "@Controller('kiosk" "$A"
```

### 8.5 合规文案（§3.4）

```bash
grep -rnF -e "一键投递" -e "立即投递" -e "企业收简历" -e "候选人管理" "$K"   # 期望 0
grep -rnP "(?<!来源)平台投递" "$K" --include='*.tsx' --include='*.ts'        # 期望 0（负向后顾，排除白名单短语子串）
```

### 8.6 门禁（§6）

```bash
grep -n "SmartCampusGuard" "$K/routes/index.tsx"          # 看哪几条传了 module prop
sed -n '35,45p' "$K/pages/smart-campus/SmartCampusGuard.tsx"
grep -n "DEFAULT_SMART_CAMPUS_MODULES" -A 8 "$SNAP/packages/shared/src/types/smartCampus.ts"
grep -n "moduleEntries\|config.modules" "$K/pages/smart-campus/SmartCampusHomePage.tsx"
```

---

## 9. 本审计未覆盖

如实列出边界，避免被当成全量结论：

1. **未做任何运行时验证。** 没起 dev server、没连后端、没上真机、没开浏览器。所有「用户会看到什么」均为代码推导。§7 列出了需实测的项。
2. **只审计 `apps/kiosk`。** `apps/miniapp`、`apps/admin`、`apps/partner`、`apps/terminal-agent` **完全未审**。`services/api` 仅在两个方向上被查询：(a) 验证 kiosk 调用的端点是否存在；(b) 反查 kiosk 相关空壳端点。后端业务逻辑、鉴权、数据正确性均未审计。
3. **`packages/ui` 不在导出快照内。** 因此 `KioskModal`、`KioskActionBar`、`Button` 等公共组件的内部行为**未验证**。§3 中 contract-review 弹窗的可关闭性推断即受此限制（依据是同仓库另一处调用点 `ContractReviewResultPage.tsx:453` 用 `onClose={() => !generatingReport && …}` 做了保护，反推 `onClose` 可由用户触发）。
4. **未审 CSS 实际渲染尺寸。** §1/§6 引用的触控尺寸问题只读了 CSS 数值（34px/40px/44px < §9 要求的 48px），未在 27 寸屏实测。发现的偏小控件集中在 `profile/me/styles/me-detail-base.css:458,185,375,443` 与 `resume/components/ResumeLayoutControls.tsx:65`，此处按体验问题归入 P2，未逐条展开。
5. **未审测试与 verify 脚本。** `apps/kiosk/scripts/verify-*.mjs`、`tests/visual/*` 未审。已知**至少 3 个 verify 脚本仍在断言 `pages/home/serviceGroups.ts`（27 个瓦片）这一实际未渲染的表面**——线上首页渲染的是 `HomePage.tsx:448-554` 的 `SvcGrid`（8 个瓦片）。也就是说 CI 门禁在守一个用户看不到的界面。这本身值得单独排查，但**不在本次审计范围**，也因此未纳入缺陷统计。
6. **未做删除可行性验证。** 本文对孤儿路由/空壳端点给出的"删除"建议**未按 CLAUDE.md §8 的删除举证要求**核验（无路由引用/无 import/无测试依赖/无文档声明/不被生产或硬件链路使用）。已知 `route-manifest.ts` 与 `verify-fusion-w2-print-scan.mjs` 仍断言 `/print/params` 渲染——**删除前必须先处理这些依赖**。
7. **未覆盖全部 705 个 onClick 的逐个人工判读。** 机械枚举是全量的（空 handler、console-only、路由目标、API 路径、合规文案均为 100% 扫描）；但「文案 vs 行为」这类需要语义判断的核查，是按域分工人工阅读完成的，重点覆盖 print / scan / resume / jobs / job-fairs / policy / profile / assistant / toolbox / smart-campus。**低流量的组件内嵌控件可能仍有遗漏。**
8. **本工作区有未提交改动。** 审计所用工作区（`claude/four-tasks-project-coordination-d39229`）对 `apps/kiosk/src/hooks/useSmartCampusConfig.ts`（+137/-56）与 `useToolboxConfig.ts`（+102）有大量在途修改，引入了 `CapabilityStatus` 状态机。**这些改动不在 `origin/main` 上，本文所有门禁结论均针对 `origin/main`。** 复核 §6 时请注意：在途工作已经在动这两个文件。

---

## 10. 建议处理顺序

| 优先级 | 项 | 位置 |
|--------|-----|------|
| **1** | **P0** `/smart-campus/service/:key` 补模块门禁 | §6.1 |
| 2 | P1 扫描件「登录后管理文件」虚假承诺 + 丢文件 | §3.1 |
| 3 | P1 首页 AI 接待台「输入框」不可点（首屏曝光最高） | §1.1 |
| 4 | P1 `ConvertImagesPage:276` 无条件「已保存到我的文档」 | §3.2 |
| 5 | P1 `PhoneUploadPage:132` 硬编码终端名 | §3.3 |
| 6 | P1 「政策收藏」接到 AI 服务记录 | §2.2(a) |
| 7 | P1 「评估历史」永远为空（含后端缺列表端点） | §2.2(b) / §5.3 |
| 8 | P1 `/smart-campus/freshman-insights` 补 `module="bigdata"` | §6.2 |
| 9 | P1 `/ai/plan` 删除或改造（伪造内容，勿接线） | §4.2 / §3.5 |
| 10 | P2 批量：其余错误目标、孤儿路由清理、空壳端点、触控尺寸 | §1–§6 |

> 清理类项目（孤儿路由、空壳端点、死代码）执行前，务必按 CLAUDE.md §8 的删除举证要求核验，并同步 `docs/progress/current-progress.md`。本文**不代替**该流程。
