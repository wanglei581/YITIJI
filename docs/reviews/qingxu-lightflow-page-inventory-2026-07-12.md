# 青序 LightFlow 三端正式页面盘点（2026-07-12）

## 1. 证据与口径

- 基线：`origin/main=9d48322b`。
- 路由事实：
  - `apps/kiosk/src/routes/index.tsx`
  - `apps/admin/src/routes/index.tsx`
  - `apps/partner/src/routes/index.tsx`
- 盘点方法：对最新 worktree 建立结构索引，读取三个 `createBrowserRouter` 定义及其页面 import；没有把 API 路由、弹窗、Tab、抽屉或纯组件误计为独立页面。
- 页面数量：Kiosk 70、Admin 29、Partner 13，共 112 个真实页面路由组件。
- 兼容路由：Kiosk 2 个、Admin 3 个，共 5 个 `Navigate` 重定向，不作为独立视觉页面。
- 壳层：`KioskRoot`、`AdminLayoutWrapper`、`PartnerLayoutWrapper` 共 3 个，作为共享主题与导航承载层单独治理。

本盘点只证明最新代码中的路由与组件承载关系，不证明页面已经完成青序 LightFlow 迁移。

## 2. Kiosk：70 个页面组件

### K0 — UI-1 代表页

| 路由 | 组件 |
| --- | --- |
| `/` | `HomePage` |

### K1 — 公共入口、身份与独立全屏页

| 路由 | 组件 |
| --- | --- |
| `/login` | `LoginPage` |
| `/member/qr-login` | `MobileQrLoginPage` |
| `/upload/phone` | `PhoneUploadPage` |
| `/legal/:doc` | `LegalDocPage` |
| `/screensaver` | `ScreensaverPage` |
| `/help` | `HelpCenterPage` |

### K2 — AI 助手、简历与面试

| 路由 | 组件 |
| --- | --- |
| `/assistant` | `AssistantPage` |
| `/resume/job-fit` | `JobFitPage` |
| `/resume/career-plan` | `CareerPlanPage` |
| `/resume/source` | `ResumeSourcePage` |
| `/resume/generate` | `ResumeGeneratePage` |
| `/resume/generate/preview` | `ResumeGeneratePreviewPage` |
| `/resume/parse` | `ResumeParsePage` |
| `/resume/report` | `ResumeReportPage` |
| `/resume/optimize` | `ResumeOptimizePage` |
| `/resume/export` | `ResumeExportPage` |
| `/resume/templates` | `ResumeTemplateLibraryPage` |
| `/resume/materials` | `JobMaterialLibraryPage` |
| `/interview/setup` | `InterviewSetupPage` |
| `/interview/session` | `InterviewSessionPage` |
| `/interview/report` | `InterviewReportPage` |
| `/interview/tips` | `InterviewTipsPage` |
| `/interview/reports` | `InterviewReportsPage` |

兼容入口 `/resume` 与 `/resume/upload` 继续重定向 `/resume/source`，不得重新设计成二次选择页。

### K3 — 打印、扫描与文件处理

| 路由 | 组件 |
| --- | --- |
| `/print-scan` | `PrintScanHomePage` |
| `/print-scan/feature/:key` | `PrintScanFeatureInfoPage` |
| `/print-scan/convert` | `ConvertImagesPage` |
| `/print/upload` | `PrintUploadPage` |
| `/print/material-check` | `PrintMaterialCheckPage` |
| `/print/preview` | `PrintPreviewPage` |
| `/print/confirm` | `PrintConfirmPage` |
| `/print/cashier` | `PrintCashierPage` |
| `/print/progress` | `PrintProgressPage` |
| `/print/done` | `PrintDonePage` |
| `/scan/start` | `ScanStartPage` |
| `/scan/settings` | `ScanSettingsPage` |
| `/scan/progress` | `ScanProgressPage` |
| `/scan/result` | `ScanResultPage` |

该波次只能做视觉与 UX 状态编排；支付、打印任务状态、扫码器、USB、OCR 和 Terminal Agent 契约不得借机修改。

### K4 — 本人资产、活动与设置

| 路由 | 组件 |
| --- | --- |
| `/profile` | `ProfilePage` |
| `/me/resumes` | `MyResumesPage` |
| `/me/print-orders` | `MyPrintOrdersPage` |
| `/me/documents` | `MyDocumentsPage` |
| `/me/favorites` | `MyFavoritesPage` |
| `/me/ai-records` | `MyAiRecordsPage` |
| `/me/benefits` | `MyBenefitsPage` |
| `/me/activity` | `MyActivityPage` |
| `/me/notifications` | `MyNotificationsPage` |
| `/me/feedback` | `MyFeedbackPage` |
| `/me/settings` | `MySettingsPage` |
| `/activities` | `BenefitActivitiesPage` |
| `/activities/:id` | `BenefitActivityDetailPage` |

该波次与当前“我的页商用闭环第一批”任务存在文件和语义重叠。在该任务完成、迁移或明确废弃前，本波次禁止开工。

### K5 — 岗位、企业与招聘会

| 路由 | 组件 |
| --- | --- |
| `/jobs` | `JobsPage` |
| `/jobs/:id` | `JobDetailPage` |
| `/companies` | `CompaniesPage` |
| `/companies/:id` | `CompanyDetailPage` |
| `/job-fairs` | `JobFairsPage` |
| `/job-fairs/checkin` | `JobFairCheckinPage` |
| `/job-fairs/:id` | `JobFairDetailPage` |
| `/job-fairs/:id/companies` | `FairCompaniesPage` |
| `/job-fairs/:id/companies/:companyId` | `FairCompanyDetailPage` |
| `/job-fairs/:id/map` | `FairMapPage` |
| `/job-fairs/:id/materials` | `FairMaterialsPage` |
| `/job-fairs/:id/visit-plan` | `FairVisitPlanPage` |
| `/job-fairs/:id/stats` | `FairStatsPage` |

