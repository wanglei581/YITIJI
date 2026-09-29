import { test, expect } from '../fixtures/kiosk-test'

for (const scenario of [
  { name: 'incomplete 200 receipt', status: 200, body: {} },
  { name: 'server 503 response', status: 503, body: { error: { code: 'UNKNOWN_ERROR' } } },
]) {
  test(`pickup treats ${scenario.name} as unknown and rechecks the same code @w2`, async ({ page, api }) => {
    api.respond('GET', '/api/v1/terminals/KSK-001/screensaver', {
      status: 200, json: { enabled: false, idleTimeoutSec: 180, items: [] },
    })
    api.respond('GET', '/api/v1/terminals/KSK-001/printer-status', {
      status: 200, json: { printerStatus: 'ready', paperLevel: 'sufficient', isOnline: true },
    })
    if (scenario.status === 200) await page.setViewportSize({ width: 390, height: 844 })

    let claims = 0
    const submitted: string[] = []
    await page.route('**/api/v1/print/jobs/claim-pickup', async route => {
      claims += 1
      submitted.push((route.request().postDataJSON() as { code: string }).code)
      await route.fulfill({
        status: claims === 1 ? scenario.status : 200,
        contentType: 'application/json',
        body: JSON.stringify(claims === 1 ? scenario.body : {
          released: false,
          orderId: 'receipt-order',
          orderNo: 'ORD-RECEIPT',
          terminalId: 'KSK-001',
          amountCents: 100,
          priceLines: [],
          paymentSessionToken: 'receipt-payment-session',
        }),
      })
    })

    await page.goto('/print/pickup-claim')
    await page.getByLabel('到机码输入框').fill('28491703')
    await expect(page.getByTestId('arrival-code-state-network-error')).toBeVisible()
    await expect(page.getByText('订单核验成功', { exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: '重试校验' }).click()
    await expect(page.getByText('订单核验成功', { exact: true })).toBeVisible()
    expect(claims).toBe(2)
    expect(submitted).toEqual(['28491703', '28491703'])
    if (scenario.status === 200) {
      const primary = page.getByRole('button', { name: '进入现场支付' })
      await primary.scrollIntoViewIfNeeded()
      const box = await primary.boundingBox()
      expect(box).not.toBeNull()
      const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('button')?.textContent, {
        x: box!.x + box!.width / 2, y: box!.y + box!.height / 2,
      })
      expect(hit).toContain('进入现场支付')
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    }
  })
}
