# 管理员凭据恢复与内部认证验收安全收口 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不直改生产数据库、不新建绕过身份核验的管理员账号的前提下，安全交付管理员自助改密、未绑定手机号的可信补绑能力，并阻止会写入测试数据的内部认证 verify 被误用于生产库。

**Architecture:** 先将已有的 PR #230 作为独立的“已登录 + 当前密码”改密闭环整合；改密成功后 tokenVersion 递增并清除 Redis session state，所有旧会话必须重新登录。随后从最新 `main` 新开独立分支，新增仅面向已认证 admin/partner 的手机号初始绑定两步接口：第 1 步以当前密码和候选手机号申请验证码，第 2 步以一次性 ticket 和验证码完成 CAS 写入。现有 `/auth/phone/code` / `/auth/phone/verify` 保持不变，继续只服务于“手机号已经预录入、仅待本人验证”的账号。

**Tech Stack:** NestJS、Prisma（SQLite/PostgreSQL 双轨既有 User phone 字段）、Redis、bcryptjs、class-validator、React/Vite、现有 `InternalOtpService`、现有 API verify 脚本。

---

## 范围与硬边界

功能归位声明：

- 功能/业务闭环名称：内部管理员凭据恢复与手机号认证上线前安全收口。
- 涉及层和具体目录：
  - 前端：`apps/admin/src/routes/account-settings/`、`apps/admin/src/services/auth/`。
  - 后端：`services/api/src/auth/`、`services/api/scripts/`。
  - 终端：不涉及；不得改 `apps/terminal-agent/`、Windows 服务、打印机或任何终端状态。
  - 共享类型：不涉及；接口只被 Admin 内部认证客户端使用。
  - 共享 UI：不涉及；沿用 Admin 现有 Card/Button。
  - 数据库：不新增表、不新增迁移；复用既有 `User.phoneHash`、`phoneEnc`、`phoneVerifiedAt`、`tokenVersion`。
  - 文档：`docs/progress/current-progress.md`、`docs/progress/next-tasks.md` 只能在代码、CI 和部署证据真实具备后更新。
- 复用确认：已存在 `AuthService`、`InternalOtpService`、`JwtAuthGuard`、`phone-identity.ts`、`verify-internal-auth-phone.ts`。PR #230 已包含改密 UI 与后端，不重新实现。
- 跨层契约：Admin 只调用 `/auth/*`，不访问数据库；验证码、密码、ticket、手机号明文不得写日志、审计 payload、localStorage/sessionStorage 或文档。

本任务允许修改：

- PR #230 的冲突收口所必需的 `docs/progress/current-progress.md`。
- `services/api/src/auth/auth.service.ts`
- `services/api/src/auth/auth.controller.ts`
- `services/api/src/auth/dto/internal-auth.dto.ts`
- `services/api/src/auth/internal-auth-verify-target.ts`（新增纯函数）
- `services/api/scripts/verify-internal-auth-phone.ts`
- `services/api/scripts/verify-internal-auth-phone-target-guard.ts`（新增）
- `services/api/package.json`
- `apps/admin/src/services/auth/index.ts`
- `apps/admin/src/routes/account-settings/index.tsx`
- `apps/admin/src/routes/account-settings/PhoneBindingCard.tsx`（新增）
- 上述两份进度文档。

本任务禁止：

- 直接修改生产 `User`、`AuditLog`、Redis、价格、支付、终端启停或打印任务。
- 创建无当前密码校验的“找回管理员”接口，创建第二个管理员，使用后门 token，或直接执行 SQL 改密码/手机号。
- 修改既有已预录手机号账号的 `/auth/phone/code`、`/auth/phone/verify` 行为。
- 启用 Tencent SMS、发送真实验证码、把 `verify:internal-auth-phone` 指向生产数据库，或宣称生产验收完成。
- 把本计划与 Windows Agent、收费模式、数据库高负载、OCR/AI 或法务事项合并。

## 已证实的事实与前置条件

