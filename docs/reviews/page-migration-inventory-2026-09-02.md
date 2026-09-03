# Kiosk 51 页前端迁移 · 逐页施工台账（2026-09-02）

## 这份台账是什么

产品负责人 2026-09-02 决定用 `docs/design/kiosk-redesign-2026-08/` 的 51 张 HTML 原型**整体替换**运行时 Kiosk 前端（不在旧页上打补丁 —— 上一代 V6 只迁移一半，效果不好）。本文件把「每页开工前必须先查的东西」一次查完落账，让后 50 页开工时不必重新调查。

**它不回答**：怎么改、改成什么样、先做哪页。那是每页开工时写的逐文件计划。本台账只回答「这一页迁移会碰到什么」。

## 数据怎么来的

| 列 | 取数方式 |
|---|---|
| 原型页 | `ls docs/design/kiosk-redesign-2026-08/*.html`，51 个编号页（00–51，无 17） |
| 对应运行时路由 | 原型头部注释 `route:` 行。8 页无该行，逐页另找证据并在表内标注 |
| 运行时实现文件 / 行数 | `docs/graph/graph.json` 的 `apps.kiosk.routes[].file`，行数为实测 `wc -l` |
| 状态数 | 优先级：页内 `STATES[]` 允许表 > 头部 `state:` 声明 > 页内 `?state=` 链接。逐页标注实际取自哪一个 |
| 门禁 | `node scripts/project-graph-query.mjs file <路径>`（等价于 `graph.json` 的 `fileToGates`），多路由页取并集 |
| 端点 | `graph.json` 路由对象的 `endpoints`，多路由页取并集。注意这是 **import 可达性上界**，不是本页真调用数 |
| 独占闭包 | 本文自带脚本：从路由入口文件沿相对 import 做 BFS（限 `apps/kiosk/src` 内），再扣掉任何其它路由也能到达的文件 |

## 什么时候会过期

- 改了 `apps/kiosk/src/routes/index.tsx`（路由表）、任何页面文件的 import、Prisma 模型或 verify 门禁之后 → 先 `pnpm graph` 重跑 `docs/graph/`，本台账的第 3/4/6/7 列全部作废。
- 改了 `docs/design/kiosk-redesign-2026-08/` 的原型头注释 → 第 2/5 列作废。
- **图谱和代码对不上时以代码为准**，并且那是 `scripts/project-graph/` 的 bug，不要手改 `docs/graph/` 产物。

## 一句话读法

**「实现文件行数」会骗人。** `/` 的 `HomePage.tsx` 只有 71 行，但它的独占闭包是 7 个文件 860 行；`/renshi` 的 `RenshiPage.tsx` 只有 167 行，独占闭包却是 13 个文件 1803 行。真正代表这一页迁移工作量的是**独占闭包行数**那一列，不是入口文件行数。

---

## 一、总表（51 行）

风险标记规则（满足任一即标）：

- `>800行` —— 入口文件超过 CLAUDE.md §8 的 800 行硬上限，迁移时必须先拆
- `门禁N` —— 该页实现文件被 N 条 verify 门禁断言，N ≥ 3
- `状态N` —— 原型声明状态数 ≥ 15
- `硬件主链` —— 路由本身落在 `/print*` `/scan*` `/print-scan*` 上，即这一页就是出纸/收款/取件本身
- `打印交接` —— 路由不在硬件主链上，但实现文件里有指向 `/print/*` 的交接（`navigate('/print/confirm')`、`print-url` 等）

> `独占闭包` = 从该页路由入口沿相对 import 可达、且**没有任何其它路由能到达**的文件数与行数。
> 这一列才是这一页的真实迁移面积；`实现文件（行数）` 只是入口文件，会严重低估（见异常 A6）。

