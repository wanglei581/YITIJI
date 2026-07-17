# Wave 1-B Slice 2：私有数据导出 artifact 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不开放下载页面、不执行账户注销的前提下，交付可恢复、可审计、本人隔离的异步 JSON 导出 artifact 后端。

**Architecture:** `UserDataRequest` 继续是唯一隐私请求账本；导出任务以固定 job id 投递到专用 BullMQ 队列。worker 先以 CAS 预留 `FileObject(uploading)` 和可推导 object key，再写对象，最后在同一 Prisma transaction 内将 FileObject 激活、账本变为 `ready`、写必需审计。一个仅处理 `pending/handling` 的恢复 sweep 随本切片上线，避免 enqueue 或 worker 崩溃留下永久卡死行或孤儿对象；下载租约、到期删除和任何 UI 均留给 Slice 3。

**Tech Stack:** NestJS、Prisma（SQLite/PostgreSQL 双 schema）、BullMQ/Redis、现有 `StorageService`、现有 `FileObject`、Node `@swc-node/register` verify。

---

## 0. 范围、前提与不可变边界

### 已确认事实

- Slice 1 已由 PR #275 squash 合入 `main@0ae51289`，`build-and-verify` 与 `postgres-readiness` 均成功；当前 `export` 只会创建 `pending` 账本，不会生成文件。
- `MemberDataRequestService` 已保证 `delete` 在所有 Prisma、Redis、BullMQ、文件、审计、账户状态与 step-up 依赖前返回 `409 ACCOUNT_CLOSURE_NOT_AVAILABLE`。
- `AuditService.write()` 会吞数据库错误，不能用于本计划的状态证明。
- `FilesService.upload()` 自动生成 file id 且返回签名 URL，不能直接用于高敏导出 artifact 的恢复路径。

### 本切片允许修改的文件预算

- `services/api/src/audit/audit.service.ts`
- `services/api/src/member-privacy/member-data-request.service.ts`
- `services/api/src/member-privacy/member-data-export.service.ts`（新建）
- `services/api/src/member-privacy/member-data-export.mapper.ts`（新建）
- `services/api/src/member-privacy/member-data-export-recovery.service.ts`（新建）
- `services/api/src/member-privacy/member-privacy.queue.ts`（新建）
- `services/api/src/member-privacy/member-privacy.processor.ts`（新建）
- `services/api/src/member-privacy/member-privacy.module.ts`
- `services/api/src/files/file.types.ts`、`packages/shared/src/types/file.ts`
- `services/api/src/files/file-validation.ts`、`services/api/src/files/retention-policy.ts`
- `services/api/src/files/files.service.ts`、`services/api/src/storage/object-key.ts`
- `services/api/prisma/schema.prisma`、`services/api/prisma/postgres/schema.prisma`
- `services/api/prisma/migrations/20260717160000_add_member_data_export_recovery_index/migration.sql`（新建）
- `services/api/prisma/postgres/migrations/20260717160000_add_member_data_export_recovery_index/migration.sql`（新建）
- `services/api/scripts/verify-member-data-export.ts`（新建）
- `services/api/scripts/verify-member-data-request-state-machine.ts`
- `services/api/package.json`、`.github/workflows/ci.yml`
- `docs/progress/current-progress.md`、`docs/progress/next-tasks.md`

### 明确禁止

- 不新增 Kiosk、Admin、Partner 页面、路由、导航或下载入口。
- 不新增账户删除、匿名化、`closing` 状态转换、删除 worker 或注销工单。
- 不生成对象存储签名 URL，不向 API 响应、日志、审计或队列 payload 写 object key、ticket、手机号、会话、提示词、完整模型输出或原始文件字节。
- 不修改生产 Redis、对象存储、环境变量、密钥、终端 Agent、支付、打印或 CI 基础设施配置。
- 不新增并行的 Export、Deletion、Download 或 outbox 业务表；`UserDataRequest` 是唯一隐私账本。

## 1. 固化后的状态机与恢复设计

```text
pending(queue_authorized) -> handling(artifact_reserved) -> ready(export_ready)
pending | handling -> failed

stale pending/handling --internal recovery, same executionVersion--> enqueue same jobId
```

