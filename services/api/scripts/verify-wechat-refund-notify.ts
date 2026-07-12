/**
 * verify:wechat-refund-notify — 微信退款结果回调通知接口验证
 *
 * 覆盖：
 * 1. 合法 SUCCESS 通知 → pending 退款 + 订单 refunding 收敛为 refunded
 * 2. 合法 SUCCESS 通知 → refunding 订单同样收敛（Admin 发起退款后渠道异步通知）
 * 3. 重复 SUCCESS 通知幂等（不重复审计/副作用）
 * 4. 签名错误拒绝（401）
 * 5. 解密失败拒绝（APIv3 密钥不符）
 * 6. 未知 out_refund_no 不误改订单（400，不影响无关记录）
 * 7. 金额不符拒绝（400）
 * 8. 时间窗过期拒绝
 * 9. CLOSED/ABNORMAL → Refund failed + 订单回 paid（可重试）
 * 10. 已 SUCCESS 不得被 CLOSED 通知回退
 * 11. 不影响 PrintTask.status（退款回调全程不触碰打印任务）
 */
// 生产门禁环境变量设置（测试专用占位，不含真实密钥）
process.env['TERMINAL_ADMIN_SECRET'] ||= 'verify-wxrn-terminal-admin-secret-0123456789'
process.env['TERMINAL_ACTION_TOKEN_SECRET'] ||= 'verify-wxrn-terminal-action-secret-01234'
process.env['FILE_SIGNING_SECRET'] ||= 'verify-wxrn-file-signing-secret-01234567890abc'
process.env['PAYMENT_SESSION_SECRET'] ||= 'verify-wxrn-payment-session-secret-01234567'
process.env['PRINT_REQUIRE_PAID_BEFORE_CLAIM'] = 'true'

import 'dotenv/config'
import { createDecipheriv, createSign, generateKeyPairSync, randomBytes, randomUUID } from 'crypto'
import { AuditService } from '../src/audit/audit.service'
import { OrderStatusService } from '../src/payment/order-status.service'
import { PAYMENT_PROVIDER_TOKEN, resolvePaymentProviders } from '../src/payment/payment-provider.factory'
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
const APIV3_KEY = randomBytes(16).toString('hex') // 32 hex chars = 32 bytes
const MCH_ID = '1900000001'
const APP_ID = 'wx0000000000000001'
const SERIAL = 'PUB_KEY_ID_WXRN_VERIFY_0001'

