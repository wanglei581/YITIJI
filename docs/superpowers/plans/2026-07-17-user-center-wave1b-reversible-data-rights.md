# User Center Wave 1-B：可逆数据权利实施计划

> **状态：规划完成，尚未进入运行时代码实施或部署。**
>
> **执行总闸：** 本计划只实施可逆的数据导出闭环。账户注销在法务签字的分类留存矩阵、冷静期、财务/审计保留期限和独立执行开关全部齐备前，必须在数据库、Redis、BullMQ、文件存储和审计写入之前以 `ACCOUNT_CLOSURE_NOT_AVAILABLE` 拒绝；不得创建工单、消费 step-up grant 或改变会员状态。
>
> **实施方式：** 每个切片独立分支、先 RED 后 GREEN、合并前完成 SQLite 主 CI 与 PostgreSQL readiness。不得把可见 Kiosk/Admin UI、真实短信、真实会员导出、生产配置或不可逆删除混入本波。

**目标：** 在既有 `UserDataRequest` 账本上，交付可审计、可重试、本人隔离的数据导出后端：幂等申请、异步白名单 JSON、私有短期文件、一次性下载租约、HTTP `finish` 后清理、过期收口。同步把账户注销固定在无副作用的 fail-closed 边界。

**当前代码事实：**

- `services/api/src/member-privacy/member-privacy.service.ts` 当前可创建 `export/delete/revoke_consent` 的 `pending` 行；对 export/delete 已阻断伪造 `completed`，但尚无执行器，且 `delete` 仍可能落账本。
- `services/api/src/member-auth/member-step-up.service.ts` 已有 `export_data_request`、`export_data_download`、`close_account` 的一次性 grant；`consumeGrant()` 会先原子消费，再复核会员仍为 `active`。
- `services/api/prisma/schema.prisma` 和 `services/api/prisma/postgres/schema.prisma` 的 `UserDataRequest` 只有基础状态字段；文件、审计、BullMQ、Redis 均已有可复用基础。
- `services/api/src/audit/audit.service.ts` 的 `write()` 按兼容约定吞掉数据库错误，不能作为本计划的必需审计写入。

## 1. 功能归位、文件预算与非范围

| 层 | 允许路径 | 责任 |
| --- | --- | --- |
| 共享契约 | `packages/shared/src/types/member-privacy.ts`、`packages/shared/src/types/file.ts` | 数据请求、导出授权与文件 purpose 的唯一前端契约。 |
| API 隐私域 | `services/api/src/member-privacy/**` | 状态机、本人授权、队列、导出、下载租约、reconciler 与 Admin 受限动作。 |
| API 文件/审计/Redis | `services/api/src/files/**`、`services/api/src/audit/audit.service.ts`、`services/api/src/common/redis/redis.service.ts` | 窄化的内部保留期、必需审计与原子 ticket/claim 原语。 |
| 数据库 | 两份 Prisma schema 与同名双 migration | 只做 additive 账本扩展，SQLite / PostgreSQL 同步。 |
| Kiosk | `apps/kiosk/src/routes/index.tsx` 和一个无导航入口下载页（仅 Slice 3） | 只消费 URL fragment 并提交 ticket header；不新增「我的」入口或首页卡片。 |
| 验证与 CI | `services/api/scripts/verify-member-data-request-*.ts`、`services/api/package.json`、`.github/workflows/ci.yml` | 用真实 SQLite 夹具锁住状态机、隔离、对象补偿与 ticket 行为。 |

**明确不涉及：** `apps/admin/` 运营 UI、`apps/terminal-agent/`、订单/支付/退款状态、岗位/招聘会、真实短信、数据迁移回填、生产环境、任何 `EndUser` 删除/匿名化 handler、任何账号恢复或 `closing` 状态迁移。

**文件体积控制：** `member-privacy.service.ts` 仅保留 AI consent；新建 `member-data-request.service.ts`、`member-data-export.service.ts`、`member-data-export.mapper.ts`、`member-data-export-reconciler.service.ts`，每个文件单一职责、目标不超过 300 行。不得把 queue、ticket、mapper 和 controller 继续堆入原 service。

## 2. 不可协商的不变量