岗位与招聘会继续只作为第三方或官方来源入口；迁移不得引入平台投递、预约或候选人闭环。

### K6 — 政策、校园与终端配置能力

| 路由 | 组件 |
| --- | --- |
| `/renshi` | `RenshiPage` |
| `/campus` | `CampusPage` |
| `/smart-campus` | `SmartCampusHomePage` |
| `/smart-campus/welcome` | `SmartCampusWelcomePage` |
| `/smart-campus/freshman-insights` | `FreshmanInsightsPage` |
| `/smart-campus/service/:key` | `SmartCampusServicePage` |

## 3. Admin：29 个页面组件

### A0 — UI-1 代表页

| 路由 | 组件 |
| --- | --- |
| `/` | `DashboardPage` |

### A1 — 身份、权限、设备与异常处理

| 路由 | 组件 |
| --- | --- |
| `/login` | `LoginPage` |
| `/devices` | `DevicesPage` |
| `/alerts` | `AlertsPage` |
| `/permissions` | `PermissionsPage` |
| `/audit` | `AuditPage` |

`/terminals`、`/printers`、`/peripherals` 继续重定向 `/devices` 对应 Tab，不恢复为重复页面。

### A2 — 交易、文件与终端运营

| 路由 | 组件 |
| --- | --- |
| `/orders` | `OrdersPage` |
| `/print-scan` | `PrintScanOpsPage` |
| `/billing` | `BillingPage` |
| `/files` | `FilesPage` |
| `/job-materials` | `JobMaterialsPage` |
| `/screensaver` | `ScreensaverPage` |
| `/toolbox` | `ToolboxPage` |

### A3 — AI 配置、内容来源与机构治理

| 路由 | 组件 |
| --- | --- |
| `/ai-services` | `AiServicesPage` |
| `/ai-config` | `AiConfigPage` |
| `/job-sources` | `JobSourcesPage` |
| `/fair-sources` | `FairSourcesPage` |
| `/policy-sources` | `PolicySourcesPage` |
| `/fairs` | `FairsPage` |
| `/companies` | `CompaniesPage` |
| `/partners` | `PartnersPage` |
| `/import-batches` | `ImportBatchesPage` |
| `/sync-sources` | `SyncSourcesPage` |

### A4 — 会员、活动与智慧校园

| 路由 | 组件 |
| --- | --- |
| `/users` | `UsersPage` |
| `/benefit-activities` | `BenefitActivitiesPage` |
| `/member-benefits` | `MemberBenefitsPage` |
| `/member-feedback` | `MemberFeedbackPage` |
| `/member-notifications` | `MemberNotificationsPage` |
| `/smart-campus` | `SmartCampusPage` |

## 4. Partner：13 个页面组件

### P0 — UI-1 代表页

| 路由 | 组件 |
| --- | --- |
| `/jobs` | `JobsPage` |

### P1 — 身份、机构与账号

| 路由 | 组件 |
| --- | --- |
| `/login` | `LoginPage` |
| `/` | `DashboardPage` |
| `/profile` | `ProfilePage` |
| `/account` | `AccountPage` |

### P2 — 机构内容工作流

| 路由 | 组件 |
| --- | --- |
| `/companies` | `CompaniesPage` |
| `/fairs` | `FairsPage` |
| `/policy` | `PolicyPage` |
| `/smart-campus` | `SmartCampusPage` |

### P3 — 终端、统计与数据源

| 路由 | 组件 |
| --- | --- |
| `/terminals` | `TerminalsPage` |
| `/stats` | `StatsPage` |
| `/sources` | `SourcesPage` |
| `/sync-logs` | `SyncLogsPage` |

## 5. 文件规模风险

最新基线中以下路由承载文件已经达到或接近治理阈值，视觉迁移不得继续堆叠：

- `apps/kiosk/src/pages/print/PrintMaterialCheckPage.tsx`：891 行。
- `apps/admin/src/routes/partners/index.tsx`：817 行。
- `apps/kiosk/src/pages/home/HomePage.tsx`：807 行。
- `apps/admin/src/routes/screensaver/index.tsx`：772 行。
- `apps/kiosk/src/pages/print/PrintPreviewPage.tsx`：746 行。
- `apps/admin/src/routes/login/index.tsx`、`apps/partner/src/routes/login/index.tsx`：各 727 行。
- `apps/kiosk/src/pages/auth/LoginPage.tsx`：697 行。
- `apps/kiosk/src/pages/interview/InterviewSessionPage.tsx`：677 行。
- `apps/admin/src/routes/print-scan/index.tsx`：658 行。
- `apps/admin/src/routes/dashboard/index.tsx`：649 行。
- `apps/partner/src/routes/companies/index.tsx`：631 行。

超过 800 行的文件只能先做无行为拆分或收口；500–800 行文件的每波实施计划必须先声明是否拆分，不能在视觉换装中顺手增加业务职责。

## 6. 盘点结论

1. UI-0/UI-1 第一批仍以首页、Admin 工作台、Partner 岗位管理三个代表页为准。
2. UI-2 必须拆成 K1–K6、A1–A4、P1–P3 共 13 个独立业务波次；每波有单独计划、分支、文件预算和验收。
3. UI-3 统一补齐跨页面边界状态、长内容、权限、离线、部分失败和返回焦点。
4. UI-4 才允许基于无引用证据退出旧主题；不得在代表页阶段全仓删除 InkPaper / Fusion Youth。
5. 112 个页面必须全部归入上述波次，但不要求同时开工或同时合并。
