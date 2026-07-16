/**
 * Admin–Partner 手机号安全转移 RED 契约。
 *
 * 本脚本只在进程内生成手机号和凭据，总是自建并清理 OS 临时 SQLite；
 * 不读取调用方数据库、不连接共享/生产环境，也不调用真实短信发送器。
 */
import type { ExecutionContext } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import * as bcrypt from 'bcryptjs'
import { execFileSync } from 'child_process'
import { randomBytes, randomInt, randomUUID } from 'crypto'
import { existsSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { AuditService } from '../src/audit/audit.service'
import { AdminInitialPhoneBindService } from '../src/auth/admin-initial-phone-bind.service'
import { InternalOtpService } from '../src/auth/internal-otp.service'
import { assertInternalAuthVerifyTarget } from '../src/auth/internal-auth-verify-target'
import { encryptPhone, hashPhone, maskPhone } from '../src/common/crypto/phone-identity'
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard'
import type { RedisService } from '../src/common/redis/redis.service'
import type { SmsSender } from '../src/member-auth/sms/sms-sender'
import { PrismaService } from '../src/prisma/prisma.service'

process.env['JWT_SECRET'] ||= randomBytes(32).toString('hex')
process.env['SECRET_ENCRYPTION_KEY'] ||= randomBytes(32).toString('hex')

const SESSION_TTL_SECONDS = 60
const UNAVAILABLE = 'AUTH_PHONE_TRANSFER_UNAVAILABLE'
const generatedPhones = new Set<string>()

class VerificationFailure extends Error {
  constructor(message: string) {
    super(`VERIFY_ASSERTION_FAILED: ${message}`)
    this.name = 'VerificationFailure'
  }
}

function pass(message: string): void {
  console.log(`  PASS ${message}`)
}

function fail(message: string): never {
  throw new VerificationFailure(message)
}

function ensure(condition: unknown, message: string): asserts condition {
  if (!condition) fail(message)
}

function errorCode(error: unknown): string | undefined {
  const exception = error as { getResponse?: () => unknown; response?: unknown }
  const response = (typeof exception.getResponse === 'function' ? exception.getResponse() : exception.response) as
    | { error?: { code?: string } }
    | undefined
  return response?.error?.code
}

async function expectCode(operation: () => Promise<unknown>, code: string, message: string): Promise<void> {
  let rejected = false
  let rejection: unknown
  try {
    await operation()
  } catch (error) {
    rejected = true
    rejection = error
  }
  if (!rejected) fail(`${message}：期望失败但调用成功`)
  if (errorCode(rejection) !== code) fail(`${message}：错误码不符合契约`)
}

function assertFailureUnwindsCleanup(): void {
  const probeDirectory = mkdtempSync(join(tmpdir(), 'verify-phone-transfer-cleanup-probe-'))
  let assertionObserved = false
  let assertionFinallyRan = false
  try {
    try {
      fail('受控 cleanup 自检')
    } finally {
      assertionFinallyRan = true
      rmSync(probeDirectory, { recursive: true, force: true })
    }
  } catch (error) {
    assertionObserved = error instanceof VerificationFailure
  } finally {
    rmSync(probeDirectory, { recursive: true, force: true })
  }
  ensure(assertionObserved && assertionFinallyRan && !existsSync(probeDirectory), '0. 失败断言未经过 finally cleanup')
  pass('0a. 失败断言通过异常栈展开执行 finally cleanup')
}

function mockContext(token: string): ExecutionContext {
  const request = { headers: { authorization: `Bearer ${token}` } }
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext
}

class CapturingSmsSender implements SmsSender {
  lastCode: string | null = null
  deliveries = 0

  async sendCode(_phone: string, code: string): Promise<void> {
    this.lastCode = code
    this.deliveries += 1
  }
}

class MemoryRedis {
  private readonly store = new Map<string, { value: string; expiresAt: number | null }>()
  private readonly failingVersionedWrites = new Set<string>()
  private nowMs = 0

  private read(key: string): string | null {
    const entry = this.store.get(key)
    if (!entry) return null
    if (entry.expiresAt !== null && entry.expiresAt <= this.nowMs) {
      this.store.delete(key)
      return null
    }
    return entry.value
  }

  async get(key: string): Promise<string | null> {
    return this.read(key)
  }

  async setEx(key: string, ttlSeconds: number, value: string): Promise<void> {
    this.store.set(key, { value, expiresAt: this.nowMs + ttlSeconds * 1000 })
  }

  async setNxEx(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    if (this.read(key) !== null) return false
    this.store.set(key, { value, expiresAt: this.nowMs + ttlSeconds * 1000 })
    return true
  }

  async incrWithTtl(key: string, ttlSeconds: number): Promise<number> {
    const existing = this.read(key)
    const next = Number(existing ?? '0') + 1
    this.store.set(key, {
      value: String(next),
      expiresAt: existing === null ? this.nowMs + ttlSeconds * 1000 : this.store.get(key)?.expiresAt ?? null,
    })
    return next
  }

  async del(key: string): Promise<number> {
    if (this.read(key) === null) return 0
    this.store.delete(key)
    return 1
  }

  async getAndDelIfEquals(
    key: string,
    expected: string,
  ): Promise<'missing' | 'matched' | 'mismatched'> {
    const current = this.read(key)
    if (current === null) return 'missing'
    if (current !== expected) return 'mismatched'
    this.store.delete(key)
    return 'matched'
  }

  async reserveWithinLimitWithTtl(key: string, ttlSeconds: number, limit: number): Promise<boolean> {
    const existing = this.read(key)
    const current = Number(existing ?? '0')
    if (current >= limit) return false
    this.store.set(key, {
      value: String(current + 1),
      expiresAt: existing === null ? this.nowMs + ttlSeconds * 1000 : this.store.get(key)?.expiresAt ?? null,
    })
    return true
  }

  async releaseReservedLimit(key: string): Promise<void> {
    const existing = this.read(key)
    const current = Number(existing ?? '0')
    if (current <= 0) return
    if (current === 1) {
      this.store.delete(key)
      return
    }
    this.store.set(key, {
      value: String(current - 1),
      expiresAt: this.store.get(key)?.expiresAt ?? null,
    })
  }

  async setJsonIfVersionNotOlder(
    key: string,
    ttlSeconds: number,
    value: string,
    tokenVersion: number,
  ): Promise<'stored' | 'stale'> {
    if (this.failingVersionedWrites.delete(key)) throw new Error('simulated versioned cache write failure')
    const current = this.read(key)
    if (current) {
      try {
        const parsed = JSON.parse(current) as { tokenVersion?: unknown }
        if (typeof parsed.tokenVersion === 'number' && parsed.tokenVersion > tokenVersion) return 'stale'
      } catch {
        // 生产 Lua 对不可解析 JSON 同样采用覆盖写入。
      }
    }
    this.store.set(key, { value, expiresAt: this.nowMs + ttlSeconds * 1000 })
    return 'stored'
  }

  failNextVersionedWrite(key: string): void {
    this.failingVersionedWrites.add(key)
  }

  advanceSeconds(seconds: number): void {
    this.nowMs += seconds * 1000
  }

  raw(key: string): string | null {
    return this.read(key)
  }
}

type RecordedAudit = {
  actorId?: string | null
  actorRole: string
  action: string
  targetType: string
  targetId?: string | null
  payload?: Record<string, unknown>
}

class RecordingAudit {
  readonly entries: RecordedAudit[] = []

  async write(entry: RecordedAudit): Promise<string> {
    this.entries.push({ ...entry, payload: { ...(entry.payload ?? {}) } })
    return `verify-transfer-audit-${this.entries.length}`
  }
}

type TransferStartResult = {
  bindTicket: string
  cooldownSeconds: number
  expiresInSeconds: number
  sourceAccount: { username: string; organizationName: string; phoneMasked: string }
}

type AdminPhoneTransferContract = {
  start(adminId: string, currentPassword: string, phone: string, ip: string, deviceId?: string): Promise<TransferStartResult>
  verify(adminId: string, bindTicket: string, code: string): Promise<{ phoneMasked: string; phoneVerifiedAt: string }>
  cancel(adminId: string, bindTicket: string): Promise<{ cancelled: true }>
}

type AdminPhoneTransferConstructor = new (
  prisma: PrismaService,
  redis: RedisService,
  otp: InternalOtpService,
  audit: AuditService,
) => AdminPhoneTransferContract

function prepareIsolatedDatabase(): {
  databasePath: string
  initialize: () => void
  cleanup: () => void
} {
  const previousDatabaseUrl = process.env['DATABASE_URL']
  const tempDirectory = mkdtempSync(join(tmpdir(), 'verify-admin-phone-transfer-'))
  const databasePath = join(tempDirectory, 'verify.db')
  process.env['DATABASE_URL'] = `file:${databasePath}`

  return {
    databasePath,
    initialize: () => {
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
      ], { stdio: 'pipe' })
    },
    cleanup: () => {
      if (previousDatabaseUrl === undefined) delete process.env['DATABASE_URL']
      else process.env['DATABASE_URL'] = previousDatabaseUrl
      rmSync(tempDirectory, { recursive: true, force: true })
    },
  }
}

