# Admin–Partner 手机号安全转移实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在保留 Partner 用户名密码登录和全部机构数据的前提下，经 Admin 当前密码与手机号 OTP 验证，把唯一手机号原子转移到当前未绑定手机号的 Admin。

**Architecture:** 新增独立 `AdminPhoneTransferService` 与三条 Admin 专用端点，不修改严格首次绑定的“手机号无主”语义。Ticket 绑定 Admin/Partner 双方版本，数据库事务固定先清 Partner 再绑 Admin并写双审计；事务后原子写入 Partner 新版本会话状态，阻止旧缓存并发回填。Admin 既有账号设置入口增加独立转移组件，不新增页面或导航。

**Tech Stack:** NestJS、Prisma（SQLite/PostgreSQL 双基线）、Redis、bcryptjs、React/Vite/TypeScript、项目现有脚本式 verifier、GitHub Actions。

---

## 文件结构与并行边界

后端执行单元只能修改：

- `services/api/src/auth/admin-phone-transfer.service.ts`（新增）
- `services/api/src/auth/admin-phone-transfer-ticket.ts`（新增，纯 ticket/key/统一错误 helper）
- `services/api/src/auth/internal-otp.service.ts`
- `services/api/src/common/guards/jwt-auth.guard.ts`（只导出既有 TTL 常量）
- `services/api/src/auth/auth.controller.ts`
- `services/api/src/auth/auth.module.ts`
- `services/api/src/audit/audit.types.ts`
- `packages/shared/src/types/audit.ts`
- `services/api/scripts/verify-admin-phone-transfer.ts`（新增）
- `services/api/scripts/support/internal-auth-verify-harness.ts`（新增，仅隔离 verifier 公共 harness）
- `services/api/scripts/support/admin-phone-transfer-security-cases.ts`（新增，安全场景）
- `services/api/scripts/support/admin-phone-transfer-static-contract.ts`（新增，AST 路由/DI/审计门禁）
- `services/api/package.json`

前端执行单元只能修改：

- `apps/admin/src/services/auth/index.ts`
- `apps/admin/src/routes/account-settings/AdminPhoneTransferCard.tsx`（新增）
- `apps/admin/src/routes/account-settings/index.tsx`
- `apps/admin/scripts/verify-admin-phone-transfer-ui.mjs`（新增）
- `apps/admin/package.json`

整合单元最后修改：

- `.github/workflows/ci.yml`
- `docs/progress/current-progress.md`
- `docs/progress/next-tasks.md`
- `.ccg/tasks/admin-partner-phone-transfer-20260716/*`

禁止触碰 Prisma schema/migration、Partner 页面、Kiosk、Terminal Agent、支付、订单、打印扫描、生产配置和 `.worktrees/partner-account-safe-delete-20260716`。

### Task 0：双模型分析门禁

- [x] **Step 1：运行 Antigravity 只读架构分析**

Run：`--backend antigravity` 通过显式模型 shim 使用用户同意切换的 `Claude Sonnet 4.6 (Thinking)`；输入已确认规格与 `origin/main@e62a9789` 上下文，要求输出实际模型、Critical/Warning/Info。不得写文件。

Result：实际模型 `Claude Sonnet 4.6 (Thinking)`，`84/100 REQUEST_CHANGES`；报告有效。默认 Gemini 额度耗尽、Opus 4.6 长请求无容量的诊断已记录，不再作为当前模型路由。

- [x] **Step 2：把两个模型的分析差异写入任务要求**

只把会改变安全不变量、接口或测试矩阵的结论写入 `requirements.md` 和设计规格；不得把聊天全文或临时日志入库。

- [x] **Step 3：针对性双复审通过并提交门禁更新**

```bash
git add -f .ccg/tasks/admin-partner-phone-transfer-20260716/requirements.md
git add docs/superpowers/specs/2026-07-16-admin-partner-phone-transfer-design.md
git commit -m "docs: refine admin phone transfer security gate"
```

### Task 1：后端 RED——独立转移 verifier