1. `main` 的密码找回流程依赖 `phoneEnc`，未绑定手机号的账号无法走该流程。
2. `main` 的 `/auth/phone/code` 同样在 `phoneEnc` 缺失时返回 `PHONE_NOT_BOUND`，因此它不能完成“首次绑定”。
3. PR #230（`claude/admin-account-settings-6ee9e8`）已有登录态改密实现：校验当前密码、bcrypt 72-byte 限制、每用户失败限流、乐观并发更新、`tokenVersion` 递增、Redis session state 失效和审计。它相对当前 `main` 的唯一 Git 合并冲突为 `docs/progress/current-progress.md`。
4. `services/api/scripts/verify-internal-auth-phone.ts` 当前按 `action startsWith 'auth.'` 删除 `AuditLog`。这是确定的生产风险；该脚本还会创建和修改临时 User/Organization，故只能在隔离数据库运行，绝不能当作生产库 verify。

---

### Task 1: 先修复内部认证 verify 的生产误用风险

**Files:**

- Create: `services/api/src/auth/internal-auth-verify-target.ts`
- Create: `services/api/scripts/verify-internal-auth-phone-target-guard.ts`
- Modify: `services/api/scripts/verify-internal-auth-phone.ts`
- Modify: `services/api/package.json`
- Modify: `docs/progress/next-tasks.md`

- [ ] **Step 1: 写 RED 守卫测试，固定“production 永远拒绝、isolated 才允许”的契约。**

```ts
import { assertInternalAuthVerifyTarget } from '../src/auth/internal-auth-verify-target'

function expectThrow(env: NodeJS.ProcessEnv, expected: string) {
  try {
    assertInternalAuthVerifyTarget(env)
    throw new Error('expected guard to throw')
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes(expected)) throw error
  }
}

expectThrow({ NODE_ENV: 'production', INTERNAL_AUTH_VERIFY_TARGET: 'isolated' }, 'production')
expectThrow({ NODE_ENV: 'staging' }, 'INTERNAL_AUTH_VERIFY_TARGET=isolated')
assertInternalAuthVerifyTarget({ NODE_ENV: 'test', INTERNAL_AUTH_VERIFY_TARGET: 'isolated' })
console.log('PASS internal auth verify target guard')
```

- [ ] **Step 2: 运行 guard，确认当前没有实现时失败。**

Run: `pnpm --filter @ai-job-print/api exec node -r @swc-node/register scripts/verify-internal-auth-phone-target-guard.ts`

Expected: 失败，提示找不到 `internal-auth-verify-target` 或导出函数。

- [ ] **Step 3: 实现纯守卫，并在现有 verify 的任何 Prisma 初始化前调用。**

```ts
// services/api/src/auth/internal-auth-verify-target.ts
export function assertInternalAuthVerifyTarget(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV === 'production') {
    throw new Error('verify:internal-auth-phone 拒绝 NODE_ENV=production；请在隔离测试库运行。')
  }
  if (env.INTERNAL_AUTH_VERIFY_TARGET !== 'isolated') {
    throw new Error('verify:internal-auth-phone 需要 INTERNAL_AUTH_VERIFY_TARGET=isolated。')
  }
}
```

在 `verify-internal-auth-phone.ts` 的 `main()` 第一行加入：

```ts
assertInternalAuthVerifyTarget()
```

`services/api/package.json` 保持显式而非隐式执行：

```json
"verify:internal-auth-phone": "node -r @swc-node/register scripts/verify-internal-auth-phone.ts",
"verify:internal-auth-phone-target-guard": "node -r @swc-node/register scripts/verify-internal-auth-phone-target-guard.ts"
```

禁止在 package script 内硬编码 `INTERNAL_AUTH_VERIFY_TARGET=isolated`，避免把“隔离”伪装成运行环境事实。

- [ ] **Step 4: 将脚本的审计 mock 改为内存记录器，消除任何 AuditLog 清理。**

用测试专用记录器替换脚本内 `new AuditService(prisma)`：

```ts
class RecordingAudit {
  readonly events: Array<{ action: string; actorId: string | null; payload: Record<string, unknown> }> = []

  async write(input: { action: string; actorId: string | null; payload: Record<string, unknown> }): Promise<void> {
    this.events.push({ action: input.action, actorId: input.actorId, payload: input.payload })
  }
}

const audit = new RecordingAudit()
const auth = new AuthService(
  jwt,
  prisma,
  redis as unknown as RedisService,
  otp,
  audit as unknown as AuditService,
)
```

