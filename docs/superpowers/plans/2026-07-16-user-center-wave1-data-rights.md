# User Center Wave 1 Data Rights Implementation Plan

> **Execution gate:** 本计划已完成技术复审，但在法务签字确认分类留存矩阵、冷静期、财务/审计期限与最小审计字段前，不得进入不可逆注销实现；`MEMBER_ACCOUNT_CLOSURE_EXECUTION_ENABLED` 默认必须为 `false`。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 `UserDataRequest` 账本上完成本人幂等申请、BullMQ 异步导出、一次性下载、账户分类注销、失败重试与安全审计，且任何中途失败都不能产生虚假 `completed`。

**Architecture:** `MemberDataRequestService` 负责状态机和 queue 调度；`MemberDataExportService` 只按白名单聚合本人数据并复用 `FilesService` 生成短期私有 `FileObject`；`AccountClosureService` 只能按法务签字的版本化分类处置矩阵逐步执行会话撤销、对象物理删除、删除/匿名解绑和 PII 墓碑化。敏感任务运行在现有 API 进程的 NestJS BullMQ processor 中，因为 `services/worker` 当前没有实现；无 Redis/queue、执行开关关闭或法务参数不完整时 fail closed，不使用 inline fallback。

**Tech Stack:** NestJS + Prisma + BullMQ + Redis；SQLite/PostgreSQL；FilesService/StorageService；AuditService；Node crypto；shared TypeScript contracts。

> **执行状态（2026-07-17，`origin/main@d4101fcc`）：** 本计划的 Slice 1（账本、导出 step-up 预约、同步撤回同意和 `delete` 零副作用闸门）已由 PR #275 合入 `main@0ae51289`，未部署。恢复型导出 Slice 2 仅有已入主线的设计方案，尚未有运行时代码合入；真实下载、账户注销和不可逆处理继续禁止。本计划中的复选框保留为原始完成定义。

---

## 0. 文件预算与不变量

**Create:**

- `services/api/prisma/migrations/20260717110000_extend_user_data_requests/migration.sql`
- `services/api/prisma/postgres/migrations/20260717110000_extend_user_data_requests/migration.sql`
- `services/api/src/member-privacy/member-privacy.queue.ts`
- `services/api/src/member-privacy/member-data-request.service.ts`
- `services/api/src/member-privacy/member-data-export.service.ts`
- `services/api/src/member-privacy/member-data-export.mapper.ts`
- `services/api/src/member-privacy/member-data-export-reconciler.service.ts`
- `services/api/src/member-privacy/account-closure.policy.ts`
- `services/api/src/member-privacy/account-closure.service.ts`
- `services/api/src/member-privacy/member-privacy.processor.ts`
- `services/api/scripts/verify-member-data-request-state-machine.ts`
- `services/api/scripts/verify-member-data-export.ts`
- `services/api/scripts/verify-member-account-closure.ts`

**Modify:**

- `packages/shared/src/types/member-privacy.ts`
- `services/api/prisma/schema.prisma`
- `services/api/prisma/postgres/schema.prisma`
- `services/api/src/member-privacy/member-privacy.controller.ts`
- `services/api/src/member-privacy/admin-member-privacy.controller.ts`
- `services/api/src/member-privacy/member-privacy.module.ts`
- `services/api/src/member-privacy/member-privacy.service.ts`
- `services/api/src/member-privacy/member-privacy.types.ts`
- `services/api/src/audit/audit.service.ts`
- `services/api/src/files/file.types.ts`
- `services/api/src/files/file-validation.ts`
- `services/api/src/files/files.service.ts`
- `services/api/src/storage/object-key.ts`
- `packages/shared/src/types/file.ts`
- `services/api/package.json`
- `.github/workflows/ci.yml`
- `docs/compliance/data-retention.md`（若实际文件名不同，先在 `docs/compliance` 选现有正式留存文档，不新建并列标准）
- `docs/progress/current-progress.md`
- `docs/progress/next-tasks.md`

**Hard Invariants:**

1. `UserDataRequest` 是唯一数据权利请求账本。
2. export/delete 共享会员级 `activeKey`，保证同一用户跨类型最多一个非终态高风险请求；终态必须清空。
3. `idempotencyKey` 由客户端提供，新请求必填；历史行允许 null。
4. Admin 不能直接把 export/delete 写成 `completed`。
5. export 的 ticket claim 只代表取得交付租约；只有 HTTP response `finish` 后的物理清理与账本 CAS 均成功才 `completed`，且该状态不证明客户端已永久保存。
6. delete 只有所有分类步骤完成后才 `completed`。
7. PII 墓碑化必须最后执行；原 `phoneHash` 不得残留。
8. Order/Refund/PrintTask/RedemptionRecord 不改金额和状态，只解除可识别会员关联。
9. 所有对象删除先物理后软删；重试只查询 `deletedAt=null`。
10. queue 不可用时不内联执行、不吞错、不提前消费 step-up。
11. export/delete 对同一会员跨类型互斥；同一时刻最多一个非终态高风险请求。
12. delete 一旦把账户置为 closing，就不能普通 reject/cancel；失败只能 retry 或人工升级。
13. 下载 ticket 只取得有 TTL 的单次 claim 租约；对象至少保留到 HTTP response `finish`，清理由 reconciler 收口。
14. 导出自然过期必须进入 `expired` 并清 `activeKey`；不能永久停在 ready。
15. 法务参数或注销执行开关未就绪时，delete API 与 closure processor 均 fail closed。
16. 注销受理后即使原会话已撤销，也必须允许原 JWT `sub` 配合原 idempotency key 只读查询最小注销回执；回执端点不得恢复会话或暴露其他资产。

## Task 1: 扩展 shared DTO 与请求 schema（RED）

**Files:**

- Modify: `packages/shared/src/types/member-privacy.ts`
- Create: `services/api/scripts/verify-member-data-request-state-machine.ts`
- Modify: `services/api/package.json`

- [ ] 在 shared 增加响应契约：

```ts
export interface MemberDataRequestItem {
  id: string
  requestType: MemberDataRequestType
  status: MemberDataRequestStatus
  requestedAt: string
  handledAt: string | null
  executionStep: string | null
  exportExpiresAt: string | null
  failureCode: string | null
  canRetry: boolean
  canDownload: boolean
}

export interface MemberDataRequestPage {
  items: MemberDataRequestItem[]
  nextCursor: string | null
  capabilities: {
    accountClosureAvailable: boolean
  }
}

export interface AdminMemberDataRequestItem extends MemberDataRequestItem {
  endUserId: string
  phoneMasked: string
  nickname: string | null
  retryCount: number
  lastAttemptAt: string | null
  handledBy: string | null
  auditRef: string | null
}

export interface CreateMemberDataRequestInput {
  requestType: MemberDataRequestType
}

export interface MemberExportDownloadAuthorization {
  requestId: string
  downloadUrl: string
  expiresAt: string
}

export interface MemberAccountClosureReceipt {
  requestId: string
  status: Extract<MemberDataRequestStatus, 'pending' | 'handling' | 'failed' | 'completed'>
  requestedAt: string
  executionStep: string | null
  supportRequired: boolean
}
```

`failureMessage` 不进入会员 DTO；内部安全原因只给 Admin 详情。

- [ ] 新建状态机 verify，先检查目标 schema 字段、状态转换函数、Admin 禁止完成、queue jobId 带 executionVersion。此时 RED。
- [ ] 注册：

