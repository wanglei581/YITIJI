# AI 合同审查设计交叉评审记录

## 评审范围

- 正式设计：`docs/superpowers/specs/2026-08-01-ai-contract-review-design.md`
- 评审方式：Codex 主审；Claude、Antigravity、Cursor 只读交叉评审。
- 本轮只审方案，不修改业务代码、数据库、页面或生产配置。

## 首轮结论与修订

### Antigravity

首轮结论为 `REQUEST_CHANGES`。主要问题及处理：

- 全局 highly-sensitive 一小时 TTL 与方案两小时会话冲突：改为服务端锁定的 `contract_upload` purpose-specific 两小时上限，并明确会话结束优先删除、TTL 只作兜底。
- 现有百宝箱 `ai_skill` 与站内工作流冲突：明确同时迁移为 `internal_route`，移除 assistant intent，并同步治理快照。
- 未校验模型结果可能先落库：改为 SafetyGate 通过后与 `completed` 状态同事务原子提交。
- 补充 20 页 OCR 队列影响、PDF.js 资源清理和数据库索引。

### Cursor

首轮结论为 `REQUEST_CHANGES`。主要问题及处理：

- 补齐 Kiosk multipart、UploadSession、ScanTask、object key 和“我的文档”排除链路。
- 明确合同专用 extraction、BullMQ worker、GET 轮询、匿名 token 请求头和 page-local UTF-16 char range。
- 补齐 consent snapshot、全文 PII 遮蔽服务、`legal-risk-check` 边界、生成内容标识 Gate 0、文件预算和双库 CI。

### Claude

首轮结论为 `REQUEST_CHANGES`。主要问题及处理：

- 合同敏感信息可能路由到境外模型：新增合同专用境内 provider/model allowlist，初始化与每次调用均 fail closed，禁止 `openai`、`claude` 等境外 fallback。
- 遗漏服务方自身算法备案/生成式 AI 安全评估：纳入 Gate 0，要求完成适用义务或归档“不适用”的书面依据。
- 将规则分为地域无关确定性、地域相关和语义提醒；未建立地域数据集前只提示核实。
- 匿名明文 token 只留在易失内存；刷新、离席和切换技能立即销毁。
- 澄清 VisionAI / AdvisorAI 是产品架构映射，不是假设仓库已存在统一引擎注册框架。
- 将提示注入防线改为结构隔离、无工具权限、schema 和白名单验证，不声称输出侧能证明系统指令未改变。
- 明确 PII 遮蔽仅覆盖 LLM 上送，OCR 仍处理原始页面，并使主体存在性判断与主体明文解耦。

## 修订版复审

- Antigravity：`APPROVE`，无 Critical、无 Warning。
- Claude：`APPROVE`，无 Critical、无 Warning；额外核验 BullMQ、`expiresAtOverride`、`UserAiConsent.scope`、UploadSession purpose 白名单和百度 OCR 能力均与仓库一致。
- Cursor：应用内置 CLI 最终复审连续两次无输出并人工中止，未把该调用记为通过；其首轮提出的全部仓库落点问题已逐项修订，并由 Claude、Antigravity 复审通过。

## 剩余非阻断说明

- 匿名会话刷新即失是公共终端隐私优先的明确取舍，实施时必须有前置提示。
- 合同审查不得接入后台可动态改 vendor/base URL 的通用 `LlmConfigService`。
- canonical text 与 UTF-16 char range 必须有独立边界测试。
- 法务、隐私、供应商、算法备案/安全评估和生成内容标识 Gate 0 未完成前，生产保持关闭。

## 结论

用户已回复“可以，继续”，据此仅进入实施计划编制，尚未进入编码。

## 实施计划交叉评审

评审对象：`docs/superpowers/plans/2026-08-01-ai-contract-review.md`。

### 首轮