1. `UserDataRequest` 是唯一隐私请求账本；不得新增并行 Export、Deletion 或 Download 表。
2. `delete` 在 controller/service 的第一处业务分支即拒绝，且测试证明拒绝前没有 Prisma、Redis、BullMQ、文件或审计副作用；任何缺省或异常配置也只会拒绝。
3. `export` 与未来 `delete` 共享会员级 `activeKey`，同一会员最多一个非终态高风险请求；幂等键唯一约束为 `@@unique([endUserId, idempotencyKey])`，避免跨会员冲突或可探测性。
4. grant 只在确认需要创建新 export 后消费；同 key 的顺序重放与并发重放返回同一工单，绝不二次消费 grant 或产生第二个 job。
5. 所有非 `revoke_consent` 的状态迁移使用带 `id + status + executionVersion` 的 CAS；worker 重投、重启、重复 delivery 不能生成第二份有效导出包。
6. export 内容只能由编译期显式 mapper 构造，不能 `select *`、`spread` Prisma row 或先取全量再删黑名单。默认禁止：手机号明文/密文/哈希、对象 key/bucket/region、签名 URL、token、验证码、`AuditLog`、内部错误、完整 AI prompt/output、原始文件字节与未审计 `itemsJson`。
7. 导出包只可为 `private + highly_sensitive + system_short`，TTL 不超过 24 小时；存储写成功而账本更新失败时必须物理补偿删除，不能返回成功。
8. 明文 ticket 不得进入 query、cookie、local/session/IndexedDB、日志、审计 payload 或埋点；Redis 仅保存 SHA-256 ticket hash。ticket 仅经 URL fragment 进入无导航下载页，随后立即清除 fragment 并放入 `x-member-download-ticket` header。
9. 下载端点的 ticket 是短时 bearer capability，必须限流、单次 claim、无 JWT、无对象存储 URL。`completed` 只表示 HTTP `finish` 已触发且对象物理清理和账本 CAS 都成功，不表示用户设备永久保存了文件。
10. 审计与需要它证明的状态必须同一 Prisma transaction 成功；不能继续调用会吞错的 `AuditService.write()`。

## 3. 目标状态机与公开契约

导出状态机仅允许：

```text
pending -> handling -> ready -> handling(download_cleanup_pending) -> completed
pending -> failed
handling -> failed
ready -> expired | failed | handling(download_cleanup_pending)
failed -> pending                 # 仅 Admin retry，executionVersion + 1
pending | failed -> rejected      # 仅 export，必须有必需审计
```

- 任何终态均不再生成新 artifact；`expired/completed/rejected` 清空 `activeKey`。
- `failed` 保留 `activeKey` 和原 request，防止用户重复申请造成并行导出；清理失败只走 reconciler，不重生成 artifact。
- 现有 `revoke_consent` 继续同步完成，但将其「同意撤回 + `UserDataRequest(completed)` + required audit」放入同一 transaction。
- `delete` 永远不是上述状态机输入。现有删除申请创建入口改为稳定的 409/403 业务错误 `ACCOUNT_CLOSURE_NOT_AVAILABLE`，不返回“已受理”的错觉。

将 shared/API 本地副本统一为下列最小外部字段（内部 `failureMessage` 不得出现在会员 DTO）：

```ts
export interface MemberDataRequestItem {
  id: string
  requestType: 'export' | 'delete' | 'revoke_consent'
  status: 'pending' | 'handling' | 'ready' | 'completed' | 'expired' | 'failed' | 'rejected' | 'cancelled'
  requestedAt: string
  handledAt: string | null
  executionStep: string | null
  exportExpiresAt: string | null
  failureCode: string | null
  canRetry: boolean
  canDownload: boolean
}
```

`GET /api/v1/me/data-requests` 改为 cursor 分页（最大 50），而非现有固定 `take: 50`。`POST /api/v1/me/data-requests` 要求 `Idempotency-Key` UUID；export 额外要求 `x-member-step-up-token`，并将 `x-terminal-id` 仅作为 step-up device 绑定输入。数据下载授权为 `POST /api/v1/me/data-requests/:id/download-authorizations`，内容端点为 `GET /api/v1/member/data-exports/:id/content`，只接受 header ticket。

## 4. 实施切片

### Slice 1 — 账本、契约和注销无副作用闸门

**目的：** 先固定导出所需的数据契约与 state machine，同时确保系统从任何现有 delete 请求路径都不会产生副作用。

**修改：**