async function assertHarnessReady(prisma: PrismaService): Promise<void> {
  ensure(prisma.dbKind === 'sqlite', '0. 隔离 harness 未使用 SQLite')
  ensure((await prisma.user.count()) === 0, '0. 临时数据库不是空库')

  const redis = new MemoryRedis()
  await redis.setEx('ttl', 2, 'v')
  ensure((await redis.get('ttl')) === 'v', '0. MemoryRedis get/setEx 语义错误')
  ensure(!(await redis.setNxEx('ttl', 'other', 2)), '0. MemoryRedis setNxEx 未保持 NX 原子语义')
  ensure((await redis.getAndDelIfEquals('ttl', 'other')) === 'mismatched', '0. MemoryRedis CAS mismatch 语义错误')
  ensure((await redis.getAndDelIfEquals('ttl', 'v')) === 'matched', '0. MemoryRedis CAS consume 语义错误')
  ensure((await redis.incrWithTtl('counter', 2)) === 1, '0. MemoryRedis 首次 INCR 错误')
  ensure((await redis.incrWithTtl('counter', 9)) === 2, '0. MemoryRedis 后续 INCR 错误')
  redis.advanceSeconds(2)
  ensure((await redis.get('counter')) === null, '0. MemoryRedis INCR 错误刷新了首次 TTL')
  ensure(await redis.reserveWithinLimitWithTtl('limit', 5, 1), '0. MemoryRedis 额度预约失败')
  ensure(!(await redis.reserveWithinLimitWithTtl('limit', 5, 1)), '0. MemoryRedis 额度上限不是原子的')
  await redis.releaseReservedLimit('limit')
  ensure(await redis.reserveWithinLimitWithTtl('limit', 5, 1), '0. MemoryRedis 额度释放后未恢复')
  await redis.setJsonIfVersionNotOlder('session', 5, JSON.stringify({ tokenVersion: 2 }), 2)
  ensure(
    (await redis.setJsonIfVersionNotOlder('session', 5, JSON.stringify({ tokenVersion: 1 }), 1)) === 'stale',
    '0. MemoryRedis 允许旧会话版本覆盖新版本',
  )
  ensure((await redis.del('session')) === 1, '0. MemoryRedis del 返回值错误')
  pass('0. 临时 SQLite、真实 Prisma 与 Redis 原子 harness 可用')
}

