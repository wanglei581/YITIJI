/**
 * C5-6 真实渠道（wechat / alipay）+ paid-before-claim 门禁 verification
 * （verify:payment-real-channels）。
 *
 * 手段：本地生成 RSA 密钥对模拟「渠道侧」（微信支付公钥 / 支付宝公钥的私钥半边只存在于
 * 本脚本内存），并起本地假网关承接下单/查单请求 —— Provider 走与生产完全相同的
 * 签名/验签/解密/解析代码路径；**不依赖真实商户凭证、不产生真实资金交易**。
 *
 * 断言全表（对齐 C5-6 任务验收重点）：
 * - 多通道注册表：双通道时出码必须显式选通道；未启用通道拒绝；availableChannels 如实。
 * - wechat 下单：out_trade_no=attemptId、attach 回带 orderId、amount.total=分、notify_url 规范路径。
 * - wechat 回调：错签名/过期时间戳/serial 不符/APIv3 解密失败/跨商户 → 401；金额篡改 → 400 且订单不动；
 *   不存在的 out_trade_no → 拒；USERPAYING 中间态 → 只 ack 不改状态；成功 → paid+paymentSource=wechat；
 *   同流水号重复回调幂等（不重复审计）；同 nonce 重放 401；成功后失败回调不回退。
 * - alipay notify：RSA2 验签、app_id 归属、notify_id 防重放、金额元↔分整数换算、
 *   WAIT_BUYER_PAY 只 ack、TRADE_SUCCESS 入账、TRADE_CLOSED 失败落库且安全文案、ack 为纯文本 success。
 * - 回调/查单**绝不改 PrintTask.status**（支付域与打印域解耦）。
 * - paid-before-claim（服务端门禁，不信任 Kiosk/Agent 上报）：unpaid 不 claim（返回空、任务保持
 *   pending、不产生出纸任务）；paid 才 claim；门禁开关行为对照。
 * - reconcile 主动查单：渠道账本 paid+金额一致才入账（同一幂等路径+审计）；金额不符拒绝；
 *   pending 不改状态；最小间隔限流；缺 session token 拒绝。
 */
process.env['TERMINAL_ADMIN_SECRET'] ||= 'verify-realpay-terminal-admin-secret-0123456789'
process.env['TERMINAL_ACTION_TOKEN_SECRET'] ||= 'verify-realpay-terminal-action-secret-0123456789'
process.env['FILE_SIGNING_SECRET'] ||= 'verify-realpay-file-signing-secret-0123456789abcd'
process.env['PAYMENT_SESSION_SECRET'] ||= 'verify-realpay-payment-session-secret-0123456789'
process.env['PRINT_REQUIRE_PAID_BEFORE_CLAIM'] = 'true'
if (process.env['NODE_ENV'] === 'production') {
  console.error('  FAIL verify:payment-real-channels 不得在 NODE_ENV=production 运行')
  process.exit(1)
}

import 'dotenv/config'
import express from 'express'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import { createSign, generateKeyPairSync, randomBytes, randomUUID } from 'crypto'
import { AuditService } from '../src/audit/audit.service'
import { installBodyParsers } from '../src/config/body-parsers'
import { OnlinePaymentService } from '../src/payment/online-payment.service'
import { OrderStatusService } from '../src/payment/order-status.service'
import { PaymentProviderRegistry } from '../src/payment/payment-provider.factory'
import { buildPaymentCallbackPath } from '../src/payment/payment-provider.types'
import { PricingService } from '../src/payment/pricing.service'
import { seedDevDefaultPriceConfig } from '../src/payment/price-config.seed'
import {
  AlipayProvider,
  alipayTimestamp,
  buildAlipaySignBase,
  centsToYuan,
  yuanToCents,
} from '../src/payment/providers/alipay.provider'
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
import { TerminalToolboxService } from '../src/terminals/terminal-toolbox.service'
import { signFileUrl } from '../src/files/signing'
import { LOCAL_BUCKET_SENTINEL } from '../src/storage/storage.interface'
import { StorageService } from '../src/storage/storage.service'
import { TerminalsService } from '../src/terminals/terminals.service'
import { TerminalAgentService } from '../src/terminals/terminals-agent.service'
import { TerminalAdminService } from '../src/terminals/terminals-admin.service'

// ── 断言基建 ────────────────────────────────────────────────────────────────
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

// ── 渠道侧密钥（仅本脚本内存；私钥半边绝不落库/落盘）────────────────────────
function rsaPair(): { privateKey: string; publicKey: string } {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  })
  return { privateKey, publicKey }
}
const mchKeys = rsaPair() // 「商户」API 私钥（请求签名）
const wxPlatformKeys = rsaPair() // 「微信支付平台」（回调签名 ↔ 验签公钥）
const aliAppKeys = rsaPair() // 「支付宝应用」私钥（请求签名）
const aliPlatformKeys = rsaPair() // 「支付宝平台」（响应/notify 签名 ↔ 验签公钥）
const APIV3_KEY = randomBytes(16).toString('hex') // 32 chars
const WX_MCHID = '1900000001'
const WX_APPID = 'wx0000000000000001'
const WX_SERIAL = 'PUB_KEY_ID_VERIFY_0001'
const ALI_APP_ID = '2021000000000001'
const NOTIFY_BASE = 'https://kiosk-pay.verify.test'

// ── 本地假网关（渠道侧下单/查单账本）────────────────────────────────────────
interface CapturedWechatCreate {
  out_trade_no?: string
  notify_url?: string
  attach?: string
  time_expire?: string
  amount?: { total?: number }
  authHeader?: string
}
let lastWechatCreate: CapturedWechatCreate | null = null
let lastAlipayPrecreateBiz: Record<string, unknown> | null = null
let lastAlipayCodePayBiz: Record<string, unknown> | null = null
let wechatQueryResponse: Record<string, unknown> = { trade_state: 'NOTPAY' }
let alipayQueryNode: Record<string, unknown> = { code: '10000', msg: 'Success', trade_status: 'WAIT_BUYER_PAY' }
let alipayCodePayNode: Record<string, unknown> | null = null
let wechatCloseCalls = 0
let alipayCloseCalls = 0

