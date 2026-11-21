/**
 * 一单多笔退款都要核（第 2 条）。
 * 订单上每一笔渠道受理过、还没落定的退款都要查渠道。全部有了明确答复才放行三步；
 * 任何一笔还在途就整单拒绝，哪一笔都不改状态。核验出纸只要有一笔在途就拦住。
 * - 第一笔渠道失败、第二笔还在打款：拒绝（agy 二.1.2 的原样）。反过来也拒绝。
 * - 过期付款那一笔还在途，也挡住这一单的三步。
 * - 两笔都明确失败：两笔都查过，才往下做。
 */
import assert from 'node:assert/strict'
import { BadRequestException, ConflictException } from '@nestjs/common'
import { AuditService } from '../../src/audit/audit.service'
import { STALE_ATTEMPT_REFUND_REASON } from '../../src/payment/print-no-paper-refund.constants'
import { resolvePrintReturnHold, type PrintReturnResolution, type RefundChannelVerdict } from '../../src/payment/resolve-print-return-hold'
import { AdminPrintJobsVerifyOutcomeService } from '../../src/print-jobs/admin-print-jobs-verify-outcome.service'
import type { PrismaService } from '../../src/prisma/prisma.service'

const PAGES = JSON.stringify({ copies: 1, colorMode: 'black_white' })

function errorCode(error: unknown): string {
  if (error instanceof BadRequestException || error instanceof ConflictException) {
    const body = error.getResponse() as { error?: { code?: string } } | string
    if (typeof body === 'string') return body
    return body?.error?.code ?? error.message
  }
  return error instanceof Error ? error.message : 'error'
}

type RefundSeed = { suffix: string; amountCents: number; reason: string | null; ageMinutes: number }

