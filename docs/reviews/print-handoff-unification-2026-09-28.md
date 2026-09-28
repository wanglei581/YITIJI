# 一体机打印交接统一方案（商用收口 P0-5，2026-09-28）

> 来源：走查报告 `docs/reviews/kiosk-full-walkthrough-2026-09-27.md` 的 F01、F16、F14、F02、F20、F09、B-14。
> 过程：Claude 子代理只读调查出方案（下面「方案原文」）→ 协调方按代码核实最急的一条 → agy（Gemini 3.8 Flash High）纯推理反方评审 → 协调方取舍（下面「协调方裁定」）。
> 方案原文里的行号以候选 `f662ffb9e` 为准。

## 协调方裁定（执行以本节为准）

**一、先修最急的：生产上 AI 产物打印会被拒单（已按代码核实，未在真实后端跑过）。**
生产发布脚本与启动门禁都强制 `PRINT_REQUIRE_PII_SCAN=true`（`.github/scripts/deploy-api-release.sh`、`services/api/src/config/production-runtime-gates.ts`）。建单闸门（`services/api/src/print-jobs/pii-scan-gate.ts`）对用途为 `resume_upload / resume_scan / print_doc / id_scan`、资产类别不是 `derived / optimized` 的文件，要求已完成的隐私检查。岗位匹配、职业规划、模拟面试报告与题目单、小青作业、参会准备单 6 处生成 PDF 时 `purpose: 'print_doc'`、没传资产类别（默认 `original`），前端又直接跳报价确认页、从不经过材料检查（隐私检查任务只由材料检查创建），所以在生产上点确认会被拒。建单服务的注释写明派生产物（含 AI 生成的报告）本意就是放行。

- 取 (b)：这 6 处上传补 `assetCategory: 'derived'`（与已有的诊断报告导出、图片转换、脱敏副本同一口径）；用户自己的原件——扫描结果「直接打印」、诊断失败「打印原件」、「我的文档」里的原件——改走打印台材料检查。
- 不采纳 agy 的「标派生会让报告从我的文档消失」：「我的文档」按本人、有效期、用途筛，不按资产类别筛（`member-assets.service.ts` 的 `listDocuments`）；派生只是多了会员自愿延长保存的选项，默认期限不变。
- 不采纳 agy 的「生成时自动扫描并自动放行」：自动放行等于不检查，只多一条记录；AI 报告里用户自己粘贴的岗位要求属于用户为自己打印的材料，不是「用户原始材料」这道闸要管的对象。记为以后可选的加固（生成时自动识别、只记审计）。
- 采纳 agy：原件改走检查之前必须补齐 `fileId`（诊断失败原件、我的文档都缺）；第一批要有一条在 `PRINT_REQUIRE_PII_SCAN=true` 下的建单回归测试，含「未检查的原件被拒」的阳性对照。

**二、第二、三批合并成一次上线，或第二批保留兼容层。** 采纳 agy：打印链四页若先删掉读临时状态、而 22 个来源还没迁移，过渡期所有入口都会落空态。做法：来源迁移完成之前，打印链「上下文优先、临时状态兜底」；全部来源迁完并验证后，再摘掉兜底。

**三、按 agy 修改的几处：**
- 交接编号对不上（「被替换」）时不提供「看当前这一份」的切换：当场作废旧单，提示「这一单已失效，请重新发起」。公共终端上更新的那一份可能属于下一位。
- 建单成功后上下文标记为已建单：从收银页「返回确认页」只能看这一单的状态，不能拿同一份上下文再建第二单。
- 材料任务报 403/404/410 时的清场只清对应交接编号的上下文，不误清已经换成的新文件。
- AI 产物打印链接 5 分钟与交接 30 分钟冲突：随第二批把 AI 产物打印链接放宽到 30 分钟（同步改 `verify-ai-artifact-print-url-contract.mjs`），与上传、图片转换一致。
- sessionStorage 写不进时给诚实提示「本机暂时无法保存打印信息，请找现场工作人员」，不静默退回。

**四、维持原方案的几处：**
- 会员刷新后上下文判为不符并清掉（隐私优先；文件在「我的文档」里能找回）。agy 建议的「刷新后 60 秒内可重新绑定」要存会员身份的可比对标记，不做。
- 游客中途登录沿用「视为同一人继续办理」（产品已定）；风险是上一位没点结束、闲置清场还没到点时下一位直接登录，会接走上一位的文件——这是现有行为，本方案不加重；可选加固见方案原文第 5 条第 11 项（清场代次）。

**五、待产品负责人定：**
- 本机没开通彩色 / 双面时，报价确认页是「自动改成能打的参数、在价格旁逐项写明、主按钮照常可点」（推荐：用户按主按钮本身就是对显示价格的确认），还是按 2.0 稿 14 进拦截屏、让用户回预览改参数。agy 主张中间做法：先弹「参数已按本机能力调整」卡、用户点「确认调整」后才亮支付按钮。
- 部署时正在办理的旧结构会话：丢掉（推荐）还是按游客升级。

**六、分批：**
1. 第一批：服务端 6 处标派生 + 原件改走检查（补 fileId）+ 生产开关下的建单回归测试 + 相关浏览器用例。
2. 第二、三批（同一次上线）：交接上下文内核、打印链四页（先把登录回跳、返回预览两个复现用例在旧代码上跑红）、22 个来源迁移、参数求交（F02、F20，按第五条的拍板）、小青作业进打印链（F09）、B-14、AI 产物链接 30 分钟。

---

## 方案原文（Claude 子代理只读调查，2026-09-28）


**结论先说：** 同一份打印文件现在有两个来源、两种相反的读法。打印台和预览信「打印材料会话」，报价确认页信跳转时带的临时状态（router state）；而 16 个来源只带临时状态、不写会话。一旦跳转丢了临时状态（返回预览、登录回跳、旧地址重定向），页面就退回会话里那一份——可能是别人的、或上一次的文件。

方案是：扩展现有会话，做成唯一的「打印交接上下文」（带交接编号、来源、归属、有效期、参数建议）；来源整份写入，打印链各页只认它，并校验归属。

另外查到一个比交接更急的问题，需要先拍板（第 5 条第 1 项）：按代码推演，岗位匹配、职业规划、模拟面试、小青作业、扫描结果、诊断失败原件这些来源直达报价页，在生产上会被隐私门禁拒单。

> **口径**
> - 只读调查：没改文件，没做 git 写操作，没跑浏览器和门禁。按协调方要求在此收口，没查完的列在第 5 条。
> - 以下路径均相对仓库根。打印链文件只写文件名，指 `apps/kiosk/src/pages/print/` 下同名文件。
> - 本工作树实际在 `claude/codex-task-history-progress-0de1dc`（HEAD `5a46a2981`），不是任务包写的 w2 分支。它与候选 `f662ffb9e` 只差 `docs/design/` 下 9 个 html，`apps/`、`services/`、`packages/` 与候选一致，行号可直接用。工作树里另有别的会话没提交的 `docs/design/` 改动，与本方案无关。
> - 走查报告里 F01/F16/F14 在第 68 行，F02 在第 69 行（任务写 66–69，其中 66–67 是 F06、F03）。修法在 155–158 行。F20、F09、B-14 分别在 104、76、84 行。

