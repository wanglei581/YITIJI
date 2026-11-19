import assert from 'node:assert/strict'
import { test } from 'node:test'
import { INVOICE_BLOCK_MESSAGES } from './invoice-eligibility'
import { InvoiceRequestsService } from './invoice-requests.service'
import { invoiceSessionKey, type InvoiceRedis } from './invoice-scene'
import { InvoiceSessionsService } from './invoice-sessions.service'

const MEMBER = 'member-1'
const TERMINAL = 'terminal-1'
const EMAIL = 'person@example.com'
const TAX_ID = '91000000MA0000000N'

class MemoryRedis implements InvoiceRedis {
  private readonly rows = new Map<string, { value: string; expiresAt: number }>()

  async get(key: string): Promise<string | null> {
    const row = this.rows.get(key)
    if (!row) return null
    if (row.expiresAt <= Date.now()) {
      this.rows.delete(key)
      return null
    }
    return row.value
  }

  async setEx(key: string, ttlSeconds: number, value: string): Promise<void> {
    this.rows.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 })
  }

  async setIfAbsent(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    if (await this.get(key)) return false
    await this.setEx(key, ttlSeconds, value)
    return true
  }

  async del(key: string): Promise<void> {
    this.rows.delete(key)
  }

  dump(): string {
    return [...this.rows.values()].map((row) => row.value).join('\n')
  }

  keys(): string[] {
    return [...this.rows.keys()]
  }
}

function paidPrint() {
  return {
    id: 'order-1',
    endUserId: MEMBER,
    terminalId: TERMINAL,
    payStatus: 'paid',
    amountCents: 300,
    discountCents: 100,
    refundedAmountCents: 0,
    refunds: [] as Array<{ status: string }>,
  }
}

function createHarness(order = paidPrint()) {
  const redis = new MemoryRedis()
  const invoices: Array<Record<string, unknown>> = []
  const prisma = {
    order: {
      findUnique: async ({ where }: { where: { id: string } }) => (where.id === order.id ? order : null),
    },
    serviceOrder: {
      findUnique: async () => null,
    },
    terminal: {
      findUnique: async () => ({ org: { type: 'licensed_hr_agency' } }),
    },
    invoiceRequest: {
      findFirst: async ({ where }: { where: { orderKind: string; orderId: string } }) =>
        invoices.find((row) => row['orderKind'] === where.orderKind && row['orderId'] === where.orderId && row['status'] !== 'returned') ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const open = invoices.find((row) => row['orderKind'] === data['orderKind'] && row['orderId'] === data['orderId'] && row['status'] !== 'returned')
        if (open) {
          const error = new Error('unique') as Error & { code?: string }
          error.code = 'P2002'
          throw error
        }
        const row = { id: `inv-${invoices.length + 1}`, status: 'submitted', ...data }
        invoices.push(row)
        return row
      },
    },
  }
  const requests = new InvoiceRequestsService(prisma as never)
  const sessions = new InvoiceSessionsService(redis, requests)
  return { redis, invoices, sessions }
}

test('一体机轮询只有三种状态，返回里没有税号和邮箱', async () => {
  process.env['FILE_SIGNING_SECRET'] = 'invoice-test-signing-secret-0123456789'
  const { sessions, redis, invoices } = createHarness()
  const created = await sessions.create({
    terminalId: TERMINAL,
    endUserId: MEMBER,
    orderKind: 'print',
    orderId: 'order-1',
    origin: 'https://kiosk.example',
  })
  assert.equal(created.codeUrl, `https://kiosk.example/k/i/${created.sceneToken}`)
  assert.equal('taxId' in created, false)
  assert.equal('email' in created, false)
  assert.equal('submitToken' in created, false)
  assert.equal(redis.dump().includes(created.controlToken), false)
  assert.equal(redis.keys().some((key) => key.includes(created.sceneToken)), false)

  const waiting = await sessions.poll(created.sessionId, created.controlToken)
  assert.deepEqual(waiting, { status: '等手机填写' })
  assert.equal('taxId' in waiting, false)
  assert.equal('email' in waiting, false)

  const redeemed = await sessions.resolveScene(created.sceneToken)
  assert.equal(redeemed.status, '等手机填写')
  assert.equal('taxId' in redeemed, false)
  assert.equal('email' in redeemed, false)

  const submitted = await sessions.submit(created.sessionId, {
    submitToken: redeemed.submitToken,
    titleType: 'company',
    title: '某单位',
    taxId: TAX_ID,
    email: EMAIL,
  })
  assert.equal(submitted.status, '已提交')
  assert.equal(submitted.message, '已提交。开好后，电子发票发到你填的邮箱。')
  const after = await sessions.poll(created.sessionId, created.controlToken)
  assert.deepEqual(after, { status: '已提交' })
  assert.equal(redis.dump().includes(EMAIL), false)
  assert.equal(redis.dump().includes(TAX_ID), false)
  assert.equal(redis.dump().includes(redeemed.submitToken), false)
  assert.equal(invoices[0]?.['taxId'], TAX_ID)
  assert.equal(invoices[0]?.['email'], EMAIL)
  assert.equal(invoices[0]?.['amountCents'], 200)
  assert.equal(invoices[0]?.['title'], '某单位')
})