1. job data 只能是 `{ requestId, executionVersion }`，job id 固定为 `${requestId}:${executionVersion}`；重复 `add()` 必须安全返回现有 job，不能产生第二份 artifact。
2. 初始 `reserve` 发生在 grant 消费之前，不能为该行写“已创建/已入列”的 required audit：grant 失败会删除这份暂存账本，留下审计孤儿。只有 grant 成功、固定 job id 已 `add()` 返回后，才可在一个 transaction 内 CAS 写 `workerJobId`、`executionStep='queue_enqueued'` 与 required audit；`add()` 返回后进程崩溃的空窗由恢复 sweep 以相同 job id 补齐。
3. `pending -> handling` 的 CAS 在同一 transaction 内创建 `FileObject(status='uploading')`，并写入 `UserDataRequest.exportFileId`、`executionStep='artifact_reserved'`、`lastAttemptAt` 与必需审计。file id 由 worker 预先生成，object key 只能由 purpose、owner 和该 file id 推导。
4. worker 在对象 `put` 成功后，只能在同一 transaction 内完成三件事：`FileObject` 变为 `active`、`UserDataRequest` 变为 `ready`、`AuditLog` 写入成功。任一数据库写失败时先删除物理对象；删除失败则保持 `handling`，交给恢复 sweep，绝不伪写 `ready/failed/completed`。
5. 恢复 sweep 只处理超过明确阈值的 `requestType='export' AND status IN ('pending','handling')` 行。它以 `id + status + executionVersion + lastAttemptAt` CAS 取得恢复权，再使用相同 job id 入列；`handling` 且保留 `uploading` FileObject 时先删除可推导的半成品对象并再投递，避免孤儿 artifact。
6. `failed` 继续保留 `activeKey`。本切片不做会员取消和 Admin retry；Slice 4 才能将 `failed -> pending` 并递增 `executionVersion`。因此错误必须是稳定、公开的 `failureCode`，不得泄露内部详情。

## 2. 导出白名单 v1

mapper 只能显式构造下列字段；每个查询必须包含 `endUserId`，不得 `select *`、spread Prisma 行或先读取全量再过滤。

| 分区 | 允许字段 | 强制排除 |
| --- | --- | --- |
| `account` | `id`、`nickname`、`createdAt` | `phone*`、密码、会话、设备、状态 epoch |
| `dataRequests` | type、status、requested/handled 时间、公开 `failureCode` | `activeKey`、workerJobId、progressJson、auditRef |
| `files` | id、filename、MIME、size、purpose、assetCategory、created/expires 时间 | `storageKey`、bucket、region、sha256、签名 URL |
| `favorites` | targetType、targetId、title、createdAt | 其他会员记录 |
| `activity` | 安全目标标识、时间 | 投递/预约/签到结果、外部 URL 查询参数 |
| `consents` | scope、版本、granted/revoked 时间 | terminal/device 标识 |
| `notifications` | 会员已见标题、类型、时间、已读状态 | 广播内部 payload、未展示内容 |
| `feedback` | subject、公开状态、createdAt | 联系方式、加密值、管理员内部回复 |
| `printOrders` | 已审核的非资金敏感只读摘要 | `itemsJson`、支付凭证、内部错误 |

所有分区必须在查询层使用 `take: CAP + 1`。发现第 `CAP + 1` 条或累计 JSON 字节超过 `MAX_EXPORT_BYTES` 时返回 `EXPORT_TOO_LARGE`，不截断、不生成部分文件。

## 3. 实施任务

### Task 1: 先写 export 状态机与恢复 RED 验证

**Files:**

- Create: `services/api/scripts/verify-member-data-export.ts`
- Modify: `services/api/scripts/verify-member-data-request-state-machine.ts`
- Modify: `services/api/package.json`
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: 编写真实 SQLite + fake Queue + fake Storage 验证骨架。**

  夹具必须创建两个 end user、各自的 `FileObject/Favorite/BrowseLog/UserAiConsent/MemberNotification/FeedbackTicket`，并提供以下 fake：

  ```ts
  class FakeMemberPrivacyQueue {
    available = true
    jobs = new Map<string, { requestId: string; executionVersion: number }>()
    async addExport(data: { requestId: string; executionVersion: number }) {
      if (!this.available) throw new Error('QUEUE_UNAVAILABLE')
      const id = `${data.requestId}:${data.executionVersion}`
      this.jobs.set(id, data)
      return { id }
    }
  }
  ```

- [ ] **Step 2: 先运行 RED。**

  Run: `PAYMENT_PROVIDER=disabled pnpm --filter @ai-job-print/api verify:member-data-export`
  Expected: script missing，或至少一条关于 queue / artifact recovery 的断言失败。

