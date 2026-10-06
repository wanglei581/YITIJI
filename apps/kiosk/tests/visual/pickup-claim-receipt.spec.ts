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
    await expect(page.getByLabel('到机码输入框')).toHaveValue('')
    await expect(page.locator('.pcp-codebox')).not.toContainText(/[0-9A-Z]/)
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

for (const printerCode of ['PRINT_TERMINAL_QUEUE_HALTED', 'PRINTER_UNAVAILABLE']) {
  test(`pickup ${printerCode} clears input and retries the same code after recovery @w2`, async ({ page, api }) => {
    api.respond('GET', '/api/v1/terminals/KSK-001/screensaver', { status: 200, json: { enabled: false, idleTimeoutSec: 180, items: [] } })
    api.respond('GET', '/api/v1/terminals/KSK-001/printer-status', { status: 200, json: { printerStatus: 'ready', isOnline: true, paperLevel: 'sufficient' } })
    // 服务端原话仍叫人找现场工作人员。屏上必须换成标准句，并且默认单点位不写「换一台机器」。
    const staffMessage = printerCode === 'PRINT_TERMINAL_QUEUE_HALTED'
      ? '这台终端暂停接打印单，你的到机码没有作废，请稍后再来这台终端输码，或找现场工作人员'
      : '这台终端的打印机暂不可用，你的到机码没有作废，请稍后再来这台终端输码，或找现场工作人员'
    const phone = '拨打服务电话 18369161921（工作日 9:00–18:00）'
    const message = printerCode === 'PRINT_TERMINAL_QUEUE_HALTED'
      ? `你的到机码没有作废。这台机器暂时不能用，请稍后再来，或${phone}。`
      : `你的到机码没有作废。这台机器暂时打不了，我们已经收到提醒，会尽快处理。请稍后再来；需要帮助请${phone}。`
    const submitted: string[] = []
    await page.route('**/api/v1/print/jobs/claim-pickup', async route => {
      submitted.push((route.request().postDataJSON() as { code: string }).code)
      await route.fulfill({ status: submitted.length === 1 ? 400 : 200, contentType: 'application/json', body: JSON.stringify(submitted.length === 1
        ? { error: { code: printerCode, message: staffMessage } }
        : { released: false, orderId: 'gate-order', orderNo: 'ORD-GATE', terminalId: 'KSK-001', amountCents: 100, paymentSessionToken: 'gate-payment-session' }) })
    })
    await page.goto('/print/pickup-claim')
    await page.getByLabel('到机码输入框').fill('28491703')
    await expect(page.getByTestId('arrival-code-state-failed')).toBeVisible()
    await expect(page.getByRole('alert')).toContainText(message)
    await expect(page.getByRole('alert')).not.toContainText('工作人员')
    await expect(page.locator('body')).not.toContainText('换一台机器')
    // 输入框清空：扫码枪再扫不会接在旧码后面拼出错码；「重试校验」用失败时记下的原码重发。
    await expect(page.getByLabel('到机码输入框')).toHaveValue('')
    // W-117：公共终端上被拒的码不得继续回显；重试仍应提交同一码。
    await expect(page.locator('.pcp-codebox')).not.toContainText(/[0-9A-Z]/)
    await expect(page.locator('body')).not.toContainText('28491703')
    await page.getByRole('button', { name: '重试校验' }).click()
    await expect(page.getByText('订单核验成功', { exact: true })).toBeVisible()
    expect(submitted).toEqual(['28491703', '28491703'])
  })
}

test('pickup names another machine when one is online nearby @w2', async ({ page, api }) => {
  api.respond('GET', '/api/v1/terminals/KSK-001/screensaver', { status: 200, json: { enabled: false, idleTimeoutSec: 180, items: [] } })
  api.respond('GET', '/api/v1/terminals/KSK-001/printer-status', { status: 200, json: { printerStatus: 'ready', isOnline: true, paperLevel: 'sufficient' } })
  api.respond('GET', '/api/v1/public/support-contact', {
    status: 200,
    json: {
      success: true,
      data: {
        servicePhone: '18369161921',
        serviceHours: '工作日 9:00–18:00',
        otherOnlineTerminalNearby: true,
        miniappPublished: false,
      },
    },
  })
  const phone = '拨打服务电话 18369161921（工作日 9:00–18:00）'
  await page.route('**/api/v1/print/jobs/claim-pickup', async route => {
    await route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({
        error: {
          code: 'PRINT_TERMINAL_QUEUE_HALTED',
          message: '这台终端暂停接打印单，你的到机码没有作废，请稍后再来这台终端输码，或找现场工作人员',
        },
      }),
    })
  })
  await page.goto('/print/pickup-claim')
  await page.getByLabel('到机码输入框').fill('28491703')
  await expect(page.getByRole('alert')).toContainText(`你的到机码没有作废。这台机器暂时不能用，请换一台机器，或${phone}。`)
  await expect(page.getByRole('alert')).toContainText('换一台机器')
  await expect(page.getByRole('alert')).not.toContainText('工作人员')
})
