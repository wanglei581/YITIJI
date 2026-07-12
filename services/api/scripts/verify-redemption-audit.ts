/**
 * C5-4 订单核销守门（verify:redemption-audit）—— service 级，直调生产 service，不起 HTTP。
 *
 * 断言（对齐用户定版验证要求 + §8.1「禁两套并列账本」）：
 *  1. order-linked 核销：redeemForOrder → 落既有 RedemptionRecord（orderId 回填 / amountCents 抵扣额 /
 *     serviceType='order_redeem' / serviceRefId=orderId），扣 BenefitGrant.quantityRemaining，写审计 benefit.redeem
 *     （payload 带 orderId + amountCents）；Order 全额核销联动 paid(voucher) + pickupCode。
 *  2. 幂等：同订单同权益重复核销 → 回放（不二次扣、RedemptionRecord 仍 1 条、订单不变）。
 *  3. **一单一核销**：同一订单换**其它权益**再核销 → BENEFIT_OUTPUT_ALREADY_REDEEMED（`@@unique([serviceType,serviceRefId])`）。
 *  4. 订单态门：已支付单 → ORDER_NOT_REDEEMABLE；免费单（0 元）→ REDEEM_NOT_REQUIRED；非本人单 → ORDER_NOT_FOUND。
 *  5. voucher 入账口径：paymentSource='voucher' 只经 markPaidByRedemption 写入；markPaid 拒 voucher（防御纵深）。
 *
 * 运行：pnpm --filter @ai-job-print/api verify:redemption-audit
 */
import 'dotenv/config'
import { randomUUID } from 'crypto'

import { PrismaService } from '../src/prisma/prisma.service'
import { AuditService } from '../src/audit/audit.service'
import { OrderStatusService } from '../src/payment/order-status.service'
import { BenefitRedemptionService } from '../src/benefit-redemption/benefit-redemption.service'
import { pickupCodeVisibleFor } from '../src/payment/order-status.service'

let passed = 0
const pass = (m: string): void => { passed += 1; console.log(`  PASS ${m}`) }
const fail = (m: string): never => { console.error(`  FAIL ${m}`); process.exit(1) }
const assert = (c: unknown, m: string): void => { c ? pass(m) : fail(m) }
/** 错误码可能在 message（字符串异常）或 response body error.code（对象异常）。 */
function errCode(e: unknown): string {
  const ex = e as { getResponse?: () => unknown; message?: string }
  const resp = typeof ex.getResponse === 'function' ? ex.getResponse() : undefined
  const bodyCode = (resp as { error?: { code?: string } } | undefined)?.error?.code
  return bodyCode ?? ex.message ?? String(e)
}
async function expectCode(label: string, code: string, fn: () => Promise<unknown>): Promise<void> {
  try { await fn() } catch (e) {
    const c = errCode(e)
    if (c === code || c.includes(code)) return pass(label)
    return fail(`${label} — 期望 ${code}，实际: ${c}`)
  }
  fail(`${label} — 期望 ${code}，但未抛`)
}