**Files:**

- Create: `services/api/scripts/verify-admin-phone-transfer.ts`
- Create: `services/api/scripts/support/internal-auth-verify-harness.ts`
- Modify: `services/api/package.json`

- [x] **Step 1：先登记失败脚本命令**

在 `services/api/package.json` 的 verify 区加入：

```json
"verify:admin-phone-transfer": "node -r @swc-node/register scripts/verify-admin-phone-transfer.ts"
```

- [x] **Step 2：写真实隔离 harness 与期望 API**

脚本必须先调用现有 `assertInternalAuthVerifyTarget()`，使用临时 SQLite `DATABASE_URL`、真实 `PrismaService` 和临时表数据；不得连接共享或生产数据库。定义捕获短信与内存 Redis，至少具有服务实际调用的以下方法：

```ts
class CapturingSmsSender {
  lastCode: string | null = null
  deliveries = 0
  async sendCode(_phone: string, code: string): Promise<void> {
    this.lastCode = code
    this.deliveries += 1
  }
}

class MemoryRedis {
  private values = new Map<string, string>()
  async get(key: string) { return this.values.get(key) ?? null }
  async setEx(key: string, _ttl: number, value: string) { this.values.set(key, value) }
  async setNxEx(key: string, value: string, _ttl: number) {
    if (this.values.has(key)) return false
    this.values.set(key, value)
    return true
  }
  async incrWithTtl(key: string, _ttl: number) {
    const next = Number(this.values.get(key) ?? '0') + 1
    this.values.set(key, String(next))
    return next
  }
  async del(key: string) { this.values.delete(key) }
  async getAndDelIfEquals(key: string, expected: string) {
    const current = this.values.get(key)
    if (current === undefined) return 'missing' as const
    if (current !== expected) return 'mismatched' as const
    this.values.delete(key)
    return 'matched' as const
  }
  async reserveWithinLimitWithTtl(key: string, _ttl: number, limit: number) {
    const current = Number(this.values.get(key) ?? '0')
    if (current >= limit) return false
    const next = current + 1
    this.values.set(key, String(next))
    return true
  }
  async releaseReservedLimit(key: string) {
    const current = Number(this.values.get(key) ?? '0')
    if (current <= 1) this.values.delete(key)
    else this.values.set(key, String(current - 1))
  }
  async setJsonIfVersionNotOlder(key: string, _ttl: number, value: string, tokenVersion: number) {
    const current = this.values.get(key)
    if (current) {
      const parsed = JSON.parse(current) as { tokenVersion?: unknown }
      if (typeof parsed.tokenVersion === 'number' && parsed.tokenVersion > tokenVersion) return 'stale' as const
    }
    this.values.set(key, value)
    return 'stored' as const
  }
}
```

测试数据固定包含：未绑定 Admin、持有候选手机号的 Partner、另一 Admin、Organization；手机号只能在测试进程内生成，不写日志。

- [x] **Step 3：写完整失败断言**

Verifier 至少调用期望类：

```ts
const service = new AdminPhoneTransferService(prisma, redis, otp, audit)
const started = await service.start(admin.id, ADMIN_PASSWORD, PHONE, '127.0.0.1')
await service.verify(admin.id, started.bindTicket, sms.lastCode!)
```

并逐项断言：

```ts
const source = await prisma.user.findUniqueOrThrow({ where: { id: partner.id } })
const target = await prisma.user.findUniqueOrThrow({ where: { id: admin.id } })
assert.equal(source.phoneHash, null)
assert.equal(source.phoneEnc, null)
assert.equal(source.phoneVerifiedAt, null)
assert.equal(source.tokenVersion, partner.tokenVersion + 1)
assert.equal(target.phoneHash, hashPhone(PHONE))
assert.ok(target.phoneVerifiedAt)
assert.equal(await bcrypt.compare(PARTNER_PASSWORD, source.passwordHash), true)
```

