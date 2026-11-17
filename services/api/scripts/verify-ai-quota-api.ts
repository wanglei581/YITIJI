/**
 * Q3：AI 按人次数余量三个只读接口。
 * 自建隔离 SQLite，Nest 在 127.0.0.1 随机端口上真走会员 / 终端 / 管理员守卫。
 * 不连生产，不读 .env（避免盖掉隔离库地址）。
 * 最后再真起一次整个 AppModule：三个新地址未登录都是 401，不存在的地址是 404。
 *
 * Run: pnpm --filter @ai-job-print/api verify:ai-quota-api
 */
import 'reflect-metadata'
import assert from 'node:assert/strict'
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { request as httpRequest } from 'node:http'
import { Module } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { JwtService } from '@nestjs/jwt'
import type { Request } from 'express'
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter'
import { EndUserAuthGuard, memberSessionKey } from '../src/common/guards/end-user-auth.guard'
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard'
import { RolesGuard } from '../src/common/guards/roles.guard'
import { JwtVerifierModule } from '../src/common/jwt-verifier.module'
import { RedisService } from '../src/common/redis/redis.service'
import { encryptPhone, hashPhone } from '../src/common/crypto/phone-identity'
import { PrismaService } from '../src/prisma/prisma.service'
import {
  TERMINAL_TOKEN_VALIDATOR,
  TerminalSessionService,
} from '../src/terminals/terminal-session.service'
import { TerminalIdentityGuard } from '../src/terminals/terminal-identity.guard'
import { lazyAiRequestContext, runWithAiRequestContext } from '../src/ai/usage/ai-usage-context'
import { AiUse } from '../src/ai-access/ai-access.decorator'
import { AiQuotaController } from '../src/ai/quota/ai-quota.controller'
import {
  AI_QUOTA_BUCKETS,
  dailyLimit,
  quotaDay,
  quotaResetsAt,
} from '../src/ai/quota/ai-quota.policy'
import { AiQuotaService } from '../src/ai/quota/ai-quota.service'
import type {
  AdminAiQuotaUsage,
  AiQuotaRemaining,
  KioskAiQuota,
} from '../src/ai/quota/ai-quota.types'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'

const ZHOU = 'eu-zhou-qiming'
const HAN = 'eu-han-shufen'
const LIN = 'eu-lin-jiashu'
const PHONE = { [ZHOU]: '13853241867', [HAN]: '13964270583', [LIN]: '13785420916' }
const SHINAN = 'qd-shinan-hall-01'
const LAOSHAN = 'qd-laoshan-hall-02'
const ADMIN_ID = 'ops-lin-jing'
const KIOSK_ID = 'kiosk-shinan-01'

function pass(message: string): void {
  console.log(`  PASS ${message}`)
}

/**
 * 三个只读接口必须标成 read，否则覆盖门禁只扫 generate|voice，删掉标记仍然全绿。
 * 元数据键取自 AiUse 返回的装饰器（SetMetadata 写在 KEY 上），不在源码里找字符串。
 */
function assertQuotaRoutesAreRead(): void {
  const key = AiUse('read').KEY
  assert.equal(typeof key, 'string', 'AiUse 必须把元数据键放在装饰器的 KEY 上')
  const expectRead = (label: string, method: object) => {
    assert.equal(Reflect.getMetadata(key, method), 'read', `${label} 的 AI 用途元数据必须是 read`)
  }
  expectRead('本人余量 mine', AiQuotaController.prototype.mine)
  expectRead('一体机余量 kiosk', AiQuotaController.prototype.kiosk)
  expectRead('管理员汇总 adminUsage', AiQuotaController.prototype.adminUsage)
  pass('三个只读接口的 AI 用途元数据都是 read')
}

/** 关掉游客池时，计数行一次都不许读。桩在服务自己的 prisma 上，不改生产代码。 */
function watchDailyReads(service: AiQuotaService): { reads: () => number; restore: () => void } {
  const holder = service as unknown as { prisma: PrismaService }
  const real = holder.prisma
  let reads = 0
  holder.prisma = new Proxy(real, {
    get(target, prop, receiver) {
      if (prop === 'aiQuotaDaily') {
        const daily = Reflect.get(target, prop, receiver) as object
        return new Proxy(daily, {
          get(dailyTarget, dailyProp, dailyReceiver) {
            const value = Reflect.get(dailyTarget, dailyProp, dailyReceiver)
            if (
              (dailyProp === 'findUnique' ||
                dailyProp === 'findMany' ||
                dailyProp === 'findFirst') &&
              typeof value === 'function'
            ) {
              return (...args: unknown[]) => {
                reads += 1
                return (value as (...a: unknown[]) => unknown).apply(dailyTarget, args)
              }
            }
            return typeof value === 'function'
              ? (value as (...a: unknown[]) => unknown).bind(dailyTarget)
              : value
          },
        })
      }
      const value = Reflect.get(target, prop, receiver)
      return typeof value === 'function'
        ? (value as (...a: unknown[]) => unknown).bind(target)
        : value
    },
  })
  return {
    reads: () => reads,
    restore: () => {
      holder.prisma = real
    },
  }
}