| # | 原型页 | 批次 | 运行时路由 | 实现文件（行数） | 状态数 | 门禁 | 端点 | 独占闭包 | 风险 |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `10-print-hub.html` | B1 | `/print-scan`<br>`/print-scan/feature/:key` | `apps/kiosk/src/pages/print-scan/PrintScanHomePage.tsx`（477）<br>`apps/kiosk/src/pages/print-scan/PrintScanFeatureInfoPage.tsx`（207） | 7 | 6 | 14 | 4 文件 / 1424 行 | 门禁6<br>硬件主链 |
| 2 | `11-arrival-code.html` | B1 | `/print/pickup-claim` | `apps/kiosk/src/pages/print/PrintPickupClaimPage.tsx`（406） | 8 | 3 | 13 | 3 文件 / 570 行（与 33 合并计） | 门禁3<br>硬件主链 |
| 3 | `12-file-source.html` | B1 | `/print/upload` | `apps/kiosk/src/pages/print/PrintUploadPage.tsx`（767） | 38 | 5 | 22 | 2 文件 / 844 行 | 门禁5<br>状态38<br>硬件主链 |
| 4 | `13-print-desk.html` | B1 | `/print/material-check`<br>`/print/preview`<br>`/print/params` | `apps/kiosk/src/pages/print/PrintMaterialCheckPage.tsx`（534）<br>`apps/kiosk/src/pages/print/PrintPreviewPage.tsx`（713）<br>（重定向，无页面文件） | 22 | 8 | 16 | 4 文件 / 1531 行 | 门禁8<br>状态22<br>硬件主链 |
| 5 | `14-print-confirm.html` | B1 | `/print/confirm` | `apps/kiosk/src/pages/print/PrintConfirmPage.tsx`（754） | 8 | 8 | 31 | 3 文件 / 1091 行 | 门禁8<br>硬件主链 |
| 6 | `15-print-fulfill.html` | B1 | `/print/progress`<br>`/print/done` | `apps/kiosk/src/pages/print/PrintProgressPage.tsx`（746）<br>`apps/kiosk/src/pages/print/PrintDonePage.tsx`（453） | 9 | 8 | 27 | 3 文件 / 1230 行 | 门禁8<br>硬件主链 |
| 7 | `18-scan-workbench.html` | B1 | `/scan/start`<br>`/scan/settings`<br>`/scan/progress`<br>`/scan/result` | `apps/kiosk/src/pages/scan/ScanStartPage.tsx`（264）<br>`apps/kiosk/src/pages/scan/ScanSettingsPage.tsx`（286）<br>`apps/kiosk/src/pages/scan/ScanProgressPage.tsx`（252）<br>`apps/kiosk/src/pages/scan/ScanResultPage.tsx`（174） | 21 | 3 | 15 | 6 文件 / 1102 行 | 门禁3<br>状态21<br>硬件主链 |
| 8 | `19-img2pdf.html` | B1 | `/print-scan/convert`<br>`/print/scan-convert` | `apps/kiosk/src/pages/print-scan/ConvertImagesPage.tsx`（298）<br>（重定向，无页面文件） | 28 | 2 | 19 | 2 文件 / 360 行 | 状态28<br>硬件主链 |
| 9 | `20-sign-stamp.html` | B1 | `/print-scan/sign`<br>`/print/scan-sign` | `apps/kiosk/src/pages/print-scan/SignStampPage.tsx`（501）<br>（重定向，无页面文件） | 63 | 3 | 20 | 2 文件 / 583 行 | 门禁3<br>状态63<br>硬件主链 |
| 10 | `32-cashier.html` | B1 | `/print/cashier` | `apps/kiosk/src/pages/print/PrintCashierPage.tsx`（673） | 23 | 7 | 23 | 2 文件 / 1033 行（与 37 合并计） | 门禁7<br>状态23<br>硬件主链 |
| 11 | `33-pickup-code.html` | B1 | `/print/pickup-claim` | `apps/kiosk/src/pages/print/PrintPickupClaimPage.tsx`（406） | 1 | 3 | 13 | 3 文件 / 570 行（与 11 合并计） | 门禁3<br>硬件主链 |
| 12 | `37-pay-states.html` | B1 | `/print/cashier` | `apps/kiosk/src/pages/print/PrintCashierPage.tsx`（673） | 6 | 7 | 23 | 2 文件 / 1033 行（与 32 合并计） | 门禁7<br>硬件主链 |
| 13 | `21-resume-triage.html` | B2 | `/resume/source`<br>`/resume/parse` | `apps/kiosk/src/pages/resume/ResumeSourcePage.tsx`（601）<br>`apps/kiosk/src/pages/resume/ResumeParsePage.tsx`（279） | 50 | 7 | 44 | 3 文件 / 1083 行 | 门禁7<br>状态50 |
| 14 | `22-resume-report.html` | B2 | `/resume/report` | `apps/kiosk/src/pages/resume/ResumeReportPage.tsx`（468） | 9 | 5 | 44 | 2 文件 / 616 行 | 门禁5 |
| 15 | `23-resume-optimize.html` | B2 | `/resume/optimize`<br>`/resume/optimize/compare` | `apps/kiosk/src/pages/resume/ResumeOptimizePage.tsx`（558）<br>`apps/kiosk/src/pages/resume/ResumeOptimizeComparePage.tsx`（411） | 8 | 7 | 44 | 5 文件 / 1271 行 | 门禁7<br>打印交接 |
| 16 | `24-resume-generate.html` | B2 | `/resume/generate`<br>`/resume/generate/preview` | `apps/kiosk/src/pages/resume/ResumeGeneratePage.tsx`（607）<br>`apps/kiosk/src/pages/resume/ResumeGeneratePreviewPage.tsx`（419） | 33 | 8 | 44 | 4 文件 / 1284 行 | 门禁8<br>状态33<br>打印交接 |
| 17 | `25-material-workshop.html` | B2 | `/resume/materials` | `apps/kiosk/src/pages/resume/JobMaterialLibraryPage.tsx`（361） | 10 | 7 | 14 | 1 文件 / 361 行 | 门禁7<br>打印交接 |
| 18 | `29-interview-training.html` | B2 | `/interview/setup`<br>`/interview/session`<br>`/interview/report`<br>`/interview/tips`<br>`/interview/reports` | `apps/kiosk/src/pages/interview/InterviewSetupPage.tsx`（559）<br>`apps/kiosk/src/pages/interview/InterviewSessionPage.tsx`（467）<br>`apps/kiosk/src/pages/interview/InterviewReportPage.tsx`（243）<br>`apps/kiosk/src/pages/interview/InterviewTipsPage.tsx`（286）<br>`apps/kiosk/src/pages/interview/InterviewReportsPage.tsx`（181） | 34 | 9 | 28 | 11 文件 / 2487 行 | 门禁9<br>状态34<br>打印交接 |
| 19 | `34-self-assessment.html` | B2 | `/resume/self-assessment/intro`<br>`/resume/self-assessment/questions`<br>`/resume/self-assessment/result`<br>`/resume/self-assessment/history` | `apps/kiosk/src/pages/resume/SelfAssessmentFlow.tsx`（808） | 11 | 4 | 18 | 2 文件 / 954 行 | >800行(808)<br>门禁4<br>打印交接 |
| 20 | `46-resume-decision-workspace.html` | B2 | `/resume/job-fit`<br>`/resume/job-fit/actions`<br>`/resume/career-plan`<br>`/resume/templates` | `apps/kiosk/src/pages/resume/JobFitPage.tsx`（685）<br>`apps/kiosk/src/pages/resume/JobFitActionsPage.tsx`（369）<br>`apps/kiosk/src/pages/resume/CareerPlanPage.tsx`（580）<br>`apps/kiosk/src/pages/resume/ResumeTemplateLibraryPage.tsx`（262） | **未知** | 11 | 51 | 13 文件 / 2346 行 | 门禁11<br>打印交接 |
| 21 | `03-login-gate.html` | B3 | `/login` | `apps/kiosk/src/pages/auth/LoginPage.tsx`（311） | 13 | 10 | 21 | 7 文件 / 1184 行 | 门禁10 |
| 22 | `04-session-guard.html` | B3 | `/session-timeout` | `apps/kiosk/src/pages/placeholders/SessionTimeoutPage.tsx`（192） | 5 | 1 | 0 | 1 文件 / 192 行 | — |
| 23 | `30-my-profile.html` | B3 | `/profile`<br>`/me/settings` | `apps/kiosk/src/pages/profile/ProfilePage.tsx`（184）<br>`apps/kiosk/src/pages/profile/me/MySettingsPage.tsx`（542） | 29 | 9 | 33 | 9 文件 / 1220 行 | 门禁9<br>状态29<br>打印交接 |
| 24 | `31-benefits.html` | B3 | `/me/benefits`<br>`/activities`<br>`/activities/:id` | `apps/kiosk/src/pages/profile/me/MyBenefitsPage.tsx`（154）<br>`apps/kiosk/src/pages/activities/BenefitActivitiesPage.tsx`（191）<br>`apps/kiosk/src/pages/activities/BenefitActivityDetailPage.tsx`（276） | 16 | 5 | 3 | 4 文件 / 706 行 | 门禁5<br>状态16 |
| 25 | `35-notifications.html` | B3 | `/me/notifications`<br>`/notifications` | `apps/kiosk/src/pages/profile/me/MyNotificationsPage.tsx`（270）<br>`apps/kiosk/src/pages/placeholders/NotificationsPage.tsx`（7） | 9 | 6 | 3 | 3 文件 / 419 行 | 门禁6 |
| 26 | `38-member-assets.html` | B3 | `/me/documents`<br>`/me/print-orders` | `apps/kiosk/src/pages/profile/me/MyDocumentsPage.tsx`（499）<br>`apps/kiosk/src/pages/profile/me/MyPrintOrdersPage.tsx`（402） | 14 | 11 | 4 | 6 文件 / 1108 行 | 门禁11<br>打印交接 |
| 27 | `39-member-records.html` | B3 | `/me/resumes`<br>`/me/favorites`<br>`/me/ai-records`<br>`/me/activity`<br>`/me/activity/:id` | `apps/kiosk/src/pages/profile/me/MyResumesPage.tsx`（288）<br>`apps/kiosk/src/pages/profile/me/MyFavoritesPage.tsx`（167）<br>`apps/kiosk/src/pages/profile/me/MyAiRecordsPage.tsx`（295）<br>`apps/kiosk/src/pages/profile/me/MyActivityPage.tsx`（175）<br>`apps/kiosk/src/pages/placeholders/MeActivityDetailPage.tsx`（118） | 32 | 11 | 30 | 7 文件 / 1183 行 | 门禁11<br>状态32 |
| 28 | `40-member-feedback.html` | B3 | `/me/feedback` | `apps/kiosk/src/pages/profile/me/MyFeedbackPage.tsx`（255） | 13 | 4 | 3 | 6 文件 / 787 行 | 门禁4 |
| 29 | `41-member-privacy.html` | B3 | `/me/privacy-requests` | `apps/kiosk/src/pages/profile/me/MyPrivacyRequestsPage.tsx`（238） | 9 | 4 | 15 | 2 文件 / 315 行 | 门禁4 |
| 30 | `51-phone-relay.html` | B3 | `/member/qr-login`<br>`/upload/phone` | `apps/kiosk/src/pages/auth/MobileQrLoginPage.tsx`（234）<br>`apps/kiosk/src/pages/upload/PhoneUploadPage.tsx`（240） | **未知** | 6 | 22 | 2 文件 / 474 行 | 门禁6 |
| 31 | `26-browse-list.html` | B4 | `/jobs` | `apps/kiosk/src/pages/jobs/JobsPage.tsx`（482） | 15 | 4 | 47 | 2 文件 / 622 行 | 门禁4<br>状态15 |
| 32 | `27-browse-detail.html` | B4 | `/jobs/:id` | `apps/kiosk/src/pages/jobs/JobDetailPage.tsx`（358） | 18 | 5 | 51 | 2 文件 / 730 行 | 门禁5<br>状态18<br>打印交接 |
| 33 | `28-jobfair-enhanced.html` | B4 | `/job-fairs`<br>`/job-fairs/checkin`<br>`/job-fairs/:id`<br>`/job-fairs/:id/companies`<br>`/job-fairs/:id/map`<br>`/job-fairs/:id/materials`<br>`/job-fairs/:id/visit-plan`<br>`/job-fairs/:id/stats` | `apps/kiosk/src/pages/job-fairs/JobFairsPage.tsx`（346）<br>`apps/kiosk/src/pages/job-fairs/JobFairCheckinPage.tsx`（219）<br>`apps/kiosk/src/pages/job-fairs/JobFairDetailPage.tsx`（323）<br>`apps/kiosk/src/pages/job-fairs/FairCompaniesPage.tsx`（182）<br>`apps/kiosk/src/pages/job-fairs/FairMapPage.tsx`（270）<br>`apps/kiosk/src/pages/job-fairs/FairMaterialsPage.tsx`（232）<br>`apps/kiosk/src/pages/job-fairs/FairVisitPlanPage.tsx`（403）<br>`apps/kiosk/src/pages/job-fairs/FairStatsPage.tsx`（299） | 33 | 12 | 48 | 12 文件 / 3496 行 | 门禁12<br>状态33<br>打印交接 |
| 34 | `42-offline-agency-directory.html` | B4 | `/offline-agencies`<br>`/offline-agencies/:id`<br>`/jobs/:id/offline` | `apps/kiosk/src/pages/offline-agencies/OfflineAgenciesPage.tsx`（205）<br>`apps/kiosk/src/pages/offline-agencies/OfflineAgencyDetailPage.tsx`（124）<br>`apps/kiosk/src/pages/offline-agencies/OfflineJobDetailPage.tsx`（162） | 11 | 3 | 3 | 4 文件 / 772 行 | 门禁3<br>打印交接 |
| 35 | `43-company-directory.html` | B4 | `/companies`<br>`/companies/:id` | `apps/kiosk/src/pages/companies/CompaniesPage.tsx`（425）<br>`apps/kiosk/src/pages/companies/CompanyDetailPage.tsx`（485） | 9 | 2 | 9 | 3 文件 / 991 行 | — |
| 36 | `44-fair-company-detail.html` | B4 | `/job-fairs/:id/companies/:companyId` | `apps/kiosk/src/pages/job-fairs/FairCompanyDetailPage.tsx`（258） | 7 | 4 | 48 | 2 文件 / 746 行 | 门禁4<br>打印交接 |
| 37 | `45-online-platform-directory.html` | B4 | `/jobs/online-platforms` | `apps/kiosk/src/pages/jobs/OnlinePlatformsPage.tsx`（280） | 4 | 0 | 0 | 1 文件 / 280 行 | — |
| 38 | `49-campus-workspace.html` | B4 | `/campus`<br>`/campus/welcome` | `apps/kiosk/src/pages/campus/CampusPage.tsx`（345）<br>`apps/kiosk/src/pages/placeholders/CampusWelcomePage.tsx`（20） | **未知** | 4 | 48 | 4 文件 / 946 行 | 门禁4 |
| 39 | `00-standby.html` | B5 | `/screensaver` | `apps/kiosk/src/pages/screensaver/ScreensaverPage.tsx`（244） | 1 | 4 | 16 | 3 文件 / 374 行 | 门禁4 |
| 40 | `01-home.html` | B5 | `/` | `apps/kiosk/src/pages/home/HomePage.tsx`（71） | 2 | 9 | 18 | 7 文件 / 860 行 | 门禁9 |
| 41 | `02-services.html` | B5 | **未知**（见异常 A2） | — | 1 | 0 | 0 | — | — |
| 42 | `05-ai-cockpit.html` | B5 | `/assistant` | `apps/kiosk/src/pages/assistant/AssistantPage.tsx`（587） | 12 | 4 | 44 | 7 文件 / 1656 行 | 门禁4 |
| 43 | `06-help.html` | B5 | `/help` | `apps/kiosk/src/pages/help/HelpCenterPage.tsx`（229） | 4 | 3 | 0 | 1 文件 / 229 行 | 门禁3<br>打印交接 |
| 44 | `07-session-resume.html` | B5 | `/session-resume` | `apps/kiosk/src/pages/session-resume/SessionResumePage.tsx`（226） | 11 | 1 | 1 | 2 文件 / 293 行 | 打印交接 |
| 45 | `08-legal.html` | B5 | `/legal/:doc` | `apps/kiosk/src/pages/legal/LegalDocPage.tsx`（261） | 4 | 3 | 44 | 1 文件 / 261 行 | 门禁3 |
| 46 | `09-system-state.html` | B5 | `/error-offline` | `apps/kiosk/src/pages/placeholders/ErrorOfflinePage.tsx`（91） | 5 | 1 | 0 | 1 文件 / 91 行 | — |
| 47 | `16-service-hubs.html` | B5 | `/resume-service`<br>`/jobs-service`<br>`/fairs-service`<br>`/interview-service`<br>`/policy-service` | `apps/kiosk/src/pages/resume/ResumeServiceHubPage.tsx`（366）<br>`apps/kiosk/src/pages/jobs/JobsServiceHubPage.tsx`（320）<br>`apps/kiosk/src/pages/job-fairs/FairsServiceHubPage.tsx`（276）<br>`apps/kiosk/src/pages/interview/InterviewServiceHubPage.tsx`（281）<br>`apps/kiosk/src/pages/policy/PolicyServiceHubPage.tsx`（282） | 20 | 3 | 0 | 7 文件 / 1626 行 | 门禁3<br>状态20<br>打印交接 |
| 48 | `36-index.html` | B5 | **不适用**（设计总览索引） | — | 0 | 0 | 0 | — | — |
| 49 | `47-contract-review-workspace.html` | B5 | `/contract-review`<br>`/contract-review/processing`<br>`/contract-review/result` | `apps/kiosk/src/pages/contract-review/ContractReviewHomePage.tsx`（402）<br>`apps/kiosk/src/pages/contract-review/ContractReviewProcessingPage.tsx`（396）<br>`apps/kiosk/src/pages/contract-review/ContractReviewResultPage.tsx`（494） | **未知** | 4 | 27 | 5 文件 / 1403 行 | 门禁4<br>打印交接 |
| 50 | `48-policy-workspace.html` | B5 | `/renshi` | `apps/kiosk/src/pages/renshi/RenshiPage.tsx`（167） | **未知** | 3 | 5 | 13 文件 / 1803 行 | 门禁3 |
| 51 | `50-capability-zone-workspace.html` | B5 | `/toolbox`<br>`/smart-campus`<br>`/smart-campus/welcome`<br>`/smart-campus/service/:key` | `apps/kiosk/src/pages/toolbox/ToolboxZonePage.tsx`（127）<br>`apps/kiosk/src/pages/smart-campus/SmartCampusHomePage.tsx`（257）<br>`apps/kiosk/src/pages/smart-campus/SmartCampusGuard.tsx`（50） | **未知** | 4 | 14 | 6 文件 / 702 行 | 门禁4 |

