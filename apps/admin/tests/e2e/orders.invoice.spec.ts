import { expect, test, type Page, type Route } from '@playwright/test'
import { MOCK_ADMIN_AUTH } from './helpers/auth'
import { openAuthed } from './helpers/open'

const ORDER_ID = 'ord-invoice-probe'
const ORDER_NO = 'ORD-INVOICE-PROBE'
const EMAIL = 'person@example.com'
const TAX_ID = '91000000MA0000000N'

function orderItem() {
  const stamp = new Date(Date.now() - 60_000).toISOString()
  return {
    id: ORDER_ID,
    orderNo: ORDER_NO,
    type: 'print',
    ownerType: 'member' as const,
    userLabel: '演示会员',
    terminalCode: 'KSK-001',
    amountCents: 200,
    billablePages: 1,
    currency: 'CNY',
    channel: null,
    pickupStatus: 'none',
    pickupCodeExpiresAt: null,
    payStatus: 'paid',
    taskStatus: 'completed',
    printFileName: '简历.pdf',
    copies: 1,
    colorMode: 'black_white' as const,
    paperSize: 'A4',
    errorCode: null,
    printOutcome: null,
    aftercareStatus: null,
    refundEligible: false,
    retryForbidden: false,
    refundRequired: false,
    opsAttention: false,
    opsAttentionCode: null,
    createdAt: stamp,
    updatedAt: stamp,
    locationLabel: null,
  }
}

function orderDetail() {
  const item = orderItem()
  return {
    ...item,
    refundedAt: null,
    refundReason: null,
    discountCents: 0,
    refundedAmountCents: 0,
    printTaskId: null,
    print: {
      fileName: '简历.pdf',
      copies: 1,
      colorMode: 'black_white',
      duplex: 'simplex',
      paperSize: 'A4',
      pageRange: null,
      status: 'completed',
      createdAt: item.createdAt,
      completedAt: item.createdAt,
      errorCode: null,
    },
    statusLogs: [],
  }
}

interface Conflict {
  code: string
  message: string
  /** 冲突发生时库里已经变成的状态（另一位管理员先动了，或者状态没变）。 */
  nextStatus: 'submitted' | 'issued' | 'returned'
  nextInvoiceNo?: string | null
  nextReturnReason?: string | null
}

async function installOrders(page: Page, conflicts: { issue?: Conflict; return?: Conflict } = {}) {
  const posts: Array<{ path: string; body: unknown }> = []
  const invoiceReads: string[] = []
  let status = 'submitted'
  let invoiceNo: string | null = null
  let returnReason: string | null = null
  await page.route('**/api/v1/**', async (route: Route) => {
    const request = route.request()
    const url = new URL(request.url())
    const json = (body: unknown, code = 200) => route.fulfill({
      status: code,
      contentType: 'application/json',
      body: JSON.stringify(body),
    })
    if (url.pathname.endsWith('/auth/me')) {
      return json({ data: { userId: MOCK_ADMIN_AUTH.user.id, role: 'admin', orgId: null } })
    }
    if (request.method() === 'GET' && url.pathname.endsWith(`/admin/orders/${ORDER_ID}/invoice`)) {
      invoiceReads.push(status)
      return json({
        id: 'inv-probe',
        orderKind: 'print',
        orderId: ORDER_ID,
        titleType: 'company',
        title: '某单位',
        taxId: TAX_ID,
        email: EMAIL,
        amountCents: 200,
        status,
        issuedAt: status === 'issued' ? new Date().toISOString() : null,
        invoiceNo,
        returnReason,
      })
    }
    if (request.method() === 'GET' && url.pathname.endsWith(`/admin/orders/${ORDER_ID}`)) {
      return json(orderDetail())
    }
    if (request.method() === 'GET' && url.pathname.endsWith('/admin/orders')) {
      const item = orderItem()
      return json({ items: [item], pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 } })
    }
    if (request.method() === 'POST' && url.pathname.endsWith('/admin/invoice-requests/inv-probe/issue')) {
      const body = request.postDataJSON() as { invoiceNo?: string }
      posts.push({ path: url.pathname, body })
      if (conflicts.issue) {
        status = conflicts.issue.nextStatus
        invoiceNo = conflicts.issue.nextInvoiceNo ?? null
        returnReason = conflicts.issue.nextReturnReason ?? null
        return json({ success: false, error: { code: conflicts.issue.code, message: conflicts.issue.message } }, 409)
      }
      status = 'issued'
      invoiceNo = body.invoiceNo ?? null
      return json({
        id: 'inv-probe',
        orderKind: 'print',
        orderId: ORDER_ID,
        titleType: 'company',
        title: '某单位',
        taxId: TAX_ID,
        email: EMAIL,
        amountCents: 200,
        status,
        issuedAt: new Date().toISOString(),
        invoiceNo,
        returnReason: null,
      })
    }
    if (request.method() === 'POST' && url.pathname.endsWith('/admin/invoice-requests/inv-probe/return')) {
      const body = request.postDataJSON() as { reason?: string }
      posts.push({ path: url.pathname, body })
      if (conflicts.return) {
        status = conflicts.return.nextStatus
        invoiceNo = conflicts.return.nextInvoiceNo ?? null
        returnReason = conflicts.return.nextReturnReason ?? null
        return json({ success: false, error: { code: conflicts.return.code, message: conflicts.return.message } }, 409)
      }
      status = 'returned'
      returnReason = body.reason ?? null
      return json({
        id: 'inv-probe',
        orderKind: 'print',
        orderId: ORDER_ID,
        titleType: 'company',
        title: '某单位',
        taxId: TAX_ID,
        email: EMAIL,
        amountCents: 200,
        status,
        issuedAt: null,
        invoiceNo: null,
        returnReason,
      })
    }
    return json({ items: [], total: 0, data: [] })
  })
  return { posts, invoiceReads }
}

