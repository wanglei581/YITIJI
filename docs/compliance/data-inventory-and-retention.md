# C2 数据分类分级与保存期限总表

供律师审阅的草案，不是法律意见。

代码基线是候选版本 `25dbe6181`。表内所有保存期均标为“代码默认值”，取自两份现有文件和该版本代码：`docs/compliance/member-personal-data-retention.md`、`docs/compliance/file-retention-and-cos-lifecycle.md`。这不是生产现值；可覆盖的环境变量集中列在总表后。

本次读的是 SQLite 侧 `services/api/prisma/schema.prisma`。生产环境变量、对象存储控制台、PostgreSQL 库里的外键，都没有打开。多项期限可以被环境变量改掉，表内写的是代码默认值。

“个人信息 / 敏感个人信息”是《个人信息保护法》的个人信息分类；“重要数据、核心数据”等是《数据安全法》分类分级制度中的法定概念，不能互相替代。下表“级别”列只表示项目内部分类标签，不是法定重要数据或核心数据认定。试点目前没有依据主管部门目录或正式评估把任何一行认定为重要数据或核心数据；需要判断的，单列为待律师确认，不用“敏感个人信息”推导“重要数据”。

试点按已拍板口径是自营单点、免费。年份和现场排期原件本次未另附。

## 可直接用

### 总表

「清理方式」只写代码里能定位到的定时任务。找不到定时删除的，写「未发现定时删除」或「手动」。