export async function runP2b9MultiRefundCases(
  db: PrismaService,
  input: { tag: string; orderIds: string[]; taskIds: string[] },
): Promise<void> {
  const tag = input.tag
  const orgId = `org_p2b9mr_${tag}`
  const terminalId = `term_p2b9mr_${tag}`
  const adminId = `user_p2b9mr_${tag}`
  await db.organization.create({ data: { id: orgId, name: '一单多笔退款', type: 'school_employment_center' } })
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
  await db.user.create({
    data: { id: adminId, username: `p2b9mr_${tag}`, name: '核验出纸', passwordHash: 'hash', role: 'admin', enabled: true, tokenVersion: 0 },
  })
  const verifySvc = new AdminPrintJobsVerifyOutcomeService(db, new AuditService(db))
  const created: string[] = []

  const seed = async (label: string, refunds: RefundSeed[], opts?: { unconfirmed?: boolean }): Promise<{ id: string; taskId: string; refundNos: string[] }> => {
    const id = `ord_${tag}_p2b9mr_${label}`
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
        printOutcome: opts?.unconfirmed ? null : 'not_printed',
        errorCode: opts?.unconfirmed ? 'PRINT_JOB_UNCONFIRMED' : 'PAPER_JAM',
        orderId: id,
        terminalId,
      },
    })
    await db.order.create({
      data: {
        id,
        orderNo: `P9MR${tag}${label}`.replace(/[^a-zA-Z0-9]/g, '').slice(0, 32),
        type: 'print',
        terminalId,
        amountCents: 200,
        discountCents: 0,
        payStatus: 'paid',
        paymentSource: 'wechat',
        paidAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
        pickupStatus: 'pending',
        taskStatus: 'failed',
        billablePages: 2,
        printParamsJson: PAGES,
        itemsJson: '[]',
        channel: 'kiosk',
        printTaskId: taskId,
      },
    })
    const refundNos: string[] = []
    for (const refund of refunds) {
      const refundNo = `RFD-P9MR-${tag}-${label}-${refund.suffix}`.slice(0, 48)
      refundNos.push(refundNo)
      const at = new Date(Date.now() - refund.ageMinutes * 60 * 1000)
      await db.refund.create({
        data: {
          orderId: id,
          refundNo,
          amountCents: refund.amountCents,
          status: 'pending',
          reason: refund.reason,
          channel: 'wechat',
          channelSubmittedAt: at,
          createdAt: at,
        },
      })
    }
    return { id, taskId, refundNos }
  }
  const statuses = async (orderId: string) => (await db.refund.findMany({ where: { orderId }, orderBy: { createdAt: 'asc' } }))
    .map((row) => row.status)
  const answering = (byRefundNo: Record<string, RefundChannelVerdict>, asked: string[]) =>
    async (call: { refundNo: string }) => {
      asked.push(call.refundNo)
      return byRefundNo[call.refundNo] ?? 'unknown'
    }

  try {
    const twoWay: Array<{ label: string; older: RefundChannelVerdict; newer: RefundChannelVerdict }> = [
      { label: 'fp', older: 'failed', newer: 'processing' },
      { label: 'pf', older: 'processing', newer: 'failed' },
    ]
    for (const order of twoWay) {
      for (const action of ['release_paper', 'close_order', 'confirm_refunded'] as PrintReturnResolution[]) {
        const seeded = await seed(`${order.label}${action.slice(0, 3)}`, [
          { suffix: 'a', amountCents: 200, reason: '第一笔退款', ageMinutes: 90 },
          { suffix: 'b', amountCents: 200, reason: '同号以外的第二笔', ageMinutes: 30 },
        ])
        const asked: string[] = []
        const code = await resolvePrintReturnHold(db, seeded.id, action, 'admin-test', answering({
          [seeded.refundNos[0] as string]: order.older,
          [seeded.refundNos[1] as string]: order.newer,
        }, asked)).then(() => 'ok', (error: unknown) => errorCode(error))
        assert.equal(code, 'REFUND_CHANNEL_UNCONFIRMED', `${order.label}/${action}：有一笔还在打款就整单拒绝`)
        assert.deepEqual([...asked].sort(), [...seeded.refundNos].sort(), `${order.label}/${action}：两笔都要查`)
        assert.deepEqual(await statuses(seeded.id), ['pending', 'pending'], `${order.label}/${action}：拒绝时哪一笔都不改`)
        const fresh = await db.order.findUniqueOrThrow({ where: { id: seeded.id } })
        assert.equal(fresh.payStatus, 'paid')
        assert.equal(fresh.taskStatus, 'failed')
        assert.equal((await db.printTask.findUniqueOrThrow({ where: { id: seeded.taskId } })).status, 'failed')
      }
    }

    // 过期付款那一笔还在途，也要等它有了答复。
    const staleOpen = await seed('stopen', [
      { suffix: 'cur', amountCents: 200, reason: '这一笔', ageMinutes: 60 },
      { suffix: 'old', amountCents: 300, reason: STALE_ATTEMPT_REFUND_REASON, ageMinutes: 20 },
    ])
    const staleAsked: string[] = []
    const staleCode = await resolvePrintReturnHold(db, staleOpen.id, 'release_paper', 'admin-test', answering({
      [staleOpen.refundNos[0] as string]: 'failed',
      [staleOpen.refundNos[1] as string]: 'processing',
    }, staleAsked)).then(() => 'ok', (error: unknown) => errorCode(error))
    assert.equal(staleCode, 'REFUND_CHANNEL_UNCONFIRMED', '过期付款的退款还在途，也不放行')
    assert.equal(staleAsked.length, 2)
    assert.deepEqual(await statuses(staleOpen.id), ['pending', 'pending'])

    // 两笔都明确失败：都查过，往下做。
    const bothFailed = await seed('ff', [
      { suffix: 'a', amountCents: 200, reason: '第一笔退款', ageMinutes: 90 },
      { suffix: 'b', amountCents: 200, reason: '第二笔退款', ageMinutes: 30 },
    ])
    const failedAsked: string[] = []
    const released = await resolvePrintReturnHold(db, bothFailed.id, 'release_paper', 'admin-test', answering({
      [bothFailed.refundNos[0] as string]: 'failed',
      [bothFailed.refundNos[1] as string]: 'failed',
    }, failedAsked))
    assert.equal(failedAsked.length, 2, '两笔都要查')
    assert.equal(released.refundStatus, 'withdrawn')
    assert.equal(released.taskStatus, 'pending')
    assert.deepEqual(await statuses(bothFailed.id), ['failed', 'withdrawn'], '两笔都落定后才改为出纸，较早那笔记失败')

    // 核验出纸：只要有一笔在途就拦住，结论不写。
    const verifyHeld = await seed('vf', [
      { suffix: 'a', amountCents: 200, reason: '第一笔退款', ageMinutes: 90 },
      { suffix: 'b', amountCents: 200, reason: '第二笔退款', ageMinutes: 30 },
    ], { unconfirmed: true })
    await db.refund.updateMany({ where: { refundNo: verifyHeld.refundNos[0] }, data: { status: 'failed' } })
    const verifyCode = await verifySvc.verifyOutcome(verifyHeld.taskId, { outcome: 'printed', confirm: 'VERIFY_PRINTED' }, adminId)
      .then(() => 'ok', (error: unknown) => errorCode(error))
    assert.equal(verifyCode, 'PRINT_OUTCOME_REFUND_BLOCKED', '第一笔已失败、第二笔还在途，核验出纸要拦住')
    assert.equal((await db.printTask.findUniqueOrThrow({ where: { id: verifyHeld.taskId } })).printOutcome, null)
    assert.deepEqual(await statuses(verifyHeld.id), ['failed', 'pending'])
  } finally {
    await db.refund.deleteMany({ where: { orderId: { in: created } } })
    await db.auditLog.deleteMany({ where: { OR: [{ targetId: { in: created } }, { targetId: { in: input.taskIds } }] } })
    await db.printTaskStatusLog.deleteMany({ where: { taskId: { in: input.taskIds } } })
    await db.order.deleteMany({ where: { id: { in: created } } })
    await db.printTask.deleteMany({ where: { orderId: { in: created } } })
    await db.user.deleteMany({ where: { id: adminId } })
    await db.terminal.delete({ where: { id: terminalId } }).catch(() => undefined)
    await db.organization.delete({ where: { id: orgId } }).catch(() => undefined)
  }
}