再覆盖：无主手机号不发码、另一 Admin 所有者不发码、错误密码共享额度、正确密码与 bcrypt 异常均释放预约额度、错误 OTP 可重试、`bind_phone`/`transfer_phone` 验证码与冷却互相隔离、ticket 重放、双 verify、两个 Admin 并发竞争、start 后来源 phoneHash/tokenVersion 变化、静态 SQLite trigger 真实触发事务第二步 CAS 失败且来源清空整体回滚、四类审计脱敏、新版本 Partner 会话缓存覆盖旧值、旧版本并发回填被拒绝、缓存刷新失败不反转数据库成功且 TTL 后旧 JWT 失败。

事务第二步回滚用例不得在 verify 前直接修改 Admin，因为会被事务前复核短路。Verifier 必须在 ticket 创建后安装一个静态 SQLite trigger：当任意 Partner 的 `phoneHash` 从非空更新为空时，递增未绑定 Admin 的 `tokenVersion`；这样第一步 Partner 更新触发版本变化，第二步 Admin CAS 返回 0，随后抛错使两次更新连同 trigger 更新一起回滚。trigger 使用无插值的静态 SQL，并在 `finally` 删除。

- [x] **Step 4：运行 RED 并确认失败原因正确**

Run：

```bash
INTERNAL_AUTH_VERIFY_TARGET=isolated pnpm --filter @ai-job-print/api verify:admin-phone-transfer
```

Expected：FAIL，唯一主因是 `admin-phone-transfer.service` 不存在或期望方法/路由尚未实现；不得因连接共享数据库、缺 Prisma 客户端或测试语法错误失败。

- [x] **Step 5：提交 RED**

```bash
git add services/api/package.json services/api/scripts/verify-admin-phone-transfer.ts
git commit -m "test(auth): define admin partner phone transfer contract"
```

### Task 2：后端 GREEN——安全转移状态机

**Files:**

- Create: `services/api/src/auth/admin-phone-transfer.service.ts`
- Modify: `services/api/src/auth/internal-otp.service.ts`
- Modify: `services/api/src/common/guards/jwt-auth.guard.ts`（只把既有 `INTERNAL_SESSION_CACHE_TTL_SECONDS` 改为 export）
- Test: `services/api/scripts/verify-admin-phone-transfer.ts`

- [x] **Step 1：定义严格 ticket 与返回类型**

服务顶部定义：

```ts
type AdminPhoneTransferTicket = {
  adminId: string
  adminTokenVersion: number
  partnerId: string
  partnerTokenVersion: number
  encryptedPhone: string
  phoneHash: string
}

export type AdminPhoneTransferStartResult = {
  bindTicket: string
  cooldownSeconds: number
  expiresInSeconds: number
  sourceAccount: {
    username: string
    organizationName: string
    phoneMasked: string
  }
}
```

`parseTicket()` 必须比较精确 key 集合、校验两个 ID 非空、两个 version 为非负安全整数，并在解密后复核手机号格式与 hash。

- [x] **Step 2：实现 start 的三因子前两步与角色限制**

核心查询和拒绝条件固定为：

```ts
const owner = await this.prisma.user.findUnique({
  where: { phoneHash },
  include: { org: { select: { name: true } } },
})
if (!owner || owner.role !== 'partner' || !owner.orgId || !owner.org) {
  throw this.unavailable()
}
```

密码失败额度键必须与严格初绑完全相同：

```ts
private currentPasswordFailureKey(adminId: string): string {
  return `internal:admin:phone-initial-bind:password-fail:${adminId}`
}
```

密码校验必须逐步镜像现有 `AdminInitialPhoneBindService`：先 `reserveCurrentPasswordAttempt`；bcrypt 抛错时 release 后统一失败；密码不匹配时不 release；密码匹配时立即 release，然后才校验手机号、创建 ticket 和发送短信。不得在短信异常路径再次 release，避免并发计数被多减。Verifier 必须断言成功 start 前后共享失败额度相同。

