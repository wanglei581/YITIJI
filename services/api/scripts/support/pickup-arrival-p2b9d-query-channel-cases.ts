/**
 * P2b9d 第 5 条：24 小时内在途单「向渠道查询结果」只查不处置端点 + manual_review 通知收口（18:13 裁定）。
 * - 24 小时内 manual_review 在途单调 queryPrintReturnChannel，渠道回 success(200)：
 *   直接落库 Refund.status='success'、order.payStatus='refunded'、channelInFlight=false，不再被 24h 卡死。
 * - 24 小时内 pending 在途单调 queryPrintReturnChannel，渠道回 failed：
 *   仅落库 failed、订单回 paid、channelInFlight=false，绝不自动放行出纸或关单（只查不处置）。
 * - 渠道回 processing / abnormal / unknown / fault：分别给出清晰中文提示、不乱改状态，abnormal 记诊断告警，fault 抛 REFUND_CHANNEL_QUERY_FAILED。
 * - 纸已出 + 渠道回 success(200)：返回 outcome='conflict'、保留 Refund.status='success'（不回滚）、写冲突审计。
 * - manual_review 收到微信 REFUND.SUCCESS 异步通知（先 failed 收 ABNORMAL 转 manual_review，再收 SUCCESS）：
 *   金额一致、未出纸下正常收口成 success + refunded（不再被 refund-notify-paper-guard 忽略为 idempotent）。
 * - 已关单（closed）上的 manual_review 收到重复 REFUND.SUCCESS 通知：幂等返回 idempotent，不抛 400。
 */
