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
