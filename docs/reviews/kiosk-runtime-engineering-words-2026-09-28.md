# 一体机运行页屏上工程词清单（2026-09-28）

> 来源：Codex 只读盘点（`apps/kiosk/src`，候选 `6c31b2dd5`）。协调方抽查 5 条属实（打印完成页「任务号」、扫描进度页「任务编号」、反馈弹层与「我的文档」直接显示 API 错误对象的 message、岗位 AI 未知错误码回落 `err.message`）。
> **用法：** 这是第三波（运行页按 2.0 稿同步）时顺手清理的线索，**实施前逐条核对 `文件:行号` 与现状**；统一说法以 `docs/design/kiosk-redesign-2026-08-v2/` 的稿为准（示例、刚才那一次、这台机器读 U 盘、屏上不显示编号与哈希）。行号以盘点时的候选为准，之后的提交可能挪动。用户能用的短订单号（如「订单 P2609020317」）、取件码不算编号暴露。

## 图片转 PDF：`/print-scan/convert`

| 文件:行号 | 屏上原文 | 建议改法 | 风险与门禁 |
|---|---|---|---|
| `print-scan/ConvertImagesView.tsx:113-115` | 「一次性请求」「无进度回传」「系统不回传中间进度」 | 「这一步会一次完成，中途不显示进度；结果回来后才继续」 | 图谱命中 `verify-fusion-w2-print-scan.mjs`、`verify-print-confirm-honest.mjs`；门禁未逐字断言这些原文。 |
| `print-scan/ConvertImagesView.tsx:120-121,128` | 「同一个标记」「没有另起一次」「用同一个标记把结果找回来了」 | 「正在查刚才那一次」「不会另起一份」「把刚才那一次的结果找回来」 | 同上；未发现逐字断言。 |
| `print-scan/ConvertImagesPanels.tsx:367` | 「一次性提交，系统不回传中间进度」 | 「这一步一次完成，中途不显示进度」 | 图谱命中 `verify-fusion-w2-print-scan.mjs`；未逐字断言。 |
| `print-scan/ConvertImagesPanels.tsx:453-454,460-462,470,604` | 「同一标记」「不发起新的生成」「用同一个标记查询」「再用这个标识提交」 | 「刚才那一次还在处理中」「先查刚才那一次」「确认失败后按同一批图片、同一个顺序重新开始」 | 同上；未逐字断言。 |
| `print-scan/ConvertImagesPanels.tsx:476-477` | 服务端原话：「该请求标识已用于另一批图片，请更换标识重试」 | 「刚才那一次已经用于另一批图片。请按同一批图片、同一个顺序重新开始。」 | 这是明确的服务端原话直出。图谱命中 `verify-fusion-w2-print-scan.mjs`；`rg` 未发现该完整句子的逐字门禁。 |

## U 盘与文件来源：`/print/upload`、简历来源页

| 文件:行号 | 屏上原文 | 建议改法 | 风险与门禁 |
|---|---|---|---|
| `print/file-source/FileSourceView.tsx:551-556` | 「本地服务会列出根目录」「本地服务在列根目录」「根目录里没有」「本地服务连上了」 | 「这台机器会列出 U 盘里能打印的文件」「正在读取 U 盘」「U 盘里暂时没有可用文件」「这台机器暂时读不到 U 盘」 | 图谱命中 `verify-file-display-truth.mjs`、`verify-fusion-w2-print-scan.mjs`、`verify-print-entry-source-split.mjs`；未逐字断言。 |
| `print/file-source/FileSourceView.tsx:568,594,635` | 「列出根目录」「U 盘根目录」「只列根目录」 | 「列出 U 盘里可打印的文件」「U 盘文件」「只显示能打印的文件」 | 同上；未逐字断言。 |
| `print/file-source/FileSourceView.tsx:571` | 「网页不直接访问磁盘，也拿不到你盘上的绝对路径」 | 「这台机器只读取可办理的文件，不显示 U 盘里的其他位置」 | 同上；未逐字断言。 |
| `print/file-source/FileSourceBits.tsx:232` | 「本地服务列出根目录里的文件」 | 「这台机器会列出 U 盘里可打印的文件」 | 同上；未逐字断言。 |
| `print/file-source/FileSourceBits.tsx:319` | 「网页不能远程启动扫描仪」 | 「请在奔图操作面板上开始扫描」 | 同上；未逐字断言。 |
| `resume/ResumeUsbImportPanel.tsx:155` | `{error}` 直接作为 U 盘错误说明 | 统一映射为「这台机器暂时读不到 U 盘，请重新插入或联系工作人员」 | 图谱命中 `verify-fusion-w2-print-scan.mjs` 等；`userMessageOf` 已有一层翻译，但未知错误仍可能落入调用方兜底，应继续禁止原始错误串。 |

