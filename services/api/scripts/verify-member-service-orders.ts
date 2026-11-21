import 'reflect-metadata'

/**
 * verify:member-service-orders —— 自助开票二期真库 + 真 Redis + 真 HTTP 综合门禁。
 * SQLite（build-and-verify）与 PostgreSQL 16（postgres-readiness）双库运行。
 *
 * 覆盖：
 *   1. 未登录 / 错 token / 失效会话 401（EndUserAuthGuard）。
 *   2. 跨用户隔离 + 匿名服务单不可见 + 查询串带未声明字段（如 endUserId）被 400 VALIDATION_FAILED 拒绝。
 *   3. 只返实付 > 0、paymentFailed=false、status ∈ [paid, consumed, refunding, refunded, refund_failed] 的单。
 *   4. 游标分页（createdAt DESC, id DESC 无重漏）、pageSize 封顶 50、非法 pageSize / 非法 cursor → 400 VALIDATION_FAILED。
 *   5. canInvoice / invoiceStatus 全状态（none / submitted / issued / returned / refunding / refund_failed / refunded）
 *      及旧 returned + 新 submitted/issued 优先取未退回申请。
 *   6. 零 PII / 零通道字段泄露断言（服务单与打印单均不含 taxId / email / title / qrCodeContent / prepayId /
 *      channelTxnNo / providerOrderNo / wxOpenId / endUserId 及真实税号/邮箱/抬头原文）。
 *   7. GET /api/v1/me/print-orders 关联 Order 且 amountCents > 0 的打印单开票态联查（含退款/部分退/全额抵扣/已开/退回），
 *      免费单与无 Order 历史单保持向后兼容、不增加多余键。
 *   8. 真实 HTTP 端到端闭环：建付成服务单 → GET /me/service-orders 可开票 → POST /kiosk/invoice-sessions 出码 →
 *      scene/resolve + submit → poll 变「已提交」→ GET /me/service-orders 变 submitted 且 canInvoice:false →
 *      管理员标已开 → GET /me/service-orders 变 issued 且 canInvoice:false。
 */
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { BadRequestException, Module, ValidationPipe, type ValidationError } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { JwtService } from '@nestjs/jwt'
import { Redis } from 'ioredis'
import { AuditService } from '../src/audit/audit.service'
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter'
import { EndUserAuthGuard } from '../src/common/guards/end-user-auth.guard'
import { RedisService } from '../src/common/redis/redis.service'
import { AdminInvoiceService } from '../src/invoices/admin-invoice.service'
import { InvoiceRequestsService } from '../src/invoices/invoice-requests.service'
import { InvoiceSessionsService } from '../src/invoices/invoice-sessions.service'
import { KioskInvoiceSessionsController } from '../src/invoices/kiosk-invoice-sessions.controller'
import { MemberInvoiceController } from '../src/invoices/member-invoice.controller'
import { MemberOrderClaimHereService } from '../src/member-print-orders/member-order-claim-here.service'
import { MemberOrderTimelineService } from '../src/member-print-orders/member-order-timeline.service'
import { MemberPrintOrderCreateService } from '../src/member-print-orders/member-print-order-create.service'
import { MemberPrintOrdersController } from '../src/member-print-orders/member-print-orders.controller'
import { MemberPrintOrdersService } from '../src/member-print-orders/member-print-orders.service'
import { PickupCodeReissueService } from '../src/member-print-orders/pickup-code-reissue.service'
import { MemberServiceOrderController } from '../src/payment/member-service-order.controller'
import { MemberServiceOrderService } from '../src/payment/member-service-order.service'
import { PrismaService } from '../src/prisma/prisma.service'
import { TerminalIdentityGuard } from '../src/terminals/terminal-identity.guard'
import { TERMINAL_TOKEN_VALIDATOR, TerminalSessionService } from '../src/terminals/terminal-session.service'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'

assertIsolatedVerificationDatabase()
assert.equal(process.env['VERIFICATION_REDIS_TARGET'], 'isolated', '真 Redis 必须显式声明隔离')
const redisTarget = new URL(process.env['REDIS_URL'] ?? 'redis://127.0.0.1:6379')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(redisTarget.hostname), '真 Redis 只允许本机回环')
process.env['FILE_SIGNING_SECRET'] ??= 'verify-member-svc-orders-signing-secret-012345'
const JWT_SECRET = process.env['JWT_SECRET'] && process.env['JWT_SECRET'].length >= 16
  ? process.env['JWT_SECRET']
  : 'verify-member-svc-orders-jwt-secret-0123456789'

const prisma = new PrismaService()
const client = new Redis(redisTarget.toString(), { maxRetriesPerRequest: 1, connectTimeout: 1000 })
const redis = new RedisService(client)
const jwt = new JwtService({ secret: JWT_SECRET, signOptions: { audience: 'enduser', expiresIn: '30m' } })
const audit = new AuditService(prisma)
const invoiceRequests = new InvoiceRequestsService(prisma)
const invoiceSessions = new InvoiceSessionsService(redis, invoiceRequests)
const adminInvoice = new AdminInvoiceService(prisma, audit, invoiceRequests)
const memberServiceOrders = new MemberServiceOrderService(prisma)
const memberPrintOrders = new MemberPrintOrdersService(prisma)
const terminalSessions = new TerminalSessionService(redis, prisma, {
  validateTerminalToken: async () => { throw new Error('本门禁不换票') },
})

const tag = randomUUID().replace(/-/g, '').slice(0, 12)
const TAX_ID = '91000000MA0000000N'
const EMAIL = 'invoice.verify.p2c2@example.com'
const TITLE_COMPANY = '青岛测试科技有限公司'
const FORBIDDEN_KEYS = [
  'taxId', 'email', 'title', 'qrCodeContent', 'prepayId',
  'channelTxnNo', 'providerOrderNo', 'wxOpenId', 'endUserId',
] as const

