import type { Page, Route } from '@playwright/test'
import type { ApiRouter } from '../fixtures/api-router'
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
    await expect(page.getByRole('alert')).toContainText('到机码不对或已过期')
    await expect(page.getByRole('alert')).toContainText('不提示具体原因')
    await expect(page.getByRole('alert')).not.toContainText('请在小程序重新下单')
    await expect(page.getByTestId('arrival-code-primary')).toHaveText('清除，重新输入')
  })
}

test('pickup PICKUP_CODE_INVALID says the code may be for another machine @w2', async ({ page, api }) => {
  api.respond('GET', '/api/v1/terminals/KSK-001/screensaver', { status: 200, json: { enabled: false, idleTimeoutSec: 180, items: [] } })
  api.respond('GET', '/api/v1/terminals/KSK-001/printer-status', { status: 200, json: { printerStatus: 'ready', isOnline: true, paperLevel: 'sufficient' } })
  await page.route('**/api/v1/print/jobs/claim-pickup', async route => {
    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({
        error: {
          code: 'PICKUP_CODE_INVALID',
          message: '到机码无效或已过期',
        },
      }),
    })
  })
  await page.goto('/print/pickup-claim')
  await page.getByLabel('到机码输入框').fill('28491703')
  await expect(page.getByTestId('arrival-code-state-invalid-or-expired')).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('到机码不对或已过期，或者这单是在别的机器上下的。请核对号码，或到下单时选的那台机器取件；还是不行的，请在手机上查看这笔订单，需要的话重新下单。')
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

// ── 登录后点单领取。令牌只在内存里，用例走屏幕键盘登录，不写 sessionStorage。──

const HERE_MEMBER_TOKEN = 'here-member-token'
const HERE_WHEN = '2026-11-12T06:20:00.000Z'
const UNAVAILABLE_OFF = '这个到机码已经不能使用。请在手机上「我的 → 打印订单」查看这笔订单，需要的话重新下单'
const UNAVAILABLE_ON = '这个到机码已经不能使用。请在手机小程序「我的 → 打印订单」查看这笔订单，需要的话重新下单'

function registerPickupShell(api: ApiRouter): void {
  api.respond('GET', '/api/v1/terminals/KSK-001/screensaver', {
    status: 200, json: { enabled: false, idleTimeoutSec: 180, items: [] },
  })
  api.respond('GET', '/api/v1/terminals/KSK-001/printer-status', {
    status: 200, json: { printerStatus: 'ready', paperLevel: 'sufficient', isOnline: true },
  })
}

function registerMemberLogin(api: ApiRouter): void {
  api.respond('GET', '/api/v1/kiosk/legal/terms_of_service', { status: 200, json: { success: true, data: null } })
  api.respond('GET', '/api/v1/kiosk/legal/privacy_policy', { status: 200, json: { success: true, data: null } })
  api.respond('POST', '/api/v1/member/auth/sms-code', {
    status: 200,
    json: { success: true, data: { sent: true, cooldownSeconds: 60, expiresInSeconds: 300 } },
  })
  api.respond('POST', '/api/v1/member/auth/login', {
    status: 200,
    json: {
      success: true,
      data: { token: HERE_MEMBER_TOKEN, user: { id: 'member-here', phoneMasked: '138****8000', nickname: '取件会员' } },
    },
  })
  api.respond('GET', '/api/v1/me/pending-tasks', { status: 200, json: { success: true, data: [] } })
  api.respond('GET', '/api/v1/me/favorites', { status: 200, json: { success: true, data: { items: [], nextCursor: null, total: 0 } } })
}