### 路由与状态取数的逐页注脚

只列取数方式**不是**「头注释 `route:` + 页内 `STATES[]` 完全一致」的页；其余页两个来源互相印证，不再赘述。

| 原型页 | 路由取自 | 状态数取自 |
|---|---|---|
| `11-arrival-code.html` | 头注释 route: | 头注释 8 = 页内 ?state= 链接 8 |
| `12-file-source.html` | 头注释 route: | 页内 STATES[] 38（头注释未逐条列举） |
| `13-print-desk.html` | 头注释 route:（/print/params 为兼容重定向） | 页内 STATES[] 22 |
| `14-print-confirm.html` | 头注释 route: | 页内 STATES[] 8（头注释只列 5 条「正常访问可达」） |
| `15-print-fulfill.html` | 头注释 route: | 头注释 9 = 页内 ?state= 链接 9 |
| `18-scan-workbench.html` | 头注释 route: | 头注释按 route 括号枚举：1+3+10+7；本页无 ?state= 轴，靠真实交互推进 |
| `19-img2pdf.html` | 头注释 route:（后者为重定向） | 页内 STATES[] 28 |
| `20-sign-stamp.html` | 头注释 route:（后者为重定向） | 页内 STATES[] 63（页内自带分组计数注释） |
| `32-cashier.html` | 头注释 route: | 头注释 23 = STATES[] 23 = 页内 ?state= 链接 23 |
| `33-pickup-code.html` | 跨页 data-route="/print/pickup-claim"（本页无头注释、不在台账内）——与 11-arrival-code 同路由，重复宿主 | 无 ?state= 轴、无状态注册表，单视图 |
| `37-pay-states.html` | 头注释 route:，但头注释自称「历史六态版式页，不是收银台真值页」——与 32-cashier 同路由，重复宿主 | 头注释 = STATES[] 6 |
| `21-resume-triage.html` | 头注释 route: | 页内 STATES[] 50（头注释只列 12 条主轴） |
| `22-resume-report.html` | 头注释 route: | 页内 STATES[] 9 |
| `23-resume-optimize.html` | 头注释 route: | 页内 STATES[] 8 |
| `24-resume-generate.html` | 头注释 route: | 页内 STATES[] 33 |
| `25-material-workshop.html` | 头注释 route: | 页内 STATES[] 10（头注释只列 6） |
| `29-interview-training.html` | 文件第 3 行注释（非标准 route: 头） | 页内 STATES[] 34 |
| `34-self-assessment.html` | 头注释 routes:（复数写法，简写展开） | 页内 STATES[] 6 + 头注释 fail-closed 拦截面 5（recover-consent / recover-submitted / recover-progress / recover-result / invalid） |
| `46-resume-decision-workspace.html` | 头注释 route: | 未知：头注释只写「由 ?screen= 与 ?state= 共同表达」，状态注册表在缺失的 resume-decision-workspace.js |
| `03-login-gate.html` | 头注释 route: | 头注释 state: 13 = 页内 STATES[] 13 |
| `30-my-profile.html` | 头注释 route: | 头注释按 screen 分组求和 profile 7 + settings 22（去重并集 26） |
| `31-benefits.html` | 头注释 route: | 头注释按 screen 分组求和 5+4+7（去重并集 11） |
| `39-member-records.html` | 头注释 route: | 页内 VIEWS 逐 view states[] 求和 5+5+10+7+5（头注释只列了前两个 view） |
| `40-member-feedback.html` | 头注释 route: | 页内 STATES[] 13（头注释只列 8） |
| `51-phone-relay.html` | 头注释 route: | 未知：状态注册表在缺失的 phone-relay.js |
| `26-browse-list.html` | 头注释 route: | 头注释 state: 15（页内 VIEWS 键一致） |
| `27-browse-detail.html` | 头注释 route: | 头注释 18 = 页内 VIEWS 键 18 |
| `28-jobfair-enhanced.html` | 头注释 route:（8 条，逐条标 screen=） | 头注释按 screen 分组求和 5+4+5+4+3+4+5+3（去重并集 18） |
| `42-offline-agency-directory.html` | 头注释 route: | 头注释按前缀分组求和 list 5 + agency 4 + job 2（状态注册表在缺失的 directory-workspaces.js，无法二次核对） |
| `43-company-directory.html` | 头注释 route: | 头注释 list 5 + company 4（同上，JS 缺失无法核对） |
| `44-fair-company-detail.html` | 头注释 route: | 头注释 7（同上，JS 缺失无法核对） |
| `45-online-platform-directory.html` | 头注释 route: | 头注释 4（同上，JS 缺失无法核对） |
| `49-campus-workspace.html` | 头注释 route: | 未知：状态注册表在缺失的 campus-workspace.js / policy-campus-workspaces.js |
| `00-standby.html` | 台账 COVERAGE-MATRIX 014（本页无 route: 头注释） | 页内仅 standby-state-default 一态，无 ?state= 轴 |
| `01-home.html` | 台账 001 +（跨页 data-route="/"）（本页无 route: 头注释） | 页内 JS：context / no-context |
| `02-services.html` | 未知：无 route: 头注释、不在 106 条台账内、被引用时只标 data-route="/" | 页内仅 data-state="default" |
| `16-service-hubs.html` | 页内 HUB_ROUTE 表 + 台账（本页无 route: 头注释） | ?state= 允许表 4 态 × ?hub= 5 个 hub |
| `36-index.html` | 不适用：本页是 51 页设计总览索引，非产品页 | 不适用 |
| `47-contract-review-workspace.html` | 头注释 route: | 未知：状态注册表在缺失的 contract-review-workspace.js |
| `48-policy-workspace.html` | 头注释 route:（另有产品真实 query ?tab= 五值） | 未知：状态注册表在缺失的 policy-workspace.js / policy-campus-workspaces.js |
| `50-capability-zone-workspace.html` | 头注释 route: | 未知：状态注册表在缺失的 capability-zone-workspace.js / policy-campus-workspaces.js |

---

## 二、五个批次小结

| 批次 | 页数 | 合计状态数 | 合计门禁数（去重后） | 合计独占闭包行 | 风险页数 |
|---|---|---|---|---|---|
| B1 打印扫描（12 页） | 12 | 234 | 18 | 9768 | 12 |
| B2 简历材料（8 页） | 8 | 155 （另 1 页未知） | 15 | 10402 | 8 |
| B3 我的账号（10 页） | 10 | 140 （另 1 页未知） | 27 | 7588 | 9 |
| B4 岗位招聘会（8 页） | 8 | 97 （另 1 页未知） | 15 | 8583 | 6 |
| B5 首页 AI 其它（13 页） | 13 | 60 （另 3 页未知） | 26 | 9298 | 10 |

### B1 打印扫描（12 页）

成员：`10-print-hub`、`11-arrival-code`、`12-file-source`、`13-print-desk`、`14-print-confirm`、`15-print-fulfill`、`18-scan-workbench`、`19-img2pdf`、`20-sign-stamp`、`32-cashier`、`33-pickup-code`、`37-pay-states`

