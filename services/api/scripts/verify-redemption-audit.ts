/**
 * C5-4 订单核销守门（verify:redemption-audit）—— service 级，直调生产 service，不起 HTTP。
 *
 * 断言（对齐用户定版验证要求 + §8.1「禁两套并列账本」）：
 *  1. **打印订单止血闸（P0 资损防线）**：redeemForOrder 对 type='print' 一律拒
 *     REDEEM_PRINT_ORDER_UNSUPPORTED，且不留任何副作用（订单仍 unpaid、无抵扣额、无取件码、
 *     不落 RedemptionRecord、不扣 BenefitGrant、不写 benefit.redeem 审计）。
 *  2. 止血闸稳定：重复调用仍拒，不会「第二次就放过去」。
 *  3. 历史账本仍可回放；一单一核销（换权益再核销 → BENEFIT_OUTPUT_ALREADY_REDEEMED）语义不变。
 *  4. 订单态门：已支付单 → ORDER_NOT_REDEEMABLE；免费单（0 元）→ REDEEM_NOT_REQUIRED；非本人单 → ORDER_NOT_FOUND。
 *  5. voucher 入账口径：paymentSource='voucher' 只经 markPaidByRedemption 写入；markPaid 拒 voucher（防御纵深）。
 *  6. 止血闸下：核销被拒后订单仍能按线下入账正常结算，权益额度不受影响。
 *
 * ⚠️ 为什么 1/2/3/6 节的旧断言是错的：它们此前断言「核销成功 → 整单免单、抵扣 100」，
 * 把一个**潜在资损**钉成了期望行为。根因是**能力缺失**——BenefitGrant 只有 quantityTotal /
 * quantityRemaining，**没有面值 / 抵扣上限 / 适用服务范围**字段，抵扣额只能取 order.amountCents，
 * 于是任意 coupon / free_quota / package_entitlement 命中未付打印订单都会整单免单。
 * 补齐面值 / 上限 / 范围后，应连同止血闸一并改回「按券面值抵扣」的正确断言，而不是删掉断言。
 *
 * 运行：pnpm --filter @ai-job-print/api verify:redemption-audit
 */
import 'dotenv/config'
import { createHash, randomUUID } from 'crypto'