async function main(): Promise<void> {
  console.log('\n=== C5-4 订单核销 verification ===')
  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const audit = new AuditService(prisma)
  const orderStatus = new OrderStatusService(prisma, audit)
  const redemption = new BenefitRedemptionService(prisma, audit, orderStatus)

  const suffix = randomUUID().replace(/-/g, '').slice(0, 12)
  const endUserId = `eu_redeem_${suffix}`
  const otherUserId = `eu_other_${suffix}`
  const orderIds: string[] = []
  const grantIds: string[] = []
  let seq = 0

  async function makeOrder(amountCents: number, owner: string | null = endUserId): Promise<string> {
    seq += 1
    const o = await prisma.order.create({
      data: { orderNo: `ORD-REDEEM-${suffix}-${seq}`, type: 'print', amountCents, payStatus: amountCents === 0 ? 'unpaid' : 'unpaid', taskStatus: 'pending', endUserId: owner },
    })
    orderIds.push(o.id)
    return o.id
  }
  async function makeGrant(qty: number): Promise<string> {
    seq += 1
    const g = await prisma.benefitGrant.create({
      data: { id: `bg_redeem_${suffix}_${seq}`, endUserId, benefitType: 'free_quota', title: '免费打印次数', quantityTotal: qty, quantityRemaining: qty, status: 'active' },
    })
    grantIds.push(g.id)
    return g.id
  }

  async function cleanup(): Promise<void> {
    await prisma.auditLog.deleteMany({ where: { targetId: { in: [...orderIds, ...grantIds] } } })
    await prisma.redemptionRecord.deleteMany({ where: { OR: [{ orderId: { in: orderIds } }, { endUserId: { in: [endUserId, otherUserId] } }] } })
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } })
    await prisma.benefitGrant.deleteMany({ where: { OR: [{ id: { in: grantIds } }, { endUserId }] } })
    await prisma.endUser.deleteMany({ where: { id: { in: [endUserId, otherUserId] } } })
  }

  try {
    await cleanup()
    await prisma.endUser.create({ data: { id: endUserId, phoneHash: `hash_${suffix}`, phoneEnc: `enc_${suffix}` } })
    await prisma.endUser.create({ data: { id: otherUserId, phoneHash: `hash2_${suffix}`, phoneEnc: `enc2_${suffix}` } })
    pass('测试夹具已创建')

    // ── (1) order-linked 核销 + 免费单联动 + 审计 ───────────────────────────
    const o1 = await makeOrder(100)
    const g1 = await makeGrant(3)
    const res = await redemption.redeemForOrder({ endUserId, orderId: o1, benefitGrantId: g1 })
    assert(res.payStatus === 'paid' && res.discountCents === 100 && !res.idempotent, '1a. redeemForOrder → 全额核销 paid，抵扣 100')
    const order1 = await prisma.order.findUnique({ where: { id: o1 } })
    assert(order1?.paymentSource === 'voucher' && order1.payChannel === 'voucher' && order1.discountCents === 100, '1b. Order 置 paid(voucher) + discountCents=100')
    assert(!!order1?.pickupCode && pickupCodeVisibleFor({ payStatus: order1.payStatus, taskStatus: order1.taskStatus, refundedAt: order1.refundedAt }), '1c. 核销单生成 pickupCode 且 paid 可见')
    const rec = await prisma.redemptionRecord.findFirst({ where: { orderId: o1 } })
    assert(rec?.serviceType === 'order_redeem' && rec.serviceRefId === o1 && rec.orderId === o1 && rec.amountCents === 100, '1d. RedemptionRecord order-linked（serviceType/serviceRefId/orderId/amountCents 回填）')
    const grantAfter = await prisma.benefitGrant.findUnique({ where: { id: g1 } })
    assert(grantAfter?.quantityRemaining === 2, '1e. BenefitGrant.quantityRemaining 扣减（3→2）')
    const redeemAudit = await prisma.auditLog.findFirst({ where: { action: 'benefit.redeem', targetId: g1 }, orderBy: { createdAt: 'desc' } })
    const ap = JSON.parse(redeemAudit?.payloadJson ?? '{}')
    assert(ap.orderId === o1 && ap.amountCents === 100, '1f. 审计 benefit.redeem 带 orderId + 抵扣额')

    // ── (2) 幂等：同订单同权益重复核销 → 回放 ───────────────────────────────
    const again = await redemption.redeemForOrder({ endUserId, orderId: o1, benefitGrantId: g1 })
    assert(again.idempotent === true, '2a. 同订单同权益重复核销 → 幂等回放')
    assert((await prisma.redemptionRecord.count({ where: { orderId: o1 } })) === 1, '2b. 幂等：RedemptionRecord 仍 1 条')
    assert((await prisma.benefitGrant.findUnique({ where: { id: g1 } }))?.quantityRemaining === 2, '2c. 幂等：不二次扣减（仍 2）')

    // ── (3) 一单一核销：同订单换其它权益再核销被拒 ──────────────────────────
    const g2 = await makeGrant(3)
    await expectCode('3. 同订单换权益再核销 → BENEFIT_OUTPUT_ALREADY_REDEEMED', 'BENEFIT_OUTPUT_ALREADY_REDEEMED',
      () => redemption.redeemForOrder({ endUserId, orderId: o1, benefitGrantId: g2 }))
    assert((await prisma.benefitGrant.findUnique({ where: { id: g2 } }))?.quantityRemaining === 3, '3b. 被拒核销不扣第二个权益（仍 3）')

    // ── (4) 订单态门 ──────────────────────────────────────────────────────
    // 已支付单不可核销。
    const oPaid = await makeOrder(80)
    await orderStatus.markPaid(oPaid, { paymentSource: 'offline', operatorId: 'verify' })
    const g4a = await makeGrant(1)
    await expectCode('4a. 已支付单核销 → ORDER_NOT_REDEEMABLE', 'ORDER_NOT_REDEEMABLE',
      () => redemption.redeemForOrder({ endUserId, orderId: oPaid, benefitGrantId: g4a }))
    // 免费单（0 元）无需核销。
    const oFree = await makeOrder(0)
    const g4b = await makeGrant(1)
    await expectCode('4b. 免费单核销 → REDEEM_NOT_REQUIRED', 'REDEEM_NOT_REQUIRED',
      () => redemption.redeemForOrder({ endUserId, orderId: oFree, benefitGrantId: g4b }))
    // 非本人单不可核销。
    const oOther = await makeOrder(60, otherUserId)
    const g4c = await makeGrant(1)
    await expectCode('4c. 非本人订单核销 → ORDER_NOT_FOUND', 'ORDER_NOT_FOUND',
      () => redemption.redeemForOrder({ endUserId, orderId: oOther, benefitGrantId: g4c }))
    // 匿名订单没有可证明的本人归属，会员权益不得借订单 ID 结算它。
    const oAnonymous = await makeOrder(60, null)
    const g4d = await makeGrant(1)
    await expectCode('4d. 匿名订单核销 → ORDER_NOT_FOUND', 'ORDER_NOT_FOUND',
      () => redemption.redeemForOrder({ endUserId, orderId: oAnonymous, benefitGrantId: g4d }))

    // ── (5) voucher 入账防御纵深：markPaid 拒 voucher ──────────────────────
    const oGuard = await makeOrder(50)
    await expectCode('5. markPaid 拒 voucher（voucher 只经 markPaidByRedemption 写入）', 'PAYMENT_SOURCE_INVALID',
      () => orderStatus.markPaid(oGuard, { paymentSource: 'voucher' as unknown as 'offline' }))

    // ── (6) 并发结算：核销提交后不得再被普通线下入账拆开 ────────────────────
    const oSettlementRace = await makeOrder(100)
    const gSettlementRace = await makeGrant(1)
    let resumeBenefitAudit: (() => void) | undefined
    let enteredBenefitAudit: (() => void) | undefined
    const benefitAuditEntered = new Promise<void>((resolve) => { enteredBenefitAudit = resolve })
    const resumeGate = new Promise<void>((resolve) => { resumeBenefitAudit = resolve })
    const originalAuditWrite = audit.write.bind(audit)
    audit.write = async (args) => {
      if (args.action === 'benefit.redeem') {
        enteredBenefitAudit?.()
        await resumeGate
      }
      return originalAuditWrite(args)
    }

    const concurrentRedemption = redemption.redeemForOrder({
      endUserId,
      orderId: oSettlementRace,
      benefitGrantId: gSettlementRace,
    })
    try {
      await benefitAuditEntered
      let offlineError: unknown
      try {
        await orderStatus.markPaid(oSettlementRace, { paymentSource: 'offline', operatorId: 'verify' })
      } catch (error) {
        offlineError = error
      }
      resumeBenefitAudit?.()

      let redemptionError: unknown
      try {
        await concurrentRedemption
      } catch (error) {
        redemptionError = error
      }

      const racedOrder = await prisma.order.findUnique({ where: { id: oSettlementRace } })
      const racedRecordCount = await prisma.redemptionRecord.count({ where: { orderId: oSettlementRace } })
      const racedGrant = await prisma.benefitGrant.findUnique({ where: { id: gSettlementRace } })
      const consistent = racedOrder?.paymentSource === 'voucher' && racedRecordCount === 1 && racedGrant?.quantityRemaining === 0
      if (consistent && offlineError && errCode(offlineError).includes('ORDER_ALREADY_PAID') && !redemptionError) {
        pass('6. 核销先提交时线下结算明确冲突，订单、权益与核销账本保持同一结算来源')
      } else {
        throw new Error(
          `并发结算不一致：paymentSource=${racedOrder?.paymentSource ?? 'null'}，` +
          `records=${racedRecordCount}，quantityRemaining=${racedGrant?.quantityRemaining ?? 'null'}，` +
          `offline=${offlineError ? errCode(offlineError) : 'resolved'}，` +
          `redeem=${redemptionError ? errCode(redemptionError) : 'resolved'}`,
        )
      }
    } finally {
      resumeBenefitAudit?.()
      audit.write = originalAuditWrite
      await concurrentRedemption.catch(() => undefined)
    }

    console.log(`\n  ✅ verify:redemption-audit 全部通过（${passed} checks）`)
  } finally {
    await cleanup()
    await prisma.onModuleDestroy?.()
  }
}

main().catch((e) => { console.error('  FAIL 未捕获异常:', e); process.exit(1) })