```json
"verify:member-data-request-state-machine": "node -r @swc-node/register scripts/verify-member-data-request-state-machine.ts"
```

- [ ] 运行：

```bash
pnpm --filter @ai-job-print/shared typecheck
pnpm --filter @ai-job-print/api verify:member-data-request-state-machine
```

Expected: schema/service 尚未实现而失败。

- [ ] Commit：

```bash
git add packages/shared/src/types/member-privacy.ts services/api/scripts/verify-member-data-request-state-machine.ts services/api/package.json
git commit -m "test: specify member data request lifecycle"
```

## Task 2: Additive 扩展 UserDataRequest

**Files:**

- Modify: `services/api/prisma/schema.prisma`
- Modify: `services/api/prisma/postgres/schema.prisma`
- Create: `services/api/prisma/migrations/20260717110000_extend_user_data_requests/migration.sql`
- Create: `services/api/prisma/postgres/migrations/20260717110000_extend_user_data_requests/migration.sql`

- [ ] 在两个 schema 把 `UserDataRequest` 扩为：

```prisma
model UserDataRequest {
  id                  String    @id @default(cuid())
  endUserId           String
  endUser             EndUser   @relation(fields: [endUserId], references: [id], onDelete: Cascade)
  requestType         String
  status              String    @default("pending")
  idempotencyKey      String?   @unique
  activeKey           String?   @unique
  executionVersion    Int       @default(0)
  executionStep       String?
  progressJson        String    @default("{}")
  workerJobId         String?
  exportFileId        String?   @unique
  exportExpiresAt     DateTime?
  downloadConsumedAt  DateTime?
  failureCode         String?
  failureMessage      String?
  retryCount          Int       @default(0)
  lastAttemptAt       DateTime?
  requestedAt         DateTime  @default(now())
  handledAt           DateTime?
  handledBy           String?
  auditRef            String?

  @@index([endUserId, requestType])
  @@index([status])
  @@index([requestedAt])
  @@index([exportExpiresAt])
}
```

`exportFileId` 首版故意不建 FK：历史/到期清理后仍需保留请求审计，服务层按 file id 校验；禁止因此在 `FileObject` 建第二个所有权关系。

- [ ] SQLite migration：

```sql
ALTER TABLE "UserDataRequest" ADD COLUMN "idempotencyKey" TEXT;
ALTER TABLE "UserDataRequest" ADD COLUMN "activeKey" TEXT;
ALTER TABLE "UserDataRequest" ADD COLUMN "executionVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "UserDataRequest" ADD COLUMN "executionStep" TEXT;
ALTER TABLE "UserDataRequest" ADD COLUMN "progressJson" TEXT NOT NULL DEFAULT '{}';
ALTER TABLE "UserDataRequest" ADD COLUMN "workerJobId" TEXT;
ALTER TABLE "UserDataRequest" ADD COLUMN "exportFileId" TEXT;
ALTER TABLE "UserDataRequest" ADD COLUMN "exportExpiresAt" DATETIME;
ALTER TABLE "UserDataRequest" ADD COLUMN "downloadConsumedAt" DATETIME;
ALTER TABLE "UserDataRequest" ADD COLUMN "failureCode" TEXT;
ALTER TABLE "UserDataRequest" ADD COLUMN "failureMessage" TEXT;
ALTER TABLE "UserDataRequest" ADD COLUMN "retryCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "UserDataRequest" ADD COLUMN "lastAttemptAt" DATETIME;

CREATE UNIQUE INDEX "UserDataRequest_idempotencyKey_key" ON "UserDataRequest"("idempotencyKey");
CREATE UNIQUE INDEX "UserDataRequest_activeKey_key" ON "UserDataRequest"("activeKey");
CREATE UNIQUE INDEX "UserDataRequest_exportFileId_key" ON "UserDataRequest"("exportFileId");
CREATE INDEX "UserDataRequest_exportExpiresAt_idx" ON "UserDataRequest"("exportExpiresAt");
```

- [ ] PostgreSQL migration 必须显式写出完整变更，不使用 SQLite `DATETIME`：

```sql
ALTER TABLE "UserDataRequest" ADD COLUMN "idempotencyKey" TEXT;
ALTER TABLE "UserDataRequest" ADD COLUMN "activeKey" TEXT;
ALTER TABLE "UserDataRequest" ADD COLUMN "executionVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "UserDataRequest" ADD COLUMN "executionStep" TEXT;
ALTER TABLE "UserDataRequest" ADD COLUMN "progressJson" TEXT NOT NULL DEFAULT '{}';
ALTER TABLE "UserDataRequest" ADD COLUMN "workerJobId" TEXT;
ALTER TABLE "UserDataRequest" ADD COLUMN "exportFileId" TEXT;
ALTER TABLE "UserDataRequest" ADD COLUMN "exportExpiresAt" TIMESTAMP(3);
ALTER TABLE "UserDataRequest" ADD COLUMN "downloadConsumedAt" TIMESTAMP(3);
ALTER TABLE "UserDataRequest" ADD COLUMN "failureCode" TEXT;
ALTER TABLE "UserDataRequest" ADD COLUMN "failureMessage" TEXT;
ALTER TABLE "UserDataRequest" ADD COLUMN "retryCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "UserDataRequest" ADD COLUMN "lastAttemptAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "UserDataRequest_idempotencyKey_key" ON "UserDataRequest"("idempotencyKey");
CREATE UNIQUE INDEX "UserDataRequest_activeKey_key" ON "UserDataRequest"("activeKey");
CREATE UNIQUE INDEX "UserDataRequest_exportFileId_key" ON "UserDataRequest"("exportFileId");
CREATE INDEX "UserDataRequest_exportExpiresAt_idx" ON "UserDataRequest"("exportExpiresAt");
```
- [ ] 不给历史记录伪造 idempotencyKey/activeKey；历史行保持 null。
- [ ] fresh SQLite migrate deploy + `db:pg:sync:check`。
- [ ] Commit：

```bash
git add services/api/prisma/schema.prisma services/api/prisma/postgres/schema.prisma services/api/prisma/migrations/20260717110000_extend_user_data_requests/migration.sql services/api/prisma/postgres/migrations/20260717110000_extend_user_data_requests/migration.sql
git commit -m "feat: extend member data request ledger"
```

## Task 3: 实现 queue 契约与状态机服务（GREEN）

**Files:**

- Create: `services/api/src/member-privacy/member-privacy.queue.ts`
- Create: `services/api/src/member-privacy/member-data-request.service.ts`
- Modify: `services/api/src/member-privacy/member-privacy.types.ts`
- Modify: `services/api/src/member-privacy/member-privacy.service.ts`
- Modify: `services/api/src/member-privacy/member-privacy.module.ts`
- Modify: `services/api/src/audit/audit.service.ts`
- Modify: `services/api/scripts/verify-member-data-request-state-machine.ts`

- [ ] queue 契约：

```ts
export const MEMBER_PRIVACY_QUEUE = 'member-privacy'
export const MEMBER_EXPORT_JOB = 'member.export'
export const MEMBER_EXPORT_RECONCILE_JOB = 'member.export.reconcile'
export const MEMBER_CLOSURE_JOB = 'member.account-closure'

export interface MemberRequestJobData {
  requestId: string
  executionVersion: number
}

export interface MemberExportReconcileJobData {
  requestId?: string
  reason: 'delivery_finished' | 'periodic_sweep'
}

export type MemberPrivacyJobData = MemberRequestJobData | MemberExportReconcileJobData
```

