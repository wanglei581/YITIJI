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
import { compareListPosition } from '../src/invoices/invoice-member-list'
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

async function serviceOrderFor(terminalId: string, endUserId: string, fields: Record<string, unknown>): Promise<string> {
  const row = await prisma.serviceOrder.create({
    data: {
      terminalId, serviceKey: 'resume_optimize', amountCents: 300, status: 'paid', kioskSessionId: `verify-invoice-ks-${next()}`,
      endUserId, provider: 'sandbox', providerOrderNo: `VINVS-${next()}`, expiresAt: new Date(Date.now() + 600_000), ...fields,
    },
  })
  made.services.push(row.id)
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
  const serviceOrder = (endUserId: string, at: Date, fields: Record<string, unknown>) =>
    serviceOrderFor(commercialTerminal, endUserId, { createdAt: at, paidAt: at, ...fields })

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

  await check('4 能不能开只看订单自己的事实：商业点位付 3 元，终端改绑到就业服务站后仍能申请，金额照实付', async () => {
    const endUserId = await member()
    const terminalId = await terminal(commercialOrg)
    const orderId = await printOrder(endUserId, terminalId)
    const publicOrg = await organization('employment_service_station')
    await prisma.terminal.update({ where: { id: terminalId }, data: { orgId: publicOrg, orgBoundAt: new Date() } })
    const list = (await requests.listForMember(endUserId)).items
    assert.deepEqual(list.map((row) => [row.orderId, row.canRequest, row.blockCode]), [[orderId, true, null]])
    const stored = await submitPersonal(endUserId, 'print', orderId)
    assert.equal(stored.amountCents, 300)
    const issued = await admin.markIssued(stored.id, { operatorId: OPERATOR })
    assert.equal(issued.status, 'issued', '改绑后标已开的复核也不看现机构')
  })

  await check('5 打印单退款事实：只看已退金额的部分退款、退款行 pending 都开不了；失败的退款行不挡；快照是减去抵扣后的实付', async () => {
    const endUserId = await member()
    const partial = await printOrder(endUserId, commercialTerminal, { refundedAmountCents: 100 })
    await expectConflict(() => submitPersonal(endUserId, 'print', partial), 'INVOICE_NOT_ALLOWED', '部分退款的单，开不了发票。')
    const pending = await printOrder(endUserId, commercialTerminal)
    await refund(pending, 'pending', 300)
    await expectConflict(() => submitPersonal(endUserId, 'print', pending), 'INVOICE_NOT_ALLOWED', '退款还没完成的单，开不了发票。')
    const refunded = await printOrder(endUserId, commercialTerminal, { refundedAmountCents: 300 })
    await expectConflict(() => submitPersonal(endUserId, 'print', refunded), 'INVOICE_NOT_ALLOWED', '已退款的单，开不了发票。')
    const voucher = await printOrder(endUserId, commercialTerminal, { amountCents: 300, discountCents: 300 })
    await expectConflict(() => submitPersonal(endUserId, 'print', voucher), 'INVOICE_NOT_ALLOWED', '这一单没有实付金额，开不了发票。')
    const failedRefund = await printOrder(endUserId, commercialTerminal, { amountCents: 500, discountCents: 200 })
    await refund(failedRefund, 'failed', 300)
    const stored = await submitPersonal(endUserId, 'print', failedRefund)
    assert.equal(stored.amountCents, 300)
    assert.equal(await prisma.invoiceRequest.count({ where: { endUserId } }), 1, '挡住的单不该落行')
    const listed = (await requests.listForMember(endUserId)).items
    assert.deepEqual(listed.map((row) => [row.orderId, row.invoiceStatus, row.amountCents]), [[failedRefund, 'submitted', 300]])
  })

  await check('6 服务单事实：已消费可开；退款中、退款失败、已退款、付款失败、待付都开不了', async () => {
    const endUserId = await member()
    const make = (fields: Record<string, unknown>) => serviceOrderFor(commercialTerminal, endUserId, fields)
    const consumed = await make({ status: 'consumed', paidAt: new Date(Date.now() - 60_000), consumedAt: new Date() })
    for (const [fields, message] of [
      [{ status: 'refunding' }, '退款还没完成的单，开不了发票。'],
      [{ status: 'refund_failed' }, '退款还没完成的单，开不了发票。'],
      [{ status: 'refunded', refundedAt: new Date() }, '已退款的单，开不了发票。'],
      [{ status: 'pending', paymentFailed: true }, '没付成的单，开不了发票。'],
      [{ status: 'pending' }, '没付成的单，开不了发票。'],
    ] as Array<[Record<string, unknown>, string]>) {
      const id = await make(fields)
      await expectConflict(() => submitPersonal(endUserId, 'service', id), 'INVOICE_NOT_ALLOWED', message)
    }
    const stored = await submitPersonal(endUserId, 'service', consumed)
    assert.equal(stored.amountCents, 300)
  })

  await check('7 会员列表翻页：两张表按同一全序合并，同一时刻跨种类、同种类并列都不重不漏；免费单、退了款又没申请的不出现', async () => {
    const endUserId = await member()
    const base = Date.now() - 3_600_000
    const tie = new Date(base - 20_000)
    const expected: Array<{ at: Date; kind: 'print' | 'service'; id: string }> = []
    const shown = async (kind: 'print' | 'service', at: Date, fields: Record<string, unknown> = {}) => {
      const id = kind === 'print' ? await printOrder(endUserId, commercialTerminal, { createdAt: at, ...fields }) : await serviceOrder(endUserId, at, fields)
      expected.push({ at, kind, id })
      return id
    }
    for (let index = 0; index < 12; index += 1) await shown('print', new Date(base - index * 1000))
    await shown('print', tie)
    await shown('print', tie)
    await shown('service', tie, { status: 'consumed' })
    await shown('service', new Date(base - 5_500), { status: 'paid' })
    const invoicedThenRefunded = await shown('print', new Date(base - 30_000))
    await submitPersonal(endUserId, 'print', invoicedThenRefunded)
    await prisma.order.update({ where: { id: invoicedThenRefunded }, data: { payStatus: 'refunded', refundedAmountCents: 300 } })
    const hiddenFree = await printOrder(endUserId, commercialTerminal, { createdAt: new Date(base - 2_500), amountCents: 0, paymentSource: 'free' })
    const hiddenRefunded = await printOrder(endUserId, commercialTerminal, { createdAt: new Date(base - 3_500), payStatus: 'refunded', refundedAmountCents: 300 })
    expected.sort((left, right) => compareListPosition(left, right))
    // 一页 7 张时第 14 张正好是并列时刻的服务单，翻页标记落在它上面，下一页要接着读同一时刻的两张打印单；
    // 一页 5 张时标记落在并列时刻的第一张打印单上，下一页要接着读同一时刻的另一张。
    // chunkSize 2：每轮每种只读 2 行，走到合并边界、一页要读好几轮、轮次用完带标记先返回这几条路。
    for (const [limit, chunkSize] of [[5, undefined], [7, undefined], [5, 2], [7, 2]] as Array<[number, number | undefined]>) {
      const seen: string[] = []
      let cursor: string | undefined
      for (let page = 0; page < 30; page += 1) {
        const result = await requests.listForMember(endUserId, { limit, ...(cursor ? { cursor } : {}), ...(chunkSize ? { chunkSize } : {}) })
        assert.ok(result.items.length <= limit)
        seen.push(...result.items.map((row) => `${row.orderKind}:${row.orderId}`))
        if (!result.nextCursor) break
        cursor = result.nextCursor
      }
      assert.deepEqual(seen, expected.map((row) => `${row.kind}:${row.id}`), `翻页拼起来应正好是全序里的全部可见单（每页 ${limit}，chunk ${chunkSize ?? '默认'}）`)
      assert.equal(new Set(seen).size, seen.length, '翻页不能重复')
      assert.equal(seen.some((key) => key.endsWith(hiddenFree) || key.endsWith(hiddenRefunded)), false)
    }
    const invoiced = (await requests.listForMember(endUserId, { limit: 50 })).items.find((row) => row.orderId === invoicedThenRefunded)
    assert.equal(invoiced?.invoiceStatus, 'submitted')
    assert.equal(invoiced?.canRequest, false)
    await assert.rejects(() => requests.listForMember(endUserId, { cursor: 'bm90LWEtY3Vyc29y' }), (error: unknown) => errorOf(error).code === 'VALIDATION_FAILED')
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
