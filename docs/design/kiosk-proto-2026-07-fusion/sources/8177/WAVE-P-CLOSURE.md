# Wave P · Kiosk 原型完整化与冻结（86 path 收口）

> 目标：让 **86 个路径条目全部有明确视觉/映射依据**，随后将本目录冻结为 Kiosk 唯一视觉与流程基准。
> 权威 router：[`apps/kiosk/src/routes/index.tsx`](../../../apps/kiosk/src/routes/index.tsx)（本文档 route 列逐条源自该文件，顺序一致）。
> 基准原型：本目录 75 屏（2026-07 定稿）+ `shared.css`（设计系统唯一来源）。
> 本文档为 Wave P 工作规范与冻结记录；75 屏 ↔ 生产实现的逐屏字段映射见 [`kiosk-proto-2026-07-migration-matrix.md`](../kiosk-proto-2026-07-migration-matrix.md)，不重复。

## 权威口径（不可动摇）

- Kiosk 86 path = **81 个真实组件路径 + 5 个纯重定向路径**。
- 现有基准 = 75 屏（含 1 屏为页内子状态：73 语音通话 = `/assistant` 内 `AssistantCallPanel`，非独立路由）。
- 81 个真实组件路径必须对应：独立原型 / 明确复用原型 / 页内状态原型。
- 5 个重定向只建**映射卡片**，不复制视觉页面。
- loading/error/success/permission/config/hardware 状态变体按真实需要补充，可用 25A/25B 编号；**最终 HTML 数量允许高于 81，不强制等于 86**。

## 分类图例（P1）

**主分类（结构角色，互斥，每条 route 取一个）：**

| 分类 | 含义 |
|---|---|
| `UNIQUE_PAGE` | 独立真实功能页，有/需独立原型 |
| `SUBVIEW_STATE` | 页内子状态，不占独立路由（如 73 通话面板） |
| `REDIRECT_ALIAS` | 纯 `Navigate` 重定向，只建映射卡 |
| `FALLBACK_PLACEHOLDER` | 生产为占位/别名兜底（stub 或指向正式实现），只建映射卡 |

**前置条件标记（正交，可叠加，标在「前置条件」列）：**

| 标记 | 含义 |
|---|---|
| `CONFIG_BLOCKED` | 受后台/终端开关门控（关则入口不出现或页内提示） |
| `EXTERNAL_BLOCKED` | 依赖第三方（短信/支付/TRTC/来源平台/法务正文），开发环境不可真跑 |
| `HARDWARE_BLOCKED` | 依赖真机硬件（打印机/扫描仪） |

## 计数闭合

- 86 route = 5 `REDIRECT_ALIAS` + 4 `FALLBACK_PLACEHOLDER` + 77 `UNIQUE_PAGE`
- 77 `UNIQUE_PAGE` = 74（已有独立原型）+ 3（**缺图，P3 补**：`/toolbox`、`/print/upload`、`/me/feedback`）
- 另有 1 个 `SUBVIEW_STATE`（73 通话面板）——已有原型，不计入 86 route
- 现有 75 屏 = 74（route 映射）+ 1（73 子状态）
- **结论：86 条全部有依据；仅 3 条真实页缺独立原型，交 P3。**

## 一、86 path 分类闭合总表（按 router 顺序）

### A. 顶级全屏路由（不套 KioskRoot，无 header/footer/nav）

