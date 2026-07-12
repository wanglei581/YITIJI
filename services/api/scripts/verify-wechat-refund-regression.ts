/**
<<<<<<< HEAD
<<<<<<< HEAD
 * verify:wechat-refund-regression — 微信退款回调 × 对账异常口径回归门禁
 *
 * 背景：`verify:wechat-refund-notify` 已覆盖验签/解密/幂等/状态机（rawBody 完整性用「篡改
 * 签名头」验证）；`verify:reconciliation` 已覆盖 STUCK_REFUNDING 检出（用直接造库的 refunding
 * 订单验证）。但两者从未交叉验证：一笔真实退款通知处理前后，`ReconciliationService` 的判定
 * 是否随之正确演进。本脚本锁定这条链路，并补一项前者未覆盖的攻击面。
 *
 * 覆盖：
 * 1. rawBody 替换攻击：拿一条完整合法通知的 headers（含真实签名），套用另一条不同内容的
 *    rawBody → 签名必然失配被拒绝（而非仅篡改签名字符串本身；验证签名确实绑定在原始字节上，
 *    不是绑定在某个可预测的派生字段）。
 * 2. 对账「退款通知缺失」口径：refunding 订单在未收到任何通知前，停留 29 分钟不算
 *    STUCK_REFUNDING，停留 31 分钟即被检出——边界随 `nowMs` 精确判定，不是提前或滞后触发。
 * 3. 退款通知到达后，STUCK_REFUNDING 立即消失（对账不再要求人工跟进同一笔）。
 * 4. 对账「渠道明确失败」口径：CLOSED 通知令订单回 paid，即便在远超 30 分钟之后对账，
 *    该订单也绝不出现在 STUCK_REFUNDING（明确失败会自愈，不是"不知道结果"的滞留态）。
 * 5. 对账「重复通知」口径：同一笔退款收到两次 SUCCESS 通知（不同 nonce）后，对账
 *    REFUND_AMOUNT_MISMATCH 不误报（不会因通知重放而被算成两笔退款）。
 * 6. 每条自动完成的退款都留有可查的人工处理线索：`refund.created`（viaRefundNotify）
 *    或 `refund.channel_error` 审计记录，供异常处理 SOP 按 orderId 定位。
 */
process.env['TERMINAL_ADMIN_SECRET'] ||= 'verify-wxrr-terminal-admin-secret-0123456789'
process.env['TERMINAL_ACTION_TOKEN_SECRET'] ||= 'verify-wxrr-terminal-action-secret-01234'
process.env['FILE_SIGNING_SECRET'] ||= 'verify-wxrr-file-signing-secret-01234567890abc'
process.env['PAYMENT_SESSION_SECRET'] ||= 'verify-wxrr-payment-session-secret-01234567'
process.env['PRINT_REQUIRE_PAID_BEFORE_CLAIM'] = 'true'

import 'dotenv/config'
import { createSign, generateKeyPairSync, randomBytes, randomUUID } from 'crypto'
import { AuditService } from '../src/audit/audit.service'
import { OrderStatusService } from '../src/payment/order-status.service'
import { resolvePaymentProviders } from '../src/payment/payment-provider.factory'
import { ReconciliationService } from '../src/payment/reconciliation.service'
=======
 * C5-6 后续回归门禁（verify:wechat-refund-regression）——微信退款端到端串联回归。
=======
 * C5-6 后续回归门禁（verify:wechat-refund-regression）——微信退款端到端组合回归。
