# C3 同意记录与撤回机制说明

供律师审阅的草案，不是法律意见。

代码基线是候选版本 `25dbe6181`。接口路径写在控制器上，调用时加上全局前缀 `/api/v1`（`services/api/src/main.ts:69`）。

本文只记录代码里找得到的同意。找不到撤回页面的，写「未发现撤回入口」。不把接口存在写成用户已经能在试点页面上点到。本文出现的期限均是代码默认值；能被环境变量覆盖的期限以 C2 的环境变量对照为准，生产值未读。

试点按已拍板口径：自营单点、免费；云上不存岗位、招聘会、企业资料；面向年满 14 周岁的用户。自我探索另有一套勾选，版本 `sa-consent-v2.2026-09-29`。

## 可直接用

### 1. 登录时的用户协议和隐私政策

同意什么：登录时提交的《用户服务协议》版本和《隐私政策》版本。

何时弹出：短信登录和扫码登录在落库前会核对版本并写入同意（调用点 `member-auth.service.ts:132`、`:160`、`:468`）。勾选框画在哪个前端组件里，本次没有定位到含协议字样的登录弹层，弹层文件未核实。版本号的读取在一体机 `apps/kiosk/src/services/auth/legalConsentVersions.ts`，该文件本次未逐行打开。

记录在哪：`MemberLegalConsent`（`schema.prisma:2030`–`:2040`）。字段有 `termsVersion`、`privacyVersion`、`termsDocVersionId`、`privacyDocVersionId`、`source`、`ipAddress`、`createdAt`。代码类型和微信登录实际写入的来源包括 `sms_login`、`qr_login`、`wx_login`（`member-auth.service.ts:19、:138、:474`）；schema 注释漏列了 `wx_login`。写入是追加一行（`member-auth.service.ts:224`–`:234`）。

版本怎么记：取当前激活的 `LegalDocVersion`。没有激活版本时，代码有 `draft-pending-legal-review` 回退值（`legal-constants.ts:5`，赋值在 `member-auth.service.ts:183`–`:184`）。用户提交的版本和当前版本不一致，返回 `LEGAL_VERSION_STALE`（`:206`）；生产应把 `assertLegalDocsPublished` 作为强阻断，未有正式发布文本时拒绝登录，不把草稿标识当成有效同意。库里现在激活的是哪一版，未读数据库。

在哪撤回：未发现撤回入口。模型没有 `revokedAt`。再次登录会再追加一行，旧行不改。

撤回后系统做什么：没有对应的撤回动作。

### 2. 年满十四周岁声明（`age_14_plus`）

同意什么：服务端正文是「我确认本人已年满14周岁。本声明不收集出生日期。」（`member-privacy.service.ts:17`）。版本 `age-14-plus-v1`（`:14`）。不收证件，不收人脸。

何时弹出：AI 功能前的声明流程会要求这项。声明门的前端文件本次未再逐行打开。服务端对没有会员身份的调用，除简历 AI 外会拒绝（`requireActiveConsent`，`member-privacy.service.ts:192` 起）。

记录在哪：已登录时 `POST /me/ai-consents`，正文里的 `scope` 为 `age_14_plus`（控制器 `member-privacy.controller.ts:66`–`:74`）。落表 `UserAiConsent`，版本由服务端按范围写入，不信任客户端自报版本（`member-privacy.service.ts:129`–`:137`）。未登录时的声明留在一体机本机会话存储里；清场只清本机，不等于把服务端 `revokedAt` 写上。本机键名本次未再逐个摘录。

版本怎么记：固定字符串 `age-14-plus-v1`，存在 `UserAiConsent.consentVersion`。

在哪撤回：服务端有 `POST /me/ai-consents/age_14_plus/revoke`（控制器 `:77`–`:82`）。小程序隐私页导出的操作是录音和简历 AI，没有年龄撤回（`apps/miniapp/pages/privacy/consents.js:160`）。一体机隐私请求走的是另一条只处理岗位 AI 的路径，见第 5 节。未发现面向用户的年龄声明撤回入口。

撤回后系统做什么：若有人直接调用该接口，只把该范围未撤回的行写上 `revokedAt`（`member-privacy.service.ts:182`–`:185`）。已有简历、对话或结果不在该撤回事务的删除范围内。之后哪些入口会重新要求声明，本次未逐个入口核对。

这项声明和下一节自我探索的年龄勾选是两套文字，同时存在。

### 3. 录音同意（`voice_recording`）