| # | route | component | 现有原型 | 主分类 | 缺图 | 状态变体 | 前置条件 | 主按钮→真实下一步 | 合法终点 |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `/login` | LoginPage | 15 | UNIQUE_PAGE | 否 | 建议补 error/超时 | `EXTERNAL_BLOCKED`(短信) | 微信扫码/手机号登录/游客 → 建立会话或游客态 | 登录成功回首页 `/`；游客留原页 |
| 2 | `/member/qr-login` | MobileQrLoginPage | 63 | UNIQUE_PAGE | 否 | 建议补 error | `EXTERNAL_BLOCKED`(短信) | 手机确认扫码+短信验证 → PC 端登录态 | 确认后 PC 端登录；超时回登录 |
| 3 | `/upload/phone` | PhoneUploadPage | 62 | UNIQUE_PAGE | 否 | 已含 loading/error | — | 手机端上传文件到会话 → 回传 PC | 上传成功提示；失败可重试 |
| 4 | `/legal/:doc` | LegalDocPage | 59 | UNIQUE_PAGE | 否 | 已含 loading/error | `EXTERNAL_BLOCKED`(法务正文) | 阅读协议/隐私、字号调节 | 返回上一页；无正文走硬编码兜底 |
| 5 | `/resume/job-fit` | JobFitPage | 55 | UNIQUE_PAGE | 否 | 已含 登录+匿名同意 | — | 三档匹配参考、改写建议 | 结果入 AI服务记录；去优化/打印 |
| 6 | `/resume/career-plan` | CareerPlanPage | 56 | UNIQUE_PAGE | 否 | 已含 loading/error/未登录 | — | 生成规划、打印 | 结果入 AI服务记录/我的文档；打印 |
| 7 | `/interview/setup` | InterviewSetupPage | 38 | UNIQUE_PAGE | 否 | 已含 loading/error | — | 设置岗位/难度、上传简历 → 开始 | 进 `/interview/session` |
| 8 | `/interview/session` | InterviewSessionPage | 39 | UNIQUE_PAGE | 否 | 已含 语音能力态 | `EXTERNAL_BLOCKED`(语音可选) | 作答/计时/语音 → 结束 | 进 `/interview/report` |
| 9 | `/interview/report` | InterviewReportPage | 40 | UNIQUE_PAGE | 否 | 已含 loading/error | `HARDWARE_BLOCKED`(打印可选) | 查看四维度评分、打印 | 结果入 AI服务记录；打印带走 |
| 10 | `/interview/tips` | InterviewTipsPage | 41 | UNIQUE_PAGE(static) | 否 | 静态 | — | STAR 法则、打印手册 | 打印带走；返回 |
| 11 | `/interview/reports` | InterviewReportsPage | 42 | UNIQUE_PAGE | 否 | 已含 loading/empty/error/未登录 | — | 历史列表、删除 | 进单份报告；空态诚实 |
| 12 | `/screensaver` | ScreensaverPage | 57 | UNIQUE_PAGE | 否 | 已含 empty(无素材)/离线缓存 | `CONFIG_BLOCKED`(终端素材集) | 轮播、触摸唤醒 | 触摸回首页；无素材走兜底 |
| 13 | `/session-timeout` | SessionTimeoutPage(placeholder) | 60 | UNIQUE_PAGE | 否 | 静态占位 | — | 倒计时、自动清理会话 | 回登录/首页。⚠️生产为 placeholder，1:1 落地属新增功能 |
| 14 | `/error-offline` | ErrorOfflinePage(placeholder) | 61 | UNIQUE_PAGE | 否 | 离线态 | — | 断网降级说明 | 恢复后返回。⚠️生产为 placeholder，属新增功能 |

### B. KioskRoot 子路由 · 首页 / 我的 / 活动 / 校园

