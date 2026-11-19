import assert from 'node:assert/strict'
import { test } from 'node:test'
import { INVOICE_BLOCK_MESSAGES } from './invoice-eligibility'
import { InvoiceRequestsService } from './invoice-requests.service'
import { MemberInvoiceController } from './member-invoice.controller'

const MEMBER = 'member-1'
const OTHER = 'member-2'
const TERMINAL = 'terminal-1'
const PUBLIC_TERMINAL = 'terminal-public'
const EMAIL = 'person@example.com'
const TAX_ID = '91000000MA0000000N'

interface PrintRow {
  id: string
  endUserId: string | null
  terminalId: string | null
  payStatus: string
  amountCents: number
  discountCents: number
  refundedAmountCents: number
  refunds: Array<{ status: string }>
  createdAt: Date
}

interface ServiceRow {
  id: string
  endUserId: string | null
  terminalId: string | null
  status: string
  amountCents: number
  paymentFailed: boolean
  createdAt: Date
}

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

function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  for (const [key, expected] of Object.entries(where)) {
    if (key === 'OR' && Array.isArray(expected)) {
      if (!expected.some((branch) => matches(row, branch as Record<string, unknown>))) return false
      continue
    }
    if (expected instanceof Date) {
      if (!(row[key] instanceof Date) || (row[key] as Date).getTime() !== expected.getTime()) return false
      continue
    }
    if (expected && typeof expected === 'object' && ('gt' in expected || 'lt' in expected || 'lte' in expected)) {
      const bound = expected as { gt?: unknown; lt?: unknown; lte?: unknown }
      const value = row[key] instanceof Date ? (row[key] as Date).getTime() : row[key]
      const num = (input: unknown) => (input instanceof Date ? input.getTime() : input) as number | string
      if (bound.gt !== undefined && !((value as number | string) > num(bound.gt))) return false
      if (bound.lt !== undefined && !((value as number | string) < num(bound.lt))) return false
      if (bound.lte !== undefined && !((value as number | string) <= num(bound.lte))) return false
      continue
    }
    if (expected && typeof expected === 'object' && 'in' in expected) {
      const values = (expected as { in: unknown[] }).in
      if (!values.includes(row[key])) return false
      continue
    }
    if (expected && typeof expected === 'object' && 'not' in expected) {
      if (row[key] === (expected as { not: unknown }).not) return false
      continue
    }
    if (row[key] !== expected) return false
  }
  return true
}

