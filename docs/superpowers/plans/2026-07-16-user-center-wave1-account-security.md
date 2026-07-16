# User Center Wave 1 Account Security Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不破坏现有会员登录的前提下，引入 additive 账户状态、可整户撤销的 Redis 会话索引，以及绑定会员与动作的 5 分钟单次 step-up 凭证，为数据导出和账号注销建立可信安全边界。

**Architecture:** `EndUser.status` 成为新事实源，`enabled` 迁移期继续作为旧 Guard 门禁并同事务双写。普通会员会话增加 user→session set 索引，支持注销时撤销全部会话。step-up 复用现有短信 sender 和 Redis，但使用独立 challenge/code/grant key 空间；验证码只以 HMAC 落 Redis，grant 是 32 字节 opaque token，数据库和日志都不保存明文。另提供仅供注销最小回执端点使用的窄化 JWT subject guard：它只验签原 token 并暴露 `sub`，不恢复 Redis 会话、不会被普通本人接口复用。

**Tech Stack:** NestJS 11；Prisma 7；SQLite/PostgreSQL；Redis Lua 原子操作；现有 SMS sender；TypeScript shared contracts；现有 AuditService。

---

## 0. 文件预算与边界

**Allowed Runtime Files:**

- Create: `packages/shared/src/types/member-privacy.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `services/api/prisma/schema.prisma`
- Modify: `services/api/prisma/postgres/schema.prisma`
- Create: `services/api/prisma/migrations/20260717090000_add_member_account_status/migration.sql`
- Create: `services/api/prisma/postgres/migrations/20260717090000_add_member_account_status/migration.sql`
- Create: `services/api/src/member-auth/dto/member-step-up.dto.ts`
- Create: `services/api/src/member-auth/member-step-up.service.ts`
- Modify: `services/api/src/member-auth/member-auth.controller.ts`
- Modify: `services/api/src/member-auth/member-auth.module.ts`
- Modify: `services/api/src/member-auth/member-auth.service.ts`
- Modify: `services/api/src/common/guards/end-user-auth.guard.ts`
- Create: `services/api/src/common/guards/member-closure-receipt.guard.ts`
- Modify: `services/api/src/common/guards/optional-end-user-auth.guard.ts`
- Modify: `services/api/src/common/auth/optional-end-user.ts`
- Modify: `services/api/src/common/redis/redis.service.ts`
- Modify: `services/api/src/member-auth/member-qr-login.service.ts`
- Modify: `services/api/src/job-ai/job-ai.controller.ts`
- Modify: `services/api/src/activity/activity.controller.ts`
- Modify: `services/api/src/print-jobs/print-jobs.controller.ts`
- Modify: `services/api/src/ai/fair-visit-plan.controller.ts`
- Modify: `services/api/src/ai/ai.controller.ts`
- Modify: `services/api/src/upload-sessions/upload-sessions.controller.ts`
- Modify: `services/api/src/files/files.controller.ts`
- Modify: `services/api/src/scan-tasks/scan-tasks.controller.ts`
- Modify: `services/api/src/ai/career-plan.controller.ts`
- Modify: `services/api/src/ai/job-fit.controller.ts`
- Modify: `services/api/src/materials/materials.controller.ts`
- Modify: `services/api/src/print-sign/print-sign.controller.ts`
- Modify: `services/api/src/mock-interview/mock-interview.controller.ts`
- Modify: `services/api/src/print-conversion/print-conversion.controller.ts`
- Create: `services/api/scripts/verify-member-account-status.ts`
- Create: `services/api/scripts/verify-member-step-up.ts`
- Modify: `services/api/scripts/verify-member-auth.ts`
- Modify: `services/api/package.json`
- Modify: `.github/workflows/ci.yml`
- Modify: `docs/progress/current-progress.md`
- Modify: `docs/progress/next-tasks.md`

**Forbidden:**

- `apps/kiosk/src/**`、`apps/admin/src/**`（本分支只交付后端契约）
- `services/api/src/member-privacy/**`（下一计划接入）
- `services/worker/**`
- 支付、退款、权益、打印机与 Terminal Agent
- 删除或重命名 `enabled`

## Task 1: 先定义共享契约和 RED 类型门禁

**Files:**

- Create: `packages/shared/src/types/member-privacy.ts`
- Modify: `packages/shared/src/index.ts`
- Create: `services/api/scripts/verify-member-account-status.ts`
- Modify: `services/api/package.json`

- [ ] 在 shared 中写唯一字面量来源：

```ts
export const END_USER_STATUSES = ['active', 'disabled', 'closing', 'anonymized'] as const
export type EndUserStatus = (typeof END_USER_STATUSES)[number]

export const MEMBER_STEP_UP_ACTIONS = [
  'export_data_request',
  'export_data_download',
  'close_account',
] as const
export type MemberStepUpAction = (typeof MEMBER_STEP_UP_ACTIONS)[number]

export const MEMBER_DATA_REQUEST_TYPES = ['export', 'delete', 'revoke_consent'] as const
export type MemberDataRequestType = (typeof MEMBER_DATA_REQUEST_TYPES)[number]

export const MEMBER_DATA_REQUEST_STATUSES = [
  'pending',
  'handling',
  'ready',
  'completed',
  'expired',
  'failed',
  'rejected',
  'cancelled',
] as const
export type MemberDataRequestStatus = (typeof MEMBER_DATA_REQUEST_STATUSES)[number]
```

- [ ] 从 `packages/shared/src/index.ts` 导出该模块：

```ts
export * from './types/member-privacy'
```

- [ ] 新建 `verify-member-account-status.ts`，先静态检查双 schema 和 Guard 的目标字段；此时必须 RED：

```ts
const schemaMarkers = [
  'status          String    @default("active")',
  'statusChangedAt DateTime?',
  'closingRequestedAt DateTime?',
  'anonymizedAt DateTime?',
  '@@index([status])',
]
mustContain(sqliteSchema, schemaMarkers)
mustContain(postgresSchema, schemaMarkers)
mustContain(guard, ['select: { enabled: true, status: true }', "user.status !== 'active'"])
```

- [ ] 注册：

```json
"verify:member-account-status": "node -r @swc-node/register scripts/verify-member-account-status.ts"
```

- [ ] 运行：

```bash
pnpm --filter @ai-job-print/shared typecheck
pnpm --filter @ai-job-print/api verify:member-account-status
```

Expected: shared 通过，账户状态 verify 因 schema/Guard 未实现而失败。

- [ ] Commit：

```bash
git add packages/shared/src/types/member-privacy.ts packages/shared/src/index.ts services/api/scripts/verify-member-account-status.ts services/api/package.json
git commit -m "test: define member privacy security contracts"
```

## Task 2: Additive 账户状态迁移（RED → GREEN）

**Files:**

- Modify: `services/api/prisma/schema.prisma`
- Modify: `services/api/prisma/postgres/schema.prisma`
- Create: `services/api/prisma/migrations/20260717090000_add_member_account_status/migration.sql`
- Create: `services/api/prisma/postgres/migrations/20260717090000_add_member_account_status/migration.sql`
- Modify: `services/api/scripts/verify-member-account-status.ts`

- [ ] 在两个 Prisma schema 的 `EndUser` 同位置加入：

```prisma
status             String    @default("active")
statusChangedAt    DateTime?
closingRequestedAt DateTime?
anonymizedAt       DateTime?
```

- [ ] 在 `EndUser` 尾部加入：

```prisma
@@index([status])
```

- [ ] SQLite migration 完整内容：

```sql
ALTER TABLE "EndUser" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'active';
ALTER TABLE "EndUser" ADD COLUMN "statusChangedAt" DATETIME;
ALTER TABLE "EndUser" ADD COLUMN "closingRequestedAt" DATETIME;
ALTER TABLE "EndUser" ADD COLUMN "anonymizedAt" DATETIME;

UPDATE "EndUser"
SET "status" = 'disabled',
    "statusChangedAt" = CURRENT_TIMESTAMP
WHERE "enabled" = 0;

CREATE INDEX "EndUser_status_idx" ON "EndUser"("status");
```

- [ ] PostgreSQL migration 完整内容：

```sql
ALTER TABLE "EndUser"
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN "statusChangedAt" TIMESTAMP(3),
  ADD COLUMN "closingRequestedAt" TIMESTAMP(3),
  ADD COLUMN "anonymizedAt" TIMESTAMP(3);

UPDATE "EndUser"
SET "status" = 'disabled',
    "statusChangedAt" = CURRENT_TIMESTAMP
WHERE "enabled" = false;

CREATE INDEX "EndUser_status_idx" ON "EndUser"("status");
```

- [ ] 扩展 verify：在临时库创建 `enabled=false` 旧用户，迁移后断言 `status=disabled`；新用户默认 `active`。
- [ ] 用临时 SQLite 从前一 migration 状态重放本 migration，不能只跑 `db push`。
- [ ] 运行：

```bash
cd services/api
pnpm db:pg:sync:check
DATABASE_URL='file:./prisma/account-status-verify.db' npx prisma migrate deploy
DATABASE_URL='file:./prisma/account-status-verify.db' npx prisma generate
pnpm verify:member-account-status
```

Expected: schema/migration 断言通过，Guard 断言仍 RED。

- [ ] Commit：

```bash
git add services/api/prisma/schema.prisma services/api/prisma/postgres/schema.prisma services/api/prisma/migrations/20260717090000_add_member_account_status/migration.sql services/api/prisma/postgres/migrations/20260717090000_add_member_account_status/migration.sql services/api/scripts/verify-member-account-status.ts
git commit -m "feat: add member account status schema"
```

## Task 3: Redis 会话索引原子操作（RED）

**Files:**

- Modify: `services/api/src/common/redis/redis.service.ts`
- Modify: `services/api/scripts/verify-member-auth.ts`

- [ ] 先在 `verify-member-auth.ts` 增加失败用例：同一用户签发两个 session 后，整户撤销应让两个 `member:session:{jti}` 都消失，其他用户 session 保留。
- [ ] 在 `RedisService` 增加原子注册：

```ts
async registerMemberSession(endUserId: string, sessionId: string, ttlSeconds: number): Promise<void> {
  await this.client.eval(
    `
    redis.call('SET', KEYS[1], ARGV[1], 'EX', tonumber(ARGV[3]))
    redis.call('SADD', KEYS[2], ARGV[2])
    redis.call('EXPIRE', KEYS[2], tonumber(ARGV[3]))
    return 1
    `,
    2,
    `member:session:${sessionId}`,
    `member:user-sessions:${endUserId}`,
    endUserId,
    sessionId,
    ttlSeconds,
  )
}
```

- [ ] 增加单次登出并移除索引：

```ts
async unregisterMemberSession(endUserId: string, sessionId: string): Promise<void> {
  await this.client.eval(
    `
    redis.call('DEL', KEYS[1])
    redis.call('SREM', KEYS[2], ARGV[1])
    if redis.call('SCARD', KEYS[2]) == 0 then redis.call('DEL', KEYS[2]) end
    return 1
    `,
    2,
    `member:session:${sessionId}`,
    `member:user-sessions:${endUserId}`,
    sessionId,
  )
}
```

- [ ] 增加整户撤销；Lua 只拼接固定服务端前缀，不接受客户端 key：

```ts
async revokeMemberSessions(endUserId: string): Promise<number> {
  const result = await this.client.eval(
    `
    local sessions = redis.call('SMEMBERS', KEYS[1])
    for _, sessionId in ipairs(sessions) do
      redis.call('DEL', ARGV[1] .. sessionId)
    end
    redis.call('DEL', KEYS[1])
    return #sessions
    `,
    1,
    `member:user-sessions:${endUserId}`,
    'member:session:',
  )
  return Number(result)
}
```

- [ ] 运行 RED/GREEN 测试，确认不能删除其他用户会话：

```bash
PAYMENT_PROVIDER=disabled pnpm --filter @ai-job-print/api verify:member-auth
```

- [ ] Commit：

```bash
git add services/api/src/common/redis/redis.service.ts services/api/scripts/verify-member-auth.ts
git commit -m "feat: index and revoke member sessions"
```

## Task 4: 切换所有登录与可选会员解析面到双轨账户状态

**Files:**

- Modify: `services/api/src/member-auth/member-auth.service.ts`
- Modify: `services/api/src/member-auth/member-auth.controller.ts`
- Modify: `services/api/src/member-auth/member-qr-login.service.ts`
- Modify: `services/api/src/common/guards/end-user-auth.guard.ts`
- Modify: `services/api/src/common/guards/optional-end-user-auth.guard.ts`
- Modify: `services/api/src/common/auth/optional-end-user.ts`
- Modify: 上述所有直接调用 `resolveOptionalEndUser` 的 controller 文件（只增加 `PrismaService` 参数传递/注入，不改业务逻辑）
- Modify: `services/api/scripts/verify-member-account-status.ts`
- Modify: `services/api/scripts/verify-member-auth.ts`

- [ ] 登录查到旧用户后同时检查：

```ts
if (user && (!user.enabled || user.status !== 'active')) {
  throw new ForbiddenException({
    error: { code: 'ACCOUNT_UNAVAILABLE', message: '账号当前不可登录，请联系工作人员' },
  })
}
```

不要向客户端区分 disabled/closing/anonymized，避免泄露账户处置状态。

- [ ] 新用户创建显式写入：

```ts
data: {
  phoneHash,
  phoneEnc: encryptPhone(phone),
  status: 'active',
  enabled: true,
  lastLoginAt: new Date(),
}
```

- [ ] `issueLoginForUser` 改用原子 session 注册：

```ts
const sessionId = randomUUID()
await this.redis.registerMemberSession(user.id, sessionId, SESSION_TTL)
const token = this.jwtService.sign({ sub: user.id }, { jwtid: sessionId })
```

不得在切换 Redis 写法时丢失 JWT `jti`；它就是会话索引的 `sessionId`。

- [ ] `issueLoginForUser` 在注册 Redis session 前必须按 `user.id` 重新读取 `enabled + status`；不是 `enabled=true,status=active` 时统一返回 `ACCOUNT_UNAVAILABLE`。扫码票据确认与最终 claim 之间发生 closing/disabled 时不得签发新 session。

- [ ] `logout` 改为接收 user 和 session：

```ts
async logout(endUserId: string, sessionId: string): Promise<void> {
  await this.redis.unregisterMemberSession(endUserId, sessionId)
}
```

controller 调用：

```ts
await this.service.logout(user.endUserId, user.sessionId)
```

- [ ] Guard 查询并双轨判断：

```ts
const sessionId = payload.jti
if (!sessionId) throw this.unauthorized('MEMBER_TOKEN_INVALID', '登录已失效,请重新登录')

const user = await this.prisma.endUser.findUnique({
  where: { id: payload.sub },
  select: { enabled: true, status: true },
})
if (!user || !user.enabled || user.status !== 'active') {
  await this.redis.unregisterMemberSession(payload.sub, sessionId)
  throw this.unauthorized(
    user ? 'ACCOUNT_UNAVAILABLE' : 'MEMBER_SESSION_EXPIRED',
    user ? '账号当前不可用，请重新登录或联系工作人员' : '会话已失效,请重新登录',
  )
}

req.endUser = { endUserId: payload.sub, sessionId }
```

现有 `AuthedEndUser` 已含 `sessionId`，本任务不重建类型；必须显式保留 `jwtid -> payload.jti -> req.endUser.sessionId -> logout` 全链路。

- [ ] `OptionalEndUserAuthGuard` 同样查询 `enabled + status`；任一门禁不通过时删除当前 session 并把请求保持为匿名，不把 closing/anonymized 用户注入 `req.endUser`。
- [ ] `resolveOptionalEndUser` 增加 `PrismaService` 参数，在 Redis session 所有权校验后再查 `enabled + status`；状态不 active 时删除 session 并返回 null。用 CodeGraph 列出的全部直接调用点必须显式传入 Prisma，禁止遗漏任一可选会员入口。

- [ ] 新建 `MemberClosureReceiptGuard`，只允许后续 `GET /member/account-closure-receipt` 使用：复用普通会员 JWT 的签名、算法、`exp` 和 `sub/jti` 校验，但有意不查询 Redis session 与 `EndUser.status`，因为注销受理后会话已被撤销。Guard 只写入 `req.closureReceiptSubject = { endUserId: payload.sub }`，不得写 `req.endUser`，不得导出成通用本人认证能力；任何其他 controller 引用都由静态守卫判失败。
- [ ] 回执 guard 不接受 query/body token，不延长 token 生命周期，不签发新 token；其唯一授权结果仍需由数据权利服务用 `sub + 原 Idempotency-Key + requestType=delete` 三项精确匹配。测试证明 closing/anonymized 用户只能过该 guard 的验签层，仍不能通过普通、可选或 QR 登录路径。

- [ ] 测试矩阵：

```text
enabled=true,status=active        -> allow
enabled=false,status=active       -> deny (旧门禁)
enabled=true,status=disabled      -> deny (新门禁)
enabled=false,status=closing      -> deny
enabled=false,status=anonymized   -> deny
missing user                      -> deny
logout with current jti          -> member:session:{jti} deleted and user set member removed
optional enabled=true,status=active -> attach member
optional enabled=false/status!=active -> anonymous + revoke current session
QR confirmed, then account closing before claim -> deny and do not issue session
closing + original unexpired JWT -> closure receipt guard exposes sub only; ordinary guard still denies
expired/invalid JWT -> closure receipt guard denies
```

- [ ] 运行：

```bash
PAYMENT_PROVIDER=disabled pnpm --filter @ai-job-print/api verify:member-auth
pnpm --filter @ai-job-print/api verify:member-account-status
pnpm --filter @ai-job-print/api typecheck
```

Expected: 全部通过。

- [ ] Commit：

```bash
git add services/api/src/member-auth/member-auth.service.ts services/api/src/member-auth/member-auth.controller.ts services/api/src/member-auth/member-qr-login.service.ts services/api/src/common/guards/end-user-auth.guard.ts services/api/src/common/guards/member-closure-receipt.guard.ts services/api/src/common/guards/optional-end-user-auth.guard.ts services/api/src/common/auth/optional-end-user.ts services/api/src/job-ai/job-ai.controller.ts services/api/src/activity/activity.controller.ts services/api/src/print-jobs/print-jobs.controller.ts services/api/src/ai/fair-visit-plan.controller.ts services/api/src/ai/ai.controller.ts services/api/src/upload-sessions/upload-sessions.controller.ts services/api/src/files/files.controller.ts services/api/src/scan-tasks/scan-tasks.controller.ts services/api/src/ai/career-plan.controller.ts services/api/src/ai/job-fit.controller.ts services/api/src/materials/materials.controller.ts services/api/src/print-sign/print-sign.controller.ts services/api/src/mock-interview/mock-interview.controller.ts services/api/src/print-conversion/print-conversion.controller.ts services/api/scripts/verify-member-account-status.ts services/api/scripts/verify-member-auth.ts
git commit -m "feat: enforce additive member account states"
```

## Task 5: 先写 step-up 集成测试（RED）

**Files:**

- Create: `services/api/scripts/verify-member-step-up.ts`
- Modify: `services/api/package.json`
- Modify: `.github/workflows/ci.yml`

- [ ] 建立 FakeSmsSender/真实 Redis 测试，覆盖：

```text
1. 未登录不能创建 challenge
2. action 不在 shared allowlist -> 400
3. challenge 只绑定当前 endUserId
4. Redis 里不存在 6 位明文验证码
5. 错码递增尝试，超过 5 次 challenge 作废
6. 正确码只能消费一次
7. grant 只对匹配 user + action 成功
8. grant 第二次消费 -> STEP_UP_TOKEN_INVALID（对外不区分重放与无效）
9. grant 过期 -> STEP_UP_TOKEN_INVALID
10. deviceId 缺失/变化只写风险摘要，不作为强认证拒绝依据
11. disabled/closing/anonymized 用户不能创建 challenge
12. 短信发送失败时清理 challenge/code/cooldown
```

- [ ] 核心调用形状：

```ts
const challenge = await service.sendChallenge(endUserId, {
  action: 'export_data_request',
  deviceId: 'KSK-001',
  ip: '127.0.0.1',
})
const grant = await service.verifyChallenge(endUserId, {
  challengeId: challenge.challengeId,
  code: sms.lastCode,
  deviceId: 'KSK-001',
})
await service.consumeGrant(endUserId, 'export_data_request', grant.stepUpToken, 'KSK-001')
await expectCode(
  () => service.consumeGrant(endUserId, 'export_data_request', grant.stepUpToken, 'KSK-001'),
  'STEP_UP_TOKEN_INVALID',
)
```

- [ ] 注册：

```json
"verify:member-step-up": "node -r @swc-node/register scripts/verify-member-step-up.ts"
```

- [ ] CI 放在 `verify:member-auth` 后。
- [ ] 运行确认 RED：

```bash
PAYMENT_PROVIDER=disabled pnpm --filter @ai-job-print/api verify:member-step-up
```

Expected: 文件/服务不存在而失败。

- [ ] Commit：

```bash
git add services/api/scripts/verify-member-step-up.ts services/api/package.json .github/workflows/ci.yml
git commit -m "test: specify member step-up security"
```

## Task 6: 实现 step-up DTO 与服务（GREEN）

**Files:**

- Create: `services/api/src/member-auth/dto/member-step-up.dto.ts`
- Create: `services/api/src/member-auth/member-step-up.service.ts`
- Modify: `services/api/src/member-auth/member-auth.module.ts`
- Modify: `services/api/src/common/redis/redis.service.ts`
- Modify: `services/api/scripts/verify-member-step-up.ts`

- [ ] DTO 完整边界：

```ts
import { MEMBER_STEP_UP_ACTIONS, type MemberStepUpAction } from '@ai-job-print/shared'
import { IsIn, IsOptional, IsString, IsUUID, Length, Matches, MaxLength } from 'class-validator'

export class SendMemberStepUpCodeDto {
  @IsIn(MEMBER_STEP_UP_ACTIONS)
  action!: MemberStepUpAction

  @IsOptional()
  @IsString()
  @MaxLength(120)
  deviceId?: string
}

export class VerifyMemberStepUpDto {
  @IsUUID()
  challengeId!: string

  @Matches(/^\d{6}$/)
  code!: string

  @IsOptional()
  @IsString()
  @MaxLength(120)
  deviceId?: string
}
```

- [ ] 服务常量：

```ts
function readStepUpTtlSeconds(): number {
  const raw = Number(process.env['MEMBER_STEP_UP_TTL_SECONDS'] ?? '300')
  if (!Number.isInteger(raw) || raw < 60 || raw > 600) {
    throw new Error('MEMBER_STEP_UP_TTL_SECONDS 必须是 60–600 的整数')
  }
  return raw
}

const ttlSeconds = readStepUpTtlSeconds()
const CHALLENGE_TTL_SECONDS = ttlSeconds
const GRANT_TTL_SECONDS = ttlSeconds
const MAX_VERIFY_ATTEMPTS = 5
const SEND_COOLDOWN_SECONDS = 60
```

- [ ] challenge 元数据只存 JSON 安全字段：

```ts
interface StepUpChallengeRecord {
  endUserId: string
  action: MemberStepUpAction
  deviceDigest: string | null
  createdAt: string
}
```

- [ ] 使用 HMAC 存验证码，不写明文：

```ts
private codeDigest(challengeId: string, code: string): string {
  const key = process.env['SECRET_ENCRYPTION_KEY']
  if (!key || key.length < 32) throw new Error('SECRET_ENCRYPTION_KEY 未配置或长度不足 32')
  return createHmac('sha256', key).update(`${challengeId}:${code}`).digest('hex')
}
```

- [ ] `sendChallenge` 必须：
  1. 查 `EndUser(id, enabled, status, phoneEnc)`；
  2. 非 active fail closed；
  3. 按 `endUserId + action` 冷却、IP/设备小时频控；
  4. 生成 UUID + 6 位码；
  5. Redis 写 meta/code/attempt TTL；
  6. `decryptPhone(phoneEnc)` 仅传给 `sms.sendCode`；
  7. 短信失败删除本次 Redis 键；
  8. 只返回 `challengeId, phoneMasked, expiresInSeconds, cooldownSeconds`。

- [ ] disabled 用户不能自助进入 closing：首版只允许 active 会员发起 step-up。若法务要求 disabled 账号仍可行使注销权，必须走独立的人工身份核验流程后再扩展，不静默绕过状态门禁。

- [ ] 先在 `RedisService` 实现 grant 的 user index；注册、单次消费和整户撤销均用 Lua 原子执行，不得使用 `KEYS` 扫描：

```ts
async registerMemberStepUpGrant(
  endUserId: string,
  tokenHash: string,
  ttlSeconds: number,
  payload: string,
): Promise<void> {
  await this.client.eval(
    `
    redis.call('SET', KEYS[1], ARGV[1], 'EX', tonumber(ARGV[3]))
    redis.call('SADD', KEYS[2], ARGV[2])
    redis.call('EXPIRE', KEYS[2], tonumber(ARGV[3]))
    return 1
    `,
    2,
    `member:step-up:grant:${tokenHash}`,
    `member:user-step-up-grants:${endUserId}`,
    payload,
    tokenHash,
    ttlSeconds,
  )
}

async getDelMemberStepUpGrant(endUserId: string, tokenHash: string): Promise<string | null> {
  const result = await this.client.eval(
    `
    local value = redis.call('GET', KEYS[1])
    if not value then return false end
    redis.call('DEL', KEYS[1])
    redis.call('SREM', KEYS[2], ARGV[1])
    if redis.call('SCARD', KEYS[2]) == 0 then redis.call('DEL', KEYS[2]) end
    return value
    `,
    2,
    `member:step-up:grant:${tokenHash}`,
    `member:user-step-up-grants:${endUserId}`,
    tokenHash,
  )
  return typeof result === 'string' ? result : null
}

async revokeMemberStepUpGrants(endUserId: string): Promise<number> {
  const result = await this.client.eval(
    `
    local grants = redis.call('SMEMBERS', KEYS[1])
    for _, tokenHash in ipairs(grants) do
      redis.call('DEL', ARGV[1] .. tokenHash)
    end
    redis.call('DEL', KEYS[1])
    return #grants
    `,
    1,
    `member:user-step-up-grants:${endUserId}`,
    'member:step-up:grant:',
  )
  return Number(result)
}
```

上述 session/grant 原子脚本按当前单实例 Redis 7 设计。若未来切换 Redis Cluster，必须先将 user index 与其子 key 改为同 hash slot 或重设撤销策略；不得直接沿用跨 slot Lua。

- [ ] `verifyChallenge` 必须用 `getAndDelIfEquals(codeKey, codeDigest)` 原子消费正确码，再 `getDel(metaKey)`，生成：

```ts
const token = randomBytes(32).toString('base64url')
const tokenHash = createHash('sha256').update(token).digest('hex')
await this.redis.registerMemberStepUpGrant(
  endUserId,
  tokenHash,
  GRANT_TTL_SECONDS,
  JSON.stringify({ endUserId, action: record.action, deviceDigest: record.deviceDigest }),
)
return { stepUpToken: token, action: record.action, expiresInSeconds: GRANT_TTL_SECONDS }
```

- [ ] `consumeGrant` 使用 `getDelMemberStepUpGrant(endUserId, tokenHash)` 原子消费，再比对 `endUserId + action`。任何 mismatch 都返回同一安全错误，不恢复 token。
- [ ] 集成测试另签发同一用户两个 grant 和其他用户一个 grant；调用 `revokeMemberStepUpGrants` 后前两者失效，其他用户仍可消费。
- [ ] device digest 只进审计 payload 的 `deviceMatched: boolean`，不得记录原 deviceId，也不得作为单独放行依据。
- [ ] Module providers/exports：

```ts
providers: [
  MemberAuthService,
  MemberStepUpService,
  MemberQrLoginService,
  EndUserAuthGuard,
  MemberClosureReceiptGuard,
  { provide: SMS_SENDER, useFactory: createSmsSender },
],
exports: [EndUserAuthGuard, MemberClosureReceiptGuard, MemberStepUpService],
```

- [ ] 运行：

```bash
PAYMENT_PROVIDER=disabled pnpm --filter @ai-job-print/api verify:member-step-up
pnpm --filter @ai-job-print/api typecheck
```

Expected: service 测试通过，HTTP route 测试仍待下一任务。

- [ ] Commit：

```bash
git add services/api/src/member-auth/dto/member-step-up.dto.ts services/api/src/member-auth/member-step-up.service.ts services/api/src/member-auth/member-auth.module.ts services/api/src/common/redis/redis.service.ts services/api/scripts/verify-member-step-up.ts
git commit -m "feat: add member step-up challenge service"
```

## Task 7: 接入 step-up HTTP 端点

**Files:**

- Modify: `services/api/src/member-auth/member-auth.controller.ts`
- Modify: `services/api/scripts/verify-member-step-up.ts`

- [ ] Controller 注入 `MemberStepUpService`。
- [ ] 增加端点：

```ts
@Post('auth/step-up/sms-code')
@UseGuards(EndUserAuthGuard)
@Throttle({ default: { ttl: 60_000, limit: 5 } })
async sendStepUpCode(
  @CurrentEndUser() user: AuthedEndUser,
  @Body() dto: SendMemberStepUpCodeDto,
  @Req() req: Request,
) {
  return ApiResponse.ok(await this.stepUp.sendChallenge(user.endUserId, {
    action: dto.action,
    deviceId: dto.deviceId,
    ip: clientIp(req),
  }))
}

@Post('auth/step-up/verify')
@UseGuards(EndUserAuthGuard)
@Throttle({ default: { ttl: 60_000, limit: 10 } })
async verifyStepUp(
  @CurrentEndUser() user: AuthedEndUser,
  @Body() dto: VerifyMemberStepUpDto,
) {
  return ApiResponse.ok(await this.stepUp.verifyChallenge(user.endUserId, dto))
}
```

- [ ] HTTP 测试断言普通 token 必需、响应不含手机号/验证码、错误 envelope 不泄露账号存在性。
- [ ] 运行：

```bash
PAYMENT_PROVIDER=disabled pnpm --filter @ai-job-print/api verify:member-step-up
PAYMENT_PROVIDER=disabled pnpm --filter @ai-job-print/api verify:member-auth
pnpm --filter @ai-job-print/api lint
pnpm --filter @ai-job-print/api typecheck
```

- [ ] Commit：

```bash
git add services/api/src/member-auth/member-auth.controller.ts services/api/scripts/verify-member-step-up.ts
git commit -m "feat: expose guarded member step-up endpoints"
```

## Task 8: CI、迁移与安全复审

**Files:**

- Modify: `docs/progress/current-progress.md`
- Modify: `docs/progress/next-tasks.md`
- Modify: `.github/workflows/ci.yml`

- [ ] CI Verify suites 按顺序加入：

```yaml
pnpm --filter @ai-job-print/api verify:member-account-status
pnpm --filter @ai-job-print/api verify:member-step-up
```

- [ ] PostgreSQL readiness 也运行这两个 verify，确保不是只在 SQLite 通过。
- [ ] 新建 fresh SQLite 重放全部 migration，运行 auth/status/step-up。
- [ ] 运行全套：

```bash
pnpm --filter @ai-job-print/shared typecheck
pnpm --filter @ai-job-print/api db:pg:sync:check
PAYMENT_PROVIDER=disabled pnpm --filter @ai-job-print/api verify:member-account-status
PAYMENT_PROVIDER=disabled pnpm --filter @ai-job-print/api verify:member-step-up
PAYMENT_PROVIDER=disabled pnpm --filter @ai-job-print/api verify:member-auth
PAYMENT_PROVIDER=disabled pnpm --filter @ai-job-print/api verify:member-qr-login
pnpm --filter @ai-job-print/api lint
pnpm --filter @ai-job-print/api typecheck
pnpm --filter @ai-job-print/api build
git diff --check origin/main...HEAD
```

- [ ] 用两个并发请求消费同一 step-up grant，断言恰好一个成功。
- [ ] 扫描日志/审计/Redis fixture，确认没有 6 位验证码、明文手机号、step-up token。
- [ ] Claude + Antigravity 并行安全复审：Redis Lua key 隔离、token replay、action confusion、状态双轨、session 横向删除、migration 回滚。
- [ ] Critical/High 修完后重跑全部门禁。
- [ ] 文档只记录“账户安全底座完成”；数据导出、注销和 UI 仍标未完成。
- [ ] Commit：

```bash
git add .github/workflows/ci.yml docs/progress/current-progress.md docs/progress/next-tasks.md
git commit -m "test: gate member account security in ci"
```

## 完成定义

- 新老字段并存，旧 disabled 用户正确回填；无破坏式 schema 变更。
- `enabled=false` 或 `status!=active` 都不能登录/访问。
- 每个会员所有 session 可原子撤销且不影响其他会员。
- step-up challenge 和 grant 均短时、单次、user+action 绑定。
- Redis/日志/数据库不存明文验证码、手机号或 grant token。
- 普通会员登录/QR 登录、logout 和会话失效回归全绿。
- Kiosk/Admin 尚未展示数据导出/注销入口，避免后端底座尚未闭环时提前开放。
