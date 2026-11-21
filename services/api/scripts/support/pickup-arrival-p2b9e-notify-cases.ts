/**
 * P2b9e：微信退款成功通知统一累计超退、部分续退与状态冲突防回滚口径（真实 Nest HTTP + RSA 验签 + 本地 Webhook）。
 * - Case A（累计超退通知）：应付 200、已有成功 50，再收 200 成功通知 → HTTP 200、新退款落 success（合计 250）、
 *   订单不静默翻 refunded、写 refund.channel_success_conflict（source=notify）、disposition=manual、opsAttention=true、Webhook +1。
 * - Case B（partial_refunded 续退与状态冲突防回滚）：
 *   1) 收 150 成功通知 → HTTP 200、order 落 refunded 且 refundedAmountCents=200；
 *   2) 收 80 成功通知 → HTTP 200、order 落 partial_refunded 且 refundedAmountCents=130；
 *   3) 收 200 超退通知 → HTTP 200、保留 Refund.status=success 绝不回滚 pending、写冲突审计与 Webhook +1；
 *   4) 意外订单态（unpaid 无待退信号）收 200 成功通知 → HTTP 200、保留 success 不抛 ORDER_INVALID_TRANSITION、写状态冲突审计与 Webhook +1。
 * - Case C（过期付款补收退款通知）：落 success，但不计入非过期合计、不把正常实付单翻成 refunded。
 */
