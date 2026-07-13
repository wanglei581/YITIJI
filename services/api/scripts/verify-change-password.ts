/**
 * 登录态自助改密验证(POST /auth/password/change)。
 *
 * 覆盖:
 * 1. 当前密码错误 → AUTH_PASSWORD_MISMATCH,密码不变。
 * 2. 当前密码正确 → 改密成功,新密码可登录、旧密码登录失败。
 * 3. 改密后旧 token 立即失效 —— 且在改密前先"预热" JwtAuthGuard 的 Redis session-state
 *    缓存,确保断言的是 invalidateSessionState() 真的清了缓存,而不是缓存本来就是空的、
 *    退化成"冷缓存直接查库"这种即使漏删缓存也会通过的假阳性。
 * 4. 审计日志写入 auth.password_change_self,且只清理本次测试自己写的记录
 *    (不能按 action 全局 deleteMany,否则会删掉其他账号的真实改密审计)。
 * 5. partner 账号同样可用(接口不限角色)。
 * 6. 新密码与当前密码相同 → 服务端拒绝(不能只依赖前端校验)。
 * 7. 并发改密:两个请求读到同一旧 hash 校验通过后,只允许一个真正写入,
 *    另一个拿到 AUTH_CHANGE_PASSWORD_CONFLICT,不能出现"两边都成功但只有一边生效"的静默丢失更新。
 * 8. 连续输错当前密码达到阈值后触发按用户维度的限流(IP 限流对已持有 token 的场景不够)。
 * 9. DTO 校验:新密码按 UTF-8 字节数(而非字符数)拒绝超过 72 字节的密码,
 *    防止 bcrypt 72 字节截断在中文密码下静默生效。
 */