const made = {
  members: [] as string[],
  orgs: [] as string[],
  terminals: [] as string[],
  serviceOrders: [] as string[],
  printTasks: [] as string[],
  orders: [] as string[],
  keys: [] as string[],
}
const passed: string[] = []
let serial = 0
let base = ''

function next(): string {
  serial += 1
  return `${tag}-${serial}`
}

function flattenValidationErrors(errors: ValidationError[], parent = ''): string[] {
  const out: string[] = []
  for (const error of errors) {
    const path = parent ? `${parent}.${error.property}` : error.property
    if (error.constraints) for (const message of Object.values(error.constraints)) out.push(`${path}: ${message}`)
    if (error.children?.length) out.push(...flattenValidationErrors(error.children, path))
  }
  return out
}

@Module({
  controllers: [
    MemberServiceOrderController,
    MemberPrintOrdersController,
    KioskInvoiceSessionsController,
    MemberInvoiceController,
  ],
  providers: [
    { provide: PrismaService, useValue: prisma },
    { provide: RedisService, useValue: redis },
    { provide: JwtService, useValue: jwt },
    { provide: TerminalSessionService, useValue: terminalSessions },
    { provide: TERMINAL_TOKEN_VALIDATOR, useValue: {} },
    { provide: MemberServiceOrderService, useValue: memberServiceOrders },
    { provide: MemberPrintOrdersService, useValue: memberPrintOrders },
    { provide: MemberPrintOrderCreateService, useValue: {} },
    { provide: PickupCodeReissueService, useValue: {} },
    { provide: MemberOrderTimelineService, useValue: {} },
    { provide: MemberOrderClaimHereService, useValue: {} },
    { provide: InvoiceRequestsService, useValue: invoiceRequests },
    { provide: InvoiceSessionsService, useValue: invoiceSessions },
    EndUserAuthGuard,
    TerminalIdentityGuard,
  ],
})
class MemberServiceOrdersHttpModule {}

interface Reply<T = Record<string, unknown>> {
  status: number
  text: string
  json: { success?: boolean; data?: T; error?: { code?: string; message?: string } }
}

async function call<T = Record<string, unknown>>(
  method: 'GET' | 'POST',
  path: string,
  options: { body?: unknown; headers?: Record<string, string> } = {},
): Promise<Reply<T>> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...options.headers,
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  })
  const text = await res.text()
  return { status: res.status, text, json: text ? (JSON.parse(text) as Reply<T>['json']) : {} }
}

async function check(label: string, fn: () => Promise<void>) {
  try {
    await fn()
  } catch (error) {
    console.error(`FAIL ${label}`)
    throw error
  }
  passed.push(label)
  console.log(`PASS ${label}`)
}

async function createMember(): Promise<{ id: string; token: string; sessionId: string }> {
  const row = await prisma.endUser.create({
    data: {
      phoneHash: `verify-mso-${next()}`,
      phoneEnc: `verify-mso-enc-${randomBytes(6).toString('hex')}`,
      wxOpenId: `wx_secret_openid_${next()}`,
    },
  })
  made.members.push(row.id)
  const sessionId = randomUUID()
  await redis.registerMemberSession(row.id, sessionId, 1800)
  return {
    id: row.id,
    sessionId,
    token: jwt.sign({ sub: row.id }, { jwtid: sessionId, audience: 'enduser', expiresIn: '30m' }),
  }
}

async function createKioskTerminal(): Promise<{ terminalId: string; headers: Record<string, string> }> {
  const orgId = `verify-mso-org-${next()}`
  await prisma.organization.create({
    data: { id: orgId, name: '青岛某人力资源服务公司', type: 'licensed_hr_agency' },
  })
  made.orgs.push(orgId)
  const terminalId = `verify-mso-term-${next()}`
  await prisma.terminal.create({
    data: {
      id: terminalId,
      terminalCode: terminalId,
      agentToken: randomBytes(16).toString('hex'),
      deviceFingerprint: randomBytes(16).toString('hex'),
      orgId,
      orgBoundAt: new Date(),
    },
  })
  made.terminals.push(terminalId)
  const sessionToken = randomBytes(32).toString('base64url')
  const key = terminalSessions.sessionKey(sessionToken)
  made.keys.push(key)
  const issuedAt = new Date()
  await redis.setEx(
    key,
    1800,
    JSON.stringify({
      terminalId,
      generation: 0,
      issuedAt: issuedAt.toISOString(),
      expiresAt: new Date(issuedAt.getTime() + 1_800_000).toISOString(),
    }),
  )
  return { terminalId, headers: { 'x-terminal-id': terminalId, 'x-terminal-session-token': sessionToken } }
}

async function createServiceOrder(
  terminalId: string,
  fields: Partial<{
    id: string
    endUserId: string | null
    serviceKey: string
    status: string
    amountCents: number
    paymentFailed: boolean
    paidAt: Date | null
    settledAt: Date | null
    refundedAt: Date | null
    refundReason: string | null
    createdAt: Date
  }> = {},
): Promise<string> {
  const suffix = next()
  const row = await prisma.serviceOrder.create({
    data: {
      ...(fields.id ? { id: fields.id } : {}),
      terminalId,
      endUserId: fields.endUserId === undefined ? null : fields.endUserId,
      serviceKey: fields.serviceKey ?? 'resume_optimize',
      status: fields.status ?? 'paid',
      amountCents: fields.amountCents ?? 100,
      paymentFailed: fields.paymentFailed ?? false,
      kioskSessionId: `ksess-${suffix}`,
      provider: 'sandbox',
      providerOrderNo: `SVC-MSO-${suffix}`,
      qrCodeContent: `weixin://wxpay/secret_qr_${suffix}`,
      prepayId: `wx_prepay_secret_${suffix}`,
      channelTxnNo: `wx_txn_secret_${suffix}`,
      paidAt: fields.paidAt === undefined ? new Date(Date.now() - 60_000) : fields.paidAt,
      settledAt: fields.settledAt ?? null,
      refundedAt: fields.refundedAt ?? null,
      refundReason: fields.refundReason ?? null,
      expiresAt: new Date(Date.now() + 300_000),
      ...(fields.createdAt ? { createdAt: fields.createdAt } : {}),
    },
  })
  made.serviceOrders.push(row.id)
  return row.id
}

