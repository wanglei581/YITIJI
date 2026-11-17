import { test, expect } from '../fixtures/kiosk-test'

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
