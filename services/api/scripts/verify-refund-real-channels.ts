/**
 * W-B 真实渠道退款（wechat / alipay 原路退回）verification（verify:refund-real-channels）。
 *
 * 手段与 verify:payment-real-channels 相同：本地 RSA 密钥模拟渠道侧 + 本地假网关，
 * Provider 走与生产完全相同的签名/验签/退款协议代码路径；无真实商户凭证、无真实资金。
 *
 * 断言全表：
 * - wechat 同步成功：/v3/refund/domestic/refunds 报文（out_refund_no=refundNo /
 *   out_trade_no=原成功尝试 / amount.refund+total 整数分）→ refunded + channelRefundNo +
 *   refundedAmountCents + 审计 refund.created 恰 1 条；重复调用幂等不重复出款/审计。
 * - wechat 受理中（PROCESSING）：保持 Refund pending + 订单 refunding（**绝不假报已退款**），
 *   审计 refund.processing；重复调用经 queryRefund 收敛——仍受理中原样返回、
 *   SUCCESS 补完成（refund.created 带 convergedFromProcessing）、再重复幂等。
 * - 渠道结果三分法（双模型审查 H1 修复）：
 *   · 明确拒绝（ABNORMAL / 4xx 业务码）→ failed + 回滚 paid + refund.channel_error 审计，
 *     且可**同号重试**（H2 修复：refund.retried 审计 + 重新走渠道，渠道幂等兜底）；
 *   · 结果不可知（HTTP 5xx/超时）→ 保持 pending+refunding + refund.channel_ambiguous 审计，
 *     **绝不判失败**；查证 unknown（渠道查无此单）时**同号重发**收敛到 refunded。
 * - 前置守卫 fail-closed（refund.blocked 审计）：缺 success 尝试 REFUND_SOURCE_ATTEMPT_MISSING /
 *   多条 success 尝试 REFUND_SOURCE_AMBIGUOUS / 金额口径异常 REFUND_AMOUNT_BASIS_UNSUPPORTED。
 * - alipay 同步成功：alipay.trade.refund 报文（out_request_no=refundNo / refund_amount 元串）
 *   → refunded；渠道错误 → 回滚 paid。
 * - 回归：offline 退款不调 provider（假网关零请求）；退款绝不改 PrintTask.status。
 */
process.env['TERMINAL_ADMIN_SECRET'] ||= 'verify-refundreal-terminal-admin-secret-0123456789'
process.env['TERMINAL_ACTION_TOKEN_SECRET'] ||= 'verify-refundreal-terminal-action-secret-0123456789'
process.env['FILE_SIGNING_SECRET'] ||= 'verify-refundreal-file-signing-secret-0123456789abcd'
process.env['PAYMENT_SESSION_SECRET'] ||= 'verify-refundreal-payment-session-secret-0123456789'
process.env['PRINT_REQUIRE_PAID_BEFORE_CLAIM'] = 'true'
if (process.env['NODE_ENV'] === 'production') {
  console.error('  FAIL verify:refund-real-channels 不得在 NODE_ENV=production 运行')
  process.exit(1)
}

import 'dotenv/config'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import { createSign, generateKeyPairSync, randomBytes, randomUUID } from 'crypto'
import { AuditService } from '../src/audit/audit.service'
import { OnlinePaymentService } from '../src/payment/online-payment.service'
import { OrderStatusService } from '../src/payment/order-status.service'
import { PaymentProviderRegistry } from '../src/payment/payment-provider.factory'
import { buildPaymentCallbackPath } from '../src/payment/payment-provider.types'
import { PricingService } from '../src/payment/pricing.service'
import { RefundService } from '../src/payment/refund.service'
import { seedDevDefaultPriceConfig } from '../src/payment/price-config.seed'
import { AlipayProvider, alipayTimestamp, buildAlipaySignBase } from '../src/payment/providers/alipay.provider'
import {
  buildWechatCallbackVerifyBase,
  encryptWechatCallbackResource,
  WECHAT_NONCE_HEADER,
  WECHAT_SERIAL_HEADER,
  WECHAT_SIGNATURE_HEADER,
  WECHAT_TIMESTAMP_HEADER,
  WechatPayProvider,
} from '../src/payment/providers/wechat-pay.provider'
import { PrintJobsService } from '../src/print-jobs/print-jobs.service'
import { PrintPageCountService } from '../src/print-jobs/print-page-count.service'
import { PrismaService } from '../src/prisma/prisma.service'
import { TerminalCapabilitiesService } from '../src/terminals/terminal-capabilities.service'
import { signFileUrl } from '../src/files/signing'
import { LOCAL_BUCKET_SENTINEL } from '../src/storage/storage.interface'
import { StorageService } from '../src/storage/storage.service'

