# Partner Account Dual-Auth Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Admin 合作机构账号的移除和手机号换绑收紧为“Admin 近期验证 + 目标账号旧手机验证码或合格当前密码”的单次、操作绑定安全流程。

**Architecture:** 保留 `AdminOrgsService` 已有的墓碑删除和 PostgreSQL Serializable 最后账号保护，新建聚合服务编排 challenge/action ticket/rebind ticket，并用独立 Redis 服务的 Lua 完成原子替换、验证、撤销、消费和机构锁。Admin 前端保留原入口，把长流程拆为纯 reducer、副作 hook 和焦点受控弹窗；不新增页面、菜单或第二套账号管理入口。

**Tech Stack:** NestJS 11, Prisma 7, SQLite/PostgreSQL, Redis/ioredis + Lua, React 18, TypeScript 5.7, Vite, Node 22 test runner / 现有 verify 脚本, pnpm.

---

## 实施边界与文件预算

**真实闭环：** Admin 在现有机构详情抽屉中，经 Admin 本人密码和目标 Partner 旧因子授权后，安全移除账号或验证新手机号并换绑。

**允许修改：**

- `services/api/prisma/` 与 `services/api/prisma/postgres/` 对称 schema/migration。
- `services/api/src/auth/` 的 OTP purpose、全局冷却、锁定与密码来源状态写入。
- `services/api/src/common/redis/` 的独立 Partner 账号操作原子状态服务。
- `services/api/src/orgs/` 的新 action DTO/service/controller 以及对已有删除入口的最小接线。
- `services/api/scripts/`、`apps/admin/scripts/`、两个 `package.json` 与 `.github/workflows/ci.yml` 的专项门禁。
- `apps/admin/src/services/api/orgsAdmin.ts` 与 `apps/admin/src/routes/partners/` 现有账号管理流程。
- `docs/progress/current-progress.md`、`docs/progress/next-tasks.md` 和本任务的设计/实施/审查文档。

**禁止修改：** Kiosk、Partner 新入口、Worker、Terminal Agent、支付、打印扫描、岗位招聘会、生产配置、密钥和真实账号数据。本计划不执行生产 migration、不发送真实短信、不 push 或部署。

**大文件约束：** `AdminOrgsService` 已有 792 行、`AuthService` 551 行、`RedisService` 497 行，只做原子字段写入/常量引用/接口移除等最小改动；不将新业务逻辑继续堆入这三个文件。

## 契约锁定

```ts
export type PartnerAccountAction = 'delete_account' | 'rebind_phone';
export type PartnerAccountVerificationMethod = 'sms' | 'password';
export type PasswordProofState = 'legacy' | 'temporary' | 'owner_managed';

export interface ActionChallengeBinding {
  challengeId: string;
  adminId: string;
  adminTokenVersion: number;
  orgId: string;
  partnerId: string;
  partnerTokenVersion: number;
  action: PartnerAccountAction;
  verifyMethod: PartnerAccountVerificationMethod;
  phoneHash?: string;
  otpPurpose?: 'partner_account_delete' | 'partner_phone_rebind_authorize';
}

export interface ActionTicketBinding {
  adminId: string;
  adminTokenVersion: number;
  orgId: string;
  partnerId: string;
  partnerTokenVersion: number;
  action: PartnerAccountAction;
}

export interface RebindTicketBinding extends ActionTicketBinding {
  action: 'rebind_phone';
  newPhoneHash: string;
  newPhoneEnc: string;
  phoneMasked: string;
}

export interface OtpRequestContext { ip: string; deviceId?: string }
export interface TicketScope {
  adminId: string;
  orgId: string;
  partnerId: string;
  action: PartnerAccountAction;
}
export interface ChallengeScope extends TicketScope { challengeId: string }
export interface CreateChallengeResponse {
  challengeId: string;
  action: PartnerAccountAction;
  verifyMethod: PartnerAccountVerificationMethod;
  phoneMasked?: string;
  availableMethods: PartnerAccountVerificationMethod[];
  expiresInSeconds: 300;
  cooldownSeconds: number;
}
export interface StartRebindResponse {
  rebindTicket: string;
  phoneMasked: string;
  expiresInSeconds: 300;
  cooldownSeconds: 60;
}
export interface ResendRebindResponse {
  phoneMasked: string;
  expiresInSeconds: number;
  cooldownSeconds: 60;
}

export interface PasswordChallengeConsumeInput {
  scope: ChallengeScope;
  challenge: ActionChallengeBinding;
  actionTicketHash: string;
  actionTicketBinding: ActionTicketBinding;
  ticketTtlSeconds: 90;
}
export interface SmsChallengeConsumeInput extends PasswordChallengeConsumeInput {
  otp: { codeKey: string; attemptKey: string; lockedKey: string; submittedCode: string; maxAttempts: 5; lockSeconds: 300 };
}
export interface DeleteTicketConsumeInput {
  actionTicketHash: string;
  scope: TicketScope & { action: 'delete_account' };
  requestId: string;
  lockSeconds: 60;
}
export interface RebindStartConsumeInput {
  actionTicketHash: string;
  scope: TicketScope & { action: 'rebind_phone' };
  rebindTicketHash: string;
  rebindBinding: RebindTicketBinding;
  rebindTtlSeconds: 300;
}
export interface RebindSmsConsumeInput {
  rebindTicketHash: string;
  scope: TicketScope & { action: 'rebind_phone' };
  otp: SmsChallengeConsumeInput['otp'];
}
```

全部 bearer ticket 用 `randomBytes(32).toString('base64url')` 生成，Redis key 只使用 `sha256(ticket)`；action ticket 只出现在 `X-Account-Action-Ticket`，rebind ticket 只出现在 `X-Phone-Rebind-Ticket`。两者不进 URL、业务日志、toast、DOM 属性或持久化存储。

### Task 1: 锁定基线与 RED 专项门禁