import { PrismaService } from '../src/prisma/prisma.service'
import { AuditService } from '../src/audit/audit.service'
import { OrderStatusService } from '../src/payment/order-status.service'
import { BenefitRedemptionService } from '../src/benefit-redemption/benefit-redemption.service'

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

    // ── (1) 打印订单止血闸：一律拒绝，且不留任何副作用 ───────────────────────
    // 这一节是整个 PR 的核心资损防线：只要它变绿，就证明「券命中未付打印订单 → 整单免单」
    // 这条路径已被关死；只要它变红，就说明止血闸被绕过或被删。
    const o1 = await makeOrder(100)
    const g1 = await makeGrant(3)
    await expectCode('1a. 打印订单核销 → REDEEM_PRINT_ORDER_UNSUPPORTED（止血闸）', 'REDEEM_PRINT_ORDER_UNSUPPORTED',
      () => redemption.redeemForOrder({ endUserId, orderId: o1, benefitGrantId: g1 }))
    const order1 = await prisma.order.findUnique({ where: { id: o1 } })
    assert(order1?.payStatus === 'unpaid' && order1.paymentSource === null && order1.payChannel === null,
      '1b. 被拒后订单仍 unpaid，未写 voucher 入账')
    assert(order1?.discountCents === 0 && !order1.pickupCode && !order1.paidAt,
      '1c. 被拒后无抵扣额 / 无取件码 / 无支付时间（应付未被打到 0）')
    assert((await prisma.redemptionRecord.count({ where: { orderId: o1 } })) === 0,
      '1d. 被拒后不落 RedemptionRecord')
    assert((await prisma.benefitGrant.findUnique({ where: { id: g1 } }))?.quantityRemaining === 3,
      '1e. 被拒后不扣权益额度（仍 3）')
    assert(!(await prisma.auditLog.findFirst({ where: { action: 'benefit.redeem', targetId: g1 } })),
      '1f. 被拒后不写 benefit.redeem 审计')

    // ── (2) 止血闸稳定：重复调用仍拒，不会「第二次就放过去」 ──────────────────
    await expectCode('2a. 重复调用仍拒 → REDEEM_PRINT_ORDER_UNSUPPORTED', 'REDEEM_PRINT_ORDER_UNSUPPORTED',
      () => redemption.redeemForOrder({ endUserId, orderId: o1, benefitGrantId: g1 }))
    assert((await prisma.redemptionRecord.count({ where: { orderId: o1 } })) === 0, '2b. 重复调用后账本仍 0 条')
    assert((await prisma.benefitGrant.findUnique({ where: { id: g1 } }))?.quantityRemaining === 3, '2c. 重复调用后仍不扣额度（仍 3）')

    // ── (3) 历史账本回放 + 一单一核销语义不变 ──────────────────────────────
    // 止血闸位于「已有核销记录」判定**之后**，所以库里已存在的 order_redeem 记录仍按幂等回放，
    // 不会因为止血闸而变成报错（本仓当前无该类生产数据，此处直接播种模拟历史记录）。
    const oLegacy = await makeOrder(100)
    const gLegacy = await makeGrant(3)
    await prisma.redemptionRecord.create({
      data: {
        endUserId, orderId: oLegacy, kind: 'free_quota', benefitRef: gLegacy,
        serviceType: 'order_redeem', serviceRefId: oLegacy, quantity: 1, amountCents: 100,
        idempotencyKey: createHash('sha256').update(`${gLegacy}:order_redeem:${oLegacy}`).digest('hex'),
      },
    })
    const replay = await redemption.redeemForOrder({ endUserId, orderId: oLegacy, benefitGrantId: gLegacy })
    assert(replay.idempotent === true, '3a. 历史 order_redeem 记录 → 幂等回放（不二次扣）')
    assert((await prisma.benefitGrant.findUnique({ where: { id: gLegacy } }))?.quantityRemaining === 3, '3b. 回放不扣额度（仍 3）')
    const g2 = await makeGrant(3)
    await expectCode('3c. 同订单换权益再核销 → BENEFIT_OUTPUT_ALREADY_REDEEMED', 'BENEFIT_OUTPUT_ALREADY_REDEEMED',
      () => redemption.redeemForOrder({ endUserId, orderId: oLegacy, benefitGrantId: g2 }))
    assert((await prisma.benefitGrant.findUnique({ where: { id: g2 } }))?.quantityRemaining === 3, '3d. 被拒核销不扣第二个权益（仍 3）')

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

    // ── (6) 止血闸下：核销被拒不妨碍订单按正常通道结算 ──────────────────────
    // 为什么改写：原用例用 audit.write 钩子在 'benefit.redeem' 处卡住核销事务，再让线下入账去撞它。
    // 止血闸下打印订单**永远不会写 benefit.redeem 审计**，该钩子永不触发，
    // `await benefitAuditEntered` 会永久挂起——原用例在新语义下不是变红，而是**挂死**。
    // 因此改为断言真正要守的性质：核销被拒后不留残留，订单仍可按线下入账正常结算。
    const oSettlementRace = await makeOrder(100)
    const gSettlementRace = await makeGrant(1)
    await expectCode('6a. 核销被止血闸拒绝', 'REDEEM_PRINT_ORDER_UNSUPPORTED',
      () => redemption.redeemForOrder({ endUserId, orderId: oSettlementRace, benefitGrantId: gSettlementRace }))
    await orderStatus.markPaid(oSettlementRace, { paymentSource: 'offline', operatorId: 'verify' })
    const racedOrder = await prisma.order.findUnique({ where: { id: oSettlementRace } })
    assert(racedOrder?.payStatus === 'paid' && racedOrder.paymentSource === 'offline' && racedOrder.discountCents === 0,
      '6b. 核销被拒后订单仍按线下入账结算（paid/offline，无抵扣额）')
    assert((await prisma.redemptionRecord.count({ where: { orderId: oSettlementRace } })) === 0,
      '6c. 被拒核销不留 order_redeem 账本')
    assert((await prisma.benefitGrant.findUnique({ where: { id: gSettlementRace } }))?.quantityRemaining === 1,
      '6d. 被拒核销不扣权益额度（仍 1）')

    console.log(`\n  ✅ verify:redemption-audit 全部通过（${passed} checks）`)
  } finally {
    await cleanup()
    await prisma.onModuleDestroy?.()
  }
}

main().catch((e) => { console.error('  FAIL 未捕获异常:', e); process.exit(1) })