## 扫描流程：`/scan/settings`、`/scan/progress`、`/scan/start`

| 文件:行号 | 屏上原文 | 建议改法 | 风险与门禁 |
|---|---|---|---|
| `scan/ScanSettingsStatusView.tsx:171,252` | 「请求还在路上」「没有任务编号」 | 「正在确认这次扫描」「这次还没有可显示的结果」 | 图谱命中 `verify-scan-session-truth.mjs`；该门禁在 `1853` 行有“任务编号/服务端原文不得泄露”的泛化检查，但未逐字锁定这些句子。 |
| `scan/ScanSettingsStatusView.tsx:272` | 「上一次请求没有收到系统回应」「同一份凭据」「不会多建一场」 | 「刚才那一次没有收到回应，正在原样确认」「不会多出第二次扫描」 | 同上；未逐字断言。 |
| `scan/ScanSettingsStatusView.tsx:341` | 「同一份凭据问过系统，没有另建一次扫描」 | 「刚才那一次已经问过，不会另起一场扫描」 | 同上。 |
| `scan/ScanSettingsStatusView.tsx:354-355` | 「为什么不给你一个编号」「编号是系统给出的」 | 「为什么这里不显示编号」「编号由系统处理，这台机器不自行编写」 | 同上；存在泛化任务编号门禁。 |
| `scan/ScanSettingsStatusView.tsx:322,400` | 「系统给出的任务编号」「任务编号」及真实 `scanTaskId` | 不显示编号；改为「扫描确认后，文件会回到这台机器」 | 这是实际任务号上屏。图谱命中 `verify-scan-session-truth.mjs`；门禁已有 `scanTaskId` 负向检查，但不是逐字中文断言。 |
| `scan/ScanProgressPage.tsx:510` | `任务编号 {scanTaskId}` | 删除编号，改为「正在等待这次扫描的文件」 | 图谱命中 `verify-scan-session-truth.mjs`、`verify-kiosk-runtime-error-boundary.mjs`；存在泛化任务编号门禁。 |
| `scan/ScanStartPage.tsx:181,184,195` | 「USB 接口」「平台扫描任务」「任务编号」 | 「打印机上的 U 盘插口」「这条路不会把文件带回屏幕」「这里不显示编号」 | 图谱命中 `verify-scan-session-truth.mjs`；未逐字断言。 |
| `scan/ScanStartPage.tsx:278` | 「网页不能远程驱动扫描仪」「建立这次扫描、转达系统给出的操作说明」 | 「请在奔图操作面板上开始；这台机器会告诉你下一步」 | 同上；未逐字断言。 |

## 打印进度与完成页：`/print/progress`、`/print/done`

| 文件:行号 | 屏上原文 | 建议改法 | 风险与门禁 |
|---|---|---|---|
| `print/PrintDonePage.tsx:440,606,732` | `任务号 ${taskId}`、`（任务号 ${taskId}）`、任务号芯片 | 「请在打印订单里查看这次记录」或「请把文件名和打印时间告诉工作人员」 | 图谱命中 `verify-print-done-truth.mjs`、`verify-kiosk-feedback-entry.mjs` 等；门禁仅在 `verify-print-done-truth.mjs:55` 间接提到任务号，未锁完整显示文案。 |
| `print/PrintProgressPage.tsx:699,705` | 「凭任务号找工作人员」「工作人员可凭任务号核查」 | 「请把打印时间和文件名告诉工作人员」 | 图谱命中多项打印门禁；未逐字断言。 |
| `print/components/PrintProgressSections.tsx:94,119` | `任务号`、`订单号`、「后台能直接查到这一单」 | 「请告诉工作人员这次打印的时间和文件名」 | 该组件未被图谱单独列出，但由打印进度页引用；未发现逐字门禁。 |
| `print/components/PrintDoneSections.tsx:178` | `任务号 {taskId}` | 删除编号，保留「订单记录已保留，可联系工作人员核查」 | 由打印完成页引用；未发现逐字门禁。 |
| `print/PrintConfirmPage.tsx:571` | 「分享链路」及 `-self-assessment` 文件名 | 「不会提供给企业、机构或其他人查看」；文件名规则不展示给用户 | 图谱未单独显示该文件；未发现逐字门禁。 |