**Files:**
- Modify: `services/api/package.json`
- Modify: `apps/admin/package.json`
- Create: `services/api/scripts/verify-partner-account-action-schema.ts`
- Create: `services/api/scripts/verify-partner-account-action-redis.ts`
- Create: `services/api/scripts/verify-partner-account-action.ts`
- Create: `services/api/scripts/verify-partner-account-action-postgres.ts`
- Create: `apps/admin/scripts/verify-partner-account-action-ui.mjs`

- [ ] **Step 1: 记录 Wave 0 只读基线**

Run:

```bash
git merge-base --is-ancestor e2b8db7f HEAD; test $? -eq 1
test -f services/api/prisma/migrations/20260716193000_add_partner_account_tombstone/migration.sql
test -f services/api/prisma/postgres/migrations/20260716193000_add_partner_account_tombstone/migration.sql
shasum -a 256 services/api/prisma/migrations/20260716193000_add_partner_account_tombstone/migration.sql services/api/prisma/postgres/migrations/20260716193000_add_partner_account_tombstone/migration.sql
pnpm --filter @ai-job-print/api verify:admin-orgs
pnpm --filter @ai-job-print/api verify:admin-orgs-delete-concurrency
pnpm --filter @ai-job-print/api verify:admin-orgs-delete-schema
pnpm --filter @ai-job-print/admin verify:partner-account-delete-ui
```

Expected: `e2b8db7f` 非当前祖先，但两个墓碑 migration 文件存在，checksum 分别为 `71fe121a291d26883dbd0b0ae80cabd3a05275522fdd9acffa5f84cd6e811c7e` 和 `e693378deab80ec5c0cdd06af3489f5ee982d2a10fee4ca79860157a21c2a2ad`，4 个已有门禁全部 PASS。任一文件缺失或 checksum 不符立即停止并重新审查基线；不 cherry-pick `e2b8db7f`。

- [ ] **Step 2: 先写新专项脚本的失败断言**

`verify-partner-account-action-schema.ts` 必须断言两库 `passwordProofState String @default("legacy")` 和全新对称 migration；`verify-partner-account-action-redis.ts` 必须使用真实 Redis 覆盖 active 替换、并发唯一签票、比较撤销、票据+机构锁原子消费和 requestId 安全解锁；HTTP 脚本必须断言无票据 DELETE 返回 `403 ACCOUNT_ACTION_STEP_UP_REQUIRED`。

```ts
assert.equal(await deleteWithoutTicket(), 'ACCOUNT_ACTION_STEP_UP_REQUIRED');
assert.equal(await useDeleteTicketForRebind(), 'ACCOUNT_ACTION_TICKET_STALE');
assert.equal((await Promise.all([verifyOnce(), verifyOnce()])).filter(Boolean).length, 1);
assert.equal(await canUseTemporaryPassword(), false);
```

Admin UI 脚本要解析源文件并断言：纯 reducer 无跨 action 跳转、密码/OTP 不持久化、最终 DELETE 只通过 header 携带 ticket、弹窗包含 focus trap/恢复和 `aria-live`。

- [ ] **Step 3: 注册精确脚本名并证明 RED**

```json
{
  "verify:partner-account-action:schema": "node -r @swc-node/register scripts/verify-partner-account-action-schema.ts",
  "verify:partner-account-action:redis": "node -r @swc-node/register scripts/verify-partner-account-action-redis.ts",
  "verify:partner-account-action": "node -r @swc-node/register scripts/verify-partner-account-action.ts",
  "verify:partner-account-action:postgres": "node -r @swc-node/register scripts/verify-partner-account-action-postgres.ts"
}
```

Admin 脚本名为 `verify:partner-account-action-ui`。Run:

```bash
pnpm --filter @ai-job-print/api verify:partner-account-action:schema
pnpm --filter @ai-job-print/api verify:partner-account-action
pnpm --filter @ai-job-print/admin verify:partner-account-action-ui
```

Expected: 依次因 schema 字段不存在、action route 不存在、UI 状态机不存在而 FAIL；失败原因必须指向目标行为，不能是脚本语法或环境错误。

- [ ] **Step 4: 提交 RED 门禁**

```bash
git add services/api/package.json apps/admin/package.json services/api/scripts/verify-partner-account-action-schema.ts services/api/scripts/verify-partner-account-action-redis.ts services/api/scripts/verify-partner-account-action.ts services/api/scripts/verify-partner-account-action-postgres.ts apps/admin/scripts/verify-partner-account-action-ui.mjs
git commit -m "test: define partner account action security gates"
```

### Task 2: 双库密码证明状态与凭据版本

**Files:**
- Modify: `services/api/prisma/schema.prisma`
- Modify: `services/api/prisma/postgres/schema.prisma`
- Create: `services/api/prisma/migrations/20260718143000_add_partner_password_proof_state/migration.sql`
- Create: `services/api/prisma/postgres/migrations/20260718143000_add_partner_password_proof_state/migration.sql`
- Create: `services/api/src/auth/password-proof-state.ts`
- Create: `services/api/src/common/constants/internal-session.constants.ts`
- Create: `services/api/src/orgs/admin-org-account-view.ts`
- Modify: `services/api/src/common/guards/jwt-auth.guard.ts`
- Modify: `services/api/src/auth/auth.service.ts`
- Modify: `services/api/src/orgs/admin-orgs.service.ts`
- Modify: `services/api/prisma/seed.ts`
- Modify: `services/api/scripts/verify-admin-orgs-delete-schema.ts`
- Modify: `services/api/scripts/verify-change-password.ts`

- [ ] **Step 1: 扩展 RED 断言**

先确认 `JwtAuthGuard` 中已有私有 `INTERNAL_SESSION_CACHE_TTL_SECONDS = 60`；本任务是把该已有常量移到 `services/api/src/common/constants/internal-session.constants.ts` 并让 Guard/Auth/AdminOrgs 共享，不是新建第二个不关联的 TTL。