import assert from 'node:assert/strict'
import { createSign, generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto'
import { BadRequestException } from '@nestjs/common'
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants'
import { AdminOrdersReadonlyService } from '../../src/admin-orders-readonly/admin-orders-readonly.service'
import { AuditService } from '../../src/audit/audit.service'
import { AdminOrderActionsController } from '../../src/payment/admin-order-actions.controller'
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
import { PAID_NO_PAPER_AUTO_REASON } from '../../src/payment/print-no-paper-refund.constants'
import { queryPrintReturnChannel } from '../../src/payment/query-print-return-channel'
import { CHANNEL_SUCCESS_CONFLICT_AUDIT } from '../../src/payment/refund-channel-answer'
import { RefundService } from '../../src/payment/refund.service'
import type { PrismaService } from '../../src/prisma/prisma.service'

const PAGES = JSON.stringify({ copies: 1, colorMode: 'black_white' })
const MCH_ID = '1900000025'

function errorCode(error: unknown): string {
  if (!(error instanceof BadRequestException)) return error instanceof Error ? error.message : 'error'
  const body = error.getResponse() as { error?: { code?: string } } | string
  if (typeof body === 'string') return body
  return body?.error?.code ?? error.message
}

export async function runP2b9dQueryChannelCases(
  db: PrismaService,
  input: { tag: string; orderIds: string[]; taskIds: string[] },
): Promise<void> {
  // 0. 校验控制器路由、角色与限流元数据。
  const handler = AdminOrderActionsController.prototype.queryPrintReturnChannel
  assert.equal(Reflect.getMetadata(PATH_METADATA, handler), 'admin/orders/:id/print-return/query-channel')
  assert.notEqual(Reflect.getMetadata(METHOD_METADATA, handler), undefined)
  assert.deepEqual(Reflect.getMetadata('roles', AdminOrderActionsController), ['admin'])
  assert.equal(Reflect.getMetadata('THROTTLER:LIMITdefault', handler), 20)
  assert.equal(Reflect.getMetadata('THROTTLER:TTLdefault', handler), 60_000)

  const tag = input.tag
  const orgId = `org_p2b9d5_${tag}`
  const terminalId = `term_p2b9d5_${tag}`
  await db.organization.create({ data: { id: orgId, name: '向渠道查询结果', type: 'school_employment_center' } })
  await db.terminal.create({
    data: { id: terminalId, terminalCode: terminalId, agentToken: `tok-${terminalId}`, deviceFingerprint: `fp-${terminalId}`, orgId, enabled: true, lifecycleStatus: 'active' },
  })
  const created: string[] = []
  const seed = async (
    label: string,
    opts: { refundStatus: string; payStatus: string; taskStatus?: string; printOutcome?: string | null; submittedMsAgo?: number },
  ) => {
    const id = `ord_${tag}_p2b9d5_${label}`
    const taskId = `pt_${id}`
    const orderNo = `P9D5${tag}${label}`.replace(/[^a-zA-Z0-9]/g, '').slice(0, 32)
    const refundNo = `RFD-${orderNo}`
    const taskStatus = opts.taskStatus ?? 'failed'
    created.push(id)
    input.orderIds.push(id)
    input.taskIds.push(taskId)
    await db.printTask.create({
      data: {
        id: taskId,
        fileUrl: 'https://example.invalid/print',
        fileMd5: 'md5',
        status: taskStatus,
        errorCode: taskStatus === 'failed' ? 'PAPER_JAM' : null,
        printOutcome: opts.printOutcome === undefined ? (taskStatus === 'failed' ? 'not_printed' : null) : opts.printOutcome,
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
        paidAt: new Date(Date.now() - 2 * 60 * 60_000),
        pickupStatus: 'pending',
        taskStatus,
        billablePages: 2,
        printParamsJson: PAGES,
        itemsJson: '[]',
        channel: 'kiosk',
        printTaskId: taskId,
      },
    })
    await db.paymentAttempt.create({
      data: {
        id: `pa_${id}`,
        orderId: id,
        channel: 'wechat',
        amountCents: 200,
        status: 'success',
        channelTxnNo: `wxtxn_${tag}_${label}`.slice(0, 64),
        prepayId: `prepay_${id}`.slice(0, 64),
      },
    })
    const submitted = new Date(Date.now() - (opts.submittedMsAgo ?? 30 * 60_000))
    await db.refund.create({
      data: {
        orderId: id,
        refundNo,
        amountCents: 200,
        status: opts.refundStatus,
        reason: PAID_NO_PAPER_AUTO_REASON,
        channel: 'wechat',
        createdAt: submitted,
        channelSubmittedAt: submitted,
      },
    })
    return { id, taskId, orderNo, refundNo }
  }

  try {
    // 1. 24h 内 manual_review 在途单：点「向渠道查询结果」，渠道回 success(200) 直接安全收口。
    const mr = await seed('mr', { refundStatus: 'manual_review', payStatus: 'refunding', taskStatus: 'pending', printOutcome: null })
    const detailBefore = await new AdminOrdersReadonlyService(db).getById(mr.id)
    assert.equal(detailBefore.channelInFlight, true)
    assert.equal(detailBefore.channelResultRegistration, null, '未满 24h 不出登记卡片，全靠向渠道查询结果收口')
    const mrRes = await queryPrintReturnChannel(db, mr.id, 'admin-p2b9d', async () => ({
      verdict: 'success',
      refundAmountCents: 200,
      channelRefundNo: 'WX-Q-MR-200',
    }))
    assert.equal(mrRes.outcome, 'refunded')
    assert.equal(mrRes.payStatus, 'refunded')
    assert.equal(mrRes.refundStatus, 'success')
    assert.equal(mrRes.channelInFlight, false)
    assert.equal(mrRes.checkedCount, 1)
    assert.equal((await db.refund.findUniqueOrThrow({ where: { refundNo: mr.refundNo } })).status, 'success')
    assert.equal((await db.printTask.findUniqueOrThrow({ where: { id: mr.taskId } })).status, 'cancelled')

    // 2. 24h 内 pending 在途单查到 failed：只落库 failed 与订单回 paid，不放行出纸也不关单。
    const fl = await seed('fl', { refundStatus: 'pending', payStatus: 'refunding', taskStatus: 'failed', printOutcome: 'not_printed' })
    const flRes = await queryPrintReturnChannel(db, fl.id, 'admin-p2b9d', async () => 'failed')
    assert.equal(flRes.outcome, 'failed')
    assert.equal(flRes.payStatus, 'paid')
    assert.equal(flRes.refundStatus, 'failed')
    assert.equal(flRes.channelInFlight, false)
    assert.equal((await db.printTask.findUniqueOrThrow({ where: { id: fl.taskId } })).status, 'failed', '只查不处置，不得自动改为出纸或关单')

    // 3. processing / abnormal / fault。
    const pr = await seed('pr', { refundStatus: 'pending', payStatus: 'refunding' })
    assert.equal((await queryPrintReturnChannel(db, pr.id, 'admin-p2b9d', async () => 'processing')).outcome, 'processing')
    assert.equal((await queryPrintReturnChannel(db, pr.id, 'admin-p2b9d', async () => 'abnormal')).outcome, 'abnormal')
    assert.equal(await db.auditLog.count({ where: { targetId: pr.id, action: 'refund.channel_abnormal' } }), 1)
    const faultCode = await queryPrintReturnChannel(db, pr.id, 'admin-p2b9d', async () => {
      throw new Error('HTTP 502')
    }).then(() => 'ok', errorCode)
    assert.equal(faultCode, 'REFUND_CHANNEL_QUERY_FAILED')
    assert.equal((await db.refund.findUniqueOrThrow({ where: { refundNo: pr.refundNo } })).status, 'pending')

    // 4. 纸已出 + 渠道查成 200：返回 outcome='conflict'，保留 Refund.status='success'，不回滚。
    const cf = await seed('cf', { refundStatus: 'manual_review', payStatus: 'paid', taskStatus: 'completed', printOutcome: 'printed' })
    const cfRes = await queryPrintReturnChannel(db, cf.id, 'admin-p2b9d', async () => ({
      verdict: 'success',
      refundAmountCents: 200,
      channelRefundNo: 'WX-Q-CONFLICT',
    }))
    assert.equal(cfRes.outcome, 'conflict')
    assert.equal(cfRes.refundStatus, 'success')
    assert.equal(cfRes.channelInFlight, false)
    assert.equal(cfRes.payStatus, 'paid')
    assert.equal(await db.auditLog.count({ where: { targetId: cf.id, action: CHANNEL_SUCCESS_CONFLICT_AUDIT } }), 1)

    // 5. manual_review 收到微信 REFUND.SUCCESS 异步通知（先 failed 收 ABNORMAL 转 manual_review，再收 SUCCESS）：安全收口。
    const keyOpts = { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } } as const
    const mchKeys = generateKeyPairSync('rsa', keyOpts)
    const platformKeys = generateKeyPairSync('rsa', keyOpts)
    const apiV3Key = randomBytes(16).toString('hex')
    const serial = `PUB_P9D5_${tag}`.slice(0, 40)
    const provider = new WechatPayProvider({
      mchid: MCH_ID,
      appid: 'wx0000000000000025',
      mchSerialNo: 'MCH_SERIAL_P9D5_0001',
      privateKeyPem: mchKeys.privateKey,
      apiV3Key,
      platformPublicKeyPem: platformKeys.publicKey,
      platformPublicKeyId: serial,
      notifyBaseUrl: 'https://test.local',
      apiBaseUrl: 'http://127.0.0.1:1',
    })
    const refunds = new RefundService(db, new AuditService(db), new PaymentProviderRegistry([provider]))
    const sendNotify = (order: { id: string; refundNo: string }, refundStatus: 'ABNORMAL' | 'SUCCESS', refundId: string) => {
      const rawBody = Buffer.from(JSON.stringify({
        id: randomUUID(),
        event_type: `REFUND.${refundStatus}`,
        resource_type: 'encrypt-resource',
        resource: encryptWechatCallbackResource(JSON.stringify({
          mchid: MCH_ID,
          out_trade_no: `pa_${order.id}`,
          out_refund_no: order.refundNo,
          refund_id: refundId,
          refund_status: refundStatus,
          amount: { refund: 200, total: 200 },
        }), apiV3Key),
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
    const abnMr = await seed('abnmr', { refundStatus: 'failed', payStatus: 'paid', taskStatus: 'failed', printOutcome: 'not_printed' })
    await sendNotify(abnMr, 'ABNORMAL', `wx_abnmr_${tag}`)
    assert.equal((await db.refund.findUniqueOrThrow({ where: { refundNo: abnMr.refundNo } })).status, 'manual_review')
    const settled = await sendNotify(abnMr, 'SUCCESS', `wx_abnmr_${tag}`)
    assert.equal(settled.ok, true)
    assert.notEqual(settled.idempotent, true, 'manual_review 收到金额一致且未出纸的 REFUND.SUCCESS 不得再被忽略成 idempotent')
    assert.equal((await db.refund.findUniqueOrThrow({ where: { refundNo: abnMr.refundNo } })).status, 'success')
    assert.equal((await db.order.findUniqueOrThrow({ where: { id: abnMr.id } })).payStatus, 'refunded')

    // 6. 已关单上的 manual_review 收到重复 REFUND.SUCCESS 通知：幂等返回，不抛 400。
    const closedMr = await seed('clsmr', { refundStatus: 'manual_review', payStatus: 'closed', taskStatus: 'cancelled', printOutcome: null })
    const closedDup = await sendNotify(closedMr, 'SUCCESS', `wx_clsmr_${tag}`)
    assert.equal(closedDup.ok, true)
    assert.equal(closedDup.idempotent, true)
    assert.equal((await db.order.findUniqueOrThrow({ where: { id: closedMr.id } })).payStatus, 'closed')
  } finally {
    await db.refund.deleteMany({ where: { orderId: { in: created } } })
    await db.paymentAttempt.deleteMany({ where: { orderId: { in: created } } })
    await db.auditLog.deleteMany({ where: { targetId: { in: created } } })
    await db.order.deleteMany({ where: { id: { in: created } } })
    await db.printTask.deleteMany({ where: { orderId: { in: created } } })
    await db.terminal.delete({ where: { id: terminalId } }).catch(() => undefined)
    await db.organization.delete({ where: { id: orgId } }).catch(() => undefined)
  }
}
