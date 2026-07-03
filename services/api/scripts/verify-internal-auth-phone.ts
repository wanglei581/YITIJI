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
import { randomUUID } from 'crypto'
import { AuditService } from '../src/audit/audit.service'
import { AuthService } from '../src/auth/auth.service'
import { InternalOtpService } from '../src/auth/internal-otp.service'
import { encryptPhone, hashPhone } from '../src/common/crypto/phone-identity'
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
}

class NoopSmsSender implements SmsSender {
  sent: Array<{ phone: string; code: string }> = []

  async sendCode(phone: string, code: string): Promise<void> {
    this.sent.push({ phone, code })
  }
}

async function main() {
  console.log('\n=== 内部账号手机号认证验证 ===')

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const audit = new AuditService(prisma)
  const redis = new MemoryRedis()
  const sms = new NoopSmsSender()
  const otp = new InternalOtpService(redis as unknown as RedisService, sms)
  const jwt = new JwtService({ secret: process.env['JWT_SECRET'] })
  const auth = new AuthService(jwt, prisma, redis as unknown as RedisService, otp, audit)
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
    await prisma.auditLog.deleteMany({ where: { action: { startsWith: 'auth.' } } }).catch(() => undefined)
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