先把 `InternalOtpPurpose` 扩展为 `'login' | 'reset_password' | 'bind_phone' | 'transfer_phone'`。创建 `internal:admin:phone-transfer:*` 独立 ticket/active/verify-lock key；ticket TTL 使用 `INTERNAL_OTP_CODE_TTL_SECONDS`。只有 owner 为 Partner 才调用 `otp.sendCode({ purpose: 'transfer_phone', shouldDeliver: true })`，verify 也只能消费 `transfer_phone` 验证码。

- [x] **Step 3：实现 verify 的锁、OTP 与 CAS 消费**

顺序必须是：读取并验证 ticket → 复核 Admin 未绑定 → 获取随机值验证锁 → 验证 OTP → CAS 消费 ticket → CAS 消费 active ticket → 数据库事务。并发请求未获得锁时不得验证或消费 OTP。

- [x] **Step 4：实现单事务先清后绑与双审计**

事务主体必须保持以下顺序：

```ts
await this.prisma.$transaction(async (tx: PrismaTransactionClient) => {
  const released = await tx.user.updateMany({
    where: {
      id: ticket.partnerId,
      role: 'partner',
      phoneHash: ticket.phoneHash,
      tokenVersion: ticket.partnerTokenVersion,
    },
    data: {
      phoneHash: null,
      phoneEnc: null,
      phoneVerifiedAt: null,
      tokenVersion: { increment: 1 },
    },
  })
  if (released.count !== 1) throw this.unavailable()

  const bound = await tx.user.updateMany({
    where: {
      id: ticket.adminId,
      role: 'admin',
      enabled: true,
      phoneHash: null,
      phoneEnc: null,
      phoneVerifiedAt: null,
      tokenVersion: ticket.adminTokenVersion,
    },
    data: {
      phoneHash: ticket.phoneHash,
      phoneEnc: ticket.encryptedPhone,
      phoneVerifiedAt,
    },
  })
  if (bound.count !== 1) throw this.unavailable()

  await tx.auditLog.create({ data: adminAudit })
  await tx.auditLog.create({ data: partnerAudit })
})
```

四个审计动作与写入点固定为：

- start 发码成功后 best-effort 写 `auth.phone_transfer_start`：`actorId=Admin`、`targetId=Partner`、空 payload；
- 事务内写 `auth.phone_transfer_complete`：`actorId=Admin`、`targetId=Admin`，payload 只含 `phoneMasked` 与 `sourcePartnerId`；
- 同一事务写 `auth.phone_released_by_admin`：`actorId=Admin`、`targetId=Partner`、`payloadJson='{}'`；
- cancel 成功消费活动 ticket 后 best-effort 写 `auth.phone_transfer_cancel`：`actorId=Admin`、`targetId=Admin`、空 payload。

事务内任何审计失败必须回滚两个账号更新；start/cancel 审计失败不改变业务结果，但不得泄露敏感数据。

- [x] **Step 5：实现事务后 Partner 新版本会话缓存覆盖**

```ts
try {
  await this.redis.setJsonIfVersionNotOlder(
    `internal:session-state:${ticket.partnerId}`,
    INTERNAL_SESSION_CACHE_TTL_SECONDS,
    JSON.stringify(freshPartnerSessionState),
    freshPartnerSessionState.tokenVersion,
  )
} catch {
  this.logger.warn('手机号转移已提交，但机构账号会话缓存刷新失败；将以数据库 tokenVersion 和缓存 TTL 收敛')
}
```

事务内在两条审计写入后，必须通过 `tx.user.findUniqueOrThrow({ include: { org: { select: { enabled: true } } } })` 读取并返回完整 `freshPartnerSessionState`（`userId/role/orgId/enabled/tokenVersion/orgEnabled`）；不得依赖不返回记录的 `updateMany`。`JwtAuthGuard` 中既有 60 秒 TTL 常量只改为 export，供服务复用；Guard 行为不变。日志不得拼接手机号、账号名、ticket 或 Redis payload。Admin 不递增 tokenVersion。