- `packages/shared/src/types/member-privacy.ts`
- `services/api/src/member-privacy/member-privacy.types.ts`
- `services/api/src/member-privacy/member-privacy.service.ts`
- `services/api/src/member-privacy/member-privacy.controller.ts`
- `services/api/src/member-privacy/admin-member-privacy.controller.ts`
- `services/api/prisma/schema.prisma`
- `services/api/prisma/postgres/schema.prisma`
- `services/api/prisma/migrations/20260717130000_extend_user_data_requests/migration.sql`
- `services/api/prisma/postgres/migrations/20260717130000_extend_user_data_requests/migration.sql`
- `services/api/scripts/verify-member-data-request-state-machine.ts`（新建）
- `services/api/scripts/verify-member-data-request-truth.ts`
- `services/api/package.json`

**实现步骤：**

1. 先为 shared/API 副本写一份结构比对 verify，锁住 request type/status/step-up allowlist；保持 API CommonJS 本地副本的既有惯例，禁止直接在 API runtime import ESM-only shared 包。
2. 以 additive 方式扩展 `UserDataRequest`：`idempotencyKey`、`activeKey`、`executionVersion`、`executionStep`、`progressJson`、`workerJobId`、`exportFileId`、`exportExpiresAt`、`downloadConsumedAt`、`failureCode`、`retryCount`、`lastAttemptAt`、`auditRef`。SQLite 与 PostgreSQL migration 均须显式书写，PostgreSQL 使用 `TIMESTAMP(3)`；不回填历史 key。
3. 增加 `@@unique([endUserId, idempotencyKey])`、`@unique activeKey`、`@unique exportFileId` 与 `(endUserId, requestType)`、`status`、`requestedAt`、`exportExpiresAt` 索引。SQLite/PG 对 nullable unique 的语义需由实际 migration replay 验证。
4. 把 request 逻辑移入新 `member-data-request.service.ts`，将 `MemberPrivacyService` 收敛到 consent；旧 controller 只改依赖，不改变 `/me/ai-consents` 路由。
5. 在新 service 的 `create()` 第一处分支处理 `requestType === 'delete'`：抛 `ACCOUNT_CLOSURE_NOT_AVAILABLE`。该分支必须发生在 idempotency 查询、Redis lock、step-up consume、Prisma transaction、queue 检测和审计调用之前。
6. 为 export 使用 transaction 内「先按 `(endUserId, idempotencyKey)` 重放查询、再查 activeKey、后 create」的数据库事实源；Redis 仅可作为短期并发收敛，唯一约束冲突要重读并稳定映射业务错误，不能泄露底层约束名。
7. 现有 `PATCH /admin/member-privacy/data-requests/:id` 不得继续接受任意状态；本切片先只保留 export 的 `rejected`，其它管理动作在 Slice 5 专用路由实现。delete 不论状态都不得 reject/cancel/complete。

**先红后绿验收：**

```bash
PAYMENT_PROVIDER=disabled pnpm --filter @ai-job-print/api verify:member-data-request-state-machine
PAYMENT_PROVIDER=disabled pnpm --filter @ai-job-print/api verify:member-data-request-truth
pnpm --filter @ai-job-print/shared typecheck
pnpm --filter @ai-job-print/api db:pg:sync:check
```

verify 至少覆盖：delete 的每一个外部依赖 mock 均为零调用；相同会员/键重放不消费第二个 grant；不同会员可使用相同 UUID；export 与 future delete 的 activeKey 冲突不消费 grant；Admin 无法写 `completed/ready/failed`；历史无 key 行仍可查询。

### Slice 2 — 必需审计、敏感队列和导出 artifact

**目的：** 生成单个可追溯的私有导出包；Redis/BullMQ 缺失时拒绝 export，绝不 inline 运行。

**修改或新建：**

- `services/api/src/audit/audit.service.ts`
- `services/api/src/member-privacy/member-privacy.queue.ts`（新建）
- `services/api/src/member-privacy/member-privacy.processor.ts`（新建）
- `services/api/src/member-privacy/member-data-request.service.ts`
- `services/api/src/member-privacy/member-data-export.service.ts`（新建）
- `services/api/src/member-privacy/member-data-export.mapper.ts`（新建）
- `services/api/src/member-privacy/member-privacy.module.ts`
- `services/api/src/files/file.types.ts`
- `packages/shared/src/types/file.ts`
- `services/api/src/files/file-validation.ts`
- `services/api/src/files/retention-policy.ts`
- `services/api/src/files/files.service.ts`
- `services/api/src/storage/object-key.ts`
- `services/api/scripts/verify-member-data-export.ts`（新建）
- `services/api/package.json`、`.github/workflows/ci.yml`

