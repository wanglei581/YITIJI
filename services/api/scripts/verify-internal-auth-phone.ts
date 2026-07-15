/**
 * 内部账号手机号认证验证。
 *
 * 覆盖:
 * 1. 用户名密码登录仍可用。
 * 2. 已验证手机号可作为密码登录账号。
 * 3. 未验证手机号不能登录、不能验证码登录。
 * 4. 短信登录不自动创建 User。
 * 5. partner 账号不能登录 admin portal。
 * 6. 机构停用后 partner 登录失败。
 * 7. 忘记密码验证码重置后旧 token 立即失效。
 * 8. 响应不含明文手机号或验证码。
 *
 * 运行时总是自建并清理 OS 临时 SQLite，不读取或写入调用方的 DATABASE_URL。
 */
import { ExecutionContext } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import * as bcrypt from 'bcryptjs'
import { validate } from 'class-validator'
import { execFileSync } from 'child_process'
import { randomUUID } from 'crypto'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import type { AuditService } from '../src/audit/audit.service'
import { AuthController } from '../src/auth/auth.controller'
import { AdminInitialPhoneBindService } from '../src/auth/admin-initial-phone-bind.service'
import { AuthService } from '../src/auth/auth.service'
import { InitialPhoneBindStartDto, InitialPhoneBindVerifyDto } from '../src/auth/dto/internal-auth.dto'
import { INTERNAL_OTP_CODE_TTL_SECONDS, InternalOtpService } from '../src/auth/internal-otp.service'
import { assertInternalAuthVerifyTarget } from '../src/auth/internal-auth-verify-target'
import { decryptPhone, encryptPhone, hashPhone, maskPhone } from '../src/common/crypto/phone-identity'
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard'
import type { RedisService } from '../src/common/redis/redis.service'
import { PrismaService, type PrismaTransactionClient } from '../src/prisma/prisma.service'
import type { SmsSender } from '../src/member-auth/sms/sms-sender'

process.env['JWT_SECRET'] ||= 'verify-internal-auth-phone-secret'
process.env['SECRET_ENCRYPTION_KEY'] ||= 'verify-internal-auth-phone-secret-32b'

function pass(m: string) { console.log(`  PASS ${m}`) }
function fail(m: string): never { console.error(`  FAIL ${m}`); process.exit(1) }

function errCode(e: unknown): string | undefined {
  const ex = e as { getResponse?: () => unknown; response?: unknown }
  const resp = (typeof ex.getResponse === 'function' ? ex.getResponse() : ex.response) as
    | { error?: { code?: string } } | undefined
  return resp?.error?.code
}

function errMessage(e: unknown): string | undefined {
  const ex = e as { getResponse?: () => unknown; response?: unknown }
  const resp = (typeof ex.getResponse === 'function' ? ex.getResponse() : ex.response) as
    | { error?: { message?: string } } | undefined
  return resp?.error?.message
}

async function expectCode(fn: () => Promise<unknown>, code: string, label: string): Promise<void> {
  try {
    await fn()
    fail(`${label} — 期望错误 ${code},但调用成功`)
  } catch (e) {
    const c = errCode(e)
    if (c === code) pass(label)
    else fail(`${label} — 期望 ${code},实际: ${c ?? (e as Error).message}`)
  }
}

async function expectCodeAndMessage(
  fn: () => Promise<unknown>,
  code: string,
  message: string,
  label: string,
): Promise<void> {
  try {
    await fn()
    fail(`${label} — 期望错误 ${code},但调用成功`)
  } catch (e) {
    const actualCode = errCode(e)
    const actualMessage = errMessage(e)
    if (actualCode === code && actualMessage === message) pass(label)
    else fail(`${label} — 期望 ${code}/${message},实际: ${actualCode ?? (e as Error).message}/${actualMessage ?? ''}`)
  }
}

function assertInitialPhoneBindRouteContract(): void {
  const source = readFileSync(resolve(__dirname, '../src/auth/auth.controller.ts'), 'utf8')
  const required = [
    "@Post('phone/initial-bind/start')",
    "@Post('phone/initial-bind/verify')",
    '@UseGuards(JwtAuthGuard, RolesGuard)',
    "@Roles('admin', 'partner')",
    'InitialPhoneBindStartDto',
    'InitialPhoneBindVerifyDto',
    'initialPhoneBindService.start',
    'initialPhoneBindService.verify',
  ]
  if (required.some((fragment) => !source.includes(fragment))) {
    fail('首次绑定路由缺少 JWT/角色保护、DTO 或服务接线')
  }
  pass('0a. 首次绑定路由具备 JWT、角色保护、DTO 与服务接线')
}

function assertAdminInitialPhoneBindRouteContract(): void {
  const source = readFileSync(resolve(__dirname, '../src/auth/auth.controller.ts'), 'utf8')
  const required = [
    "@Post('admin/phone/initial-bind/start')",
    "@Post('admin/phone/initial-bind/verify')",
    "@Roles('admin')",
    'adminInitialPhoneBindService.start',
    'adminInitialPhoneBindService.verify',
    "user.role === 'admin'",
    "user.role === 'partner'",
  ]
  if (required.some((fragment) => !source.includes(fragment)) || source.includes('dto.role')) {
    fail('管理员首次绑定路由缺少 Admin 专用保护或旧通用路由角色分派')
  }
  pass('0b. Admin 专用路由受 JWT/角色保护，旧通用路由按 JWT 角色分派')
}