---

## 1. 现状地图

### 1.1 现有「打印材料会话」

| 项 | 现状 | 证据 |
|---|---|---|
| 存哪 | `sessionStorage['ai-job-print:current-print-material-check']` | `printMaterialSession.ts:4` |
| 字段 | 有：文件（名称、大小、页数、fileId、fileUrl、哈希、类型）、source（只有 resume 或 document）、内容类别、4 个材料任务（含匿名 accessToken）、检查结论、打印参数、更新时间。<br>没有：交接编号、细分来源、归属、创建时间、有效期、参数建议 | `printMaterialSession.ts:6-16,74-86` |
| 写 | 整份写一种；合并写一种（换了文件也保留旧任务、旧参数、旧 source）；保存时按白名单过滤字段 | `:203-210`、`:212-223`、`:176-188` |
| 读 | 只校验文件字段的形状，不看时效、不看归属 | `:190-201` |
| 已清的时机 | 登出、会员换人、闲置或结束使用、进屏保、换引导票（C-02 已修，提交 `6825c664a`）；流程内：建单成功、完成页、上传页换文件、材料任务报 403/404/410 | `apps/kiosk/src/auth/kioskSensitiveSession.ts:35-44,64-77`；`apps/kiosk/src/auth/AuthContext.tsx:49-53,70-93`；`apps/kiosk/src/auth/KioskPrivacyGuard.tsx:315-341,347-371`；`apps/kiosk/src/services/terminalAuth.ts:87-107`；`PrintConfirmPage.tsx:410`；`PrintDonePage.tsx:164-167`；`PrintUploadPage.tsx:384-390`；`PrintMaterialCheckPage.tsx:378-380` |
| 不清的时机 | 游客中途登录（产品口径「视为同一人继续办理，打印材料仍在」）；回首页、换去别的功能也不清 | `AuthContext.tsx:47-61` |
| 门禁 | 这个文件被 W2 门禁按哈希逐字节冻结 | `apps/kiosk/scripts/verify-fusion-w2-print-scan.mjs:57-61` |

### 1.2 进打印的来源

表中「只带临时状态」= 只把文件放在 router state 里跳转，不写会话。

| # | 来源 | 触发点 | 交接方式 | 落到哪一步 | 文件身份 / 链接时效 | 默认参数 | 服务端文件用途·类别（决定生产隐私门禁） |
|---|---|---|---|---|---|---|---|
| 1 | 普通上传（本机、扫码、U 盘） | `PrintUploadPage.tsx:244-252`（上传成功即写）、`:374-382` | 整份写会话 + 临时状态 | 材料检查 → 打印台 | fileId + 签名链接 30 分钟（`services/api/src/files/files.controller.ts:63,133-174`） | 在预览里设 | print_doc 或 resume_upload · 原件 |
| 2 | 诊断报告 / 修改清单 | `apps/kiosk/src/pages/resume/components/resume-report/ResumeReportTakeaway.tsx:164-179` | 只带临时状态 | `/print/confirm` | fileId + 打印链接 5 分钟 | 黑白单面 | 派生（`services/api/src/ai/resume-report-export.controller.ts:107-115`） |
| 3 | 诊断失败「打印原件」 | `apps/kiosk/src/pages/resume/components/ResumeDiagnosisFailExits.tsx:46-61` | 只带临时状态 | confirm | **没有 fileId** | 黑白单面 | resume_upload · 原件 |
| 4 | 优化稿 | `apps/kiosk/src/pages/resume/ResumeOptimizePage.tsx:229-238` | 只带临时状态 | confirm | fileId + 打印链接 5 分钟 | 黑白单面 | 优化稿类（`services/api/src/ai/ai.service.ts:873-899`）。另：导出后自动弹出的预览层（`:210,:431-433`）盖住「去打印优化版」（`apps/kiosk/src/pages/resume/components/resume-deliver/ResumeDeliverPanel.tsx:156`），即 B-14 |
| 5 | AI 生成草稿 / 生成预览 | `apps/kiosk/src/pages/resume/ResumeGeneratePage.tsx:264-281`、`ResumeGeneratePreviewPage.tsx:198-215` | 只带临时状态 | confirm | 同上 | 黑白单面 | 优化稿类 |
| 6 | 图片转 PDF | `apps/kiosk/src/pages/print-scan/ConvertImagesPage.tsx:246-261` | 整份写会话 + 临时状态 | 打印台检查 | fileId + 签名链接 30 分钟 | — | 派生。**与走查说的「没写会话」不符**：`:257` 自 9/8（`843ed54c7`）起就写。真正的问题是「先登录再保存」直接跳 `/login`、不带回跳（`:295,:365`），生成结果只在页面内存里 |
| 7 | 签名盖章 | `apps/kiosk/src/pages/print-scan/sign-stamp/useSignStampFlow.ts:313-326` | 写会话 + 临时状态 | 打印台检查 | 同上 | — | 派生 |
| 8 | 小青作业 | `apps/kiosk/src/pages/ai-plan/AiPlanPage.tsx:136-158` | **不进打印链**，只生成打印稿 | 无 | 响应里有 fileId 和 5 分钟打印链接（`apps/kiosk/src/services/api/advisor.ts:62-92`；`services/api/src/advisor/advisor-artifact.service.ts:136`） | — | print_doc · 原件（`advisor-artifact.service.ts:106-114`）。<br>页面固定写「已保存到我的文档」（`AiPlanPage.tsx:219-221`），但文件归属跟顾问会话走（`services/api/src/advisor/advisor.service.ts:381-384`），匿名时为空，而「我的文档」只列会员文件（`apps/kiosk/src/services/api/memberAssets.ts:120-126`）。<br>v2 稿 52 已改成「生成后直接进打印，先看预览和价格」（`docs/design/kiosk-redesign-2026-08-v2/52-advisor-artifact.html:220,541-547`） |
| 9 | 求职材料 | `apps/kiosk/src/pages/resume/JobMaterialLibraryPage.tsx:285-299` | 只带临时状态 | confirm | **没有 fileId** | `duplex: pageCount > 1 ? 'double' : 'single'`（`:296`），被归一成长边双面（`packages/shared/src/types/print.ts:299-305`） | 派生；生成前要登录（`:254-258`） |
| 10 | 我的文档 | `apps/kiosk/src/pages/profile/me/MyDocumentsPage.tsx:151-181` | 只带临时状态 | confirm | **没有 fileId**（其实 `doc.id` 就是文件 id，`packages/shared/src/types/memberAssets.ts:62-64`），页数为空 | 黑白单面 | 视文件而定（列表里带用途和类别） |
| 11 | 岗位匹配 | `apps/kiosk/src/pages/resume/JobFitPage.tsx:473-498`、`JobFitActionsPage.tsx:214-247` | 只带临时状态 | confirm | fileId + 打印链接 5 分钟 | 黑白单面 | print_doc · 原件（`services/api/src/ai/resume/job-fit.service.ts:246-253`） |
| 12 | 职业规划 | `apps/kiosk/src/pages/resume/CareerPlanPage.tsx:285-315` | 只带临时状态 | confirm | 同上 | 同上 | print_doc · 原件（`services/api/src/ai/resume/career-plan.service.ts:293-300`） |
| 13 | 自我探索 | `apps/kiosk/src/pages/resume/SelfAssessmentFlow.tsx:831-846` | 只带临时状态 | confirm | 同上 | 同上 | 自我探索报告（不在隐私门禁的用途清单里） |
| 14 | 模拟面试题目单 / 报告 | `apps/kiosk/src/pages/interview/InterviewSetupPage.tsx:271-300`、`InterviewReportPage.tsx:128-153` | 只带临时状态 | confirm | 同上 | 同上 | print_doc · 原件（`services/api/src/mock-interview/mock-interview.service.ts:469-476,530-537`） |
| 15 | 扫描结果「直接打印」 | `apps/kiosk/src/pages/scan/ScanResultPage.tsx:246-270` | 只带临时状态（先清扫描登记） | confirm | fileId + 签名链接 | 黑白单面 | 简历扫描 / 证件扫描 / print_doc · 原件（`services/api/src/scan-tasks/scan-tasks.service.ts:140-145`） |
| 16 | 招聘会资料、参会准备单、企业（托管 a 已关，b 版本保留） | `apps/kiosk/src/pages/job-fairs/FairMaterialsPage.tsx:103-126`（`:122` 也写死双面）；`FairVisitPlanPage.tsx:185-210`（`:202` 同）；`FairCompanyDetailPage.tsx:99-123`（写会话并跳 `/print/preview`） | 前两处只带临时状态 | confirm / 预览 | — | 两处写死双面 | 招聘会资料 · 派生；参会准备单是 print_doc · 原件（`services/api/src/ai/resume/fair-visit-plan.service.ts:175-182`） |
| 17 | 「我的」页本次记录 | `apps/kiosk/src/pages/profile/ProfilePage.tsx:101-108` | 写会话（没有 fileId 和链接）+ 跳 `/print/preview` | 只能落到「重新选择文件」 | — | — | 全仓没有页面给 /profile 传这些记录（只有 `:37-46` 在读），实际是死路径 |
| 18 | 建单后「返回确认页」 | `PrintCashierPage.tsx:473-475`、`PrintProgressPage.tsx:370,376` | 带整份建单信息回确认页 | confirm | — | — | 建单时会话已被清（`PrintConfirmPage.tsx:410`） |