- [ ] **Step 3: 固定不可回退的断言。**

  验证至少包括：无 Redis 队列时新 export 零副作用拒绝；queue add 抛错时 `failed/QUEUE_ENQUEUE_FAILED + required audit + activeKey`；上传后 ready transaction 失败会物理删除；在 put 后模拟进程中断，重投不能产生第二个对象且不能永久 `handling`；同一 request 的重复 processor 只有一个 `ready` artifact；超限无对象；审计失败无 `ready/completed`；JSON 不含他人 id/title、11 位手机号或 `phoneEnc|phoneHash|storageKey|objectKey|signedUrl|token|prompt|output|itemsJson`。

- [ ] **Step 4: 将脚本接入 package 与双 CI。**

  新增：

  ```json
  "verify:member-data-export": "node -r @swc-node/register scripts/verify-member-data-export.ts"
  ```

  在 SQLite `build-and-verify` 和 PostgreSQL readiness 的既有 API verify 区块中显式执行该脚本；不依赖真实 Redis、COS 或生产凭证。

### Task 2: 必需审计与恢复查询索引

**Files:**

- Modify: `services/api/src/audit/audit.service.ts`
- Modify: `services/api/prisma/schema.prisma`
- Modify: `services/api/prisma/postgres/schema.prisma`
- Create: `services/api/prisma/migrations/20260717160000_add_member_data_export_recovery_index/migration.sql`
- Create: `services/api/prisma/postgres/migrations/20260717160000_add_member_data_export_recovery_index/migration.sql`

- [ ] **Step 1: 增加会失败的 `writeRequired` 测试。**

  断言 transaction client 的 `auditLog.create` 抛错时外层 transaction 回滚；旧 `write()` 仍返回 `null`，行为不变。

- [ ] **Step 2: 新增窄化 API。**

  ```ts
  async writeRequired(
    tx: Pick<PrismaService, 'auditLog'>,
    args: RequiredAuditArgs,
  ): Promise<string> {
    const row = await tx.auditLog.create({ data: this.toCreateData(args) })
    return row.id
  }
  ```

  `toCreateData()` 复用现有 `safeStringify()` 的 4KB 限制；调用方传入 export payload 时只能有 requestId、executionVersion、稳定 failureCode、计数和 fileId，不能传 object key、ticket、手机号或对象内容。

- [ ] **Step 3: 为恢复查询增加双库同名索引。**

  两份 schema 增加：

  ```prisma
  @@index([requestType, status, lastAttemptAt])
  ```

  两份 migration 分别创建 `UserDataRequest_requestType_status_lastAttemptAt_idx`，只加索引，不回填、不改历史请求。

- [ ] **Step 4: 运行双 schema 验证。**

  Run: `pnpm --filter @ai-job-print/api db:pg:sync:check`
  Expected: `postgres schema 同步校验通过`。

### Task 3: 文件 purpose 与可恢复的内部 artifact 原语

**Files:**

- Modify: `packages/shared/src/types/file.ts`
- Modify: `services/api/src/files/file.types.ts`
- Modify: `services/api/src/files/file-validation.ts`
- Modify: `services/api/src/files/retention-policy.ts`
- Modify: `services/api/src/storage/object-key.ts`
- Modify: `services/api/src/files/files.service.ts`

- [ ] **Step 1: 增加双端 file 契约 RED 比对。**

  `member_data_export` 必须同时存在于 shared/API `FilePurpose`；它只允许 `application/json`，默认 `highly_sensitive`，只能为 `system_short`，文件归属为请求会员，object key 位于用户 scope。任一副本遗漏或 TTL 超过 24 小时即失败。

- [ ] **Step 2: 以专用内部方法替代 `FilesService.upload()`。**

  ```ts
  async reserveMemberDataExport(args: {
    fileId: string
    endUserId: string
    expiresAt: Date
  }): Promise<{ fileId: string }>

  async writeReservedMemberDataExport(args: {
    fileId: string
    endUserId: string
    buffer: Buffer
  }): Promise<{ fileId: string; sizeBytes: number; sha256: string }>
  ```

  `reserve...` 只允许 `now < expiresAt <= now + 24h`，创建 `FileObject(status='uploading', purpose='member_data_export', visibility='private', assetCategory='derived')`；`write...` 只允许该会员自己的 uploading 记录，用由 file id 推导的 key `putObject`，不得返回 signed URL。由 export service 在自己的 transaction 中把 FileObject 改为 `active`。