- Antigravity：`APPROVE`，无 Critical；建议把 PostgreSQL schema 改为由 SQLite SSOT 运行 `db:pg:sync` 生成、强化三波文件预算，并为文字层 PDF 增加 50 页硬上限测试。三项均已修订。
- Claude：`APPROVE`，七项核心闭环全部成立；唯一 Warning 是 `legal-risk-check` 长合同文本可能绕过合同专用入口，另建议补证据片段 30 秒自动模糊门禁。两项均已写入 Task 13 的 API 前拦截、E2E 和计时验证。

### 修订回归

- Antigravity：`APPROVE`，无阻断项，确认 SQLite SSOT、50 页整份拒绝、聊天旁路拦截和 30 秒模糊均闭环。
- Claude：`APPROVE`，无阻断项，确认相应 RED 测试、实现片段和门禁命令自洽。
- Cursor：未重复调用实施计划复审；正式设计阶段已完成 Cursor 首轮审查，其提出的仓库落点问题已纳入设计和本计划。此前最终复审调用无输出的事实继续保留，不虚构通过状态。

## 当前结论

正式设计和 14 个任务的逐步实施计划均已完成，无已知阻断项。当前仅等待用户选择执行方式；在用户明确选择前不进入业务代码、数据库或页面实现。

## Wave A Task 1：Gate 0 发布门禁实施审查

审查范围：`d77bf144..62621535`，仅包含：

- `docs/compliance/contract-review-release-gate.md`
- `services/api/scripts/verify-contract-review-gate0.ts`
- `services/api/package.json`

实施采用 RED→GREEN：先证明缺失门禁记录会失败，再建立默认 `blocked`、`production_default: false`、`fail_closed: true` 的记录与 package verifier。后续针对审查发现的重复键、错误 YAML 类型、非法状态、伪批准人、自动化代签、批准生命周期和正文状态漂移逐项补充回归 fixture。

### 本地双阶段审查

- 规格符合性：`APPROVE`。
- 代码质量：`APPROVE`，无 Critical、Important、Minor。
- 实测覆盖：当前 blocked、六种部分批准、最终 approved 生命周期；重复/未知键；错误布尔值；非法 RFC3339；三角色独立 stable ID；占位与自动化身份；正文动态状态镜像；ES2021 严格 TypeScript；ESLint；`git diff --check`。

### 外部双模型交叉审查

- Antigravity：最终 `APPROVE`，无 Critical、无 Warning。
- Claude：最终 `APPROVE`。其两轮 Warning 已处理：bare `ci` 合法身份误报，以及 `office-ci-agent` 一类中段组合漏检。
- Claude 保留一项可接受的 fail-closed 取舍：极少数自然人姓名在移除分隔符后可能偶然形成 `ci+automation-term`，从而被拒绝。该情况不会放行自动化代签，只要求批准人改用另一稳定目录 ID，因此不阻断 P0。

### 结论

Task 1 已封板。Gate 0 静态验证通过只代表记录格式和状态一致性有效，不代表 Gate 已获批准，也不构成生产上线授权；当前正式记录仍为 `blocked`，真实合同 AI 调用和生产入口保持关闭。

## Wave A Task 2：共享契约与状态机实施审查

审查范围：`2e5480d3..622b7aa8`。

- 新增唯一共享合同审查状态常量与 Finding / Result / TaskView 契约。
- `FilePurpose` additive 增加 `contract_upload`，`ScanType` additive 增加 `contract`；UploadSession 请求通过既有 `FilePurpose` 复用自动获得类型支持。
- verifier 自执行严格 ES2021 `tsc --noEmit`，以独立 expected shape 双向冻结状态、合同类型、优先级、分类、Finding、Result、TaskView 和嵌套字段，避免 SWC 擦除类型导致假通过。
- API runtime 的 purpose 白名单、object key、留存策略和 scan mapping 按正式计划留在 Task 4；当前无合同路由或调用方，分支不会在半接通状态交付。