- 合计状态数 **234**
- 去重门禁 **18** 条
- 风险页 **12/12**：
  - `10-print-hub` —— 门禁6、硬件主链
  - `11-arrival-code` —— 门禁3、硬件主链
  - `12-file-source` —— 门禁5、状态38、硬件主链
  - `13-print-desk` —— 门禁8、状态22、硬件主链
  - `14-print-confirm` —— 门禁8、硬件主链
  - `15-print-fulfill` —— 门禁8、硬件主链
  - `18-scan-workbench` —— 门禁3、状态21、硬件主链
  - `19-img2pdf` —— 状态28、硬件主链
  - `20-sign-stamp` —— 门禁3、状态63、硬件主链
  - `32-cashier` —— 门禁7、状态23、硬件主链
  - `33-pickup-code` —— 门禁3、硬件主链
  - `37-pay-states` —— 门禁7、硬件主链

<details><summary>本批命中的门禁清单</summary>

- `apps/kiosk/scripts/verify-contract-review-report-print.mjs`
- `apps/kiosk/scripts/verify-device-status-honest.mjs`
- `apps/kiosk/scripts/verify-file-display-truth.mjs`
- `apps/kiosk/scripts/verify-fusion-w2-print-scan.mjs`
- `apps/kiosk/scripts/verify-kiosk-feedback-entry.mjs`
- `apps/kiosk/scripts/verify-legal-retention-copy.mjs`
- `apps/kiosk/scripts/verify-p39-print-hub-fidelity.mjs`
- `apps/kiosk/scripts/verify-price-single-source.mjs`
- `apps/kiosk/scripts/verify-print-confirm-honest.mjs`
- `apps/kiosk/scripts/verify-print-done-truth.mjs`
- `apps/kiosk/scripts/verify-print-entry-source-split.mjs`
- `apps/kiosk/scripts/verify-print-parameter-capability.mjs`
- `apps/kiosk/scripts/verify-profile-commercial-first-batch.mjs`
- `apps/kiosk/scripts/verify-profile-documents-inkpaper.mjs`
- `apps/kiosk/scripts/verify-scan-input-safety.mjs`
- `apps/kiosk/scripts/verify-scan-session-truth.mjs`
- `apps/kiosk/scripts/verify-service-entry-readiness.mjs`
- `services/api/scripts/verify-backend-p0-contracts.mjs`

</details>

### B2 简历材料（8 页）

成员：`21-resume-triage`、`22-resume-report`、`23-resume-optimize`、`24-resume-generate`、`25-material-workshop`、`29-interview-training`、`34-self-assessment`、`46-resume-decision-workspace`

- 合计状态数 **155**（另有 1 页未知：`46-resume-decision-workspace`）
- 去重门禁 **15** 条
- 风险页 **8/8**：
  - `21-resume-triage` —— 门禁7、状态50
  - `22-resume-report` —— 门禁5
  - `23-resume-optimize` —— 门禁7、打印交接
  - `24-resume-generate` —— 门禁8、状态33、打印交接
  - `25-material-workshop` —— 门禁7、打印交接
  - `29-interview-training` —— 门禁9、状态34、打印交接
  - `34-self-assessment` —— >800行(808)、门禁4、打印交接
  - `46-resume-decision-workspace` —— 门禁11、打印交接

<details><summary>本批命中的门禁清单</summary>

- `apps/kiosk/scripts/verify-ai-artifact-print-url-contract.mjs`
- `apps/kiosk/scripts/verify-ai-down-fallbacks.mjs`
- `apps/kiosk/scripts/verify-fusion-w3.mjs`
- `apps/kiosk/scripts/verify-job-fit-m1-5-ui.mjs`
- `apps/kiosk/scripts/verify-job-material-library-ui.mjs`
- `apps/kiosk/scripts/verify-kiosk-frontend-debt.mjs`
- `apps/kiosk/scripts/verify-kiosk-runtime-error-boundary.mjs`
- `apps/kiosk/scripts/verify-lightflow-k2a-career.mjs`
- `apps/kiosk/scripts/verify-lightflow-k2b-ai-resume.mjs`
- `apps/kiosk/scripts/verify-lightflow-k2c-interview.mjs`
- `apps/kiosk/scripts/verify-mic-capability-truth.mjs`
- `apps/kiosk/scripts/verify-profile-commercial-first-batch.mjs`
- `apps/kiosk/scripts/verify-profile-documents-inkpaper.mjs`
- `apps/kiosk/scripts/verify-resume-diagnosis-flow-ui.mjs`
- `apps/kiosk/scripts/verify-resume-phone-upload-ui.mjs`

</details>

### B3 我的账号（10 页）

成员：`03-login-gate`、`04-session-guard`、`30-my-profile`、`31-benefits`、`35-notifications`、`38-member-assets`、`39-member-records`、`40-member-feedback`、`41-member-privacy`、`51-phone-relay`

- 合计状态数 **140**（另有 1 页未知：`51-phone-relay`）
- 去重门禁 **27** 条
- 风险页 **9/10**：
  - `03-login-gate` —— 门禁10
  - `30-my-profile` —— 门禁9、状态29、打印交接
  - `31-benefits` —— 门禁5、状态16
  - `35-notifications` —— 门禁6
  - `38-member-assets` —— 门禁11、打印交接
  - `39-member-records` —— 门禁11、状态32
  - `40-member-feedback` —— 门禁4
  - `41-member-privacy` —— 门禁4
  - `51-phone-relay` —— 门禁6

<details><summary>本批命中的门禁清单</summary>

- `apps/kiosk/scripts/verify-ai-artifact-print-url-contract.mjs`
- `apps/kiosk/scripts/verify-data-request-ui.mjs`
- `apps/kiosk/scripts/verify-file-retention-ui.mjs`
- `apps/kiosk/scripts/verify-fusion-shell.mjs`
- `apps/kiosk/scripts/verify-fusion-w5.mjs`
- `apps/kiosk/scripts/verify-fusion-w6.mjs`
- `apps/kiosk/scripts/verify-job-ai-history-privacy-ui.mjs`
- `apps/kiosk/scripts/verify-job-fit-m1-5-ui.mjs`
- `apps/kiosk/scripts/verify-job-material-library-ui.mjs`
- `apps/kiosk/scripts/verify-kiosk-frontend-debt.mjs`
- `apps/kiosk/scripts/verify-lightflow-k1-public-entry.mjs`
- `apps/kiosk/scripts/verify-lightflow-profile-entry.mjs`
- `apps/kiosk/scripts/verify-member-login-dialog.mjs`
- `apps/kiosk/scripts/verify-member-print-orders-ui.mjs`
- `apps/kiosk/scripts/verify-member-session-closure.mjs`
- `apps/kiosk/scripts/verify-profile-activity-inkpaper.mjs`
- `apps/kiosk/scripts/verify-profile-ai-records-inkpaper.mjs`
- `apps/kiosk/scripts/verify-profile-commercial-first-batch.mjs`
- `apps/kiosk/scripts/verify-profile-documents-inkpaper.mjs`
- `apps/kiosk/scripts/verify-profile-feedback-inkpaper.mjs`
- `apps/kiosk/scripts/verify-profile-inkpaper-home.mjs`
- `apps/kiosk/scripts/verify-profile-print-orders-inkpaper.mjs`
- `apps/kiosk/scripts/verify-profile-print-orders-login-smoke.mjs`
- `apps/kiosk/scripts/verify-profile-resumes-notifications-inkpaper.mjs`
- `apps/kiosk/scripts/verify-qr-login-ui.mjs`
- `apps/kiosk/scripts/verify-resume-phone-upload-ui.mjs`
- `apps/kiosk/scripts/verify-user-center-wave0.mjs`

</details>

### B4 岗位招聘会（8 页）

成员：`26-browse-list`、`27-browse-detail`、`28-jobfair-enhanced`、`42-offline-agency-directory`、`43-company-directory`、`44-fair-company-detail`、`45-online-platform-directory`、`49-campus-workspace`

- 合计状态数 **97**（另有 1 页未知：`49-campus-workspace`）
- 去重门禁 **15** 条
- 风险页 **6/8**：
  - `26-browse-list` —— 门禁4、状态15
  - `27-browse-detail` —— 门禁5、状态18、打印交接
  - `28-jobfair-enhanced` —— 门禁12、状态33、打印交接
  - `42-offline-agency-directory` —— 门禁3、打印交接
  - `44-fair-company-detail` —— 门禁4、打印交接
  - `49-campus-workspace` —— 门禁4

<details><summary>本批命中的门禁清单</summary>

- `apps/kiosk/scripts/verify-ai-artifact-print-url-contract.mjs`
- `apps/kiosk/scripts/verify-fusion-w4.mjs`
- `apps/kiosk/scripts/verify-job-ai-ui.mjs`
- `apps/kiosk/scripts/verify-job-info-ui.mjs`
- `apps/kiosk/scripts/verify-jobfair-checkin.mjs`
- `apps/kiosk/scripts/verify-jobfair-commercial-closure.mjs`
- `apps/kiosk/scripts/verify-jobfair-page-size.mjs`
- `apps/kiosk/scripts/verify-jobfair-ui.mjs`
- `apps/kiosk/scripts/verify-jobfairs-terminal-priority.mjs`
- `apps/kiosk/scripts/verify-kiosk-frontend-debt.mjs`
- `apps/kiosk/scripts/verify-kiosk-runtime-error-boundary.mjs`
- `apps/kiosk/scripts/verify-kiosk-visible-actions-truth.mjs`
- `apps/kiosk/scripts/verify-profile-commercial-first-batch.mjs`
- `apps/kiosk/scripts/verify-profile-documents-inkpaper.mjs`
- `services/api/scripts/verify-backend-p0-contracts.mjs`

</details>

### B5 首页 AI 其它（13 页）

成员：`00-standby`、`01-home`、`02-services`、`05-ai-cockpit`、`06-help`、`07-session-resume`、`08-legal`、`09-system-state`、`16-service-hubs`、`36-index`、`47-contract-review-workspace`、`48-policy-workspace`、`50-capability-zone-workspace`