async function createPrintOrderPair(
  endUserId: string,
  terminalId: string,
  orderFields: Partial<{
    amountCents: number
    discountCents: number
    refundedAmountCents: number
    payStatus: string
    paymentSource: string | null
  }> | null,
  createdAt: Date,
  fileName: string,
): Promise<{ taskId: string; orderId: string | null }> {
  const taskId = `ptask-mso-${next()}`
  await prisma.printTask.create({
    data: {
      id: taskId,
      endUserId,
      terminalId,
      fileUrl: `sig://secret-${taskId}`,
      fileMd5: `sha256-${taskId}`,
      status: 'completed',
      completedAt: createdAt,
      createdAt,
      paramsJson: JSON.stringify({ fileName, copies: 1, colorMode: 'black_white', duplex: 'simplex', paperSize: 'A4' }),
    },
  })
  made.printTasks.push(taskId)
  if (!orderFields) return { taskId, orderId: null }
  const order = await prisma.order.create({
    data: {
      orderNo: `ORD-MSO-${next()}`,
      type: 'print',
      printTaskId: taskId,
      endUserId,
      terminalId,
      amountCents: orderFields.amountCents ?? 200,
      discountCents: orderFields.discountCents ?? 0,
      refundedAmountCents: orderFields.refundedAmountCents ?? 0,
      payStatus: orderFields.payStatus ?? 'paid',
      paymentSource: orderFields.paymentSource === undefined ? 'sandbox' : orderFields.paymentSource,
      paidAt: orderFields.payStatus === 'unpaid' ? null : createdAt,
      taskStatus: 'completed',
      createdAt,
    },
  })
  made.orders.push(order.id)
  return { taskId, orderId: order.id }
}

function assertZeroPii(replyText: string, items: Array<Record<string, unknown>>, label: string) {
  for (const item of items) {
    for (const forbidden of FORBIDDEN_KEYS) {
      assert.equal(Object.prototype.hasOwnProperty.call(item, forbidden), false, `${label} 不得包含敏感键 ${forbidden}`)
    }
  }
  for (const leak of [TAX_ID, EMAIL, TITLE_COMPANY, 'weixin://wxpay/secret_qr_', 'wx_prepay_secret_', 'wx_txn_secret_', 'SVC-MSO-', 'wx_secret_openid_']) {
    assert.equal(replyText.includes(leak), false, `${label} 响应不得泄露敏感原文 ${leak}`)
  }
}