### 1.3 打印链各页从哪里读文件身份

| 页 | 读法 | 证据 |
|---|---|---|
| 打印台 `/print/desk` | **会话优先**：`session?.file ?? locationState?.file`，检查结论同样 | `PrintDeskPage.tsx:32-37` |
| 材料检查（`?step=check`） | 两边 fileId 不同时临时状态优先，挂载时把临时状态里的文件合并进旧会话。<br>但走到这一步时临时状态已被重定向或切换步骤（`setSearchParams`）丢掉，实际只读会话 | `PrintMaterialCheckPage.tsx:236-243,386-394`；`PrintDeskPage.tsx:54-56` |
| 预览与参数（`?step=preview`；旧的 `/print/params` 已并入） | **会话优先**。份数、方向、缩放、页码从会话恢复；彩色、双面固定取基线（黑白单面） | `PrintPreviewPage.tsx:144-157,171-178`；`apps/kiosk/src/routes/index.tsx:220` |
| 报价确认 `/print/confirm` | **临时状态优先**：`state?.file ?? restoredSession?.file`，参数、检查结论、source 同样。<br>页头「返回预览与参数」跳 `/print/preview`，不带状态；登录按钮用当前地址生成回跳 | `PrintConfirmPage.tsx:135-138,164-166,197,602,639`；登录按钮在 `components/PrintConfirmView.tsx:241-247` |
| 登录回跳 | 回跳地址 = 路径 + 查询串；登录后替换跳回，不带状态 | `apps/kiosk/src/auth/returnPath.ts:9-14`；`apps/kiosk/src/pages/auth/LoginPage.tsx:54-58,67-69`；`apps/kiosk/src/pages/auth/loginGateModel.ts:118-133` |
| 旧地址重定向 | `/print/material-check`、`/print/preview` 用重定向组件跳走，没传状态；该组件只转发显式传入的状态，所以跳完后临时状态全丢 | `apps/kiosk/src/routes/index.tsx:214-215`；react-router 实现见 `node_modules/.pnpm/react-router@7.18.1…/dist/development/chunk-KS7C4IRE.mjs:6994-7025` |

**根因：** 同一份文件有两个来源、两种相反的优先级；1.2 表里 16 个跳转点只带临时状态。只要某次跳转丢了临时状态，页面就退回会话里那一份。

---

## 2. 复现路径（按代码推演，未实跑）

### 2.0 会话里为什么会留着另一份文件 A
下面任何一条都会留下：
- 在上传页上传成功就写会话，不点「下一步」也留下（`PrintUploadPage.tsx:244-252`）。
- 走过检查、预览但没建单。只有建单成功（`PrintConfirmPage.tsx:410`）和完成页（`PrintDonePage.tsx:164-167`）才清。
- 上一位游客没点「结束」就走了，隐私闲置清场默认 300 秒（`KioskPrivacyGuard.tsx:24`）没到点，下一位一碰屏就重置了计时。
- 游客中途登录不清会话（`AuthContext.tsx:53-61`）。

### 2.1 场景②：点「返回预览」换成了 A
1. 在优化稿页点「去打印优化版」，带着 B 跳到确认页（`ResumeOptimizePage.tsx:229-238`）；会话里仍是 A。
2. 确认页临时状态优先，显示 B（`PrintConfirmPage.tsx:137`）。
3. 点页头「返回预览与参数」，跳 `/print/preview`，不带状态（`:602`）。
4. `/print/preview` 被重定向到 `/print/desk?step=preview`，状态为空（`routes/index.tsx:215`）。
5. 打印台读会话拿到 A；A 的检查结论齐全，放行预览（`PrintDeskPage.tsx:34-37`；`printDeskModel.ts:64-90`）。
6. 预览页同样会话优先，画出 A 的预览和页数（`PrintPreviewPage.tsx:145-149`）。
7. 用户点「下一步：核对价格」，A 被写回会话并带去确认页（`:293-294`），之后报价、建单都是 A。

如果会话是空的，第 5 步落到「这一页没有待处理的文件」（`PrintMaterialCheckPage.tsx:483-551`、`PrintPreviewPage.tsx:298-327`），就是丢文件。