**实现步骤：**

1. 在 `AuditService` 新增 `writeRequired(tx, args)`：复用现有 payload 限长/安全序列化，但使用调用方 transaction client，写失败必须抛出。旧 `write()` 保持兼容；export create、Admin decision/retry、artifact ready/expired/cleanup 统一改为必需审计。
2. 按 `services/api/src/job-sync/job-sync.module.ts` 的条件注册模式注册 `MEMBER_PRIVACY_QUEUE`，但与 JobSync 不同：没有 `REDIS_URL` 时不注册 processor，也不能在 service 内 `setImmediate` fallback。`assertQueueAvailable()` 是 export 创建、retry、finish enqueue 的共同 fail-closed 前置条件。
3. job data 只含 `{ requestId, executionVersion }`，job id 固定为 `${requestId}:${executionVersion}`。queue add 成功后再 CAS 写 `workerJobId`；add 失败以同一 request CAS 为 `failed/QUEUE_ENQUEUE_FAILED`，保留 activeKey，且写 required audit。
4. 新增 `member_data_export` purpose，且只允许 `application/json`、`highly_sensitive`、`system_short`、user scope object key。shared/API 文件类型、`PURPOSE_POLICY`、默认敏感等级、retention policy 和 `PURPOSE_FOLDER` 必须同一提交同步。
5. 把 `FilesService.upload()` 的现有 `expiresAtOverride` 收紧为仅内部的 `retentionOverride`；只有上述 purpose、`system_short`、`expiresAt > now && <= now + 24h` 才可进入。对象 put 成功而 `FileObject.create` 失败时立即物理删除；补偿失败只记安全摘要，不泄露 object key。
6. `MemberDataExportService.execute()` 先 CAS `pending/failed -> handling`；仅允许一个 worker 取得 executionVersion。它调用 mapper 取得纯数据，先检查每分区行数和序列化总字节上限，再上传；任何超过上限为稳定 `EXPORT_TOO_LARGE`，不截断、不创建部分 artifact。
7. artifact 创建后以 `id + handling + executionVersion` CAS 写 `ready/export_ready/exportFileId/exportExpiresAt`；若账本更新失败，调用 `FilesService.systemDelete()` 补偿。重复 job 遇到有效 `ready` 行直接幂等返回；遇到已终态不重新生成文件。

**导出白名单 v1：**

```text
account          id、昵称、创建时间（不含手机号和密码/会话字段）
dataRequests     requestType、status、申请/处理时间、公开 failureCode
files            id、文件名、MIME、大小、purpose、资产类别、创建/到期时间
favorites        targetType、targetId、标题快照、创建时间
activity         浏览/外跳的安全目标标识与时间，不含外部投递/预约结果
consents         scope、版本、授权/撤回时间
notifications    仅已面向会员展示的标题、类型、时间、已读状态
feedback         本人提交的主题、公开状态、创建时间；联系信息排除
printOrders      已有安全只读 DTO 的非资金敏感摘要；禁止复用未经审查的 itemsJson
```

二进制原件、简历正文、完整 AI 输出/转写、原始订单 items、审计日志、内部票据不在 v1 包内。此范围在开放可见入口前必须由法务/隐私负责人确认是否满足适用的数据副本义务；未确认前，只能内部测试账号验证，不对外声称「完整个人数据副本」。

**先红后绿验收：** 创建两名隔离会员及不同资产，递归扫描导出 JSON；任何另一会员 ID/标题、11 位手机号、`phoneEnc|phoneHash|storageKey|objectKey|signedUrl|token|prompt|output` 均失败。另验证 Redis 缺失、queue add 失败、上传后 DB 写失败、重复 processor、超限包、required audit 写失败均不出现 `ready/completed` 假象或孤儿对象。

### Slice 3 — 一次性下载租约与异步清理

**目的：** 不向终端或手机暴露对象存储 URL，并让网络中断、并发 GET、过期 ticket 都有可恢复且诚实的状态。

**修改或新建：**

- `services/api/src/common/redis/redis.service.ts`
- `services/api/src/member-privacy/member-data-request.service.ts`
- `services/api/src/member-privacy/member-data-export-reconciler.service.ts`（新建）
- `services/api/src/member-privacy/member-privacy.processor.ts`
- `services/api/src/member-privacy/member-privacy.controller.ts`
- `services/api/src/member-privacy/member-privacy.module.ts`
- `apps/kiosk/src/routes/index.tsx`
- `apps/kiosk/src/pages/member-export-download/MemberExportDownloadPage.tsx`（新建）
- `apps/kiosk/src/services/api/memberDataRequests.ts`（新建）
- `services/api/scripts/verify-member-data-export.ts`

