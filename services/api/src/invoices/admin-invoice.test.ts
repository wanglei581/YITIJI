import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AdminInvoiceController } from './admin-invoice.controller'
import { AdminInvoiceService } from './admin-invoice.service'
import { InvoiceRequestsService } from './invoice-requests.service'

const EMAIL = 'person@example.com'
const TAX_ID = '91000000MA0000000N'
const OPERATOR = 'admin-1'

interface InvoiceRow {
  id: string
  orderKind: string
  orderId: string
  endUserId: string
  titleType: string
  title: string
  taxId: string | null
  email: string | null
  amountCents: number
  status: string
  issuedAt: Date | null
  invoiceNo: string | null
  returnReason: string | null
  operatorId: string | null
  createdAt: Date
}

function errorBody(error: unknown): { code?: string; message?: string } {
  const body = (error as { getResponse?: () => { error?: { code?: string; message?: string } } }).getResponse?.()
  return body?.error ?? {}
}

interface OrderRow {
  id: string
  endUserId: string | null
  terminalId: string | null
  payStatus: string
  amountCents: number
  discountCents: number
  refundedAmountCents: number
  refunds: Array<{ status: string }>
}

function createHarness() {
  const orders: OrderRow[] = [
    {
      id: 'order-1',
      endUserId: 'member-1',
      terminalId: 'terminal-1',
      payStatus: 'paid',
      amountCents: 200,
      discountCents: 0,
      refundedAmountCents: 0,
      refunds: [],
    },
  ]
  const invoices: InvoiceRow[] = [
    {
      id: 'inv-1',
      orderKind: 'print',
      orderId: 'order-1',
      endUserId: 'member-1',
      titleType: 'company',
      title: '某单位',
      taxId: TAX_ID,
      email: EMAIL,
      amountCents: 200,
      status: 'submitted',
      issuedAt: null,
      invoiceNo: null,
      returnReason: null,
      operatorId: null,
      createdAt: new Date(Date.now() - 60_000),
    },
  ]
  const audits: Array<Record<string, unknown>> = []
  const prisma = {
    order: {
      findUnique: async ({ where }: { where: { id: string } }) => orders.find((row) => row.id === where.id) ?? null,
    },
    serviceOrder: {
      findUnique: async () => null,
    },
    terminal: {
      findUnique: async () => ({ org: { type: 'licensed_hr_agency' } }),
    },
    invoiceRequest: {
      findFirst: async ({ where }: { where: { orderKind: string; orderId: string } }) =>
        invoices.find((row) => row.orderKind === where.orderKind && row.orderId === where.orderId && row.status !== 'returned') ?? null,
      findMany: async ({ where }: { where: Record<string, unknown> }) =>
        invoices.filter((row) => Object.entries(where).every(([key, value]) => row[key as keyof InvoiceRow] === value)),
      updateMany: async ({ where, data }: { where: { id: string; status: string }; data: Partial<InvoiceRow> }) => {
        const row = invoices.find((item) => item.id === where.id && item.status === where.status)
        if (!row) return { count: 0 }
        Object.assign(row, data)
        return { count: 1 }
      },
    },
  }
  const audit = {
    write: async (args: Record<string, unknown>) => {
      audits.push(args)
      return 'audit-1'
    },
  }
  const requests = new InvoiceRequestsService(prisma as never)
  const service = new AdminInvoiceService(prisma as never, audit as never, requests)
  return { orders, invoices, audits, service, controller: new AdminInvoiceController(service) }
}

test('订单详情能看到抬头、税号、邮箱和金额，标已开两次只有一次成功', async () => {
  const { service, invoices, audits } = createHarness()
  const view = await service.getByOrder('print', 'order-1')
  assert.equal(view.titleType, 'company')
  assert.equal(view.title, '某单位')
  assert.equal(view.taxId, TAX_ID)
  assert.equal(view.email, EMAIL)
  assert.equal(view.amountCents, 200)
  assert.equal(view.status, 'submitted')

  const [first, second] = await Promise.allSettled([
    service.markIssued('inv-1', { invoiceNo: 'NO-1', operatorId: OPERATOR }),
    service.markIssued('inv-1', { invoiceNo: 'NO-2', operatorId: 'admin-2' }),
  ])
  const fulfilled = [first, second].filter((item) => item.status === 'fulfilled')
  const rejected = [first, second].filter((item) => item.status === 'rejected')
  assert.equal(fulfilled.length, 1)
  assert.equal(rejected.length, 1)
  assert.equal(errorBody((rejected[0] as PromiseRejectedResult).reason).message, '只有已提交的申请可以标已开。')
  assert.equal(invoices[0]?.status, 'issued')
  assert.equal(audits.length, 1)
  assert.equal(audits[0]?.['action'], 'invoice.mark_issued')
  assert.equal(audits[0]?.['actorId'], null)
  const payload = audits[0]?.['payload'] as Record<string, unknown>
  assert.equal(payload['operatorId'], invoices[0]?.operatorId)
  assert.equal(JSON.stringify(payload).includes(EMAIL), false)
  assert.equal(JSON.stringify(payload).includes(TAX_ID), false)
  await assert.rejects(
    () => service.markIssued('inv-1', { operatorId: OPERATOR }),
    (error: unknown) => {
      assert.equal(errorBody(error).message, '只有已提交的申请可以标已开。')
      return true
    },
  )
  assert.equal(audits.length, 1)
})

