/**
 * Admin orders read-only verification.
 *
 * This verifies the safe admin order surface:
 * - list/read only Order data, with page/pageSize pagination and filters
 * - no fileUrl/fileMd5/paramsJson/errorMessage/endUserId/terminalId leakage
 * - print metadata is extracted from PrintTask.paramsJson using a whitelist
 * - no payment/refund/status mutation methods are exposed by the service
 *
 * Run: pnpm --filter @ai-job-print/api verify:admin-orders-readonly
 */
import 'dotenv/config'
import { randomUUID } from 'crypto'
import { PrismaService } from '../src/prisma/prisma.service'
import { AdminOrdersReadonlyService } from '../src/admin-orders-readonly/admin-orders-readonly.service'
import { PAID_UNFULFILLED_PENDING_REFUND_REASON } from '../src/payment/pending-refund-signal'

function pass(message: string): void {
  console.log(`  PASS ${message}`)
}

function fail(message: string): never {
  throw new Error(message)
}

async function main(): Promise<void> {
  console.log('\n=== Admin orders read-only verification ===')

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const service = new AdminOrdersReadonlyService(prisma)

  const suffix = randomUUID().replace(/-/g, '').slice(0, 10)
  const terminalId = `t_aor_${suffix}`
  const terminalCode = `KSK-AOR-${suffix}`
  const endUserId = `eu_aor_${suffix}`
  const taskId = `ptask_aor_${suffix}`
  const brokenTaskId = `ptask_aor_broken_${suffix}`
  const unconfirmedTaskId = `ptask_aor_unconfirmed_${suffix}`
  const printedTaskId = `ptask_aor_printed_${suffix}`
  const notPrintedTaskId = `ptask_aor_notp_${suffix}`
  const orderId = `ord_aor_${suffix}`
  const brokenOrderId = `ord_aor_broken_${suffix}`
  const unconfirmedOrderId = `ord_aor_unconfirmed_${suffix}`
  const printedOrderId = `ord_aor_printed_${suffix}`
  const notPrintedOrderId = `ord_aor_notp_${suffix}`
  const orderNo = `ORD-READ-${suffix.toUpperCase()}`
  const brokenOrderNo = `ORD-READ-B-${suffix.toUpperCase()}`
  const unconfirmedOrderNo = `ORD-READ-U-${suffix.toUpperCase()}`
  const printedOrderNo = `ORD-READ-P-${suffix.toUpperCase()}`
  const notPrintedOrderNo = `ORD-READ-N-${suffix.toUpperCase()}`

  async function cleanup(): Promise<void> {
    const leftoverTasks = await prisma.printTask.findMany({
      where: { id: { startsWith: 'ptask_aor_' } },
      select: { id: true },
    })
    const taskIds = [...new Set([taskId, brokenTaskId, unconfirmedTaskId, printedTaskId, notPrintedTaskId, ...leftoverTasks.map((task) => task.id)])]
    await prisma.order.deleteMany({
      where: { OR: [{ id: { in: [orderId, brokenOrderId, unconfirmedOrderId, printedOrderId, notPrintedOrderId] } }, { orderNo: { startsWith: 'ORD-READ' } }] },
    })
    await prisma.printTaskStatusLog.deleteMany({ where: { taskId: { in: taskIds } } })
    await prisma.printTask.deleteMany({ where: { id: { in: taskIds } } })
    await prisma.terminal.deleteMany({ where: { id: { startsWith: 't_aor_' } } })
    await prisma.endUser.deleteMany({ where: { id: { startsWith: 'eu_aor_' } } })
  }

  try {
    await cleanup()

    await prisma.terminal.create({
      data: {
        id: terminalId,
        terminalCode,
        agentToken: `tok_aor_${suffix}`,
        deviceFingerprint: 'verify-admin-orders-readonly',
      },
    })
    await prisma.endUser.create({
      data: {
        id: endUserId,
        phoneHash: `aor-${endUserId}`,
        phoneEnc: `aor-enc-${endUserId}`,
        nickname: '只读订单会员',
      },
    })
    await prisma.printTask.create({
      data: {
        id: taskId,
        terminalId,
        endUserId,
        fileUrl: 'https://internal.example/secret-file-url',
        fileMd5: 'sha256-secret-md5',
        paramsJson: JSON.stringify({
          fileName: '只读订单验证.pdf',
          copies: 3,
          colorMode: 'color',
          duplex: 'simplex',
          paperSize: 'A4',
          pageRange: '1-2',
          unsafeField: 'must-not-leak',
        }),
        status: 'completed',
        completedAt: new Date('2026-06-25T01:30:00.000Z'),
        errorCode: null,
        errorMessage: 'internal error details must not leak',
      },
    })
    await prisma.printTaskStatusLog.createMany({
      data: [
        { taskId, fromStatus: 'pending', toStatus: 'claimed', errorCode: null, createdAt: new Date('2026-06-25T01:00:00.000Z') },
        { taskId, fromStatus: 'claimed', toStatus: 'completed', errorCode: null, createdAt: new Date('2026-06-25T01:30:00.000Z') },
      ],
    })
    await prisma.order.create({
      data: {
        id: orderId,
        orderNo,
        type: 'print',
        printTaskId: taskId,
        endUserId,
        terminalId,
        amountCents: 0,
        currency: 'CNY',
        payStatus: 'unpaid',
        taskStatus: 'completed',
      },
    })
    await prisma.printTask.create({
      data: {
        id: unconfirmedTaskId,
        fileUrl: 'https://internal.example/unconfirmed',
        fileMd5: 'sha256-unconfirmed',
        paramsJson: JSON.stringify({ fileName: '待人工核查.pdf', copies: 1, colorMode: 'black_white', paperSize: 'A4' }),
        status: 'failed',
        errorCode: 'PRINT_JOB_UNCONFIRMED',
        errorMessage: 'internal unconfirmed trace must not leak',
      },
    })
    await prisma.order.create({
      data: {
        id: unconfirmedOrderId,
        orderNo: unconfirmedOrderNo,
        type: 'print',
        printTaskId: unconfirmedTaskId,
        amountCents: 300,
        currency: 'CNY',
        payStatus: 'paid',
        taskStatus: 'failed',
      },
    })
    await prisma.printTask.create({
      data: {
        id: printedTaskId,
        fileUrl: 'https://internal.example/printed',
        fileMd5: 'sha256-printed',
        paramsJson: JSON.stringify({ fileName: '已核查已出纸.pdf', copies: 1, colorMode: 'black_white', paperSize: 'A4' }),
        status: 'failed',
        errorCode: 'PRINT_JOB_UNCONFIRMED',
        printOutcome: 'printed',
      },
    })
    await prisma.order.create({
      data: {
        id: printedOrderId,
        orderNo: printedOrderNo,
        type: 'print',
        printTaskId: printedTaskId,
        amountCents: 300,
        currency: 'CNY',
        payStatus: 'paid',
        taskStatus: 'failed',
      },
    })
    await prisma.printTask.create({
      data: {
        id: notPrintedTaskId,
        fileUrl: 'https://internal.example/not-printed',
        fileMd5: 'sha256-not-printed',
        paramsJson: JSON.stringify({ fileName: '已核查未出纸.pdf', copies: 1, colorMode: 'black_white', paperSize: 'A4' }),
        status: 'failed',
        errorCode: 'PRINT_JOB_UNCONFIRMED',
        printOutcome: 'not_printed',
      },
    })
    await prisma.order.create({
      data: {
        id: notPrintedOrderId,
        orderNo: notPrintedOrderNo,
        type: 'print',
        printTaskId: notPrintedTaskId,
        amountCents: 300,
        currency: 'CNY',
        payStatus: 'paid',
        taskStatus: 'failed',
      },
    })

    await prisma.printTask.create({
      data: {
        id: brokenTaskId,
        fileUrl: 'https://internal.example/broken',
        fileMd5: 'sha256-broken',
        paramsJson: '{broken json',
        status: 'failed',
        errorCode: 'PRINTER_OFFLINE',
        errorMessage: 'printer internal trace must not leak',
      },
    })
    await prisma.order.create({
      data: {
        id: brokenOrderId,
        orderNo: brokenOrderNo,
        type: 'print',
        printTaskId: brokenTaskId,
        amountCents: 0,
        currency: 'CNY',
        payStatus: 'unpaid',
        taskStatus: 'failed',
      },
    })
    pass('fixtures created')

    const page = await service.list({ search: 'ORD-READ', page: 1, pageSize: 10 })
    const item = page.items.find((o) => o.id === orderId)
    const brokenItem = page.items.find((o) => o.id === brokenOrderId)
    if (
      page.pagination.total >= 2 &&
      item?.orderNo === orderNo &&
      item.userLabel === '只读订单会员' &&
      item.ownerType === 'member' &&
      item.terminalCode === terminalCode &&
      item.printFileName === '只读订单验证.pdf' &&
      item.copies === 3 &&
      item.colorMode === 'color' &&
      brokenItem?.printFileName === null &&
      brokenItem.ownerType === 'anonymous'
    ) {
      pass('list returns safe order rows with labels, print metadata, pagination, and broken params fallback')
    } else {
      fail(`list mismatch: ${JSON.stringify(page)}`)
    }

    const failedOnly = await service.list({ taskStatus: 'failed', search: brokenOrderNo, page: 1, pageSize: 10 })
    if (failedOnly.pagination.total === 1 && failedOnly.items[0]?.id === brokenOrderId) {
      pass('taskStatus/search filters work')
    } else {
      fail(`filter mismatch: ${JSON.stringify(failedOnly)}`)
    }

    const unconfirmedItem = (await service.list({ payStatus: 'paid', taskStatus: 'failed', search: unconfirmedOrderNo, page: 1, pageSize: 10 })).items[0]
    if (
      unconfirmedItem?.id !== unconfirmedOrderId ||
      unconfirmedItem.aftercareStatus !== 'manual_check_required' ||
      unconfirmedItem.refundEligible !== true ||
      unconfirmedItem.retryForbidden !== true ||
      unconfirmedItem.printOutcome !== null
    ) {
      fail(`paid+failed+PRINT_JOB_UNCONFIRMED 必须派生人工核查/可退款/禁重试：${JSON.stringify(unconfirmedItem)}`)
    }
    const printedItem = (await service.list({ payStatus: 'paid', taskStatus: 'failed', search: printedOrderNo, page: 1, pageSize: 10 })).items[0]
    if (
      printedItem?.printOutcome !== 'printed' ||
      printedItem.aftercareStatus !== null ||
      printedItem.refundEligible !== false ||
      printedItem.retryForbidden !== true
    ) {
      fail(`已核查已出纸必须清红条、禁退款、仍禁重试：${JSON.stringify(printedItem)}`)
    }
    const notPrintedItem = (await service.list({ payStatus: 'paid', taskStatus: 'failed', search: notPrintedOrderNo, page: 1, pageSize: 10 })).items[0]
    if (
      notPrintedItem?.printOutcome !== 'not_printed' ||
      notPrintedItem.aftercareStatus !== null ||
      notPrintedItem.refundEligible !== true ||
      notPrintedItem.retryForbidden !== true ||
      notPrintedItem.refundRequired !== false
    ) {
      fail(`已核查未出纸必须清红条、可退款、仍禁重试、未标待退款信号：${JSON.stringify(notPrintedItem)}`)
    }
    const unconfirmedDetail = await service.getById(unconfirmedOrderId)
    if (
      unconfirmedDetail.aftercareStatus !== 'manual_check_required' ||
      !unconfirmedDetail.refundEligible ||
      !unconfirmedDetail.retryForbidden
    ) {
      fail(`订单详情派生售后字段不一致：${JSON.stringify(unconfirmedDetail)}`)
    }
    if (item?.aftercareStatus !== null || item?.refundEligible || item?.retryForbidden || item?.refundRequired) {
      fail('普通未支付订单不得误派生 Gate 0.3B 售后资格')
    }
    pass('list/detail 服务端派生 paid+failed+unconfirmed 售后字段，其他订单 fail-closed')

    await prisma.order.update({
      where: { id: notPrintedOrderId },
      data: { refundReason: PAID_UNFULFILLED_PENDING_REFUND_REASON },
    })
    const markedPage = await service.list({ refundRequired: true, search: notPrintedOrderNo, page: 1, pageSize: 10 })
    if (
      markedPage.pagination.total !== 1 ||
      markedPage.items[0]?.id !== notPrintedOrderId ||
      markedPage.items[0]?.refundRequired !== true
    ) {
      fail(`refundRequired 筛选必须只返回已标记待退款的已付款单：${JSON.stringify(markedPage)}`)
    }
    pass('refundRequired 筛选返回已标记待退款的已付款未出纸单')

    const detail = await service.getById(orderId)
    if (
      detail.id === orderId &&
      detail.print?.fileName === '只读订单验证.pdf' &&
      detail.print.pageRange === '1-2' &&
      detail.print.status === 'completed' &&
      detail.statusLogs.length === 2 &&
      detail.statusLogs[1]?.toStatus === 'completed'
    ) {
      pass('detail returns whitelisted print detail and status logs')
    } else {
      fail(`detail mismatch: ${JSON.stringify(detail)}`)
    }

    const serialized = JSON.stringify({ page, detail })
    for (const banned of [
      'secret-file-url',
      'sha256-secret-md5',
      'paramsJson',
      'fileUrl',
      'fileMd5',
      'errorMessage',
      'internal error details',
      'printer internal trace',
      'internal unconfirmed trace',
      'must-not-leak',
      endUserId,
      terminalId,
    ]) {
      if (serialized.includes(banned)) fail(`response leaked banned field/value: ${banned}`)
    }
    pass('responses do not leak URLs, hashes, raw params, internal errors, or internal IDs')

    const serviceShape = service as unknown as Record<string, unknown>
    if (
      serviceShape['updateStatus'] === undefined &&
      serviceShape['refund'] === undefined &&
      serviceShape['refundOrder'] === undefined
    ) {
      pass('service exposes no payment/refund/status mutation methods')
    } else {
      fail('service unexpectedly exposes mutation methods')
    }
  } finally {
    await cleanup()
    await prisma.onModuleDestroy()
  }

  console.log('\nALL PASS')
}

main().catch((error: unknown) => {
  console.error('\nFatal error:', (error as Error).message)
  console.error((error as Error).stack)
  process.exit(1)
})
