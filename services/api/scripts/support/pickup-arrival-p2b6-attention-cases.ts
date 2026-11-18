/**
 * 收货疑点：成功的过期退款已经在待人工和告警里，订单列表「需关注」仍是空的。
 * 形状：过期退款 80 分已成功，当前这笔仍已付、任务失败、纸没出。
 * 已出纸的同形状不去向、也不进需关注。非过期的全额成功退款、订单仍显示已付，去向是自动退成功，不能标成待人工。
 * 没有退款行的已付失败单不靠这一条进需关注。
 */
import assert from 'node:assert/strict'
import { AdminOrdersReadonlyService } from '../../src/admin-orders-readonly/admin-orders-readonly.service'
import { collectPrintReturnAlerts } from '../../src/admin-ops/derived-print-return-alerts'
import { STALE_ATTEMPT_REFUND_REASON, PRINT_RETURN_MANUAL_TYPE } from '../../src/payment/print-no-paper-refund.constants'
import { explainPrintRefund, listPrintReturnHolds } from '../../src/payment/print-return-disposition'
import type { PrismaService } from '../../src/prisma/prisma.service'

const PAGES = JSON.stringify({ copies: 1, colorMode: 'black_white' })
const NO_RECORD_REASON = '已付款，打印失败，没有退款记录，待人工处理'

export async function runP2b6AttentionCases(
  db: PrismaService,
  input: { tag: string; orderIds: string[]; taskIds: string[] },
): Promise<void> {
  const tag = input.tag
  const orgId = `org_p2b6at_${tag}`
  const terminalId = `term_p2b6at_${tag}`
  await db.organization.create({ data: { id: orgId, name: '过期退款需关注', type: 'school_employment_center' } })
  await db.terminal.create({
    data: {
      id: terminalId,
      terminalCode: terminalId,
      agentToken: `tok-${terminalId}`,
      deviceFingerprint: `fp-${terminalId}`,
      orgId,
      enabled: true,
      lifecycleStatus: 'active',
    },
  })
  const created: string[] = []
  let n = 0

  const seed = async (opts: {
    suffix: string
    printOutcome: 'not_printed' | 'printed' | null
    taskStatus?: string
    refund?: { amountCents: number; status: 'success'; reason: string } | null
  }): Promise<{ id: string; orderNo: string }> => {
    n += 1
    const id = `ord_${tag}_p2b6at_${n}`
    const taskId = `pt_${id}`
    const orderNo = `A6${tag}${opts.suffix}${n}`.slice(0, 32)
    created.push(id)
    input.orderIds.push(id)
    input.taskIds.push(taskId)
    await db.printTask.create({
      data: {
        id: taskId,
        fileUrl: 'https://example.invalid/print',
        fileMd5: 'md5',
        status: 'failed',
        printOutcome: opts.printOutcome,
        errorCode: 'PAPER_JAM',
        orderId: id,
        terminalId,
      },
    })
    await db.order.create({
      data: {
        id,
        orderNo,
        type: 'print',
        terminalId,
        amountCents: 200,
        discountCents: 0,
        payStatus: 'paid',
        paymentSource: 'sandbox',
        paidAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        pickupStatus: 'pending',
        taskStatus: opts.taskStatus ?? 'failed',
        billablePages: 2,
        printParamsJson: PAGES,
        itemsJson: '[]',
        channel: 'kiosk',
        printTaskId: taskId,
      },
    })
    if (opts.refund) {
      await db.refund.create({
        data: {
          orderId: id,
          refundNo: `RFD-AT-${tag}-${n}`.slice(0, 40),
          amountCents: opts.refund.amountCents,
          status: opts.refund.status,
          reason: opts.refund.reason,
          channel: 'sandbox',
          createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
        },
      })
    }
    return { id, orderNo }
  }

  try {
    const stale = await seed({
      suffix: 'stale',
      printOutcome: 'not_printed',
      refund: { amountCents: 80, status: 'success', reason: STALE_ATTEMPT_REFUND_REASON },
    })
    const printed = await seed({
      suffix: 'out',
      printOutcome: 'printed',
      refund: { amountCents: 80, status: 'success', reason: STALE_ATTEMPT_REFUND_REASON },
    })
    const fullSuccess = await seed({
      suffix: 'full',
      printOutcome: 'not_printed',
      refund: { amountCents: 200, status: 'success', reason: '这一笔已经退完' },
    })
    const bare = await seed({ suffix: 'bare', printOutcome: 'not_printed', refund: null })

    const view = await explainPrintRefund(db, stale.id)
    assert.equal(view.disposition, 'manual')
    assert.equal(view.reason, NO_RECORD_REASON)
    assert.equal((await listPrintReturnHolds(db)).filter((hold) => hold.orderId === stale.id).length, 1)
    const alert = (await collectPrintReturnAlerts(db)).find((row) => row.subjectId === stale.id)
    assert.equal(alert?.type, PRINT_RETURN_MANUAL_TYPE)

    const orders = new AdminOrdersReadonlyService(db)
    const attention = await orders.list({ opsAttention: true, search: stale.orderNo, page: 1, pageSize: 20 })
    assert.equal(attention.pagination.total, 1, '成功的过期退款必须出现在需关注')
    assert.equal(attention.items[0]?.id, stale.id)
    assert.equal(attention.items[0]?.opsAttention, true)
    assert.equal(attention.items[0]?.opsAttentionCode, 'print_return_manual')
    const detail = await orders.getById(stale.id)
    assert.equal(detail.opsAttention, true)
    assert.equal(detail.opsAttentionCode, 'print_return_manual')

    const printedView = await explainPrintRefund(db, printed.id)
    assert.equal(printedView.disposition, null)
    const printedPage = await orders.list({ opsAttention: true, search: printed.orderNo, page: 1, pageSize: 20 })
    assert.equal(printedPage.pagination.total, 0, '已经出纸的不进需关注')

    const fullView = await explainPrintRefund(db, fullSuccess.id)
    assert.equal(fullView.disposition, 'auto_success')
    const fullPage = await orders.list({ opsAttention: true, search: fullSuccess.orderNo, page: 1, pageSize: 20 })
    assert.equal(fullPage.pagination.total, 0, '非过期的全额成功退款不能标成待人工')
    const fullDetail = await orders.getById(fullSuccess.id)
    assert.notEqual(fullDetail.opsAttentionCode, 'print_return_manual')

    const barePage = await orders.list({ opsAttention: true, search: bare.orderNo, page: 1, pageSize: 20 })
    assert.equal(barePage.pagination.total, 0, '没有退款行的已付失败单不靠这一条进需关注')
  } finally {
    await db.refund.deleteMany({ where: { orderId: { in: created } } })
    await db.auditLog.deleteMany({ where: { targetId: { in: created } } })
    await db.order.deleteMany({ where: { id: { in: created } } })
    await db.printTask.deleteMany({ where: { orderId: { in: created } } })
    await db.terminal.delete({ where: { id: terminalId } }).catch(() => undefined)
    await db.organization.delete({ where: { id: orgId } }).catch(() => undefined)
  }
}
