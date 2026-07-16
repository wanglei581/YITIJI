import { Logger } from '@nestjs/common'
import type { JwtService } from '@nestjs/jwt'
import * as bcrypt from 'bcryptjs'
import { randomUUID } from 'crypto'
import { AuditService } from '../../src/audit/audit.service'
import { AuthService } from '../../src/auth/auth.service'
import { InternalOtpService } from '../../src/auth/internal-otp.service'
import { hashPhone } from '../../src/common/crypto/phone-identity'
import type { RedisService } from '../../src/common/redis/redis.service'
import { AdminOrgsService } from '../../src/orgs/admin-orgs.service'
import type { PrismaService, PrismaTransactionClient } from '../../src/prisma/prisma.service'
import {
  CapturingSmsSender,
  ensure,
  errorCode,
  expectCode,
  MemoryRedis,
  pass,
  type RecordingAudit,
} from './internal-auth-verify-harness'

const UNAVAILABLE = 'AUTH_PHONE_TRANSFER_UNAVAILABLE'

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

type SecurityUser = {
  id: string
  username: string
  passwordHash: string
  name: string
  role: string
  orgId: string | null
  phoneHash: string | null
  phoneEnc: string | null
  phoneVerifiedAt: Date | null
  tokenVersion: number
  enabled: boolean
}

export type AdminPhoneTransferSecurityContext = {
  prisma: PrismaService
  redis: MemoryRedis
  otp: InternalOtpService
  audit: RecordingAudit
  sms: CapturingSmsSender
  jwt: JwtService
  adminPassword: string
  partnerPassword: string
  orgId: string
  nextPhone: () => string
  createService: (options?: {
    prisma?: PrismaService
    redis?: MemoryRedis
    otp?: InternalOtpService
    audit?: AuditService | RecordingAudit
  }) => AdminPhoneTransferContract
  createAdmin: (label: string, tokenVersion?: number, id?: string) => Promise<SecurityUser>
  createPartner: (label: string, phone: string, tokenVersion?: number) => Promise<SecurityUser>
}

function ticketKey(adminId: string, bindTicket: string): string {
  return `internal:admin:phone-transfer:ticket:${adminId}:${bindTicket}`
}

function activeTicketKey(adminId: string): string {
  return `internal:admin:phone-transfer:active:${adminId}`
}

function verifyLockKey(adminId: string, bindTicket: string): string {
  return `internal:admin:phone-transfer:verify-lock:${adminId}:${bindTicket}`
}

function transferCodeKey(phone: string): string {
  return `internal:sms:code:transfer_phone:${hashPhone(phone)}`
}

async function requireTransferCode(context: AdminPhoneTransferSecurityContext, phone: string, message: string): Promise<string> {
  const code = await context.redis.get(transferCodeKey(phone))
  ensure(code && code === context.sms.lastCode, message)
  return code
}

function differentOtp(code: string): string {
  return code === '000000' ? '111111' : '000000'
}

function assertTemporaryTransferStateCleared(
  context: AdminPhoneTransferSecurityContext,
  adminId: string,
  bindTicket: string,
  message: string,
): void {
  ensure(
    context.redis.raw(ticketKey(adminId, bindTicket)) === null &&
      context.redis.raw(activeTicketKey(adminId)) === null,
    message,
  )
}

function prismaFailingNthTransactionAudit(prisma: PrismaService, failureIndex: number): PrismaService {
  return {
    get user() {
      return prisma.user
    },
    $transaction: async <R>(callback: (tx: PrismaTransactionClient) => Promise<R>): Promise<R> =>
      prisma.$transaction(async (tx) => {
        let auditWrites = 0
        const auditDelegate = tx.auditLog
        const createAudit = auditDelegate.create.bind(auditDelegate) as unknown as (args: unknown) => Promise<unknown>
        const guardedAuditDelegate = new Proxy(auditDelegate, {
          get(target, property, receiver) {
            if (property === 'create') {
              return async (args: unknown) => {
                auditWrites += 1
                if (auditWrites === failureIndex) throw new Error('simulated transaction audit failure')
                return createAudit(args)
              }
            }
            const value: unknown = Reflect.get(target, property, receiver)
            return typeof value === 'function' ? value.bind(target) : value
          },
        })
        const guardedTx = new Proxy(tx, {
          get(target, property, receiver) {
            if (property === 'auditLog') return guardedAuditDelegate
            const value: unknown = Reflect.get(target, property, receiver)
            return typeof value === 'function' ? value.bind(target) : value
          },
        }) as PrismaTransactionClient
        return callback(guardedTx)
      }),
  } as unknown as PrismaService
}