function createHarness(options?: { hideOpen?: boolean }) {
  const now = Date.now()
  const prints: PrintRow[] = [
    {
      id: 'order-ok',
      endUserId: MEMBER,
      terminalId: TERMINAL,
      payStatus: 'paid',
      amountCents: 300,
      discountCents: 100,
      refundedAmountCents: 0,
      refunds: [],
      createdAt: new Date(now - 20_000),
    },
    {
      id: 'order-other',
      endUserId: OTHER,
      terminalId: TERMINAL,
      payStatus: 'paid',
      amountCents: 300,
      discountCents: 0,
      refundedAmountCents: 0,
      refunds: [],
      createdAt: new Date(now - 15_000),
    },
    {
      id: 'order-refunded',
      endUserId: MEMBER,
      terminalId: TERMINAL,
      payStatus: 'refunded',
      amountCents: 300,
      discountCents: 100,
      refundedAmountCents: 200,
      refunds: [],
      createdAt: new Date(now - 10_000),
    },
    {
      id: 'order-unpaid',
      endUserId: MEMBER,
      terminalId: TERMINAL,
      payStatus: 'unpaid',
      amountCents: 300,
      discountCents: 0,
      refundedAmountCents: 0,
      refunds: [],
      createdAt: new Date(now - 5_000),
    },
    {
      id: 'order-public',
      endUserId: MEMBER,
      terminalId: PUBLIC_TERMINAL,
      payStatus: 'paid',
      amountCents: 300,
      discountCents: 0,
      refundedAmountCents: 0,
      refunds: [],
      createdAt: new Date(now - 4_000),
    },
  ]
  const services: ServiceRow[] = [
    {
      id: 'svc-ok',
      endUserId: MEMBER,
      terminalId: TERMINAL,
      status: 'consumed',
      amountCents: 500,
      paymentFailed: false,
      createdAt: new Date(now - 30_000),
    },
  ]
  const invoices: InvoiceRow[] = []
  const calls = { findUnique: 0, findFirst: 0, findMany: 0 }
  const orgType = (terminalId: string | null) => (
    terminalId === PUBLIC_TERMINAL ? 'public_employment_service' : 'licensed_hr_agency'
  )
  const prisma = {
    order: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        calls.findUnique += 1
        return prints.find((row) => row.id === where.id) ?? null
      },
      findMany: async ({ where }: { where: Record<string, unknown> }) => {
        calls.findMany += 1
        return prints.filter((row) => matches(row as never, where))
      },
    },
    serviceOrder: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        calls.findUnique += 1
        return services.find((row) => row.id === where.id) ?? null
      },
      findMany: async ({ where }: { where: Record<string, unknown> }) => {
        calls.findMany += 1
        return services.filter((row) => matches(row as never, where))
      },
    },
    terminal: {
      findUnique: async ({ where }: { where: { id: string } }) => ({ org: { type: orgType(where.id) } }),
    },
    invoiceRequest: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        calls.findFirst += 1
        if (options?.hideOpen && where['status'] && typeof where['status'] === 'object' && (where['status'] as { not?: string }).not === 'returned') {
          return null
        }
        return invoices.find((row) => matches(row as never, where)) ?? null
      },
      findMany: async ({ where }: { where: Record<string, unknown> }) =>
        invoices.filter((row) => matches(row as never, where)),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const open = invoices.find((row) => row.orderKind === data['orderKind'] && row.orderId === data['orderId'] && row.status !== 'returned')
        if (open) {
          const error = new Error('unique') as Error & { code?: string }
          error.code = 'P2002'
          throw error
        }
        const row: InvoiceRow = {
          id: `inv-${invoices.length + 1}`,
          orderKind: String(data['orderKind']),
          orderId: String(data['orderId']),
          endUserId: String(data['endUserId']),
          titleType: String(data['titleType']),
          title: String(data['title']),
          taxId: (data['taxId'] as string | null) ?? null,
          email: (data['email'] as string | null) ?? null,
          amountCents: Number(data['amountCents']),
          status: String(data['status']),
          issuedAt: null,
          invoiceNo: null,
          returnReason: null,
          operatorId: null,
          createdAt: new Date(),
        }
        invoices.push(row)
        return row
      },
    },
  }
  const requests = new InvoiceRequestsService(prisma as never)
  return { prints, invoices, calls, requests, controller: new MemberInvoiceController(requests) }
}

function errorBody(error: unknown): { code?: string; message?: string } {
  const body = (error as { getResponse?: () => { error?: { code?: string; message?: string } } }).getResponse?.()
  return body?.error ?? {}
}