### 2.2 场景①：从 AI 结果直达报价页后点登录，回来丢文件或换成 A
1. 同 2.1 第 1–2 步：B 在临时状态里，A 在会话里。
2. 游客的权益卡上有「去登录查看我的权益」（`PrintConfirmView.tsx:241-247`），点了跳 `/login?from=%2Fprint%2Fconfirm`（`PrintConfirmPage.tsx:639`；`returnPath.ts:9-14`）。
3. 登录成功。游客转会员不清会话（`AuthContext.tsx:53-61`）；登录页替换跳回 `/print/confirm`，不带状态（`LoginPage.tsx:67-69`）。
4. 确认页重新加载，临时状态为空，于是读会话里的 A（`PrintConfirmPage.tsx:136-138`）。报价和建单都用 A 的链接（`:188,:215-217,:401-408`），这就是「换文件」。如果会话是空的，页面判定没有文件，落到「没有待确认的任务」（`:197`；`printConfirmModel.ts:91`），这就是「丢文件」。
5. 即使回来的是对的文件，AI 产物的打印链接默认只有 5 分钟（`services/api/src/files/signing.ts:19,31-40`；例如 `job-fit.service.ts:271`、`advisor-artifact.service.ts:136`）。收短信登录一慢就过期：报价报「页数识别不了」（`services/api/src/print-jobs/print-page-count.service.ts:48-50`），建单报「链接无效」（`services/api/src/print-jobs/print-jobs.service.ts:263-273`），页面只给一句泛泛的原因（`PrintConfirmPage.tsx:222-228`）。

### 2.3 同一根因的其他路径
- **「返回打印台」：** 确认页交接出错时的「返回打印台」同样不带状态，也会落到会话里的 A（`PrintConfirmPage.tsx:538`）。
- **检查页回写竞态：** 检查过程没有「离开页面就取消」，并用当时记住的旧文件合并写会话（`PrintMaterialCheckPage.tsx:274-280,287-384`）。检查 A 的途中离开、改去打 B，A 的检查结果回来时会把 A 写回会话。
- **刷新：** 会员登录态只存在内存里（`AuthContext.tsx:9-16`），看门狗刷新后变成游客，但会话还在，打印台照样复水出那份文件（设计本意见 `PrintDeskPage.tsx:24-28`）。风险低，但属于没校验归属。
- **F20：** 预览页的彩色、双面初值固定取基线（`PrintPreviewPage.tsx:172-173`）。而且能力还在加载时一律按「不可用」算（`apps/kiosk/src/hooks/usePrintParamCapability.ts:39-43`），`:189-192` 会先把颜色、双面降级。所以即使本机已开通，只改初值也不够。
- **F02：** 确认页只要参数超出本机能力，就进「参数不可用」屏、不报价（`PrintConfirmPage.tsx:159,202-207`；`printConfirmModel.ts:92`）。「返回改参数」是回上一页（`:325-328,:542`），回到的求职材料页没有参数控件，于是锁死。视图里本来有一条不拦人的提示「已改回目前能打的参数」（`PrintConfirmView.tsx:381-383`），因为上面那个判定永远先命中，这条提示永远出不来。能力加载中还会闪一下拦截屏。

### 2.4 在旧代码上变红的测试
具体见 4.5 的 H1、H2。思路：先写一份旧会话 A，再从真实来源页（优化稿）把 B 送到确认页，然后分别走「去登录 → 回来」和「返回预览与参数」，断言屏幕上和报价请求里都是 B，不出现 A。旧代码上两条都会红：有 A 时显示 A；没有 A 时落空态。

---

## 3. 方案

### 3.1 放在哪里、谁写谁读、有效期
- **扩展现有会话，不另起新存储位置。** 同一个 sessionStorage 位置，升级为「打印交接上下文 v2」。
  - 好处：它已经在清场清单里，第 1.1 节列的清场时机全部自动覆盖；打印台本来就从它复水。
  - 代价：`printMaterialSession.ts` 被门禁冻结，要重冻哈希（第 5 条第 6 项）。
- 仍放 sessionStorage：不放 localStorage，关掉标签就失效更安全；本期不建服务端表。
- **谁写：** 只有来源能整份写入（`beginPrintHandoff`）；打印链各页只能按交接编号打补丁（检查结果、参数、建单标记）。
- **谁读：** 打印台、材料检查、预览、确认。
- **清：** 清场清单不变，另外读到失效就当场清。
- **有效期：** 建议创建后 30 分钟封顶，和一体机上传、图片转换的签名链接一致（`files.controller.ts:63`；`services/api/src/print-conversion/print-conversion.service.ts:27`）。文件链接自己的到期另算（第 5 条第 3、4 项）。

### 3.2 字段

| 字段 | 说明 | 新 / 旧 |
|---|---|---|
| 版本号 `v` | 2 | 新 |
| 交接编号 `contextId` | 随机编号；只放在临时状态和存储里，不进网址 | 新 |
| 细分来源 `origin` | upload / scan_result / resume_report / resume_original / resume_optimize / resume_generate / image_convert / sign_stamp / advisor_artifact / job_material / my_documents / job_fit / career_plan / self_assessment / interview_report / interview_practice / fair_material / fair_visit_plan / fair_company | 新 |
| `source` | 保留 resume 或 document，只用来回上传页（门禁在查这个字段） | 旧 |
| 返回路径 `returnPath` | 站内路径，只取路径部分，给「回到上一步 / 重新生成」用 | 新 |
| 文件 `file` | 原结构，但 **fileId 必填**（我的文档、求职材料、诊断原件要补上） | 旧，收紧 |
| 链接到期时间 `fileUrlExpiresAt` | 从打印链接里的 `expires` 参数解析（格式见 `signing.ts:38`）；解析不出就视为未知，不拦 | 新 |
| 归属 `owner` | 游客，或「会员 + 本次登录的随机标记」。标记在登录时于内存生成，**不存会员 id、手机号、令牌** | 新 |
| 创建时间 / 失效时间 | — | 新 |
| 检查策略 `checkPolicy` | 必须检查 / 免检查，由 3.5 的入口表给出 | 新 |
| 参数建议 `paramsSuggestion` | 来源给的建议（如两页以上建议双面），只是建议 | 新 |
| 打印参数 `printParams` | 用户最后确定、并已与本机能力求交的参数 | 旧 |
| 材料任务、检查结论、内容类别 | 原样保留 | 旧 |
| 建单标记 `orderId` / `orderedAt` | 如采纳第 5 条第 7 项 | 新，可选 |

**关于「匿名访问令牌」：** 游客打印凭的是文件里那条服务端签名链接，材料检查的匿名 accessToken 已经存在任务字段里，所以不另存令牌。客户端能认定的游客归属只到「本机这一次办理」；要不要做服务端交接凭据，列在第 5 条第 11 项。

### 3.3 读写规则
新建 `apps/kiosk/src/pages/print/printHandoff.ts`，存储仍用 `printMaterialSession.ts`：
- **`beginPrintHandoff(输入, 归属)`**：整份覆盖，生成新编号；旧任务、旧检查结论、旧参数一律不带过来。这修掉了「换文件时合并旧数据」的问题。
- **`readPrintHandoff(当前归属, 当前时间)`**：返回 正常 / 无 / 归属不符 / 已过期 / 结构不对 五种结果。不正常时当场清掉存储，返回值里不带旧文件的任何信息。
- **`patchPrintHandoff(交接编号, 补丁)`**：编号对不上就不写。这修掉了 2.3 的检查页竞态。
- 清除函数 `clearPrintMaterialSession` 保留，清场清单不动。
- 旧结构（v1）怎么处理，见第 5 条第 5 项。