| # | route | component | 现有原型 | 主分类 | 缺图 | 状态变体 | 前置条件 | 主按钮→真实下一步 | 合法终点 |
|---|---|---|---|---|---|---|---|---|---|
| 15 | `/` (index) | HomePage | 01 | UNIQUE_PAGE | 否 | 游客/登录/离线/动态专区/继续办理 | `CONFIG_BLOCKED`(百宝箱·智慧校园开关) | 服务分组跳转、扫码登录 | 各业务线入口；prototype-v1 已 1:1 |
| 16 | `/assistant` | AssistantPage | 13 | UNIQUE_PAGE | 否 | 已含 loading/error；含 73 子状态 | `EXTERNAL_BLOCKED`(TRTC 语音可选) | 咨询主题、对话、白名单动作 | 引导跳功能页；语音失败回文字 |
| 17 | `/profile` | ProfilePage | 14 | UNIQUE_PAGE | 否 | 已含 未登录引导/登录态 | — | 五分区入口、本次记录 | 进各 `/me/*` 明细；未登录引导登录 |
| 18 | `/me/resumes` | MyResumesPage | 16 | UNIQUE_PAGE | 否 | 已含 loading/empty/error/未登录 | — | 去报告/优化/匹配 | 进对应简历功能页 |
| 19 | `/me/print-orders` | MyPrintOrdersPage | 18 | UNIQUE_PAGE | 否 | 已含 loading/empty/error/未登录 | — | 状态筛选、取件码 | 查看订单详情/取件码 |
| 20 | `/me/documents` | MyDocumentsPage | 17 | UNIQUE_PAGE | 否 | 已含 loading/empty/error/未登录 | — | 保存期限管理、签章、清理 | 去签章/打印；到期清理 |
| 21 | `/me/favorites` | MyFavoritesPage | 20 | UNIQUE_PAGE | 否 | 已含 loading/empty/error/未登录 | — | 岗位/招聘会/政策收藏浏览 | 进对应详情页 |
| 22 | `/me/ai-records` | MyAiRecordsPage | 19 | UNIQUE_PAGE | 否 | 已含 loading/empty/error/未登录 | — | 记录查看、删除 | 进对应 AI 结果；删除即清 |
| 23 | `/me/benefits` | MyBenefitsPage | 21 | UNIQUE_PAGE | 否 | 已含 loading/empty/error/未登录 | — | 券/免费次数/额度浏览 | 去权益活动领取（入口见 24） |
| 24 | `/me/activity` | MyActivityPage | 71 | UNIQUE_PAGE | 否 | 已含 loading/empty/error/未登录 | — | 浏览/外部跳转两 Tab（只记动作） | 明细占位见 25；诚实空态 |
| 25 | `/me/activity/:id` | MeActivityDetailPage(placeholder) | 无（71 仅列表） | FALLBACK_PLACEHOLDER | — | 只建映射卡 | — | 浏览记录明细（占位 stub） | 返回 24 列表 |
| 26 | `/me/notifications` | MyNotificationsPage | 22 | UNIQUE_PAGE | 否 | 已含 loading/empty/未登录 | — | 消息分类/已读/删除 | 站内消息操作；空态诚实 |
| 27 | `/me/feedback` | MyFeedbackPage | **22 合屏未单列** | UNIQUE_PAGE | **是→P3** | 建议 22B 变体或独立小图 | — | 提交反馈工单 | 工单提交成功提示 |
| 28 | `/me/settings` | MySettingsPage | 23 | UNIQUE_PAGE | 否 | 已含 登录态 | — | 会话说明、AI授权撤销、退出 | 退出回登录；撤权即时生效 |
| 29 | `/help` | HelpCenterPage | 58 | UNIQUE_PAGE(static) | 否 | 静态 | — | FAQ 浏览、现场协助 | 静态信息；返回 |
| 30 | `/activities` | BenefitActivitiesPage | 24 | UNIQUE_PAGE | 否 | 已含 loading/empty/error | — | 领取型活动列表 | 进活动详情 31 |
| 31 | `/activities/:id` | BenefitActivityDetailPage | 72 | UNIQUE_PAGE | 否 | 已含 loading/error/领取态/未登录 | — | 额度/有效期/规则、领取 | 领取生成 BenefitGrant → 我的权益 |
| 32 | `/renshi` | RenshiPage | 12 | UNIQUE_PAGE | 否 | 已含 loading/empty/error | — | 政策/社保/登记/公告浏览、材料打印 | 材料清单打印；⚠️范围宽于原型 12 单屏 |
| 33 | `/campus` | CampusPage | 50 | UNIQUE_PAGE | 否 | 已含 loading/empty/error | `CONFIG_BLOCKED`(校招开关) | 校招双选会 5-Tab 浏览 | 进招聘会/企业详情 |
| 34 | `/campus/welcome` | CampusWelcomePage(placeholder) | 无（正式=69） | FALLBACK_PLACEHOLDER | — | 只建映射卡 | — | 直达兜底占位 | 重定向语义指向 `/smart-campus/welcome` |
| 35 | `/campus/freshman-insights` | FreshmanInsightsPage(placeholder) | 无（正式=70） | FALLBACK_PLACEHOLDER | — | 只建映射卡 | — | 直达兜底占位 | 语义指向 `/smart-campus/freshman-insights` |
| 36 | `/toolbox` | ToolboxZonePage | **无** | UNIQUE_PAGE | **是→P3** | config-off 态必备 | `CONFIG_BLOCKED`(百宝箱开关) | 微应用卡跳转 | 关闭或无 items 时页内显示「待配置」空态（页框仍渲染）；开且有 items 则进各微应用 |
| 37 | `/smart-campus` | SmartCampusHomePage | 51 | UNIQUE_PAGE | 否 | 已含 开关态 | `CONFIG_BLOCKED`(智慧校园开关) | 迎新+校园自助 6 卡 | 进迎新/服务/大数据 |
| 38 | `/smart-campus/welcome` | SmartCampusWelcomePage | 69 | UNIQUE_PAGE(static) | 否 | 静态/即将上线 | `CONFIG_BLOCKED` | 报到流程、办事窗口 | 静态指引；即将上线标注诚实 |
| 39 | `/smart-campus/freshman-insights` | FreshmanInsightsPage | 70 | UNIQUE_PAGE | 否 | 未开放锁定态 | `CONFIG_BLOCKED`+合规冻结 | 校园大数据 | **未开放锁定态，绝不展示假数据** |
| 40 | `/smart-campus/service/:key` | SmartCampusServicePage | 52 | UNIQUE_PAGE(static) | 否 | 静态/即将上线 | `CONFIG_BLOCKED` | 自助服务办理指引 | 静态指引；即将上线标注诚实 |