- [ ] **Step 3: 补偿语义。**

  `deleteReservedMemberDataExport(fileId, reason)` 必须先依据 FileObject 读取受控 key，再删除对象与 metadata；删失败抛稳定内部错误，不把 key 拼进异常、日志或 audit payload。复用 `readContentForEndUser()` 的本人隔离语义，不调用无归属校验的 `readContent()`。

- [ ] **Step 4: 运行专项目录验证。**

  Run: `pnpm --filter @ai-job-print/api verify:file-retention && pnpm --filter @ai-job-print/api verify:member-data-export`
  Expected: member_data_export 只能短期私有保存，且不返回签名 URL。

### Task 4: 专用队列、稳定 job id 与恢复 sweep

**Files:**

- Create: `services/api/src/member-privacy/member-privacy.queue.ts`
- Create: `services/api/src/member-privacy/member-data-export-recovery.service.ts`
- Create: `services/api/src/member-privacy/member-privacy.processor.ts`
- Modify: `services/api/src/member-privacy/member-privacy.module.ts`

- [ ] **Step 1: 写 queue 不可用 RED 用例。**

  ```ts
  expect(() => queue.assertQueueAvailable()).toThrow('MEMBER_PRIVACY_QUEUE_UNAVAILABLE')
  ```

  未设 `REDIS_URL` 时 Module 不注册 processor，`assertQueueAvailable()` 必须在新 export 消费 step-up grant 前拒绝；已有幂等 replay 仍只读返回原账本。

- [ ] **Step 2: 实现 queue facade。**

  ```ts
  export const MEMBER_PRIVACY_QUEUE = 'member-privacy'
  export const exportJobId = (requestId: string, executionVersion: number) =>
    `${requestId}:${executionVersion}`
  ```

  facade 只接受 `{ requestId, executionVersion }`；`addExport()` 使用固定 job id、有限 attempts/backoff，禁止 `setImmediate`、Promise background fallback 或把 payload 扩展为 endUserId、object key、token。

- [ ] **Step 3: 实现受限恢复 sweep。**

  每次至多处理固定上限的 stale `pending/handling` export；以 `id/status/executionVersion/lastAttemptAt` CAS 获得恢复权。对于 `handling + FileObject(uploading)`，先物理删除可推导半成品，再同 job id 重新投递；queue 不可用时保留非终态并写安全 ops 日志，不能 inline 执行。

- [ ] **Step 4: 实现 processor。**

  `process(job)` 只接受固定 job 名和两字段 data，调用 `MemberDataExportService.execute(requestId, executionVersion)`；未知 job 名只记录安全摘要并拒绝。

### Task 5: 白名单 mapper、artifact worker 与 create enqueue 接线

**Files:**

- Create: `services/api/src/member-privacy/member-data-export.mapper.ts`
- Create: `services/api/src/member-privacy/member-data-export.service.ts`
- Modify: `services/api/src/member-privacy/member-data-request.service.ts`
- Modify: `services/api/src/member-privacy/member-privacy.module.ts`

- [ ] **Step 1: 先实现 mapper 的显式分区选择。**

  ```ts
  export interface MemberDataExportDocument {
    version: 'member-data-export-v1'
    generatedAt: string
    account: { id: string; nickname: string | null; createdAt: string }
    dataRequests: Array<{ requestType: string; status: string; requestedAt: string; handledAt: string | null; failureCode: string | null }>
    files: Array<{ id: string; filename: string; mimeType: string; sizeBytes: number; purpose: string; assetCategory: string; createdAt: string; expiresAt: string | null }>
  }
  ```

  其余白名单分区同样用显式 DTO；每个 Prisma `where` 带 `endUserId`，每个查询 `take: CAP + 1`，累计 `Buffer.byteLength(JSON.stringify(document))` 不能超过 `MAX_EXPORT_BYTES`。

- [ ] **Step 2: 实现 worker 的三段提交。**

  1. `claimAndReserve()`：CAS `pending -> handling`，预留 FileObject，写 required audit；审计失败使 transaction 回滚。
  2. `buildAndStore()`：mapper 超限先失败；成功后写 reserved object。put 后崩溃时，账本已有 file id，可由恢复 sweep 定位并清理。
  3. `markReady()`：以 `id + handling + executionVersion` CAS 同 transaction 激活 FileObject、写 `ready/export_ready/exportExpiresAt/auditRef` 与 required audit；失败立即调用受控补偿删除。

