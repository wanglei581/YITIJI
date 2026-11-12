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
    await expect(page.getByRole('alert')).toContainText(message.replace(/，或找现场工作人员$/, ''))
    await expect(page.getByRole('alert')).toContainText('需要帮助？')
    await expect(page.getByRole('alert')).not.toContainText('找现场工作人员')
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
  { code: 'PICKUP_RESUME_LIMIT_REACHED', message: '这单已经接着打过 2 次，不能再打了。还要打，请在手机上重新下单', state: 'arrival-code-state-closed' },
  { code: 'PICKUP_RESUME_UNCONFIRMED', message: '这单的出纸结果还没确认。请过 5 分钟后回到这台机器，再输一次同一个到机码，按屏幕提示办理；符合条件时可以整份重打。', state: 'arrival-code-state-failed' },
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

for (const scenario of [
  { code: 'PRINT_RETRY_FILE_UNAVAILABLE', status: 409, server: '打印文件已过期或已清理，不能重新提交', screen: '这笔订单的文件现在无法用于打印。请在手机上重新上传文件、重新下单。', state: 'arrival-code-state-closed', next: '输另一个到机码' },
  { code: 'PRINT_RETRY_AGENT_VERSION', status: 409, server: '这台终端的打印程序版本过旧，升级到 0.4.13 后才能重新提交', screen: '这台机器暂时不能用同一个到机码接着打。还要打，请在手机上重新下单。', state: 'arrival-code-state-closed', next: '输另一个到机码' },
  { code: 'PICKUP_RESUME_REFUND_PENDING', status: 409, server: '这单没有打完，费用会按原路退回，需要帮助请拨打服务电话', screen: '这单没有打完，退款待处理，输码时不会当场退款。请不要再输这个到机码；需要帮助请查看《隐私政策》里的联系方式。', state: 'arrival-code-state-closed', next: '输另一个到机码' },
]) {
  test(`pickup ${scenario.code} says what happened and gives a next step @w2`, async ({ page, api }) => {
    api.respond('GET', '/api/v1/terminals/KSK-001/screensaver', { status: 200, json: { enabled: false, idleTimeoutSec: 180, items: [] } })
    api.respond('GET', '/api/v1/terminals/KSK-001/printer-status', { status: 200, json: { printerStatus: 'ready', isOnline: true, paperLevel: 'sufficient' } })
    await page.route('**/api/v1/print/jobs/claim-pickup', async route => {
      await route.fulfill({
        status: scenario.status,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: scenario.code, message: scenario.server } }),
      })
    })
    await page.goto('/print/pickup-claim')
    await page.getByLabel('到机码输入框').fill('28491703')
    const screen = page.getByTestId(scenario.state)
    await expect(screen).toBeVisible()
    await expect(screen.getByRole('alert')).toContainText(scenario.screen)
    await expect(screen).not.toContainText(scenario.server)
    await expect(screen).not.toContainText('请重试')
    await expect(screen).not.toContainText('人较多')
    await expect(screen).not.toContainText('免费')
    await expect(screen).not.toContainText('0.4.13')
    await expect(screen).not.toContainText('已退款')
    await expect(page.getByTestId('arrival-code-primary')).toHaveText('回到首页')
    await expect(page.locator('.pcp-actions').getByRole('button', { name: scenario.next, exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '清除，重新输入' })).toHaveCount(0)
  })
}

for (const scenario of [
  { code: 'PRINT_TERMINAL_DAILY_QUOTA_REACHED', status: 429, server: '今天这台机器的免费打印量已用完，明天 0 点恢复。', screen: '这台机器今天的免费打印量已用完，明天 0 点恢复', state: 'arrival-code-state-failed' },
  { code: 'PRINT_MEMBER_DAILY_QUOTA_REACHED', status: 429, server: '你今天已免费打印 1 面，达到每日上限，明天 0 点恢复。确有急用，可以拨打屏幕上的服务电话。', screen: '你今天的免费打印量已达上限，明天 0 点恢复', state: 'arrival-code-state-failed' },
]) {
  test(`pickup ${scenario.code} keeps the shared quota sentence and another-code exit @w2`, async ({ page, api }) => {
    api.respond('GET', '/api/v1/terminals/KSK-001/screensaver', { status: 200, json: { enabled: false, idleTimeoutSec: 180, items: [] } })
    api.respond('GET', '/api/v1/terminals/KSK-001/printer-status', { status: 200, json: { printerStatus: 'ready', isOnline: true, paperLevel: 'sufficient' } })
    await page.route('**/api/v1/print/jobs/claim-pickup', async route => {
      await route.fulfill({
        status: scenario.status,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: scenario.code, message: scenario.server } }),
      })
    })
    await page.goto('/print/pickup-claim')
    await page.getByLabel('到机码输入框').fill('28491703')
    const screen = page.getByTestId(scenario.state)
    await expect(screen).toBeVisible()
    await expect(screen.getByRole('alert')).toContainText(scenario.screen)
    await expect(screen.getByRole('alert')).toContainText('免费')
    await expect(screen).not.toContainText(scenario.server)
    await expect(screen).not.toContainText('请重试')
    await expect(screen).not.toContainText('人较多')
    await expect(screen).not.toContainText('0.4.13')
    await expect(screen).not.toContainText('已退款')
    await expect(page.getByTestId('arrival-code-primary')).toHaveText('回到首页')
    await expect(page.locator('.pcp-actions').getByRole('button', { name: '输另一个到机码', exact: true })).toBeVisible()
    await expect(page.locator('.pcp-actions').getByRole('button', { name: '求助', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '清除，重新输入' })).toHaveCount(0)
  })
}

