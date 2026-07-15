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
 * 10. DTO 校验:新密码至少 12 位,并至少包含大写字母、小写字母、数字、特殊字符中的 3 类。
 */
import 'dotenv/config'
import { ExecutionContext } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import * as bcrypt from 'bcryptjs'
import { randomUUID } from 'crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { AuditService } from '../src/audit/audit.service'
import { AuthController } from '../src/auth/auth.controller'
import { AuthService } from '../src/auth/auth.service'
import { ChangePasswordDto, PasswordResetCompleteDto } from '../src/auth/dto/internal-auth.dto'
import { InternalOtpService } from '../src/auth/internal-otp.service'
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard'
import { ROLES_KEY } from '../src/common/decorators/roles.decorator'
import type { RedisService } from '../src/common/redis/redis.service'
import { PrismaService } from '../src/prisma/prisma.service'
import type { SmsSender } from '../src/member-auth/sms/sms-sender'

process.env['JWT_SECRET'] ||= 'verify-change-password-secret'
process.env['SECRET_ENCRYPTION_KEY'] ||= 'verify-change-password-secret-32b'
const dedicatedDatabasePath = resolve(__dirname, '../prisma/verify-change-password.db')
if (
  process.env['NODE_ENV'] === 'production' ||
  process.env['DATABASE_URL'] !== 'file:./prisma/verify-change-password.db' ||
  process.env['VERIFY_CHANGE_PASSWORD_DB_PATH'] !== dedicatedDatabasePath
) {
  throw new Error('verify:change-password 只允许通过专用临时 SQLite 包装脚本运行')
}

