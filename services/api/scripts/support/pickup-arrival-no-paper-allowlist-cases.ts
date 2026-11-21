/**
 * 没出纸自动退的允许名单。每个确定没交给打印机的码各退一次。
 * 没见过的码不退。交给打印机之后上报的 PRINT_JOB_UNCONFIRMED 不退。
 */
import assert from 'node:assert/strict'
import { PAID_NO_PAPER_AUTO_REASON } from '../../src/payment/print-no-paper-refund.constants'
import { settleExplicitNoPaperFromReportedFailure } from '../../src/payment/print-no-paper-refund'
import type { PrismaService } from '../../src/prisma/prisma.service'

/** 与 print-no-paper-refund.ts 的允许名单逐字相同，单独写死，移出名单时这里变红。 */
const MUST_REFUND_BEFORE_PRINTER = [
  'PRINT_COMMAND_FAILED',
  'DOWNLOAD_HASH_MISMATCH',
  'PRINTER_NOT_FOUND',
  'PRINTER_OFFLINE',
  'PRINTER_ERROR',
  'LOCAL_TASK_STATE_PERSIST_FAILED',
  'FILE_NOT_FOUND',
  'UNSUPPORTED_FILE_TYPE',
  'PRINT_QUEUE_TIMEOUT',
] as const

export async function runNoPaperAllowlistCases(
  db: PrismaService,
  input: { tag: string; terminalId: string; orderIds: string[]; taskIds: string[] },
): Promise<void> {
  const paidFailed = async (suffix: string, errorCode: string | null): Promise<string> => {
    const id = `ord_${input.tag}_${suffix}`
    await db.order.create({
      data: {
        id,
        orderNo: `NO${input.tag}${suffix}`.slice(0, 40),
        type: 'print',
        terminalId: input.terminalId,
        amountCents: 200,
        payStatus: 'paid',
        paymentSource: 'offline',
        paidAt: new Date('2026-11-17T01:00:00Z'),
        pickupStatus: 'used',
        taskStatus: 'failed',
        billablePages: 2,
        printParamsJson: JSON.stringify({ copies: 1, colorMode: 'black_white' }),
        itemsJson: '[]',
        discountCents: 0,
        channel: 'miniapp_cloud',
      },
    })
    input.orderIds.push(id)
    const taskId = `pt_${id}`
    await db.printTask.create({
      data: {
        id: taskId,
        fileUrl: 'https://example.invalid/print',
        fileMd5: 'md5',
        status: 'failed',
        errorCode,
        printOutcome: null,
        orderId: id,
      },
    })
    input.taskIds.push(taskId)
    await db.order.update({ where: { id }, data: { printTaskId: taskId } })
    return taskId
  }

  for (const errorCode of MUST_REFUND_BEFORE_PRINTER) {
    const taskId = await paidFailed(`allow${errorCode}`, errorCode)
    const outcome = await settleExplicitNoPaperFromReportedFailure(db, taskId)
    assert.equal(outcome, 'refunded', `${errorCode} 确定没交给打印机，要自动原路退一次`)
    const refunds = await db.refund.findMany({
      where: { reason: PAID_NO_PAPER_AUTO_REASON, order: { printTaskId: taskId } },
    })
    assert.equal(refunds.length, 1, `${errorCode} 只产生一笔退款`)
    assert.equal(refunds[0]?.status, 'success')
    assert.equal(refunds[0]?.amountCents, 200)
    const again = await settleExplicitNoPaperFromReportedFailure(db, taskId)
    assert.notEqual(again, 'refunded', `${errorCode} 不能退第二次`)
    assert.equal(await db.refund.count({ where: { order: { printTaskId: taskId } } }), 1)
  }

  const unknownTask = await paidFailed('allowfuture', 'FUTURE_OUTPUT_UNKNOWN')
  let unknownCalls = 0
  const unknown = await settleExplicitNoPaperFromReportedFailure(db, unknownTask, {
    refund: {
      refund: async () => {
        unknownCalls += 1
        throw new Error('没见过的错误码不能退')
      },
    },
  })
  assert.equal(unknown, 'manual', '没见过的错误码不自动退，改成待人工')
  assert.equal(unknownCalls, 0)
  assert.equal(await db.refund.count({ where: { order: { printTaskId: unknownTask } } }), 0)

  const afterDispatch = await paidFailed('allowafter', 'PRINT_JOB_UNCONFIRMED')
  let afterCalls = 0
  const after = await settleExplicitNoPaperFromReportedFailure(db, afterDispatch, {
    refund: {
      refund: async () => {
        afterCalls += 1
        throw new Error('交给打印机之后不能按命令失败自动退')
      },
    },
  })
  assert.equal(after, 'manual', '提交打印之后改写成未确认的，不自动退，改成待人工')
  assert.equal(afterCalls, 0)
}
