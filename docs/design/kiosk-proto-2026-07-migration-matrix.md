# Kiosk 75 屏原型 ↔ 生产实现迁移映射矩阵

> 基准原型目录:`docs/design/kiosk-proto-2026-07/`（75 屏 · 2026-07 定稿，源自 worktree `resume-optimize-wave2-plan`）
> 生产分支/worktree:`kiosk-proto-v1-home-20260720`(`apps/kiosk/src/`)
> 生成日期:2026-07-20 · 本文档为只读调研产物,不改任何源码
>
> 路径约定:下表「页面文件路径」「验收脚本」均相对 `apps/kiosk/`。数据来源标注 `import` 到的 service/hook 简名;找不到明确对应处标「待核实」。

---

## 一、75 屏映射矩阵(按原型编号 01→75)

| 编号 | 原型文件 | 屏名 | 业务线分组 | 生产路由 path | React 组件 | 页面文件路径 | 数据来源(service/hook/API) | 主要操作 | 页面状态 | 验收脚本(scripts/) |
|---|---|---|---|---|---|---|---|---|---|---|
| 01 | 01-home.html | 首页 | 首页登录系统 | `/` (index) | HomePage | src/pages/home/HomePage.tsx | useAuth / useHomeDeviceStatus / useSmartCampusConfig / useToolboxConfig / terminalConfig(getTerminalId) / MemberLoginDialog / ContinuePanel(getMyPrintOrders+getMyResumes) | 服务分组跳转、分组标题→聚合页(titleTo)、扫码登录、设备状态、继续办理(条件)、百宝箱/智慧校园动态专区(prototype-v1 按原型 1:1，不渲染统计) | 游客态 / 登录态 / 离线(设备状态) / 动态专区(有/无) / 继续办理(登录且有可恢复任务) | verify-home-prototype-v1 / verify-home-toolbox-ui / verify-smart-campus-ui |
| 02 | 02-print-hub.html | 打印扫描中心 | 打印扫描 | `/print-scan` | PrintScanHomePage | src/pages/print-scan/PrintScanHomePage.tsx | printScanCapabilities.getConfiguredCapabilities | 七能力卡跳转、记录入口 | loading / 能力开关(后台可配) | verify-profile-documents-inkpaper(间接) |
| 03 | 03-print-settings.html | 打印参数 | 打印扫描 | `/print/params` | PrintParamsPage | src/pages/print/PrintParamsPage.tsx | fetch(价格配置) / sessionStorage 流转 | 份数/色彩/双面/缩放、费用预估 | loading / error(价格加载) | verify-price-single-source(间接) |
| 04 | 04-print-progress.html | 打印进度 | 打印扫描 | `/print/progress` | PrintProgressPage | src/pages/print/PrintProgressPage.tsx | printJobsApi.getPrintJobStatus / API_MODE | 轮询状态、异常指引 | loading / error / 轮询态 | verify-print-confirm-honest |
| 05 | 05-resume-source.html | 简历来源选择 | AI简历 | `/resume/source` | ResumeSourcePage | src/pages/resume/ResumeSourcePage.tsx | api.kioskUploadFile / useAuth | 上传/扫码传/纸质扫描 OCR | loading / error / 登录态 | verify-resume-diagnosis-flow-ui / verify-resume-phone-upload-ui |
| 06 | 06-resume-diagnosis.html | AI诊断报告 | AI简历 | `/resume/report` | ResumeReportPage | src/pages/resume/ResumeReportPage.tsx | api.getResumeRecord / API_MODE / useAuth | 查看评分维度、去优化 | loading / error / 登录态 | verify-resume-diagnosis-flow-ui |
| 07 | 07-resume-optimize.html | 优化对比 | AI简历 | `/resume/optimize` | ResumeOptimizePage | src/pages/resume/ResumeOptimizePage.tsx | api.getResumeOptimize / exportGeneratedResume / adjustResumeLayoutDraft / jobMaterials.getResumeTemplates / useResumeLayout / useAuth | 原文/建议对比、排版调整、导出 | loading / error / 登录态 | verify-resume-diagnosis-flow-ui / verify-profile-resumes-notifications-inkpaper |
| 08 | 08-jobs-list.html | 岗位列表 | 岗位企业 | `/jobs` | JobsPage | src/pages/jobs/JobsPage.tsx | api.getJobs / ApiHttpError / useAuth | 类型/来源筛选、线上线下双轨 | loading / empty / error | verify-job-info-ui / verify-job-ai-ui |
| 09 | 09-job-detail.html | 岗位详情(线上平台) | 岗位企业 | `/jobs/:id` | JobDetailPage | src/pages/jobs/JobDetailPage.tsx | api.getJobById / activity.recordBrowse+recordExternalJump / screensaver.getTerminalId / useAuth | 扫码投递、去来源平台、浏览/跳转埋点 | loading / error / 登录态 | verify-job-info-ui / verify-job-ai-ui |
| 10 | 10-fairs-list.html | 招聘会列表 | 招聘会校园 | `/job-fairs` | JobFairsPage | src/pages/job-fairs/JobFairsPage.tsx | api.getJobFairs+getTerminalId / activity.recordExternalJump / useAuth | 场次浏览、状态标签、去预约 | loading / empty / error | verify-jobfair-ui / verify-jobfairs-terminal-priority / verify-jobfair-page-size |
| 11 | 11-fair-detail.html | 招聘会详情 | 招聘会校园 | `/job-fairs/:id` | JobFairDetailPage | src/pages/job-fairs/JobFairDetailPage.tsx | api.getJobFairById+getFairCompanies+getFairStats+getFairZones / activity.record* / useAuth | 展位导览、扫码预约 | loading / empty / error | verify-jobfair-ui / verify-jobfair-page-size |
| 12 | 12-policy.html | 政策服务 | 面试助手政策 | `/renshi` | RenshiPage | src/pages/renshi/RenshiPage.tsx | policies.getPublishedPolicies / activity.record* / useAuth | 三类政策浏览、材料清单打印 | loading / empty / error | verify-renshi-policy-ui |
| 13 | 13-assistant.html | AI助手·小青 | 面试助手政策 | `/assistant` | AssistantPage | src/pages/assistant/AssistantPage.tsx | api.chatWithAssistant / useInkRipple | 咨询主题、对话、白名单动作 | loading / error(对话) | verify-assistant-trtc-guard |
| 14 | 14-profile.html | 我的(主页) | 我的 | `/profile` | ProfilePage | src/pages/profile/ProfilePage.tsx | useAuth / ProfileEntrySection / ProfileHeader / ProfileSessionRecords | 五分区入口、概览、本次记录 | loading / 未登录引导 / 登录态 | verify-profile-inkpaper-home / verify-lightflow-profile-entry |
| 15 | 15-login.html | 扫码登录 | 首页登录系统 | `/login` | LoginPage | src/pages/auth/LoginPage.tsx | useAuth / useIdleTimer / MemberLoginDialog / MemberPhoneLoginPane | 微信扫码、手机号登录、游客模式 | loading / error / 登录态 / 空闲超时 | verify-member-login-dialog / verify-member-session-closure / verify-qr-login-ui |
| 16 | 16-me-resumes.html | 我的简历 | 我的 | `/me/resumes` | MyResumesPage | src/pages/profile/me/MyResumesPage.tsx | memberAssets.getMyResumes / useInkRipple | 诊断/生成记录、去报告/优化/匹配 | loading / empty / error / 未登录 | verify-profile-resumes-notifications-inkpaper |
| 17 | 17-me-documents.html | 我的文档 | 我的 | `/me/documents` | MyDocumentsPage | src/pages/profile/me/MyDocumentsPage.tsx | memberAssets(getMyDocuments 等) / useInkRipple | 保存期限管理、签章、清理 | loading / empty / error / 未登录 | verify-file-retention-ui / verify-profile-documents-inkpaper |
| 18 | 18-me-print-orders.html | 打印订单 | 我的 | `/me/print-orders` | MyPrintOrdersPage | src/pages/profile/me/MyPrintOrdersPage.tsx | memberPrintOrders.getMyPrintOrders / OrderPaymentSummary / PickupCodePanel | 状态筛选、支付信息、取件码 | loading / empty / error / 未登录 | verify-member-print-orders-ui / verify-profile-print-orders-inkpaper / verify-profile-print-orders-login-smoke |
| 19 | 19-me-ai-records.html | AI服务记录 | 我的 | `/me/ai-records` | MyAiRecordsPage | src/pages/profile/me/MyAiRecordsPage.tsx | memberAssets.getMyAiRecords+deleteMyAiRecord / jobAi.listMyJobAiSessions+deleteMyJobAiSession / JobAiSessionRecords | 记录查看、删除、隐私控制 | loading / empty / error / 未登录 | verify-profile-ai-records-inkpaper / verify-job-ai-history-privacy-ui |
| 20 | 20-me-favorites.html | 我的收藏 | 我的 | `/me/favorites` | MyFavoritesPage | src/pages/profile/me/MyFavoritesPage.tsx | memberFavorites.getAllMyFavorites / useInkRipple | 岗位/招聘会/政策收藏浏览 | loading / empty / error / 未登录 | verify-profile-feedback-inkpaper(间接) |
| 21 | 21-me-benefits.html | 我的权益 | 我的 | `/me/benefits` | MyBenefitsPage | src/pages/profile/me/MyBenefitsPage.tsx | memberFavorites.getMyBenefits / useInkRipple | 券/免费次数/额度/政策资格 | loading / empty / error / 未登录 | verify-profile-feedback-inkpaper(间接) |
| 22 | 22-me-notifications.html | 通知与反馈 | 我的 | `/me/notifications` (+ `/me/feedback`) | MyNotificationsPage (+ MyFeedbackPage) | src/pages/profile/me/MyNotificationsPage.tsx | API_MODE / useInkRipple (通知);MyFeedbackPage 走反馈工单 | 消息分类/已读/删除、反馈工单 | loading / empty / 未登录 | verify-profile-resumes-notifications-inkpaper / verify-profile-feedback-inkpaper |
| 23 | 23-me-settings.html | 账号设置 | 我的 | `/me/settings` | MySettingsPage | src/pages/profile/me/MySettingsPage.tsx | jobAi.getJobAiConsentStatus+revokeJobAiConsent / useInkRipple | 会话说明、AI授权撤销、退出登录 | loading / 登录态 | verify-user-center-wave0 |
| 24 | 24-activities.html | 权益活动 | 我的 | `/activities` | BenefitActivitiesPage | src/pages/activities/BenefitActivitiesPage.tsx | benefitActivities.listBenefitActivities | 领取型活动列表、库存状态 | loading / empty / error | verify-user-center-wave0(间接) |
| 25 | 25-resume-generate.html | AI简历生成 | AI简历 | `/resume/generate` | ResumeGeneratePage | src/pages/resume/ResumeGeneratePage.tsx | api.submitResumeGenerate | 信息表单、提交生成 | loading / error | verify-resume-diagnosis-flow-ui |
| 26 | 26-resume-generate-preview.html | 生成预览 | AI简历 | `/resume/generate/preview` | ResumeGeneratePreviewPage | src/pages/resume/ResumeGeneratePreviewPage.tsx | api.getResumeGenerate+exportGeneratedResume | A4 缩略预览、分段重生成、导出 | loading / error | verify-profile-resumes-notifications-inkpaper |
| 27 | 27-resume-parse.html | AI解析中 | AI简历 | `/resume/parse` | ResumeParsePage | src/pages/resume/ResumeParsePage.tsx | api.submitResumeParse | 加载态、三步清单 | loading / error | verify-resume-diagnosis-flow-ui |
| 28 | 28-resume-export.html | 导出 | AI简历 | `/resume/export` | ResumeExportPage | src/pages/resume/ResumeExportPage.tsx | 待核实(无直接 service import;经 state/sessionStorage 流转) | PDF/Word/纯文本导出、去向选择 | 待核实(依赖上游态) | verify-lightflow-k2a-ai-career / verify-lightflow-k2b-ai-resume |
| 29 | 29-resume-templates.html | 简历素材库 | AI简历 | `/resume/templates` | ResumeTemplateLibraryPage | src/pages/resume/ResumeTemplateLibraryPage.tsx | jobMaterials.getResumeTemplates | 模板卡浏览、布局变体 | loading / empty / error | verify-job-material-library-ui |
| 30 | 30-resume-materials.html | 求职材料库 | AI简历 | `/resume/materials` | JobMaterialLibraryPage | src/pages/resume/JobMaterialLibraryPage.tsx | jobMaterials.getJobMaterialTemplates+generateJobMaterial / API_MODE | 求职信/自我介绍/清单/证书生成 | loading / error | verify-job-material-library-ui |
| 31 | 31-print-material-check.html | 材料检查 | 打印扫描 | `/print/material-check` | PrintMaterialCheckPage | src/pages/print/PrintMaterialCheckPage.tsx | ApiHttpError / sessionStorage 流转 | 文件体检、A4 规范化、隐私片段检查 | loading / error | verify-print-entry-source-split |
| 32 | 32-print-cashier.html | 收银台 | 打印扫描 | `/print/cashier` | PrintCashierPage | src/pages/print/PrintCashierPage.tsx | API_MODE / CashierPaymentPanel | 价目明细、双支付、核实兜底 | loading / error / 支付态 | verify-print-confirm-honest |
| 33 | 33-print-done.html | 打印完成 | 打印扫描 | `/print/done` | PrintDonePage | src/pages/print/PrintDonePage.tsx | API_MODE / paymentApi.getPayStatus | 取件凭证码、任务摘要、满意度 | loading / 支付态 | verify-print-confirm-honest |
| 34 | 34-scan-start.html | 扫描类型选择 | 打印扫描 | `/scan/start` | ScanStartPage | src/pages/scan/ScanStartPage.tsx | API_BASE_URL | 简历/证件/普通文档三选一 | 静态选择 | (无专项) |
| 35 | 35-scan-settings.html | 扫描指引 | 打印扫描 | `/scan/settings` | ScanSettingsPage | src/pages/scan/ScanSettingsPage.tsx | scanTasks.createScanSession+cancelScanSession / screensaver.getTerminalId | 面板操作四步、任务会话 | loading / error | (无专项) |
| 36 | 36-scan-progress.html | 扫描等待 | 打印扫描 | `/scan/progress` | ScanProgressPage | src/pages/scan/ScanProgressPage.tsx | scanTasks.getScanSessionStatus+cancelScanSession / ApiHttpError | 诚实等待态、处理阶段时间线 | loading / error / 轮询态 | (无专项) |
| 37 | 37-scan-result.html | 扫描结果 | 打印扫描 | `/scan/result` | ScanResultPage | src/pages/scan/ScanResultPage.tsx | 待核实(经 state 流转,无直接 service import) | AI简历识别/打印/保存文档 | 待核实(依赖上游态) | (无专项) |
| 38 | 38-interview-setup.html | 面试设置 | 面试助手政策 | `/interview/setup` | InterviewSetupPage | src/pages/interview/InterviewSetupPage.tsx | interview.createInterview+startInterview / files.kioskUploadFile | 岗位/难度/题量/方式、简历上传 | loading / error | verify-lightflow-k2c-interview |
| 39 | 39-interview-session.html | 答题现场 | 面试助手政策 | `/interview/session` | InterviewSessionPage | src/pages/interview/InterviewSessionPage.tsx | interview.answerInterview+endInterview+fetchQuestionAudio+getVoiceCapability+transcribeAnswer | 问题卡、作答、计时、语音 | loading / error / 语音能力态 | verify-lightflow-k2c-interview |
| 40 | 40-interview-report.html | 面试报告 | 面试助手政策 | `/interview/report` | InterviewReportPage | src/pages/interview/InterviewReportPage.tsx | interview.getInterviewReport+printInterviewReport | 总分/四维度/逐题点评、打印 | loading / error | verify-lightflow-k2c-interview / verify-ai-artifact-print-url-contract |
| 41 | 41-interview-tips.html | 面试技巧 | 面试助手政策 | `/interview/tips` | InterviewTipsPage | src/pages/interview/InterviewTipsPage.tsx | 静态(仅样式 import) | STAR 法则等、打印手册 | 静态 | verify-lightflow-k2c-interview(间接) |
| 42 | 42-interview-reports.html | 历史报告 | 面试助手政策 | `/interview/reports` | InterviewReportsPage | src/pages/interview/InterviewReportsPage.tsx | interview.getMyInterviews+deleteMyInterview | 记录列表、删除、空态 | loading / empty / error / 未登录 | verify-lightflow-k2c-interview |
| 43 | 43-fair-checkin.html | 扫码签到 | 招聘会校园 | `/job-fairs/checkin` | JobFairCheckinPage | src/pages/job-fairs/JobFairCheckinPage.tsx | api.getJobFairs+getTerminalId / activity.recordExternalJump | 三步签到指引(主办方管理) | loading / error | verify-jobfair-checkin / verify-jobfair-commercial-closure |
| 44 | 44-fair-companies.html | 参展企业 | 招聘会校园 | `/job-fairs/:id/companies` | FairCompaniesPage | src/pages/job-fairs/FairCompaniesPage.tsx | api.getFairCompanies+getFairZones+getJobFairById | 展位号、行业筛选 | loading / empty / error | verify-jobfair-commercial-closure |
| 45 | 45-fair-company-detail.html | 展位企业详情 | 招聘会校园 | `/job-fairs/:id/companies/:companyId` | FairCompanyDetailPage | src/pages/job-fairs/FairCompanyDetailPage.tsx | api.getFairCompanyById / activity.recordExternalJump | 在招岗位、来源卡 | loading / error | verify-jobfair-commercial-closure / verify-jobfair-page-size |
| 46 | 46-fair-map.html | 场馆导览图 | 招聘会校园 | `/job-fairs/:id/map` | FairMapPage | src/pages/job-fairs/FairMapPage.tsx | api.getFairMap+getJobFairById / MapBlock | 分区色块、路线提示 | loading / empty / error | (无专项) |
| 47 | 47-fair-materials.html | 活动资料 | 招聘会校园 | `/job-fairs/:id/materials` | FairMaterialsPage | src/pages/job-fairs/FairMaterialsPage.tsx | api.getFairMaterials+getJobFairById+prepareFairMaterialPrint / API_MODE | 批量打印 | loading / error | verify-ai-artifact-print-url-contract / verify-jobfair-commercial-closure |
| 48 | 48-fair-visit-plan.html | AI参会准备单 | 招聘会校园 | `/job-fairs/:id/visit-plan` | FairVisitPlanPage | src/pages/job-fairs/FairVisitPlanPage.tsx | fairVisitPlan.generateFairVisitPlan+getLatestFairVisitPlan+printFairVisitPlan | 基于本人简历+公开信息生成、打印 | loading / error / 未登录 | verify-ai-artifact-print-url-contract |
| 49 | 49-fair-stats.html | 现场数据 | 招聘会校园 | `/job-fairs/:id/stats` | FairStatsPage | src/pages/job-fairs/FairStatsPage.tsx | api.getFairStats / FairDataScreen | 签到进度、行业/意向分布 | loading / empty / error | (无专项) |
| 50 | 50-campus.html | 校园招聘专区 | 招聘会校园 | `/campus` | CampusPage | src/pages/campus/CampusPage.tsx | api.getJobFairs+getFairCompanies+getFairStats+getFairZones+getTerminalId / activity.record* / CampusTabs | 校招双选会 5-Tab 沉浸浏览 | loading / empty / error | verify-jobfair-ui / verify-jobfair-commercial-closure |
| 51 | 51-smart-campus.html | 智慧校园 | 招聘会校园 | `/smart-campus` | SmartCampusHomePage | src/pages/smart-campus/SmartCampusHomePage.tsx | useSmartCampusConfig | 迎新+校园自助 6 卡(后台开关) | loading / 开关态 | verify-smart-campus-ui |
| 52 | 52-smart-campus-service.html | 校园卡办理 | 招聘会校园 | `/smart-campus/service/:key` | SmartCampusServicePage | src/pages/smart-campus/SmartCampusServicePage.tsx | 静态(按 key 渲染指引;含"即将上线"标注) | 自助服务办理指引 | 静态 / 即将上线标注 | verify-smart-campus-ui |
| 53 | 53-companies.html | 找企业 | 岗位企业 | `/companies` | CompaniesPage | src/pages/companies/CompaniesPage.tsx | companies.getCompanies+getCompanyStats | 来源企业与岗位导览、筛选 | loading / empty / error | (无专项) |
| 54 | 54-company-detail.html | 企业详情 | 岗位企业 | `/companies/:id` | CompanyDetailPage | src/pages/companies/CompanyDetailPage.tsx | companies.getCompanyById+getCompanyJobs / activity.record* | 在招岗位、来源说明、跳转埋点 | loading / error | (无专项) |
| 55 | 55-job-fit.html | 岗位匹配参考 | 岗位企业 | `/resume/job-fit` | JobFitPage | src/pages/resume/JobFitPage.tsx | api.getJobs / jobFit 子组件(ConsentCard/SkillMap/GapActionCards/RewriteCard) | 三档匹配参考(较高/中等/偏低)、改写建议 | loading / error / 登录态+匿名同意 | verify-job-fit-m1-5-ui |
| 56 | 56-career-plan.html | 职业规划 | 岗位企业 | `/resume/career-plan` | CareerPlanPage | src/pages/resume/CareerPlanPage.tsx | careerPlan.generateCareerPlan+getLatestCareerPlan+printCareerPlan | 现状/方向建议/行动项、打印 | loading / error / 未登录 | verify-lightflow-k2a-career / verify-lightflow-k2a-ai-career |
| 57 | 57-screensaver.html | 待机宣传屏 | 首页登录系统 | `/screensaver` (顶级全屏) | ScreensaverPage | src/pages/screensaver/ScreensaverPage.tsx | screensaver.getScreensaverPlaylist+getTerminalId / screensaverCache.prefetchAsset+resolveAssetUrl | 轮播、触摸唤醒 | loading / empty(无素材) / 离线缓存 | (无专项) |
| 58 | 58-help.html | 帮助中心 | 首页登录系统 | `/help` | HelpCenterPage | src/pages/help/HelpCenterPage.tsx | 静态 FAQ(仅样式 import) | FAQ 浏览、现场协助 | 静态 | verify-legal-retention-copy |
| 59 | 59-legal.html | 法务文档 | 首页登录系统 | `/legal/:doc` (顶级全屏) | LegalDocPage | src/pages/legal/LegalDocPage.tsx | api.API_BASE_URL(拉取文档) | 用户协议/隐私政策、字号调节 | loading / error | verify-legal-retention-copy |
| 60 | 60-session-timeout.html | 会话超时提醒 | 首页登录系统 | `/session-timeout` (顶级,lazy) | SessionTimeoutPage(placeholder) | src/pages/placeholders/SessionTimeoutPage.tsx | 静态(占位实现) | 倒计时、自动清理会话 | 静态占位 | (无专项) |
| 61 | 61-error-offline.html | 网络/设备异常 | 首页登录系统 | `/error-offline` (顶级,lazy) | ErrorOfflinePage(placeholder) | src/pages/placeholders/ErrorOfflinePage.tsx | 静态(占位实现) | 断网降级说明、诚实状态 | 静态占位 / 离线 | (无专项) |
| 62 | 62-phone-upload.html | 手机上传落地页 | 首页登录系统 | `/upload/phone` (顶级全屏,手机尺寸) | PhoneUploadPage | src/pages/upload/PhoneUploadPage.tsx | uploadSessions.uploadPhoneSessionFile / UploadSessionQrPanel | 手机端上传文件到会话 | loading / error | verify-resume-phone-upload-ui |
| 63 | 63-qr-login-mobile.html | 手机登录确认页 | 首页登录系统 | `/member/qr-login` (顶级全屏,手机尺寸) | MobileQrLoginPage | src/pages/auth/MobileQrLoginPage.tsx | memberAuthApi.sendSmsCode / memberQrLoginApi.confirmQrLogin+fetchQrLoginStatus | 手机确认扫码登录、短信验证 | loading / error / 登录态 | verify-qr-login-ui |
| 64 | 64-print-preview.html | 打印预览 | 打印扫描 | `/print/preview` | PrintPreviewPage | src/pages/print/PrintPreviewPage.tsx | priceConfigApi / sessionStorage 流转 | 单页放大、缩略图、页面范围 | loading / error / 文件不可用兜底 | verify-price-single-source / verify-legal-retention-copy / verify-print-entry-source-split |
| 65 | 65-print-confirm.html | 确认打印 | 打印扫描 | `/print/confirm` | PrintConfirmPage | src/pages/print/PrintConfirmPage.tsx | API_MODE / printJobsApi.createPrintJob | 参数确认、隐私摘要、须知 | loading / error | verify-print-confirm-honest / verify-price-single-source / verify-print-entry-source-split |
| 66 | 66-print-scan-convert.html | 格式转换 | 打印扫描 | `/print-scan/convert` | ConvertImagesPage | src/pages/print-scan/ConvertImagesPage.tsx | filesApi.kioskUploadFile / printConversion.convertImagesToPdf | 图片合并 PDF、排序、双通道添加 | loading / error | (无专项) |
| 67 | 67-print-scan-sign.html | 签名盖章 | 打印扫描 | `/print-scan/sign` | SignStampPage | src/pages/print-scan/SignStampPage.tsx | files.kioskUploadFile / printSign.signCompose+signInspect / screensaver.getTerminalId | 四步签章、授权勾选、非 CA 声明 | loading / error | verify-profile-documents-inkpaper(间接) |
| 68 | 68-print-scan-feature.html | 功能介绍 | 打印扫描 | `/print-scan/feature/:key` | PrintScanFeatureInfoPage | src/pages/print-scan/PrintScanFeatureInfoPage.tsx | 静态(证件照"即将上线"+替代路径) | 功能说明、即将上线标注 | 静态 / 即将上线 | verify-profile-commercial-first-batch / verify-profile-documents-inkpaper |
| 69 | 69-smart-campus-welcome.html | 迎新系统 | 招聘会校园 | `/smart-campus/welcome` | SmartCampusWelcomePage | src/pages/smart-campus/SmartCampusWelcomePage.tsx | 静态只读(Phase1;含"即将上线"标注) | 报到流程、办事窗口、求职准备 | 静态 / 即将上线 | verify-smart-campus-ui |
| 70 | 70-freshman-insights.html | 校园大数据 | 招聘会校园 | `/smart-campus/freshman-insights` | FreshmanInsightsPage | src/pages/smart-campus/FreshmanInsightsPage.tsx | 静态(仅"未开放"兜底,绝不展示假数据) | 未开放锁定态、合规兜底 | 未开放锁定态 | verify-smart-campus-ui |
| 71 | 71-me-activity.html | 浏览与跳转记录 | 我的 | `/me/activity` | MyActivityPage | src/pages/profile/me/MyActivityPage.tsx | activity.getMyBrowseLogs+getMyJumpLogs / useInkRipple | 浏览/外部跳转两 Tab(只记动作) | loading / empty / error / 未登录 | verify-profile-activity-inkpaper |
| 72 | 72-activity-detail.html | 权益活动详情 | 我的 | `/activities/:id` | BenefitActivityDetailPage | src/pages/activities/BenefitActivityDetailPage.tsx | benefitActivities.getBenefitActivity+claimBenefitActivity | 额度/有效期/规则、领取 | loading / error / 领取态 / 未登录 | (无专项) |
| 73 | 73-assistant-call.html | 语音咨询中 | 面试助手政策 | (无独立路由;`/assistant` 内 AssistantCallPanel) | AssistantCallPanel | src/pages/assistant/AssistantCallPanel.tsx | useAiAdvisorCallSession | 声纹、实时字幕、通话控制 | loading / error / 通话态 | verify-assistant-trtc-guard |
| 74 | 74-job-detail-offline.html | 岗位详情(线下机构) | 岗位企业 | `/jobs/:id/offline` (lazy) | OfflineJobDetailPage | src/pages/offline-agencies/OfflineJobDetailPage.tsx | offlineAgencies API | 机构门店卡、到店咨询、打印带走 | loading / error / "打印即将上线"提示 | (无专项) |
| 75 | 75-offline-agencies.html | 线下招聘机构 | 岗位企业 | `/offline-agencies` (lazy) | OfflineAgenciesPage | src/pages/offline-agencies/OfflineAgenciesPage.tsx | offlineAgencies API | 机构门店列表、营业状态、服务范围 | loading / empty / error | (无专项) |

