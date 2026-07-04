import 'dotenv/config'
import 'reflect-metadata'
import { randomUUID } from 'crypto'
import { rmSync } from 'fs'
import { createClient } from '@libsql/client'
import { PrismaService } from '../src/prisma/prisma.service'
import { AuditService } from '../src/audit/audit.service'
import { BenefitRedemptionService } from '../src/benefit-redemption/benefit-redemption.service'

// ============================================================
// P1 权益核销（BenefitRedemptionService）验证。
//
// 覆盖：
//   1. 基础核销：扣 quantityRemaining、落 RedemptionRecord、写审计；orderId=null / amountCents=0（券≠资金）。
//   2. 幂等回放：同 (grant+service+ref) 重复 → 不二次扣、不二次审计、返回同一记录、idempotent=true。
//   3. 第二产物扣减 + 用尽置 used_up。
//   4. CAS 用尽守卫：active 但 remaining=0 → BENEFIT_USED_UP。
//   5. used_up 权益再核销 → BENEFIT_NOT_ACTIVE。
//   6. subsidy_eligibility_hint 拒核销 → BENEFIT_NOT_REDEEMABLE。
//   7. 跨用户拒核销 → BENEFIT_GRANT_NOT_FOUND。
//   8. 无额度（quantityRemaining=null）拒 → BENEFIT_NOT_QUANTIFIED。
//   9. 过期权益拒 → BENEFIT_EXPIRED。
//  10. 一产物一核销：同一 (serviceType,serviceRefId) 换权益再核销 → BENEFIT_OUTPUT_ALREADY_REDEEMED。
//  11. 缺 serviceRefId 拒 → REDEEM_SERVICE_REF_REQUIRED。
//  12. 全量 RedemptionRecord orderId 恒 null、amountCents 恒 0；审计仅真实扣减写、回放不写。
// ============================================================

const fallbackDbName = process.env['DATABASE_URL'] ? null : `verify-benefit-redemption-${randomUUID().slice(0, 8)}.db`
if (fallbackDbName) process.env['DATABASE_URL'] = `file:./prisma/${fallbackDbName}`
process.env['SECRET_ENCRYPTION_KEY'] ??= 'verify-benefit-redemption-secret-key-0123456789'
process.env['JWT_SECRET'] ??= 'verify-benefit-redemption-jwt-secret-0123456789'

function pass(message: string) { console.log(`  PASS ${message}`) }
function fail(message: string): never { console.error(`  FAIL ${message}`); process.exit(1) }

async function expectReject(code: string, label: string, fn: () => Promise<unknown>) {
  try {
    await fn()
    fail(`${label} — expected ${code}, got success`)
  } catch (error) {
    const body = (error as { getResponse?: () => unknown; response?: unknown }).getResponse?.()
      ?? (error as { response?: unknown }).response
    const actual = (body as { error?: { code?: string } } | undefined)?.error?.code
    if (actual === code) pass(label)
    else fail(`${label} — expected ${code}, got ${actual ?? (error as Error).message}`)
  }
}