- [ ] `MemberPrivacyModule` 启动时注册唯一 repeatable reconcile job（每 60 秒），使用稳定 job id；多 API 实例不得各自累积重复定时任务。无 Redis 时模块不注册队列，export/delete API 仍 fail closed。

- [ ] `MemberPrivacyModule` 导入 `MemberAuthModule`、`FilesModule`，仅有 `REDIS_URL` 时 `BullModule.registerQueue({ name: MEMBER_PRIVACY_QUEUE })`；与 `JobSyncModule` 保持相同 root connection。
- [ ] `MemberDataRequestService` 的构造函数注入：

```ts
constructor(
  private readonly prisma: PrismaService,
  private readonly stepUp: MemberStepUpService,
  private readonly privacy: MemberPrivacyService,
  private readonly audit: AuditService,
  private readonly redis: RedisService,
  @Optional() @InjectQueue(MEMBER_PRIVACY_QUEUE) private readonly queue?: Queue,
) {}
```

- [ ] 只有“确认不是幂等重放、不存在任何 export/delete active request、确实需要新建”时才执行 `assertQueueAvailable` 和消费 step-up；只有 `revoke_consent` 允许同步不依赖 queue。
- [ ] `create` 的关键顺序：

```ts
// export/delete 共享同一会员级互斥键，禁止导出与注销并行。
const activeKey = requestType === 'revoke_consent' ? null : `${endUserId}:privacy-exclusive`
const lockValue = randomUUID()
const idempotencyDigest = createHash('sha256').update(idempotencyKey).digest('hex')
const lockKey = `member:data-request:create:${endUserId}:${idempotencyDigest}`
const locked = await this.redis.setNxEx(lockKey, lockValue, 30)
if (!locked) {
  const concurrent = await this.prisma.userDataRequest.findUnique({ where: { idempotencyKey } })
  if (concurrent?.endUserId === endUserId && concurrent.requestType === requestType) return concurrent
  throw conflict('DATA_REQUEST_IN_PROGRESS')
}

let row: UserDataRequest
try {
  const existing = await this.prisma.userDataRequest.findUnique({ where: { idempotencyKey } })
  if (existing) {
    if (existing.endUserId !== endUserId || existing.requestType !== requestType) {
      throw conflict('IDEMPOTENCY_KEY_REUSED')
    }
    return existing
  }

  if (activeKey) {
    const active = await this.prisma.userDataRequest.findUnique({ where: { activeKey } })
    if (active) throw conflict('DATA_REQUEST_ALREADY_ACTIVE')
  }

  if (requestType === 'revoke_consent') {
    return this.revokeConsentAndRecordInOneTransaction(endUserId, idempotencyKey)
  }

  this.assertQueueAvailable()
  if (requestType === 'delete') this.assertAccountClosureExecutionEnabled()
  if (requestType === 'export') {
    await this.stepUp.consumeGrant(endUserId, 'export_data_request', stepUpToken, deviceId)
  }
  if (requestType === 'delete') {
    await this.stepUp.consumeGrant(endUserId, 'close_account', stepUpToken, deviceId)
  }

  row = await this.prisma.$transaction(async (tx) => {
    // 锁内仍重查，数据库唯一约束是最终事实源。
    const replay = await tx.userDataRequest.findUnique({ where: { idempotencyKey } })
    if (replay) {
      if (replay.endUserId !== endUserId || replay.requestType !== requestType) {
        throw conflict('IDEMPOTENCY_KEY_REUSED')
      }
      return replay
    }

    if (requestType === 'delete') {
      const changed = await tx.endUser.updateMany({
        where: { id: endUserId, enabled: true, status: 'active' },
        data: {
          enabled: false,
          status: 'closing',
          statusChangedAt: now,
          closingRequestedAt: now,
        },
      })
      if (changed.count !== 1) throw conflict('ACCOUNT_NOT_ACTIVE')
    }

    return tx.userDataRequest.create({
      data: { endUserId, requestType, idempotencyKey, activeKey, status: 'pending' },
    })
  })
} finally {
  try {
    await this.redis.getAndDelIfEquals(lockKey, lockValue)
  } catch {
    this.logger.warn('member data request create lock release failed')
  }
}
```

锁不作为唯一性真相，DB 唯一约束仍是最终门禁。捕获唯一约束冲突后先重查 `idempotencyKey`：若归属和 requestType 一致则返回原记录，否则才映射 `IDEMPOTENCY_KEY_REUSED` 或 `DATA_REQUEST_ALREADY_ACTIVE`，不回显数据库错误。测试必须覆盖：顺序重放直接返回原记录且不再消费 grant；export/delete 跨类型 active 冲突不消费 grant；并发同 idempotency key 不会生成两行或烧掉第二个有效 grant。

- [ ] 现有 `AuditService.write` 会吞掉数据库错误，不能用于必须与业务原子提交的隐私状态。为其增加窄化 `writeRequired(tx, args)`：复用同一 payload 限长/脱敏逻辑，但使用调用方 Prisma transaction client 并让失败抛出；旧 `write` 行为保持兼容。隐私撤回、Admin decision/retry 和最终注销必须使用 required 版本，测试注入审计失败时业务也回滚。
- [ ] `revokeConsentAndRecordInOneTransaction` 在同一 Prisma transaction 内撤回有效 consent、创建 `status=completed/handledAt=now/activeKey=null` 的 `UserDataRequest` 并以 `AuditService.writeRequired` 写安全审计；失败则整体回滚，不留下永久 pending 请求。
- [ ] `assertAccountClosureExecutionEnabled` 要求 `MEMBER_ACCOUNT_CLOSURE_EXECUTION_ENABLED=true`，且冷静期、分类留存矩阵版本和财务保留天数均已显式配置；任一缺失返回 `ACCOUNT_CLOSURE_NOT_AVAILABLE`，不得把未设置冷静期解释为 0。

- [ ] delete 事务提交后立即调用 `redis.revokeMemberSessions(endUserId)`；即使 Redis 失败，`status=closing + enabled=false` 也让 Guard fail closed，并把请求标 failed 供重试。
- [ ] enqueue job id：

```ts
const jobId = `${row.id}:${row.executionVersion}`
await this.queue!.add(jobName, {
  requestId: row.id,
  executionVersion: row.executionVersion,
}, {
  jobId,
  attempts: 5,
  backoff: { type: 'exponential', delay: 30_000 },
  removeOnComplete: { age: 86_400 },
  removeOnFail: { age: 7 * 86_400 },
})
```

- [ ] queue add 成功后才以 `where id,status=pending,executionVersion` CAS 写 `workerJobId=jobId`；enqueue 失败时把 row 置 `failed/QUEUE_ENQUEUE_FAILED`、保持 `workerJobId=null`，保留 `activeKey` 以便 Admin 重试同一请求。delete 的 session revoke 失败时不得继续 enqueue。
- [ ] delete 已进入 `closing + enabled=false` 后若 enqueue 失败，账号按 fail-closed 保持不可登录，用户不能重新提交或自助取消，必须由 Admin 对原 request retry 或人工升级并留审计；禁止 reject/cancel 后恢复账号。export 失败同样复用原 request retry，本波不新建第二行。
- [ ] 从旧 `MemberPrivacyService` 移出 list/create/handle 到新服务；旧 service 只保留 consent。
- [ ] 状态转换集中为纯函数：