**实现步骤：**

1. `authorizeDownload()` 先消费 `export_data_download` grant，再查本人 `ready`、未过期、未消费的 request。它生成 32-byte token，Redis 只存 SHA-256 hash，TTL 10 分钟，并返回 `` `${publicWebBase}/member/export-download#request=${requestId}&ticket=${ticket}` ``；不得生成 COS/local signed URL。
2. Redis 新增 Lua 原子原语：ticket 未失效、request claim 未占用时，删除 ticket hash、建立 120 秒随机 `claimId` 租约；同一个请求的两个 GET 至多一个成功。value 只保存 requestId/endUserId/claimId，不含对象 key。
3. 公开内容 controller 不继承 `EndUserAuthGuard`，但显式 `@Throttle`、长度/格式验证和 `Cache-Control: no-store, private`、`X-Content-Type-Options: nosniff`。token 只读取 `x-member-download-ticket`，对不存在/他人/过期统一 404，日志只写 requestId 的安全摘要和稳定错误码。
4. content handler 读取的是服务端 `FilesService.readContent()` buffer，且再次核对 request、artifact purpose、存活状态、大小与 ownership。controller 在发送前注册 `finish` 和 `close`：`finish` 仅将 `ready -> handling(download_cleanup_pending)` 并入清理 job；`close/error` compare-and-delete 当前 claim，保留 `ready` 和对象，用户须重新 step-up 获取新 ticket。
5. reconciler 对 `download_cleanup_pending` 调用 `FilesService.systemDelete()`，删除成功后才 CAS `completed/activeKey=null/handledAt/downloadConsumedAt`；对象 NotFound 必须先以 `FileObject.deletedAt`/受控存储检查证明确实不可读，不能盲目当成功。
6. 每分钟至多一个稳定 sweep job（有 Redis 才注册），按游标/上限处理：过期 ready 包先撤销 ticket/claim，再物理删除，成功才 `expired/activeKey=null`；过期 claim 只释放租约，不删仍 ready 的对象。sweep 失败保留非终态并写安全告警/审计。
7. Kiosk 下载页不加入导航或 `/me/settings`。它读取 hash 后第一时间 `history.replaceState()` 清掉 fragment，以 header 请求 content；不把 ticket 放入 React state 持久层、浏览器存储或错误上报。页面仅渲染下载处理中/已开始/已失效的无敏感文案。

**先红后绿验收：** 两个并发 content 请求恰好一份 bytes；`close` 先发生时对象仍可读且 status 仍 `ready`；`finish` 前不能 `completed`；物理删除或 required audit 失败时不能清 activeKey；ticket 重放、ticket 写 query、ticket 出现在 logger/analytics 参数、他人 requestId 均被拒绝。

### Slice 4 — 受限运营动作、回归与发布准备

**目的：** 让导出失败能由受限运营流程恢复，但不建设 Admin 页面、不让人工伪造任何 worker 终态。

**修改：**

- `services/api/src/member-privacy/admin-member-privacy.controller.ts`
- `services/api/src/member-privacy/member-data-request.service.ts`
- `services/api/scripts/verify-member-data-request-state-machine.ts`
- `services/api/scripts/verify-member-data-export.ts`
- `.github/workflows/ci.yml`
- `docs/compliance/member-personal-data-retention.md`
- `docs/progress/current-progress.md`
- `docs/progress/next-tasks.md`

**实现步骤：**

1. 将 Admin API 拆为 `retry`、`reject`、`detail` 三个专用动作。`retry` 仅允许 export `failed`，先检查 queue，CAS 增加 executionVersion/retryCount，再 enqueue；enqueue 失败时回到 `failed`，不生成第二行。`reject` 仅允许 `pending/failed` export，原因 1–200 字、PII 扫描、required audit；Admin 永远不能设置 `ready/completed/expired/failed`。
2. 不开放 delete retry/reject/escalate UI 或 API 行为；delete 保持在创建前拒绝，避免 future legal policy 未就绪时出现 `closing` 残留账号。
3. 更新 `docs/compliance/member-personal-data-retention.md` 的 export artifact 规则（purpose、最大 TTL、物理清理、ticket 不留存、v1 范围与非范围），但不把账号注销矩阵写成已签字或已可执行。
4. 开放前只进行内部测试账号的 browser/HTTP 演练；生产发布单独审批，需确认 Redis、私有存储 at-rest encryption、TLS、可信 `trust proxy` 跳数、日志脱敏、告警路由、留存审批与回滚路径。

