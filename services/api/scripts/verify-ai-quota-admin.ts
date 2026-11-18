/**
 * 每天免费 AI 次数可由管理员改。
 * 没设过后台值时等于环境变量，环境变量没设就是简历 20、小青 80、面试 5。
 * 同进程改完立刻生效。另一进程有自己的缓存，最迟 30 秒读到 Redis。越界 400 且原值不动。
 * Redis 读失败回落环境变量，不当成 0。改小后已用够的下一次是 AI_QUOTA_EXHAUSTED。
 * 用量查询跨过缓存有效期后，面板上限仍是后台值，并且和下一次扣次一致。
 * 非管理员 401/403。审计有改前改后，不带姓名和手机号。
 *
 * 默认自建 SQLite。--postgres 只用调用方给的本机隔离库，不自己建库。
 */
import 'reflect-metadata'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { closeSync, mkdtempSync, openSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { BadRequestException, Module, ValidationPipe, type ValidationError } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { NestFactory } from '@nestjs/core'
import { JwtService } from '@nestjs/jwt'
import { Redis } from 'ioredis'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter'
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard'
import { RolesGuard } from '../src/common/guards/roles.guard'
import { JwtVerifierModule } from '../src/common/jwt-verifier.module'
import { RedisService } from '../src/common/redis/redis.service'
import { PrismaService } from '../src/prisma/prisma.service'
import { AuditService } from '../src/audit/audit.service'
import { AdminAiQuotaLimitController } from '../src/ai/quota/admin-ai-quota-limit.controller'
import { AiQuotaLimitService, type AiQuotaDailyLimitInput } from '../src/ai/quota/ai-quota-limit.service'
import { AiQuotaService } from '../src/ai/quota/ai-quota.service'
import {
  AI_QUOTA_BUCKETS,
  AI_QUOTA_LIMIT_CACHE_MS,
  DailyLimitCache,
  aiQuotaDailyLimitKey,
  clearDailyLimitCache,
  dailyLimit,
  quotaDay,
  type AiQuotaBucket,
} from '../src/ai/quota/ai-quota.policy'

const LIMIT_NAMES = ['AI_QUOTA_RESUME_DAILY', 'AI_QUOTA_ASSISTANT_DAILY', 'AI_QUOTA_INTERVIEW_DAILY', 'AI_QUOTA_GUEST_TERMINAL_DAILY'] as const
/** 别的进程最迟生效的规格期限。不读产品缓存常量，改成 60 秒时这一条要红。 */
const CROSS_PROCESS_REFRESH_MS = 30_000
const ADMIN_NAME = '青岛市南中心运营员林静'
const ADMIN_PHONE = '13800001123'

function flattenValidationErrors(errors: ValidationError[], parent = ''): string[] {
  const out: string[] = []
  for (const error of errors) {
    const path = parent ? `${parent}.${error.property}` : error.property
    if (error.constraints) out.push(...Object.values(error.constraints).map((message) => `${path}: ${message}`))
    if (error.children?.length) out.push(...flattenValidationErrors(error.children, path))
  }
  return out
}

function statusOf(error: unknown): number | undefined {
  const read = (error as { getStatus?: () => number }).getStatus
  return typeof read === 'function' ? read.call(error) : undefined
}

function bodyOf(error: unknown): { error?: { code?: string; message?: string } } {
  const response = (error as { getResponse?: () => unknown }).getResponse?.()
  return response && typeof response === 'object' ? response as { error?: { code?: string; message?: string } } : {}
}

async function expectHttpError(status: number, code: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn()
    assert.fail(`应当返回 ${code}`)
  } catch (error) {
    if ((error as { name?: string }).name === 'AssertionError') throw error
    assert.equal(statusOf(error), status, (error as Error).message)
    assert.equal(bodyOf(error).error?.code, code)
  }
}

