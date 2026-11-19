import 'reflect-metadata'

/**
 * verify:invoice-http —— 开票接口打真实 HTTP。SQLite（build-and-verify）与 PostgreSQL（postgres-readiness）都跑。
 *
 * 起一个只挂开票两个控制器（一体机会话、会员接口）的最小 Nest 应用，随机端口；全局校验管道与 main.ts 同参
 * （whitelist + forbidNonWhitelisted + transform，失败包成 VALIDATION_FAILED），错误信封用真 HttpExceptionFilter。
 * 守卫是真的：TerminalIdentityGuard 走真 TerminalSessionService（会话写在真 Redis 里），
 * EndUserAuthGuard 走真 JwtService 与真 Redis 会员会话。数据写真 PrismaService（隔离库）。
 *
 * Redis 只许本机回环并显式声明隔离（VERIFICATION_REDIS_TARGET=isolated）。写的行与键带随机标签，跑完删净。
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
import { PrismaService } from '../src/prisma/prisma.service'
import { TERMINAL_TOKEN_VALIDATOR, TerminalSessionService } from '../src/terminals/terminal-session.service'
import { TerminalIdentityGuard } from '../src/terminals/terminal-identity.guard'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'

assertIsolatedVerificationDatabase()
assert.equal(process.env['VERIFICATION_REDIS_TARGET'], 'isolated', '真 Redis 必须显式声明隔离')
const redisTarget = new URL(process.env['REDIS_URL'] ?? 'redis://127.0.0.1:6379')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(redisTarget.hostname), '真 Redis 只允许本机回环')
process.env['FILE_SIGNING_SECRET'] ??= 'verify-invoice-http-signing-secret-0123456789'
const JWT_SECRET = process.env['JWT_SECRET'] && process.env['JWT_SECRET'].length >= 16
  ? process.env['JWT_SECRET']
  : 'verify-invoice-http-jwt-secret-0123456789'

const prisma = new PrismaService()
const client = new Redis(redisTarget.toString(), { maxRetriesPerRequest: 1, connectTimeout: 1000 })
const redis = new RedisService(client)
const jwt = new JwtService({ secret: JWT_SECRET, signOptions: { audience: 'enduser', expiresIn: '30m' } })
const audit = new AuditService(prisma)
const requests = new InvoiceRequestsService(prisma)
const sessions = new InvoiceSessionsService(redis, requests)
const terminalSessions = new TerminalSessionService(redis, prisma, {
  validateTerminalToken: async () => { throw new Error('本门禁不换票') },
})
const admin = new AdminInvoiceService(prisma, audit, requests)
const tag = randomUUID().replace(/-/g, '').slice(0, 12)
const TAX_ID = '91000000MA0000000N'
const EMAIL = 'finance.desk@example.com'
const made = { members: [] as string[], orgs: [] as string[], terminals: [] as string[], orders: [] as string[], keys: [] as string[] }
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
  controllers: [KioskInvoiceSessionsController, MemberInvoiceController],
  providers: [
    { provide: PrismaService, useValue: prisma },
    { provide: RedisService, useValue: redis },
    { provide: JwtService, useValue: jwt },
    { provide: TerminalSessionService, useValue: terminalSessions },
    { provide: TERMINAL_TOKEN_VALIDATOR, useValue: {} },
    { provide: InvoiceRequestsService, useValue: requests },
    { provide: InvoiceSessionsService, useValue: sessions },
    EndUserAuthGuard,
    TerminalIdentityGuard,
  ],
})
class InvoiceHttpModule {}

interface Reply {
  status: number
  text: string
  json: { success?: boolean; data?: any; error?: { code?: string; message?: string } }
}

async function call(method: 'GET' | 'POST', path: string, options: { body?: unknown; headers?: Record<string, string> } = {}): Promise<Reply> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { Accept: 'application/json', ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }), ...options.headers },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  })
  const text = await res.text()
  return { status: res.status, text, json: text ? JSON.parse(text) : {} }
}

async function check(label: string, operation: () => Promise<void>) {
  try {
    await operation()
  } catch (error) {
    console.error(`FAIL ${label}`)
    throw error
  }
  passed.push(label)
  console.log(`PASS ${label}`)
}

async function member(): Promise<{ id: string; token: string }> {
  const row = await prisma.endUser.create({
    data: { phoneHash: `verify-invoice-http-${next()}`, phoneEnc: `verify-invoice-http-not-a-phone-${randomBytes(6).toString('hex')}` },
  })
  made.members.push(row.id)
  const sessionId = randomUUID()
  await redis.registerMemberSession(row.id, sessionId, 1800)
  return { id: row.id, token: jwt.sign({ sub: row.id }, { jwtid: sessionId, audience: 'enduser', expiresIn: '30m' }) }
}

async function kioskTerminal(): Promise<Record<string, string>> {
  const orgId = `verify-invoice-http-org-${next()}`
  await prisma.organization.create({ data: { id: orgId, name: '青岛某人力资源服务公司', type: 'licensed_hr_agency' } })
  made.orgs.push(orgId)
  const terminalId = `verify-invoice-http-term-${next()}`
  await prisma.terminal.create({
    data: { id: terminalId, terminalCode: terminalId, agentToken: randomBytes(16).toString('hex'), deviceFingerprint: randomBytes(16).toString('hex'), orgId, orgBoundAt: new Date() },
  })
  made.terminals.push(terminalId)
  const sessionToken = randomBytes(32).toString('base64url')
  const key = terminalSessions.sessionKey(sessionToken)
  made.keys.push(key)
  const issuedAt = new Date()
  await redis.setEx(key, 1800, JSON.stringify({ terminalId, generation: 0, issuedAt: issuedAt.toISOString(), expiresAt: new Date(issuedAt.getTime() + 1_800_000).toISOString() }))
  return { 'x-terminal-id': terminalId, 'x-terminal-session-token': sessionToken }
}

async function printOrder(endUserId: string, terminalId: string, fields: Record<string, unknown> = {}): Promise<string> {
  const row = await prisma.order.create({
    data: {
      orderNo: `VINVH-${next()}`, endUserId, terminalId, payStatus: 'paid', paymentSource: 'sandbox', paidAt: new Date(Date.now() - 60_000),
      amountCents: 300, discountCents: 0, refundedAmountCents: 0, ...fields,
    },
  })
  made.orders.push(row.id)
  return row.id
}

async function main(): Promise<void> {
  const app = await NestFactory.create(InvoiceHttpModule, { logger: false })
  app.setGlobalPrefix('api/v1')
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors) => {
      const details = flattenValidationErrors(errors)
      return new BadRequestException({ error: { code: 'VALIDATION_FAILED', message: details[0] ?? '请求参数校验失败', details } })
    },
  }))
  app.useGlobalFilters(new HttpExceptionFilter())
  await app.listen(0, '127.0.0.1')
  base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}/api/v1`
  try {
    const kiosk = await kioskTerminal()
    const kioskTerminalId = kiosk['x-terminal-id']!

    await check('1 一体机带会员令牌查单条：只拿到打码后的税号和邮箱，退回原因里抄到的也打码；列表不带这两项', async () => {
      const owner = await member()
      const orderId = await printOrder(owner.id, kioskTerminalId)
      const asKiosk = { ...kiosk, Authorization: `Bearer ${owner.token}` }
      const created = await call('POST', '/me/invoice-requests', {
        headers: asKiosk,
        body: { orderKind: 'print', orderId, titleType: 'company', title: '青岛某印务有限公司', taxId: TAX_ID, email: EMAIL },
      })
      assert.equal(created.status, 201, created.text)
      const id = created.json.data.id as string
      const one = await call('GET', `/me/invoice-requests/${id}`, { headers: asKiosk })
      assert.equal(one.status, 200, one.text)
      assert.equal(one.json.data.taxIdMasked, '9100**********000N')
      assert.equal(one.json.data.emailMasked, 'f***@example.com')
      assert.equal(one.text.includes(TAX_ID), false, '单条接口带回了完整税号')
      assert.equal(one.text.includes(EMAIL), false, '单条接口带回了完整邮箱')
      await admin.returnRequest(id, { reason: `税号 ${TAX_ID} 与邮箱 ${EMAIL} 对不上`, operatorId: `verify-invoice-http-admin-${tag}` })
      const returned = await call('GET', `/me/invoice-requests/${id}`, { headers: asKiosk })
      assert.equal(returned.json.data.status, 'returned')
      assert.equal(returned.text.includes(TAX_ID), false, '退回原因带回了完整税号')
      assert.equal(returned.text.includes(EMAIL), false, '退回原因带回了完整邮箱')
      const list = await call('GET', '/me/invoice-orders', { headers: asKiosk })
      assert.equal(list.status, 200, list.text)
      assert.equal(list.text.includes(TAX_ID) || list.text.includes(EMAIL), false)
    })

    await check('2 会员提交：抬头、税号、邮箱填错时，经 HTTP 回文档写的专用错误码和中文句子，每个码一条；不落行', async () => {
      const owner = await member()
      const orderId = await printOrder(owner.id, kioskTerminalId)
      const headers = { Authorization: `Bearer ${owner.token}` }
      const good = { orderKind: 'print', orderId, titleType: 'personal', title: '刘晓楠', email: 'liuxiaonan@example.com' }
      const cases: Array<[string, Record<string, unknown>, string, string]> = [
        ['抬头类型乱填', { ...good, titleType: 'boss' }, 'INVOICE_TITLE_INVALID', '抬头要选个人或单位。'],
        ['抬头只有空格', { ...good, title: '   ' }, 'INVOICE_TITLE_INVALID', '抬头。个人写姓名，单位写单位名称。'],
        ['抬头 81 个字', { ...good, title: '晓'.repeat(81) }, 'INVOICE_TITLE_INVALID', '抬头请控制在 80 个字以内。'],
        ['个人填了税号', { ...good, taxId: TAX_ID }, 'INVOICE_TAX_ID_FORBIDDEN', '个人不用填税号。'],
        ['单位没填税号', { ...good, titleType: 'company', title: '青岛某印务有限公司' }, 'INVOICE_TAX_ID_REQUIRED', '单位请填写名称和统一社会信用代码。'],
        ['单位税号校验位错', { ...good, titleType: 'company', title: '青岛某印务有限公司', taxId: '91000000MA0000000X' }, 'INVOICE_TAX_ID_INVALID', '统一社会信用代码需为 18 位（数字与大写字母，末位校验位正确）'],
        ['缺邮箱', { orderKind: 'print', orderId, titleType: 'personal', title: '刘晓楠' }, 'INVOICE_EMAIL_INVALID', '接收邮箱格式不对。电子发票发到这个邮箱。'],
        ['邮箱格式错', { ...good, email: 'liuxiaonan@' }, 'INVOICE_EMAIL_INVALID', '接收邮箱格式不对。电子发票发到这个邮箱。'],
      ]
      for (const [label, body, code, message] of cases) {
        const reply = await call('POST', '/me/invoice-requests', { headers, body })
        assert.equal(reply.status, 400, `${label}：${reply.text}`)
        assert.equal(reply.json.error?.code, code, `${label}：${reply.text}`)
        assert.equal(reply.json.error?.message, message, label)
      }
      const injected = await call('POST', '/me/invoice-requests', { headers, body: { ...good, endUserId: made.members[0] } })
      assert.equal(injected.status, 400, '请求体带会员编号整单拒绝，不采用')
      assert.equal(injected.json.error?.code, 'VALIDATION_FAILED')
      const badKind = await call('POST', '/me/invoice-requests', { headers, body: { ...good, orderKind: 'refund' } })
      assert.equal(badKind.status, 400)
      assert.equal(badKind.json.error?.code, 'VALIDATION_FAILED')
      assert.equal(await prisma.invoiceRequest.count({ where: { endUserId: owner.id } }), 0)
    })

    await check('3 手机填写页提交：同样的专用错误码和中文句子经 HTTP 回到手机，会话仍可再交', async () => {
      const owner = await member()
      const orderId = await printOrder(owner.id, kioskTerminalId)
      const created = await call('POST', '/kiosk/invoice-sessions', {
        headers: { ...kiosk, Authorization: `Bearer ${owner.token}` },
        body: { orderKind: 'print', orderId },
      })
      assert.equal(created.status, 201, created.text)
      made.keys.push(`invoice_session:${created.json.data.sessionId}`)
      const resolved = await call('POST', '/kiosk/invoice-sessions/scene/resolve', { body: { scene: created.json.data.sceneToken } })
      assert.equal(resolved.status, 201, resolved.text)
      const { sessionId, submitToken } = resolved.json.data as { sessionId: string; submitToken: string }
      const good = { submitToken, titleType: 'personal', title: '刘晓楠', email: 'liuxiaonan@example.com' }
      for (const [body, code, message] of [
        [{ ...good, titleType: 'boss' }, 'INVOICE_TITLE_INVALID', '抬头要选个人或单位。'],
        [{ ...good, title: '晓'.repeat(81) }, 'INVOICE_TITLE_INVALID', '抬头请控制在 80 个字以内。'],
        [{ submitToken, titleType: 'personal', title: '刘晓楠' }, 'INVOICE_EMAIL_INVALID', '接收邮箱格式不对。电子发票发到这个邮箱。'],
      ] as Array<[Record<string, unknown>, string, string]>) {
        const reply = await call('POST', `/kiosk/invoice-sessions/${sessionId}/submit`, { body })
        assert.equal(reply.status, 400, reply.text)
        assert.equal(reply.json.error?.code, code, reply.text)
        assert.equal(reply.json.error?.message, message)
      }
      const ok = await call('POST', `/kiosk/invoice-sessions/${sessionId}/submit`, { body: good })
      assert.equal(ok.status, 201, ok.text)
      assert.equal(await prisma.invoiceRequest.count({ where: { endUserId: owner.id } }), 1)
    })

    await check('4 登录错误表：缺令牌 401 MEMBER_MISSING_TOKEN；账号停用后 401 ACCOUNT_UNAVAILABLE', async () => {
      const missing = await call('GET', '/me/invoice-orders')
      assert.equal(missing.status, 401)
      assert.equal(missing.json.error?.code, 'MEMBER_MISSING_TOKEN')
      const owner = await member()
      await prisma.endUser.update({ where: { id: owner.id }, data: { enabled: false } })
      const disabled = await call('GET', '/me/invoice-orders', { headers: { Authorization: `Bearer ${owner.token}` } })
      assert.equal(disabled.status, 401, disabled.text)
      assert.equal(disabled.json.error?.code, 'ACCOUNT_UNAVAILABLE')
    })

    await check('5 一体机接口的守卫组合：建会话要终端会话加会员令牌，轮询要终端会话；挡单与会员口同为 409', async () => {
      const owner = await member()
      const orderId = await printOrder(owner.id, kioskTerminalId)
      const memberOnly = { Authorization: `Bearer ${owner.token}` }
      const sessionKeysBefore = (await client.keys('invoice_session:*')).length
      const noTerminal = await call('POST', '/kiosk/invoice-sessions', { headers: memberOnly, body: { orderKind: 'print', orderId } })
      assert.equal(noTerminal.status, 401, `只带会员令牌、不带终端会话也建了开票码：${noTerminal.text}`)
      assert.equal(noTerminal.json.error?.code, 'TERMINAL_SESSION_INVALID')
      const forged = await call('POST', '/kiosk/invoice-sessions', {
        headers: { ...memberOnly, 'x-terminal-id': kioskTerminalId, 'x-terminal-session-token': randomBytes(32).toString('base64url') },
        body: { orderKind: 'print', orderId },
      })
      assert.equal(forged.status, 401)
      assert.equal(forged.json.error?.code, 'TERMINAL_SESSION_INVALID')
      const noMember = await call('POST', '/kiosk/invoice-sessions', { headers: kiosk, body: { orderKind: 'print', orderId } })
      assert.equal(noMember.status, 401, `只带终端会话、不带会员令牌也建了开票码：${noMember.text}`)
      assert.equal(noMember.json.error?.code, 'MEMBER_MISSING_TOKEN')
      assert.equal((await client.keys('invoice_session:*')).length, sessionKeysBefore, '被拒的请求不该写会话')
      const created = await call('POST', '/kiosk/invoice-sessions', { headers: { ...kiosk, ...memberOnly }, body: { orderKind: 'print', orderId } })
      assert.equal(created.status, 201, created.text)
      made.keys.push(`invoice_session:${created.json.data.sessionId}`)
      const control = { 'x-invoice-control': created.json.data.controlToken as string }
      const pollNoTerminal = await call('GET', `/kiosk/invoice-sessions/${created.json.data.sessionId}`, { headers: control })
      assert.equal(pollNoTerminal.status, 401, `不带终端会话也能轮询：${pollNoTerminal.text}`)
      assert.equal(pollNoTerminal.json.error?.code, 'TERMINAL_SESSION_INVALID')
      const poll = await call('GET', `/kiosk/invoice-sessions/${created.json.data.sessionId}`, { headers: { ...kiosk, ...control } })
      assert.equal(poll.status, 200, poll.text)
      assert.deepEqual(poll.json.data, { status: '等手机填写' })
      const refundedId = await printOrder(owner.id, kioskTerminalId, { payStatus: 'refunded', refundedAmountCents: 300 })
      const blockedKiosk = await call('POST', '/kiosk/invoice-sessions', { headers: { ...kiosk, ...memberOnly }, body: { orderKind: 'print', orderId: refundedId } })
      const blockedMember = await call('POST', '/me/invoice-requests', {
        headers: memberOnly,
        body: { orderKind: 'print', orderId: refundedId, titleType: 'personal', title: '刘晓楠', email: 'liuxiaonan@example.com' },
      })
      for (const reply of [blockedKiosk, blockedMember]) {
        assert.equal(reply.status, 409, reply.text)
        assert.equal(reply.json.error?.code, 'INVOICE_NOT_ALLOWED')
        assert.equal(reply.json.error?.message, '已退款的单，开不了发票。')
      }
    })

    console.log(`PASS verify:invoice-http（${passed.length} 组）`)
  } finally {
    await new Promise<void>((done) => app.getHttpServer().close(() => done()))
  }
}

async function cleanup(): Promise<void> {
  const invoices = await prisma.invoiceRequest.findMany({ where: { endUserId: { in: made.members } }, select: { id: true } })
  await prisma.auditLog.deleteMany({ where: { targetId: { in: invoices.map((row) => row.id) } } })
  await prisma.invoiceRequest.deleteMany({ where: { endUserId: { in: made.members } } })
  await prisma.refund.deleteMany({ where: { orderId: { in: made.orders } } })
  await prisma.order.deleteMany({ where: { id: { in: made.orders } } })
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
