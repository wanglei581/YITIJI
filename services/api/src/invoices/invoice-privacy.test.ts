import assert from 'node:assert/strict'
import { test } from 'node:test'
import { deidentifyClosedMemberInvoices } from '../member-privacy/member-closure-retention'
import { InvoiceEmailCleanupTask } from './invoice-email-cleanup.task'
import { clearExpiredInvoiceEmails, readInvoiceEmailRetentionDays } from './invoice-email-retention'

const DAY_MS = 24 * 60 * 60 * 1000
const TAX_ID = '91000000MA0000000N'
const PERSONAL_NAME = '会员甲'
const COMPANY_NAME = '某单位'

interface InvoiceRow {
  id: string
  endUserId: string
  orderKind: string
  orderId: string
  titleType: string
  title: string
  taxId: string | null
  email: string | null
  emailClearedAt: Date | null
  returnReason: string | null
  amountCents: number
  status: string
  updatedAt: Date
}

function age(days: number, now: Date): Date {
  return new Date(now.getTime() - days * DAY_MS)
}

function matchesWhere(row: InvoiceRow, where: Record<string, unknown>): boolean {
  if (typeof where['endUserId'] === 'string' && row.endUserId !== where['endUserId']) return false
  if (typeof where['id'] === 'string' && row.id !== where['id']) return false
  const status = where['status'] as { in?: string[] } | undefined
  if (status?.in && !status.in.includes(row.status)) return false
  const email = where['email'] as { not?: null } | undefined
  if (email && 'not' in email && email.not === null && row.email == null) return false
  const updatedAt = where['updatedAt'] as { lt?: Date } | undefined
  if (updatedAt?.lt && !(row.updatedAt < updatedAt.lt)) return false
  return true
}

function createStore(seed: InvoiceRow[]) {
  const rows = seed.map((row) => ({ ...row }))
  const tx = {
    invoiceRequest: {
      findMany: async ({ where }: { where: Record<string, unknown> }) =>
        rows.filter((row) => matchesWhere(row, where)).map((row) => ({ ...row })),
      update: async ({ where, data }: { where: { id: string }; data: Partial<InvoiceRow> }) => {
        const row = rows.find((item) => item.id === where.id)
        if (!row) throw new Error('missing invoice')
        Object.assign(row, data)
        return { ...row }
      },
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Partial<InvoiceRow> }) => {
        const matched = rows.filter((row) => matchesWhere(row, where))
        for (const row of matched) Object.assign(row, data)
        return { count: matched.length }
      },
    },
  }
  return { rows, tx }
}

test('注销去掉个人抬头和邮箱，单位名称和税号还在，行不删', async () => {
  const now = new Date(Date.now() - 60_000)
  const { rows, tx } = createStore([
    {
      id: 'personal',
      endUserId: 'member-1',
      orderKind: 'print',
      orderId: 'order-1',
      titleType: 'personal',
      title: PERSONAL_NAME,
      taxId: null,
      email: 'member-a@example.com',
      emailClearedAt: null,
      returnReason: `${PERSONAL_NAME}来过`,
      amountCents: 300,
      status: 'submitted',
      updatedAt: now,
    },
    {
      id: 'company',
      endUserId: 'member-1',
      orderKind: 'service',
      orderId: 'order-2',
      titleType: 'company',
      title: COMPANY_NAME,
      taxId: TAX_ID,
      email: 'finance@example.com',
      emailClearedAt: null,
      returnReason: null,
      amountCents: 300,
      status: 'issued',
      updatedAt: now,
    },
    {
      id: 'other',
      endUserId: 'member-2',
      orderKind: 'print',
      orderId: 'order-3',
      titleType: 'personal',
      title: '会员乙',
      taxId: null,
      email: 'member-b@example.com',
      emailClearedAt: null,
      returnReason: null,
      amountCents: 100,
      status: 'submitted',
      updatedAt: now,
    },
  ])
  const scrub = (text: string) => text.split(PERSONAL_NAME).join('[已去标识]')
  const count = await deidentifyClosedMemberInvoices(tx as never, 'member-1', scrub)
  assert.equal(count, 2)
  assert.equal(rows.length, 3)
  const personal = rows.find((row) => row.id === 'personal')!
  const company = rows.find((row) => row.id === 'company')!
  const other = rows.find((row) => row.id === 'other')!
  assert.equal(personal.title, '[已去标识]')
  assert.equal(personal.email, null)
  assert.ok(personal.emailClearedAt instanceof Date)
  // 期望值改动（返工包 P2c1b 第 3 条）：已提交、还没处理的申请随注销转「已退回」，原因只写「会员已注销」，
  // 原先断言的「仍是已提交、原因擦成 [已去标识]来过」正是这一条要改掉的行为。
  assert.equal(personal.returnReason, '会员已注销')
  assert.equal(personal.taxId, null)
  assert.equal(personal.amountCents, 300)
  assert.equal(personal.status, 'returned')
  assert.equal(personal.endUserId, 'member-1')
  assert.equal(company.title, COMPANY_NAME)
  assert.equal(company.taxId, TAX_ID)
  assert.equal(company.email, null)
  assert.ok(company.emailClearedAt instanceof Date)
  assert.equal(company.amountCents, 300)
  assert.equal(company.status, 'issued')
  assert.equal(other.title, '会员乙')
  assert.equal(other.email, 'member-b@example.com')
  assert.equal(other.emailClearedAt, null)
})

