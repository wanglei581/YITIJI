import { test, expect } from '../fixtures/kiosk-test'
import { kioskProfileBody, UNVERIFIED_KIOSK_PROFILE } from '../fixtures/kiosk-profile'

test('pickup arrival charge explains the machine price and offers pay or back @w2', async ({ page, api }) => {
  api.respond('GET', '/api/v1/terminals/KSK-001/screensaver', {
    status: 200, json: { enabled: false, idleTimeoutSec: 180, items: [] },
  })
  api.respond('GET', '/api/v1/terminals/KSK-001/printer-status', {
    status: 200, json: { printerStatus: 'ready', paperLevel: 'sufficient', isOnline: true },
  })
  const receipt = {
    released: false,
    orderId: 'arrival-order',
    orderNo: 'ORD-ARRIVAL',
    terminalId: 'KSK-001',
    amountCents: 200,
    priceLines: [],
    paymentSessionToken: 'arrival-payment-session',
    arrivalChargeNotice: true,
  }
  await page.route('**/api/v1/print/jobs/claim-pickup', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(receipt) })
  })
  await page.route('**/api/v1/payment/channels', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ channels: ['sandbox'] }) })
  })
  await page.route('**/api/v1/orders/arrival-order/pay-status', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ payStatus: 'failed', attempt: null }),
    })
  })

  await page.goto('/print/pickup-claim')
  await page.getByLabel('到机码输入框').fill('28491703')
  await expect(page.getByTestId('pickup-arrival-charge')).toContainText('这台机器打印收费，本单 2.00 元，付完就出纸')
  await expect(page.getByTestId('pickup-arrival-charge')).toContainText('下一步进收银台。付好了才开始打印。核查确认没出纸后，钱自动退回原付款账户，到账时间以支付渠道为准。')
  await expect(page.getByTestId('pickup-arrival-charge')).toContainText('付不成可以返回，订单还在，可以再来付款。')
  await expect(page.getByRole('button', { name: '进入现场支付' })).toBeVisible()
  // 页眉返回键的读屏名是「返回上一步」，底栏才是这一屏的「返回」。
  const back = page.getByRole('button', { name: '返回', exact: true })
  await expect(back).toBeVisible()

  await back.click()
  await expect.poll(() => api.requestCount('POST', '/api/v1/orders/arrival-order/pay/abandon')).toBe(1)
  await expect(page.getByLabel('到机码输入框')).toBeVisible()
  await expect(page.getByTestId('pickup-arrival-charge')).toHaveCount(0)

  await page.getByLabel('到机码输入框').fill('28491703')
  await expect(page.getByTestId('pickup-arrival-charge')).toBeVisible()
  await page.getByRole('button', { name: '进入现场支付' }).click()
  await expect(page).toHaveURL(/\/print\/cashier/)
  // 页眉状态条和标题都写「订单支付已失败」，对准标题，避免两个节点都不唯一。
  await expect(page.getByRole('heading', { name: '订单支付已失败' })).toBeVisible()
  await expect(page.getByRole('button', { name: '重新发起打印' })).toBeVisible()
})

const PAY_RECEIPT = {
  released: false,
  orderId: 'arrival-order',
  orderNo: 'ORD-ARRIVAL',
  terminalId: 'KSK-001',
  amountCents: 200,
  priceLines: [],
  paymentSessionToken: 'arrival-payment-session',
  arrivalChargeNotice: true,
}

const FREE_RECEIPT = {
  released: true,
  taskId: 'task-public-free',
  orderId: 'arrival-order',
  orderNo: 'ORD-ARRIVAL',
  terminalId: 'KSK-PUBLIC',
  taskStatus: 'pending',
  printTaskStatus: 'pending',
  amountCents: 0,
  paymentSessionToken: 'public-free-session',
  arrivalChargeNotice: false,
}

function stubMachine(api: { respond: (method: string, path: string, body: { status: number; json: unknown }) => void }, terminalId: string) {
  api.respond('GET', `/api/v1/terminals/${terminalId}/screensaver`, {
    status: 200, json: { enabled: false, idleTimeoutSec: 180, items: [] },
  })
  api.respond('GET', `/api/v1/terminals/${terminalId}/printer-status`, {
    status: 200, json: { printerStatus: 'ready', paperLevel: 'sufficient', isOnline: true },
  })
}

