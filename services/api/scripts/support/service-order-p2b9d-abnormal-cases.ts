/**
 * P2b9d 第 4 条：AI 服务单 ABNORMAL 全部三处不当失败（18:13 裁定）。
 * - 发起退款应答 ABNORMAL（service-order.payment.ts:258）：不递增 refundAttempts、不置 refund_failed、
 *   refundChannelState='processing'（后续重试走 queryRefund 而非重复 refund）、写明中间账户诊断、触发告警。
 * - 查询收敛 ABNORMAL（applyRefundQuery，临近重试上限 refundAttempts=7）：同样不递增 refundAttempts、
 *   不置 refund_failed、写明中间账户诊断、触发告警。
 * - 微信退款回调通知 ABNORMAL（settleServiceRefundNotify + processWechatRefundNotify 真实解密验签）：
 *   先收 CLOSED 再收 ABNORMAL（refundState 纳入 serviceRefundNotifyKey 指纹），不递增 refundAttempts、
 *   不置 refund_failed、写明中间账户诊断、触发告警；随后收到 REFUND.SUCCESS 正常收口 refunded 且清空 refundAnomaly。
 */
import assert from 'node:assert/strict'
import { createSign, generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { AuditService } from '../../src/audit/audit.service'
import { collectServiceReturnAlerts } from '../../src/admin-ops/derived-service-return-alerts'
import { PaymentProviderRegistry } from '../../src/payment/payment-provider.factory'
import type { PaymentProvider } from '../../src/payment/payment-provider.types'
import {
  buildWechatCallbackVerifyBase,
  encryptWechatCallbackResource,
  WECHAT_NONCE_HEADER,
  WECHAT_SERIAL_HEADER,
  WECHAT_SIGNATURE_HEADER,
  WECHAT_TIMESTAMP_HEADER,
  WechatPayProvider,
} from '../../src/payment/providers/wechat-pay.provider'
import { RefundService } from '../../src/payment/refund.service'
import { SERVICE_REFUND_ABNORMAL_AUDIT } from '../../src/payment/service-order-refund-abnormal'
import { executeServiceOrderRefund, serviceRefundNo, settleServiceRefundNotify, type RefundRedis } from '../../src/payment/service-order.payment'
import type { PrismaService } from '../../src/prisma/prisma.service'

function memoryRedis(): RefundRedis {
  const keys = new Set<string>()
  return {
    async setIfAbsent(key: string): Promise<boolean> {
      if (keys.has(key)) return false
      keys.add(key)
      return true
    },
    async del(key: string): Promise<number> {
      return keys.delete(key) ? 1 : 0
    },
  }
}

async function withWebhook(run: (received: string[]) => Promise<void>): Promise<void> {
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
  const prev = process.env['ALERT_WEBHOOK_URL']
  process.env['ALERT_WEBHOOK_URL'] = `http://127.0.0.1:${port}/svc-alert`
  try {
    await run(received)
  } finally {
    if (prev === undefined) delete process.env['ALERT_WEBHOOK_URL']
    else process.env['ALERT_WEBHOOK_URL'] = prev
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

export async function runServiceOrderP2b9dAbnormalCases(db: PrismaService, tag: string): Promise<void> {
  const terminalId = `term_svcabn_${tag}`
  const createdIds: string[] = []
  const audit = new AuditService(db)
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

  const seedServiceOrder = async (
    label: string,
    opts?: { status?: string; refundAttempts?: number; refundChannelState?: string | null; withRefundNo?: boolean },
  ) => {
    const id = `svo_${tag}_${label}`.slice(0, 48)
    createdIds.push(id)
    const providerOrderNo = `svc${tag}${label}`.replace(/[^a-zA-Z0-9]/g, '').slice(0, 32)
    await db.serviceOrder.create({
      data: {
        id,
        terminalId,
        serviceKey: 'resume_optimize',
        amountCents: 100,
        status: opts?.status ?? 'paid',
        attemptsUsed: 0,
        kioskSessionId: `ks_${id}`,
        provider: 'wechat',
        providerOrderNo,
        channelTxnNo: `wxtxn_${id}`,
        paidAt: new Date(Date.now() - 10 * 60_000),
        expiresAt: new Date(Date.now() + 10 * 60_000),
        refundAttempts: opts?.refundAttempts ?? 0,
        refundChannelState: opts?.refundChannelState ?? null,
        refundNo: opts?.withRefundNo ? serviceRefundNo(id) : null,
        nextRefundAt: opts?.status === 'refunding' ? new Date(Date.now() - 1_000) : null,
      },
    })
    return { id, providerOrderNo, refundNo: serviceRefundNo(id) }
  }

  try {
    await withWebhook(async (received) => {
      const redis = memoryRedis()

      // 1. 发起退款应答 ABNORMAL（service-order.payment.ts:258）。
      let createRefundCalls = 0
      let createQueryCalls = 0
      const createProvider = {
        channel: 'wechat',
        refund: async () => {
          createRefundCalls += 1
          return { status: 'failed' as const, channelRefundNo: 'wx-svc-abn-create', refundState: 'ABNORMAL' }
        },
        queryRefund: async () => {
          createQueryCalls += 1
          return { status: 'failed' as const, channelRefundNo: 'wx-svc-abn-create', refundState: 'ABNORMAL' }
        },
      } as unknown as PaymentProvider
      const s1 = await seedServiceOrder('create')
      const r1 = await executeServiceOrderRefund(db, new PaymentProviderRegistry([createProvider]), audit, redis, s1.id, '没做成自动退')
      assert.equal(r1, 'refunding', '发起退款收到 ABNORMAL 必须留在 refunding，不能当失败')
      const row1 = await db.serviceOrder.findUniqueOrThrow({ where: { id: s1.id } })
      assert.equal(row1.status, 'refunding')
      assert.equal(row1.refundAttempts, 0, 'ABNORMAL 不得递增 refundAttempts')
      assert.equal(row1.refundChannelState, 'processing', 'ABNORMAL 不得置 refundChannelState=failed')
      assert.match(row1.refundAnomaly ?? '', /中间账户/, '必须写明资金在中间账户')
      assert.equal(row1.channelRefundNo, 'wx-svc-abn-create')
      assert.equal(await db.auditLog.count({ where: { targetId: s1.id, action: SERVICE_REFUND_ABNORMAL_AUDIT } }), 1)
      assert.ok((await collectServiceReturnAlerts(db)).some((a) => a.subjectId === s1.id), '服务单 ABNORMAL 必须进入告警中心')
      assert.equal(received.length, 1, '发起退款 ABNORMAL 必须触发运维告警推送')
      // 下次重试应走 queryRefund 而非重复调用 provider.refund。
      await db.serviceOrder.update({ where: { id: s1.id }, data: { nextRefundAt: new Date(Date.now() - 1_000) } })
      const r1Retry = await executeServiceOrderRefund(db, new PaymentProviderRegistry([createProvider]), audit, redis, s1.id, '没做成自动退')
      assert.equal(r1Retry, 'refunding')
      assert.equal(createRefundCalls, 1, '后续重试不得重复调用 provider.refund')
      assert.equal(createQueryCalls, 1, '后续重试应走 queryRefund')
      assert.equal((await db.serviceOrder.findUniqueOrThrow({ where: { id: s1.id } })).refundAttempts, 0)

      // 2. 查询收敛 ABNORMAL（applyRefundQuery，临近重试上限 refundAttempts=7）：不递增、不置 refund_failed。
      const queryProvider = {
        channel: 'wechat',
        queryRefund: async () => ({ status: 'failed' as const, channelRefundNo: 'wx-svc-abn-query', refundState: 'ABNORMAL' }),
      } as unknown as PaymentProvider
      const s2 = await seedServiceOrder('query', {
        status: 'refunding',
        refundAttempts: 7,
        refundChannelState: 'processing',
        withRefundNo: true,
      })
      const r2 = await executeServiceOrderRefund(db, new PaymentProviderRegistry([queryProvider]), audit, redis, s2.id, '查单收敛')
      assert.equal(r2, 'refunding')
      const row2 = await db.serviceOrder.findUniqueOrThrow({ where: { id: s2.id } })
      assert.equal(row2.status, 'refunding', '临近重试上限收到 ABNORMAL 绝不能置为 refund_failed')
      assert.notEqual(row2.status, 'refund_failed')
      assert.equal(row2.refundAttempts, 7, '查询收到 ABNORMAL 不得递增 refundAttempts')
      assert.equal(row2.refundChannelState, 'processing')
      assert.match(row2.refundAnomaly ?? '', /中间账户/)
      assert.equal(received.length, 2, '查询 ABNORMAL 必须触发运维告警推送')

      // 3. 微信回调通知 ABNORMAL（真实 WechatPayProvider 验签解密 + settleServiceRefundNotify + 指纹含 refundState）。
      const keyOpts = { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } } as const
      const mchKeys = generateKeyPairSync('rsa', keyOpts)
      const platformKeys = generateKeyPairSync('rsa', keyOpts)
      const apiV3Key = randomBytes(16).toString('hex')
      const serial = `PUB_SVC_ABN_${tag}`.slice(0, 40)
      const wxProvider = new WechatPayProvider({
        mchid: '1900000019',
        appid: 'wx0000000000000019',
        mchSerialNo: 'MCH_SVC_ABN_0001',
        privateKeyPem: mchKeys.privateKey,
        apiV3Key,
        platformPublicKeyPem: platformKeys.publicKey,
        platformPublicKeyId: serial,
        notifyBaseUrl: 'https://test.local',
        apiBaseUrl: 'http://127.0.0.1:1',
      })
      const refundSvc = new RefundService(db, audit, new PaymentProviderRegistry([wxProvider]), redis as never)
      const s3 = await seedServiceOrder('notify', {
        status: 'refunding',
        refundAttempts: 7,
        refundChannelState: 'processing',
        withRefundNo: true,
      })
      const sendWechatNotify = (refundStatus: 'CLOSED' | 'ABNORMAL' | 'SUCCESS', refundId: string) => {
        const rawBody = Buffer.from(JSON.stringify({
          id: randomUUID(),
          event_type: `REFUND.${refundStatus}`,
          resource_type: 'encrypt-resource',
          resource: encryptWechatCallbackResource(JSON.stringify({
            mchid: '1900000019',
            out_trade_no: s3.providerOrderNo,
            out_refund_no: s3.refundNo,
            refund_id: refundId,
            refund_status: refundStatus,
            amount: { refund: 100, total: 100 },
          }), apiV3Key),
        }), 'utf8')
        const timestamp = String(Math.floor(Date.now() / 1000))
        const nonce = randomBytes(16).toString('hex')
        const signature = createSign('RSA-SHA256').update(buildWechatCallbackVerifyBase({ timestamp, nonce, rawBody })).sign(platformKeys.privateKey, 'base64')
        return refundSvc.processWechatRefundNotify(rawBody, {
          [WECHAT_TIMESTAMP_HEADER]: timestamp,
          [WECHAT_NONCE_HEADER]: nonce,
          [WECHAT_SIGNATURE_HEADER]: signature,
          [WECHAT_SERIAL_HEADER]: serial,
        })
      }
      // 3a. 直接发 ABNORMAL 通知：不递增 refundAttempts（仍是 7）、不置 refund_failed、发告警。
      await sendWechatNotify('ABNORMAL', 'wx-svc-abn-ntf')
      const row3 = await db.serviceOrder.findUniqueOrThrow({ where: { id: s3.id } })
      assert.equal(row3.status, 'refunding', '通知收到 ABNORMAL 绝不能置 refund_failed')
      assert.equal(row3.refundAttempts, 7, '通知收到 ABNORMAL 不得递增 refundAttempts')
      assert.equal(row3.refundChannelState, 'processing')
      assert.match(row3.refundAnomaly ?? '', /中间账户/)
      assert.match(row3.refundNotifyKey ?? '', /\|ABNORMAL\|/, 'serviceRefundNotifyKey 必须包含 refundState')
      assert.equal(received.length, 3, '通知 ABNORMAL 必须触发运维告警推送')

      // 3b. 同单号先收 CLOSED 再收 ABNORMAL：验证 refundState 纳入去重指纹不误判幂等。
      const s4 = await seedServiceOrder('fp', {
        status: 'refunding',
        refundAttempts: 0,
        refundChannelState: 'processing',
        withRefundNo: true,
      })
      await settleServiceRefundNotify(db, audit, redis, {
        refundNo: s4.refundNo,
        status: 'failed',
        refundState: 'CLOSED',
        refundAmountCents: 100,
        channelRefundNo: 'wx-fp-same',
      })
      assert.equal((await db.serviceOrder.findUniqueOrThrow({ where: { id: s4.id } })).refundAttempts, 1, 'CLOSED 正常记一次失败')
      const fpAbn = await settleServiceRefundNotify(db, audit, redis, {
        refundNo: s4.refundNo,
        status: 'failed',
        refundState: 'ABNORMAL',
        refundAmountCents: 100,
        channelRefundNo: 'wx-fp-same',
      })
      assert.notEqual(fpAbn.idempotent, true, 'CLOSED 与 ABNORMAL 即使其余字段相同也不能被去重指纹吞掉')
      const row4 = await db.serviceOrder.findUniqueOrThrow({ where: { id: s4.id } })
      assert.equal(row4.refundAttempts, 1, '后续 ABNORMAL 不得再递增 refundAttempts')
      assert.equal(row4.refundChannelState, 'processing')
      assert.match(row4.refundAnomaly ?? '', /中间账户/)

      // 3c. 商户在微信商户平台处理完异常退款后，收到 REFUND.SUCCESS 正常收口 refunded 并清空 refundAnomaly。
      await sendWechatNotify('SUCCESS', 'wx-svc-abn-ntf')
      const row3Done = await db.serviceOrder.findUniqueOrThrow({ where: { id: s3.id } })
      assert.equal(row3Done.status, 'refunded')
      assert.equal(row3Done.refundChannelState, 'success')
      assert.equal(row3Done.refundAnomaly, null)
    })
  } finally {
    await db.auditLog.deleteMany({ where: { targetId: { in: createdIds } } })
    await db.serviceOrder.deleteMany({ where: { id: { in: createdIds } } })
    await db.terminal.delete({ where: { id: terminalId } }).catch(() => undefined)
  }
}
