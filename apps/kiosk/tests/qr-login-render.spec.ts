import { test, expect } from './fixtures/kiosk-test'

const LOCAL_QR_CREATE_URL = 'http://127.0.0.1:9527/local/qr-login/create'
const BRIDGE_TOKEN = 'playwright-local-bridge-token-0123456789abcdef'
const TICKET_ID = 'playwright_qr_ticket_0123456789abcdef'

test('扫码登录拿到真实票据后渲染可扫描 SVG @kiosk', async ({ page, api }) => {
  api.respond('GET', '/api/v1/kiosk/legal/terms_of_service', {
    status: 200,
    json: { success: true, data: null },
  })
  api.respond('GET', '/api/v1/kiosk/legal/privacy_policy', {
    status: 200,
    json: { success: true, data: null },
  })
  api.respond('GET', `/api/v1/member/auth/qr/${TICKET_ID}/status`, {
    status: 200,
    json: {
      success: true,
      data: { status: 'pending', deviceLabel: 'KSK-001', returnTo: '/', expiresInSeconds: 180 },
    },
  })
  api.respond('GET', '/api/v1/terminals/KSK-001/screensaver', {
    status: 200,
    json: { enabled: false, idleTimeoutSec: 180, items: [] },
  })

  let createCalls = 0
  await page.route(LOCAL_QR_CREATE_URL, async (route) => {
    const request = route.request()
    const origin = request.headers().origin ?? 'http://127.0.0.1:4177'
    if (request.method() === 'OPTIONS') {
      await route.fulfill({
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, X-Local-Bridge-Token',
          'Access-Control-Allow-Private-Network': 'true',
        },
      })
      return
    }

    expect(request.method()).toBe('POST')
    expect(request.headers()['x-local-bridge-token']).toBe(BRIDGE_TOKEN)
    createCalls += 1
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': origin },
      body: JSON.stringify({
        success: true,
        data: {
          ticketId: TICKET_ID,
          qrUrl: `/member/qr-login?ticketId=${TICKET_ID}`,
          expiresInSeconds: 180,
          returnTo: '/',
        },
      }),
    })
  })

  await page.goto('/login')
  await page.getByRole('checkbox', { name: /我已阅读并同意/ }).click()
  await page.getByRole('button', { name: '手机扫码登录', exact: true }).click()

  const qrFrame = page.locator('.k-qrframe')
  await expect(qrFrame.locator('svg')).toBeVisible()
  await expect(qrFrame.locator('.k-qr-placeholder')).toHaveCount(0)
  await expect(page.getByText(/二维码.*后过期/)).toBeVisible()
  expect(createCalls).toBe(1)
})