async function loadTransferService(): Promise<AdminPhoneTransferConstructor> {
  const modulePath = '../src/auth/admin-phone-transfer.service'
  try {
    const loaded = (await import(modulePath)) as Record<string, unknown>
    const candidate = loaded['AdminPhoneTransferService']
    ensure(typeof candidate === 'function', 'RED：AdminPhoneTransferService 导出不存在')
    return candidate as AdminPhoneTransferConstructor
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message.includes('admin-phone-transfer.service')) {
      throw new Error('RED_CONTRACT_TARGET_MISSING: admin-phone-transfer.service 尚不存在')
    }
    throw error
  }
}

type TestContext = {
  prisma: PrismaService
  redis: MemoryRedis
  sms: CapturingSmsSender
  otp: InternalOtpService
  audit: RecordingAudit
  jwt: JwtService
  guard: JwtAuthGuard
  Service: AdminPhoneTransferConstructor
  databasePath: string
  orgId: string
  orgName: string
  suffix: string
  adminPassword: string
  partnerPassword: string
  adminPasswordHash: string
  partnerPasswordHash: string
  nextPhone: () => string
}

function createService(
  context: TestContext,
  options: {
    prisma?: PrismaService
    redis?: MemoryRedis
    otp?: InternalOtpService
    audit?: RecordingAudit
  } = {},
): AdminPhoneTransferContract {
  return new context.Service(
    options.prisma ?? context.prisma,
    (options.redis ?? context.redis) as unknown as RedisService,
    options.otp ?? context.otp,
    (options.audit ?? context.audit) as unknown as AuditService,
  )
}

async function createAdmin(context: TestContext, label: string, tokenVersion = 0, id?: string) {
  return context.prisma.user.create({
    data: {
      id,
      username: `transfer_admin_${label}_${context.suffix}`,
      passwordHash: context.adminPasswordHash,
      name: `转移验证管理员_${label}`,
      role: 'admin',
      tokenVersion,
    },
  })
}

async function createPartner(context: TestContext, label: string, phone: string, tokenVersion = 0) {
  return context.prisma.user.create({
    data: {
      username: `transfer_partner_${label}_${context.suffix}`,
      passwordHash: context.partnerPasswordHash,
      name: `转移验证机构账号_${label}`,
      role: 'partner',
      orgId: context.orgId,
      phoneHash: hashPhone(phone),
      phoneEnc: encryptPhone(phone),
      phoneVerifiedAt: new Date(),
      tokenVersion,
    },
  })
}

function passwordFailureKey(adminId: string): string {
  return `internal:admin:phone-initial-bind:password-fail:${adminId}`
}

function transferCodeKey(phone: string): string {
  return `internal:sms:code:transfer_phone:${hashPhone(phone)}`
}

function bindCodeKey(phone: string): string {
  return `internal:sms:code:bind_phone:${hashPhone(phone)}`
}

function sessionKey(userId: string): string {
  return `internal:session-state:${userId}`
}

async function requireTransferCode(context: TestContext, phone: string, message: string): Promise<string> {
  const code = await context.redis.get(transferCodeKey(phone))
  ensure(code && code === context.sms.lastCode, message)
  return code
}

function oldPartnerState(partner: {
  id: string
  orgId: string | null
  enabled: boolean
  tokenVersion: number
}): Record<string, unknown> {
  return {
    userId: partner.id,
    role: 'partner',
    orgId: partner.orgId,
    enabled: partner.enabled,
    tokenVersion: partner.tokenVersion,
    orgEnabled: true,
  }
}