function replaceLockBeforeCompareAndDelete(
  redis: MemoryRedis,
  lockKey: string,
  replacementValue: string,
): MemoryRedis {
  let replaced = false
  return new Proxy(redis, {
    get(target, property, receiver) {
      if (property === 'getAndDelIfEquals') {
        return async (key: string, expected: string) => {
          if (key === lockKey && !replaced) {
            replaced = true
            await target.setEx(lockKey, 30, replacementValue)
          }
          return target.getAndDelIfEquals(key, expected)
        }
      }
      const value: unknown = Reflect.get(target, property, receiver)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

function failTicketCleanupAfterActiveConsume(
  redis: MemoryRedis,
  targetTicketKey: string,
  failure: Error,
): MemoryRedis {
  return new Proxy(redis, {
    get(target, property, receiver) {
      if (property === 'getAndDelIfEquals') {
        return async (key: string, expected: string) => {
          if (key === targetTicketKey) throw failure
          return target.getAndDelIfEquals(key, expected)
        }
      }
      const value: unknown = Reflect.get(target, property, receiver)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

export async function verifyCancelLockCleanup(context: AdminPhoneTransferSecurityContext): Promise<void> {
  const firstPhone = context.nextPhone()
  const firstAdmin = await context.createAdmin('cancel-lock-existing')
  await context.createPartner('cancel-lock-existing', firstPhone)
  const firstService = context.createService()
  const firstStarted = await firstService.start(firstAdmin.id, context.adminPassword, firstPhone, '127.0.1.17')
  const firstLockKey = verifyLockKey(firstAdmin.id, firstStarted.bindTicket)
  await context.redis.setEx(firstLockKey, 30, 'verify-lock-original')
  await firstService.cancel(firstAdmin.id, firstStarted.bindTicket)
  ensure(context.redis.raw(firstLockKey) === null, '9b. cancel 未清理已存在的 verify-lock')
  ensure(
    context.redis.raw(ticketKey(firstAdmin.id, firstStarted.bindTicket)) === null &&
      context.redis.raw(activeTicketKey(firstAdmin.id)) === null,
    '9b. cancel 未清理 ticket/active ticket',
  )

  const secondPhone = context.nextPhone()
  const secondAdmin = await context.createAdmin('cancel-lock-replaced')
  await context.createPartner('cancel-lock-replaced', secondPhone)
  const setupService = context.createService()
  const secondStarted = await setupService.start(secondAdmin.id, context.adminPassword, secondPhone, '127.0.1.18')
  const secondLockKey = verifyLockKey(secondAdmin.id, secondStarted.bindTicket)
  await context.redis.setEx(secondLockKey, 30, 'verify-lock-stale')
  const replacementValue = 'verify-lock-new-owner'
  const replacingRedis = replaceLockBeforeCompareAndDelete(context.redis, secondLockKey, replacementValue)
  const cancelService = context.createService({ redis: replacingRedis })
  await cancelService.cancel(secondAdmin.id, secondStarted.bindTicket)
  ensure(context.redis.raw(secondLockKey) === replacementValue, '9b. cancel 无条件删除了 CAS 前已换值的新 verify-lock')
  ensure(
    context.redis.raw(ticketKey(secondAdmin.id, secondStarted.bindTicket)) === null &&
      context.redis.raw(activeTicketKey(secondAdmin.id)) === null,
    '9b. 锁值竞争时 cancel 未安全清理 ticket/active ticket',
  )

  const failurePhone = context.nextPhone()
  const failureAdmin = await context.createAdmin('cancel-cleanup-failure-audit')
  await context.createPartner('cancel-cleanup-failure-audit', failurePhone)
  const failureSetupService = context.createService()
  const failureStarted = await failureSetupService.start(
    failureAdmin.id,
    context.adminPassword,
    failurePhone,
    '127.0.1.181',
  )
  const failureCode = await requireTransferCode(context, failurePhone, '9b. cleanup 故障场景未生成验证码')
  const failureTicketKey = ticketKey(failureAdmin.id, failureStarted.bindTicket)
  const injectedFailure = new Error(
    `simulated cleanup failure ${failurePhone} ${failureStarted.bindTicket} ${failureCode}`,
  )
  const failingRedis = failTicketCleanupAfterActiveConsume(context.redis, failureTicketKey, injectedFailure)
  const failureService = context.createService({ redis: failingRedis })
  const auditCountBefore = context.audit.entries.length
  const capturedLogs: string[] = []
  const originalLoggerError = Logger.prototype.error
  const originalLoggerWarn = Logger.prototype.warn
  Logger.prototype.error = function (message: unknown, ...optionalParams: unknown[]): void {
    capturedLogs.push([message, ...optionalParams].map(String).join(' '))
  }
  Logger.prototype.warn = function (message: unknown, ...optionalParams: unknown[]): void {
    capturedLogs.push([message, ...optionalParams].map(String).join(' '))
  }
  let cancellationError: unknown
  try {
    await failureService.cancel(failureAdmin.id, failureStarted.bindTicket)
  } catch (error) {
    cancellationError = error
  } finally {
    Logger.prototype.error = originalLoggerError
    Logger.prototype.warn = originalLoggerWarn
  }
  ensure(errorCode(cancellationError) === UNAVAILABLE, '9b. cleanup 故障未统一返回 unavailable')
  ensure(
    context.redis.raw(activeTicketKey(failureAdmin.id)) === null && context.redis.raw(failureTicketKey) !== null,
    '9b. cleanup 故障注入未发生在 active ticket 成功消费之后',
  )
  const cancellationAudits = context.audit.entries.slice(auditCountBefore)
  ensure(
    cancellationAudits.length === 1 &&
      cancellationAudits[0]?.action === 'auth.phone_transfer_cancel' &&
      Object.keys(cancellationAudits[0].payload ?? {}).length === 0,
    '9b. active 已消费但 cleanup 失败时 cancel 空 payload 审计未恰好尝试一次',
  )
  const observableError = JSON.stringify({
    message: cancellationError instanceof Error ? cancellationError.message : cancellationError,
    response:
      cancellationError && typeof cancellationError === 'object' && 'getResponse' in cancellationError
        ? (cancellationError as { getResponse: () => unknown }).getResponse()
        : undefined,
  })
  const observableOutput = `${observableError}\n${capturedLogs.join('\n')}`
  ensure(
    [failurePhone, failureStarted.bindTicket, failureCode].every((secret) => !observableOutput.includes(secret)),
    '9b. cleanup 故障通过错误响应或日志泄露 phone/ticket/code',
  )
  console.log('  PASS 9b. cancel CAS 清理状态，cleanup 故障后仍脱敏审计且不误删新锁')
}

async function verifyOtpTerminalFailuresCleanup(context: AdminPhoneTransferSecurityContext): Promise<void> {
  const service = context.createService()
  const expiredPhone = context.nextPhone()
  const expiredAdmin = await context.createAdmin('otp-expired-cleanup')
  await context.createPartner('otp-expired-cleanup', expiredPhone)
  const expiredStarted = await service.start(expiredAdmin.id, context.adminPassword, expiredPhone, '127.0.1.19')
  const expiredCode = await requireTransferCode(context, expiredPhone, '11. OTP expired 场景未生成验证码')
  await context.redis.del(transferCodeKey(expiredPhone))
  await expectCode(
    () => service.verify(expiredAdmin.id, expiredStarted.bindTicket, expiredCode),
    UNAVAILABLE,
    '11. OTP expired 未统一失败',
  )
  assertTemporaryTransferStateCleared(context, expiredAdmin.id, expiredStarted.bindTicket, '11. OTP expired 未清理 ticket/active')

  const lockedPhone = context.nextPhone()
  const lockedAdmin = await context.createAdmin('otp-locked-cleanup')
  await context.createPartner('otp-locked-cleanup', lockedPhone)
  const lockedStarted = await service.start(lockedAdmin.id, context.adminPassword, lockedPhone, '127.0.1.20')
  const lockedCode = await requireTransferCode(context, lockedPhone, '11. OTP locked 场景未生成验证码')
  const wrongCode = differentOtp(lockedCode)
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await expectCode(
      () => service.verify(lockedAdmin.id, lockedStarted.bindTicket, wrongCode),
      'SMS_CODE_INVALID',
      `11. OTP 锁定前第 ${attempt + 1} 次错误不可重试`,
    )
  }
  await expectCode(
    () => service.verify(lockedAdmin.id, lockedStarted.bindTicket, wrongCode),
    UNAVAILABLE,
    '11. OTP locked 未统一失败',
  )
  assertTemporaryTransferStateCleared(context, lockedAdmin.id, lockedStarted.bindTicket, '11. OTP locked 未清理 ticket/active')
  pass('11. OTP expired/locked 均清理 ticket/active，锁定前错误仍可重试')
}

async function verifyLockContentionSkipsOtp(context: AdminPhoneTransferSecurityContext): Promise<void> {
  const phone = context.nextPhone()
  const admin = await context.createAdmin('lock-contention-no-otp')
  await context.createPartner('lock-contention-no-otp', phone)
  const setupService = context.createService()
  const started = await setupService.start(admin.id, context.adminPassword, phone, '127.0.1.21')
  const code = await requireTransferCode(context, phone, '12. 锁竞争场景未生成验证码')
  await context.redis.setEx(verifyLockKey(admin.id, started.bindTicket), 30, 'another-verifier')
  let verifyCalls = 0
  const countingOtp = {
    sendCode: (...args: Parameters<InternalOtpService['sendCode']>) => context.otp.sendCode(...args),
    verifyCode: async () => {
      verifyCalls += 1
    },
  } as unknown as InternalOtpService
  const contendingService = context.createService({ otp: countingOtp })
  await expectCode(
    () => contendingService.verify(admin.id, started.bindTicket, code),
    UNAVAILABLE,
    '12. 锁竞争失败方未统一失败',
  )
  ensure(verifyCalls === 0, '12. 锁竞争失败方错误调用了 verifyCode')
  ensure(
    context.redis.raw(ticketKey(admin.id, started.bindTicket)) !== null &&
      context.redis.raw(activeTicketKey(admin.id)) === started.bindTicket,
    '12. 锁竞争失败方错误消费了 ticket/active',
  )
  await setupService.cancel(admin.id, started.bindTicket)
  pass('12. verify-lock 竞争失败方 verifyCode 调用次数为 0，且不消费 ticket/active')
}

async function verifyActiveTicketMismatchFailsClosed(context: AdminPhoneTransferSecurityContext): Promise<void> {
  const phone = context.nextPhone()
  const admin = await context.createAdmin('active-ticket-mismatch', 4)
  const partner = await context.createPartner('active-ticket-mismatch', phone, 8)
  const service = context.createService()
  const started = await service.start(admin.id, context.adminPassword, phone, '127.0.1.22')
  const code = await requireTransferCode(context, phone, '13. active mismatch 场景未生成验证码')
  await context.redis.setEx(activeTicketKey(admin.id), 300, 'replacement-active-ticket')
  await expectCode(
    () => service.verify(admin.id, started.bindTicket, code),
    UNAVAILABLE,
    '13. active ticket mismatch 未使业务失败',
  )
  const adminAfter = await context.prisma.user.findUniqueOrThrow({ where: { id: admin.id } })
  const partnerAfter = await context.prisma.user.findUniqueOrThrow({ where: { id: partner.id } })
  ensure(
    adminAfter.phoneHash === null &&
      adminAfter.tokenVersion === admin.tokenVersion &&
      partnerAfter.phoneHash === hashPhone(phone) &&
      partnerAfter.tokenVersion === partner.tokenVersion,
    '13. active ticket mismatch 后数据库发生部分转移',
  )
  ensure(context.redis.raw(activeTicketKey(admin.id)) === 'replacement-active-ticket', '13. active CAS 错误删除了新 active ticket')
  pass('13. active-ticket mismatch/CAS 使转移失败、数据库不变且不删除新 active 值')
}

async function verifyTransactionAuditFailuresRollback(context: AdminPhoneTransferSecurityContext): Promise<void> {
  for (const failureIndex of [1, 2]) {
    const phone = context.nextPhone()
    const admin = await context.createAdmin(`transaction-audit-${failureIndex}`, 2)
    const partner = await context.createPartner(`transaction-audit-${failureIndex}`, phone, 7)
    const failingPrisma = prismaFailingNthTransactionAudit(context.prisma, failureIndex)
    const service = context.createService({ prisma: failingPrisma })
    const started = await service.start(admin.id, context.adminPassword, phone, `127.0.1.${22 + failureIndex}`)
    const code = await requireTransferCode(context, phone, `14. 第 ${failureIndex} 条事务审计失败场景无验证码`)
    await expectCode(
      () => service.verify(admin.id, started.bindTicket, code),
      UNAVAILABLE,
      `14. 第 ${failureIndex} 条事务审计失败未回滚`,
    )
    const adminAfter = await context.prisma.user.findUniqueOrThrow({ where: { id: admin.id } })
    const partnerAfter = await context.prisma.user.findUniqueOrThrow({ where: { id: partner.id } })
    const transactionAudits = await context.prisma.auditLog.count({
      where: { actorId: admin.id, action: { in: ['auth.phone_transfer_complete', 'auth.phone_released_by_admin'] } },
    })
    ensure(
      adminAfter.phoneHash === null &&
        adminAfter.tokenVersion === admin.tokenVersion &&
        partnerAfter.phoneHash === hashPhone(phone) &&
        partnerAfter.tokenVersion === partner.tokenVersion &&
        transactionAudits === 0,
      `14. 第 ${failureIndex} 条事务审计失败后双账号或审计未整体回滚`,
    )
  }
  pass('14. complete/released_by_admin 任一事务审计失败均回滚双账号更新与审计')
}

async function verifyBestEffortAuditFailuresAreSafe(context: AdminPhoneTransferSecurityContext): Promise<void> {
  const phone = context.nextPhone()
  const admin = await context.createAdmin('best-effort-audit-failure')
  const partner = await context.createPartner('best-effort-audit-failure', phone)
  const failingAuditPrisma = {
    auditLog: {
      create: async () => {
        throw new Error('simulated audit sink failure')
      },
    },
  } as unknown as PrismaService
  const failingAudit = new AuditService(failingAuditPrisma)
  const capturedLogs: string[] = []
  const originalLoggerError = Logger.prototype.error
  Logger.prototype.error = function (message: unknown, ...optionalParams: unknown[]): void {
    capturedLogs.push([message, ...optionalParams].map(String).join(' '))
  }
  let started: TransferStartResult
  let code: string
  try {
    const service = context.createService({ audit: failingAudit })
    started = await service.start(admin.id, context.adminPassword, phone, '127.0.1.25')
    code = await requireTransferCode(context, phone, '15. best-effort 审计失败场景未生成验证码')
    const cancelled = await service.cancel(admin.id, started.bindTicket)
    ensure(cancelled.cancelled, '15. cancel 审计失败改变了取消结果')
  } finally {
    Logger.prototype.error = originalLoggerError
  }

  const adminAfter = await context.prisma.user.findUniqueOrThrow({ where: { id: admin.id } })
  const partnerAfter = await context.prisma.user.findUniqueOrThrow({ where: { id: partner.id } })
  ensure(adminAfter.phoneHash === null && partnerAfter.phoneHash === hashPhone(phone), '15. start/cancel 审计失败改变了数据库状态')
  assertTemporaryTransferStateCleared(context, admin.id, started.bindTicket, '15. cancel 审计失败未完成临时状态清理')
  const rawLogs = capturedLogs.join('\n')
  ensure(
    rawLogs.includes('auth.phone_transfer_start') && rawLogs.includes('auth.phone_transfer_cancel'),
    '15. start/cancel AuditService 失败未产生可运维错误日志',
  )
  const forbidden = [phone, hashPhone(phone), partner.phoneEnc, context.adminPassword, code, started.bindTicket]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
  ensure(forbidden.every((secret) => !rawLogs.includes(secret)), '15. start/cancel 审计失败日志泄露 ticket/phone/code/密码')
  pass('15. start/cancel AuditService 失败不改变业务结果，且失败日志无 ticket/phone/code')
}

async function verifySourceDeletionAndPasswordChanges(context: AdminPhoneTransferSecurityContext): Promise<void> {
  const deletedPhone = context.nextPhone()
  const deletedAdmin = await context.createAdmin('source-deleted')
  const deletedPartner = await context.createPartner('source-deleted', deletedPhone, 3)
  const service = context.createService()
  const deletedStarted = await service.start(deletedAdmin.id, context.adminPassword, deletedPhone, '127.0.1.26')
  const deletedCode = await requireTransferCode(context, deletedPhone, '16. Partner 删除场景未生成验证码')
  await context.prisma.user.delete({ where: { id: deletedPartner.id } })
  await expectCode(
    () => service.verify(deletedAdmin.id, deletedStarted.bindTicket, deletedCode),
    UNAVAILABLE,
    '16. start 后 Partner 删除未使 CAS 失败',
  )
  const deletedAdminAfter = await context.prisma.user.findUniqueOrThrow({ where: { id: deletedAdmin.id } })
  ensure(deletedAdminAfter.phoneHash === null, '16. Partner 删除后的失败转移污染了 Admin')

  const passwordOnlyPhone = context.nextPhone()
  const passwordOnlyAdmin = await context.createAdmin('source-password-only')
  const passwordOnlyPartner = await context.createPartner('source-password-only', passwordOnlyPhone, 5)
  const passwordOnlyStarted = await service.start(
    passwordOnlyAdmin.id,
    context.adminPassword,
    passwordOnlyPhone,
    '127.0.1.27',
  )
  const passwordOnlyCode = await requireTransferCode(context, passwordOnlyPhone, '16. password-only 场景未生成验证码')
  const changedPassword = `Changed_${randomUUID()}!`
  const changedPasswordHash = await bcrypt.hash(changedPassword, 10)
  await context.prisma.user.update({
    where: { id: passwordOnlyPartner.id },
    data: { passwordHash: changedPasswordHash },
  })
  await service.verify(passwordOnlyAdmin.id, passwordOnlyStarted.bindTicket, passwordOnlyCode)
  const passwordOnlyAfter = await context.prisma.user.findUniqueOrThrow({ where: { id: passwordOnlyPartner.id } })
  ensure(
    passwordOnlyAfter.phoneHash === null &&
      passwordOnlyAfter.tokenVersion === passwordOnlyPartner.tokenVersion + 1 &&
      (await bcrypt.compare(changedPassword, passwordOnlyAfter.passwordHash)),
    '16. passwordHash 单独变化被错误当作授权条件或新密码未保留',
  )

  const credentialVersionPhone = context.nextPhone()
  const credentialVersionAdmin = await context.createAdmin('source-credential-version')
  const credentialVersionPartner = await context.createPartner('source-credential-version', credentialVersionPhone, 9)
  const credentialVersionStarted = await service.start(
    credentialVersionAdmin.id,
    context.adminPassword,
    credentialVersionPhone,
    '127.0.1.28',
  )
  const credentialVersionCode = await requireTransferCode(context, credentialVersionPhone, '16. credential version 场景未生成验证码')
  const newestPassword = `Newest_${randomUUID()}!`
  const newestPasswordHash = await bcrypt.hash(newestPassword, 10)
  await context.prisma.user.update({
    where: { id: credentialVersionPartner.id },
    data: { passwordHash: newestPasswordHash, tokenVersion: { increment: 1 } },
  })
  await expectCode(
    () => service.verify(credentialVersionAdmin.id, credentialVersionStarted.bindTicket, credentialVersionCode),
    UNAVAILABLE,
    '16. 凭据变更后的 tokenVersion CAS 未失败',
  )
  const credentialVersionAdminAfter = await context.prisma.user.findUniqueOrThrow({ where: { id: credentialVersionAdmin.id } })
  const credentialVersionPartnerAfter = await context.prisma.user.findUniqueOrThrow({ where: { id: credentialVersionPartner.id } })
  ensure(
    credentialVersionAdminAfter.phoneHash === null &&
      credentialVersionPartnerAfter.phoneHash === hashPhone(credentialVersionPhone) &&
      credentialVersionPartnerAfter.tokenVersion === credentialVersionPartner.tokenVersion + 1 &&
      (await bcrypt.compare(newestPassword, credentialVersionPartnerAfter.passwordHash)),
    '16. 凭据版本 CAS 失败后发生部分转移或新密码未保留',
  )
  pass('16. Partner 删除/凭据版本变化均 fail-closed；单独 passwordHash 变化不阻断且保留新密码')
}

async function verifyTicketValidationFailures(context: AdminPhoneTransferSecurityContext): Promise<void> {
  const service = context.createService()

  const malformedPhone = context.nextPhone()
  const malformedAdmin = await context.createAdmin('ticket-malformed')
  const malformedPartner = await context.createPartner('ticket-malformed', malformedPhone)
  const malformedStarted = await service.start(malformedAdmin.id, context.adminPassword, malformedPhone, '127.0.1.29')
  const malformedCode = await requireTransferCode(context, malformedPhone, '17. malformed ticket 场景未生成验证码')
  const malformedKey = ticketKey(malformedAdmin.id, malformedStarted.bindTicket)
  const validSerialized = await context.redis.get(malformedKey)
  ensure(validSerialized, '17. malformed ticket 场景缺少 ticket')
  const malformedValue = { ...(JSON.parse(validSerialized) as Record<string, unknown>), unexpected: true }
  await context.redis.setEx(malformedKey, 300, JSON.stringify(malformedValue))
  await expectCode(
    () => service.verify(malformedAdmin.id, malformedStarted.bindTicket, malformedCode),
    UNAVAILABLE,
    '17. 含额外 key 的 ticket 未被拒绝',
  )
  assertTemporaryTransferStateCleared(context, malformedAdmin.id, malformedStarted.bindTicket, '17. malformed ticket 未清理临时状态')
  const malformedPartnerAfter = await context.prisma.user.findUniqueOrThrow({ where: { id: malformedPartner.id } })
  ensure(malformedPartnerAfter.phoneHash === hashPhone(malformedPhone), '17. malformed ticket 修改了 Partner')

  const stalePhone = context.nextPhone()
  const staleAdmin = await context.createAdmin('ticket-stale', 4)
  const stalePartner = await context.createPartner('ticket-stale', stalePhone)
  const staleStarted = await service.start(staleAdmin.id, context.adminPassword, stalePhone, '127.0.1.30')
  const staleCode = await requireTransferCode(context, stalePhone, '17. stale ticket 场景未生成验证码')
  await context.prisma.user.update({ where: { id: staleAdmin.id }, data: { tokenVersion: { increment: 1 } } })
  await expectCode(
    () => service.verify(staleAdmin.id, staleStarted.bindTicket, staleCode),
    UNAVAILABLE,
    '17. Admin tokenVersion stale ticket 未被拒绝',
  )
  assertTemporaryTransferStateCleared(context, staleAdmin.id, staleStarted.bindTicket, '17. stale ticket 未清理临时状态')
  const stalePartnerAfter = await context.prisma.user.findUniqueOrThrow({ where: { id: stalePartner.id } })
  ensure(stalePartnerAfter.phoneHash === hashPhone(stalePhone), '17. stale ticket 修改了 Partner')

  const hashPhoneValue = context.nextPhone()
  const hashAdmin = await context.createAdmin('ticket-phone-hash')
  const hashPartner = await context.createPartner('ticket-phone-hash', hashPhoneValue)
  const hashStarted = await service.start(hashAdmin.id, context.adminPassword, hashPhoneValue, '127.0.1.31')
  const hashCode = await requireTransferCode(context, hashPhoneValue, '17. phone-hash ticket 场景未生成验证码')
  const hashTicketKey = ticketKey(hashAdmin.id, hashStarted.bindTicket)
  const hashSerialized = await context.redis.get(hashTicketKey)
  ensure(hashSerialized, '17. phone-hash ticket 场景缺少 ticket')
  const mismatchedTicket = JSON.parse(hashSerialized) as Record<string, unknown>
  mismatchedTicket['phoneHash'] = hashPhone(context.nextPhone())
  await context.redis.setEx(hashTicketKey, 300, JSON.stringify(mismatchedTicket))
  await expectCode(
    () => service.verify(hashAdmin.id, hashStarted.bindTicket, hashCode),
    UNAVAILABLE,
    '17. 解密手机号与 phoneHash 不一致未被拒绝',
  )
  assertTemporaryTransferStateCleared(context, hashAdmin.id, hashStarted.bindTicket, '17. phone-hash mismatch 未清理临时状态')
  const hashPartnerAfter = await context.prisma.user.findUniqueOrThrow({ where: { id: hashPartner.id } })
  ensure(hashPartnerAfter.phoneHash === hashPhone(hashPhoneValue), '17. phone-hash mismatch 修改了 Partner')
  pass('17. ticket exact-key/malformed、Admin stale 与解密手机号 hash 不一致均 fail-closed')
}

async function verifySmsFailureCleansTicket(context: AdminPhoneTransferSecurityContext): Promise<void> {
  const phone = context.nextPhone()
  const admin = await context.createAdmin('sms-send-failure')
  await context.createPartner('sms-send-failure', phone)
  const failingSender = {
    sendCode: async () => {
      throw new Error('simulated sms provider failure')
    },
  }
  const failingOtp = new InternalOtpService(context.redis as unknown as RedisService, failingSender)
  const service = context.createService({ otp: failingOtp })
  await expectCode(
    () => service.start(admin.id, context.adminPassword, phone, '127.0.1.32'),
    UNAVAILABLE,
    '18. 短信发送异常未统一失败',
  )
  ensure(context.redis.raw(activeTicketKey(admin.id)) === null, '18. 短信发送异常未清理 active ticket')
  ensure(
    context.redis.keysWithPrefix(`internal:admin:phone-transfer:ticket:${admin.id}:`).length === 0,
    '18. 短信发送异常遗留 ticket',
  )
  ensure(context.redis.raw(transferCodeKey(phone)) === null, '18. 短信发送异常遗留 transfer_phone OTP')
  pass('18. 短信发送异常清理 ticket/active/OTP，且不连接真实短信')
}

async function verifyPartnerAuthenticationFallbacks(context: AdminPhoneTransferSecurityContext): Promise<void> {
  const phone = context.nextPhone()
  const admin = await context.createAdmin('auth-fallback-admin')
  const partner = await context.createPartner('auth-fallback-partner', phone, 2)
  const transferService = context.createService()
  const started = await transferService.start(admin.id, context.adminPassword, phone, '127.0.1.33')
  const transferCode = await requireTransferCode(context, phone, '19. AuthService 兜底场景未生成验证码')
  await transferService.verify(admin.id, started.bindTicket, transferCode)

  const authService = new AuthService(
    context.jwt,
    context.prisma,
    context.redis as unknown as RedisService,
    context.otp,
    context.audit as unknown as AuditService,
  )
  const passwordLogin = await authService.login(partner.username, context.partnerPassword, 'partner')
  ensure(passwordLogin.user.id === partner.id && passwordLogin.user.role === 'partner', '19. Partner 用户名密码登录未保留')

  const deliveriesBeforeSmsLogin = context.sms.deliveries
  await authService.sendSmsCode({ phone, purpose: 'login', portal: 'partner' }, '127.0.1.34')
  ensure(context.sms.deliveries === deliveriesBeforeSmsLogin, '19. Partner 转移后短信登录仍发送验证码')
  await expectCode(
    () => authService.loginWithSms(phone, '000000', 'partner'),
    'SMS_CODE_EXPIRED',
    '19. Partner 转移后短信登录未失败',
  )

  const deliveriesBeforeReset = context.sms.deliveries
  await authService.startPasswordReset(partner.username, '127.0.1.35')
  ensure(context.sms.deliveries === deliveriesBeforeReset, '19. Partner 转移后短信找回仍发送验证码')
  await expectCode(
    () => authService.verifyPasswordReset(partner.username, '000000'),
    'AUTH_RESET_FAILED',
    '19. Partner 转移后短信找回未失败',
  )

  const adminOrgs = new AdminOrgsService(
    context.prisma,
    context.audit as unknown as AuditService,
    context.redis as unknown as RedisService,
  )
  const resetPassword = `AdminReset_${randomUUID()}!`
  await adminOrgs.resetAccountPassword(context.orgId, partner.id, resetPassword, {
    userId: admin.id,
    role: 'admin',
    orgId: null,
  })
  await expectCode(
    () => authService.login(partner.username, context.partnerPassword, 'partner'),
    'AUTH_LOGIN_FAILED',
    '19. Admin 重置后 Partner 旧密码仍可登录',
  )
  const resetLogin = await authService.login(partner.username, resetPassword, 'partner')
  ensure(resetLogin.user.id === partner.id, '19. Admin 重置后 Partner 新密码不可登录')
  pass('19. Partner 用户名密码登录保留；短信登录/找回失效；Admin 重置密码后新密码可用')
}

export async function verifyAdminPhoneTransferSecurityCases(
  context: AdminPhoneTransferSecurityContext,
): Promise<void> {
  await verifyCancelLockCleanup(context)
  await verifyOtpTerminalFailuresCleanup(context)
  await verifyLockContentionSkipsOtp(context)
  await verifyActiveTicketMismatchFailsClosed(context)
  await verifyTransactionAuditFailuresRollback(context)
  await verifyBestEffortAuditFailuresAreSafe(context)
  await verifySourceDeletionAndPasswordChanges(context)
  await verifyTicketValidationFailures(context)
  await verifySmsFailureCleansTicket(context)
  await verifyPartnerAuthenticationFallbacks(context)
}