删除以下危险清理语句，且不得以时间窗、action 前缀或 JSON payload 猜测替代：

```ts
await prisma.auditLog.deleteMany({ where: { action: { startsWith: 'auth.' } } })
```

对已有认证流程新增断言，例如：

```ts
if (!audit.events.some((event) => event.action === 'auth.password_login' && event.actorId === verified.id)) {
  fail('认证成功应请求写入 auth.password_login 审计事件')
}
```

保留仅按随机 suffix 删除测试 User/Organization 的 cleanup；禁止删除任何预存审计记录。

- [ ] **Step 5: 将生产待办改成“隔离库功能验证 + 生产只读部署检查”。**

在 `docs/progress/next-tasks.md` 的“三端登录 / 内部账号手机号认证部署”项中，替换“生产库运行 `verify:internal-auth-phone`”的表述：

```markdown
隔离预生产库：设置 `INTERNAL_AUTH_VERIFY_TARGET=isolated` 后运行 `verify:internal-auth-phone`。
生产库：只执行 `prisma migrate status`、目标提交/环境变量脱敏核对和真实管理员本人 UI 验收；该 verify 在 `NODE_ENV=production` 必须拒绝运行，不能以测试账号或清理脚本触碰生产审计。
```

- [ ] **Step 6: 运行 RED→GREEN 验证。**

Run:

```bash
pnpm --filter @ai-job-print/api verify:internal-auth-phone-target-guard
INTERNAL_AUTH_VERIFY_TARGET=isolated pnpm --filter @ai-job-print/api verify:internal-auth-phone
pnpm --filter @ai-job-print/api typecheck
pnpm --filter @ai-job-print/api lint
git diff --check
```

Expected: guard 三种环境断言 PASS；认证 verify 仅在显式 isolated 时 PASS；typecheck/lint/diff check 通过。

- [ ] **Step 7: 提交独立 PR，禁止与改密/补绑运行时代码混合。**

```bash
git add services/api/src/auth/internal-auth-verify-target.ts \
  services/api/scripts/verify-internal-auth-phone-target-guard.ts \
  services/api/scripts/verify-internal-auth-phone.ts \
  services/api/package.json \
  docs/progress/next-tasks.md
git commit -m "fix(auth): guard internal phone verify from production"
git push -u origin codex/internal-auth-verify-safety-20260715
```

创建 PR 后运行仓库双 CI，并进行独立安全审查；审查必须确认没有密码、手机号明文、验证码、ticket 或生产连接字符串进入 diff、日志或审计。

### Task 2: 复核并整合 PR #230 的登录态自助改密

**Files:**

- Modify: PR #230 的 `docs/progress/current-progress.md` 冲突块（仅冲突解法）
- Verify existing: `services/api/scripts/verify-change-password.ts`
- Verify existing: `services/api/src/auth/auth.service.ts`
- Verify existing: `apps/admin/src/routes/account-settings/index.tsx`

- [ ] **Step 1: 在 PR #230 专用 worktree 中基于最新 `origin/main` rebase。**

```bash
git fetch origin main
git rebase origin/main
```

预期只出现 `docs/progress/current-progress.md` 冲突。保留 `main` 中较新的、已合并事实；只保留可由本分支实际命令/CI证明的自助改密条目。不得保留“外部模型已批准”等无有效报告的表述。

- [ ] **Step 2: 逐项复核改密的安全不变量。**

必须阅读并确认：

```ts
await bcrypt.compare(currentPassword, user.passwordHash)
await this.prisma.user.updateMany({ where: { id: user.id, passwordHash: user.passwordHash }, ... })
data: { passwordHash, tokenVersion: { increment: 1 } }
await this.invalidateSessionState(user.id)
await this.writeAudit(user.id, user.role, 'auth.password_change_self', {})
```

确认 DTO 同时限制最小长度、72 个 UTF-8 字节上限，错误密码按用户限流，路由使用 `JwtAuthGuard`，成功后前端调用 `logout()`。不得接受只靠前端长度校验、无当前密码校验或不作 token 失效的版本。

- [ ] **Step 3: 在 rebase 后运行实际回归。**