async function verifyNormalTransferAndAudits(context: TestContext): Promise<void> {
  const service = createService(context)
  const phone = context.nextPhone()
  const admin = await createAdmin(context, 'normal', 3)
  const partner = await createPartner(context, 'normal', phone, 5)
  const oldState = oldPartnerState(partner)
  await context.redis.setEx(sessionKey(partner.id), SESSION_TTL_SECONDS, JSON.stringify(oldState))
  const oldPartnerToken = context.jwt.sign({ sub: partner.id, ver: partner.tokenVersion, aud: 'internal' })
  const adminToken = context.jwt.sign({ sub: admin.id, ver: admin.tokenVersion, aud: 'internal' })

  const deliveriesBefore = context.sms.deliveries
  const started = await service.start(admin.id, context.adminPassword, phone, '127.0.1.1')
  ensure(context.sms.deliveries === deliveriesBefore + 1, '1. 正常 start 未且仅未发送一次捕获短信')
  ensure(
    started.sourceAccount.username === partner.username &&
      started.sourceAccount.organizationName === context.orgName &&
      started.sourceAccount.phoneMasked === maskPhone(phone) &&
      started.cooldownSeconds === 60 &&
      started.expiresInSeconds === 300,
    '1. start 未返回最小且脱敏的来源摘要',
  )
  const code = await requireTransferCode(context, phone, '1. start 未使用独立 transfer_phone OTP')
  const result = await service.verify(admin.id, started.bindTicket, code)
  const source = await context.prisma.user.findUniqueOrThrow({ where: { id: partner.id } })
  const target = await context.prisma.user.findUniqueOrThrow({ where: { id: admin.id } })
  ensure(source.phoneHash === null && source.phoneEnc === null && source.phoneVerifiedAt === null, '1. Partner 手机号字段未清空')
  ensure(source.tokenVersion === partner.tokenVersion + 1, '1. Partner tokenVersion 未递增')
  ensure(target.phoneHash === hashPhone(phone) && target.phoneEnc && target.phoneVerifiedAt, '1. Admin 手机号三字段未原子写入')
  ensure(target.tokenVersion === admin.tokenVersion, '1. 转移错误递增了 Admin tokenVersion')
  ensure(await bcrypt.compare(context.partnerPassword, source.passwordHash), '1. Partner 密码未保留')
  ensure(result.phoneMasked === maskPhone(phone), '1. 完成响应未保持手机号脱敏')

  const cached = context.redis.raw(sessionKey(partner.id))
  ensure(cached !== null, '2. Partner 新版本会话缓存未写入')
  const cachedState = JSON.parse(cached) as { tokenVersion?: number }
  ensure(cachedState.tokenVersion === partner.tokenVersion + 1, '2. 新版本会话缓存未覆盖旧版本')
  const staleWrite = await context.redis.setJsonIfVersionNotOlder(
    sessionKey(partner.id),
    SESSION_TTL_SECONDS,
    JSON.stringify(oldState),
    partner.tokenVersion,
  )
  ensure(staleWrite === 'stale', '2. 旧版本并发回填未被原子拒绝')
  await expectCode(
    () => context.guard.canActivate(mockContext(oldPartnerToken)),
    'AUTH_TOKEN_INVALID',
    '2. 真实 JwtAuthGuard 未拒绝 Partner 旧 JWT',
  )
  ensure(await context.guard.canActivate(mockContext(adminToken)), '2. Admin 当前 JWT 未在转移后保持有效')

  const startAudit = context.audit.entries.find(
    (entry) => entry.action === 'auth.phone_transfer_start' && entry.actorId === admin.id,
  )
  const databaseAudits = await context.prisma.auditLog.findMany({
    where: { actorId: admin.id, action: { in: ['auth.phone_transfer_complete', 'auth.phone_released_by_admin'] } },
  })
  const completeAudit = databaseAudits.find((entry) => entry.action === 'auth.phone_transfer_complete')
  const releaseAudit = databaseAudits.find((entry) => entry.action === 'auth.phone_released_by_admin')
  ensure(
    startAudit?.actorRole === 'admin' && startAudit.targetId === partner.id && JSON.stringify(startAudit.payload) === '{}',
    '3. start 审计 actor/target/payload 不正确',
  )
  ensure(
    completeAudit?.targetId === admin.id &&
      completeAudit.actorRole === 'admin' &&
      completeAudit.payloadJson === JSON.stringify({ phoneMasked: maskPhone(phone), sourcePartnerId: partner.id }),
    '3. complete 审计 actor/target/payload 不正确',
  )
  ensure(
    releaseAudit?.targetId === partner.id && releaseAudit.actorRole === 'admin' && releaseAudit.payloadJson === '{}',
    '3. released_by_admin 审计 actor/target/payload 不正确',
  )
  const auditRaw = JSON.stringify([startAudit, completeAudit, releaseAudit])
  const forbidden = [phone, hashPhone(phone), target.phoneEnc, context.adminPassword, context.partnerPassword, code, started.bindTicket]
  ensure(forbidden.every((secret) => !auditRaw.includes(secret)), '3. 转移审计泄露敏感字段')
  pass('1-3. 正常转移、密码保留、双会话版本与三类审计契约成立')
}

async function verifyOwnerRestrictions(context: TestContext): Promise<void> {
  const service = createService(context)
  const target = await createAdmin(context, 'owner-restrictions')
  const unownedPhone = context.nextPhone()
  const adminOwnedPhone = context.nextPhone()
  const kioskOwnedPhone = context.nextPhone()
  await context.prisma.user.create({
    data: {
      username: `transfer_other_admin_${context.suffix}`,
      passwordHash: context.adminPasswordHash,
      name: '另一管理员',
      role: 'admin',
      phoneHash: hashPhone(adminOwnedPhone),
      phoneEnc: encryptPhone(adminOwnedPhone),
      phoneVerifiedAt: new Date(),
    },
  })
  await context.prisma.user.create({
    data: {
      username: `transfer_kiosk_${context.suffix}`,
      passwordHash: context.adminPasswordHash,
      name: '非 Partner 账号',
      role: 'kiosk',
      phoneHash: hashPhone(kioskOwnedPhone),
      phoneEnc: encryptPhone(kioskOwnedPhone),
      phoneVerifiedAt: new Date(),
    },
  })

  for (const [label, phone] of [
    ['无主手机号', unownedPhone],
    ['另一 Admin 手机号', adminOwnedPhone],
    ['非 Partner 手机号', kioskOwnedPhone],
  ] as const) {
    const before = context.sms.deliveries
    await expectCode(() => service.start(target.id, context.adminPassword, phone, '127.0.1.2'), UNAVAILABLE, `4. ${label}必须统一拒绝`)
    ensure(context.sms.deliveries === before, `4. ${label}拒绝前错误发送了短信`)
  }
  pass('4. 无主、另一 Admin 与非 Partner 所有者均统一拒绝且不发码')
}