---

## 二、生产有、原型无(补充清单,不计入 75 行)

以下生产路由在 75 屏原型中无独立对应屏(多为流程中间步、明细子页、重定向或直达兜底占位),迁移时按现状保留:

| 生产路由 path | React 组件 | 页面文件 | 说明 |
|---|---|---|---|
| `/print/upload` | PrintUploadPage | src/pages/print/PrintUploadPage.tsx | 打印流程第一步(上传);原型 02 打印中心为入口,上传步骤未单列一屏 |
| `/me/feedback` | MyFeedbackPage | src/pages/profile/me/MyFeedbackPage.tsx | 原型 22 把"通知与反馈"合为一屏,生产拆成通知页 + 独立反馈页 |
| `/print-scan/feature/:key` | PrintScanFeatureInfoPage | (见 68) | 已计入 68;此处仅提示 `:key` 参数化多能力共用 |
| `/print/scan-convert` | Navigate → `/print-scan/convert` | routes/index.tsx | 旧入口重定向 |
| `/print/scan-sign` | Navigate → `/print-scan/sign` | routes/index.tsx | 旧入口重定向 |
| `/print/scan-feature` | Navigate → `/print-scan/feature/id-photo` | routes/index.tsx | 旧入口重定向 |
| `/resume` `/resume/upload` | Navigate → `/resume/source` | routes/index.tsx | 旧入口重定向(中间服务页已移除) |
| `/campus/welcome` | CampusWelcomePage(placeholder) | src/pages/placeholders/CampusWelcomePage.tsx | 直达兜底占位;智慧校园正式实现在 `/smart-campus/welcome`(=69) |
| `/campus/freshman-insights` | FreshmanInsightsPage(placeholder) | src/pages/placeholders/FreshmanInsightsPage.tsx | 直达兜底占位;正式实现在 `/smart-campus/freshman-insights`(=70) |
| `/me/activity/:id` | MeActivityDetailPage(placeholder) | src/pages/placeholders/MeActivityDetailPage.tsx | 浏览记录明细占位,原型 71 只有列表 |
| `/notifications` | NotificationsPage(placeholder) | src/pages/placeholders/NotificationsPage.tsx | 顶层通知占位(与 `/me/notifications` 不同层级) |