| # | 数据类别 | 例子 | 个人信息 / 敏感个人信息 | 项目内部分类标签 | 收集场景 | 保存期（代码默认值） | 清理方式 | 存储位置 | 谁能访问 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 短信验证码 | 登录验证码 | 与手机号哈希绑在同一键上，按个人信息对待。是否敏感：待律师确认 | 一般 | 手机号登录发码 | 5 分钟（`CODE_TTL = 300`，`member-auth.service.ts:29`） | Redis 到期。验证成功或超限会删键。键名 `member:sms:code:`（同文件 `:332`）。同号频控、冷却、设备频控键在 `:333`–`:336`，各自时长未逐个摘录 | Redis，不落用户表 | 服务端校验。代码注释要求不把验证码返回前端。生产日志是否按配置不记录，未读生产配置 |
| 2 | 会员登录会话 | 登录后的会话标识 | 能对应到会员，属个人信息。是否敏感：工作判断为否 | 一般 | 登录成功后 | 30 分钟（`SESSION_TTL = 1800`，`member-auth.service.ts:30`；`MEMBER_SESSION_TTL_SECONDS`，`end-user-auth.guard.ts:28`） | 到期失效；登出删除。键 `member:session:{会话标识}`（`end-user-auth.guard.ts:24`） | Redis。一体机 token 按留存矩阵放在页面内存 | 本人持有凭证。服务端按会话标识核验 |
| 3 | 手机号 | 登录身份 | 个人信息。单独的手机号通常不按敏感个人信息列举；本场景是否有其他敏感性由律师判断 | 一般（项目标签） | 注册 / 登录 | 账号存在期间。未发现按天删除的任务 | 未发现定时删除。账号注销接口当前直接拒绝（`ACCOUNT_CLOSURE_NOT_AVAILABLE`，`member-data-request.service.ts:62`–`:63`） | `EndUser.phoneHash`、`phoneEnc`（`schema.prisma:877`–`:878`）。无明文字段 | 页面按矩阵展示脱敏号。谁持有解密密钥、哪些后台能解出号码，未核实 |
| 4 | 微信标识 | 小程序一键登录后的 openid | 个人信息。是否敏感：工作判断为否 | 一般 | 微信登录绑定 | 账号存在期间。两份期限文件未列此行 | 未发现定时删除。字段注释写不存 sessionKey（`schema.prisma:879`–`:880`） | `EndUser.wxOpenId` | 本人账号关联。后台谁能查看，未核实 |
| 5 | 昵称 | 会员显示名 | 若能指向个人，属个人信息。是否敏感：工作判断为否 | 一般 | 账号资料。写入入口本次未逐页打开 | 账号存在期间。两份期限文件未列 | 未发现定时删除 | `EndUser.nickname`（`schema.prisma:881`） | 本人；后台范围未核实 |
| 6 | 登录协议同意记录 | 同意时的协议版本、来源、IP | 版本号本身标识意义弱。IP 属个人信息。是否敏感：工作判断为否 | 一般 | 短信登录、扫码登录成功时追加一条 | 随账号留存。模型没有撤回字段，也没有到期列（`schema.prisma:2030`–`:2040`） | 未发现定时删除。账号级联删除写在外键上（`:2033`），注销入口未开放，所以这行实际会留下 | `MemberLegalConsent` | 本人账号下的记录。管理员审计范围未逐个接口核对 |
| 7 | 分项 AI 同意记录 | 岗位 AI、简历 AI、年龄声明、录音、合同审查 | 能对应到会员，属个人信息。是否敏感：工作判断为否；若范围是未成年人信息，待律师确认 | 一般 | 会员调用 `POST /me/ai-consents` | 随账号留存。撤回只写 `revokedAt`，不删行（`member-privacy.service.ts:182`–`:185`） | 未发现定时删除 | `UserAiConsent`（`schema.prisma:2013`–`:2021`）：`scope`、`consentVersion`、`grantedAt`、`revokedAt`、`terminalId` | 本人；服务端在对应功能前读取 |
| 8 | 权利请求记录 | 导出、撤回同意的请求单 | 个人信息。是否敏感：待律师确认（导出包指向简历等材料） | 一般。待律师确认 | 会员在隐私请求页提交 | 请求行本身未发现保存天数。导出文件另见第 9 行 | 未发现删除请求行的定时任务。`delete` 类型不会创建成功（`member-data-request.service.ts:62`–`:63`） | `UserDataRequest`（`schema.prisma:2045`） | 本人可列表查看（`member-privacy.controller.ts:94`–`:99`）。管理员处理接口存在，权限细节未在本表展开 |
| 9 | 会员数据导出包 | 导出的 JSON 文件 | 打包了会员数据，属个人信息。敏感级代码定为 `highly_sensitive`（`file-validation.ts:37`）。是否均按敏感个人信息，待律师确认 | 待律师确认 | 会员发起导出且通过校验之后 | 文件策略 `system_short`，`maxTtlHours: 24`（`file-validation.ts:34`–`:41`）。下载票据默认 10 分钟（`member-data-export-download.service.ts:29`），领取单默认 15 分钟（`:30`）。环境变量可改，代码有上下限（`:48`–`:58`） | 文件到期走 `FilesCleanupTask` 每小时（`files.cleanup.task.ts:45`–`:48`）。票据靠 Redis 到期 | 对象键前缀 `exports/member-data/`（`object-key.ts:75`–`:77`，生成函数 `:95` 之后的 export 分支）。表 `FileObject` | 本人凭短期凭证下载。管理员访问文件会写 `file.admin_access`（`files.controller.ts:271`） |
| 10 | 扫码上传会话 | 手机扫码把文件送到一体机 | 会话能连到一次办理，按个人信息对待。是否敏感：视文件内容，待律师确认 | 一般 | 扫码上传 | 会话 10 分钟（`SESSION_TTL_SECONDS`，`upload-sessions.service.ts:94`）。确认后的文件链接 30 分钟（`:102`） | `FilesCleanupTask` 每分钟调用 `cleanupExpiredSessions`（`files.cleanup.task.ts:29`–`:33`） | Redis。文件本体落入 `FileObject` 和第 11 行以后的前缀 | 持有本次会话的人。会话标识的传递范围未在现场复核 |
| 11 | 系统短期文件 | 未登录上传、匿名打印、临时文件 | 文件内容通常是个人信息。是否敏感：按敏感级分开，见右侧保存期 | 待律师确认（高敏文件） | 上传时按用途和敏感级落入 `system_short` | `normal` 24 小时、`sensitive` 6 小时、`highly_sensitive` 1 小时（`file.types.ts:62`–`:65`）。`expiresAt` 由 `retention-policy.ts:183` 计算 | `FilesCleanupTask` 每小时 `cleanupExpired`（`files.cleanup.task.ts:45`–`:48`），并每小时对账对象是否真的删掉（`:60`）。长期保存行的 `expiresAt` 为空，该轮谓词不选中 | `FileObject` 加私有对象存储。无主文件回退 `tmp/uploads/{会话}/`（`object-key.ts:109`） | 本人或当次办理凭证；管理员访问写审计。合作机构前缀是 `partners/`，与用户文件前缀 `users/` 分开（`object-key.ts:110`、`:114`）。是否另有接口读到用户文件，未逐个核对 |
| 12 | 身份证扫描件 | 身份证复印件图像 | 代码默认 `highly_sensitive`（`file-validation.ts:161`）。是否属于敏感个人信息，待律师确认 | 待律师确认 | 用户上传证件扫描 | 用途锁在 `system_short`，不能延长（`retention-policy.ts:98`、`:133`）。按高敏默认是 1 小时 | 同第 11 行的每小时清理 | `users/{会员}/scans/`（`object-key.ts:70`） | 同第 11 行 |
| 13 | 签名图像 | 签名合成用的签名图 | 代码默认 `highly_sensitive`（`file-validation.ts:174`）。是否敏感个人信息，待律师确认 | 待律师确认 | 代码保留该用途。试点是否对用户打开，未读开关 | 锁在 `system_short`（`retention-policy.ts:99`、`:136`），按高敏默认 1 小时 | 同第 11 行 | `users/{会员}/signatures/`（`object-key.ts:74`） | 同第 11 行 |
| 14 | 登录会员的原始简历、扫描简历、求职信原件 | 本人上传或扫描的原文 | 个人信息。默认敏感级：简历两类为 `highly_sensitive`，求职信为 `sensitive`（`file-validation.ts:159`–`:162`）。整类是否都按敏感个人信息，待律师确认 | 待律师确认 | 会员已登录且用途属于这三项 | 默认 90 天（`months_3`，`retention-policy.ts:70`–`:72`、`:180`）。本人可延至 180 天，须同意版本 `file-retention-v1`（`file.types.ts:60`，校验 `:154`）。原始文件策略不允许 `long_term`（`retention-policy.ts:143`） | 到期由第 11 行的每小时任务按 `expiresAt` 删除。本人可提前删除。敏感级高并不改这 90 天：期限看用途，不看敏感级 | `FileObject`。简历 `users/{会员}/resumes/`，扫描 `users/{会员}/scans/`（`object-key.ts:67`–`:70`）。同意写在 `retentionConsentAt`、`retentionConsentVersion`（`schema.prisma:1243`–`:1244`） | 留存矩阵写明只给本人查看、下载、打印，不向企业或合作机构提供。字段设计不等于接口已经隔离，合作机构读取路径未逐个核对 |
| 15 | 优化后简历、AI 派生成果文件 | 导出或另存的成果物 | 个人信息。是否敏感：待律师确认 | 待律师确认 | 会员确认保存时 | 默认 90 天；可延至 180 天或长期。长期为 `expiresAt = null`（`retention-policy.ts:182`），每小时过期任务的条件不包含它。180 天和长期都要当前同意版本（`:188` 与 `:154`） | 到期删除，或本人删除。长期保存没有到期任务 | 同第 14 行的对象前缀，具体目录取决于用途 | 同第 14 行 |
| 16 | 普通打印文件 | 非简历类打印件 | 内容可能是个人信息。默认敏感级 `normal`（`file-validation.ts:163`） | 一般。内容若是证件或简历，待律师确认改级 | 打印上传 | 不在 90 天用途集合内，走 `system_short`。`normal` 为 24 小时 | 同第 11 行 | `users/{会员}/print-files/` 或无主时 `tmp/uploads/`（`object-key.ts:71`、`:109`） | 同第 11 行 |
| 17 | 合同上传件与审查报告文件 | 合同文本、审查报告 | 可能含个人信息甚至敏感个人信息。上传件默认 `highly_sensitive`（`file-validation.ts:172`） | 待律师确认 | 合同审查流程。页面开关和试点是否开放，未读生产值 | 固定 2 小时（`CONTRACT_REVIEW_TTL_MS`，`retention-policy.ts:13`、`:61`），不按 1 小时的高敏默认 | `ContractReviewCleanupTask` 每小时（`contract-review.cleanup.task.ts:42`，删除在 `:122`） | `users/{会员}/contract-reviews/`、`contract-review-reports/`（`object-key.ts:72`–`:73`） | 本人；管理员审计未逐条列出 |
| 18 | 自我探索报告文件 | 另存的报告文件 | 个人信息。默认敏感级 `sensitive`（`file-validation.ts:176`）。若使用者未满十四周岁，敏感个人信息的结论待律师确认 | 待律师确认 | 生成报告文件时。调用点是否改写默认策略，未逐一核实 | 不在 90 天用途集合内，按 `system_short` + `sensitive` 为 6 小时（`file.types.ts:64`）。结果正文的保存见第 20 行，两者不是同一行 | 文件走第 11 行的每小时任务 | `users/{会员}/self-assessment/`（`object-key.ts:88`） | 同第 11 行。矩阵与边界要求不向企业、合作机构推送 |
| 19 | 签名链接 | 打开文件用的临时地址 | 链接能打开个人信息。是否敏感：待律师确认 | 一般 | 本人或管理员换取下载、打印地址时 | 硬上限 30 分钟（`MAX_SIGN_TTL_SECONDS`，`storage.service.ts:29`）。打印产物常量同为 30 分钟（`signing.ts:27`）。部分对象存储操作预签名示例是 300 秒（`cos-storage.backend.ts:83`），短于上限 | 到期失效，没有单独的删库任务 | 不落长期公开地址。对象仍在私有桶 | 拿到链接的人，在有效期内 |
| 20 | AI 简历结果行 | 解析、诊断、优化草稿、生成输入、自我探索结果 | 个人信息。简历派生文本是否整类敏感，待律师确认。自我探索若涉及未满十四周岁，待律师确认 | 待律师确认 | 使用对应 AI 功能时写入 | 默认 24 小时（`AI_RESUME_RESULT_TTL_HOURS`，`ai.service.ts:46`）。自我探索使用同一变量（`self-assessment.service.ts:37` 一带）。环境变量可改 | `AiResultCleanupTask` 每小时（`ai-result.cleanup.task.ts:35`–`:37`）。删除谓词包含已到期，也包含 `expiresAt` 为空的历史行（`ai.service.ts:978`、`:990`）。自我探索点「撤回」是清空内容、留下这一行（`self-assessment.service.ts:411`–`:427`），等到点才删行 | `AiResumeResult`（`schema.prisma:1852`） | 本人凭账号或当次访问凭证。列表接口按矩阵不回传原文给旁人 |
| 21 | 岗位 AI 会话 | 匹配、推荐、解释的会话和意向摘要 | 含会员或当次简历任务的关联，属个人信息。是否敏感：待律师确认。托管开关默认关时，云上岗位库不应再增长；会话代码仍在 | 一般。待律师确认 | 岗位 AI 功能。生产开关未读 | 默认 24 小时，复用简历结果的同一环境变量（`job-ai.service.ts:27`–`:30`、`:461`–`:462`）。对照某份简历时，到期时间跟随该简历结果（`governed-job-fit.service.ts:137`） | 同一每小时任务删除到期行（`ai-result.cleanup.task.ts:55`–`:57`）。本人可删自己的会话（`job-ai.service.ts:218`） | `JobAiSession`（`schema.prisma:1893`）。推荐明细表随会话级联（`:1919`） | 本人 |
| 22 | 模拟面试 | 会话、报告、原话和语音转写 | 个人信息。转写文本是否敏感，待律师确认。同意文案写不做声纹、不留音频（`member-privacy.service.ts:25`）。音频文件落点未核实 | 待律师确认 | 开始模拟面试 | 匿名 2 小时，会员 7 天（`mock-interview.service.ts:40`–`:41`） | 每小时按会话 `expiresAt` 删除（`:623`–`:625`）。回合、报告的外键是 `onDelete: Cascade`（`schema.prisma:2451`、`:2470`）。这是 schema 声明，生产库是否真有此外键，未验证 | `MockInterviewSession`（`:2420`）、`MockInterviewTurn`（`:2448`）、`MockInterviewReport`（`:2467`）。库存的是未脱敏原话 | 本人回看。矩阵要求原文不进日志和审计载荷。是否每一条日志都做到，未在本表重跑门禁 |
| 23 | 小青文字对话 | 文字咨询的当次上下文 | 个人信息。是否敏感：待律师确认 | 一般。待律师确认 | 一体机文字对话 | 内存 30 分钟无活动即淘汰（`SESSION_TTL_MS`，`llm-chat.service.ts:53`，淘汰在 `:268`）。进程重启即失 | 进程内淘汰。未发现落库表 | 服务进程内存 | 当次会话所在进程 |
| 24 | 顾问会话与产物 | 诉求、槽位、钉住内容、产物 JSON | 个人信息。落库的是未脱敏原文。是否敏感：待律师确认 | 待律师确认 | 使用顾问功能 | 默认各 24 小时（`ADVISOR_SESSION_TTL_HOURS`，`advisor.service.ts:45`–`:46`；`ADVISOR_ARTIFACT_TTL_HOURS`，`advisor-artifact.service.ts:22`–`:24`） | `AdvisorRetentionTask` 每小时先删会话再删产物（`advisor-retention.task.ts:50`、`:74`、`:77`） | `AdvisorSession`（`schema.prisma:3219`）、`AdvisorArtifact`（`:3273`）。打印出来的 PDF 是独立 `FileObject`，不随产物行消失 | 本人 |
| 25 | AI 服务日志 | 功能、厂商、状态、耗时、终端、会员号 | 含会员号时属个人信息。代码说明不存正文。是否敏感：工作判断为否 | 一般 | 一次 AI 操作结束时 | 默认 90 天（`readAiServiceLogRetentionDays`，`ai-result.cleanup.task.ts:8`–`:11`）。环境变量可改 | 同一每小时任务（`:39`–`:40`、`:76` 一带） | `AiServiceLog`（`schema.prisma:1936`）。另有未登录任务上的声明快照，注释写只有状态和文案版本（`:1948`–`:1949`） | 后台统计。会员本人是否能看到明细，未在本表打开页面 |
| 26 | AI 用量明细 | 功能、厂商、型号、token、金额、已验签终端、会员号 | 含会员号时属个人信息。不含用户文本。是否敏感：工作判断为否 | 一般 | 真实发出的模型请求 | 默认 90 天，与第 25 行同一函数 | 每小时：先月汇总，再删明细（`ai-result.cleanup.task.ts:41`；`ai-usage-retention.ts:95`、`:176`）。注销时把会员号置空的函数存在；注销入口未开放，拒绝路径不会调用它 | `AiUsageRecord`（`schema.prisma:1962`） | 后台计量。不含给用户看的正文 |
| 27 | AI 用量月汇总 | 月份、功能、厂商、次数、金额 | 矩阵写不含个人信息、不含会员号和终端号 | 一般。聚合后是否仍可识别，待律师确认 | 明细到期前滚入 | 长期保留，不随明细删除（模型注释 `schema.prisma:1993`–`:1994`） | 未发现删除任务 | `AiUsageMonthlySummary`（`:1996`） | 后台 |
| 28 | 浏览记录 | 本人浏览了哪个已发布目标 | 个人信息。是否敏感：工作判断为否 | 一般 | 登录会员浏览 | 默认 30 天（`ACTIVITY_LOG_TTL_DAYS`，`activity.service.ts:37`） | 每小时删除到期行（`:292`–`:295`）。本人可删（`:277`） | `BrowseLog`（`schema.prisma:2488`） | 本人 |
| 29 | 外部跳转记录 | 打开来源入口的记录 | 个人信息。是否敏感：工作判断为否。不记录投递或预约结果 | 一般 | 登录会员离开去来源页面 | 默认 30 天，同一环境变量 | 每小时（`activity.service.ts:296`）。本人可删（`:287`） | `ExternalJumpLog`（`schema.prisma:2507`） | 本人 |
| 30 | 收藏 | 收藏的已发布目标 | 个人信息。是否敏感：工作判断为否 | 一般 | 会员收藏 | 账号存在期间 | 未发现到期任务。本人取消即删。托管关闭后收藏目标是否仍能新增，未读生产开关 | `Favorite`（`schema.prisma:2106`） | 本人 |
| 31 | 打印订单元数据 | 订单状态等安全字段 | 能对应到本人，属个人信息。是否含支付账户等敏感信息，待律师确认。矩阵写「我的打印订单」不返回文件地址和支付敏感字段 | 一般。待律师确认 | 下单、打印 | 两份文件都写「业务留痕期，后续按财务 / 审计收口」，没有天数。本草案不补天数 | `services/api/src` 内未找到 `printTask.delete`。清理方式写「未发现定时删除」 | `PrintTask`（`schema.prisma:132`） | 本人看安全元数据。管理员订单管理能看到的字段，未在本表逐项列出 |
| 32 | 反馈与会员通知 | 设备、打印、一般建议 | 内容由用户填写，可能含个人信息。是否敏感：视内容，待律师确认 | 一般 | 用户提交反馈、系统发通知 | 两份文件写「服务处理期」，没有天数 | 未发现定时删除 | `FeedbackTicket`（`schema.prisma:2757`）、`MemberNotification`（`:2707`） | 本人可查看自己的。处理人员范围未逐角色核对 |
| 33 | 求职材料处理任务 | 材料处理过程记录 | 可能关联简历文件，按个人信息对待 | 一般。待律师确认 | 材料处理 | 24 小时（`TASK_TTL_HOURS`，`materials.service.ts:29`，写入 `:150`） | `MaterialsCleanupTask` 每小时（`materials.cleanup.task.ts:17`） | `DocumentProcessTask`（`schema.prisma:1287`） | 当次任务的归属用户。细节未再展开 |
| 34 | 一体机会话人次 | 统计用的开始时间 | 任务注释写「只为统计服务人次」（`kiosk-session-retention.task.ts:12`）。是否含会员号，字段未逐列摘录，是否个人信息待律师确认 | 一般。待律师确认 | 一体机一次使用开始 | 默认 180 天（`kiosk-session.types.ts:32`）。另有空闲 30 分钟的过期戳（`:29`），那是会话失效，不是这 180 天 | 每天 03:30 删除更早的开始记录（`kiosk-session-retention.task.ts:19`–`:23`）。环境变量可改天数 | `KioskSession`（`schema.prisma:3106`） | 运营统计。公开页面是否展示，未核实 |
| 35 | 终端心跳 | 设备在线记录 | 工作判断为设备运维数据。若能对到在场个人，待律师确认 | 一般 | 终端上报 | 默认 90 天（`terminal-heartbeat-retention.task.ts:5`） | 每天 03:00 删除（`:23`–`:27`） | `TerminalHeartbeat`（`schema.prisma:249`） | 管理员运维 |
| 36 | 工具箱启动事件 | 本机工具被打开的记录 | 工作判断偏设备日志。是否含个人标识，未逐字段摘录 | 一般。待律师确认 | 终端工具箱 | 90 天（`terminal-toolbox.service.ts:20`、`:435`） | 每小时按 `expiresAt` 删除（`:621`–`:623`） | `ToolboxLaunchEvent`（`schema.prisma:2684`） | 运维 |
| 37 | 审计日志 | 同意、删除、管理员访问文件等动作 | 可能含会员关联和 IP；个人信息属性由字段决定 | 待律师确认（项目标签） | 关键动作写审计 | 两份期限文件未写天数。`services/api/src` 内未找到 `auditLog.delete` | 未发现定时删除 | `AuditLog`（`schema.prisma:2298`） | 审计人员。角色清单未在本表重列；不以此表替代网络日志判断 |
| 38 | 本机未领取扫描件 | 扫描后尚未被本次办理取走的文件 | 扫描件通常是个人信息，可能是敏感个人信息 | 待律师确认 | 一体机扫描 | 最多 24 小时（`UNCLAIMED_MAX_AGE_MS`，`apps/terminal-agent/src/agent/scan-watcher.ts:122`） | 终端本机清扫。不是云上 cron | 终端本机目录，不在对象存储前缀表内 | 能接触那台机器的人。云上账号权限管不到这批文件 |
| 39 | 本人自填的求职进度 | 公司名、岗位名、自述状态、备注 | 个人信息。状态由本人填写，不是企业回传。是否敏感：工作判断为否 | 一般。待律师确认 | 会员自己记一笔站外进展 | 未发现到期天数。账号存在期间，本人可删 | 未发现定时删除。本人删除走 `jobApplication.deleteMany`（`job-applications.service.ts:259`）。创建在同文件 `:173` | `JobApplication`（`schema.prisma:2138`–`:2176`）。`channel` 默认 `external_self_reported`，`statusSource` 默认 `self_reported`。代码注释写 `resumeFileId`、`consentId` 默认为空，实际数据仍需按接口核对 | 本人。导出映射会读出摘要（`member-data-export.mapper.ts:175`）。字段设计不等于已完成接口隔离，本次未逐个查询接口 |