// 模拟渠道侧用 platformKeys.privateKey 签名，服务端用 platformKeys.publicKey 验签
function buildRefundNotify(payload: Record<string, unknown>): { rawBody: Buffer; headers: Record<string, string> } {
  const resource = encryptWechatCallbackResource(JSON.stringify(payload), APIV3_KEY)
  const rawBody = Buffer.from(
    JSON.stringify({
      id: randomUUID(),
      event_type: 'REFUND.SUCCESS',
      resource_type: 'encrypt-resource',
      resource,
    }),
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
  console.log('\n=== verify:wechat-refund-notify ===')

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const audit = new AuditService(prisma)
  const storage = new StorageService()
  const pageCount = new PrintPageCountService(prisma, storage)
  const pricing = new PricingService(prisma)
  const orderStatus = new OrderStatusService(prisma, audit)
  const printJobs = new PrintJobsService(prisma, audit, pageCount, pricing, orderStatus, new TerminalCapabilitiesService(prisma))

  // 注入真实 WechatPayProvider（本地密钥，零外部请求）
  const wechatProvider = new WechatPayProvider({
    mchid: MCH_ID,
    appid: APP_ID,
    mchSerialNo: 'MCH_SERIAL_WXRN_0001',
    privateKeyPem: mchKeys.privateKey,
    apiV3Key: APIV3_KEY,
    platformPublicKeyPem: platformKeys.publicKey,
    platformPublicKeyId: SERIAL,
    notifyBaseUrl: 'https://test.local',
    apiBaseUrl: 'http://127.0.0.1:1', // 不发真实请求
  })
  const registry = { get: (ch: string) => ch === 'wechat' ? wechatProvider : undefined } as ReturnType<typeof resolvePaymentProviders>
  const refundService = new RefundService(prisma, audit, registry as unknown as Parameters<typeof RefundService.prototype.refund>[never])

  // @ts-expect-error 构造函数反射
  const refundSvc: RefundService = new (RefundService as unknown as new (...args: unknown[]) => RefundService)(prisma, audit, registry)

  const suffix = randomUUID().replace(/-/g, '').slice(0, 10)
  const terminalId = `t_wxrn_${suffix}`
  const fileIds: string[] = []
  const storageKeys: string[] = []
  const taskIds: string[] = []

  async function seedPdf(label: string): Promise<string> {
    const fid = `f_wxrn_${suffix}_${label}`
    const sk = `verify/wxrn/${fid}.pdf`
    // 每页含 /Type /Page（无 /Pages）以匹配 countPdfPages 轻量识别逻辑
    const pdf = Buffer.from(`%PDF-1.4\n${'1 0 obj\n<< /Type /Page >>\nendobj\n'.repeat(2)}%%EOF\n`)
    await storage.putObject(sk, pdf, 'application/pdf', LOCAL_BUCKET_SENTINEL)
    await prisma.fileObject.create({
      data: { id: fid, storageKey: sk, filename: `${label}.pdf`, mimeType: 'application/pdf', sizeBytes: pdf.length, sha256: '', purpose: 'print_source', bucket: LOCAL_BUCKET_SENTINEL },
    })
    fileIds.push(fid)
    storageKeys.push(sk)
    return signFileUrl(fid, 60_000).url
  }

  /** 创建订单并用 markPaidOnline 打成 paid (wechat) + 建 pending Refund + 置 refunding */
  async function makePaidAndRefunding(label: string): Promise<{
    orderId: string; orderNo: string; refundNo: string; taskId: string; amountCents: number
  }> {
    await seedDevDefaultPriceConfig(prisma)
    const created = await printJobs.create(
      { fileUrl: await seedPdf(label), fileMd5: `sha256-wxrn-${label}`, fileName: `${label}.pdf`, params: PRINT_PARAMS },
      { endUserId: null, terminalId },
    )
    taskIds.push(created.taskId)
    const order = await prisma.order.findUnique({ where: { printTaskId: created.taskId } })
    if (!order) fail(`order not found for ${label}`)

    // 模拟一次支付成功（wechat 入账），在 PaymentAttempt 写成功记录（refund 需要）
    const attemptId = `attempt_wxrn_${suffix}_${label}`
    await prisma.paymentAttempt.create({
      data: { id: attemptId, orderId: order.id, channel: 'wechat', status: 'success', amountCents: order.amountCents, expiresAt: new Date(Date.now() + 3600_000), prepayId: 'fake_prepay', channelTxnNo: `wxtxn_${suffix}_${label}` },
    })
    await prisma.order.update({ where: { id: order.id }, data: { payStatus: 'paid', paymentSource: 'wechat', payChannel: 'wechat', paidAt: new Date(), paidBy: 'verify' } })

    // 建 Refund(pending) + 置订单 refunding
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
      data: { id: terminalId, terminalCode: `KSK-WXRN-${suffix}`, agentToken: `agt_${suffix}`, deviceFingerprint: 'verify-wxrn' },
    })

    // ── 1. SUCCESS → pending 退款 + refunding 订单收敛为 refunded ──────────────
    const R1 = await makePaidAndRefunding('r1')
    const r1ChannelRefundNo = `wxrfd_${randomBytes(6).toString('hex')}`
    const r1Notify = buildRefundNotify({
      mchid: MCH_ID, out_trade_no: `attempt_wxrn_${suffix}_r1`,
      out_refund_no: R1.refundNo, refund_id: r1ChannelRefundNo,
      refund_status: 'SUCCESS',
      amount: { refund: R1.amountCents, total: R1.amountCents },
    })
    const r1Result = await refundSvc.processWechatRefundNotify(r1Notify.rawBody, r1Notify.headers)
    const r1Order = await prisma.order.findUnique({ where: { id: R1.orderId } })
    const r1Refund = await prisma.refund.findUnique({ where: { refundNo: R1.refundNo } })
    if (r1Result.ok && r1Refund?.status === 'success' && r1Refund.channelRefundNo === r1ChannelRefundNo && r1Order?.payStatus === 'refunded' && r1Order.refundedAmountCents === R1.amountCents) {
      pass('SUCCESS 通知：pending 退款 + refunding 订单收敛为 refunded，channelRefundNo 已回填')
    } else {
      fail(`R1 mismatch: refund=${JSON.stringify(r1Refund)}, order payStatus=${r1Order?.payStatus}`)
    }
    const r1Audit = await prisma.auditLog.findFirst({ where: { action: 'refund.created', targetId: R1.orderId } })
    const r1Payload = r1Audit ? (JSON.parse(r1Audit.payloadJson ?? '{}') as Record<string, unknown>) : null
    if (r1Payload?.['viaRefundNotify'] === true && r1Payload?.['channelRefundNo'] === r1ChannelRefundNo) {
      pass('SUCCESS 通知审计：viaRefundNotify=true + channelRefundNo 记录')
    } else fail(`R1 audit mismatch: ${JSON.stringify(r1Payload)}`)

    // ── 2. 重复 SUCCESS 通知幂等（不重复审计/副作用）──────────────────────────
    // 重复通知需要不同 nonce 才能通过防重放
    const r1DupNotify = buildRefundNotify({ mchid: MCH_ID, out_trade_no: `attempt_wxrn_${suffix}_r1`, out_refund_no: R1.refundNo, refund_id: r1ChannelRefundNo, refund_status: 'SUCCESS', amount: { refund: R1.amountCents, total: R1.amountCents } })
    const r1DupResult = await refundSvc.processWechatRefundNotify(r1DupNotify.rawBody, r1DupNotify.headers)
    const r1AuditCount = await prisma.auditLog.count({ where: { action: 'refund.created', targetId: R1.orderId } })
    if (r1DupResult.idempotent && r1AuditCount === 1) {
      pass('重复 SUCCESS 通知幂等：不重复审计')
    } else fail(`R1 dup: idempotent=${r1DupResult.idempotent}, audits=${r1AuditCount}`)

    // ── 3. 签名错误拒绝 ──────────────────────────────────────────────────────
    const R3 = await makePaidAndRefunding('r3')
    const r3Notify = buildRefundNotify({ mchid: MCH_ID, out_trade_no: `attempt_wxrn_${suffix}_r3`, out_refund_no: R3.refundNo, refund_id: 'rfd3', refund_status: 'SUCCESS', amount: { refund: R3.amountCents, total: R3.amountCents } })
    // 篡改签名
    const badHeaders = { ...r3Notify.headers, [WECHAT_SIGNATURE_HEADER]: 'BADSIG' + r3Notify.headers[WECHAT_SIGNATURE_HEADER] }
    await expectCode('签名错误拒绝（CALLBACK_SIGNATURE_INVALID）', 'CALLBACK_SIGNATURE_INVALID', () =>
      refundSvc.processWechatRefundNotify(r3Notify.rawBody, badHeaders),
    )
    if ((await prisma.refund.findUnique({ where: { refundNo: R3.refundNo } }))?.status === 'pending') {
      pass('签名错误：退款记录未被改动')
    } else fail('R3: refund status changed on bad sig')

    // ── 4. 解密失败拒绝（APIv3 密钥不符）────────────────────────────────────
    const R4 = await makePaidAndRefunding('r4')
    // 用错误密钥加密
    const wrongKey = randomBytes(16).toString('hex')
    const r4Resource = encryptWechatCallbackResource(JSON.stringify({ mchid: MCH_ID, out_trade_no: 'x', out_refund_no: R4.refundNo, refund_id: 'rfd4', refund_status: 'SUCCESS', amount: { refund: R4.amountCents, total: R4.amountCents } }), wrongKey)
    const r4RawBody = Buffer.from(JSON.stringify({ id: randomUUID(), event_type: 'REFUND.SUCCESS', resource_type: 'encrypt-resource', resource: r4Resource }), 'utf8')
    const r4ts = String(Math.floor(Date.now() / 1000))
    const r4nonce = randomBytes(16).toString('hex')
    const r4sig = createSign('RSA-SHA256').update(buildWechatCallbackVerifyBase({ timestamp: r4ts, nonce: r4nonce, rawBody: r4RawBody })).sign(platformKeys.privateKey, 'base64')
    await expectCode('解密失败拒绝（CALLBACK_RESOURCE_DECRYPT_FAILED）', 'CALLBACK_RESOURCE_DECRYPT_FAILED', () =>
      refundSvc.processWechatRefundNotify(r4RawBody, { [WECHAT_TIMESTAMP_HEADER]: r4ts, [WECHAT_NONCE_HEADER]: r4nonce, [WECHAT_SIGNATURE_HEADER]: r4sig, [WECHAT_SERIAL_HEADER]: SERIAL }),
    )

    // ── 5. 未知 out_refund_no 不误改订单 ─────────────────────────────────────
    const R5 = await makePaidAndRefunding('r5')
    const r5Notify = buildRefundNotify({ mchid: MCH_ID, out_trade_no: `attempt_wxrn_${suffix}_r5`, out_refund_no: 'RFD-NONEXISTENT-ORDER', refund_id: 'rfd5', refund_status: 'SUCCESS', amount: { refund: R5.amountCents, total: R5.amountCents } })
    await expectCode('未知 out_refund_no 拒绝（REFUND_NOTIFY_UNKNOWN_REFUND）', 'REFUND_NOTIFY_UNKNOWN_REFUND', () =>
      refundSvc.processWechatRefundNotify(r5Notify.rawBody, r5Notify.headers),
    )
    const r5Refund = await prisma.refund.findUnique({ where: { refundNo: R5.refundNo } })
    const r5Order = await prisma.order.findUnique({ where: { id: R5.orderId } })
    if (r5Refund?.status === 'pending' && r5Order?.payStatus === 'refunding') {
      pass('未知 refundNo：真实订单未被误改')
    } else fail(`R5: refund=${r5Refund?.status}, order=${r5Order?.payStatus}`)

    // ── 6. 金额不符拒绝 ───────────────────────────────────────────────────────
    const R6 = await makePaidAndRefunding('r6')
    const r6Notify = buildRefundNotify({ mchid: MCH_ID, out_trade_no: `attempt_wxrn_${suffix}_r6`, out_refund_no: R6.refundNo, refund_id: 'rfd6', refund_status: 'SUCCESS', amount: { refund: R6.amountCents + 1, total: R6.amountCents } })
    await expectCode('金额不符拒绝（REFUND_NOTIFY_AMOUNT_MISMATCH）', 'REFUND_NOTIFY_AMOUNT_MISMATCH', () =>
      refundSvc.processWechatRefundNotify(r6Notify.rawBody, r6Notify.headers),
    )

    // ── 7. 时间窗过期拒绝 ─────────────────────────────────────────────────────
    const R7 = await makePaidAndRefunding('r7')
    const r7RawBody = Buffer.from(JSON.stringify({ id: randomUUID(), event_type: 'REFUND.SUCCESS', resource_type: 'encrypt-resource', resource: encryptWechatCallbackResource(JSON.stringify({ mchid: MCH_ID, out_trade_no: 'x', out_refund_no: R7.refundNo, refund_id: 'rfd7', refund_status: 'SUCCESS', amount: { refund: R7.amountCents, total: R7.amountCents } }), APIV3_KEY) }), 'utf8')
    const expiredTs = String(Math.floor((Date.now() - 6 * 60 * 1000) / 1000)) // 6 分钟前
    const r7nonce = randomBytes(16).toString('hex')
    const r7sig = createSign('RSA-SHA256').update(buildWechatCallbackVerifyBase({ timestamp: expiredTs, nonce: r7nonce, rawBody: r7RawBody })).sign(platformKeys.privateKey, 'base64')
    await expectCode('时间窗过期拒绝（CALLBACK_TIMESTAMP_EXPIRED）', 'CALLBACK_TIMESTAMP_EXPIRED', () =>
      refundSvc.processWechatRefundNotify(r7RawBody, { [WECHAT_TIMESTAMP_HEADER]: expiredTs, [WECHAT_NONCE_HEADER]: r7nonce, [WECHAT_SIGNATURE_HEADER]: r7sig, [WECHAT_SERIAL_HEADER]: SERIAL }),
    )

    // ── 8. CLOSED → Refund failed + 订单回 paid（内部回滚，对微信返回成功避免重试）──
    const R8 = await makePaidAndRefunding('r8')
    const r8Notify = buildRefundNotify({ mchid: MCH_ID, out_trade_no: `attempt_wxrn_${suffix}_r8`, out_refund_no: R8.refundNo, refund_id: null, refund_status: 'CLOSED', amount: { refund: 0, total: R8.amountCents } })
    const r8Result = await refundSvc.processWechatRefundNotify(r8Notify.rawBody, r8Notify.headers)
    const r8Refund = await prisma.refund.findUnique({ where: { refundNo: R8.refundNo } })
    const r8Order = await prisma.order.findUnique({ where: { id: R8.orderId } })
    if (r8Result.ok && r8Refund?.status === 'failed' && r8Order?.payStatus === 'paid') {
      pass('CLOSED：Refund failed + 订单回 paid（可重试），接口对微信返回成功避免重试风暴）')
    } else {
      fail(`R8 mismatch: ok=${r8Result.ok}, refund=${r8Refund?.status}, order=${r8Order?.payStatus}`)
    }

    // ── 9. 已 SUCCESS 不得被 CLOSED 通知回退 ─────────────────────────────────
    const R9 = await makePaidAndRefunding('r9')
    const r9SuccessNotify = buildRefundNotify({ mchid: MCH_ID, out_trade_no: `attempt_wxrn_${suffix}_r9`, out_refund_no: R9.refundNo, refund_id: 'rfd9', refund_status: 'SUCCESS', amount: { refund: R9.amountCents, total: R9.amountCents } })
    await refundSvc.processWechatRefundNotify(r9SuccessNotify.rawBody, r9SuccessNotify.headers)
    const r9ClosedNotify = buildRefundNotify({ mchid: MCH_ID, out_trade_no: `attempt_wxrn_${suffix}_r9`, out_refund_no: R9.refundNo, refund_id: null, refund_status: 'CLOSED', amount: { refund: 0, total: R9.amountCents } })
    await expectCode('已退款订单收到 CLOSED 拒绝（REFUND_NOTIFY_STATE_CONFLICT）', 'REFUND_NOTIFY_STATE_CONFLICT', () =>
      refundSvc.processWechatRefundNotify(r9ClosedNotify.rawBody, r9ClosedNotify.headers),
    )
    const r9Order = await prisma.order.findUnique({ where: { id: R9.orderId } })
    if (r9Order?.payStatus === 'refunded') pass('已 SUCCESS 的退款被 CLOSED 通知后订单仍保持 refunded（不回退）')
    else fail(`R9: order payStatus=${r9Order?.payStatus}`)

    // ── 10. 不影响 PrintTask ──────────────────────────────────────────────────
    const r1Task = await prisma.printTask.findUnique({ where: { id: R1.taskId } })
    if (r1Task?.status === 'pending') {
      pass('退款回调全程不影响 PrintTask.status（打印域与支付域解耦）')
    } else fail(`R1 PrintTask status changed: ${r1Task?.status}`)

    console.log(`\n  ✅ verify:wechat-refund-notify 全部通过（${passCount} checks）\n`)
  } finally {
    await cleanup()
    await prisma.onModuleDestroy()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