test('注销擦掉本人申请里的个人抬头和邮箱：退回原因里的姓名、邮箱都查不到，已提交的转已退回', async () => {
  const now = new Date(Date.now() - 60_000)
  const NAME = '王小明'
  const OWN_EMAIL = 'wangxm.invoice@example.com'
  const DESK_EMAIL = 'finance.desk@example.com'
  const STRAY_EMAIL = 'someone.else@example.org'
  const base = { endUserId: 'member-1', taxId: null, emailClearedAt: null, amountCents: 300, updatedAt: now }
  const { rows, tx } = createStore([
    { ...base, id: 'returned-personal', orderKind: 'print', orderId: 'order-1', titleType: 'personal', title: NAME, email: OWN_EMAIL,
      status: 'returned', returnReason: `${NAME}的邮箱 ${OWN_EMAIL} 收不到，请重新填写` },
    { ...base, id: 'returned-company', orderKind: 'print', orderId: 'order-2', titleType: 'company', title: COMPANY_NAME, taxId: TAX_ID,
      email: DESK_EMAIL, status: 'returned', returnReason: `抬头写成了${NAME}，${DESK_EMAIL} 是单位邮箱，另抄送 ${STRAY_EMAIL}` },
    { ...base, id: 'issued-company', orderKind: 'service', orderId: 'order-3', titleType: 'company', title: COMPANY_NAME, taxId: TAX_ID,
      email: DESK_EMAIL, status: 'issued', returnReason: null },
    { ...base, id: 'submitted-personal', orderKind: 'print', orderId: 'order-4', titleType: 'personal', title: NAME, email: OWN_EMAIL,
      status: 'submitted', returnReason: null },
    { ...base, id: 'other-member', endUserId: 'member-2', orderKind: 'print', orderId: 'order-5', titleType: 'personal', title: NAME,
      email: OWN_EMAIL, status: 'returned', returnReason: `${NAME} ${OWN_EMAIL}` },
  ])
  // 注销的身份擦除器只认手机号、昵称；「王小明」和发票邮箱都不是账号身份。
  const scrub = (text: string) => text.split(PERSONAL_NAME).join('[已去标识]')
  const count = await deidentifyClosedMemberInvoices(tx as never, 'member-1', scrub)
  assert.equal(count, 4)
  for (const row of rows.filter((item) => item.endUserId === 'member-1')) {
    const text = JSON.stringify(row)
    for (const secret of [NAME, OWN_EMAIL, DESK_EMAIL, STRAY_EMAIL]) {
      assert.equal(text.includes(secret), false, `${row.id} 还留着 ${secret}`)
    }
    assert.equal(row.email, null)
  }
  const submitted = rows.find((row) => row.id === 'submitted-personal')!
  assert.equal(submitted.status, 'returned')
  assert.equal(submitted.returnReason, '会员已注销')
  assert.equal(rows.find((row) => row.id === 'issued-company')!.status, 'issued')
  assert.equal(rows.find((row) => row.id === 'returned-company')!.title, COMPANY_NAME)
  assert.equal(rows.find((row) => row.id === 'returned-company')!.taxId, TAX_ID)
  assert.equal(rows.find((row) => row.id === 'returned-company')!.amountCents, 300)
  const other = rows.find((row) => row.id === 'other-member')!
  assert.equal(other.title, NAME)
  assert.equal(other.email, OWN_EMAIL)
  assert.equal(other.returnReason, `${NAME} ${OWN_EMAIL}`)
})

