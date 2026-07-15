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
 */
import 'dotenv/config'
import { ExecutionContext } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import * as bcrypt from 'bcryptjs'
import { validate } from 'class-validator'
import { randomUUID } from 'crypto'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import type { AuditService } from '../src/audit/audit.service'
import { AuthService } from '../src/auth/auth.service'
import { InitialPhoneBindStartDto, InitialPhoneBindVerifyDto } from '../src/auth/dto/internal-auth.dto'
import { InternalOtpService } from '../src/auth/internal-otp.service'
import { assertInternalAuthVerifyTarget } from '../src/auth/internal-auth-verify-target'
import { encryptPhone, hashPhone, maskPhone } from '../src/common/crypto/phone-identity'
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard'
import type { RedisService } from '../src/common/redis/redis.service'
import { PrismaService } from '../src/prisma/prisma.service'
import type { SmsSender } from '../src/member-auth/sms/sms-sender'

process.env['JWT_SECRET'] ||= 'verify-internal-auth-phone-secret'
process.env['SECRET_ENCRYPTION_KEY'] ||= 'verify-internal-auth-phone-secret-32b'
process.env['DATABASE_URL'] ||= 'file:./prisma/dev.db'

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

function mockCtx(authHeader?: string): ExecutionContext {
  const req = { headers: authHeader ? { authorization: authHeader } : {} }
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext
}

