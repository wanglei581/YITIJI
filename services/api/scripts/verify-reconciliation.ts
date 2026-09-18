/**
 * W-C part2a 本地对账 verification（verify:reconciliation）。
 *
 * 造多种账本状态的订单，直接调 ReconciliationService，断言：
 * - 汇总净额：grossPaid / refunded / net 计算正确（整数分）。
 * - 健康单（paid + success attempt / refunded + 金额一致）不产生差异。
 * - 差异检出：PAID_WITHOUT_SUCCESS_ATTEMPT / REFUND_AMOUNT_MISMATCH /
 *   ORDER_REFUNDED_WITHOUT_REFUND_ROW / REFUND_SUCCESS_ORDER_NOT_REFUNDED /
 *   STUCK_REFUNDING（超龄）各命中且带 orderId。
 * - 专项：LATE_PAID（审计 late=true）/ RECONCILED（payment.reconciled 审计）进 attention。
 * - 只读：对账不改任何账本（前后订单/退款计数不变）。
 */
import 'dotenv/config'
import { randomUUID } from 'crypto'
import { ReconciliationService } from '../src/payment/reconciliation.service'
import { PrismaService } from '../src/prisma/prisma.service'

let passCount = 0
const pass = (m: string) => {
  passCount += 1
  console.log(`  PASS ${m}`)
}
const fail = (m: string): never => {
  console.error(`  FAIL ${m}`)
  process.exit(1)
}

