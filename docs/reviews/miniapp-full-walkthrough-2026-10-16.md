# 小程序全量走查矩阵（2026-10-16 起）

> 格式参照 [`kiosk-full-walkthrough-2026-09-27.md`](kiosk-full-walkthrough-2026-09-27.md)。现状汇总写在 `docs/progress/current-progress.md`，这里是逐页明细，不另立账本。
> 范围：`apps/miniapp/app.json` 注册的 44 页（主包 5 + 分包 39，底部 4 个 Tab）。停放的 20 页不注册、不打包，不在本表。

## 证据口径（三类，不混算）

- **已见实际**：有人真看到过。注明是开发者工具实际模拟器截图还是用户手机，并写清源版本。
  - 正式版：`cfbe56784`。
  - 候选：`689047e9f`、`8242781fa`，以及 VIS1 的 `0205742fc`。
  - 后台 webview 的 AX 树不算可见截图。CUA 点击偶发 noWindowsAvailable，不记成产品按钮坏。
- **仅代码检查**：只从源码推断入口、状态分支和测试覆盖。没人看过实际效果，不能当作通过。
- **待真机**：必须在手机上看。例如下单后的系统返回、图片预览、下载中途返回。

截图证据清单：`commercial-closeout-20261016/claude-exec/evidence/ui-audit-2106/capture-manifest.json`。
- 8 个路由，全部是 `cfbe56784` 正式版在开发者工具 iPhone 12/13 (Pro) 下的截图。
- `01-orders-before.png` 实际拍到的是首页，作废。

## 概况（截至 21:30）

- 已见实际：14 页。其中模拟器截图 8 页，用户手机 7 页，有重叠。其余 30 页仅代码检查。
- 已发现问题：
  - P1 三条：
    - 订单页首屏被空卡占据、到机码折行；
    - 诊断页无报告时显示禁用导出卡、按钮越屏；
    - 简历优化入口是死路。
  - P2 六条：首页、AI 工具、简历搭建、语音简历、面试入口，以及 AI 工具滚动后内容进入状态栏下方。
- 代码层面：
  - 5 页没有任何测试：简历搭建、语音简历、求职材料、关于、今日提醒。
  - 10 页 js 超过 500 行，其中材料包确认 1112 行、打印确认 970 行、取件页 819 行，这三页超过 800 行。按 CLAUDE.md §8 不再往里堆功能，取件页列入拆分。

## 批次

| 批 | 页面 | 内容 | 状态 |
|---|---|---|---|
| 预览修复 | 打印预览、我的文档 | 每次现取签名链接、失败说清原因、返回不留遮罩 | #1469 `689047e9f`。手机上两个 PDF 入口 PASS |
| B1 / B2 / 修订 | 取件页、订单列表、订单详情、确认页 | 按钮用语、主次、信息卡、返回路径、下单后重建页面栈 | #1470 `8242781fa`。手机查看路径两项 PASS；下单后系统返回待真机 |
| VIS1 | 订单列表、诊断报告 | 首屏空卡、到机码折行、单件「加载更多」、导出只在完成态、按钮越界根因 | #1472 `0205742fc`。agy：可以出候选；候选截图待 Codex |
| 下一批（待预算） | 简历优化、AI 工具、简历搭建、语音简历 | P1 入口死路；对齐与安全区；首屏挤占；文字模式题面 | 未开工 |

## 逐页矩阵

