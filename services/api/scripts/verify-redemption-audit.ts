/**
 * C5-4 订单核销守门（verify:redemption-audit）—— service 级，直调生产 service，不起 HTTP。
 *
 * 断言（对齐用户定版验证要求 + §8.1「禁两套并列账本」）：
 *  1. **按券面值抵扣（P0 资损防线）**：抵扣额 = min(面值, 上限, 订单应付)，**与订单金额脱钩**。
 *     部分抵扣不置 paid、不发取件码；面值未定义 / 范围不匹配一律 fail-closed 且不留副作用。
 *  2. 抵扣额只落一次：重复调用幂等回放，不二次扣额度、不二次改订单。
 *  3. 历史账本仍可回放；一单一核销（换权益再核销 → BENEFIT_OUTPUT_ALREADY_REDEEMED）语义不变。
 *  4. 订单态门：已支付单 → ORDER_NOT_REDEEMABLE；免费单（0 元）→ REDEEM_NOT_REQUIRED；非本人单 → ORDER_NOT_FOUND。
 *  5. voucher 入账口径：paymentSource='voucher' 只经核销路径写入；markPaid 拒 voucher（防御纵深）。
 *  6. 被拒核销不留残留：订单仍能按线下入账正常结算，权益额度不受影响。
 *
 * ⚠️ 本文件的断言演进史（不要再退回任何一版）：
 *  - v1「核销成功 → 整单免单、抵扣 = 订单金额」：**错**。把一个潜在资损钉成了期望行为。
 *    根因是能力缺失 —— BenefitGrant 只有次数额度，没有面值 / 上限 / 范围，抵扣额只能取
 *    order.amountCents，任意券命中未付单都整单免单。
 *  - v2「打印订单一律拒 REDEEM_PRINT_ORDER_UNSUPPORTED」：**止血闸**，不是正确行为。
 *  - v3（当前）：三列补齐后按面值计算。1/2/3/6 节改回**正确的**核销断言 ——
 *    既不断言整单免单，也不断言一律拒绝，而是断言「抵多少 = 券值多少」。
 *  核心不变量：**任何一节都不允许出现「抵扣额 == 订单金额」这种与券面值无关的断言**，
 *  除非该券的面值本来就 >= 订单金额（4a/1e 用例即为此设计）。
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
  /**
   * 建权益。`valuation` 缺省时**不带面值**（amountCents=null）——刻意与存量权益一致，
   * 用于验证 fail-closed；需要可抵扣的券必须显式传面值。
   */
  async function makeGrant(
    qty: number,
    valuation: { amountCents?: number; maxDiscountCents?: number; serviceScope?: string } = {},
  ): Promise<string> {
    seq += 1
    const g = await prisma.benefitGrant.create({
      data: {
        id: `bg_redeem_${suffix}_${seq}`, endUserId, benefitType: 'free_quota', title: '免费打印次数',
        quantityTotal: qty, quantityRemaining: qty, status: 'active',
        amountCents: valuation.amountCents ?? null,
        maxDiscountCents: valuation.maxDiscountCents ?? null,
        serviceScope: valuation.serviceScope ?? null,
      },
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

    // ── (1) 核心资损防线：抵扣额 = 券面值，与订单金额脱钩 ─────────────────────
    // 只要本节变红，就说明抵扣额又回到了「按订单金额算」——即整单免单的老路。
    // 用例刻意让面值(30) ≠ 订单应付(100)：若实现退回 discountCents = order.amountCents，
    // 1b/1c 立刻变红，而不是悄悄多免 70 分。
    const o1 = await makeOrder(100)
    const g1 = await makeGrant(3, { amountCents: 30, serviceScope: 'print' })
    const r1 = await redemption.redeemForOrder({ endUserId, orderId: o1, benefitGrantId: g1 })
    assert(r1.discountCents === 30, `1a. 抵扣额 = 券面值 30（实际 ${r1.discountCents}），不是订单金额 100`)
    assert(r1.payStatus === 'unpaid' && r1.netPayableCents === 70,
      `1b. 部分抵扣后订单仍 unpaid，净应付 70（实际 ${r1.payStatus}/${r1.netPayableCents}）`)
    const order1 = await prisma.order.findUnique({ where: { id: o1 } })
    assert(order1?.discountCents === 30 && order1.amountCents === 100,
      '1c. 落库抵扣额 30、应付原价 100 不被改写')
    assert(order1?.payStatus === 'unpaid' && order1.paymentSource === null && order1.payChannel === null,
      '1d. 部分抵扣不写 voucher 入账（钱还没收齐）')
    assert(!order1?.pickupCode && !order1?.paidAt,
      '1e. 部分抵扣不发取件码 / 不写支付时间（未付款不得放货）')
    assert((await prisma.benefitGrant.findUnique({ where: { id: g1 } }))?.quantityRemaining === 2,
      '1f. 核销扣一次权益额度（3 → 2）')
    const rec1 = await prisma.redemptionRecord.findFirst({ where: { orderId: o1 } })
    assert(rec1?.amountCents === 30, `1g. 账本记实际抵扣额 30（实际 ${rec1?.amountCents}）`)
    assert(!!(await prisma.auditLog.findFirst({ where: { action: 'benefit.redeem', targetId: g1 } })),
      '1h. 真实核销写 benefit.redeem 审计')

    // 面值 >= 应付 → 全额抵扣：订单结清、发取件码、净应付 0。
    const oFull = await makeOrder(50)
    const gFull = await makeGrant(1, { amountCents: 80, serviceScope: 'print' })
    const rFull = await redemption.redeemForOrder({ endUserId, orderId: oFull, benefitGrantId: gFull })
    assert(rFull.discountCents === 50 && rFull.netPayableCents === 0,
      `1i. 面值 80 > 应付 50 → 抵扣按应付封顶为 50、净应付 0（实际 ${rFull.discountCents}/${rFull.netPayableCents}）`)
    const orderFull = await prisma.order.findUnique({ where: { id: oFull } })
    assert(orderFull?.payStatus === 'paid' && orderFull.paymentSource === 'voucher' && !!orderFull.pickupCode,
      '1j. 全额抵扣 → paid(voucher) 且发取件码')

    // 抵扣上限压过面值：min(面值, 上限, 应付) 三重取小。
    const oCap = await makeOrder(100)
    const gCap = await makeGrant(1, { amountCents: 60, maxDiscountCents: 25, serviceScope: 'print' })
    const rCap = await redemption.redeemForOrder({ endUserId, orderId: oCap, benefitGrantId: gCap })
    assert(rCap.discountCents === 25, `1k. 上限 25 < 面值 60 → 抵扣 25（实际 ${rCap.discountCents}）`)

    // fail-closed ①：未定义面值（**所有存量权益的状态**）→ 拒，且不留任何副作用。
    const oNoFace = await makeOrder(100)
    const gNoFace = await makeGrant(3)
    await expectCode('1l. 未定义面值的权益 → BENEFIT_NOT_VALUED', 'BENEFIT_NOT_VALUED',
      () => redemption.redeemForOrder({ endUserId, orderId: oNoFace, benefitGrantId: gNoFace }))
    const orderNoFace = await prisma.order.findUnique({ where: { id: oNoFace } })
    assert(orderNoFace?.payStatus === 'unpaid' && orderNoFace.discountCents === 0 && !orderNoFace.pickupCode,
      '1m. 被拒后订单零副作用（仍 unpaid / 无抵扣额 / 无取件码）')
    assert((await prisma.redemptionRecord.count({ where: { orderId: oNoFace } })) === 0,
      '1n. 被拒后不落 RedemptionRecord')
    assert((await prisma.benefitGrant.findUnique({ where: { id: gNoFace } }))?.quantityRemaining === 3,
      '1o. 被拒后不扣权益额度（仍 3）')
    assert(!(await prisma.auditLog.findFirst({ where: { action: 'benefit.redeem', targetId: gNoFace } })),
      '1p. 被拒后不写 benefit.redeem 审计')

    // fail-closed ②：适用范围不含本订单类型（订单恒为 type='print'）→ 拒，零副作用。
    const oScope = await makeOrder(100)
    const gScope = await makeGrant(2, { amountCents: 50, serviceScope: 'resume_service' })
    await expectCode('1q. 适用范围不匹配 → BENEFIT_SCOPE_MISMATCH', 'BENEFIT_SCOPE_MISMATCH',
      () => redemption.redeemForOrder({ endUserId, orderId: oScope, benefitGrantId: gScope }))
    const orderScope = await prisma.order.findUnique({ where: { id: oScope } })
    assert(orderScope?.payStatus === 'unpaid' && orderScope.discountCents === 0,
      '1r. 范围不匹配被拒后订单零副作用')
    assert((await prisma.benefitGrant.findUnique({ where: { id: gScope } }))?.quantityRemaining === 2,
      '1s. 范围不匹配被拒后不扣额度（仍 2）')

    // ── (2) 幂等：重复核销不二次扣额度、不二次改订单 ──────────────────────────
    const r2 = await redemption.redeemForOrder({ endUserId, orderId: o1, benefitGrantId: g1 })
    assert(r2.idempotent === true, '2a. 同订单同权益重复调用 → 幂等回放')
    assert(r2.discountCents === 30 && r2.netPayableCents === 70, '2b. 回放返回同一抵扣额 30 / 净应付 70')
    assert((await prisma.redemptionRecord.count({ where: { orderId: o1 } })) === 1, '2c. 账本仍只有 1 条')
    assert((await prisma.benefitGrant.findUnique({ where: { id: g1 } }))?.quantityRemaining === 2,
      '2d. 回放不二次扣额度（仍 2）')
    const order1After = await prisma.order.findUnique({ where: { id: o1 } })
    assert(order1After?.discountCents === 30, '2e. 回放不叠加抵扣额（仍 30，未被抵成 60）')

    // ── (3) 历史账本回放 + 一单一核销语义不变 ──────────────────────────────
    // 账本判定位于计价之前，所以库里已存在的 order_redeem 记录按幂等回放，
    // **不会**因为该权益如今没有面值而变成 BENEFIT_NOT_VALUED —— 历史核销结果不可被新规则推翻。
    // （本仓当前无该类生产数据，此处直接播种模拟历史记录。）
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
    assert(replay.discountCents === 100, '3b. 回放返回历史账本记录的抵扣额 100，不按当前面值重算')
    assert((await prisma.benefitGrant.findUnique({ where: { id: gLegacy } }))?.quantityRemaining === 3, '3c. 回放不扣额度（仍 3）')
    // 一单一核销：换一张**有面值、范围也匹配**的券再核销，仍必须被账本唯一性挡住 ——
    // 若用没面值的券，可能是被计价 fail-closed 拒的，就验不到一单一核销这条语义。
    const g2 = await makeGrant(3, { amountCents: 20, serviceScope: 'print' })
    await expectCode('3d. 同订单换权益再核销 → BENEFIT_OUTPUT_ALREADY_REDEEMED', 'BENEFIT_OUTPUT_ALREADY_REDEEMED',
      () => redemption.redeemForOrder({ endUserId, orderId: oLegacy, benefitGrantId: g2 }))
    assert((await prisma.benefitGrant.findUnique({ where: { id: g2 } }))?.quantityRemaining === 3, '3e. 被拒核销不扣第二个权益（仍 3）')
    const legacyOrder = await prisma.order.findUnique({ where: { id: oLegacy } })
    assert(legacyOrder?.discountCents === 0, '3f. 被拒的第二次核销不写抵扣额到订单')

    // ── (4) 订单态门 ──────────────────────────────────────────────────────
    // 本节的券**一律给足面值且范围匹配**：这样报出的错误码只可能来自订单态门，
    // 证明订单态校验优先于计价（否则会先撞 BENEFIT_NOT_VALUED，验不到本节要守的语义）。
    const valued = { amountCents: 500, serviceScope: 'print' }
    // 已支付单不可核销。
    const oPaid = await makeOrder(80)
    await orderStatus.markPaid(oPaid, { paymentSource: 'offline', operatorId: 'verify' })
    const g4a = await makeGrant(1, valued)
    await expectCode('4a. 已支付单核销 → ORDER_NOT_REDEEMABLE', 'ORDER_NOT_REDEEMABLE',
      () => redemption.redeemForOrder({ endUserId, orderId: oPaid, benefitGrantId: g4a }))
    // 免费单（0 元）无需核销。
    const oFree = await makeOrder(0)
    const g4b = await makeGrant(1, valued)
    await expectCode('4b. 免费单核销 → REDEEM_NOT_REQUIRED', 'REDEEM_NOT_REQUIRED',
      () => redemption.redeemForOrder({ endUserId, orderId: oFree, benefitGrantId: g4b }))
    // 非本人单不可核销。
    const oOther = await makeOrder(60, otherUserId)
    const g4c = await makeGrant(1, valued)
    await expectCode('4c. 非本人订单核销 → ORDER_NOT_FOUND', 'ORDER_NOT_FOUND',
      () => redemption.redeemForOrder({ endUserId, orderId: oOther, benefitGrantId: g4c }))
    // 匿名订单没有可证明的本人归属，会员权益不得借订单 ID 结算它。
    const oAnonymous = await makeOrder(60, null)
    const g4d = await makeGrant(1, valued)
    await expectCode('4d. 匿名订单核销 → ORDER_NOT_FOUND', 'ORDER_NOT_FOUND',
      () => redemption.redeemForOrder({ endUserId, orderId: oAnonymous, benefitGrantId: g4d }))
    // 被拒后一律不扣额度（四个都是零副作用拒绝）。
    for (const [label, id] of [['4a', g4a], ['4b', g4b], ['4c', g4c], ['4d', g4d]] as const) {
      assert((await prisma.benefitGrant.findUnique({ where: { id } }))?.quantityRemaining === 1,
        `4e-${label}. 订单态门拒绝后不扣权益额度（仍 1）`)
    }

    // ── (5) voucher 入账防御纵深：markPaid 拒 voucher ──────────────────────
    const oGuard = await makeOrder(50)
    await expectCode('5. markPaid 拒 voucher（voucher 只经 markPaidByRedemption 写入）', 'PAYMENT_SOURCE_INVALID',
      () => orderStatus.markPaid(oGuard, { paymentSource: 'voucher' as unknown as 'offline' }))

    // ── (6) 被拒核销不留残留；部分抵扣后余额仍可按正常通道结算 ────────────────
    // 前半段：计价 fail-closed 拒绝后，订单必须完全干净，仍可走线下入账。
    const oSettlementRace = await makeOrder(100)
    const gSettlementRace = await makeGrant(1)
    await expectCode('6a. 未定义面值的核销被拒（fail-closed）', 'BENEFIT_NOT_VALUED',
      () => redemption.redeemForOrder({ endUserId, orderId: oSettlementRace, benefitGrantId: gSettlementRace }))
    await orderStatus.markPaid(oSettlementRace, { paymentSource: 'offline', operatorId: 'verify' })
    const racedOrder = await prisma.order.findUnique({ where: { id: oSettlementRace } })
    assert(racedOrder?.payStatus === 'paid' && racedOrder.paymentSource === 'offline' && racedOrder.discountCents === 0,
      '6b. 核销被拒后订单仍按线下入账结算（paid/offline，无抵扣额）')
    assert((await prisma.redemptionRecord.count({ where: { orderId: oSettlementRace } })) === 0,
      '6c. 被拒核销不留 order_redeem 账本')
    assert((await prisma.benefitGrant.findUnique({ where: { id: gSettlementRace } }))?.quantityRemaining === 1,
      '6d. 被拒核销不扣权益额度（仍 1）')

    // 后半段：部分抵扣是「先抵一部分，余额照付」，必须真的能把余额收掉 ——
    // 否则等于用户白扣一次权益、订单永远结不了账。
    const oPartialThenPay = await makeOrder(100)
    const gPartialThenPay = await makeGrant(1, { amountCents: 40, serviceScope: 'print' })
    const rPartial = await redemption.redeemForOrder({ endUserId, orderId: oPartialThenPay, benefitGrantId: gPartialThenPay })
    assert(rPartial.discountCents === 40 && rPartial.netPayableCents === 60,
      `6e. 部分抵扣 40、净应付 60（实际 ${rPartial.discountCents}/${rPartial.netPayableCents}）`)
    await orderStatus.markPaid(oPartialThenPay, { paymentSource: 'offline', operatorId: 'verify' })
    const settledPartial = await prisma.order.findUnique({ where: { id: oPartialThenPay } })
    assert(settledPartial?.payStatus === 'paid' && settledPartial.paymentSource === 'offline',
      '6f. 部分抵扣后余额可正常入账（paid/offline）')
    assert(settledPartial?.discountCents === 40 && settledPartial.amountCents === 100,
      '6g. 入账后抵扣额 40 与应付原价 100 均保持不变（实收 60 由净应付口径推导）')
    assert((await prisma.benefitGrant.findUnique({ where: { id: gPartialThenPay } }))?.quantityRemaining === 0,
      '6h. 部分抵扣同样扣一次权益额度（1 → 0）')

    console.log(`\n  ✅ verify:redemption-audit 全部通过（${passed} checks）`)
  } finally {
    await cleanup()
    await prisma.onModuleDestroy?.()
  }
}

main().catch((e) => { console.error('  FAIL 未捕获异常:', e); process.exit(1) })