import 'reflect-metadata'
import assert from 'node:assert/strict'
import { createSign, generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { Module } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { AdminOrdersReadonlyService } from '../../src/admin-orders-readonly/admin-orders-readonly.service'
import { collectPrintReturnAlerts } from '../../src/admin-ops/derived-print-return-alerts'
import { AuditService } from '../../src/audit/audit.service'
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter'
import { installBodyParsers } from '../../src/config/body-parsers'
import { OnlinePaymentService } from '../../src/payment/online-payment.service'
import { PaymentController } from '../../src/payment/payment.controller'
import { PAYMENT_PROVIDER_TOKEN, PaymentProviderRegistry } from '../../src/payment/payment-provider.factory'
import { PricingService } from '../../src/payment/pricing.service'
import { STALE_ATTEMPT_REFUND_REASON } from '../../src/payment/print-no-paper-refund.constants'
import { explainPrintRefund } from '../../src/payment/print-return-disposition'
import {
  buildWechatCallbackVerifyBase,
  encryptWechatCallbackResource,
  WECHAT_NONCE_HEADER,
  WECHAT_SERIAL_HEADER,
  WECHAT_SIGNATURE_HEADER,
  WECHAT_TIMESTAMP_HEADER,
  WechatPayProvider,
} from '../../src/payment/providers/wechat-pay.provider'
import { CHANNEL_SUCCESS_CONFLICT_AUDIT } from '../../src/payment/refund-channel-answer'
import { nonStaleSuccessCents } from '../../src/payment/refund-remainder'
import { RefundService } from '../../src/payment/refund.service'
import { PrismaService } from '../../src/prisma/prisma.service'

const PAGES = JSON.stringify({ copies: 1, colorMode: 'black_white' })
const MCH_ID = '1900000029'

async function withWebhookAndNotifyServer(
  db: PrismaService,
  tag: string,
  run: (ctx: {
    received: string[]
    postNotify: (orderId: string, refundNo: string, amountCents: number, channelRefundNo: string) => Promise<{
      status: number
      body: Record<string, unknown>
    }>
  }) => Promise<void>,
): Promise<void> {
  const keyOpts = {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  } as const
  const mchKeys = generateKeyPairSync('rsa', keyOpts)
  const platformKeys = generateKeyPairSync('rsa', keyOpts)
  const apiV3Key = randomBytes(16).toString('hex')
  const serial = `PUB_P9E_${tag}`.slice(0, 40)
  const provider = new WechatPayProvider({
    mchid: MCH_ID,
    appid: 'wx0000000000000029',
    mchSerialNo: 'MCH_SERIAL_P9E_0001',
    privateKeyPem: mchKeys.privateKey,
    apiV3Key,
    platformPublicKeyPem: platformKeys.publicKey,
    platformPublicKeyId: serial,
    notifyBaseUrl: 'https://test.local',
    apiBaseUrl: 'http://127.0.0.1:1',
  })
  const registry = new PaymentProviderRegistry([provider])
  const refunds = new RefundService(db, new AuditService(db), registry)

  const received: string[] = []
  const webhook = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk: Buffer) => { body += chunk.toString('utf8') })
    req.on('end', () => {
      received.push(body)
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{"errcode":0}')
    })
  })
  await new Promise<void>((resolve) => webhook.listen(0, '127.0.0.1', () => resolve()))
  const webhookAddr = webhook.address()
  const webhookPort = typeof webhookAddr === 'object' && webhookAddr ? webhookAddr.port : 0
  const prevWebhook = process.env['ALERT_WEBHOOK_URL']
  process.env['ALERT_WEBHOOK_URL'] = `http://127.0.0.1:${webhookPort}/webhook`

  class P2b9eNotifyModule {}
  Module({
    controllers: [PaymentController],
    providers: [
      { provide: PrismaService, useValue: db },
      { provide: OnlinePaymentService, useValue: {} },
      { provide: PricingService, useValue: {} },
      { provide: RefundService, useValue: refunds },
      { provide: PAYMENT_PROVIDER_TOKEN, useValue: registry },
    ],
  })(P2b9eNotifyModule)

  const app = await NestFactory.create(P2b9eNotifyModule, { logger: false, abortOnError: false, bodyParser: false })
  app.setGlobalPrefix('api/v1')
  installBodyParsers(app)
  app.useGlobalFilters(new HttpExceptionFilter())
  await app.listen(0, '127.0.0.1')
  const server = app.getHttpServer() as { address: () => { port: number } | string | null }
  const appAddr = server.address()
  const appPort = typeof appAddr === 'object' && appAddr ? appAddr.port : 0

  const postNotify = async (orderId: string, refundNo: string, amountCents: number, channelRefundNo: string) => {
    const raw = JSON.stringify({
      id: randomUUID(),
      event_type: 'REFUND.SUCCESS',
      resource_type: 'encrypt-resource',
      resource: encryptWechatCallbackResource(JSON.stringify({
        mchid: MCH_ID,
        out_trade_no: `pa_${orderId}`,
        out_refund_no: refundNo,
        refund_id: channelRefundNo,
        refund_status: 'SUCCESS',
        amount: { refund: amountCents, total: 200 },
      }), apiV3Key),
    })
    const timestamp = String(Math.floor(Date.now() / 1000))
    const nonce = randomBytes(16).toString('hex')
    const signature = createSign('RSA-SHA256')
      .update(buildWechatCallbackVerifyBase({ timestamp, nonce, rawBody: Buffer.from(raw, 'utf8') }))
      .sign(platformKeys.privateKey, 'base64')
    const res = await fetch(`http://127.0.0.1:${appPort}/api/v1/payment/wechat/refund-notify`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [WECHAT_TIMESTAMP_HEADER]: timestamp,
        [WECHAT_NONCE_HEADER]: nonce,
        [WECHAT_SIGNATURE_HEADER]: signature,
        [WECHAT_SERIAL_HEADER]: serial,
      },
      body: raw,
    })
    return { status: res.status, body: (await res.json()) as Record<string, unknown> }
  }

  try {
    await run({ received, postNotify })
  } finally {
    await app.close()
    if (prevWebhook === undefined) delete process.env['ALERT_WEBHOOK_URL']
    else process.env['ALERT_WEBHOOK_URL'] = prevWebhook
    await new Promise<void>((resolve) => webhook.close(() => resolve()))
  }
}