### C. 打印扫描服务中心 + 打印流程 + 简历 + 扫描

| # | route | component | 现有原型 | 主分类 | 缺图 | 状态变体 | 前置条件 | 主按钮→真实下一步 | 合法终点 |
|---|---|---|---|---|---|---|---|---|---|
| 41 | `/print-scan` | PrintScanHomePage | 02 | UNIQUE_PAGE | 否 | 已含 loading/能力开关 | `CONFIG_BLOCKED`(七能力开关) | 七能力卡跳转 | 进各打印扫描功能页 |
| 42 | `/print-scan/feature/:key` | PrintScanFeatureInfoPage | 68 | UNIQUE_PAGE(static) | 否 | 静态/即将上线 | — | 功能说明、替代路径 | 证件照「即将上线」诚实标注 |
| 43 | `/print-scan/convert` | ConvertImagesPage | 66 | UNIQUE_PAGE | 否 | 已含 loading/error | — | 图片合并 PDF、排序 | 转换结果去打印/保存 |
| 44 | `/print-scan/sign` | SignStampPage | 67 | UNIQUE_PAGE | 否 | 已含 loading/error | — | 四步签章、授权勾选 | 签章件去打印/保存；非 CA 声明 |
| 45 | `/print/scan-convert` | Navigate→`/print-scan/convert` | 无 | REDIRECT_ALIAS | — | 只建映射卡 | — | 旧入口重定向 | → 43 |
| 46 | `/print/scan-sign` | Navigate→`/print-scan/sign` | 无 | REDIRECT_ALIAS | — | 只建映射卡 | — | 旧入口重定向 | → 44 |
| 47 | `/print/scan-feature` | Navigate→`/print-scan/feature/id-photo` | 无 | REDIRECT_ALIAS | — | 只建映射卡 | — | 旧入口重定向 | → 42 |
| 48 | `/print/upload` | PrintUploadPage | **无** | UNIQUE_PAGE | **是→P3** | 本机/扫码/U盘三 tab；error | `HARDWARE_BLOCKED`(U盘/Agent) | 上传/扫码传/U盘导入 | 进 `/print/material-check` |
| 49 | `/print/material-check` | PrintMaterialCheckPage | 31 | UNIQUE_PAGE | 否 | 已含 loading/error | — | 文件体检、A4 规范化 | 进 `/print/preview` |
| 50 | `/print/preview` | PrintPreviewPage | 64 | UNIQUE_PAGE | 否 | 已含 loading/error/文件不可用兜底 | — | 单页放大、页面范围 | 进 `/print/params` |
| 51 | `/print/params` | PrintParamsPage | 03 | UNIQUE_PAGE | 否 | 已含 loading/error（**视觉待双栏对齐**） | — | 份数/色彩/双面、费用预估 | 进 `/print/confirm` |
| 52 | `/print/confirm` | PrintConfirmPage | 65 | UNIQUE_PAGE | 否 | 已含 loading/error | — | 参数确认、隐私摘要 | 进 `/print/cashier` |
| 53 | `/print/cashier` | PrintCashierPage | 32 | UNIQUE_PAGE | 否 | 已含 loading/error/支付态 | `EXTERNAL_BLOCKED`(支付) | 价目明细、双支付 | 支付成功进 `/print/progress`；失败不建任务 |
| 54 | `/print/progress` | PrintProgressPage | 04 | UNIQUE_PAGE | 否 | 已含 loading/error/轮询 | `HARDWARE_BLOCKED`(打印机) | 轮询状态、异常指引 | 进 `/print/done`；设备离线诚实提示 |
| 55 | `/print/done` | PrintDonePage | 33 | UNIQUE_PAGE | 否 | 已含 loading/支付态 | `HARDWARE_BLOCKED`(出件) | 取件码、满意度 | 取件凭证；订单入我的 |
| 56 | `/resume` | Navigate→`/resume/source` | 无 | REDIRECT_ALIAS | — | 只建映射卡 | — | 旧入口重定向 | → 58 |
| 57 | `/resume/upload` | Navigate→`/resume/source` | 无 | REDIRECT_ALIAS | — | 只建映射卡 | — | 旧入口重定向 | → 58 |
| 58 | `/resume/source` | ResumeSourcePage | 05 | UNIQUE_PAGE | 否 | 已含 loading/error/登录态（**视觉待双栏对齐**） | — | 上传/扫码传/纸质扫描 OCR | 进 `/resume/parse`；纸质走 `/scan` 分流 |
| 59 | `/resume/generate` | ResumeGeneratePage | 25 | UNIQUE_PAGE | 否 | 已含 loading/error | — | 信息表单、提交生成 | 进 `/resume/generate/preview` |
| 60 | `/resume/generate/preview` | ResumeGeneratePreviewPage | 26 | UNIQUE_PAGE | 否 | 已含 loading/error | — | A4 预览、分段重生成、导出 | 导出去 `/resume/export`；入我的简历 |
| 61 | `/resume/parse` | ResumeParsePage | 27 | UNIQUE_PAGE | 否 | 已含 loading/error | — | 加载态、三步清单 | 进 `/resume/report`；OCR 失败不调 LLM |
| 62 | `/resume/report` | ResumeReportPage | 06 | UNIQUE_PAGE | 否 | 已含 loading/error/登录态（**视觉待双栏对齐**） | — | 评分维度、去优化 | 进 `/resume/optimize`；结果入我的简历 |
| 63 | `/resume/optimize` | ResumeOptimizePage | 07 | UNIQUE_PAGE | 否 | 已含 loading/error/登录态 | — | 原文/建议对比、排版、导出 | 去 `/resume/export`；入我的简历 |
| 64 | `/resume/export` | ResumeExportPage | 28 | UNIQUE_PAGE | 否 | 依赖上游 state | — | PDF/Word/纯文本导出、去向 | 下载/打印/入我的文档 |
| 65 | `/resume/templates` | ResumeTemplateLibraryPage | 29 | UNIQUE_PAGE | 否 | 已含 loading/empty/error | — | 模板卡浏览、布局变体 | 选模板回生成/优化 |
| 66 | `/resume/materials` | JobMaterialLibraryPage | 30 | UNIQUE_PAGE | 否 | 已含 loading/error | — | 求职信/自我介绍/清单生成 | 结果去导出/打印；入我的文档 |
| 67 | `/scan/start` | ScanStartPage | 34 | UNIQUE_PAGE | 否 | 静态选择 | `HARDWARE_BLOCKED`(扫描仪) | 简历/证件/普通三选一 | 进 `/scan/settings` |
| 68 | `/scan/settings` | ScanSettingsPage | 35 | UNIQUE_PAGE | 否 | 已含 loading/error | `HARDWARE_BLOCKED`(扫描仪) | 面板四步、任务会话 | 进 `/scan/progress` |
| 69 | `/scan/progress` | ScanProgressPage | 36 | UNIQUE_PAGE | 否 | 已含 loading/error/轮询 | `HARDWARE_BLOCKED`(扫描仪) | 诚实等待态、阶段时间线 | 进 `/scan/result`；设备离线提示 |
| 70 | `/scan/result` | ScanResultPage | 37 | UNIQUE_PAGE | 否 | 依赖上游 state | — | AI简历识别/打印/保存 | 去简历诊断/打印/我的文档 |

