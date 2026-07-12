/**
 * C5-6 后续回归门禁（verify:wechat-refund-regression）——微信退款端到端串联回归。
 *
 * 定位（反堆砌口径）：单点断言归属既有五脚本（refund-idempotent / refund-real-channels /
 * wechat-refund-notify / refund-convergence / reconciliation），本脚本**不重复单点**，
 * 只锁定跨脚本的端到端组合链路——即 C5-6 验收语言的四场景在真实运营时序下的串联：
 *
 * R1 STUCK_REFUNDING 全生命周期（cron 收敛入口）：
 *    渠道 5xx（结果不可知）→ pending+refunding → 新鲜 refunding 不误报 STUCK →
 *    超龄后对账检出 STUCK_REFUNDING → convergeStalePendingRefunds()（定时任务同一入口）
 *    查证 SUCCESS 补完成 → refunded → 对账复核 STUCK 清零、无差异残留。
 * R2 渠道明确失败 → 对账不残留 → 同号重试成功：
 *    4xx 明确拒绝 → failed+回滚 paid → 对账不把回滚单误报 STUCK/差异 →
 *    同号重试 SUCCESS → refunded → 对账无差异。
 * R3 重复/乱序退款通知 × 收敛互不重复出款：
 *    PROCESSING 造 pending → 退款通知 SUCCESS 完成（viaRefundNotify）→
 *    同 payload 重复通知幂等 → 迟到 CLOSED 通知不回退（STATE_CONFLICT）→
 *    再跑 convergeStalePendingRefunds() 零渠道请求、不二次出款。
 * R4 退款缺失三型排查链（SOP 排查树的机器口径）：
 *    4a 通知未知 out_refund_no → 拒绝且不误改任何本地单；
 *    4b 账实不符（refunded 无 Refund 行）→ 对账检出 ORDER_REFUNDED_WITHOUT_REFUND_ROW；
 *    4c 渠道查无此单（原请求未到达）→ 手动重复 refund() 同号重发 → refunded。
 *
 * 手段与 verify:refund-real-channels 相同：本地 RSA 密钥 + 假网关，Provider 走生产同源
 * 签名/验签/解密代码路径；无真实商户凭证、无真实资金。
 * 运行：pnpm --filter @ai-job-print/api verify:wechat-refund-regression
 */
process.env['TERMINAL_ADMIN_SECRET'] ||= 'verify-wxrr-terminal-admin-secret-0123456789'
process.env['TERMINAL_ACTION_TOKEN_SECRET'] ||= 'verify-wxrr-terminal-action-secret-0123456789'
process.env['FILE_SIGNING_SECRET'] ||= 'verify-wxrr-file-signing-secret-0123456789abcd'
process.env['PAYMENT_SESSION_SECRET'] ||= 'verify-wxrr-payment-session-secret-0123456789'
process.env['PRINT_REQUIRE_PAID_BEFORE_CLAIM'] = 'true'
if (process.env['NODE_ENV'] === 'production') {
  console.error('  FAIL verify:wechat-refund-regression 不得在 NODE_ENV=production 运行')
  process.exit(1)
}

import 'dotenv/config'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import { createSign, generateKeyPairSync, randomBytes, randomUUID } from 'crypto'
import { AuditService } from '../src/audit/audit.service'
import { OnlinePaymentService } from '../src/payment/online-payment.service'
import { OrderStatusService } from '../src/payment/order-status.service'
import { PaymentProviderRegistry } from '../src/payment/payment-provider.factory'
import { PricingService } from '../src/payment/pricing.service'
import { ReconciliationService } from '../src/payment/reconciliation.service'
import { RefundService } from '../src/payment/refund.service'
import { seedDevDefaultPriceConfig } from '../src/payment/price-config.seed'
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
const platformKeys = rsaPair()
const APIV3_KEY = randomBytes(16).toString('hex')
const WX_MCHID = '1900000001'
const WX_APPID = 'wx0000000000000001'
const WX_SERIAL = 'PUB_KEY_ID_WXRR_VERIFY_0001'