test('退回必须写原因，退回之后不能再标已开', async () => {
  const { service, invoices, audits, controller } = createHarness()
  await assert.rejects(
    () => service.returnRequest('inv-1', { reason: '   ', operatorId: OPERATOR }),
    (error: unknown) => {
      assert.equal(errorBody(error).message, '退回原因要填写。')
      return true
    },
  )
  assert.equal(invoices[0]?.status, 'submitted')
  const returned = await controller.returnRequest(
    'inv-1',
    { reason: '抬头与付款人不符', operatorId: 'body-op' } as never,
    { userId: OPERATOR, role: 'admin', orgId: null, sessionId: 'session-1' },
  )
  assert.equal(returned.status, 'returned')
  assert.equal(returned.returnReason, '抬头与付款人不符')
  assert.equal(invoices[0]?.operatorId, OPERATOR)
  assert.equal(audits[0]?.['action'], 'invoice.return')
  assert.equal((audits[0]?.['payload'] as Record<string, unknown>)['operatorId'], OPERATOR)
  // 退回原因可能写到姓名、邮箱，审计不变、注销也不改写审计，所以审计里只留长度和去处。
  const returnPayload = audits[0]?.['payload'] as Record<string, unknown>
  assert.equal(JSON.stringify(returnPayload).includes('抬头与付款人不符'), false)
  assert.equal(returnPayload['reasonLength'], '抬头与付款人不符'.length)
  assert.equal(returnPayload['reasonNote'], '原因见申请')
  assert.equal('reason' in returnPayload, false)
  await assert.rejects(
    () => service.markIssued('inv-1', { operatorId: OPERATOR }),
    (error: unknown) => {
      assert.equal(errorBody(error).message, '只有已提交的申请可以标已开。')
      return true
    },
  )
  await assert.rejects(
    () => service.getByOrder('service', 'missing'),
    (error: unknown) => {
      assert.equal(errorBody(error).message, '这张订单没有开票申请。')
      return true
    },
  )
})

test('申请提交后订单退了款，标已开要 409，并引导去退回；库里仍是已提交，审计不写', async () => {
  for (const change of [
    { payStatus: 'refunded', refundedAmountCents: 200, refunds: [{ status: 'success' }] },
    { payStatus: 'refunding', refundedAmountCents: 0, refunds: [{ status: 'pending' }] },
    { payStatus: 'paid', refundedAmountCents: 0, refunds: [{ status: 'pending' }] },
    { payStatus: 'partial_refunded', refundedAmountCents: 100, refunds: [{ status: 'success' }] },
  ]) {
    const { service, orders, invoices, audits } = createHarness()
    Object.assign(orders[0]!, change)
    await assert.rejects(
      () => service.markIssued('inv-1', { invoiceNo: 'NO-1', operatorId: OPERATOR }),
      (error: unknown) => {
        assert.equal((error as { getStatus?: () => number }).getStatus?.(), 409)
        assert.equal(errorBody(error).code, 'INVOICE_ORDER_NOT_ISSUABLE')
        assert.match(errorBody(error).message ?? '', /开不了发票。请点「退回」，写明原因。$/)
        return true
      },
    )
    assert.equal(invoices[0]?.status, 'submitted', JSON.stringify(change))
    assert.equal(invoices[0]?.invoiceNo, null)
    assert.equal(audits.length, 0)
    const returned = await service.returnRequest('inv-1', { reason: '订单已退款', operatorId: OPERATOR })
    assert.equal(returned.status, 'returned')
  }
})