function mockCtx(authHeader?: string): ExecutionContext {
  const req = { headers: authHeader ? { authorization: authHeader } : {} }
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext
}

class MemoryRedis {
  private readonly store = new Map<string, { value: string; expiresAt: number | null }>()
  private nowMs = 0
  readonly calls: string[] = []

  private read(key: string): string | null {
    const entry = this.store.get(key)
    if (!entry) return null
    if (entry.expiresAt !== null && entry.expiresAt <= this.nowMs) {
      this.store.delete(key)
      return null
    }
    return entry.value
  }

  get(key: string): Promise<string | null> {
    this.calls.push(`get:${key}`)
    return Promise.resolve(this.read(key))
  }

  getDel(key: string): Promise<string | null> {
    this.calls.push(`getDel:${key}`)
    const value = this.read(key)
    this.store.delete(key)
    return Promise.resolve(value)
  }

  getAndDelIfEquals(key: string, expectedValue: string): Promise<'missing' | 'matched' | 'mismatched'> {
    this.calls.push(`getAndDelIfEquals:${key}`)
    const value = this.read(key)
    if (!value) return Promise.resolve('missing')
    if (value !== expectedValue) return Promise.resolve('mismatched')
    this.store.delete(key)
    return Promise.resolve('matched')
  }

  async setEx(key: string, ttlSeconds: number, value: string): Promise<void> {
    this.calls.push(`setEx:${key}`)
    this.store.set(key, { value, expiresAt: this.nowMs + ttlSeconds * 1000 })
  }

  setJsonIfVersionNotOlder(
    key: string,
    _ttlSeconds: number,
    value: string,
    tokenVersion: number,
  ): Promise<'stored' | 'stale'> {
    const current = this.read(key)
    if (current) {
      const currentVersion = (JSON.parse(current) as { tokenVersion?: number }).tokenVersion
      if (typeof currentVersion === 'number' && currentVersion > tokenVersion) return Promise.resolve('stale')
    }
    this.store.set(key, { value, expiresAt: this.nowMs + _ttlSeconds * 1000 })
    return Promise.resolve('stored')
  }

  del(key: string): Promise<number> {
    this.calls.push(`del:${key}`)
    const existed = this.store.delete(key)
    return Promise.resolve(existed ? 1 : 0)
  }

  setNxEx(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    this.calls.push(`setNxEx:${key}`)
    if (this.read(key) !== null) return Promise.resolve(false)
    this.store.set(key, { value, expiresAt: this.nowMs + ttlSeconds * 1000 })
    return Promise.resolve(true)
  }

  incrWithTtl(key: string, _ttlSeconds: number): Promise<number> {
    const current = this.read(key)
    const next = Number(current ?? '0') + 1
    this.store.set(key, {
      value: String(next),
      expiresAt: current === null ? this.nowMs + _ttlSeconds * 1000 : this.store.get(key)?.expiresAt ?? null,
    })
    return Promise.resolve(next)
  }

  reserveWithinLimitWithTtl(key: string, _ttlSeconds: number, limit: number): Promise<boolean> {
    const existing = this.read(key)
    const current = Number(existing ?? '0')
    if (current >= limit) return Promise.resolve(false)
    this.store.set(key, {
      value: String(current + 1),
      expiresAt: existing === null ? this.nowMs + _ttlSeconds * 1000 : this.store.get(key)?.expiresAt ?? null,
    })
    return Promise.resolve(true)
  }

  releaseReservedLimit(key: string): Promise<void> {
    const current = Number(this.read(key) ?? '0')
    if (current <= 1) this.store.delete(key)
    else this.store.set(key, { value: String(current - 1), expiresAt: this.store.get(key)?.expiresAt ?? null })
    return Promise.resolve()
  }

  advanceSeconds(seconds: number): void {
    this.nowMs += seconds * 1000
  }

  clearCalls(): void {
    this.calls.splice(0)
  }

  raw(key: string): string | null {
    return this.read(key)
  }

  values(): string[] {
    return [...this.store.keys()].flatMap((key) => {
      const value = this.read(key)
      return value === null ? [] : [value]
    })
  }
}

class NoopSmsSender implements SmsSender {
  sent: Array<{ phone: string; code: string }> = []

  async sendCode(phone: string, code: string): Promise<void> {
    this.sent.push({ phone, code })
  }
}

class RecordingAudit {
  readonly entries: Parameters<AuditService['write']>[0][] = []

  async write(args: Parameters<AuditService['write']>[0]): Promise<string> {
    this.entries.push(args)
    return `verify-audit-${this.entries.length}`
  }
}