同意什么：现有文案将录音用途限定为转成文字，供简历整理、模拟面试作答或向小青提问；音频交给当前启用的语音识别；文案设计为转写完成后不再保存音频，未见声纹处理路径，仍需按运行链路核验；可在隐私页撤回（`member-privacy.service.ts:22`–`:26`）。版本 `voice-recording-v1`（`:15`）。

正文仍写「腾讯云或百度智能云，以实际配置的一家为准」，与已拍板的“语音只用腾讯云”不一致。代码仍按 `ASR_PROVIDER` 保留腾讯/百度分支，默认是 `disabled`；生产实际启用哪一家，未读环境变量。试点对外文案应先按律师确认的单一厂商口径更新。

何时弹出：开始需要录音的功能之前。每个录音按钮是否都先弹出，未逐个核对。

记录在哪：已登录时同样写入 `UserAiConsent`，`scope = voice_recording`。

版本怎么记：`voice-recording-v1`。

在哪撤回：小程序隐私页可以撤回。入口 `pages/privacy/privacy.js` 的 `tapVoiceConsent`（`:429`）调用 `promptVoice`（`consents.js:121`），再请求 `POST /me/ai-consents/voice_recording/revoke`（`api-legal-consent.js:52`–`:54`，语音封装在 `:240` 一带）。一体机设置页的撤回函数默认范围是 `job_ai`（`apps/kiosk/src/services/api/jobAi.ts:73`）。未发现一体机上撤回录音同意的页面。

撤回后系统做什么：服务端只写 `revokedAt`（`member-privacy.service.ts:182`–`:185`）；已落库的转写文字不在该事务的删除范围内。转写在模拟面试回合里，保存期见数据总表。现有文案表述为撤回后新的录音不再开始，哪些录音入口实际检查这项同意，未逐一核实。

### 4. 简历 AI 同意（`resume_ai`）

同意什么：使用简历类 AI 前的授权。版本 `resume-ai-consent-v1`（`member-privacy.service.ts:13`）。

何时弹出：简历 AI 功能前。没有会员身份时，服务端不在这里拦截（`member-privacy.service.ts:192`–`:193`），注释写游客只做会话级提示。

记录在哪：已登录时写入 `UserAiConsent`，`scope = resume_ai`。

版本怎么记：`resume-ai-consent-v1`。

在哪撤回：小程序 `promptResume`（`consents.js:84`）会调用撤回，范围 `resume_ai`（`:97`）。一体机 `MySettingsPage.tsx:164` 调用的 `revokeJobAiConsent` 默认只撤 `job_ai`。有文案提到可在隐私设置撤回简历 AI；该按钮是否接到 `resume_ai`，本次未再打开对话框逐个核对，标未核实。

撤回后系统做什么：只写 `revokedAt`。不删除已生成的简历结果。

### 5. 会员的岗位 AI 授权（`job_ai`）

同意什么：岗位推荐、岗位对照等会员侧 AI。版本字符串是 `20260701`（`member-privacy.service.ts:12`）。

何时弹出：会员使用相应功能前。服务端在分析前要求有效同意（`governed-job-fit.service.ts:108`）。托管开关默认关闭时，云上岗位内容不应对外提供；这段授权代码仍在。生产开关未读。

记录在哪：`UserAiConsent.scope = job_ai`。

版本怎么记：`20260701`。

在哪撤回：有两条，都只针对这一项。

- 一体机页面 `/me/settings`（`routes/index.tsx:176`）调用 `POST /me/ai-consents/job_ai/revoke`（`MySettingsPage.tsx:164`，适配器 `jobAiHttpAdapter.ts:142`–`:143`）。
- 一体机页面 `/me/privacy-requests`（`routes/index.tsx:177`）提交 `POST /me/data-requests`，类型 `revoke_consent`（`MyPrivacyRequestsPage.tsx:71`）。服务端只把 `scope = job_ai` 且尚未撤回的行写上时间（`member-data-request.service.ts:179`–`:181`）。

小程序隐私页另有一条同样的数据请求，因此也只撤岗位 AI。函数所在文件是 `pages/privacy/privacy.js`；小程序按钮和确认文案应明确写“撤回岗位 AI 授权”，不能写成“撤回简历对照授权”或泛称“撤回 AI”。

撤回后系统做什么：