async function verifySharedPasswordBudget(context: TestContext): Promise<void> {
  const service = createService(context)
  const strictService = new AdminInitialPhoneBindService(
    context.prisma,
    context.redis as unknown as RedisService,
    context.otp,
    context.audit as unknown as AuditService,
  )
  const phone = context.nextPhone()
  const admin = await createAdmin(context, 'shared-budget')
  await createPartner(context, 'shared-budget', phone)
  await expectCode(
    () => strictService.start(admin.id, 'wrong-password', context.nextPhone(), '127.0.1.3'),
    'AUTH_INITIAL_PHONE_BIND_UNAVAILABLE',
    '5. 严格初绑错误密码未进入共享额度',
  )
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await expectCode(() => service.start(admin.id, 'wrong-password', phone, '127.0.1.3'), UNAVAILABLE, '5. 转移错误密码未统一拒绝')
  }
  ensure(context.redis.raw(passwordFailureKey(admin.id)) === '5', '5. 两入口未共享 5 次失败额度')
  const deliveriesBeforeLimit = context.sms.deliveries
  await expectCode(() => service.start(admin.id, context.adminPassword, phone, '127.0.1.3'), UNAVAILABLE, '5. 第六次密码尝试未被共享额度阻断')
  ensure(context.sms.deliveries === deliveriesBeforeLimit, '5. 共享密码限流后仍发送了短信')

  const releasePhone = context.nextPhone()
  const releaseAdmin = await createAdmin(context, 'success-release')
  await createPartner(context, 'success-release', releasePhone)
  await expectCode(
    () => strictService.start(releaseAdmin.id, 'wrong-password', context.nextPhone(), '127.0.1.4'),
    'AUTH_INITIAL_PHONE_BIND_UNAVAILABLE',
    '5. 正确密码释放前置额度准备失败',
  )
  const started = await service.start(releaseAdmin.id, context.adminPassword, releasePhone, '127.0.1.4')
  ensure(context.redis.raw(passwordFailureKey(releaseAdmin.id)) === '1', '5. 正确密码错误清空或占用了既有失败额度')
  await service.cancel(releaseAdmin.id, started.bindTicket)

  const bcryptPhone = context.nextPhone()
  const bcryptAdmin = await createAdmin(context, 'bcrypt-release')
  await createPartner(context, 'bcrypt-release', bcryptPhone)
  await context.redis.setEx(passwordFailureKey(bcryptAdmin.id), 300, '2')
  const bcryptFailurePrisma = {
    user: {
      findUnique: async (args: { where: { id?: string } }) => {
        const userId = args.where.id
        if (!userId) return null
        const user = await context.prisma.user.findUnique({ where: { id: userId } })
        return user?.id === bcryptAdmin.id ? { ...user, passwordHash: null } : user
      },
    },
  } as unknown as PrismaService
  const bcryptFailureService = createService(context, { prisma: bcryptFailurePrisma })
  await expectCode(
    () => bcryptFailureService.start(bcryptAdmin.id, context.adminPassword, bcryptPhone, '127.0.1.5'),
    UNAVAILABLE,
    '5. bcrypt 异常未统一拒绝',
  )
  ensure(context.redis.raw(passwordFailureKey(bcryptAdmin.id)) === '2', '5. bcrypt 异常未释放刚预约的额度')
  pass('5. 严格初绑与转移共享密码额度，正确密码及 bcrypt 异常均精确释放预约')
}

async function verifyOtpIsolationRetryAndReplay(context: TestContext): Promise<void> {
  const service = createService(context)
  const phone = context.nextPhone()
  const admin = await createAdmin(context, 'otp-isolation')
  await createPartner(context, 'otp-isolation', phone)
  await context.otp.sendCode({ phone, purpose: 'bind_phone', ip: '127.0.1.6', shouldDeliver: true })
  const started = await service.start(admin.id, context.adminPassword, phone, '127.0.1.7')
  const transferCode = await requireTransferCode(context, phone, '6. transfer_phone OTP 未写入')
  const guaranteedWrongCode = transferCode === '000000' ? '111111' : '000000'
  await context.redis.setEx(bindCodeKey(phone), 300, guaranteedWrongCode)
  await expectCode(
    () => service.verify(admin.id, started.bindTicket, guaranteedWrongCode),
    'SMS_CODE_INVALID',
    '6. bind_phone OTP 错误跨 purpose 消费 transfer_phone OTP',
  )
  ensure(context.redis.raw(transferCodeKey(phone)) === transferCode, '6. 错误 OTP 提前消费 transfer_phone 验证码')
  ensure(context.redis.raw(bindCodeKey(phone)) === guaranteedWrongCode, '6. 转移验证污染 bind_phone 验证码')
  await service.verify(admin.id, started.bindTicket, transferCode)
  await expectCode(() => service.verify(admin.id, started.bindTicket, transferCode), UNAVAILABLE, '6. 已消费 ticket 可以重放')
  ensure(context.redis.raw(bindCodeKey(phone)) === guaranteedWrongCode, '6. 完成转移错误清理了 bind_phone 命名空间')
  pass('6. transfer_phone OTP 与 bind_phone 冷却/验证码隔离，错误 OTP 可重试且 ticket 不可重放')
}