> 备注:`src/pages/placeholders/` 下另有 `OfflineAgenciesPage.tsx` / `OfflineJobDetailPage.tsx` / `PrintScanConvertPage.tsx` / `PrintScanFeaturePage.tsx` / `PrintScanSignPage.tsx` 等占位文件,**未被 routes/index.tsx 引用**(实际路由指向正式实现版),属历史遗留,不参与迁移。`src/pages/jobs-fairs-prototype.tsx` 亦未被路由引用。

---

## 三、数据覆盖度小结(75 屏)

- **有完整生产页面(真实 service/API 接入)**:约 **60 屏**。覆盖首页、打印七步、扫描四步、AI简历全链路、岗位/企业/招聘会/校园、面试全链路、政策、AI助手、「我的」全部明细页、权益活动、手机上传/扫码登录、线下机构双轨等。
- **静态/占位/未开放(无真实数据接入)**:约 **15 屏**。
  - 纯静态信息屏(设计即为静态):41 面试技巧、52 校园卡办理、58 帮助中心、68 功能介绍、69 迎新系统、70 校园大数据(未开放锁定态,合规兜底)。
  - placeholder 占位实现:60 会话超时、61 断网异常(routes 中 lazy 加载 `placeholders/`,商用补缺屏,功能待补齐)。
  - 依赖上游 state 流转、无独立 service import(功能真实但数据来自流程上下文):28 导出、37 扫描结果、31 材料检查、64 打印预览(部分)。