let passCount = 0
function pass(message: string): void {
  passCount += 1
  console.log(`  PASS ${message}`)
}
function fail(message: string): never {
  console.error(`  FAIL ${message}`)
  process.exit(1)
}
async function expectCode(label: string, code: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn()
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e)
    if (msg.includes(code)) return pass(label)
    fail(`${label} — expected error ${code}, got: ${msg}`)
  }
  fail(`${label} — expected error ${code}, but resolved`)
}

// ── 渠道侧密钥（仅本脚本内存）────────────────────────────────────────────────
function rsaPair(): { privateKey: string; publicKey: string } {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  })
  return { privateKey, publicKey }
}
const mchKeys = rsaPair()
const wxPlatformKeys = rsaPair()
const aliAppKeys = rsaPair()
const aliPlatformKeys = rsaPair()
const APIV3_KEY = randomBytes(16).toString('hex')
const WX_MCHID = '1900000001'
const WX_APPID = 'wx0000000000000001'
const WX_SERIAL = 'PUB_KEY_ID_VERIFY_0001'
const ALI_APP_ID = '2021000000000001'
const NOTIFY_BASE = 'https://kiosk-pay.verify.test'

// ── 假网关（渠道侧账本，可按场景切换响应）────────────────────────────────────
let wechatRefundCreateResponse: { httpStatus?: number; body?: Record<string, unknown> } = {}
let wechatRefundQueryResponse: { httpStatus?: number; body?: Record<string, unknown> } = { body: { status: 'PROCESSING' } }
let alipayRefundNode: Record<string, unknown> = { code: '10000', msg: 'Success' }
let lastWechatRefundCreate: Record<string, unknown> | null = null
let lastAlipayRefundBiz: Record<string, unknown> | null = null
let gatewayRequestCount = 0

function signAlipayResponse(nodeKey: string, node: Record<string, unknown>): string {
  const nodeRaw = JSON.stringify(node)
  const sign = createSign('RSA-SHA256').update(nodeRaw, 'utf8').sign(aliPlatformKeys.privateKey, 'base64')
  return `{"${nodeKey}":${nodeRaw},"sign":"${sign}"}`
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

function startFakeGateway(): Promise<{ server: Server; port: number }> {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      gatewayRequestCount += 1
      const url = req.url ?? ''
      const body = await readBody(req)
      if (req.method === 'POST' && url === '/v3/pay/transactions/native') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ code_url: `weixin://wxpay/bizpayurl?pr=vrf_${randomBytes(4).toString('hex')}` }))
        return
      }
      if (req.method === 'POST' && url === '/v3/refund/domestic/refunds') {
        lastWechatRefundCreate = JSON.parse(body) as Record<string, unknown>
        if (wechatRefundCreateResponse.httpStatus && wechatRefundCreateResponse.httpStatus >= 400) {
          res.writeHead(wechatRefundCreateResponse.httpStatus, { 'content-type': 'application/json' })
          // 5xx 用 SYSTEM_ERROR（渠道自述结果未知）；4xx 用 PARAM_ERROR（明确业务拒绝）
          const code = wechatRefundCreateResponse.httpStatus >= 500 ? 'SYSTEM_ERROR' : 'PARAM_ERROR'
          res.end(JSON.stringify({ code, message: 'verify simulated failure' }))
          return
        }
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(wechatRefundCreateResponse.body ?? {}))
        return
      }
      if (req.method === 'GET' && url.startsWith('/v3/refund/domestic/refunds/')) {
        if (wechatRefundQueryResponse.httpStatus && wechatRefundQueryResponse.httpStatus >= 400) {
          res.writeHead(wechatRefundQueryResponse.httpStatus, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ code: 'RESOURCE_NOT_EXISTS', message: 'not found' }))
          return
        }
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(wechatRefundQueryResponse.body ?? {}))
        return
      }
      if (req.method === 'POST' && url.startsWith('/alipay/gateway.do')) {
        const params = Object.fromEntries(new URLSearchParams(body))
        const method = params['method'] ?? ''
        const responseKey = `${method.replace(/\./g, '_')}_response`
        if (method === 'alipay.trade.precreate') {
          const biz = JSON.parse(params['biz_content'] ?? '{}') as Record<string, unknown>
          const node = { code: '10000', msg: 'Success', out_trade_no: biz['out_trade_no'], qr_code: 'https://qr.alipay.com/vrf' }
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(signAlipayResponse(responseKey, node))
          return
        }
        if (method === 'alipay.trade.refund') {
          lastAlipayRefundBiz = JSON.parse(params['biz_content'] ?? '{}') as Record<string, unknown>
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(signAlipayResponse(responseKey, alipayRefundNode))
          return
        }
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(signAlipayResponse(responseKey, { code: '40004', msg: 'error', sub_code: 'ACQ.TRADE_NOT_EXIST' }))
        return
      }
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end('{}')
    })().catch(() => {
      res.writeHead(500)
      res.end()
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      resolve({ server, port: typeof addr === 'object' && addr ? addr.port : 0 })
    })
  })
}