async function loginThroughVisibleUi(page: Page): Promise<void> {
  await page.goto('/login?from=%2Fprint%2Fpickup-claim')
  await page.getByRole('checkbox', { name: /我已阅读并同意/ }).click()
  await page.getByRole('button', { name: '手机号（11 位本人号码）', exact: true }).click()
  for (const digit of '13800138000') await page.getByRole('button', { name: digit, exact: true }).click()
  await page.getByRole('button', { name: '收起键盘', exact: true }).click()
  await page.getByRole('button', { name: '获取验证码', exact: true }).click()
  await page.getByRole('button', { name: '短信验证码', exact: true }).click()
  for (const digit of '123456') await page.getByRole('button', { name: digit, exact: true }).click()
  await page.getByRole('button', { name: '收起键盘', exact: true }).click()
  await page.getByRole('button', { name: '确认登录', exact: true }).click()
  await page.waitForURL((url) => url.pathname === '/print/pickup-claim')
}

function hereItem(orderId: string, title: string, claimableHere = true) {
  return {
    kind: 'cloud_single',
    orderId,
    title,
    itemCount: 1,
    claimableHere,
    createdAt: HERE_WHEN,
    billablePages: 2,
  }
}

function timelineJson(items: unknown[], nextCursor: string | null) {
  return { success: true, data: { items, nextCursor, total: items.length } }
}

function claimHereOk(orderId: string) {
  return {
    released: true,
    taskId: `task-${orderId}`,
    orderId,
    orderNo: `NO-${orderId}`,
    terminalId: 'KSK-001',
    taskStatus: 'claimed',
    printTaskStatus: 'pending',
    amountCents: 0,
    fileName: '简历.pdf',
    paymentSessionToken: 'here-pay',
  }
}

async function fulfillJson(route: Route, status: number, body: unknown): Promise<void> {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}

async function prepareLoggedInPickup(page: Page, api: ApiRouter): Promise<void> {
  registerPickupShell(api)
  registerMemberLogin(api)
}

test('logged-in pickup lists this machine, claims once, and hides the loading line @w2', async ({ page, api }) => {
  test.setTimeout(60_000)
  await prepareLoggedInPickup(page, api)
  let timelineHits = 0
  let releaseTimeline: (() => void) | undefined
  const held = new Promise<void>((resolve) => { releaseTimeline = resolve })
  const claimIds: string[] = []
  await page.route('**/api/v1/me/print-orders/timeline**', async (route) => {
    timelineHits += 1
    if (timelineHits === 1) await held
    await fulfillJson(route, 200, timelineJson([hereItem('ord-1', '简历.pdf')], null))
  })
  await page.route('**/api/v1/me/print-orders/*/claim-here', async (route) => {
    claimIds.push(new URL(route.request().url()).pathname.split('/').at(-2) ?? '')
    expect(route.request().headers().authorization).toBe(`Bearer ${HERE_MEMBER_TOKEN}`)
    await fulfillJson(route, 200, claimHereOk('ord-1'))
  })
  await loginThroughVisibleUi(page)
  await expect.poll(() => timelineHits).toBe(1)
  await expect(page.getByTestId('pickup-here-loading')).toHaveCount(0)
  await expect(page.getByText('正在读取你在这台机器上还没取的单。')).toHaveCount(0)
  releaseTimeline?.()
  const row = page.getByTestId('pickup-here-claim')
  await expect(row).toBeVisible()
  await expect(row).toContainText('简***.pdf')
  await expect(row).toContainText('11月12日 14:20')
  await expect(row).toContainText('2 页')
  await row.click()
  await expect(page.getByText('已进入打印队列', { exact: true })).toBeVisible()
  await expect(page.getByTestId('pickup-here-claim')).toHaveCount(0)
  expect(claimIds).toEqual(['ord-1'])
})