import 'dotenv/config'
import { ExecutionContext } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import * as bcrypt from 'bcryptjs'
import { randomUUID } from 'crypto'
import { AuditService } from '../src/audit/audit.service'
import { AuthService } from '../src/auth/auth.service'
import { ChangePasswordDto } from '../src/auth/dto/internal-auth.dto'
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
  let orgId = ''
  let adminId = ''
  let partnerId = ''

  // 只清理本次测试自己创建的账号 id 关联的审计记录,绝不按 action 全局 deleteMany——
  // 那会连带删掉其他账号(含真实生产/预发数据)的改密审计,破坏取证链路。
  const cleanup = async () => {
    const actorIds = [adminId, partnerId].filter(Boolean)
    if (actorIds.length) {
      await prisma.auditLog.deleteMany({ where: { actorId: { in: actorIds } } }).catch(() => undefined)
    }
    await prisma.user.deleteMany({ where: { username: { contains: suffix } } }).catch(() => undefined)
    if (orgId) await prisma.organization.delete({ where: { id: orgId } }).catch(() => undefined)
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
    adminId = admin.id

    const login1 = await auth.login(admin.username, passwordV1, 'admin')
    const oldToken = login1.token
    if (!oldToken) fail('0. 初始密码登录失败')

    // 预热 session-state 缓存:改密前先用旧 token 走一次 Guard,确保 Redis 里
    // 真的缓存了旧 tokenVersion。否则下面第 5 步"旧 token 失效"哪怕漏删缓存
    // 也会因为缓存本来就是空的、退化成查库而误判通过。
    const warmed = await guard.canActivate(mockCtx(`Bearer ${oldToken}`))
    if (!warmed) fail('0a. 预热 session-state 缓存失败(初始 token 应可用)')
    pass('0a. 已预热 session-state 缓存')

    await expectCode(
      () => auth.changePassword(admin.id, 'wrong-current-password', passwordV2),
      'AUTH_PASSWORD_MISMATCH',
      '1. 当前密码错误被拒绝',
    )
    await auth.login(admin.username, passwordV1, 'admin')
    pass('1a. 改密失败后原密码仍可登录(未被破坏)')

    await expectCode(
      () => auth.changePassword(admin.id, passwordV1, passwordV1),
      'AUTH_PASSWORD_UNCHANGED',
      '1b. 新密码与当前密码相同被服务端拒绝(不只靠前端校验)',
    )

    // 并发改密:两个请求都用同一个正确的旧密码,但改成不同的新密码。
    // 期望恰好一个成功、一个因乐观并发冲突失败,数据库最终落地的密码必须是
    // "成功那一侧"提交的值,不能出现两边都返回 success 但静默覆盖的丢失更新。
    const concurrentA = `ConcurrentA_${suffix}`
    const concurrentB = `ConcurrentB_${suffix}`
    const [resA, resB] = await Promise.allSettled([
      auth.changePassword(admin.id, passwordV1, concurrentA),
      auth.changePassword(admin.id, passwordV1, concurrentB),
    ])
    const succeeded = [resA, resB].filter((r) => r.status === 'fulfilled')
    const conflicted = [resA, resB].filter(
      (r) => r.status === 'rejected' && errCode(r.reason) === 'AUTH_CHANGE_PASSWORD_CONFLICT',
    )
    if (succeeded.length !== 1 || conflicted.length !== 1) {
      fail(`2. 并发改密未按预期收敛为"一成功一冲突"(成功 ${succeeded.length} 个,冲突 ${conflicted.length} 个)`)
    }
    pass('2. 并发改密:一个成功、一个正确报 AUTH_CHANGE_PASSWORD_CONFLICT')
    const winningPassword = resA.status === 'fulfilled' ? concurrentA : concurrentB
    const losingPassword = resA.status === 'fulfilled' ? concurrentB : concurrentA
    await expectCode(() => auth.login(admin.username, losingPassword, 'admin'), 'AUTH_LOGIN_FAILED', '2a. 落败一侧的新密码不可登录')
    const loginAfterRace = await auth.login(admin.username, winningPassword, 'admin')
    if (!loginAfterRace.token) fail('2b. 获胜一侧的新密码应可登录')
    pass('2b. 数据库最终一致地保留了获胜一侧的新密码')

    const result = await auth.changePassword(admin.id, winningPassword, passwordV2)
    if (!result.success) fail('3. 改密调用未返回 success')
    pass('3. 正确当前密码改密成功')

    await expectCode(() => auth.login(admin.username, winningPassword, 'admin'), 'AUTH_LOGIN_FAILED', '4. 旧密码改密后登录失败')
    const login2 = await auth.login(admin.username, passwordV2, 'admin')
    if (!login2.token) fail('4a. 新密码登录失败')
    pass('4a. 新密码可正常登录')

    await expectCode(
      () => guard.canActivate(mockCtx(`Bearer ${oldToken}`)),
      'AUTH_TOKEN_INVALID',
      '5. 改密后旧 token 立即失效(预热过的 session 缓存已同步清除)',
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

    // 按用户维度限流:连续输错当前密码,IP 维度限流覆盖不到"已持有 token 但不知道
    // 当前密码"的场景(比如 token 被盗用)。用独立账号测试,避免和前面几步已经
    // 对 admin.id 计过数的失败次数耦合,保证阈值断言不受执行顺序影响。
    const rateLimitUser = await prisma.user.create({
      data: {
        username: `changepw_ratelimit_${suffix}`,
        passwordHash: await bcrypt.hash(passwordV1, 10),
        name: '改密限流验证账号',
        role: 'admin',
      },
    })
    for (let i = 0; i < 5; i++) {
      await expectCode(
        () => auth.changePassword(rateLimitUser.id, `still-wrong-${i}`, passwordV2),
        'AUTH_PASSWORD_MISMATCH',
        `9.${i}. 第 ${i + 1} 次输错当前密码仍报密码错误`,
      )
    }
    await expectCode(
      () => auth.changePassword(rateLimitUser.id, `still-wrong-final`, passwordV2),
      'AUTH_CHANGE_PASSWORD_RATE_LIMITED',
      '9a. 连续输错达到阈值后触发按用户限流',
    )
    await expectCode(
      () => auth.changePassword(rateLimitUser.id, passwordV1, passwordV2),
      'AUTH_CHANGE_PASSWORD_RATE_LIMITED',
      '9b. 限流生效期间即便这次输入了正确的当前密码也仍被拒绝',
    )

    // partner 角色同样可用(接口不限角色)
    const org = await prisma.organization.create({
      data: {
        id: `org_${suffix}`,
        name: `改密验证机构_${suffix}`,
        type: 'public_employment_service',
        sceneTemplate: 'public_employment',
        enabledModulesJson: '[]',
      },
    })
    orgId = org.id
    const partner = await prisma.user.create({
      data: {
        username: `changepw_partner_${suffix}`,
        passwordHash: await bcrypt.hash(passwordV1, 10),
        name: '改密验证机构账号',
        role: 'partner',
        orgId,
      },
    })
    partnerId = partner.id
    await auth.changePassword(partner.id, passwordV1, passwordV2)
    const partnerLogin = await auth.login(partner.username, passwordV2, 'partner')
    if (!partnerLogin.token) fail('10. partner 账号改密后应可用新密码登录')
    pass('10. partner 账号同样可用登录态自助改密')

    // DTO 校验:25 个中文字符 = 75 字节 > 72,应被拒绝;72 字节以内的中文应通过。
    const cjkOverLimit = '密'.repeat(25) // 75 bytes
    const cjkWithinLimit = '密'.repeat(20) // 60 bytes
    const overLimitDto = plainToInstance(ChangePasswordDto, { currentPassword: passwordV2, newPassword: cjkOverLimit })
    const overLimitErrors = await validate(overLimitDto)
    if (!overLimitErrors.some((e) => e.constraints && 'isBcryptSafeByteLength' in e.constraints)) {
      fail('11. 超过 72 字节的中文新密码应被 DTO 校验拒绝(isBcryptSafeByteLength)')
    }
    pass('11. DTO 校验:超 72 字节的中文新密码被拒绝(防 bcrypt 静默截断)')

    const withinLimitDto = plainToInstance(ChangePasswordDto, { currentPassword: passwordV2, newPassword: cjkWithinLimit })
    const withinLimitErrors = await validate(withinLimitDto)
    if (withinLimitErrors.some((e) => e.constraints && 'isBcryptSafeByteLength' in e.constraints)) {
      fail('11a. 60 字节以内的中文新密码不应被字节长度校验拒绝')
    }
    pass('11a. DTO 校验:字节数在阈值内的中文新密码通过')
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