// ── 支付回调构造（把订单打成 paid 的前置动作；与 verify:payment-real-channels 同构）──
function buildWechatCallback(txn: Record<string, unknown>): { rawBody: Buffer; headers: Record<string, string> } {
  const resource = encryptWechatCallbackResource(JSON.stringify(txn), APIV3_KEY)
  const rawBody = Buffer.from(
    JSON.stringify({ id: randomUUID(), event_type: 'TRANSACTION.SUCCESS', resource_type: 'encrypt-resource', resource }),
    'utf8',
  )
  const timestamp = String(Math.floor(Date.now() / 1000))
  const nonce = randomBytes(16).toString('hex')
  const signature = createSign('RSA-SHA256')
    .update(buildWechatCallbackVerifyBase({ timestamp, nonce, rawBody }))
    .sign(wxPlatformKeys.privateKey, 'base64')
  return {
    rawBody,
    headers: {
      [WECHAT_TIMESTAMP_HEADER]: timestamp,
      [WECHAT_NONCE_HEADER]: nonce,
      [WECHAT_SIGNATURE_HEADER]: signature,
      [WECHAT_SERIAL_HEADER]: WX_SERIAL,
    },
  }
}

function buildAlipayNotify(params: Record<string, string>): { rawBody: Buffer; headers: Record<string, string> } {
  const full: Record<string, string> = {
    notify_id: `ntf_${randomBytes(12).toString('hex')}`,
    notify_time: alipayTimestamp(),
    notify_type: 'trade_status_sync',
    app_id: ALI_APP_ID,
    charset: 'utf-8',
    version: '1.0',
    sign_type: 'RSA2',
    ...params,
  }
  full['sign'] = createSign('RSA-SHA256')
    .update(buildAlipaySignBase(full, ['sign', 'sign_type']), 'utf8')
    .sign(aliPlatformKeys.privateKey, 'base64')
  return {
    rawBody: Buffer.from(new URLSearchParams(full).toString(), 'utf8'),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  }
}

const PRINT_PARAMS = {
  copies: 2,
  colorMode: 'color' as const,
  duplex: 'simplex' as const,
  paperSize: 'A4' as const,
  orientation: 'auto' as const,
  quality: 'standard' as const,
  scale: 'fit' as const,
  pagesPerSheet: 1 as const,
}