- 直接撤回接口：写 `revokedAt`，不删简历、文档、订单。
- 数据请求这条：同一事务里写 `revokedAt`，并把 `UserDataRequest` 记为 `requestType = revoke_consent`、`status = completed`、`handledBy = system`（`member-data-request.service.ts:183`–`:192`），审计动作 `member_ai_consent.revoke`，载荷只有 `{ scope: 'job_ai' }`（`:198`–`:201`）。一体机文案已经写明范围：按钮叫「撤回岗位 AI 授权」（`packages/shared/src/types/memberPrivacy.ts:31`），确认框标题是「确认撤回岗位 AI 授权」（`MyPrivacyRequestsPage.tsx:266`），并写明简历、文档、打印订单和收藏不在该请求的删除范围（`:268`）。再次使用岗位 AI 须重新确认（同文件提示常量 `:38`–`:39`）。该请求的 scope 不包含第 2、3、4、9 节的同意。小程序上同一请求的展示文案应同步为“撤回岗位 AI 授权”。

### 6. 未登录的岗位对照授权

同意什么：没有会员身份时，对某一份简历结果做岗位对照的授权。版本 `job_fit_anonymous_v1`（`job-fit.service.ts:30`）。它不能代替第 5 节的 `UserAiConsent`。

何时弹出：未登录用户在 `/resume/job-fit`（`routes/index.tsx:99`）继续分析之前。页面卡片本次未再打开，按钮行号未复核。

记录在哪：写在该条 `AiResumeResult` 上，不是同意表。字段 `jobAiConsentVersion`、`jobAiConsentGrantedAt`、`jobAiConsentRevokedAt`（`schema.prisma:1868`–`:1870`）。授予接口 `POST /resume/job-fit/consent`（`job-fit.controller.ts:155`）。

版本怎么记：`job_fit_anonymous_v1` 写入 `jobAiConsentVersion`（`job-fit.service.ts:319` 一带）。

在哪撤回：`DELETE /resume/job-fit/consent/:taskId`（`job-fit.controller.ts:170`）。

撤回后系统做什么：写入 `jobAiConsentRevokedAt`（`job-fit.service.ts:338`–`:342`）。不删除已经生成的报告。后续分析会因撤回而停；已有报告还在，直到第 20 行那种 24 小时清理。会员走第 5 节，不走这个字段（`governed-job-fit.service.ts:107`–`:110`）。

### 7. 自我探索同意

同意什么：提交答卷前的勾选。当前版本 `sa-consent-v2.2026-09-29`，服务端与共享类型各有一份相同字面量（`self-assessment.types.ts:55`，`packages/shared/src/types/selfAssessment.ts:76`）。

条款包括：结果只给本人、不向企业或合作机构推送、可在结果页撤回、不评估适不适合某岗位、维度强度不经过模型、面向年满 14 周岁，未满 14 周岁须监护人同意并陪同（`self-assessment.types.ts:58`–`:65`）。勾选原文允许两种情况并存：本人已满 14 周岁，或者未满 14 周岁且已取得监护人同意并由监护人陪同（`:87`）。一体机 AI 年龄声明拒绝时会显示 `AI_AGE_DECLINED_MESSAGE` 并阻断 AI；自我探索这套勾选仍可放行未满 14 周岁。

何时弹出：进入答题并提交时。题目由 `GET /resume/self-assessment/questions` 下发（`self-assessment.controller.ts:130`）。页面路径：`/resume/self-assessment/intro`、`questions`、`result`、`history`（`routes/index.tsx:103`–`:106`）。

记录在哪：没有单独的同意表。`consentVersion` 与 `consentedAt` 写进 `AiResumeResult.payloadJson`（`self-assessment.service.ts:262` 一带）。缺非敏感题勾选时返回 `SELF_ASSESSMENT_CONSENT_REQUIRED`（`:152`）。版本不是当前版时返回 `SELF_ASSESSMENT_CONSENT_VERSION_STALE`（`:164` 一带）。提交体里还有一个 `sensitive` 布尔（`:95`）。题库文件中未搜到 `sensitive: true`。是否另有敏感题，未核实。

版本怎么记：客户端必须带上当前版本字符串。服务端不接受旧版本。

在哪撤回：结果页对应 `DELETE /resume/self-assessment/:taskId`（`self-assessment.controller.ts:181`）。谁可以调用，要过 `loadAuthorizedRow`（`self-assessment.service.ts:410`）。没有访问凭证时页面是否只提示等待过期，本次未再打开结果页组件。

撤回后系统做什么：把答案、维度、摘要、同意版本清空，写入 `deletedAt`，行状态仍是 `completed`（`:414`–`:427`）。返回值是 `{ deleted: true }`，库里的行仍保留。审计记 `resume.self_assessment_withdraw`（`:432`）；创建时已经写下的 `resume.self_assessment_create` 不在清空事务的处理范围内。条款里的「物理删除」「不留存本人答案原文」和这段实现要交给律师看是否同一件事。到期后整行仍按 AI 结果的默认定时任务删除。

### 8. 长期保存同意