- 合计状态数 **60**（另有 3 页未知：`47-contract-review-workspace`、`48-policy-workspace`、`50-capability-zone-workspace`）
- 去重门禁 **26** 条
- 风险页 **10/13**：
  - `00-standby` —— 门禁4
  - `01-home` —— 门禁9
  - `05-ai-cockpit` —— 门禁4
  - `06-help` —— 门禁3、打印交接
  - `07-session-resume` —— 打印交接
  - `08-legal` —— 门禁3
  - `16-service-hubs` —— 门禁3、状态20、打印交接
  - `47-contract-review-workspace` —— 门禁4、打印交接
  - `48-policy-workspace` —— 门禁3
  - `50-capability-zone-workspace` —— 门禁4

<details><summary>本批命中的门禁清单</summary>

- `apps/kiosk/scripts/verify-advisor-provider-gate.mjs`
- `apps/kiosk/scripts/verify-assistant-trtc-guard.mjs`
- `apps/kiosk/scripts/verify-contract-review-report-print.mjs`
- `apps/kiosk/scripts/verify-contract-review-session.mjs`
- `apps/kiosk/scripts/verify-device-status-honest.mjs`
- `apps/kiosk/scripts/verify-fusion-home.mjs`
- `apps/kiosk/scripts/verify-fusion-w3.mjs`
- `apps/kiosk/scripts/verify-fusion-w4.mjs`
- `apps/kiosk/scripts/verify-fusion-w5.mjs`
- `apps/kiosk/scripts/verify-fusion-w6.mjs`
- `apps/kiosk/scripts/verify-home-toolbox-ui.mjs`
- `apps/kiosk/scripts/verify-job-material-library-ui.mjs`
- `apps/kiosk/scripts/verify-kiosk-frontend-debt.mjs`
- `apps/kiosk/scripts/verify-kiosk-visible-actions-truth.mjs`
- `apps/kiosk/scripts/verify-kiosk-visual-unity.mjs`
- `apps/kiosk/scripts/verify-legal-retention-copy.mjs`
- `apps/kiosk/scripts/verify-lightflow-k1-public-entry.mjs`
- `apps/kiosk/scripts/verify-lightflow-k2a-ai-career.mjs`
- `apps/kiosk/scripts/verify-member-login-dialog.mjs`
- `apps/kiosk/scripts/verify-member-session-closure.mjs`
- `apps/kiosk/scripts/verify-policy-eligibility-ui.mjs`
- `apps/kiosk/scripts/verify-profile-documents-inkpaper.mjs`
- `apps/kiosk/scripts/verify-renshi-policy-ui.mjs`
- `apps/kiosk/scripts/verify-screensaver-empty-shell.mjs`
- `apps/kiosk/scripts/verify-service-entry-readiness.mjs`
- `apps/kiosk/scripts/verify-smart-campus-ui.mjs`

</details>

## 三、开工前必读的坑

以下每条都是 2026-09-02 做第一页样板时实际踩到的，不是预防性提醒。

### 1. `.claude/launch.json` 里的 `kiosk` 指向主仓，不是本 worktree

`kiosk`（端口 5273）与 `kiosk-uplift`（5278）的 `runtimeArgs` 里写死的是主仓绝对路径
`/Users/wanglei/AI求职打印服务终端/apps/kiosk`。**在 worktree 里改的代码不会被那个 server 加载**，
截出来的是主仓旧页面，而页面看上去"能打开"，所以这个错误不会自己暴露。

本 worktree 要用：

| 配置名 | 端口 | 指向 |
|---|---|---|
| `kiosk-worktree` | 5279 | 本 worktree 的 `apps/kiosk` |
| `api-worktree` | 3010 | 本 worktree 的 `services/api` |

### 2. 新建 worktree 缺两个 env 文件，缺后者 API 直接 FATAL

`apps/kiosk/.env.local` 与 `services/api/.env` **不入库**（`.env.example` 才入库）。
缺 `services/api/.env` 时 API 启动即 FATAL：

```
TERMINAL_ADMIN_SECRET is required
```

而 Kiosk 页面的表现不是"接口报错"，是**卡在会话清除态**——看起来像页面写坏了。

本 worktree 这两个文件已于 2026-09-02 补齐；**下次另开 worktree 会再缺一次**。

### 3. `KioskPrivacyGuard` 的隐私边界残留会让整个 origin 永久遮罩

`apps/kiosk/src/auth/KioskPrivacyGuard.tsx` 把隐私边界同时写进**四个**地方：

```
sessionStorage  ai-job-print:kiosk-privacy-boundary:v1
localStorage    ai-job-print:kiosk-privacy-boundary-fallback:v1
cookie          ai_job_print_kiosk_privacy_boundary_v1
history.state   __kioskPrivacyBoundary
```

四路冗余是设计意图（本地清场不能依赖 sessionStorage 可写），代价是**一旦留下残留，
该 origin 上任何页面都被遮罩并重载回首页，而且清不掉就永远出不来**。

截图/验收**一律用全新浏览器 profile**，不要试图在已污染的 profile 上"清一下再来"。

### 4. 截图用 `scripts/dev/shot-route.sh`，它已经处理了上面三条

```bash
scripts/dev/shot-route.sh /print/pickup-claim /tmp/shot.png 5279
```

参数：`<路由> [输出路径=/tmp/kiosk-shot.png] [端口=5279]`。它做了：
用 `kiosk-worktree` 的 5279 端口、每次 `mktemp -d` 全新 profile、
`--virtual-time-budget=8000` 等 SPA 渲染完再截、外层 `timeout 30` 兜住
（Chrome headless 截完不会自己退出）、`--window-size=1080,1920 --force-device-scale-factor=1`。

**不要用 Firefox 的 `--screenshot`**：它不等 SPA 渲染，截出来是空白页。

### 5. 新页面只 `import` 一个样式文件

```ts
import '../../styles/qingxu/index.css'   // 或走 components/qingxu/QxPageFrame
```

`apps/kiosk/src/styles/qingxu/index.css` 是青序流光的唯一入口（它再 `@import` tokens / shell / primitives 三份）。

**不要再引** `print-prototype.css` 或 `warm-professional-override.css` —— 那两套是旧的暖褐配色，
混用必然打架，V6"只迁移了一半所以效果不好"就是这么来的。

> ⚠️ **但要知道一件事**：`warm-professional-override.css` 目前仍被
> `apps/kiosk/src/index.css:13` 全局 `@import`，且注释要求它"保持为最后一个 CSS import"。
> 也就是说旧配色**现在仍然全局生效**，不是"只要你不引就没有"。
> 迁移期这层全局覆盖何时下线，是需要单独决策的事项，不要在做单页时顺手删它 ——
> 那会同时影响还没迁移的 50 页。

### 6. 每页开工前的三条命令

```bash
node scripts/project-graph-query.mjs route  <本页路由>      # 组件/文件/端点/门禁一次看全
node scripts/project-graph-query.mjs file   <实现文件路径>  # 改它会红哪条门禁
node scripts/project-graph-query.mjs endpoint <端点路径>    # 端点的实现与数据模型
```

图谱是 `node scripts/generate-project-graph.mjs` 从源码算出来的产物。
**图谱和代码对不上时以代码为准**，并且那是 `scripts/project-graph/` 的 bug ——
不要手改 `docs/graph/` 里的产物，下次生成会被直接覆盖。

---

## 四、调查中发现的异常（比台账本身更重要）

### A1 —— 10 张原型的 sidecar JS/CSS 不在工作区，这些页现在打不开

`42`–`51` 共 10 张原型把全部内容交给外部脚本渲染，HTML 里只有一个空的 `#body-root`。
被引用但**在整个 worktree 里 `find` 不到**的文件共 14 个：

| 缺失文件 | 被哪些原型引用 |
|---|---|
| `directory-workspaces.js` / `.css` | `42-offline-agency-directory`、`43-company-directory`、`44-fair-company-detail`、`45-online-platform-directory` |
| `resume-decision-workspace.js` / `.css` | `46-resume-decision-workspace` |
| `contract-review-workspace.js` / `.css` | `47-contract-review-workspace` |
| `policy-campus-workspaces.js` / `.css` | `48-policy-workspace`、`49-campus-workspace`、`50-capability-zone-workspace` |
| `policy-workspace.js` | `48-policy-workspace` |
| `campus-workspace.js` | `49-campus-workspace` |
| `capability-zone-workspace.js` | `50-capability-zone-workspace` |
| `phone-relay.js` / `.css` | `51-phone-relay` |

**不是被 gitignore 挡住的**：`docs/design/kiosk-redesign-2026-08/.gitignore` 只排除
`kimi-full-coverage-v2/evidence/*`、`review-2026-08-23/`、`assets/shot-*`、`assets/test-*`；
根 `.gitignore` 里也没有能命中它们的规则。这 10 个 HTML 的体积（4–13 KB）也印证了它们只是壳。

**影响**：这 10 页（占 51 页的 20%，覆盖 22 条运行时路由）**现在没有可看的视觉真值**，
也无法截图对照。这些页的"状态数"列因此全部是 **未知** 或"仅头注释、无法二次核对"。

**开工前必须先解决**，否则 B2 的 `46`、B4 的 `42`–`45` / `49`、B5 的 `47` / `48` / `50`、
B3 的 `51` 都没有施工依据。这不是我能自行修的（属 `docs/design/` 只读区）。

### A2 —— `02-services.html` 没有对应的运行时路由

`02-services`（"全部服务 / 8 大功能域"）：无 `route:` 头注释、**不在 COVERAGE-MATRIX 的
106 条台账里**、被 `01-home` 的"更多服务"按钮和 `16-service-hubs` 的"全部服务"入口引用时，
`data-route` 标的都是 `/`（首页），而运行时也**没有** `/services` 这条路由。

所以这一页要么是"首页的一个态"，要么是一条**尚未注册的新路由**。
开工前需要产品负责人裁一刀，否则无法定"迁到哪里"。

