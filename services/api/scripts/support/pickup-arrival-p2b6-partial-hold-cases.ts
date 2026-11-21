/**
 * 反方第 4、5 条。
 * 只有成功的部分退款时，三步不能再点，应去退还剩余。
 * 剩余退款失败后确认退成，要接住部分退款，并把已退金额累加上去。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { BadRequestException } from '@nestjs/common'
import { resolvePrintReturnHold } from '../../src/payment/resolve-print-return-hold'
import type { PrismaService } from '../../src/prisma/prisma.service'

const PAGES = JSON.stringify({ copies: 1, colorMode: 'black_white' })

function errorCode(error: unknown): string {
  if (!(error instanceof BadRequestException)) return error instanceof Error ? error.message : 'error'
  const body = error.getResponse() as { error?: { code?: string } }
  return body?.error?.code ?? error.message
}

export async function runP2b6PartialHoldCases(
  db: PrismaService,
  input: { tag: string; orderIds: string[]; taskIds: string[] },
): Promise<void> {
  const tag = input.tag
  const orgId = `org_p2b6ph_${tag}`
  const terminalId = `term_p2b6ph_${tag}`
  await db.organization.create({ data: { id: orgId, name: '部分退款三步', type: 'school_employment_center' } })
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
    extra?: { amountCents: number; status: 'failed' | 'manual_review' }
  }): Promise<string> => {
    n += 1
    const id = `ord_${tag}_p2b6ph_${n}`
    const taskId = `pt_${id}`
    created.push(id)
    input.orderIds.push(id)
    input.taskIds.push(taskId)
    await db.printTask.create({
      data: {
        id: taskId,
        fileUrl: 'https://example.invalid/print',
        fileMd5: 'md5',
        status: 'failed',
        printOutcome: 'not_printed',
        errorCode: 'PAPER_JAM',
        orderId: id,
        terminalId,
      },
    })
    await db.order.create({
      data: {
        id,
        orderNo: `H6${tag}${opts.suffix}${n}`.slice(0, 32),
        type: 'print',
        terminalId,
        amountCents: 200,
        discountCents: 0,
        refundedAmountCents: 50,
        payStatus: 'partial_refunded',
        paymentSource: 'offline',
        paidAt: new Date(Date.now() - 60 * 60 * 1000),
        pickupStatus: 'pending',
        taskStatus: 'failed',
        billablePages: 2,
        printParamsJson: PAGES,
        itemsJson: '[]',
        channel: 'kiosk',
        printTaskId: taskId,
      },
    })
    await db.refund.create({
      data: {
        orderId: id,
        refundNo: `RFD-OK-${tag}-${n}`.slice(0, 40),
        amountCents: 50,
        status: 'success',
        reason: '部分页未出',
        channel: 'offline',
      },
    })
    if (opts.extra) {
      await db.refund.create({
        data: {
          orderId: id,
          refundNo: `RFD-REST-${tag}-${n}`.slice(0, 40),
          amountCents: opts.extra.amountCents,
          status: opts.extra.status,
          reason: '退还剩余没有成功',
          channel: 'offline',
        },
      })
    }
    return id
  }

  const codeOf = async (id: string, action: 'confirm_refunded' | 'release_paper' | 'close_order'): Promise<string> =>
    resolvePrintReturnHold(db, id, action, 'admin-test').then(
      () => 'ok',
      (error: unknown) => errorCode(error),
    )

  try {
    const onlySuccess = await seed({ suffix: 'ok' })
    assert.equal(await codeOf(onlySuccess, 'confirm_refunded'), 'REFUND_REMAINDER_REQUIRED')
    assert.equal(await codeOf(onlySuccess, 'release_paper'), 'REFUND_REMAINDER_REQUIRED')
    assert.equal(await codeOf(onlySuccess, 'close_order'), 'REFUND_REMAINDER_REQUIRED')
    assert.equal((await db.order.findUniqueOrThrow({ where: { id: onlySuccess } })).refundedAmountCents, 50)

    const failedRest = await seed({ suffix: 'fl', extra: { amountCents: 150, status: 'failed' } })
    const confirmed = await resolvePrintReturnHold(db, failedRest, 'confirm_refunded', 'admin-test')
    assert.equal(confirmed.refundStatus, 'success')
    assert.equal(confirmed.payStatus, 'refunded')
    const afterFull = await db.order.findUniqueOrThrow({ where: { id: failedRest } })
    assert.equal(afterFull.payStatus, 'refunded')
    assert.equal(afterFull.refundedAmountCents, 200, '先前 50 加上确认的 150，已退必须是 200')

    const shortRest = await seed({ suffix: 'sh', extra: { amountCents: 40, status: 'manual_review' } })
    const short = await resolvePrintReturnHold(db, shortRest, 'confirm_refunded', 'admin-test')
    assert.equal(short.refundStatus, 'success')
    assert.equal(short.payStatus, 'partial_refunded')
    const afterShort = await db.order.findUniqueOrThrow({ where: { id: shortRest } })
    assert.equal(afterShort.refundedAmountCents, 90, '50 加 40 还没盖住 200，不能记成全额')

    const readRepo = (relativePath: string) => readFileSync(resolve(__dirname, '../../../..', relativePath), 'utf8')
    const holds = readRepo('apps/admin/src/routes/orders/PrintReturnHoldActions.tsx')
    const drawer = readRepo('apps/admin/src/routes/orders/OrderDetailDrawer.tsx')
    assert.match(holds, /请用上面的「退还剩余」/)
    assert.match(holds, /payStatus === 'partial_refunded' && detail\.refundStatus === 'success'/)
    assert.match(drawer, /请用下面的「退还剩余」/)
  } finally {
    await db.refund.deleteMany({ where: { orderId: { in: created } } })
    await db.auditLog.deleteMany({ where: { targetId: { in: created } } })
    await db.order.deleteMany({ where: { id: { in: created } } })
    await db.printTask.deleteMany({ where: { orderId: { in: created } } })
    await db.terminal.delete({ where: { id: terminalId } }).catch(() => undefined)
    await db.organization.delete({ where: { id: orgId } }).catch(() => undefined)
  }
}