```ts
assert.equal(created.passwordProofState, 'temporary');
assert.equal(reset.passwordProofState, 'temporary');
assert.equal(changed.passwordProofState, 'owner_managed');
assert.equal(recovered.passwordProofState, 'owner_managed');
assert.equal(changed.tokenVersion, before.tokenVersion + 1);
```

Run: `pnpm --filter @ai-job-print/api verify:admin-orgs-delete-schema && pnpm --filter @ai-job-print/api verify:change-password`

Expected: FAIL，缺少 `passwordProofState`。

- [ ] **Step 2: 增加对称 schema 和新 migration**

```prisma
passwordProofState String @default("legacy")
```

SQLite/PostgreSQL migration 必须是相同语义：

```sql
ALTER TABLE "User" ADD COLUMN "passwordProofState" TEXT NOT NULL DEFAULT 'legacy'
  CHECK ("passwordProofState" IN ('legacy', 'temporary', 'owner_managed'));
```

不修改任何已存在 migration。Run: `pnpm --filter @ai-job-print/api db:pg:sync:check`。Expected: PASS。

- [ ] **Step 3: 以单次原子 update 维护状态**

```ts
export const PASSWORD_PROOF_STATE = {
  LEGACY: 'legacy',
  TEMPORARY: 'temporary',
  OWNER_MANAGED: 'owner_managed',
} as const;
export type PasswordProofState = (typeof PASSWORD_PROOF_STATE)[keyof typeof PASSWORD_PROOF_STATE];

export const INTERNAL_SESSION_CACHE_TTL_SECONDS = 60;
```

`createOrg`/`createAccount`/`resetAccountPassword` 和 `seed.ts` 中任何 Admin 可知密码写入均写 `temporary`；`changePassword`/`completePasswordReset` 在与 `passwordHash` 和 `tokenVersion: { increment: 1 }` 同一个 update/updateMany 中写 `owner_managed`。每个写入值用 `satisfies PasswordProofState` 或类型化 helper 限制，不把 SQLite `CHECK` 当作唯一防线。墓碑删除写 `temporary`，并把 `JwtAuthGuard`、凭据变更和删除会话发布 TTL 统一引用共享常量。`AdminOrgAccount` 类型、map/select 和可用验证方式计算移入 `admin-org-account-view.ts`，避免 792 行的 service 越过 800 行红线。

- [ ] **Step 4: 生成 Prisma client 并跑 GREEN**

```bash
pnpm --filter @ai-job-print/api exec prisma generate
pnpm --filter @ai-job-print/api db:pg:generate
pnpm --filter @ai-job-print/api verify:partner-account-action:schema
pnpm --filter @ai-job-print/api verify:admin-orgs
pnpm --filter @ai-job-print/api verify:change-password
pnpm --filter @ai-job-print/api typecheck
```

Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add services/api/prisma services/api/src/auth/password-proof-state.ts services/api/src/common/constants/internal-session.constants.ts services/api/src/common/guards/jwt-auth.guard.ts services/api/src/auth/auth.service.ts services/api/src/orgs/admin-org-account-view.ts services/api/src/orgs/admin-orgs.service.ts services/api/scripts/verify-admin-orgs-delete-schema.ts services/api/scripts/verify-change-password.ts
git commit -m "feat: track partner password proof state"
```

### Task 3: Redis 原子 challenge/ticket 状态层

**Files:**
- Create: `services/api/src/common/redis/partner-account-action-redis.types.ts`
- Create: `services/api/src/common/redis/partner-account-action-redis.service.ts`
- Modify: `services/api/src/common/redis/redis.module.ts`
- Modify: `services/api/scripts/verify-partner-account-action-redis.ts`

- [ ] **Step 1: 用真 Redis 写完整 RED 测试**

使用唯一 test namespace，每个 case 在 `finally` 中删除它自己的 key。必须覆盖下列结果枚举：

```ts
type ChallengeConsumeResult = 'consumed' | 'unavailable' | 'credential_invalid' | 'credential_locked';
type TicketLockResult =
  | { kind: 'acquired'; binding: ActionTicketBinding }
  | { kind: 'conflict' }
  | { kind: 'missing_or_scope_mismatch' };
```

Run: `REDIS_URL=redis://127.0.0.1:6379 pnpm --filter @ai-job-print/api verify:partner-account-action:redis`

Expected: FAIL，因 `PartnerAccountActionRedisService` 不存在。

- [ ] **Step 2: 实现聚合原子方法**

```ts
replaceChallenge(binding: ActionChallengeBinding, ttlSeconds: number): Promise<void>;
consumePasswordChallenge(input: PasswordChallengeConsumeInput): Promise<ChallengeConsumeResult>;
consumeSmsChallenge(input: SmsChallengeConsumeInput): Promise<ChallengeConsumeResult>;
cancelChallenge(scope: ChallengeScope): Promise<void>;
revokeActionTicket(ticket: string, scope: TicketScope): Promise<void>;
consumeDeleteTicketAndAcquireLock(input: DeleteTicketConsumeInput): Promise<TicketLockResult>;
releaseCommitLock(orgId: string, requestId: string): Promise<void>;
consumeActionTicketForRebind(input: RebindStartConsumeInput): Promise<ActionTicketBinding | null>;
consumeRebindSmsTicket(input: RebindSmsConsumeInput): Promise<ChallengeConsumeResult>;
revokeRebindTicket(ticket: string, scope: TicketScope): Promise<void>;
setAdminRecentVerification(adminId: string, tokenVersion: number): Promise<void>;
getAdminRecentVerification(adminId: string): Promise<number | null>;
recordPasswordFailure(subject: 'admin' | 'partner', id: string): Promise<'retry' | 'locked'>;
clearPasswordFailures(subject: 'admin' | 'partner', id: string): Promise<void>;
clearAdminRecentVerification(adminId: string): Promise<void>;
```

所有多 key 状态转移均在该服务的 Lua 中完成；不扩大 497 行的通用 `RedisService`。取消必须比较 active 指针，撤销必须比较 scope，锁冲突不消费 ticket，解锁必须比较 requestId。