async function verifyDoubleVerifyAndAdminCompetition(context: TestContext): Promise<void> {
  const service = createService(context)
  const doublePhone = context.nextPhone()
  const doubleAdmin = await createAdmin(context, 'double-verify')
  await createPartner(context, 'double-verify', doublePhone)
  const doubleStarted = await service.start(doubleAdmin.id, context.adminPassword, doublePhone, '127.0.1.8')
  const doubleCode = await requireTransferCode(context, doublePhone, '7. 双 verify 场景缺少 OTP')
  const doubleResults = await Promise.allSettled([
    service.verify(doubleAdmin.id, doubleStarted.bindTicket, doubleCode),
    service.verify(doubleAdmin.id, doubleStarted.bindTicket, doubleCode),
  ])
  const doubleSuccesses = doubleResults.filter((result) => result.status === 'fulfilled')
  const doubleFailures = doubleResults.filter((result) => result.status === 'rejected')
  ensure(
    doubleSuccesses.length === 1 && doubleFailures.length === 1 && errorCode(doubleFailures[0]?.reason) === UNAVAILABLE,
    '7. 同 ticket 双 verify 未保持最多一次成功',
  )

  const competitionPhone = context.nextPhone()
  const competitionPartner = await createPartner(context, 'competition', competitionPhone, 9)
  const firstAdmin = await createAdmin(context, 'competition-a')
  const secondAdmin = await createAdmin(context, 'competition-b')
  const firstStart = await service.start(firstAdmin.id, context.adminPassword, competitionPhone, '127.0.1.9')
  context.redis.advanceSeconds(60)
  const secondStart = await service.start(secondAdmin.id, context.adminPassword, competitionPhone, '127.0.1.10')
  const competitionCode = await requireTransferCode(context, competitionPhone, '7. 两 Admin 竞争场景缺少 OTP')

  let barrierArrivals = 0
  let releaseBarrier: (() => void) | null = null
  const barrier = new Promise<void>((resolve) => { releaseBarrier = resolve })
  const competitionOtp = {
    sendCode: (...args: Parameters<InternalOtpService['sendCode']>) => context.otp.sendCode(...args),
    verifyCode: async () => {
      barrierArrivals += 1
      if (barrierArrivals === 2) releaseBarrier?.()
      await barrier
    },
  } as unknown as InternalOtpService
  const competitionService = createService(context, { otp: competitionOtp })
  const competitionResults = await Promise.allSettled([
    competitionService.verify(firstAdmin.id, firstStart.bindTicket, competitionCode),
    competitionService.verify(secondAdmin.id, secondStart.bindTicket, competitionCode),
  ])
  const successes = competitionResults.filter((result) => result.status === 'fulfilled')
  const failures = competitionResults.filter((result) => result.status === 'rejected')
  ensure(successes.length === 1 && failures.length === 1 && errorCode(failures[0]?.reason) === UNAVAILABLE, '7. 两 Admin 竞争未收敛为单一成功')
  const sourceAfter = await context.prisma.user.findUniqueOrThrow({ where: { id: competitionPartner.id } })
  const firstAfter = await context.prisma.user.findUniqueOrThrow({ where: { id: firstAdmin.id } })
  const secondAfter = await context.prisma.user.findUniqueOrThrow({ where: { id: secondAdmin.id } })
  ensure(sourceAfter.phoneHash === null && sourceAfter.tokenVersion === 10, '7. 竞争成功后 Partner 状态错误')
  ensure(Number(Boolean(firstAfter.phoneHash)) + Number(Boolean(secondAfter.phoneHash)) === 1, '7. 竞争后不是恰好一个 Admin 获得手机号')
  pass('7. 同 ticket 双 verify 与两 Admin 数据库竞争均最多一次成功')
}