- [ ] **Step 3: 改造创建链路。**

  幂等查找必须早于 `assertQueueAvailable()`，仅新 export 做队列可用性检查；reserve 与 grant 语义维持 Slice 1，且 grant 失败按 Slice 1 删除暂存账本、不写 required audit。grant 成功后固定 job id 入列；仅在 `add()` 返回后，才用一个 transaction CAS 写 `workerJobId`、`executionStep='queue_enqueued'` 与 required audit。`add()` 抛错时以 CAS 写 `failed/QUEUE_ENQUEUE_FAILED` 和 required audit，保留 activeKey；若 `add()` 成功后、该 transaction 前进程中断，recovery sweep 必须以相同 job id 确认/重投，并补齐这个状态与审计。写失败时由 recovery sweep 处理 stale pending，不得删除或伪完成账本。

- [ ] **Step 4: 回归 delete。**

  `delete` 分支保持在任何 queue、storage、audit、Prisma 与 step-up 调用之前。所有新 queue/provider 的可用性检查只能位于 export 分支。

### Task 6: 全量 verify、审查、文档与独立提交

**Files:**

- Modify: `services/api/scripts/verify-member-data-request-state-machine.ts`
- Modify: `docs/progress/current-progress.md`
- Modify: `docs/progress/next-tasks.md`

- [ ] **Step 1: 执行验证。**

  ```bash
  PAYMENT_PROVIDER=disabled pnpm --filter @ai-job-print/api verify:member-data-export
  PAYMENT_PROVIDER=disabled pnpm --filter @ai-job-print/api verify:member-data-request-state-machine
  PAYMENT_PROVIDER=disabled pnpm --filter @ai-job-print/api verify:member-data-request-truth
  pnpm --filter @ai-job-print/api verify:file-retention
  pnpm --filter @ai-job-print/shared typecheck
  pnpm --filter @ai-job-print/api db:pg:sync:check
  pnpm --filter @ai-job-print/api lint
  pnpm --filter @ai-job-print/api typecheck
  pnpm --filter @ai-job-print/api build
  pnpm audit --audit-level=high
  git diff --check
  ```

- [ ] **Step 2: 执行双模型审查。**

  审查必须覆盖：worker crash after put、enqueue crash、recovery CAS、required-audit rollback、FileObject owner/TTL、JSON 白名单、无 Redis fail-closed 与 delete 零副作用。任何 Critical 均需 RED→GREEN 修正并重新审查；无法取得某模型有效报告时，在 review.md 和进度文档如实记录，不得视为批准。

- [ ] **Step 3: 更新正式事实。**

  `current-progress.md` 只在 PR 合入且双 CI 通过后写“Slice 2 已合入”；在此之前只能写本地候选。`next-tasks.md` 必须保持 Slice 3（下载租约/到期清理）与 Slice 4（受限运营 retry）未开始，不能因 ready artifact 声称下载已开放。

- [ ] **Step 4: 独立提交。**

  ```bash
  git add <本切片文件>
  git commit -m "feat: add recoverable member data export artifacts"
  ```

## 4. 合入门禁

1. C1/C2 崩溃窗口在真实 SQLite + fake queue/storage 验证中可复现并通过恢复；不能只覆盖异常 throw。
2. SQLite 与 PostgreSQL 迁移、schema 同步、API build/lint/typecheck 与 `pnpm audit --audit-level=high` 均通过。
3. 无 Redis 时新 export 无账本、无 grant、无审计、无文件副作用；同 key 的既有账本 replay 不受影响。
4. 任何对象存储写入后，账本都可从 `exportFileId` 定位并清理；没有永久 `handling`、没有无引用 `member_data_export` 对象。
5. 不增加用户可见入口或下载路由；`delete` 仍稳定零副作用 409。
6. 仅在内部测试账号与隔离存储夹具完成闭环；未获得法务/隐私负责人确认前，不对用户宣称“完整个人数据副本”。

## 5. 计划自检

- **覆盖性：** 必需审计、队列 fail-closed、white-list artifact、owner/TTL、enqueue/worker crash 恢复、补偿、双库索引、验证和文档均有明确任务。
- **无占位：** 没有 Kiosk/Admin UI、真实下载、账户注销或生产配置任务。
- **术语一致：** 唯一账本为 `UserDataRequest`；唯一 artifact purpose 为 `member_data_export`；队列常量为 `MEMBER_PRIVACY_QUEUE`；恢复 job id 为 `${requestId}:${executionVersion}`。
