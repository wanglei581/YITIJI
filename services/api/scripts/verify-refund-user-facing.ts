/**
 * A3-S3 会员自助退款门禁（verify:refund-user-facing）—— service 级，直调生产 service，不起 HTTP。
 *
 * 这条门禁要证明的是「用户侧触发面是一层门禁，不是第二套退款实现」，因此断言分三段：
 *
 * 一、结构（静态，防止有人把退款逻辑复制过来）
 *   S1  API 侧原因码白名单与 packages/shared 契约副本逐字相等。
 *   S2  shared 的拒绝码联合覆盖策略层能吐出的全部拒绝码。
 *   S3  自助退款 service **不含任何退款状态写入**（不建 Refund、不写 refunding/refunded、
 *       不生成 refundNo），只能委托 RefundService。
 *   S4  请求 DTO 里没有任何金额字段 —— 退款额结构上不可由请求方指定。
 *   S5  路由挂 EndUserAuthGuard + Throttle。
 *
 * 二、状态组合矩阵（纯函数穷举）
 *   M1  8 × 9 = 72 格逐格比对独立写死的期望表；允许集恰为 5 格且全部 payStatus='paid'。
 *   M2  未知 payStatus / taskStatus → SELF_REFUND_STATE_UNSUPPORTED（fail-closed）。
 *
 * 三、行为（真库、真 RefundService、sandbox provider）
 *   B1  允许组合能退：pending / failed / expired 三格真的退成，金额 = 实付额。
 *   B2  **不得退已退过的单**：第二次提交 409 ALREADY_REFUNDED，Refund 行数不变、
 *       refundedAmountCents 不变（红线 2）。
 *   B3  **不得退超出订单金额**：退款额恒等于 amountCents − discountCents，且端点无金额入参。
 *   B4  **0 元订单**：实付 0 一律 409 NO_REFUNDABLE_AMOUNT，不建 0 元退款记录、订单态不变（红线 3）。
 *   B5  资金通道：offline / manual_confirmed / free / voucher / 空 一律 409 CHANNEL_UNSUPPORTED。
 *   B6  不允许的状态组合返回明确 409（不是 500），且不留任何 Refund 行。
 *   B7  本人校验：他人订单 / 游客单（endUserId=null）一律 404，且不建 Refund 行。
 *   B8  原因码白名单：非法 reasonCode 被 DTO 层拒（class-validator 实测）。
 *   B9  自由文本含 PII → 400，不建 Refund 行。
 *   B10 限流：额度用尽后 429，且不产生第 N+1 笔退款。
 *   B11 审计走既有通道：member.print_order.self_refund 落 AuditLog，operatorId 带 member_self: 前缀。
 *
 * 运行：pnpm --filter @ai-job-print/api verify:refund-user-facing
 */
import 'dotenv/config'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { randomBytes, randomUUID } from 'crypto'

process.env['TERMINAL_ADMIN_SECRET'] ||= 'verify-selfrefund-terminal-admin-secret-0123456789'
process.env['TERMINAL_ACTION_TOKEN_SECRET'] ||= 'verify-selfrefund-terminal-action-secret-0123456789'
process.env['FILE_SIGNING_SECRET'] ||= 'verify-selfrefund-file-signing-secret-0123456789ab'
process.env['PAYMENT_SESSION_SECRET'] ||= 'verify-selfrefund-payment-session-secret-01234567'
if (process.env['NODE_ENV'] === 'production') {
  console.error('  FAIL verify:refund-user-facing 不得在 NODE_ENV=production 运行（沙箱模拟支付被禁用）')
  process.exit(1)
}