- [ ] **Step 3: 在 RedisModule 注册并导出**

```ts
providers: [REDIS_CLIENT_PROVIDER, RedisService, MemberDataExportRedisService, PartnerAccountActionRedisService],
exports: [RedisService, MemberDataExportRedisService, PartnerAccountActionRedisService],
```

- [ ] **Step 4: 跑并发 GREEN 和类型检查**

```bash
REDIS_URL=redis://127.0.0.1:6379 pnpm --filter @ai-job-print/api verify:partner-account-action:redis
pnpm --filter @ai-job-print/api typecheck
```

Expected: 并发正确验证只一个 `consumed`；锁冲突后重试仍能消费原 ticket；错 requestId 不能解锁；全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add services/api/src/common/redis/partner-account-action-redis.types.ts services/api/src/common/redis/partner-account-action-redis.service.ts services/api/src/common/redis/redis.module.ts services/api/scripts/verify-partner-account-action-redis.ts
git commit -m "feat: add atomic partner account action state"
```

### Task 4: OTP 全局冷却、失败锁定与三种隔离 purpose

**Files:**
- Create: `services/api/src/auth/internal-otp.types.ts`
- Modify: `services/api/src/auth/internal-otp.service.ts`
- Modify: `services/api/src/auth/auth.module.ts`
- Modify: `services/api/scripts/verify-admin-phone-transfer.ts`
- Modify: `services/api/scripts/verify-internal-auth-phone.ts`

- [ ] **Step 1: 先把已有“purpose 可绕过冷却”断言反转为 RED**

```ts
await otp.sendCode({ purpose: 'bind_phone', phone, ...context });
await assert.rejects(
  otp.sendCode({ purpose: 'transfer_phone', phone, ...context }),
  (error) => apiCode(error) === 'SMS_SEND_TOO_FREQUENT',
);
```

新增全部 7 个 purpose 的共享手机日限额、IP 时限额、设备时限额和 60 秒全局冷却断言。对同一 code 错 5 次后，正确 code 也必须返回 `ACCOUNT_CREDENTIAL_LOCKED`；重新发送不能清除 300 秒锁定。

- [ ] **Step 2: 改为单一全局冷却 key 并保留 purpose 内容隔离**

```ts
export type InternalOtpPurpose =
  | 'login'
  | 'reset_password'
  | 'bind_phone'
  | 'transfer_phone'
  | 'partner_account_delete'
  | 'partner_phone_rebind_authorize'
  | 'partner_phone_rebind_new';

const cooldownRequestId = randomBytes(16).toString('base64url');
const globalCooldownKey = `internal:sms:cooldown:global:${phoneHash}`;
const codeKey = `internal:sms:code:${purpose}:${phoneHash}`;
const lockedKey = `internal:sms:locked:${purpose}:${phoneHash}`;
```

`sendCode` 先查 `lockedKey`，再以 `SET globalCooldownKey cooldownRequestId NX EX 60` 保留全局冷却；不再用 purpose 分桶冷却。短信 provider 失败时使用 `getAndDelIfEquals(globalCooldownKey, cooldownRequestId)` 释放本请求占用的全局冷却，不能删除后来请求的 key；手机/IP/设备额度按已有保留/释放语义收敛。`verifyCode` 在第 5 次失败时写入 300 秒 lock 并删除 code，但不删除 lock；每次验证先查 lock。对 action SMS 原子消费提供只读 key/hash descriptor，明文 code 不进 Redis action binding。

- [ ] **Step 3: 导出 InternalOtpService 供 OrgsModule 使用**

```ts
exports: [JwtModule, InternalJwtGuard, RolesGuard, AuthService, InternalOtpService],
```

- [ ] **Step 4: 跑新旧 GREEN**

```bash
INTERNAL_AUTH_VERIFY_TARGET=isolated pnpm --filter @ai-job-print/api verify:internal-auth-phone
INTERNAL_AUTH_VERIFY_TARGET=isolated pnpm --filter @ai-job-print/api verify:admin-phone-transfer
pnpm --filter @ai-job-print/api typecheck
```

Expected: 两个旧 purpose 不再能在 60 秒内交叉发送；7 purpose 内容仍互不可消费；5 次锁定断言 PASS。

- [ ] **Step 5: 提交**

```bash
git add services/api/src/auth/internal-otp.types.ts services/api/src/auth/internal-otp.service.ts services/api/src/auth/auth.module.ts services/api/scripts/verify-admin-phone-transfer.ts services/api/scripts/verify-internal-auth-phone.ts
git commit -m "fix: enforce global otp cooldown and lockout"
```

### Task 5: 后端 challenge、强制票据删除与换绑编排

**Files:**
- Create: `services/api/src/orgs/dto/partner-account-action.dto.ts`
- Create: `services/api/src/orgs/partner-account-action.service.ts`
- Create: `services/api/src/orgs/partner-phone-rebind.service.ts`
- Create: `services/api/src/orgs/partner-account-action.controller.ts`
- Modify: `services/api/src/orgs/admin-orgs.controller.ts`
- Modify: `services/api/src/orgs/admin-orgs.service.ts`
- Modify: `services/api/src/orgs/orgs.module.ts`
- Modify: `services/api/src/auth/auth.controller.ts`
- Modify: `apps/admin/src/services/auth/index.ts`
- Modify: `services/api/scripts/verify-partner-account-action.ts`
- Modify: `services/api/scripts/verify-partner-account-action-postgres.ts`
- Modify: `services/api/scripts/verify-admin-orgs.ts`

- [ ] **Step 1: 用 HTTP 门禁写完 RED 矩阵**

```ts
await expectCode(deleteAccount({ ticket: undefined }), 403, 'ACCOUNT_ACTION_STEP_UP_REQUIRED');
await expectCode(verifyPassword({ proofState: 'temporary' }), 409, 'ACCOUNT_PASSWORD_PROOF_NOT_READY');
await expectCode(useTicket({ action: 'delete_account', endpoint: 'phone-rebind/start' }), 409, 'ACCOUNT_ACTION_TICKET_STALE');
await expectCode(replayConsumedTicket(), 403, 'ACCOUNT_ACTION_STEP_UP_REQUIRED');
await expectCode(useTicketAfterTokenVersionChange(), 409, 'ACCOUNT_ACTION_TICKET_STALE');
```

必须另覆盖 Admin/org/account/action 交叉使用、`legacy/temporary/owner_managed`、Admin/Partner 5 次密码锁定、challenge/action/rebind 撤销幂等、`PHONE_TAKEN`、无效 422 不触发 401 登出。

Admin 密码在 `createChallenge` 中连续 5 次失败后，即使第 6 次提交正确密码也必须返回 `429 ADMIN_CREDENTIAL_LOCKED`；只有锁定 TTL 过期后才能重试。Partner 密码同样在第 5 次失败时锁定。密码成功且近期验证/challenge 已原子写入后才清空对应失败计数。

- [ ] **Step 2: 实现联合 DTO 边界**

```ts
export class CreatePartnerAccountActionChallengeDto {
  @IsIn(['delete_account', 'rebind_phone']) action!: PartnerAccountAction;
  @IsIn(['sms', 'password']) verifyMethod!: PartnerAccountVerificationMethod;
  @IsOptional() @IsString() @MinLength(8) @MaxLength(128) adminCurrentPassword?: string;
}