## 简历解析与自我探索

| 文件:行号 | 屏上原文 | 建议改法 | 风险与门禁 |
|---|---|---|---|
| `resume/ResumeParsePage.tsx:186,197,235` | 「返回了另一个编号」「有了编号」「拿到了编号」 | 「刚才那一次返回的结果对不上」「这次结果还不能确认」「结果还不完整」 | 图谱命中 `verify-resume-diagnosis-flow-ui.mjs`、`verify-kiosk-runtime-error-boundary.mjs` 等；未逐字断言。 |
| `resume/ResumeParsePage.tsx:211,226` | 「读取凭证」「本机解析标识」 | 「这次结果暂时无法找回」「请留在此页原样再试一次」 | 同上；未逐字断言。 |
| `resume/ResumeParseOutcomeNote.tsx:131-148` | 「拿到了编号」「按编号再查」「同一次标识」「按同一编号再查结果」 | 「刚才那一次还没有最终结果」「继续查看刚才那一次」「重新开始会算新的一次」 | 该组件由解析页引用；未发现逐字断言。 |
| `resume/SelfAssessmentFlow.tsx:773,781,922,924,1051` | 「记录编号」、真实 `taskId`、`按记录编号读回本次结果` | 删除记录编号；改为「正在读取这次结果」「本次结果仅保留在这台机器上」 | 图谱命中 `verify-w3a-ai-records.mjs`、`verify-kiosk-frontend-debt.mjs` 等；未逐字断言。 |
| `jobs/components/ResumeSelectModal.tsx:54` | 「简历元数据」 | 「简历基本信息」或「仅展示简历名称、时间等信息」 | 图谱命中 `verify-job-ai-ui.mjs`；未逐字断言。 |
| `profile/me/qx/QxMeChrome.tsx:44` | `服务元数据` | 「服务记录摘要」 | 图谱命中 `verify-fusion-w5.mjs` 等；未逐字断言。 |
| `profile/me/MockInterviewRecords.tsx:27` | 「仅展示元数据」 | 「仅展示练习记录摘要」 | 图谱命中 `verify-lightflow-profile-entry.mjs`、`verify-profile-inkpaper-home.mjs`；未逐字断言。 |

## 签名盖章：`/print-scan/sign`

| 文件:行号 | 屏上原文 | 建议改法 | 风险与门禁 |
|---|---|---|---|
| `print-scan/sign-stamp/SignStampWorkbench.tsx:343` | 「一次性请求，没有进度也没有阶段」 | 「这一步一次完成，中途不显示进度」 | 路由为 `/print-scan/sign`；未发现对应逐字门禁。 |

## 反馈弹层

| 文件:行号 | 屏上原文 | 建议改法 | 风险与门禁 |
|---|---|---|---|
| `components/KioskFeedbackDialog.tsx:106,230` | `caught.message` 原样放入错误框 | 统一使用错误码到用户文案的映射；未知错误固定为「提交失败，请联系现场工作人员」 | 图谱命中 `verify-kiosk-feedback-entry.mjs`，但该门禁未逐字禁止 `caught.message`。这是服务端原话直出风险。 |
| `components/KioskFeedbackDialog.tsx:132-143` | 「系统没有重复建单」「反馈编号」并显示 `ticketId` | 「刚才那一次已经提交过，没有重复提交」；不显示编号，改为「如需跟进，请向工作人员说明提交时间」 | 图谱命中 `verify-kiosk-feedback-entry.mjs`；未逐字断言这两句。 |

## 服务端错误原文直出

以下位置不是固定工程词，而是直接把 `Error.message` 或服务端错误字段放到屏幕上，风险更高：