test('已退款的单提交不了，第二次提交也不成功', async () => {
  process.env['FILE_SIGNING_SECRET'] = 'invoice-test-signing-secret-0123456789'
  const refunded = createHarness({ ...paidPrint(), payStatus: 'refunded', refundedAmountCents: 200 })
  await assert.rejects(
    () => refunded.sessions.create({
      terminalId: TERMINAL,
      endUserId: MEMBER,
      orderKind: 'print',
      orderId: 'order-1',
      origin: 'https://kiosk.example',
    }),
    (error: unknown) => {
      const body = (error as { getResponse?: () => { error?: { code?: string; message?: string } } }).getResponse?.()
      assert.equal(body?.error?.message, INVOICE_BLOCK_MESSAGES.refunded)
      // 同一个挡单条件，一体机建会话口与会员提交口返回同一个状态码和错误码（409 INVOICE_NOT_ALLOWED）。
      assert.equal((error as { getStatus?: () => number }).getStatus?.(), 409)
      assert.equal(body?.error?.code, 'INVOICE_NOT_ALLOWED')
      return true
    },
  )
  assert.equal(refunded.redis.dump(), '')

  const { sessions } = createHarness()
  const created = await sessions.create({
    terminalId: TERMINAL,
    endUserId: MEMBER,
    orderKind: 'print',
    orderId: 'order-1',
    origin: 'https://kiosk.example',
  })
  const redeemed = await sessions.resolveScene(created.sceneToken)
  await sessions.submit(created.sessionId, {
    submitToken: redeemed.submitToken,
    titleType: 'personal',
    title: '张三',
    email: EMAIL,
  })
  await assert.rejects(
    () => sessions.submit(created.sessionId, {
      submitToken: redeemed.submitToken,
      titleType: 'personal',
      title: '张三',
      email: EMAIL,
    }),
    (error: unknown) => {
      const body = (error as { getResponse?: () => { error?: { message?: string } } }).getResponse?.()
      assert.equal(body?.error?.message, '这份开票信息已经提交过了。请回到一体机查看。')
      return true
    },
  )
})

test('过期后轮询是已过期，个人带税号会被拒绝', async () => {
  process.env['FILE_SIGNING_SECRET'] = 'invoice-test-signing-secret-0123456789'
  const { sessions, redis } = createHarness()
  const created = await sessions.create({
    terminalId: TERMINAL,
    endUserId: MEMBER,
    orderKind: 'print',
    orderId: 'order-1',
    origin: 'https://kiosk.example',
  })
  const redeemed = await sessions.resolveScene(created.sceneToken)
  await assert.rejects(
    () => sessions.submit(created.sessionId, {
      submitToken: redeemed.submitToken,
      titleType: 'personal',
      title: '张三',
      taxId: TAX_ID,
      email: EMAIL,
    }),
    (error: unknown) => {
      const body = (error as { getResponse?: () => { error?: { message?: string } } }).getResponse?.()
      assert.equal(body?.error?.message, '个人不用填税号。')
      return true
    },
  )
  const raw = await redis.get(invoiceSessionKey(created.sessionId))
  const record = JSON.parse(raw ?? '{}') as { expiresAt: string }
  record.expiresAt = new Date(Date.now() - 1000).toISOString()
  await redis.setEx(invoiceSessionKey(created.sessionId), 600, JSON.stringify(record))
  assert.deepEqual(await sessions.poll(created.sessionId, created.controlToken), { status: '已过期' })
})