// 期望值改动（返工包 P2c1b 第 11 条）：邮箱保留天数单独设 INVOICE_EMAIL_RETENTION_DAYS（默认 90），
// 不再借用 AI_SERVICE_LOG_RETENTION_DAYS；原先断言「天数与 AI 服务日志相同」正是要拆开的绑定。
test('已开或已退回满期才清邮箱，已提交和未满期留下，天数单独设、默认 90', async () => {
  assert.equal(readInvoiceEmailRetentionDays({}), 90)
  assert.equal(readInvoiceEmailRetentionDays({ AI_SERVICE_LOG_RETENTION_DAYS: '7' }), 90, '调小 AI 日志天数不该连带开票邮箱')
  assert.equal(readInvoiceEmailRetentionDays({ INVOICE_EMAIL_RETENTION_DAYS: '180' }), 180)
  assert.equal(readInvoiceEmailRetentionDays({ INVOICE_EMAIL_RETENTION_DAYS: '0' }), 90)
  assert.equal(readInvoiceEmailRetentionDays({ INVOICE_EMAIL_RETENTION_DAYS: 'abc' }), 90)
  const now = new Date()
  const { rows, tx } = createStore([
    {
      id: 'old-issued',
      endUserId: 'member-1',
      orderKind: 'print',
      orderId: 'order-1',
      titleType: 'personal',
      title: PERSONAL_NAME,
      taxId: null,
      email: 'old-issued@example.com',
      emailClearedAt: null,
      returnReason: null,
      amountCents: 100,
      status: 'issued',
      updatedAt: age(91, now),
    },
    {
      id: 'old-returned',
      endUserId: 'member-1',
      orderKind: 'service',
      orderId: 'order-2',
      titleType: 'company',
      title: COMPANY_NAME,
      taxId: TAX_ID,
      email: 'old-returned@example.com',
      emailClearedAt: null,
      returnReason: '退回',
      amountCents: 100,
      status: 'returned',
      updatedAt: age(91, now),
    },
    {
      id: 'old-submitted',
      endUserId: 'member-1',
      orderKind: 'print',
      orderId: 'order-3',
      titleType: 'personal',
      title: PERSONAL_NAME,
      taxId: null,
      email: 'old-submitted@example.com',
      emailClearedAt: null,
      returnReason: null,
      amountCents: 100,
      status: 'submitted',
      updatedAt: age(91, now),
    },
    {
      id: 'young-issued',
      endUserId: 'member-1',
      orderKind: 'print',
      orderId: 'order-4',
      titleType: 'personal',
      title: PERSONAL_NAME,
      taxId: null,
      email: 'young-issued@example.com',
      emailClearedAt: null,
      returnReason: null,
      amountCents: 100,
      status: 'issued',
      updatedAt: age(1, now),
    },
    {
      id: 'already-clear',
      endUserId: 'member-1',
      orderKind: 'print',
      orderId: 'order-5',
      titleType: 'personal',
      title: '[已去标识]',
      taxId: null,
      email: null,
      emailClearedAt: age(10, now),
      returnReason: null,
      amountCents: 100,
      status: 'issued',
      updatedAt: age(91, now),
    },
  ])
  const keptClearedAt = rows.find((row) => row.id === 'already-clear')!.emailClearedAt
  const result = await clearExpiredInvoiceEmails(tx as never, readInvoiceEmailRetentionDays({}), now)
  assert.equal(result.clearedCount, 2)
  assert.equal(rows.length, 5)
  assert.equal(rows.find((row) => row.id === 'old-issued')!.email, null)
  assert.equal(rows.find((row) => row.id === 'old-issued')!.title, PERSONAL_NAME)
  assert.equal(rows.find((row) => row.id === 'old-returned')!.email, null)
  assert.equal(rows.find((row) => row.id === 'old-returned')!.taxId, TAX_ID)
  assert.equal(rows.find((row) => row.id === 'old-returned')!.title, COMPANY_NAME)
  assert.equal(rows.find((row) => row.id === 'old-submitted')!.email, 'old-submitted@example.com')
  assert.equal(rows.find((row) => row.id === 'young-issued')!.email, 'young-issued@example.com')
  assert.equal(rows.find((row) => row.id === 'already-clear')!.emailClearedAt, keptClearedAt)
})

