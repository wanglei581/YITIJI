/**
 * 微信退款异常（ABNORMAL）不当失败（第 5 条）。钱停在渠道中间账户：不记 failed、不回滚、不放行出纸，
 * 进待人工并告警，诊断写明「资金在渠道中间账户，需按渠道异常退款流程处理」。
 * - 退款结果通知 ABNORMAL（真实验签、解密路径）：退款仍是处理中、订单仍在退款中；重复通知只记一次诊断；
 *   改为出纸不放行（查渠道仍是异常，提示写明中间账户）；待人工说明是这句诊断；
 *   商户处理完异常退款、渠道通知退成之后照常收口为已退。
 * - 已经记成失败的退款又收到 ABNORMAL：改回待人工（和渠道答复矛盾），三步不放行。
 * - 发起退款时渠道直接回 ABNORMAL（微信应答原样解析）：不抛渠道失败、不回滚。过期付款那一路同样不记失败。
 */
import assert from 'node:assert/strict'
import { createSign, generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto'
import { BadRequestException } from '@nestjs/common'
import { AuditService } from '../../src/audit/audit.service'
import { PaymentProviderRegistry } from '../../src/payment/payment-provider.factory'
import type { PaymentProvider } from '../../src/payment/payment-provider.types'
import { PAID_NO_PAPER_AUTO_REASON } from '../../src/payment/print-no-paper-refund.constants'
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
import { parseWechatRefundCreate, parseWechatRefundQuery } from '../../src/payment/providers/wechat-pay-refund'
import { CHANNEL_ABNORMAL_DETAIL, isChannelAbnormal } from '../../src/payment/refund-abnormal'
import { queryRefundChannel } from '../../src/payment/refund-channel-query'
import { RefundService } from '../../src/payment/refund.service'
import { resolvePrintReturnHold } from '../../src/payment/resolve-print-return-hold'
import { refundExpiredAttemptCollection } from '../../src/payment/stale-attempt-collection'
import type { PrismaService } from '../../src/prisma/prisma.service'

const PAGES = JSON.stringify({ copies: 1, colorMode: 'black_white' })
const MCH_ID = '1900000009'

function rejection(error: unknown): { code: string; message: string } {
  if (!(error instanceof BadRequestException)) return { code: error instanceof Error ? error.message : 'error', message: '' }
  const body = error.getResponse() as { error?: { code?: string; message?: string } } | string
  if (typeof body === 'string') return { code: body, message: '' }
  return { code: body?.error?.code ?? error.message, message: body?.error?.message ?? '' }
}

export async function runP2b9AbnormalCases(
  db: PrismaService,
  input: { tag: string; orderIds: string[]; taskIds: string[] },
): Promise<void> {
  const tag = input.tag
  const keyOpts = { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } } as const
  const mchKeys = generateKeyPairSync('rsa', keyOpts)
  const platformKeys = generateKeyPairSync('rsa', keyOpts)
  const apiV3Key = randomBytes(16).toString('hex')
  const serial = `PUB_KEY_ID_P2B9_${tag}`.slice(0, 40)
  const provider = new WechatPayProvider({
    mchid: MCH_ID,
    appid: 'wx0000000000000009',
    mchSerialNo: 'MCH_SERIAL_P2B9_0001',
    privateKeyPem: mchKeys.privateKey,
    apiV3Key,
    platformPublicKeyPem: platformKeys.publicKey,
    platformPublicKeyId: serial,
    notifyBaseUrl: 'https://test.local',
    apiBaseUrl: 'http://127.0.0.1:1',
  })
  const refunds = new RefundService(db, new AuditService(db), new PaymentProviderRegistry([provider]))
  const notify = (payload: Record<string, unknown>) => {
    const rawBody = Buffer.from(JSON.stringify({
      id: randomUUID(),
      event_type: payload['refund_status'] === 'SUCCESS' ? 'REFUND.SUCCESS' : `REFUND.${String(payload['refund_status'])}`,
      resource_type: 'encrypt-resource',
      resource: encryptWechatCallbackResource(JSON.stringify(payload), apiV3Key),
    }), 'utf8')
    const timestamp = String(Math.floor(Date.now() / 1000))
    const nonce = randomBytes(16).toString('hex')
    const signature = createSign('RSA-SHA256').update(buildWechatCallbackVerifyBase({ timestamp, nonce, rawBody })).sign(platformKeys.privateKey, 'base64')
    return refunds.processWechatRefundNotify(rawBody, {
      [WECHAT_TIMESTAMP_HEADER]: timestamp,
      [WECHAT_NONCE_HEADER]: nonce,
      [WECHAT_SIGNATURE_HEADER]: signature,
      [WECHAT_SERIAL_HEADER]: serial,
    })
  }
  const terminalId = `term_p2b9ab_${tag}`
  await db.terminal.create({
    data: { id: terminalId, terminalCode: terminalId, agentToken: `tok-${terminalId}`, deviceFingerprint: `fp-${terminalId}`, enabled: true, lifecycleStatus: 'active' },
  })
  const created: string[] = []
  const seed = async (label: string, refundStatus: string, payStatus = 'refunding'): Promise<{ id: string; orderNo: string; refundNo: string }> => {
    const id = `ord_${tag}_p2b9ab_${label}`
    const orderNo = `P9AB${tag}${label}`.replace(/[^a-zA-Z0-9]/g, '').slice(0, 32)
    created.push(id)
    input.orderIds.push(id)
    input.taskIds.push(`pt_${id}`)
    await db.printTask.create({
      data: { id: `pt_${id}`, fileUrl: 'https://example.invalid/print', fileMd5: 'md5', status: 'failed', errorCode: 'PAPER_JAM', printOutcome: 'not_printed', orderId: id, terminalId },
    })
    await db.order.create({
      data: {
        id, orderNo, type: 'print', terminalId, amountCents: 200, discountCents: 0, payStatus, paymentSource: 'wechat',
        paidAt: new Date(Date.now() - 20 * 60 * 1000), pickupStatus: 'pending', taskStatus: 'failed', billablePages: 2,
        printParamsJson: PAGES, itemsJson: '[]', channel: 'kiosk', printTaskId: `pt_${id}`,
      },
    })
    await db.paymentAttempt.create({
      data: { id: `pa_${id}`, orderId: id, channel: 'wechat', amountCents: 200, status: 'success', channelTxnNo: `wxtxn_${tag}_${label}`.slice(0, 64), prepayId: `prepay_${id}`.slice(0, 64) },
    })
    const refundNo = `RFD-${orderNo}`
    if (refundStatus !== 'none') {
      await db.refund.create({
        data: { orderId: id, refundNo, amountCents: 200, status: refundStatus, reason: PAID_NO_PAPER_AUTO_REASON, channel: 'wechat', channelSubmittedAt: new Date(Date.now() - 15 * 60 * 1000) },
      })
    }
    return { id, orderNo, refundNo }
  }
  const refundOf = (refundNo: string) => db.refund.findUniqueOrThrow({ where: { refundNo } })
  const abnormalAudits = (orderId: string) => db.auditLog.findMany({ where: { targetId: orderId, action: 'refund.channel_abnormal' } })
  const abnormalQuery = (query: { channel: string; refundNo: string; orderId: string }) => queryRefundChannel(
    new PaymentProviderRegistry([{ channel: 'wechat', queryRefund: async () => ({ status: 'failed', channelRefundNo: 'wx-abn', refundState: 'ABNORMAL' }) } as unknown as PaymentProvider]),
    db,
    query,
  )

  try {
    // 1. 退款结果通知 ABNORMAL。
    const held = await seed('held', 'pending')
    const abnormalPayload = (order: { id: string; refundNo: string }, refundId: string) => ({
      mchid: MCH_ID, out_trade_no: `pa_${order.id}`, out_refund_no: order.refundNo, refund_id: refundId, refund_status: 'ABNORMAL', amount: { refund: 200, total: 200 },
    })
    assert.deepEqual(await notify(abnormalPayload(held, `wx_abn_${tag}`)), { ok: true })
    const heldRow = await refundOf(held.refundNo)
    assert.equal(heldRow.status, 'pending', '退款异常不能记成失败')
    assert.notEqual(heldRow.status, 'failed')
    assert.equal(heldRow.channelRefundNo, `wx_abn_${tag}`)
    assert.equal((await db.order.findUniqueOrThrow({ where: { id: held.id } })).payStatus, 'refunding', '退款异常不能把订单回滚成已付')
    const audits = await abnormalAudits(held.id)
    assert.equal(audits.length, 1)
    assert.match(audits[0]?.payloadJson ?? '', /资金在渠道中间账户，需按渠道异常退款流程处理/)
    await notify(abnormalPayload(held, `wx_abn_${tag}`))
    assert.equal((await abnormalAudits(held.id)).length, 1, '重复的异常通知只记一次诊断')
    assert.equal((await refundOf(held.refundNo)).status, 'pending')
    const noQuery = await resolvePrintReturnHold(db, held.id, 'release_paper', 'admin-test').then(() => null, rejection)
    assert.equal(noQuery?.code, 'REFUND_CHANNEL_UNCONFIRMED', '退款异常时改为出纸不放行')
    const queried = await resolvePrintReturnHold(db, held.id, 'release_paper', 'admin-test', abnormalQuery).then(() => null, rejection)
    assert.equal(queried?.code, 'REFUND_CHANNEL_UNCONFIRMED')
    assert.match(queried?.message ?? '', /中间账户/, '查渠道仍是异常时，提示要写明钱在中间账户')
    assert.equal((await refundOf(held.refundNo)).status, 'pending')
    assert.equal((await db.printTask.findUniqueOrThrow({ where: { id: `pt_${held.id}` } })).status, 'failed')
    const explained = await explainPrintRefund(db, held.id)
    assert.equal(explained.disposition, 'manual')
    assert.equal(explained.reason, CHANNEL_ABNORMAL_DETAIL, '待人工说明写这句诊断')
    // 商户处理完异常退款，渠道通知退成：照常收口。
    await notify({ mchid: MCH_ID, out_trade_no: `pa_${held.id}`, out_refund_no: held.refundNo, refund_id: `wx_abn_${tag}`, refund_status: 'SUCCESS', amount: { refund: 200, total: 200 } })
    assert.equal((await refundOf(held.refundNo)).status, 'success')
    assert.equal((await db.order.findUniqueOrThrow({ where: { id: held.id } })).payStatus, 'refunded')

    // 2. 已经记成失败的退款又收到 ABNORMAL：和渠道答复矛盾，改回待人工，三步不放行。
    const contra = await seed('contra', 'failed', 'paid')
    await notify(abnormalPayload(contra, `wx_abn_c_${tag}`))
    const contraRow = await refundOf(contra.refundNo)
    assert.equal(contraRow.status, 'manual_review')
    assert.ok(contraRow.channelSubmittedAt)
    const contraCode = await resolvePrintReturnHold(db, contra.id, 'close_order', 'admin-test').then(() => null, rejection)
    assert.equal(contraCode?.code, 'REFUND_CHANNEL_UNCONFIRMED')
    assert.equal((await db.order.findUniqueOrThrow({ where: { id: contra.id } })).payStatus, 'paid')

    // 3. 发起退款时渠道直接回 ABNORMAL：微信应答原样解析出退款异常；退款服务不抛渠道失败、不回滚。
    const created = parseWechatRefundCreate({ status: 'ABNORMAL', refund_id: 'wx-abn-create' })
    assert.equal(created.status, 'failed', '归一化 status 仍是 failed（服务单沿用）')
    assert.equal(isChannelAbnormal(created), true, '退款申请应答要带出退款异常原文')
    assert.equal(isChannelAbnormal(parseWechatRefundQuery({ status: 'ABNORMAL', refund_id: 'wx-abn-query', amount: { refund: 200 } })), true)
    assert.equal(isChannelAbnormal(parseWechatRefundCreate({ status: 'CLOSED', refund_id: 'wx-closed' })), false, '退款关闭才是没退出去')
    const direct = await seed('direct', 'none', 'paid')
    const directService = new RefundService(db, new AuditService(db), new PaymentProviderRegistry([
      { channel: 'wechat', refund: async () => ({ status: 'failed', channelRefundNo: 'wx-abn-direct', refundState: 'ABNORMAL' }) } as unknown as PaymentProvider,
    ]))
    const directView = await directService.refund(direct.id, { reason: '发起时就异常' })
    assert.equal(directView.refund.status, 'pending', '发起时回退款异常也不当失败')
    assert.equal((await db.order.findUniqueOrThrow({ where: { id: direct.id } })).payStatus, 'refunding')
    assert.equal((await abnormalAudits(direct.id)).length, 1)
    assert.equal((await resolvePrintReturnHold(db, direct.id, 'release_paper', 'admin-test').then(() => null, rejection))?.code, 'REFUND_CHANNEL_UNCONFIRMED')

    // 4. 过期付款那一路：渠道回 ABNORMAL 不记失败。
    const stale = await seed('stale', 'none', 'paid')
    const staleAttempt = `pa_old_${stale.id}`
    await db.paymentAttempt.create({ data: { id: staleAttempt, orderId: stale.id, channel: 'wechat', amountCents: 300, status: 'expired', prepayId: `prepay_${staleAttempt}`.slice(0, 64) } })
    await refundExpiredAttemptCollection(db, new PaymentProviderRegistry([
      { channel: 'wechat', refund: async () => ({ status: 'failed', channelRefundNo: 'wx-abn-stale', refundState: 'ABNORMAL' }) } as unknown as PaymentProvider,
    ]), {
      orderId: stale.id, orderNo: stale.orderNo, payStatus: 'paid', attemptId: staleAttempt, attemptStatus: 'expired',
      attemptAmountCents: 300, orderAmountCents: 200, channel: 'wechat', channelTxnNo: `wxtxn_old_${tag}`, result: 'success',
    })
    const staleRow = await db.refund.findFirstOrThrow({ where: { orderId: stale.id } })
    assert.equal(staleRow.status, 'pending', '过期付款退款异常也不当失败')
    assert.equal(staleRow.channelRefundNo, 'wx-abn-stale')
    assert.equal((await abnormalAudits(stale.id)).length, 1)
  } finally {
    await db.refund.deleteMany({ where: { orderId: { in: created } } })
    await db.paymentAttempt.deleteMany({ where: { orderId: { in: created } } })
    await db.auditLog.deleteMany({ where: { targetId: { in: created } } })
    await db.order.deleteMany({ where: { id: { in: created } } })
    await db.printTask.deleteMany({ where: { orderId: { in: created } } })
    await db.terminal.delete({ where: { id: terminalId } }).catch(() => undefined)
  }
}
