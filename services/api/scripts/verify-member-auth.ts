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
 *  10. 账号禁用后既有 Redis session 立即 fail-closed
 *  11. 双向隔离：内部 token 被 EndUserAuthGuard 拒；enduser token 被内部 JwtAuthGuard 拒
 *  12. 清理测试数据 → 报告 PASS / FAIL
 */
import 'dotenv/config'
import { ExecutionContext } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { JwtService } from '@nestjs/jwt'
import { ValidationPipe, BadRequestException, type ValidationError } from '@nestjs/common'
import type { NestExpressApplication } from '@nestjs/platform-express'
import type { Redis } from 'ioredis'
import { AppModule } from '../src/app.module'
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter'
import { EndUserAuthGuard } from '../src/common/guards/end-user-auth.guard'
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard'
import { OptionalEndUserAuthGuard } from '../src/common/guards/optional-end-user-auth.guard'
import { REDIS_CLIENT, RedisService } from '../src/common/redis/redis.service'
import { hashPhone } from '../src/common/crypto/phone-identity'
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
function mockCtx(authHeader?: string): ExecutionContext {
  const req = { headers: authHeader ? { authorization: authHeader } : {} }
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

  // ── 启动真实 HTTP 服务（镜像 main.ts 关键配置）────────────────────────────────
  info('Bootstrapping NestJS HTTP app (logger: error/warn)...')
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ['error', 'warn'] })
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
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
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
    const send = await post('/auth/sms-code', { phone: PHONE, deviceId: 'e2e-kiosk-01' })
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

    // ── 10. 账号禁用后既有 session 立即失效 ──────────────────────────────────
    console.log('\n── 10. 账号禁用后既有 session 立即失效 ───────────────────────')
    const jwtOkForDisabled = { verify: () => ({ sub: user.id as string, jti: 'sess-disabled' }) } as never
    let deletedDisabledSession = false
    const redisDisabled = {
      get: async () => user.id as string,
      del: async (key: string) => {
        deletedDisabledSession = key === 'member:session:sess-disabled'
      },
    } as never
    const prismaDisabled = {
      endUser: {
        findUnique: async () => ({ id: user.id as string, enabled: false }),
      },
    } as never
    const guardDisabled = new EndUserAuthGuard(jwtOkForDisabled, redisDisabled, prismaDisabled)
    await expectGuardCode(
      () => guardDisabled.canActivate(mockCtx('Bearer disabled-session-token')),
      'ACCOUNT_DISABLED',
      '账号禁用后旧 token → ACCOUNT_DISABLED',
    )
    if (deletedDisabledSession) pass('账号禁用时 guard 顺手删除既有 Redis session')
    else fail('账号禁用时 guard 未删除既有 Redis session')

    // ── 11. optional guard 禁用账号不注入本人态 ───────────────────────────────
    console.log('\n── 11. optional guard 禁用账号不注入本人态 ────────────────────')
    let deletedOptionalDisabledSession = false
    const redisOptionalDisabled = {
      get: async () => user.id as string,
      del: async (key: string) => {
        deletedOptionalDisabledSession = key === 'member:session:sess-disabled'
      },
    } as never
    const optionalDisabledGuard = new OptionalEndUserAuthGuard(jwtOkForDisabled, redisOptionalDisabled, prismaDisabled)
    const optionalCtx = mockCtx('Bearer optional-disabled-session-token')
    const optionalAllowed = await optionalDisabledGuard.canActivate(optionalCtx)
    const optionalReq = optionalCtx.switchToHttp().getRequest() as { endUser?: unknown }
    if (optionalAllowed === true && optionalReq.endUser === undefined) pass('optional guard 对禁用账号放行公共读但不注入 endUser')
    else fail('optional guard 对禁用账号仍注入 endUser')
    if (deletedOptionalDisabledSession) pass('optional guard 对禁用账号顺手删除既有 Redis session')
    else fail('optional guard 对禁用账号未删除既有 Redis session')

    // ── 12. 双向隔离 ──────────────────────────────────────────────────────────
    console.log('\n── 12. 双向 token 隔离 ────────────────────────────────────────')
    const internalJwt = new JwtService({ secret: jwtSecret })
    const memberJwt = new JwtService({ secret: jwtSecret, signOptions: { expiresIn: '30m', audience: 'enduser' } })
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