### D. 岗位 / 企业 / 招聘会 / 线下机构

| # | route | component | 现有原型 | 主分类 | 缺图 | 状态变体 | 前置条件 | 主按钮→真实下一步 | 合法终点 |
|---|---|---|---|---|---|---|---|---|---|
| 71 | `/jobs` | JobsPage | 08 | UNIQUE_PAGE | 否 | 已含 loading/empty/error | — | 类型/来源筛选、线上线下双轨 | 进 `/jobs/:id` |
| 72 | `/jobs/:id` | JobDetailPage | 09 | UNIQUE_PAGE | 否 | 已含 loading/error/登录态 | `EXTERNAL_BLOCKED`(来源平台) | **去来源平台投递/扫码投递** | 外跳来源平台；埋点浏览/跳转（合规白名单） |
| 73 | `/jobs/:id/offline` | OfflineJobDetailPage | 74 | UNIQUE_PAGE | 否 | 已含 loading/error/「打印即将上线」 | — | 机构门店卡、到店咨询 | 到店指引；打印带走。**不代收简历/费用** |
| 74 | `/offline-agencies` | OfflineAgenciesPage | 75 | UNIQUE_PAGE | 否 | 已含 loading/empty/error | — | 机构门店列表、营业状态 | 进 `/jobs/:id/offline` |
| 75 | `/notifications` | NotificationsPage(placeholder) | 无（正式=`/me/notifications`=22） | FALLBACK_PLACEHOLDER | — | 只建映射卡 | — | 顶层通知占位 stub | 语义指向 `/me/notifications` |
| 76 | `/companies` | CompaniesPage | 53 | UNIQUE_PAGE | 否 | 已含 loading/empty/error | — | 来源企业与岗位导览、筛选 | 进 `/companies/:id` |
| 77 | `/companies/:id` | CompanyDetailPage | 54 | UNIQUE_PAGE | 否 | 已含 loading/error | `EXTERNAL_BLOCKED`+`CONFIG_BLOCKED`(指标开关) | 在招岗位、来源说明 | 外跳来源；埋点跳转。**非招聘平台** |
| 78 | `/job-fairs` | JobFairsPage | 10 | UNIQUE_PAGE | 否 | 已含 loading/empty/error | `EXTERNAL_BLOCKED`(预约平台) | 场次浏览、**去来源平台预约** | 进 `/job-fairs/:id`；外跳预约 |
| 79 | `/job-fairs/checkin` | JobFairCheckinPage | 43 | UNIQUE_PAGE | 否 | 已含 loading/error | — | 三步签到指引（主办方管理） | 签到指引；不代收数据 |
| 80 | `/job-fairs/:id` | JobFairDetailPage | 11 | UNIQUE_PAGE | 否 | 已含 loading/empty/error | `EXTERNAL_BLOCKED`(预约平台) | 展位导览、扫码预约 | 进现场服务子页；外跳预约 |
| 81 | `/job-fairs/:id/companies` | FairCompaniesPage | 44 | UNIQUE_PAGE | 否 | 已含 loading/empty/error | — | 展位号、行业筛选 | 进 `/job-fairs/:id/companies/:companyId` |
| 82 | `/job-fairs/:id/companies/:companyId` | FairCompanyDetailPage | 45 | UNIQUE_PAGE | 否 | 已含 loading/error | `EXTERNAL_BLOCKED`(来源) | 在招岗位、来源卡 | 外跳来源；埋点跳转 |
| 83 | `/job-fairs/:id/map` | FairMapPage | 46 | UNIQUE_PAGE | 否 | 已含 loading/empty/error | — | 分区色块、路线提示 | 导览返回详情 |
| 84 | `/job-fairs/:id/materials` | FairMaterialsPage | 47 | UNIQUE_PAGE | 否 | 已含 loading/error | `HARDWARE_BLOCKED`(打印) | 批量打印 | 资料打印带走 |
| 85 | `/job-fairs/:id/visit-plan` | FairVisitPlanPage | 48 | UNIQUE_PAGE | 否 | 已含 loading/error/未登录 | `HARDWARE_BLOCKED`(打印) | 基于本人简历+公开信息生成 | 参会单打印；入我的文档 |
| 86 | `/job-fairs/:id/stats` | FairStatsPage | 49 | UNIQUE_PAGE | 否 | 已含 loading/empty/error | — | 签到进度、行业/意向分布 | 现场数据只读；返回 |