Run:

```bash
pnpm --filter @ai-job-print/api verify:change-password
pnpm --filter @ai-job-print/api typecheck
pnpm --filter @ai-job-print/api lint
pnpm --filter @ai-job-print/admin typecheck
pnpm --filter @ai-job-print/admin lint
git diff --check
```

Expected: 改密 verify 覆盖错误当前密码、相同密码、并发冲突、旧 token 失效、旧密码失效、新密码可登录、审计和限流；工程检查均通过。

- [ ] **Step 4: 仅在有效独立安全审查和 GitHub CI 均通过后，取得明确合并授权。**

合并前输出 PR URL、head SHA、冲突解决 diff、CI 链接、审查结论。没有有效审查结论时状态为“待审查”，不得把旧的空输出、超时或失败 wrapper 伪装为批准。

### Task 3: 为未绑定手机号账号实现可信“初始绑定”后端

**Files:**

- Modify: `services/api/src/auth/dto/internal-auth.dto.ts`
- Modify: `services/api/src/auth/auth.controller.ts`
- Modify: `services/api/src/auth/auth.service.ts`
- Modify: `services/api/scripts/verify-internal-auth-phone.ts`

- [ ] **Step 1: 先在 verify 中写出失败用例。**

在随机新建、无 `phoneEnc` 的 admin 与 partner 测试账号上覆盖：

```ts
// 缺当前密码、错当前密码、已绑定账号、候选手机号已属于其他账号都必须拒绝。
await expectCode(() => auth.startInitialPhoneBind(unbound.id, 'wrong', candidatePhone, '127.0.0.1'), 'AUTH_PASSWORD_MISMATCH', '错当前密码拒绝')
const start = await auth.startInitialPhoneBind(unbound.id, passwordV1, candidatePhone, '127.0.0.1')
await expectCode(() => auth.completeInitialPhoneBind(unbound.id, start.bindTicket, '000000'), 'SMS_CODE_INVALID', '错误验证码拒绝')
```

继续断言：验证码仅发给候选手机号、ticket 不能跨 user 使用、ticket 不能重放、手机号冲突在完成时再次检查、第二个并发成功绑定返回冲突、响应/`RecordingAudit.events` 不含手机号明文、验证码、当前密码或 ticket。

- [ ] **Step 2: 新增严格 DTO，不复用“已绑定账号验证”的 DTO。**

```ts
export class InitialPhoneBindStartDto {
  @IsString()
  @MinLength(1)
  @MaxLength(72)
  currentPassword!: string

  @Matches(/^1[3-9]\d{9}$/, { message: '必须是有效的中国大陆手机号' })
  phone!: string

  @IsOptional()
  @IsString()
  @MaxLength(128)
  deviceId?: string
}

export class InitialPhoneBindVerifyDto {
  @IsString()
  @MinLength(16)
  @MaxLength(128)
  bindTicket!: string

  @Matches(/^\d{6}$/, { message: '必须是 6 位数字验证码' })
  code!: string
}
```

- [ ] **Step 3: 新增两个被 `JwtAuthGuard` 保护的端点，保持旧端点语义不变。**

```ts
@Post('phone/initial-bind/start')
@UseGuards(JwtAuthGuard)
@Throttle({ default: { ttl: 60_000, limit: 5 } })
async startInitialPhoneBind(@CurrentUser() user: AuthedUser, @Body() dto: InitialPhoneBindStartDto, @Ip() ip: string) {
  return ApiResponse.ok(await this.authService.startInitialPhoneBind(user.userId, dto.currentPassword, dto.phone, ip, dto.deviceId))
}

@Post('phone/initial-bind/verify')
@UseGuards(JwtAuthGuard)
@Throttle({ default: { ttl: 60_000, limit: 5 } })
async completeInitialPhoneBind(@CurrentUser() user: AuthedUser, @Body() dto: InitialPhoneBindVerifyDto) {
  return ApiResponse.ok(await this.authService.completeInitialPhoneBind(user.userId, dto.bindTicket, dto.code))
}
```

旧 `/auth/phone/code` 和 `/auth/phone/verify` 不得接受候选手机号参数。

