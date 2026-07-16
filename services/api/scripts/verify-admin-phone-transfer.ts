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
import { resolve } from 'path'
import type { AuditService } from '../src/audit/audit.service'
import { AdminInitialPhoneBindService } from '../src/auth/admin-initial-phone-bind.service'
import { InternalOtpService } from '../src/auth/internal-otp.service'
import { assertInternalAuthVerifyTarget } from '../src/auth/internal-auth-verify-target'
import { encryptPhone, hashPhone, maskPhone } from '../src/common/crypto/phone-identity'
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard'
import type { RedisService } from '../src/common/redis/redis.service'
import { PrismaService } from '../src/prisma/prisma.service'
import {
  assertFailureUnwindsCleanup,
  assertHarnessReady,
  CapturingSmsSender,
  createBoundedBarrier,
  ensure,
  errorCode,
  expectCode,
  MemoryRedis,
  pass,
  prepareIsolatedDatabase,
  RecordingAudit,
} from './support/internal-auth-verify-harness'
import { verifyAdminPhoneTransferSecurityCases } from './support/admin-phone-transfer-security-cases'

process.env['JWT_SECRET'] ||= randomBytes(32).toString('hex')
process.env['SECRET_ENCRYPTION_KEY'] ||= randomBytes(32).toString('hex')

const SESSION_TTL_SECONDS = 60
const UNAVAILABLE = 'AUTH_PHONE_TRANSFER_UNAVAILABLE'
const TRANSFER_SERVICE_MODULE_PATH = '../src/auth/admin-phone-transfer.service'
const RED_TARGET_MISSING = 'RED_CONTRACT_TARGET_MISSING: admin-phone-transfer.service 尚不存在'
const generatedPhones = new Set<string>()

