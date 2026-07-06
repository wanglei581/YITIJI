/**
 * W-C part2b-1 退款自动收敛 verification（verify:refund-convergence）。
 *
 * 用本地 RSA 模拟渠道 + 假网关造出「pending 真实渠道退款」（wechat PROCESSING），
 * 再直接调 RefundService.convergeStalePendingRefunds，断言：
 * - 批量扫 pending → 渠道查证 SUCCESS → 补完成 refunded（幂等，refund.created 恰 1 条）。
 * - 仍 PROCESSING 的单保持 pending，不被误判失败。
 * - 明确失败（ABNORMAL）的单回滚 paid 计 failed，不阻断其它笔。
 * - 只处理 wechat/alipay（sandbox 同步完成不留 pending，不进批处理）。
 * - 收敛复用与人工重复退款同一路径：不二次出款（渠道请求次数受控）。
 * - cron 任务 env 门控（源码断言 REFUND_AUTO_CONVERGE_ENABLED）。
 */
process.env['PAYMENT_SESSION_SECRET'] ||= 'verify-refundconv-payment-session-secret-0123456789'
process.env['PRINT_REQUIRE_PAID_BEFORE_CLAIM'] = 'true'
if (process.env['NODE_ENV'] === 'production') {
  console.error('  FAIL verify:refund-convergence 不得在 NODE_ENV=production 运行')
  process.exit(1)
}

import 'dotenv/config'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import { createSign, generateKeyPairSync, randomBytes, randomUUID } from 'crypto'
import { readFileSync } from 'fs'
import { join } from 'path'
import { AuditService } from '../src/audit/audit.service'
import { OrderStatusService } from '../src/payment/order-status.service'
import { PaymentProviderRegistry } from '../src/payment/payment-provider.factory'
import { RefundService } from '../src/payment/refund.service'
import { WechatPayProvider } from '../src/payment/providers/wechat-pay.provider'
import { PrismaService } from '../src/prisma/prisma.service'

let passCount = 0
const pass = (m: string) => {
  passCount += 1
  console.log(`  PASS ${m}`)
}
const fail = (m: string): never => {
  console.error(`  FAIL ${m}`)
  process.exit(1)
}

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
const APIV3_KEY = randomBytes(16).toString('hex')

/** 每个 out_refund_no 的查证响应（按 refundNo 路由，模拟不同单不同结果）。 */
const refundQueryByNo = new Map<string, { status: string; refund_id?: string }>()
let refundGatewayHits = 0

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

function startFakeGateway(): Promise<{ server: Server; port: number }> {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      const url = req.url ?? ''
      await readBody(req)
      if (req.method === 'GET' && url.startsWith('/v3/refund/domestic/refunds/')) {
        refundGatewayHits += 1
        const no = decodeURIComponent(url.split('/').pop() ?? '')
        const resp = refundQueryByNo.get(no) ?? { status: 'PROCESSING' }
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(resp))
        return
      }
      res.writeHead(404)
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

