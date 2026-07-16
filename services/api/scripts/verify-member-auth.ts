/**
 * L2-2 member-auth — 后端 E2E 验证脚本
 *
 * 用途：在真实 Redis + dev.db 环境下，端到端验证 C 端求职者手机号验证码登录后端骨干。
 *
 * 前置条件：
 *   - services/api/.env 已配置 DATABASE_URL / JWT_SECRET(>=16) / SECRET_ENCRYPTION_KEY(>=32) / REDIS_URL
 *   - Redis 已启动（redis-cli ping → PONG）
 *   - EndUser 表已在 dev.db 中（迁移已应用 / 或 db execute 已建表）
 *
 * 运行方式（从 services/api/ 目录）：
 *   pnpm verify:member-auth
 *
 * 验证链路（真实 HTTP，端口 0 临时监听，请求经全局 ValidationPipe + HttpExceptionFilter）：
 *   0. Redis 会话索引原子注册 / 整户撤销 / 单会话注销
 *   1. 发送验证码 → 200，且响应体不含明文验证码
 *   2. 非法手机号 → 400 VALIDATION_FAILED
 *   3. 额外字段(candidate/email 等越界) → 400（forbidNonWhitelisted）
 *   4. 同号 60s 冷却 → 429 SMS_TOO_FREQUENT
 *   5. 从 Redis 取出验证码 → 错误验证码登录 → 401 SMS_CODE_INVALID
 *   6. 正确验证码登录 → 200，返回 token + phoneMasked（脱敏，绝不回明文）
 *   7. GET /me 带 token → 200 phoneMasked
 *   8. EndUser 落库不含明文手机号（phoneHash 命中 + phoneEnc 可解密 ≠ 明文列）
 *   9. logout 删除 Redis 会话 → 同一 token 再访问 /me → 401（JWT 未过期也失效）
 *  10. 登录入口对 enabled/status 非 active 组合统一 fail-closed
 *  11. 最终签发重查状态，覆盖 QR confirm→closing→claim 竞态
 *  12. 普通 / optional guard / optional resolver 状态矩阵与 session 撤销
 *  13. 注销回执 guard 仅验 JWT，拒绝过期/无效/非 Header token
 *  14. 双向隔离：内部 token 被 EndUserAuthGuard 拒；enduser token 被内部 JwtAuthGuard 拒
 */
import 'dotenv/config'
import { createHash, randomBytes } from 'node:crypto'
import { ExecutionContext } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { JwtService } from '@nestjs/jwt'
import { ValidationPipe, BadRequestException, type ValidationError } from '@nestjs/common'
import type { NestExpressApplication } from '@nestjs/platform-express'
import type { Redis } from 'ioredis'
import { AppModule } from '../src/app.module'
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter'
import { resolveOptionalEndUser, type OptionalEndUser } from '../src/common/auth/optional-end-user'
import { EndUserAuthGuard, memberSessionKey } from '../src/common/guards/end-user-auth.guard'
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard'
import { OptionalEndUserAuthGuard } from '../src/common/guards/optional-end-user-auth.guard'
import { REDIS_CLIENT, RedisService } from '../src/common/redis/redis.service'
import { hashPhone } from '../src/common/crypto/phone-identity'
import { MemberAuthService } from '../src/member-auth/member-auth.service'
import { MemberQrLoginService } from '../src/member-auth/member-qr-login.service'
import { PrismaService } from '../src/prisma/prisma.service'

// ── tiny assert helpers ──────────────────────────────────────────────────────
function pass(msg: string) { console.log(`  ✅ ${msg}`) }
function fail(msg: string) { console.error(`  ❌ ${msg}`); process.exitCode = 1 }
function info(msg: string) { console.log(`  ℹ  ${msg}`) }

async function expectGuardCode(fn: () => Promise<unknown>, code: string, label: string): Promise<void> {
  try {
    await fn()
    fail(`${label}（期望拒绝）`)
  } catch (error) {
    const response = (error as { getResponse?: () => unknown }).getResponse?.()
    const actual = (response as { error?: { code?: string } } | undefined)?.error?.code
    if (actual === code) pass(label)
    else fail(`${label}（期望 ${code}，实际 ${actual ?? 'unknown'}）`)
  }
}

function flatten(errors: ValidationError[], parent = ''): string[] {
  const out: string[] = []
  for (const e of errors) {
    const path = parent ? `${parent}.${e.property}` : e.property
    if (e.constraints) out.push(...Object.values(e.constraints).map((m) => `${path}: ${m}`))
    if (e.children?.length) out.push(...flatten(e.children, path))
  }
  return out
}

// 构造一个最小的 ExecutionContext，只携带 Authorization 头，用于直测 guard。
function mockCtx(authHeader?: string, extras: Record<string, unknown> = {}): ExecutionContext {
  const req = {
    ...extras,
    headers: authHeader ? { authorization: authHeader } : {},
  }
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext
}

interface Json { [k: string]: unknown }

