import 'reflect-metadata'

/**
 * verify:invoice-real-db —— 开票在真库上的事实。SQLite（build-and-verify）与 PostgreSQL（postgres-readiness）都跑。
 *
 * 五份开票单测用的是假 Prisma：不看 select、不看真唯一索引，数据库映射层改坏了它们照样绿。
 * 这里用真 PrismaService 写真行，走真 InvoiceRequestsService、AdminInvoiceService、AuditService。
 * 写的行都带本次随机标签，跑完按编号删净。夹具日期都相对「现在」算，不写死。
 */
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { AuditService } from '../src/audit/audit.service'
import { AdminInvoiceService } from '../src/invoices/admin-invoice.service'
import { InvoiceRequestsService } from '../src/invoices/invoice-requests.service'
import { PrismaService } from '../src/prisma/prisma.service'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'

assertIsolatedVerificationDatabase()

const prisma = new PrismaService()
const audit = new AuditService(prisma)
const requests = new InvoiceRequestsService(prisma)
const admin = new AdminInvoiceService(prisma, audit, requests)
const tag = randomUUID().replace(/-/g, '').slice(0, 12)
const OPERATOR = `verify-invoice-admin-${tag}`
const EMAIL = 'invoice.verify@example.com'
const made = { members: [] as string[], orgs: [] as string[], terminals: [] as string[], orders: [] as string[], services: [] as string[] }
let serial = 0
const passed: string[] = []

function next(): string {
  serial += 1
  return `${tag}-${serial}`
}

function errorOf(error: unknown): { status?: number; code?: string; message?: string } {
  const http = error as { getStatus?: () => number; getResponse?: () => { error?: { code?: string; message?: string } } }
  return { status: http.getStatus?.(), ...(http.getResponse?.()?.error ?? {}) }
}