export class VerifyPartnerAccountActionChallengeDto {
  @IsOptional() @Matches(/^\d{6}$/) code?: string;
  @IsOptional() @IsString() @MinLength(8) @MaxLength(128) currentPassword?: string;
}
```

服务在任何 Redis/DB 查询前断言“短信挑战只接受 code，密码挑战只接受 currentPassword”，同时提交两者或两者都不提交均返回 400，绝不忽略多余敏感字段。

- [ ] **Step 3: 实现 PartnerAccountActionService**

```ts
createChallenge(admin: AuthedUser, orgId: string, partnerId: string, dto: CreatePartnerAccountActionChallengeDto, context: OtpRequestContext): Promise<CreateChallengeResponse>;
verifyChallenge(admin: AuthedUser, orgId: string, partnerId: string, challengeId: string, dto: VerifyPartnerAccountActionChallengeDto): Promise<{ actionTicket: string; expiresInSeconds: 90 }>;
cancelChallenge(admin: AuthedUser, orgId: string, partnerId: string, challengeId: string): Promise<void>;
revokeActionTicket(admin: AuthedUser, orgId: string, partnerId: string, ticket: string): Promise<void>;
deleteAccount(admin: AuthedUser, orgId: string, partnerId: string, ticket: string | undefined): Promise<{ success: true }>;
startPhoneRebind(admin: AuthedUser, orgId: string, partnerId: string, ticket: string | undefined, newPhone: string, context: OtpRequestContext): Promise<StartRebindResponse>;
resendNewPhone(admin: AuthedUser, orgId: string, partnerId: string, rebindTicket: string | undefined, context: OtpRequestContext): Promise<ResendRebindResponse>;
verifyPhoneRebind(admin: AuthedUser, orgId: string, partnerId: string, rebindTicket: string | undefined, code: string): Promise<{ success: true }>;
revokeRebindTicket(admin: AuthedUser, orgId: string, partnerId: string, rebindTicket: string | undefined): Promise<void>;
```

每个公开方法都先从 DB 重读 Admin 和 Partner，校验 role/org/deletedAt/enabled/tokenVersion。创建挑战时以 `phoneVerifiedAt && phoneHash` 计算 SMS 可用性，以 `passwordProofState === 'owner_managed'` 计算密码可用性。Admin 近期验证绑定 DB `tokenVersion`，不信 Redis 快照。

删除路径：原子消费 ticket + 以 `SET NX EX 60` 获取 org lock → 以 ticket 返回的绑定版本复核 DB → 调用 `AdminOrgsService.deleteAccount(orgId, partnerId, admin, { adminTokenVersion, partnerTokenVersion })`，该方法在 Serializable 事务内再次比较双版本 → `finally` 比较 requestId 解锁。只有锁冲突不消费 ticket；其他结果不恢复 ticket。Redis 连接/Lua 执行失败必须 fail closed，不得绕过机构锁直接进入 DB 删除事务。

换绑细节下沉到 `PartnerPhoneRebindService`：`start` 消费 `rebind_phone` action ticket，规范化/加密/哈希新手机号，创建 rebind ticket 并发送新 purpose OTP；`phoneMasked` 必须由 `decryptPhone(newPhoneEnc)` 后的规范化值计算，并在测试中与最终账号脱敏号码相等。`verify` 原子消费 OTP + rebind ticket，在 Serializable 事务内重读版本和唯一性，写 `phoneHash/phoneEnc/phoneVerifiedAt/tokenVersion+1`，捕获 Prisma `P2002` 返回 `PHONE_TAKEN`，提交后发布高版本会话。两个 service 均保持低于 400 行。

`AuthController` 新增受 `JwtAuthGuard` 保护的 `POST /auth/logout`：Admin 调用 `clearAdminRecentVerification(user.userId)`，Partner 仅返回 `{ loggedOut: true }`。JSDoc 必须明确“只撤销近期高风险验证，不会服务端撤销无 jti 的当前 JWT”。Admin 前端 `logout()` 先捕获当前 bearer token 并 best-effort 发送该请求，再立即执行现有 `clearAuth()`；网络失败不阻止本地退出。

- [ ] **Step 4: 用专用 controller 收紧路由**

`PartnerAccountActionController` 承担 9 个 action/rebind 路由和最终 DELETE，从已有 `AdminOrgsController` 移除无票据 DELETE handler，避免重复路由。票据用 `@Headers('x-account-action-ticket')` 或 `@Headers('x-phone-rebind-ticket')` 获取，不放 DTO/body。`OrgsModule` 注册新 service/controller。“注册新 controller + 删除旧 DELETE handler + 无票据 fail-closed 门禁”必须在同一 commit 完成，不得出现双路由或过渡性无票据窗口。

- [ ] **Step 5: DTO 只暴露可用方式**

```ts
availableActionVerificationMethods: [
  ...(account.phoneHash && account.phoneVerifiedAt ? ['sms' as const] : []),
  ...(account.passwordProofState === 'owner_managed' ? ['password' as const] : []),
]
```

不返回 `passwordProofState`、`phoneHash`、`phoneEnc` 或完整手机号。

- [ ] **Step 6: 跑 SQLite/Redis GREEN**

```bash
pnpm --filter @ai-job-print/api verify:partner-account-action
REDIS_URL=redis://127.0.0.1:6379 pnpm --filter @ai-job-print/api verify:partner-account-action:redis
pnpm --filter @ai-job-print/api verify:admin-orgs
pnpm --filter @ai-job-print/api verify:internal-auth-phone
pnpm --filter @ai-job-print/api typecheck
```

Expected: 全部 PASS；无票据 DELETE 已 fail closed。

- [ ] **Step 7: 跑 PostgreSQL 16 + Redis 真并发门禁**

```bash
INTERNAL_AUTH_VERIFY_TARGET=isolated \
DATABASE_URL=postgresql://ci:ci@127.0.0.1:5432/ai_job_print_ci \
POSTGRES_URL=postgresql://ci:ci@127.0.0.1:5432/ai_job_print_ci \
REDIS_URL=redis://127.0.0.1:6379 \
pnpm --filter @ai-job-print/api verify:partner-account-action:postgres
```

Expected: 两个有效 Partner 并发删除最终仍有 1 个有效账号；锁冲突不消费 ticket；新手机号竞态由 `P2002` 收敛为 `PHONE_TAKEN`。

- [ ] **Step 8: 提交**

```bash
git add services/api/src/orgs services/api/scripts/verify-partner-account-action.ts services/api/scripts/verify-partner-account-action-postgres.ts services/api/scripts/verify-admin-orgs.ts
git commit -m "feat: require scoped verification for partner account actions"
```

### Task 6: Admin API 适配器与纯状态机

**Files:**
- Modify: `apps/admin/src/services/api/orgsAdmin.ts`
- Create: `apps/admin/src/routes/partners/partnerAccountActionMachine.ts`
- Create: `apps/admin/src/routes/partners/partnerAccountActionMachine.test.ts`
- Modify: `apps/admin/scripts/verify-partner-account-action-ui.mjs`

- [ ] **Step 1: 先写 reducer RED 测试**

```ts
assert.equal(reduce(confirmState, { type: 'COMMIT_DELETE' }).step, 'confirm');
assert.equal(reduce(deleteTicketState, { type: 'SWITCH_ACTION', action: 'rebind_phone' }).actionTicket, undefined);
assert.equal(reduce(rebindTicketState, { type: 'REBIND_EXPIRED' }).step, 'confirm_rebind');
assert.equal(reduce(busyState, { type: 'SUBMIT' }), busyState);
assert.equal(reduce(credentialState, { type: 'ERROR', code: 'ACCOUNT_CREDENTIAL_INVALID' }).step, credentialState.step);
assert.equal(reduce(ticketState, { type: 'ERROR', code: 'ACCOUNT_ACTION_TICKET_STALE' }).step, 'confirm');
```

Run: `node --experimental-strip-types --test apps/admin/src/routes/partners/partnerAccountActionMachine.test.ts`

Expected: FAIL，模块不存在。

- [ ] **Step 2: 实现无副作不可变 reducer**

```ts
export type PartnerAccountActionStep =
  | 'closed' | 'confirm' | 'confirm_rebind' | 'choose_method' | 'admin_reauth'
  | 'sms_verify' | 'password_verify' | 'new_phone_input' | 'new_phone_sms_verify'
  | 'delete_committing' | 'rebind_committing' | 'success';

