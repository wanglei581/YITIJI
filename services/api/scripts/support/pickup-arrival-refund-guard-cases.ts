/**
 * 退款曾经失败之后，又收到渠道成功通知。
 * 打印任务还没失败：不能把订单改成已退款。
 * 打印任务已经失败：可以收敛成退款成功。
 * 渠道少退：详情必须是待人工，不能是空。
 * 三条都走 processWechatRefundNotify，停掉服务里的调用这里会红。
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

    const held = await seed('held', 'pending', 'failed', 'paid')
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
    assert.equal((await db.printTask.findUnique({ where: { id: `pt_${held.orderId}` } }))?.status, 'pending')
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
  } finally {
    await db.refund.deleteMany({ where: { orderId: { in: orderIds } } })
    await db.paymentAttempt.deleteMany({ where: { orderId: { in: orderIds } } })
    await db.auditLog.deleteMany({ where: { targetId: { in: orderIds } } })
    await db.order.deleteMany({ where: { id: { in: orderIds } } })
    await db.printTask.deleteMany({ where: { id: { in: taskIds } } })
    await db.terminal.deleteMany({ where: { id: terminalId } })
  }
}
