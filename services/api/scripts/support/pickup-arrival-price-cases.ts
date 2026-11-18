/**
 * 到机补价与明确没出纸自动退的规格用例。SQLite 与 PostgreSQL 共用。
 * 期望按任务包写：未付按本机价、0 元免费已付到收费机要先付、已付大于 0 不补不退、本机价 0 照旧。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { AuditService } from '../../src/audit/audit.service'
import { AdminOrdersReadonlyService } from '../../src/admin-orders-readonly/admin-orders-readonly.service'
import { collectPrintReturnAlerts } from '../../src/admin-ops/derived-print-return-alerts'
import type { PaymentProvider } from '../../src/payment/payment-provider.types'
import { PaymentProviderRegistry } from '../../src/payment/payment-provider.factory'
import { PAID_NO_PAPER_AUTO_REASON } from '../../src/payment/print-no-paper-refund.constants'
import {
  settleExplicitNoPaper,
  settleExplicitNoPaperFromReportedFailure,
} from '../../src/payment/print-no-paper-refund'
import { PAID_UNFULFILLED_PENDING_REFUND_REASON } from '../../src/payment/pending-refund-signal'
import { RefundService } from '../../src/payment/refund.service'
import { PERSONAL_CHARGE_SETTING_KEY } from '../../src/payment/terminal-charge.contract'
import type { PrismaService } from '../../src/prisma/prisma.service'
import {
  ARRIVAL_CLAIM_WON_AUDIT,
  ARRIVAL_REPRICE_AUDIT,
  settlePickupArrival,
} from '../../src/print-jobs/pickup-arrival-price'
import {
  PAPER_EMPTY_ERROR_CODE,
  PARTIAL_OUTPUT_ERROR_CODE,
  PRINT_JOB_UNCONFIRMED_ERROR_CODE,
  PRINTING_REPORT_LOST_ERROR_CODE,
} from '../../src/print-jobs/paid-anomaly-disposition'
import { runArrivalHoldCases } from './pickup-arrival-hold-cases'
import { assertArrivalQuoteAmounts } from './pickup-arrival-quote-cases'
import { runArrivalMoneyCases } from './pickup-arrival-money-cases'
import { runNoPaperAllowlistCases } from './pickup-arrival-no-paper-allowlist-cases'
import {
  restoreTerminalChargeFixture,
  setTerminalUserPrintPrices,
} from './terminal-charge-fixture'

const API_ROOT = resolve(__dirname, '../..')
const PAGES = JSON.stringify({ copies: 1, colorMode: 'black_white' })

function source(relativePath: string): string {
  return readFileSync(resolve(API_ROOT, relativePath), 'utf8')
}

function assertWiring(): void {
  assert.match(source('src/print-jobs/pickup-order.service.ts'), /settlePickupArrival\(/)
  assert.match(
    source('src/print-jobs/pickup-order.service.ts'),
    /order\.terminalId && order\.terminalId !== terminal\.id/,
  )
  assert.match(
    source('src/member-print-orders/member-order-claim-here.service.ts'),
    /order\.terminalId && order\.terminalId !== terminal\.id/,
  )
  assert.match(source('src/print-jobs/print-queue-timeout.ts'), /settleExplicitNoPaperFromReportedFailure\(/)
  assert.match(source('src/terminals/terminals-agent.service.ts'), /settleExplicitNoPaperFromReportedFailure\(/)
  assert.match(source('src/payment/print-no-paper-refund.ts'), /if \(!enabled\)[\s\S]{0,500}return 'signaled'/)
  assert.match(source('src/payment/print-no-paper-refund.ts'), /EXPLICIT_NO_PAPER_ERROR_CODES\.has\(errorCode\)/)
  assert.match(source('src/payment/print-no-paper-refund.ts'), /reason: PAID_NO_PAPER_AUTO_REASON/)
}

export async function runPickupArrivalPriceCases(db: PrismaService, tag: string): Promise<void> {
  assertWiring()
  assertArrivalQuoteAmounts()
  const orgId = `org_${tag}`
  const publicOrgId = `org_pub_${tag}`
  const pricedTerminalId = `term_priced_${tag}`
  const zeroTerminalId = `term_zero_${tag}`
  const publicTerminalId = `term_public_${tag}`
  const otherTerminalId = `term_other_${tag}`
  const orderIds: string[] = []
  const taskIds: string[] = []

  const createdOrders = async (input: {
    suffix: string
    terminalId?: string | null
    amountCents: number
    payStatus: string
    paymentSource?: string | null
    billablePages?: number | null
    printParamsJson?: string
    taskStatus?: string
  }): Promise<string> => {
    const id = `ord_${tag}_${input.suffix}`
    await db.order.create({
      data: {
        id,
        orderNo: `NO${tag}${input.suffix}`.slice(0, 40),
        type: 'print',
        terminalId: input.terminalId === undefined ? pricedTerminalId : input.terminalId,
        amountCents: input.amountCents,
        payStatus: input.payStatus,
        paymentSource: input.paymentSource ?? null,
        paidAt: input.payStatus === 'paid' ? new Date('2026-11-17T01:00:00Z') : null,
        pickupStatus: 'pending',
        taskStatus: input.taskStatus ?? (input.payStatus === 'paid' ? 'pending' : 'awaiting_payment'),
        billablePages: input.billablePages === undefined ? 2 : input.billablePages,
        printParamsJson: input.printParamsJson ?? PAGES,
        itemsJson: '[]',
        discountCents: 0,
        channel: 'miniapp_cloud',
      },
    })
    orderIds.push(id)
    return id
  }

  const attachTask = async (
    orderId: string,
    errorCode: string | null,
    options?: { completed?: boolean; printOutcome?: string | null },
  ): Promise<string> => {
    const taskId = `pt_${orderId}`
    await db.printTask.create({
      data: {
        id: taskId,
        fileUrl: 'https://example.invalid/print',
        fileMd5: 'md5',
        status: 'failed',
        errorCode,
        printOutcome: options?.printOutcome ?? null,
        orderId,
      },
    })
    taskIds.push(taskId)
    await db.order.update({
      where: { id: orderId },
      data: { printTaskId: taskId, taskStatus: 'failed', pickupStatus: 'used' },
    })
    if (options?.completed) {
      await db.orderItem.create({
        data: {
          orderId,
          seq: 0,
          fileId: `file_${orderId}`,
          colorMode: 'black_white',
          duplex: 'simplex',
          copies: 1,
          billablePages: 1,
          amountCents: 100,
          status: 'completed',
        },
      })
    }
    return taskId
  }

  try {
    await db.organization.create({ data: { id: orgId, name: '到机补价学校', type: 'school_employment_center' } })
    await db.organization.create({ data: { id: publicOrgId, name: '到机补价公共点', type: 'public_employment_service' } })
    for (const [id, org] of [
      [pricedTerminalId, orgId],
      [zeroTerminalId, orgId],
      [publicTerminalId, publicOrgId],
      [otherTerminalId, orgId],
    ] as const) {
      await db.terminal.create({
        data: {
          id,
          terminalCode: id,
          agentToken: `tok-${id}`,
          deviceFingerprint: `fp-${id}`,
          orgId: org,
          enabled: true,
          lifecycleStatus: 'active',
        },
      })
    }
    await setTerminalUserPrintPrices(db, pricedTerminalId, { print_bw_page: 100, print_color_page: 300 })
    await setTerminalUserPrintPrices(db, publicTerminalId, { print_bw_page: 100, print_color_page: 300 })
    await setTerminalUserPrintPrices(db, otherTerminalId, { print_bw_page: 100, print_color_page: 300 })

    const unpaidId = await createdOrders({ suffix: 'unpaid', amountCents: 0, payStatus: 'unpaid' })
    await db.paymentAttempt.create({
      data: { id: `pa_${unpaidId}`, orderId: unpaidId, channel: 'sandbox', amountCents: 0, status: 'pending' },
    })
    const unpaid = await settlePickupArrival(db, { orderId: unpaidId, terminalId: pricedTerminalId })
    assert.equal(unpaid.kind, 'pay', '未付应按本机价进入付款，不放行')
    assert.equal(unpaid.notice, true)
    assert.equal(unpaid.arrivalCents, 200)
    const unpaidRow = await db.order.findUniqueOrThrow({ where: { id: unpaidId } })
    assert.equal(unpaidRow.amountCents, 200, '未付订单金额要改成本机价')
    assert.equal(unpaidRow.payStatus, 'unpaid')
    const reprice = await db.auditLog.findMany({ where: { targetId: unpaidId, action: ARRIVAL_REPRICE_AUDIT } })
    assert.equal(reprice.length, 1)
    const repricePayload = JSON.parse(reprice[0]?.payloadJson ?? '{}') as { fromAmountCents?: number; toAmountCents?: number; reason?: string }
    assert.equal(repricePayload.fromAmountCents, 0)
    assert.equal(repricePayload.toAmountCents, 200)
    assert.equal(repricePayload.reason, 'unpaid_reprice')
    const attempt = await db.paymentAttempt.findUniqueOrThrow({ where: { id: `pa_${unpaidId}` } })
    assert.equal(attempt.status, 'expired')

    const freeId = await createdOrders({
      suffix: 'free',
      amountCents: 0,
      payStatus: 'paid',
      paymentSource: 'free',
    })
    const free = await settlePickupArrival(db, { orderId: freeId, terminalId: pricedTerminalId })
    assert.equal(free.kind, 'pay', '0 元免费已付到收费机不能直接放行')
    assert.equal(free.notice, true)
    assert.equal(free.arrivalCents, 200)
    const freeRow = await db.order.findUniqueOrThrow({ where: { id: freeId } })
    assert.equal(freeRow.payStatus, 'unpaid')
    assert.equal(freeRow.amountCents, 200)
    assert.equal(freeRow.paymentSource, null)
    assert.equal(freeRow.paidAt, null)
    assert.equal(freeRow.printTaskId, null)

    const paidId = await createdOrders({
      suffix: 'paid',
      amountCents: 200,
      payStatus: 'paid',
      paymentSource: 'offline',
    })
    const paid = await settlePickupArrival(db, { orderId: paidId, terminalId: pricedTerminalId })
    assert.equal(paid.kind, 'release', '已按大于 0 付过的单照旧放行')
    assert.equal(paid.notice, false)
    const paidRow = await db.order.findUniqueOrThrow({ where: { id: paidId } })
    assert.equal(paidRow.amountCents, 200, '已付大于 0 不补不退')
    assert.equal(paidRow.payStatus, 'paid')
    assert.equal(await db.auditLog.count({ where: { targetId: paidId, action: ARRIVAL_REPRICE_AUDIT } }), 0)

    const zeroId = await createdOrders({
      suffix: 'zero',
      terminalId: zeroTerminalId,
      amountCents: 0,
      payStatus: 'paid',
      paymentSource: 'free',
    })
    const zero = await settlePickupArrival(db, { orderId: zeroId, terminalId: zeroTerminalId })
    assert.equal(zero.kind, 'release', '本机价 0 时免费已付照旧放行')
    assert.equal(zero.notice, false)
    assert.equal(zero.arrivalCents, 0)
    const zeroRow = await db.order.findUniqueOrThrow({ where: { id: zeroId } })
    assert.equal(zeroRow.amountCents, 0)
    assert.equal(zeroRow.payStatus, 'paid')
    assert.equal(zeroRow.paymentSource, 'free')

    const publicId = await createdOrders({
      suffix: 'public',
      terminalId: publicTerminalId,
      amountCents: 0,
      payStatus: 'paid',
      paymentSource: 'free',
    })
    const publicArrival = await settlePickupArrival(db, { orderId: publicId, terminalId: publicTerminalId })
    assert.equal(publicArrival.kind, 'release', '公共就业点位永远按 0，免费已付照旧放行')
    assert.equal(publicArrival.arrivalCents, 0)
    const publicRow = await db.order.findUniqueOrThrow({ where: { id: publicId } })
    assert.equal(publicRow.amountCents, 0)
    assert.equal(publicRow.payStatus, 'paid')

    const blankId = await createdOrders({
      suffix: 'blank',
      terminalId: null,
      amountCents: 0,
      payStatus: 'unpaid',
      billablePages: null,
      printParamsJson: '{}',
    })
    const blank = await settlePickupArrival(db, { orderId: blankId, terminalId: pricedTerminalId })
    assert.equal(blank.kind, 'unpriced')
    const blankRow = await db.order.findUniqueOrThrow({ where: { id: blankId } })
    assert.equal(blankRow.terminalId, null, '算不出价格不能把单绑死在这台机器上')
    assert.equal(blankRow.amountCents, 0)

    const raceId = await createdOrders({
      suffix: 'race',
      terminalId: null,
      amountCents: 200,
      payStatus: 'paid',
      paymentSource: 'offline',
    })
    const [first, second] = await Promise.all([
      settlePickupArrival(db, { orderId: raceId, terminalId: pricedTerminalId }),
      settlePickupArrival(db, { orderId: raceId, terminalId: otherTerminalId }),
    ])
    const releases = [first, second].filter((item) => item.kind === 'release')
    assert.equal(releases.length, 1, '两台机器同时核同一单只能有一台放行')
    assert.equal([first, second].filter((item) => item.kind === 'lost').length, 1)
    assert.equal(
      await db.auditLog.count({ where: { targetId: raceId, action: ARRIVAL_CLAIM_WON_AUDIT } }),
      1,
      '并发抢占只记一条审计',
    )

    const explicitId = await createdOrders({
      suffix: 'explicit',
      amountCents: 200,
      payStatus: 'paid',
      paymentSource: 'offline',
      taskStatus: 'failed',
    })
    const explicitTask = await attachTask(explicitId, 'PRINT_QUEUE_TIMEOUT')
    const explicit = await settleExplicitNoPaperFromReportedFailure(db, explicitTask)
    assert.equal(explicit, 'refunded', '明确没出纸要自动原路退一次')
    const explicitRefunds = await db.refund.findMany({ where: { orderId: explicitId, reason: PAID_NO_PAPER_AUTO_REASON } })
    assert.equal(explicitRefunds.length, 1)
    assert.equal(explicitRefunds[0]?.status, 'success')
    const explicitReturnAudit = JSON.parse(
      (await db.auditLog.findFirstOrThrow({ where: { targetId: explicitId, action: 'print_order.auto_return' } })).payloadJson ?? '{}',
    ) as { refundNo?: string; amountCents?: number }
    assert.equal(explicitReturnAudit.refundNo, explicitRefunds[0]?.refundNo)
    assert.equal(explicitReturnAudit.amountCents, 200)
    const explicitAgain = await settleExplicitNoPaperFromReportedFailure(db, explicitTask)
    assert.notEqual(explicitAgain, 'refunded')
    assert.equal(await db.refund.count({ where: { orderId: explicitId } }), 1)

    await runNoPaperAllowlistCases(db, {
      tag,
      terminalId: pricedTerminalId,
      orderIds,
      taskIds,
    })

    const repeatId = await createdOrders({
      suffix: 'repeat',
      amountCents: 200,
      payStatus: 'paid',
      paymentSource: 'offline',
      taskStatus: 'failed',
    })
    await attachTask(repeatId, 'FILE_NOT_FOUND')
    let refundCalls = 0
    const repeatOrder = await db.order.findUniqueOrThrow({ where: { id: repeatId } })
    const countingRefund = {
      refund: async (orderId: string) => {
        refundCalls += 1
        await db.refund.create({
          data: {
            orderId,
            refundNo: `RFD-${repeatOrder.orderNo}`,
            amountCents: 200,
            status: 'success',
            reason: PAID_NO_PAPER_AUTO_REASON,
            channel: 'offline',
          },
        }).catch(() => undefined)
        return {
          refund: {
            refundNo: `RFD-${repeatOrder.orderNo}`,
            amountCents: 200,
            status: 'success' as const,
            channel: 'offline',
            channelRefundNo: null,
            reason: PAID_NO_PAPER_AUTO_REASON,
            createdAt: new Date().toISOString(),
          },
          order: { orderNo: repeatOrder.orderNo, payStatus: 'paid', refundedAmountCents: 0, refundedAt: null },
          idempotent: false,
        }
      },
    }
    assert.equal(await settleExplicitNoPaperFromReportedFailure(db, `pt_${repeatId}`, { refund: countingRefund }), 'refunded')
    assert.equal(await settleExplicitNoPaperFromReportedFailure(db, `pt_${repeatId}`, { refund: countingRefund }), 'idempotent')
    assert.equal(refundCalls, 1, '重复回调只调用一次退款')

    const manualReason: Record<string, string> = {
      unconfirmed: '出纸结果未确认，不能自动退',
      'lost-report': '打印过程中报告丢失，不能自动退',
      'partial-code': '只出了一部分纸，不能自动退',
      paper: '打印机缺纸，没有自动退',
      'empty-code': '打印失败但没有错误码，不能确定有没有出纸，不能自动退',
    }
    for (const [suffix, errorCode] of [
      ['unconfirmed', PRINT_JOB_UNCONFIRMED_ERROR_CODE],
      ['lost-report', PRINTING_REPORT_LOST_ERROR_CODE],
      ['partial-code', PARTIAL_OUTPUT_ERROR_CODE],
      ['paper', PAPER_EMPTY_ERROR_CODE],
      ['empty-code', null],
    ] as const) {
      const id = await createdOrders({
        suffix,
        amountCents: 200,
        payStatus: 'paid',
        paymentSource: 'offline',
        taskStatus: 'failed',
      })
      await attachTask(id, errorCode)
      let calls = 0
      const outcome = await settleExplicitNoPaperFromReportedFailure(db, `pt_${id}`, {
        refund: { refund: async () => { calls += 1; throw new Error('不应退款') } },
      })
      assert.equal(outcome, 'manual', `${suffix} 不能自动退，要进待人工`)
      assert.equal(calls, 0)
      assert.equal(await db.refund.count({ where: { orderId: id } }), 0)
      const row = await db.order.findUniqueOrThrow({ where: { id } })
      assert.equal(row.refundReason, null, '缺纸和说不准不写成文件失效待退款')
      const detail = await new AdminOrdersReadonlyService(db).getById(id)
      assert.equal(detail.printRefundDisposition, 'manual')
      assert.equal(detail.autoRefund, false)
      assert.equal(detail.printRefundReason, manualReason[suffix])
      const held = (await collectPrintReturnAlerts(db)).find((alert) => alert.subjectId === id)
      assert.equal(held?.detail, manualReason[suffix])
      assert.equal(held?.terminalCode, pricedTerminalId)
    }

    const partialId = await createdOrders({
      suffix: 'partial-item',
      amountCents: 200,
      payStatus: 'paid',
      paymentSource: 'offline',
      taskStatus: 'failed',
    })
    await attachTask(partialId, 'PRINT_COMMAND_FAILED')
    for (const [seq, status] of [[0, 'completed'], [1, 'failed'], [2, 'failed']] as const) {
      await db.orderItem.create({
        data: {
          orderId: partialId,
          seq,
          fileId: `file_${partialId}_${seq}`,
          colorMode: 'black_white',
          duplex: 'simplex',
          copies: 1,
          billablePages: 1,
          amountCents: 100,
          status,
        },
      })
    }
    let partialCalls = 0
    const partial = await settleExplicitNoPaperFromReportedFailure(db, `pt_${partialId}`, {
      refund: { refund: async () => { partialCalls += 1; throw new Error('部分出纸不应退款') } },
    })
    assert.equal(partial, 'manual', '三份里出了一份不能自动退')
    assert.equal(partialCalls, 0)
    assert.equal(
      (await db.order.findUniqueOrThrow({ where: { id: partialId } })).refundReason,
      null,
      '部分出纸不写成文件失效待退款',
    )
    const partialReason = '材料包 3 份里出了 1 份，没有全部出纸，不能自动退'
    const partialDetail = await new AdminOrdersReadonlyService(db).getById(partialId)
    assert.equal(partialDetail.printRefundDisposition, 'manual')
    assert.equal(partialDetail.autoRefund, false)
    assert.equal(partialDetail.printRefundReason, partialReason)
    assert.equal(
      (await collectPrintReturnAlerts(db)).find((alert) => alert.subjectId === partialId)?.detail,
      partialReason,
    )

    const failedId = await createdOrders({
      suffix: 'fail',
      amountCents: 200,
      payStatus: 'paid',
      paymentSource: 'sandbox',
      taskStatus: 'failed',
    })
    await attachTask(failedId, 'DOWNLOAD_HASH_MISMATCH')
    const failedProvider = {
      channel: 'sandbox',
      refund: async () => ({ status: 'failed' as const, channelRefundNo: null }),
    } as PaymentProvider
    const failedRefund = new RefundService(db, new AuditService(db), new PaymentProviderRegistry([failedProvider]))
    const failed = await settleExplicitNoPaperFromReportedFailure(db, `pt_${failedId}`, { refund: failedRefund })
    assert.equal(failed, 'failed')
    const failedOrder = await db.order.findUniqueOrThrow({ where: { id: failedId } })
    assert.equal(failedOrder.payStatus, 'paid', '渠道退款失败后订单回到已付款')
    const failedRow = await db.refund.findFirst({ where: { orderId: failedId, reason: PAID_NO_PAPER_AUTO_REASON } })
    assert.equal(failedRow?.status, 'failed')
    const failedAudit = JSON.parse(
      (await db.auditLog.findFirstOrThrow({
        where: { targetId: failedId, action: 'print_order.auto_return_failed' },
      })).payloadJson ?? '{}',
    ) as { code?: string; refundNo?: string }
    assert.equal(failedAudit.code, 'REFUND_CHANNEL_FAILED')
    assert.equal(failedAudit.refundNo, failedRow?.refundNo)
    const channelFailedReason = '退款渠道返回失败（REFUND_CHANNEL_FAILED），没有退成'
    const alerts = await collectPrintReturnAlerts(db)
    assert.ok(alerts.some((alert) => alert.type === 'print_return_manual' && alert.subjectId === failedId && alert.detail === channelFailedReason))
    const detail = await new AdminOrdersReadonlyService(db).getById(failedId)
    assert.equal(detail.autoRefund, true)
    assert.equal(detail.printRefundDisposition, 'auto_failed')
    assert.equal(detail.refundStatus, 'failed')
    assert.equal(detail.refundFailureReason, channelFailedReason)
    assert.equal(detail.printRefundReason, channelFailedReason)

    await runArrivalMoneyCases(db, {
      tag,
      terminalId: pricedTerminalId,
      orderIds,
      taskIds,
    })
    await runArrivalHoldCases(db, {
      tag,
      pricedTerminalId,
      zeroTerminalId,
      publicTerminalId,
      otherTerminalId,
      orderIds,
    })

    await db.platformSetting.upsert({
      where: { key: PERSONAL_CHARGE_SETTING_KEY },
      create: { key: PERSONAL_CHARGE_SETTING_KEY, value: 'false' },
      update: { value: 'false' },
    })
    const offId = await createdOrders({
      suffix: 'off',
      amountCents: 200,
      payStatus: 'paid',
      paymentSource: 'offline',
      taskStatus: 'failed',
    })
    await attachTask(offId, 'PRINT_QUEUE_TIMEOUT')
    let offCalls = 0
    const off = await settleExplicitNoPaper(db, {
      orderId: offId,
      taskStatus: 'failed',
      errorCode: 'PRINT_QUEUE_TIMEOUT',
      printOutcome: null,
      completedItemCount: 0,
    }, {
      refund: { refund: async () => { offCalls += 1; throw new Error('开关关着不能退') } },
    })
    assert.equal(off, 'signaled', '个人收费总开关关时只落待退款信号')
    assert.equal(offCalls, 0)
    const offRow = await db.order.findUniqueOrThrow({ where: { id: offId } })
    assert.equal(offRow.refundReason, PAID_UNFULFILLED_PENDING_REFUND_REASON)
    assert.equal(offRow.payStatus, 'paid')
    assert.equal(await db.refund.count({ where: { orderId: offId } }), 0)
    const switchOffReason = '个人收费总开关关着，没有发起自动退款'
    const offDetail = await new AdminOrdersReadonlyService(db).getById(offId)
    assert.equal(offDetail.printRefundDisposition, 'manual')
    assert.equal(offDetail.autoRefund, false)
    assert.equal(offDetail.printRefundReason, switchOffReason)
    const offAlert = (await collectPrintReturnAlerts(db)).find((alert) => alert.subjectId === offId)
    assert.equal(offAlert?.detail, switchOffReason)
    assert.equal(offAlert?.terminalCode, pricedTerminalId)
  } finally {
    await db.refund.deleteMany({ where: { orderId: { in: orderIds } } })
    await db.paymentAttempt.deleteMany({ where: { orderId: { in: orderIds } } })
    await db.orderItem.deleteMany({ where: { orderId: { in: orderIds } } })
    await db.order.deleteMany({ where: { id: { in: orderIds } } })
    await db.printTask.deleteMany({ where: { id: { in: taskIds } } })
    await db.auditLog.deleteMany({ where: { targetId: { in: orderIds } } })
    await restoreTerminalChargeFixture(db)
    await db.terminal.deleteMany({
      where: { id: { in: [pricedTerminalId, zeroTerminalId, publicTerminalId, otherTerminalId] } },
    })
    await db.organization.deleteMany({ where: { id: { in: [orgId, publicOrgId] } } })
  }
}