/** 微信 Native 文档要求秒级 RFC3339 + 明确时区；允许因去毫秒产生不足 1 秒的差异。 */
function isWechatNativeExpiry(value: string | undefined, expectedExpiresAt: string): boolean {
  if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/.test(value)) return false
  const actual = Date.parse(value)
  const expected = Date.parse(expectedExpiresAt)
  return Number.isFinite(actual) && Number.isFinite(expected) && Math.abs(actual - expected) < 1_000
}

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
      const url = req.url ?? ''
      const body = await readBody(req)
      if (req.method === 'POST' && url === '/v3/pay/transactions/native') {
        const parsed = JSON.parse(body) as CapturedWechatCreate & Record<string, unknown>
        lastWechatCreate = { ...parsed, authHeader: String(req.headers['authorization'] ?? '') }
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ code_url: `weixin://wxpay/bizpayurl?pr=vrf_${randomBytes(4).toString('hex')}` }))
        return
      }
      if (req.method === 'POST' && url.startsWith('/v3/pay/transactions/out-trade-no/') && url.endsWith('/close')) {
        wechatCloseCalls += 1
        res.writeHead(204)
        res.end()
        return
      }
      if (req.method === 'GET' && url.startsWith('/v3/pay/transactions/out-trade-no/')) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(wechatQueryResponse))
        return
      }
      if (req.method === 'POST' && url.startsWith('/alipay/gateway.do')) {
        const params = Object.fromEntries(new URLSearchParams(body))
        const method = params['method'] ?? ''
        if (method === 'alipay.trade.precreate') {
          lastAlipayPrecreateBiz = JSON.parse(params['biz_content'] ?? '{}') as Record<string, unknown>
          const node = {
            code: '10000',
            msg: 'Success',
            out_trade_no: (lastAlipayPrecreateBiz['out_trade_no'] as string) ?? '',
            qr_code: `https://qr.alipay.com/vrf_${randomBytes(4).toString('hex')}`,
          }
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(signAlipayResponse('alipay_trade_precreate_response', node))
          return
        }
        if (method === 'alipay.trade.pay') {
          lastAlipayCodePayBiz = JSON.parse(params['biz_content'] ?? '{}') as Record<string, unknown>
          const node = alipayCodePayNode ?? {
            code: '10000',
            msg: 'Success',
            out_trade_no: (lastAlipayCodePayBiz['out_trade_no'] as string) ?? '',
            trade_no: `alitxn_code_${randomBytes(6).toString('hex')}`,
            total_amount: (lastAlipayCodePayBiz['total_amount'] as string) ?? '',
          }
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(signAlipayResponse('alipay_trade_pay_response', node))
          return
        }
        if (method === 'alipay.trade.query') {
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(signAlipayResponse('alipay_trade_query_response', alipayQueryNode))
          return
        }
        if (method === 'alipay.trade.close') {
          const biz = JSON.parse(params['biz_content'] ?? '{}') as Record<string, unknown>
          alipayCloseCalls += 1
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(
            signAlipayResponse('alipay_trade_close_response', {
              code: '10000',
              msg: 'Success',
              out_trade_no: (biz['out_trade_no'] as string) ?? '',
            }),
          )
          return
        }
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

// ── 渠道侧回调构造 ──────────────────────────────────────────────────────────
const WX_CALLBACK_PATH = buildPaymentCallbackPath('wechat')
const ALI_CALLBACK_PATH = buildPaymentCallbackPath('alipay')

function buildWechatCallback(input: {
  txn: Record<string, unknown>
  timestampMs?: number
  nonce?: string
  serial?: string
  breakSignature?: boolean
  wrongApiV3Key?: boolean
}): { rawBody: Buffer; headers: Record<string, string> } {
  const resource = encryptWechatCallbackResource(
    JSON.stringify(input.txn),
    input.wrongApiV3Key ? randomBytes(16).toString('hex') : APIV3_KEY,
  )
  const rawBody = Buffer.from(
    JSON.stringify({ id: randomUUID(), event_type: 'TRANSACTION.SUCCESS', resource_type: 'encrypt-resource', resource }),
    'utf8',
  )
  const timestamp = String(Math.floor((input.timestampMs ?? Date.now()) / 1000))
  const nonce = input.nonce ?? randomBytes(16).toString('hex')
  let signature = createSign('RSA-SHA256')
    .update(buildWechatCallbackVerifyBase({ timestamp, nonce, rawBody }))
    .sign(wxPlatformKeys.privateKey, 'base64')
  if (input.breakSignature) signature = `AAAA${signature.slice(4)}`
  return {
    rawBody,
    headers: {
      [WECHAT_TIMESTAMP_HEADER]: timestamp,
      [WECHAT_NONCE_HEADER]: nonce,
      [WECHAT_SIGNATURE_HEADER]: signature,
      [WECHAT_SERIAL_HEADER]: input.serial ?? WX_SERIAL,
    },
  }
}

function wechatTxn(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    mchid: WX_MCHID,
    appid: WX_APPID,
    out_trade_no: 'MISSING',
    transaction_id: `wxtxn_${randomBytes(8).toString('hex')}`,
    trade_state: 'SUCCESS',
    trade_state_desc: '支付成功',
    amount: { total: 0, currency: 'CNY' },
    ...overrides,
  }
}