for (const code of ['PICKUP_CODE_INVALID', 'PICKUP_CODE_EXPIRED', 'PICKUP_TERMINAL_MISMATCH']) {
  test(`pickup ${code} keeps one sentence and offers a phone next step @w2`, async ({ page, api }) => {
    api.respond('GET', '/api/v1/terminals/KSK-001/screensaver', { status: 200, json: { enabled: false, idleTimeoutSec: 180, items: [] } })
    api.respond('GET', '/api/v1/terminals/KSK-001/printer-status', { status: 200, json: { printerStatus: 'ready', isOnline: true, paperLevel: 'sufficient' } })
    await page.route('**/api/v1/print/jobs/claim-pickup', async route => {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code, message: '到机码已过期，请在小程序重新下单' } }),
      })
    })
    await page.goto('/print/pickup-claim')
    await page.getByLabel('到机码输入框').fill('28491703')
    await expect(page.getByTestId('arrival-code-state-invalid-or-expired')).toBeVisible()
    await expect(page.getByRole('alert')).toContainText('到机码无效或已过期，请核对后重新输入。核对后还是不行的，请在手机上查看这笔订单，需要的话重新下单。')
    await expect(page.getByRole('alert')).toContainText('不提示具体原因')
    await expect(page.getByRole('alert')).not.toContainText('请在小程序重新下单')
    await expect(page.getByTestId('arrival-code-primary')).toHaveText('清除，重新输入')
  })
}

test('pickup PICKUP_CODE_OTHER_TERMINAL names the other machine @w2', async ({ page, api }) => {
  api.respond('GET', '/api/v1/terminals/KSK-001/screensaver', { status: 200, json: { enabled: false, idleTimeoutSec: 180, items: [] } })
  api.respond('GET', '/api/v1/terminals/KSK-001/printer-status', { status: 200, json: { printerStatus: 'ready', isOnline: true, paperLevel: 'sufficient' } })
  await page.route('**/api/v1/print/jobs/claim-pickup', async route => {
    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({
        error: {
          code: 'PICKUP_CODE_OTHER_TERMINAL',
          message: '这单是在别的机器上下的，请到下单时选的那台机器取件',
        },
      }),
    })
  })
  await page.goto('/print/pickup-claim')
  await page.getByLabel('到机码输入框').fill('28491703')
  await expect(page.getByTestId('arrival-code-state-failed')).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('这单是在别的机器上下的，请到下单时选的那台机器取件')
  await expect(page.getByRole('alert')).not.toContainText('不提示具体原因')
  await expect(page.getByRole('alert')).not.toContainText('到机码无效或已过期')
  await expect(page.getByTestId('arrival-code-state-invalid-or-expired')).toHaveCount(0)
  await expect(page.getByTestId('arrival-code-primary')).toHaveText('清除，重新输入')
})

test('pickup idle names two codes and the same-code resume @w2', async ({ page, api }) => {
  api.respond('GET', '/api/v1/terminals/KSK-001/screensaver', { status: 200, json: { enabled: false, idleTimeoutSec: 180, items: [] } })
  api.respond('GET', '/api/v1/terminals/KSK-001/printer-status', { status: 200, json: { printerStatus: 'ready', isOnline: true, paperLevel: 'sufficient' } })
  await page.goto('/print/pickup-claim')
  // 2026-10-28 稿 pickup：键盘下面只留一行折叠「两种码的区别 · 码找不到了」，点开才是两种码的说明与续打说明。
  await page.getByText('两种码的区别 · 码找不到了').click()
  await expect(page.getByRole('heading', { name: '两种码，别搞混' })).toBeVisible()
  await expect(page.getByText('没打完？回到出纸失败的那台机器上，再输一次同一个到机码就能接着打，每单最多 2 次。')).toBeVisible()
  await expect(page.getByText('取件凭证码')).toHaveCount(0)
  await expect(page.getByText('出示给工作人员')).toHaveCount(0)
  await expect(page.getByText('出示给现场工作人员')).toHaveCount(0)
})