import { plainToInstance } from 'class-transformer'
import { validateSync } from 'class-validator'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'
import { PrismaService } from '../src/prisma/prisma.service'
import { AuditService } from '../src/audit/audit.service'
import { OnlinePaymentService } from '../src/payment/online-payment.service'
import { OrderStatusService } from '../src/payment/order-status.service'
import { PaymentProviderRegistry } from '../src/payment/payment-provider.factory'
import { RefundService } from '../src/payment/refund.service'
import { SandboxPaymentProvider } from '../src/payment/providers/sandbox-payment.provider'
import { createPaymentSessionToken } from '../src/payment/payment-session-token'
import { MemberSelfRefundService } from '../src/member-print-orders/member-self-refund.service'
import { RequestSelfRefundDto } from '../src/member-print-orders/dto/request-self-refund.dto'
import {
  SELF_REFUND_PAY_STATUSES,
  SELF_REFUND_REASON_CODES,
  SELF_REFUND_TASK_STATUSES,
  SELF_REFUND_STATE_MATRIX,
  decideSelfRefundState,
  selfRefundOperatorId,
  type SelfRefundReasonCode,
} from '../src/member-print-orders/self-refund-policy'
import { SELF_REFUND_REASON_CODES as SHARED_REASON_CODES } from '../../../packages/shared/src/types/payment'

const SECRET = 'verify-selfrefund-sandbox-secret-01'
let passed = 0
const pass = (m: string): void => { passed += 1; console.log(`  PASS ${m}`) }
const fail = (m: string): never => { console.error(`  FAIL ${m}`); process.exit(1) }
const assert = (c: unknown, m: string): void => { c ? pass(m) : fail(m) }

/** 取 Nest 异常里的机器码（本仓统一 { error: { code, message } } 形状）。 */
function nestErrorCode(error: unknown): string | undefined {
  const candidate = error as { getResponse?: () => unknown; response?: unknown }
  const response = typeof candidate.getResponse === 'function' ? candidate.getResponse() : candidate.response
  const code = response && typeof response === 'object'
    ? (response as { error?: { code?: unknown } }).error?.code
    : undefined
  return typeof code === 'string' ? code : undefined
}

function nestStatus(error: unknown): number | undefined {
  const candidate = error as { getStatus?: () => number }
  return typeof candidate.getStatus === 'function' ? candidate.getStatus() : undefined
}

// ── 期望矩阵（**独立于实现写死**，不 import 生产表，否则等于自证）──────────────
/** 唯一允许自助退款的 5 格：payStatus='paid' 且这一单不可能已经出过纸。 */
const EXPECTED_ALLOWED: ReadonlyArray<readonly [string, string]> = [
  ['paid', 'pending'],
  ['paid', 'pending_release'],
  ['paid', 'awaiting_payment'],
  ['paid', 'expired'],
  ['paid', 'failed'],
]
/** paid 之外的 payStatus 一票否决码。 */
const EXPECTED_PAY_DENIALS: Record<string, string> = {
  unpaid: 'SELF_REFUND_ORDER_NOT_PAID',
  paying: 'SELF_REFUND_ORDER_NOT_PAID',
  failed: 'SELF_REFUND_ORDER_NOT_PAID',
  closed: 'SELF_REFUND_ORDER_NOT_PAID',
  refunding: 'SELF_REFUND_IN_PROGRESS',
  refunded: 'SELF_REFUND_ALREADY_REFUNDED',
  partial_refunded: 'SELF_REFUND_ALREADY_REFUNDED',
}
/** paid 时按 taskStatus 的拒绝码。 */
const EXPECTED_PAID_DENIALS: Record<string, string> = {
  claimed: 'SELF_REFUND_TASK_IN_PROGRESS',
  printing: 'SELF_REFUND_TASK_IN_PROGRESS',
  completed: 'SELF_REFUND_TASK_COMPLETED',
  cancelled: 'SELF_REFUND_ORDER_CANCELLED',
}