test('logged-in pickup double click sends claim-here once @w2', async ({ page, api }) => {
  test.setTimeout(60_000)
  await prepareLoggedInPickup(page, api)
  let claims = 0
  let releaseClaim: (() => void) | undefined
  const held = new Promise<void>((resolve) => { releaseClaim = resolve })
  await page.route('**/api/v1/me/print-orders/timeline**', async (route) => {
    await fulfillJson(route, 200, timelineJson([hereItem('ord-lock', '简历.pdf')], null))
  })
  await page.route('**/api/v1/me/print-orders/*/claim-here', async (route) => {
    claims += 1
    await held
    await fulfillJson(route, 200, claimHereOk('ord-lock'))
  })
  try {
    await loginThroughVisibleUi(page)
    await expect(page.getByTestId('pickup-here-claim')).toBeVisible()
    await page.evaluate(() => {
      const button = document.querySelector('[data-testid="pickup-here-claim"]')
      if (!(button instanceof HTMLButtonElement)) throw new Error('没有领取按钮')
      const fire = () => button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      fire()
      fire()
    })
    await expect.poll(() => claims, { timeout: 2_000 }).toBe(1)
    await page.waitForTimeout(250)
    expect(claims).toBe(1)
  } finally {
    releaseClaim?.()
  }
  await expect(page.getByText('已进入打印队列', { exact: true })).toBeVisible()
})

for (const failure of [
  { name: 'network', status: 503, body: { error: { code: 'UNKNOWN_ERROR', message: '服务器错误' } }, alert: '' },
  { name: 'printer', status: 400, body: { error: { code: 'PRINTER_UNAVAILABLE', message: '这台终端的打印机暂不可用，你的到机码没有作废，请稍后再来这台终端输码' } }, alert: '没有作废' },
]) {
  test(`logged-in pickup ${failure.name} retry repeats the same claim-here @w2`, async ({ page, api }) => {
    test.setTimeout(60_000)
    await prepareLoggedInPickup(page, api)
    const orderIds: string[] = []
    await page.route('**/api/v1/me/print-orders/timeline**', async (route) => {
      await fulfillJson(route, 200, timelineJson([hereItem('ord-retry', '简历.pdf')], null))
    })
    await page.route('**/api/v1/me/print-orders/*/claim-here', async (route) => {
      orderIds.push(new URL(route.request().url()).pathname.split('/').at(-2) ?? '')
      if (orderIds.length === 1) {
        await fulfillJson(route, failure.status, failure.body)
        return
      }
      await fulfillJson(route, 200, claimHereOk('ord-retry'))
    })
    await loginThroughVisibleUi(page)
    await page.getByTestId('pickup-here-claim').click()
    if (failure.name === 'network') {
      const block = page.locator('.pcp-block')
      await expect(block).toContainText('同一笔订单再领一次')
      await expect(block).not.toContainText('输码')
      await expect(block).not.toContainText('同一串码')
    } else {
      const alert = page.getByRole('alert')
      await expect(alert).toContainText(failure.alert)
      await expect(alert).not.toContainText('输码')
    }
    const order = await page.evaluate(() => {
      const explanation = document.querySelector('[role="alert"]')
      const list = document.querySelector('[data-testid="pickup-here-list"]')
      if (!explanation || !list) return 'missing'
      return (explanation.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 ? 'alert-first' : 'list-first'
    })
    expect(order).toBe('alert-first')
    await page.getByRole('button', { name: '重试校验' }).click()
    await expect(page.getByText('已进入打印队列', { exact: true })).toBeVisible()
    expect(orderIds).toEqual(['ord-retry', 'ord-retry'])
  })
}

test('logged-in pickup reload after a failed read shows the list @w2', async ({ page, api }) => {
  test.setTimeout(60_000)
  await prepareLoggedInPickup(page, api)
  let timelineHits = 0
  await page.route('**/api/v1/me/print-orders/timeline**', async (route) => {
    timelineHits += 1
    if (timelineHits === 1) {
      await fulfillJson(route, 500, { success: false })
      return
    }
    await fulfillJson(route, 200, timelineJson([hereItem('ord-back', '简历.pdf')], null))
  })
  await loginThroughVisibleUi(page)
  await expect(page.getByTestId('pickup-here-error')).toBeVisible()
  await expect(page.getByTestId('pickup-here-list')).toHaveCount(0)
  await page.getByTestId('pickup-here-reload').click()
  await expect(page.getByTestId('pickup-here-claim')).toContainText('简***.pdf')
  expect(timelineHits).toBe(2)
})

test('logged-in pickup drops a closed order and keeps the other without another read @w2', async ({ page, api }) => {
  test.setTimeout(60_000)
  await prepareLoggedInPickup(page, api)
  let timelineHits = 0
  await page.route('**/api/v1/me/print-orders/timeline**', async (route) => {
    timelineHits += 1
    await fulfillJson(route, 200, timelineJson([
      hereItem('ord-used', '简历.pdf'),
      hereItem('ord-keep', '获奖.pdf'),
    ], null))
  })
  await page.route('**/api/v1/me/print-orders/*/claim-here', async (route) => {
    await fulfillJson(route, 409, { error: { code: 'PICKUP_CODE_ALREADY_USED', message: 'used' } })
  })
  await loginThroughVisibleUi(page)
  await expect(page.getByTestId('pickup-here-claim')).toHaveCount(2)
  await page.getByTestId('pickup-here-claim').first().click()
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByTestId('pickup-here-claim')).toHaveCount(1)
  await expect(page.getByTestId('pickup-here-claim')).toContainText('获***.pdf')
  await expect(page.getByTestId('pickup-here-claim')).not.toContainText('简***.pdf')
  expect(timelineHits).toBe(1)
})

