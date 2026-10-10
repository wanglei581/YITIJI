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
    const message = printerCode === 'PRINT_TERMINAL_QUEUE_HALTED'
      ? '这台终端暂停接打印单，你的到机码没有作废，请稍后再来这台终端输码，或找现场工作人员'
      : '这台终端的打印机暂不可用，你的到机码没有作废，请稍后再来这台终端输码，或找现场工作人员'
    const submitted: string[] = []
    await page.route('**/api/v1/print/jobs/claim-pickup', async route => {
      submitted.push((route.request().postDataJSON() as { code: string }).code)
      await route.fulfill({ status: submitted.length === 1 ? 400 : 200, contentType: 'application/json', body: JSON.stringify(submitted.length === 1
        ? { error: { code: printerCode, message } }
        : { released: false, orderId: 'gate-order', orderNo: 'ORD-GATE', terminalId: 'KSK-001', amountCents: 100, paymentSessionToken: 'gate-payment-session' }) })
    })
    await page.goto('/print/pickup-claim')
    await page.getByLabel('到机码输入框').fill('28491703')
    await expect(page.getByTestId('arrival-code-state-failed')).toBeVisible()
    // 服务端旧句仍作为反例夹具；画面须换成到机码保留说明和标准求助句。
    const alert = page.getByRole('alert')
    await expect(alert).toContainText('你的到机码没有作废')
    await expect(alert).toContainText(/服务电话|联系方式/)
    await expect(alert).not.toContainText('工作人员')
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

for (const scenario of [
  { code: 'PICKUP_RESUME_LIMIT_REACHED', message: '这单已经接着打过 2 次，不能再打了', state: 'arrival-code-state-closed' },
  { code: 'PICKUP_RESUME_UNCONFIRMED', message: '这单的出纸结果还没确认，暂时不能接着打，请稍后再试', state: 'arrival-code-state-failed' },
  { code: 'PICKUP_RESUME_PARTIAL_OUTPUT', message: '这单已经出了一部分纸，不能整单重打', state: 'arrival-code-state-closed' },
]) {
  test(`pickup ${scenario.code} shows the resume sentence @w2`, async ({ page, api }) => {
    api.respond('GET', '/api/v1/terminals/KSK-001/screensaver', { status: 200, json: { enabled: false, idleTimeoutSec: 180, items: [] } })
    api.respond('GET', '/api/v1/terminals/KSK-001/printer-status', { status: 200, json: { printerStatus: 'ready', isOnline: true, paperLevel: 'sufficient' } })
    await page.route('**/api/v1/print/jobs/claim-pickup', async route => {
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: scenario.code, message: scenario.message } }),
      })
    })
    await page.goto('/print/pickup-claim')
    await page.getByLabel('到机码输入框').fill('28491703')
    await expect(page.getByTestId(scenario.state)).toBeVisible()
    await expect(page.getByRole('alert')).toContainText(scenario.message)
  })
}

test('pickup idle names two codes and the same-code resume @w2', async ({ page, api }) => {
  api.respond('GET', '/api/v1/terminals/KSK-001/screensaver', { status: 200, json: { enabled: false, idleTimeoutSec: 180, items: [] } })
  api.respond('GET', '/api/v1/terminals/KSK-001/printer-status', { status: 200, json: { printerStatus: 'ready', isOnline: true, paperLevel: 'sufficient' } })
  await page.goto('/print/pickup-claim')
  await expect(page.getByRole('heading', { name: '两种码，别搞混' })).toBeVisible()
  await expect(page.getByText('没打完？回到出纸失败的那台机器上，再输一次同一个到机码就能接着打，每单最多 2 次。')).toBeVisible()
  await expect(page.getByText('取件凭证码')).toHaveCount(0)
  await expect(page.getByText('出示给工作人员')).toHaveCount(0)
  await expect(page.getByText('出示给现场工作人员')).toHaveCount(0)
})