>>>>>>> 5f9fc980 (fix(payment): C5-6 回归门禁按复审收缩为方案 B + 隔离加固 + SOP 校准)
 *
 * 定位（反堆砌口径，Codex 复审后收缩为方案 B）：单点断言归属既有五脚本
 * （refund-idempotent / refund-real-channels / wechat-refund-notify / refund-convergence /
 * reconciliation），本脚本只对**跨脚本组合链路**计 PASS；链路中间步骤（其单点语义已被
 * 既有脚本覆盖）只做静默守卫（断链即失败，不计 check、不重复报告）。
 *
 * 计数的 6 项组合断言：
 * R1a 新鲜 refunding 单不被对账误报 STUCK（负向组合：三分法「结果不可知」×对账阈值）；
 * R1c 超龄 STUCK 单经 convergeStalePendingRefunds()（cron 同一入口）查证补完成，且本轮
 *     恰扫描 1 条（隔离前置已保证无外部 pending）；
 * R1d 收敛后对账复核：STUCK 清零、本单零差异残留；
 * R2b 渠道明确失败回滚 paid 后，即使超龄视角对账也零残留（failed ≠ stuck）；
 * R2c 同号重试成功 → refunded 且对账零差异；
 * R3d 退款通知完成后，批量收敛零扫描、零渠道请求、不重复入账（通知/查证两条完成路径互斥）。
 *
 * 边界声明：假网关按 out_refund_no 路由响应、不校验出站请求签名——本门禁锁定的是
 * 状态机×对账×收敛的组合正确性；出站签名正确性不在本门禁范围（与既有渠道类 verify 同口径）。
 * 共享库隔离：任何批量收敛调用前先探测非本脚本的 pending 真实渠道退款，存在即安全失败，
 * 绝不对外部残留应用本脚本的网关响应。
 *
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
>>>>>>> c2ea58d1 (feat(payment): C5-6 退款端到端回归门禁 + 对账/异常退款 SOP + FREE_MODE 决策记录)
import {
  buildWechatCallbackVerifyBase,
  encryptWechatCallbackResource,
  WECHAT_NONCE_HEADER,
  WECHAT_SERIAL_HEADER,
  WECHAT_SIGNATURE_HEADER,
  WECHAT_TIMESTAMP_HEADER,
  WechatPayProvider,
} from '../src/payment/providers/wechat-pay.provider'
<<<<<<< HEAD
import { PricingService } from '../src/payment/pricing.service'
import { RefundService } from '../src/payment/refund.service'
import { seedDevDefaultPriceConfig } from '../src/payment/price-config.seed'
import { PrintJobsService } from '../src/print-jobs/print-jobs.service'
import { TerminalCapabilitiesService } from '../src/terminals/terminal-capabilities.service'
import { PrintPageCountService } from '../src/print-jobs/print-page-count.service'
import { PrismaService } from '../src/prisma/prisma.service'
import { StorageService } from '../src/storage/storage.service'
import { signFileUrl } from '../src/files/signing'
import { LOCAL_BUCKET_SENTINEL } from '../src/storage/storage.interface'

let passCount = 0
function pass(msg: string): void {
  passCount += 1
  console.log(`  PASS ${msg}`)
}
function fail(msg: string): never {
  console.error(`  FAIL ${msg}`)
=======
import { PrintJobsService } from '../src/print-jobs/print-jobs.service'
import { PrintPageCountService } from '../src/print-jobs/print-page-count.service'
import { PrismaService } from '../src/prisma/prisma.service'
import { TerminalCapabilitiesService } from '../src/terminals/terminal-capabilities.service'
import { signFileUrl } from '../src/files/signing'
import { LOCAL_BUCKET_SENTINEL } from '../src/storage/storage.interface'
import { StorageService } from '../src/storage/storage.service'

let passCount = 0
class VerifyFailure extends Error {}
function pass(message: string): void {
  passCount += 1
  console.log(`  PASS ${message}`)
}
/** 抛异常而非 process.exit：保证 finally/cleanup 必然执行（共享库不留残留）。 */
function fail(message: string): never {
<<<<<<< HEAD
  console.error(`  FAIL ${message}`)
>>>>>>> c2ea58d1 (feat(payment): C5-6 退款端到端回归门禁 + 对账/异常退款 SOP + FREE_MODE 决策记录)
  process.exit(1)
=======
  throw new VerifyFailure(`  FAIL ${message}`)
>>>>>>> 5f9fc980 (fix(payment): C5-6 回归门禁按复审收缩为方案 B + 隔离加固 + SOP 校准)
}
/** 链路中间静默守卫：断链即失败，但不计 check、不输出 PASS（单点语义归属既有脚本）。 */
function guard(cond: boolean, message: string): void {
  if (!cond) fail(`[链路守卫] ${message}`)
}
async function expectCodeGuard(code: string, label: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn()
  } catch (e) {
<<<<<<< HEAD
<<<<<<< HEAD
    const m = (e as Error)?.message ?? String(e)
    if (m.includes(code)) return pass(label)
    fail(`${label} — expected ${code}, got: ${m}`)
  }
  fail(`${label} — expected error ${code} but resolved`)
}

// ── 渠道侧密钥（本地生成，仅验证脚本内存，零真实凭证） ──────────────────────────
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
const APIV3_KEY = randomBytes(16).toString('hex')
const MCH_ID = '1900000002'
const APP_ID = 'wx0000000000000002'
const SERIAL = 'PUB_KEY_ID_WXRR_VERIFY_0001'