Verifier 必须先模拟旧版本缓存，再完成转移并断言缓存变为新版本、旧 JWT 因 `payload.ver !== state.tokenVersion` 被真实 `JwtAuthGuard` 拒绝；随后模拟在途旧请求调用 `setJsonIfVersionNotOlder(..., oldVersion)`，必须返回 `stale` 且缓存仍是新版本。另测缓存刷新抛错时业务仍成功，并在删除/过期模拟后由数据库回源拒绝旧 JWT。

- [x] **Step 6：实现 cancel 与统一错误**

cancel 仅 CAS 删除当前 Admin active ticket，再删除对应 ticket；成功消费活动 ticket 后 best-effort 写空 payload cancel 审计，审计失败不得记录手机号、账号名、ticket 或 Redis payload。所有非可操作短信失败统一：

```ts
new BadRequestException({
  error: { code: 'AUTH_PHONE_TRANSFER_UNAVAILABLE', message: '当前账号暂不可进行手机号安全转移' },
})
```

- [x] **Step 7：运行 GREEN**

Run：

```bash
INTERNAL_AUTH_VERIFY_TARGET=isolated pnpm --filter @ai-job-print/api verify:admin-phone-transfer
```

Expected：全部转移状态机断言 PASS，临时数据库清理完成。

- [x] **Step 8：提交服务**

```bash
git add services/api/src/auth/admin-phone-transfer.service.ts services/api/src/auth/internal-otp.service.ts services/api/src/common/guards/jwt-auth.guard.ts
git commit -m "feat(auth): add admin partner phone transfer state machine"
```

### Task 3：后端路由、DI 与审计动作

**Files:**

- Modify: `services/api/src/auth/auth.controller.ts`
- Modify: `services/api/src/auth/auth.module.ts`
- Modify: `services/api/src/audit/audit.types.ts`
- Modify: `packages/shared/src/types/audit.ts`
- Test: `services/api/scripts/verify-admin-phone-transfer.ts`

- [x] **Step 1：先扩展 verifier 的静态路由断言**

要求三条路由分别为：

```ts
@Post('admin/phone/transfer/start')
@Post('admin/phone/transfer/verify')
@Post('admin/phone/transfer/cancel')
```

每条都必须同时出现 `@UseGuards(JwtAuthGuard, RolesGuard)`、`@Roles('admin')` 与 `@Throttle({ default: { ttl: 60_000, limit: 5 } })`，并只委派 `AdminPhoneTransferService`。

- [x] **Step 2：运行 RED**

Run：同 Task 2 Step 7。

Expected：状态机行为仍 PASS，路由/DI/审计动作登记断言 FAIL。

- [x] **Step 3：接入 controller 与 module**

构造器新增 `private readonly adminPhoneTransferService: AdminPhoneTransferService`。start/verify/cancel 复用 `InitialPhoneBindStartDto`、`InitialPhoneBindVerifyDto`、`InitialPhoneBindCancelDto`，不增加重复 DTO。

- [x] **Step 4：登记四个审计动作**

API 与 shared 的 `AuditAction` 同步增加：

```ts
| 'auth.phone_transfer_start'
| 'auth.phone_transfer_complete'
| 'auth.phone_transfer_cancel'
| 'auth.phone_released_by_admin'
```

- [x] **Step 5：运行专项与现有回归**

```bash
INTERNAL_AUTH_VERIFY_TARGET=isolated pnpm --filter @ai-job-print/api verify:admin-phone-transfer
INTERNAL_AUTH_VERIFY_TARGET=isolated pnpm --filter @ai-job-print/api verify:internal-auth-phone
pnpm --filter @ai-job-print/api typecheck
pnpm --filter @ai-job-print/shared typecheck
```

Expected：新旧认证 verifier 和两个 typecheck 均退出 0。

- [x] **Step 6：提交接线**

```bash
git add services/api/src/auth/auth.controller.ts services/api/src/auth/auth.module.ts services/api/src/audit/audit.types.ts packages/shared/src/types/audit.ts services/api/scripts/verify-admin-phone-transfer.ts
git commit -m "feat(auth): expose guarded admin phone transfer endpoints"
```