```ts
const ALLOWED: Record<MemberDataRequestStatus, readonly MemberDataRequestStatus[]> = {
  pending: ['handling', 'failed', 'rejected', 'cancelled'],
  handling: ['ready', 'completed', 'failed'],
  ready: ['handling', 'expired', 'failed'],
  failed: ['pending', 'rejected', 'cancelled'],
  completed: [],
  expired: [],
  rejected: [],
  cancelled: [],
}
```

额外规则：`pending→failed` 只允许 queue enqueue/session revoke 失败的服务端补偿 CAS，其中 session revoke 成因仅适用于 delete；该转换不是 Admin/API 通用动作。export 生成阶段只允许 `pending→handling→ready`；只有一次性下载 response `finish` 后才能 `ready→handling(download_cleanup_pending)`，再由清理协调器写 `handling→completed`。delete 不能 `handling→ready/expired/rejected/cancelled`，进入 closing 后只允许 `handling/failed/completed`；Admin 不能写 ready/completed/expired/failed。export 的 pending/failed 可 reject，delete 的 failed 只能 retry/升级。

- [ ] 运行：

```bash
PAYMENT_PROVIDER=disabled pnpm --filter @ai-job-print/api verify:member-data-request-state-machine
PAYMENT_PROVIDER=disabled pnpm --filter @ai-job-print/api verify:member-data-request-truth
pnpm --filter @ai-job-print/api typecheck
```

- [ ] Commit：

```bash
git add services/api/src/member-privacy/member-privacy.queue.ts services/api/src/member-privacy/member-data-request.service.ts services/api/src/member-privacy/member-privacy.types.ts services/api/src/member-privacy/member-privacy.service.ts services/api/src/member-privacy/member-privacy.module.ts services/api/src/audit/audit.service.ts services/api/scripts/verify-member-data-request-state-machine.ts
git commit -m "feat: add member data request state machine"
```

## Task 4: 先写数据导出测试（RED）

**Files:**

- Create: `services/api/scripts/verify-member-data-export.ts`
- Modify: `services/api/package.json`
- Modify: `.github/workflows/ci.yml`

- [ ] 测试使用两个会员，各写一组资产，必须覆盖：

```text
- 只导出目标 endUserId 的数据
- 不包含另一会员 id/标题/反馈
- 不包含 phoneEnc、phoneHash、storageKey、objectKey、fileUrl、signedUrl
- 不包含明文 11 位手机号、token、验证码、prompt、output 原文
- 文件元数据不返回内部 bucket/region
- JSON 有 schemaVersion、generatedAt、account、files、aiRecords、printOrders、favorites、benefits、activity、notifications、feedback、consents、requests
- FileObject 为 private/temp/system_short，expiresAt <= 24h
- 重复 processor 不产生第二个有效 exportFileId
- 过期 artifact 被 reconciler 调用 FilesService cleanup 物理删除，request=expired、activeKey=null
- 任一分区或总包超过配置上限时稳定失败为 EXPORT_TOO_LARGE，不生成部分包
- download authorization 需要 export_data_download step-up
- 两个并发 GET 只有一个取得 claim，另一个 EXPORT_DOWNLOAD_IN_PROGRESS
- ticket 消费只取得一个有 TTL 的 download claim；不直接 completed
- response finish 前 request 仍为 ready；finish 后进入 cleanup pending，只有物理清理和 CAS 成功才 completed、activeKey=null、downloadConsumedAt 非空
- response 在 finish 前 close/error 则释放 claim，对象仍在，用户重新 step-up 后可取新 ticket
- claim 租约超时但无 deliveryFinishedAt 时由 reconciler 释放，不标 completed
```

- [ ] 递归敏感键/手机号扫描：

```ts
const forbiddenKeys = /phoneEnc|phoneHash|storageKey|objectKey|fileUrl|signedUrl|accessToken|prompt|output/i
walk(exported, (key, value) => {
  assert.doesNotMatch(key, forbiddenKeys)
  if (typeof value === 'string') assert.doesNotMatch(value, /1[3-9]\d{9}/)
})
```

- [ ] 注册 `verify:member-data-export` 并加入 CI。
- [ ] 运行确认 RED。

## Task 5: 实现白名单导出 mapper

**Files:**

- Create: `services/api/src/member-privacy/member-data-export.mapper.ts`
- Create: `services/api/src/member-privacy/member-data-export.service.ts`
- Modify: `services/api/src/files/files.service.ts`
- Modify: `services/api/src/files/file.types.ts`
- Modify: `packages/shared/src/types/file.ts`

- [ ] 在前后端 FilePurpose 同步增加：

```ts
| 'member_data_export'
```

- [ ] `object-key.ts` 的 `PURPOSE_FOLDER` 同步增加 user scoped：

```ts
member_data_export: { scope: 'user', folder: 'exports' },
```

因此本任务还允许 Modify: `services/api/src/storage/object-key.ts`。

- [ ] mapper 只接 Prisma 已选择字段，禁止接整行 `unknown` 后再删除黑名单。导出 envelope：

```ts
export interface MemberDataExportEnvelope {
  schemaVersion: 'member-data-export-v1'
  generatedAt: string
  account: {
    id: string
    phoneMasked: string
    nickname: string | null
    createdAt: string
  }
  files: Array<{
    id: string
    filename: string
    mimeType: string
    sizeBytes: number
    purpose: string
    assetCategory: string
    status: string
    createdAt: string
    expiresAt: string | null
  }>
  // 其他数组也必须显式列字段，不能 spread Prisma row
}
```

- [ ] `MemberDataExportService.collect(endUserId)` 对每张表使用 `select` 白名单；不导出：
  - `AiResumeResult.payloadJson`（可能含简历 PII）
  - `MockInterviewTurn.content/transcriptText`
  - `FeedbackTicket.contactPhoneEnc`
  - `FileObject.storageKey/bucket/region/sha256`
  - `Order.itemsJson` 中未审查的内部字段
  - `AuditLog`、内部风控和系统日志

- [ ] 输出 JSON 使用稳定 key 和 UTF-8：

```ts
const buffer = Buffer.from(JSON.stringify(envelope, null, 2), 'utf8')
const artifact = await this.files.upload({
  buffer,
  filename: `member-data-export-${requestId}.json`,
  mimeType: 'application/json',
  purpose: 'member_data_export',
  sensitiveLevel: 'highly_sensitive',
  uploaderId: null,
  endUserId,
  assetCategory: 'derived',
  createdBy: 'system:member-data-export',
  retentionOverride: {
    expiresAt: exportExpiresAt,
    retentionPolicy: 'system_short',
    retentionSetBy: 'system',
  },
})
```