test('每小时任务现读开票邮箱自己的保留天数（不看 AI 日志天数），清掉的审计不带邮箱和税号', async () => {
  // 期望值改动（返工包 P2c1b 第 11 条）：任务改读 INVOICE_EMAIL_RETENTION_DAYS。AI 日志天数故意设成 7，
  // 若任务还借用它，9 天前退回的 wait 会被误清。
  const savedInvoice = process.env['INVOICE_EMAIL_RETENTION_DAYS']
  const saved = process.env['AI_SERVICE_LOG_RETENTION_DAYS']
  process.env['INVOICE_EMAIL_RETENTION_DAYS'] = '10'
  process.env['AI_SERVICE_LOG_RETENTION_DAYS'] = '7'
  try {
    const now = new Date()
    const { rows, tx } = createStore([
      {
        id: 'due',
        endUserId: 'member-1',
        orderKind: 'print',
        orderId: 'order-1',
        titleType: 'personal',
        title: PERSONAL_NAME,
        taxId: null,
        email: 'due@example.com',
        emailClearedAt: null,
        returnReason: null,
        amountCents: 100,
        status: 'issued',
        updatedAt: age(11, now),
      },
      {
        id: 'wait',
        endUserId: 'member-1',
        orderKind: 'print',
        orderId: 'order-2',
        titleType: 'company',
        title: COMPANY_NAME,
        taxId: TAX_ID,
        email: 'wait@example.com',
        emailClearedAt: null,
        returnReason: null,
        amountCents: 100,
        status: 'returned',
        updatedAt: age(9, now),
      },
    ])
    const audits: Array<Record<string, unknown>> = []
    const task = new InvoiceEmailCleanupTask(tx as never, {
      write: async (entry: Record<string, unknown>) => {
        audits.push(entry)
        return 'audit-1'
      },
    } as never)
    await task.handleHourly(now)
    assert.equal(rows.find((row) => row.id === 'due')!.email, null)
    assert.equal(rows.find((row) => row.id === 'wait')!.email, 'wait@example.com')
    assert.equal(rows.find((row) => row.id === 'wait')!.taxId, TAX_ID)
    assert.equal(audits.length, 1)
    assert.equal(audits[0]?.['action'], 'invoice.email_cleared')
    assert.equal((audits[0]?.['payload'] as Record<string, unknown>)['retentionDays'], 10)
    const payload = JSON.stringify(audits[0]?.['payload'])
    assert.equal(payload.includes('due@example.com'), false)
    assert.equal(payload.includes(TAX_ID), false)
    assert.equal(payload.includes(PERSONAL_NAME), false)
  } finally {
    if (saved === undefined) delete process.env['AI_SERVICE_LOG_RETENTION_DAYS']
    else process.env['AI_SERVICE_LOG_RETENTION_DAYS'] = saved
    if (savedInvoice === undefined) delete process.env['INVOICE_EMAIL_RETENTION_DAYS']
    else process.env['INVOICE_EMAIL_RETENTION_DAYS'] = savedInvoice
  }
})