### 3.4 归属校验与提示

| 存的是 | 现在是 | 结果 |
|---|---|---|
| 游客 | 游客 | 通过 |
| 游客 | 会员 | 通过（沿用「中途登录视为同一人」，`AuthContext.tsx:47`），并改绑到这位会员 |
| 会员（本次登录的标记） | 同一次登录 | 通过 |
| 会员 | 游客、另一位会员、或刷新后（标记已丢） | 不符：清掉并提示 |

- **归属不符时：** 打印台、预览落到现有空态，确认页落到「交接出错」态。提示语：「这份文件属于上一位使用者，或登录身份变了，为保护隐私已清除。请重新选择文件。」**不显示旧文件名、页数、价格**；按钮只有「重新选文件」和「回到上一步」。
- **被替换时：** 确认页的临时状态只带交接编号。它和存储里的对不上时，提示「这一单已被新的打印文件替换」，要用户点「看当前这一份」才切过去，不悄悄换。
- **游客与游客之间：** 同一个 sessionStorage，客户端分不出来。只能靠闲置清场、「最新一次交接整份覆盖」和 30 分钟封顶；可选的加固见第 5 条第 11 项。

### 3.5 每个来源怎么改
- **统一两步：** 先 `const ctx = beginPrintHandoff({...}, 当前归属)`，再带着 `{ printContextId: ctx.contextId }` 跳到入口。临时状态里不再放文件和参数。
- 来源代码里仍保留 `fileUrl: x.printFileUrl` 这种写法，好让 `verify-ai-artifact-print-url-contract.mjs` 继续防止误传下载链接。
- **入口和检查策略集中在一张表**（新建 `printHandoffPolicy.ts`），先按服务端现状填：

| 来源 | 生产隐私门禁 | 建议入口 |
|---|---|---|
| 普通上传、图片转 PDF、签名盖章 | 原件需要检查；转换、签章是产品选择先查 | 打印台检查（维持） |
| 诊断报告、优化稿、AI 生成、求职材料、自我探索、招聘会资料和企业 | 不需要（派生、优化稿，或不在门禁用途内） | 报价页（维持）；「返回预览」进免检查的参数页 |
| 扫描结果、诊断失败原件 | **需要**（原件） | **未决**：现在直达报价，生产上会被拒单（第 5 条第 1 项） |
| 岗位匹配、职业规划、参会准备单、面试报告、面试题目单、小青作业 | **需要**（print_doc · 原件） | **未决**：先进打印台检查，还是服务端改成派生（第 5 条第 1 项） |
| 我的文档 | 看文件的用途和类别 | 原件进打印台检查，派生进报价页（第 5 条第 1 项） |

- **小青作业（F09）：** 生成打印稿成功后写上下文，按上表入口进打印链，和 v2 稿 52 一致。「已保存到我的文档」只在服务端明确说已保存时才显示（服务端要新增 `savedToDocuments` 字段），否则不写。
- **求职材料和招聘会两处（F02）：** `JobMaterialLibraryPage.tsx:296`、`FairVisitPlanPage.tsx:202`、`FairMaterialsPage.tsx:122` 不再把双面写死进参数，改为写「参数建议：两页以上建议双面」。求职材料同时补上 `fileId`。
- **我的文档：** 补 `fileId: doc.id`，按用途和类别定检查策略。
- **诊断失败原件：** 补 fileId，入口见第 5 条第 1 项。
- **图片转 PDF（推断是 F14）：** 「先登录再保存」改成带回跳的登录；离开前把生成结果写成上下文，登录回来后「拿这份 PDF 去打印」仍可用。「登录后保存进我的文档」服务端没有认领接口，做不到，文案或接口待定（第 5 条第 10 项）。
- **B-14：** `apps/kiosk/src/components/FilePreviewDialog.tsx` 加一个可选主按钮「去打印这一份」，优化稿页和生成预览页都接到各自的打印处理（`ResumeOptimizePage.tsx:431-433`；`ResumeGeneratePreviewPage.tsx:192`）。
- **收银页、进度页「返回确认页」：** 只带交接编号（取决于第 5 条第 7 项）。
- **「我的」本次记录、合同报告分支：** 都是死路径，见第 5 条第 13 项。
- **带身份闸的页面**（`JobFitActionsPage`、`CareerPlanPage` 里的 `isLive(run)`）：只在身份仍有效时才写上下文。

### 3.6 打印链各页只认上下文
- **打印台**（`PrintDeskPage.tsx`、`printDeskModel.ts`）：只用 `readPrintHandoff`，异常时带理由落空态。免检查的上下文没有检查结论也可以进预览；`?step=preview` 仍只表示意图、不等于授权。
- **材料检查**（`PrintMaterialCheckPage.tsx`）：删掉读临时状态和挂载时合并写（`:236-243,:386-394`）；所有写入都走按编号打补丁。
- **预览**（`PrintPreviewPage.tsx`）：只读上下文；参数初值和求交见 3.8；参数一改就写回；「返回材料检查」直接跳 `/print/desk?step=check`。
- **确认**（`PrintConfirmPage.tsx`）：
  - 删掉从临时状态读文件、读参数这两条（`:137-138,:164-166`）；
  - 增加三种失效态：归属不符、已过期、被替换；
  - 「返回预览与参数」直接跳 `/print/desk?step=preview`，不再经过重定向；
  - 参数处理按 3.8，建单后按第 5 条第 7 项。
- 旧地址的重定向保留，给旧收藏和旧二维码用；站内导航不再依赖它。

### 3.7 登录回跳怎么带回（不把文件身份放进网址）
1. **离开前先存：** 确认页把当前（已求交的）参数写回上下文；预览页的参数随改随写。
2. **去登录：** 新增 `loginPathForPrintStep()`，或改用登录页已支持的「通过跳转状态传回跳地址」（`LoginPage.tsx:54`、`loginGateModel.ts:123-127`）。回跳地址只放路由路径（`/print/confirm` 或 `/print/desk?step=preview`），不带 fileId、链接、交接编号，也不带确认页原来的查询串——确认页的查询白名单里有 `fileId`（`apps/kiosk/src/pages/print/printConfirmQuery.ts:12-24`），而现在生成回跳地址时会把查询串原样带上。
3. **回来后依次检查：** 读上下文 → 归属（游客转会员视为通过）→ 有效期 → 链接是否到期。
   - 会员名下的文件链接到期：可以用 `/files/:id/preview-url` 换一条新的（`files.controller.ts:251-282`，「我的文档」已在用）。
   - 游客的文件换不了新链接：提示「打印链接已过期，回到上一步重新生成」，并跳回返回路径；或者按第 5 条第 4 项由服务端放宽时效。