// ── 假网关（渠道侧账本，可按场景切换响应）────────────────────────────────────
let refundCreateResponse: { httpStatus?: number; body?: Record<string, unknown> } = {}
let refundQueryResponse: { httpStatus?: number; body?: Record<string, unknown> } = { body: { status: 'PROCESSING' } }
let lastRefundCreate: Record<string, unknown> | null = null
let gatewayRequestCount = 0

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
        res.end(JSON.stringify({ code_url: `weixin://wxpay/bizpayurl?pr=wxrr_${randomBytes(4).toString('hex')}` }))
        return
      }
      if (req.method === 'POST' && url === '/v3/refund/domestic/refunds') {
        lastRefundCreate = JSON.parse(body) as Record<string, unknown>
        if (refundCreateResponse.httpStatus && refundCreateResponse.httpStatus >= 400) {
          res.writeHead(refundCreateResponse.httpStatus, { 'content-type': 'application/json' })
          const code = refundCreateResponse.httpStatus >= 500 ? 'SYSTEM_ERROR' : 'PARAM_ERROR'
          res.end(JSON.stringify({ code, message: 'wxrr simulated failure' }))
          return
        }
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(refundCreateResponse.body ?? {}))
        return
      }
      if (req.method === 'GET' && url.startsWith('/v3/refund/domestic/refunds/')) {
        if (refundQueryResponse.httpStatus && refundQueryResponse.httpStatus >= 400) {
          res.writeHead(refundQueryResponse.httpStatus, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ code: 'RESOURCE_NOT_EXISTS', message: 'not found' }))
          return
        }
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(refundQueryResponse.body ?? {}))
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