- [ ] `FilesService.upload` 增加只供服务端调用的 `retentionOverride`；仅当 `purpose='member_data_export'`、`retentionPolicy='system_short'`且 `expiresAt <= now+24h` 时接受，并在创建 `FileObject` 的同一次 DB write 中落 `expiresAt/retentionPolicy/retentionSetBy`。禁止“先用 highly_sensitive 默认 1h 上传，再二次 update 为 24h”的清理竞态。
- [ ] `file-validation.ts` 的 purpose→MIME/大小/敏感等级/保留策略映射同步加入 `member_data_export`；只允许 `application/json`、`highly_sensitive`、`system_short`，缺任一映射时 typecheck 或上传守卫必须失败。
- [ ] `FilesService.upload` 若对象存储 put 成功但 `FileObject.create` 失败，必须立即按刚生成的 storage key 物理删除对象；补偿失败写安全告警并由孤儿对象对账任务捕获，禁止返回成功或遗留无 DB 归属对象。
- [ ] 导出包 `exportExpiresAt` 取 `min(now+24h, MEMBER_EXPORT_TTL_HOURS)`，不采用会员长期保留设置。
- [ ] 对每个导出分区设置显式行数上限，并在序列化前后分别检查 `MEMBER_DATA_EXPORT_MAX_ROWS_PER_SECTION` 与 `MEMBER_DATA_EXPORT_MAX_BYTES`；配置缺失使用保守非零默认，配置越界启动失败。超过上限统一 `EXPORT_TOO_LARGE`，不截断、不生成部分 JSON，也不把包标 ready。
- [ ] 生产存储必须在上线验收中证明 at-rest 加密已开启（云对象存储 SSE 或加密磁盘），传输只用 TLS。本期 JSON 不再用服务端私钥做二次应用层加密，否则用户无法解密；如法务要求密码 ZIP，须单独评审密码交付 UX 后再实施。
- [ ] 如果 DB 更新请求失败，立即 `files.ownerDelete(fileId, memberRequester, 'orphaned member export')` 补偿，不留下孤儿包。
- [ ] 成功后 CAS 更新请求：

```ts
status: 'ready',
executionStep: 'export_ready',
exportFileId: artifact.fileId,
exportExpiresAt,
failureCode: null,
failureMessage: null
```

- [ ] 重复执行时：若已 `ready` 且现有 FileObject alive，直接返回；若 ready 文件不存在，转 failed 让 Admin retry；若已 `completed/expired` 直接按终态幂等返回且不要求对象仍存在，不能创建第二个有效包。
- [ ] 运行导出测试直到除下载 ticket 外全部 GREEN。
- [ ] Commit。

## Task 6: 实现一次性 application download ticket

**Files:**

- Modify: `services/api/src/member-privacy/member-data-request.service.ts`
- Create: `services/api/src/member-privacy/member-data-export-reconciler.service.ts`
- Modify: `services/api/src/member-privacy/member-privacy.controller.ts`
- Modify: `services/api/src/member-privacy/member-privacy.module.ts`
- Modify: `services/api/scripts/verify-member-data-export.ts`

- [ ] `authorizeDownload`：
  1. `consumeGrant(endUserId,'export_data_download',token,deviceId)`；
  2. 查本人 request 为 `ready`、未过期、未消费；
  3. 生成 32 字节 token，Redis 只存 SHA-256 key；
  4. TTL 10 分钟；
  5. 返回同源下载页 URL，不返回 object storage URL；明文 ticket 只放 URL fragment，避免进入服务器 access log、Referer 和浏览器 history query。

```ts
return {
  requestId,
  downloadUrl: `${publicWebBase}/member/export-download#request=${requestId}&ticket=${ticket}`,
  expiresAt: expiresAt.toISOString(),
}
```

- [ ] 下载内容端点不依赖会员 JWT；一次性高熵 ticket 本身是短时 bearer capability，便于公共一体机显示二维码后由用户手机取回。端点只接受 `x-member-download-ticket` header，不接受 query/body token。
- [ ] 每个 ticket 同时登记 request/user 反向索引，TTL 与 ticket 一致；新授权、导出过期、注销开始和账号状态变更都能按索引撤销全部相关 ticket。Redis 只保存 ticket hash，不保存明文。
- [ ] GET download 使用“单次租约 + response finish 后清理”，不能先删对象再向客户端发送：
  1. 校验 request id、ticket 长度与 header 来源，只查 request + FileObject 元数据；
  2. 用一段 Redis Lua 原子消费 ticket hash，并对 `member:export:claim:{requestId}` 建立 120 秒 claim 租约；value 只含随机 claimId、requestId、endUserId，恰好一个并发请求能取得租约；
  3. 核对 request 为 `ready`、未过期、未消费，且 ticket/claim 的 requestId + endUserId 与账本一致；
  4. 在 `MEMBER_DATA_EXPORT_MAX_BYTES` 上限内读取对象，返回 `buffer + claimId` 给 controller，此时不删对象、不写 completed；
  5. controller 在发送前注册 `res.once('finish')` 与 `res.once('close')`。`finish` 先 CAS `ready→handling/executionStep=download_cleanup_pending/downloadConsumedAt=now`，再触发协调器物理删除对象、软删 FileObject、撤销全部 ticket/claim，最后 CAS 为 `completed/activeKey=null/handledAt=now`；
  6. 若 `close` 先于 `finish`，仅 compare-and-delete 当前 claim，request 保持 `ready`、对象保留；原 ticket 已作废，用户重新 step-up 后可取得新 ticket，系统不得自动重放消费型 GET；
  7. finish 后任一清理步骤失败，request 进入 `failed/EXPORT_CLEANUP_FAILED` 且保留 `activeKey`，由 Admin retry/协调器继续清理；不得回写“未交付”，也不得声称用户已保存文件。

- [ ] `finishDownload(claimId)` 先按 claimId 原子读取/校验 Redis claim，并从 claim payload 取得 `requestId + endUserId`，再以该 requestId CAS 写 `executionStep=download_cleanup_pending,downloadConsumedAt=now`，然后入队 `MEMBER_EXPORT_RECONCILE_JOB`（稳定 job id = `export-reconcile:{requestId}`）。若入队失败，不回滚交付事实；保留 cleanup pending 并高优告警，由 60 秒 repeatable sweep 收口。
- [ ] `abortDownload` 只用 compare-and-delete 释放当前 claim，不改 `downloadConsumedAt`、不删对象、不自动发新 ticket。

- [ ] Controller 路由：

```ts
@Controller('me/data-requests')
@UseGuards(EndUserAuthGuard)
export class MemberDataRequestController {
  constructor(private readonly requests: MemberDataRequestService) {}

@Post(':id/download-authorizations')
async authorizeDownload(
  @CurrentEndUser() user: AuthedEndUser,
  @Param('id') id: string,
  @Headers('x-member-step-up-token') stepUpToken: string | undefined,
  @Headers('x-terminal-id') deviceId: string | undefined,
) {
  return ApiResponse.ok(await this.requests.authorizeDownload(
    user.endUserId,
    id,
    stepUpToken,
    deviceId,
  ))
}
}