function buildRefundNotify(payload: Record<string, unknown>): { rawBody: Buffer; headers: Record<string, string> } {
  const resource = encryptWechatCallbackResource(JSON.stringify(payload), APIV3_KEY)
  const rawBody = Buffer.from(
    JSON.stringify({ id: randomUUID(), event_type: 'REFUND.SUCCESS', resource_type: 'encrypt-resource', resource }),
=======
=======
    if (e instanceof VerifyFailure) throw e
>>>>>>> 5f9fc980 (fix(payment): C5-6 回归门禁按复审收缩为方案 B + 隔离加固 + SOP 校准)
    const msg = (e as Error)?.message ?? String(e)
    guard(msg.includes(code), `${label} — expected ${code}, got: ${msg}`)
    return
  }
  fail(`[链路守卫] ${label} — expected error ${code}, but resolved`)
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

// ── 假网关：按 out_refund_no 路由响应；未知退款号一律 PROCESSING（绝不改变外部状态）──
type GatewayResponse = { httpStatus?: number; body?: Record<string, unknown> }
const refundCreateByNo = new Map<string, GatewayResponse>()
const refundQueryByNo = new Map<string, GatewayResponse>()
let lastRefundCreate: Record<string, unknown> | null = null
let gatewayRequestCount = 0
const SAFE_DEFAULT: GatewayResponse = { body: { status: 'PROCESSING' } }

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
      const respond = (r: GatewayResponse, notFoundCode = 'PARAM_ERROR'): void => {
        if (r.httpStatus && r.httpStatus >= 400) {
          res.writeHead(r.httpStatus, { 'content-type': 'application/json' })
          const code = r.httpStatus >= 500 ? 'SYSTEM_ERROR' : r.httpStatus === 404 ? 'RESOURCE_NOT_EXISTS' : notFoundCode
          res.end(JSON.stringify({ code, message: 'wxrr simulated' }))
          return
        }
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(r.body ?? {}))
      }
      if (req.method === 'POST' && url === '/v3/pay/transactions/native') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ code_url: `weixin://wxpay/bizpayurl?pr=wxrr_${randomBytes(4).toString('hex')}` }))
        return
      }
      if (req.method === 'POST' && url === '/v3/refund/domestic/refunds') {
        const parsed = JSON.parse(body) as Record<string, unknown>
        lastRefundCreate = parsed
        respond(refundCreateByNo.get(String(parsed['out_refund_no'])) ?? SAFE_DEFAULT)
        return
      }
      if (req.method === 'GET' && url.startsWith('/v3/refund/domestic/refunds/')) {
        const no = decodeURIComponent(url.slice('/v3/refund/domestic/refunds/'.length).split('?')[0] ?? '')
        respond(refundQueryByNo.get(no) ?? SAFE_DEFAULT)
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

// ── 报文构造（渠道侧签名，与生产验签/解密路径同源）──────────────────────────
function signedNotify(rawJson: Record<string, unknown>, eventType: string): { rawBody: Buffer; headers: Record<string, string> } {
  const resource = encryptWechatCallbackResource(JSON.stringify(rawJson), APIV3_KEY)
  const rawBody = Buffer.from(
    JSON.stringify({ id: randomUUID(), event_type: eventType, resource_type: 'encrypt-resource', resource }),
>>>>>>> c2ea58d1 (feat(payment): C5-6 退款端到端回归门禁 + 对账/异常退款 SOP + FREE_MODE 决策记录)
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
<<<<<<< HEAD
      [WECHAT_SERIAL_HEADER]: SERIAL,
    },
  }
}
=======
      [WECHAT_SERIAL_HEADER]: WX_SERIAL,
    },
  }
}
const buildPayCallback = (txn: Record<string, unknown>) => signedNotify(txn, 'TRANSACTION.SUCCESS')
const buildRefundNotify = (payload: Record<string, unknown>) => signedNotify(payload, 'REFUND.SUCCESS')
>>>>>>> c2ea58d1 (feat(payment): C5-6 退款端到端回归门禁 + 对账/异常退款 SOP + FREE_MODE 决策记录)

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