本地规格与质量审查均 `APPROVE`，无剩余 Critical / Important / Minor。Antigravity 最终 `APPROVE`，无 Critical / Warning；Claude 最终 `APPROVE`，确认类型门禁真实有效，并提醒现有 CI 使用显式 verifier allowlist。该提醒已写入 Task 14：合并前必须把 `verify:contract-review:gate0` 与 `verify:contract-review:contract` 接入 CI，未接入不得视为发布门禁完成。

Task 2 已封板，下一步进入双库 `ContractReviewTask` 聚合。

## Wave A Task 3：双库 ContractReviewTask 聚合实施审查

审查范围：`d6623116..67b191e0`。

- SQLite schema 作为唯一真源新增 `ContractReviewTask` 与 EndUser relation；PostgreSQL schema 由 `db:pg:sync` 生成并通过 sync check。
- 两套 migration 仅创建新表、EndUser 外键和五个查询/清理索引，无 DROP / ALTER 既有表或数据写入。
- schema verifier 使用临时 SQLite 预创建文件，真实执行全部 75 条 migration、零 drift 检查和删列负向控制；配置 `POSTGRES_URL` 时只在 postgres-readiness 已完成 fresh deploy 后执行只读 PG drift。
- `verify:contract-review:gate0`、`verify:contract-review:contract`、`verify:contract-review:schema` 已进入 SQLite 主 CI；schema verifier 同时进入 PostgreSQL readiness。

本地规格与数据库质量审查均 `APPROVE`。质量审查额外在 PostgreSQL 16 事务中验证原 migration SQL、索引和 `ON DELETE SET NULL` 后回滚，未保留对象。Antigravity 与 Claude 最终均 `APPROVE`，无阻塞项。`resultJson` 使用 String 是 SQLite SSOT 下保持双库一致的当前取舍；如未来需要服务端 JSONB 查询，应作为独立 additive 演进，不在本任务扩大范围。

Task 3 已封板，下一步进入 `contract_upload` 高敏短期文件链路。

## Wave A Task 4：`contract_upload` 高敏短期文件链路实施审查

审查范围：`b692f0c3..702679d3`。

- Kiosk multipart、UploadSession、ScanTask 三条入口均把合同文件映射为 `contract_upload`，服务端强制 `highly_sensitive`、`private`、`system_short`、固定两小时寿命和 `contract_review_session_only` 留存锁，客户端不能降级或延长。
- 合同文件使用独立对象键目录；匿名路径不包含 session token 或原始文件名。合同及被留存锁定的派生文件不会进入会员“我的文档”。
- 读取、预览、下载、续期和会员绑定统一按持久化 `expiresAt` fail closed；`expiresAt=null` 的异常合同会进入物理删除和数据库软删流程，非合同 null-TTL 长期文件保持原语义。
- 会员绑定及并发绑定不会把两小时寿命重置为会员 90 天，也不会解除留存锁。首次上传、后续访问和管理签名的存储层下载 URL 均截断到文件剩余寿命；不足一秒拒绝签发。
- 扫描采集窗口仍为十分钟；完成后的合同扫描按文件两小时寿命返回。waiting/matched 懒过期使用条件更新，CAS 竞争失败后只重读一次并重新鉴权，响应与并发 completed/cancelled 终态一致。
- `verify:contract-review:file-policy` 最终 13/13 通过；`verify:file-retention`、`verify:upload-sessions`、`verify:scan-tasks`、API typecheck/lint 通过。member-assets 在临时 SQLite 全量 migration 后回归通过；本机无 PostgreSQL URL 的 scan 专项由 postgres-readiness 覆盖。

内部规格审查为 `Spec compliant`，质量审查为 `Ready: Yes`，无 Critical/Important。Claude、Antigravity、Cursor 最终均 `APPROVE`；Cursor 提出的首次上传下载 URL 未统一 clamp 已修复，Claude 提出的精确秒数测试 flake 已改为稳定性质断言并由三方复审通过。