function createAuditFailingPrisma(prisma: PrismaService): PrismaService {
  return {
    get user() {
      return prisma.user
    },
    $transaction: async <T>(callback: (tx: PrismaTransactionClient) => Promise<T>) =>
      prisma.$transaction(async (tx) =>
        callback({
          user: tx.user,
          auditLog: {
            ...tx.auditLog,
            create: async () => {
              throw new Error('forced audit insert failure')
            },
          },
        } as PrismaTransactionClient),
      ),
  } as PrismaService
}

function createIsolatedVerificationDatabase(): { cleanup: () => void } {
  const tempDirectory = mkdtempSync(join(tmpdir(), 'verify-internal-auth-phone-'))
  const databasePath = join(tempDirectory, 'verify.db')
  const databaseUrl = `file:${databasePath}`
  process.env['DATABASE_URL'] = databaseUrl

  try {
    execFileSync('sqlite3', [
      databasePath,
      `
      PRAGMA foreign_keys = ON;
      CREATE TABLE "Organization" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "name" TEXT NOT NULL,
        "type" TEXT NOT NULL,
        "contact" TEXT,
        "contactPhone" TEXT,
        "sceneTemplate" TEXT,
        "enabledModulesJson" TEXT NOT NULL DEFAULT '[]',
        "enabled" BOOLEAN NOT NULL DEFAULT true,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE "User" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "username" TEXT NOT NULL,
        "passwordHash" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "role" TEXT NOT NULL,
        "orgId" TEXT,
        "phoneHash" TEXT,
        "phoneEnc" TEXT,
        "phoneVerifiedAt" DATETIME,
        "tokenVersion" INTEGER NOT NULL DEFAULT 0,
        "lastLoginAt" DATETIME,
        "enabled" BOOLEAN NOT NULL DEFAULT true,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "User_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE SET NULL ON UPDATE CASCADE
      );
      CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
      CREATE UNIQUE INDEX "User_phoneHash_key" ON "User"("phoneHash");
      CREATE INDEX "User_orgId_idx" ON "User"("orgId");
      CREATE INDEX "User_phoneVerifiedAt_idx" ON "User"("phoneVerifiedAt");
      CREATE TABLE "AuditLog" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "actorId" TEXT,
        "actorRole" TEXT NOT NULL,
        "action" TEXT NOT NULL,
        "targetType" TEXT NOT NULL,
        "targetId" TEXT,
        "payloadJson" TEXT NOT NULL DEFAULT '{}',
        "ipAddress" TEXT,
        "userAgent" TEXT,
        "requestId" TEXT,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
      );
      CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog"("actorId");
      CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");
      CREATE INDEX "AuditLog_targetType_targetId_idx" ON "AuditLog"("targetType", "targetId");
      CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
      `,
    ], {
      stdio: 'pipe',
    })
  } catch (error) {
    rmSync(tempDirectory, { recursive: true, force: true })
    throw error
  }
  return { cleanup: () => rmSync(tempDirectory, { recursive: true, force: true }) }
}

async function assertAdminInitialPhoneBindControllerDelegation(): Promise<void> {
  const genericCalls: string[] = []
  const strictCalls: string[] = []
  const generic = {
    async start(...args: unknown[]) {
      genericCalls.push(`start:${String(args[0])}`)
      return { bindTicket: 'generic-ticket', cooldownSeconds: 60, expiresInSeconds: 300 }
    },
    async verify(...args: unknown[]) {
      genericCalls.push(`verify:${String(args[0])}`)
      return { phoneMasked: '138****0000', phoneVerifiedAt: new Date(0).toISOString() }
    },
  }
  const strict = {
    async start(...args: unknown[]) {
      strictCalls.push(`start:${String(args[0])}`)
      return { bindTicket: 'strict-ticket', cooldownSeconds: 60, expiresInSeconds: 300 }
    },
    async verify(...args: unknown[]) {
      strictCalls.push(`verify:${String(args[0])}`)
      return { phoneMasked: '139****0000', phoneVerifiedAt: new Date(0).toISOString() }
    },
  }
  const controller = new AuthController({} as AuthService, generic as never, strict as never)
  const startDto = { currentPassword: 'VerifyPassword_123!', phone: '13900000000' } as InitialPhoneBindStartDto
  const verifyDto = { bindTicket: 'a'.repeat(16), code: '123456' } as InitialPhoneBindVerifyDto

  await controller.startInitialPhoneBind({ userId: 'controller-admin', role: 'admin', orgId: null }, startDto, '127.0.0.1')
  await controller.verifyInitialPhoneBind({ userId: 'controller-admin', role: 'admin', orgId: null }, verifyDto)
  await controller.startInitialPhoneBind({ userId: 'controller-partner', role: 'partner', orgId: 'org-controller' }, startDto, '127.0.0.1')
  await controller.verifyInitialPhoneBind({ userId: 'controller-partner', role: 'partner', orgId: 'org-controller' }, verifyDto)
  await controller.startAdminInitialPhoneBind({ userId: 'controller-admin', role: 'admin', orgId: null }, startDto, '127.0.0.1')
  await controller.verifyAdminInitialPhoneBind({ userId: 'controller-admin', role: 'admin', orgId: null }, verifyDto)

  if (
    strictCalls.join(',') !== 'start:controller-admin,verify:controller-admin,start:controller-admin,verify:controller-admin' ||
    genericCalls.join(',') !== 'start:controller-partner,verify:controller-partner'
  ) {
    fail('Admin/Partner 首次绑定控制器没有正确分派到严格/既有服务')
  }
  await expectCode(
    () => controller.startInitialPhoneBind({ userId: 'controller-kiosk', role: 'kiosk', orgId: null }, startDto, '127.0.0.1'),
    'AUTH_INITIAL_PHONE_BIND_UNAVAILABLE',
    '0c. kiosk 不能借旧通用首次绑定路由进入 Admin 严格状态机',
  )
  pass('0d. Admin 通用和专用路由委派严格服务，Partner 保留既有服务')
}