async function main(): Promise<void> {
  console.log('\n=== W-C reconciliation (本地账本对账) verification ===')
  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const svc = new ReconciliationService(prisma)

  const suffix = randomUUID().replace(/-/g, '').slice(0, 12)
  const terminalId = `t_recon_${suffix}`
  const orderIds: string[] = []
  const mk = async (
    tag: string,
    data: Partial<Parameters<PrismaService['order']['create']>[0]['data']> & { amountCents: number; payStatus: string },
  ): Promise<string> => {
    const o = await prisma.order.create({
      data: {
        orderNo: `ORD-RECON-${suffix}-${tag}`,
        type: 'print',
        taskStatus: 'pending',
        terminalId,
        discountCents: 0,
        refundedAmountCents: 0,
        ...data,
      },
    })
    orderIds.push(o.id)
    return o.id
  }

  const find = (list: { code: string; orderId: string }[], code: string, orderId: string): boolean =>
    list.some((d) => d.code === code && d.orderId === orderId)

  try {
    await prisma.terminal.create({
      data: { id: terminalId, terminalCode: `KSK-RECON-${suffix}`, agentToken: `agt_${suffix}`, deviceFingerprint: 'verify-recon' },
    })

    // 健康 paid 单（wechat + success attempt，200 分）
    const healthy = await mk('healthy', { amountCents: 200, payStatus: 'paid', paymentSource: 'wechat', payChannel: 'wechat', paidAt: new Date() })
    await prisma.paymentAttempt.create({ data: { orderId: healthy, channel: 'wechat', amountCents: 200, status: 'success', channelTxnNo: `wx_${suffix}_h` } })

    // 健康 refunded 单（150 分实付、已退 150、有 success Refund）
    const refundedOk = await mk('refok', { amountCents: 150, payStatus: 'refunded', paymentSource: 'alipay', payChannel: 'alipay', paidAt: new Date(), refundedAmountCents: 150, refundedAt: new Date() })
    await prisma.paymentAttempt.create({
      data: {
        orderId: refundedOk,
        channel: 'alipay',
        amountCents: 150,
        status: 'success',
        channelTxnNo: `ali_${suffix}_r`,
        createdAt: new Date(Date.now() - 120_000),
      },
    })
    await prisma.refund.create({ data: { orderId: refundedOk, refundNo: `RFD-${suffix}-refok`, amountCents: 150, status: 'success', channel: 'alipay', reason: 't' } })

    // 差异：paid 无 success attempt（100 分）
    const noAttempt = await mk('noatt', { amountCents: 100, payStatus: 'paid', paymentSource: 'wechat', payChannel: 'wechat', paidAt: new Date() })

    // 差异：refunded 但 refundedAmountCents(120) ≠ success Refund 之和(100)
    const mismatch = await mk('mism', { amountCents: 120, payStatus: 'refunded', paymentSource: 'wechat', payChannel: 'wechat', paidAt: new Date(), refundedAmountCents: 120, refundedAt: new Date() })
    await prisma.refund.create({ data: { orderId: mismatch, refundNo: `RFD-${suffix}-mism`, amountCents: 100, status: 'success', channel: 'wechat', reason: 't' } })

    // 差异：refunded 但无 success Refund 记录（refundedAmountCents=80）
    const noRow = await mk('norow', { amountCents: 80, payStatus: 'refunded', paymentSource: 'wechat', payChannel: 'wechat', paidAt: new Date(), refundedAmountCents: 80, refundedAt: new Date() })

    // 差异：paid 却已有 success Refund（不应共存）
    const paidWithRefund = await mk('pwr', { amountCents: 90, payStatus: 'paid', paymentSource: 'wechat', payChannel: 'wechat', paidAt: new Date() })
    await prisma.paymentAttempt.create({ data: { orderId: paidWithRefund, channel: 'wechat', amountCents: 90, status: 'success', channelTxnNo: `wx_${suffix}_pwr` } })
    await prisma.refund.create({ data: { orderId: paidWithRefund, refundNo: `RFD-${suffix}-pwr`, amountCents: 90, status: 'success', channel: 'wechat', reason: 't' } })

    // 差异：STUCK_REFUNDING（refunding 且 updatedAt 超 30 分钟前）
    const stuck = await mk('stuck', { amountCents: 60, payStatus: 'refunding', paymentSource: 'wechat', payChannel: 'wechat', paidAt: new Date() })
    await prisma.order.update({ where: { id: stuck }, data: { updatedAt: new Date(Date.now() - 60 * 60 * 1000) } })

    // 渠道已收款、订单未转 paid（迟到回调待退）必须进入对账，不得因 closed 被排除
    const collected = await mk('coll', {
      amountCents: 330,
      payStatus: 'closed',
      refundReason: 'ONLINE_PAID_PENDING_REFUND',
      pickupStatus: 'expired',
    })
    await prisma.paymentAttempt.create({
      data: { orderId: collected, channel: 'wechat', amountCents: 330, status: 'success', channelTxnNo: `wx_${suffix}_c` },
    })

    // 已退款后再出现第二条 success 尝试：必须检出，不得当健康单；gross 按两次实收合计
    const extra = await mk('extra', {
      amountCents: 150,
      payStatus: 'refunded',
      paymentSource: 'wechat',
      payChannel: 'wechat',
      paidAt: new Date(Date.now() - 180_000),
      refundedAmountCents: 150,
      refundedAt: new Date(Date.now() - 60_000),
    })
    await prisma.paymentAttempt.create({
      data: {
        orderId: extra,
        channel: 'wechat',
        amountCents: 150,
        status: 'success',
        channelTxnNo: `wx_${suffix}_e1`,
        createdAt: new Date(Date.now() - 170_000),
      },
    })
    await prisma.paymentAttempt.create({
      data: {
        orderId: extra,
        channel: 'wechat',
        amountCents: 150,
        status: 'success',
        channelTxnNo: `wx_${suffix}_e2`,
        createdAt: new Date(),
      },
    })
    await prisma.refund.create({
      data: { orderId: extra, refundNo: `RFD-${suffix}-extra`, amountCents: 150, status: 'success', channel: 'wechat', reason: 't' },
    })

    const extraRefunding = await mk('extrf', {
      amountCents: 80,
      payStatus: 'refunding',
      paymentSource: 'wechat',
      payChannel: 'wechat',
      paidAt: new Date(Date.now() - 90_000),
    })
    await prisma.paymentAttempt.create({
      data: {
        orderId: extraRefunding,
        channel: 'wechat',
        amountCents: 80,
        status: 'success',
        channelTxnNo: `wx_${suffix}_rf1`,
        createdAt: new Date(Date.now() - 80_000),
      },
    })
    await prisma.paymentAttempt.create({
      data: {
        orderId: extraRefunding,
        channel: 'wechat',
        amountCents: 80,
        status: 'success',
        channelTxnNo: `wx_${suffix}_rf2`,
        createdAt: new Date(),
      },
    })

    // 专项：LATE_PAID（healthy 单加 late 审计）+ RECONCILED（refundedOk 单加 reconcile 审计）
    await prisma.auditLog.create({ data: { actorRole: 'system', action: 'order.mark_paid_online', targetType: 'order', targetId: healthy, payloadJson: JSON.stringify({ late: true, channel: 'wechat' }) } })
    await prisma.auditLog.create({ data: { actorRole: 'system', action: 'payment.reconciled', targetType: 'order', targetId: refundedOk, payloadJson: JSON.stringify({ channel: 'alipay' }) } })

    const ordersBefore = await prisma.order.count({ where: { terminalId } })
    const refundsBefore = await prisma.refund.count({ where: { order: { is: { terminalId } } } })

    const rep = await svc.report({ nowMs: Date.now() })
    // 只截我们造的单（全库可能有其它 dev 数据，按 orderId 过滤断言）
    const mine = (list: { orderId: string }[]) => list.filter((d) => orderIds.includes(d.orderId))
    const disc = mine(rep.discrepancies) as { code: string; orderId: string }[]

    // 汇总：净额包含所有 paid/refunded 单，直接断言我们造的单被计入（≥ 各自值）
    if (rep.summary.grossPaidCents >= 200 + 100 + 90 && rep.summary.refundedCents >= 150 + 120 + 80) {
      pass('汇总净额包含本次造单（gross/refunded 累计）')
    } else {
      fail(`summary mismatch: ${JSON.stringify(rep.summary)}`)
    }
    if (rep.summary.netCents === rep.summary.grossPaidCents - rep.summary.refundedCents) {
      pass('净额 = 应收 − 退款')
    } else {
      fail('net calc wrong')
    }

    if (!find(disc, 'PAID_WITHOUT_SUCCESS_ATTEMPT', healthy) && !find(disc, 'REFUND_AMOUNT_MISMATCH', refundedOk)) {
      pass('健康单（paid+attempt / refunded 金额一致）不产生差异')
    } else {
      fail('healthy orders flagged')
    }
    if (find(disc, 'PAID_WITHOUT_SUCCESS_ATTEMPT', noAttempt)) pass('检出 PAID_WITHOUT_SUCCESS_ATTEMPT')
    else fail('missed PAID_WITHOUT_SUCCESS_ATTEMPT')
    if (find(disc, 'REFUND_AMOUNT_MISMATCH', mismatch)) pass('检出 REFUND_AMOUNT_MISMATCH')
    else fail('missed REFUND_AMOUNT_MISMATCH')
    if (find(disc, 'ORDER_REFUNDED_WITHOUT_REFUND_ROW', noRow)) pass('检出 ORDER_REFUNDED_WITHOUT_REFUND_ROW')
    else fail('missed ORDER_REFUNDED_WITHOUT_REFUND_ROW')
    if (find(disc, 'REFUND_SUCCESS_ORDER_NOT_REFUNDED', paidWithRefund)) pass('检出 REFUND_SUCCESS_ORDER_NOT_REFUNDED')
    else fail('missed REFUND_SUCCESS_ORDER_NOT_REFUNDED')
    if (find(disc, 'STUCK_REFUNDING', stuck)) pass('检出 STUCK_REFUNDING（超龄退款中单）')
    else fail('missed STUCK_REFUNDING')
    if (find(disc, 'ONLINE_COLLECTED_PENDING_REFUND', collected) && rep.summary.grossPaidCents >= 200 + 100 + 90 + 330) {
      pass('检出 ONLINE_COLLECTED_PENDING_REFUND，金额计入 gross（不伪装 payStatus=paid）')
    } else {
      fail(`missed ONLINE_COLLECTED_PENDING_REFUND: ${JSON.stringify(disc)} summary=${JSON.stringify(rep.summary)}`)
    }
    if (
      find(disc, 'ORDER_EXTRA_COLLECTION_AFTER_REFUND', extra) &&
      find(disc, 'ORDER_EXTRA_COLLECTION_AFTER_REFUND', extraRefunding) &&
      !find(disc, 'ORDER_EXTRA_COLLECTION_AFTER_REFUND', refundedOk)
    ) {
      pass('检出 ORDER_EXTRA_COLLECTION_AFTER_REFUND（refunded/refunding）；单笔已退健康单不误报')
    } else {
      fail(`extra collection mismatch: ${JSON.stringify(disc)}`)
    }
    if (rep.summary.grossPaidCents >= 200 + 100 + 90 + 330 + 150 + 150 + 80 + 80) {
      pass('额外成功尝试按实收合计计入 gross')
    } else {
      fail(`extra collection gross missing: ${JSON.stringify(rep.summary)}`)
    }

    if (find(mine(rep.attention.latePaid), 'LATE_PAID', healthy)) pass('LATE_PAID 进 attention 专项')
    else fail('missed LATE_PAID attention')
    if (find(mine(rep.attention.reconciled), 'RECONCILED', refundedOk)) pass('RECONCILED 进 attention 专项')
    else fail('missed RECONCILED attention')

    // 只读：对账不改账本
    if (
      (await prisma.order.count({ where: { terminalId } })) === ordersBefore &&
      (await prisma.refund.count({ where: { order: { is: { terminalId } } } })) === refundsBefore
    ) {
      pass('对账只读：不改任何账本')
    } else {
      fail('reconciliation mutated ledger')
    }

    // 时间窗过滤：to=昨天应排除本次刚造的单
    const past = await svc.report({ to: new Date(Date.now() - 24 * 3600 * 1000).toISOString(), nowMs: Date.now() })
    if (mine(past.discrepancies).length === 0) pass('时间窗过滤：窗口外订单不进对账')
    else fail('time window filter leaked orders')

    console.log(`\n  ✅ verify:reconciliation 全部通过（${passCount} checks）\n`)
  } finally {
    await prisma.auditLog.deleteMany({ where: { targetId: { in: orderIds } } })
    await prisma.refund.deleteMany({ where: { orderId: { in: orderIds } } })
    await prisma.paymentAttempt.deleteMany({ where: { orderId: { in: orderIds } } })
    await prisma.order.deleteMany({ where: { terminalId } })
    await prisma.terminal.deleteMany({ where: { id: terminalId } })
    await prisma.onModuleDestroy()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