@Controller('member/data-exports')
export class MemberDataExportController {
  constructor(private readonly requests: MemberDataRequestService) {}

@Get(':id/content')
@Throttle({ default: { ttl: 60_000, limit: 10 } })
async download(
  @Param('id') id: string,
  @Headers('x-member-download-ticket') ticket: string | undefined,
  @Res() res: Response,
) {
  const delivery = await this.requests.claimDownload(id, ticket)
  let finished = false
  res.once('finish', () => {
    finished = true
    void this.requests.finishDownload(delivery.claimId).catch((error: unknown) => {
      this.logger.error('member export finish cleanup failed', safeErrorSummary(error))
    })
  })
  res.once('close', () => {
    if (!finished) {
      void this.requests.abortDownload(delivery.claimId).catch((error: unknown) => {
        this.logger.warn('member export abort cleanup failed', safeErrorSummary(error))
      })
    }
  })
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="member-data-export-${id}.json"`)
  res.setHeader('Cache-Control', 'no-store, private')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.send(delivery.buffer)
}
}
```

Controller 必须使用本地 `Logger` 与既有安全错误摘要 helper（若当前模块无 helper，则新增仅返回错误类型/稳定码的窄化函数）；不得把 ticket、claim payload、对象 key 或完整异常对象写入日志。事件监听器内所有异步 Promise 都必须显式 `.catch()`，禁止产生 unhandled rejection。

- [ ] Web 下载页从 `window.location.hash` 解析 ticket 后立即 `history.replaceState` 清掉 fragment，再把 ticket 放 `x-member-download-ticket` header；禁止 localStorage/sessionStorage/IndexedDB/cookie。
- [ ] `MemberPrivacyModule.controllers` 必须同时注册 `MemberDataRequestController` 和 `MemberDataExportController`；公开 content route 不得意外继承会员 Guard。
- [ ] token 不进 query 日志、异常日志和前端埋点；静态/集成测试扫描 URL 和 logger 参数。安全优先于示例 URL。
- [ ] 并发测试必须证明恰好一个下载响应拿到 bytes；断连测试证明对象和 ready 状态保留；finish 测试证明只有清理成功后才 completed。
- [ ] `MemberDataExportReconcilerService` 至少收口三类状态：`download_cleanup_pending/failed(EXPORT_CLEANUP_FAILED)` 重试物理清理；`ready + exportExpiresAt<=now` 撤销 ticket/claim、物理删除并 CAS 为 `expired/activeKey=null`；过期 claim 只释放租约、不删除仍 ready 的对象。所有批次有上限、游标和安全审计，不能全表无界扫描。
- [ ] reconciler 对“对象已删但账本未收口”必须幂等：只有能通过 `FileObject.deletedAt`/存储 NotFound 证明对象已不可读时才继续 completed/expired CAS，不因单次 delete 返回 NotFound 盲目跳过所有权校验。
- [ ] 导出自然过期和注销开始必须同时撤销 request/user ticket 索引；过期物理删除失败时保持非终态并告警，只有删除成功才写 `expired` 和清 `activeKey`。
- [ ] 文案与验收统一：`completed` 仅表示服务器已完成响应发送事件和后端清理，不证明用户设备已永久保存；客户端网络栈之后的失败无法由服务器证明。
- [ ] 运行 `verify:member-data-export` 全绿。
- [ ] Commit。

## Task 7: 先写账户注销分类测试（RED）

**Files:**

- Create: `services/api/scripts/verify-member-account-closure.ts`
- Modify: `services/api/package.json`
- Modify: `.github/workflows/ci.yml`

- [ ] 为目标用户准备：
  - 两个 Redis session + 一个 step-up grant
  - active FileObject + 本地对象 bytes
  - AI resume/job AI/mock interview/document process
  - favorites/activity/benefits/notifications/feedback
  - consent/data request
  - PrintTask + Order + Refund + RedemptionRecord
  - 第二个对照用户全套数据
  - 一份法务已签字且版本固定的测试分类矩阵；逐类声明 `delete/anonymize/detach/retain/revoke` 和保留期限，测试不得靠硬编码猜测反馈、通知、权益或财务动作

- [ ] 失败注入场景：第 2 个对象删除抛错。断言：
  - request=`failed`，非 completed
  - EndUser=`closing, enabled=false`
  - 原 phoneHash 暂时仍在（PII 最后一步未执行）
  - 已删文件可重试，未删文件仍在
  - 财务状态/金额未变化
  - 第二用户无变化
  - 若测试矩阵把 `BenefitGrant` 分类为 delete，则其 `BenefitClaim` 通过已核对的 FK cascade 归零；若分类为 anonymize/detach/retain，则按矩阵验证不可识别与期限，禁止无规则遗留可识别活动领取记录

- [ ] 清除失败注入后 retry。断言：
  - 所有原 session/grant 失效
  - 所有对象不存在，FileObject deleted/owner 解绑
  - 每类数据严格按测试分类矩阵执行；矩阵要求 delete 的归零、要求 anonymize/detach 的只去标识、要求 retain 的字段和期限保持不变
  - Order/Refund/PrintTask/RedemptionRecord 状态金额未改；会员关联只能按签字矩阵做匿名解绑，不能删除或重写资金事实
  - UserDataRequest 和最小 AuditLog 保留
  - EndUser status=anonymized, enabled=false, nickname=null
  - `phoneHash !== hashPhone(original)`
  - `decryptPhone(phoneEnc)` 不含原号且 `maskPhoneFromEnc='***'`
  - 原手机号可新建新 EndUser
  - 新用户 id 不等于旧 id，本人资产接口查询旧资产为 0；依法留存的最小财务/审计记录不可由新用户继承或反向还原旧 PII
  - 再执行 worker 幂等返回，不重复写金额/删除他人

- [ ] 注册 `verify:member-account-closure` 并先跑 RED。

## Task 8: 实现 AccountClosureService（GREEN）

**Files:**

- Create: `services/api/src/member-privacy/account-closure.policy.ts`
- Create: `services/api/src/member-privacy/account-closure.service.ts`
- Modify: `services/api/src/member-privacy/member-privacy.module.ts`
- Modify: `services/api/scripts/verify-member-account-closure.ts`

- [ ] 服务暴露：

```ts
async execute(requestId: string, executionVersion: number): Promise<AccountClosureResult>
```

- [ ] `account-closure.policy.ts` 只承载法务签字后进入版本控制的分类矩阵，不从任意 JSON 环境变量执行动态删除语句。每类必须显式声明 action、必要字段白名单、retentionDays/法律依据引用；`MEMBER_ACCOUNT_CLOSURE_POLICY_VERSION` 必须精确命中已签字版本。版本未知、分类遗漏、执行开关不是 `true` 或冷静期/财务/审计参数缺失时，service 在任何状态 claim 前返回 `ACCOUNT_CLOSURE_NOT_AVAILABLE`。
- [ ] 在法务矩阵未签字前，只允许提交接口/类型/测试和 fail-closed gate；不得提交会实际删除、匿名化或解绑生产数据的 handler，也不得在 Kiosk 展示注销按钮。

- [ ] 每次 worker 执行（包括 BullMQ 自动 retry 和 Admin retry）都先重新断言执行开关与签字矩阵，再开始 CAS claim；运行中开关关闭时不执行任何不可逆步骤，保留 failed/closing 供人工处理。
- [ ] 开始用 CAS claim：

```ts
const claimed = await prisma.userDataRequest.updateMany({
  where: {
    id: requestId,
    requestType: 'delete',
    executionVersion,
    status: { in: ['pending', 'failed'] },
  },
  data: {
    status: 'handling',
    executionStep: 'revoke_sessions',
    lastAttemptAt: now,
    failureCode: null,
    failureMessage: null,
  },
})
if (claimed.count === 0) return idempotentExistingResult()
```

- [ ] Step 1: 依次调用 `redis.revokeMemberSessions(endUserId)` 和 account-security 已实现的 `redis.revokeMemberStepUpGrants(endUserId)`；不得用 Redis `KEYS` 扫描。
- [ ] Step 2: 分类矩阵必须逐个覆盖 `FileObject.assetCategory/purpose`；本波只实现矩阵明确要求 delete 的类别并逐个 `files.ownerDelete`。若出现未分类类别或矩阵要求 retain/anonymize 但没有已评审 handler，立即 fail closed，不得猜测或跳过。每完成一个更新 `progressJson` 的计数摘要，不写文件名/storage key。
- [ ] Step 3: 在短事务里按版本化分类矩阵执行非财务个人数据动作。下面仅表示允许被 mapper 调用的有界操作原语，不代表默认全部删除：

```ts
await tx.favorite.deleteMany({ where: { endUserId } })
await tx.browseLog.deleteMany({ where: { endUserId } })
await tx.externalJumpLog.deleteMany({ where: { endUserId } })
await tx.jobAiSession.deleteMany({ where: { endUserId } })
await tx.aiResumeResult.deleteMany({ where: { endUserId } })
await tx.documentProcessTask.deleteMany({ where: { endUserId } })
await tx.mockInterviewSession.deleteMany({ where: { endUserId } })
await tx.userAiConsent.updateMany({
  where: { endUserId, revokedAt: null },
  data: { revokedAt: now },
})
```

通知、广播已读、反馈、权益/领取记录及上述每个行为类到底调用 delete、匿名化、解绑还是保留，必须由签字矩阵逐项决定，禁止因为示例代码存在就默认删除。执行前必须核对 Prisma 关系的 cascade 只影响该用户；不允许把整表 deleteMany 写成无 where。

- [ ] Step 4: 保留运营/财务事实但解绑。以下 `updateMany` 只能作为版本化 policy mapper 在“该类别 action 明确为 `detach`”时调用的有界原语，禁止把整段当作无条件注销步骤直接执行；每个调用前必须由 policy 断言当前类别、留存期限和法律依据允许解绑：

```ts
await tx.order.updateMany({ where: { endUserId }, data: { endUserId: null } })
await tx.printTask.updateMany({ where: { endUserId }, data: { endUserId: null } })
await tx.redemptionRecord.updateMany({ where: { endUserId }, data: { endUserId: null } })
await tx.aiServiceLog.updateMany({ where: { endUserId }, data: { endUserId: null } })
await tx.fileObject.updateMany({
  where: { endUserId },
  data: { endUserId: null, ownerId: null },
})
```

不得改 `amountCents/payStatus/taskStatus/refund status`。

`MEMBER_FINANCIAL_RETENTION_DAYS` 与矩阵版本必须一致；运行时只按矩阵保留并解除允许解除的会员可识别关联。到期 purge 属后续独立波次，本计划不把“到期物理清理”写成已实现；若矩阵要求某条关联在保留期内不能解绑，本波也不得强行置 null。

- [ ] Step 5 最后墓碑化：

```ts
const tombstoneId = randomUUID()
const tombstoneHash = createHash('sha256')
  .update(`anonymized:${endUserId}:${tombstoneId}`)
  .digest('hex')
const tombstoneEnc = encryptPhone(`anon-${tombstoneId}`)

await tx.endUser.update({
  where: { id: endUserId },
  data: {
    phoneHash: tombstoneHash,
    phoneEnc: tombstoneEnc,
    nickname: null,
    enabled: false,
    status: 'anonymized',
    statusChangedAt: now,
    anonymizedAt: now,
  },
})
```

注意：`encryptPhone` 会调用 normalize，但不要求 11 位；`maskPhoneFromEnc` 对非 11 位返回 `***`。测试必须锁住。

- [ ] 同一最终事务：
  - 用 `AuditService.writeRequired` 写/复用 sanitized AuditLog（target=requestId），审计失败则最终事务回滚
  - request `completed`
  - `activeKey=null`
  - `handledAt=now`
  - `executionStep='completed'`
  - `auditRef` 指向最终审计

- [ ] catch：
  - 只保存 allowlisted `failureCode` 和安全 `failureMessage`
  - status=`failed`
  - activeKey 保留
  - retryCount 不在 worker 自动 attempts 中重复加；只有显式 Admin retry 增加
  - 抛错让 BullMQ retry

- [ ] 运行注销测试、member auth/status/file retention/payment/refund/redemption 回归。
- [ ] Commit。

## Task 9: 实现 Processor 与 Admin retry/decision

**Files:**

- Create: `services/api/src/member-privacy/member-privacy.processor.ts`
- Modify: `services/api/src/member-privacy/member-privacy.module.ts`
- Modify: `services/api/src/member-privacy/member-data-request.service.ts`
- Modify: `services/api/src/member-privacy/admin-member-privacy.controller.ts`
- Modify: `services/api/scripts/verify-member-data-request-state-machine.ts`

- [ ] Processor 只分发三个 job name：

```ts
@Processor(MEMBER_PRIVACY_QUEUE)
export class MemberPrivacyProcessor extends WorkerHost {
  async process(job: Job<MemberPrivacyJobData>): Promise<unknown> {
    if (job.name === MEMBER_EXPORT_JOB) {
      const data = job.data as MemberRequestJobData
      return this.exports.execute(data.requestId, data.executionVersion)
    }
    if (job.name === MEMBER_CLOSURE_JOB) {
      const data = job.data as MemberRequestJobData
      return this.closure.execute(data.requestId, data.executionVersion)
    }
    if (job.name === MEMBER_EXPORT_RECONCILE_JOB) {
      const data = job.data as MemberExportReconcileJobData
      return this.exportReconciler.reconcile(data.requestId)
    }
    throw new Error('UNKNOWN_MEMBER_PRIVACY_JOB')
  }
}
```

- [ ] Admin API：
  - `GET /admin/member-privacy/data-requests?status&type&cursor&pageSize`
  - `GET /admin/member-privacy/data-requests/:id`
  - `POST /admin/member-privacy/data-requests/:id/retry`
  - `POST /admin/member-privacy/data-requests/:id/reject`
  - `POST /admin/member-privacy/data-requests/:id/escalate`

- [ ] retry 只允许 failed：
  - 先确认 queue 可用，再 CAS `failed→pending`，同时 `executionVersion += 1`、`retryCount += 1`、清 failure；
  - enqueue 新 `requestId:executionVersion`，只有 add 成功后才以 `where id,status=pending,executionVersion` CAS 写 `workerJobId`；
  - 若 add 失败，必须以同一 executionVersion CAS 补偿为 `failed/QUEUE_ENQUEUE_FAILED`，保留 `activeKey`，不回退 executionVersion、不生成第二行；补偿本身失败要进入高优告警与对账；
  - retry、enqueue 结果和补偿都写 Admin 安全审计，不记录内部 stack/Redis URL。
  - export 且 `failureCode=EXPORT_CLEANUP_FAILED` 或 `executionStep=download_cleanup_pending` 时，只入队 `MEMBER_EXPORT_RECONCILE_JOB`复用原 `exportFileId`，不重生成第二个导出包；只有生成阶段失败才入队 `MEMBER_EXPORT_JOB`。

- [ ] reject 只允许 `requestType=export` 且状态 pending/failed；写 reason（1–200 字符，合规词/PII 扫描），状态 rejected、activeKey null、handledAt/By/auditRef，并撤销该 request 的 ticket/claim。delete 一旦受理即已进入 closing，任何状态都不能走 reject/cancel 或恢复 active。
- [ ] escalate 只允许 delete failed；状态仍保持 failed，`activeKey` 保留，只把 `executionStep` 写成 `manual_escalation_required` 并记录 reason/handledBy/auditRef，交给人工身份与法务流程，不能借 escalation 伪造 completed 或恢复账号。
- [ ] 删除/废弃旧 `PATCH status` 的任意状态能力；若保留兼容 endpoint，只允许映射到 reject，绝不接受 completed/ready/failed。
- [ ] 测试并发 retry 只有一次 executionVersion 增长；注入 queue add 失败后请求稳定回到 failed 且 workerJobId 未写；delete reject 返回 409 且账号仍 closing。
- [ ] Commit。

## Task 10: 接入会员 HTTP 请求与下载

**Files:**

- Modify: `services/api/src/member-privacy/member-privacy.controller.ts`
- Modify: `services/api/src/member-privacy/member-privacy.types.ts`
- Modify: `services/api/scripts/verify-member-data-request-state-machine.ts`
- Modify: `services/api/scripts/verify-member-data-export.ts`

- [ ] Create DTO 要求：
  - `requestType` allowlist
  - `Idempotency-Key` 为 UUID
  - export/delete 需要 `x-member-step-up-token`
  - device id 只作为风险摘要
  - revoke consent 不需要 step-up

- [ ] 端点契约：

```text
GET  /api/v1/me/data-requests
POST /api/v1/me/data-requests
POST /api/v1/me/data-requests/:id/download-authorizations
GET  /api/v1/member/account-closure-receipt  (原未过期 JWT + Idempotency-Key；专用窄化 guard)
GET  /api/v1/member/data-exports/:id/content  (一次性 ticket header；不使用会员 JWT)
```

- [ ] 在独立的公开前缀 controller（不得继承 `EndUserAuthGuard`）显式实现注销回执路由；只从 header 读取幂等键：

```ts
@Get('account-closure-receipt')
@UseGuards(MemberClosureReceiptGuard)
async getAccountClosureReceipt(
  @Req() req: RequestWithClosureReceiptSubject,
  @Headers('idempotency-key') idempotencyKey: string | undefined,
) {
  return ApiResponse.ok(await this.requests.getAccountClosureReceipt(
    req.closureReceiptSubject.endUserId,
    idempotencyKey,
  ))
}
```

路由最终必须解析为 `GET /api/v1/member/account-closure-receipt`；禁止把它放进带类级 `EndUserAuthGuard` 的 `/me/data-requests` controller，也禁止从 query/body 接收 JWT 或完整幂等键。

- [ ] 所有本人资源不存在/越权统一 404，不区分“存在但属于他人”。
- [ ] closure receipt 仅使用 account-security 计划提供的 `MemberClosureReceiptGuard`，不得使用会被 closing 拒绝的普通 Guard，也不得把专用 subject 注入 `req.endUser`。服务层只按 `closureReceiptSubject.endUserId + Idempotency-Key + requestType=delete` 精确查询，返回 `MemberAccountClosureReceipt` 最小字段；不返回手机号、failureMessage、文件/资产、审计 payload 或新 token，不改变任何状态。
- [ ] 该端点只解决“注销 create 已提交但弱网丢失响应”的只读确认：原 JWT 必须仍在有效期内，idempotency key 必须是同一次申请的 UUID；JWT 无效、key 不匹配、他人请求均统一 404/401，不允许用它恢复普通会话。HTTP 日志不得记录 Authorization 或完整 Idempotency-Key。
- [ ] list 返回最多 50 条并带 cursor；禁止继续用固定 take=50 却无 nextCursor。`capabilities.accountClosureAvailable` 仅在执行开关为 true、签字矩阵版本命中且冷静期/财务/审计参数完整时为 true；任一检查异常都返回 false，不向客户端泄露缺哪个内部参数。
- [ ] HTTP integration 覆盖 idempotency replay、active conflict、step-up action confusion、IDOR、ticket replay、expired export，以及 create 响应丢失后 closing 账号用原 JWT + 同一 key 查到最小回执、不同 key/不同 sub 查不到、普通本人接口仍拒绝。
- [ ] Commit。

## Task 11: 全量门禁与双模型安全复审

- [ ] CI Verify suites 和 PostgreSQL readiness 都加入：

```yaml
pnpm --filter @ai-job-print/api verify:member-data-request-state-machine
pnpm --filter @ai-job-print/api verify:member-data-export
pnpm --filter @ai-job-print/api verify:member-account-closure
```

- [ ] 本地/CI 命令：

```bash
pnpm --filter @ai-job-print/shared typecheck
pnpm --filter @ai-job-print/api db:pg:sync:check
PAYMENT_PROVIDER=disabled pnpm --filter @ai-job-print/api verify:member-account-status
PAYMENT_PROVIDER=disabled pnpm --filter @ai-job-print/api verify:member-step-up
PAYMENT_PROVIDER=disabled pnpm --filter @ai-job-print/api verify:member-data-request-state-machine
PAYMENT_PROVIDER=disabled pnpm --filter @ai-job-print/api verify:member-data-export
PAYMENT_PROVIDER=disabled pnpm --filter @ai-job-print/api verify:member-account-closure
PAYMENT_PROVIDER=disabled pnpm --filter @ai-job-print/api verify:member-auth
PAYMENT_PROVIDER=disabled pnpm --filter @ai-job-print/api verify:member-data-retention
PAYMENT_PROVIDER=disabled pnpm --filter @ai-job-print/api verify:file-retention
PAYMENT_PROVIDER=disabled pnpm --filter @ai-job-print/api verify:member-print-orders
PAYMENT_PROVIDER=disabled pnpm --filter @ai-job-print/api verify:benefit-redemption
PAYMENT_PROVIDER=disabled pnpm --filter @ai-job-print/api verify:refund-idempotent
pnpm --filter @ai-job-print/api lint
pnpm --filter @ai-job-print/api typecheck
pnpm --filter @ai-job-print/api build
git diff --check origin/main...HEAD
```

- [ ] 安全审查必须覆盖：IDOR、OTP/grant replay、download ticket 日志泄露、queue 重放、CAS、对象 orphan、PII 墓碑、phoneHash 重新注册、金融状态不变、跨用户 deleteMany、Redis outage。
- [ ] 故障演练：
  - Redis/queue down
  - object delete 第 N 个失败
  - DB 在上传后失败
  - processor 重复执行
  - download 并发/网络中断
  - worker 在墓碑化前后崩溃
- [ ] 所有 Critical/High 修复后重跑。
- [ ] 更新留存/进度文档，明确生产法务期限尚未签字时不能称生产完成。
- [ ] CCG 归档前记录精确执行证据，不提交任何测试 PII/导出包。

## 完成定义

- export/delete/revoke 三类请求有一致、可查询、幂等状态机。
- 导出包是白名单 JSON、私有、短期、一次性下载、到期/下载后物理删除。
- 注销按分类处理，失败可重试，完成才墓碑化；同手机号重新注册不继承旧资产。
- 财务/打印/退款事实保留且金额状态不被注销改写。
- Admin 只能拒绝/重试，不能伪造 worker 终态。
- SQLite/PostgreSQL、Redis、local storage/COS adapter 行为均有测试或预生产证据。
- Kiosk/Admin UI 尚未在本分支开放；下一计划接入后再做可见闭环。