async function main() {
  console.log('\n=== L2-2 member-auth — 后端 E2E 验证 ===')
  console.log(`Redis: ${process.env['REDIS_URL'] ?? '(未设置)'}`)
  console.log(`DB:    ${(process.env['DATABASE_URL'] ?? '').slice(0, 50)}\n`)

  // ── env 硬前置自检 ───────────────────────────────────────────────────────────
  const jwtSecret = process.env['JWT_SECRET'] ?? ''
  if (jwtSecret.length < 16) { fail('JWT_SECRET 缺失或 <16'); process.exit(1) }
  if ((process.env['SECRET_ENCRYPTION_KEY'] ?? '').length < 32) { fail('SECRET_ENCRYPTION_KEY 缺失或 <32'); process.exit(1) }
  if (!process.env['REDIS_URL']) { fail('REDIS_URL 未设置'); process.exit(1) }
  const memberJwt = new JwtService({ secret: jwtSecret, signOptions: { expiresIn: '30m', audience: 'enduser' } })

  // ── 启动真实 HTTP 服务（镜像 main.ts 关键配置）────────────────────────────────
  info('Bootstrapping NestJS HTTP app (logger: error/warn)...')
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ['error', 'warn'] })
  // Test-only trusted loopback proxy: each verifier run gets an isolated IP
  // bucket while production remains responsible for its explicit proxy policy.
  app.set('trust proxy', 'loopback')
  app.setGlobalPrefix('api/v1')
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors) => new BadRequestException({
        error: { code: 'VALIDATION_FAILED', message: flatten(errors)[0] ?? '请求参数校验失败', details: flatten(errors) },
      }),
    }),
  )
  app.useGlobalFilters(new HttpExceptionFilter())
  await app.listen(0)
  const url = await app.getUrl()
  const base = `${url.replace('[::1]', '127.0.0.1')}/api/v1/member`
  info(`HTTP listening: ${base}\n`)

  const redis = app.get(RedisService)
  const rawRedis = app.get<Redis>(REDIS_CLIENT)
  const prisma = app.get(PrismaService)

  // 唯一测试手机号（138 + 8 位时间派生），避免与真实数据/历史 Redis 冲突。
  const tail = Date.now().toString().slice(-8)
  const testNetwork = randomBytes(2)
  const testIp = `198.18.${testNetwork[0]}.${testNetwork[1]}`
  const memberDeviceId = `verify-member-auth-${randomBytes(4).toString('hex')}`
  const testHeaders = { 'x-forwarded-for': testIp }
  const rateLimitHourAtStart = new Date().toISOString().slice(0, 13)
  const PHONE = `138${tail}`
  const phoneHash = hashPhone(PHONE)
  const sessionOwnerId = `verify-member-session-owner-${tail}`
  const otherSessionOwnerId = `verify-member-session-other-${tail}`
  const foreignIndexOwnerId = `verify-member-session-foreign-index-${tail}`
  const conflictOwnerId = `verify-member-session-conflict-owner-${tail}`
  const conflictingOwnerId = `verify-member-session-conflicting-owner-${tail}`
  const firstSessionId = `verify-member-session-a-${tail}`
  const secondSessionId = `verify-member-session-b-${tail}`
  const otherSessionId = `verify-member-session-other-${tail}`
  const conflictSessionId = `verify-member-session-conflict-${tail}`
  const sessionOwnerIndexKey = `member:user-sessions:${sessionOwnerId}`
  const otherSessionOwnerIndexKey = `member:user-sessions:${otherSessionOwnerId}`
  const foreignIndexOwnerIndexKey = `member:user-sessions:${foreignIndexOwnerId}`
  const conflictOwnerIndexKey = `member:user-sessions:${conflictOwnerId}`
  const conflictingOwnerIndexKey = `member:user-sessions:${conflictingOwnerId}`
  const firstSessionKey = `member:session:${firstSessionId}`
  const secondSessionKey = `member:session:${secondSessionId}`
  const otherSessionKey = `member:session:${otherSessionId}`
  const conflictSessionKey = `member:session:${conflictSessionId}`

  async function post(path: string, body: Json, token?: string): Promise<{ status: number; json: Json }> {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...testHeaders,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    })
    const json = (await res.json().catch(() => ({}))) as Json
    return { status: res.status, json }
  }
  async function get(path: string, token?: string): Promise<{ status: number; json: Json }> {
    const res = await fetch(`${base}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
    const json = (await res.json().catch(() => ({}))) as Json
    return { status: res.status, json }
  }

  try {
    // 预清理可能的脏 Redis / DB 残留
    await redis.del(`member:sms:code:${phoneHash}`)
    await redis.del(`member:sms:cooldown:${phoneHash}`)
    await prisma.endUser.deleteMany({ where: { phoneHash } })

    // ── 0. 会话索引注册 / 整户撤销 / 单会话注销 ───────────────────────
    console.log('── 0. Redis 会话索引原子操作 ─────────────────────────')

    await redis.registerMemberSession(conflictOwnerId, conflictSessionId, 120)
    let conflictError: unknown
    try {
      await redis.registerMemberSession(conflictingOwnerId, conflictSessionId, 120)
    } catch (error) {
      conflictError = error
    }
    const [conflictOwner, conflictingOwnerIndexed] = await Promise.all([
      redis.get(conflictSessionKey),
      rawRedis.sismember(conflictingOwnerIndexKey, conflictSessionId),
    ])
    if (conflictError instanceof Error && conflictError.message === 'Member session ownership conflict'
      && conflictOwner === conflictOwnerId && conflictingOwnerIndexed === 0) {
      pass('sessionId 冲突注册 fail-closed，原 owner 与索引保持不变')
    } else fail('sessionId 冲突未拒绝或原 owner 被覆盖')
    await rawRedis.del(conflictSessionKey, conflictOwnerIndexKey, conflictingOwnerIndexKey)

    await redis.registerMemberSession(sessionOwnerId, firstSessionId, 120)
    await redis.registerMemberSession(sessionOwnerId, secondSessionId, 30)
    await redis.registerMemberSession(otherSessionOwnerId, otherSessionId, 120)

    const [firstSession, secondSession, ownerSessions, firstTtl, ownerIndexTtl] = await Promise.all([
      redis.get(firstSessionKey),
      redis.get(secondSessionKey),
      rawRedis.smembers(sessionOwnerIndexKey),
      redis.ttl(firstSessionKey),
      redis.ttl(sessionOwnerIndexKey),
    ])
    if (firstSession === sessionOwnerId && secondSession === sessionOwnerId
      && [...ownerSessions].sort().join(',') === [firstSessionId, secondSessionId].sort().join(',')) {
      pass('同一用户的两个 session 与索引均已注册')
    } else fail('同一用户的 session 或索引注册异常')
    if (firstTtl > 30 && firstTtl <= 120 && ownerIndexTtl > 30 && ownerIndexTtl <= 120) {
      pass('短 TTL session 不会缩短已有长 TTL 的用户索引')
    } else fail(`session/index TTL 异常: ${firstTtl}/${ownerIndexTtl}`)

    await redis.unregisterMemberSession(sessionOwnerId, firstSessionId)
    const [firstAfterUnregister, secondAfterUnregister, ownerAfterUnregister] = await Promise.all([
      redis.get(firstSessionKey),
      redis.get(secondSessionKey),
      rawRedis.smembers(sessionOwnerIndexKey),
    ])
    if (firstAfterUnregister === null && secondAfterUnregister === sessionOwnerId
      && ownerAfterUnregister.length === 1 && ownerAfterUnregister[0] === secondSessionId) {
      pass('多 session 用户注销一条后，其他 session 与非空索引保留')
    } else fail('注销单条 session 误删了同用户的其他 session 或索引')
    await redis.registerMemberSession(sessionOwnerId, firstSessionId, 120)

    await rawRedis.sadd(foreignIndexOwnerIndexKey, firstSessionId)
    const foreignRevokedCount = await redis.revokeMemberSessions(foreignIndexOwnerId)
    const [firstAfterForeignRevoke, foreignIndexAfterRevoke] = await Promise.all([
      redis.get(firstSessionKey),
      rawRedis.exists(foreignIndexOwnerIndexKey),
    ])
    if (foreignRevokedCount === 0 && firstAfterForeignRevoke === sessionOwnerId && foreignIndexAfterRevoke === 0) {
      pass('整户撤销只删除 owner 匹配的 session，错误索引成员仅清理索引')
    } else fail('整户撤销通过错误索引删除了其他用户 session')

    await rawRedis.sadd(foreignIndexOwnerIndexKey, secondSessionId)
    await redis.unregisterMemberSession(foreignIndexOwnerId, secondSessionId)
    const [secondAfterForeignUnregister, foreignIndexAfterUnregister] = await Promise.all([
      redis.get(secondSessionKey),
      rawRedis.exists(foreignIndexOwnerIndexKey),
    ])
    if (secondAfterForeignUnregister === sessionOwnerId && foreignIndexAfterUnregister === 0) {
      pass('单 session 注销 owner 错配时不删他人会话，仅清理调用方错误索引')
    } else fail('单 session 注销 owner 错配时删除了其他用户 session')

    const revokedCount = await redis.revokeMemberSessions(sessionOwnerId)
    const [firstAfterRevoke, secondAfterRevoke, ownerIndexExists, otherAfterRevoke, otherSessions] = await Promise.all([
      redis.get(firstSessionKey),
      redis.get(secondSessionKey),
      rawRedis.exists(sessionOwnerIndexKey),
      redis.get(otherSessionKey),
      rawRedis.smembers(otherSessionOwnerIndexKey),
    ])
    if (revokedCount === 2 && firstAfterRevoke === null && secondAfterRevoke === null && ownerIndexExists === 0) {
      pass('整户撤销删除该用户的两个 session 及用户索引')
    } else fail(`整户撤销异常: count=${revokedCount}, indexExists=${ownerIndexExists}`)
    if (otherAfterRevoke === otherSessionOwnerId && otherSessions.length === 1 && otherSessions[0] === otherSessionId) {
      pass('整户撤销不会删除其他用户的 session 或索引')
    } else fail('整户撤销破坏了其他用户的 session 或索引')

    await redis.unregisterMemberSession(otherSessionOwnerId, otherSessionId)
    if (await rawRedis.exists(otherSessionKey, otherSessionOwnerIndexKey) === 0) {
      pass('单 session 注销后删除会话，空索引集合同步清理')
    } else fail('单 session 注销未完整清理会话与空索引')

    // ── 1. 发送验证码 ──────────────────────────────────────────────────────────
    console.log('── 1. 发送验证码 ──────────────────────────────────────────────')
    const send = await post('/auth/sms-code', { phone: PHONE, deviceId: memberDeviceId })
    if (send.status === 201) pass('POST /auth/sms-code → 201（Nest @Post 默认）')
    else fail(`POST /auth/sms-code → ${send.status} (expected 201) ${JSON.stringify(send.json)}`)
    if (!JSON.stringify(send.json).includes('"code"') || !/\d{6}/.test(JSON.stringify(send.json.data ?? {})))
      pass('响应体不含明文 6 位验证码')
    else fail(`响应体疑似泄露验证码: ${JSON.stringify(send.json)}`)

    // ── 2. 非法手机号 → 400 ────────────────────────────────────────────────────
    console.log('\n── 2. 非法手机号 → 400 ────────────────────────────────────────')
    const bad = await post('/auth/sms-code', { phone: '1234' })
    if (bad.status === 400) pass('非法手机号 → 400')
    else fail(`非法手机号 → ${bad.status} (expected 400)`)

    // ── 3. 越界字段 → 400（forbidNonWhitelisted）──────────────────────────────
    console.log('\n── 3. 越界字段 → 400 ──────────────────────────────────────────')
    const inject = await post('/auth/sms-code', { phone: `139${tail}`, candidate: 'leak', email: 'x@x.com' })
    if (inject.status === 400) pass('携带 candidate/email 越界字段 → 400')
    else fail(`越界字段 → ${inject.status} (expected 400)`)

    // ── 4. 同号冷却 → 429 ──────────────────────────────────────────────────────
    console.log('\n── 4. 同号 60s 冷却 → 429 ─────────────────────────────────────')
    const cooldown = await post('/auth/sms-code', { phone: PHONE })
    if (cooldown.status === 429) pass('同号 60s 内重复 → 429 SMS_TOO_FREQUENT')
    else fail(`同号重复 → ${cooldown.status} (expected 429)`)

    // ── 5. 取验证码 + 错误码登录 → 401 ────────────────────────────────────────
    console.log('\n── 5. 错误验证码 → 401 ────────────────────────────────────────')
    const code = await redis.get(`member:sms:code:${phoneHash}`)
    if (code && /^\d{6}$/.test(code)) info(`从 Redis 取得验证码（脱敏校验内部用）: ${code.slice(0, 2)}****`)
    else fail('未能从 Redis 取得验证码')
    const wrong = await post('/auth/login', { phone: PHONE, code: code === '000000' ? '111111' : '000000' })
    if (wrong.status === 401) pass('错误验证码 → 401')
    else fail(`错误验证码 → ${wrong.status} (expected 401)`)

    // ── 6. 正确验证码登录 → 200 ───────────────────────────────────────────────
    console.log('\n── 6. 正确验证码登录 → 200 ────────────────────────────────────')
    const login = await post('/auth/login', { phone: PHONE, code: code! })
    const loginData = (login.json.data ?? {}) as Json
    const token = loginData.token as string | undefined
    const user = (loginData.user ?? {}) as Json
    if (login.status === 201 && token) pass('正确验证码 → 201 + token')
    else fail(`登录 → ${login.status} (expected 201) ${JSON.stringify(login.json)}`)
    if (user.phoneMasked === `138****${tail.slice(-4)}`) pass(`返回 phoneMasked=${user.phoneMasked}（脱敏）`)
    else fail(`phoneMasked 异常: ${JSON.stringify(user)}`)
    if (!JSON.stringify(login.json).includes(PHONE)) pass('登录响应不含明文手机号')
    else fail('登录响应泄露明文手机号')
    let loginSessionId: string | undefined
    if (token && typeof user.id === 'string') {
      const payload = memberJwt.verify<{ sub: string; jti?: string }>(token, { audience: 'enduser' })
      loginSessionId = payload.jti
      const [sessionOwner, indexed] = loginSessionId
        ? await Promise.all([
            redis.get(memberSessionKey(loginSessionId)),
            rawRedis.sismember(`member:user-sessions:${user.id}`, loginSessionId),
          ])
        : [null, 0]
      if (loginSessionId && payload.sub === user.id && sessionOwner === user.id && indexed === 1) {
        pass('登录 token 的 jti 已原子注册为本人 session 与用户索引')
      } else fail('登录 token 缺少 jti，或 session owner / 用户索引未完整注册')
    }

    // ── 7. GET /me ────────────────────────────────────────────────────────────
    console.log('\n── 7. GET /me 带 token → 200 ──────────────────────────────────')
    const me = await get('/me', token)
    if (me.status === 200 && (me.json.data as Json)?.phoneMasked === `138****${tail.slice(-4)}`) pass('/me → 200 phoneMasked')
    else fail(`/me → ${me.status} ${JSON.stringify(me.json)}`)
    if (!JSON.stringify(me.json).includes(PHONE)) pass('/me 响应不含明文手机号')
    else fail('/me 响应泄露明文手机号')

    // ── 8. 落库不含明文 ───────────────────────────────────────────────────────
    console.log('\n── 8. EndUser 落库隐私校验 ────────────────────────────────────')
    const row = await prisma.endUser.findUnique({ where: { phoneHash } })
    if (row) pass('EndUser 已创建（by phoneHash）')
    else fail('EndUser 未创建')
    if (row?.enabled === true && row.status === 'active') pass('新用户显式保持 enabled=true,status=active')
    else fail(`新用户账户状态异常: ${row?.enabled}/${row?.status}`)
    if (row && row.phoneEnc && row.phoneEnc !== PHONE && !row.phoneEnc.includes(PHONE)) pass('phoneEnc 为密文，不含明文手机号')
    else fail('phoneEnc 异常（疑似明文）')

    // ── 9. logout 使会话立即失效 ──────────────────────────────────────────────
    console.log('\n── 9. logout → 会话立即失效 ───────────────────────────────────')
    const logout = await post('/auth/logout', {}, token)
    if (logout.status === 201) pass('logout → 201')
    else fail(`logout → ${logout.status}`)
    const meAfter = await get('/me', token)
    if (meAfter.status === 401) pass('logout 后同一 token /me → 401（JWT 未过期也失效）')
    else fail(`logout 后 /me → ${meAfter.status} (expected 401)`)
    if (loginSessionId && typeof user.id === 'string') {
      const [sessionOwner, indexed] = await Promise.all([
        redis.get(memberSessionKey(loginSessionId)),
        rawRedis.sismember(`member:user-sessions:${user.id}`, loginSessionId),
      ])
      if (sessionOwner === null && indexed === 0) pass('logout 按 endUserId+jti 删除 session 与用户索引成员')
      else fail('logout 未完整删除当前 jti 的 session 或用户索引成员')
    }

    const endUserId = user.id as string

    // ── 10. 登录入口双轨账户状态矩阵 ────────────────────────────────────────
    console.log('\n── 10. 登录入口 enabled/status 双轨矩阵 ───────────────────────')
    const unavailableLoginStates = [
      { enabled: false, status: 'active' },
      { enabled: true, status: 'disabled' },
      { enabled: false, status: 'closing' },
      { enabled: false, status: 'anonymized' },
    ] as const
    for (const state of unavailableLoginStates) {
      await prisma.endUser.update({ where: { id: endUserId }, data: state })
      const matrixCode = `${unavailableLoginStates.indexOf(state) + 1}`.padStart(6, '4')
      await redis.setEx(`member:sms:code:${phoneHash}`, 300, matrixCode)
      await redis.del(`member:sms:attempt:${phoneHash}`)
      const result = await post('/auth/login', { phone: PHONE, code: matrixCode })
      const error = result.json.error as Json | undefined
      if (
        result.status === 403 &&
        error?.code === 'ACCOUNT_UNAVAILABLE' &&
        error.message === '账号当前不可登录，请联系工作人员'
      ) {
        pass(`旧用户 ${state.enabled}/${state.status} → 统一 ACCOUNT_UNAVAILABLE`)
      } else {
        fail(`旧用户 ${state.enabled}/${state.status} 未统一拒绝: ${result.status} ${JSON.stringify(result.json)}`)
        const unexpectedToken = ((result.json.data as Json | undefined)?.token) as string | undefined
        if (unexpectedToken) {
          const unexpectedJti = memberJwt.verify<{ jti?: string }>(unexpectedToken, { audience: 'enduser' }).jti
          if (unexpectedJti) await redis.unregisterMemberSession(endUserId, unexpectedJti)
        }
      }
    }
    await prisma.endUser.update({ where: { id: endUserId }, data: { enabled: true, status: 'active' } })

    // ── 11. issueLoginForUser 最终签发门禁 / QR claim 竞态 ─────────────────
    console.log('\n── 11. 最终签发门禁与 QR claim 竞态 ──────────────────────────')
    const memberAuth = app.get(MemberAuthService)
    const issueUser = { id: `issue-user-${tail}`, phoneMasked: '138****0000', nickname: null }
    const activeState = { enabled: true, status: 'active' }
    const closingState = { enabled: false, status: 'closing' }
    function issueLoginHarness(states: Array<typeof activeState | Error>, signError?: Error, cleanupError?: Error) {
      const trace: {
        reads: number
        registered?: { endUserId: string; sessionId: string }
        unregistered?: { endUserId: string; sessionId: string }
        unregisterCalls: number
        signed?: { payload: { sub: string }; options: { jwtid: string } }
      } = { reads: 0, unregisterCalls: 0 }
      const harnessPrisma = {
        endUser: {
          findUnique: async () => {
            const state = states[trace.reads]
            trace.reads += 1
            if (state instanceof Error) throw state
            return state ?? null
          },
        },
      } as never
      const harnessRedis = {
        registerMemberSession: async (endUserId: string, sessionId: string) => {
          trace.registered = { endUserId, sessionId }
        },
        unregisterMemberSession: async (endUserId: string, sessionId: string) => {
          trace.unregisterCalls += 1
          trace.unregistered = { endUserId, sessionId }
          if (cleanupError) throw cleanupError
        },
      } as never
      const harnessJwt = {
        sign: (payload: { sub: string }, options: { jwtid: string }) => {
          trace.signed = { payload, options }
          if (signError) throw signError
          return 'verify-issue-token'
        },
      } as never
      return { service: new MemberAuthService(harnessPrisma, harnessRedis, harnessJwt, {} as never), trace }
    }

    const raceHarness = issueLoginHarness([activeState, closingState])
    let raceError: unknown
    try { await raceHarness.service.issueLoginForUser(issueUser) } catch (error) { raceError = error }
    const raceResponse = (raceError as { getResponse?: () => unknown } | undefined)?.getResponse?.() as Json | undefined
    if ((raceResponse?.error as Json | undefined)?.code === 'ACCOUNT_UNAVAILABLE') pass('注册后状态变 closing → ACCOUNT_UNAVAILABLE')
    else fail('注册后状态变 closing 未统一拒绝')
    if (
      raceHarness.trace.reads === 2 &&
      raceHarness.trace.registered?.sessionId === raceHarness.trace.unregistered?.sessionId &&
      raceHarness.trace.unregisterCalls === 1 &&
      raceHarness.trace.signed === undefined
    ) pass('TOCTOU 竞态只清理一次同一 session，且绝不 sign')
    else fail(`TOCTOU 清理链异常: ${JSON.stringify(raceHarness.trace)}`)

    const activeHarness = issueLoginHarness([activeState, activeState])
    const activeIssue = await activeHarness.service.issueLoginForUser(issueUser)
    if (
      activeHarness.trace.reads === 2 &&
      activeHarness.trace.registered?.sessionId === activeHarness.trace.signed?.options.jwtid &&
      activeHarness.trace.signed?.payload.sub === issueUser.id &&
      activeHarness.trace.unregisterCalls === 0 &&
      activeIssue.token === 'verify-issue-token'
    ) pass('两次 active → 保留同一 jti 链并正常签发')
    else fail(`正常双重状态检查异常: ${JSON.stringify(activeHarness.trace)}`)

    const readFailure = new Error('verify second read failure')
    const readFailureHarness = issueLoginHarness([activeState, readFailure])
    let caughtReadFailure: unknown
    try { await readFailureHarness.service.issueLoginForUser(issueUser) } catch (error) { caughtReadFailure = error }
    if (caughtReadFailure === readFailure && readFailureHarness.trace.unregisterCalls === 1 && !readFailureHarness.trace.signed) {
      pass('第二次 DB 读取异常 → 清理 session 并重抛原错')
    } else fail('第二次 DB 读取异常未清理或吞掉原错')

    const signFailure = new Error('verify sign failure')
    const signFailureHarness = issueLoginHarness([activeState, activeState], signFailure)
    let caughtSignFailure: unknown
    try { await signFailureHarness.service.issueLoginForUser(issueUser) } catch (error) { caughtSignFailure = error }
    if (caughtSignFailure === signFailure && signFailureHarness.trace.unregisterCalls === 1) {
      pass('JWT sign 异常 → 清理 session 并重抛原错')
    } else fail('JWT sign 异常未清理或吞掉原错')

    const cleanupFailureHarness = issueLoginHarness([activeState, closingState], undefined, new Error('verify cleanup failure'))
    let cleanupRaceError: unknown
    try { await cleanupFailureHarness.service.issueLoginForUser(issueUser) } catch (error) { cleanupRaceError = error }
    const cleanupRaceResponse = (cleanupRaceError as { getResponse?: () => unknown } | undefined)?.getResponse?.() as Json | undefined
    if ((cleanupRaceResponse?.error as Json | undefined)?.code === 'ACCOUNT_UNAVAILABLE' && cleanupFailureHarness.trace.unregisterCalls === 1) {
      pass('清理失败仍 fail-closed，并保留原 ACCOUNT_UNAVAILABLE')
    } else fail('清理失败吞掉原始安全错误或重复清理')

    const missingUserId = `missing-member-${tail}`
    let unexpectedMissingLogin: { token: string } | undefined
    try {
      unexpectedMissingLogin = await memberAuth.issueLoginForUser({
        id: missingUserId,
        phoneMasked: '138****0000',
        nickname: null,
      })
      fail('issueLoginForUser 对 missing user 仍签发 session')
    } catch (error) {
      const response = (error as { getResponse?: () => unknown }).getResponse?.() as Json | undefined
      if ((response?.error as Json | undefined)?.code === 'ACCOUNT_UNAVAILABLE') pass('issueLoginForUser missing user → ACCOUNT_UNAVAILABLE')
      else fail(`issueLoginForUser missing user 错误码异常: ${JSON.stringify(response)}`)
    }
    if (unexpectedMissingLogin) {
      const unexpectedJti = memberJwt.verify<{ jti?: string }>(unexpectedMissingLogin.token, { audience: 'enduser' }).jti
      if (unexpectedJti) await redis.del(memberSessionKey(unexpectedJti))
    }

    await prisma.endUser.update({ where: { id: endUserId }, data: { enabled: false, status: 'closing' } })
    const claimToken = `claim-${tail}`
    const ticketId = `verifyqr${tail}`.padEnd(32, 'q')
    const terminalId = `verify-terminal-${tail}`
    const confirmedTicket = JSON.stringify({
      status: 'confirmed',
      claimTokenHash: createHash('sha256').update(claimToken).digest('hex'),
      terminalId,
      returnTo: '/',
      createdAt: new Date().toISOString(),
      user: { id: endUserId, phoneMasked: user.phoneMasked, nickname: user.nickname ?? null },
    })
    const qrRedis = {
      get: async (key: string) => key.includes(':claimed:') ? null : confirmedTicket,
      getDelAndSetEx: async () => confirmedTicket,
    } as never
    const terminals = { validateTerminalToken: async () => undefined } as never
    const qrLogin = new MemberQrLoginService(qrRedis, memberAuth, terminals)
    const sessionsBeforeClaim = await rawRedis.smembers(`member:user-sessions:${endUserId}`)
    let unexpectedClaimToken: string | undefined
    try {
      unexpectedClaimToken = (await qrLogin.claim(ticketId, claimToken, terminalId, 'Bearer verify-terminal-token')).token
      fail('QR confirmed 后账户 closing 仍可 claim')
    } catch (error) {
      const response = (error as { getResponse?: () => unknown }).getResponse?.() as Json | undefined
      if ((response?.error as Json | undefined)?.code === 'ACCOUNT_UNAVAILABLE') pass('QR confirmed→closing→claim 统一拒绝')
      else fail(`QR claim race 错误码异常: ${JSON.stringify(response)}`)
    }
    if (unexpectedClaimToken) {
      const unexpectedJti = memberJwt.verify<{ jti?: string }>(unexpectedClaimToken, { audience: 'enduser' }).jti
      if (unexpectedJti) await redis.del(memberSessionKey(unexpectedJti))
    }
    const sessionsAfterClaim = await rawRedis.smembers(`member:user-sessions:${endUserId}`)
    if ([...sessionsAfterClaim].sort().join(',') === [...sessionsBeforeClaim].sort().join(',')) {
      pass('QR claim race 未新增用户 session 索引')
    } else fail('QR claim race 写入了新 session')

    // ── 12. 普通 / optional / resolver 状态矩阵 ─────────────────────────────
    console.log('\n── 12. 普通与可选会员解析状态矩阵 ─────────────────────────────')
    const accountStates: Array<{
      label: string
      user: { enabled: boolean; status: string } | null
      allow: boolean
      expectedCode?: string
    }> = [
      { label: 'enabled=true,status=active', user: { enabled: true, status: 'active' }, allow: true },
      { label: 'enabled=false,status=active', user: { enabled: false, status: 'active' }, allow: false, expectedCode: 'ACCOUNT_UNAVAILABLE' },
      { label: 'enabled=true,status=disabled', user: { enabled: true, status: 'disabled' }, allow: false, expectedCode: 'ACCOUNT_UNAVAILABLE' },
      { label: 'enabled=false,status=closing', user: { enabled: false, status: 'closing' }, allow: false, expectedCode: 'ACCOUNT_UNAVAILABLE' },
      { label: 'enabled=false,status=anonymized', user: { enabled: false, status: 'anonymized' }, allow: false, expectedCode: 'ACCOUNT_UNAVAILABLE' },
      { label: 'missing user', user: null, allow: false, expectedCode: 'MEMBER_SESSION_EXPIRED' },
    ]
    for (const state of accountStates) {
      const sessionId = `matrix-${accountStates.indexOf(state)}`
      const jwt = { verify: () => ({ sub: endUserId, jti: sessionId }) } as never
      let ordinaryUnregistered = false
      const ordinaryRedis = {
        get: async () => endUserId,
        unregisterMemberSession: async (ownerId: string, currentSessionId: string) => {
          ordinaryUnregistered = ownerId === endUserId && currentSessionId === sessionId
        },
      } as never
      const statePrisma = { endUser: { findUnique: async () => state.user } } as never
      const guard = new EndUserAuthGuard(jwt, ordinaryRedis, statePrisma)
      const guardCtx = mockCtx('Bearer matrix-token')
      if (state.allow) {
        const allowed = await guard.canActivate(guardCtx)
        const request = guardCtx.switchToHttp().getRequest() as { endUser?: { endUserId: string; sessionId: string } }
        if (allowed && request.endUser?.endUserId === endUserId && request.endUser.sessionId === sessionId) {
          pass(`普通 guard ${state.label} → allow + jti`)
        } else fail(`普通 guard ${state.label} 未注入完整 endUser`)
      } else {
        await expectGuardCode(
          () => guard.canActivate(guardCtx),
          state.expectedCode!,
          `普通 guard ${state.label} → ${state.expectedCode}`,
        )
        if (ordinaryUnregistered) pass(`普通 guard ${state.label} 撤销当前 session`)
        else fail(`普通 guard ${state.label} 未撤销当前 session`)
      }

      let optionalUnregistered = false
      const optionalRedis = {
        get: async () => endUserId,
        unregisterMemberSession: async (ownerId: string, currentSessionId: string) => {
          optionalUnregistered = ownerId === endUserId && currentSessionId === sessionId
        },
      } as never
      const optionalGuard = new OptionalEndUserAuthGuard(jwt, optionalRedis, statePrisma)
      const optionalCtx = mockCtx('Bearer optional-matrix-token')
      const optionalAllowed = await optionalGuard.canActivate(optionalCtx)
      const optionalRequest = optionalCtx.switchToHttp().getRequest() as { endUser?: { endUserId: string; sessionId: string } }
      if (state.allow) {
        if (optionalAllowed && optionalRequest.endUser?.sessionId === sessionId) pass(`optional guard ${state.label} → attach`)
        else fail(`optional guard ${state.label} 未注入本人态`)
      } else {
        if (optionalAllowed && optionalRequest.endUser === undefined) pass(`optional guard ${state.label} → anonymous`)
        else fail(`optional guard ${state.label} 未匿名放行`)
        if (optionalUnregistered) pass(`optional guard ${state.label} 撤销当前 session`)
        else fail(`optional guard ${state.label} 未撤销当前 session`)
      }

      let resolverUnregistered = false
      const resolverRedis = {
        get: async () => endUserId,
        unregisterMemberSession: async (ownerId: string, currentSessionId: string) => {
          resolverUnregistered = ownerId === endUserId && currentSessionId === sessionId
        },
      } as never
      const resolveWithPrisma = resolveOptionalEndUser as unknown as (
        authorization: string | undefined,
        jwtService: JwtService,
        redisService: RedisService,
        prismaService: PrismaService,
      ) => Promise<OptionalEndUser | null>
      const resolved = await resolveWithPrisma('Bearer resolver-token', jwt, resolverRedis, statePrisma)
      if (state.allow) {
        if (resolved?.endUserId === endUserId && resolved.sessionId === sessionId) pass(`optional resolver ${state.label} → attach`)
        else fail(`optional resolver ${state.label} 未返回本人态`)
      } else {
        if (resolved === null) pass(`optional resolver ${state.label} → anonymous`)
        else fail(`optional resolver ${state.label} 未匿名返回`)
        if (resolverUnregistered) pass(`optional resolver ${state.label} 撤销当前 session`)
        else fail(`optional resolver ${state.label} 未撤销当前 session`)
      }
    }

    const outageSessionId = 'resolver-database-outage'
    let outageUnregistered = false
    const outageResult = await resolveOptionalEndUser(
      'Bearer resolver-outage-token',
      { verify: () => ({ sub: endUserId, jti: outageSessionId }) } as never,
      {
        get: async () => endUserId,
        unregisterMemberSession: async () => { outageUnregistered = true },
      } as never,
      { endUser: { findUnique: async () => { throw new Error('simulated database outage') } } } as never,
    )
    if (outageResult === null && !outageUnregistered) {
      pass('optional resolver 数据库故障 → anonymous，且不误撤销有效 session')
    } else fail('optional resolver 数据库故障未安全降级为匿名')

    // ── 13. 注销回执 guard 仅做严格 JWT 验签 ────────────────────────────────
    console.log('\n── 13. 注销回执 guard 的窄授权边界 ───────────────────────────')
    type ClosureGuard = { canActivate(context: ExecutionContext): Promise<boolean> }
    type ClosureGuardConstructor = new (jwtService: JwtService) => ClosureGuard
    let ClosureGuardClass: ClosureGuardConstructor | undefined
    try {
      const modulePath = '../src/common/guards/' + 'member-closure-receipt.guard'
      ClosureGuardClass = (require(modulePath) as { MemberClosureReceiptGuard?: ClosureGuardConstructor }).MemberClosureReceiptGuard
    } catch {
      // Missing module is reported as the expected RED behavior below.
    }
    if (!ClosureGuardClass) {
      fail('MemberClosureReceiptGuard 尚未实现')
    } else {
      const closureGuard = new ClosureGuardClass(memberJwt)
      const closureSessionId = `closure-${tail}`
      const closureToken = memberJwt.sign({ sub: endUserId }, { jwtid: closureSessionId })
      for (const status of ['closing', 'anonymized'] as const) {
        await prisma.endUser.update({ where: { id: endUserId }, data: { enabled: false, status } })
        const closureCtx = mockCtx(`Bearer ${closureToken}`)
        const allowed = await closureGuard.canActivate(closureCtx)
        const closureReq = closureCtx.switchToHttp().getRequest() as {
          closureReceiptSubject?: { endUserId: string }
          endUser?: unknown
        }
        if (allowed && closureReq.closureReceiptSubject?.endUserId === endUserId && closureReq.endUser === undefined) {
          pass(`${status} + 原未过期 JWT → closure guard 仅暴露 sub`)
        } else fail(`${status} + 原未过期 JWT 的 closure guard 授权结果越界`)

        await redis.registerMemberSession(endUserId, closureSessionId, 120)
        const ordinaryGuard = new EndUserAuthGuard(memberJwt, redis, prisma)
        await expectGuardCode(
          () => ordinaryGuard.canActivate(mockCtx(`Bearer ${closureToken}`)),
          'ACCOUNT_UNAVAILABLE',
          `${status} + 原未过期 JWT 仍被普通 guard 拒绝`,
        )
        const [ordinarySession, ordinaryIndexed] = await Promise.all([
          redis.get(memberSessionKey(closureSessionId)),
          rawRedis.sismember(`member:user-sessions:${endUserId}`, closureSessionId),
        ])
        if (ordinarySession === null && ordinaryIndexed === 0) pass(`${status} 普通 guard 同步撤销原 session`)
        else fail(`${status} 普通 guard 未完整撤销原 session`)
      }

      const expiredToken = memberJwt.sign({ sub: endUserId }, { jwtid: 'closure-expired', expiresIn: -1 })
      const invalidSignatureToken = new JwtService({ secret: `${jwtSecret}-different` }).sign(
        { sub: endUserId },
        { jwtid: 'closure-invalid', expiresIn: '30m', audience: 'enduser' },
      )
      const wrongAlgorithmToken = new JwtService({ secret: jwtSecret }).sign(
        { sub: endUserId },
        { jwtid: 'closure-hs384', expiresIn: '30m', audience: 'enduser', algorithm: 'HS384' },
      )
      const wrongAudienceToken = new JwtService({ secret: jwtSecret }).sign(
        { sub: endUserId },
        { jwtid: 'closure-wrong-aud', expiresIn: '30m', audience: 'internal' },
      )
      const missingJtiToken = memberJwt.sign({ sub: endUserId })
      const missingSubToken = memberJwt.sign({}, { jwtid: 'closure-missing-sub' })
      const missingExpToken = new JwtService({ secret: jwtSecret }).sign(
        { sub: endUserId },
        { jwtid: 'closure-missing-exp', audience: 'enduser', algorithm: 'HS256' },
      )
      for (const invalid of [
        { label: 'expired', token: expiredToken },
        { label: 'invalid signature', token: invalidSignatureToken },
        { label: 'wrong algorithm', token: wrongAlgorithmToken },
        { label: 'wrong audience', token: wrongAudienceToken },
        { label: 'missing jti', token: missingJtiToken },
        { label: 'missing sub', token: missingSubToken },
        { label: 'missing exp', token: missingExpToken },
      ]) {
        await expectGuardCode(
          () => closureGuard.canActivate(mockCtx(`Bearer ${invalid.token}`)),
          'MEMBER_TOKEN_INVALID',
          `closure guard 拒绝 ${invalid.label} token`,
        )
      }
      await expectGuardCode(
        () => closureGuard.canActivate(mockCtx(undefined, { query: { token: closureToken }, body: { token: closureToken } })),
        'MEMBER_MISSING_TOKEN',
        'closure guard 不接受 query/body token',
      )
    }
    await prisma.endUser.update({ where: { id: endUserId }, data: { enabled: true, status: 'active' } })

    // ── 14. 双向隔离 ──────────────────────────────────────────────────────────
    console.log('\n── 14. 双向 token 隔离 ────────────────────────────────────────')
    const internalJwt = new JwtService({ secret: jwtSecret })
    const endUserGuard = new EndUserAuthGuard(memberJwt, redis, prisma)
    const internalGuard = new JwtAuthGuard(internalJwt, prisma, redis)

    // 10a: 内部 token（无 aud）→ EndUserAuthGuard 必须拒
    const internalToken = internalJwt.sign({ sub: 'op-1', role: 'admin', orgId: null })
    let rejectedA = false
    try { await endUserGuard.canActivate(mockCtx(`Bearer ${internalToken}`)) } catch { rejectedA = true }
    if (rejectedA) pass('EndUserAuthGuard 拒绝内部 token')
    else fail('EndUserAuthGuard 未拒绝内部 token')

    // 10b: enduser token（aud=enduser）→ 内部 JwtAuthGuard 必须拒
    const memberToken = memberJwt.sign({ sub: 'eu-1' }, { jwtid: 'sess-x' })
    let rejectedB = false
    try { await internalGuard.canActivate(mockCtx(`Bearer ${memberToken}`)) } catch { rejectedB = true }
    if (rejectedB) pass('内部 JwtAuthGuard 拒绝 enduser token')
    else fail('内部 JwtAuthGuard 未拒绝 enduser token')

  } finally {
    // ── 11. 清理 ──────────────────────────────────────────────────────────────
    console.log('\n── 清理测试数据 ──────────────────────────────────────────────')
    await prisma.endUser.deleteMany({ where: { phoneHash } })
    await redis.del(`member:sms:code:${phoneHash}`)
    await redis.del(`member:sms:cooldown:${phoneHash}`)
    await redis.del(`member:sms:attempt:${phoneHash}`)
    for (const rateLimitHour of new Set([rateLimitHourAtStart, new Date().toISOString().slice(0, 13)])) {
      await redis.del(`member:sms:ip:${testIp}:${rateLimitHour}`)
      await redis.del(`member:sms:device:${memberDeviceId}:${rateLimitHour}`)
    }
    await rawRedis.del(
      firstSessionKey,
      secondSessionKey,
      otherSessionKey,
      conflictSessionKey,
      sessionOwnerIndexKey,
      otherSessionOwnerIndexKey,
      foreignIndexOwnerIndexKey,
      conflictOwnerIndexKey,
      conflictingOwnerIndexKey,
    )
    info('测试数据已清理。')
    await app.close()
  }

  const exitCode = process.exitCode ?? 0
  console.log(`\n${'─'.repeat(60)}`)
  console.log(exitCode === 0 ? '✅ ALL PASS' : '❌ SOME CHECKS FAILED')
  console.log('─'.repeat(60))
  if (exitCode !== 0) process.exit(exitCode)
}

main().catch((e: unknown) => {
  console.error('\nFatal error:', (e as Error).message)
  console.error((e as Error).stack)
  process.exit(1)
})