function buildAlipayNotify(input: {
  params: Record<string, string>
  breakSignature?: boolean
}): { rawBody: Buffer; headers: Record<string, string> } {
  const params: Record<string, string> = {
    notify_id: `ntf_${randomBytes(12).toString('hex')}`,
    notify_time: alipayTimestamp(),
    notify_type: 'trade_status_sync',
    app_id: ALI_APP_ID,
    charset: 'utf-8',
    version: '1.0',
    sign_type: 'RSA2',
    ...input.params,
  }
  let sign = createSign('RSA-SHA256')
    .update(buildAlipaySignBase(params, ['sign', 'sign_type']), 'utf8')
    .sign(aliPlatformKeys.privateKey, 'base64')
  if (input.breakSignature) sign = `AAAA${sign.slice(4)}`
  params['sign'] = sign
  return {
    rawBody: Buffer.from(new URLSearchParams(params).toString(), 'utf8'),
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
  console.log('\n=== C5-6 real payment channels (wechat/alipay) + paid-before-claim verification ===')

  // 纯函数金额换算（元串 ↔ 分整数，绝不浮点）
  if (
    yuanToCents('2.00') === 200 &&
    yuanToCents('0.01') === 1 &&
    yuanToCents('15') === 1500 &&
    yuanToCents('1.5') === 150 &&
    yuanToCents('1.234') === null &&
    yuanToCents('-1.00') === null &&
    yuanToCents('abc') === null &&
    centsToYuan(200) === '2.00' &&
    centsToYuan(1) === '0.01' &&
    centsToYuan(1500) === '15.00'
  ) {
    pass('yuan↔cents 字符串换算（拒绝超 2 位小数/负数/非数字）')
  } else {
    fail('yuan↔cents conversion mismatch')
  }

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
  const payment = new OnlinePaymentService(
    prisma,
    audit,
    orderStatus,
    new PaymentProviderRegistry([wechatProvider, alipayProvider]),
  )
  const terminals = (() => { const _ag = new TerminalAgentService(prisma, audit); return new TerminalsService(_ag, new TerminalAdminService(prisma, _ag, new TerminalToolboxService(prisma))) })()

  const suffix = randomUUID().replace(/-/g, '').slice(0, 12)
  const terminalId = `t_realpay_${suffix}`
  const agentToken = `agt_realpay_${suffix}`
  const taskIds: string[] = []
  const fixtureFileIds: string[] = []
  const fixtureStorageKeys: string[] = []

  async function seedPdfFixture(label: string, pages: number): Promise<string> {
    const fileId = `f_realpay_${suffix}_${label}`
    const storageKey = `verify/payment-real-channels/${fileId}.pdf`
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

  /** 建真实打印单（同事务建 Order），返回 orderId/taskId/paymentSessionToken。 */
  async function makePrintOrder(label: string): Promise<{ orderId: string; taskId: string; token: string; amountCents: number }> {
    const printed = await printJobs.create(
      {
        fileUrl: await seedPdfFixture(label, 2),
        fileMd5: `sha256-realpay-${label}`,
        fileName: `${label}.pdf`,
        params: PRINT_PARAMS,
      },
      { endUserId: null, terminalId },
    )
    taskIds.push(printed.taskId)
    const order = await prisma.order.findUnique({ where: { printTaskId: printed.taskId } })
    if (!order) fail(`makePrintOrder(${label}): Order missing`)
    if (!printed.paymentSessionToken) fail(`makePrintOrder(${label}): payment session token missing`)
    return { orderId: order.id, taskId: printed.taskId, token: printed.paymentSessionToken, amountCents: order.amountCents }
  }

  async function orderState(orderId: string): Promise<{ payStatus: string; paymentSource: string | null; payChannel: string | null; pickupCode: string | null }> {
    const o = await prisma.order.findUnique({ where: { id: orderId } })
    if (!o) fail('order missing')
    return { payStatus: o.payStatus, paymentSource: o.paymentSource, payChannel: o.payChannel, pickupCode: o.pickupCode }
  }

  async function taskStatus(taskId: string): Promise<string> {
    const t = await prisma.printTask.findUnique({ where: { id: taskId } })
    if (!t) fail('print task missing')
    return t.status
  }

  async function claimOnce(): Promise<string | null> {
    const res = await terminals.claimTasks(terminalId, { maxTasks: 1 }, `Bearer ${agentToken}`)
    return res[0]?.taskId ?? null
  }

  async function auditCount(action: string, targetId: string): Promise<number> {
    return prisma.auditLog.count({ where: { action, targetId } })
  }

  const cleanup = async (): Promise<void> => {
    await prisma.paymentAttempt.deleteMany({ where: { order: { is: { terminalId } } } })
    await prisma.auditLog.deleteMany({ where: { payload: { contains: suffix } } }).catch(() => ({ count: 0 }))
    await prisma.order.deleteMany({ where: { terminalId } })
    await prisma.printTask.deleteMany({ where: { id: { in: taskIds } } })
    await prisma.terminalHeartbeat.deleteMany({ where: { terminalId } })
    await prisma.terminal.deleteMany({ where: { id: terminalId } })
    await prisma.fileObject.deleteMany({ where: { id: { in: fixtureFileIds } } })
    for (const key of fixtureStorageKeys) {
      await storage.deleteObject(key, LOCAL_BUCKET_SENTINEL).catch(() => undefined)
    }
    server.close()
  }

  try {
    await prisma.terminal.create({
      data: { id: terminalId, terminalCode: `KSK-REALPAY-${suffix}`, agentToken, deviceFingerprint: 'verify-realpay' },
    })
    await terminals.heartbeat(
      terminalId,
      { status: 'online', printerStatus: 'ok', localTaskDatabaseAvailable: true, agentVersion: 'verify-realpay' },
      `Bearer ${agentToken}`,
    )
    await seedDevDefaultPriceConfig(prisma)
    pass('test fixtures created (terminal online + price config)')

    // ── (1) 多通道注册表 & 出码 ────────────────────────────────────────────
    if (JSON.stringify(payment.availableChannels().slice().sort()) === JSON.stringify(['alipay', 'wechat'])) {
      pass('availableChannels 如实返回 [wechat, alipay]')
    } else {
      fail(`availableChannels mismatch: ${payment.availableChannels().join(',')}`)
    }

    const A = await makePrintOrder('orderA')
    if (A.amountCents !== 200) fail(`expected 200 cents quote, got ${A.amountCents}`)

    await expectCode('双通道时未指定 channel 出码被拒（不替用户默认选资金通道）', 'PAY_CHANNEL_REQUIRED', () =>
      payment.createPayAttempt(A.orderId, A.token),
    )
    await expectCode('未启用通道（sandbox）出码被拒', 'PAY_CHANNEL_NOT_ENABLED', () =>
      payment.createPayAttempt(A.orderId, A.token, 'sandbox'),
    )
    await expectCode('非法通道名出码被拒', 'PAY_CHANNEL_INVALID', () =>
      payment.createPayAttempt(A.orderId, A.token, 'paypal'),
    )

    const attemptA = await payment.createPayAttempt(A.orderId, A.token, 'wechat')
    if (
      attemptA.channel === 'wechat' &&
      attemptA.status === 'pending' &&
      attemptA.qrCodeContent?.startsWith('weixin://wxpay/') &&
      attemptA.orderPayStatus === 'paying'
    ) {
      pass('wechat 出码：attempt pending + code_url 动态码 + 订单 paying')
    } else {
      fail(`wechat attempt mismatch: ${JSON.stringify(attemptA)}`)
    }
    if (
      lastWechatCreate?.out_trade_no === attemptA.attemptId &&
      lastWechatCreate?.amount?.total === 200 &&
      lastWechatCreate?.notify_url === `${NOTIFY_BASE}${WX_CALLBACK_PATH}` &&
      isWechatNativeExpiry(lastWechatCreate?.time_expire, attemptA.expiresAt) &&
      JSON.parse(lastWechatCreate?.attach ?? '{}')?.orderId === A.orderId &&
      lastWechatCreate?.authHeader?.startsWith('WECHATPAY2-SHA256-RSA2048 ')
    ) {
      pass('wechat 下单报文：out_trade_no=attemptId + attach 回带 orderId + 金额分 + time_expire + 规范 notify_url + APIv3 签名头')
    } else {
      fail(`wechat create payload mismatch: ${JSON.stringify(lastWechatCreate)}`)
    }

    const attemptA2 = await payment.createPayAttempt(A.orderId, A.token, 'wechat')
    if (attemptA2.attemptId === attemptA.attemptId) pass('同通道重复出码幂等复用未过期尝试')
    else fail('wechat attempt not reused')

    await expectCode('活动微信二维码阻断切换支付宝出码（禁止同单并行可扣款）', 'PAYMENT_ATTEMPT_PENDING', () =>
      payment.createPayAttempt(A.orderId, A.token, 'alipay'),
    )
    if (lastAlipayPrecreateBiz === null) pass('活动微信二维码时不向支付宝创建第二笔渠道订单')
    else fail(`alipay precreate must not run while wechat attempt is pending: ${JSON.stringify(lastAlipayPrecreateBiz)}`)

    // 到期屏上二维码必须先查单、再关单；真实 Provider 的请求字段也同步本服务截止时间。
    const expiryWechat = await makePrintOrder('orderExpiryWechat')
    const expiryWechatAttempt = await payment.createPayAttempt(expiryWechat.orderId, expiryWechat.token, 'wechat')
    const expiryWechatTime = lastWechatCreate?.time_expire
    const expiryAlipay = await makePrintOrder('orderExpiryAlipay')
    const expiryAlipayAttempt = await payment.createPayAttempt(expiryAlipay.orderId, expiryAlipay.token, 'alipay')
    const expiryAlipayTimeout = lastAlipayPrecreateBiz?.['timeout_express']
    await prisma.paymentAttempt.updateMany({
      where: { id: { in: [expiryWechatAttempt.attemptId, expiryAlipayAttempt.attemptId] } },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    })
    const releaseBeforeWechat = wechatCloseCalls
    const releaseBeforeAlipay = alipayCloseCalls
    const expiryRelease = await payment.releaseExpiredQrPayments({ limit: 10 })
    const expiryWechatState = await orderState(expiryWechat.orderId)
    const expiryAlipayState = await orderState(expiryAlipay.orderId)
    if (
      isWechatNativeExpiry(expiryWechatTime, expiryWechatAttempt.expiresAt) &&
      typeof expiryAlipayTimeout === 'string' &&
      /^\d+m$/.test(expiryAlipayTimeout) &&
      wechatCloseCalls === releaseBeforeWechat + 1 &&
      alipayCloseCalls === releaseBeforeAlipay + 1 &&
      expiryWechatState.payStatus === 'unpaid' &&
      expiryAlipayState.payStatus === 'unpaid' &&
      expiryRelease.released >= 2
    ) {
      pass('二维码到期：微信 time_expire、支付宝 timeout_express 已同步，查单后关单确认才释放订单')
    } else {
      fail(
        `screen QR expiry close mismatch: ${JSON.stringify({
          expiryWechatTime,
          expectedWechatExpiry: expiryWechatAttempt.expiresAt,
          expiryAlipayTimeout,
          wechatCloseCalls,
          releaseBeforeWechat,
          alipayCloseCalls,
          releaseBeforeAlipay,
          expiryWechatState,
          expiryAlipayState,
          expiryRelease,
        })}`,
      )
    }

    // ── (2) paid-before-claim：unpaid 绝不出纸 ────────────────────────────
    if ((await claimOnce()) === null && (await taskStatus(A.taskId)) === 'pending') {
      pass('unpaid 订单：claim 返回空 + 任务保持 pending（不产生出纸任务）')
    } else {
      fail('unpaid task was claimable or status changed')
    }

    // ── (2b) alipay 付款码支付：同步成功 / 未决 / 明确失败 ──────────────
    const alipayAuthCode = '251234567890123456'
    const codeSuccess = await makePrintOrder('orderAlipayCodeSuccess')
    alipayCodePayNode = null
    lastAlipayCodePayBiz = null
    const codeSuccessResult = await payment.createCodePayAttempt(codeSuccess.orderId, codeSuccess.token, alipayAuthCode, 'alipay')
    const codeSuccessState = await orderState(codeSuccess.orderId)
    if (
      codeSuccessResult.status === 'success' &&
      codeSuccessState.payStatus === 'paid' &&
      codeSuccessState.paymentSource === 'alipay' &&
      lastAlipayCodePayBiz?.['scene'] === 'bar_code' &&
      lastAlipayCodePayBiz?.['auth_code'] === alipayAuthCode &&
      lastAlipayCodePayBiz?.['total_amount'] === '2.00' &&
      lastAlipayCodePayBiz?.['timeout_express'] === '5m'
    ) {
      pass('alipay 付款码同步成功：bar_code + 18 位付款码 + 金额校验后入账')
    } else {
      fail('alipay codepay success flow did not create a verified paid order')
    }
    if ((await claimOnce()) === codeSuccess.taskId) pass('alipay 付款码已入账订单可被领取')
    else fail('alipay codepay paid task not claimable')

    const codeUserPaying = await makePrintOrder('orderAlipayCodeUserPaying')
    alipayCodePayNode = { code: '10003', msg: 'Waiting', sub_code: 'ACQ.USERPAYING' }
    const codeUserPayingResult = await payment.createCodePayAttempt(codeUserPaying.orderId, codeUserPaying.token, alipayAuthCode, 'alipay')
    const codeUserPayingState = await orderState(codeUserPaying.orderId)
    if (codeUserPayingResult.status === 'paying' && codeUserPayingState.payStatus === 'paying') {
      pass('alipay 付款码 USERPAYING 保持待核实，禁止回退后重复扣款')
    } else {
      fail('alipay USERPAYING was not kept pending')
    }
    const codeUserPayingAttempt = await prisma.paymentAttempt.findUnique({ where: { id: codeUserPayingResult.attemptId } })
    if (!codeUserPayingAttempt) fail('missing alipay USERPAYING attempt')
    alipayQueryNode = { code: '10000', msg: 'Success', out_trade_no: codeUserPayingAttempt.id, trade_status: 'TRADE_CLOSED' }
    await payment.reconcilePayment(codeUserPaying.orderId, codeUserPaying.token)
    if ((await orderState(codeUserPaying.orderId)).payStatus === 'unpaid') pass('alipay 付款码待核实订单经查单关单后回到 unpaid')
    else fail('alipay USERPAYING close reconciliation did not release the order')

    const codeRejected = await makePrintOrder('orderAlipayCodeRejected')
    alipayCodePayNode = { code: '40004', msg: 'Business Failed', sub_code: 'ACQ.PAYMENT_AUTH_CODE_INVALID' }
    const codeRejectedResult = await payment.createCodePayAttempt(codeRejected.orderId, codeRejected.token, alipayAuthCode, 'alipay')
    if (codeRejectedResult.status === 'failed' && (await orderState(codeRejected.orderId)).payStatus === 'unpaid') {
      pass('alipay 付款码明确失败才释放订单重试')
    } else {
      fail('alipay explicit codepay failure did not release the order')
    }

    const codeBusinessUnknown = await makePrintOrder('orderAlipayCodeBusinessUnknown')
    alipayCodePayNode = { code: '40004', msg: 'Business Failed', sub_code: 'ACQ.SYSTEM_ERROR' }
    const codeBusinessUnknownResult = await payment.createCodePayAttempt(codeBusinessUnknown.orderId, codeBusinessUnknown.token, alipayAuthCode, 'alipay')
    if (codeBusinessUnknownResult.status === 'paying' && (await orderState(codeBusinessUnknown.orderId)).payStatus === 'paying') {
      pass('alipay 未知 40004 子码保持待核实，禁止以业务总码误放开重扫')
    } else {
      fail('alipay unknown 40004 sub-code was incorrectly released')
    }
    const codeBusinessUnknownAttempt = await prisma.paymentAttempt.findUnique({ where: { id: codeBusinessUnknownResult.attemptId } })
    if (!codeBusinessUnknownAttempt) fail('missing alipay unknown-business attempt')
    alipayQueryNode = { code: '10000', msg: 'Success', out_trade_no: codeBusinessUnknownAttempt.id, trade_status: 'TRADE_CLOSED' }
    await payment.reconcilePayment(codeBusinessUnknown.orderId, codeBusinessUnknown.token)
    if ((await orderState(codeBusinessUnknown.orderId)).payStatus === 'unpaid') pass('alipay 未知 40004 子码经查单关单后回到 unpaid')
    else fail('alipay unknown 40004 close reconciliation did not release the order')

    const codeUnknown = await makePrintOrder('orderAlipayCodeUnknown')
    alipayCodePayNode = { code: '20000', msg: 'Service Currently Unavailable' }
    const codeUnknownResult = await payment.createCodePayAttempt(codeUnknown.orderId, codeUnknown.token, alipayAuthCode, 'alipay')
    if (codeUnknownResult.status === 'paying' && (await orderState(codeUnknown.orderId)).payStatus === 'paying') {
      pass('alipay 付款码网关结果不可知时保持待核实')
    } else {
      fail('alipay unknown codepay result was incorrectly released')
    }
    const codeUnknownAttempt = await prisma.paymentAttempt.findUnique({ where: { id: codeUnknownResult.attemptId } })
    if (!codeUnknownAttempt) fail('missing alipay unknown attempt')
    alipayQueryNode = { code: '10000', msg: 'Success', out_trade_no: codeUnknownAttempt.id, trade_status: 'TRADE_CLOSED' }
    await payment.reconcilePayment(codeUnknown.orderId, codeUnknown.token)
    if ((await orderState(codeUnknown.orderId)).payStatus === 'unpaid') pass('alipay 不可知付款码订单经查单关单后回到 unpaid')
    else fail('alipay unknown codepay close reconciliation did not release the order')
    alipayCodePayNode = null

    const priorNodeEnv = process.env['NODE_ENV']
    const priorAutoConverge = process.env['PAYMENT_CODEPAY_AUTO_CONVERGE_ENABLED']
    try {
      process.env['NODE_ENV'] = 'production'
      delete process.env['PAYMENT_CODEPAY_AUTO_CONVERGE_ENABLED']
      lastAlipayCodePayBiz = null
      const productionRejected = await alipayProvider.createCodePayment({
        orderId: 'order-production-guard',
        orderNo: 'ORD-PRODUCTION-GUARD',
        attemptId: 'attempt-production-guard',
        terminalId: 'terminal-production-guard',
        amountCents: 200,
        authCode: alipayAuthCode,
      })
      if (productionRejected.status === 'failed' && lastAlipayCodePayBiz === null) {
        pass('生产环境未显式启用自动核验时支付宝付款码不会发起渠道扣款')
      } else {
        fail('alipay production codepay guard did not block the channel request')
      }
    } finally {
      if (priorNodeEnv === undefined) delete process.env['NODE_ENV']
      else process.env['NODE_ENV'] = priorNodeEnv
      if (priorAutoConverge === undefined) delete process.env['PAYMENT_CODEPAY_AUTO_CONVERGE_ENABLED']
      else process.env['PAYMENT_CODEPAY_AUTO_CONVERGE_ENABLED'] = priorAutoConverge
    }

    // ── (3) wechat 回调安全 ───────────────────────────────────────────────
    const okTxn = (over: Record<string, unknown> = {}) =>
      wechatTxn({
        out_trade_no: attemptA.attemptId,
        attach: JSON.stringify({ orderId: A.orderId }),
        amount: { total: 200, currency: 'CNY' },
        ...over,
      })

    await expectCode('wechat 错签名 → 401', 'CALLBACK_SIGNATURE_INVALID', async () => {
      const cb = buildWechatCallback({ txn: okTxn(), breakSignature: true })
      await payment.processCallback('wechat', cb.rawBody, cb.headers)
    })
    await expectCode('wechat 过期时间戳 → 401', 'CALLBACK_TIMESTAMP_EXPIRED', async () => {
      const cb = buildWechatCallback({ txn: okTxn(), timestampMs: Date.now() - 6 * 60 * 1000 })
      await payment.processCallback('wechat', cb.rawBody, cb.headers)
    })
    await expectCode('wechat serial 不符配置公钥 ID → 401', 'CALLBACK_SERIAL_MISMATCH', async () => {
      const cb = buildWechatCallback({ txn: okTxn(), serial: 'PUB_KEY_ID_OTHER' })
      await payment.processCallback('wechat', cb.rawBody, cb.headers)
    })
    await expectCode('wechat APIv3 密钥不符（解密失败）→ 401', 'CALLBACK_RESOURCE_DECRYPT_FAILED', async () => {
      const cb = buildWechatCallback({ txn: okTxn(), wrongApiV3Key: true })
      await payment.processCallback('wechat', cb.rawBody, cb.headers)
    })
    await expectCode('wechat 跨商户报文（mchid 不符）→ 401', 'CALLBACK_MERCHANT_MISMATCH', async () => {
      const cb = buildWechatCallback({ txn: okTxn({ mchid: '1900009999' }) })
      await payment.processCallback('wechat', cb.rawBody, cb.headers)
    })
    await expectCode('wechat 金额篡改 → 400 AMOUNT_MISMATCH', 'CALLBACK_AMOUNT_MISMATCH', async () => {
      const cb = buildWechatCallback({ txn: okTxn({ amount: { total: 1, currency: 'CNY' } }) })
      await payment.processCallback('wechat', cb.rawBody, cb.headers)
    })
    await expectCode('wechat 不存在的 out_trade_no → 拒', 'CALLBACK_ATTEMPT_NOT_FOUND', async () => {
      const fakeId = `pa_none_${randomBytes(6).toString('hex')}`
      const cb = buildWechatCallback({ txn: okTxn({ out_trade_no: fakeId }) })
      await payment.processCallback('wechat', cb.rawBody, cb.headers)
    })
    if ((await orderState(A.orderId)).payStatus === 'paying' && (await taskStatus(A.taskId)) === 'pending') {
      pass('全部非法回调后订单仍 paying、PrintTask 仍 pending（未被污染）')
    } else {
      fail('order/task polluted by rejected callbacks')
    }

    const ignoredCb = buildWechatCallback({ txn: okTxn({ trade_state: 'USERPAYING' }) })
    const ignoredRes = await payment.processCallback('wechat', ignoredCb.rawBody, ignoredCb.headers)
    const attemptAState = await prisma.paymentAttempt.findUnique({ where: { id: attemptA.attemptId } })
    if (ignoredRes.ok && ignoredRes.idempotent && attemptAState?.status === 'pending') {
      pass('wechat USERPAYING 中间态：只 ack 不改状态（绝不误判失败）')
    } else {
      fail(`USERPAYING mishandled: ${JSON.stringify({ ignoredRes, status: attemptAState?.status })}`)
    }

    // 成功入账
    const wxTxnNo = `wxtxn_ok_${randomBytes(6).toString('hex')}`
    const successCb = buildWechatCallback({ txn: okTxn({ transaction_id: wxTxnNo }) })
    const successRes = await payment.processCallback('wechat', successCb.rawBody, successCb.headers)
    const paidA = await orderState(A.orderId)
    if (
      successRes.ok &&
      paidA.payStatus === 'paid' &&
      paidA.paymentSource === 'wechat' &&
      paidA.payChannel === 'wechat' &&
      Boolean(paidA.pickupCode)
    ) {
      pass('wechat 成功回调：paid + paymentSource=wechat + payChannel + pickupCode')
    } else {
      fail(`wechat success mishandled: ${JSON.stringify(paidA)}`)
    }
    if (JSON.parse(String(successRes.ack?.body ?? '{}'))?.code === 'SUCCESS') {
      pass('wechat 成功应答为 {code:SUCCESS} JSON')
    } else {
      fail(`wechat ack mismatch: ${JSON.stringify(successRes.ack)}`)
    }
    if ((await taskStatus(A.taskId)) === 'pending') {
      pass('支付回调不改 PrintTask.status（仍 pending，等 Agent claim）')
    } else {
      fail('callback touched PrintTask.status')
    }
    const auditAfterPaid = await auditCount('order.mark_paid_online', A.orderId)
    if (auditAfterPaid === 1) pass('入账审计 order.mark_paid_online 恰好 1 条')
    else fail(`unexpected mark_paid_online audit count: ${auditAfterPaid}`)

    // 幂等（同流水号新报文）与防重放（同 nonce）
    const dupCb = buildWechatCallback({ txn: okTxn({ transaction_id: wxTxnNo }) })
    const dupRes = await payment.processCallback('wechat', dupCb.rawBody, dupCb.headers)
    if (dupRes.ok && dupRes.idempotent && (await auditCount('order.mark_paid_online', A.orderId)) === 1) {
      pass('同渠道流水号重复回调幂等（不重复入账/审计）')
    } else {
      fail('duplicate wechat callback not idempotent')
    }
    await expectCode('同 nonce 重放 → 401 CALLBACK_REPLAY', 'CALLBACK_REPLAY', async () => {
      await payment.processCallback('wechat', dupCb.rawBody, dupCb.headers)
    })
    await expectCode('入账后异流水号成功回调 → 冲突拒绝', 'CALLBACK_TXN_CONFLICT', async () => {
      const cb = buildWechatCallback({ txn: okTxn({ transaction_id: 'wxtxn_conflict_01' }) })
      await payment.processCallback('wechat', cb.rawBody, cb.headers)
    })
    await expectCode('成功后到达的失败回调绝不回退', 'CALLBACK_STATE_CONFLICT', async () => {
      const cb = buildWechatCallback({ txn: okTxn({ trade_state: 'PAYERROR', transaction_id: wxTxnNo }) })
      await payment.processCallback('wechat', cb.rawBody, cb.headers)
    })
    if ((await orderState(A.orderId)).payStatus === 'paid') pass('订单保持 paid 不被回退')
    else fail('paid order was rolled back')

    // ── (4) paid 后才可 claim ─────────────────────────────────────────────
    const claimedA = await claimOnce()
    if (claimedA === A.taskId && (await taskStatus(A.taskId)) === 'claimed') {
      pass('paid 订单任务被 claim（服务端读 Order.payStatus，不信任客户端）')
    } else {
      fail(`paid task not claimable: ${claimedA}`)
    }

    // ── (5) alipay notify 全链路 ─────────────────────────────────────────
    const B = await makePrintOrder('orderB')
    const attemptB = await payment.createPayAttempt(B.orderId, B.token, 'alipay')

    const aliParams = (over: Record<string, string> = {}): Record<string, string> => ({
      out_trade_no: attemptB.attemptId,
      trade_no: `alitxn_${randomBytes(8).toString('hex')}`,
      trade_status: 'TRADE_SUCCESS',
      total_amount: '2.00',
      passback_params: encodeURIComponent(JSON.stringify({ orderId: B.orderId })),
      ...over,
    })

    await expectCode('alipay 错签名 → 401', 'CALLBACK_SIGNATURE_INVALID', async () => {
      const cb = buildAlipayNotify({ params: aliParams(), breakSignature: true })
      await payment.processCallback('alipay', cb.rawBody, cb.headers)
    })
    await expectCode('alipay 过期 notify_time → 401', 'CALLBACK_TIMESTAMP_EXPIRED', async () => {
      const cb = buildAlipayNotify({
        params: { ...aliParams(), notify_time: alipayTimestamp(new Date(Date.now() - 6 * 60 * 1000)) },
      })
      await payment.processCallback('alipay', cb.rawBody, cb.headers)
    })
    await expectCode('alipay 跨应用报文（app_id 不符）→ 401', 'CALLBACK_MERCHANT_MISMATCH', async () => {
      const cb = buildAlipayNotify({ params: { ...aliParams(), app_id: '2021000000009999' } })
      await payment.processCallback('alipay', cb.rawBody, cb.headers)
    })
    await expectCode('alipay 金额篡改（0.01 元）→ 400', 'CALLBACK_AMOUNT_MISMATCH', async () => {
      const cb = buildAlipayNotify({ params: aliParams({ total_amount: '0.01' }) })
      await payment.processCallback('alipay', cb.rawBody, cb.headers)
    })

    const waitCb = buildAlipayNotify({ params: aliParams({ trade_status: 'WAIT_BUYER_PAY' }) })
    const waitRes = await payment.processCallback('alipay', waitCb.rawBody, waitCb.headers)
    const attemptBWait = await prisma.paymentAttempt.findUnique({ where: { id: attemptB.attemptId } })
    if (waitRes.ok && waitRes.idempotent && attemptBWait?.status === 'pending' && waitRes.ack?.body === 'success') {
      pass('alipay WAIT_BUYER_PAY：只 ack（纯文本 success）不改状态')
    } else {
      fail(`WAIT_BUYER_PAY mishandled: ${JSON.stringify({ waitRes, status: attemptBWait?.status })}`)
    }

    const aliTxnNo = `alitxn_ok_${randomBytes(6).toString('hex')}`
    const aliOkCb = buildAlipayNotify({ params: aliParams({ trade_no: aliTxnNo }) })
    const aliOkRes = await payment.processCallback('alipay', aliOkCb.rawBody, aliOkCb.headers)
    const paidB = await orderState(B.orderId)
    if (
      aliOkRes.ok &&
      aliOkRes.ack?.body === 'success' &&
      aliOkRes.ack?.contentType === 'text/plain' &&
      paidB.payStatus === 'paid' &&
      paidB.paymentSource === 'alipay' &&
      (await taskStatus(B.taskId)) === 'pending'
    ) {
      pass('alipay TRADE_SUCCESS：paid + paymentSource=alipay + ack=success + PrintTask 不受影响')
    } else {
      fail(`alipay success mishandled: ${JSON.stringify({ aliOkRes, paidB })}`)
    }
    const aliDupCb = buildAlipayNotify({ params: aliParams({ trade_no: aliTxnNo }) })
    const aliDupRes = await payment.processCallback('alipay', aliDupCb.rawBody, aliDupCb.headers)
    if (aliDupRes.ok && aliDupRes.idempotent && (await auditCount('order.mark_paid_online', B.orderId)) === 1) {
      pass('alipay 重复通知（同 trade_no 新 notify_id）幂等')
    } else {
      fail('duplicate alipay notify not idempotent')
    }
    await expectCode('alipay 同 notify_id 重放 → 401 CALLBACK_REPLAY', 'CALLBACK_REPLAY', async () => {
      await payment.processCallback('alipay', aliDupCb.rawBody, aliDupCb.headers)
    })
    if ((await claimOnce()) === B.taskId) pass('alipay paid 后任务可 claim')
    else fail('alipay paid task not claimable')

    // TRADE_CLOSED：pending 尝试失败落库（安全文案）+ 订单回 unpaid 可重试
    const C = await makePrintOrder('orderC')
    const attemptC = await payment.createPayAttempt(C.orderId, C.token, 'alipay')
    const closedCb = buildAlipayNotify({
      params: {
        out_trade_no: attemptC.attemptId,
        trade_no: `alitxn_closed_${randomBytes(6).toString('hex')}`,
        trade_status: 'TRADE_CLOSED',
        total_amount: '2.00',
        passback_params: encodeURIComponent(JSON.stringify({ orderId: C.orderId })),
      },
    })
    await payment.processCallback('alipay', closedCb.rawBody, closedCb.headers)
    const attemptCState = await prisma.paymentAttempt.findUnique({ where: { id: attemptC.attemptId } })
    const orderCState = await orderState(C.orderId)
    if (
      attemptCState?.status === 'failed' &&
      attemptCState.failReason === '支付未完成，请重新发起支付' &&
      orderCState.payStatus === 'unpaid'
    ) {
      pass('alipay TRADE_CLOSED：尝试 failed（安全文案，不透传渠道原文）+ 订单回 unpaid 可重试')
    } else {
      fail(`TRADE_CLOSED mishandled: ${JSON.stringify({ attemptCState, orderCState })}`)
    }

    // ── (5b) 真实 HTTP 栈回调入口（body-parser 装配守护，C5-6 双模型审查修复项）────
    // 用与生产 main.ts 完全相同的 installBodyParsers（json + urlencoded 均挂 rawBody verify）
    // 起真实 express 服务：alipay form-urlencoded / wechat json 回调都必须在 HTTP 层拿到
    // rawBody 并成功验签入账 —— 堵住「service 级测试绕过 body-parser 掩盖生产装配缺口」。
    const httpApp = express()
    installBodyParsers(httpApp)
    httpApp.post('/api/v1/payment/callback/:channel', (req, res) => {
      void (async () => {
        try {
          const result = await payment.processCallback(
            req.params['channel'] as string,
            (req as { rawBody?: Buffer }).rawBody,
            req.headers as Record<string, string | string[] | undefined>,
          )
          if (result.ack) res.set('content-type', result.ack.contentType).send(result.ack.body)
          else res.json({ ok: true })
        } catch (e) {
          res.status(400).send((e as Error).message)
        }
      })()
    })
    const httpEntry: Server = await new Promise((resolve) => {
      const s = httpApp.listen(0, '127.0.0.1', () => resolve(s))
    })
    const entryAddr = httpEntry.address()
    const entryPort = typeof entryAddr === 'object' && entryAddr ? entryAddr.port : 0
    try {
      // alipay：form-urlencoded 经真实 HTTP 栈入账
      const IA = await makePrintOrder('orderHttpAli')
      const attemptIA = await payment.createPayAttempt(IA.orderId, IA.token, 'alipay')
      const httpAliCb = buildAlipayNotify({
        params: {
          out_trade_no: attemptIA.attemptId,
          trade_no: `alitxn_http_${randomBytes(6).toString('hex')}`,
          trade_status: 'TRADE_SUCCESS',
          total_amount: '2.00',
          passback_params: encodeURIComponent(JSON.stringify({ orderId: IA.orderId })),
        },
      })
      const aliHttpRes = await fetch(`http://127.0.0.1:${entryPort}${ALI_CALLBACK_PATH}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: httpAliCb.rawBody,
      })
      const aliHttpText = await aliHttpRes.text()
      if (aliHttpRes.status === 200 && aliHttpText === 'success' && (await orderState(IA.orderId)).payStatus === 'paid') {
        pass('HTTP 栈 alipay form-urlencoded 回调：rawBody 捕获 + 验签入账 + 纯文本 success 应答')
      } else {
        fail(`HTTP alipay callback failed: ${aliHttpRes.status} ${aliHttpText}`)
      }

      // wechat：json 经真实 HTTP 栈入账
      const IW = await makePrintOrder('orderHttpWx')
      const attemptIW = await payment.createPayAttempt(IW.orderId, IW.token, 'wechat')
      const httpWxCb = buildWechatCallback({
        txn: wechatTxn({
          out_trade_no: attemptIW.attemptId,
          attach: JSON.stringify({ orderId: IW.orderId }),
          amount: { total: 200, currency: 'CNY' },
          transaction_id: `wxtxn_http_${randomBytes(6).toString('hex')}`,
        }),
      })
      const wxHttpRes = await fetch(`http://127.0.0.1:${entryPort}${WX_CALLBACK_PATH}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...httpWxCb.headers },
        body: httpWxCb.rawBody,
      })
      const wxHttpBody = (await wxHttpRes.json().catch(() => ({}))) as { code?: string }
      if (wxHttpRes.status === 200 && wxHttpBody.code === 'SUCCESS' && (await orderState(IW.orderId)).payStatus === 'paid') {
        pass('HTTP 栈 wechat json 回调：rawBody 捕获 + 验签解密入账 + JSON SUCCESS 应答')
      } else {
        fail(`HTTP wechat callback failed: ${wxHttpRes.status} ${JSON.stringify(wxHttpBody)}`)
      }

      // 两单入账后立即领取，保持后续 claim 断言的确定性
      const httpClaims = new Set([await claimOnce(), await claimOnce()])
      if (httpClaims.has(IA.taskId) && httpClaims.has(IW.taskId)) pass('HTTP 入账订单任务可 claim')
      else fail(`http-paid claims mismatch: ${[...httpClaims].join(',')}`)
    } finally {
      httpEntry.close()
    }

    // ── (6) reconcile 主动查单兜底 ────────────────────────────────────────
    await expectCode('reconcile 缺 payment session token → 401', 'PAYMENT_SESSION_REQUIRED', () =>
      payment.reconcilePayment(C.orderId, undefined),
    )

    const D = await makePrintOrder('orderD')
    const attemptD = await payment.createPayAttempt(D.orderId, D.token, 'wechat')
    // 渠道账本：已支付（回调丢失场景）
    const wxQueryTxn = `wxtxn_query_${randomBytes(6).toString('hex')}`
    wechatQueryResponse = {
      mchid: WX_MCHID,
      appid: WX_APPID,
      out_trade_no: attemptD.attemptId,
      transaction_id: wxQueryTxn,
      trade_state: 'SUCCESS',
      amount: { total: 200, currency: 'CNY' },
    }
    const reconciled = await payment.reconcilePayment(D.orderId, D.token)
    const paidD = await orderState(D.orderId)
    if (
      reconciled.payStatus === 'paid' &&
      paidD.paymentSource === 'wechat' &&
      (await auditCount('payment.reconciled', attemptD.attemptId)) === 1 &&
      (await taskStatus(D.taskId)) === 'pending'
    ) {
      pass('reconcile：渠道账本 SUCCESS + 金额一致 → 同路径入账 + 审计 + 不碰 PrintTask')
    } else {
      fail(`reconcile mishandled: ${JSON.stringify({ reconciled: reconciled.payStatus, paidD })}`)
    }
    const reconciledAgain = await payment.reconcilePayment(D.orderId, D.token)
    if (reconciledAgain.payStatus === 'paid' && (await auditCount('order.mark_paid_online', D.orderId)) === 1) {
      pass('已 paid 订单重复 reconcile 幂等（不再打渠道/不重复审计）')
    } else {
      fail('reconcile not idempotent after paid')
    }

    // 渠道账本金额与服务端不一致：拒绝入账 + 可审计
    const E = await makePrintOrder('orderE')
    const attemptE = await payment.createPayAttempt(E.orderId, E.token, 'wechat')
    wechatQueryResponse = {
      mchid: WX_MCHID,
      appid: WX_APPID,
      out_trade_no: attemptE.attemptId,
      transaction_id: `wxtxn_bad_${randomBytes(6).toString('hex')}`,
      trade_state: 'SUCCESS',
      amount: { total: 999, currency: 'CNY' },
    }
    await expectCode('reconcile 渠道金额不符 → 拒绝入账', 'RECONCILE_AMOUNT_MISMATCH', () =>
      payment.reconcilePayment(E.orderId, E.token),
    )
    if (
      (await orderState(E.orderId)).payStatus === 'paying' &&
      (await auditCount('payment.reconcile_amount_mismatch', attemptE.attemptId)) === 1
    ) {
      pass('金额不符时订单不动 + 审计 payment.reconcile_amount_mismatch')
    } else {
      fail('reconcile amount mismatch not audited or order polluted')
    }
    await expectCode('reconcile 最小间隔限流', 'RECONCILE_TOO_FREQUENT', () =>
      payment.reconcilePayment(E.orderId, E.token),
    )

    // 渠道账本 pending：不改状态
    const F = await makePrintOrder('orderF')
    const attemptF = await payment.createPayAttempt(F.orderId, F.token, 'alipay')
    alipayQueryNode = { code: '10000', msg: 'Success', out_trade_no: attemptF.attemptId, trade_status: 'WAIT_BUYER_PAY' }
    const reconF = await payment.reconcilePayment(F.orderId, F.token)
    if (reconF.payStatus === 'paying' && (await orderState(F.orderId)).payStatus === 'paying') {
      pass('reconcile 渠道 WAIT_BUYER_PAY：不改状态，返回真实 paying')
    } else {
      fail(`reconcile pending mishandled: ${reconF.payStatus}`)
    }

    // alipay 渠道账本已支付（回调丢失）：查单入账
    const G = await makePrintOrder('orderG')
    const attemptG = await payment.createPayAttempt(G.orderId, G.token, 'alipay')
    alipayQueryNode = {
      code: '10000',
      msg: 'Success',
      out_trade_no: attemptG.attemptId,
      trade_no: `alitxn_query_${randomBytes(6).toString('hex')}`,
      trade_status: 'TRADE_SUCCESS',
      total_amount: '2.00',
    }
    const reconG = await payment.reconcilePayment(G.orderId, G.token)
    if (reconG.payStatus === 'paid' && (await orderState(G.orderId)).paymentSource === 'alipay') {
      pass('alipay reconcile：TRADE_SUCCESS + 金额一致 → 入账 paymentSource=alipay')
    } else {
      fail(`alipay reconcile mishandled: ${reconG.payStatus}`)
    }
    // D 与 G 均经 reconcile 入账为 paid：两次 claim 应恰好取回这两个任务（unpaid 的 C/E/F 不可见）。
    const reconClaims = new Set([await claimOnce(), await claimOnce()])
    if (reconClaims.has(D.taskId) && reconClaims.has(G.taskId) && (await claimOnce()) === null) {
      pass('reconcile 入账后任务同样可 claim（与回调入账同权；未支付任务仍不可见）')
    } else {
      fail(`reconciled-paid claims mismatch: ${[...reconClaims].join(',')}`)
    }

    // ── (7) 门禁开关对照（隔离订单 H，验证 legacy off 行为仍可用）─────────
    const H = await makePrintOrder('orderH')
    // 门禁开启时 H（及此前未支付的 C/E/F）都不可领取。
    if ((await claimOnce()) === null) pass('门禁开启时全部未支付任务不可 claim')
    else fail('gate-on claim leaked an unpaid task')
    // 关闭门禁：未支付任务（含 H）可被领取 —— claim 按创建序逐个取，循环至取到 H。
    process.env['PRINT_REQUIRE_PAID_BEFORE_CLAIM'] = 'false'
    let sawH = false
    // 前文还会创建两笔已由渠道关单释放的二维码订单；按上限扫描到 H，避免测试夹具数量变化掩盖门禁断言。
    for (let i = 0; i < 12; i += 1) {
      const claimed = await claimOnce()
      if (!claimed) break
      if (claimed === H.taskId) {
        sawH = true
        break
      }
    }
    process.env['PRINT_REQUIRE_PAID_BEFORE_CLAIM'] = 'true'
    if (sawH) {
      pass('门禁关闭时 unpaid 任务可 claim（legacy 行为，生产由 runtime gates 强制显式声明）')
    } else {
      fail('gate-off did not allow claiming unpaid task H')
    }

    console.log(`\n  ✅ verify:payment-real-channels 全部通过（${passCount} checks）\n`)
  } finally {
    await cleanup()
    await prisma.onModuleDestroy()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
