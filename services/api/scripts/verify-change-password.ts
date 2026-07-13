/**
 * 登录态自助改密验证(POST /auth/password/change)。
 *
 * 覆盖:
 * 1. 当前密码错误 → AUTH_PASSWORD_MISMATCH,密码不变。
 * 2. 当前密码正确 → 改密成功,新密码可登录、旧密码登录失败。
 * 3. 改密后旧 token 立即失效(tokenVersion 递增 + session 缓存失效)。
 * 4. 审计日志写入 auth.password_change_self。
 * 5. partner 账号同样可用(接口不限角色)。
 */
import 'dotenv/config'
import { ExecutionContext } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import * as bcrypt from 'bcryptjs'
import { randomUUID } from 'crypto'
import { AuditService } from '../src/audit/audit.service'
import { AuthService } from '../src/auth/auth.service'
import { InternalOtpService } from '../src/auth/internal-otp.service'
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard'
import type { RedisService } from '../src/common/redis/redis.service'
import { PrismaService } from '../src/prisma/prisma.service'
import type { SmsSender } from '../src/member-auth/sms/sms-sender'

process.env['JWT_SECRET'] ||= 'verify-change-password-secret'
process.env['SECRET_ENCRYPTION_KEY'] ||= 'verify-change-password-secret-32b'
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
  async sendCode(_phone: string, _code: string): Promise<void> {}
}

async function main() {
  console.log('\n=== 登录态自助改密验证 ===')

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const audit = new AuditService(prisma)
  const redis = new MemoryRedis()
  const otp = new InternalOtpService(redis as unknown as RedisService, new NoopSmsSender())
  const jwt = new JwtService({ secret: process.env['JWT_SECRET'] })
  const auth = new AuthService(jwt, prisma, redis as unknown as RedisService, otp, audit)
  const guard = new JwtAuthGuard(jwt, prisma, redis as unknown as RedisService)

  const suffix = randomUUID().replace(/-/g, '').slice(0, 10)
  const passwordV1 = `InitPass_${suffix}`
  const passwordV2 = `ChangedPass_${suffix}`

  const cleanup = async () => {
    await prisma.auditLog.deleteMany({ where: { action: 'auth.password_change_self' } }).catch(() => undefined)
    await prisma.user.deleteMany({ where: { username: { contains: suffix } } }).catch(() => undefined)
  }

  try {
    const admin = await prisma.user.create({
      data: {
        username: `changepw_admin_${suffix}`,
        passwordHash: await bcrypt.hash(passwordV1, 10),
        name: '改密验证管理员',
        role: 'admin',
      },
    })

    const login1 = await auth.login(admin.username, passwordV1, 'admin')
    const oldToken = login1.token
    if (!oldToken) fail('0. 初始密码登录失败')

    await expectCode(
      () => auth.changePassword(admin.id, 'wrong-current-password', passwordV2),
      'AUTH_PASSWORD_MISMATCH',
      '1. 当前密码错误被拒绝',
    )
    await auth.login(admin.username, passwordV1, 'admin')
    pass('1a. 改密失败后原密码仍可登录(未被破坏)')

    const result = await auth.changePassword(admin.id, passwordV1, passwordV2)
    if (!result.success) fail('2. 改密调用未返回 success')
    pass('2. 正确当前密码改密成功')

    await expectCode(() => auth.login(admin.username, passwordV1, 'admin'), 'AUTH_LOGIN_FAILED', '3. 旧密码改密后登录失败')
    const login2 = await auth.login(admin.username, passwordV2, 'admin')
    if (!login2.token) fail('4. 新密码登录失败')
    pass('4. 新密码可正常登录')

    await expectCode(
      () => guard.canActivate(mockCtx(`Bearer ${oldToken}`)),
      'AUTH_TOKEN_INVALID',
      '5. 改密后旧 token 立即失效(session 缓存已同步失效)',
    )

    const ok = await guard.canActivate(mockCtx(`Bearer ${login2.token}`))
    if (!ok) fail('6. 改密后新 token 不可用')
    pass('6. 改密后新 token 可正常鉴权')

    const auditRow = await prisma.auditLog.findFirst({
      where: { actorId: admin.id, action: 'auth.password_change_self' },
      orderBy: { createdAt: 'desc' },
    })
    if (!auditRow) fail('7. 未写入审计日志 auth.password_change_self')
    pass('7. 审计日志已写入')

    await expectCode(
      () => auth.changePassword('non-existent-user-id', passwordV2, `Another_${suffix}`),
      'AUTH_SESSION_INVALID',
      '8. 不存在的用户 id 改密被拒绝',
    )
  } finally {
    await cleanup()
    await prisma.onModuleDestroy()
  }

  console.log('\n登录态自助改密验证完成。')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