已批准、矩阵写明未实施的两类，不放入上表，也不写成正在收集：简历智能上下文会话建议、`ResumeProfileSnapshot`。矩阵要求实现前不得描述为已上线。本次未再搜索同名模型。

#### 保存期环境变量对照

下列变量可以覆盖相应的代码默认值；生产值本次未读。没有列出的账号存在期、同意记录、打印订单、反馈通知、审计表等，本文不据此推定有自动清理。

| 代码默认值 | 可覆盖环境变量 | 适用数据 |
| --- | --- | --- |
| 24 小时 | `AI_RESUME_RESULT_TTL_HOURS` | AI 简历结果、自我探索结果、岗位 AI 会话 |
| 90 天 | `AI_SERVICE_LOG_RETENTION_DAYS` | AI 服务日志、AI 用量明细 |
| 24 小时 | `ADVISOR_SESSION_TTL_HOURS` | 顾问会话 |
| 24 小时 | `ADVISOR_ARTIFACT_TTL_HOURS` | 顾问产物 |
| 30 天 | `ACTIVITY_LOG_TTL_DAYS` | 浏览、外部跳转记录 |
| 180 天 | `KIOSK_SESSION_RETENTION_DAYS` | 一体机会话统计 |
| 90 天 | `TERMINAL_HEARTBEAT_RETENTION_DAYS` | 终端心跳 |
| 10 分钟 / 15 分钟 | `MEMBER_EXPORT_TICKET_TTL_SECONDS` / `MEMBER_EXPORT_CLAIM_TTL_SECONDS` | 导出下载票据 / 领取票据 |
| 30 分钟 / 1800 秒 | `MEMBER_SESSION_TTL_SECONDS` | 会员会话（服务层有 `SESSION_TTL = 1800`；实际以调用路径为准） |