export function reducePartnerAccountAction(
  state: Readonly<PartnerAccountActionState>,
  event: Readonly<PartnerAccountActionEvent>,
): PartnerAccountActionState {
  if (state.busy && event.type !== 'REQUEST_FINISHED') return state;
  return transition(state, event);
}
```

ticket/challenge 过期时只通过显式 event 转移，不根据当前页面推断 action。切换 action/method、关闭、成功、终态错误都返回新 state 并清空敏感字段，不原地 mutate。

- [ ] **Step 3: 扩展 API 联合类型和 header 适配**

```ts
export type PartnerAccountAction = 'delete_account' | 'rebind_phone';
export type PartnerAccountVerificationMethod = 'sms' | 'password';

export interface AdminOrgAccount {
  // existing fields remain unchanged
  availableActionVerificationMethods: PartnerAccountVerificationMethod[];
}

deleteAccount(orgId: string, accountId: string, actionTicket: string): Promise<void>;
startPhoneRebind(orgId: string, accountId: string, actionTicket: string, newPhone: string): Promise<StartRebindResponse>;
```

`req` 接受 `RequestInit`，HTTP adapter 仅在 headers 中携带 ticket。Mock adapter 与 HTTP adapter 实现同一接口，用模块内存的 action/target 绑定单次 ticket 模拟契约，明确标注为演示行为，不伪装真实安全强度。

- [ ] **Step 4: 跑 reducer 与 adapter GREEN**

```bash
node --experimental-strip-types --test apps/admin/src/routes/partners/partnerAccountActionMachine.test.ts
pnpm --filter @ai-job-print/admin verify:partner-account-action-ui
pnpm --filter @ai-job-print/admin typecheck
```

Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/admin/src/services/api/orgsAdmin.ts apps/admin/src/routes/partners/partnerAccountActionMachine.ts apps/admin/src/routes/partners/partnerAccountActionMachine.test.ts apps/admin/scripts/verify-partner-account-action-ui.mjs
git commit -m "feat: add partner account action client state machine"
```