<<<<<<< HEAD
async function main(): Promise<void> {
  console.log('\n=== verify:wechat-refund-regression ===')
=======
const STUCK_AGE_MS = 31 * 60 * 1000 // 对账 STUCK_REFUNDING 阈值 30min，取 31min 视角

async function main(): Promise<void> {
  console.log('\n=== C5-6 wechat refund regression（端到端组合回归）===')

  const { server, port } = await startFakeGateway()
  const closeGateway = () =>
    new Promise<void>((resolve) => {
      server.close(() => resolve())
    })
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
>>>>>>> c2ea58d1 (feat(payment): C5-6 退款端到端回归门禁 + 对账/异常退款 SOP + FREE_MODE 决策记录)

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const audit = new AuditService(prisma)
  const storage = new StorageService()
  const pageCount = new PrintPageCountService(prisma, storage)
  const pricing = new PricingService(prisma)
  const orderStatus = new OrderStatusService(prisma, audit)
  const printJobs = new PrintJobsService(prisma, audit, pageCount, pricing, orderStatus, new TerminalCapabilitiesService(prisma))
<<<<<<< HEAD
  const reconciliation = new ReconciliationService(prisma)

  const wechatProvider = new WechatPayProvider({
    mchid: MCH_ID,
    appid: APP_ID,
    mchSerialNo: 'MCH_SERIAL_WXRR_0001',
    privateKeyPem: mchKeys.privateKey,
    apiV3Key: APIV3_KEY,
    platformPublicKeyPem: platformKeys.publicKey,
    platformPublicKeyId: SERIAL,
    notifyBaseUrl: 'https://test.local',
    apiBaseUrl: 'http://127.0.0.1:1',
  })
  const registry = { get: (ch: string) => (ch === 'wechat' ? wechatProvider : undefined) } as ReturnType<typeof resolvePaymentProviders>
  // @ts-expect-error 构造函数反射（与 verify-wechat-refund-notify.ts 同一手法）
  const refundSvc: RefundService = new (RefundService as unknown as new (...args: unknown[]) => RefundService)(prisma, audit, registry)

  const suffix = randomUUID().replace(/-/g, '').slice(0, 10)
  const terminalId = `t_wxrr_${suffix}`
  const fileIds: string[] = []
  const storageKeys: string[] = []
  const taskIds: string[] = []

  async function seedPdf(label: string): Promise<string> {
    const fid = `f_wxrr_${suffix}_${label}`
    const sk = `verify/wxrr/${fid}.pdf`
    const pdf = Buffer.from(`%PDF-1.4\n${'1 0 obj\n<< /Type /Page >>\nendobj\n'.repeat(2)}%%EOF\n`)
    await storage.putObject(sk, pdf, 'application/pdf', LOCAL_BUCKET_SENTINEL)
    await prisma.fileObject.create({
      data: { id: fid, storageKey: sk, filename: `${label}.pdf`, mimeType: 'application/pdf', sizeBytes: pdf.length, sha256: '', purpose: 'print_source', bucket: LOCAL_BUCKET_SENTINEL },
    })
    fileIds.push(fid)
    storageKeys.push(sk)
    return signFileUrl(fid, 60_000).url
  }

  async function makePaidAndRefunding(label: string): Promise<{
    orderId: string; orderNo: string; refundNo: string; taskId: string; amountCents: number
  }> {
    await seedDevDefaultPriceConfig(prisma)
    const created = await printJobs.create(
      { fileUrl: await seedPdf(label), fileMd5: `sha256-wxrr-${label}`, fileName: `${label}.pdf`, params: PRINT_PARAMS },
      { endUserId: null, terminalId },
    )
    taskIds.push(created.taskId)
    const order = await prisma.order.findUnique({ where: { printTaskId: created.taskId } })
    if (!order) fail(`order not found for ${label}`)

    const attemptId = `attempt_wxrr_${suffix}_${label}`
    await prisma.paymentAttempt.create({
      data: { id: attemptId, orderId: order.id, channel: 'wechat', status: 'success', amountCents: order.amountCents, expiresAt: new Date(Date.now() + 3600_000), prepayId: 'fake_prepay', channelTxnNo: `wxtxn_${suffix}_${label}` },
    })
    await prisma.order.update({ where: { id: order.id }, data: { payStatus: 'paid', paymentSource: 'wechat', payChannel: 'wechat', paidAt: new Date(), paidBy: 'verify' } })

    const refundNo = `RFD-${order.orderNo}`
    await prisma.$transaction(async (tx) => {
      await tx.order.update({ where: { id: order.id }, data: { payStatus: 'refunding' } })
      await tx.refund.create({
        data: { orderId: order.id, refundNo, amountCents: order.amountCents, status: 'pending', reason: 'test', channel: 'wechat' },
      })
    })
    return { orderId: order.id, orderNo: order.orderNo, refundNo, taskId: created.taskId, amountCents: order.amountCents }
  }

  const cleanup = async () => {
    await prisma.refund.deleteMany({ where: { order: { is: { terminalId } } } })
    await prisma.paymentAttempt.deleteMany({ where: { order: { is: { terminalId } } } })
    await prisma.order.deleteMany({ where: { terminalId } })
    await prisma.printTask.deleteMany({ where: { id: { in: taskIds } } })
    await prisma.terminal.deleteMany({ where: { id: terminalId } })
    await prisma.fileObject.deleteMany({ where: { id: { in: fileIds } } })
    for (const k of storageKeys) await storage.deleteObject(k, LOCAL_BUCKET_SENTINEL).catch(() => undefined)
=======
  const registry = new PaymentProviderRegistry([wechatProvider])
  const payment = new OnlinePaymentService(prisma, audit, orderStatus, registry)
  const refundService = new RefundService(prisma, audit, registry)
  const reconciliation = new ReconciliationService(prisma)

  const suffix = randomUUID().replace(/-/g, '').slice(0, 12)
  const terminalId = `t_wxrr_${suffix}`
  const taskIds: string[] = []
  const orderIds: string[] = []
  const fixtureFileIds: string[] = []
  const fixtureStorageKeys: string[] = []

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
  async function makePaidOrder(label: string): Promise<{ orderId: string; orderNo: string; refundNo: string; attemptId: string; amountCents: number }> {
    const printed = await printJobs.create(
      { fileUrl: await seedPdfFixture(label), fileMd5: `sha256-wxrr-${label}`, fileName: `${label}.pdf`, params: PRINT_PARAMS },
      { endUserId: null, terminalId },
    )
    taskIds.push(printed.taskId)
    const order = await prisma.order.findUnique({ where: { printTaskId: printed.taskId } })
    if (!order || !printed.paymentSessionToken) fail(`makePaidOrder(${label}) setup failed`)
    orderIds.push(order.id)
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
    guard(paid?.payStatus === 'paid', `makePaidOrder(${label}): not paid`)
    return { orderId: order.id, orderNo: order.orderNo, refundNo: `RFD-${order.orderNo}`, attemptId: attempt.attemptId, amountCents: order.amountCents }
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
  const discrepancyCodes = async (orderId: string, nowMs: number) => {
    const rep = await reconciliation.report({ nowMs })
    return rep.discrepancies.filter((d) => d.orderId === orderId).map((d) => d.code)
  }
  /**
   * 共享库隔离前置：convergeStalePendingRefunds 是无范围条件的全表批处理入口
   * （cron 生产语义即如此）。调用前必须确认库内不存在**非本脚本**的真实渠道 pending
   * 退款；存在即安全失败——绝不让本脚本的假网关响应作用于外部残留。
   */
  const assertNoForeignPending = async (where: string): Promise<void> => {
    const foreign = await prisma.refund.findMany({
      where: { status: 'pending', channel: { in: ['wechat', 'alipay'] }, orderId: { notIn: orderIds } },
      select: { refundNo: true },
      take: 5,
    })
    guard(
      foreign.length === 0,
      `${where}: 共享库存在非本脚本的 pending 真实渠道退款（${foreign.map((f) => f.refundNo).join('、')}）。为避免批量收敛误处理外部数据，本脚本安全终止；请先清理残留（多为上游 verify 异常中断）。`,
    )
  }

  const cleanup = async (): Promise<void> => {
    await prisma.auditLog.deleteMany({ where: { targetType: 'order', targetId: { in: orderIds } } }).catch(() => undefined)
    await prisma.refund.deleteMany({ where: { orderId: { in: orderIds } } }).catch(() => undefined)
    await prisma.paymentAttempt.deleteMany({ where: { orderId: { in: orderIds } } }).catch(() => undefined)
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } }).catch(() => undefined)
    await prisma.printTask.deleteMany({ where: { id: { in: taskIds } } }).catch(() => undefined)
    await prisma.terminal.deleteMany({ where: { id: terminalId } }).catch(() => undefined)
    await prisma.fileObject.deleteMany({ where: { id: { in: fixtureFileIds } } }).catch(() => undefined)
    for (const key of fixtureStorageKeys) {
      await storage.deleteObject(key, LOCAL_BUCKET_SENTINEL).catch(() => undefined)
    }
<<<<<<< HEAD
    server.close()
>>>>>>> c2ea58d1 (feat(payment): C5-6 退款端到端回归门禁 + 对账/异常退款 SOP + FREE_MODE 决策记录)
=======
    await closeGateway().catch(() => undefined)
>>>>>>> 5f9fc980 (fix(payment): C5-6 回归门禁按复审收缩为方案 B + 隔离加固 + SOP 校准)
  }

  try {
    await prisma.terminal.create({
<<<<<<< HEAD
      data: { id: terminalId, terminalCode: `KSK-WXRR-${suffix}`, agentToken: `agt_${suffix}`, deviceFingerprint: 'verify-wxrr' },
    })

    // ── 1. rawBody 替换攻击：套用另一条通知的合法 headers/签名 ──────────────
    const RSwap = await makePaidAndRefunding('swap')
    const genuine = buildRefundNotify({ mchid: MCH_ID, out_trade_no: 'x', out_refund_no: RSwap.refundNo, refund_id: 'rfd_swap', refund_status: 'SUCCESS', amount: { refund: RSwap.amountCents, total: RSwap.amountCents } })
    const decoyPayload = buildRefundNotify({ mchid: MCH_ID, out_trade_no: 'y', out_refund_no: RSwap.refundNo, refund_id: 'rfd_decoy', refund_status: 'SUCCESS', amount: { refund: RSwap.amountCents, total: RSwap.amountCents } })
    // 拿 genuine 的 headers（含真实签名），套用 decoyPayload 的 rawBody —— 签名对不上新字节。
    await expectCode('rawBody 替换攻击拒绝（签名绑定原始字节，非派生字段）', 'CALLBACK_SIGNATURE_INVALID', () =>
      refundSvc.processWechatRefundNotify(decoyPayload.rawBody, genuine.headers),
    )
    if ((await prisma.refund.findUnique({ where: { refundNo: RSwap.refundNo } }))?.status === 'pending') {
      pass('rawBody 替换攻击：退款记录未被改动')
    } else fail('RSwap: refund status changed by body-swap attack')

    // ── 2/3. 对账「退款通知缺失」边界 + 通知到达后立即解除 ───────────────────
    const RStuck = await makePaidAndRefunding('stuck')
    const order2 = await prisma.order.findUnique({ where: { id: RStuck.orderId } })
    if (!order2) fail('RStuck order missing')
    const updatedAtMs = order2.updatedAt.getTime()

    const freshReport = await reconciliation.report({ nowMs: updatedAtMs + 29 * 60 * 1000 })
    if (!freshReport.discrepancies.some((d) => d.code === 'STUCK_REFUNDING' && d.orderId === RStuck.orderId)) {
      pass('对账边界：refunding 29 分钟内不判 STUCK_REFUNDING（通知尚在合理时限内）')
    } else fail('RStuck: 29min falsely flagged as STUCK_REFUNDING')

    const staleReport = await reconciliation.report({ nowMs: updatedAtMs + 31 * 60 * 1000 })
    if (staleReport.discrepancies.some((d) => d.code === 'STUCK_REFUNDING' && d.orderId === RStuck.orderId)) {
      pass('对账「退款通知缺失」口径：31 分钟无通知即检出 STUCK_REFUNDING')
    } else fail('RStuck: 31min not flagged as STUCK_REFUNDING')

    // 通知到达 → refunded
    const stuckNotify = buildRefundNotify({ mchid: MCH_ID, out_trade_no: 'x', out_refund_no: RStuck.refundNo, refund_id: 'rfd_stuck', refund_status: 'SUCCESS', amount: { refund: RStuck.amountCents, total: RStuck.amountCents } })
    await refundSvc.processWechatRefundNotify(stuckNotify.rawBody, stuckNotify.headers)
    const resolvedReport = await reconciliation.report({ nowMs: updatedAtMs + 31 * 60 * 1000 })
    if (!resolvedReport.discrepancies.some((d) => d.code === 'STUCK_REFUNDING' && d.orderId === RStuck.orderId)) {
      pass('退款通知到达后 STUCK_REFUNDING 立即解除（同一 nowMs 复算）')
    } else fail('RStuck: still flagged STUCK_REFUNDING after notify resolved it')
    if (!resolvedReport.discrepancies.some((d) => d.orderId === RStuck.orderId)) {
      pass('通知解除后该订单在对账中不再产生任何差异（金额/状态一致）')
    } else fail(`RStuck: unexpected discrepancy after resolution: ${JSON.stringify(resolvedReport.discrepancies.filter((d) => d.orderId === RStuck.orderId))}`)

    // ── 4. 对账「渠道明确失败」口径：CLOSED 自愈，远期也不算滞留 ─────────────
    const RClosed = await makePaidAndRefunding('closed')
    const orderClosed = await prisma.order.findUnique({ where: { id: RClosed.orderId } })
    if (!orderClosed) fail('RClosed order missing')
    const closedNotify = buildRefundNotify({ mchid: MCH_ID, out_trade_no: 'x', out_refund_no: RClosed.refundNo, refund_id: null, refund_status: 'CLOSED', amount: { refund: 0, total: RClosed.amountCents } })
    await refundSvc.processWechatRefundNotify(closedNotify.rawBody, closedNotify.headers)
    const farFutureReport = await reconciliation.report({ nowMs: orderClosed.updatedAt.getTime() + 365 * 24 * 60 * 60 * 1000 })
    if (!farFutureReport.discrepancies.some((d) => d.orderId === RClosed.orderId)) {
      pass('渠道明确失败（CLOSED）自愈回 paid，即便远期对账也不算 STUCK_REFUNDING 滞留')
    } else fail(`RClosed: unexpectedly flagged: ${JSON.stringify(farFutureReport.discrepancies.filter((d) => d.orderId === RClosed.orderId))}`)

    // ── 5. 对账「重复通知」口径：重放不产生金额误报 ──────────────────────────
    const RDup = await makePaidAndRefunding('dup')
    const dupNotify1 = buildRefundNotify({ mchid: MCH_ID, out_trade_no: 'x', out_refund_no: RDup.refundNo, refund_id: 'rfd_dup', refund_status: 'SUCCESS', amount: { refund: RDup.amountCents, total: RDup.amountCents } })
    await refundSvc.processWechatRefundNotify(dupNotify1.rawBody, dupNotify1.headers)
    const dupNotify2 = buildRefundNotify({ mchid: MCH_ID, out_trade_no: 'x', out_refund_no: RDup.refundNo, refund_id: 'rfd_dup', refund_status: 'SUCCESS', amount: { refund: RDup.amountCents, total: RDup.amountCents } })
    await refundSvc.processWechatRefundNotify(dupNotify2.rawBody, dupNotify2.headers)
    const dupReport = await reconciliation.report({ nowMs: Date.now() })
    if (!dupReport.discrepancies.some((d) => d.code === 'REFUND_AMOUNT_MISMATCH' && d.orderId === RDup.orderId)) {
      pass('对账「重复通知」口径：SUCCESS 通知重放不产生 REFUND_AMOUNT_MISMATCH（未被算成两笔）')
    } else fail('RDup: duplicate notify caused REFUND_AMOUNT_MISMATCH')

    // ── 6. 人工处理线索：每条自动完成路径都留审计记录 ────────────────────────
    const successAudit = await prisma.auditLog.findFirst({ where: { action: 'refund.created', targetId: RStuck.orderId } })
    const closedAudit = await prisma.auditLog.findFirst({ where: { action: 'refund.channel_error', targetId: RClosed.orderId } })
    if (successAudit && closedAudit) {
      pass('人工处理线索：SUCCESS(refund.created) 与 CLOSED(refund.channel_error) 均留可按 orderId 查询的审计记录')
    } else fail(`missing audit trail: success=${!!successAudit}, closed=${!!closedAudit}`)

    console.log(`\n  ✅ verify:wechat-refund-regression 全部通过（${passCount} checks）\n`)
=======
      data: { id: terminalId, terminalCode: `KSK-WXRR-${suffix}`, agentToken: `agt_wxrr_${suffix}`, deviceFingerprint: 'verify-wxrr' },
    })
    await seedDevDefaultPriceConfig(prisma) // 支付域 verify 既有共用前置：幂等写入开发默认价目
    console.log('  · fixtures ready（不计 check）')

    // ══ R1 STUCK_REFUNDING 全生命周期（产生 → 检出 → cron 收敛 → 复核清零）══
    const R1 = await makePaidOrder('r1')
    refundCreateByNo.set(R1.refundNo, { httpStatus: 500 })
    const r1View = await refundService.refund(R1.orderId, { reason: '用户申请退款', operatorId: 'verify-admin' })
    guard(r1View.refund.status === 'pending' && (await orderState(R1.orderId)).payStatus === 'refunding', 'R1 setup: 5xx 未形成 pending+refunding')
    if (!(await stuckHit(R1.orderId, Date.now()))) {
      pass('R1a. 新鲜 refunding 单不被对账误报 STUCK_REFUNDING（三分法「结果不可知」×30 分钟阈值组合）')
    } else {
      fail('R1a. fresh refunding misreported as STUCK')
    }
    guard(await stuckHit(R1.orderId, Date.now() + STUCK_AGE_MS), 'R1 链路: 超龄未被对账检出 STUCK（单点归属 verify:reconciliation）')
    const r1RefundId = `wxrfd_r1_${randomBytes(6).toString('hex')}`
    refundQueryByNo.set(R1.refundNo, { body: { status: 'SUCCESS', refund_id: r1RefundId } })
    await assertNoForeignPending('R1c 收敛前')
    const r1Stats = await refundService.convergeStalePendingRefunds({ limit: 100 })
    const r1Refund = await refundRow(R1.refundNo)
    if (
      r1Stats.scanned === 1 &&
      r1Stats.refunded === 1 &&
      r1Refund?.status === 'success' &&
      r1Refund.channelRefundNo === r1RefundId &&
      (await orderState(R1.orderId)).payStatus === 'refunded' &&
      (await auditCount('refund.created', R1.orderId)) === 1
    ) {
      pass('R1c. convergeStalePendingRefunds（cron 同一入口，scanned 恰 1）查证 SUCCESS 补完成 → refunded + refund.created 恰 1 条')
    } else {
      fail(`R1c. cron convergence failed: ${JSON.stringify({ r1Stats, status: r1Refund?.status })}`)
    }
    if (!(await stuckHit(R1.orderId, Date.now() + STUCK_AGE_MS)) && (await discrepancyCodes(R1.orderId, Date.now())).length === 0) {
      pass('R1d. 收敛后对账复核：STUCK 清零且本单无任何差异残留')
    } else {
      fail('R1d. post-convergence reconciliation still dirty')
    }

    // ══ R2 渠道明确失败 → 对账不残留 → 同号重试后仍零差异 ═══════════════════
    const R2 = await makePaidOrder('r2')
    refundCreateByNo.set(R2.refundNo, { httpStatus: 400 })
    await expectCodeGuard('REFUND_CHANNEL_FAILED', 'R2 setup: 渠道 4xx 明确拒绝（单点归属 verify:refund-real-channels）', () =>
      refundService.refund(R2.orderId, { reason: '用户申请退款' }),
    )
    const r2Codes = await discrepancyCodes(R2.orderId, Date.now() + STUCK_AGE_MS)
    if ((await orderState(R2.orderId)).payStatus === 'paid' && r2Codes.length === 0) {
      pass('R2b. 明确失败回滚 paid 后：即使超龄视角，对账零 STUCK/差异残留（failed ≠ stuck）')
    } else {
      fail(`R2b. rollback left reconciliation residue: ${JSON.stringify(r2Codes)}`)
    }
    const r2RefundId = `wxrfd_r2_${randomBytes(6).toString('hex')}`
    refundCreateByNo.set(R2.refundNo, { body: { status: 'SUCCESS', refund_id: r2RefundId } })
    const r2Retry = await refundService.refund(R2.orderId, { reason: '重试退款', operatorId: 'verify-admin' })
    if (
      r2Retry.refund.status === 'success' &&
      lastRefundCreate?.['out_refund_no'] === R2.refundNo &&
      (await orderState(R2.orderId)).payStatus === 'refunded' &&
      (await discrepancyCodes(R2.orderId, Date.now())).length === 0
    ) {
      pass('R2c. 同号重试成功 → refunded 且对账零差异（同 out_refund_no 渠道幂等 × 对账口径组合）')
    } else {
      fail('R2c. retry-after-failure chain broken')
    }

    // ══ R3 退款通知完成 × 批量收敛互斥（不重复出款）═════════════════════════
    const R3 = await makePaidOrder('r3')
    const r3RefundId = `wxrfd_r3_${randomBytes(6).toString('hex')}`
    refundCreateByNo.set(R3.refundNo, { body: { status: 'PROCESSING', refund_id: r3RefundId } })
    await refundService.refund(R3.orderId, { reason: '用户申请退款' })
    guard((await refundRow(R3.refundNo))?.status === 'pending', 'R3 setup: PROCESSING 未形成 pending')
    const r3Notify = buildRefundNotify({
      mchid: WX_MCHID,
      out_trade_no: R3.attemptId,
      out_refund_no: R3.refundNo,
      refund_id: r3RefundId,
      refund_status: 'SUCCESS',
      amount: { refund: R3.amountCents, total: R3.amountCents },
    })
    await refundService.processWechatRefundNotify(r3Notify.rawBody, r3Notify.headers)
    guard(
      (await refundRow(R3.refundNo))?.status === 'success' && (await orderState(R3.orderId)).payStatus === 'refunded',
      'R3 链路: 退款通知未完成 pending 单（单点归属 verify:wechat-refund-notify）',
    )
    await assertNoForeignPending('R3d 收敛前')
    const r3GatewayBefore = gatewayRequestCount
    const r3Stats = await refundService.convergeStalePendingRefunds({ limit: 100 })
    if (
      r3Stats.scanned === 0 &&
      gatewayRequestCount === r3GatewayBefore &&
      (await auditCount('refund.created', R3.orderId)) === 1
    ) {
      pass('R3d. 通知完成后批量收敛零扫描、零渠道请求、不重复入账（通知/查证两条完成路径互斥幂等）')
    } else {
      fail(`R3d. convergence after notify not inert: ${JSON.stringify(r3Stats)}`)
    }

<<<<<<< HEAD
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
>>>>>>> c2ea58d1 (feat(payment): C5-6 退款端到端回归门禁 + 对账/异常退款 SOP + FREE_MODE 决策记录)
=======
    console.log(`\n✅ ALL PASS（${passCount} 项组合断言 + 链路静默守卫）— C5-6 微信退款端到端组合回归通过\n`)
>>>>>>> 5f9fc980 (fix(payment): C5-6 回归门禁按复审收缩为方案 B + 隔离加固 + SOP 校准)
  } finally {
    await cleanup()
    await prisma.onModuleDestroy()
  }
}

main().catch((e) => {
<<<<<<< HEAD
<<<<<<< HEAD
  console.error(e)
=======
  console.error('  FAIL uncaught:', e)
>>>>>>> c2ea58d1 (feat(payment): C5-6 退款端到端回归门禁 + 对账/异常退款 SOP + FREE_MODE 决策记录)
=======
  console.error(e instanceof VerifyFailure ? e.message : `  FAIL uncaught: ${String(e)}`)
>>>>>>> 5f9fc980 (fix(payment): C5-6 回归门禁按复审收缩为方案 B + 隔离加固 + SOP 校准)
  process.exit(1)
})