### A3 —— 两组原型抢同一条路由

| 路由 | 宿主 A | 宿主 B | 差别 |
|---|---|---|---|
| `/print/pickup-claim` | `11-arrival-code`（8 态，头注释详尽，自称冻结页，码制/提交规则逐条对齐 `PrintPickupClaimPage.tsx`） | `33-pickup-code`（无头注释、无状态注册表、不在台账内，但有 `data-testid="pickup-keyboard"` 虚拟数字键盘） | 运行时最近一次提交 `23464350f` 是"取件码页接入虚拟数字键盘"，即键盘来自 33；但 11 才是台账认的宿主 |
| `/print/cashier` | `32-cashier`（23 态，状态映射逐条对齐 `cashierStatus.ts`） | `37-pay-states`（6 态，**头注释自己写明**"历史六态版式页，不是收银台真值页"） | 37 已自我降级，但仍占一个页号 |

`37` 的归属清楚（历史页）。`11` vs `33` **需要裁决**：迁移时是以 11 为准再把 33 的键盘并进去，
还是反过来。两张都算进 51 页，但它们只对应 1 条路由。

### A4 —— 4 条真实运行时路由在 51 页里没有对应原型

51 页全部迁完之后，下列路由**仍然没有新稿视觉真值**：

| 路由 | 实现文件 | 行数 |
|---|---|---|
| `/ai/plan` | `apps/kiosk/src/pages/ai-plan/AiPlanPage.tsx` | 373 |
| `/resume/export` | `apps/kiosk/src/pages/resume/ResumeExportPage.tsx` | 108 |
| `/campus/freshman-insights` | `apps/kiosk/src/pages/placeholders/FreshmanInsightsPage.tsx` | 20 |
| `/smart-campus/freshman-insights` | `apps/kiosk/src/pages/smart-campus/SmartCampusGuard.tsx` | 50 |

（另有 3 条纯重定向 `/print/scan-feature`、`/resume`、`/resume/upload` 无页面文件，不需要迁移。）

`/ai/plan` 373 行是**真页面**，不是占位。它在 COVERAGE-MATRIX 里编号 100 但标为"无宿主"。

反向核对：原型声明的路由**全部**在运行时已注册，`原型有 / 运行时无` = **0 条**
（与 `docs/delivery/kiosk-redesign-r1/evidence/EV-002-route-coverage.txt` 的结论一致）。

### A5 —— 交付证据 EV-011 的状态计数已经过期

`docs/delivery/kiosk-redesign-r1/evidence/EV-011-ui-state-coverage.txt`（revision `23464350f`）写：

> 51 个宿主页承载 126 个 `?state=` 状态 …… 30-my-profile 单页即有 27 个状态（profile 5 + settings 22）

**两处都对不上当前文件**：
- `30-my-profile.html` 的 profile 组现在是 **7** 态（`ready | printing | member | signed-out | loading | empty | error`），不是 5。该文件 mtime 是 2026-09-02 20:19，晚于 EV-011。
- 全量 126 也偏低：仅 `20-sign-stamp`（63）+ `21-resume-triage`（50）+ `12-file-source`（38）三页就已经 151 态。
  本台账逐页统计的可数状态合计为 **686**（另有 6 页因 A1 无法计数）。

EV-011 的判定 `G1-03 PASS` 建立在这个数上，**下次引用前需要重算**。

### A6 —— 「实现文件行数」严重低估工作量，>800 行只筛出 1 页

按 CLAUDE.md §8 的 800 行阈值，51 页里只有 **1** 页命中：
`34-self-assessment` → `SelfAssessmentFlow.tsx` **808 行**（一个文件承载 4 条路由）。

但这个阈值筛不出真正的重页，因为**入口文件薄不代表页面小**：

| 路由 | 入口文件行数 | 独占闭包 |
|---|---|---|
| `/renshi` | 167 | 13 文件 / **1803** 行 |
| `/` | 71 | 7 文件 / **860** 行 |
| `/profile` | 184 | 8 文件 / **678** 行 |
| `/me/feedback` | 255 | 6 文件 / **787** 行 |

同时有 4 页的入口文件已逼近 800：`/print/upload` 767、`/print/confirm` 754、
`/print/progress` 746、`/print/preview` 713 —— 它们在 B1，且都是硬件主链。
**这 4 页迁移时如果按"在原文件上重写"做，必然当场越过 800 行硬上限**，
必须在开工计划里先写拆分方案。

建议排期看**独占闭包行数**那一列，不看入口文件行数。

### A7 —— 页号 17 不存在

`docs/design/kiosk-redesign-2026-08/` 的编号是 `00`–`51` 但缺 `17`，共 51 个文件。
不是漏读，是编号本身跳号。

### A8 —— `36-index.html` 不是产品页

它是 51 页的设计总览索引（"设计总览 · 职易达"），不对应任何运行时路由，
迁移时应从 51 页里剔除。**扣掉它和归属未决的 `02-services` 之后，真正要迁的是 49 页。**

---

## 五、本台账未做的事

- **未做视觉比对**：没有逐页截运行时与原型的对照图。本台账只回答"碰到什么"，不回答"差多少"。
- **未验证端点真实可用**：`endpoints` 列是 import 可达性上界，不代表页面真调这些接口，也不代表接口在本地跑得起来。
- **未确认批次划分**：五个批次的**页数**（12/8/10/8/13）来自产品负责人，**成员**是我按批次名推的。
  以下几处是判断，需要确认：
  - `29-interview-training`（面试）划进 B2 简历材料
  - `03-login-gate` / `04-session-guard` / `51-phone-relay`（身份与会话）划进 B3 我的账号
  - `49-campus-workspace`（校园招聘）划进 B4 岗位招聘会
  - `47-contract-review-workspace` / `48-policy-workspace` / `50-capability-zone-workspace` 划进 B5
- **未跑任何 verify / lint / build**：本任务是只读调查。

---

## 附录 · 逐页门禁清单

改这一页的实现文件会让下列 verify 门禁重跑。跑单条：`pnpm --filter @ai-job-print/kiosk verify:<脚本名>`；
脚本名与 CI 归属用 `node scripts/project-graph-query.mjs file <路径>` 查（它会一并打印 `pnpm --filter` 命令行）。

多路由页取并集，不区分是哪条路由带进来的 —— 迁移是整页做的，逐条拆开没有意义。

### `10-print-hub.html` —— 6 条

- `apps/kiosk/scripts/verify-fusion-w2-print-scan.mjs`
- `apps/kiosk/scripts/verify-kiosk-feedback-entry.mjs`
- `apps/kiosk/scripts/verify-p39-print-hub-fidelity.mjs`
- `apps/kiosk/scripts/verify-profile-commercial-first-batch.mjs`
- `apps/kiosk/scripts/verify-profile-documents-inkpaper.mjs`
- `apps/kiosk/scripts/verify-service-entry-readiness.mjs`

### `11-arrival-code.html` —— 3 条

- `apps/kiosk/scripts/verify-fusion-w2-print-scan.mjs`
- `apps/kiosk/scripts/verify-scan-input-safety.mjs`
- `services/api/scripts/verify-backend-p0-contracts.mjs`

### `12-file-source.html` —— 5 条

- `apps/kiosk/scripts/verify-file-display-truth.mjs`
- `apps/kiosk/scripts/verify-fusion-w2-print-scan.mjs`
- `apps/kiosk/scripts/verify-print-entry-source-split.mjs`
- `apps/kiosk/scripts/verify-print-parameter-capability.mjs`
- `apps/kiosk/scripts/verify-service-entry-readiness.mjs`

### `13-print-desk.html` —— 8 条

- `apps/kiosk/scripts/verify-device-status-honest.mjs`
- `apps/kiosk/scripts/verify-file-display-truth.mjs`
- `apps/kiosk/scripts/verify-fusion-w2-print-scan.mjs`
- `apps/kiosk/scripts/verify-legal-retention-copy.mjs`
- `apps/kiosk/scripts/verify-price-single-source.mjs`
- `apps/kiosk/scripts/verify-print-confirm-honest.mjs`
- `apps/kiosk/scripts/verify-print-entry-source-split.mjs`
- `apps/kiosk/scripts/verify-print-parameter-capability.mjs`

### `14-print-confirm.html` —— 8 条

- `apps/kiosk/scripts/verify-contract-review-report-print.mjs`
- `apps/kiosk/scripts/verify-fusion-w2-print-scan.mjs`
- `apps/kiosk/scripts/verify-legal-retention-copy.mjs`
- `apps/kiosk/scripts/verify-price-single-source.mjs`
- `apps/kiosk/scripts/verify-print-confirm-honest.mjs`
- `apps/kiosk/scripts/verify-print-entry-source-split.mjs`
- `apps/kiosk/scripts/verify-print-parameter-capability.mjs`
- `apps/kiosk/scripts/verify-profile-documents-inkpaper.mjs`

### `15-print-fulfill.html` —— 8 条

- `apps/kiosk/scripts/verify-fusion-w2-print-scan.mjs`
- `apps/kiosk/scripts/verify-kiosk-feedback-entry.mjs`
- `apps/kiosk/scripts/verify-print-confirm-honest.mjs`
- `apps/kiosk/scripts/verify-print-done-truth.mjs`
- `apps/kiosk/scripts/verify-print-entry-source-split.mjs`
- `apps/kiosk/scripts/verify-print-parameter-capability.mjs`
- `apps/kiosk/scripts/verify-profile-commercial-first-batch.mjs`
- `apps/kiosk/scripts/verify-profile-documents-inkpaper.mjs`

### `18-scan-workbench.html` —— 3 条

- `apps/kiosk/scripts/verify-fusion-w2-print-scan.mjs`
- `apps/kiosk/scripts/verify-profile-documents-inkpaper.mjs`
- `apps/kiosk/scripts/verify-scan-session-truth.mjs`

### `19-img2pdf.html` —— 2 条