async function verifySourceChangesAndTriggerRollback(context: TestContext): Promise<void> {
  const service = createService(context)
  const changedPhone = context.nextPhone()
  const changedAdmin = await createAdmin(context, 'source-phone-change')
  const changedPartner = await createPartner(context, 'source-phone-change', changedPhone, 4)
  const changedStart = await service.start(changedAdmin.id, context.adminPassword, changedPhone, '127.0.1.11')
  const changedCode = await requireTransferCode(context, changedPhone, '8. 来源改号场景缺少 OTP')
  const replacementPhone = context.nextPhone()
  await context.prisma.user.update({
    where: { id: changedPartner.id },
    data: { phoneHash: hashPhone(replacementPhone), phoneEnc: encryptPhone(replacementPhone), phoneVerifiedAt: new Date() },
  })
  await expectCode(() => service.verify(changedAdmin.id, changedStart.bindTicket, changedCode), UNAVAILABLE, '8. start 后来源改号未使 ticket 失效')
  const changedAdminAfter = await context.prisma.user.findUniqueOrThrow({ where: { id: changedAdmin.id } })
  const changedPartnerAfter = await context.prisma.user.findUniqueOrThrow({ where: { id: changedPartner.id } })
  ensure(!changedAdminAfter.phoneHash && changedPartnerAfter.phoneHash === hashPhone(replacementPhone), '8. 来源改号失败后产生部分转移')

  const versionPhone = context.nextPhone()
  const versionAdmin = await createAdmin(context, 'source-version-change')
  const versionPartner = await createPartner(context, 'source-version-change', versionPhone, 7)
  const versionStart = await service.start(versionAdmin.id, context.adminPassword, versionPhone, '127.0.1.12')
  const versionCode = await requireTransferCode(context, versionPhone, '8. 来源版本变化场景缺少 OTP')
  await context.prisma.user.update({ where: { id: versionPartner.id }, data: { tokenVersion: { increment: 1 } } })
  await expectCode(() => service.verify(versionAdmin.id, versionStart.bindTicket, versionCode), UNAVAILABLE, '8. start 后来源版本变化未使 ticket 失效')
  const versionAdminAfter = await context.prisma.user.findUniqueOrThrow({ where: { id: versionAdmin.id } })
  const versionPartnerAfter = await context.prisma.user.findUniqueOrThrow({ where: { id: versionPartner.id } })
  ensure(!versionAdminAfter.phoneHash && versionPartnerAfter.phoneHash === hashPhone(versionPhone) && versionPartnerAfter.tokenVersion === 8, '8. 来源版本冲突后产生部分转移')

  const triggerPhone = context.nextPhone()
  const triggerAdmin = await createAdmin(context, 'trigger-rollback', 13, 'verify_transfer_trigger_admin')
  const triggerPartner = await createPartner(context, 'trigger-rollback', triggerPhone, 17)
  const triggerStart = await service.start(triggerAdmin.id, context.adminPassword, triggerPhone, '127.0.1.13')
  const triggerCode = await requireTransferCode(context, triggerPhone, '8. trigger 回滚场景缺少 OTP')
  const createTriggerSql = `
    CREATE TRIGGER "verify_admin_phone_transfer_second_cas_zero"
    AFTER UPDATE OF "phoneHash" ON "User"
    WHEN OLD."role" = 'partner' AND OLD."phoneHash" IS NOT NULL AND NEW."phoneHash" IS NULL
    BEGIN
      UPDATE "User" SET "tokenVersion" = "tokenVersion" + 1 WHERE "id" = 'verify_transfer_trigger_admin';
    END;
  `
  const dropTriggerSql = 'DROP TRIGGER IF EXISTS "verify_admin_phone_transfer_second_cas_zero";'
  execFileSync('sqlite3', [context.databasePath, createTriggerSql], { stdio: 'pipe' })
  try {
    await expectCode(
      () => service.verify(triggerAdmin.id, triggerStart.bindTicket, triggerCode),
      UNAVAILABLE,
      '8. trigger 未真实触发事务第二步 CAS=0',
    )
  } finally {
    execFileSync('sqlite3', [context.databasePath, dropTriggerSql], { stdio: 'pipe' })
  }
  const triggerAdminAfter = await context.prisma.user.findUniqueOrThrow({ where: { id: triggerAdmin.id } })
  const triggerPartnerAfter = await context.prisma.user.findUniqueOrThrow({ where: { id: triggerPartner.id } })
  ensure(
    triggerAdminAfter.tokenVersion === triggerAdmin.tokenVersion &&
      triggerAdminAfter.phoneHash === null &&
      triggerPartnerAfter.tokenVersion === triggerPartner.tokenVersion &&
      triggerPartnerAfter.phoneHash === hashPhone(triggerPhone),
    '8. 事务第二步 CAS=0 后 Partner 清空或 trigger 版本更新未整体回滚',
  )
  pass('8. 来源状态变化 fail-closed，静态 SQLite trigger 证明第二步 CAS=0 整体回滚')
}

async function verifyCancelAudit(context: TestContext): Promise<void> {
  const service = createService(context)
  const phone = context.nextPhone()
  const admin = await createAdmin(context, 'cancel')
  const partner = await createPartner(context, 'cancel', phone)
  const started = await service.start(admin.id, context.adminPassword, phone, '127.0.1.14')
  const code = await requireTransferCode(context, phone, '9. cancel 场景缺少 OTP')
  await service.cancel(admin.id, started.bindTicket)
  await expectCode(() => service.verify(admin.id, started.bindTicket, code), UNAVAILABLE, '9. cancel 后 ticket 仍可验证')
  const adminAfter = await context.prisma.user.findUniqueOrThrow({ where: { id: admin.id } })
  const partnerAfter = await context.prisma.user.findUniqueOrThrow({ where: { id: partner.id } })
  ensure(!adminAfter.phoneHash && partnerAfter.phoneHash === hashPhone(phone), '9. cancel 错误修改数据库手机号状态')
  const cancelAudit = context.audit.entries.find(
    (entry) => entry.action === 'auth.phone_transfer_cancel' && entry.actorId === admin.id,
  )
  ensure(
    cancelAudit?.targetId === admin.id && cancelAudit.actorRole === 'admin' && JSON.stringify(cancelAudit.payload) === '{}',
    '9. cancel 审计 actor/target/payload 不正确',
  )
  const raw = JSON.stringify(cancelAudit)
  ensure(
    [phone, hashPhone(phone), context.adminPassword, code, started.bindTicket].every((secret) => !raw.includes(secret)),
    '9. cancel 审计泄露敏感字段',
  )
  pass('9. cancel 只清临时状态并写入空 payload 脱敏审计')
}