// ── 支付/退款报文构造（渠道侧签名，与生产验签路径同源）──────────────────────
function signedNotify(rawJson: Record<string, unknown>, eventType: string): { rawBody: Buffer; headers: Record<string, string> } {
  const resource = encryptWechatCallbackResource(JSON.stringify(rawJson), APIV3_KEY)
  const rawBody = Buffer.from(
    JSON.stringify({ id: randomUUID(), event_type: eventType, resource_type: 'encrypt-resource', resource }),
    'utf8',
  )
  const timestamp = String(Math.floor(Date.now() / 1000))
  const nonce = randomBytes(16).toString('hex')
  const signature = createSign('RSA-SHA256')
    .update(buildWechatCallbackVerifyBase({ timestamp, nonce, rawBody }))
    .sign(platformKeys.privateKey, 'base64')
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
const buildPayCallback = (txn: Record<string, unknown>) => signedNotify(txn, 'TRANSACTION.SUCCESS')
const buildRefundNotify = (payload: Record<string, unknown>) => signedNotify(payload, 'REFUND.SUCCESS')

const PRINT_PARAMS = {
  copies: 1,
  colorMode: 'black_white' as const,
  duplex: 'simplex' as const,
  paperSize: 'A4' as const,
  orientation: 'auto' as const,
  quality: 'standard' as const,
  scale: 'fit' as const,
  pagesPerSheet: 1 as const,
}

const STUCK_AGE_MS = 31 * 60 * 1000 // 对账 STUCK_REFUNDING 阈值 30min，取 31min 视角

async function main(): Promise<void> {
  console.log('\n=== C5-6 wechat refund regression（端到端串联回归）===')

  const { server, port } = await startFakeGateway()
  const wechatProvider = new WechatPayProvider({
    mchid: WX_MCHID,
    appid: WX_APPID,
    mchSerialNo: 'MCH_SERIAL_WXRR_0001',
    privateKeyPem: mchKeys.privateKey,
    apiV3Key: APIV3_KEY,
    platformPublicKeyPem: platformKeys.publicKey,
    platformPublicKeyId: WX_SERIAL,
    notifyBaseUrl: 'https://kiosk-pay.wxrr.test',
    apiBaseUrl: `http://127.0.0.1:${port}`,
  })

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const audit = new AuditService(prisma)
  const storage = new StorageService()
  const pageCount = new PrintPageCountService(prisma, storage)
  const pricing = new PricingService(prisma)
  const orderStatus = new OrderStatusService(prisma, audit)
  const printJobs = new PrintJobsService(prisma, audit, pageCount, pricing, orderStatus, new TerminalCapabilitiesService(prisma))
  const registry = new PaymentProviderRegistry([wechatProvider])
  const payment = new OnlinePaymentService(prisma, audit, orderStatus, registry)
  const refundService = new RefundService(prisma, audit, registry)
  const reconciliation = new ReconciliationService(prisma)

  const suffix = randomUUID().replace(/-/g, '').slice(0, 12)
  const terminalId = `t_wxrr_${suffix}`
  const taskIds: string[] = []
  const fixtureFileIds: string[] = []
  const fixtureStorageKeys: string[] = []
  const fabricatedOrderIds: string[] = []

  async function seedPdfFixture(label: string): Promise<string> {
    const fileId = `f_wxrr_${suffix}_${label}`
    const storageKey = `verify/wechat-refund-regression/${fileId}.pdf`
    const pdfBytes = Buffer.from(`%PDF-1.4\n${'1 0 obj\n<< /Type /Page >>\nendobj\n'.repeat(2)}%%EOF\n`)
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

  /** 建打印单并经真实回调路径打成 paid（channel=wechat）。 */
  async function makePaidOrder(label: string): Promise<{ orderId: string; orderNo: string; refundNo: string; taskId: string; attemptId: string; amountCents: number }> {
    const printed = await printJobs.create(
      { fileUrl: await seedPdfFixture(label), fileMd5: `sha256-wxrr-${label}`, fileName: `${label}.pdf`, params: PRINT_PARAMS },
      { endUserId: null, terminalId },
    )
    taskIds.push(printed.taskId)
    const order = await prisma.order.findUnique({ where: { printTaskId: printed.taskId } })
    if (!order || !printed.paymentSessionToken) fail(`makePaidOrder(${label}) setup failed`)
    const attempt = await payment.createPayAttempt(order.id, printed.paymentSessionToken, 'wechat')
    const cb = buildPayCallback({
      mchid: WX_MCHID,
      appid: WX_APPID,
      out_trade_no: attempt.attemptId,
      transaction_id: `wxtxn_${randomBytes(8).toString('hex')}`,
      trade_state: 'SUCCESS',
      amount: { total: order.amountCents, currency: 'CNY' },
      attach: JSON.stringify({ orderId: order.id }),
    })
    await payment.processCallback('wechat', cb.rawBody, cb.headers)
    const paid = await prisma.order.findUnique({ where: { id: order.id } })
    if (paid?.payStatus !== 'paid') fail(`makePaidOrder(${label}): not paid`)
    return { orderId: order.id, orderNo: order.orderNo, refundNo: `RFD-${order.orderNo}`, taskId: printed.taskId, attemptId: attempt.attemptId, amountCents: order.amountCents }
  }

  const orderState = async (orderId: string) => {
    const o = await prisma.order.findUnique({ where: { id: orderId } })
    if (!o) fail('order missing')
    return o
  }
  const refundRow = (refundNo: string) => prisma.refund.findUnique({ where: { refundNo } })
  const auditCount = (action: string, targetId: string) => prisma.auditLog.count({ where: { action, targetId } })
  /** 对账断言只看本脚本自己的 orderId，绝不假设共享库全局干净。 */
  const stuckHit = async (orderId: string, nowMs: number) => {
    const rep = await reconciliation.report({ nowMs })
    return rep.discrepancies.some((d) => d.code === 'STUCK_REFUNDING' && d.orderId === orderId)
  }
  const anyDiscrepancy = async (orderId: string, nowMs: number) => {
    const rep = await reconciliation.report({ nowMs })
    return rep.discrepancies.filter((d) => d.orderId === orderId).map((d) => d.code)
  }

  const cleanup = async (): Promise<void> => {
    await prisma.refund.deleteMany({ where: { order: { is: { terminalId } } } })
    await prisma.paymentAttempt.deleteMany({ where: { order: { is: { terminalId } } } })
    await prisma.order.deleteMany({ where: { terminalId } })
    await prisma.order.deleteMany({ where: { id: { in: fabricatedOrderIds } } })
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
      data: { id: terminalId, terminalCode: `KSK-WXRR-${suffix}`, agentToken: `agt_wxrr_${suffix}`, deviceFingerprint: 'verify-wxrr' },
    })
    await seedDevDefaultPriceConfig(prisma)
    pass('test fixtures created')

    // ══ R1 STUCK_REFUNDING 全生命周期（产生 → 检出 → cron 收敛 → 复核清零）══
    const R1 = await makePaidOrder('r1')
    refundCreateResponse = { httpStatus: 500 }
    const r1View = await refundService.refund(R1.orderId, { reason: '用户申请退款', operatorId: 'verify-admin' })
    if (r1View.refund.status !== 'pending' || (await orderState(R1.orderId)).payStatus !== 'refunding') {
      fail('R1 setup: 5xx 未形成 pending+refunding')
    }
    if (!(await stuckHit(R1.orderId, Date.now()))) {
      pass('R1a. 新鲜 refunding 单不被对账误报 STUCK_REFUNDING（30 分钟阈值内）')
    } else {
      fail('R1a. fresh refunding misreported as STUCK')
    }
    if (await stuckHit(R1.orderId, Date.now() + STUCK_AGE_MS)) {
      pass('R1b. 超龄后对账检出 STUCK_REFUNDING（命中本单 orderId）')
    } else {
      fail('R1b. aged refunding not detected as STUCK')
    }
    const r1RefundId = `wxrfd_r1_${randomBytes(6).toString('hex')}`
    refundQueryResponse = { body: { status: 'SUCCESS', refund_id: r1RefundId } }
    refundCreateResponse = {}
    const r1Stats = await refundService.convergeStalePendingRefunds({ limit: 100 })
    const r1Refund = await refundRow(R1.refundNo)
    if (
      r1Stats.refunded >= 1 &&
      r1Refund?.status === 'success' &&
      r1Refund.channelRefundNo === r1RefundId &&
      (await orderState(R1.orderId)).payStatus === 'refunded' &&
      (await auditCount('refund.created', R1.orderId)) === 1
    ) {
      pass('R1c. convergeStalePendingRefunds（cron 同一入口）查证 SUCCESS 补完成 → refunded + refund.created 恰 1 条')
    } else {
      fail(`R1c. cron convergence failed: ${JSON.stringify({ r1Stats, status: r1Refund?.status })}`)
    }
    if (!(await stuckHit(R1.orderId, Date.now() + STUCK_AGE_MS)) && (await anyDiscrepancy(R1.orderId, Date.now())).length === 0) {
      pass('R1d. 收敛后对账复核：STUCK 清零且本单无任何差异残留')
    } else {
      fail('R1d. post-convergence reconciliation still dirty')
    }
    refundQueryResponse = { body: { status: 'PROCESSING' } }

    // ══ R2 渠道明确失败 → 对账不残留 → 同号重试成功 ══════════════════════
    const R2 = await makePaidOrder('r2')
    refundCreateResponse = { httpStatus: 400 }
    await expectCode('R2a. 渠道 4xx 明确拒绝 → REFUND_CHANNEL_FAILED', 'REFUND_CHANNEL_FAILED', () =>
      refundService.refund(R2.orderId, { reason: '用户申请退款' }),
    )
    const r2Codes = await anyDiscrepancy(R2.orderId, Date.now() + STUCK_AGE_MS)
    if ((await orderState(R2.orderId)).payStatus === 'paid' && r2Codes.length === 0) {
      pass('R2b. 明确失败回滚 paid 后：即使超龄视角，对账也无 STUCK/差异残留（failed ≠ stuck）')
    } else {
      fail(`R2b. rollback left reconciliation residue: ${JSON.stringify(r2Codes)}`)
    }
    const r2RefundId = `wxrfd_r2_${randomBytes(6).toString('hex')}`
    refundCreateResponse = { body: { status: 'SUCCESS', refund_id: r2RefundId } }
    const r2Retry = await refundService.refund(R2.orderId, { reason: '重试退款', operatorId: 'verify-admin' })
    if (
      r2Retry.refund.status === 'success' &&
      lastRefundCreate?.['out_refund_no'] === R2.refundNo &&
      (await orderState(R2.orderId)).payStatus === 'refunded' &&
      (await anyDiscrepancy(R2.orderId, Date.now())).length === 0
    ) {
      pass('R2c. 同号重试成功 → refunded，对账无差异（同 out_refund_no 渠道幂等）')
    } else {
      fail('R2c. retry-after-failure chain broken')
    }

    // ══ R3 重复/乱序退款通知 × cron 收敛互不重复出款 ══════════════════════
    const R3 = await makePaidOrder('r3')
    const r3RefundId = `wxrfd_r3_${randomBytes(6).toString('hex')}`
    refundCreateResponse = { body: { status: 'PROCESSING', refund_id: r3RefundId } }
    await refundService.refund(R3.orderId, { reason: '用户申请退款' })
    if ((await refundRow(R3.refundNo))?.status !== 'pending') fail('R3 setup: PROCESSING 未形成 pending')
    const r3NotifyPayload = {
      mchid: WX_MCHID,
      out_trade_no: R3.attemptId,
      out_refund_no: R3.refundNo,
      refund_id: r3RefundId,
      refund_status: 'SUCCESS',
      amount: { refund: R3.amountCents, total: R3.amountCents },
    }
    const r3Notify = buildRefundNotify(r3NotifyPayload)
    await refundService.processWechatRefundNotify(r3Notify.rawBody, r3Notify.headers)
    if (
      (await refundRow(R3.refundNo))?.status === 'success' &&
      (await orderState(R3.orderId)).payStatus === 'refunded' &&
      (await auditCount('refund.created', R3.orderId)) === 1
    ) {
      pass('R3a. pending 单由渠道退款通知完成（viaRefundNotify 路径）→ refunded')
    } else {
      fail('R3a. refund notify did not complete pending refund')
    }
    const r3Dup = buildRefundNotify(r3NotifyPayload) // 同 payload 新 nonce（渠道重发场景）
    const r3DupResult = await refundService.processWechatRefundNotify(r3Dup.rawBody, r3Dup.headers)
    if (r3DupResult.idempotent === true && (await auditCount('refund.created', R3.orderId)) === 1) {
      pass('R3b. 渠道重发同一 SUCCESS 通知：幂等，不重复入账/审计')
    } else {
      fail('R3b. duplicate notify not idempotent')
    }
    const r3Closed = buildRefundNotify({ ...r3NotifyPayload, refund_status: 'CLOSED' })
    await expectCode('R3c. 迟到 CLOSED 通知不回退已 SUCCESS 单 → REFUND_NOTIFY_STATE_CONFLICT', 'REFUND_NOTIFY_STATE_CONFLICT', () =>
      refundService.processWechatRefundNotify(r3Closed.rawBody, r3Closed.headers),
    )
    const r3GatewayBefore = gatewayRequestCount
    const r3Stats = await refundService.convergeStalePendingRefunds({ limit: 100 })
    if (gatewayRequestCount === r3GatewayBefore && r3Stats.refunded === 0 && (await auditCount('refund.created', R3.orderId)) === 1) {
      pass('R3d. 通知完成后 cron 收敛零渠道请求、不二次出款（通知/查证两条完成路径互斥幂等）')
    } else {
      fail(`R3d. convergence after notify not inert: ${JSON.stringify(r3Stats)}`)
    }

    // ══ R4 退款缺失三型排查链 ═════════════════════════════════════════════
    // 4a 通知未知 out_refund_no：拒绝且不误改任何本地单
    const r4aNotify = buildRefundNotify({
      mchid: WX_MCHID,
      out_trade_no: 'x',
      out_refund_no: `RFD-WXRR-NONEXISTENT-${suffix}`,
      refund_id: 'rfd4a',
      refund_status: 'SUCCESS',
      amount: { refund: 100, total: 100 },
    })
    await expectCode('R4a. 未知 out_refund_no 通知 → REFUND_NOTIFY_UNKNOWN_REFUND（不误改本地单）', 'REFUND_NOTIFY_UNKNOWN_REFUND', () =>
      refundService.processWechatRefundNotify(r4aNotify.rawBody, r4aNotify.headers),
    )
    if ((await orderState(R3.orderId)).payStatus === 'refunded' && (await orderState(R2.orderId)).payStatus === 'refunded') {
      pass('R4a2. 未知单通知后既有订单状态零变化')
    } else {
      fail('R4a2. unknown notify mutated unrelated orders')
    }
    // 4b 账实不符：refunded 无 Refund 行 → 对账检出（SOP 排查树入口之一）
    const r4bId = `ord_wxrr_${suffix}_4b`
    fabricatedOrderIds.push(r4bId)
    await prisma.order.create({
      data: {
        id: r4bId,
        orderNo: `ORD-WXRR-${suffix}-4B`,
        type: 'print',
        amountCents: 100,
        payStatus: 'refunded',
        paymentSource: 'wechat',
        payChannel: 'wechat',
        paidAt: new Date(),
        refundedAt: new Date(),
        refundedAmountCents: 100,
      },
    })
    const r4bRep = await reconciliation.report({ nowMs: Date.now() })
    if (r4bRep.discrepancies.some((d) => d.code === 'ORDER_REFUNDED_WITHOUT_REFUND_ROW' && d.orderId === r4bId)) {
      pass('R4b. 账实不符（refunded 无 Refund 行）被对账检出 ORDER_REFUNDED_WITHOUT_REFUND_ROW')
    } else {
      fail('R4b. missing-refund-row not detected')
    }
    // 4c 渠道查无此单（原请求未到达）→ 手动重复 refund() 同号重发收敛
    const R4c = await makePaidOrder('r4c')
    refundCreateResponse = { httpStatus: 500 }
    await refundService.refund(R4c.orderId, { reason: '用户申请退款' })
    const r4cRefundId = `wxrfd_r4c_${randomBytes(6).toString('hex')}`
    refundQueryResponse = { httpStatus: 404 } // 渠道查无此单
    refundCreateResponse = { body: { status: 'SUCCESS', refund_id: r4cRefundId } }
    const r4cDone = await refundService.refund(R4c.orderId, { reason: '人工核实后重发' })
    if (
      r4cDone.refund.status === 'success' &&
      r4cDone.refund.channelRefundNo === r4cRefundId &&
      lastRefundCreate?.['out_refund_no'] === R4c.refundNo &&
      (await orderState(R4c.orderId)).payStatus === 'refunded' &&
      (await anyDiscrepancy(R4c.orderId, Date.now())).length === 0
    ) {
      pass('R4c. 渠道查无此单 → 人工重复 refund() 同号重发 → refunded，对账无差异')
    } else {
      fail('R4c. unknown-at-channel manual reissue chain broken')
    }
    refundQueryResponse = { body: { status: 'PROCESSING' } }

    console.log(`\n✅ ALL PASS（${passCount} checks）— C5-6 微信退款端到端回归通过\n`)
  } finally {
    await cleanup()
    await prisma.onModuleDestroy()
  }
}

main().catch((e) => {
  console.error('  FAIL uncaught:', e)
  process.exit(1)
})