### Task 7: Admin 受控弹窗、换绑与移除交互

**Files:**
- Create: `apps/admin/src/routes/partners/usePartnerAccountAction.ts`
- Create: `apps/admin/src/routes/partners/PartnerAccountActionDialog.tsx`
- Create: `apps/admin/src/routes/partners/PartnerAccountDeleteConfirmationDialog.tsx`
- Create: `apps/admin/src/routes/partners/PartnerAccountActionCredentialSteps.tsx`
- Create: `apps/admin/src/routes/partners/PartnerAccountPhoneRebindSteps.tsx`
- Modify: `apps/admin/src/routes/partners/PartnerAccountManager.tsx`
- Delete: `apps/admin/src/routes/partners/PartnerAccountDeletionDialog.tsx`
- Modify: `apps/admin/scripts/verify-partner-account-action-ui.mjs`

- [ ] **Step 1: 扩展 UI RED 为行为与无障碍矩阵**

```js
assertSourceContains('role="dialog"');
assertDeleteConfirmationContains('role="alertdialog"');
assertSourceContains('aria-busy={state.busy}');
assertSourceContains('autoComplete="one-time-code"');
assertSourceContains('inputMode="numeric"');
assertNoSensitivePersistence(['localStorage', 'sessionStorage', 'data-ticket', 'actionTicket=']);
```

脚本还必须断言 focus trap/restore、busy 时 Escape 不关闭、15 秒提示只播报一次、迟到响应核对 flow ID、网络/5xx 最终提交不自动重试而是刷新详情收敛结果。

- [ ] **Step 2: 实现副作 hook**

```ts
export interface UsePartnerAccountActionResult {
  state: PartnerAccountActionState;
  open(action: PartnerAccountAction, account: AdminOrgAccount, trigger: HTMLElement): void;
  close(): Promise<void>;
  chooseMethod(method: PartnerAccountVerificationMethod): Promise<void>;
  submitAdminPassword(password: string): Promise<void>;
  verifyCredential(value: string): Promise<void>;
  startRebind(newPhone: string): Promise<void>;
  resendNewPhoneCode(): Promise<void>;
  verifyNewPhone(code: string): Promise<void>;
  commitDelete(): Promise<void>;
}
```

hook 使用 `Date.now() + expiresInSeconds * 1000` 作唯一截止时间，interval 只刷新显示。每次请求生成 flow/request ID，响应返回时必须与当前 target/action 一致才能 dispatch；关闭、切换 action 和 `useEffect` cleanup 都显式递增 `currentFlowId.current`，使所有迟到 Promise 失效。如迟到的 verify/start 响应已签发 action/rebind ticket，hook 不得只丢弃响应：必须立即以该迟到 ticket 在后台静默调用对应撤销端点，然后不 dispatch UI。管理员密码和目标密码在每次请求 `finally` 清空；OTP、手机号和 ticket 在切换、关闭、终态错误、成功、卸载时清空并尽力调用撤销端点。

- [ ] **Step 3: 实现焦点受控 Dialog shell 和分步组件**

`PartnerAccountActionDialog.tsx` 不持有 API 逻辑，只管理标题/说明 ID、初始焦点、Tab/Shift+Tab 循环、Escape 传播阻断和关闭后焦点恢复。长流程始终使用稳定的 `dialog`；删除最终确认条件挂载独立 `PartnerAccountDeleteConfirmationDialog` 且在 mount 时就固定为 `alertdialog`，不在同一 DOM node 上动态切换 role。错误使用 `role="alert"`，关键状态使用 `role="status"`，每秒倒计时不放 live region。

OTP 输入为 6 位数字且 `autoComplete="one-time-code"`。两个密码输入使用不同 `name`、明确标签和 username 上下文，允许粘贴和密码管理器，不用 `autocomplete=off`。

- [ ] **Step 4: 缩减 PartnerAccountManager 为编排入口**

`PartnerAccountManager` 只保留账号列表、新增/重置/启停与打开 action dialog，不保存 challenge/ticket/倒计时。每行使用可换行的“账号安全操作”组，不新增页面。如 `availableActionVerificationMethods.length === 0`，禁用移除/换绑并就地说明“该账号安全验证未就绪，请让持有人在登录态完成自助改密；原手机也不可用时只能走独立线下核验，本系统不提供管理员绕过”。成功后调用已有 `onChanged` 刷新详情；删除成功因触发按钮消失，焦点落到账号区标题/容器。删除旧 `PartnerAccountDeletionDialog.tsx`前确认只有 Manager import。

- [ ] **Step 5: 跑 UI GREEN 和生产构建**

```bash
node --experimental-strip-types --test apps/admin/src/routes/partners/partnerAccountActionMachine.test.ts
pnpm --filter @ai-job-print/admin verify:partner-account-action-ui
pnpm --filter @ai-job-print/admin lint
pnpm --filter @ai-job-print/admin typecheck
VITE_API_MODE=http VITE_API_BASE_URL=/api/v1 pnpm --filter @ai-job-print/admin build
```

Expected: 全部 PASS，`PartnerAccountManager.tsx` 低于 300 行，新文件均低于 300 行。

- [ ] **Step 6: 使用本地隔离数据和模拟短信做浏览器验收**

验收路径：默认短信删除、目标密码删除、密码授权后换绑、新手机号占用、最后账号拦截、ticket 过期、双击提交、Tab/Shift+Tab/Escape/焦点恢复。网络超时注入后确认 UI 不自动重复最终写操作，而是刷新机构详情判断实际结果。

- [ ] **Step 7: 提交**

```bash
git add apps/admin/src/routes/partners apps/admin/scripts/verify-partner-account-action-ui.mjs
git commit -m "feat: add verified partner account removal and rebind flow"
```