同意什么：把文件从默认期限延到 180 天，或把优化成果、派生成果物设为长期保存。版本 `file-retention-v1`（`file.types.ts:60`；`CURRENT_RETENTION_CONSENT_VERSION` 在 `retention-policy.ts:21`）。

何时弹出：会员在文档页选择上述期限时。页面 `/me/documents`（`routes/index.tsx:164`），确认层 `RetentionConfirmOverlay`（`MyDocumentsPage.tsx:33`、`:487`）。

记录在哪：`FileObject.retentionConsentAt`、`retentionConsentVersion`（`schema.prisma:1243`–`:1244`）。没有同意历史表。180 天和长期必须带当前版本，否则拒绝（`retention-policy.ts:154`）。错误码字符串本次未再摘录。原始简历不能设为长期（`:143`）。身份证扫描件和签名图不能改离短期（`:133`–`:136`）。

版本怎么记：需要同意时，把当前版本写入该文件行（`:170`–`:171`）。

在哪撤回：未发现单独撤回长期保存同意的接口。用户可以改回不需要这份同意的较短期限，或删除文件。改回时，代码会把同意时间写成空（`:170`–`:171`）。是否写审计，未核实。

撤回后系统做什么：删除文件走文件删除，不是一条同意撤回记录。改短期限后，到期任务才会按新的 `expiresAt` 清理。长期保存在改掉之前没有到期时间。

### 9. 合同审查同意（`contract_review`）

同意什么：合同审查范围的授权。版本 `contract-review-consent-v1`（`member-privacy.service.ts:29`）。

何时弹出：使用合同审查前，若该功能对用户可见。页面路由存在（`routes/index.tsx:116` 一带）。试点是否打开、生产开关的值，未读。

记录在哪：`UserAiConsent.scope = contract_review`。

版本怎么记：`contract-review-consent-v1`。

在哪撤回：服务端 `POST /me/ai-consents/contract_review/revoke`。未发现一体机或小程序上把按钮接到这个范围的页面。小程序隐私页导出函数不含这项。未发现撤回入口（指用户页面）；接口本身存在。

撤回后系统做什么：在同一事务里给同意行写 `revokedAt`，并把处理中的合同任务标成 `cancelled`（`member-privacy.service.ts:147`–`:160`）。处理中状态列在 `:43`–`:51`。这段代码取消的是任务状态，不是删除已经生成的报告文件。文件仍按 2 小时的文件期限清理。

### 10. 导出简历时「申请不印」可见人工智能标识

2026-10-06 产品负责人定方案 b：导出的简历默认印可见标识；用户自己申请才不印。这一步属于用户的单项申请：
- 只限 PDF 和 Word。TXT、MD 没有隐式标识，不能选不印。
- 要等律师答复第 21 问，并且新版用户协议写明用户的标识义务与使用责任、上线以后才打开。
- 每次放行前写审计留痕（谁、何时、哪份导出），留存不少于 6 个月。

后端准入和留痕已在 `resume-unlabeled-export.ts`。一体机和小程序的勾选入口待做，后端返回字段约 10/30 进候选。下面是 10/6 之前的代码现状记录。

代码默认不印可见页脚，只有环境变量精确等于 `true` 才打开（`aigc-label.ts:17`）。「不带显式标识」的选项还要另一个环境变量同时为 `true`，并且前一个开关已经打开（`aigc-label.ts:25`，说明在 `resume-unlabeled-export.ts:10`）。非草稿 PDF 的隐式元数据实际写入在 `resume-pdf.service.ts:132–137`；`:124` 是说明注释。生产取值未读。

未发现一项名为「同意不印可见标识」的弹层或数据表。和登录协议如何绑在一起，未在本文件里再追调用链。

### 11. 不能当成撤回手段的入口

账号注销请求类型 `delete` 会直接被拒绝，代码 `ACCOUNT_CLOSURE_NOT_AVAILABLE` /“账号注销暂未开放”（`member-data-request.service.ts:62`–`:63`）。隐私政策对外写“目前由我们人工处理”；本次未找到可执行的人工注销后台按钮、脚本或注销删除流水线，现有导出请求管理和账号停用/恢复能力不能替代带审计的注销流程。当前不能用线上注销来撤回同意或删除账号数据。

本机清场、待机、空闲退出，清的是这台浏览器里的临时数据。它们不更新 `UserAiConsent.revokedAt`，也不更新 `MemberLegalConsent`。

## 待律师确认的事项

要问律师的问题不放在公开仓库，统一见律师清单（私有，第 34–46 问来自本组三份文件）。本文件正文里标「待律师确认」的地方，结论以律师答复为准。