| 页面 | 入口（代码） | 模板状态分支（代码） | 证据 | 视觉问题 | 操作问题 | 严重度 | 修复 | 测试；规模 |
|---|---|---|---|---|---|---|---|---|
| 首页<br>`pages/home/home` | 底部 Tab；TabBar, about, ai-records, assistant, career-plan, daily-report 等 | （模板无状态分支） | 已见实际｜模拟器 cfbe567：03-home-top-before（已登录、有一笔待到机） | 入口层级密集；待取件副标题被截断 | — | P2 | 待排批 | page-lifecycle、print-flow-ux、verify-miniapp-static 等；js 170 行 |
| 启动/登录<br>`pages/launch/launch` | ai-records, career-plan, daily-report, documents, feedback, job-fit 等 | 锁定 | 仅代码检查 | 待截图 | 待走查 | — | — | ai-access、page-lifecycle、session-generation 等；js 270 行 |
| AI 工具（Tab）<br>`pages/ai/ai` | 底部 Tab；TabBar, assistant, daily-report, help, home | （模板无状态分支） | 已见实际｜模拟器 cfbe567：04-ai-before、04b-ai-lower-before | 分组标题与说明贴左、未与卡片对齐；顶部说明和入口密集；滚动后内容跑到状态栏和微信胶囊下面（截图所见，根因待核） | — | P2 | 待排批（下一批） | verify-miniapp-static、verify-package-layout；js 140 行 |
| 打印（Tab）<br>`pages/print/print` | 底部 Tab；TabBar, assistant, daily-report, home, resume-diagnose | （模板无状态分支） | 仅代码检查 | 待截图 | 待走查 | — | — | free-pilot-copy、verify-miniapp-static、verify-package-layout；js 60 行 |
| 我的（Tab）<br>`pages/me/me` | 底部 Tab；TabBar, assistant, daily-report, feedback, home | 失败、未登录 | 仅代码检查 | 待截图 | 待走查 | — | — | me-stats、print-flow-ux、verify-miniapp-static 等；js 171 行 |
| AI 助手<br>`pages/assistant/assistant` | ai, home | 加载、锁定 | 仅代码检查 | 待截图 | 待走查 | — | — | page-lifecycle；js 330 行 |
| 材料包·组包<br>`pages/package-create/package-create` | orders, package-confirm, print, store-select | 分页、加载、失败、完成、未登录 | 仅代码检查 | 待截图 | 待走查 | — | — | free-pilot-copy、package-order-idempotency、page-lifecycle 等；js 553 行 ⚠ 超 500 |
| 材料包·选服务点<br>`pages/store-select/store-select` | package-confirm, package-create | 加载、失败、空 | 仅代码检查 | 待截图 | 待走查 | — | — | package-order-idempotency、page-lifecycle、verify-miniapp-static 等；js 186 行 |
| 材料包·确认<br>`pages/package-confirm/package-confirm` | store-select | 加载、失败、完成、未登录 | 仅代码检查 | 待截图 | 待走查 | — | — | free-pilot-copy、package-order-idempotency、page-lifecycle 等；js 1112 行 ⚠ 超 800 |
| 材料包·到机码<br>`pages/package-code/package-code` | home, orders, package-confirm | 加载、失败、完成 | 仅代码检查 | 待截图 | 待走查 | — | — | free-pilot-copy、home-pickup-summary、package-order-idempotency 等；js 457 行 |
| 打印·上传参数<br>`pages/print-upload/print-upload` | assistant, career-plan, documents, interview-qa, interview-result, job-fit 等 | 加载、失败、完成 | 已见实际｜手机 689047e9f：「查看原文」入口；03439f5 下单时走过 | 待截图 | 待走查 | — | — | free-pilot-copy、page-lifecycle、print-flow-ux 等；js 302 行 |
| 打印·选终端<br>`pages/print-store/print-store` | print-upload | 加载、失败、完成、空 | 已见实际｜手机 03439f5（旧源）：COLOR / DUPLEX / OFFLINE 下单时走过 | 待截图 | 待走查 | — | — | free-pilot-copy、page-lifecycle、print-capabilities 等；js 289 行 |
| 打印·确认<br>`pages/print-pay/print-pay` | print-store | 加载、失败、未登录、锁定 | 已见实际｜手机 03439f5（旧源）：同上 | 待截图 | 待走查 | — | — | free-pilot-copy、page-lifecycle、price-confirmation 等；js 970 行 ⚠ 超 800 |
| 打印·到机码/取件<br>`pages/print-pickup/print-pickup` | home, orders, print-pay | 加载、失败、完成、未登录 | 已见实际｜手机 03439f5（旧源）：同上；8242781fa 查看路径（用户未逐页记录） | 待截图 | 待走查 | — | — | free-pilot-copy、home-pickup-summary、page-lifecycle 等；js 819 行 ⚠ 超 800 |
| 简历搭建<br>`pages/resume-build/resume-build` | ai, ai-records, resume-voice | 加载、失败、完成、未登录 | 已见实际｜模拟器 cfbe567：05-resume-build-before（空表单） | 语音替代入口和大段说明先占首屏，基本字段靠下 | — | P2 | 待排批（下一批） | **无测试覆盖**；js 555 行 ⚠ 超 500 |
| 语音简历<br>`pages/resume-voice/resume-voice` | ai, home, resume-build | 失败、完成 | 已见实际｜模拟器 cfbe567：07、07b（未勾选录音 → 用手打进入第一题） | 文字模式题面仍写「请说出你的姓名」「转成文字后」 | 文字兜底入口本身可用（已观察） | P2 | 待排批（下一批） | **无测试覆盖**；js 387 行 |
| 简历上传<br>`pages/resume-upload/resume-upload` | assistant, career-plan, job-fit, resume-diagnose, resume-parse, resumes 等 | （模板无状态分支） | 仅代码检查 | 待截图 | 待走查 | — | — | verify-miniapp-static；js 128 行 |
| AI 诊断报告<br>`pages/resume-diagnose/resume-diagnose` | ai, ai-records, assistant, home, resume-parse, resumes | 加载、失败、完成、禁用、空 | 已见实际｜模拟器 cfbe567：02-diagnose-before（空态） | 无报告却有整块禁用导出卡；并排按钮右侧越屏；空态与主按钮之间大片空白 | 空态主操作离说明太远 | P1 | VIS1 #1472 `0205742fc`（agy：可以出候选；候选截图待 Codex） | ai-records-qa、free-pilot-copy、page-lifecycle 等；js 343 行 |
| 简历优化<br>`pages/resume-optimize/resume-optimize` | ai, ai-records, assistant, home, job-fit, resume-diagnose 等 | 加载、失败、完成、禁用 | 已见实际｜模拟器 cfbe567：06-resume-optimize-before（从 AI 工具正常进入） | — | 无 taskId 时只显示「未指定优化任务／请从简历诊断页发起」，只能返回：入口死路（首页有同名入口） | P1 | 下一批：复用上传 / 诊断 / 已有任务入口 | free-pilot-copy、verify-miniapp-static；js 498 行 |
| 模拟面试·设置<br>`pages/interview-entry/interview-entry` | ai, assistant, home, interview-result, job-fit | （模板无状态分支） | 已见实际｜模拟器 cfbe567：08-interview-entry-before（空表单） | 选择控件文字贴顶、下半块空白；练习时长标签与按题数选项不一致 | — | P2 | 待排批 | page-lifecycle；js 79 行 |
| 模拟面试·作答<br>`pages/interview-qa/interview-qa` | interview-entry | 加载、失败 | 仅代码检查 | 待截图 | 待走查 | — | — | page-lifecycle；js 202 行 |
| 模拟面试·报告<br>`pages/interview-result/interview-result` | ai-records, interview-qa | 加载、失败、完成 | 仅代码检查 | 待截图 | 待走查 | — | — | interview-result-compliance、page-lifecycle；js 121 行 |
| 职业规划<br>`pages/career-plan/career-plan` | ai, ai-records, assistant, home | 加载、失败、完成 | 仅代码检查 | 待截图 | 待走查 | — | — | self-explore-consent-items、verify-miniapp-static；js 250 行 |
| 自我探索<br>`pages/self-explore/self-explore` | ai, ai-records, career-plan | 加载、失败、完成、锁定 | 仅代码检查 | 待截图 | 待走查 | — | — | self-explore-consent-items、verify-miniapp-static；js 780 行 ⚠ 超 500 |
| 岗位匹配参考<br>`pages/job-fit/job-fit` | ai, ai-records, assistant | 加载、失败、完成 | 仅代码检查 | 待截图 | 待走查 | — | — | verify-miniapp-static、verify-review-scope；js 354 行 |
| 打印预览<br>`pages/print-preview/print-preview` | print-upload | 加载 | 已见实际｜手机 689047e9f：「打开原文查看」PDF 完整、返回无残留遮罩 | 待截图 | 待走查 | — | — | file-preview、free-pilot-copy、page-lifecycle 等；js 181 行 |
| U盘打印指引<br>`pages/usb-import/usb-import` | print | （模板无状态分支） | 仅代码检查 | 待截图 | 待走查 | — | — | page-lifecycle；js 28 行 |
| 简历解析<br>`pages/resume-parse/resume-parse` | resume-diagnose, resume-optimize, resume-upload | 失败、完成、锁定 | 仅代码检查 | 待截图 | 待走查 | — | — | page-lifecycle、verify-miniapp-static；js 756 行 ⚠ 超 500 |
| 我的简历<br>`pages/resumes/resumes` | me | 分页、加载、失败、未登录 | 仅代码检查 | 待截图 | 待走查 | — | — | list-load-more、verify-miniapp-static；js 183 行 |
| 我的文档<br>`pages/documents/documents` | ai, home, launch, me, order-detail, orders 等 | 分页、加载、失败、锁定 | 已见实际｜手机 689047e9f / 8242781fa：预览 PDF 完整、返回正常 | 待截图 | 待走查 | — | — | file-preview、page-lifecycle、print-flow-ux 等；js 468 行 |
| 求职材料<br>`pages/job-materials/job-materials` | ai | 加载、失败、空 | 仅代码检查 | 待截图 | 待走查 | — | — | **无测试覆盖**；js 145 行 |
| 打印订单<br>`pages/orders/orders` | home, me, notifications, order-detail, package-code, package-confirm 等 | 分页、加载、失败、完成、未登录、空 | 已见实际｜模拟器 cfbe567：01-orders-actual-before<br>已见实际｜手机 8242781fa：查看已完成 COLOR / DUPLEX 与待到机 PAPER 单，文件/终端/单双面清楚、返回正常（只看不下单） | 材料包 0 笔大空卡占首屏；到机码和标签折行；字小、卡里套卡 | 真实订单被挤到下面 | P1 | VIS1 #1472 `0205742fc`（agy：可以出候选；候选截图待 Codex） | free-pilot-copy、page-lifecycle、print-flow-ux 等；js 539 行 ⚠ 超 500 |
| 订单详情<br>`pages/order-detail/order-detail` | orders | 加载、失败 | 仅代码检查 | 待截图 | 待走查 | — | — | free-pilot-copy、order-detail-refresh、page-lifecycle 等；js 593 行 ⚠ 超 500 |
| AI 服务记录<br>`pages/ai-records/ai-records` | ai, assistant, me, notifications, resume-parse | 加载、失败、未登录 | 仅代码检查 | 待截图 | 待走查 | — | — | ai-records-qa、page-lifecycle、verify-miniapp-static；js 384 行 |
| 设置<br>`pages/settings/settings` | me | 未登录 | 仅代码检查 | 待截图 | 待走查 | — | — | verify-miniapp-static；js 61 行 |
| 隐私与数据<br>`pages/privacy/privacy` | feedback, settings | 加载、失败、未登录、空 | 仅代码检查 | 待截图 | 待走查 | — | — | free-pilot-copy、page-lifecycle、verify-miniapp-static；js 579 行 ⚠ 超 500 |
| 帮助<br>`pages/help/help` | settings | （模板无状态分支） | 仅代码检查 | 待截图 | 待走查 | — | — | page-lifecycle、verify-miniapp-static；js 71 行 |
| 关于<br>`pages/about/about` | settings | （模板无状态分支） | 仅代码检查 | 待截图 | 待走查 | — | — | **无测试覆盖**；js 42 行 |
| 法务文档<br>`pages/legal/legal` | about, ai, assistant, feedback, home, launch 等 | 加载、失败 | 仅代码检查 | 待截图 | 待走查 | — | — | self-explore-consent-items、verify-miniapp-static；js 119 行 |
| 消息通知<br>`pages/notifications/notifications` | home, launch, me, settings | 加载、失败 | 仅代码检查 | 待截图 | 待走查 | — | — | verify-miniapp-static；js 139 行 |
| 扫码登录一体机<br>`pages/kiosk-login/kiosk-login` | home, print | 失败、完成、未登录 | 仅代码检查 | 待截图 | 待走查 | — | — | kiosk-login-confirm；js 348 行 |
| 发送到一体机<br>`pages/kiosk-send/kiosk-send` | kiosk-login | 加载、失败、完成 | 仅代码检查 | 待截图 | 待走查 | — | — | kiosk-send-receipt；js 253 行 |
| 今日提醒<br>`pages/daily-report/daily-report` | home, print | 加载、失败、空 | 仅代码检查 | 待截图 | 待走查 | — | — | **无测试覆盖**；js 129 行 |
| 意见反馈<br>`pages/feedback/feedback` | ai, assistant, help, me, privacy | 分页、加载、失败、完成 | 仅代码检查 | 待截图 | 待走查 | — | — | list-load-more；js 315 行 |