保留一项非阻塞维护债务：`services/api/src/files/files.service.ts` 已超过 800 行，后续继续向文件服务新增职责前必须先拆分签名访问与生命周期清理；本任务不以重构扩大范围。

Task 4 已封板。Gate 0 正式记录仍为 `blocked`，本结论不代表合同 AI 生产入口可开启。下一步进入版本化免责声明与独立同意。

## Wave A Task 5：版本化免责声明与独立同意实施审查

审查范围：`61d03337..3771957a`。

- `contract_review` 与 `job_ai` 使用独立 scope 和版本；HTTP grant/revoke DTO 与 service 均只接受两个显式 scope，未知值及 `toString`、`__proto__` 等原型键在 Prisma 调用前 fail closed。
- 授权保留 append-only 事件语义；状态页和后端授权检查统一读取 `grantedAt desc, id desc` 的最新任意版本事件，再判断当前版本和撤回时间，消除了多记录时 UI 与服务端真相分裂。
- 撤回合同审查同意在同一 Prisma transaction 中撤回该 scope 所有 active 记录，并以明确处理中状态集合把会员任务收敛到 `cancelled`，不覆盖 `completed/failed/cancelled/expired` 终态；失败响应脱敏。
- `contract_review_disclaimer` 已登记为法律文档类型，但创建仍固定为未激活草稿，未自动发布任何文案，也未解除 Gate 0。
- `verify:contract-review:consent` 已注册并接入主 CI；`verify-job-ai-privacy` 使用 TypeScript AST 冻结 scope 必须为唯一、纯字符串字面量、无重复的精确联合，拒绝 `| string`、intersection、`typeof` 和增删成员等宽化形式。

最终 `verify:contract-review:consent` 21/21、法律文档 11/11、岗位 AI 隐私、会员数据请求、API/shared typecheck 与 lint 均通过。内部规格审查为 `Spec compliant`、质量审查为 `Ready: Yes`；Claude、Antigravity、Cursor 最终均 `APPROVE`。

后续硬门禁：Task 6 必须让会员任务创建的最终 consent 校验与 task insert 采用同一 Serializable/retry 并发协议，避免撤回与创建交错后遗留处理中任务；Task 14 必须用真实 PostgreSQL 双连接验证该竞态和事务回滚。历史数据权利请求 `revoke_consent` 当前保持 `job_ai` 语义，是否扩展为全部 AI scope 需独立产品决策，不在本任务静默改写。Kiosk 局部 scope 类型和 Admin 免责声明下拉在对应 UI 任务统一收口。合同同意测试文件已达 800 行，后续扩展前必须拆分 harness。

Task 5 已封板，下一步进入归属、匿名令牌与状态机核心。

## Wave A Task 6：归属、匿名令牌与状态机核心实施审查

审查范围：`b18ca731..15305eb7`。

- 会员与匿名 task owner 严格 XOR；匿名 task token 使用 32 字节 base64url CSPRNG，数据库只存 SHA-256，畸形 token/hash 在等长检查后安全拒绝并使用 `timingSafeEqual`。
- 匿名 create 不再把随机 `sourceFileId` 当作唯一授权：必须同时持有上传响应的短期 HMAC signed content URL proof，验签、有效期与 fileId 精确一致；缺失、错文件、过期或畸形 proof 与不存在同形 404。proof 不落库、不记录，TTL 内允许重试，Task 12 仍须执行 create 限流。
- 源文件必须是本人/当前匿名会话可证明持有的 active `contract_upload`，未删除且未过期；task `expiresAt` 精确继承源文件，不重新延长。
- create 同一事务要求唯一 active `contract_review_disclaimer`；0 个、多个、空白正文/版本/ID、无效或未来发布时间均 503 fail closed。canonical scope hash 绑定 scope、当前 consent version、文档 ID/version/原始 content SHA-256/publishedAt 和七项机器可读披露，task 只存服务端真相。
- 匿名 consent 时间窗口固定为 15 分钟、未来容差 60 秒且不得早于免责声明发布；会员使用数据库最新授权事件并要求 grant 不早于当前免责声明发布。一次 create 捕获单一可注入服务端时钟快照，避免边界和 P2034 重试漂移。
- 会员 create 的 latest consent read 与 task insert、合同 consent revoke 与 processing task cancel 共用 PostgreSQL Serializable + 精确 P2034 三次有界重试；SQLite 明确省略不支持的 isolation 参数。真实 PostgreSQL 双连接线性一致验证仍是 Task 14 硬门禁。
- 状态迁移表与嵌套数组运行时冻结；终态只可进入 expired，expired 无出边。测试使用独立硬编码矩阵，不再从实现自证。