test('logged-in pickup follows nextCursor onto the second page @w2', async ({ page, api }) => {
  test.setTimeout(60_000)
  await prepareLoggedInPickup(page, api)
  const cursors: Array<string | null> = []
  await page.route('**/api/v1/me/print-orders/timeline**', async (route) => {
    const cursor = new URL(route.request().url()).searchParams.get('cursor')
    cursors.push(cursor)
    if (!cursor) {
      const others = Array.from({ length: 50 }, (_, index) => hereItem(`other-${index}`, `别的${index}.pdf`, false))
      await fulfillJson(route, 200, timelineJson(others, 'page-2'))
      return
    }
    await fulfillJson(route, 200, timelineJson([hereItem('ord-page2', '第二页.pdf')], null))
  })
  await loginThroughVisibleUi(page)
  await expect(page.getByTestId('pickup-here-claim')).toContainText('第***.pdf')
  await expect(page.getByTestId('pickup-here-claim')).toContainText('11月12日 14:20')
  expect(cursors).toEqual([null, 'page-2'])
})

test('logged-in pickup treats a later page failure as a failed read and stops after four pages @w2', async ({ page, api }) => {
  test.setTimeout(60_000)
  await prepareLoggedInPickup(page, api)
  let mode: 'fail-page' | 'cap' = 'fail-page'
  let hits = 0
  await page.route('**/api/v1/me/print-orders/timeline**', async (route) => {
    hits += 1
    const cursor = new URL(route.request().url()).searchParams.get('cursor')
    if (mode === 'fail-page') {
      if (!cursor) {
        await fulfillJson(route, 200, timelineJson([hereItem('ord-partial', '首页单.pdf')], 'page-2'))
        return
      }
      await fulfillJson(route, 500, { success: false })
      return
    }
    if (hits < 4) {
      await fulfillJson(route, 200, timelineJson([hereItem(`skip-${hits}`, `跳过${hits}.pdf`, false)], `page-${hits + 1}`))
      return
    }
    if (hits === 4) {
      await fulfillJson(route, 200, timelineJson([hereItem('skip-4', '跳过4.pdf', false)], 'page-5'))
      return
    }
    await fulfillJson(route, 200, timelineJson([hereItem('ord-late', '末页简历.pdf')], null))
  })
  await loginThroughVisibleUi(page)
  await expect(page.getByTestId('pickup-here-error')).toBeVisible()
  await expect(page.getByText('首***.pdf')).toHaveCount(0)
  expect(hits).toBe(2)
  mode = 'cap'
  hits = 0
  await page.getByTestId('pickup-here-reload').click()
  await expect.poll(() => hits).toBe(4)
  await page.waitForTimeout(250)
  expect(hits).toBe(4)
  await expect(page.getByTestId('pickup-here-list')).toHaveCount(0)
  await expect(page.getByText('末***.pdf')).toHaveCount(0)
})

