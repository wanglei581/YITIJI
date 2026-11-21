/**
 * P2b9d 第 1 条：渠道退成事实绝不回滚，冲突另进待人工告警（agy #1 + 18:22 裁定）。
 * - 纸已出 + 渠道查成 200（经 registerChannelResult）：Refund.status='success'、金额与渠道单号、
 *   refund.channel_answer 与 refund.channel_success_conflict 审计全部留存，发告警，报错不引导二次退款。
 * - 纸已出 + 渠道查成 200（经 resolvePrintReturnHold 查渠道期间纸被并发标为 printed）：
 *   同样保留 Refund.status='success'、留存审计与 hold_rejected、发告警且不引导二次退款。
 * - 微信 REFUND.SUCCESS 通知遇纸已出（convergeNotifiedRefundSuccess）：与同一口径对齐，保留 success + 冲突告警。
 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { BadRequestException } from '@nestjs/common'
import { AdminOrdersReadonlyService } from '../../src/admin-orders-readonly/admin-orders-readonly.service'
import { collectPrintReturnAlerts } from '../../src/admin-ops/derived-print-return-alerts'
import { explainPrintRefund } from '../../src/payment/print-return-disposition'
import {
  CHANNEL_SUCCESS_CONFLICT_AUDIT,
  CHANNEL_SUCCESS_PAPER_CONFLICT_CODE,
} from '../../src/payment/refund-channel-answer'
import { registerChannelResult } from '../../src/payment/refund-channel-registration'
import { convergeNotifiedRefundSuccess } from '../../src/payment/refund-notify-paper-guard'
import { resolvePrintReturnHold } from '../../src/payment/resolve-print-return-hold'
import type { PrismaService } from '../../src/prisma/prisma.service'

const PAGES = JSON.stringify({ copies: 1, colorMode: 'black_white' })
const DAY = 24 * 60 * 60 * 1000

function rejection(error: unknown): { code: string; message: string } {
  if (!(error instanceof BadRequestException)) return { code: error instanceof Error ? error.message : 'error', message: '' }
  const body = error.getResponse() as { error?: { code?: string; message?: string } } | string
  if (typeof body === 'string') return { code: body, message: '' }
  return { code: body?.error?.code ?? error.message, message: body?.error?.message ?? '' }
}

async function withAlertWebhook(run: (received: string[]) => Promise<void>): Promise<void> {
  const received: string[] = []
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk: Buffer) => { body += chunk.toString('utf8') })
    req.on('end', () => {
      received.push(body)
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{"errcode":0}')
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const addr = server.address()
  const port = typeof addr === 'object' && addr ? addr.port : 0
  const prevWebhook = process.env['ALERT_WEBHOOK_URL']
  process.env['ALERT_WEBHOOK_URL'] = `http://127.0.0.1:${port}/webhook`
  try {
    await run(received)
  } finally {
    if (prevWebhook === undefined) delete process.env['ALERT_WEBHOOK_URL']
    else process.env['ALERT_WEBHOOK_URL'] = prevWebhook
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

export async function runP2b9dConflictCases(
  db: PrismaService,
  input: { tag: string; orderIds: string[]; taskIds: string[] },
): Promise<void> {
  const tag = input.tag
  const orgId = `org_p2b9d1_${tag}`
  const terminalId = `term_p2b9d1_${tag}`
  await db.organization.create({ data: { id: orgId, name: '退成事实不回滚', type: 'school_employment_center' } })
  await db.terminal.create({
    data: { id: terminalId, terminalCode: terminalId, agentToken: `tok-${terminalId}`, deviceFingerprint: `fp-${terminalId}`, orgId, enabled: true, lifecycleStatus: 'active' },
  })
  const created: string[] = []
  const seed = async (label: string, opts: { printOutcome: string | null; taskStatus: string; payStatus: string; submittedMsAgo: number }) => {
    const id = `ord_${tag}_p2b9d1_${label}`
    const taskId = `pt_${id}`
    const orderNo = `P9D1${tag}${label}`.replace(/[^a-zA-Z0-9]/g, '').slice(0, 32)
    const refundNo = `RFD-${orderNo}`
    created.push(id)
    input.orderIds.push(id)
    input.taskIds.push(taskId)
    await db.printTask.create({
      data: {
        id: taskId,
        fileUrl: 'https://example.invalid/print',
        fileMd5: 'md5',
        status: opts.taskStatus,
        errorCode: opts.taskStatus === 'failed' ? 'PRINT_JOB_UNCONFIRMED' : null,
        printOutcome: opts.printOutcome,
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
        payStatus: opts.payStatus,
        paymentSource: 'wechat',
        paidAt: new Date(Date.now() - 2 * DAY),
        pickupStatus: 'pending',
        taskStatus: opts.taskStatus,
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
        refundNo,
        amountCents: 200,
        status: 'pending',
        reason: '没出纸先退',
        channel: 'wechat',
        channelSubmittedAt: new Date(Date.now() - opts.submittedMsAgo),
      },
    })
    return { id, taskId, orderNo, refundNo }
  }

  try {
    await withAlertWebhook(async (received) => {
      // 1. 纸已出 + 渠道查成 200（经 registerChannelResult）。
      const reg = await seed('reg', { printOutcome: 'printed', taskStatus: 'completed', payStatus: 'paid', submittedMsAgo: DAY + 60_000 })
      const regErr = await registerChannelResult(db, reg.id, {
        refundNo: reg.refundNo,
        result: 'refunded',
        channelRefundNo: 'WX-ADMIN-IGNORED',
        confirmOrderNo: reg.orderNo,
      }, 'admin-p2b9d', {
        supportsQuery: () => true,
        channelQuery: async () => ({ verdict: 'success', refundAmountCents: 200, channelRefundNo: 'WX-REG-PAPER-200' }),
      }).then(() => null, rejection)
      assert.equal(regErr?.code, CHANNEL_SUCCESS_PAPER_CONFLICT_CODE)
      assert.doesNotMatch(regErr?.message ?? '', /先不记账|核对后仍退款/, '冲突提示不得误导二次退款')
      assert.match(regErr?.message ?? '', /请勿重复退款/)
      const regRefund = await db.refund.findUniqueOrThrow({ where: { refundNo: reg.refundNo } })
      assert.equal(regRefund.status, 'success', '纸已出时渠道退成事实绝不回滚')
      assert.equal(regRefund.amountCents, 200)
      assert.equal(regRefund.channelRefundNo, 'WX-REG-PAPER-200')
      assert.equal(await db.auditLog.count({ where: { targetId: reg.id, action: 'refund.channel_answer' } }), 1)
      assert.equal(await db.auditLog.count({ where: { targetId: reg.id, action: CHANNEL_SUCCESS_CONFLICT_AUDIT } }), 1)
      const regOrder = await db.order.findUniqueOrThrow({ where: { id: reg.id } })
      assert.equal(regOrder.payStatus, 'paid', '纸已出时不静默把订单改成已退款')
      const regExplained = await explainPrintRefund(db, reg.id)
      assert.equal(regExplained.disposition, 'manual', '冲突单必须停留在待人工核对态')
      assert.equal(regExplained.refundStatus, 'success')
      const regDetail = await new AdminOrdersReadonlyService(db).getById(reg.id)
      assert.equal(regDetail.refundEligible, false, '冲突单不得允许再退')
      assert.equal(regDetail.channelInFlight, false)
      assert.equal(regDetail.opsAttention, true)
      const alertsAfterReg = await collectPrintReturnAlerts(db)
      assert.ok(alertsAfterReg.some((alert) => alert.subjectId === reg.id), '冲突单必须进入告警中心')

      // 2. 纸已出 + 渠道查成 200（经 resolvePrintReturnHold 并发：查渠道期间纸被标为 printed）。
      const conc = await seed('conc', { printOutcome: null, taskStatus: 'failed', payStatus: 'refunding', submittedMsAgo: 30 * 60_000 })
      const concErr = await resolvePrintReturnHold(db, conc.id, 'release_paper', 'admin-p2b9d', async () => {
        await db.printTask.update({ where: { id: conc.taskId }, data: { printOutcome: 'printed' } })
        return { verdict: 'success', refundAmountCents: 200, channelRefundNo: 'WX-CONC-200' }
      }).then(() => null, rejection)
      assert.equal(concErr?.code, CHANNEL_SUCCESS_PAPER_CONFLICT_CODE)
      assert.doesNotMatch(concErr?.message ?? '', /先不记账|核对后仍退款/)
      const concRefund = await db.refund.findUniqueOrThrow({ where: { refundNo: conc.refundNo } })
      assert.equal(concRefund.status, 'success', '并发出纸时渠道退成事实绝不回滚')
      assert.equal(concRefund.amountCents, 200)
      assert.equal(concRefund.channelRefundNo, 'WX-CONC-200')
      assert.equal(await db.auditLog.count({ where: { targetId: conc.id, action: 'refund.channel_answer' } }), 1)
      assert.equal(await db.auditLog.count({ where: { targetId: conc.id, action: CHANNEL_SUCCESS_CONFLICT_AUDIT } }), 1)
      assert.equal(await db.auditLog.count({ where: { targetId: conc.id, action: 'refund.hold_rejected' } }), 1)
      assert.equal((await db.order.findUniqueOrThrow({ where: { id: conc.id } })).payStatus, 'refunding')
      assert.equal((await explainPrintRefund(db, conc.id)).disposition, 'manual')
      const alertsAfterConc = await collectPrintReturnAlerts(db)
      assert.ok(alertsAfterConc.some((alert) => alert.subjectId === conc.id))
      if (process.env['REDIS_URL']) {
        assert.ok(received.length >= 2, `两路冲突均应触发真实告警推送，实收 ${received.length}`)
      }

      // 3. 微信 REFUND.SUCCESS 通知遇纸已出（convergeNotifiedRefundSuccess）：同口径落 success + 冲突审计。
      const notify = await seed('ntf', { printOutcome: 'printed', taskStatus: 'completed', payStatus: 'paid', submittedMsAgo: 10 * 60_000 })
      const notifyRow = await db.refund.findUniqueOrThrow({ where: { refundNo: notify.refundNo } })
      const outcome = await db.$transaction((tx) => convergeNotifiedRefundSuccess(tx, {
        refundId: notifyRow.id,
        orderId: notify.id,
        priorStatus: 'pending',
        channelRefundNo: 'WX-NTF-PAPER-200',
        amountCents: 200,
        reason: notifyRow.reason,
      }))
      assert.equal(outcome, 'blocked')
      const notifyAfter = await db.refund.findUniqueOrThrow({ where: { refundNo: notify.refundNo } })
      assert.equal(notifyAfter.status, 'success', '通知遇纸已出也应保留渠道退成事实')
      assert.equal(notifyAfter.channelRefundNo, 'WX-NTF-PAPER-200')
      assert.equal((await db.order.findUniqueOrThrow({ where: { id: notify.id } })).payStatus, 'paid')
      assert.equal((await explainPrintRefund(db, notify.id)).disposition, 'manual')
    })
  } finally {
    await db.refund.deleteMany({ where: { orderId: { in: created } } })
    await db.auditLog.deleteMany({ where: { targetId: { in: created } } })
    await db.order.deleteMany({ where: { id: { in: created } } })
    await db.printTask.deleteMany({ where: { orderId: { in: created } } })
    await db.terminal.delete({ where: { id: terminalId } }).catch(() => undefined)
    await db.organization.delete({ where: { id: orgId } }).catch(() => undefined)
  }
}