### Task 4：Admin RED 与严格 API adapter

**Files:**

- Create: `apps/admin/scripts/verify-admin-phone-transfer-ui.mjs`
- Modify: `apps/admin/package.json`
- Modify: `apps/admin/src/services/auth/index.ts`

- [x] **Step 1：写 UI RED verifier 与命令**

`apps/admin/package.json` 新增：

```json
"verify:admin-phone-transfer-ui": "node scripts/verify-admin-phone-transfer-ui.mjs"
```

Verifier 使用现有 VM adapter 模式，要求三函数存在且不持久化密码、手机号、OTP 或 ticket：

```ts
startAdminPhoneTransfer(currentPassword, phone)
verifyAdminPhoneTransfer(bindTicket, code)
cancelAdminPhoneTransfer(bindTicket)
```

非法 2xx 至少覆盖：非 UUID ticket、超范围秒数、明文手机号、非法掩码、空 username、空 organizationName、非 canonical ISO、`cancelled:false`；只有验证成功的脱敏字段可以合并到现有本地用户。

- [x] **Step 2：运行 RED**

```bash
pnpm --filter @ai-job-print/admin verify:admin-phone-transfer-ui
```

Expected：FAIL，原因是 adapter/组件尚不存在，不是 verifier 语法或模块加载错误。

- [x] **Step 3：实现严格响应类型与 runtime guard**

新增返回契约：

```ts
export type AdminPhoneTransferSourceAccount = {
  username: string
  organizationName: string
  phoneMasked: string
}
```

start guard 必须验证 UUID、0..300 整数秒、非零 expiry、非空 username/organizationName 和合法掩码；verify/cancel 复用严格初绑的 canonical 时间与精确成功形状逻辑。失败结果保留 HTTP `status`。

- [x] **Step 4：运行 adapter GREEN**

Run：同 Step 2。

Expected：adapter 行为断言 PASS；组件存在性仍 FAIL。

- [x] **Step 5：提交 adapter 与 RED UI 契约**

```bash
git add apps/admin/package.json apps/admin/scripts/verify-admin-phone-transfer-ui.mjs apps/admin/src/services/auth/index.ts
git commit -m "test(admin): define phone transfer UI contract"
```

### Task 5：Admin GREEN——独立转移组件与既有入口接线

**Files:**

- Create: `apps/admin/src/routes/account-settings/AdminPhoneTransferCard.tsx`
- Modify: `apps/admin/src/routes/account-settings/index.tsx`
- Test: `apps/admin/scripts/verify-admin-phone-transfer-ui.mjs`

- [ ] **Step 1：实现三态内存状态机**

组件 props：

```ts
type Props = {
  onBound: (phone: { phoneMasked: string; phoneVerifiedAt: string }) => void
  onBack: () => void
}
```

状态只使用 `useState`：`currentPassword`、`phone`、`code`、`bindTicket`、`sourceAccount`、`acknowledged`、冷却/过期时间、提交状态和可访问消息。不得使用 local/session storage、URL、console 或隐藏 input。

- [ ] **Step 2：实现来源确认与不可省略文案**

start 成功后必须显示来源账号的转义文本，并逐字包含以下业务事实：

```text
该手机号将从上述机构账号转移到当前管理员账号。
机构账号仍可使用用户名和密码登录。
机构账号将无法再使用该手机号短信登录或找回密码。
机构账号当前登录会话将失效；忘记密码时需由管理员重置。
```

确认控件使用可访问 checkbox；`!acknowledged` 时“确认转移”按钮必须 disabled。验证码发送成功不等于转移完成。

- [ ] **Step 3：实现保守错误和取消语义**

复用严格初绑的五分钟未知发送冷却、已知短信限流、OTP 可重试、ticket 过期、未知 verify/cancel 强制重新登录语义。返回初绑模式前必须先调用远端 cancel；cancel 未确认时不得静默切换。