function pass(m: string) { console.log(`  PASS ${m}`) }
function fail(m: string): never { throw new Error(`FAIL ${m}`) }

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
  reserveWithinLimitCallCount = 0
  releaseReservedLimitCallCount = 0
  private blockedSessionVersion: number | null = null
  private sessionWriteEntered: Promise<void> = Promise.resolve()
  private resolveSessionWriteEntered: (() => void) | null = null
  private releaseSessionWrite: (() => void) | null = null
  private sessionWriteRelease: Promise<void> = Promise.resolve()

  blockNextSessionStateWrite(tokenVersion: number): void {
    this.blockedSessionVersion = tokenVersion
    this.sessionWriteEntered = new Promise((resolveEntered) => {
      this.resolveSessionWriteEntered = resolveEntered
    })
    this.sessionWriteRelease = new Promise((resolveRelease) => {
      this.releaseSessionWrite = resolveRelease
    })
  }

  waitForBlockedSessionStateWrite(): Promise<void> {
    return this.sessionWriteEntered
  }

  releaseBlockedSessionStateWrite(): void {
    this.releaseSessionWrite?.()
  }

  private async waitIfSessionStateWriteIsBlocked(key: string, value: string): Promise<void> {
    if (!key.startsWith('internal:session-state:') || this.blockedSessionVersion === null) return
    const state = JSON.parse(value) as { tokenVersion?: number }
    if (state.tokenVersion !== this.blockedSessionVersion) return
    this.resolveSessionWriteEntered?.()
    await this.sessionWriteRelease
    this.blockedSessionVersion = null
  }

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
    await this.waitIfSessionStateWriteIsBlocked(key, value)
    this.store.set(key, value)
  }

  async setJsonIfVersionNotOlder(
    key: string,
    _ttlSeconds: number,
    value: string,
    tokenVersion: number,
  ): Promise<'stored' | 'stale'> {
    await this.waitIfSessionStateWriteIsBlocked(key, value)
    const current = this.store.get(key)
    if (current) {
      const currentVersion = (JSON.parse(current) as { tokenVersion?: number }).tokenVersion
      if (typeof currentVersion === 'number' && currentVersion > tokenVersion) return 'stale'
    }
    this.store.set(key, value)
    return 'stored'
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
    this.reserveWithinLimitCallCount += 1
    const current = Number(this.store.get(key) ?? '0')
    if (current >= limit) return Promise.resolve(false)
    this.store.set(key, String(current + 1))
    return Promise.resolve(true)
  }

  releaseReservedLimit(key: string): Promise<void> {
    this.releaseReservedLimitCallCount += 1
    const current = Number(this.store.get(key) ?? '0')
    if (current <= 0) return Promise.resolve()
    if (current === 1) this.store.delete(key)
    else this.store.set(key, String(current - 1))
    return Promise.resolve()
  }

  decr(key: string): Promise<number> {
    const next = Number(this.store.get(key) ?? '0') - 1
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

  // 本脚本只能运行在包装器创建的专用临时数据库中；清理失败必须让门禁失败，
  // 外层包装器仍会在子进程结束后删除整库文件。
  const cleanup = async () => {
    await prisma.auditLog.deleteMany()
    await prisma.user.deleteMany({ where: { username: { contains: suffix } } })
    if (orgId) await prisma.organization.delete({ where: { id: orgId } })
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

    const clearedFailureCount = await redis.get(`internal:password-change:fail:${admin.id}`)
    if (clearedFailureCount !== null) {
      fail(`3a. 改密成功后必须清除该账号的失败计数,实际残留 ${clearedFailureCount}`)
    }
    pass('3a. 改密成功后已清除该账号的失败计数')

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

    const burstLimitUser = await prisma.user.create({
      data: {
        username: `changepw_burst_${suffix}`,
        passwordHash: await bcrypt.hash(passwordV1, 10),
        name: '改密并发限流验证账号',
        role: 'admin',
      },
    })
    const burstResults = await Promise.allSettled(
      Array.from({ length: 8 }, (_, index) =>
        auth.changePassword(burstLimitUser.id, `burst-wrong-${index}`, passwordV2),
      ),
    )
    const burstMismatchCount = burstResults.filter(
      (result) => result.status === 'rejected' && errCode(result.reason) === 'AUTH_PASSWORD_MISMATCH',
    ).length
    const burstLimitedCount = burstResults.filter(
      (result) => result.status === 'rejected' && errCode(result.reason) === 'AUTH_CHANGE_PASSWORD_RATE_LIMITED',
    ).length
    if (burstMismatchCount > 5 || burstLimitedCount < 1) {
      fail(`9c. 并发错误尝试应最多放行 5 次密码不匹配并让后续请求返回限流,实际 mismatch=${burstMismatchCount}, limited=${burstLimitedCount}`)
    }
    pass('9c. 并发错误尝试达到阈值后在同一批请求内返回限流')
    const burstCounter = await redis.get(`internal:password-change:fail:${burstLimitUser.id}`)
    if (burstCounter !== '5') {
      fail(`9d. 并发限流必须在 bcrypt 前原子占位且只保留 5 个失败额度,实际计数 ${burstCounter ?? 'null'}`)
    }
    pass('9d. 并发限流在 bcrypt 前原子占位,拒绝请求不会穿透或污染计数')
    if (redis.reserveWithinLimitCallCount === 0) {
      fail('9d-1. 改密限流必须使用单条 Redis 原子“额度检查 + 占位”,不得用 INCR 后补偿 DECR')
    }
    pass('9d-1. 改密限流使用单条 Redis 原子额度预留操作')
    if (redis.releaseReservedLimitCallCount === 0) {
      fail('9d-2. 正确密码请求必须使用不会重建缺失 key 的原子额度释放操作')
    }
    const lateReleaseKey = `internal:password-change:fail:late-release-${suffix}`
    await redis.reserveWithinLimitWithTtl(lateReleaseKey, 300, 5)
    await redis.del(lateReleaseKey)
    await redis.releaseReservedLimit(lateReleaseKey)
    if (await redis.get(lateReleaseKey) !== null) {
      fail('9d-2. 计数清零后的迟到释放不得把缺失 key 重建为负数')
    }
    pass('9d-2. 原子额度释放不会在清零竞态后重建负计数 key')

    const cacheRaceUser = await prisma.user.create({
      data: {
        username: `changepw_cache_race_${suffix}`,
        passwordHash: await bcrypt.hash(passwordV1, 10),
        name: '改密缓存竞态验证账号',
        role: 'admin',
      },
    })
    const cacheRaceLogin = await auth.login(cacheRaceUser.username, passwordV1, 'admin')
    const cacheRaceKey = `internal:session-state:${cacheRaceUser.id}`
    await redis.del(cacheRaceKey)
    redis.blockNextSessionStateWrite(cacheRaceUser.tokenVersion)
    const staleGuardAttempt = guard.canActivate(mockCtx(`Bearer ${cacheRaceLogin.token}`))
    await redis.waitForBlockedSessionStateWrite()
    await auth.changePassword(cacheRaceUser.id, passwordV1, `CacheRace_${suffix}`)
    redis.releaseBlockedSessionStateWrite()
    await expectCode(
      () => staleGuardAttempt,
      'AUTH_TOKEN_INVALID',
      '9e. 改密期间冷缓存旧版本回填被单调版本写入拒绝,旧 JWT 不会复活',
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
    await auth.changePassword(partner.id, passwordV1, passwordV2)
    const partnerLogin = await auth.login(partner.username, passwordV2, 'partner')
    if (!partnerLogin.token) fail('10. partner 账号改密后应可用新密码登录')
    pass('10. partner 账号同样可用登录态自助改密')

    const changePasswordRoles = Reflect.getMetadata(ROLES_KEY, AuthController.prototype.changePassword) as string[] | undefined
    if (JSON.stringify(changePasswordRoles) !== JSON.stringify(['admin', 'partner'])) {
      fail('10a. 改密接口必须只允许 admin/partner 角色,不得允许 kiosk 设备账号')
    }
    pass('10a. 改密接口角色边界仅允许 admin/partner')

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

    const weakPasswordDto = plainToInstance(ChangePasswordDto, {
      currentPassword: passwordV2,
      newPassword: 'onlylowercase',
    })
    const weakPasswordErrors = await validate(weakPasswordDto)
    if (!weakPasswordErrors.some((e) => e.constraints && 'isCommercialStrongPassword' in e.constraints)) {
      fail('12. 只有单一字符类型的新密码应被强密码规则拒绝')
    }
    pass('12. DTO 校验:弱密码被强密码规则拒绝')

    const strongPasswordDto = plainToInstance(ChangePasswordDto, {
      currentPassword: passwordV2,
      newPassword: 'QingxuFlow_2026',
    })
    const strongPasswordErrors = await validate(strongPasswordDto)
    if (strongPasswordErrors.some((e) => e.constraints && 'isCommercialStrongPassword' in e.constraints)) {
      fail('12a. 满足 12 位和 3 类字符的密码不应被强密码规则拒绝')
    }
    pass('12a. DTO 校验:商用强密码通过')

    const shortUnicodePasswordDto = plainToInstance(ChangePasswordDto, {
      currentPassword: passwordV2,
      newPassword: '😀😀😀😀😀A1a',
    })
    const shortUnicodePasswordErrors = await validate(shortUnicodePasswordDto)
    if (shortUnicodePasswordErrors.length === 0) {
      fail('12a-1. Unicode 代理对必须按字符数计算,不足 12 位不能按 UTF-16 code unit 放行')
    }
    pass('12a-1. DTO 校验:Unicode 密码长度与前端统一按字符数计算')

    const weakResetPasswordDto = plainToInstance(PasswordResetCompleteDto, {
      resetTicket: randomUUID(),
      newPassword: 'weakpass',
    })
    const weakResetPasswordErrors = await validate(weakResetPasswordDto)
    if (!weakResetPasswordErrors.some((e) => e.constraints && 'isCommercialStrongPassword' in e.constraints)) {
      fail('12b. 找回密码完成接口不得绕过商用强密码规则')
    }
    pass('12b. 找回密码完成接口与登录态改密使用同一商用强密码规则')

    if (auditRow.payloadJson !== '{}') {
      fail('13. 改密审计 payload 必须为空对象,不得记录密码或派生信息')
    }
    pass('13. 改密审计不包含密码或派生信息')

    const localAuditTypes = readFileSync(resolve(__dirname, '../src/audit/audit.types.ts'), 'utf8')
    const sharedAuditTypes = readFileSync(resolve(__dirname, '../../../packages/shared/src/types/audit.ts'), 'utf8')
    for (const source of [localAuditTypes, sharedAuditTypes]) {
      if (!source.includes("| 'auth.password_change_self'") || !source.includes("| 'auth'")) {
        fail('14. auth.password_change_self 与 auth targetType 必须同步进入审计类型 SSOT')
      }
    }
    pass('14. 改密审计动作与 auth targetType 已同步两份类型契约')
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