- **缺 verify 脚本**:约 **17 屏**无专项验收脚本。包括 34/35/36 扫描三步、37 扫描结果、46 场馆导览、49 现场数据、54 企业详情、57 待机屏、60/61 系统补缺屏、66 格式转换、72 权益活动详情、74/75 线下机构双轨等(部分被 lightflow/commercial-closure 等宽口径脚本间接覆盖)。

---

## 四、最值得注意的对应关系异常

1. **73 语音咨询屏无独立路由**:原型 73「语音咨询中」是独立一屏,但生产实现为 `/assistant` 页面内的 `AssistantCallPanel` 组件(通话态子面板),不是单独路由。迁移/截图对比时需在 AssistantPage 内触发通话态,不能按独立页处理。
2. **12 政策服务 ↔ `/renshi` 语义错位**:原型 12 屏名「政策服务」,生产路由是 `/renshi`(人社),组件 RenshiPage 含 Policy/Social/Register/Notice 多面板,范围比原型单屏「政策服务」更宽。原型未覆盖社保/登记/公告等子面板。
3. **69/70 一屏对多路由(智慧校园 vs 占位重定向)**:迎新(69)与校园大数据(70)各有两条路由——正式实现 `/smart-campus/welcome`、`/smart-campus/freshman-insights`,以及直达兜底占位 `/campus/welcome`、`/campus/freshman-insights`(placeholders/)。迁移须以 smart-campus 版为准,campus 版仅容错。
4. **60/61 商用补缺屏为 placeholder,尚未真实实现**:会话超时、断网异常在 index.html 与 README 均标注"项目路由中尚无对应实现/商用补缺",生产确以 `placeholders/SessionTimeoutPage`、`placeholders/ErrorOfflinePage` lazy 占位。1:1 迁移这两屏属**新增功能**,需按正常任务流程立项,不能视为"已实现待还原"。
5. **22 通知与反馈原型合屏、生产拆两页**:原型 22 单屏合并"通知+反馈",生产拆为 `/me/notifications`(MyNotificationsPage)与 `/me/feedback`(MyFeedbackPage)两条路由两个组件。矩阵已在 22 行合并标注,迁移时注意是两个落点。