- `apps/kiosk/scripts/verify-fusion-w2-print-scan.mjs`
- `apps/kiosk/scripts/verify-profile-documents-inkpaper.mjs`

### `20-sign-stamp.html` —— 3 条

- `apps/kiosk/scripts/verify-fusion-w2-print-scan.mjs`
- `apps/kiosk/scripts/verify-profile-commercial-first-batch.mjs`
- `apps/kiosk/scripts/verify-profile-documents-inkpaper.mjs`

### `32-cashier.html` —— 7 条

- `apps/kiosk/scripts/verify-fusion-w2-print-scan.mjs`
- `apps/kiosk/scripts/verify-kiosk-feedback-entry.mjs`
- `apps/kiosk/scripts/verify-print-confirm-honest.mjs`
- `apps/kiosk/scripts/verify-print-parameter-capability.mjs`
- `apps/kiosk/scripts/verify-profile-commercial-first-batch.mjs`
- `apps/kiosk/scripts/verify-profile-documents-inkpaper.mjs`
- `apps/kiosk/scripts/verify-scan-input-safety.mjs`

### `33-pickup-code.html` —— 3 条

- `apps/kiosk/scripts/verify-fusion-w2-print-scan.mjs`
- `apps/kiosk/scripts/verify-scan-input-safety.mjs`
- `services/api/scripts/verify-backend-p0-contracts.mjs`

### `37-pay-states.html` —— 7 条

- `apps/kiosk/scripts/verify-fusion-w2-print-scan.mjs`
- `apps/kiosk/scripts/verify-kiosk-feedback-entry.mjs`
- `apps/kiosk/scripts/verify-print-confirm-honest.mjs`
- `apps/kiosk/scripts/verify-print-parameter-capability.mjs`
- `apps/kiosk/scripts/verify-profile-commercial-first-batch.mjs`
- `apps/kiosk/scripts/verify-profile-documents-inkpaper.mjs`
- `apps/kiosk/scripts/verify-scan-input-safety.mjs`

### `21-resume-triage.html` —— 7 条

- `apps/kiosk/scripts/verify-ai-down-fallbacks.mjs`
- `apps/kiosk/scripts/verify-fusion-w3.mjs`
- `apps/kiosk/scripts/verify-kiosk-runtime-error-boundary.mjs`
- `apps/kiosk/scripts/verify-lightflow-k2b-ai-resume.mjs`
- `apps/kiosk/scripts/verify-profile-documents-inkpaper.mjs`
- `apps/kiosk/scripts/verify-resume-diagnosis-flow-ui.mjs`
- `apps/kiosk/scripts/verify-resume-phone-upload-ui.mjs`

### `22-resume-report.html` —— 5 条

- `apps/kiosk/scripts/verify-ai-down-fallbacks.mjs`
- `apps/kiosk/scripts/verify-fusion-w3.mjs`
- `apps/kiosk/scripts/verify-kiosk-frontend-debt.mjs`
- `apps/kiosk/scripts/verify-lightflow-k2b-ai-resume.mjs`
- `apps/kiosk/scripts/verify-resume-diagnosis-flow-ui.mjs`

### `23-resume-optimize.html` —— 7 条

- `apps/kiosk/scripts/verify-ai-down-fallbacks.mjs`
- `apps/kiosk/scripts/verify-fusion-w3.mjs`
- `apps/kiosk/scripts/verify-kiosk-runtime-error-boundary.mjs`
- `apps/kiosk/scripts/verify-lightflow-k2b-ai-resume.mjs`
- `apps/kiosk/scripts/verify-profile-documents-inkpaper.mjs`
- `apps/kiosk/scripts/verify-resume-diagnosis-flow-ui.mjs`
- `apps/kiosk/scripts/verify-resume-phone-upload-ui.mjs`

### `24-resume-generate.html` —— 8 条

- `apps/kiosk/scripts/verify-ai-artifact-print-url-contract.mjs`
- `apps/kiosk/scripts/verify-ai-down-fallbacks.mjs`
- `apps/kiosk/scripts/verify-fusion-w3.mjs`
- `apps/kiosk/scripts/verify-kiosk-runtime-error-boundary.mjs`
- `apps/kiosk/scripts/verify-lightflow-k2b-ai-resume.mjs`
- `apps/kiosk/scripts/verify-profile-commercial-first-batch.mjs`
- `apps/kiosk/scripts/verify-profile-documents-inkpaper.mjs`
- `apps/kiosk/scripts/verify-resume-diagnosis-flow-ui.mjs`

### `25-material-workshop.html` —— 7 条

- `apps/kiosk/scripts/verify-ai-artifact-print-url-contract.mjs`
- `apps/kiosk/scripts/verify-fusion-w3.mjs`
- `apps/kiosk/scripts/verify-job-material-library-ui.mjs`
- `apps/kiosk/scripts/verify-kiosk-frontend-debt.mjs`
- `apps/kiosk/scripts/verify-lightflow-k2b-ai-resume.mjs`
- `apps/kiosk/scripts/verify-profile-commercial-first-batch.mjs`
- `apps/kiosk/scripts/verify-profile-documents-inkpaper.mjs`

### `29-interview-training.html` —— 9 条

- `apps/kiosk/scripts/verify-ai-artifact-print-url-contract.mjs`
- `apps/kiosk/scripts/verify-ai-down-fallbacks.mjs`
- `apps/kiosk/scripts/verify-fusion-w3.mjs`
- `apps/kiosk/scripts/verify-kiosk-frontend-debt.mjs`
- `apps/kiosk/scripts/verify-kiosk-runtime-error-boundary.mjs`
- `apps/kiosk/scripts/verify-lightflow-k2c-interview.mjs`
- `apps/kiosk/scripts/verify-mic-capability-truth.mjs`
- `apps/kiosk/scripts/verify-profile-commercial-first-batch.mjs`
- `apps/kiosk/scripts/verify-profile-documents-inkpaper.mjs`

### `34-self-assessment.html` —— 4 条

- `apps/kiosk/scripts/verify-ai-artifact-print-url-contract.mjs`
- `apps/kiosk/scripts/verify-kiosk-frontend-debt.mjs`
- `apps/kiosk/scripts/verify-profile-documents-inkpaper.mjs`
- `apps/kiosk/scripts/verify-resume-phone-upload-ui.mjs`

### `46-resume-decision-workspace.html` —— 11 条

- `apps/kiosk/scripts/verify-ai-artifact-print-url-contract.mjs`
- `apps/kiosk/scripts/verify-ai-down-fallbacks.mjs`
- `apps/kiosk/scripts/verify-fusion-w3.mjs`
- `apps/kiosk/scripts/verify-job-fit-m1-5-ui.mjs`
- `apps/kiosk/scripts/verify-job-material-library-ui.mjs`
- `apps/kiosk/scripts/verify-kiosk-frontend-debt.mjs`
- `apps/kiosk/scripts/verify-kiosk-runtime-error-boundary.mjs`
- `apps/kiosk/scripts/verify-lightflow-k2a-career.mjs`
- `apps/kiosk/scripts/verify-lightflow-k2b-ai-resume.mjs`
- `apps/kiosk/scripts/verify-profile-commercial-first-batch.mjs`
- `apps/kiosk/scripts/verify-profile-documents-inkpaper.mjs`

### `03-login-gate.html` —— 10 条

- `apps/kiosk/scripts/verify-fusion-w5.mjs`
- `apps/kiosk/scripts/verify-job-material-library-ui.mjs`
- `apps/kiosk/scripts/verify-kiosk-frontend-debt.mjs`
- `apps/kiosk/scripts/verify-lightflow-k1-public-entry.mjs`
- `apps/kiosk/scripts/verify-member-login-dialog.mjs`
- `apps/kiosk/scripts/verify-member-session-closure.mjs`
- `apps/kiosk/scripts/verify-profile-commercial-first-batch.mjs`
- `apps/kiosk/scripts/verify-profile-print-orders-login-smoke.mjs`
- `apps/kiosk/scripts/verify-qr-login-ui.mjs`
- `apps/kiosk/scripts/verify-user-center-wave0.mjs`

### `04-session-guard.html` —— 1 条

- `apps/kiosk/scripts/verify-fusion-w5.mjs`

### `30-my-profile.html` —— 9 条

- `apps/kiosk/scripts/verify-data-request-ui.mjs`
- `apps/kiosk/scripts/verify-fusion-w5.mjs`
- `apps/kiosk/scripts/verify-job-ai-history-privacy-ui.mjs`
- `apps/kiosk/scripts/verify-lightflow-profile-entry.mjs`
- `apps/kiosk/scripts/verify-member-session-closure.mjs`
- `apps/kiosk/scripts/verify-profile-commercial-first-batch.mjs`
- `apps/kiosk/scripts/verify-profile-feedback-inkpaper.mjs`
- `apps/kiosk/scripts/verify-profile-inkpaper-home.mjs`
- `apps/kiosk/scripts/verify-user-center-wave0.mjs`

### `31-benefits.html` —— 5 条

- `apps/kiosk/scripts/verify-fusion-w5.mjs`
- `apps/kiosk/scripts/verify-lightflow-profile-entry.mjs`
- `apps/kiosk/scripts/verify-profile-commercial-first-batch.mjs`
- `apps/kiosk/scripts/verify-profile-feedback-inkpaper.mjs`
- `apps/kiosk/scripts/verify-profile-inkpaper-home.mjs`

### `35-notifications.html` —— 6 条

- `apps/kiosk/scripts/verify-fusion-w5.mjs`
- `apps/kiosk/scripts/verify-lightflow-profile-entry.mjs`
- `apps/kiosk/scripts/verify-profile-commercial-first-batch.mjs`
- `apps/kiosk/scripts/verify-profile-feedback-inkpaper.mjs`
- `apps/kiosk/scripts/verify-profile-inkpaper-home.mjs`
- `apps/kiosk/scripts/verify-profile-resumes-notifications-inkpaper.mjs`

### `38-member-assets.html` —— 11 条

