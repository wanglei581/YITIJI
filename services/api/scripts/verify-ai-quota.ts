/** Q1: 真数据库账本验证。默认自建 SQLite；--postgres 只接受隔离的本机 PG。
 * PG 前置：db:pg:generate + db:pg:deploy；两种库执行完全相同的并发/结算断言。
 * 结果重看用真实 AiResumeResult 做 Q2 接线前的服务契约模拟，不宣称 controller 已接入。
 */
import 'reflect-metadata'
import assert from 'node:assert/strict'
import { randomUUID, createHash } from 'node:crypto'
import { closeSync, mkdtempSync, openSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { validate } from 'class-validator'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'
import { PrismaService } from '../src/prisma/prisma.service'
import { AiQuotaService } from '../src/ai/quota/ai-quota.service'
import { hashQuotaOperation } from '../src/ai/quota/ai-quota.policy'
import { runWithAiRequestContext, lazyAiRequestContext } from '../src/ai/usage/ai-usage-context'
import { AdminMemberBenefitsService } from '../src/member-benefits/admin-member-benefits.service'
import { GrantBenefitDto } from '../src/member-benefits/dto/admin-member-benefits.dto'
import { BenefitRedemptionService } from '../src/benefit-redemption/benefit-redemption.service'
import { AuditService } from '../src/audit/audit.service'
import { encryptPhone, hashPhone } from '../src/common/crypto/phone-identity'
import type { AiQuotaBucket } from '../src/member-benefits/member-benefits.types'

async function main() {
  const pg = process.argv.includes('--postgres')
  const apiRoot = resolve(__dirname, '..')
  const temporary = pg ? null : mkdtempSync(join(tmpdir(), 'verify-ai-quota-'))
  if (temporary) {
    const db = join(temporary, 'verify-ai-quota.db')
    closeSync(openSync(db, 'a'))
    process.env.DATABASE_URL = `file:${db}`
    process.env.VERIFICATION_DATABASE_TARGET = 'isolated'
    try {
      assertIsolatedVerificationDatabase()
      execFileSync(resolve(apiRoot, 'node_modules/.bin/prisma'), ['db', 'push'], { cwd: apiRoot, env: process.env, stdio: 'pipe', timeout: 30_000 })
    } catch (error) {
      rmSync(temporary, { recursive: true, force: true })
      throw error
    }
  }
  if (pg && !/^postgres(ql)?:/.test(process.env.DATABASE_URL ?? '')) throw new Error('AI_QUOTA_VERIFY_POSTGRES_REQUIRED')
  assertIsolatedVerificationDatabase()
  process.env.SECRET_ENCRYPTION_KEY ??= 'verify-ai-quota-phone-secret-0123456789abcdef'
  // 服务不依赖 Redis。死端口不实例化 Redis，不需要监听端口。
  process.env.REDIS_URL = 'redis://127.0.0.1:1'
  delete process.env.AI_QUOTA_GUEST_TERMINAL_DAILY
  process.env.AI_QUOTA_RESUME_DAILY = '3'
  process.env.AI_QUOTA_ASSISTANT_DAILY = '80'
  process.env.AI_QUOTA_INTERVIEW_DAILY = '5'
  delete process.env.AI_QUOTA_AUTO_RELEASE_DAILY_CAP
  const prisma = new PrismaService()
  const quota = new AiQuotaService(prisma)
  const audit = new AuditService(prisma)
  const adminBenefits = new AdminMemberBenefitsService(prisma, audit)
  const run = randomUUID().slice(0, 8)
  const names = ['张雨桐', '陈志远', '李晓宁', '赵明轩', '周若涵', '王嘉诚', '刘思琪', '徐子安', '孙佳禾', '杨文博', '高婉清', '何景瑞', '林语宁', '郑凯', '宋安然']
  const users: string[] = []
  const terminal = `qingdao-shinan-quota-${run}`
  const now = new Date('2026-10-03T10:00:00+08:00')
  const beforeMidnight = new Date('2026-10-03T23:59:59+08:00')
  const afterMidnight = new Date('2026-10-04T00:00:05+08:00')
  let sequence = 0, passed = 0
  const operation = () => `qingdao:${run}:${++sequence}`
  const reserve = (endUserId: string, extra: Partial<Parameters<AiQuotaService['reserve']>[0]> = {}) => quota.reserve({ bucket: 'ai_resume', endUserId, now, operationKey: operation(), ...extra })
  async function check(name: string, fn: () => Promise<void>) { await fn(); passed++; console.log(`PASS ${name}`) }
  async function reject(code: string, fn: () => Promise<unknown>, status?: number) {
    try { await fn(); assert.fail(`expected ${code}`) } catch (error) {
      const e = error as { getResponse?: () => unknown; getStatus?: () => number }
      const body = e.getResponse?.() as { error?: { code?: string; bucket?: string; resetsAt?: string }; message?: string } | string
      assert.equal(typeof body === 'string' ? body : body?.error?.code ?? body?.message, code)
      if (status) assert.equal(e.getStatus?.(), status)
      if (code === 'AI_QUOTA_EXHAUSTED') {
        assert.equal(typeof body === 'string' ? null : body.error?.bucket, 'ai_resume')
        assert.equal(typeof body === 'string' ? null : body.error?.resetsAt, '2026-10-03T16:00:00.000Z')
      }
    }
  }
  async function used(user: string, day = '2026-10-03') {
    return (await prisma.aiQuotaDaily.findUnique({ where: { endUserId_bucket_day: { endUserId: `member:${user}`, bucket: 'ai_resume', day } } }))?.used ?? 0
  }
  async function grant(user: string, until: Date | null, extra: Record<string, unknown> = {}) {
    return prisma.benefitGrant.create({ data: { endUserId: user, benefitType: 'ai_quota', serviceKey: 'ai_resume', title: '青岛市南公共就业服务中心 AI 材料次数', sourceType: 'gov', quantityTotal: 2, quantityRemaining: 2, validUntil: until, ...extra } })
  }
  const verified = <T>(fn: () => T, terminalId = terminal, terminalVerified = true) => runWithAiRequestContext(lazyAiRequestContext(async () => ({ endUserId: null, terminalId, terminalVerified, orgId: null })), fn)
  const admin = { userId: `quota-admin-${run}`, role: 'admin' as const, orgId: null }
  try {
    await prisma.onModuleInit()
    for (let i = 0; i < names.length; i++) {
      const id = `quota-${run}-${i}`, phone = `1395702${String(6100 + i)}`
      await prisma.endUser.create({ data: { id, nickname: names[i], phoneHash: hashPhone(phone), phoneEnc: encryptPhone(phone), enabled: true, status: 'active' } })
      users.push(id)
    }
    await prisma.user.create({ data: { id: admin.userId, name: '青岛市南中心运营员林静', username: `shinan-quota-${run}`, passwordHash: 'quota-verification-disabled-login', role: 'admin' } })
    await check('冷启动/Redis 不可用时会员照常扣次、账号隔离与跨端合并', async () => {
      assert.equal((await verified(() => reserve(users[0], { terminalId: terminal }))).source, 'daily')
      await verified(() => reserve(users[0], { terminalId: terminal + '-laoshan' }), terminal + '-laoshan')
      await reserve(users[0], { terminalId: null })
      await reserve(users[1])
      assert.equal(await used(users[0]), 3); assert.equal(await used(users[1]), 1)
      const state = await quota.remaining({ endUserId: users[0], now })
      assert.equal(state.length, 3); assert.equal(state[0].dailyRemaining, 0)
      assert.equal(state[0].resetsAt, '2026-10-03T16:00:00.000Z')
      assert.equal(state[1].dailyLimit, 80); assert.equal(state[2].dailyLimit, 5)
    })
    async function concurrent(user: string, successes: number) {
      const results = await Promise.allSettled(Array.from({ length: 10 }, () => reserve(user)))
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, successes, '并发成功数必须严格等于剩余次数')
      for (const r of results) if (r.status === 'rejected') {
        assert.equal(r.reason.getResponse?.().error?.code, 'AI_QUOTA_EXHAUSTED', '并发输家只能是额度用尽，不能是主键/事务错误')
      }
      assert.equal(await used(user), 3)
    }
    await check(`${pg ? 'PG' : 'SQLite'} 冷启动十并发，上限三，恰好三个成功`, () => concurrent(users[2], 3))
    await check('最后一次十并发只成功一个', async () => { await reserve(users[3]); await reserve(users[3]); await concurrent(users[3], 1) })
    await check('机构最后一次十并发只成功一个，预占扣减与 reservation 原子一致', async () => {
      process.env.AI_QUOTA_RESUME_DAILY = '0'
      const g = await grant(users[12], afterMidnight, { quantityTotal: 1, quantityRemaining: 1 })
      const results = await Promise.allSettled(Array.from({ length: 10 }, () => reserve(users[12])))
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
      for (const r of results) if (r.status === 'rejected') assert.equal(r.reason.getResponse?.().error?.code, 'AI_QUOTA_EXHAUSTED')
      assert.equal((await prisma.benefitGrant.findUniqueOrThrow({ where: { id: g.id } })).quantityRemaining, 0)
      assert.equal(await prisma.aiQuotaReservation.count({ where: { endUserId: users[12] } }), 1)
      process.env.AI_QUOTA_RESUME_DAILY = '3'
    })
    await check('同 operationKey 重放不重扣，hash 不信任输入且跨账号不可回放', async () => {
      const key = operation()
      const r = await reserve(users[4], { operationKey: key })
      const replay = await reserve(users[4], { operationKey: key })
      assert.equal(replay.replay, true); assert.equal(r.reservationId, replay.reservationId); assert.equal(await used(users[4]), 1)
      assert.equal((await prisma.aiQuotaReservation.findUniqueOrThrow({ where: { id: r.reservationId } })).operationKey, createHash('sha256').update(`ai_resume:${key}`).digest('hex'))
      await reject('AI_QUOTA_OPERATION_OWNER_MISMATCH', () => reserve(users[5], { operationKey: key }))
      await reject('AI_QUOTA_OPERATION_INVALID', () => reserve(users[4], { operationKey: '../forged/key' }))
      await reject('AI_QUOTA_OPERATION_INVALID', () => reserve(users[4], { operationKey: 'x'.repeat(201) }))
      const same = operation()
      const results = await Promise.all(Array.from({ length: 10 }, () => reserve(users[4], { operationKey: same })))
      assert.equal(new Set(results.map((v) => v.reservationId)).size, 1); assert.equal(await used(users[4]), 2)
    })
    await check('北京时间跨日重置，23:59 预占归还前一天', async () => {
      const r = await reserve(users[5], { now: beforeMidnight })
      await reserve(users[5], { now: afterMidnight })
      await quota.release(r.reservationId, 'provider_error', afterMidnight)
      assert.equal(await used(users[5]), 0); assert.equal(await used(users[5], '2026-10-04'), 1)
    })
    await check('免费优先，机构次数最早到期优先，无期限最后，commit 同事务核销', async () => {
      const late = await grant(users[6], new Date('2026-10-20T00:00:00+08:00'))
      const endless = await grant(users[6], null)
      const early = await grant(users[6], new Date('2026-10-05T00:00:00+08:00'))
      for (let i = 0; i < 3; i++) assert.equal((await reserve(users[6])).source, 'daily')
      assert.equal((await prisma.benefitGrant.findUniqueOrThrow({ where: { id: early.id } })).quantityRemaining, 2)
      const r = await reserve(users[6]); assert.equal(r.source, 'grant')
      assert.equal((await prisma.aiQuotaReservation.findUniqueOrThrow({ where: { id: r.reservationId } })).benefitGrantId, early.id)
      await quota.commit(r.reservationId, { resultRef: `resume-${run}-chen` })
      await quota.commit(r.reservationId, { resultRef: `resume-${run}-chen` })
      const records = await prisma.redemptionRecord.findMany({ where: { benefitRef: early.id } })
      assert.equal(records.length, 1); assert.equal(records[0].kind, 'free_quota'); assert.equal(records[0].amountCents, 0)
      const operationKey = (await prisma.aiQuotaReservation.findUniqueOrThrow({ where: { id: r.reservationId } })).operationKey
      assert.equal(records[0].serviceType, 'ai_resume'); assert.equal(records[0].serviceRefId, operationKey)
      assert.equal(records[0].idempotencyKey, createHash('sha256').update(`${early.id}:ai_resume:${operationKey}`).digest('hex'))
      assert.equal((await prisma.benefitGrant.findUniqueOrThrow({ where: { id: late.id } })).quantityRemaining, 2)
      assert.equal((await prisma.benefitGrant.findUniqueOrThrow({ where: { id: endless.id } })).quantityRemaining, 2)
      const state = (await quota.remaining({ endUserId: users[6], now }))[0]
      assert.equal(state.extraRemaining, 5); assert.equal(state.extraEarliestExpiry, early.validUntil?.toISOString())
    })
    await check('过期/撤销/未生效/错误用途不可用；ai_quota 不能走旧通用核销', async () => {
      await grant(users[7], now)
      await grant(users[7], null, { status: 'revoked' })
      await grant(users[7], null, { validFrom: afterMidnight })
      await grant(users[7], null, { serviceKey: 'ai_interview' })
      for (let i = 0; i < 3; i++) await reserve(users[7])
      await reject('AI_QUOTA_EXHAUSTED', () => reserve(users[7]), 429)
      const g = await grant(users[7], null)
      const redemption = new BenefitRedemptionService(prisma, audit, {} as never)
      await reject('BENEFIT_NOT_REDEEMABLE', () => redemption.redeem({ endUserId: users[7], benefitGrantId: g.id, serviceType: 'resume_optimize', serviceRefId: operation() }))
    })
    await check('release 归还、幂等，客户端取消不许归还，第六次自动失败扣次并告警', async () => {
      for (let i = 0; i < 5; i++) {
        const r = await reserve(users[8]); await quota.release(r.reservationId, 'provider_error', now); await quota.release(r.reservationId, 'provider_error', now)
        assert.equal(await used(users[8]), 0)
      }
      const r = await reserve(users[8]); await quota.release(r.reservationId, 'server_timeout', now)
      assert.equal(await used(users[8]), 1)
      assert.equal((await prisma.aiQuotaReservation.findUniqueOrThrow({ where: { id: r.reservationId } })).status, 'committed')
      assert.equal(await prisma.auditLog.count({ where: { targetId: r.reservationId, action: 'ai_quota.release_cap_exceeded' } }), 1)
      await reject('AI_QUOTA_COMMITTED_CANNOT_RELEASE', () => quota.release(r.reservationId, 'stale', now))
      await reject('AI_QUOTA_RELEASE_REASON_INVALID', () => quota.release(r.reservationId, 'client_disconnect' as never, now))
    })
    await check('并发归还上限按人跨桶合并，环境阈值二只归还两次', async () => {
      process.env.AI_QUOTA_AUTO_RELEASE_DAILY_CAP = '2'
      const a = await reserve(users[13]), b = await reserve(users[13]), c = await reserve(users[13], { bucket: 'ai_assistant' })
      await Promise.all([a, b, c].map((r) => quota.release(r.reservationId, 'provider_error', now)))
      assert.equal(await prisma.aiQuotaReservation.count({ where: { endUserId: users[13], status: 'released' } }), 2)
      assert.equal(await prisma.aiQuotaReservation.count({ where: { endUserId: users[13], status: 'committed' } }), 1)
      delete process.env.AI_QUOTA_AUTO_RELEASE_DAILY_CAP
    })
    await check('机构次数归还、过期/撤销后不加回，只写审计', async () => {
      process.env.AI_QUOTA_RESUME_DAILY = '0'
      const g = await grant(users[9], afterMidnight)
      const r = await reserve(users[9]); await quota.release(r.reservationId, 'content_rejected', now)
      assert.equal((await prisma.benefitGrant.findUniqueOrThrow({ where: { id: g.id } })).quantityRemaining, 2)
      const expired = await reserve(users[9]); await quota.release(expired.reservationId, 'provider_error', afterMidnight)
      assert.equal((await prisma.benefitGrant.findUniqueOrThrow({ where: { id: g.id } })).quantityRemaining, 1)
      const revoked = await reserve(users[9]); await prisma.benefitGrant.update({ where: { id: g.id }, data: { status: 'revoked' } })
      await quota.release(revoked.reservationId, 'provider_error', now)
      assert.equal((await prisma.benefitGrant.findUniqueOrThrow({ where: { id: g.id } })).quantityRemaining, 0)
      for (const id of [expired.reservationId, revoked.reservationId]) {
        const log = await prisma.auditLog.findFirstOrThrow({ where: { targetId: id } }); assert.equal(JSON.parse(log.payloadJson).refunded, false)
      }
      process.env.AI_QUOTA_RESUME_DAILY = '3'
    })
    await check('stale 清扫超过十五分钟归还，十五分钟边界仍保留', async () => {
      const r = await reserve(users[10], { now: new Date(now.getTime() - 15 * 60_000 - 1) })
      const boundary = await reserve(users[10], { now: new Date(now.getTime() - 15 * 60_000) })
      // 排除其他场景的预占，精准收敛此次夹具。
      await prisma.aiQuotaReservation.updateMany({ where: { endUserId: { in: users.filter((id) => id !== users[10]) }, status: 'reserved' }, data: { reservedAt: now } })
      const result = await quota.sweepStale(now); assert.equal(result.releasedCount, 1)
      assert.equal(await used(users[10]), 1)
      assert.equal((await prisma.aiQuotaReservation.findUniqueOrThrow({ where: { id: boundary.reservationId } })).status, 'reserved')
      const log = await prisma.auditLog.findFirstOrThrow({ where: { targetId: r.reservationId } }); assert.equal(JSON.parse(log.payloadJson).reason, 'stale')
    })
    await check('commit 必须有 resultRef，断连仍扣次，缓存重放需声明，重看真实已存结果不 reserve', async () => {
      const key = operation(), taskId = `resume-${run}-yang`
      const r = await reserve(users[11], { operationKey: key })
      await reject('AI_QUOTA_RESULT_REQUIRED', () => quota.commit(r.reservationId, {} as never))
      await prisma.aiResumeResult.create({ data: { taskId, kind: 'generate', status: 'completed', provider: 'mock', endUserId: users[11], payloadJson: JSON.stringify({ name: '杨文博', phoneTail: '6111', summary: '物流调度经历，青岛市南公共就业服务中心材料辅导' }), expiresAt: afterMidnight } })
      // 服务端 commit 成功，模拟响应在网络中丢失，客户端只持有 taskId。
      await quota.commit(r.reservationId, { resultRef: taskId })
      const row = await prisma.aiQuotaReservation.findUniqueOrThrow({ where: { id: r.reservationId } }); assert.equal(row.resultRef, taskId)
      assert.equal(await used(users[11]), 1)
      await reject('AI_QUOTA_OPERATION_SETTLED', () => reserve(users[11], { operationKey: key }))
      assert.equal((await reserve(users[11], { operationKey: key, allowCommittedReplay: true })).replay, true)
      await reject('AI_QUOTA_COMMITTED_CANNOT_RELEASE', () => quota.release(r.reservationId, 'provider_error', now))
      let reserveCalls = 0
      const original = quota.reserve.bind(quota)
      quota.reserve = async (...args) => { reserveCalls++; return original(...args) }
      try {
        const result = await prisma.aiResumeResult.findFirstOrThrow({ where: { taskId: row.resultRef!, endUserId: users[11] } })
        assert.equal(JSON.parse(result.payloadJson).name, '杨文博'); assert.equal(reserveCalls, 0); assert.equal(await used(users[11]), 1)
      } finally { quota.reserve = original }
    })
    await check('游客默认关闭，已验签池三次跨桶共享，第四次拒绝，缺票/伪造拒绝', async () => {
      const guest = (bucket: AiQuotaBucket = 'ai_resume') => quota.reserve({ bucket, terminalId: terminal, now, operationKey: operation() })
      await verified(() => reject('AI_QUOTA_EXHAUSTED', () => guest(), 429))
      process.env.AI_QUOTA_GUEST_TERMINAL_DAILY = '3'
      await reject('AI_QUOTA_EXHAUSTED', () => guest(), 429)
      await verified(() => reject('AI_QUOTA_EXHAUSTED', () => guest(), 429), terminal, false)
      await verified(() => reject('AI_QUOTA_EXHAUSTED', () => quota.reserve({ bucket: 'ai_resume', terminalId: 'forged', now, operationKey: operation() }), 429))
      for (const bucket of ['ai_resume', 'ai_assistant', 'ai_interview'] as const) assert.equal((await verified(() => guest(bucket))).source, 'guest')
      await verified(() => reject('AI_QUOTA_EXHAUSTED', () => guest(), 429))
      const row = await prisma.aiQuotaDaily.findUniqueOrThrow({ where: { endUserId_bucket_day: { endUserId: `terminal:${terminal}`, bucket: 'guest', day: '2026-10-03' } } }); assert.equal(row.used, 3)
    })
    await check('ai_quota 发放必填合法 serviceKey 与整数 1..9999，其他类型不许带用途，DTO 不丢用途', async () => {
      const dto: GrantBenefitDto = { endUserId: users[0], benefitType: 'ai_quota', title: '市南材料辅导 AI 次数', sourceType: 'gov', quantityTotal: 4 }
      await reject('BENEFIT_SERVICE_KEY_REQUIRED', () => adminBenefits.grant(admin, dto))
      for (const quantity of [undefined, null, 0, 10000, 1.5]) await reject('BENEFIT_QUANTITY_INVALID', () => adminBenefits.grant(admin, { ...dto, serviceKey: 'ai_resume', quantityTotal: quantity }))
      await reject('BENEFIT_SERVICE_KEY_REQUIRED', () => adminBenefits.grant(admin, { ...dto, serviceKey: 'print' as never }))
      await reject('BENEFIT_SERVICE_KEY_FORBIDDEN', () => adminBenefits.grant(admin, { ...dto, benefitType: 'free_quota', serviceKey: 'ai_resume' }))
      const valid = Object.assign(new GrantBenefitDto(), dto, { serviceKey: 'ai_assistant' })
      assert.equal((await validate(valid)).length, 0)
      assert.ok((await validate(Object.assign(new GrantBenefitDto(), dto))).some((e) => e.property === 'serviceKey'))
      assert.equal((await adminBenefits.grant(admin, valid)).serviceKey, 'ai_assistant')
    })
    await check('定时清扫已接现有调度，shared/API 桶与用途契约同步', async () => {
      const cleanup = readFileSync(join(apiRoot, 'src/ai/ai-result.cleanup.task.ts'), 'utf8')
      assert.match(cleanup, /@Cron\(CronExpression.EVERY_MINUTE\)[\s\S]*?quota.sweepStale/)
      const shared = readFileSync(resolve(apiRoot, '../../packages/shared/src/types/memberBenefits.ts'), 'utf8')
      const local = readFileSync(join(apiRoot, 'src/member-benefits/member-benefits.types.ts'), 'utf8')
      assert.equal(shared.match(/export type AiQuotaBucket = [^\n]+/)?.[0], local.match(/export type AiQuotaBucket = [^\n]+/)?.[0])
      assert.equal(hashQuotaOperation('ai_resume', 'opaque-task'), createHash('sha256').update('ai_resume:opaque-task').digest('hex'))
    })
    console.log(`verify:ai-quota ${pg ? 'PostgreSQL' : 'SQLite'} ALL PASS (${passed})`)
  } finally {
    if (pg) {
      await prisma.aiResumeResult.deleteMany({ where: { endUserId: { in: users } } })
      await prisma.redemptionRecord.deleteMany({ where: { endUserId: { in: users } } })
      await prisma.auditLog.deleteMany({ where: { OR: [{ targetId: { startsWith: 'quota-' + run } }, { payloadJson: { contains: run } }, { actorId: admin.userId }] } })
      await prisma.aiQuotaReservation.deleteMany({ where: { OR: [{ endUserId: { in: users } }, { terminalId: terminal }] } })
      await prisma.aiQuotaDaily.deleteMany({ where: { endUserId: { in: [...users.map((id) => `member:${id}`), `terminal:${terminal}`] } } })
      await prisma.benefitGrant.deleteMany({ where: { endUserId: { in: users } } })
      await prisma.endUser.deleteMany({ where: { id: { in: users } } })
      await prisma.user.deleteMany({ where: { id: admin.userId } })
    }
    await prisma.onModuleDestroy()
    if (temporary) rmSync(temporary, { recursive: true, force: true })
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