async function main() {
  const isolatedDatabase = createIsolatedVerificationDatabase()
  try {
    console.log('\n=== 内部账号手机号认证验证 ===')
    assertInternalAuthVerifyTarget(process.env)
    assertInitialPhoneBindRouteContract()
    assertAdminInitialPhoneBindRouteContract()
    if (INTERNAL_OTP_CODE_TTL_SECONDS !== 300) fail('0c. 内部 OTP 有效期未固定为 300 秒')
    pass('0c. 内部 OTP 使用统一的 300 秒导出常量')
    await assertAdminInitialPhoneBindControllerDelegation()

  const invalidInitialBindStart = await validate(Object.assign(new InitialPhoneBindStartDto(), {
    currentPassword: '',
    phone: 'not-a-phone',
  }))
  if (invalidInitialBindStart.length < 2) fail('0. 首次绑定开始 DTO 未拒绝空当前密码和非法手机号')
  const invalidInitialBindVerify = await validate(Object.assign(new InitialPhoneBindVerifyDto(), {
    bindTicket: 'too-short',
    code: 'bad',
  }))
  if (invalidInitialBindVerify.length < 2) fail('0a. 首次绑定确认 DTO 未拒绝短 ticket 和非法验证码')
  pass('0. 首次绑定 DTO 拒绝不安全输入')

  const [{ InitialPhoneBindService }] = await Promise.all([
    import('../src/auth/initial-phone-bind.service'),
  ])

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const audit = new RecordingAudit()
  const redis = new MemoryRedis()
  const sms = new NoopSmsSender()
  const otp = new InternalOtpService(redis as unknown as RedisService, sms)
  const jwt = new JwtService({ secret: process.env['JWT_SECRET'] })
  const auth = new AuthService(jwt, prisma, redis as unknown as RedisService, otp, audit as unknown as AuditService)
  const initialPhoneBind = new InitialPhoneBindService(
    prisma,
    redis as unknown as RedisService,
    otp,
    audit as unknown as AuditService,
    auth,
  )
  const adminInitialPhoneBind = new AdminInitialPhoneBindService(
    prisma,
    redis as unknown as RedisService,
    otp,
    audit as unknown as AuditService,
  )
  const guard = new JwtAuthGuard(jwt, prisma, redis as unknown as RedisService)

  const suffix = randomUUID().replace(/-/g, '').slice(0, 10)
  const base = Number(Date.now().toString().slice(-8))
  const phone = (prefix: string, n: number) => `${prefix}${String((base + n) % 100000000).padStart(8, '0')}`
  const verifiedPhone = phone('139', 1)
  const unverifiedPhone = phone('138', 2)
  const unknownPhone = phone('137', 3)
  const passwordV1 = `InitPass_${suffix}`
  const passwordV2 = `ResetPass_${suffix}`
  let orgId = ''

  const cleanup = async () => {
    await prisma.user.deleteMany({ where: { username: { contains: suffix } } }).catch(() => undefined)
    if (orgId) await prisma.organization.delete({ where: { id: orgId } }).catch(() => undefined)
  }

  try {
    const org = await prisma.organization.create({
      data: {
        id: `org_${suffix}`,
        name: `内部认证验证机构_${suffix}`,
        type: 'public_employment_service',
        sceneTemplate: 'public_employment',
        enabledModulesJson: '[]',
      },
    })
    orgId = org.id

    const verified = await prisma.user.create({
      data: {
        username: `via_partner_${suffix}`,
        passwordHash: await bcrypt.hash(passwordV1, 10),
        name: '验证机构账号',
        role: 'partner',
        orgId,
        phoneHash: hashPhone(verifiedPhone),
        phoneEnc: encryptPhone(verifiedPhone),
        phoneVerifiedAt: new Date(),
      },
    })
    await prisma.user.create({
      data: {
        username: `via_unverified_${suffix}`,
        passwordHash: await bcrypt.hash(passwordV1, 10),
        name: '未验证机构账号',
        role: 'partner',
        orgId,
        phoneHash: hashPhone(unverifiedPhone),
        phoneEnc: encryptPhone(unverifiedPhone),
      },
    })

    const unboundAdmin = await prisma.user.create({
      data: {
        username: `via_initial_admin_${suffix}`,
        passwordHash: await bcrypt.hash(passwordV1, 10),
        name: '未绑定管理员账号',
        role: 'admin',
        tokenVersion: 7,
      },
    })
    const unboundPartner = await prisma.user.create({
      data: {
        username: `via_initial_partner_${suffix}`,
        passwordHash: await bcrypt.hash(passwordV1, 10),
        name: '未绑定合作机构账号',
        role: 'partner',
        orgId,
        tokenVersion: 8,
      },
    })
    const strictTicketKey = (userId: string, ticket: string) => `internal:admin:phone-initial-bind:ticket:${userId}:${ticket}`
    const strictActiveKey = (userId: string) => `internal:admin:phone-initial-bind:active:${userId}`
    const strictPasswordFailuresKey = (userId: string) => `internal:admin:phone-initial-bind:password-fail:${userId}`
    const createStrictAdmin = async (label: string, tokenVersion = 0, enabled = true) => {
      return prisma.user.create({
        data: {
          username: `via_strict_${label}_${suffix}`,
          passwordHash: await bcrypt.hash(passwordV1, 10),
          name: `严格绑定验证_${label}`,
          role: 'admin',
          tokenVersion,
          enabled,
        },
      })
    }

    const byUsername = await auth.login(verified.username, passwordV1, 'partner')
    if (!byUsername.token || byUsername.user.orgId !== orgId) fail('1. 用户名密码登录失败')
    pass('1. 用户名密码登录仍可用')

    const byPhone = await auth.login(verifiedPhone, passwordV1, 'partner')
    if (JSON.stringify(byPhone).includes(verifiedPhone)) fail('2. 手机号登录响应泄露明文手机号')
    pass('2. 已验证手机号可作为密码登录账号,且响应不含明文手机号')

    await expectCode(() => auth.login(unverifiedPhone, passwordV1, 'partner'), 'AUTH_LOGIN_FAILED', '3. 未验证手机号不能密码登录')
    await expectCode(() => auth.login(verified.username, passwordV1, 'admin'), 'AUTH_LOGIN_FAILED', '4. partner 账号不能登录 admin portal')

    await auth.sendSmsCode({ phone: verifiedPhone, purpose: 'login', portal: 'partner' }, '127.0.0.1')
    const loginCode = await redis.get(`internal:sms:code:login:${hashPhone(verifiedPhone)}`)
    if (!loginCode) fail('5. 未写入登录验证码')
    const smsLogin = await auth.loginWithSms(verifiedPhone, loginCode, 'partner')
    const smsRaw = JSON.stringify(smsLogin)
    if (smsRaw.includes(verifiedPhone) || smsRaw.includes(loginCode)) fail('5. 短信登录响应泄露手机号或验证码')
    pass('5. 已验证手机号验证码登录成功,响应不泄密')

    await auth.sendSmsCode({ phone: unknownPhone, purpose: 'login', portal: 'partner' }, '127.0.0.1')
    const unknownCode = await redis.get(`internal:sms:code:login:${hashPhone(unknownPhone)}`)
    const unknownUserCount = await prisma.user.count({ where: { phoneHash: hashPhone(unknownPhone) } })
    if (unknownCode || unknownUserCount !== 0) fail('6. 未授权手机号被写入验证码或自动建号')
    pass('6. 未授权手机号短信登录不自动创建 User,也不写可用验证码')

    const unknownUsername = `missing_${suffix}`
    await auth.startPasswordReset(unknownUsername, '127.0.0.2')
    await expectCode(
      () => auth.startPasswordReset(unknownUsername, '127.0.0.2'),
      'SMS_TOO_FREQUENT',
      '6a. 未知用户名重复找回同样进入冷却',
    )

    await prisma.organization.update({ where: { id: orgId }, data: { enabled: false } })
    await expectCode(() => auth.login(verified.username, passwordV1, 'partner'), 'AUTH_LOGIN_FAILED', '7. 机构停用后密码登录失败')
    await prisma.organization.update({ where: { id: orgId }, data: { enabled: true } })

    const oldToken = byUsername.token
    await auth.startPasswordReset(verifiedPhone, '127.0.0.1')
    const resetCode = await redis.get(`internal:sms:code:reset_password:${hashPhone(verifiedPhone)}`)
    if (!resetCode) fail('8. 未写入重置验证码')
    const wrongResetCode = resetCode === '000000' ? '111111' : '000000'
    await expectCode(
      () => auth.verifyPasswordReset(verifiedPhone, wrongResetCode),
      'AUTH_RESET_FAILED',
      '8a. 已存在账号重置验证码错误码归一',
    )
    await expectCode(
      () => auth.verifyPasswordReset(unknownPhone, '000000'),
      'AUTH_RESET_FAILED',
      '8b. 未授权账号重置验证码错误码归一',
    )
    const { resetTicket } = await auth.verifyPasswordReset(verifiedPhone, resetCode)
    await auth.completePasswordReset(resetTicket, passwordV2)
    await expectCode(() => auth.login(verified.username, passwordV1, 'partner'), 'AUTH_LOGIN_FAILED', '8c. 重置后旧密码失效')
    await auth.login(verified.username, passwordV2, 'partner')
    pass('8d. 重置后新密码可登录')
    await expectCode(
      () => guard.canActivate(mockCtx(`Bearer ${oldToken}`)),
      'AUTH_TOKEN_INVALID',
      '8e. 重置密码后旧 token 立即失效',
    )

    await expectCode(
      () => auth.sendOwnPhoneBindCode(unboundAdmin.id, '127.0.0.1'),
      'PHONE_NOT_BOUND',
      '8f. 旧 phone/code 对未绑定账号仍拒绝，不作为首次绑定旁路',
    )
    await expectCode(
      () => auth.verifyOwnPhoneBindCode(unboundAdmin.id, '123456'),
      'PHONE_NOT_BOUND',
      '8g. 旧 phone/verify 对未绑定账号仍拒绝，不作为首次绑定旁路',
    )

    const unavailable = 'AUTH_INITIAL_PHONE_BIND_UNAVAILABLE'
    const disabledAdmin = await createStrictAdmin('disabled', 1, false)
    const partialAdmin = await createStrictAdmin('partial', 2)
    await prisma.user.update({ where: { id: partialAdmin.id }, data: { phoneHash: hashPhone(phone('130', 20)) } })
    const kiosk = await prisma.user.create({
      data: { username: `via_strict_kiosk_${suffix}`, passwordHash: await bcrypt.hash(passwordV1, 10), name: '终端账号', role: 'kiosk' },
    })
    for (const [label, userId] of [
      ['不存在用户', `missing_${suffix}`],
      ['partner 用户', unboundPartner.id],
      ['kiosk 用户', kiosk.id],
      ['禁用管理员', disabledAdmin.id],
      ['手机号状态不完整管理员', partialAdmin.id],
    ]) {
      await expectCode(
        () => adminInitialPhoneBind.start(userId, passwordV1, phone('130', 21), '127.0.0.1'),
        unavailable,
        `9.${label} 只能得到统一的严格绑定不可用错误`,
      )
    }

    const rateAdmin = await createStrictAdmin('rate')
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await expectCode(
        () => adminInitialPhoneBind.start(rateAdmin.id, 'wrong-password', phone('130', 30 + attempt), '127.0.0.1'),
        unavailable,
        `10.${attempt}. 管理员错误当前密码保留失败额度`,
      )
    }
    await expectCode(
      () => adminInitialPhoneBind.start(rateAdmin.id, 'wrong-password', phone('130', 36), '127.0.0.1'),
      unavailable,
      '10.6 管理员第六次错误密码仍得到统一错误',
    )
    if (redis.raw(strictPasswordFailuresKey(rateAdmin.id)) !== '5') fail('10. 错误当前密码没有严格按 5/300 计数')
    redis.advanceSeconds(300)
    const afterPasswordTtl = await adminInitialPhoneBind.start(rateAdmin.id, passwordV1, phone('130', 37), '127.0.0.1')
    if (redis.raw(strictPasswordFailuresKey(rateAdmin.id)) || afterPasswordTtl.expiresInSeconds !== 300) {
      fail('10. 当前密码失败 TTL 过期或密码成功释放额度行为不正确')
    }
    pass('10. 严格服务对当前密码执行 5 次/300 秒失败限流，成功后释放额度')

    const collisionAdmin = await createStrictAdmin('collision')
    await expectCode(
      () => adminInitialPhoneBind.start(collisionAdmin.id, passwordV1, verifiedPhone, '127.0.0.1'),
      unavailable,
      '11. 管理员候选手机号已占用时不泄露冲突状态',
    )
    if (redis.raw(strictActiveKey(collisionAdmin.id))) fail('11. 候选手机号预检查失败仍创建了活跃 ticket')

    const ticketAdmin = await createStrictAdmin('ticket', 11)
    const ticketPhone = phone('136', 40)
    const firstTicket = await adminInitialPhoneBind.start(ticketAdmin.id, passwordV1, ticketPhone, '127.0.0.1', 'verify-admin-device')
    const ticketCode = await redis.get(`internal:sms:code:bind_phone:${hashPhone(ticketPhone)}`)
    const ticketRaw = redis.raw(strictTicketKey(ticketAdmin.id, firstTicket.bindTicket))
    if (!ticketCode || !ticketRaw) fail('12. 严格服务没有写入一次性 ticket 或 OTP')
    const ticketPayload = JSON.parse(ticketRaw) as Record<string, unknown>
    if (
      JSON.stringify(Object.keys(ticketPayload).sort()) !== JSON.stringify(['encryptedPhone', 'phoneHash', 'tokenVersion', 'userId']) ||
      ticketPayload.userId !== ticketAdmin.id ||
      ticketPayload.tokenVersion !== 11 ||
      typeof ticketPayload.encryptedPhone !== 'string' ||
      decryptPhone(ticketPayload.encryptedPhone) !== ticketPhone ||
      ticketRaw.includes(ticketPhone) ||
      JSON.stringify(firstTicket).includes(ticketPhone) ||
      JSON.stringify(audit.entries.at(-1)).includes(ticketPhone)
    ) {
      fail('12. 严格 ticket 结构、加密存储或脱敏审计不符合约束')
    }
    await expectCode(
      () => adminInitialPhoneBind.start(ticketAdmin.id, passwordV1, phone('136', 41), '127.0.0.1'),
      unavailable,
      '12a. 同一管理员只能保有一个活跃 ticket',
    )
    const wrongTicketCode = ticketCode === '000000' ? '111111' : '000000'
    await expectCode(
      () => adminInitialPhoneBind.verify(ticketAdmin.id, firstTicket.bindTicket, wrongTicketCode),
      unavailable,
      '12b. 错误 OTP 返回统一错误并烧毁 ticket',
    )
    if (redis.raw(strictTicketKey(ticketAdmin.id, firstTicket.bindTicket)) || redis.raw(strictActiveKey(ticketAdmin.id))) {
      fail('12b. 错误 OTP 后 ticket 或活跃标记未销毁')
    }
    await expectCode(
      () => adminInitialPhoneBind.verify(ticketAdmin.id, firstTicket.bindTicket, ticketCode),
      unavailable,
      '12c. 严格 ticket 不能重放',
    )
    pass('12. 严格 ticket 仅存加密手机号、单活跃、错误 OTP 消耗且不可重放')

    const auditFailureAdmin = await createStrictAdmin('audit-failure')
    const auditFailurePhone = phone('135', 49)
    const auditFailureStart = await adminInitialPhoneBind.start(auditFailureAdmin.id, passwordV1, auditFailurePhone, '127.0.0.1')
    const auditFailureCode = await redis.get(`internal:sms:code:bind_phone:${hashPhone(auditFailurePhone)}`)
    if (!auditFailureCode) fail('13. 审计失败场景未写入 OTP')
    const auditFailureService = new AdminInitialPhoneBindService(
      createAuditFailingPrisma(prisma),
      redis as unknown as RedisService,
      otp,
      audit as unknown as AuditService,
    )
    await expectCode(
      () => auditFailureService.verify(auditFailureAdmin.id, auditFailureStart.bindTicket, auditFailureCode),
      unavailable,
      '13. 完成审计写入失败时必须回滚管理员首次绑定',
    )
    const auditFailureAfter = await prisma.user.findUniqueOrThrow({ where: { id: auditFailureAdmin.id } })
    if (auditFailureAfter.phoneHash || auditFailureAfter.phoneEnc || auditFailureAfter.phoneVerifiedAt) {
      fail('13. 完成审计写入失败后管理员手机号字段没有回滚')
    }
    pass('13. 完成审计写入失败会回滚管理员手机号绑定')

    const successfulAdmin = await createStrictAdmin('success', 17)
    const successPhone = phone('135', 50)
    const successfulStart = await adminInitialPhoneBind.start(successfulAdmin.id, passwordV1, successPhone, '127.0.0.1')
    const successCode = await redis.get(`internal:sms:code:bind_phone:${hashPhone(successPhone)}`)
    if (!successCode) fail('13. 严格成功场景未写入 OTP')
    const successfulResult = await adminInitialPhoneBind.verify(successfulAdmin.id, successfulStart.bindTicket, successCode)
    const boundAdmin = await prisma.user.findUniqueOrThrow({ where: { id: successfulAdmin.id } })
    const completionAudit = await prisma.auditLog.findFirst({
      where: { actorId: successfulAdmin.id, action: 'auth.phone_initial_bind_complete' },
      orderBy: { createdAt: 'desc' },
    })
    const strictAuditRaw = JSON.stringify([audit.entries.slice(-2), completionAudit])
    if (
      successfulResult.phoneMasked !== maskPhone(successPhone) ||
      !boundAdmin.phoneVerifiedAt ||
      boundAdmin.phoneHash !== hashPhone(successPhone) ||
      !boundAdmin.phoneEnc ||
      boundAdmin.tokenVersion !== 17 ||
      completionAudit?.payloadJson !== JSON.stringify({ phoneMasked: maskPhone(successPhone) }) ||
      [successPhone, passwordV1, successCode, successfulStart.bindTicket, hashPhone(successPhone), boundAdmin.phoneEnc]
        .some((secret) => JSON.stringify(successfulResult).includes(secret) || strictAuditRaw.includes(secret))
    ) {
      fail('13. 严格成功绑定没有用 CAS 写入三字段，或响应/审计泄露了敏感数据')
    }
    pass('13. 严格成功绑定保留 tokenVersion，响应和审计只含脱敏手机号')

    const expiredAdmin = await createStrictAdmin('expired')
    const expiredPhone = phone('134', 60)
    const expiredStart = await adminInitialPhoneBind.start(expiredAdmin.id, passwordV1, expiredPhone, '127.0.0.1')
    redis.advanceSeconds(300)
    redis.clearCalls()
    await expectCode(
      () => adminInitialPhoneBind.verify(expiredAdmin.id, expiredStart.bindTicket, '123456'),
      unavailable,
      '14. ticket TTL 过期返回统一错误',
    )
    if (redis.calls.some((call) => call.startsWith(`getAndDelIfEquals:${strictActiveKey(expiredAdmin.id)}`))) {
      fail('14. ticket 缺失时错误读取或消耗了活跃标记')
    }

    const conflictAdmin = await createStrictAdmin('p2002', 23)
    const conflictPhone = phone('133', 70)
    const conflictStart = await adminInitialPhoneBind.start(conflictAdmin.id, passwordV1, conflictPhone, '127.0.0.1')
    const conflictCode = await redis.get(`internal:sms:code:bind_phone:${hashPhone(conflictPhone)}`)
    if (!conflictCode) fail('15. P2002 场景未写入 OTP')
    await prisma.user.create({
      data: {
        username: `via_strict_owner_${suffix}`,
        passwordHash: await bcrypt.hash(passwordV1, 10),
        name: '手机号竞争账号',
        role: 'admin',
        phoneHash: hashPhone(conflictPhone),
        phoneEnc: encryptPhone(conflictPhone),
        phoneVerifiedAt: new Date(),
      },
    })
    await expectCode(
      () => adminInitialPhoneBind.verify(conflictAdmin.id, conflictStart.bindTicket, conflictCode),
      unavailable,
      '15. 手机号唯一冲突 P2002 不泄露为具体状态',
    )

    const tokenVersionAdmin = await createStrictAdmin('token-version', 29)
    const versionPhone = phone('132', 80)
    const versionStart = await adminInitialPhoneBind.start(tokenVersionAdmin.id, passwordV1, versionPhone, '127.0.0.1')
    const versionCode = await redis.get(`internal:sms:code:bind_phone:${hashPhone(versionPhone)}`)
    if (!versionCode) fail('16. tokenVersion 场景未写入 OTP')
    await prisma.user.update({ where: { id: tokenVersionAdmin.id }, data: { tokenVersion: 30 } })
    await expectCode(
      () => adminInitialPhoneBind.verify(tokenVersionAdmin.id, versionStart.bindTicket, versionCode),
      unavailable,
      '16. tokenVersion 变化使旧 ticket 失效',
    )
    const versionAfter = await prisma.user.findUniqueOrThrow({ where: { id: tokenVersionAdmin.id } })
    if (versionAfter.phoneHash || versionAfter.phoneEnc || versionAfter.phoneVerifiedAt || versionAfter.tokenVersion !== 30) {
      fail('16. tokenVersion CAS 失败后仍覆盖了手机号字段')
    }

    const concurrentAdmin = await createStrictAdmin('concurrent')
    const concurrentPhone = phone('131', 90)
    const sentBeforeConcurrent = sms.sent.length
    const concurrentStarts = await Promise.allSettled([
      adminInitialPhoneBind.start(concurrentAdmin.id, passwordV1, concurrentPhone, '127.0.0.1'),
      adminInitialPhoneBind.start(concurrentAdmin.id, passwordV1, concurrentPhone, '127.0.0.1'),
    ])
    const concurrentSuccesses = concurrentStarts.filter((result): result is PromiseFulfilledResult<typeof firstTicket> => result.status === 'fulfilled')
    const concurrentFailures = concurrentStarts.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (
      concurrentSuccesses.length !== 1 ||
      concurrentFailures.length !== 1 ||
      errCode(concurrentFailures[0]?.reason) !== unavailable ||
      sms.sent.length !== sentBeforeConcurrent + 1 ||
      redis.raw(strictActiveKey(concurrentAdmin.id)) !== concurrentSuccesses[0]?.value.bindTicket
    ) {
      fail('17. 并发首次绑定没有维持单 ticket、单 OTP 的原子约束')
    }
    pass('14-17. TTL、P2002、tokenVersion CAS 与并发开始均按严格状态机收口')

    const partnerPhone = phone('130', 100)
    const partnerStart = await initialPhoneBind.start(unboundPartner.id, passwordV1, partnerPhone, '127.0.0.1')
    const partnerCode = await redis.get(`internal:sms:code:bind_phone:${hashPhone(partnerPhone)}`)
    if (!partnerCode) fail('18. Partner 既有首次绑定没有写入 OTP')
    const partnerResult = await initialPhoneBind.verify(unboundPartner.id, partnerStart.bindTicket, partnerCode)
    const boundPartner = await prisma.user.findUniqueOrThrow({ where: { id: unboundPartner.id } })
    if (partnerResult.phoneMasked !== maskPhone(partnerPhone) || !boundPartner.phoneVerifiedAt || boundPartner.tokenVersion !== 8) {
      fail('18. Admin 收紧改动破坏了 Partner 既有首次绑定闭环')
    }
    pass('18. Partner 仍使用主线 InitialPhoneBindService，既有闭环未退化')
  } finally {
    await cleanup()
    await prisma.onModuleDestroy()
  }

    console.log('\n内部账号手机号认证验证完成。')
  } finally {
    isolatedDatabase.cleanup()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