---

## 五、01 首页 prototype-v1 迁移验收记录(2026-07-20)

首页按 01-home.html 原型 1:1 重写,经 Claude+codex 双方验收审查。已修复的实质问题(codex 独立审查发现,均已运行时验证):

| 严重度 | 问题 | 修复 | 验证 |
| --- | --- | --- | --- |
| Blocker | CI 仍跑旧首页契约守卫 `verify:lightflow-4188-layout-parity`(断言旧 `ReferenceServiceNav`/`lf-reference-*` 结构,重写后必红) | 删除该守卫脚本 + CI 行 + package.json 条目;首页契约由 `verify-home-prototype-v1` 取代(已接入 CI L125) | 复现 exit1/10 项失败 → 移除后 CI 清白 |
| High | 登录用户「继续办理」入口在重写后从首页消失(能力回归) | 条件挂载 `ContinuePanel`——自门控:仅登录且有进行中打印/已诊断未优化简历时渲染;匿名或无任务返回 null,标准原型态保持 1:1 | CDP flow2-A(匿名不渲染)+ flow2-B(真登录+进行中任务→显示) |
| High | `showCampus` 门控不对称:首页要求 modules/items 非空,但 `/smart-campus` enabled 时恒有校园卡/一卡通/校园网三项 → 纯基础服务态首页漏入口 | 改为 `showCampus = campus.enabled`,与 /smart-campus 对齐;空 chips 态显示基础服务签 | CDP flow2-D |
| Medium | 分组标题改不可点 `h2` 后,`titleTo:'/print-scan'` 成死配置,聚合页从首页失去发现路径 | 有 `titleTo` 的分组标题作聚合入口(复用原型标题 + 箭头暗示,不新增可见组件) | CDP flow2-C |
| Low | `/smart-campus` 顶部计数不含扩展项;chips 用重复 title 作 React key | 计数改 `cards.length + extensionItems.length`;chips 改 `{key,label}` 稳定 key | typecheck + 守卫 |

> 验收资产:`.cache/kpv1-acceptance/cdp-flow.mjs`(启动流程 16 项)、`cdp-flow2.mjs`(四态 8 项)。dev server 因 vite 6.4.3 畸形请求崩溃,验收统一走生产 build + `vite preview` 静态服务。
> 遗留:重写后孤儿组件 `ReferenceServiceNav`(零引用)另开后台任务清理,不并入本次迁移 diff。