test('logged-in pickup can claim a typed code after taking another order @w2', async ({ page, api }) => {
  test.setTimeout(60_000)
  await prepareLoggedInPickup(page, api)
  let timelineHits = 0
  let codeClaims = 0
  await page.route('**/api/v1/me/print-orders/timeline**', async (route) => {
    timelineHits += 1
    const items = timelineHits === 1
      ? [hereItem('ord-first', '简历.pdf')]
      : [hereItem('ord-next', '获奖.pdf')]
    await fulfillJson(route, 200, timelineJson(items, null))
  })
  await page.route('**/api/v1/me/print-orders/*/claim-here', async (route) => {
    await fulfillJson(route, 200, claimHereOk('ord-first'))
  })
  await page.route('**/api/v1/print/jobs/claim-pickup', async (route) => {
    codeClaims += 1
    await fulfillJson(route, 200, {
      released: true,
      taskId: 'task-code',
      orderId: 'ord-code',
      orderNo: 'NO-CODE',
      terminalId: 'KSK-001',
      taskStatus: 'claimed',
      printTaskStatus: 'pending',
      amountCents: 0,
      fileName: '简历.pdf',
    })
  })
  await loginThroughVisibleUi(page)
  await page.getByTestId('pickup-here-claim').click()
  await expect(page.getByText('已进入打印队列', { exact: true })).toBeVisible()
  expect(timelineHits).toBe(1)
  await page.getByRole('button', { name: '返回取件', exact: true }).click()
  await expect(page.getByTestId('pickup-here-claim')).toContainText('获***.pdf')
  expect(timelineHits).toBe(2)
  await page.getByLabel('到机码输入框').fill('28491703')
  await expect(page.getByText('已进入打印队列', { exact: true })).toBeVisible()
  expect(codeClaims).toBe(1)
  await expect.poll(() => timelineHits).toBe(3)
})

test('pickup unavailable sentence stays off the miniapp name while unpublished @w2', async ({ page, api }) => {
  registerPickupShell(api)
  await page.route('**/api/v1/print/jobs/claim-pickup', async (route) => {
    await fulfillJson(route, 400, { error: { code: 'PICKUP_CODE_UNAVAILABLE', message: 'server' } })
  })
  await page.goto('/print/pickup-claim')
  await expect(page.locator('.pcp-fine')).not.toContainText('小程序')
  await page.getByLabel('到机码输入框').fill('28491703')
  await expect(page.getByRole('alert')).toContainText(UNAVAILABLE_OFF)
  await expect(page.getByRole('alert')).not.toContainText('小程序')
})

test('pickup unavailable sentence names the miniapp when it is published @w2', async ({ page, api }) => {
  registerPickupShell(api)
  api.respond('GET', '/api/v1/public/support-contact', {
    status: 200,
    json: {
      success: true,
      data: {
        servicePhone: '18369161921',
        serviceHours: '工作日 9:00–18:00',
        otherOnlineTerminalNearby: false,
        miniappPublished: true,
      },
    },
  })
  await page.route('**/api/v1/print/jobs/claim-pickup', async (route) => {
    await fulfillJson(route, 400, { error: { code: 'PICKUP_CODE_UNAVAILABLE', message: 'server' } })
  })
  await page.goto('/print/pickup-claim')
  await expect(page.locator('.pcp-fine')).toContainText('在职易达小程序下的单')
  await page.getByLabel('到机码输入框').fill('28491703')
  await expect(page.getByRole('alert')).toContainText(UNAVAILABLE_ON)
})

type AnchorBox = { x: number; y: number; width: number; height: number }