async function main(): Promise<void> {
  console.log('\n=== A3-S3 会员自助退款门禁 verification ===')

  // ── 一、结构断言（静态）──────────────────────────────────────────────────
  const apiDir = resolve(__dirname, '..')
  const serviceSrc = readFileSync(resolve(apiDir, 'src/member-print-orders/member-self-refund.service.ts'), 'utf8')
  const policySrc = readFileSync(resolve(apiDir, 'src/member-print-orders/self-refund-policy.ts'), 'utf8')
  const dtoSrc = readFileSync(resolve(apiDir, 'src/member-print-orders/dto/request-self-refund.dto.ts'), 'utf8')
  const controllerSrc = readFileSync(resolve(apiDir, 'src/member-print-orders/member-print-orders.controller.ts'), 'utf8')

  assert(
    JSON.stringify([...SELF_REFUND_REASON_CODES]) === JSON.stringify([...SHARED_REASON_CODES]),
    'S1. 原因码白名单与 packages/shared 契约副本逐字相等',
  )

  {
    // 策略层能吐出的拒绝码 + service 层三个闸的码，必须都在 shared 联合里声明。
    const sharedSrc = readFileSync(resolve(apiDir, '../../packages/shared/src/types/payment.ts'), 'utf8')
    const emitted = new Set<string>()
    for (const pay of SELF_REFUND_PAY_STATUSES) {
      for (const task of SELF_REFUND_TASK_STATUSES) {
        const d = SELF_REFUND_STATE_MATRIX[pay]?.[task]
        if (d && !d.allowed) emitted.add(d.code)
      }
    }
    emitted.add('SELF_REFUND_STATE_UNSUPPORTED')
    for (const code of ['SELF_REFUND_CHANNEL_UNSUPPORTED', 'SELF_REFUND_NO_REFUNDABLE_AMOUNT', 'SELF_REFUND_NOTE_PII_REJECTED', 'SELF_REFUND_RATE_LIMITED']) {
      assert(serviceSrc.includes(code), `S2a. service 实现包含拒绝码 ${code}`)
      emitted.add(code)
    }
    const missing = [...emitted].filter((c) => !sharedSrc.includes(`'${c}'`))
    assert(missing.length === 0, `S2b. shared 拒绝码联合覆盖全部实现拒绝码（缺: ${missing.join(',') || '无'}）`)
  }

  {
    // 红线 1：门禁层不得复制退款逻辑。判定只看**代码**，先剥注释（文档里出现 RFD- 是解释，不是实现）。
    const code = serviceSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
    const forbidden: ReadonlyArray<readonly [string, RegExp]> = [
      ['建 Refund 行', /refund\.(create|update|updateMany|upsert|delete)/],
      ['改订单支付态', /order\.(update|updateMany|upsert)/],
      ['自开事务推状态机', /\$transaction/],
      ['写退款态', /payStatus:\s*['"](refunding|refunded|partial_refunded)['"]/],
      ['自造 refundNo', /refundNo:\s*[`'"]/],
      ['直连支付 provider', /provider\.refund|PaymentProviderRegistry|PAYMENT_PROVIDER/],
    ]
    const hits = forbidden.filter(([, re]) => re.test(code)).map(([label]) => label)
    assert(hits.length === 0, `S3a. 自助退款 service 不含任何退款实现（越界: ${hits.join(' | ') || '无'}）`)
    assert(
      /this\.refunds\.refund\(\s*order\.id,\s*\{[^}]*\}/.test(code) && !/this\.refunds\.refund\([^)]*refundNo/.test(code),
      'S3b. 只委托 RefundService.refund() 且不传自定义 refundNo（沿用 RFD-<orderNo> 一单一退幂等键）',
    )
    assert(!/prisma|Prisma/.test(policySrc.replace(/\/\*[\s\S]*?\*\//g, '')), 'S3c. 策略层是纯函数（不碰 Prisma）')
  }

  assert(
    !/amount|cents|fee|price/i.test(dtoSrc),
    'S4. 请求 DTO 无任何金额字段 —— 退款额结构上不可由请求方指定',
  )

  assert(
    controllerSrc.includes('@UseGuards(EndUserAuthGuard)') &&
      /@Post\(':orderId\/refund'\)[\s\S]{0,200}@Throttle\(/.test(controllerSrc),
    'S5. 退款路由挂 EndUserAuthGuard（控制器级）+ @Throttle 突发限流',
  )

  // ── 二、状态组合矩阵穷举 ────────────────────────────────────────────────
  {
    const allowedSet = new Set(EXPECTED_ALLOWED.map(([p, t]) => `${p}|${t}`))
    let cells = 0
    let allowedSeen = 0
    for (const pay of SELF_REFUND_PAY_STATUSES) {
      for (const task of SELF_REFUND_TASK_STATUSES) {
        cells += 1
        const actual = decideSelfRefundState(pay, task)
        const shouldAllow = allowedSet.has(`${pay}|${task}`)
        if (shouldAllow) {
          allowedSeen += 1
          if (!actual.allowed) fail(`M1. (${pay} × ${task}) 期望允许，实际拒绝 ${actual.code}`)
          continue
        }
        const expectedCode = pay === 'paid' ? EXPECTED_PAID_DENIALS[task] : EXPECTED_PAY_DENIALS[pay]
        if (actual.allowed) fail(`M1. (${pay} × ${task}) 期望拒绝 ${expectedCode}，实际放行`)
        if (actual.code !== expectedCode) {
          fail(`M1. (${pay} × ${task}) 期望 ${expectedCode}，实际 ${actual.code}`)
        }
      }
    }
    assert(cells === 72, `M1a. 穷举了 ${cells} 格（8 payStatus × 9 taskStatus）`)
    assert(allowedSeen === EXPECTED_ALLOWED.length && allowedSeen === 5, 'M1b. 允许集恰为 5 格且全部 payStatus=paid')
    pass('M1c. 72 格组合逐格与独立期望表一致')
  }
  assert(decideSelfRefundState('paid', 'no_such_status').allowed === false, 'M2a. 未知 taskStatus 不放行')
  assert(
    decideSelfRefundState('paid', 'no_such_status').allowed === false &&
      (decideSelfRefundState('paid', 'no_such_status') as { code: string }).code === 'SELF_REFUND_STATE_UNSUPPORTED',
    'M2b. 未知 taskStatus → SELF_REFUND_STATE_UNSUPPORTED（fail-closed）',
  )
  assert(
    (decideSelfRefundState('no_such_pay', 'pending') as { code: string }).code === 'SELF_REFUND_STATE_UNSUPPORTED',
    'M2c. 未知 payStatus → SELF_REFUND_STATE_UNSUPPORTED（fail-closed）',
  )

  // ── 三、行为断言（真库）────────────────────────────────────────────────
  // 本段真的建单、真的走 RefundService 出款（沙箱），属于写行脚本：
  // 构造 Prisma 之前必须先过隔离库门禁，绝不允许对着生产/非测试库跑。
  assertIsolatedVerificationDatabase()
  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const audit = new AuditService(prisma)
  const orderStatus = new OrderStatusService(prisma, audit)
  const provider = new SandboxPaymentProvider(SECRET)
  const registry = new PaymentProviderRegistry([provider])
  const onlinePayment = new OnlinePaymentService(prisma, audit, orderStatus, registry)
  const refundService = new RefundService(prisma, audit, registry)
  const selfRefund = new MemberSelfRefundService(prisma, audit, refundService)

  const suffix = randomUUID().replace(/-/g, '').slice(0, 12)
  const terminalId = `t_selfrefund_${suffix}`
  const otherUserId = `eu_selfrefund_other_${suffix}`
  const orderIds: string[] = []
  const memberIds: string[] = []
  let seq = 0

  /**
   * 每个断言分组换一个会员。按会员限流是真门禁（3 次 / 10 分钟），
   * 全套跑在同一个会员上会在第 4 单被自己的限流挡住 —— 那不是被测行为。
   */
  let endUserId = ''
  async function rotateMember(): Promise<string> {
    const id = `eu_srf_${suffix}_${memberIds.length}`
    await prisma.endUser.create({ data: { id, phoneHash: `hash_${id}`, phoneEnc: `enc_${id}` } })
    memberIds.push(id)
    endUserId = id
    return id
  }

  async function makeOrder(input: {
    amountCents: number
    endUser?: string | null
    payStatus?: string
    taskStatus?: string
    paymentSource?: string | null
    discountCents?: number
  }): Promise<string> {
    seq += 1
    const order = await prisma.order.create({
      data: {
        orderNo: `ORD-SELFRFD-${suffix}-${seq}`,
        type: 'print',
        amountCents: input.amountCents,
        discountCents: input.discountCents ?? 0,
        payStatus: input.payStatus ?? 'unpaid',
        taskStatus: input.taskStatus ?? 'pending',
        paymentSource: input.paymentSource ?? null,
        terminalId,
        endUserId: input.endUser === undefined ? endUserId : input.endUser,
      },
    })
    orderIds.push(order.id)
    return order.id
  }

  /** 走真实沙箱收银入账：payStatus→paid + paymentSource='sandbox'（唯一合法写入路径）。 */
  async function paySandbox(orderId: string): Promise<void> {
    const o = (await prisma.order.findUnique({ where: { id: orderId } }))!
    const token = createPaymentSessionToken({
      orderId: o.id, orderNo: o.orderNo, terminalId: o.terminalId, amountCents: o.amountCents, printTaskId: o.printTaskId,
    })
    const attempt = await onlinePayment.createPayAttempt(orderId, token)
    await onlinePayment.simulateSandboxCallback({ attemptId: attempt.attemptId, result: 'success' })
  }

  const dto = (reasonCode: SelfRefundReasonCode, note?: string): RequestSelfRefundDto =>
    ({ reasonCode, ...(note === undefined ? {} : { note }) }) as RequestSelfRefundDto

  async function refundCountFor(orderId: string): Promise<number> {
    return prisma.refund.count({ where: { orderId } })
  }

  /** 断言「拒绝」：抛出期望机器码 + 期望 HTTP 状态 + 未留下任何 Refund 行 + 订单态未变。 */
  async function expectDenied(label: string, orderId: string, code: string, status: number, body?: RequestSelfRefundDto): Promise<void> {
    const before = (await prisma.order.findUnique({ where: { id: orderId } }))!
    try {
      await selfRefund.request(endUserId, orderId, body ?? dto('print_failed'))
    } catch (e) {
      const actual = nestErrorCode(e)
      const actualStatus = nestStatus(e)
      if (actual !== code) return fail(`${label} — 期望 ${code}，实际 ${actual ?? (e as Error).message}`)
      if (actualStatus !== status) return fail(`${label} — 期望 HTTP ${status}，实际 ${actualStatus}`)
      const after = (await prisma.order.findUnique({ where: { id: orderId } }))!
      if (await refundCountFor(orderId) !== 0) return fail(`${label} — 拒绝路径不得留下 Refund 行`)
      if (after.payStatus !== before.payStatus || after.refundedAmountCents !== before.refundedAmountCents) {
        return fail(`${label} — 拒绝路径不得改动订单支付态`)
      }
      return pass(`${label}（${code} / HTTP ${status}，无 Refund 行、订单态未变）`)
    }
    fail(`${label} — 期望 ${code}，但请求成功了`)
  }

  async function cleanup(): Promise<void> {
    const owned = await prisma.order.findMany({ where: { terminalId }, select: { id: true } })
    const ids = [...new Set([...orderIds, ...owned.map((o) => o.id)])]
    await prisma.auditLog.deleteMany({ where: { targetId: { in: ids } } })
    await prisma.refund.deleteMany({ where: { orderId: { in: ids } } })
    await prisma.paymentAttempt.deleteMany({ where: { orderId: { in: ids } } })
    await prisma.order.deleteMany({ where: { id: { in: ids } } })
    await prisma.terminalHeartbeat.deleteMany({ where: { terminalId } })
    await prisma.terminal.deleteMany({ where: { id: terminalId } })
    await prisma.endUser.deleteMany({ where: { id: { in: [...memberIds, otherUserId] } } })
  }

  try {
    await cleanup()
    await prisma.terminal.create({
      data: { id: terminalId, terminalCode: `KSK-SRF-${suffix}`, agentToken: randomBytes(16).toString('hex'), deviceFingerprint: 'verify-self-refund' },
    })
    await prisma.endUser.create({ data: { id: otherUserId, phoneHash: `hash_srfo_${suffix}`, phoneEnc: `enc_srfo_${suffix}` } })
    await rotateMember()
    pass('测试夹具已创建')

    // ── B1 允许组合能退 ───────────────────────────────────────────────────
    for (const taskStatus of ['pending', 'failed', 'expired'] as const) {
      const id = await makeOrder({ amountCents: 350 })
      await paySandbox(id)
      await prisma.order.update({ where: { id }, data: { taskStatus } })
      const receipt = await selfRefund.request(endUserId, id, dto(taskStatus === 'failed' ? 'print_failed' : 'print_not_started'))
      const after = (await prisma.order.findUnique({ where: { id } }))!
      assert(
        receipt.status === 'success' && after.payStatus === 'refunded' && receipt.amountCents === 350,
        `B1-${taskStatus}. paid × ${taskStatus} 允许自助退款并退成（350 分）`,
      )
      assert(
        after.refundedAmountCents === 350 && after.refundReason?.startsWith('member_self_refund:') === true,
        `B1-${taskStatus}b. 订单落 refundedAmountCents=350 且 refundReason 标明自助退款`,
      )
      assert(receipt.idempotent === false, `B1-${taskStatus}c. 首次提交非幂等命中`)
    }

    // ── B2 不得退已退过的单（红线 2）+ B3 金额不可超额 ──────────────────────
    await rotateMember()
    {
      const id = await makeOrder({ amountCents: 800 })
      await paySandbox(id)
      const first = await selfRefund.request(endUserId, id, dto('print_failed'))
      const refundRowsAfterFirst = await refundCountFor(id)
      const orderAfterFirst = (await prisma.order.findUnique({ where: { id } }))!
      assert(first.amountCents === 800 && orderAfterFirst.refundedAmountCents === 800, 'B3a. 退款额恒等于实付额（800 分）')

      let secondCode: string | undefined
      try { await selfRefund.request(endUserId, id, dto('duplicate_charge')) } catch (e) { secondCode = nestErrorCode(e) }
      const orderAfterSecond = (await prisma.order.findUnique({ where: { id } }))!
      assert(secondCode === 'SELF_REFUND_ALREADY_REFUNDED', 'B2a. 已退过的单第二次提交 → SELF_REFUND_ALREADY_REFUNDED')
      assert(await refundCountFor(id) === refundRowsAfterFirst && refundRowsAfterFirst === 1, 'B2b. Refund 行数仍为 1（未二次出款）')
      assert(orderAfterSecond.refundedAmountCents === 800, 'B2c. refundedAmountCents 未被累加（不得退超出订单金额）')
    }
    {
      // B3b：带抵扣的单，可退额 = 应付 − 抵扣，绝不按应付全额退。
      const id = await makeOrder({ amountCents: 1000, discountCents: 400, payStatus: 'paid', paymentSource: 'sandbox' })
      const receipt = await selfRefund.request(endUserId, id, dto('print_failed'))
      assert(receipt.amountCents === 600, 'B3b. 有抵扣时退款额 = amountCents − discountCents（600 分），不退抵扣部分')
    }

    // ── B4 0 元订单（红线 3）─────────────────────────────────────────────
    {
      // 免费试运营真实形态：0 元单由建单路径 markPaid(free) 置 paid + paymentSource='free'。
      const freeId = await makeOrder({ amountCents: 0 })
      await orderStatus.markPaid(freeId, { paymentSource: 'free' })
      const freeOrder = (await prisma.order.findUnique({ where: { id: freeId } }))!
      assert(freeOrder.payStatus === 'paid' && freeOrder.paymentSource === 'free', 'B4a. 0 元单经状态机置 paid(free)')
      // 通道闸先命中（free 不在自助退款通道白名单）——同样是明确 409、不建 0 元退款记录。
      await expectDenied('B4b. 0 元免费单不可自助退款', freeId, 'SELF_REFUND_CHANNEL_UNSUPPORTED', 409)

      // 隔离金额闸本身：通道合法（sandbox）但实付为 0。
      const zeroSandbox = await makeOrder({ amountCents: 0, payStatus: 'paid', paymentSource: 'sandbox' })
      await expectDenied('B4c. 通道合法但实付 0 → 金额闸拒', zeroSandbox, 'SELF_REFUND_NO_REFUNDABLE_AMOUNT', 409)

      // 全额券核销单：实付 0 且退款不恢复权益额度，双重理由不放行。
      const voucherId = await makeOrder({ amountCents: 500, discountCents: 500, payStatus: 'paid', paymentSource: 'voucher' })
      await expectDenied('B4d. 全额券核销单不可自助退款', voucherId, 'SELF_REFUND_CHANNEL_UNSUPPORTED', 409)
    }

    // ── B5 资金通道闸 ────────────────────────────────────────────────────
    for (const source of ['offline', 'manual_confirmed'] as const) {
      const id = await makeOrder({ amountCents: 600, payStatus: 'paid', paymentSource: source })
      await expectDenied(`B5-${source}. ${source} 收款单不可自助退款（钱不会自动回到用户）`, id, 'SELF_REFUND_CHANNEL_UNSUPPORTED', 409)
    }
    {
      const id = await makeOrder({ amountCents: 600, payStatus: 'paid', paymentSource: null })
      await expectDenied('B5-null. paymentSource 缺失单不可自助退款', id, 'SELF_REFUND_CHANNEL_UNSUPPORTED', 409)
    }

    // ── B6 不允许的状态组合 → 明确 409（不是 500）──────────────────────────
    for (const [taskStatus, code] of [
      ['claimed', 'SELF_REFUND_TASK_IN_PROGRESS'],
      ['printing', 'SELF_REFUND_TASK_IN_PROGRESS'],
      ['completed', 'SELF_REFUND_TASK_COMPLETED'],
      ['cancelled', 'SELF_REFUND_ORDER_CANCELLED'],
      ['no_such_status', 'SELF_REFUND_STATE_UNSUPPORTED'],
    ] as const) {
      const id = await makeOrder({ amountCents: 400, payStatus: 'paid', paymentSource: 'sandbox', taskStatus })
      await expectDenied(`B6-${taskStatus}. paid × ${taskStatus} 拒绝`, id, code, 409)
    }
    for (const [payStatus, code] of [
      ['unpaid', 'SELF_REFUND_ORDER_NOT_PAID'],
      ['paying', 'SELF_REFUND_ORDER_NOT_PAID'],
      ['closed', 'SELF_REFUND_ORDER_NOT_PAID'],
      ['failed', 'SELF_REFUND_ORDER_NOT_PAID'],
      ['refunding', 'SELF_REFUND_IN_PROGRESS'],
      ['refunded', 'SELF_REFUND_ALREADY_REFUNDED'],
      ['partial_refunded', 'SELF_REFUND_ALREADY_REFUNDED'],
    ] as const) {
      const id = await makeOrder({ amountCents: 400, payStatus, paymentSource: 'sandbox' })
      await expectDenied(`B6-${payStatus}. payStatus=${payStatus} 拒绝`, id, code, 409)
    }

    // ── B7 本人校验 ──────────────────────────────────────────────────────
    {
      const othersOrder = await makeOrder({ amountCents: 500, endUser: otherUserId, payStatus: 'paid', paymentSource: 'sandbox' })
      await expectDenied('B7a. 他人订单 → 404，不泄露订单是否存在', othersOrder, 'PRINT_ORDER_NOT_FOUND', 404)
      const guestOrder = await makeOrder({ amountCents: 500, endUser: null, payStatus: 'paid', paymentSource: 'sandbox' })
      await expectDenied('B7b. 游客单（endUserId=null）→ 404，自助退款不覆盖匿名单', guestOrder, 'PRINT_ORDER_NOT_FOUND', 404)
    }

    // ── B8 原因码白名单（DTO 层实测）──────────────────────────────────────
    {
      const bad = validateSync(plainToInstance(RequestSelfRefundDto, { reasonCode: 'because_i_want_money' }))
      assert(bad.length > 0, 'B8a. 白名单外的 reasonCode 被 DTO 拒绝')
      const freeText = validateSync(plainToInstance(RequestSelfRefundDto, { reasonCode: '打印机坏了请退钱' }))
      assert(freeText.length > 0, 'B8b. 自由文本不能当 reasonCode（不接受自由文本作为判定依据）')
      const missing = validateSync(plainToInstance(RequestSelfRefundDto, {}))
      assert(missing.length > 0, 'B8c. reasonCode 必填')
      for (const code of SELF_REFUND_REASON_CODES) {
        const ok = validateSync(plainToInstance(RequestSelfRefundDto, { reasonCode: code }))
        if (ok.length !== 0) fail(`B8d. 白名单内 reasonCode ${code} 被误拒`)
      }
      pass(`B8d. 白名单内 ${SELF_REFUND_REASON_CODES.length} 个 reasonCode 全部放行`)
      const longNote = validateSync(plainToInstance(RequestSelfRefundDto, { reasonCode: 'print_failed', note: 'x'.repeat(121) }))
      assert(longNote.length > 0, 'B8e. note 超长被拒（≤120 字）')
    }

    // ── B9 自由文本 PII ──────────────────────────────────────────────────
    {
      const id = await makeOrder({ amountCents: 400, payStatus: 'paid', paymentSource: 'sandbox' })
      await expectDenied(
        'B9. 说明含手机号 → 400 且不建 Refund 行',
        id,
        'SELF_REFUND_NOTE_PII_REJECTED',
        400,
        dto('print_failed', '退到我手机 13800138000'),
      )
    }

    // ── B10 限流 ─────────────────────────────────────────────────────────
    await rotateMember()
    {
      // 用与生产同一 operatorId 前缀预置额度（模拟该会员 10 分钟内已自助退过 3 单）。
      const operatorId = selfRefundOperatorId(endUserId)
      const quotaOrders: string[] = []
      for (let i = 0; i < 3; i += 1) {
        const oid = await makeOrder({ amountCents: 100, payStatus: 'refunded', paymentSource: 'sandbox' })
        quotaOrders.push(oid)
        await prisma.refund.create({
          data: { orderId: oid, refundNo: `RFD-QUOTA-${suffix}-${i}`, amountCents: 100, status: 'success', channel: 'sandbox', operatorId },
        })
      }
      const target = await makeOrder({ amountCents: 700, payStatus: 'paid', paymentSource: 'sandbox' })
      await expectDenied('B10a. 会员额度用尽 → 429，且不产生新的退款', target, 'SELF_REFUND_RATE_LIMITED', 429)
      const rateAudits = await prisma.auditLog.count({
        where: { action: 'member.print_order.self_refund_rate_limited', targetId: target },
      })
      assert(rateAudits === 1, 'B10b. 限流命中写审计 member.print_order.self_refund_rate_limited')
      // 清掉配额行，避免影响后续断言。
      await prisma.refund.deleteMany({ where: { orderId: { in: quotaOrders } } })
    }

    // ── B11 审计 ────────────────────────────────────────────────────────
    await rotateMember()
    {
      const id = await makeOrder({ amountCents: 900, payStatus: 'paid', paymentSource: 'sandbox' })
      await selfRefund.request(endUserId, id, dto('device_unrecovered', '按提示合上盖子还是没出纸'))
      const logs = await prisma.auditLog.findMany({ where: { action: 'member.print_order.self_refund', targetId: id } })
      assert(logs.length === 1, 'B11a. 成功退款写且只写一条 member.print_order.self_refund 审计')
      const payload = JSON.parse(logs[0]?.payloadJson ?? '{}') as Record<string, unknown>
      assert(
        payload['reasonCode'] === 'device_unrecovered' && payload['payStatusBefore'] === 'paid' && payload['taskStatusBefore'] === 'pending',
        'B11b. 审计 payload 含原因码与退款前 payStatus/taskStatus',
      )
      assert(payload['note'] === '按提示合上盖子还是没出纸', 'B11c. 自由文本只进审计（不参与判定）')
      const refundRow = await prisma.refund.findFirst({ where: { orderId: id } })
      assert(
        refundRow?.operatorId === selfRefundOperatorId(endUserId),
        'B11d. Refund.operatorId 带 member_self: 前缀（自助退款可与 Admin 代退区分）',
      )
      assert(
        refundRow?.reason === 'member_self_refund:device_unrecovered',
        'B11e. Refund.reason 为机器可读的自助退款原因串',
      )
      assert(logs[0]?.actorRole === 'end_user' && logs[0]?.actorId === null, 'B11f. 审计 actorRole=end_user（沿用既有审计通道，未新起表）')
    }

    console.log(`\n  ✅ verify:refund-user-facing 全部通过（${passed} checks）\n`)
  } finally {
    await cleanup()
    await prisma.onModuleDestroy?.()
  }
}

main().catch((e) => {
  console.error('  FAIL verify:refund-user-facing 异常:', e)
  process.exit(1)
})