4. **游客登录后不写「已保存」：** 文件在服务端仍不属于任何人，不会进「我的文档」，页面不能说已保存。

### 3.8 参数与本机能力求交集
- **能力以服务端为准：** 按每台终端的登记，彩色、双面没登记就拒绝（`services/api/src/terminals/terminal-capabilities.types.ts:100-128`；`terminal-capabilities.service.ts:199-235`）。报价（`services/api/src/payment/order-quote.service.ts:69-71`）和建单（`print-jobs.service.ts:411-415`）都会按这个拒绝。
- **一体机怎么读：** `GET /terminals/:id/capabilities`（`services/api/src/terminals/terminals.controller.ts:223-229`）→ `apps/kiosk/src/services/api/printScanCapabilities.ts:42-66` → `usePrintParamCapability`（`hooks/usePrintParamCapability.ts:45-77`）。只认「已配置且可用」。
- **新增纯函数 `negotiatePrintParams(请求参数, 本机能力)`**，放在 `packages/shared/src/types/print.ts`，紧挨现有的收口函数（`:266-277`），返回三样：
  - 求交后的参数；
  - 调整清单：改了哪项、为什么（用现成的拒绝理由文案）；
  - 是否还在等：能力还在加载、且请求里有彩色或双面时为「等」。
- **确认页：**
  - 还在等时停在「正在计算本次费用」，不报价，也不闪拦截屏；
  - 否则按求交后的参数报价，主按钮可点；
  - 有调整时，把那条现成的提示接回来（`PrintConfirmView.tsx:381-383`；门禁要求保留原句「彩色或双面本机暂未开通，已改回目前能打的参数」），再逐项说明，例如「双面改为单面，预计多用 N 张纸」（用 `printUsageEstimate.ts` 算）；
  - 权益卡的显示条件从「参数没被收口」改成「不在等」（`PrintConfirmPage.tsx:198`）；
  - 求交后的参数写回上下文。
- **预览页（修 F20）：**
  - 初值依次取：上下文里的参数 → 来源建议 → 基线；
  - 降级只在能力加载完成后才做（`PrintPreviewPage.tsx:189-192` 加上「已加载完」的条件）；
  - 降级时逐项说明，把 `:487` 那句提示推广开；
  - 基线常量保留作兜底（门禁在查）。
- 服务端不用改：前端送去的已经是求交后的参数，服务端照旧兜底。
- 这和稿 14 的「本机未开通就强制进拦截屏」冲突，见第 5 条第 2 项。

### 3.9 与闲置清场、会话清除的关系
- **存储位置不变，现有清场全部自动覆盖：** 登出、会员换人、闲置或结束使用、进屏保、换引导票、完成页都会一并清掉上下文。「本机还有没有敏感信息」仍按这个位置判断（`kioskSensitiveSession.ts:96-111`），闲置提醒不受影响。
- **新增的清除点：** 读到结构不对、已过期、归属不符时当场清；新交接整份覆盖旧的；建单后打标记或清掉（第 5 条第 7 项）。
- **会员标记只在内存里：** 登出或刷新就没了，所以刷新后会员的上下文会被判为不符并清掉（修掉 2.3 的「刷新后游客看到会员的文件」）。
- **浏览历史更干净：** 跳转时只带交接编号，历史记录里不再留文件名和签名链接。现在的临时状态里有这些，建单后还会把整份文件信息带进收银页（`PrintConfirmPage.tsx:411-423`）。

---

## 4. 改动清单与工作量

### 4.1 一体机（`apps/kiosk/src/`）

| 文件 | 改什么 |
|---|---|
| `pages/print/printMaterialSession.ts` | 加 v2 字段；保存和读取带上新字段并校验；处理旧结构；重冻哈希 |
| 新建 `pages/print/printHandoff.ts`、`printHandoffPolicy.ts` | 写入 / 读取 / 打补丁、归属标记、有效期、链接到期解析、入口策略表 |
| `pages/print/PrintDeskPage.tsx`、`printDeskModel.ts` | 只读上下文、免检查分支、失效态提示 |
| `pages/print/PrintMaterialCheckPage.tsx` | 去掉读临时状态和合并写；按编号打补丁 |
| `pages/print/PrintPreviewPage.tsx` | 只读上下文、修 F20、参数随改随写、免检查、返回检查直达 |
| `pages/print/PrintConfirmPage.tsx`、`printConfirmModel.ts`、`components/PrintConfirmView.tsx` | 只读上下文、三种失效态、自动回落并提示、返回预览直达、登录前先存、建单后处理 |
| `auth/returnPath.ts` | 新增 `loginPathForPrintStep` |
| 来源共 22 个文件（1.2 表第 1–17 行） | 改成先写上下文、只带交接编号；补 fileId；双面改成建议 |
| `pages/ai-plan/AiPlanPage.tsx`、`services/api/advisor.ts` | 小青作业进打印链；文案按 `savedToDocuments` 决定 |
| `components/FilePreviewDialog.tsx` 和两处调用 | B-14 |
| `pages/print-scan/ConvertImagesPage.tsx` | 登录带回跳；生成结果写上下文 |
| `pages/print/PrintCashierPage.tsx`、`PrintProgressPage.tsx` | 「返回确认页」只带交接编号 |

### 4.2 共享包
`packages/shared/src/types/print.ts`：新增 `negotiatePrintParams`，纯函数，只加不改。

### 4.3 服务端（看第 5 条拍板，可分批）
- 小青打印的返回值加 `savedToDocuments`（`advisor-artifact.service.ts:98-138`），并在 `services/api/scripts/verify-advisor-work.ts` 补断言。
- AI 产物二选一：
  - 统一先进打印台检查（服务端不改）；
  - 或把岗位匹配、职业规划、参会准备单、模拟面试两处、小青作业共 6 个上传点改成派生类别，需评估对保存期限和「我的文档」分类的影响。
- AI 打印链接时效：改为 30 分钟，或新增按 fileId 重签（会员可复用 `/files/:id/preview-url`）。
- 可选：建单时校验文件归属（文件属于会员 X、请求者不是 X 就拒单）。

### 4.4 受影响的门禁和既有用例（用 `node scripts/project-graph-query.mjs file …` 查得）

**门禁**（`apps/kiosk/scripts/` 下，除注明外）
- `verify-fusion-w2-print-scan.mjs`：
  - 冻结哈希（`:57-61`）要重冻；
  - 断言打印台用了 `readPrintMaterialSession`（`:183`）；
  - 断言检查页、预览页保留读和打补丁的函数名（`:594-599,:652-655`）；
  - 断言预览页里有旧标记注释「PrintPageFrame / KioskActionBar」（`:608-615`），注释要留着。