### 子状态原型（不占独立路由，不计入 86）

| 原型 | 归属 route | component | 主分类 | 说明 |
|---|---|---|---|---|
| 73 | `/assistant`(=16) | AssistantCallPanel | SUBVIEW_STATE | 语音通话态子面板；截图对比须在 AssistantPage 内触发通话态 |

## 二、P3 待补清单（仅 3 真实页缺图 + 必要状态变体）— 已落地

**独立缺图页（3，已补）：**

| route | 落地文件 | 依据 | 复用 |
|---|---|---|---|
| `/toolbox` | `76-toolbox-zone.html` | 首页动态专区已有视觉语言，但独立落地页无原型；需 config-off 兜底态 | 复用 tile/card + 首页专区样式 |
| `/print/upload` | `77-print-upload.html` | 打印流程第一步（本机/扫码/U盘三 tab）；原型 02 仅为入口 | 复用 62 上传面板 + tab 组件 |
| `/me/feedback` | `22B-me-feedback.html` | 原型 22 合屏「通知+反馈」，生产拆两页，反馈页无独立视觉 | 复用 22 表单区 + row-item |

**必要状态变体（P3 已按真实前置逐一核验后落地）：**

> 变体文件按**原型编号**命名（非路由编号），因 route↔proto 不一一对应：route 53=`/print/cashier`→proto 32、route 67=`/scan/start`→proto 34、route 36=`/toolbox`→proto 76。用路由号会与既有原型冲突（如 route 32=`/renshi`）。