/** 量码格和键盘前先把正文滚回顶，避免「看得见」把目标滚进视口后把坐标比歪。 */
async function pickupAnchorBoxes(page: Page): Promise<{ code: AnchorBox; keypad: AnchorBox }> {
  return page.evaluate(() => {
    const scroller = document.querySelector('.qxt-body')
    if (scroller instanceof HTMLElement) scroller.scrollTop = 0
    const read = (selector: string): AnchorBox | null => {
      const el = document.querySelector(selector)
      if (!el) return null
      const rect = el.getBoundingClientRect()
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    }
    const code = read('.pcp-input-wrap')
    const keypad = read('.pcp-keypad-card')
    if (!code || !keypad) throw new Error('码格或键盘还没画出来')
    return { code, keypad }
  })
}

function expectSameBox(actual: AnchorBox, expected: AnchorBox): void {
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    expect(Math.abs(actual[key] - expected[key]), key).toBeLessThanOrEqual(1)
  }
}

test('logged-in pickup list arrives under the keypad without moving it @w2', async ({ page, api }) => {
  test.setTimeout(90_000)
  await prepareLoggedInPickup(page, api)
  let timelineHits = 0
  let releaseTimeline: (() => void) | undefined
  const held = new Promise<void>((resolve) => { releaseTimeline = resolve })
  await page.route('**/api/v1/me/print-orders/timeline**', async (route) => {
    timelineHits += 1
    if (timelineHits === 1) await held
    await fulfillJson(route, 200, timelineJson([hereItem('ord-late', '简历.pdf')], null))
  })
  await loginThroughVisibleUi(page)
  await expect.poll(() => timelineHits).toBe(1)
  await expect(page.getByTestId('pickup-here-list')).toHaveCount(0)
  const keypadBefore = await pickupAnchorBoxes(page)
  await page.getByRole('button', { name: '用扫码枪扫', exact: true }).click()
  await expect(page.getByTestId('arrival-code-state-hid')).toBeVisible()
  const hidBefore = await pickupAnchorBoxes(page)
  releaseTimeline?.()
  await expect.poll(() => page.evaluate(() => document.querySelector('[data-testid="pickup-here-list"]') !== null)).toBe(true)
  const hidAfter = await pickupAnchorBoxes(page)
  expectSameBox(hidAfter.code, hidBefore.code)
  expectSameBox(hidAfter.keypad, hidBefore.keypad)
  const hidLayout = await page.evaluate(() => {
    const scroller = document.querySelector('.qxt-body')
    if (scroller instanceof HTMLElement) scroller.scrollTop = 0
    const list = document.querySelector('[data-testid="pickup-here-list"]')
    const keypad = document.querySelector('.pcp-keypad-card')
    if (!list || !keypad || !(scroller instanceof HTMLElement)) return null
    const claim = list.querySelector('.pcp-here-go')
    const claimBox = claim?.getBoundingClientRect()
    const view = scroller.getBoundingClientRect()
    return {
      followsKeypad: (keypad.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
      gap: list.getBoundingClientRect().top - keypad.getBoundingClientRect().bottom,
      overflowX: scroller.scrollWidth - scroller.clientWidth,
      overflowY: scroller.scrollHeight - scroller.clientHeight,
      claimHeight: claimBox?.height ?? 0,
      claimInside: claimBox ? claimBox.top >= view.top - 1 && claimBox.bottom <= view.bottom + 1 : false,
    }
  })
  expect(hidLayout).not.toBeNull()
  expect(hidLayout?.followsKeypad).toBe(true)
  expect(hidLayout?.gap ?? 999).toBeGreaterThanOrEqual(0)
  expect(hidLayout?.gap ?? 999).toBeLessThanOrEqual(40)
  expect(hidLayout?.overflowX ?? 999).toBeLessThanOrEqual(1)
  // 扫码枪说明更高。领取按钮必须落在视口里；折叠的「两种码的区别」可以略超出，不能整屏被撑飞。
  expect(hidLayout?.overflowY ?? 999).toBeLessThanOrEqual(160)
  expect(hidLayout?.claimHeight ?? 0).toBeGreaterThanOrEqual(56)
  expect(hidLayout?.claimInside).toBe(true)
  await page.getByRole('button', { name: '还是手输吧', exact: true }).click()
  await expect(page.getByTestId('arrival-code-state-idle')).toBeVisible()
  const keypadAfter = await pickupAnchorBoxes(page)
  expectSameBox(keypadAfter.code, keypadBefore.code)
  expectSameBox(keypadAfter.keypad, keypadBefore.keypad)
  const keypadLayout = await page.evaluate(() => {
    const scroller = document.querySelector('.qxt-body')
    if (scroller instanceof HTMLElement) scroller.scrollTop = 0
    const list = document.querySelector('[data-testid="pickup-here-list"]')
    const claim = list?.querySelector('.pcp-here-go')
    if (!list || !claim || !(scroller instanceof HTMLElement)) return null
    const claimBox = claim.getBoundingClientRect()
    const view = scroller.getBoundingClientRect()
    return {
      overflowX: scroller.scrollWidth - scroller.clientWidth,
      overflowY: scroller.scrollHeight - scroller.clientHeight,
      claimInside: claimBox.top >= view.top - 1 && claimBox.bottom <= view.bottom + 1,
    }
  })
  expect(keypadLayout?.overflowX ?? 999).toBeLessThanOrEqual(1)
  expect(keypadLayout?.overflowY ?? 999).toBeLessThanOrEqual(160)
  expect(keypadLayout?.claimInside).toBe(true)
})

test('typed pickup success keeps the arrival-code wording @w2', async ({ page, api }) => {
  registerPickupShell(api)
  await page.route('**/api/v1/print/jobs/claim-pickup', async (route) => {
    await fulfillJson(route, 200, {
      released: true,
      taskId: 'task-code',
      orderId: 'ord-code',
      orderNo: 'NO-CODE',
      terminalId: 'KSK-001',
      taskStatus: 'claimed',
      printTaskStatus: 'pending',
      amountCents: 0,
      fileName: '简历.pdf',
    })
  })
  await page.goto('/print/pickup-claim')
  await page.getByLabel('到机码输入框').fill('28491703')
  await expect(page.getByText('已进入打印队列', { exact: true })).toBeVisible()
  await expect(page.getByRole('list', { name: '办理步骤' })).toContainText('✓ 输到机码')
  await expect(page.locator('.qxt-eyebrow')).toHaveText('到机码核销')
  await expect(page.getByTestId('pickup-ok-resume')).toContainText('同一个到机码可以接着打')
  await expect(page.getByTestId('pickup-ok-resume')).toContainText('再输一次同一个到机码')
  await expect(page.getByRole('list', { name: '办理步骤' })).not.toContainText('选中这一单')
  await expect(page.locator('.qxt-band .qxt-status')).toHaveText('到机码验证')
  await expect(page.getByRole('button', { name: '重新输入', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '问小青：码在哪', exact: true })).toBeVisible()
})

test('logged-in pickup success uses the order wording @w2', async ({ page, api }) => {
  test.setTimeout(60_000)
  await prepareLoggedInPickup(page, api)
  await page.route('**/api/v1/me/print-orders/timeline**', async (route) => {
    await fulfillJson(route, 200, timelineJson([hereItem('ord-ok', '简历.pdf')], null))
  })
  await page.route('**/api/v1/me/print-orders/*/claim-here', async (route) => {
    await fulfillJson(route, 200, claimHereOk('ord-ok'))
  })
  await loginThroughVisibleUi(page)
  await page.getByTestId('pickup-here-claim').click()
  await expect(page.getByText('已进入打印队列', { exact: true })).toBeVisible()
  await expect(page.getByRole('list', { name: '办理步骤' })).toContainText('✓ 选中这一单')
  await expect(page.locator('.qxt-eyebrow')).toHaveText('本机领取')
  await expect(page.locator('.qxt-eyebrow')).not.toContainText('到机码')
  const resume = page.getByTestId('pickup-ok-resume')
  await expect(resume).toHaveText('打印中断时，回手机上查看这笔订单')
  await expect(resume).not.toContainText('到机码')
  const capsule = page.locator('.qxt-band .qxt-status')
  const back = page.getByRole('button', { name: '返回取件', exact: true })
  const ask = page.getByRole('button', { name: '问小青：取纸或异常怎么办', exact: true })
  await expect(capsule).toHaveText('本机领取')
  await expect(capsule).toHaveClass(/qxt-status-unknown/)
  await expect(back).toBeVisible()
  await expect(ask).toBeVisible()
  for (const spot of [capsule, back, ask]) {
    await expect(spot).not.toContainText('到机码')
    await expect(spot).not.toContainText('码在哪')
    await expect(spot).not.toContainText('重新输入')
  }
  api.respond('GET', '/api/v1/mock-interviews/capabilities/voice', {
    status: 200,
    json: { data: { asrEnabled: false, ttsEnabled: false } },
  })
  await ask.click()
  await expect(page).toHaveURL(/\/assistant$/)
  await expect(page.getByLabel('输入咨询问题')).toHaveValue('打印时取纸或遇到异常该怎么办？请告诉我现在可以做的事，不要替我判断有没有打出来。')
})

test('logged-in pickup terminal not ready retries this order @w2', async ({ page, api }) => {
  test.setTimeout(60_000)
  await prepareLoggedInPickup(page, api)
  const orderIds: string[] = []
  await page.route('**/api/v1/me/print-orders/timeline**', async (route) => {
    await fulfillJson(route, 200, timelineJson([hereItem('ord-ready', '简历.pdf')], null))
  })
  await page.route('**/api/v1/me/print-orders/*/claim-here', async (route) => {
    orderIds.push(new URL(route.request().url()).pathname.split('/').at(-2) ?? '')
    if (orderIds.length < 3) {
      await fulfillJson(route, 400, { error: { code: 'PRINT_TERMINAL_NOT_READY', message: '本机终端当前不能接收打印订单' } })
      return
    }
    await fulfillJson(route, 200, claimHereOk('ord-ready'))
  })
  await loginThroughVisibleUi(page)
  await page.getByTestId('pickup-here-claim').click()
  const alert = page.getByRole('alert')
  await expect(alert).toContainText('这台机器暂时不能取件')
  await expect(alert).toContainText('请稍后再来')
  await expect(alert).not.toContainText('这台机器暂时不能用')
  await expect.poll(async () => {
    const text = await alert.innerText()
    return text.split('这台机器暂时不能取件').length - 1
  }).toBe(1)
  await expect(page.getByTestId('arrival-code-primary')).toHaveText('重试这一单')
  await expect(page.getByRole('button', { name: '改为输到机码', exact: true })).toBeVisible()
  const order = await page.evaluate(() => {
    const explanation = document.querySelector('[role="alert"]')
    const list = document.querySelector('[data-testid="pickup-here-list"]')
    if (!explanation || !list) return 'missing'
    return (explanation.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 ? 'alert-first' : 'list-first'
  })
  expect(order).toBe('alert-first')
  await page.getByRole('button', { name: '改为输到机码', exact: true }).click()
  await expect(page.getByTestId('arrival-code-state-idle')).toBeVisible()
  expect(orderIds).toEqual(['ord-ready'])
  await page.getByTestId('pickup-here-claim').click()
  await expect(page.getByTestId('arrival-code-primary')).toHaveText('重试这一单')
  await page.getByTestId('arrival-code-primary').click()
  await expect(page.getByText('已进入打印队列', { exact: true })).toBeVisible()
  expect(orderIds).toEqual(['ord-ready', 'ord-ready', 'ord-ready'])
})