审查期间修复了两项阻断：fileId-only 匿名 IDOR 与未绑定服务端免责声明/同意内容的伪快照；随后修复空白/未来免责声明和时间边界测试抖动。最终核心测试 28/28，50 轮稳定循环通过，lines 96.90%、branches 92.55%、functions 91.30%；Task 5 consent 21/21、file-policy、schema（本机 PG 按规则 skip）、legal、member-data、job-ai privacy、API typecheck/lint 与 `git diff --check` 通过。内部规格审查 `Spec compliant`、质量审查 `Ready: Yes`；Claude、Antigravity、Cursor 最终均 `APPROVE`。

后续硬约束：Task 12 必须提供 `GET /contract-reviews/consent-scope`，匿名 create 只从 `x-contract-review-source-file-proof` header 读 proof，Kiosk 不复制 canonical hash 算法；Task 14 必须完成真实 PostgreSQL 双连接 create/revoke 竞态。`contract-review-service.test.ts` 已 999 行，后续不得继续堆测试，必须新建分层测试文件；`contract-review.service.ts` 已 479 行，Task 12 再新增 HTTP/读写职责前必须拆分 consent/access 或 repository 边界。

Task 6 已封板，下一步进入逐页提取与 canonical text。

## Wave B Task 7：逐页提取与 canonical text 实施审查

审查范围：`0c3374cf..c291ef52`。

- canonical text 统一为 NFC + LF，所有证据偏移使用 UTF-16 code units；PDF 逐页保留原页码，文字层不可靠时才进入 OCR，稀疏页数组、畸形页数、OCR 页数超限、空识别与部分失败均 fail closed。
- PDF 文字层 proxy 与 OCR renderer 独立释放，原始错误优先；只有 renderer 成功销毁后才上报最终 100%。单页 200,000、整份 2,000,000 UTF-16 code units 的输出预算已锁定。
- 文件读取通过 `FilesService.readContentForEndUser` 复验 active、归属、删除和过期状态，再断言 `contract_upload`，关闭 create 到 worker 执行之间的 TOCTOU。
- DOCX 在进入 mammoth 前执行流式 ZIP 预检：标准 Unicode Path extra、NFC canonical path、central/local 路径一致、三方 CRC、Zip64/多盘/加密/data descriptor/未知压缩方法拒绝、4,096 entries、64 MiB 总量与全部非目录 entry 统一 16 MiB 实际/声明内容预算；不以媒体魔数绕过预算。
- 最终专项测试 31/31；Contract Review 全套 97 通过、1 个 PostgreSQL 环境性 skip；API typecheck/lint、真实生成 DOCX 安全预检与 mammoth 解析均通过。

内部规格审查与质量审查均为 `APPROVE / Ready: Yes`；Antigravity、Claude、Cursor 最终均 `APPROVE`。审查期间发现的 sparse array、active TOCTOU、Nest DI、短页眉误判、Unicode 计数、DOCX 解压炸弹、Unicode Path、relationship 预算绕过、CRC 与媒体豁免问题均已修复并回归。

Task 12 必须在 processor 层补可终止 worker、总执行时间和内存上限；该项是硬发布门禁。Task 7 封板不代表生产可用，Gate 0 正式记录继续保持 `blocked`。下一步进入版本化规则包。