| 变体文件 | 基于原型 | 依据 | 判定 | 说明 |
|---|---|---|---|---|
| `15A-login-error.html` | 15 | `EXTERNAL_BLOCKED` B1 | ✅ 已补 | 15 零 error 态；协议已勾选，失败发生在验证码环节，不放行登录 |
| `32A-cashier-failed.html` | 32 | `EXTERNAL_BLOCKED` B2 | ✅ 已补 | 32 只画待支付主态；失败态守住「未扣款/未创建打印任务/文件仍在」底线 |
| `34A-scan-offline.html` | 34 | `HARDWARE_BLOCKED` B3 | ✅ 已补 | 34 只画就绪主态；离线态复用 61 视觉语言，列仍可用替代路径 |
| `76A-toolbox-empty.html` | 76 | `CONFIG_BLOCKED` | ✅ 已补 | 真实代码 `config.enabled?items:[]`→`.tb-empty`；76 只画 items>0 |
| ~~54A 打印机离线~~ | 04 | `HARDWARE_BLOCKED` B3 | ❌ 不新建 | 原型 04（打印进度）已成块画缺纸/卡纸/失败/重试/无法出件（136–161 行），无需另建 |

> 逐一核验依据:未信任 P1「已含」标注（那反映代码能力，非原型 HTML 是否真画出该态），而是逐个读原型 HTML 确认。54A 经核实已被 04 覆盖故不建；其余 4 个原型仅画主态,确为真实缺口。不为覆盖率强凑。

## 三、5 个重定向映射（只建卡，不复制页面）

| 旧入口 | 重定向到 | 目标原型 |
|---|---|---|
| `/print/scan-convert` | `/print-scan/convert` | 66 |
| `/print/scan-sign` | `/print-scan/sign` | 67 |
| `/print/scan-feature` | `/print-scan/feature/id-photo` | 68 |
| `/resume` | `/resume/source` | 05 |
| `/resume/upload` | `/resume/source` | 05 |

## 四、P1 结论

- **86 条路径全部有明确依据**：77 UNIQUE_PAGE（74 已有原型 + 3 缺图→P3）+ 5 REDIRECT_ALIAS + 4 FALLBACK_PLACEHOLDER。
- **缺独立原型仅 3 条真实页**：`/toolbox`、`/print/upload`、`/me/feedback`。
- 前置条件已全标：`CONFIG_BLOCKED` 12+ 条、`EXTERNAL_BLOCKED` 10 条、`HARDWARE_BLOCKED` 9 条，与迁移矩阵第七节 B 类清单一致。
- 视觉待对齐 3 屏（03/05/06 双栏，即 51/58/62 行）为冻结后 p25 批次事项，P1 已标注，不在本阶段改。
- **下一步 P2**：按 12 条业务线编排流程闭环，验证每条主功能有合法终点、状态变体齐备，产出后再进 P3 补图。