export async function runP2b9eNotifyCases(
  db: PrismaService,
  input: { tag: string; orderIds: string[]; taskIds: string[] },
): Promise<void> {
  const tag = input.tag
  const orgId = `org_p2b9e_${tag}`
  const terminalId = `term_p2b9e_${tag}`
  await db.organization.create({ data: { id: orgId, name: '通知累计超退收口', type: 'school_employment_center' } })
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
  const readonlySvc = new AdminOrdersReadonlyService(db)

  const seed = async (
    label: string,
    opts: { payStatus: string; priorSuccessCents?: number; pendingAmountCents: number; refundReason?: string },
  ) => {
    const id = `ord_${tag}_p2b9e_${label}`
    const taskId = `pt_${id}`
    const orderNo = `P9E${tag}${label}`.replace(/[^a-zA-Z0-9]/g, '').slice(0, 32)
    const refundNo = `RFD-ALT-${orderNo}`
    created.push(id)
    input.orderIds.push(id)
    input.taskIds.push(taskId)
    await db.printTask.create({
      data: {
        id: taskId,
        fileUrl: 'https://example.invalid/print',
        fileMd5: 'md5',
        status: 'failed',
        errorCode: 'PAPER_JAM',
        printOutcome: 'not_printed',
        orderId: id,
        terminalId,
      },
    })
    const prior = opts.priorSuccessCents ?? 0
    await db.order.create({
      data: {
        id,
        orderNo,
        type: 'print',
        terminalId,
        amountCents: 200,
        discountCents: 0,
        payStatus: opts.payStatus,
        paymentSource: opts.payStatus === 'unpaid' ? null : 'wechat',
        paidAt: opts.payStatus === 'unpaid' ? null : new Date(Date.now() - 3600_000),
        refundedAmountCents: prior,
        pickupStatus: 'pending',
        taskStatus: 'failed',
        billablePages: 2,
        printParamsJson: PAGES,
        itemsJson: '[]',
        channel: 'kiosk',
        printTaskId: taskId,
      },
    })
    if (prior > 0) {
      await db.refund.create({
        data: {
          orderId: id,
          refundNo: `RFD-PRIOR-${orderNo}`,
          amountCents: prior,
          status: 'success',
          reason: '已退部分',
          channel: 'wechat',
          channelSubmittedAt: new Date(Date.now() - 120_000),
        },
      })
    }
    await db.refund.create({
      data: {
        orderId: id,
        refundNo,
        amountCents: opts.pendingAmountCents,
        status: 'pending',
        reason: opts.refundReason ?? '没出纸退款',
        channel: 'wechat',
        channelSubmittedAt: new Date(Date.now() - 60_000),
      },
    })
    return { id, taskId, orderNo, refundNo }
  }

  try {
    await withWebhookAndNotifyServer(db, tag, async ({ received, postNotify }) => {
      // Case A：应付 200 分，已有成功退款 50 分，再收 200 分微信 REFUND.SUCCESS 通知。
      const over = await seed('over', { payStatus: 'refunding', priorSuccessCents: 50, pendingAmountCents: 200 })
      const hooksBeforeA = received.length
      const resA = await postNotify(over.id, over.refundNo, 200, `WX-P9E-OVER-${tag}`)
      assert.equal(resA.status, 200, '累计超退通知应对微信回 200，避免无限重试')
      assert.equal(resA.body['code'], 'SUCCESS')
      const refundA = await db.refund.findUniqueOrThrow({ where: { refundNo: over.refundNo } })
      assert.equal(refundA.status, 'success', '累计超退不得回滚渠道已退成事实')
      assert.equal(refundA.amountCents, 200)
      assert.equal(await nonStaleSuccessCents(db, over.id), 250)
      const orderA = await db.order.findUniqueOrThrow({ where: { id: over.id } })
      assert.notEqual(orderA.payStatus, 'refunded', '累计超退不得静默把订单改成 refunded')
      assert.equal(orderA.refundedAmountCents, 50)
      const auditA = await db.auditLog.findFirst({ where: { targetId: over.id, action: CHANNEL_SUCCESS_CONFLICT_AUDIT } })
      assert.ok(auditA, '累计超退必须写入 refund.channel_success_conflict 审计')
      assert.match(auditA.payloadJson ?? '', /"code":"REFUND_CHANNEL_AMOUNT_EXCEEDS"/)
      assert.match(auditA.payloadJson ?? '', /"totalSuccessCents":250/)
      assert.match(auditA.payloadJson ?? '', /"source":"notify"/)
      const explainedA = await explainPrintRefund(db, over.id)
      assert.equal(explainedA.disposition, 'manual', '累计超退必须停留在 manual，不得伪装成 auto_success')
      assert.equal((await readonlySvc.getById(over.id)).opsAttention, true)
      assert.ok((await collectPrintReturnAlerts(db)).some((alert) => alert.subjectId === over.id), '累计超退必须进告警中心')
      if (process.env['REDIS_URL']) {
        assert.ok(received.length > hooksBeforeA, `Case A 必须触发真实 Webhook 告警，实收增量 ${received.length - hooksBeforeA}`)
      }

      // Case B1：partial_refunded（已退 50）再收 150 分成功通知 → 退满 refunded 且 refundedAmountCents = 200。
      const restFull = await seed('b150', { payStatus: 'partial_refunded', priorSuccessCents: 50, pendingAmountCents: 150 })
      const resB1 = await postNotify(restFull.id, restFull.refundNo, 150, `WX-P9E-B150-${tag}`)
      assert.equal(resB1.status, 200, 'partial_refunded 收 150 分续退通知不得抛 ORDER_INVALID_TRANSITION')
      const refundB1 = await db.refund.findUniqueOrThrow({ where: { refundNo: restFull.refundNo } })
      assert.equal(refundB1.status, 'success')
      assert.equal(refundB1.amountCents, 150)
      const orderB1 = await db.order.findUniqueOrThrow({ where: { id: restFull.id } })
      assert.equal(orderB1.payStatus, 'refunded')
      assert.equal(orderB1.refundedAmountCents, 200, '已退金额必须是累计 50 + 150 = 200')
      assert.notEqual(orderB1.refundedAt, null)
      assert.equal(await db.auditLog.count({ where: { targetId: restFull.id, action: CHANNEL_SUCCESS_CONFLICT_AUDIT } }), 0)

      // Case B2：partial_refunded（已退 50）再收 80 分成功通知 → 仍 partial_refunded 且 refundedAmountCents = 130。
      const restPart = await seed('b80', { payStatus: 'partial_refunded', priorSuccessCents: 50, pendingAmountCents: 80 })
      const resB2 = await postNotify(restPart.id, restPart.refundNo, 80, `WX-P9E-B80-${tag}`)
      assert.equal(resB2.status, 200)
      const orderB2 = await db.order.findUniqueOrThrow({ where: { id: restPart.id } })
      assert.equal(orderB2.payStatus, 'partial_refunded')
      assert.equal(orderB2.refundedAmountCents, 130, '已退金额必须是累计 50 + 80 = 130，不能覆写成 80')
      assert.equal(orderB2.refundedAt, null)

      // Case B3：partial_refunded（已退 50）收 200 分超退通知 → HTTP 200、保留 success 不回滚 pending、写冲突审计与 Webhook。
      const partOver = await seed('b200', { payStatus: 'partial_refunded', priorSuccessCents: 50, pendingAmountCents: 200 })
      const hooksBeforeB3 = received.length
      const resB3 = await postNotify(partOver.id, partOver.refundNo, 200, `WX-P9E-B200-${tag}`)
      assert.equal(resB3.status, 200, 'partial_refunded 收超退通知不得抛 400 回滚')
      const refundB3 = await db.refund.findUniqueOrThrow({ where: { refundNo: partOver.refundNo } })
      assert.equal(refundB3.status, 'success', '绝不能把渠道已退成回滚为 pending')
      assert.equal(await nonStaleSuccessCents(db, partOver.id), 250)
      const orderB3 = await db.order.findUniqueOrThrow({ where: { id: partOver.id } })
      assert.equal(orderB3.payStatus, 'partial_refunded')
      assert.equal(orderB3.refundedAmountCents, 50)
      assert.equal(await db.auditLog.count({ where: { targetId: partOver.id, action: CHANNEL_SUCCESS_CONFLICT_AUDIT } }), 1)
      assert.equal((await explainPrintRefund(db, partOver.id)).disposition, 'manual')
      const detailB3 = await readonlySvc.getById(partOver.id)
      assert.equal(detailB3.opsAttention, true)
      assert.equal(detailB3.refundEligible, false)
      assert.ok((await collectPrintReturnAlerts(db)).some((alert) => alert.subjectId === partOver.id))
      if (process.env['REDIS_URL']) {
        assert.ok(received.length > hooksBeforeB3, 'Case B3 超退冲突必须触发真实 Webhook 告警')
      }

      // Case B4：意外订单态（unpaid 无待退信号）收 200 分成功通知 → HTTP 200、保留 success 不抛 ORDER_INVALID_TRANSITION。
      const stateConflict = await seed('bstate', { payStatus: 'unpaid', pendingAmountCents: 200 })
      const hooksBeforeB4 = received.length
      const resB4 = await postNotify(stateConflict.id, stateConflict.refundNo, 200, `WX-P9E-BSTATE-${tag}`)
      assert.equal(resB4.status, 200, '意外订单态收成功通知不得抛 ORDER_INVALID_TRANSITION 回滚')
      const refundB4 = await db.refund.findUniqueOrThrow({ where: { refundNo: stateConflict.refundNo } })
      assert.equal(refundB4.status, 'success', '意外订单态也不得回滚渠道已退成事实')
      const auditB4 = await db.auditLog.findFirst({ where: { targetId: stateConflict.id, action: CHANNEL_SUCCESS_CONFLICT_AUDIT } })
      assert.ok(auditB4, '意外订单态必须写 refund.channel_success_conflict 审计')
      assert.match(auditB4.payloadJson ?? '', /"code":"REFUND_NOTIFY_ORDER_STATE_CONFLICT"/)
      assert.match(auditB4.payloadJson ?? '', /"payStatus":"unpaid"/)
      assert.match(auditB4.payloadJson ?? '', /"source":"notify"/)
      assert.equal((await explainPrintRefund(db, stateConflict.id)).disposition, 'manual')
      assert.equal((await readonlySvc.getById(stateConflict.id)).opsAttention, true)
      assert.ok((await collectPrintReturnAlerts(db)).some((alert) => alert.subjectId === stateConflict.id))
      if (process.env['REDIS_URL']) {
        assert.ok(received.length > hooksBeforeB4, 'Case B4 状态冲突必须触发真实 Webhook 告警')
      }

      // Case C：过期付款补收退款成功通知 → 落 success，不计入非过期合计，不把正常实付单误翻为 refunded。
      const stale = await seed('stale', {
        payStatus: 'paid',
        pendingAmountCents: 200,
        refundReason: STALE_ATTEMPT_REFUND_REASON,
      })
      const resC = await postNotify(stale.id, stale.refundNo, 200, `WX-P9E-STALE-${tag}`)
      assert.equal(resC.status, 200)
      assert.equal((await db.refund.findUniqueOrThrow({ where: { refundNo: stale.refundNo } })).status, 'success')
      assert.equal(await nonStaleSuccessCents(db, stale.id), 0)
      const orderC = await db.order.findUniqueOrThrow({ where: { id: stale.id } })
      assert.equal(orderC.payStatus, 'paid', '过期付款补收退款不得把正常实付单翻成 refunded')
      assert.equal(orderC.refundedAmountCents, 0)
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