test('会员只看到自己能开的订单，列表不带税号和邮箱', async () => {
  const { requests } = createHarness()
  // 用法改动（返工包 P2c1b 第 16 条）：列表改成分页，返回 { items, nextCursor }，这里取 .items，期望值不变。
  const list = (await requests.listForMember(MEMBER)).items
  assert.deepEqual(list.map((row) => ({
    orderKind: row.orderKind,
    orderId: row.orderId,
    canRequest: row.canRequest,
    invoiceStatus: row.invoiceStatus,
    blockCode: row.blockCode,
    amountCents: row.amountCents,
  })), [
    { orderKind: 'print', orderId: 'order-public', canRequest: true, invoiceStatus: 'none', blockCode: null, amountCents: 300 },
    { orderKind: 'print', orderId: 'order-ok', canRequest: true, invoiceStatus: 'none', blockCode: null, amountCents: 200 },
    { orderKind: 'service', orderId: 'svc-ok', canRequest: true, invoiceStatus: 'none', blockCode: null, amountCents: 500 },
  ])
  // 期望值改动（返工包 P2c1b 第 10 条）：order-public 是在终端现在绑到公共就业点位前就已付 300 分的单。
  // 能不能开只看订单自己的事实，它现在能开，排在最前（创建最晚）；原先按现机构把它挡在列表外是误判。
  assert.equal(list.some((row) => row.orderId === 'order-other' || row.orderId === 'order-refunded' || row.orderId === 'order-unpaid'), false)
  assert.equal(list.every((row) => !('taxId' in row) && !('email' in row)), true)
})

test('已退款的单提交要失败，同一订单不能有两条未退回申请', async () => {
  const { requests, invoices } = createHarness()
  await assert.rejects(
    () => requests.submit(MEMBER, {
      orderKind: 'print',
      orderId: 'order-refunded',
      titleType: 'personal',
      title: '张三',
      email: EMAIL,
    }),
    (error: unknown) => {
      assert.equal(errorBody(error).message, INVOICE_BLOCK_MESSAGES.refunded)
      return true
    },
  )
  assert.equal(invoices.length, 0)

  const created = await requests.submit(MEMBER, {
    orderKind: 'print',
    orderId: 'order-ok',
    titleType: 'company',
    title: '某单位',
    taxId: TAX_ID,
    email: EMAIL,
  })
  await assert.rejects(
    () => requests.submit(MEMBER, {
      orderKind: 'print',
      orderId: 'order-ok',
      titleType: 'personal',
      title: '张三',
      email: EMAIL,
    }),
    (error: unknown) => {
      assert.equal(errorBody(error).code, 'INVOICE_NOT_ALLOWED')
      assert.equal(errorBody(error).message, INVOICE_BLOCK_MESSAGES.already_requested)
      return true
    },
  )
  assert.equal(invoices.length, 1)

  const listed = (await requests.listForMember(MEMBER)).items
  const row = listed.find((item) => item.orderId === 'order-ok')
  assert.equal(row?.invoiceStatus, 'submitted')
  assert.equal(row?.canRequest, false)
  assert.equal(row?.requestId, created.id)
  assert.equal(row?.blockCode, 'already_requested')
  assert.equal(row && 'taxId' in row, false)
  assert.equal(row && 'email' in row, false)

  const view = await requests.getForMember(MEMBER, created.id)
  assert.equal(view.status, 'submitted')
  assert.equal(view.title, '某单位')
  // 期望值改动（返工包 P2c1b 第 5 条）：会员单条接口一体机带会员令牌也能调，所以只回打码后的税号和邮箱，
  // 字段改名 taxIdMasked、emailMasked；原先断言的完整 taxId、email 正是要堵的口子。
  assert.equal(view.taxIdMasked, '9100**********000N')
  assert.equal(view.emailMasked, 'p***@example.com')
  assert.equal('taxId' in view, false)
  assert.equal('email' in view, false)
  assert.equal(JSON.stringify(view).includes(TAX_ID), false)
  assert.equal(JSON.stringify(view).includes(EMAIL), false)
  assert.equal('operatorId' in view, false)

  await assert.rejects(
    () => requests.getForMember(OTHER, created.id),
    (error: unknown) => {
      const body = errorBody(error)
      assert.equal(body.code, 'INVOICE_REQUEST_NOT_FOUND')
      assert.equal(JSON.stringify(body).includes(TAX_ID), false)
      assert.equal(JSON.stringify(body).includes(EMAIL), false)
      return true
    },
  )
})

