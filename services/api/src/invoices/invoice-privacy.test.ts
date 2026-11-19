import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readAiServiceLogRetentionDays } from '../ai/ai-result.cleanup.task'
import { deidentifyClosedMemberInvoices } from '../member-privacy/member-closure-retention'
import { InvoiceEmailCleanupTask } from './invoice-email-cleanup.task'
import { clearExpiredInvoiceEmails } from './invoice-email-retention'

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
  assert.equal(personal.returnReason, '[已去标识]来过')
  assert.equal(personal.taxId, null)
  assert.equal(personal.amountCents, 300)
  assert.equal(personal.status, 'submitted')
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

test('已开或已退回满期才清邮箱，已提交和未满期留下，天数与 AI 服务日志相同', async () => {
  assert.equal(readAiServiceLogRetentionDays({}), 90)
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
  const result = await clearExpiredInvoiceEmails(tx as never, readAiServiceLogRetentionDays({}), now)
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

test('每小时任务现读保留天数，清掉的审计不带邮箱和税号', async () => {
  const saved = process.env['AI_SERVICE_LOG_RETENTION_DAYS']
  process.env['AI_SERVICE_LOG_RETENTION_DAYS'] = '10'
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
    const payload = JSON.stringify(audits[0]?.['payload'])
    assert.equal(payload.includes('due@example.com'), false)
    assert.equal(payload.includes(TAX_ID), false)
    assert.equal(payload.includes(PERSONAL_NAME), false)
  } finally {
    if (saved === undefined) delete process.env['AI_SERVICE_LOG_RETENTION_DAYS']
    else process.env['AI_SERVICE_LOG_RETENTION_DAYS'] = saved
  }
})