async function verifyCacheFailureConverges(context: TestContext): Promise<void> {
  const service = createService(context)
  const phone = context.nextPhone()
  const admin = await createAdmin(context, 'cache-failure', 2)
  const partner = await createPartner(context, 'cache-failure', phone, 12)
  const oldState = oldPartnerState(partner)
  const cacheKey = sessionKey(partner.id)
  await context.redis.setEx(cacheKey, SESSION_TTL_SECONDS, JSON.stringify(oldState))
  context.redis.failNextVersionedWrite(cacheKey)
  const oldToken = context.jwt.sign({ sub: partner.id, ver: partner.tokenVersion, aud: 'internal' })
  const started = await service.start(admin.id, context.adminPassword, phone, '127.0.1.15')
  const code = await requireTransferCode(context, phone, '10. 缓存失败场景缺少 OTP')
  await service.verify(admin.id, started.bindTicket, code)
  const source = await context.prisma.user.findUniqueOrThrow({ where: { id: partner.id } })
  const target = await context.prisma.user.findUniqueOrThrow({ where: { id: admin.id } })
  ensure(source.tokenVersion === 13 && source.phoneHash === null && target.phoneHash === hashPhone(phone), '10. 缓存刷新失败反转或伪装了数据库成功')
  ensure(await context.guard.canActivate(mockContext(oldToken)), '10. 旧缓存残余窗口模拟不成立')
  context.redis.advanceSeconds(SESSION_TTL_SECONDS)
  await expectCode(
    () => context.guard.canActivate(mockContext(oldToken)),
    'AUTH_TOKEN_INVALID',
    '10. 缓存 TTL 到期回源后旧 JWT 未失效',
  )
  const refreshed = context.redis.raw(cacheKey)
  ensure(refreshed !== null && (JSON.parse(refreshed) as { tokenVersion?: number }).tokenVersion === 13, '10. TTL 回源未写入数据库新版本')
  pass('10. 会话缓存刷新失败不反转 DB，旧缓存按 TTL 回源收敛并拒绝旧 JWT')
}

async function main(): Promise<void> {
  const isolatedDatabase = prepareIsolatedDatabase()
  let prisma: PrismaService | null = null
  try {
    assertInternalAuthVerifyTarget(process.env)
    isolatedDatabase.initialize()
    prisma = new PrismaService()
    await assertHarnessReady(prisma)
    assertFailureUnwindsCleanup()

    const Service = await loadTransferService()
    const redis = new MemoryRedis()
    const sms = new CapturingSmsSender()
    const otp = new InternalOtpService(redis as unknown as RedisService, sms)
    const audit = new RecordingAudit()
    const jwt = new JwtService({ secret: process.env['JWT_SECRET'] })
    const guard = new JwtAuthGuard(jwt, prisma, redis as unknown as RedisService)
    const suffix = randomUUID().replace(/-/g, '').slice(0, 10)
    const adminPassword = `Admin_${randomUUID()}!`
    const partnerPassword = `Partner_${randomUUID()}!`
    const phoneSeed = randomInt(0, 100_000_000)
    let phoneIndex = 0
    const nextPhone = () => {
      const prefixes = ['130', '131', '132', '133', '135', '136', '137', '138', '139']
      const prefix = prefixes[phoneIndex % prefixes.length]
      const tail = String((phoneSeed + phoneIndex++) % 100_000_000).padStart(8, '0')
      const phone = `${prefix}${tail}`
      generatedPhones.add(phone)
      return phone
    }
    const orgName = `手机号转移验证机构_${suffix}`
    const org = await prisma.organization.create({
      data: {
        id: `org_transfer_${suffix}`,
        name: orgName,
        type: 'public_employment_service',
        sceneTemplate: 'public_employment',
        enabledModulesJson: '[]',
      },
    })
    const context: TestContext = {
      prisma,
      redis,
      sms,
      otp,
      audit,
      jwt,
      guard,
      Service,
      databasePath: isolatedDatabase.databasePath,
      orgId: org.id,
      orgName,
      suffix,
      adminPassword,
      partnerPassword,
      adminPasswordHash: await bcrypt.hash(adminPassword, 10),
      partnerPasswordHash: await bcrypt.hash(partnerPassword, 10),
      nextPhone,
    }

    console.log('\n=== Admin–Partner 手机号安全转移契约验证 ===')
    await verifyNormalTransferAndAudits(context)
    await verifyOwnerRestrictions(context)
    await verifySharedPasswordBudget(context)
    await verifyOtpIsolationRetryAndReplay(context)
    await verifyDoubleVerifyAndAdminCompetition(context)
    await verifySourceChangesAndTriggerRollback(context)
    await verifyCancelAudit(context)
    await verifyCacheFailureConverges(context)
    console.log('\nAdmin–Partner 手机号安全转移契约验证完成。')
  } finally {
    if (prisma) await prisma.onModuleDestroy().catch(() => undefined)
    isolatedDatabase.cleanup()
  }
}

main().catch((error) => {
  const raw = error instanceof Error ? error.message : 'unknown verifier failure'
  const redacted = [...generatedPhones].reduce((message, phone) => message.replaceAll(phone, '[redacted-phone]'), raw)
  console.error(redacted)
  process.exitCode = 1
})
