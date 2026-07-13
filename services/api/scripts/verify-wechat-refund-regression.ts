/**
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
import {
  buildWechatCallbackVerifyBase,
  encryptWechatCallbackResource,
  WECHAT_NONCE_HEADER,
  WECHAT_SERIAL_HEADER,
  WECHAT_SIGNATURE_HEADER,
  WECHAT_TIMESTAMP_HEADER,
  WechatPayProvider,
} from '../src/payment/providers/wechat-pay.provider'
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
  process.exit(1)
}
async function expectCode(label: string, code: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn()
  } catch (e) {
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
      [WECHAT_SERIAL_HEADER]: SERIAL,
    },
  }
}

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

async function main(): Promise<void> {
  console.log('\n=== verify:wechat-refund-regression ===')

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const audit = new AuditService(prisma)
  const storage = new StorageService()
  const pageCount = new PrintPageCountService(prisma, storage)
  const pricing = new PricingService(prisma)
  const orderStatus = new OrderStatusService(prisma, audit)
  const printJobs = new PrintJobsService(prisma, audit, pageCount, pricing, orderStatus, new TerminalCapabilitiesService(prisma))
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
  }

  try {
    await prisma.terminal.create({
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
  } finally {
    await cleanup()
    await prisma.onModuleDestroy()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