async function main(): Promise<void> {
  console.log('\n=== W-B real channel refunds (wechat/alipay) verification ===')

  const { server, port } = await startFakeGateway()
  const wechatProvider = new WechatPayProvider({
    mchid: WX_MCHID,
    appid: WX_APPID,
    mchSerialNo: 'MCH_SERIAL_VERIFY_0001',
    privateKeyPem: mchKeys.privateKey,
    apiV3Key: APIV3_KEY,
    platformPublicKeyPem: wxPlatformKeys.publicKey,
    platformPublicKeyId: WX_SERIAL,
    notifyBaseUrl: NOTIFY_BASE,
    apiBaseUrl: `http://127.0.0.1:${port}`,
  })
  const alipayProvider = new AlipayProvider({
    appId: ALI_APP_ID,
    appPrivateKeyPem: aliAppKeys.privateKey,
    alipayPublicKeyPem: aliPlatformKeys.publicKey,
    notifyBaseUrl: NOTIFY_BASE,
    gatewayUrl: `http://127.0.0.1:${port}/alipay/gateway.do`,
  })

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const audit = new AuditService(prisma)
  const storage = new StorageService()
  const pageCount = new PrintPageCountService(prisma, storage)
  const pricing = new PricingService(prisma)
  const orderStatus = new OrderStatusService(prisma, audit)
  const printJobs = new PrintJobsService(prisma, audit, pageCount, pricing, orderStatus, new TerminalCapabilitiesService(prisma))
  const registry = new PaymentProviderRegistry([wechatProvider, alipayProvider])
  const payment = new OnlinePaymentService(prisma, audit, orderStatus, registry)
  const refundService = new RefundService(prisma, audit, registry)

  const suffix = randomUUID().replace(/-/g, '').slice(0, 12)
  const terminalId = `t_refundreal_${suffix}`
  const taskIds: string[] = []
  const fixtureFileIds: string[] = []
  const fixtureStorageKeys: string[] = []

  async function seedPdfFixture(label: string, pages: number): Promise<string> {
    const fileId = `f_refundreal_${suffix}_${label}`
    const storageKey = `verify/refund-real-channels/${fileId}.pdf`
    const pdfBytes = Buffer.from(`%PDF-1.4\n${'1 0 obj\n<< /Type /Page >>\nendobj\n'.repeat(pages)}%%EOF\n`)
    await storage.putObject(storageKey, pdfBytes, 'application/pdf', LOCAL_BUCKET_SENTINEL)
    await prisma.fileObject.create({
      data: {
        id: fileId,
        storageKey,
        filename: `${label}.pdf`,
        mimeType: 'application/pdf',
        sizeBytes: pdfBytes.length,
        sha256: '',
        purpose: 'print_source',
        bucket: LOCAL_BUCKET_SENTINEL,
      },
    })
    fixtureFileIds.push(fileId)
    fixtureStorageKeys.push(storageKey)
    return signFileUrl(fileId, 60_000).url
  }

  /** 建打印单并经真实回调路径打成 paid（channel=wechat|alipay），返回 order/attempt。 */
  async function makePaidOrder(label: string, channel: 'wechat' | 'alipay'): Promise<{ orderId: string; orderNo: string; taskId: string; attemptId: string }> {
    const printed = await printJobs.create(
      { fileUrl: await seedPdfFixture(label, 2), fileMd5: `sha256-refundreal-${label}`, fileName: `${label}.pdf`, params: PRINT_PARAMS },
      { endUserId: null, terminalId },
    )
    taskIds.push(printed.taskId)
    const order = await prisma.order.findUnique({ where: { printTaskId: printed.taskId } })
    if (!order || !printed.paymentSessionToken) fail(`makePaidOrder(${label}) setup failed`)
    const attempt = await payment.createPayAttempt(order.id, printed.paymentSessionToken, channel)
    if (channel === 'wechat') {
      const cb = buildWechatCallback({
        mchid: WX_MCHID,
        appid: WX_APPID,
        out_trade_no: attempt.attemptId,
        transaction_id: `wxtxn_${randomBytes(8).toString('hex')}`,
        trade_state: 'SUCCESS',
        amount: { total: order.amountCents, currency: 'CNY' },
        attach: JSON.stringify({ orderId: order.id }),
      })
      await payment.processCallback('wechat', cb.rawBody, cb.headers)
    } else {
      const cb = buildAlipayNotify({
        out_trade_no: attempt.attemptId,
        trade_no: `alitxn_${randomBytes(8).toString('hex')}`,
        trade_status: 'TRADE_SUCCESS',
        total_amount: (order.amountCents / 100).toFixed(2),
        passback_params: encodeURIComponent(JSON.stringify({ orderId: order.id })),
      })
      await payment.processCallback('alipay', cb.rawBody, cb.headers)
    }
    const paid = await prisma.order.findUnique({ where: { id: order.id } })
    if (paid?.payStatus !== 'paid') fail(`makePaidOrder(${label}): not paid`)
    return { orderId: order.id, orderNo: order.orderNo, taskId: printed.taskId, attemptId: attempt.attemptId }
  }

  async function orderState(orderId: string) {
    const o = await prisma.order.findUnique({ where: { id: orderId } })
    if (!o) fail('order missing')
    return o
  }
  async function refundRow(refundNo: string) {
    return prisma.refund.findUnique({ where: { refundNo } })
  }
  async function auditCount(action: string, targetId: string): Promise<number> {
    return prisma.auditLog.count({ where: { action, targetId } })
  }

  const cleanup = async (): Promise<void> => {
    await prisma.refund.deleteMany({ where: { order: { is: { terminalId } } } })
    await prisma.paymentAttempt.deleteMany({ where: { order: { is: { terminalId } } } })
    await prisma.order.deleteMany({ where: { terminalId } })
    await prisma.printTask.deleteMany({ where: { id: { in: taskIds } } })
    await prisma.terminal.deleteMany({ where: { id: terminalId } })
    await prisma.fileObject.deleteMany({ where: { id: { in: fixtureFileIds } } })
    for (const key of fixtureStorageKeys) {
      await storage.deleteObject(key, LOCAL_BUCKET_SENTINEL).catch(() => undefined)
    }
    server.close()
  }

  try {
    await prisma.terminal.create({
      data: { id: terminalId, terminalCode: `KSK-REFUNDREAL-${suffix}`, agentToken: `agt_${suffix}`, deviceFingerprint: 'verify-refundreal' },
    })
    await seedDevDefaultPriceConfig(prisma)
    pass('test fixtures created')

    // ── (W1) wechat 同步退款成功 ─────────────────────────────────────────
    const W1 = await makePaidOrder('w1', 'wechat')
    const w1RefundId = `wxrfd_${randomBytes(6).toString('hex')}`
    wechatRefundCreateResponse = { body: { status: 'SUCCESS', refund_id: w1RefundId } }
    const w1View = await refundService.refund(W1.orderId, { reason: '用户申请退款', operatorId: 'verify-admin' })
    const w1Order = await orderState(W1.orderId)
    if (
      w1View.refund.status === 'success' &&
      w1View.refund.channelRefundNo === w1RefundId &&
      w1Order.payStatus === 'refunded' &&
      w1Order.refundedAmountCents === w1Order.amountCents &&
      (await auditCount('refund.created', W1.orderId)) === 1
    ) {
      pass('wechat 同步退款：refunded + channelRefundNo + refundedAmountCents + 审计恰 1 条')
    } else {
      fail(`wechat sync refund mismatch: ${JSON.stringify({ w1View, payStatus: w1Order.payStatus })}`)
    }
    const w1Amount = (lastWechatRefundCreate?.['amount'] ?? {}) as Record<string, unknown>
    if (
      lastWechatRefundCreate?.['out_refund_no'] === `RFD-${W1.orderNo}` &&
      lastWechatRefundCreate?.['out_trade_no'] === W1.attemptId &&
      w1Amount['refund'] === w1Order.amountCents &&
      w1Amount['total'] === w1Order.amountCents
    ) {
      pass('wechat 退款报文：out_refund_no=refundNo + out_trade_no=原成功尝试 + 金额整数分')
    } else {
      fail(`wechat refund payload mismatch: ${JSON.stringify(lastWechatRefundCreate)}`)
    }
    const w1CountBefore = gatewayRequestCount
    const w1Repeat = await refundService.refund(W1.orderId, { reason: '重复请求', operatorId: 'verify-admin' })
    if (
      w1Repeat.idempotent &&
      gatewayRequestCount === w1CountBefore &&
      (await auditCount('refund.created', W1.orderId)) === 1
    ) {
      pass('wechat 退款重复请求幂等：不再打渠道、不重复出款/审计')
    } else {
      fail('wechat refund repeat not idempotent')
    }
    if ((await prisma.printTask.findUnique({ where: { id: W1.taskId } }))?.status === 'pending') {
      pass('退款全程不改 PrintTask.status（支付域与打印域解耦）')
    } else {
      fail('refund touched PrintTask.status')
    }

    // ── (W2) wechat 受理中 → queryRefund 收敛 ────────────────────────────
    const W2 = await makePaidOrder('w2', 'wechat')
    const w2RefundId = `wxrfd_${randomBytes(6).toString('hex')}`
    wechatRefundCreateResponse = { body: { status: 'PROCESSING', refund_id: w2RefundId } }
    const w2View = await refundService.refund(W2.orderId, { reason: '用户申请退款', operatorId: 'verify-admin' })
    const w2Order = await orderState(W2.orderId)
    if (
      w2View.refund.status === 'pending' &&
      w2Order.payStatus === 'refunding' &&
      (await auditCount('refund.processing', W2.orderId)) === 1 &&
      (await auditCount('refund.created', W2.orderId)) === 0
    ) {
      pass('wechat PROCESSING：Refund pending + 订单 refunding（不假报已退款）+ 审计 refund.processing')
    } else {
      fail(`wechat processing mishandled: ${JSON.stringify({ status: w2View.refund.status, payStatus: w2Order.payStatus })}`)
    }
    wechatRefundQueryResponse = { body: { status: 'PROCESSING', refund_id: w2RefundId } }
    const w2Still = await refundService.refund(W2.orderId, { reason: '重复请求' })
    if (w2Still.idempotent && w2Still.refund.status === 'pending' && (await orderState(W2.orderId)).payStatus === 'refunding') {
      pass('收敛查证仍受理中：原样返回，不动状态、不重复出款')
    } else {
      fail('processing convergence changed state prematurely')
    }
    wechatRefundQueryResponse = { body: { status: 'SUCCESS', refund_id: w2RefundId } }
    const w2Done = await refundService.refund(W2.orderId, { reason: '重复请求' })
    const w2DoneOrder = await orderState(W2.orderId)
    if (
      w2Done.refund.status === 'success' &&
      w2DoneOrder.payStatus === 'refunded' &&
      (await auditCount('refund.created', W2.orderId)) === 1
    ) {
      pass('收敛查证 SUCCESS：补完成 refunded + refund.created 恰 1 条（convergedFromProcessing）')
    } else {
      fail(`processing convergence completion failed: ${JSON.stringify(w2Done)}`)
    }
    const w2Again = await refundService.refund(W2.orderId, { reason: '再次重复' })
    if (w2Again.idempotent && (await auditCount('refund.created', W2.orderId)) === 1) {
      pass('收敛完成后再重复请求幂等')
    } else {
      fail('post-convergence repeat not idempotent')
    }

    // ── (W3) wechat 渠道明确拒绝（ABNORMAL）→ 回滚 → 同号重试成功（H2 修复）──
    const W3 = await makePaidOrder('w3', 'wechat')
    wechatRefundCreateResponse = { body: { status: 'ABNORMAL', refund_id: 'wxrfd_abn' } }
    await expectCode('wechat 渠道拒绝 → REFUND_CHANNEL_FAILED', 'REFUND_CHANNEL_FAILED', () =>
      refundService.refund(W3.orderId, { reason: '用户申请退款' }),
    )
    const w3Order = await orderState(W3.orderId)
    const w3Refund = await refundRow(`RFD-${W3.orderNo}`)
    if (w3Order.payStatus === 'paid' && w3Refund?.status === 'failed') {
      pass('渠道拒绝后：Refund failed + 订单回 paid')
    } else {
      fail(`wechat reject rollback failed: ${JSON.stringify({ pay: w3Order.payStatus, refund: w3Refund?.status })}`)
    }
    // H2：failed 后同号重试必须真正重新走渠道并可完成（不被幂等门短路卡死）
    const w3RetryRefundId = `wxrfd_retry_${randomBytes(6).toString('hex')}`
    wechatRefundCreateResponse = { body: { status: 'SUCCESS', refund_id: w3RetryRefundId } }
    const w3GatewayBefore = gatewayRequestCount
    const w3Retry = await refundService.refund(W3.orderId, { reason: '重试退款', operatorId: 'verify-admin' })
    if (
      w3Retry.refund.status === 'success' &&
      w3Retry.refund.channelRefundNo === w3RetryRefundId &&
      gatewayRequestCount > w3GatewayBefore &&
      lastWechatRefundCreate?.['out_refund_no'] === `RFD-${W3.orderNo}` &&
      (await orderState(W3.orderId)).payStatus === 'refunded' &&
      (await auditCount('refund.retried', W3.orderId)) === 1 &&
      (await auditCount('refund.created', W3.orderId)) === 1
    ) {
      pass('failed 同号重试：重新走渠道（同 out_refund_no）→ refunded + refund.retried/created 各 1 条')
    } else {
      fail(`failed retry mismatch: ${JSON.stringify(w3Retry)}`)
    }

    // ── (W4) wechat 渠道 HTTP 5xx（结果不可知）→ 保持 pending，unknown 同号重发收敛（H1/M4 修复）──
    const W4 = await makePaidOrder('w4', 'wechat')
    wechatRefundCreateResponse = { httpStatus: 500 }
    const w4View = await refundService.refund(W4.orderId, { reason: '用户申请退款' })
    if (
      w4View.refund.status === 'pending' &&
      (await orderState(W4.orderId)).payStatus === 'refunding' &&
      (await auditCount('refund.channel_ambiguous', W4.orderId)) === 1
    ) {
      pass('渠道 5xx（结果不可知）：保持 pending+refunding（绝不判失败）+ refund.channel_ambiguous 审计')
    } else {
      fail(`ambiguous 5xx mishandled: ${JSON.stringify({ status: w4View.refund.status })}`)
    }
    // 查证 404（渠道查无此单=原请求未到达）→ 同号重发 → 本次成功 → refunded
    const w4RefundId = `wxrfd_reissue_${randomBytes(6).toString('hex')}`
    wechatRefundQueryResponse = { httpStatus: 404 }
    wechatRefundCreateResponse = { body: { status: 'SUCCESS', refund_id: w4RefundId } }
    const w4Done = await refundService.refund(W4.orderId, { reason: '重复请求' })
    if (
      w4Done.refund.status === 'success' &&
      w4Done.refund.channelRefundNo === w4RefundId &&
      lastWechatRefundCreate?.['out_refund_no'] === `RFD-${W4.orderNo}` &&
      (await orderState(W4.orderId)).payStatus === 'refunded' &&
      (await auditCount('refund.created', W4.orderId)) === 1
    ) {
      pass('查证 unknown → 同号重发（渠道幂等）→ refunded + refund.created 恰 1 条')
    } else {
      fail(`unknown reissue failed: ${JSON.stringify(w4Done)}`)
    }
    wechatRefundQueryResponse = { body: { status: 'PROCESSING' } }

    // ── (W4a) wechat 渠道 429 限流（瞬态 4xx，结果不可知）→ 保持 pending 收敛（第二轮审查 High）──
    const W4a = await makePaidOrder('w4a', 'wechat')
    wechatRefundCreateResponse = { httpStatus: 429 }
    const w4aView = await refundService.refund(W4a.orderId, { reason: '用户申请退款' })
    if (
      w4aView.refund.status === 'pending' &&
      (await orderState(W4a.orderId)).payStatus === 'refunding' &&
      (await auditCount('refund.channel_ambiguous', W4a.orderId)) === 1
    ) {
      pass('渠道 429 限流（瞬态 4xx）：保持 pending+refunding（绝不判失败）')
    } else {
      fail(`transient 429 mishandled: ${JSON.stringify({ status: w4aView.refund.status })}`)
    }
    const w4aRefundId = `wxrfd_429_${randomBytes(6).toString('hex')}`
    wechatRefundQueryResponse = { body: { status: 'SUCCESS', refund_id: w4aRefundId } }
    wechatRefundCreateResponse = {}
    const w4aDone = await refundService.refund(W4a.orderId, { reason: '重复请求' })
    if (w4aDone.refund.status === 'success' && (await orderState(W4a.orderId)).payStatus === 'refunded') {
      pass('429 后查证收敛到 refunded')
    } else {
      fail('429 convergence failed')
    }
    wechatRefundQueryResponse = { body: { status: 'PROCESSING' } }

    // ── (W4b) wechat 渠道 4xx 明确业务拒绝 → failed 回滚 + channel_error 审计 ──
    const W4b = await makePaidOrder('w4b', 'wechat')
    wechatRefundCreateResponse = { httpStatus: 400 }
    await expectCode('wechat 渠道 4xx 明确拒绝 → REFUND_CHANNEL_FAILED', 'REFUND_CHANNEL_FAILED', () =>
      refundService.refund(W4b.orderId, { reason: '用户申请退款' }),
    )
    if (
      (await orderState(W4b.orderId)).payStatus === 'paid' &&
      (await auditCount('refund.channel_error', W4b.orderId)) === 1
    ) {
      pass('渠道 4xx：回滚 paid + refund.channel_error 审计（原始错误只进审计）')
    } else {
      fail('wechat 4xx not audited or rollback failed')
    }
    wechatRefundCreateResponse = {}

    // ── (W5) 真实渠道缺 success 支付尝试 → fail-closed ────────────────────
    const w5Order = await prisma.order.create({
      data: {
        orderNo: `ORD-REFUNDREAL-${suffix}-W5`,
        type: 'print',
        amountCents: 100,
        payStatus: 'paid',
        paymentSource: 'wechat',
        payChannel: 'wechat',
        paidAt: new Date(),
        paidBy: 'verify-fabricated',
        taskStatus: 'pending',
        terminalId,
      },
    })
    await expectCode('缺 success 支付尝试的 wechat 单 → REFUND_SOURCE_ATTEMPT_MISSING', 'REFUND_SOURCE_ATTEMPT_MISSING', () =>
      refundService.refund(w5Order.id, { reason: '数据异常单' }),
    )
    if (
      (await orderState(w5Order.id)).payStatus === 'paid' &&
      (await auditCount('refund.blocked', w5Order.id)) === 1
    ) {
      pass('缺原单 fail-closed：订单回 paid + refund.blocked 审计（人工介入处理）')
    } else {
      fail('W5 rollback/audit failed')
    }

    // ── (W6) 多条 success 尝试（疑似双重扣款）→ 盲退拦截（审查 M5）──────────
    const W6 = await makePaidOrder('w6', 'wechat')
    await prisma.paymentAttempt.create({
      data: {
        orderId: W6.orderId,
        channel: 'wechat',
        amountCents: 200,
        status: 'success',
        prepayId: `pa_dup_${suffix}`,
        channelTxnNo: `wxtxn_dup_${randomBytes(6).toString('hex')}`,
      },
    })
    await expectCode('同单多条 success 尝试 → REFUND_SOURCE_AMBIGUOUS（拒绝盲退）', 'REFUND_SOURCE_AMBIGUOUS', () =>
      refundService.refund(W6.orderId, { reason: '疑似双重扣款单' }),
    )
    if ((await orderState(W6.orderId)).payStatus === 'paid' && (await auditCount('refund.blocked', W6.orderId)) === 1) {
      pass('多原单拦截后订单回 paid + refund.blocked 审计')
    } else {
      fail('W6 rollback/audit failed')
    }

    // ── (W7) 金额口径异常（discount≠0 的线上单）→ 拦截（审查 M2）────────────
    const W7 = await makePaidOrder('w7', 'wechat')
    await prisma.order.update({ where: { id: W7.orderId }, data: { discountCents: 50 } })
    await expectCode('线上单 discount≠0 → REFUND_AMOUNT_BASIS_UNSUPPORTED（退款额必须=渠道实收）', 'REFUND_AMOUNT_BASIS_UNSUPPORTED', () =>
      refundService.refund(W7.orderId, { reason: '金额口径异常单' }),
    )
    if ((await orderState(W7.orderId)).payStatus === 'paid') pass('金额口径拦截后订单回 paid')
    else fail('W7 rollback failed')

    // ── (A1) alipay 同步退款成功 ─────────────────────────────────────────
    const A1 = await makePaidOrder('a1', 'alipay')
    const a1TradeNo = `alitxn_rfd_${randomBytes(6).toString('hex')}`
    alipayRefundNode = { code: '10000', msg: 'Success', fund_change: 'Y', trade_no: a1TradeNo, out_trade_no: A1.attemptId }
    const a1View = await refundService.refund(A1.orderId, { reason: '用户申请退款', operatorId: 'verify-admin' })
    const a1Order = await orderState(A1.orderId)
    if (
      a1View.refund.status === 'success' &&
      a1View.refund.channelRefundNo === a1TradeNo &&
      a1Order.payStatus === 'refunded' &&
      (await auditCount('refund.created', A1.orderId)) === 1
    ) {
      pass('alipay 同步退款：refunded + channelRefundNo=trade_no + 审计恰 1 条')
    } else {
      fail(`alipay refund mismatch: ${JSON.stringify(a1View)}`)
    }
    if (
      lastAlipayRefundBiz?.['out_request_no'] === `RFD-${A1.orderNo}` &&
      lastAlipayRefundBiz?.['out_trade_no'] === A1.attemptId &&
      lastAlipayRefundBiz?.['refund_amount'] === (a1Order.amountCents / 100).toFixed(2)
    ) {
      pass('alipay 退款报文：out_request_no=refundNo + out_trade_no=原成功尝试 + refund_amount 元串')
    } else {
      fail(`alipay refund payload mismatch: ${JSON.stringify(lastAlipayRefundBiz)}`)
    }
    const a1Repeat = await refundService.refund(A1.orderId, { reason: '重复请求' })
    if (a1Repeat.idempotent && (await auditCount('refund.created', A1.orderId)) === 1) {
      pass('alipay 退款重复请求幂等')
    } else {
      fail('alipay refund repeat not idempotent')
    }

    // ── (A2) alipay 渠道错误 → 回滚可重试 ────────────────────────────────
    const A2 = await makePaidOrder('a2', 'alipay')
    alipayRefundNode = { code: '40004', msg: 'Business Failed', sub_code: 'ACQ.SELLER_BALANCE_NOT_ENOUGH' }
    await expectCode('alipay 渠道错误 → REFUND_CHANNEL_FAILED', 'REFUND_CHANNEL_FAILED', () =>
      refundService.refund(A2.orderId, { reason: '用户申请退款' }),
    )
    if (
      (await orderState(A2.orderId)).payStatus === 'paid' &&
      (await refundRow(`RFD-${A2.orderNo}`))?.status === 'failed' &&
      (await auditCount('refund.channel_error', A2.orderId)) === 1
    ) {
      pass('alipay 渠道错误：Refund failed + 订单回 paid + channel_error 审计')
    } else {
      fail('alipay channel error rollback failed')
    }

    // ── (R1) 回归：offline 退款不调 provider ─────────────────────────────
    const printedR = await printJobs.create(
      { fileUrl: await seedPdfFixture('r1', 2), fileMd5: `sha256-refundreal-r1`, fileName: 'r1.pdf', params: PRINT_PARAMS },
      { endUserId: null, terminalId },
    )
    taskIds.push(printedR.taskId)
    const orderR = await prisma.order.findUnique({ where: { printTaskId: printedR.taskId } })
    if (!orderR) fail('R1 order missing')
    await orderStatus.markPaid(orderR.id, { paymentSource: 'offline', operatorId: 'verify-admin' })
    const gatewayBefore = gatewayRequestCount
    const rView = await refundService.refund(orderR.id, { reason: '线下退款', operatorId: 'verify-admin' })
    if (rView.refund.status === 'success' && gatewayRequestCount === gatewayBefore && (await orderState(orderR.id)).payStatus === 'refunded') {
      pass('offline 退款不调 provider（假网关零新增请求），状态机不回退')
    } else {
      fail('offline refund regression')
    }

    console.log(`\n  ✅ verify:refund-real-channels 全部通过（${passCount} checks）\n`)
  } finally {
    await cleanup()
    await prisma.onModuleDestroy()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