class MemoryRedis {
  private readonly store = new Map<string, string>()

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.store.get(key) ?? null)
  }

  getDel(key: string): Promise<string | null> {
    const value = this.store.get(key) ?? null
    this.store.delete(key)
    return Promise.resolve(value)
  }

  getAndDelIfEquals(key: string, expectedValue: string): Promise<'missing' | 'matched' | 'mismatched'> {
    const value = this.store.get(key)
    if (!value) return Promise.resolve('missing')
    if (value !== expectedValue) return Promise.resolve('mismatched')
    this.store.delete(key)
    return Promise.resolve('matched')
  }

  async setEx(key: string, _ttlSeconds: number, value: string): Promise<void> {
    this.store.set(key, value)
  }

  setJsonIfVersionNotOlder(
    key: string,
    _ttlSeconds: number,
    value: string,
    tokenVersion: number,
  ): Promise<'stored' | 'stale'> {
    const current = this.store.get(key)
    if (current) {
      const currentVersion = (JSON.parse(current) as { tokenVersion?: number }).tokenVersion
      if (typeof currentVersion === 'number' && currentVersion > tokenVersion) return Promise.resolve('stale')
    }
    this.store.set(key, value)
    return Promise.resolve('stored')
  }

  del(key: string): Promise<number> {
    const existed = this.store.delete(key)
    return Promise.resolve(existed ? 1 : 0)
  }

  setNxEx(key: string, value: string, _ttlSeconds: number): Promise<boolean> {
    if (this.store.has(key)) return Promise.resolve(false)
    this.store.set(key, value)
    return Promise.resolve(true)
  }

  incrWithTtl(key: string, _ttlSeconds: number): Promise<number> {
    const next = Number(this.store.get(key) ?? '0') + 1
    this.store.set(key, String(next))
    return Promise.resolve(next)
  }

  reserveWithinLimitWithTtl(key: string, _ttlSeconds: number, limit: number): Promise<boolean> {
    const current = Number(this.store.get(key) ?? '0')
    if (current >= limit) return Promise.resolve(false)
    this.store.set(key, String(current + 1))
    return Promise.resolve(true)
  }

  releaseReservedLimit(key: string): Promise<void> {
    const current = Number(this.store.get(key) ?? '0')
    if (current <= 1) this.store.delete(key)
    else this.store.set(key, String(current - 1))
    return Promise.resolve()
  }

  values(): string[] {
    return [...this.store.values()]
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

async function main() {
  console.log('\n=== 内部账号手机号认证验证 ===')
  assertInternalAuthVerifyTarget(process.env)
  assertInitialPhoneBindRouteContract()

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

    const initialCandidatePhone = phone('136', 4)
    await expectCode(
      () => initialPhoneBind.start(unboundAdmin.id, 'wrong-password', initialCandidatePhone, '127.0.0.1'),
      'AUTH_PASSWORD_MISMATCH',
      '9. 首次绑定拒绝错误当前密码',
    )
    await expectCodeAndMessage(
      () => initialPhoneBind.start(verified.id, passwordV2, initialCandidatePhone, '127.0.0.1'),
      'PHONE_SELF_ALREADY_BOUND',
      '当前账号已绑定手机号，请刷新页面确认状态',
      '9a. 已绑定账号不能重复首次绑定，且返回本账号已绑定语义',
    )
    await expectCode(
      () => initialPhoneBind.start(unboundAdmin.id, passwordV1, verifiedPhone, '127.0.0.1'),
      'PHONE_ALREADY_BOUND',
      '9b. 首次绑定预检查拒绝已被占用的手机号',
    )

    const rateLimitedAdmin = await prisma.user.create({
      data: {
        username: `via_initial_rate_${suffix}`,
        passwordHash: await bcrypt.hash(passwordV1, 10),
        name: '首次绑定限流账号',
        role: 'admin',
      },
    })
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await expectCode(
        () => initialPhoneBind.start(rateLimitedAdmin.id, 'wrong-password', phone('130', attempt), '127.0.0.1'),
        'AUTH_PASSWORD_MISMATCH',
        `9c.${attempt}. 首次绑定错误当前密码计入逐用户限流`,
      )
    }
    await expectCode(
      () => initialPhoneBind.start(rateLimitedAdmin.id, 'wrong-password', phone('130', 6), '127.0.0.1'),
      'AUTH_PHONE_BIND_PASSWORD_RATE_LIMITED',
      '9d. 首次绑定第六次错误当前密码被拒绝',
    )

    const firstBind = await initialPhoneBind.start(
      unboundAdmin.id,
      passwordV1,
      initialCandidatePhone,
      '127.0.0.1',
      'verify-initial-bind-device',
    )
    const firstBindRaw = JSON.stringify(firstBind)
    const firstBindCode = await redis.get(`internal:sms:code:bind_phone:${hashPhone(initialCandidatePhone)}`)
    const firstTicketRecord = await redis.get(`internal:phone-initial-bind:ticket:${unboundAdmin.id}:${firstBind.bindTicket}`)
    if (
      !firstBindCode ||
      !firstTicketRecord ||
      firstBind.cooldownSeconds !== 60 ||
      firstBind.expiresInSeconds !== 300 ||
      firstBind.bindTicket.length < 16 ||
      sms.sent.at(-1)?.phone !== initialCandidatePhone ||
      firstBindRaw.includes(initialCandidatePhone) ||
      firstBindRaw.includes(passwordV1) ||
      firstTicketRecord.includes(initialCandidatePhone)
    ) {
      fail('10. 首次绑定未仅向候选手机号发送验证码，或响应/ticket 泄露明文敏感数据')
    }
    pass('10. 首次绑定仅向候选手机号发送验证码，ticket 不保存明文手机号')

    await expectCode(
      () => initialPhoneBind.verify(unboundPartner.id, firstBind.bindTicket, firstBindCode),
      'PHONE_BIND_TICKET_INVALID',
      '10a. 绑定 ticket 不能跨用户使用',
    )
    if (!await redis.get(`internal:phone-initial-bind:ticket:${unboundAdmin.id}:${firstBind.bindTicket}`)) {
      fail('10b. 跨用户验证错误消耗了原用户 ticket')
    }
    const wrongInitialCode = firstBindCode === '000000' ? '111111' : '000000'
    await expectCode(
      () => initialPhoneBind.verify(unboundAdmin.id, firstBind.bindTicket, wrongInitialCode),
      'SMS_CODE_INVALID',
      '10c. 首次绑定拒绝错误验证码',
    )
    await expectCode(
      () => initialPhoneBind.verify(unboundAdmin.id, firstBind.bindTicket, firstBindCode),
      'PHONE_BIND_TICKET_INVALID',
      '10d. 首次绑定 ticket 不能重放',
    )

    const successPhone = phone('135', 5)
    const successBind = await initialPhoneBind.start(unboundPartner.id, passwordV1, successPhone, '127.0.0.1')
    const successCode = await redis.get(`internal:sms:code:bind_phone:${hashPhone(successPhone)}`)
    if (!successCode) fail('11. 成功首次绑定场景未写入验证码')
    const successResult = await initialPhoneBind.verify(unboundPartner.id, successBind.bindTicket, successCode)
    const boundPartner = await prisma.user.findUniqueOrThrow({ where: { id: unboundPartner.id } })
    const successRaw = JSON.stringify(successResult)
    const auditRaw = JSON.stringify(audit.entries)
    if (
      successResult.phoneMasked !== maskPhone(successPhone) ||
      !successResult.phoneVerifiedAt ||
      boundPartner.phoneHash !== hashPhone(successPhone) ||
      !boundPartner.phoneEnc ||
      !boundPartner.phoneVerifiedAt ||
      boundPartner.tokenVersion !== 8 ||
      [successPhone, successCode, successBind.bindTicket, hashPhone(successPhone), boundPartner.phoneEnc]
        .some((secret) => successRaw.includes(secret) || auditRaw.includes(secret))
    ) {
      fail('11. 成功首次绑定未按约束写入，或响应/审计泄露敏感数据')
    }
    pass('11. partner 首次绑定 CAS 写入三字段且响应/审计仅含脱敏数据')

    const racePhone = phone('134', 6)
    const raceBind = await initialPhoneBind.start(unboundAdmin.id, passwordV1, racePhone, '127.0.0.1')
    const raceCode = await redis.get(`internal:sms:code:bind_phone:${hashPhone(racePhone)}`)
    if (!raceCode) fail('12. 手机号冲突复检场景未写入验证码')
    await prisma.user.create({
      data: {
        username: `via_initial_phone_owner_${suffix}`,
        passwordHash: await bcrypt.hash(passwordV1, 10),
        name: '并发占用手机号账号',
        role: 'admin',
        phoneHash: hashPhone(racePhone),
        phoneEnc: encryptPhone(racePhone),
        phoneVerifiedAt: new Date(),
      },
    })
    await expectCode(
      () => initialPhoneBind.verify(unboundAdmin.id, raceBind.bindTicket, raceCode),
      'PHONE_ALREADY_BOUND',
      '12. 完成首次绑定前再次检查手机号唯一性',
    )

    const casPhone = phone('133', 7)
    const casBind = await initialPhoneBind.start(unboundAdmin.id, passwordV1, casPhone, '127.0.0.1')
    const casCode = await redis.get(`internal:sms:code:bind_phone:${hashPhone(casPhone)}`)
    if (!casCode) fail('13. CAS 冲突场景未写入验证码')
    const otherPhone = phone('132', 8)
    await prisma.user.update({
      where: { id: unboundAdmin.id },
      data: {
        phoneHash: hashPhone(otherPhone),
        phoneEnc: encryptPhone(otherPhone),
        phoneVerifiedAt: new Date(),
      },
    })
    await expectCode(
      () => initialPhoneBind.verify(unboundAdmin.id, casBind.bindTicket, casCode),
      'PHONE_BIND_CONFLICT',
      '13. 并发状态变化会由 phoneEnc=null CAS 拒绝覆盖',
    )
  } finally {
    await cleanup()
    await prisma.onModuleDestroy()
  }

  console.log('\n内部账号手机号认证验证完成。')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