- [ ] **Step 4：在既有页面添加模式切换，不新增入口**

`AccountSettingsPage` 仅在 `user.role==='admin' && !user.phoneMasked` 时渲染一个账号绑定区域；默认显示严格初绑卡片和次级按钮“该号码已用于机构账号？安全转移”。切换后只显示转移卡片。两个组件共用同一 `onBound` 不可变更新：

```ts
const handlePhoneBound = (phone: Pick<AuthedUser, 'phoneMasked' | 'phoneVerifiedAt'>) => {
  setUser((current) => current ? { ...current, ...phone } : current)
  setPhoneBindingSuccess(phone)
}
```

- [ ] **Step 5：运行 UI GREEN 与现有回归**

```bash
pnpm --filter @ai-job-print/admin verify:admin-phone-transfer-ui
pnpm --filter @ai-job-print/admin verify:admin-account-settings-ui
pnpm --filter @ai-job-print/admin typecheck
pnpm --filter @ai-job-print/admin lint
```

Expected：两个 verifier、typecheck、lint 全部退出 0。

- [ ] **Step 6：提交 UI**

```bash
git add apps/admin/src/routes/account-settings/AdminPhoneTransferCard.tsx apps/admin/src/routes/account-settings/index.tsx apps/admin/scripts/verify-admin-phone-transfer-ui.mjs
git commit -m "feat(admin): add explicit partner phone transfer flow"
```

### Task 6：CI、正式进度与范围复核

**Files:**

- Modify: `.github/workflows/ci.yml`
- Modify: `docs/progress/current-progress.md`
- Modify: `docs/progress/next-tasks.md`

- [ ] **Step 1：把两个专项门禁串行接入 CI**

在 Admin UI verify 区加入：

```bash
pnpm --filter @ai-job-print/admin verify:admin-phone-transfer-ui
```

在 API Verify suites 的认证/机构账号附近加入：

```bash
INTERNAL_AUTH_VERIFY_TARGET=isolated pnpm --filter @ai-job-print/api verify:admin-phone-transfer
```

保持 SQLite verify 串行，不增加 `&`、`run-p` 或共享数据库并发。

- [ ] **Step 2：同步进度 SSOT**

`current-progress.md` 只记录真实完成的本地代码、验证和审查状态；明确“未部署、未发真实短信、未执行真实转移、生产仍 CLOSED_MODE”。`next-tasks.md` 把后续拆成：PR/CI、部署授权、用户在页面自行输入密码与 OTP 完成真实转移。

- [ ] **Step 3：证明范围未漂移**

```bash
git diff origin/main...HEAD --name-only
git diff --check
pnpm --filter @ai-job-print/api db:pg:sync:check
```

Expected：只有计划文件范围；PostgreSQL schema 同步检查退出 0，且无 schema/migration diff。

- [ ] **Step 4：提交整合**

```bash
git add .github/workflows/ci.yml docs/progress/current-progress.md docs/progress/next-tasks.md
git commit -m "ci: gate admin partner phone transfer"
```

### Task 7：完整验证、安全复审与修复循环

- [ ] **Step 1：运行完整相关验证**

```bash
INTERNAL_AUTH_VERIFY_TARGET=isolated pnpm --filter @ai-job-print/api verify:admin-phone-transfer
INTERNAL_AUTH_VERIFY_TARGET=isolated pnpm --filter @ai-job-print/api verify:internal-auth-phone
pnpm --filter @ai-job-print/api verify:admin-orgs
pnpm --filter @ai-job-print/admin verify:admin-phone-transfer-ui
pnpm --filter @ai-job-print/admin verify:admin-account-settings-ui
pnpm --filter @ai-job-print/shared typecheck
pnpm --filter @ai-job-print/api typecheck
pnpm --filter @ai-job-print/api lint
pnpm --filter @ai-job-print/api build
pnpm --filter @ai-job-print/admin typecheck
pnpm --filter @ai-job-print/admin lint
VITE_API_MODE=http VITE_API_BASE_URL=/api/v1 pnpm --filter @ai-job-print/admin build
pnpm --filter @ai-job-print/api db:pg:sync:check
pnpm audit --audit-level high
git diff --check
```