- `verify-print-entry-source-split.mjs`：逐字断言「临时状态 + 会话」双通道（`:101-114`）和上传页写会话的正则（`:82`）。要按「只认上下文」重写。
- `verify-print-parameter-capability.mjs`（`:55-64`）：保留那句原话和「先收口再报价」的顺序就能过；新增对「等能力加载」的断言。
- `verify-ai-artifact-print-url-contract.mjs`：
  - 「服务端响应返回内部签名链接」那组逐字匹配 `signFileUrl(uploaded.fileId).url`，改链接时效就要放宽；
  - 「来源只传打印链接」「我的文档只传打印链接」两组，来源保留原写法即可。
- 断言来源里写着 `navigate('/print/confirm'` 和 `makePrintParams({ copies: 1, duplex: 'single', color: 'bw' })` 的：`verify-resume-report-qx.mjs:61`、`verify-job-material-library-ui.mjs:79,143,152`、`verify-job-fit-m1-5-ui.mjs:96-97`、`verify-ai-down-fallbacks.mjs:119-121,169,216`、`verify-lightflow-k2c-interview.mjs:127`、`verify-lightflow-k2a-career.mjs:51-52`。入口不变就保留原写法；入口改到打印台（第 5 条第 1 项）就要跟着改。
- `verify-print-confirm-honest.mjs:130-159`：断言建单后带给收银页的信息，以及模拟跳转的写法（里面有合同报告分支）。改建单后逻辑或删合同分支时要同步。
- 保留即可、不受影响：`verify-fusion-w3.mjs:337`、`verify-pii-redaction-contract.mjs`（会话文件里要保留脱敏结论相关类型）、`verify-member-session-closure.mjs:290-297`（返回路径文件只是加函数）、`verify-resume-phone-upload-ui.mjs:205-240`（预览弹层只是加可选属性）、服务端 `services/api/scripts/verify-print-color-duplex-capability.ts:368-380`。
- **元门禁：**
  - 新的检查脚本必须进 CI（`scripts/verify-ci-gate-coverage.mjs`）；
  - 新的浏览器用例必须被 CI 里某个配置命中（`apps/kiosk/scripts/verify-browser-spec-coverage.mjs`），所以要改 `apps/kiosk/playwright.w2.config.ts` 的匹配规则；
  - 改完跑 `pnpm graph` 刷新项目图谱。

**既有浏览器用例**
- `apps/kiosk/tests/visual/fusion-w2-print.spec.ts` 要改：
  - `:1104`、`:1119`：在打印台上靠临时状态造文件；
  - 权益卡 8 条（`:2027-2218`）：靠旧会话夹具或临时状态造文件；
  - `:2228`、`:2261`、`:2305`；
  - `:2375`、`:2450`：直接往存储里写自定义结构；
  - 其余用旧会话夹具的，随夹具一起升级。
- `apps/kiosk/tests/visual/print-confirm-price-truth.spec.ts` 要改：
  - `:129`、`:161`、`:280`：靠临时状态造文件；
  - `:153`「拦下未验证的彩色、不报价」改为「回落到黑白后按黑白报价，绝不按彩色报价」。
- 要升级到 v2 的夹具：`apps/kiosk/tests/visual/fixtures/fusion-w2-state.ts`、`qingxu-pair-seeds.ts:41`、`kiosk-p1-evidence-capture-api.ts:10`。
- 不受影响（按存储位置判断清场）：`kiosk-privacy-timeout.spec.ts:22`、`kiosk-session-warning.spec.ts:1252,1398`、`kiosk-scan-safety.spec.ts:1896,1933`。
- 从真实来源页进打印的 `fusion-w2-scan.spec.ts:452`、`fusion-w5.spec.ts:1379`、`fair-workbench-qx.spec.ts:495`：入口不变就能过，入口改了就要改断言。

### 4.5 新增测试

**单元测试：** 新建 `apps/kiosk/scripts/tests/print-handoff.test.mjs`，写法照 `boot-ticket-clears-sensitive-session.test.mjs`（转译 TypeScript + 内存里的存储），由新的 `verify:print-handoff` 调用并进 CI。
- U1 新交接整份覆盖：旧检查结论、参数、任务、source 都不带过来，编号换新。
- U2 归属：3.4 表四种情况；不符时存储被清，返回值里没有旧文件名。
- U3 过期：满 30 分钟判过期并清；链接里的到期时间已过判「链接过期」；解析不出不拦。
- U4 编号对不上的补丁不写入（检查页竞态）。
- U5 旧结构按第 5 条第 5 项的拍板结果处理。
- U6 存储里查不到会员 id、令牌、手机号。
- U7 参数求交：
  - 要双面但本机不许 → 改单面并给出理由；
  - 要彩色但不许 → 改黑白；
  - 本机许 → 不变；
  - 能力加载中且需要能力 → 标记「等」；
  - 基线参数不标记「等」；
  - 每张纸只印一页，恒为 1。
- U8 确认页状态判定：参数被收口后不再落到「参数不可用」屏。
- U9 确认页取文件的纯函数：带着文件、但编号不符或没有编号的临时状态，一律不能盖过存储里的上下文。
- U10 打印页生成的登录回跳地址不含查询串和文件身份。

**浏览器用例：** 新建 `apps/kiosk/tests/visual/print-handoff.spec.ts`（标签 @w2，并加进 w2 配置的匹配规则）。

- **H1 登录回跳（旧代码红）**
  1. 先写旧会话 A（夹具里的 `W2_FILE`，检查齐全）。
  2. 用 W3 已有的优化稿夹具（`fusion-w3.spec.ts:248-290`，打印链接的到期时间改成远期）导出 B，关掉预览层，点「去打印优化版」进确认页。
  3. 点「去登录查看我的权益」，断言登录地址里没有 fileId、链接、签名。
  4. 在当前页用键盘完成登录（步骤同现有的 `loginThroughVisibleUi`，但不重新打开页面），回到 `/print/confirm`。
  5. 断言：文件名是 B；A 的文件名 `w2-sample.pdf` 出现 0 次；最后一次报价请求用的是 B 的链接。

  旧代码回来显示 A，红。
- **H1b**（同上但不写 A）：断言不是「没有待确认的任务」。旧代码会落到这个空态，红。
- **H2 返回预览（旧代码红）**：同样走到确认页显示 B，点「返回预览与参数」，等到 `/print/desk?step=preview`。断言 A 的文件名出现 0 次、能看到 B（优化稿免检查，直接进参数页）。旧代码打印台复水出 A，红。
- **H3 F02**：登录后在求职材料页生成两页 PDF 并点打印，本机双面未登记。断言不出拦截屏、有「已改回目前能打的参数」提示、报价请求是单面、主按钮可点。旧代码落到拦截屏，红。
- **H4 F20**：本机彩色、双面都已登记。在预览里选彩色和双面 → 下一步 → 返回预览与参数，断言两项仍是选中状态。旧代码回到黑白单面，红。
- **H5 F09**：在小青作业页点「打印带走」后进入打印链，带着这份文件名；游客状态下不出现「已保存到我的文档」。旧代码停在原页并显示这句，红。
- **H6 B-14**：优化稿导出后弹出的预览层里有「去打印这一份」，点了进确认页。旧代码没有这个按钮，红。
- **H7 归属（辅助）**：会员从「我的文档」进确认页，点「结束使用」后再进打印台只看到空态。清场本来就会清，这条在旧代码上也是绿的，只做回归保护。