## 5. 账户注销：永久 fail-closed 设计

本波只提交和验证闸门；以下内容必须在法务签字后另立计划、另建分支并重新做威胁建模：

- 数据类别的 `delete/anonymize/detach/retain` 版本化矩阵与法律依据；当前 `docs/compliance/member-personal-data-retention.md` 只是留存说明，不能当作可执行删除 policy。
- 冷静期、撤销/申诉、通知、人工审批与最小回执时限。
- 财务、订单、退款、核销、打印、审计、文件和 AI 记录的精确保留期限及关联解绑方式。
- `MEMBER_ACCOUNT_CLOSURE_EXECUTION_ENABLED` 的安全默认、密钥/配置审计、双人变更流程与生产演练。
- `EndUser` 变为 `closing/anonymized`、会话/step-up 撤销、PII 墓碑化、对象删除、重试补偿、完成回执。

未来在进入任何 DB transaction 前，closure guard 必须同时要求：执行开关显式 `true`、签字 policy version 精确匹配、冷静期为有效正整数、财务/审计保留期为有效正整数。任一读取异常或不满足均为 `ACCOUNT_CLOSURE_NOT_AVAILABLE`；不得把空值解释为零，不得创建 pending request 供人工「以后处理」。

## 6. 验证、审查和完成定义

每个切片合并前至少执行：

```bash
pnpm --filter @ai-job-print/shared typecheck
pnpm --filter @ai-job-print/api db:pg:sync:check
PAYMENT_PROVIDER=disabled pnpm --filter @ai-job-print/api verify:member-account-status
PAYMENT_PROVIDER=disabled pnpm --filter @ai-job-print/api verify:member-step-up
PAYMENT_PROVIDER=disabled pnpm --filter @ai-job-print/api verify:member-data-request-truth
PAYMENT_PROVIDER=disabled pnpm --filter @ai-job-print/api verify:member-data-request-state-machine
PAYMENT_PROVIDER=disabled pnpm --filter @ai-job-print/api verify:member-data-export
PAYMENT_PROVIDER=disabled pnpm --filter @ai-job-print/api verify:file-retention
PAYMENT_PROVIDER=disabled pnpm --filter @ai-job-print/api verify:member-print-orders
pnpm --filter @ai-job-print/api lint
pnpm --filter @ai-job-print/api typecheck
pnpm --filter @ai-job-print/api build
pnpm --filter @ai-job-print/kiosk typecheck
pnpm --filter @ai-job-print/kiosk lint
pnpm --filter @ai-job-print/kiosk build
git diff --check origin/main...HEAD
```

合并前的安全复审必须逐项检查：IDOR、同 key 并发、grant action 混淆与重复消费、Redis/queue outage、queue replay、状态 CAS、对象 orphan、TTL 边界、ticket/claim 日志泄露、HTTP finish/close 顺序、意外 `completed`、跨用户 select/delete、审计失败回滚、SQLite/PostgreSQL nullable unique 差异。

**Wave 1-B 完成定义：**

- export 能在测试环境从申请到 `ready`、单次 delivery、物理清理或到期收口全程可复验；失败仅到可解释、可重试状态，绝不伪完成。
- 包内容是已批准白名单，导出和日志均不含禁止字段；任何 artifact 一天内失效并物理删除。
- 无 Redis/BullMQ/存储/required audit 时 export fail closed；不引入 inline fallback。
- delete 从 HTTP 到 service、queue/worker 均没有可达的执行路径，且验证证明零副作用。
- 没有新增用户中心可见入口、重复页面或假数据闭环；Admin UI 留待 Wave 1-C。

## 7. 推荐执行顺序

推荐先实施 **Slice 1**，以最小、安全、可回退的 schema/contract/closure gate 验证当前基线；通过双数据库 CI 和安全复审后，依次推进 Slice 2、Slice 3、Slice 4。禁止将 Slice 2–4 压缩为单个 PR，也禁止在法务签字前把任何 delete worker、数据删除或账号状态变更混入导出切片。