async function expectConflict(operation: () => Promise<unknown>, code: string, message?: RegExp | string) {
  try {
    await operation()
  } catch (error) {
    const body = errorOf(error)
    assert.equal(body.status, 409, `期望 409，实际 ${body.status} ${body.code}`)
    assert.equal(body.code, code)
    if (typeof message === 'string') assert.equal(body.message, message)
    else if (message) assert.match(body.message ?? '', message)
    return body
  }
  assert.fail(`期望 ${code}，实际成功`)
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

async function member(): Promise<string> {
  const row = await prisma.endUser.create({
    data: { phoneHash: `verify-invoice-${next()}`, phoneEnc: `verify-invoice-not-a-phone-${randomBytes(6).toString('hex')}` },
  })
  made.members.push(row.id)
  return row.id
}

async function organization(type: string): Promise<string> {
  const id = `verify-invoice-org-${next()}`
  await prisma.organization.create({ data: { id, name: type === 'licensed_hr_agency' ? '青岛某人力资源服务公司' : '某街道就业服务站', type } })
  made.orgs.push(id)
  return id
}

async function terminal(orgId: string): Promise<string> {
  const id = `verify-invoice-term-${next()}`
  await prisma.terminal.create({
    data: { id, terminalCode: id, agentToken: randomBytes(16).toString('hex'), deviceFingerprint: randomBytes(16).toString('hex'), orgId, orgBoundAt: new Date() },
  })
  made.terminals.push(id)
  return id
}

async function printOrder(endUserId: string, terminalId: string | null, fields: Record<string, unknown> = {}): Promise<string> {
  const row = await prisma.order.create({
    data: {
      orderNo: `VINV-${next()}`, endUserId, terminalId, payStatus: 'paid', paymentSource: 'sandbox', paidAt: new Date(Date.now() - 60_000),
      amountCents: 300, discountCents: 0, refundedAmountCents: 0, ...fields,
    },
  })
  made.orders.push(row.id)
  return row.id
}

async function refund(orderId: string, status: string, amountCents: number): Promise<void> {
  await prisma.refund.create({ data: { orderId, refundNo: `VINV-R-${next()}`, amountCents, channel: 'sandbox', status } })
}

async function submitPersonal(endUserId: string, orderKind: 'print' | 'service', orderId: string) {
  return requests.submit(endUserId, { orderKind, orderId, titleType: 'personal', title: '刘晓楠', email: EMAIL })
}

async function markIssuedAudits(invoiceId: string): Promise<number> {
  return prisma.auditLog.count({ where: { targetId: invoiceId, action: 'invoice.mark_issued' } })
}

async function main(): Promise<void> {
  const commercialOrg = await organization('licensed_hr_agency')
  const commercialTerminal = await terminal(commercialOrg)

  await check('1 标已开前复核：干净的已付单照常标已开，写一条标已开审计', async () => {
    const endUserId = await member()
    const orderId = await printOrder(endUserId, commercialTerminal)
    const stored = await submitPersonal(endUserId, 'print', orderId)
    assert.equal(stored.amountCents, 300)
    const issued = await admin.markIssued(stored.id, { invoiceNo: 'VINV-NO-1', operatorId: OPERATOR })
    assert.equal(issued.status, 'issued')
    assert.equal(await markIssuedAudits(stored.id), 1)
  })

  await check('2 标已开前复核：申请后全额退款，标已开 409 并引导退回；库里仍是已提交，没有标已开审计，退回能成', async () => {
    const endUserId = await member()
    const orderId = await printOrder(endUserId, commercialTerminal)
    const stored = await submitPersonal(endUserId, 'print', orderId)
    await prisma.order.update({ where: { id: orderId }, data: { payStatus: 'refunded', refundedAmountCents: 300, refundedAt: new Date() } })
    await refund(orderId, 'success', 300)
    await expectConflict(() => admin.markIssued(stored.id, { invoiceNo: 'VINV-NO-2', operatorId: OPERATOR }),
      'INVOICE_ORDER_NOT_ISSUABLE', '已退款的单，开不了发票。请点「退回」，写明原因。')
    const row = await prisma.invoiceRequest.findUniqueOrThrow({ where: { id: stored.id } })
    assert.equal(row.status, 'submitted')
    assert.equal(row.invoiceNo, null)
    assert.equal(row.issuedAt, null)
    assert.equal(await markIssuedAudits(stored.id), 0)
    const returned = await admin.returnRequest(stored.id, { reason: '订单已全额退款', operatorId: OPERATOR })
    assert.equal(returned.status, 'returned')
  })

  await check('3 标已开前复核：退款行还在 pending（订单仍是已付），标已开 409', async () => {
    const endUserId = await member()
    const orderId = await printOrder(endUserId, commercialTerminal)
    const stored = await submitPersonal(endUserId, 'print', orderId)
    await refund(orderId, 'pending', 300)
    await expectConflict(() => admin.markIssued(stored.id, { operatorId: OPERATOR }),
      'INVOICE_ORDER_NOT_ISSUABLE', '退款还没完成的单，开不了发票。请点「退回」，写明原因。')
    assert.equal((await prisma.invoiceRequest.findUniqueOrThrow({ where: { id: stored.id } })).status, 'submitted')
    assert.equal(await markIssuedAudits(stored.id), 0)
  })

  console.log(`PASS verify:invoice-real-db（${passed.length} 组）`)
}

async function cleanup(): Promise<void> {
  const invoices = await prisma.invoiceRequest.findMany({ where: { endUserId: { in: made.members } }, select: { id: true } })
  await prisma.auditLog.deleteMany({ where: { targetId: { in: invoices.map((row) => row.id) } } })
  await prisma.invoiceRequest.deleteMany({ where: { endUserId: { in: made.members } } })
  await prisma.refund.deleteMany({ where: { orderId: { in: made.orders } } })
  await prisma.order.deleteMany({ where: { id: { in: made.orders } } })
  await prisma.serviceOrder.deleteMany({ where: { id: { in: made.services } } })
  await prisma.terminal.deleteMany({ where: { id: { in: made.terminals } } })
  await prisma.organization.deleteMany({ where: { id: { in: made.orgs } } })
  await prisma.endUser.deleteMany({ where: { id: { in: made.members } } })
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
      await prisma.onModuleDestroy()
    }
  })