- [ ] **Step 4: 在 `AuthService` 实现带 user namespace 的一次性 ticket 和 CAS 持久化。**

新增 `INITIAL_PHONE_BIND_TICKET_TTL = 600`，并使用下列 key 规则：

```ts
private initialPhoneBindTicketKey(userId: string, ticket: string): string {
  return `internal:phone-initial-bind:ticket:${userId}:${ticket}`
}
```

`startInitialPhoneBind` 必须按顺序完成：读取 `findUsableSelfPhoneUser` → 拒绝已有 `phoneEnc` → `bcrypt.compare(currentPassword, user.passwordHash)` → 规范化手机号 → 预检 `phoneHash` 冲突 → 经现有 `InternalOtpService.sendCode({ purpose: 'bind_phone', shouldDeliver: true })` 发码 → 生成随机 UUID ticket → 用 `encryptPhone(normalized)` 写入该 user namespace key 的 Redis TTL → 只审计 `phoneMasked`。

`completeInitialPhoneBind` 必须按顺序完成：`redis.getDel` 读取 ticket（不存在返回 `PHONE_BIND_TICKET_INVALID`）→ 解密候选手机号 → `otp.verifyCode(phone, 'bind_phone', code)` → 再次查同手机号冲突 → `prisma.user.updateMany({ where: { id: userId, phoneEnc: null }, data: { phoneHash, phoneEnc, phoneVerifiedAt: new Date() } })` → `count !== 1` 返回 `PHONE_BIND_CONFLICT` → 审计 `auth.phone_initial_bind_complete`（仅 mask）。

不得把明文手机号、验证码或 ticket 放进 audit payload；不得在 verify 请求中重新提交手机号；不得自动更改密码、角色、机构归属或 tokenVersion。

- [ ] **Step 5: 运行后端回归。**

Run:

```bash
INTERNAL_AUTH_VERIFY_TARGET=isolated pnpm --filter @ai-job-print/api verify:internal-auth-phone
pnpm --filter @ai-job-print/api typecheck
pnpm --filter @ai-job-print/api lint
pnpm --filter @ai-job-print/api db:pg:sync:check
git diff --check
```

Expected: 新绑定和既有预录手机号验证都通过；无 schema 漂移；拒绝分支及泄密检查通过。

### Task 4: 在 PR #230 合并后补 Admin 账号设置 UI

**Files:**

- Create: `apps/admin/src/routes/account-settings/PhoneBindingCard.tsx`
- Modify: `apps/admin/src/routes/account-settings/index.tsx`
- Modify: `apps/admin/src/services/auth/index.ts`

- [ ] **Step 1: 先为 API adapter 写最小协议。**

```ts
export async function startInitialPhoneBind(currentPassword: string, phone: string) {
  return postJson<{ bindTicket: string; cooldownSeconds: number; expiresInSeconds: number }>(
    '/auth/phone/initial-bind/start',
    { currentPassword, phone },
  )
}

export async function completeInitialPhoneBind(bindTicket: string, code: string) {
  return postJson<{ phoneMasked: string; phoneVerifiedAt: string }>(
    '/auth/phone/initial-bind/verify',
    { bindTicket, code },
  )
}
```

adapter 不得写 localStorage；沿用现有 `postJson` 的网络错误收口。

- [ ] **Step 2: 新建局部 `PhoneBindingCard`，不继续膨胀账号设置页。**

组件只在 `user?.phoneMasked` 为空时渲染，状态包含当前密码、候选手机号、验证码、一次性 ticket、冷却倒计时和错误信息。成功后调用现有 `mergeStoredUser({ phoneMasked, phoneVerifiedAt })`，清除当前密码、验证码和 ticket，并只显示脱敏手机号及“已验证”。

页面必须显示：`绑定手机号后，可用于短信登录和忘记密码。` 同时显示：`验证码、密码和绑定凭据不会保存到本机。`

禁止提供手机号换绑、解绑、账号注销、管理员创建、密码找回绕过或在浏览器控制台显示 ticket。

- [ ] **Step 3: 在 `AccountSettingsPage` 仅编排该组件。**