文件的 24/6/1 小时、合同 2 小时、未领取扫描件 24 小时和长期保存 `expiresAt = null` 是代码策略常量或产品策略，不得写成生产已核实值。环境变量可以改变的边界、优先级和后台覆盖关系应在上线前形成配置快照。

#### 网络日志与应用审计分开核对

经联网核对现行《网络安全法》，网络日志不少于六个月的要求在第二十三条第三项，不是第二十一条；第二十一条是宣传教育。官方全文见[市场监管总局转载](https://www.samr.gov.cn/zw/zfxxgk/fdzdgknr/bgt/art/2023/art_66129f936b9b4ca188eb073fbf2f144e.html)。试点制度要求 Nginx 访问日志、API 运行日志和管理员审计日志至少保存 180 日，但这三类与 Windows/主机系统日志要分别核对轮转、归档和删除。

`AuditLog`（`schema.prisma:2298`）是应用审计表，当前代码检索未找到 `auditLog.delete` 定时删除；它不能单独证明已满足第二十三条第三项，Nginx/API 规则也不能证明系统日志满足。管理员文件访问动作的审计名称为 `file.admin_access`（`files.controller.ts:271`）。评估报告和处理记录至少保存三年，仓库未找到针对本草案的自动归档任务。

对象存储还有 `partners/`、`admin/uploads/`、`screensaver/materials/`（`object-key.ts:10`–`:16`）。那是机构资料、后台上传和待机画面，不是本表的会员个人数据行。桶级过期规则按文件期限文档禁止覆盖长期对象；业务代码挡不住控制台手工配置。控制台本次未打开。

### 与现有两份文件的差异

下列只记录对不上的地方。期限数字保持两份文件和代码里的原样。

1. 会员矩阵写了 24 / 6 / 1 小时。文件期限文档对未登录文件和证件只写「短期保存」，没有这三个小时数。代码与会员矩阵一致（`file.types.ts:63`–`:65`）。
2. 会员简历即使默认敏感级是 `highly_sensitive`，只要用途是 `resume_upload`、`resume_scan`、`cover_letter`，保存期仍是 90 天，不是 1 小时（`retention-policy.ts:15`–`:19`、`:70`–`:72`）。`id_scan` 才锁在短期并按高敏落到 1 小时。两份文件把「高敏短期」和「简历 90 天」分成两行，这个拆分和代码一致；若只拿敏感级去套 1 小时，会算错。
3. 合同文件固定 2 小时（`retention-policy.ts:13`）。两份文件的「短期」都没有写出 2 小时。高敏默认 1 小时因此不适用于这一类。
4. 登录用户的普通打印件（`print_doc`）不在 90 天集合里，默认 24 小时。两份文件没有单独这一句。
5. 自我探索报告文件按默认策略是 6 小时；自我探索结果行在 `AiResumeResult`，默认 24 小时。两份文件没有把文件和结果行拆开。结果行点撤回后仍留空行，直到每小时任务删行，不是立刻 `deleteMany`。
6. `AiResumeResult` 的清理还会删掉 `expiresAt` 为空的历史行（`ai.service.ts:978`）。两份文件只写「到期硬删」。
7. 长期保存 `expiresAt = null` 不会被过期任务选中。这一点与两份文件一致。对象存储控制台是否另有生命周期，未核实。
8. 打印订单在两份文件和代码里都没有具体天数。本草案不补。
9. 会员矩阵脚注仍写：AI 助手对话与模拟面试转写送模型仍是原文。候选版本里，小青文字和模拟面试文字路径已有遮盖调用；语音对话不经我方遮盖。脚注与代码不再同一句话。遮盖细节写在个人信息保护影响评估里，本表只标这个差异。
10. 第 4、5、6、7、8、9、18、33、34、35、36、37、38、39 行，两份主表没有单独列出，或只被更大的一行盖住。期限来自代码默认值，或写明未发现定时删除。
11. 模拟面试回合和报告在 schema 里声明级联删除。生产 PostgreSQL 是否建成此外键，未验证。也未逐行对照 Postgres schema 文件。
12. 下列默认值都能被环境变量覆盖：`AI_RESUME_RESULT_TTL_HOURS`、`AI_SERVICE_LOG_RETENTION_DAYS`、`ADVISOR_SESSION_TTL_HOURS`、`ADVISOR_ARTIFACT_TTL_HOURS`、`ACTIVITY_LOG_TTL_DAYS`、`KIOSK_SESSION_RETENTION_DAYS`、`TERMINAL_HEARTBEAT_RETENTION_DAYS`、`MEMBER_EXPORT_TICKET_TTL_SECONDS`、`MEMBER_EXPORT_CLAIM_TTL_SECONDS`。生产现值未读；会员会话还存在代码常量与 guard 配置差异，需按运行路径核对。
13. 账号注销线上返回 `ACCOUNT_CLOSURE_NOT_AVAILABLE` /“账号注销暂未开放”。隐私政策应写“目前由我们人工处理”；本次未找到可执行的会员人工注销后台或脚本，因此“随账号删除”在当前试点尚未形成可执行闭环，C1 已列为第一优先改进。
14. 矩阵里的简历智能上下文、`ResumeProfileSnapshot` 仍是未实施。代码侧本次未把它们列入正在收集。
15. 网络安全日志「不少于 6 个月」对应现行《网络安全法》第二十三条第三项，不是第二十一条。它写在试点制度第 1 条，不是这两份期限文件的一行，也没有对应到 `AuditLog` 的清理任务。Nginx、API、Windows/主机系统日志的实际保留均未核实，不能用其中一类推定其他类。
16. 改保存期限时，不需要同意的策略会把同意字段写成空（`retention-policy.ts:170`–`:171`）。是否另写审计，未核实。同意没有历史表。
17. 本人自填的求职进度已补为第 39 行。两份期限文件原先没有这一行。导出文案还提到权益（`packages/shared/src/types/memberPrivacy.ts:26`）。`BenefitGrant` 在 `schema.prisma:2201`。它的字段和保存期本次未摘完，所以没有单独成行。

## 待律师确认的事项

要问律师的问题不放在公开仓库，统一见律师清单（私有，第 34–46 问来自本组三份文件）。本文件正文里标「待律师确认」的地方，结论以律师答复为准。