async function openOrder(page: Page) {
  await openAuthed(page, '/orders')
  await expect(page.getByRole('heading', { name: '订单管理' })).toBeVisible()
  await page.getByRole('button', { name: `查看订单 ${ORDER_NO}`, exact: true }).click()
  await expect(page.getByRole('heading', { name: '开票申请' })).toBeVisible()
}

test('标已开可以填写发票号码，提交后按钮消失', async ({ page }) => {
  const orders = await installOrders(page)
  await openOrder(page)
  await expect(page.getByText('某单位')).toBeVisible()
  await expect(page.getByText(TAX_ID)).toBeVisible()
  await expect(page.getByText(EMAIL)).toBeVisible()
  await expect(page.getByText('已提交')).toBeVisible()
  await page.getByRole('button', { name: '标已开', exact: true }).click()
  await page.getByLabel('发票号码（选填）').fill('INV-PROBE')
  await page.getByRole('button', { name: '确认标已开', exact: true }).click()
  await expect(page.getByText('已开')).toBeVisible()
  await expect(page.getByRole('button', { name: '标已开', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '退回', exact: true })).toHaveCount(0)
  expect(orders.posts).toEqual([{ path: '/api/v1/admin/invoice-requests/inv-probe/issue', body: { invoiceNo: 'INV-PROBE' } }])
})

test('退回必须填写原因，提交后状态变成已退回', async ({ page }) => {
  const orders = await installOrders(page)
  await openOrder(page)
  await page.getByRole('button', { name: '退回', exact: true }).click()
  await expect(page.getByRole('button', { name: '确认退回', exact: true })).toBeDisabled()
  await page.getByLabel('退回原因').fill('抬头与付款人不符')
  await page.getByRole('button', { name: '确认退回', exact: true }).click()
  await expect(page.getByText('已退回')).toBeVisible()
  await expect(page.getByRole('button', { name: '退回', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '标已开', exact: true })).toHaveCount(0)
  expect(orders.posts).toEqual([{ path: '/api/v1/admin/invoice-requests/inv-probe/return', body: { reason: '抬头与付款人不符' } }])
})

test('标已开撞上别人先开了（409）：重新读申请，按最新状态画，按钮不再出现', async ({ page }) => {
  const orders = await installOrders(page, {
    issue: { code: 'INVOICE_NOT_SUBMITTED', message: '只有已提交的申请可以标已开。', nextStatus: 'issued', nextInvoiceNo: 'INV-OTHER' },
  })
  await openOrder(page)
  await page.getByRole('button', { name: '标已开', exact: true }).click()
  await page.getByLabel('发票号码（选填）').fill('INV-MINE')
  await page.getByRole('button', { name: '确认标已开', exact: true }).click()
  await expect(page.getByText('只有已提交的申请可以标已开。')).toBeVisible()
  await expect(page.getByText('已开', { exact: true })).toBeVisible()
  await expect(page.getByText('INV-OTHER', { exact: true })).toBeVisible()
  await expect(page.getByText('已提交', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '标已开', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '退回', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '确认标已开', exact: true })).toHaveCount(0)
  expect(orders.invoiceReads).toEqual(['submitted', 'issued'])
})

test('标已开时订单已退款（409）：仍是已提交，表单不收起，刚填的发票号码还在，可以改去退回', async ({ page }) => {
  const orders = await installOrders(page, {
    issue: { code: 'INVOICE_ORDER_NOT_ISSUABLE', message: '已退款的单，开不了发票。请点「退回」，写明原因。', nextStatus: 'submitted' },
  })
  await openOrder(page)
  await page.getByRole('button', { name: '标已开', exact: true }).click()
  await page.getByLabel('发票号码（选填）').fill('INV-KEEP')
  await page.getByRole('button', { name: '确认标已开', exact: true }).click()
  await expect(page.getByText('已退款的单，开不了发票。请点「退回」，写明原因。')).toBeVisible()
  await expect(page.getByLabel('发票号码（选填）')).toHaveValue('INV-KEEP')
  await expect(page.getByRole('button', { name: '确认标已开', exact: true })).toBeEnabled()
  await expect(page.getByText('已提交', { exact: true })).toBeVisible()
  expect(orders.invoiceReads).toEqual(['submitted', 'submitted'])
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await expect(page.getByRole('button', { name: '退回', exact: true })).toBeVisible()
})

test('退回撞上别人先退了（409）：重新读申请，显示最新原因，按钮不再出现', async ({ page }) => {
  const orders = await installOrders(page, {
    return: { code: 'INVOICE_NOT_SUBMITTED', message: '只有已提交的申请可以退回。', nextStatus: 'returned', nextReturnReason: '抬头与付款人不符（另一位管理员）' },
  })
  await openOrder(page)
  await page.getByRole('button', { name: '退回', exact: true }).click()
  await page.getByLabel('退回原因').fill('邮箱写错了')
  await page.getByRole('button', { name: '确认退回', exact: true }).click()
  await expect(page.getByText('只有已提交的申请可以退回。')).toBeVisible()
  await expect(page.getByText('已退回', { exact: true })).toBeVisible()
  await expect(page.getByText('抬头与付款人不符（另一位管理员）')).toBeVisible()
  await expect(page.getByRole('button', { name: '退回', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '确认退回', exact: true })).toHaveCount(0)
  expect(orders.invoiceReads).toEqual(['submitted', 'returned'])
})