Expected：除已登记的独立基线项外，所有命令 fresh exit 0；`multer@2.1.1` 深层字段 DoS 必须在部署前由独立 P0 升级到 `>=2.2.0` 并回归上传链路。本认证分支不得顺手改 manifest/lock；如基线项尚未解决，只能报告代码候选完成、部署 blocked。

- [ ] **Step 2：Admin 浏览器冒烟**

使用本地 HTTP API/mock 捕获模式验证：默认严格初绑 → 切换安全转移 → 来源摘要 → 未勾选无法提交 → 取消返回 → 成功响应只更新脱敏手机号。不得连接生产、不得发送短信。

- [ ] **Step 3：并行双模型代码终审**

Antigravity 与 Claude 必须分别审查 `git diff origin/main...HEAD`，输出实际模型和 Critical/Warning/Info。用户已同意切换可用模型：Antigravity 使用已验证可承载长审查的 `Claude Sonnet 4.6 (Thinking)`；Claude 使用其实际模型并如实报告。任一路无有效报告都保持 blocked，不能用角色文案或模型别名冒充实际模型。

- [ ] **Step 4：修复 Critical/Warning 并重新验证**

每个缺陷先在专项 verifier 中写失败用例，再做最小修复，重跑对应专项与类型检查；Critical 修复后必须重新跑两模型终审。

### Task 8：CCG 归档与交付边界

**Files:**

- Create: `.ccg/tasks/admin-partner-phone-transfer-20260716/review.md`
- Move via patch: `.ccg/tasks/admin-partner-phone-transfer-20260716/` → `.ccg/tasks/archive/2026-07/admin-partner-phone-transfer-20260716/`

- [ ] **Step 1：写 review.md**

记录实际命令、退出码、浏览器范围、双模型实际模型/结论、未完成事项和生产禁区；不得记录手机号、密码、OTP、token、cookie 或 Redis payload。

- [ ] **Step 2：将 task.json 更新为 completed**

```json
{
  "status": "completed",
  "currentPhase": "completed",
  "nextAction": "等待用户授权推送、创建 PR 与 CI；生产转移另行授权"
}
```

- [ ] **Step 3：使用 apply_patch 归档活动任务文件**

把 task/requirements/review 的内容添加到 `.ccg/tasks/archive/2026-07/admin-partner-phone-transfer-20260716/`，并用同一 patch 删除活动目录文件，保证 CI 的“无 tracked active AI tool state”门禁通过。

- [ ] **Step 4：提交归档**

```bash
git add -f .ccg/tasks/archive/2026-07/admin-partner-phone-transfer-20260716
git add -u .ccg/tasks/admin-partner-phone-transfer-20260716
git commit -m "chore: archive ccg task admin-partner-phone-transfer-20260716"
```

- [ ] **Step 5：最终只读状态检查**

```bash
git status --short --branch
git log --oneline origin/main..HEAD
git diff --stat origin/main...HEAD
git ls-files .ccg/tasks | rg -v '^\.ccg/tasks/archive/'
```

Expected：工作区无未提交任务改动；最后一条命令无输出。未经用户明确授权，不 push、不建 PR、不部署、不发送短信、不执行真实账号转移。

## 计划自检

- 规格的角色限制、共享密码失败额度、双因子+会话、ticket、事务顺序、双审计、UI 明示同意、失败恢复、CI 与生产授权边界均有对应任务。
- 类型名称在后端、controller、前端 adapter 和组件中保持一致：`AdminPhoneTransfer*`；请求继续复用 `InitialPhoneBind*Dto`。
- 无 `TODO`、`TBD`、“稍后实现”或未定义的测试步骤。
- 两个实现单元文件互不重叠；CI/文档/CCG 归档由整合单元最后处理。