### Task 8: CI、全量回归、双模型审查与文档收口

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `docs/progress/current-progress.md`
- Modify: `docs/progress/next-tasks.md`
- Create: `.ccg/tasks/partner-account-dual-auth-removal/review.md` (gitignored task evidence)

- [ ] **Step 1: 把专项门禁接入现有 SQLite 和 PostgreSQL job**

SQLite job 增加 schema/action/UI 专项；PostgreSQL job 在 `db:pg:deploy` 后增加 `verify:partner-account-action:postgres`。两个需要 Redis 的 job 都必须配置可健康检查的 Redis 7 service；verify 脚本在业务断言前显式连接检查，不可达时输出明确环境错误。不删除现有门禁，不修改生产密钥或部署配置。

- [ ] **Step 2: 跑完整验证矩阵**

```bash
pnpm --filter @ai-job-print/api db:pg:sync:check
pnpm --filter @ai-job-print/api verify:partner-account-action:schema
pnpm --filter @ai-job-print/api verify:partner-account-action
REDIS_URL=redis://127.0.0.1:6379 pnpm --filter @ai-job-print/api verify:partner-account-action:redis
pnpm --filter @ai-job-print/api verify:admin-orgs
pnpm --filter @ai-job-print/api verify:admin-orgs-delete-concurrency
pnpm --filter @ai-job-print/api verify:admin-orgs-delete-schema
INTERNAL_AUTH_VERIFY_TARGET=isolated pnpm --filter @ai-job-print/api verify:internal-auth-phone
INTERNAL_AUTH_VERIFY_TARGET=isolated pnpm --filter @ai-job-print/api verify:admin-phone-transfer
pnpm --filter @ai-job-print/api verify:change-password
pnpm --filter @ai-job-print/api verify:member-step-up
pnpm --filter @ai-job-print/admin verify:partner-account-action-ui
pnpm --filter @ai-job-print/admin verify:admin-phone-transfer-ui
pnpm --filter @ai-job-print/api exec tsx --test --experimental-test-coverage \
  --test-coverage-include=src/common/redis/partner-account-action-redis.service.ts \
  --test-coverage-include=src/orgs/partner-account-action.service.ts \
  --test-coverage-include=src/orgs/partner-phone-rebind.service.ts \
  --test-coverage-lines=80 --test-coverage-branches=80 --test-coverage-functions=80 \
  scripts/verify-partner-account-action-redis.ts scripts/verify-partner-account-action.ts
node --experimental-strip-types --test --experimental-test-coverage \
  --test-coverage-include=apps/admin/src/routes/partners/partnerAccountActionMachine.ts \
  --test-coverage-lines=80 --test-coverage-branches=80 --test-coverage-functions=80 \
  apps/admin/src/routes/partners/partnerAccountActionMachine.test.ts
pnpm --filter @ai-job-print/api lint
pnpm --filter @ai-job-print/admin lint
pnpm --filter @ai-job-print/api typecheck
pnpm --filter @ai-job-print/admin typecheck
pnpm --filter @ai-job-print/api build
VITE_API_MODE=http VITE_API_BASE_URL=/api/v1 pnpm --filter @ai-job-print/admin build
git diff --check
```

PostgreSQL 并发命令按 Task 5 Step 7 再跑一次。Expected: 全部 exit 0。如环境缺 PostgreSQL/Redis，不伪报 PASS；先启动与 CI 相同版本的本地隔离服务后重跑。

- [ ] **Step 3: 检查敏感数据与变更边界**

```bash
git diff --name-only origin/main...HEAD
git diff --check
rg -n "(actionTicket|rebindTicket|adminCurrentPassword|currentPassword|phoneHash|phoneEnc)" services/api/src/orgs apps/admin/src/routes/partners apps/admin/src/services/api/orgsAdmin.ts
```

人工确认命中只在 DTO/内存变量/header 组装/明确禁止的测试断言中，不在 logger、audit payload、URL、toast、DOM 属性或持久化存储中。

- [ ] **Step 4: 并行调用 Claude 与 Antigravity 审查完整 diff**

两个模型都以 `reviewer` 角色检查正确性、认证绕过、Lua 原子性、并发、手机唯一性、会话失效、敏感数据、UI 状态机和无障碍。合并去重为 Critical/Warning/Info 写入 `review.md`。Critical 必须修复后重新双审；Warning 修复或写出有证据的不修复理由。

- [ ] **Step 5: 同步真实进度，不写生产已部署**

`current-progress.md` 记录本地已实现的删除/换绑闭环、双库 migration ID、实际通过的命令和“未部署生产、未发真实短信”。`next-tasks.md` 只保留受控发布、生产 migration checksum 只读核对、网关/APM ticket header 脱敏、真实短信与隔离账号验收。

- [ ] **Step 6: 最终提交并归档 CCG 任务**

```bash
git add .github/workflows/ci.yml docs/progress/current-progress.md docs/progress/next-tasks.md docs/superpowers/specs/2026-07-18-partner-account-dual-auth-removal-design.md docs/superpowers/plans/2026-07-18-partner-account-dual-auth-removal-implementation.md
git commit -m "docs: close partner account action implementation"
```

将 `.ccg/tasks/partner-account-dual-auth-removal/task.json` 更新为 `completed`，然后移入 `.ccg/tasks/archive/2026-07/partner-account-dual-auth-removal/`。`.ccg` 在本仓库中为 gitignored，因此仅作本地任务证据，不伪造可提交的归档 commit。

## 执行编排

- Layer 1 可并行：Task 2（schema/凭据状态）、Task 3（独立 Redis 状态层）、Task 6 的纯 reducer 部分。文件归属不重叠。
- Layer 2 串行：Task 4 完成 OTP 契约，然后 Task 5 集成后端。
- Layer 3：Task 6 API adapter 与 Task 7 UI，等 Task 5 路由契约稳定后完成。
- 每个 task 均使用新实现子代理，随后使用新审查子代理先做 spec compliance，再做 code quality/security review。任何子代理都不得回退其他人的变更。