async function main() {
  const pg = process.argv.includes('--postgres')
  const savedEnv = Object.fromEntries(LIMIT_NAMES.map((name) => [name, process.env[name]]))
  const savedAllowlist = process.env.ADMIN_IP_ALLOWLIST
  const apiRoot = resolve(__dirname, '..')
  const temporary = pg ? null : mkdtempSync(join(tmpdir(), 'verify-ai-quota-admin-'))
  if (!process.env.REDIS_URL) throw new Error('REDIS_URL 未配置')
  const redisUrl = new URL(process.env.REDIS_URL)
  if (!['127.0.0.1', 'localhost', '::1'].includes(redisUrl.hostname)) throw new Error('只允许本机 Redis')
  if (temporary) {
    const db = join(temporary, 'verify-ai-quota-admin.db')
    closeSync(openSync(db, 'a'))
    process.env.DATABASE_URL = `file:${db}`
  } else if (!/^postgres(ql)?:/.test(process.env.DATABASE_URL ?? '')) {
    throw new Error('AI_QUOTA_VERIFY_POSTGRES_REQUIRED')
  }
  process.env.VERIFICATION_DATABASE_TARGET = 'isolated'
  process.env.JWT_SECRET ??= 'verify-ai-quota-admin-jwt-secret'
  delete process.env.ADMIN_IP_ALLOWLIST
  for (const name of LIMIT_NAMES) delete process.env[name]
  assertIsolatedVerificationDatabase()
  if (temporary) {
    execFileSync(resolve(apiRoot, 'node_modules/.bin/prisma'), ['db', 'push'], {
      cwd: apiRoot, env: process.env, stdio: 'pipe', timeout: 60_000,
    })
  }

  const run = randomUUID().slice(0, 8)
  const adminId = `quota-limit-admin-${run}`
  const kioskId = `quota-limit-kiosk-${run}`
  const memberId = `quota-limit-member-${run}`
  const exhaustId = `quota-limit-exhaust-${run}`
  const readerId = `quota-limit-reader-${run}`
  const slowId = `quota-limit-slow-${run}`
  const now = new Date('2026-11-17T03:00:00.000Z')
  const client = new Redis(process.env.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: 1500,
    enableOfflineQueue: false,
  })
  const redis = new RedisService(client)
  const prisma = new PrismaService()
  const audit = new AuditService(prisma)
  const limits = new AiQuotaLimitService(redis, audit, prisma)
  const quota = new AiQuotaService(prisma, limits)
  let passed = 0
  let nest: { close: () => Promise<void> } | null = null
  const input = (aiResume: number, aiAssistant = 80, aiInterview = 5): AiQuotaDailyLimitInput => ({
    ai_resume: aiResume, ai_assistant: aiAssistant, ai_interview: aiInterview,
  })
  const bucket = async (name: AiQuotaBucket) => (await limits.getConfig()).buckets.find((item) => item.bucket === name)
  const rawOf = (name: AiQuotaBucket) => client.get(aiQuotaDailyLimitKey(name))
  async function clearKeys() {
    await Promise.all(AI_QUOTA_BUCKETS.map((name) => client.del(aiQuotaDailyLimitKey(name))))
    clearDailyLimitCache()
  }
  async function check(name: string, fn: () => Promise<void>) {
    await fn()
    passed += 1
    console.log(`PASS ${name}`)
  }

  try {
    await client.connect()
    await client.ping()
    await prisma.onModuleInit()
    await clearKeys()
    await prisma.user.create({ data: { id: adminId, name: ADMIN_NAME, username: `quota-limit-admin-${run}`, passwordHash: 'verify-only', role: 'admin' } })
    await prisma.user.create({ data: { id: kioskId, name: '市南大厅终端', username: `quota-limit-kiosk-${run}`, passwordHash: 'verify-only', role: 'kiosk' } })

    await check('没设后台值时等于环境变量，环境变量没设就是 20、80、5', async () => {
      const config = await limits.getConfig()
      assert.deepEqual(config.buckets.map((item) => [item.bucket, item.effective, item.source, item.fallback]), [
        ['ai_resume', 20, 'default', 20],
        ['ai_assistant', 80, 'default', 80],
        ['ai_interview', 5, 'default', 5],
      ])
      assert.equal(dailyLimit('ai_resume'), 20)
      process.env.AI_QUOTA_RESUME_DAILY = '7'
      process.env.AI_QUOTA_INTERVIEW_DAILY = '9'
      clearDailyLimitCache()
      const resume = await bucket('ai_resume')
      const assistant = await bucket('ai_assistant')
      const interview = await bucket('ai_interview')
      assert.equal(resume?.effective, 7)
      assert.equal(resume?.source, 'env')
      assert.equal(assistant?.effective, 80)
      assert.equal(assistant?.source, 'default')
      assert.equal(interview?.effective, 9)
      assert.equal(interview?.source, 'env')
      assert.equal(dailyLimit('ai_resume'), 7)
      delete process.env.AI_QUOTA_RESUME_DAILY
      delete process.env.AI_QUOTA_INTERVIEW_DAILY
      clearDailyLimitCache()
    })

    await check('同进程改完立刻生效，审计有改前改后且不带姓名手机号', async () => {
      await clearKeys()
      const saved = await limits.update(input(11, 12, 13), adminId, '127.0.0.1')
      assert.equal(saved.buckets.find((item) => item.bucket === 'ai_resume')?.effective, 11)
      assert.equal(saved.buckets.find((item) => item.bucket === 'ai_resume')?.source, 'admin')
      assert.equal(dailyLimit('ai_resume'), 11)
      assert.equal(dailyLimit('ai_assistant'), 12)
      assert.equal(dailyLimit('ai_interview'), 13)
      const ttl = await client.ttl(aiQuotaDailyLimitKey('ai_resume'))
      assert.ok(ttl > 300 * 24 * 3600, `保存时间过短: ${ttl}`)
      const rows = await prisma.auditLog.findMany({ where: { actorId: adminId, action: 'ai.quota_daily_limit_changed' }, orderBy: { createdAt: 'desc' }, take: 1 })
      assert.equal(rows.length, 1)
      assert.equal(rows[0]?.actorRole, 'admin')
      assert.equal(rows[0]?.targetId, 'ai-quota-daily')
      assert.equal(rows[0]?.payloadJson.includes(ADMIN_NAME), false)
      assert.equal(rows[0]?.payloadJson.includes(ADMIN_PHONE), false)
      const payload = JSON.parse(rows[0]?.payloadJson ?? '{}') as { before: Array<{ bucket: string; effective: number; source: string }>; after: Array<{ bucket: string; effective: number; source: string }> }
      assert.deepEqual(Object.keys(payload).sort(), ['after', 'before'])
      assert.equal(payload.before.find((item) => item.bucket === 'ai_resume')?.effective, 20)
      assert.equal(payload.before.find((item) => item.bucket === 'ai_resume')?.source, 'default')
      assert.equal(payload.after.find((item) => item.bucket === 'ai_resume')?.effective, 11)
      assert.equal(payload.after.find((item) => item.bucket === 'ai_resume')?.source, 'admin')
      for (const side of [payload.before, payload.after]) {
        for (const item of side) assert.deepEqual(Object.keys(item).sort(), ['bucket', 'effective', 'source'])
      }
      clearDailyLimitCache()
      const usage = await quota.adminUsage(now)
      const remaining = await quota.remaining({ endUserId: readerId, now })
      assert.equal(usage.buckets.find((item) => item.bucket === 'ai_resume')?.dailyLimit, 11)
      assert.equal(remaining.find((item) => item.bucket === 'ai_resume')?.dailyLimit, 11)
      const guest = await quota.remainingForTerminal(`t-${run}`, now)
      assert.equal(guest.guestEnabled, false)
      assert.equal(guest.dailyLimit, 0)
    })

    await check('写成功的进程立刻生效，另一进程最迟 30 秒读到新上限', async () => {
      await clearKeys()
      const originalNow = Date.now
      let clock = originalNow()
      Date.now = () => clock
      const readerCache = new DailyLimitCache()
      const reader = new AiQuotaLimitService(redis, audit, prisma, readerCache)
      try {
        await limits.ensureFresh()
        await reader.ensureFresh()
        assert.equal(dailyLimit('ai_resume'), 20)
        assert.equal(dailyLimit('ai_resume', readerCache), 20)
        await limits.update(input(15, 16, 17), adminId, null)
        assert.equal(dailyLimit('ai_resume'), 15)
        assert.equal(dailyLimit('ai_assistant'), 16)
        assert.equal(dailyLimit('ai_interview'), 17)
        assert.equal(dailyLimit('ai_resume', readerCache), 20)
        clock += CROSS_PROCESS_REFRESH_MS - 1
        assert.equal(dailyLimit('ai_resume', readerCache), 20)
        await reader.ensureFresh()
        assert.equal(dailyLimit('ai_resume', readerCache), 20)
        clock += 1
        await reader.ensureFresh()
        assert.equal(dailyLimit('ai_resume', readerCache), 15)
        assert.equal(dailyLimit('ai_assistant', readerCache), 16)
        assert.equal(dailyLimit('ai_interview', readerCache), 17)
      } finally {
        Date.now = originalNow
      }
    })

    await check('用量查询跨过缓存有效期后，面板上限仍是后台值，并且和实扣一致', async () => {
      const savedRaw = await Promise.all(AI_QUOTA_BUCKETS.map((name) => rawOf(name)))
      const originalNow = Date.now
      let clock = originalNow()
      const daily = prisma.aiQuotaDaily
      const grants = prisma.benefitGrant
      const originalDailyFindMany = daily.findMany.bind(daily)
      const originalDailyFindUnique = daily.findUnique.bind(daily)
      const originalGrantFindMany = grants.findMany.bind(grants)
      const crossCache = async <T>(run: () => Promise<T>): Promise<T> => {
        await new Promise((resolve) => setTimeout(resolve, 15))
        // 缓存只看 Date.now()。查询里把时钟拨过有效期，和查询真的超过 30 秒是同一种过期。
        clock += AI_QUOTA_LIMIT_CACHE_MS + 1
        return run()
      }
      daily.findMany = ((args: unknown) => crossCache(() => originalDailyFindMany(args))) as typeof daily.findMany
      daily.findUnique = ((args: unknown) => crossCache(() => originalDailyFindUnique(args))) as typeof daily.findUnique
      grants.findMany = ((args: unknown) => crossCache(() => originalGrantFindMany(args))) as typeof grants.findMany
      Date.now = () => clock
      try {
        await clearKeys()
        await limits.update(input(11, 12, 13), adminId, null)
        await prisma.aiQuotaDaily.create({
          data: { endUserId: `member:${slowId}`, bucket: 'ai_resume', day: quotaDay(now), used: 11 },
        })
        const beforeUsage = clock
        const usage = await quota.adminUsage(now)
        assert.ok(clock - beforeUsage > AI_QUOTA_LIMIT_CACHE_MS, '用量查询应当跨过缓存有效期')
        const resumeUsage = usage.buckets.find((item) => item.bucket === 'ai_resume')
        assert.equal(resumeUsage?.dailyLimit, 11, '用量面板上限')
        assert.equal(resumeUsage?.usedTotal, 11)
        assert.equal(resumeUsage?.membersExhausted, 1)
        assert.equal(usage.buckets.find((item) => item.bucket === 'ai_assistant')?.dailyLimit, 12)
        assert.equal(usage.buckets.find((item) => item.bucket === 'ai_interview')?.dailyLimit, 13)
        const beforeRemaining = clock
        const left = await quota.remaining({ endUserId: slowId, now })
        assert.ok(clock - beforeRemaining > AI_QUOTA_LIMIT_CACHE_MS, '余量查询应当跨过缓存有效期')
        const resumeLeft = left.find((item) => item.bucket === 'ai_resume')
        assert.equal(resumeLeft?.dailyLimit, 11, '余量上限')
        assert.equal(resumeLeft?.dailyUsed, 11)
        assert.equal(resumeLeft?.dailyRemaining, 0)
        assert.equal(left.find((item) => item.bucket === 'ai_assistant')?.dailyLimit, 12)
        assert.equal(left.find((item) => item.bucket === 'ai_interview')?.dailyLimit, 13)
        daily.findMany = originalDailyFindMany
        daily.findUnique = originalDailyFindUnique
        grants.findMany = originalGrantFindMany
        Date.now = originalNow
        await expectHttpError(429, 'AI_QUOTA_EXHAUSTED', () => quota.reserve({
          bucket: 'ai_resume', endUserId: slowId, operationKey: `q23b:${run}:across-cache`, now,
        }))
      } finally {
        Date.now = originalNow
        daily.findMany = originalDailyFindMany
        daily.findUnique = originalDailyFindUnique
        grants.findMany = originalGrantFindMany
        await Promise.all(AI_QUOTA_BUCKETS.map(async (name, index) => {
          const value = savedRaw[index]
          if (value == null) await client.del(aiQuotaDailyLimitKey(name))
          else await client.set(aiQuotaDailyLimitKey(name), value)
        }))
        clearDailyLimitCache()
        await prisma.aiQuotaReservation.deleteMany({ where: { endUserId: slowId } }).catch(() => undefined)
        await prisma.aiQuotaDaily.deleteMany({ where: { endUserId: `member:${slowId}` } }).catch(() => undefined)
      }
    })

    await check('越界、小数、非整数都不写入，原值保持不变', async () => {
      const beforeRaw = await rawOf('ai_resume')
      const beforeCount = await prisma.auditLog.count({ where: { actorId: adminId, action: 'ai.quota_daily_limit_changed' } })
      const rejected = [input(1001, 1, 1), input(-1, 1, 1), input(1.5, 1, 1), { ai_resume: '20', ai_assistant: 1, ai_interview: 1 } as unknown as AiQuotaDailyLimitInput]
      for (const bad of rejected) {
        await expectHttpError(400, 'AI_QUOTA_LIMIT_INVALID', () => limits.update(bad, adminId, null))
      }
      assert.equal(await rawOf('ai_resume'), beforeRaw)
      assert.equal(await prisma.auditLog.count({ where: { actorId: adminId, action: 'ai.quota_daily_limit_changed' } }), beforeCount)
      assert.equal((await bucket('ai_resume'))?.effective, 15)
    })

    await check('Redis 读失败回落环境变量，不当成 0，扣次也不报 500', async () => {
      process.env.AI_QUOTA_RESUME_DAILY = '6'
      process.env.AI_QUOTA_ASSISTANT_DAILY = '7'
      process.env.AI_QUOTA_INTERVIEW_DAILY = '8'
      clearDailyLimitCache()
      const failing = new Proxy(redis, {
        get(target, prop, receiver) {
          if (prop === 'get') return () => Promise.reject(new Error('ECONNREFUSED'))
          const value = Reflect.get(target, prop, receiver) as unknown
          return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value
        },
      }) as RedisService
      const broken = new AiQuotaLimitService(failing, audit, prisma)
      const brokenQuota = new AiQuotaService(prisma, broken)
      const config = await broken.getConfig()
      assert.equal(config.buckets.find((item) => item.bucket === 'ai_resume')?.effective, 6)
      assert.equal(config.buckets.find((item) => item.bucket === 'ai_resume')?.source, 'env')
      assert.notEqual(dailyLimit('ai_resume'), 0)
      assert.equal(dailyLimit('ai_assistant'), 7)
      assert.equal(dailyLimit('ai_interview'), 8)
      const receipt = await brokenQuota.reserve({ bucket: 'ai_resume', endUserId: memberId, operationKey: `q23:${run}:redis-down`, now })
      assert.equal(receipt.source, 'daily')
      delete process.env.AI_QUOTA_RESUME_DAILY
      delete process.env.AI_QUOTA_ASSISTANT_DAILY
      delete process.env.AI_QUOTA_INTERVIEW_DAILY
      clearDailyLimitCache()
    })

    await check('乱码和超过 1000 的 Redis 值不当成后台值，也不当成 0', async () => {
      process.env.AI_QUOTA_RESUME_DAILY = '6'
      await client.set(aiQuotaDailyLimitKey('ai_resume'), 'nope')
      await client.set(aiQuotaDailyLimitKey('ai_assistant'), '1001')
      clearDailyLimitCache()
      const resume = await bucket('ai_resume')
      const assistant = await bucket('ai_assistant')
      assert.equal(resume?.effective, 6)
      assert.equal(resume?.source, 'env')
      assert.equal(assistant?.effective, 80)
      assert.equal(assistant?.source, 'default')
      delete process.env.AI_QUOTA_RESUME_DAILY
      await clearKeys()
    })

    await check('改小后已用次数达到新上限，下一次提示今天用完；改大立即可再用', async () => {
      await limits.update(input(3), adminId, null)
      const reserve = (suffix: string) => quota.reserve({ bucket: 'ai_resume', endUserId: exhaustId, operationKey: `q23:${run}:${suffix}`, now })
      await reserve('used-1')
      await reserve('used-2')
      await limits.update(input(2), adminId, null)
      await expectHttpError(429, 'AI_QUOTA_EXHAUSTED', () => reserve('used-3'))
      try {
        await reserve('used-3b')
        assert.fail('应当用完')
      } catch (error) {
        if ((error as { name?: string }).name === 'AssertionError') throw error
        assert.equal(bodyOf(error).error?.message, '今天的 AI 次数用完了，明天 0 点恢复')
      }
      await limits.update(input(4), adminId, null)
      const again = await reserve('used-4')
      assert.equal(again.source, 'daily')
      await limits.update(input(0), adminId, null)
      assert.equal((await bucket('ai_resume'))?.source, 'admin')
      assert.equal(dailyLimit('ai_resume'), 0)
      await expectHttpError(429, 'AI_QUOTA_EXHAUSTED', () => quota.reserve({
        bucket: 'ai_resume', endUserId: readerId, operationKey: `q23:${run}:zero`, now,
      }))
    })

    @Module({
      imports: [JwtVerifierModule],
      controllers: [AdminAiQuotaLimitController],
      providers: [
        Reflector,
        JwtAuthGuard,
        RolesGuard,
        { provide: AiQuotaLimitService, useValue: limits },
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: redis },
        { provide: AuditService, useValue: audit },
      ],
    })
    class AiQuotaLimitVerifyModule {}

    const app = await NestFactory.create(AiQuotaLimitVerifyModule, { logger: false })
    nest = app
    app.setGlobalPrefix('api/v1')
    app.useGlobalFilters(new HttpExceptionFilter())
    app.useGlobalPipes(new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors) => {
        const details = flattenValidationErrors(errors)
        return new BadRequestException({ error: { code: 'VALIDATION_FAILED', message: details[0] ?? '请求参数校验失败', details } })
      },
    }))
    await app.listen(0, '127.0.0.1')
    const address = app.getHttpServer().address()
    if (!address || typeof address === 'string') throw new Error('无法取得监听地址')
    const base = `http://127.0.0.1:${address.port}/api/v1`
    const jwt = new JwtService({ secret: process.env.JWT_SECRET })
    const staffToken = (userId: string) => jwt.sign({ sub: userId, ver: 0 }, { expiresIn: '30m' })
    const adminToken = staffToken(adminId)
    const kioskToken = staffToken(kioskId)
    const memberToken = jwt.sign({ sub: memberId }, { jwtid: `session-${run}`, audience: 'enduser', expiresIn: '30m' })
    async function http(method: string, path: string, token?: string, body?: unknown) {
      const response = await fetch(`${base}${path}`, {
        method,
        headers: {
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      })
      const text = await response.text()
      let json: { success?: boolean; data?: { buckets?: Array<{ bucket: string; effective: number; source: string }> }; error?: { code?: string } } = {}
      try { json = JSON.parse(text) as typeof json } catch { /* 留给断言看状态码 */ }
      return { status: response.status, json, text }
    }

    await check('管理员可读可改；越界的 HTTP 请求是 400 且值不变', async () => {
      const current = await http('GET', '/admin/ai/quota-limits', adminToken)
      assert.equal(current.status, 200)
      assert.equal(current.json.data?.buckets?.find((item) => item.bucket === 'ai_resume')?.effective, 0)
      const rawBefore = await rawOf('ai_resume')
      for (const body of [
        { ai_resume: 1001, ai_assistant: 1, ai_interview: 1 },
        { ai_resume: 1.5, ai_assistant: 1, ai_interview: 1 },
        { ai_resume: '20', ai_assistant: 1, ai_interview: 1 },
        { ai_resume: 1, ai_assistant: 1 },
      ]) {
        const rejected = await http('PUT', '/admin/ai/quota-limits', adminToken, body)
        assert.equal(rejected.status, 400, JSON.stringify(rejected.json))
      }
      assert.equal(await rawOf('ai_resume'), rawBefore)
      const changed = await http('PUT', '/admin/ai/quota-limits', adminToken, input(21, 22, 23))
      assert.equal(changed.status, 200, JSON.stringify(changed.json))
      assert.equal(changed.json.data?.buckets?.find((item) => item.bucket === 'ai_resume')?.effective, 21)
      assert.equal(dailyLimit('ai_resume'), 21)
      assert.equal(changed.text.includes(ADMIN_NAME), false)
      assert.equal(changed.text.includes(ADMIN_PHONE), false)
    })

    await check('非管理员不能改，恢复默认后回到环境变量或缺省', async () => {
      const rawBefore = await rawOf('ai_resume')
      const anonymous = await http('PUT', '/admin/ai/quota-limits', undefined, input(1, 1, 1))
      assert.equal(anonymous.status, 401)
      const member = await http('PUT', '/admin/ai/quota-limits', memberToken, input(1, 1, 1))
      assert.equal(member.status, 401)
      const kiosk = await http('PUT', '/admin/ai/quota-limits', kioskToken, input(1, 1, 1))
      assert.equal(kiosk.status, 403)
      const kioskReset = await http('POST', '/admin/ai/quota-limits/reset', kioskToken)
      assert.equal(kioskReset.status, 403)
      const kioskRead = await http('GET', '/admin/ai/quota-limits', kioskToken)
      assert.equal(kioskRead.status, 403)
      assert.equal(await rawOf('ai_resume'), rawBefore)
      delete process.env.AI_QUOTA_RESUME_DAILY
      delete process.env.AI_QUOTA_ASSISTANT_DAILY
      delete process.env.AI_QUOTA_INTERVIEW_DAILY
      const reset = await http('POST', '/admin/ai/quota-limits/reset', adminToken)
      assert.equal(reset.status, 200, JSON.stringify(reset.json))
      assert.equal(reset.json.data?.buckets?.find((item) => item.bucket === 'ai_resume')?.effective, 20)
      assert.equal(reset.json.data?.buckets?.find((item) => item.bucket === 'ai_resume')?.source, 'default')
      assert.equal(await rawOf('ai_resume'), null)
      assert.equal(dailyLimit('ai_resume'), 20)
      const resetAudit = await prisma.auditLog.findFirst({
        where: { actorId: adminId, action: 'ai.quota_daily_limit_changed' },
        orderBy: { createdAt: 'desc' },
      })
      const payload = JSON.parse(resetAudit?.payloadJson ?? '{}') as { before: Array<{ effective: number }>; after: Array<{ source: string; effective: number }> }
      assert.equal(payload.before[0]?.effective, 21)
      assert.equal(payload.after[0]?.effective, 20)
      assert.equal(payload.after[0]?.source, 'default')
      assert.equal(resetAudit?.payloadJson.includes(ADMIN_NAME), false)
    })

    console.log(`\n${passed} PASS  每天免费 AI 次数后台可改`)
  } finally {
    await nest?.close().catch(() => undefined)
    await clearKeys().catch(() => undefined)
    await prisma.auditLog.deleteMany({ where: { actorId: { in: [adminId, kioskId] } } }).catch(() => undefined)
    await prisma.aiQuotaReservation.deleteMany({ where: { endUserId: { in: [memberId, exhaustId, readerId, slowId] } } }).catch(() => undefined)
    await prisma.aiQuotaDaily.deleteMany({ where: { endUserId: { in: [`member:${memberId}`, `member:${exhaustId}`, `member:${readerId}`, `member:${slowId}`] } } }).catch(() => undefined)
    await prisma.user.deleteMany({ where: { id: { in: [adminId, kioskId] } } }).catch(() => undefined)
    await prisma.onModuleDestroy().catch(() => undefined)
    client.disconnect()
    if (temporary) rmSync(temporary, { recursive: true, force: true })
    for (const name of LIMIT_NAMES) {
      if (savedEnv[name] === undefined) delete process.env[name]
      else process.env[name] = savedEnv[name]
    }
    if (savedAllowlist === undefined) delete process.env.ADMIN_IP_ALLOWLIST
    else process.env.ADMIN_IP_ALLOWLIST = savedAllowlist
    clearDailyLimitCache()
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error)
  process.exit(1)
})