function mockContext(token: string): ExecutionContext {
  const request = { headers: { authorization: `Bearer ${token}` } }
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext
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

function isExactMissingTransferModule(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const candidate = error as { code?: unknown; message?: unknown }
  if (candidate.code !== 'MODULE_NOT_FOUND' && candidate.code !== 'ERR_MODULE_NOT_FOUND') return false
  if (typeof candidate.message !== 'string') return false
  const missingPath = candidate.message.match(/^Cannot find module ['"]([^'"]+)['"]/)?.[1]
  if (!missingPath) return false

  const absoluteModulePath = resolve(__dirname, TRANSFER_SERVICE_MODULE_PATH)
  return new Set([
    TRANSFER_SERVICE_MODULE_PATH,
    absoluteModulePath,
    `${absoluteModulePath}.ts`,
    `${absoluteModulePath}.js`,
  ]).has(missingPath)
}

function assertMissingModuleClassifier(): void {
  const exactMissing = {
    code: 'MODULE_NOT_FOUND',
    message: `Cannot find module '${TRANSFER_SERVICE_MODULE_PATH}'\nRequire stack: verifier`,
  }
  const dependencyMissing = {
    code: 'MODULE_NOT_FOUND',
    message: `Cannot find module 'nested-dependency'\nRequire stack: ${TRANSFER_SERVICE_MODULE_PATH}`,
  }
  const wrongCode = { code: 'EACCES', message: `Cannot find module '${TRANSFER_SERVICE_MODULE_PATH}'` }
  ensure(
    isExactMissingTransferModule(exactMissing) &&
      !isExactMissingTransferModule(dependencyMissing) &&
      !isExactMissingTransferModule(wrongCode),
    '0. 目标模块缺失分类器会误吞依赖或其他加载错误',
  )
  pass('0b. RED 只识别确切目标路径的 MODULE_NOT_FOUND/ERR_MODULE_NOT_FOUND')
}

async function loadTransferService(): Promise<AdminPhoneTransferConstructor> {
  try {
    const loaded = (await import(TRANSFER_SERVICE_MODULE_PATH)) as Record<string, unknown>
    const candidate = loaded['AdminPhoneTransferService']
    ensure(typeof candidate === 'function', 'RED：AdminPhoneTransferService 导出不存在')
    return candidate as AdminPhoneTransferConstructor
  } catch (error) {
    if (isExactMissingTransferModule(error)) throw new Error(RED_TARGET_MISSING)
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
    audit?: AuditService | RecordingAudit
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

  for (const [caseId, label, phone] of [
    ['unowned', '无主手机号', unownedPhone],
    ['admin-owned', '另一 Admin 手机号', adminOwnedPhone],
    ['non-partner', '非 Partner 手机号', kioskOwnedPhone],
  ] as const) {
    const target = await createAdmin(context, `owner-restrictions-${caseId}`)
    const before = context.sms.deliveries
    await expectCode(() => service.start(target.id, context.adminPassword, phone, '127.0.1.2'), UNAVAILABLE, `4. ${label}必须统一拒绝`)
    ensure(context.sms.deliveries === before, `4. ${label}拒绝前错误发送了短信`)
    const targetAfter = await context.prisma.user.findUniqueOrThrow({ where: { id: target.id } })
    ensure(
      targetAfter.phoneHash === null && targetAfter.phoneEnc === null && targetAfter.phoneVerifiedAt === null,
      `4. ${label}拒绝后污染了独立目标 Admin 的手机号状态`,
    )
  }
  pass('4. 无主、另一 Admin 与非 Partner 各用独立目标账号拒绝，不发码且三字段保持未绑定')
}

async function verifyDisabledPartnerCanTransfer(context: TestContext): Promise<void> {
  const service = createService(context)
  const phone = context.nextPhone()
  const admin = await createAdmin(context, 'disabled-partner')
  const enabledPartner = await createPartner(context, 'disabled-partner', phone, 6)
  const partner = await context.prisma.user.update({
    where: { id: enabledPartner.id },
    data: { enabled: false },
  })

  let started: TransferStartResult | undefined
  try {
    started = await service.start(admin.id, context.adminPassword, phone, '127.0.1.16')
  } catch (error) {
    ensure(errorCode(error) !== UNAVAILABLE, '4b. 禁用 Partner 被错误当作不可转移来源')
    throw error
  }
  ensure(started, '4b. 禁用 Partner 未创建转移 ticket')
  const code = await requireTransferCode(context, phone, '4b. 禁用 Partner 转移未发送独立 OTP')
  await service.verify(admin.id, started.bindTicket, code)

  const source = await context.prisma.user.findUniqueOrThrow({ where: { id: partner.id } })
  const target = await context.prisma.user.findUniqueOrThrow({ where: { id: admin.id } })
  ensure(
    source.enabled === false &&
      source.role === 'partner' &&
      source.username === partner.username &&
      source.name === partner.name &&
      source.orgId === context.orgId &&
      source.phoneHash === null &&
      source.phoneEnc === null &&
      source.phoneVerifiedAt === null &&
      source.tokenVersion === partner.tokenVersion + 1,
    '4b. 禁用 Partner 转移后账号数据、禁用状态或版本不正确',
  )
  ensure(await bcrypt.compare(context.partnerPassword, source.passwordHash), '4b. 禁用 Partner 转移后密码未保留')
  ensure(target.phoneHash === hashPhone(phone) && target.phoneEnc && target.phoneVerifiedAt, '4b. 禁用 Partner 手机号未绑定 Admin')

  const cached = context.redis.raw(sessionKey(partner.id))
  ensure(cached !== null, '4b. 禁用 Partner 新版本会话缓存未写入')
  const cachedState = JSON.parse(cached) as { enabled?: unknown; tokenVersion?: unknown }
  ensure(
    cachedState.enabled === false && cachedState.tokenVersion === partner.tokenVersion + 1,
    '4b. 禁用 Partner 会话缓存未保留 disabled 状态或新版本',
  )
  pass('4b. 禁用 Partner 仍可释放手机号，账号数据/密码保留且新会话状态保持 disabled')
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

  const barrier = createBoundedBarrier(2, 1_000, '两 Admin 数据库竞争')
  const competitionOtp = {
    sendCode: (...args: Parameters<InternalOtpService['sendCode']>) => context.otp.sendCode(...args),
    verifyCode: () => barrier.wait(),
  } as unknown as InternalOtpService
  const competitionService = createService(context, { otp: competitionOtp })
  const competitionResults = await (async () => {
    try {
      return await Promise.allSettled([
        competitionService.verify(firstAdmin.id, firstStart.bindTicket, competitionCode),
        competitionService.verify(secondAdmin.id, secondStart.bindTicket, competitionCode),
      ])
    } finally {
      barrier.release()
    }
  })()
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
    assertMissingModuleClassifier()

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
    await verifyDisabledPartnerCanTransfer(context)
    await verifySharedPasswordBudget(context)
    await verifyOtpIsolationRetryAndReplay(context)
    await verifyDoubleVerifyAndAdminCompetition(context)
    await verifySourceChangesAndTriggerRollback(context)
    await verifyCancelAudit(context)
    await verifyAdminPhoneTransferSecurityCases({
      ...context,
      createService: (options) => createService(context, options),
      createAdmin: (label, tokenVersion, id) => createAdmin(context, label, tokenVersion, id),
      createPartner: (label, phone, tokenVersion) => createPartner(context, label, phone, tokenVersion),
    })
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