async function main() {
  console.log('\n=== P1 权益核销验证 ===')
  if (fallbackDbName) await initFallbackDb()

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const audit = new AuditService(prisma)
  const svc = new BenefitRedemptionService(prisma, audit)

  const s = randomUUID().replace(/-/g, '').slice(0, 10)
  const userA = `eu_rd_a_${s}`
  const userB = `eu_rd_b_${s}`
  const grantIds: string[] = []
  const g = (k: string) => `bg_rd_${k}_${s}`

  const past = new Date(Date.now() - 24 * 60 * 60 * 1000)

  async function cleanup() {
    await prisma.redemptionRecord.deleteMany({ where: { endUserId: { in: [userA, userB] } } })
    await prisma.benefitGrant.deleteMany({ where: { id: { in: grantIds } } })
    await prisma.auditLog.deleteMany({ where: { targetId: { in: grantIds } } })
    await prisma.endUser.deleteMany({ where: { id: { in: [userA, userB] } } })
  }

  try {
    await cleanup()
    for (const id of [userA, userB]) {
      await prisma.endUser.create({ data: { id, phoneHash: `rd-${id}`, phoneEnc: `rd-enc-${id}`, nickname: id } })
    }

    async function mkGrant(k: string, data: Record<string, unknown>): Promise<string> {
      const id = g(k)
      grantIds.push(id)
      await prisma.benefitGrant.create({
        data: {
          id, endUserId: userA, benefitType: 'free_quota', title: `权益 ${k}`,
          quantityTotal: 2, quantityRemaining: 2, status: 'active', sourceType: 'platform',
          ...data,
        },
      })
      return id
    }

    const gQuota = await mkGrant('quota', { benefitType: 'free_quota', quantityTotal: 2, quantityRemaining: 2 })
    const gQuota2 = await mkGrant('quota2', { benefitType: 'coupon', quantityTotal: 1, quantityRemaining: 1 })
    const gSubsidy = await mkGrant('subsidy', { benefitType: 'subsidy_eligibility_hint', quantityTotal: null, quantityRemaining: null })
    const gExpired = await mkGrant('expired', { benefitType: 'coupon', quantityTotal: 1, quantityRemaining: 1, validUntil: past })
    const gNull = await mkGrant('bnull', { benefitType: 'coupon', quantityTotal: null, quantityRemaining: null })
    const gZero = await mkGrant('zero', { benefitType: 'coupon', quantityTotal: 1, quantityRemaining: 0 })
    pass('测试会员与权益夹具已创建')

    // ── 1. 基础核销 ──
    const r1 = await svc.redeem({ endUserId: userA, benefitGrantId: gQuota, serviceType: 'resume_optimize', serviceRefId: 'task-1' })
    const after1 = await prisma.benefitGrant.findUnique({ where: { id: gQuota } })
    const rec1 = await prisma.redemptionRecord.findUnique({ where: { id: r1.redemptionRecordId } })
    if (r1.idempotent === false && r1.quantityRemaining === 1 && after1?.quantityRemaining === 1 && after1.status === 'active'
      && rec1 && rec1.orderId === null && rec1.amountCents === 0 && rec1.benefitRef === gQuota && rec1.serviceRefId === 'task-1' && rec1.kind === 'free_quota') {
      pass('1. 基础核销：quantityRemaining 2→1、落记录、orderId=null/amountCents=0（券≠资金）')
    } else fail(`1. 基础核销异常：r1=${JSON.stringify(r1)} after=${JSON.stringify(after1)} rec=${JSON.stringify(rec1)}`)

    // ── 2. 幂等回放 ──
    const auditBefore = await prisma.auditLog.count({ where: { action: 'benefit.redeem', targetId: gQuota } })
    const r2 = await svc.redeem({ endUserId: userA, benefitGrantId: gQuota, serviceType: 'resume_optimize', serviceRefId: 'task-1' })
    const after2 = await prisma.benefitGrant.findUnique({ where: { id: gQuota } })
    const auditAfter = await prisma.auditLog.count({ where: { action: 'benefit.redeem', targetId: gQuota } })
    const recCount = await prisma.redemptionRecord.count({ where: { benefitRef: gQuota, serviceRefId: 'task-1' } })
    if (r2.idempotent === true && r2.redemptionRecordId === r1.redemptionRecordId && after2?.quantityRemaining === 1
      && auditAfter === auditBefore && recCount === 1) {
      pass('2. 幂等回放：不二次扣、不二次审计、返回同一记录、无重复行')
    } else fail(`2. 幂等异常：r2=${JSON.stringify(r2)} after=${after2?.quantityRemaining} auditΔ=${auditAfter - auditBefore} recCount=${recCount}`)

    // ── 3. 第二产物扣减 + used_up ──
    const r3 = await svc.redeem({ endUserId: userA, benefitGrantId: gQuota, serviceType: 'resume_optimize', serviceRefId: 'task-2' })
    const after3 = await prisma.benefitGrant.findUnique({ where: { id: gQuota } })
    if (r3.quantityRemaining === 0 && r3.status === 'used_up' && after3?.status === 'used_up' && after3.quantityRemaining === 0) {
      pass('3. 第二产物扣减 1→0 且置 used_up')
    } else fail(`3. used_up 异常：r3=${JSON.stringify(r3)} after=${JSON.stringify(after3)}`)

    // ── 4. CAS 用尽守卫（active 但 remaining=0）──
    await expectReject('BENEFIT_USED_UP', '4. active 但 remaining=0 → BENEFIT_USED_UP', () =>
      svc.redeem({ endUserId: userA, benefitGrantId: gZero, serviceType: 'resume_optimize', serviceRefId: 'task-zero' }))

    // ── 5. used_up 权益再核销 ──
    await expectReject('BENEFIT_NOT_ACTIVE', '5. used_up 权益再核销 → BENEFIT_NOT_ACTIVE', () =>
      svc.redeem({ endUserId: userA, benefitGrantId: gQuota, serviceType: 'resume_optimize', serviceRefId: 'task-3' }))

    // ── 6. subsidy 拒核销 ──
    await expectReject('BENEFIT_NOT_REDEEMABLE', '6. subsidy_eligibility_hint 拒核销 → BENEFIT_NOT_REDEEMABLE', () =>
      svc.redeem({ endUserId: userA, benefitGrantId: gSubsidy, serviceType: 'resume_optimize', serviceRefId: 'task-sub' }))

    // ── 7. 跨用户拒核销 ──
    await expectReject('BENEFIT_GRANT_NOT_FOUND', '7. B 核销 A 的权益 → BENEFIT_GRANT_NOT_FOUND', () =>
      svc.redeem({ endUserId: userB, benefitGrantId: gQuota2, serviceType: 'resume_optimize', serviceRefId: 'task-x' }))

    // ── 8. 无额度拒 ──
    await expectReject('BENEFIT_NOT_QUANTIFIED', '8. quantityRemaining=null → BENEFIT_NOT_QUANTIFIED', () =>
      svc.redeem({ endUserId: userA, benefitGrantId: gNull, serviceType: 'resume_optimize', serviceRefId: 'task-null' }))

    // ── 9. 过期拒 ──
    await expectReject('BENEFIT_EXPIRED', '9. validUntil 过期 → BENEFIT_EXPIRED', () =>
      svc.redeem({ endUserId: userA, benefitGrantId: gExpired, serviceType: 'resume_optimize', serviceRefId: 'task-exp' }))

    // ── 10. 一产物一核销（task-1 已被 gQuota 核销，换 gQuota2 再核销同产物）──
    await expectReject('BENEFIT_OUTPUT_ALREADY_REDEEMED', '10. 同一产物换权益再核销 → BENEFIT_OUTPUT_ALREADY_REDEEMED', () =>
      svc.redeem({ endUserId: userA, benefitGrantId: gQuota2, serviceType: 'resume_optimize', serviceRefId: 'task-1' }))
    const gQuota2After = await prisma.benefitGrant.findUnique({ where: { id: gQuota2 } })
    if (gQuota2After?.quantityRemaining === 1) pass('10b. 被拒的核销未扣减其它权益额度（事务回滚）')
    else fail(`10b. gQuota2 额度被误扣：${gQuota2After?.quantityRemaining}`)

    // ── 11. 缺 serviceRefId 拒 ──
    await expectReject('REDEEM_SERVICE_REF_REQUIRED', '11. 空 serviceRefId → REDEEM_SERVICE_REF_REQUIRED', () =>
      svc.redeem({ endUserId: userA, benefitGrantId: gQuota2, serviceType: 'resume_optimize', serviceRefId: '  ' }))

    // ── 12. 无金额耦合 + 审计计数 ──
    const allRecords = await prisma.redemptionRecord.findMany({ where: { endUserId: userA } })
    const noMoney = allRecords.every((r) => r.orderId === null && r.amountCents === 0)
    const redeemAudits = await prisma.auditLog.count({ where: { action: 'benefit.redeem', targetId: gQuota } })
    // gQuota 真实扣减两次（task-1、task-2）；幂等回放与各类被拒不写审计 → 恰好 2 条。
    if (noMoney && allRecords.length === 2 && redeemAudits === 2) {
      pass('12. 全量核销记录 orderId=null/amountCents=0（券≠资金）；审计仅真实扣减写（2 条），回放/被拒不写')
    } else fail(`12. 无金额/审计异常：records=${allRecords.length} noMoney=${noMoney} audits=${redeemAudits}`)

    // ── 13. DB 层「一产物一核销」唯一约束（并发绕过的最终防线）──
    //     直插同一 (serviceType,serviceRefId)、不同 idempotencyKey → 应命中 @@unique 唯一冲突。
    const s13 = `task-db-inv-${s}`
    await prisma.redemptionRecord.create({ data: { endUserId: userA, kind: 'coupon', benefitRef: 'x', serviceType: 'resume_optimize', serviceRefId: s13, quantity: 1, amountCents: 0, idempotencyKey: `k13a-${s}` } })
    let dbGuardOk = false
    try {
      await prisma.redemptionRecord.create({ data: { endUserId: userA, kind: 'coupon', benefitRef: 'y', serviceType: 'resume_optimize', serviceRefId: s13, quantity: 1, amountCents: 0, idempotencyKey: `k13b-${s}` } })
    } catch (e) {
      dbGuardOk = (e as { code?: string }).code === 'P2002' || /unique/i.test((e as Error).message)
    }
    await prisma.redemptionRecord.deleteMany({ where: { serviceRefId: s13 } })
    if (dbGuardOk) pass('13. DB @@unique([serviceType,serviceRefId]) 拒绝同产物不同 key 二次核销（并发最终防线）')
    else fail('13. DB 唯一约束未生效：同产物不同 idempotencyKey 竟可二次插入')

    // ── 14. validFrom 未到生效 → BENEFIT_NOT_STARTED ──
    const gFuture = await mkGrant('future', { benefitType: 'coupon', quantityTotal: 1, quantityRemaining: 1, validFrom: new Date(Date.now() + 24 * 60 * 60 * 1000) })
    await expectReject('BENEFIT_NOT_STARTED', '14. validFrom 未到 → BENEFIT_NOT_STARTED', () =>
      svc.redeem({ endUserId: userA, benefitGrantId: gFuture, serviceType: 'resume_optimize', serviceRefId: 'task-future' }))

    // ── 15. replay 归属校验：B 用 A 已核销的 key（同 grantId+ref）回放 → 拒，不泄露他人核销 ──
    await expectReject('BENEFIT_GRANT_NOT_FOUND', '15. B 回放 A 已核销的 key → BENEFIT_GRANT_NOT_FOUND（归属校验覆盖 replay）', () =>
      svc.redeem({ endUserId: userB, benefitGrantId: gQuota, serviceType: 'resume_optimize', serviceRefId: 'task-1' }))

    // ── 16. 同 key 并发：额度恰扣 1、记录恰 1 条、无双扣（并发收敛/回放正确）──
    const gConc = await mkGrant('conc', { benefitType: 'free_quota', quantityTotal: 1, quantityRemaining: 1 })
    const concResults = await Promise.allSettled([
      svc.redeem({ endUserId: userA, benefitGrantId: gConc, serviceType: 'resume_optimize', serviceRefId: 'task-conc' }),
      svc.redeem({ endUserId: userA, benefitGrantId: gConc, serviceType: 'resume_optimize', serviceRefId: 'task-conc' }),
    ])
    const concFulfilled = concResults.filter((r) => r.status === 'fulfilled').length
    const gConcAfter = await prisma.benefitGrant.findUnique({ where: { id: gConc } })
    const concRecords = await prisma.redemptionRecord.count({ where: { serviceType: 'resume_optimize', serviceRefId: 'task-conc' } })
    if (gConcAfter?.quantityRemaining === 0 && gConcAfter.status === 'used_up' && concRecords === 1 && concFulfilled >= 1) {
      pass('16. 同 key 并发：额度恰扣 1、记录恰 1 条、无双扣')
    } else fail(`16. 并发异常：remaining=${gConcAfter?.quantityRemaining} status=${gConcAfter?.status} records=${concRecords} fulfilled=${concFulfilled}`)
  } finally {
    await cleanup()
    await prisma.onModuleDestroy()
    if (fallbackDbName) {
      for (const suffix of ['', '-journal', '-wal', '-shm']) {
        rmSync(`prisma/${fallbackDbName}${suffix}`, { force: true })
      }
    }
  }

  console.log('\nALL PASS')
}