test('返回后再输同一枚到机码，订单还在，仍然可以付款 @w2', async ({ page, api }) => {
  stubMachine(api, 'KSK-001')
  const codes: string[] = []
  await page.route('**/api/v1/print/jobs/claim-pickup', async (route) => {
    const body = route.request().postDataJSON() as { code?: string }
    codes.push(body.code ?? '')
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PAY_RECEIPT) })
  })

  await page.goto('/print/pickup-claim')
  await page.getByLabel('到机码输入框').fill('28491703')
  const notice = page.getByTestId('pickup-arrival-charge')
  await expect(notice).toContainText('付不成可以返回，订单还在，可以再来付款。')
  await expect(notice).not.toContainText(/岗位|招聘|投递/)
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await expect.poll(() => api.requestCount('POST', '/api/v1/orders/arrival-order/pay/abandon')).toBe(1)
  await expect(page.getByLabel('到机码输入框')).toBeVisible()
  await expect(notice).toHaveCount(0)

  await page.getByLabel('到机码输入框').fill('28491703')
  await expect(notice).toContainText('这台机器打印收费，本单 2.00 元，付完就出纸')
  await expect(page.getByRole('button', { name: '进入现场支付' })).toBeVisible()
  expect(codes).toEqual(['28491703', '28491703'])
})

test('换到不收费的机器再输同一枚到机码，不再要求付款 @w2', async ({ page, browser, api }) => {
  stubMachine(api, 'KSK-001')
  await page.route('**/api/v1/print/jobs/claim-pickup', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PAY_RECEIPT) })
  })
  await page.goto('/print/pickup-claim')
  await page.getByLabel('到机码输入框').fill('28491703')
  await expect(page.getByTestId('pickup-arrival-charge')).toContainText('本单 2.00 元')
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await expect.poll(() => api.requestCount('POST', '/api/v1/orders/arrival-order/pay/abandon')).toBe(1)
  await expect(page.getByLabel('到机码输入框')).toBeVisible()

  const context = await browser.newContext({ viewport: { width: 1080, height: 1920 }, locale: 'zh-CN' })
  const other = await context.newPage()
  try {
    await other.route('http://127.0.0.1:9527/local/terminal-identity', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ success: true, data: { terminalId: 'KSK-PUBLIC', terminalCode: 'KSK-PUBLIC' } }),
      })
    })
    await other.route('**/api/v1/terminals/KSK-PUBLIC/screensaver', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ enabled: false, idleTimeoutSec: 180, items: [] }) })
    })
    await other.route('**/api/v1/terminals/KSK-PUBLIC/printer-status', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ printerStatus: 'ready', paperLevel: 'sufficient', isOnline: true }) })
    })
    await other.route('**/api/v1/public/support-contact**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: { servicePhone: '18369161921', serviceHours: '工作日 9:00–18:00', otherOnlineTerminalNearby: false, miniappPublished: false },
        }),
      })
    })
    await other.route('**/api/v1/public/kiosk-profile', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(kioskProfileBody(UNVERIFIED_KIOSK_PROFILE)),
      })
    })
    const terminals: string[] = []
    await other.route('**/api/v1/print/jobs/claim-pickup', async (route) => {
      terminals.push(route.request().headers()['x-terminal-id'] ?? '')
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FREE_RECEIPT) })
    })
    await other.goto('http://127.0.0.1:4182/print/pickup-claim')
    await other.getByLabel('到机码输入框').fill('28491703')
    await expect(other.getByRole('heading', { name: '已进入打印队列' })).toBeVisible()
    await expect(other.getByTestId('pickup-arrival-charge')).toHaveCount(0)
    await expect(other.getByRole('button', { name: '进入现场支付' })).toHaveCount(0)
    await expect(other.getByTestId('arrival-code-state-success')).not.toContainText(/岗位|招聘|投递/)
    expect(terminals).toEqual(['KSK-PUBLIC'])
  } finally {
    await context.close()
  }
})