将当前只读的 `const [user] = useState(...)` 改为可控的
`const [user, setUser] = useState<AuthedUser | null>(...)`；`PhoneBindingCard`
只回传 `Pick<AuthedUser, 'phoneMasked' | 'phoneVerifiedAt'>`，由页面用不可变
合并更新当前用户，而不是把 `setUser` 整个暴露给子组件：

```tsx
{!user?.phoneMasked ? (
  <PhoneBindingCard
    onBound={(phone) => setUser((current) => current ? { ...current, ...phone } : current)}
  />
) : <BoundPhoneSummary user={user} />}
```

不调用 `window.location.reload()`，不自行拼 JWT，也不把密码、验证码或 ticket
放入 `AuthedUser`、localStorage 或 URL。

- [ ] **Step 4: 写 Admin 静态 verify 和浏览器用例。**

新增或扩展一个 `apps/admin/scripts/verify-account-settings.mjs`，至少断言：路由受 Admin shell 保护；页面只在未绑定时出现绑定卡；所有请求走 `/auth/phone/initial-bind/*`；无手机号明文、密码、验证码、ticket 的日志/持久化 API；已绑定账号不出现重复绑定入口。

真实浏览器验收仅在隔离预生产、测试 admin 与受控手机号中进行：错当前密码拒绝 → 短信验证码正确后成功 → 刷新 `GET /auth/me` 显示 mask/verified → 旧密码找回入口可发码；测试账号与记录按受控 runbook 清理。不得在生产用真实管理员做功能探索。

- [ ] **Step 5: 前端工程验证与独立 PR。**

Run:

```bash
pnpm --filter @ai-job-print/admin typecheck
pnpm --filter @ai-job-print/admin lint
pnpm --filter @ai-job-print/admin build
pnpm --filter @ai-job-print/admin verify:account-settings
git diff --check
```

提交为独立 `feat(admin): bind initial recovery phone`；该 PR 基线必须是已合入 #230 后的最新 `origin/main`，不堆叠在落后 100+ commit 的旧分支。

### Task 5: 部署与人为恢复操作（需要单独授权，不能自动执行）

**Files:**

- Modify after evidence only: `docs/progress/current-progress.md`
- Modify after evidence only: `docs/progress/next-tasks.md`

- [ ] **Step 1: 部署前只读门槛。**

确认目标 commit、GitHub 双 CI、迁移状态（本功能应为零 migration）、PM2 `NODE_ENV=production`、Redis 可用、SMS provider 状态、`/api/v1/health` 与 Admin 静态包版本一致。任何一项没有证据即停止，不做密码或手机号操作。

- [ ] **Step 2: 在真实管理员会话中执行自助改密。**

管理员本人在已部署的 `/account-settings` 输入当前密码和新生成的高熵密码。客户端/聊天中不传递密码。成功后确认所有旧会话失效、以新密码重新登录、Admin 审计存在 `auth.password_change_self` 且不含密码/hash。

- [ ] **Step 3: 在短信已批准且功能已部署后绑定恢复手机号。**

管理员本人输入当前新密码和其可控制手机号，完成 SMS 验证；确认 `/auth/me` 仅返回 mask/verified 时间，密码找回和短信登录仅对该已验证手机有效。若短信服务未审批，停在“密码已轮换、手机号待绑定”，不伪造短信验收。

- [ ] **Step 4: 更新事实文档，不扩大证据。**

只记录 commit、CI、部署 SHA、具体验收级别和剩余阻塞。不得记录密码、手机号、验证码、token、Redis key、审计完整 payload 或将“隔离预生产通过”写成“生产已完成”。

## 计划自检

- 范围覆盖：生产 verify 误用、PR #230 改密、未绑定手机号补绑、Admin UI、部署/真人验收均有独立任务。
- 安全边界：无生产 SQL/后门账号；所有运行时敏感操作均要求当前密码、JWT、OTP、Redis 一次性 ticket、CAS 和审计脱敏。
- 依赖顺序：先修 verify 安全，再整合改密，之后从新 `main` 开补绑分支；UI 不可先于 #230。
- 反堆砌：不引入新表/迁移/依赖；不改旧验证端点；UI 拆出局部组件，避免账号页超 300 行。
- 文档真值：只有真实 CI/部署/验收完成后才更新 progress 文档。