async function main(): Promise<void> {
  console.log('\n=== AI 按人次数余量接口 ===')
  assertQuotaRoutesAreRead()
  const apiRoot = resolve(__dirname, '..')
  const moduleSource = readFileSync(resolve(apiRoot, 'src/ai/quota/ai-quota.module.ts'), 'utf8')
  assert.match(moduleSource, /controllers:\s*\[AiQuotaController\]/, 'AiQuotaModule 必须注册控制器')
  if ((process.env.NODE_ENV ?? '').trim().toLowerCase() === 'production')
    process.env.NODE_ENV = 'test'
  process.env.NODE_ENV ||= 'test'
  delete process.env.ADMIN_IP_ALLOWLIST
  process.env.JWT_SECRET = 'verify-ai-quota-api-jwt-secret-32chars'
  process.env.SECRET_ENCRYPTION_KEY = 'verify-ai-quota-api-phone-secret-0123456789abcdef'
  process.env.AI_QUOTA_RESUME_DAILY = '2'
  process.env.AI_QUOTA_ASSISTANT_DAILY = '80'
  process.env.AI_QUOTA_INTERVIEW_DAILY = '5'
  process.env.RECRUITMENT_CONTENT_HOSTING_ENABLED ??= 'false'
  delete process.env.AI_QUOTA_GUEST_TERMINAL_DAILY
  delete process.env.AI_QUOTA_AUTO_RELEASE_DAILY_CAP

  const temporary = mkdtempSync(join(tmpdir(), 'verify-ai-quota-api-'))
  const db = join(temporary, 'verify-ai-quota-api.db')
  closeSync(openSync(db, 'a'))
  process.env.DATABASE_URL = `file:${db}`
  process.env.VERIFICATION_DATABASE_TARGET = 'isolated'
  assertIsolatedVerificationDatabase()
  try {
    execFileSync(
      resolve(apiRoot, 'node_modules/.bin/prisma'),
      ['db', 'push', '--accept-data-loss', '--url', `file:${db}`],
      {
        cwd: apiRoot,
        env: process.env,
        stdio: 'pipe',
        timeout: 120_000,
      }
    )
  } catch (error) {
    rmSync(temporary, { recursive: true, force: true })
    const stderr = (error as { stderr?: Buffer }).stderr?.toString() ?? ''
    throw new Error(
      `prisma db push 失败\n${stderr}\n${error instanceof Error ? error.message : String(error)}`
    )
  }

  const now = new Date()
  const day = quotaDay(now)
  const earlyExpiry = new Date(now.getTime() + 8 * 24 * 3600_000)
  const laterExpiry = new Date(now.getTime() + 40 * 24 * 3600_000)
  const soonExpiry = new Date(now.getTime() + 6 * 24 * 3600_000)
  const expired = new Date(now.getTime() - 24 * 3600_000)
  const prisma = new PrismaService()
  const quota = new AiQuotaService(prisma)
  const sessions = new Map<string, string>()
  const redis = {
    get: async (key: string) => sessions.get(key) ?? null,
    setEx: async (key: string, _ttl: number, value: string) => {
      sessions.set(key, value)
      return 'OK'
    },
    getDel: async (key: string) => {
      const value = sessions.get(key) ?? null
      sessions.delete(key)
      return value
    },
    setJsonIfVersionNotOlder: async () => 'ok' as const,
    unregisterMemberSession: async () => undefined,
  }
  let sequence = 0
  const operation = (who: string) => `${who}-material-${++sequence}`
  const resumeOf = (items: AiQuotaRemaining[]) => {
    const row = items.find((item) => item.bucket === 'ai_resume')
    assert.ok(row, '简历类余量必须在')
    return row
  }

  let app: {
    close: () => Promise<void>
    getHttpServer: () => { address: () => string | { port: number } | null }
  } | null = null
  let released = false
  const releasePrisma = async () => {
    if (released) return
    released = true
    await prisma.onModuleDestroy().catch(() => undefined)
  }
  try {
    await prisma.onModuleInit()
    await prisma.endUser.create({
      data: {
        id: ZHOU,
        nickname: '周启明',
        phoneHash: hashPhone(PHONE[ZHOU]),
        phoneEnc: encryptPhone(PHONE[ZHOU]),
        enabled: true,
        status: 'active',
        createdAt: new Date('2026-03-18T09:20:00+08:00'),
      },
    })
    await prisma.endUser.create({
      data: {
        id: HAN,
        nickname: '韩淑芬',
        phoneHash: hashPhone(PHONE[HAN]),
        phoneEnc: encryptPhone(PHONE[HAN]),
        enabled: true,
        status: 'active',
        createdAt: new Date('2026-05-06T14:05:00+08:00'),
      },
    })
    await prisma.endUser.create({
      data: {
        id: LIN,
        nickname: '林嘉树',
        phoneHash: hashPhone(PHONE[LIN]),
        phoneEnc: encryptPhone(PHONE[LIN]),
        enabled: true,
        status: 'active',
        createdAt: new Date('2026-07-22T11:40:00+08:00'),
      },
    })
    await prisma.user.create({
      data: {
        id: ADMIN_ID,
        name: '林静',
        username: 'shinan-ops-linjing',
        passwordHash: 'verify-ai-quota-api-login-disabled',
        role: 'admin',
      },
    })
    await prisma.user.create({
      data: {
        id: KIOSK_ID,
        name: '市南大厅值机',
        username: 'kiosk-shinan-hall',
        passwordHash: 'verify-ai-quota-api-login-disabled',
        role: 'kiosk',
      },
    })
    for (const [id, code, name, place] of [
      [SHINAN, 'QD-SHINAN-HALL-01', '青岛市南公共就业大厅', '市南大厅一层'],
      [LAOSHAN, 'QD-LAOSHAN-HALL-02', '青岛崂山公共就业大厅', '崂山大厅服务台'],
    ] as const) {
      await prisma.terminal.create({
        data: {
          id,
          terminalCode: code,
          agentToken: `verify-quota-api-${id}`,
          deviceFingerprint: `fp-${id}`,
          displayName: name,
          locationLabel: place,
        },
      })
    }
    await prisma.benefitGrant.create({
      data: {
        endUserId: ZHOU,
        benefitType: 'ai_quota',
        serviceKey: 'ai_resume',
        title: '市南材料辅导加发的简历次数',
        sourceType: 'gov',
        quantityTotal: 2,
        quantityRemaining: 2,
        validUntil: earlyExpiry,
        createdAt: new Date('2026-09-18T09:12:00+08:00'),
      },
    })
    await prisma.benefitGrant.create({
      data: {
        endUserId: ZHOU,
        benefitType: 'ai_quota',
        serviceKey: 'ai_resume',
        title: '崂山招聘会现场加发的简历次数',
        sourceType: 'fair',
        quantityTotal: 4,
        quantityRemaining: 4,
        validUntil: laterExpiry,
        createdAt: new Date('2026-09-02T14:40:00+08:00'),
      },
    })
    await prisma.benefitGrant.create({
      data: {
        endUserId: ZHOU,
        benefitType: 'ai_quota',
        serviceKey: 'ai_resume',
        title: '市南长期材料辅导次数',
        sourceType: 'gov',
        quantityTotal: 3,
        quantityRemaining: 3,
        validUntil: null,
        createdAt: new Date('2026-08-21T11:05:00+08:00'),
      },
    })
    await prisma.benefitGrant.create({
      data: {
        endUserId: HAN,
        benefitType: 'ai_quota',
        serviceKey: 'ai_assistant',
        title: '韩淑芬的小青咨询次数',
        sourceType: 'campus',
        quantityTotal: 2,
        quantityRemaining: 2,
        validUntil: soonExpiry,
        createdAt: new Date('2026-09-28T16:18:00+08:00'),
      },
    })
    await prisma.benefitGrant.create({
      data: {
        endUserId: HAN,
        benefitType: 'ai_quota',
        serviceKey: 'ai_interview',
        title: '已经过期的模拟面试次数',
        sourceType: 'campus',
        quantityTotal: 5,
        quantityRemaining: 5,
        validUntil: expired,
        createdAt: new Date('2026-06-11T10:00:00+08:00'),
      },
    })

    const reserveMember = (
      endUserId: string,
      bucket: 'ai_resume' | 'ai_assistant' | 'ai_interview'
    ) => quota.reserve({ bucket, endUserId, now, operationKey: operation(endUserId) })
    const first = await reserveMember(ZHOU, 'ai_resume')
    const second = await reserveMember(ZHOU, 'ai_resume')
    await quota.commit(first.reservationId, { resultRef: 'resume-zhou-qiming-morning' })
    await quota.release(second.reservationId, 'provider_error', now)

    const controller = new AiQuotaController(quota)
    const directMine = await controller.mine({ endUserId: ZHOU, sessionId: 'direct-zhou' })
    const directResume = resumeOf(directMine.data.items)
    assert.equal(directResume.dailyUsed, 1)
    assert.equal(directResume.dailyRemaining, 1)
    assert.equal(directResume.extraRemaining, 9)
    assert.equal(directResume.extraEarliestExpiry, earlyExpiry.toISOString())
    assert.equal(directResume.resetsAt, quotaResetsAt(now))
    const closedWatch = watchDailyReads(quota)
    try {
      const directOff = await controller.kiosk({
        header: (name: string) => (name.toLowerCase() === 'x-terminal-id' ? SHINAN : undefined),
      } as Request)
      assert.equal(directOff.data.guestEnabled, false)
      assert.equal(directOff.data.dailyLimit, 0)
      assert.equal(directOff.data.dailyUsed, 0)
      assert.equal(directOff.data.dailyRemaining, 0)
      assert.equal(closedWatch.reads(), 0, '游客池关闭时不得读取计数行')
    } finally {
      closedWatch.restore()
    }
    pass('直接调用控制器：预占 2、结算 1、归还 1 后 dailyUsed=1；游客开关为 0 时不读计数')

    @Module({
      imports: [JwtVerifierModule],
      controllers: [AiQuotaController],
      providers: [
        { provide: AiQuotaService, useValue: quota },
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: redis },
        EndUserAuthGuard,
        JwtAuthGuard,
        RolesGuard,
        TerminalIdentityGuard,
        TerminalSessionService,
        {
          provide: TERMINAL_TOKEN_VALIDATOR,
          useValue: { validateTerminalToken: async () => undefined },
        },
      ],
    })
    class AiQuotaApiVerifyModule {}

    const nest = await NestFactory.create(AiQuotaApiVerifyModule, { logger: false })
    app = nest
    nest.setGlobalPrefix('api/v1')
    nest.useGlobalFilters(new HttpExceptionFilter())
    await nest.listen(0, '127.0.0.1')
    const address = nest.getHttpServer().address()
    if (!address || typeof address === 'string') throw new Error('无法取得监听地址')
    const base = `http://127.0.0.1:${address.port}/api/v1`
    const jwt = new JwtService({ secret: process.env.JWT_SECRET })
    const memberToken = (endUserId: string) => {
      const sessionId = `session-${endUserId}`
      sessions.set(memberSessionKey(sessionId), endUserId)
      return jwt.sign(
        { sub: endUserId },
        { jwtid: sessionId, audience: 'enduser', expiresIn: '30m' }
      )
    }
    const staffToken = (userId: string) => jwt.sign({ sub: userId, ver: 0 }, { expiresIn: '30m' })
    const zhouToken = memberToken(ZHOU)
    const adminToken = staffToken(ADMIN_ID)
    const kioskToken = staffToken(KIOSK_ID)
    const shinanSession = 'shinan-hall-morning-session'
    sessions.set(
      new TerminalSessionService(redis as never, prisma, {
        validateTerminalToken: async () => undefined,
      }).sessionKey(shinanSession),
      JSON.stringify({
        terminalId: SHINAN,
        generation: 0,
        issuedAt: new Date().toISOString(),
      })
    )

    // Node fetch 拒绝 GET 带 body。用原始 HTTP，才能把别人的账号放进 body，证明控制器不读它。
    function http(
      path: string,
      headers: Record<string, string> = {},
      body?: string
    ): Promise<{ status: number; text: string; json: Record<string, unknown> }> {
      const url = new URL(`${base}${path}`)
      return new Promise((resolvePromise, reject) => {
        const req = httpRequest(
          {
            hostname: '127.0.0.1',
            port: address.port,
            path: `${url.pathname}${url.search}`,
            method: 'GET',
            headers: {
              Accept: 'application/json',
              ...(body
                ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }
                : {}),
              ...headers,
            },
          },
          (response) => {
            const chunks: Buffer[] = []
            response.on('data', (chunk: Buffer) => chunks.push(chunk))
            response.on('end', () => {
              const text = Buffer.concat(chunks).toString('utf8')
              let json: Record<string, unknown> = {}
              try {
                json = JSON.parse(text) as Record<string, unknown>
              } catch {
                /* 非 JSON 时留给断言看原文 */
              }
              resolvePromise({ status: response.statusCode ?? 0, text, json })
            })
          }
        )
        req.on('error', reject)
        if (body) req.write(body)
        req.end()
      })
    }
    function dataOf<T>(result: { status: number; json: Record<string, unknown> }): T {
      assert.equal(result.status, 200, JSON.stringify(result.json))
      assert.equal(result.json.success, true)
      return result.json.data as T
    }

    const anonymous = await http('/me/ai-quota')
    assert.equal(anonymous.status, 401)
    const opened = dataOf<{ items: AiQuotaRemaining[] }>(
      await http('/me/ai-quota', { Authorization: `Bearer ${zhouToken}` })
    )
    const openedResume = resumeOf(opened.items)
    assert.equal(openedResume.dailyUsed, 1)
    assert.equal(openedResume.dailyLimit, 2)
    assert.equal(openedResume.dailyRemaining, 1)
    assert.equal(openedResume.extraRemaining, 9)
    assert.equal(openedResume.extraEarliestExpiry, earlyExpiry.toISOString())
    assert.equal(opened.items.length, 3)
    pass('HTTP /me/ai-quota：未登录 401；结算后 dailyUsed=1，机构次数尚未扣')

    await reserveMember(ZHOU, 'ai_resume')
    const grantUse = await reserveMember(ZHOU, 'ai_resume')
    assert.equal(grantUse.source, 'grant')
    const afterGrant = dataOf<{ items: AiQuotaRemaining[] }>(
      await http('/me/ai-quota', { Authorization: `Bearer ${zhouToken}` })
    )
    const afterResume = resumeOf(afterGrant.items)
    assert.equal(afterResume.dailyUsed, 2)
    assert.equal(afterResume.extraRemaining, 8)
    assert.equal(afterResume.extraEarliestExpiry, earlyExpiry.toISOString())
    pass('用一张机构次数后 extraRemaining 减 1，最早到期日仍是市南那张')

    // 只放一个字符串 query。重复的同名键会被 Express 收成数组，读到它会 500，测不到「读了别人的数」。
    const forgedResponse = await http(
      `/me/ai-quota?endUserId=${encodeURIComponent(HAN)}`,
      { Authorization: `Bearer ${zhouToken}`, 'x-end-user-id': HAN, 'x-terminal-id': SHINAN },
      JSON.stringify({ endUserId: HAN, phone: PHONE[HAN] })
    )
    const forged = dataOf<{ items: AiQuotaRemaining[] }>(forgedResponse)
    assert.equal(resumeOf(forged.items).dailyUsed, afterResume.dailyUsed)
    assert.equal(forged.items.find((item) => item.bucket === 'ai_assistant')?.dailyUsed, 0)
    assert.equal(forgedResponse.text.includes(HAN), false)
    assert.equal(forgedResponse.text.includes(PHONE[HAN]), false)
    pass('只读本人：query、body、请求头里换成韩淑芬，看到的仍是周启明')

    const assistant = await reserveMember(HAN, 'ai_assistant')
    await quota.commit(assistant.reservationId, { resultRef: 'assistant-han-shufen-consult' })
    for (let i = 0; i < 5; i += 1) {
      const interview = await reserveMember(HAN, 'ai_interview')
      await quota.commit(interview.reservationId, { resultRef: `interview-han-shufen-${i + 1}` })
    }
    const linOpen = await reserveMember(LIN, 'ai_resume')
    await quota.release(linOpen.reservationId, 'content_rejected', now)

    const guestOff = dataOf<KioskAiQuota>(
      await http('/kiosk/ai-quota', {
        'x-terminal-id': SHINAN,
        'x-terminal-session-token': shinanSession,
      })
    )
    assert.equal(guestOff.guestEnabled, false)
    assert.equal(guestOff.dailyLimit, 0)
    assert.equal(guestOff.dailyUsed, 0)
    assert.equal(guestOff.dailyRemaining, 0)
    assert.equal(guestOff.resetsAt, quotaResetsAt(now))
    const unsigned = await http(`/kiosk/ai-quota?terminalId=${SHINAN}`)
    assert.equal(unsigned.status, 401)
    const badSession = await http('/kiosk/ai-quota', {
      'x-terminal-id': SHINAN,
      'x-terminal-session-token': 'not-a-session',
    })
    assert.equal(badSession.status, 401)
    pass('游客池关闭时数字为 0；未验签或会话不对为 401')

    process.env.AI_QUOTA_GUEST_TERMINAL_DAILY = '3'
    await runWithAiRequestContext(
      lazyAiRequestContext(async () => ({
        endUserId: null,
        terminalId: SHINAN,
        terminalVerified: true,
        orgId: null,
      })),
      () =>
        quota.reserve({
          bucket: 'ai_resume',
          terminalId: SHINAN,
          now,
          operationKey: operation('shinan-guest'),
        })
    )
    const guestOn = dataOf<KioskAiQuota>(
      await http(`/kiosk/ai-quota?terminalId=${LAOSHAN}`, {
        'x-terminal-id': SHINAN,
        'x-terminal-session-token': shinanSession,
      })
    )
    assert.equal(guestOn.guestEnabled, true)
    assert.equal(guestOn.dailyLimit, 3)
    assert.equal(guestOn.dailyUsed, 1)
    assert.equal(guestOn.dailyRemaining, 2)
    const storedToday = await prisma.aiQuotaDaily.findUnique({
      where: { endUserId_bucket_day: { endUserId: `terminal:${SHINAN}`, bucket: 'guest', day } },
    })
    assert.equal(guestOn.dailyUsed, storedToday?.used ?? -1)
    pass('游客池设为 3、市南用掉 1 次后 remaining=2；query 里的另一台终端不影响，已用与计数行一致')

    // 北京时间日界不看进程时区。用一个不会撞上「今天」的历史日，免得混进管理员汇总。
    const beforeMidnight = new Date('2020-01-01T15:30:00.000Z')
    const afterMidnight = new Date('2020-01-01T16:30:00.000Z')
    assert.equal(quotaDay(beforeMidnight), '2020-01-01')
    assert.equal(quotaDay(afterMidnight), '2020-01-02')
    await prisma.aiQuotaDaily.create({
      data: { endUserId: `terminal:${LAOSHAN}`, bucket: 'guest', day: '2020-01-01', used: 2 },
    })
    const sameDay = await quota.remainingForTerminal(LAOSHAN, beforeMidnight)
    assert.equal(sameDay.guestEnabled, true)
    assert.equal(sameDay.dailyLimit, 3)
    assert.equal(sameDay.dailyUsed, 2)
    assert.equal(sameDay.dailyRemaining, 1)
    const nextDay = await quota.remainingForTerminal(LAOSHAN, afterMidnight)
    assert.equal(nextDay.dailyUsed, 0)
    assert.equal(nextDay.dailyRemaining, 3)
    assert.equal(nextDay.resetsAt, quotaResetsAt(afterMidnight))
    pass('游客池跨北京时间零点按新的一天算，前一天的已用不带过去')

    const noStaff = await http('/admin/ai/quota-usage')
    assert.equal(noStaff.status, 401)
    const kioskStaff = await http('/admin/ai/quota-usage', {
      Authorization: `Bearer ${kioskToken}`,
    })
    assert.equal(kioskStaff.status, 403)
    const memberOnAdmin = await http('/admin/ai/quota-usage', {
      Authorization: `Bearer ${zhouToken}`,
    })
    assert.equal(memberOnAdmin.status, 401)
    const admin = await http('/admin/ai/quota-usage', { Authorization: `Bearer ${adminToken}` })
    const usage = dataOf<AdminAiQuotaUsage>(admin)
    const rows = await prisma.aiQuotaDaily.findMany({ where: { day } })
    const grants = await prisma.benefitGrant.findMany()
    const horizon = now.getTime() + 30 * 24 * 3600_000
    for (const bucket of AI_QUOTA_BUCKETS) {
      const memberRows = rows.filter(
        (row) => row.bucket === bucket && row.endUserId.startsWith('member:')
      )
      const limit = dailyLimit(bucket)
      const got = usage.buckets.find((item) => item.bucket === bucket)
      assert.ok(got)
      assert.equal(
        got.usedTotal,
        memberRows.reduce((sum, row) => sum + row.used, 0)
      )
      assert.equal(got.membersUsed, memberRows.filter((row) => row.used > 0).length)
      assert.equal(got.membersExhausted, memberRows.filter((row) => row.used >= limit).length)
      assert.equal(got.dailyLimit, limit)
      const live = grants.filter(
        (grant) =>
          grant.benefitType === 'ai_quota' &&
          grant.serviceKey === bucket &&
          grant.status === 'active' &&
          (grant.quantityRemaining ?? 0) > 0 &&
          (grant.validFrom === null || grant.validFrom <= now) &&
          (grant.validUntil === null || grant.validUntil > now)
      )
      const extra = usage.extra.find((item) => item.bucket === bucket)
      assert.ok(extra)
      assert.equal(
        extra.remainingTotal,
        live.reduce((sum, grant) => sum + (grant.quantityRemaining ?? 0), 0)
      )
      assert.equal(
        extra.expiringWithin30Days,
        live.reduce(
          (sum, grant) =>
            grant.validUntil && grant.validUntil.getTime() <= horizon
              ? sum + (grant.quantityRemaining ?? 0)
              : sum,
          0
        )
      )
    }
    const guestRows = rows.filter(
      (row) => row.bucket === 'guest' && row.endUserId.startsWith('terminal:')
    )
    assert.equal(usage.day, day)
    assert.equal(usage.guest.perTerminalDailyLimit, 3)
    assert.equal(usage.guest.terminalsUsed, guestRows.filter((row) => row.used > 0).length)
    assert.equal(
      usage.guest.usedTotal,
      guestRows.reduce((sum, row) => sum + row.used, 0)
    )
    assert.equal(usage.buckets.find((item) => item.bucket === 'ai_resume')?.usedTotal, 2)
    assert.equal(usage.buckets.find((item) => item.bucket === 'ai_resume')?.membersUsed, 1)
    assert.equal(usage.buckets.find((item) => item.bucket === 'ai_resume')?.membersExhausted, 1)
    assert.equal(usage.buckets.find((item) => item.bucket === 'ai_assistant')?.usedTotal, 1)
    assert.equal(usage.buckets.find((item) => item.bucket === 'ai_assistant')?.membersExhausted, 0)
    assert.equal(usage.buckets.find((item) => item.bucket === 'ai_interview')?.usedTotal, 5)
    assert.equal(usage.buckets.find((item) => item.bucket === 'ai_interview')?.membersExhausted, 1)
    assert.equal(usage.extra.find((item) => item.bucket === 'ai_resume')?.remainingTotal, 8)
    assert.equal(usage.extra.find((item) => item.bucket === 'ai_resume')?.expiringWithin30Days, 1)
    assert.equal(usage.extra.find((item) => item.bucket === 'ai_assistant')?.remainingTotal, 2)
    assert.equal(usage.extra.find((item) => item.bucket === 'ai_interview')?.remainingTotal, 0)
    assert.equal(usage.guest.terminalsUsed, 1)
    assert.equal(usage.guest.usedTotal, 1)
    for (const secret of [
      ZHOU,
      HAN,
      LIN,
      PHONE[ZHOU],
      PHONE[HAN],
      PHONE[LIN],
      'member:',
      ADMIN_ID,
    ]) {
      assert.equal(admin.text.includes(secret), false, `管理员响应不应出现 ${secret}`)
    }
    pass('管理员汇总与库里逐行一致，响应不含会员 id 与手机号；非 admin 403')

    const directAdmin = await controller.adminUsage()
    assert.equal(
      directAdmin.data.buckets.find((item) => item.bucket === 'ai_resume')?.usedTotal,
      usage.buckets.find((item) => item.bucket === 'ai_resume')?.usedTotal
    )
    assert.equal(
      directAdmin.data.extra.find((item) => item.bucket === 'ai_resume')?.remainingTotal,
      8
    )
    pass('直接调用 adminUsage 与 HTTP 的简历类合计一致')

    // 用不会撞上「今天」的历史日，免得这两行混进上面的管理员汇总。
    const previousResumeLimit = process.env.AI_QUOTA_RESUME_DAILY
    const countOnDay = async (
      day: string,
      limit: string,
      rows: ReadonlyArray<{ id: string; used: number }>
    ) => {
      process.env.AI_QUOTA_RESUME_DAILY = limit
      for (const row of rows) {
        await prisma.aiQuotaDaily.create({
          data: { endUserId: `member:${row.id}`, bucket: 'ai_resume', day, used: row.used },
        })
      }
      const at = new Date(`${day}T04:00:00.000Z`)
      assert.equal(quotaDay(at), day)
      const summary = await quota.adminUsage(at)
      const resume = summary.buckets.find((item) => item.bucket === 'ai_resume')
      assert.ok(resume)
      assert.equal(resume.dailyLimit, Number(limit))
      return resume
    }
    try {
      const zeroLimit = await countOnDay('2019-04-08', '0', [
        { id: 'eu-sun-qiaoling', used: 0 },
        { id: 'eu-zhao-wenbo', used: 1 },
      ])
      assert.equal(zeroLimit.membersUsed, 1, '上限 0：用过人数')
      assert.equal(zeroLimit.membersExhausted, 1, '上限 0：用完人数')
      pass('上限为 0：used=0 的计数行不算用完，used=1 算用过也算用完')

      const twoLimit = await countOnDay('2019-04-09', '2', [
        { id: 'eu-wu-haiyan', used: 0 },
        { id: 'eu-zheng-mingyuan', used: 2 },
      ])
      assert.equal(twoLimit.membersUsed, 1, '上限 2：用过人数')
      assert.equal(twoLimit.membersExhausted, 1, '上限 2：用完人数')
      pass('上限为 2：used=0 不算用过也不算用完，used=2 算用过也算用完')
    } finally {
      if (previousResumeLimit === undefined) delete process.env.AI_QUOTA_RESUME_DAILY
      else process.env.AI_QUOTA_RESUME_DAILY = previousResumeLimit
    }

    process.env.AI_QUOTA_GUEST_TERMINAL_DAILY = '0'
    const again = watchDailyReads(quota)
    try {
      const guestClosedAgain = dataOf<KioskAiQuota>(
        await http('/kiosk/ai-quota', {
          'x-terminal-id': SHINAN,
          'x-terminal-session-token': shinanSession,
        })
      )
      assert.equal(guestClosedAgain.guestEnabled, false)
      assert.equal(guestClosedAgain.dailyUsed, 0)
      assert.equal(guestClosedAgain.dailyRemaining, 0)
      assert.equal(again.reads(), 0, '开关改回 0 后仍不得读取计数行')
    } finally {
      again.restore()
    }
    const storedGuest = await prisma.aiQuotaDaily.findUnique({
      where: { endUserId_bucket_day: { endUserId: `terminal:${SHINAN}`, bucket: 'guest', day } },
    })
    assert.equal(storedGuest?.used, 1)
    const adminAfterClose = dataOf<AdminAiQuotaUsage>(
      await http('/admin/ai/quota-usage', { Authorization: `Bearer ${adminToken}` })
    )
    assert.equal(adminAfterClose.guest.perTerminalDailyLimit, 0)
    assert.equal(adminAfterClose.guest.usedTotal, 1)
    pass('开关改回 0 后游客接口数字为 0，计数行仍在；管理员仍能看到今天已用 1 次')

    await nest.close()
    app = null
    await releasePrisma()
    if (!process.env.REDIS_URL) process.env.REDIS_URL = 'redis://127.0.0.1:6379'
    const { AppModule } = await import('../src/app.module')
    const full = await NestFactory.create(AppModule, { logger: ['error'] })
    full.setGlobalPrefix('api/v1')
    await full.listen(0, '127.0.0.1')
    try {
      const fullAddress = full.getHttpServer().address()
      if (!fullAddress || typeof fullAddress === 'string')
        throw new Error('无法取得 AppModule 监听地址')
      const fullBase = `http://127.0.0.1:${fullAddress.port}/api/v1`
      for (const path of ['/me/ai-quota', '/kiosk/ai-quota', '/admin/ai/quota-usage']) {
        const response = await fetch(`${fullBase}${path}`, {
          headers: { Accept: 'application/json' },
        })
        assert.equal(response.status, 401, `${path} 未登录应为 401，实际 ${response.status}`)
      }
      const missing = await fetch(`${fullBase}/admin/ai/quota-usage-missing`, {
        headers: { Accept: 'application/json' },
      })
      assert.equal(missing.status, 404, `不存在的地址应为 404，实际 ${missing.status}`)
      pass('整个 AppModule 启动后，三个新地址未登录都是 401，不存在的地址是 404')
    } finally {
      await full.close()
    }

    console.log(`\n${'PASS'.padEnd(6)} AI 按人次数余量接口`)
  } finally {
    await app?.close().catch(() => undefined)
    await releasePrisma()
    rmSync(temporary, { recursive: true, force: true })
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error)
  process.exit(1)
})