async function initFallbackDb(): Promise<void> {
  const client = createClient({ url: process.env['DATABASE_URL']! })
  try {
    await client.batch([
      `CREATE TABLE "User" ("id" TEXT NOT NULL PRIMARY KEY, "username" TEXT NOT NULL, "passwordHash" TEXT NOT NULL, "name" TEXT NOT NULL, "role" TEXT NOT NULL, "orgId" TEXT, "enabled" BOOLEAN NOT NULL DEFAULT true, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE "EndUser" ("id" TEXT NOT NULL PRIMARY KEY, "phoneHash" TEXT NOT NULL, "phoneEnc" TEXT NOT NULL, "nickname" TEXT, "enabled" BOOLEAN NOT NULL DEFAULT true, "lastLoginAt" DATETIME, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE UNIQUE INDEX "EndUser_phoneHash_key" ON "EndUser"("phoneHash")`,
      `CREATE TABLE "AuditLog" ("id" TEXT NOT NULL PRIMARY KEY, "actorId" TEXT, "actorRole" TEXT NOT NULL, "action" TEXT NOT NULL, "targetType" TEXT NOT NULL, "targetId" TEXT, "payloadJson" TEXT NOT NULL DEFAULT '{}', "ipAddress" TEXT, "userAgent" TEXT, "requestId" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE "BenefitGrant" ("id" TEXT NOT NULL PRIMARY KEY, "endUserId" TEXT NOT NULL, "benefitType" TEXT NOT NULL, "title" TEXT NOT NULL, "description" TEXT, "quantityTotal" INTEGER, "quantityRemaining" INTEGER, "status" TEXT NOT NULL DEFAULT 'active', "sourceType" TEXT NOT NULL DEFAULT 'platform', "sourceRef" TEXT, "validFrom" DATETIME, "validUntil" DATETIME, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE INDEX "BenefitGrant_endUserId_idx" ON "BenefitGrant"("endUserId")`,
      `CREATE TABLE "RedemptionRecord" ("id" TEXT NOT NULL PRIMARY KEY, "endUserId" TEXT, "orderId" TEXT, "kind" TEXT NOT NULL, "benefitRef" TEXT NOT NULL, "serviceType" TEXT NOT NULL, "serviceRefId" TEXT NOT NULL, "quantity" INTEGER NOT NULL DEFAULT 1, "amountCents" INTEGER NOT NULL DEFAULT 0, "idempotencyKey" TEXT NOT NULL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE UNIQUE INDEX "RedemptionRecord_idempotencyKey_key" ON "RedemptionRecord"("idempotencyKey")`,
      `CREATE UNIQUE INDEX "RedemptionRecord_serviceType_serviceRefId_key" ON "RedemptionRecord"("serviceType","serviceRefId")`,
      `CREATE INDEX "RedemptionRecord_endUserId_idx" ON "RedemptionRecord"("endUserId")`,
      `CREATE INDEX "RedemptionRecord_benefitRef_idx" ON "RedemptionRecord"("benefitRef")`,
    ])
  } finally {
    client.close()
  }
}

main().catch((error: unknown) => {
  console.error('\nFatal error:', (error as Error).message)
  console.error((error as Error).stack)
  process.exit(1)
})