async function main() {
  await prisma.onModuleInit()
  const app = await NestFactory.create(MemberServiceOrdersHttpModule, { logger: ['error'] })
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors) => new BadRequestException({
      error: { code: 'VALIDATION_FAILED', message: flattenValidationErrors(errors).join('; ') || '请求参数校验失败' },
    }),
  }))
  app.useGlobalFilters(new HttpExceptionFilter())
  await app.listen(0, '127.0.0.1')
  const addr = app.getHttpServer().address() as { port: number }
  base = `http://127.0.0.1:${addr.port}`

  try {
    const { terminalId, headers: kioskHeaders } = await createKioskTerminal()
    const memberA = await createMember()
    const memberB = await createMember()
    const authA = { Authorization: `Bearer ${memberA.token}` }
    const authB = { Authorization: `Bearer ${memberB.token}` }

    await check('1. 未登录 / 错 token / 失效会话均 401', async () => {
      const anon = await call('GET', '/me/service-orders')
      assert.equal(anon.status, 401)
      assert.equal(anon.json.error?.code, 'MEMBER_MISSING_TOKEN')

      const badTok = await call('GET', '/me/service-orders', { headers: { Authorization: 'Bearer not-a-jwt' } })
      assert.equal(badTok.status, 401)
      assert.equal(badTok.json.error?.code, 'MEMBER_TOKEN_INVALID')

      const memberGone = await createMember()
      await redis.revokeMemberSessions(memberGone.id)
      const expired = await call('GET', '/me/service-orders', { headers: { Authorization: `Bearer ${memberGone.token}` } })
      assert.equal(expired.status, 401)
      assert.equal(expired.json.error?.code, 'MEMBER_SESSION_EXPIRED')
    })

    await check('2. 跨用户隔离 + 匿名单排除 + 只返实付 > 0 非草稿非支付失败单 + 拒多余查询参数', async () => {
      const now = Date.now()
      const validPaidId = await createServiceOrder(terminalId, {
        endUserId: memberA.id, serviceKey: 'resume_optimize', status: 'paid', amountCents: 100, createdAt: new Date(now - 10_000),
      })
      const validConsumedId = await createServiceOrder(terminalId, {
        endUserId: memberA.id, serviceKey: 'mock_interview', status: 'consumed', amountCents: 200, settledAt: new Date(now - 5_000), createdAt: new Date(now - 20_000),
      })
      // 应被排除的单：草稿 pending、关闭 closed、0 元单、paymentFailed=true、他人单、匿名单
      await createServiceOrder(terminalId, { endUserId: memberA.id, status: 'pending', amountCents: 100 })
      await createServiceOrder(terminalId, { endUserId: memberA.id, status: 'closed', amountCents: 100 })
      await createServiceOrder(terminalId, { endUserId: memberA.id, status: 'paid', amountCents: 0 })
      await createServiceOrder(terminalId, { endUserId: memberA.id, status: 'paid', amountCents: 100, paymentFailed: true })
      const bOrderId = await createServiceOrder(terminalId, { endUserId: memberB.id, serviceKey: 'scan', status: 'paid', amountCents: 300 })
      await createServiceOrder(terminalId, { endUserId: null, serviceKey: 'scan', status: 'paid', amountCents: 100 })

      const resA = await call<{ items: Array<Record<string, unknown>>; nextCursor: string | null; total: number }>('GET', '/me/service-orders', { headers: authA })
      assert.equal(resA.status, 200, resA.text)
      assert.equal(resA.json.data?.total, 2)
      assert.deepEqual(resA.json.data?.items.map((x) => x['id']), [validPaidId, validConsumedId])
      assert.equal(resA.json.data?.items[0]?.['serviceName'], 'AI 简历优化')
      assert.equal(resA.json.data?.items[1]?.['serviceName'], 'AI 模拟面试')
      assertZeroPii(resA.text, resA.json.data?.items ?? [], 'memberA 服务单')

      const resB = await call<{ items: Array<Record<string, unknown>>; total: number }>('GET', '/me/service-orders', { headers: authB })
      assert.equal(resB.status, 200)
      assert.deepEqual(resB.json.data?.items.map((x) => x['id']), [bOrderId])
      assert.equal(resB.json.data?.items[0]?.['serviceName'], '扫描')

      const extraParam = await call('GET', `/me/service-orders?endUserId=${encodeURIComponent(memberB.id)}`, { headers: authA })
      assert.equal(extraParam.status, 400, extraParam.text)
      assert.equal(extraParam.json.error?.code, 'VALIDATION_FAILED')
    })

    await check('3. 游标分页（createdAt DESC, id DESC 含同毫秒稳定翻页）与非法参数 400 VALIDATION_FAILED', async () => {
      const m = await createMember()
      const auth = { Authorization: `Bearer ${m.token}` }
      const sameTime = new Date(Date.now() - 30_000)
      const id1 = await createServiceOrder(terminalId, { id: `so_a_${tag}`, endUserId: m.id, status: 'paid', amountCents: 100, createdAt: sameTime })
      const id2 = await createServiceOrder(terminalId, { id: `so_b_${tag}`, endUserId: m.id, status: 'paid', amountCents: 100, createdAt: sameTime })
      const id3 = await createServiceOrder(terminalId, { id: `so_c_${tag}`, endUserId: m.id, status: 'paid', amountCents: 100, createdAt: new Date(sameTime.getTime() + 5_000) })

      type Page = { items: Array<{ id: string }>; nextCursor: string | null; total: number }
      const p1 = await call<Page>('GET', '/me/service-orders?pageSize=2', { headers: auth })
      assert.equal(p1.status, 200, p1.text)
      assert.equal(p1.json.data?.total, 3)
      assert.deepEqual(p1.json.data?.items.map((x) => x.id), [id3, id2])
      assert.ok(p1.json.data?.nextCursor)

      const p2 = await call<Page>('GET', `/me/service-orders?pageSize=2&cursor=${encodeURIComponent(p1.json.data!.nextCursor!)}`, { headers: auth })
      assert.equal(p2.status, 200, p2.text)
      assert.deepEqual(p2.json.data?.items.map((x) => x.id), [id1])
      assert.equal(p2.json.data?.nextCursor, null)

      const capped = await call<Page>('GET', '/me/service-orders?pageSize=999', { headers: auth })
      assert.equal(capped.status, 200)
      assert.equal(capped.json.data?.items.length, 3)

      for (const badQuery of ['cursor=not-valid', 'cursor=%40%40%40', 'cursor=bm90LWEtY3Vyc29y', 'pageSize=0', 'pageSize=-3', 'pageSize=abc', 'pageSize=1.5']) {
        const bad = await call('GET', `/me/service-orders?${badQuery}`, { headers: auth })
        assert.equal(bad.status, 400, `${badQuery}: ${bad.text}`)
        assert.equal(bad.json.error?.code, 'VALIDATION_FAILED', badQuery)
      }
    })

    await check('4. canInvoice / invoiceStatus 全状态矩阵 + 零 PII（含旧 returned + 新 submitted 优先级）', async () => {
      const m = await createMember()
      const auth = { Authorization: `Bearer ${m.token}` }
      const baseMs = Date.now() - 100_000

      const idNone = await createServiceOrder(terminalId, { endUserId: m.id, status: 'paid', amountCents: 100, createdAt: new Date(baseMs + 7000) })
      const idReturned = await createServiceOrder(terminalId, { endUserId: m.id, status: 'consumed', amountCents: 150, createdAt: new Date(baseMs + 6000) })
      const idSubmitted = await createServiceOrder(terminalId, { endUserId: m.id, status: 'paid', amountCents: 200, createdAt: new Date(baseMs + 5000) })
      const idIssued = await createServiceOrder(terminalId, { endUserId: m.id, status: 'consumed', amountCents: 250, createdAt: new Date(baseMs + 4000) })
      const idRefunding = await createServiceOrder(terminalId, { endUserId: m.id, status: 'refunding', amountCents: 100, createdAt: new Date(baseMs + 3000) })
      const idRefundFailed = await createServiceOrder(terminalId, { endUserId: m.id, status: 'refund_failed', amountCents: 100, createdAt: new Date(baseMs + 2000) })
      const idRefunded = await createServiceOrder(terminalId, {
        endUserId: m.id, status: 'refunded', amountCents: 100, refundedAt: new Date(baseMs + 9000), refundReason: 'not_made', createdAt: new Date(baseMs + 1000),
      })

      const reqReturned = await prisma.invoiceRequest.create({
        data: { orderKind: 'service', orderId: idReturned, endUserId: m.id, titleType: 'company', title: TITLE_COMPANY, taxId: TAX_ID, email: EMAIL, amountCents: 150, status: 'returned', returnReason: '抬头不对' },
      })
      // 同一单先有一条较新的 returned（故意模拟），再有一条未退回 submitted：必须优先取未退回 submitted！
      await prisma.invoiceRequest.create({
        data: { orderKind: 'service', orderId: idSubmitted, endUserId: m.id, titleType: 'company', title: TITLE_COMPANY, taxId: TAX_ID, email: EMAIL, amountCents: 200, status: 'returned', createdAt: new Date(baseMs + 5500) },
      })
      const reqSubmitted = await prisma.invoiceRequest.create({
        data: { orderKind: 'service', orderId: idSubmitted, endUserId: m.id, titleType: 'company', title: TITLE_COMPANY, taxId: TAX_ID, email: EMAIL, amountCents: 200, status: 'submitted', createdAt: new Date(baseMs + 5400) },
      })
      const reqIssued = await prisma.invoiceRequest.create({
        data: { orderKind: 'service', orderId: idIssued, endUserId: m.id, titleType: 'company', title: TITLE_COMPANY, taxId: TAX_ID, email: EMAIL, amountCents: 250, status: 'issued', issuedAt: new Date() },
      })

      const res = await call<{ items: Array<Record<string, unknown>>; total: number }>('GET', '/me/service-orders', { headers: auth })
      assert.equal(res.status, 200, res.text)
      assert.equal(res.json.data?.total, 7)
      const byId = new Map((res.json.data?.items ?? []).map((row) => [String(row['id']), row]))

      assert.equal(byId.get(idNone)?.['canInvoice'], true)
      assert.equal(byId.get(idNone)?.['invoiceStatus'], 'none')
      assert.equal(byId.get(idNone)?.['invoiceRequestId'], null)

      assert.equal(byId.get(idReturned)?.['canInvoice'], true)
      assert.equal(byId.get(idReturned)?.['invoiceStatus'], 'returned')
      assert.equal(byId.get(idReturned)?.['invoiceRequestId'], reqReturned.id)

      assert.equal(byId.get(idSubmitted)?.['canInvoice'], false)
      assert.equal(byId.get(idSubmitted)?.['invoiceStatus'], 'submitted')
      assert.equal(byId.get(idSubmitted)?.['invoiceRequestId'], reqSubmitted.id)

      assert.equal(byId.get(idIssued)?.['canInvoice'], false)
      assert.equal(byId.get(idIssued)?.['invoiceStatus'], 'issued')
      assert.equal(byId.get(idIssued)?.['invoiceRequestId'], reqIssued.id)

      for (const blockedId of [idRefunding, idRefundFailed, idRefunded]) {
        assert.equal(byId.get(blockedId)?.['canInvoice'], false, `${blockedId} 不得允许开票`)
        assert.equal(byId.get(blockedId)?.['invoiceStatus'], 'none')
      }
      assertZeroPii(res.text, res.json.data?.items ?? [], '全状态服务单')
    })

    await check('5. GET /api/v1/me/print-orders 补齐实付 > 0 打印单开票态 + 免费/无 Order 零新增键 + 零 PII', async () => {
      const m = await createMember()
      const auth = { Authorization: `Bearer ${m.token}` }
      const baseMs = Date.now() - 200_000

      const pPaid = await createPrintOrderPair(m.id, terminalId, { amountCents: 200, payStatus: 'paid' }, new Date(baseMs + 7000), '可开票打印.pdf')
      const pSubmitted = await createPrintOrderPair(m.id, terminalId, { amountCents: 300, payStatus: 'paid' }, new Date(baseMs + 6000), '已提交打印.pdf')
      const pIssued = await createPrintOrderPair(m.id, terminalId, { amountCents: 400, payStatus: 'paid' }, new Date(baseMs + 5000), '已开打印.pdf')
      const pReturned = await createPrintOrderPair(m.id, terminalId, { amountCents: 250, payStatus: 'paid' }, new Date(baseMs + 4000), '退回重开打印.pdf')
      const pRefunded = await createPrintOrderPair(m.id, terminalId, { amountCents: 200, payStatus: 'refunded', refundedAmountCents: 200 }, new Date(baseMs + 3000), '已退款打印.pdf')
      const pZeroNet = await createPrintOrderPair(m.id, terminalId, { amountCents: 200, discountCents: 200, payStatus: 'paid' }, new Date(baseMs + 2500), '全抵扣打印.pdf')
      const pFree = await createPrintOrderPair(m.id, terminalId, { amountCents: 0, payStatus: 'paid', paymentSource: 'free' }, new Date(baseMs + 2000), '免费打印.pdf')
      const pNoOrder = await createPrintOrderPair(m.id, terminalId, null, new Date(baseMs + 1000), '历史无单打印.pdf')

      const rSub = await prisma.invoiceRequest.create({
        data: { orderKind: 'print', orderId: pSubmitted.orderId!, endUserId: m.id, titleType: 'company', title: TITLE_COMPANY, taxId: TAX_ID, email: EMAIL, amountCents: 300, status: 'submitted' },
      })
      const rIss = await prisma.invoiceRequest.create({
        data: { orderKind: 'print', orderId: pIssued.orderId!, endUserId: m.id, titleType: 'company', title: TITLE_COMPANY, taxId: TAX_ID, email: EMAIL, amountCents: 400, status: 'issued', issuedAt: new Date() },
      })
      const rRet = await prisma.invoiceRequest.create({
        data: { orderKind: 'print', orderId: pReturned.orderId!, endUserId: m.id, titleType: 'company', title: TITLE_COMPANY, taxId: TAX_ID, email: EMAIL, amountCents: 250, status: 'returned', returnReason: '重填' },
      })

      const res = await call<{ items: Array<Record<string, unknown>> }>('GET', '/me/print-orders', { headers: auth })
      assert.equal(res.status, 200, res.text)
      const byTask = new Map((res.json.data?.items ?? []).map((row) => [String(row['id']), row]))

      assert.equal(byTask.get(pPaid.taskId)?.['orderId'], pPaid.orderId)
      assert.equal(byTask.get(pPaid.taskId)?.['payableAmountCents'], 200)
      assert.equal(byTask.get(pPaid.taskId)?.['canInvoice'], true)
      assert.equal(byTask.get(pPaid.taskId)?.['invoiceStatus'], 'none')
      assert.equal(byTask.get(pPaid.taskId)?.['invoiceRequestId'], null)

      assert.equal(byTask.get(pSubmitted.taskId)?.['payableAmountCents'], 300)
      assert.equal(byTask.get(pSubmitted.taskId)?.['canInvoice'], false)
      assert.equal(byTask.get(pSubmitted.taskId)?.['invoiceStatus'], 'submitted')
      assert.equal(byTask.get(pSubmitted.taskId)?.['invoiceRequestId'], rSub.id)

      assert.equal(byTask.get(pIssued.taskId)?.['payableAmountCents'], 400)
      assert.equal(byTask.get(pIssued.taskId)?.['canInvoice'], false)
      assert.equal(byTask.get(pIssued.taskId)?.['invoiceStatus'], 'issued')
      assert.equal(byTask.get(pIssued.taskId)?.['invoiceRequestId'], rIss.id)

      assert.equal(byTask.get(pReturned.taskId)?.['payableAmountCents'], 250)
      assert.equal(byTask.get(pReturned.taskId)?.['canInvoice'], true)
      assert.equal(byTask.get(pReturned.taskId)?.['invoiceStatus'], 'returned')
      assert.equal(byTask.get(pReturned.taskId)?.['invoiceRequestId'], rRet.id)

      assert.equal(byTask.get(pRefunded.taskId)?.['canInvoice'], false)
      assert.equal(byTask.get(pZeroNet.taskId)?.['payableAmountCents'], 0)
      assert.equal(byTask.get(pZeroNet.taskId)?.['canInvoice'], false)

      // 免费单与无 Order 历史单保持 100% 向后兼容：不附加实付/开票字段键
      for (const legacyTaskId of [pFree.taskId, pNoOrder.taskId]) {
        const row = byTask.get(legacyTaskId)!
        assert.equal(Object.prototype.hasOwnProperty.call(row, 'payableAmountCents'), false)
        assert.equal(Object.prototype.hasOwnProperty.call(row, 'canInvoice'), false)
        assert.equal(Object.prototype.hasOwnProperty.call(row, 'invoiceStatus'), false)
        assert.equal(Object.prototype.hasOwnProperty.call(row, 'invoiceRequestId'), false)
      }
      assertZeroPii(res.text, res.json.data?.items ?? [], '打印单联查')
    })

    await check('6. 真实 HTTP 端到端闭环：服务单可开票 → 出码 → resolve+submit → poll 已提交 → 列表变 submitted → 后台标已开 → 列表变 issued', async () => {
      const m = await createMember()
      const auth = { Authorization: `Bearer ${m.token}` }
      const svcId = await createServiceOrder(terminalId, {
        endUserId: m.id, serviceKey: 'resume_optimize', status: 'paid', amountCents: 100,
      })

      // Step 1: 列表可开票
      const before = await call<{ items: Array<Record<string, unknown>> }>('GET', '/me/service-orders', { headers: auth })
      assert.equal(before.status, 200)
      assert.equal(before.json.data?.items[0]?.['canInvoice'], true)
      assert.equal(before.json.data?.items[0]?.['invoiceStatus'], 'none')

      // Step 2: 一体机出码
      const created = await call<{
        sessionId: string
        sceneToken: string
        codeUrl: string
        controlToken: string
        status: string
      }>('POST', '/kiosk/invoice-sessions', {
        headers: { ...kioskHeaders, ...auth },
        body: { orderKind: 'service', orderId: svcId },
      })
      assert.equal(created.status, 201, created.text)
      const session = created.json.data!
      made.keys.push(`invoice_session:${session.sessionId}`, `invoice_scene:${session.sceneToken}`)
      assert.equal(session.status, '等手机填写')
      assert.ok(session.codeUrl.includes(`/k/i/${session.sceneToken}`))

      // Step 3: 手机兑换场景码 + 提交开票
      const resolved = await call<{ sessionId: string; submitToken: string }>('POST', '/kiosk/invoice-sessions/scene/resolve', {
        body: { scene: session.sceneToken },
      })
      assert.equal(resolved.status, 201, resolved.text)
      const submitted = await call<{ status: string; requestId: string }>('POST', `/kiosk/invoice-sessions/${resolved.json.data!.sessionId}/submit`, {
        body: {
          submitToken: resolved.json.data!.submitToken,
          titleType: 'company',
          title: TITLE_COMPANY,
          taxId: TAX_ID,
          email: EMAIL,
        },
      })
      assert.equal(submitted.status, 201, submitted.text)
      assert.equal(submitted.json.data?.status, '已提交')
      const requestId = submitted.json.data!.requestId

      // Step 4: 一体机轮询变「已提交」（零 PII）
      const polled = await call<{ status: string }>('GET', `/kiosk/invoice-sessions/${session.sessionId}`, {
        headers: { ...kioskHeaders, 'x-invoice-control': session.controlToken },
      })
      assert.equal(polled.status, 200, polled.text)
      assert.deepEqual(polled.json.data, { status: '已提交' })
      assert.equal(polled.text.includes(TAX_ID), false)
      assert.equal(polled.text.includes(EMAIL), false)

      // Step 5: 刷新服务单列表变 submitted 且 canInvoice=false
      const afterSubmit = await call<{ items: Array<Record<string, unknown>> }>('GET', '/me/service-orders', { headers: auth })
      assert.equal(afterSubmit.status, 200)
      assert.equal(afterSubmit.json.data?.items[0]?.['canInvoice'], false)
      assert.equal(afterSubmit.json.data?.items[0]?.['invoiceStatus'], 'submitted')
      assert.equal(afterSubmit.json.data?.items[0]?.['invoiceRequestId'], requestId)
      assertZeroPii(afterSubmit.text, afterSubmit.json.data?.items ?? [], '提交后服务单')

      // Step 6: 管理员标已开 → 刷新服务单列表变 issued 且 canInvoice=false
      await adminInvoice.markIssued(requestId, { operatorId: 'admin-verify-p2c2', invoiceNo: `INV-${tag}` })
      const afterIssue = await call<{ items: Array<Record<string, unknown>> }>('GET', '/me/service-orders', { headers: auth })
      assert.equal(afterIssue.status, 200)
      assert.equal(afterIssue.json.data?.items[0]?.['canInvoice'], false)
      assert.equal(afterIssue.json.data?.items[0]?.['invoiceStatus'], 'issued')
      assert.equal(afterIssue.json.data?.items[0]?.['invoiceRequestId'], requestId)
      assertZeroPii(afterIssue.text, afterIssue.json.data?.items ?? [], '已开后服务单')
    })

    await check('7. 材料包 1 单 3 任务（主任务 + 2 子任务）四态收费与开票字段一致 + 跨用户 orderId 归属隔离', async () => {
      const member = await createMember()
      const outsider = await createMember()
      const { terminalId } = await createKioskTerminal()
      const t0 = Date.now() - 200_000

      async function createPack(
        label: string,
        orderFields: {
          amountCents: number
          discountCents?: number
          refundedAmountCents?: number
          payStatus: string
          withPendingRefund?: boolean
        },
        offsetMs: number,
      ): Promise<{ orderId: string; orderNo: string; taskIds: [string, string, string] }> {
        const createdAt = new Date(t0 + offsetMs)
        const mainId = `ptask-pack-${label}-0-${next()}`
        const sub1Id = `ptask-pack-${label}-1-${next()}`
        const sub2Id = `ptask-pack-${label}-2-${next()}`
        const orderNo = `ORD-PACK-${label}-${next()}`

        await prisma.printTask.create({
          data: {
            id: mainId,
            endUserId: member.id,
            terminalId,
            fileUrl: `sig://secret-${mainId}`,
            fileMd5: `sha256-${mainId}`,
            status: 'completed',
            completedAt: createdAt,
            createdAt,
            paramsJson: JSON.stringify({ fileName: `${label}-主任务.pdf`, copies: 1, colorMode: 'black_white', duplex: 'simplex', paperSize: 'A4' }),
          },
        })
        made.printTasks.push(mainId)

        const order = await prisma.order.create({
          data: {
            orderNo,
            type: 'print',
            printTaskId: mainId,
            endUserId: member.id,
            terminalId,
            amountCents: orderFields.amountCents,
            discountCents: orderFields.discountCents ?? 0,
            refundedAmountCents: orderFields.refundedAmountCents ?? 0,
            payStatus: orderFields.payStatus,
            paymentSource: 'offline',
            paidAt: createdAt,
            taskStatus: 'completed',
            createdAt,
          },
        })
        made.orders.push(order.id)

        // 主任务与 2 个子任务的 PrintTask.orderId 均指向该 Order；Order.printTaskId 只指向主任务。
        await prisma.printTask.update({ where: { id: mainId }, data: { orderId: order.id } })
        for (const [idx, subId] of [[1, sub1Id], [2, sub2Id]] as const) {
          const subAt = new Date(createdAt.getTime() + idx * 100)
          await prisma.printTask.create({
            data: {
              id: subId,
              endUserId: member.id,
              terminalId,
              orderId: order.id,
              fileUrl: `sig://secret-${subId}`,
              fileMd5: `sha256-${subId}`,
              status: 'completed',
              completedAt: subAt,
              createdAt: subAt,
              paramsJson: JSON.stringify({ fileName: `${label}-子任务${idx}.pdf`, copies: 1, colorMode: 'black_white', duplex: 'simplex', paperSize: 'A4' }),
            },
          })
          made.printTasks.push(subId)
        }

        if (orderFields.withPendingRefund) {
          await prisma.refund.create({
            data: {
              orderId: order.id,
              refundNo: `REF-PACK-${next()}`,
              amountCents: orderFields.amountCents,
              reason: 'manual_refund',
              channel: 'offline',
              status: 'pending',
            },
          })
        }

        return { orderId: order.id, orderNo, taskIds: [mainId, sub1Id, sub2Id] }
      }

      const paidPack = await createPack('paid', { amountCents: 300, discountCents: 100, payStatus: 'paid' }, 1_000)
      const partialPack = await createPack('partial', { amountCents: 300, refundedAmountCents: 100, payStatus: 'partial_refunded' }, 2_000)
      const refundingPack = await createPack('refunding', { amountCents: 300, payStatus: 'refunding', withPendingRefund: true }, 3_000)
      const refundedPack = await createPack('refunded', { amountCents: 300, refundedAmountCents: 300, payStatus: 'refunded' }, 4_000)

      // 跨用户归属隔离负例：outsider 拥有一笔 Order，member 名下任务即使 orderId 误指向他人 Order 也不得读出他人收费/开票字段。
      const outsiderPair = await createPrintOrderPair(outsider.id, terminalId, { amountCents: 500, payStatus: 'paid' }, new Date(t0 + 5_000), '他人订单.pdf')
      const foreignLinkedTaskId = `ptask-pack-foreign-${next()}`
      await prisma.printTask.create({
        data: {
          id: foreignLinkedTaskId,
          endUserId: member.id,
          terminalId,
          orderId: outsiderPair.orderId,
          fileUrl: `sig://secret-${foreignLinkedTaskId}`,
          fileMd5: `sha256-${foreignLinkedTaskId}`,
          status: 'completed',
          completedAt: new Date(t0 + 5_100),
          createdAt: new Date(t0 + 5_100),
          paramsJson: JSON.stringify({ fileName: '跨人引用负例.pdf', copies: 1, colorMode: 'black_white', duplex: 'simplex', paperSize: 'A4' }),
        },
      })
      made.printTasks.push(foreignLinkedTaskId)

      const res = await call<{ items: Array<Record<string, unknown>> }>('GET', '/me/print-orders?pageSize=50', {
        headers: { Authorization: `Bearer ${member.token}` },
      })
      assert.equal(res.status, 200, res.text)
      assertZeroPii(res.text, res.json.data?.items ?? [], '材料包打印单')
      const byTaskId = new Map((res.json.data?.items ?? []).map((item) => [String(item['id']), item]))

      const assertPackUniform = (
        pack: { orderId: string; orderNo: string; taskIds: [string, string, string] },
        expected: {
          amountCents: number
          discountCents: number
          payableAmountCents: number
          payStatus: string
          canInvoice: boolean
          invoiceStatus: string
          invoiceRequestId: string | null
        },
        stateLabel: string,
      ) => {
        for (const taskId of pack.taskIds) {
          const row = byTaskId.get(taskId)
          assert.ok(row, `${stateLabel} 缺少任务 ${taskId}`)
          assert.equal(row['orderId'], pack.orderId, `${stateLabel} ${taskId} orderId 不一致`)
          assert.equal(row['orderNo'], pack.orderNo, `${stateLabel} ${taskId} orderNo 不一致`)
          assert.equal(row['amountCents'], expected.amountCents, `${stateLabel} ${taskId} amountCents 不一致`)
          assert.equal(row['discountCents'], expected.discountCents, `${stateLabel} ${taskId} discountCents 不一致`)
          assert.equal(row['payableAmountCents'], expected.payableAmountCents, `${stateLabel} ${taskId} payableAmountCents 不一致`)
          assert.equal(row['payStatus'], expected.payStatus, `${stateLabel} ${taskId} payStatus 不一致`)
          assert.equal(row['canInvoice'], expected.canInvoice, `${stateLabel} ${taskId} canInvoice 不一致`)
          assert.equal(row['invoiceStatus'], expected.invoiceStatus, `${stateLabel} ${taskId} invoiceStatus 不一致`)
          assert.equal(row['invoiceRequestId'], expected.invoiceRequestId, `${stateLabel} ${taskId} invoiceRequestId 不一致`)
        }
      }

      assertPackUniform(paidPack, { amountCents: 300, discountCents: 100, payableAmountCents: 200, payStatus: 'paid', canInvoice: true, invoiceStatus: 'none', invoiceRequestId: null }, 'paid')
      assertPackUniform(partialPack, { amountCents: 300, discountCents: 0, payableAmountCents: 300, payStatus: 'partial_refunded', canInvoice: false, invoiceStatus: 'none', invoiceRequestId: null }, 'partial_refunded')
      assertPackUniform(refundingPack, { amountCents: 300, discountCents: 0, payableAmountCents: 300, payStatus: 'refunding', canInvoice: false, invoiceStatus: 'none', invoiceRequestId: null }, 'refunding')
      assertPackUniform(refundedPack, { amountCents: 300, discountCents: 0, payableAmountCents: 300, payStatus: 'refunded', canInvoice: false, invoiceStatus: 'none', invoiceRequestId: null }, 'refunded')

      const foreignRow = byTaskId.get(foreignLinkedTaskId)
      assert.ok(foreignRow, '跨人引用负例任务应存在')
      assert.equal(foreignRow['orderId'], null, '不得透传他人 Order 的 orderId')
      assert.equal(foreignRow['amountCents'], null, '不得透传他人 Order 的 amountCents')
      assert.equal(foreignRow['payStatus'], null, '不得透传他人 Order 的 payStatus')
      assert.equal(Object.prototype.hasOwnProperty.call(foreignRow, 'payableAmountCents'), false, '他人 Order 不得出现 payableAmountCents')
      assert.equal(Object.prototype.hasOwnProperty.call(foreignRow, 'canInvoice'), false, '他人 Order 不得出现 canInvoice')
      assert.equal(Object.prototype.hasOwnProperty.call(foreignRow, 'invoiceStatus'), false, '他人 Order 不得出现 invoiceStatus')

      // 为 paidPack 提交开票申请后，主任务与 2 个子任务同步变为 submitted 且 canInvoice=false
      const submittedPackReq = await invoiceRequests.submit(member.id, {
        orderKind: 'print',
        orderId: paidPack.orderId,
        titleType: 'personal',
        title: '材料包测试个人抬头',
        email: EMAIL,
      })
      const afterSubmit = await call<{ items: Array<Record<string, unknown>> }>('GET', '/me/print-orders?pageSize=50', {
        headers: { Authorization: `Bearer ${member.token}` },
      })
      assert.equal(afterSubmit.status, 200, afterSubmit.text)
      const afterMap = new Map((afterSubmit.json.data?.items ?? []).map((item) => [String(item['id']), item]))
      for (const taskId of paidPack.taskIds) {
        const row = afterMap.get(taskId)
        assert.ok(row)
        assert.equal(row['canInvoice'], false, `提交后 ${taskId} 不得再开票`)
        assert.equal(row['invoiceStatus'], 'submitted', `提交后 ${taskId} 应为 submitted`)
        assert.equal(row['invoiceRequestId'], submittedPackReq.id, `提交后 ${taskId} 应关联同一申请 id`)
      }
      assertZeroPii(afterSubmit.text, afterSubmit.json.data?.items ?? [], '材料包提交开票后打印单')
    })

    console.log(`PASS verify:member-service-orders（${passed.length} 组）`)
  } finally {
    await new Promise<void>((done) => app.getHttpServer().close(() => done()))
  }
}

async function cleanup(): Promise<void> {
  const invoices = await prisma.invoiceRequest.findMany({ where: { endUserId: { in: made.members } }, select: { id: true } })
  if (invoices.length > 0) {
    await prisma.auditLog.deleteMany({ where: { targetId: { in: invoices.map((row) => row.id) } } })
  }
  await prisma.invoiceRequest.deleteMany({ where: { endUserId: { in: made.members } } })
  await prisma.serviceOrder.deleteMany({ where: { id: { in: made.serviceOrders } } })
  await prisma.refund.deleteMany({ where: { orderId: { in: made.orders } } })
  await prisma.order.deleteMany({ where: { id: { in: made.orders } } })
  await prisma.printTask.deleteMany({ where: { id: { in: made.printTasks } } })
  await prisma.terminal.deleteMany({ where: { id: { in: made.terminals } } })
  await prisma.organization.deleteMany({ where: { id: { in: made.orgs } } })
  for (const id of made.members) await redis.revokeMemberSessions(id)
  await prisma.endUser.deleteMany({ where: { id: { in: made.members } } })
  for (const key of made.keys) await client.del(key)
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    try {
      await cleanup()
    } finally {
      client.disconnect()
      await prisma.onModuleDestroy()
    }
  })