- `apps/kiosk/scripts/verify-ai-artifact-print-url-contract.mjs`
- `apps/kiosk/scripts/verify-file-retention-ui.mjs`
- `apps/kiosk/scripts/verify-fusion-w5.mjs`
- `apps/kiosk/scripts/verify-job-material-library-ui.mjs`
- `apps/kiosk/scripts/verify-lightflow-profile-entry.mjs`
- `apps/kiosk/scripts/verify-member-print-orders-ui.mjs`
- `apps/kiosk/scripts/verify-profile-commercial-first-batch.mjs`
- `apps/kiosk/scripts/verify-profile-documents-inkpaper.mjs`
- `apps/kiosk/scripts/verify-profile-inkpaper-home.mjs`
- `apps/kiosk/scripts/verify-profile-print-orders-inkpaper.mjs`
- `apps/kiosk/scripts/verify-profile-print-orders-login-smoke.mjs`

### `39-member-records.html` —— 11 条

- `apps/kiosk/scripts/verify-fusion-w5.mjs`
- `apps/kiosk/scripts/verify-job-ai-history-privacy-ui.mjs`
- `apps/kiosk/scripts/verify-job-fit-m1-5-ui.mjs`
- `apps/kiosk/scripts/verify-kiosk-frontend-debt.mjs`
- `apps/kiosk/scripts/verify-lightflow-profile-entry.mjs`
- `apps/kiosk/scripts/verify-profile-activity-inkpaper.mjs`
- `apps/kiosk/scripts/verify-profile-ai-records-inkpaper.mjs`
- `apps/kiosk/scripts/verify-profile-commercial-first-batch.mjs`
- `apps/kiosk/scripts/verify-profile-feedback-inkpaper.mjs`
- `apps/kiosk/scripts/verify-profile-inkpaper-home.mjs`
- `apps/kiosk/scripts/verify-profile-resumes-notifications-inkpaper.mjs`

### `40-member-feedback.html` —— 4 条

- `apps/kiosk/scripts/verify-fusion-w5.mjs`
- `apps/kiosk/scripts/verify-profile-commercial-first-batch.mjs`
- `apps/kiosk/scripts/verify-profile-feedback-inkpaper.mjs`
- `apps/kiosk/scripts/verify-profile-inkpaper-home.mjs`

### `41-member-privacy.html` —— 4 条

- `apps/kiosk/scripts/verify-data-request-ui.mjs`
- `apps/kiosk/scripts/verify-fusion-w5.mjs`
- `apps/kiosk/scripts/verify-lightflow-profile-entry.mjs`
- `apps/kiosk/scripts/verify-profile-inkpaper-home.mjs`

### `51-phone-relay.html` —— 6 条

- `apps/kiosk/scripts/verify-fusion-shell.mjs`
- `apps/kiosk/scripts/verify-fusion-w5.mjs`
- `apps/kiosk/scripts/verify-fusion-w6.mjs`
- `apps/kiosk/scripts/verify-lightflow-k1-public-entry.mjs`
- `apps/kiosk/scripts/verify-qr-login-ui.mjs`
- `apps/kiosk/scripts/verify-resume-phone-upload-ui.mjs`

### `26-browse-list.html` —— 4 条

- `apps/kiosk/scripts/verify-fusion-w4.mjs`
- `apps/kiosk/scripts/verify-job-ai-ui.mjs`
- `apps/kiosk/scripts/verify-job-info-ui.mjs`
- `apps/kiosk/scripts/verify-kiosk-runtime-error-boundary.mjs`

### `27-browse-detail.html` —— 5 条

- `apps/kiosk/scripts/verify-fusion-w4.mjs`
- `apps/kiosk/scripts/verify-job-ai-ui.mjs`
- `apps/kiosk/scripts/verify-job-info-ui.mjs`
- `apps/kiosk/scripts/verify-kiosk-frontend-debt.mjs`
- `apps/kiosk/scripts/verify-kiosk-runtime-error-boundary.mjs`

### `28-jobfair-enhanced.html` —— 12 条

- `apps/kiosk/scripts/verify-ai-artifact-print-url-contract.mjs`
- `apps/kiosk/scripts/verify-fusion-w4.mjs`
- `apps/kiosk/scripts/verify-jobfair-checkin.mjs`
- `apps/kiosk/scripts/verify-jobfair-commercial-closure.mjs`
- `apps/kiosk/scripts/verify-jobfair-page-size.mjs`
- `apps/kiosk/scripts/verify-jobfair-ui.mjs`
- `apps/kiosk/scripts/verify-jobfairs-terminal-priority.mjs`
- `apps/kiosk/scripts/verify-kiosk-frontend-debt.mjs`
- `apps/kiosk/scripts/verify-kiosk-runtime-error-boundary.mjs`
- `apps/kiosk/scripts/verify-kiosk-visible-actions-truth.mjs`
- `apps/kiosk/scripts/verify-profile-commercial-first-batch.mjs`
- `apps/kiosk/scripts/verify-profile-documents-inkpaper.mjs`

### `42-offline-agency-directory.html` —— 3 条

- `apps/kiosk/scripts/verify-fusion-w4.mjs`
- `apps/kiosk/scripts/verify-kiosk-visible-actions-truth.mjs`
- `services/api/scripts/verify-backend-p0-contracts.mjs`

### `43-company-directory.html` —— 2 条

- `apps/kiosk/scripts/verify-fusion-w4.mjs`
- `apps/kiosk/scripts/verify-kiosk-frontend-debt.mjs`

### `44-fair-company-detail.html` —— 4 条

- `apps/kiosk/scripts/verify-jobfair-commercial-closure.mjs`
- `apps/kiosk/scripts/verify-jobfair-page-size.mjs`
- `apps/kiosk/scripts/verify-jobfair-ui.mjs`
- `apps/kiosk/scripts/verify-kiosk-frontend-debt.mjs`

### `45-online-platform-directory.html` —— 无门禁断言

没有任何门禁断言这一页的实现文件。**这不代表可以随便改** —— typecheck / lint / build 仍然会看它。

### `49-campus-workspace.html` —— 4 条

- `apps/kiosk/scripts/verify-fusion-w4.mjs`
- `apps/kiosk/scripts/verify-jobfair-commercial-closure.mjs`
- `apps/kiosk/scripts/verify-jobfair-page-size.mjs`
- `apps/kiosk/scripts/verify-jobfair-ui.mjs`

### `00-standby.html` —— 4 条

- `apps/kiosk/scripts/verify-fusion-w5.mjs`
- `apps/kiosk/scripts/verify-job-material-library-ui.mjs`
- `apps/kiosk/scripts/verify-lightflow-k1-public-entry.mjs`
- `apps/kiosk/scripts/verify-screensaver-empty-shell.mjs`

### `01-home.html` —— 9 条

- `apps/kiosk/scripts/verify-device-status-honest.mjs`
- `apps/kiosk/scripts/verify-fusion-home.mjs`
- `apps/kiosk/scripts/verify-fusion-w4.mjs`
- `apps/kiosk/scripts/verify-fusion-w6.mjs`
- `apps/kiosk/scripts/verify-home-toolbox-ui.mjs`
- `apps/kiosk/scripts/verify-kiosk-visual-unity.mjs`
- `apps/kiosk/scripts/verify-member-login-dialog.mjs`
- `apps/kiosk/scripts/verify-service-entry-readiness.mjs`
- `apps/kiosk/scripts/verify-smart-campus-ui.mjs`

### `02-services.html` —— 无门禁断言

该页无对应运行时路由，无实现文件。

### `05-ai-cockpit.html` —— 4 条

- `apps/kiosk/scripts/verify-advisor-provider-gate.mjs`
- `apps/kiosk/scripts/verify-assistant-trtc-guard.mjs`
- `apps/kiosk/scripts/verify-fusion-w3.mjs`
- `apps/kiosk/scripts/verify-lightflow-k2a-ai-career.mjs`

### `06-help.html` —— 3 条

- `apps/kiosk/scripts/verify-fusion-w5.mjs`
- `apps/kiosk/scripts/verify-legal-retention-copy.mjs`
- `apps/kiosk/scripts/verify-lightflow-k1-public-entry.mjs`

### `07-session-resume.html` —— 1 条

- `apps/kiosk/scripts/verify-member-session-closure.mjs`

### `08-legal.html` —— 3 条

- `apps/kiosk/scripts/verify-fusion-w5.mjs`
- `apps/kiosk/scripts/verify-legal-retention-copy.mjs`
- `apps/kiosk/scripts/verify-lightflow-k1-public-entry.mjs`

### `09-system-state.html` —— 1 条

- `apps/kiosk/scripts/verify-fusion-w5.mjs`

### `16-service-hubs.html` —— 3 条

- `apps/kiosk/scripts/verify-kiosk-frontend-debt.mjs`
- `apps/kiosk/scripts/verify-kiosk-visible-actions-truth.mjs`
- `apps/kiosk/scripts/verify-service-entry-readiness.mjs`

### `36-index.html` —— 无门禁断言

该页无对应运行时路由，无实现文件。

### `47-contract-review-workspace.html` —— 4 条

- `apps/kiosk/scripts/verify-contract-review-report-print.mjs`
- `apps/kiosk/scripts/verify-contract-review-session.mjs`
- `apps/kiosk/scripts/verify-kiosk-visible-actions-truth.mjs`
- `apps/kiosk/scripts/verify-profile-documents-inkpaper.mjs`

### `48-policy-workspace.html` —— 3 条

- `apps/kiosk/scripts/verify-fusion-w4.mjs`
- `apps/kiosk/scripts/verify-policy-eligibility-ui.mjs`
- `apps/kiosk/scripts/verify-renshi-policy-ui.mjs`

### `50-capability-zone-workspace.html` —— 4 条

- `apps/kiosk/scripts/verify-fusion-w4.mjs`
- `apps/kiosk/scripts/verify-fusion-w5.mjs`
- `apps/kiosk/scripts/verify-home-toolbox-ui.mjs`
- `apps/kiosk/scripts/verify-smart-campus-ui.mjs`