test('资格判断没看见在途申请时，唯一约束仍只留下一条', async () => {
  const { requests, invoices } = createHarness({ hideOpen: true })
  await requests.submit(MEMBER, {
    orderKind: 'print',
    orderId: 'order-ok',
    titleType: 'personal',
    title: '张三',
    email: EMAIL,
  })
  await assert.rejects(
    () => requests.submit(MEMBER, {
      orderKind: 'print',
      orderId: 'order-ok',
      titleType: 'personal',
      title: '李四',
      email: EMAIL,
    }),
    (error: unknown) => {
      assert.equal(errorBody(error).code, 'INVOICE_ALREADY_REQUESTED')
      assert.equal(errorBody(error).message, INVOICE_BLOCK_MESSAGES.already_requested)
      return true
    },
  )
  assert.equal(invoices.length, 1)
  assert.equal(invoices[0]?.title, '张三')
})

test('提交认登录的会员，不认请求体里写的别人', async () => {
  const { controller, invoices } = createHarness()
  const response = await controller.create(
    { endUserId: MEMBER, sessionId: 'session-1' },
    {
      orderKind: 'service',
      orderId: 'svc-ok',
      titleType: 'personal',
      title: '张三',
      email: EMAIL,
      endUserId: OTHER,
    } as never,
  )
  assert.equal(response.data.status, 'submitted')
  assert.equal(invoices[0]?.endUserId, MEMBER)
  assert.equal(invoices[0]?.taxId, null)
  assert.equal(response.data.orderKind, 'service')
  assert.equal('taxId' in response.data, false)
  assert.equal('email' in response.data, false)
})

test('会员单条接口：退回原因里抄到的邮箱和税号也打码，个人申请没有税号', async () => {
  const { requests, invoices } = createHarness()
  const created = await requests.submit(MEMBER, {
    orderKind: 'print',
    orderId: 'order-ok',
    titleType: 'personal',
    title: '张三',
    email: EMAIL,
  })
  const row = invoices.find((item) => item.id === created.id)!
  row.status = 'returned'
  row.returnReason = `邮箱 ${EMAIL} 收不到；单位税号 ${TAX_ID} 也对不上，请改成单位抬头再交`
  const view = await requests.getForMember(MEMBER, created.id)
  assert.equal(view.taxIdMasked, null)
  assert.equal(view.emailMasked, 'p***@example.com')
  assert.equal(view.returnReason, '邮箱 p***@example.com 收不到；单位税号 9100**********000N 也对不上，请改成单位抬头再交')
  const text = JSON.stringify(view)
  assert.equal(text.includes(EMAIL), false)
  assert.equal(text.includes(TAX_ID), false)
})

test('会员列表批量读三次库，不对每张单逐个查；一页默认最多 20 张，后面还有就给翻页标记', async () => {
  const { prints, calls, requests } = createHarness()
  const now = Date.now()
  for (let index = 0; index < 30; index += 1) {
    prints.push({
      id: `order-bulk-${String(index).padStart(2, '0')}`,
      endUserId: MEMBER,
      terminalId: TERMINAL,
      payStatus: 'paid',
      amountCents: 200,
      discountCents: 0,
      refundedAmountCents: 0,
      refunds: [],
      createdAt: new Date(now - 60_000 - index * 1000),
    })
  }
  const page = await requests.listForMember(MEMBER)
  assert.equal(page.items.length, 20)
  assert.ok(page.nextCursor, '还有没列出的单，要给翻页标记')
  assert.equal(calls.findUnique, 0, '不该对每张单逐个查订单')
  assert.equal(calls.findFirst, 0, '不该对每张单逐个查申请')
  assert.equal(calls.findMany, 2, '打印单、服务单各一次批量读')
  const small = await requests.listForMember(MEMBER, { limit: 5 })
  assert.equal(small.items.length, 5)
  assert.deepEqual(small.items.map((row) => row.orderId), page.items.slice(0, 5).map((row) => row.orderId))
})