| 文件:行号 | 路由/页面 | 当前行为 | 建议 |
|---|---|---|---|
| `offline-agencies/OfflineAgencyDetailPage.tsx:58,85` | `/offline-agencies/:id` | `err.message` 直接进入详情错误态 | 改用 `userMessageOf` 或按错误码映射。图谱命中 `verify-fusion-w4.mjs`；未逐字断言。 |
| `companies/CompanyDetailPage.tsx:59` | 企业详情页 | `err.message` 直接显示 | 改用稳定用户文案。图谱命中 `verify-fusion-w4.mjs`、`verify-kiosk-frontend-debt.mjs`；未逐字断言。 |
| `profile/me/MyDocumentsPage.tsx:261` | `/me/documents` | `MemberAssetsApiError.message` 直接显示 | 只显示「设置失败，请稍后重试」或按错误码翻译。图谱命中多个 profile 门禁；未逐字断言。 |
| `print/components/PrintFileDeletionRecords.tsx:46-48,90` | `/print/done` 删除记录区 | `MemberAssetsApiError.message` 直接显示 | 改为固定用户文案。图谱命中 `verify-print-confirm-honest.mjs`；未逐字断言。 |
| `resume/SelfAssessmentFlow.tsx:714,821,859` | 自我探索结果/打印/撤回 | `SelfAssessmentApiError.message` 直接显示 | 使用错误码白名单；未知码回退为操作相关文案。图谱命中 `verify-kiosk-frontend-debt.mjs`、`verify-w3a-ai-records.mjs` 等；未逐字断言。 |
| `resume/CareerPlanPage.tsx:98-99,196,278` | `/resume/career-plan` | 任意 `Error.message` 作为 AI 不可用或生成失败原因 | 使用 `userMessageOf`；不要按是否含中文决定可展示性。图谱命中 `verify-ai-down-fallbacks.mjs`、`verify-lightflow-k2a-career.mjs` 等；未逐字断言。 |
| `jobs/JobDetailPage.tsx:395-403`、`jobs/JobsPage.tsx:492-500` | 岗位详情/列表 AI 操作 | 未知 `ApiHttpError` 返回 `err.message` | 使用统一错误翻译。两页图谱均命中 `verify-kiosk-runtime-error-boundary.mjs`；该门禁源码 `123` 行禁止直接展示 `err.message`，但当前调用仍存在。 |
| `auth/MobileQrLoginPage.tsx:243`、`upload/PhoneUploadPage.tsx:327` | 手机登录/手机上传页 | `serverMessage/serverNote` 进入「系统说明」 | 当前来源经过 `accountDisplayMessage` / `uploadSessionUserMessage`，不是无条件原样透传；仍应确认未知码不会回退到服务端原文。 |

## 岗位、招聘会页面中的外部编号

这些不是 `taskId/fileId`，但仍属于用户不需要理解的工程字段：

- `jobs/components/JobDetailSections.tsx:62,269`
- `jobs/components/JobListInsights.tsx:177,223`
- `job-fairs/JobFairDetailPage.tsx:272,285`
- `job-fairs/JobFairCheckinPage.tsx:81,218`
- `job-fairs/FairCompaniesPage.tsx:210`
- `job-fairs/FairMapPage.tsx:399`
- `job-fairs/FairMaterialsPage.tsx:306`
- `job-fairs/components/FairDetailSections.tsx:100`
- `job-fairs/components/FairWorkbenchBits.tsx:105,166`
- `campus/CampusPage.tsx:257`
- `campus/components/CampusTabs.tsx:226`
- `renshi/EligibilityResults.tsx:141`
- `renshi/components.tsx:211`

原文均为「外部编号」。建议统一为「来源信息」或直接隐藏；这些页面在托管 a 口径下还应继续受招聘内容入口门禁控制。相关图谱主要命中 `verify-fusion-w4.mjs`、`verify-job-info-ui.mjs`、`verify-jobfair-ui.mjs`；未发现对「外部编号」完整文案的逐字断言。

## 汇总

按语义合并重复渲染点，本次共发现 **31 条问题项**，涉及：

- **打印/扫描与 U 盘页最多**：图片转 PDF、文件来源、扫描状态、打印进度合计约 20 条。
- **编号暴露集中**：打印任务号、扫描任务编号、简历解析编号、自我探索记录编号。
- **防重复提交用语集中**：图片转 PDF、扫描重试、简历解析。
- **服务端原话直出**：反馈弹层、机构详情、企业详情、我的文档、删除记录、自我探索、职业规划、岗位 AI 操作。
- **明确需要前后端加翻译层的优先项**：所有 `err.message`、`caught.message`、`MemberAssetsApiError.message`、`SelfAssessmentApiError.message` 的屏上出口。

这一轮只做了状态复核、规则读取、代码扫描、路由与门禁取证；没有修改任何文件。