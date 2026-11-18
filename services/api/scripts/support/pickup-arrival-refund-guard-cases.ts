/**
 * 渠道退款成功通知。
 * 任务已领取：不能记成退款成功，停在待人工，原因写明已经放行出纸。
 * 任务还是待打印、先前失败：记成退款成功，任务保持待打印，终端不能再领。
 * 任务已领取且退款还在处理：整笔成功通知也不能记成已退。
 * 管理员关单之后渠道又通知退成：退款行回到待人工，订单保持关闭，不抛错。
 * 渠道少退：详情必须是待人工，不能是空。
 * 都走 processWechatRefundNotify，停掉服务里的调用这里会红。
 */
import assert from 'node:assert/strict'
import { createSign, generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto'
import { AuditService } from '../../src/audit/audit.service'
import { collectPrintReturnAlerts } from '../../src/admin-ops/derived-print-return-alerts'
import { AdminOrdersReadonlyService } from '../../src/admin-orders-readonly/admin-orders-readonly.service'
import { PaymentProviderRegistry } from '../../src/payment/payment-provider.factory'
import {
  buildWechatCallbackVerifyBase,
  encryptWechatCallbackResource,
  WECHAT_NONCE_HEADER,
  WECHAT_SERIAL_HEADER,
  WECHAT_SIGNATURE_HEADER,
  WECHAT_TIMESTAMP_HEADER,
  WechatPayProvider,
} from '../../src/payment/providers/wechat-pay.provider'
import { explainPrintRefund } from '../../src/payment/print-return-disposition'
import { CLAIM_BLOCKED_BY_REFUND_AUDIT, CLAIM_BLOCKED_BY_REFUND_REASON } from '../../src/payment/refund-paper-exclusion'
import { resolvePrintReturnHold } from '../../src/payment/resolve-print-return-hold'
import { TerminalAgentService } from '../../src/terminals/terminals-agent.service'
import { PAID_NO_PAPER_AUTO_REASON } from '../../src/payment/print-no-paper-refund.constants'
import { RefundService } from '../../src/payment/refund.service'
import type { PrismaService } from '../../src/prisma/prisma.service'

const PAGES = JSON.stringify({ copies: 1, colorMode: 'black_white' })

function buildRefundNotify(
  payload: Record<string, unknown>,
  apiV3Key: string,
  privateKey: string,
  serial: string,
): { rawBody: Buffer; headers: Record<string, string> } {
  const resource = encryptWechatCallbackResource(JSON.stringify(payload), apiV3Key)
  const rawBody = Buffer.from(JSON.stringify({
    id: randomUUID(),
    event_type: 'REFUND.SUCCESS',
    resource_type: 'encrypt-resource',
    resource,
  }), 'utf8')
  const timestamp = String(Math.floor(Date.now() / 1000))
  const nonce = randomBytes(16).toString('hex')
  const signature = createSign('RSA-SHA256')
    .update(buildWechatCallbackVerifyBase({ timestamp, nonce, rawBody }))
    .sign(privateKey, 'base64')
  return {
    rawBody,
    headers: {
      [WECHAT_TIMESTAMP_HEADER]: timestamp,
      [WECHAT_NONCE_HEADER]: nonce,
      [WECHAT_SIGNATURE_HEADER]: signature,
      [WECHAT_SERIAL_HEADER]: serial,
    },
  }
}

export async function runRefundPaperGuardCases(db: PrismaService, tag: string): Promise<void> {
  const mchKeys = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  })
  const platformKeys = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  })
  const apiV3Key = randomBytes(16).toString('hex')
  const serial = `PUB_KEY_ID_P2B3_${tag}`.slice(0, 40)
  const provider = new WechatPayProvider({
    mchid: '1900000001',
    appid: 'wx0000000000000001',
    mchSerialNo: 'MCH_SERIAL_P2B3_0001',
    privateKeyPem: mchKeys.privateKey,
    apiV3Key,
    platformPublicKeyPem: platformKeys.publicKey,
    platformPublicKeyId: serial,
    notifyBaseUrl: 'https://test.local',
    apiBaseUrl: 'http://127.0.0.1:1',
  })
  const registry = new PaymentProviderRegistry([provider])
  const refunds = new RefundService(db, new AuditService(db), registry)
  const terminalId = `term_guard_${tag}`
  const orderIds: string[] = []
  const taskIds: string[] = []
  try {
    await db.terminal.create({
      data: {
        id: terminalId,
        terminalCode: terminalId,
        agentToken: `tok-${terminalId}`,
        deviceFingerprint: `fp-${terminalId}`,
        enabled: true,
        lifecycleStatus: 'active',
      },
    })
    const seed = async (label: string, taskStatus: string, refundStatus: string, payStatus: string) => {
      const orderId = `ord_${tag}_guard_${label}`
      const taskId = `pt_${orderId}`
      const orderNo = `GRD${tag}${label}`.slice(0, 32)
      await db.printTask.create({
        data: {
          id: taskId,
          fileUrl: 'https://example.invalid/print',
          fileMd5: 'md5',
          status: taskStatus,
          errorCode: taskStatus === 'failed' ? 'PRINT_COMMAND_FAILED' : null,
          printOutcome: taskStatus === 'failed' ? 'not_printed' : null,
          terminalId,
          orderId,
        },
      })
      taskIds.push(taskId)
      await db.order.create({
        data: {
          id: orderId,
          orderNo,
          type: 'print',
          terminalId,
          amountCents: 137,
          discountCents: 0,
          payStatus,
          paymentSource: 'wechat',
          paidAt: new Date('2026-11-18T02:00:00Z'),
          pickupStatus: 'used',
          taskStatus,
          billablePages: 1,
          printParamsJson: PAGES,
          itemsJson: '[]',
          channel: 'kiosk',
          printTaskId: taskId,
        },
      })
      orderIds.push(orderId)
      const refundNo = `RFD-GRD-${tag}-${label}`
      await db.paymentAttempt.create({
        data: {
          id: `pa_${orderId}`,
          orderId,
          channel: 'wechat',
          amountCents: 137,
          status: 'success',
          channelTxnNo: `wxtxn_${tag}_${label}`,
          prepayId: `prepay_${orderId}`,
        },
      })
      await db.refund.create({
        data: {
          orderId,
          refundNo,
          amountCents: 137,
          status: refundStatus,
          reason: PAID_NO_PAPER_AUTO_REASON,
          channel: 'wechat',
        },
      })
      return { orderId, refundNo }
    }

    const agent = new TerminalAgentService(db, new AuditService(db), { validateTerminalToken: async () => undefined } as never)
    const claimCount = async () => (await agent.claimTasks(terminalId, { maxTasks: 1 }, 'Bearer test')).length

    const held = await seed('held', 'claimed', 'failed', 'paid')
    const heldNotify = buildRefundNotify({
      mchid: '1900000001',
      out_trade_no: `pa_${held.orderId}`,
      out_refund_no: held.refundNo,
      refund_id: `wx_${tag}_held`,
      refund_status: 'SUCCESS',
      amount: { refund: 137, total: 137 },
    }, apiV3Key, platformKeys.privateKey, serial)
    const heldResult = await refunds.processWechatRefundNotify(heldNotify.rawBody, heldNotify.headers)
    assert.equal(heldResult.ok, true)
    assert.equal((await db.refund.findUnique({ where: { refundNo: held.refundNo } }))?.status, 'manual_review')
    assert.equal((await db.order.findUnique({ where: { id: held.orderId } }))?.payStatus, 'paid')
    assert.equal((await db.printTask.findUnique({ where: { id: `pt_${held.orderId}` } }))?.status, 'claimed')
    const heldView = await explainPrintRefund(db, held.orderId)
    assert.equal(heldView.disposition, 'manual')
    assert.equal(heldView.refundStatus, 'manual_review')
    assert.match(heldView.reason ?? '', /已经放行出纸/)
    assert.equal((await collectPrintReturnAlerts(db)).some((alert) => alert.subjectId === held.orderId), true)

    const paperFailed = await seed('paper', 'failed', 'failed', 'paid')
    const paperNotify = buildRefundNotify({
      mchid: '1900000001',
      out_trade_no: `pa_${paperFailed.orderId}`,
      out_refund_no: paperFailed.refundNo,
      refund_id: `wx_${tag}_paper`,
      refund_status: 'SUCCESS',
      amount: { refund: 137, total: 137 },
    }, apiV3Key, platformKeys.privateKey, serial)
    await refunds.processWechatRefundNotify(paperNotify.rawBody, paperNotify.headers)
    assert.equal((await db.refund.findUnique({ where: { refundNo: paperFailed.refundNo } }))?.status, 'success')
    assert.equal((await db.order.findUnique({ where: { id: paperFailed.orderId } }))?.payStatus, 'refunded')
    assert.equal((await explainPrintRefund(db, paperFailed.orderId)).disposition, 'auto_success')

    const short = await seed('short', 'pending', 'pending', 'refunding')
    const shortNotify = buildRefundNotify({
      mchid: '1900000001',
      out_trade_no: `pa_${short.orderId}`,
      out_refund_no: short.refundNo,
      refund_id: `wx_${tag}_short`,
      refund_status: 'SUCCESS',
      amount: { refund: 50, total: 137 },
    }, apiV3Key, platformKeys.privateKey, serial)
    const shortResult = await refunds.processWechatRefundNotify(shortNotify.rawBody, shortNotify.headers)
    assert.equal(shortResult.ok, true)
    assert.equal((await db.refund.findUnique({ where: { refundNo: short.refundNo } }))?.status, 'manual_review')
    assert.equal((await db.order.findUnique({ where: { id: short.orderId } }))?.payStatus, 'refunding')
    const shortDetail = await new AdminOrdersReadonlyService(db).getById(short.orderId)
    assert.equal(shortDetail.printRefundDisposition, 'manual')
    assert.equal(shortDetail.refundStatus, 'manual_review')
    assert.equal(shortDetail.printRefundReason, '渠道通知退了 50 分，这笔应退 137 分，待人工核对')
    assert.equal(shortDetail.refundLedgerNo, short.refundNo)
    assert.equal(shortDetail.refundLedgerCents, 137)
    assert.equal((await collectPrintReturnAlerts(db)).some((alert) => alert.subjectId === short.orderId), true)

    const opened = await seed('open', 'pending', 'failed', 'paid')
    assert.equal(await claimCount(), 0, '退款失败时不能出纸')
    const blockedAudit = await db.auditLog.findFirst({
      where: { targetId: opened.orderId, action: CLAIM_BLOCKED_BY_REFUND_AUDIT },
    })
    assert.match(blockedAudit?.payloadJson ?? '', new RegExp(CLAIM_BLOCKED_BY_REFUND_REASON))
    const openNotify = buildRefundNotify({
      mchid: '1900000001',
      out_trade_no: `pa_${opened.orderId}`,
      out_refund_no: opened.refundNo,
      refund_id: `wx_${tag}_open`,
      refund_status: 'SUCCESS',
      amount: { refund: 137, total: 137 },
    }, apiV3Key, platformKeys.privateKey, serial)
    await refunds.processWechatRefundNotify(openNotify.rawBody, openNotify.headers)
    assert.equal((await db.refund.findUnique({ where: { refundNo: opened.refundNo } }))?.status, 'success')
    assert.equal((await db.order.findUnique({ where: { id: opened.orderId } }))?.payStatus, 'refunded')
    assert.equal((await db.printTask.findUnique({ where: { id: `pt_${opened.orderId}` } }))?.status, 'pending')
    assert.equal(await claimCount(), 0, '退款成功后不能出纸')

    const latePaper = await seed('late', 'claimed', 'pending', 'refunding')
    const lateNotify = buildRefundNotify({
      mchid: '1900000001',
      out_trade_no: `pa_${latePaper.orderId}`,
      out_refund_no: latePaper.refundNo,
      refund_id: `wx_${tag}_late`,
      refund_status: 'SUCCESS',
      amount: { refund: 137, total: 137 },
    }, apiV3Key, platformKeys.privateKey, serial)
    await refunds.processWechatRefundNotify(lateNotify.rawBody, lateNotify.headers)
    assert.equal((await db.refund.findUnique({ where: { refundNo: latePaper.refundNo } }))?.status, 'manual_review')
    assert.equal((await db.order.findUnique({ where: { id: latePaper.orderId } }))?.payStatus, 'paid')
    assert.notEqual((await db.order.findUnique({ where: { id: latePaper.orderId } }))?.payStatus, 'refunded')
    assert.equal((await db.printTask.findUnique({ where: { id: `pt_${latePaper.orderId}` } }))?.status, 'claimed')

    const shut = await seed('shut', 'cancelled', 'closed', 'closed')
    const shutNotify = buildRefundNotify({
      mchid: '1900000001',
      out_trade_no: `pa_${shut.orderId}`,
      out_refund_no: shut.refundNo,
      refund_id: `wx_${tag}_shut`,
      refund_status: 'SUCCESS',
      amount: { refund: 137, total: 137 },
    }, apiV3Key, platformKeys.privateKey, serial)
    const shutResult = await refunds.processWechatRefundNotify(shutNotify.rawBody, shutNotify.headers)
    assert.equal(shutResult.ok, true)
    assert.equal((await db.refund.findUnique({ where: { refundNo: shut.refundNo } }))?.status, 'manual_review')
    assert.equal((await db.order.findUnique({ where: { id: shut.orderId } }))?.payStatus, 'closed')
    const shutResolved = await resolvePrintReturnHold(db, shut.orderId, 'confirm_refunded', 'admin-test')
    assert.equal(shutResolved.refundStatus, 'success')
    assert.equal(shutResolved.payStatus, 'closed')
  } finally {
    await db.refund.deleteMany({ where: { orderId: { in: orderIds } } })
    await db.paymentAttempt.deleteMany({ where: { orderId: { in: orderIds } } })
    await db.auditLog.deleteMany({ where: { targetId: { in: orderIds } } })
    await db.order.deleteMany({ where: { id: { in: orderIds } } })
    await db.printTaskStatusLog.deleteMany({ where: { taskId: { in: taskIds } } })
    await db.printTask.deleteMany({ where: { id: { in: taskIds } } })
    await db.terminal.deleteMany({ where: { id: terminalId } })
  }
}