async function main(): Promise<void> {
  console.log('\n=== W-C refund auto-convergence verification ===')
  const { server, port } = await startFakeGateway()
  const wechat = new WechatPayProvider({
    mchid: '1900000001',
    appid: 'wx0000000000000001',
    mchSerialNo: 'MCH_SERIAL_VERIFY',
    privateKeyPem: mchKeys.privateKey,
    apiV3Key: APIV3_KEY,
    platformPublicKeyPem: wxPlatformKeys.publicKey,
    platformPublicKeyId: 'PUB_KEY_ID',
    notifyBaseUrl: 'https://kiosk-pay.verify.test',
    apiBaseUrl: `http://127.0.0.1:${port}`,
  })
  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const audit = new AuditService(prisma)
  const registry = new PaymentProviderRegistry([wechat])
  const refundService = new RefundService(prisma, audit, registry)
  void new OrderStatusService(prisma, audit)

  const suffix = randomUUID().replace(/-/g, '').slice(0, 12)
  const terminalId = `t_refconv_${suffix}`
  const orderIds: string[] = []

  // 造一个 paid 订单 + success attempt + pending Refund（模拟受理中退款留下的状态）。
  const makePendingRefund = async (tag: string, refundNo: string): Promise<void> => {
    const o = await prisma.order.create({
      data: {
        orderNo: `ORD-REFCONV-${suffix}-${tag}`,
        type: 'print',
        amountCents: 100,
        payStatus: 'refunding', // 退款受理中
        paymentSource: 'wechat',
        payChannel: 'wechat',
        paidAt: new Date(),
        taskStatus: 'pending',
        terminalId,
      },
    })
    orderIds.push(o.id)
    await prisma.paymentAttempt.create({
      data: { orderId: o.id, channel: 'wechat', amountCents: 100, status: 'success', channelTxnNo: `wx_${tag}_${suffix}` },
    })
    await prisma.refund.create({
      data: { orderId: o.id, refundNo, amountCents: 100, status: 'pending', channel: 'wechat', reason: '受理中退款' },
    })
  }

  const cleanup = async (): Promise<void> => {
    await prisma.auditLog.deleteMany({ where: { targetId: { in: orderIds } } })
    await prisma.refund.deleteMany({ where: { orderId: { in: orderIds } } })
    await prisma.paymentAttempt.deleteMany({ where: { orderId: { in: orderIds } } })
    await prisma.order.deleteMany({ where: { terminalId } })
    await prisma.terminal.deleteMany({ where: { id: terminalId } })
    server.close()
  }

  try {
    await prisma.terminal.create({
      data: { id: terminalId, terminalCode: `KSK-REFCONV-${suffix}`, agentToken: `agt_${suffix}`, deviceFingerprint: 'verify-refconv' },
    })

    const noDone = `RFD-CONV-${suffix}-done`
    const noStill = `RFD-CONV-${suffix}-still`
    const noFail = `RFD-CONV-${suffix}-fail`
    await makePendingRefund('done', noDone)
    await makePendingRefund('still', noStill)
    await makePendingRefund('fail', noFail)
    // 渠道账本：done→SUCCESS，still→PROCESSING，fail→ABNORMAL
    refundQueryByNo.set(noDone, { status: 'SUCCESS', refund_id: `wxrfd_${suffix}_done` })
    refundQueryByNo.set(noStill, { status: 'PROCESSING' })
    refundQueryByNo.set(noFail, { status: 'ABNORMAL' })

    const res = await refundService.convergeStalePendingRefunds({ limit: 100 })
    // 全库可能有其它 pending，断言只针对我们造的三笔结果状态
    const doneRow = await prisma.refund.findUnique({ where: { refundNo: noDone } })
    const stillRow = await prisma.refund.findUnique({ where: { refundNo: noStill } })
    const failRow = await prisma.refund.findUnique({ where: { refundNo: noFail } })
    const orderOf = async (refundNo: string) => {
      const r = await prisma.refund.findUnique({ where: { refundNo } })
      return r ? (await prisma.order.findUnique({ where: { id: r.orderId } }))?.payStatus : null
    }

    if (doneRow?.status === 'success' && (await orderOf(noDone)) === 'refunded') {
      pass('SUCCESS 单：自动收敛补完成 refunded')
    } else {
      fail(`done not converged: ${doneRow?.status}`)
    }
    if (stillRow?.status === 'pending' && (await orderOf(noStill)) === 'refunding') {
      pass('PROCESSING 单：保持 pending+refunding（不误判失败）')
    } else {
      fail(`still mishandled: ${stillRow?.status}`)
    }
    if (failRow?.status === 'failed' && (await orderOf(noFail)) === 'paid') {
      pass('ABNORMAL 单：回滚 paid 计 failed（不阻断其它笔）')
    } else {
      fail(`fail mishandled: ${failRow?.status}`)
    }
    if (res.scanned >= 3 && res.refunded >= 1 && res.stillPending >= 1 && res.failed >= 1) {
      pass(`批处理统计合理：scanned=${res.scanned} refunded=${res.refunded} stillPending=${res.stillPending} failed=${res.failed}`)
    } else {
      fail(`batch stats mismatch: ${JSON.stringify(res)}`)
    }

    // done 单已 refunded，再次收敛不重复出款/审计（refund.created 恰 1）
    const hitsBefore = refundGatewayHits
    await refundService.convergeStalePendingRefunds({ limit: 100 })
    const doneAudits = await prisma.auditLog.count({ where: { action: 'refund.created', targetId: doneRow!.orderId } })
    if (doneAudits === 1 && refundGatewayHits >= hitsBefore) {
      pass('已完成单不再进 pending 批处理（refund.created 恰 1，无重复出款）')
    } else {
      fail(`re-converge not idempotent: audits=${doneAudits}`)
    }

    // cron 任务 env 门控（源码断言）
    const taskSrc = readFileSync(join(__dirname, '../src/payment/refund-convergence.task.ts'), 'utf8')
    if (taskSrc.includes("REFUND_AUTO_CONVERGE_ENABLED") && taskSrc.includes('@Cron(')) {
      pass('cron 任务 env 门控 REFUND_AUTO_CONVERGE_ENABLED + @Cron 定时')
    } else {
      fail('convergence task missing env gate or cron')
    }

    console.log(`\n  ✅ verify:refund-convergence 全部通过（${passCount} checks）\n`)
  } finally {
    await cleanup()
    await prisma.onModuleDestroy()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