建议实施时先把 H1–H6 加到旧代码上、确认确实变红，再动实现。

### 4.6 工作量（人日）

| 块 | 内容 | 估计 |
|---|---|---|
| A 上下文内核 | v2 字段、交接模块、入口策略表、单元测试 | 1.0 |
| B 打印链四页 | 只认上下文、三种失效态、返回直达、修竞态 | 1.0–1.5 |
| C 参数求交 | 共享函数、确认页自动回落、预览恢复（F02、F20） | 0.5–0.75 |
| D 来源 | 22 个来源文件 + 建单后两处 + 小青 + B-14 + 图片转换 | 1.0–1.25 |
| E 门禁与用例 | 改 8–10 个门禁（含重冻哈希）、升级 3 个夹具、改写约 20 条既有用例、新增约 8 条浏览器用例、新检查脚本进 CI、刷新图谱 | 1.25–1.5 |
| **一体机合计** | | **4.75–6** |
| F 服务端（看拍板） | savedToDocuments 0.25；AI 产物类别 0.5；链接时效 0.25–1；建单归属校验 0.5（可选） | 0.25–2.25 |

`docs/progress/next-tasks.md:17` 原来估 3–4 天。多出来的主要有两块：来源实际有 22 处，不是 7 处；约 20 条既有用例靠临时状态造数，要改写。

---

## 5. 风险与未决（不拍板）

1. **最急：AI 产物和原件直达报价页，生产上建单会被拒（按代码推演，没在真实后端验过）。**
   - 依据：生产开着「打印前必须做隐私检查」（`services/api/src/config/production-runtime-gates.ts:270`；`docs/progress/current-progress.md:3706`）。建单时，用途是 print_doc、简历上传、简历扫描、证件扫描之一、类别是原件、又没做过隐私扫描的文件会被拒（`print-jobs.service.ts:351-364`；`services/api/src/print-jobs/pii-scan-gate.ts:7,32-33,57-79`；上传默认就是原件，`services/api/src/files/files.service.ts:256`）。
   - 受影响：岗位匹配、职业规划、参会准备单、模拟面试两种、小青作业、扫描结果、诊断失败原件、「我的文档」里没扫描过的原件。表现是报价能出，点确认时失败。
   - 二选一：
     - (a) 这些来源先进打印台做检查。代价是用户要对自己的名字、电话逐条选保留或遮挡，体验重。
     - (b) 服务端把 AI 产物标成派生，和 `print-jobs.service.ts:351-363` 注释里「AI 生成的报告放行」的本意一致；原件仍然要检查。
   - 这一项决定 3.5 的入口表、4.4 里一批门禁改不改、扫描页「直接打印」这个按钮名要不要换。
2. **自动回落和设计稿 14 冲突。** v2 稿写的是本机未开通「强制进拦截屏」（`docs/design/kiosk-redesign-2026-08-v2/14-print-confirm.html:59`），走查的修法是「自动回落并提示，不锁死」。
   - 备选：保留拦截屏，但把「返回改参数」改成去打印台预览（真正锁死的原因是现在它回到了来源页）。
   - 改完后这一屏删掉还是改成提示态，需要设计同步；本任务不碰 `docs/design/`。
3. **有效期取值：** 30 分钟封顶，还是随操作续期。
4. **AI 产物打印链接只有 5 分钟**（`signing.ts:19`），登录或检查可能超时。选项：
   - 服务端改成 30 分钟（要同步改 `verify-ai-artifact-print-url-contract.mjs`）；
   - 新增按 fileId 重签（游客的文件目前没有办法重签）；
   - 到期就引导回来源重新生成。
5. **旧结构（v1）的会话：** 部署那一刻正在办理的，是丢掉（安全优先，推荐）还是当作游客的升级过来。会影响 3 个测试夹具和 P1 截图证据。
6. **重冻 `printMaterialSession.ts` 的哈希**（`verify-fusion-w2-print-scan.mjs:57-61`）需要评审同意。不改这个文件的话，它保存时的字段白名单（`printMaterialSession.ts:176-188`）会把新字段丢掉，绕不开。
7. **建单后清不清上下文。** 现在建单就清（`PrintConfirmPage.tsx:410`）；改成「只认上下文」之后，收银页「返回确认页」（`PrintCashierPage.tsx:475`）会落到空态。
   - 建议：建单后只打标记，完成页再清。
   - 这会保留「回确认页可以再建一单」的现有行为，需要确认。
8. **会员的上下文在刷新后丢掉。** 这是隐私优先的做法，但和「看门狗刷新后仍停在原步骤」的目标（`ProfilePage.tsx:103-105`）对会员有冲突。文件在「我的文档」里可以找回。
9. **小青作业：** 「已保存到我的文档」是让服务端新增 `savedToDocuments`，还是直接删掉这句？另外，每点一次「打印带走」都会重新生成一个文件（`advisor-artifact.service.ts:98-138`），和该文件自己的注释「复签不重复生成」不符，要不要顺手修。
10. **F14 到底指什么：** 走查报告没单列原文。代码上图片转换已经写会话（`ConvertImagesPage.tsx:257`），问题在登录不带回跳、生成结果丢失（`:295,:365`）；而「登录后保存进我的文档」没有服务端认领接口。验收口径待定。
11. **匿名归属要不要加固：**
    - 可以记录每次清场生成的随机代次（`KioskPrivacyGuard.tsx:163-195`，目前没导出），用来识别「清场失败留下的残留」；
    - 或者做服务端交接凭据；
    - 另有可选的服务端建单归属校验（4.3），它会影响「会员令牌悄悄失效」时的边界行为。
12. **sessionStorage 不能写时整条链走不通**（现在还能退回临时状态，见 `printMaterialSession.ts:208` 的注释）。一体机上的 Edge 正常模式能写，但要给一个诚实的失败提示：「本机暂时无法保存打印信息」。
13. **两条死路径删还是留：**
    - 「我的」页本次记录的打印（`ProfilePage.tsx:101-108`）；
    - 确认页的合同报告分支（`PrintConfirmPage.tsx:62-65,325-339`）。合同报告打印 9/6 已拍板禁止（`apps/kiosk/src/pages/contract-review/contractReviewReportPrintFlow.ts:1-7`），服务端也会拒（`print-jobs.service.ts:287-305`）。删这个分支会牵动 `verify-print-confirm-honest.mjs:130-159`。
14. **招聘会三处来源**（托管 a 已关）要不要同批改：建议同批，免得 b 版本回归。
15. **W2 另外两项**不在本任务包里，是否同批：A-04（OCR 不可用时本人确认后可继续）、C-08（报价失败按错误码说原因，`PrintConfirmPage.tsx:222-228`）。
16. **本方案没跑过任何浏览器用例和门禁。** 第 2 节的复现和第 1 项的拒单都是按代码推演；实施时要先用 H1、H2 在旧代码上跑红，并在真实后端核对第 1 项。
