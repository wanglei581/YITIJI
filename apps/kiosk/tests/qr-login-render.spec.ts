import { test, expect } from './fixtures/kiosk-test'
import type { Locator, Page, Route, TestInfo } from '@playwright/test'
import type { ApiRouter } from './fixtures/api-router'

const LOCAL_QR_CREATE_URL = 'http://127.0.0.1:9527/local/qr-login/create'
const BRIDGE_TOKEN = 'playwright-local-bridge-token-0123456789abcdef'
const TICKET_ID = 'playwright_qr_ticket_0123456789abcdef'
const MEMBER_PHONE = '13800138000'

function registerKioskShell(api: ApiRouter): void {
  api.respond('GET', '/api/v1/terminals/KSK-001/screensaver', {
    status: 200,
    json: { enabled: false, idleTimeoutSec: 180, items: [] },
  })
}

async function enterMemberPhone(page: Page): Promise<void> {
  await page.getByRole('checkbox', { name: /我已阅读并同意/ }).click()
  await page.getByRole('button', { name: '手机号（11 位本人号码）', exact: true }).click()
  for (const digit of MEMBER_PHONE) {
    await page.getByRole('button', { name: digit, exact: true }).click()
  }
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const metrics = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1)
}

function parseRgb(value: string): [number, number, number] {
  const channels = value.match(/[\d.]+/g)?.slice(0, 3).map(Number)
  if (!channels || channels.length !== 3 || channels.some((channel) => !Number.isFinite(channel))) {
    throw new Error(`无法解析颜色：${value}`)
  }
  return channels as [number, number, number]
}

function relativeLuminance([red, green, blue]: [number, number, number]): number {
  const channels = [red, green, blue].map((channel) => {
    const normalized = channel / 255
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4
  })
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
}

async function expectReadableButton(button: Locator): Promise<void> {
  const colors = await button.evaluate((element) => {
    const style = window.getComputedStyle(element)
    return { background: style.backgroundColor, foreground: style.color }
  })
  const background = relativeLuminance(parseRgb(colors.background))
  const foreground = relativeLuminance(parseRgb(colors.foreground))
  const ratio = (Math.max(background, foreground) + 0.05) / (Math.min(background, foreground) + 0.05)
  expect(ratio).toBeGreaterThanOrEqual(4.5)
}

async function attachViewportScreenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await testInfo.attach(name, {
    body: await page.screenshot({ animations: 'disabled' }),
    contentType: 'image/png',
  })
}

async function fulfillLocalQrPreflight(route: Route): Promise<boolean> {
  if (route.request().method() !== 'OPTIONS') return false
  const origin = route.request().headers().origin ?? 'http://127.0.0.1:4177'
  await route.fulfill({
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Local-Bridge-Token',
      'Access-Control-Allow-Private-Network': 'true',
    },
  })
  return true
}

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

async function fulfillQrCreate(route: Route, createCalls: { n: number }, ticketId: string, failFirst = false): Promise<void> {
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
  createCalls.n += 1
  if (failFirst && createCalls.n === 1) {
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': origin },
      body: JSON.stringify({ success: false, error: { code: 'QR_CREATE_FAILED', message: '请求失败（500）' } }),
    })
    return
  }
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: { 'Access-Control-Allow-Origin': origin },
    body: JSON.stringify({
      success: true,
      data: {
        ticketId,
        qrUrl: `/member/qr-login?ticketId=${ticketId}`,
        expiresInSeconds: 180,
        returnTo: '/',
      },
    }),
  })
}

test('W-15 先切到扫码再勾选协议也能拿到二维码 @kiosk', async ({ page, api }) => {
  registerKioskShell(api)
  api.respond('GET', `/api/v1/member/auth/qr/${TICKET_ID}/status`, {
    status: 200,
    json: { success: true, data: { status: 'pending', deviceLabel: '就业大厅 3 号机', returnTo: '/', expiresInSeconds: 180 } },
  })
  const createCalls = { n: 0 }
  await page.route(LOCAL_QR_CREATE_URL, (route) => fulfillQrCreate(route, createCalls, TICKET_ID))
  await page.goto('/login')
  await page.getByRole('button', { name: '手机扫码登录', exact: true }).click()
  await expect(page.getByText('等待你勾选协议', { exact: true })).toBeVisible()
  expect(createCalls.n).toBe(0)
  await page.getByRole('checkbox', { name: /我已阅读并同意/ }).click()
  await expect(page.locator('.k-qrframe svg')).toBeVisible()
  await expect(page.locator('.k-qrframe .k-qr-placeholder')).toHaveCount(0)
  expect(createCalls.n).toBe(1)
})

test('W-15 二维码获取失败后可以重新生成 @kiosk', async ({ page, api }) => {
  registerKioskShell(api)
  api.respond('GET', `/api/v1/member/auth/qr/${TICKET_ID}/status`, {
    status: 200,
    json: { success: true, data: { status: 'pending', deviceLabel: '就业大厅 3 号机', returnTo: '/', expiresInSeconds: 180 } },
  })
  const createCalls = { n: 0 }
  await page.route(LOCAL_QR_CREATE_URL, (route) => fulfillQrCreate(route, createCalls, TICKET_ID, true))
  await page.goto('/login')
  await page.getByRole('button', { name: '手机扫码登录', exact: true }).click()
  await page.getByRole('checkbox', { name: /我已阅读并同意/ }).click()
  await expect(page.getByTestId('login-gate-state-qr-error')).toBeVisible()
  await expect(page.getByText('二维码未能获取', { exact: true })).toBeVisible()
  const retry = page.getByTestId('login-gate-primary')
  await expect(retry).toHaveText('重新生成二维码')
  await expect(retry).toBeEnabled()
  await retry.click()
  await expect(page.locator('.k-qrframe svg')).toBeVisible()
  expect(createCalls.n).toBe(2)
})

test('手机号验证码按钮交互态可读且通用错误使用场景提示 @kiosk', async ({ page, api }, testInfo) => {
  registerKioskShell(api)
  let smsRequestCount = 0
  let releaseFirstResponse: (() => void) | undefined
  const firstResponseGate = new Promise<void>((resolve) => { releaseFirstResponse = resolve })

  await page.route('**/api/v1/member/auth/sms-code', async (route) => {
    smsRequestCount += 1
    if (smsRequestCount === 1) {
      await firstResponseGate
      await route.fulfill({ status: 500, contentType: 'text/plain', body: 'upstream failure' })
      return
    }
    await route.fulfill({
      status: 429,
      contentType: 'application/json',
      body: JSON.stringify({
        success: false,
        error: { code: 'SMS_RATE_LIMITED', message: '验证码发送过于频繁，请稍后再试' },
      }),
    })
  })

  try {
    await page.goto('/login')
    await enterMemberPhone(page)
    await page.getByRole('button', { name: '收起键盘', exact: true }).click()
    const sendButton = page.getByTestId('login-gate-send')
    const loginButton = page.getByRole('button', { name: '短信验证码', exact: true })
    await expect(sendButton).toHaveCount(1)
    await expect(sendButton).toHaveText('获取验证码')
    await expect(sendButton).toBeEnabled()
    await expect(sendButton).toBeVisible()
    await expectReadableButton(sendButton)
    await attachViewportScreenshot(page, testInfo, 'login-send-default-1080x1920')

    await sendButton.hover()
    await expectReadableButton(sendButton)
    await attachViewportScreenshot(page, testInfo, 'login-send-hover-1080x1920')

    await page.getByRole('button', { name: '手机号（11 位本人号码）', exact: true }).focus()
    await page.keyboard.press('Tab')
    await expect(sendButton).toBeFocused()
    expect(await sendButton.evaluate((element) => element.matches(':focus-visible'))).toBe(true)
    await attachViewportScreenshot(page, testInfo, 'login-send-focus-1080x1920')

    await expect(loginButton).toBeDisabled()
    await expect(loginButton).toContainText('还没有可填的验证码')
    const loginBox = await loginButton.boundingBox()
    expect(loginBox?.height ?? 0).toBeGreaterThanOrEqual(56)

    await sendButton.click()
    await expect(sendButton).toBeDisabled()
    await expect(sendButton).toContainText('发送中')
    await expectReadableButton(sendButton)
    releaseFirstResponse?.()
    await expect(page.getByRole('alert')).toContainText('验证码发送失败，请稍后重试')
    await expect(page.getByText('请求失败（500）', { exact: true })).toHaveCount(0)
    await attachViewportScreenshot(page, testInfo, 'login-phone-generic-500-1080x1920')

    await sendButton.click()
    await expect(page.getByRole('alert')).toContainText('验证码发送过于频繁，请稍后再试')
    await attachViewportScreenshot(page, testInfo, 'login-phone-business-message-1080x1920')
    await expectNoHorizontalOverflow(page)
    await expect(page.getByRole('button', { name: '手机号登录', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '手机扫码登录', exact: true })).toBeVisible()
  } finally {
    releaseFirstResponse?.()
  }
})

test('Kiosk 扫码登录通用 500 使用本机场景恢复提示 @kiosk', async ({ page, api }, testInfo) => {
  registerKioskShell(api)
  await page.route(LOCAL_QR_CREATE_URL, async (route) => {
    if (await fulfillLocalQrPreflight(route)) return
    expect(route.request().method()).toBe('POST')
    const origin = route.request().headers().origin ?? 'http://127.0.0.1:4177'
    await route.fulfill({
      status: 500,
      contentType: 'text/plain',
      headers: { 'Access-Control-Allow-Origin': origin },
      body: 'agent upstream failure',
    })
  })

  await page.goto('/login')
  await page.getByRole('checkbox', { name: /我已阅读并同意/ }).click()
  await page.getByRole('button', { name: '手机扫码登录', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('扫码登录服务不可用，请使用手机号登录')
  await expect(page.getByText('请求失败（500）', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /改用手机号登录/ })).toBeVisible()
  await expectNoHorizontalOverflow(page)
  await attachViewportScreenshot(page, testInfo, 'login-kiosk-qr-generic-500-1080x1920')
})

test('Mobile QR 通用 500 使用恢复提示且明确业务消息原样保留 @mobile', async ({ page }, testInfo) => {
  let statusRequestCount = 0
  await page.route('**/api/v1/member/auth/qr/mobile-error-ticket/status', async (route) => {
    statusRequestCount += 1
    if (statusRequestCount === 1) {
      await route.fulfill({ status: 500, contentType: 'text/plain', body: 'gateway failure' })
      return
    }
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        success: false,
        error: { code: 'QR_SERVICE_MAINTENANCE', message: '二维码服务维护中，请稍后重试' },
      }),
    })
  })

  await page.goto('/member/qr-login?ticketId=mobile-error-ticket')
  const root = page.locator('main[data-kiosk-screen="member-qr-login"]')
  await expect(root.getByRole('heading', { name: '二维码状态读取失败', exact: true })).toBeVisible()
  await expect(root.getByText('请求失败（500）', { exact: true })).toHaveCount(0)
  const retry = root.getByRole('button', { name: '重新检查二维码', exact: true })
  await expect(retry).toBeVisible()
  await expectNoHorizontalOverflow(page)
  await attachViewportScreenshot(page, testInfo, 'mobile-qr-generic-500-390x844')

  await retry.click()
  await expect(root.getByText('二维码服务维护中，请稍后重试', { exact: true })).toBeVisible()
  await attachViewportScreenshot(page, testInfo, 'mobile-qr-business-message-390x844')
  expect(statusRequestCount).toBe(2)
})

// ── 手机确认登录（稿 51 screen=qr-login）：每一步只按 status / sms-code / confirm 的真实回执推进 ──
const MOBILE_TICKET = 'mobile_chain_ticket_0123456789abcdefghij'
const MOBILE_STATUS_PATH = `/api/v1/member/auth/qr/${MOBILE_TICKET}/status`
const MOBILE_CONFIRM_PATH = `/api/v1/member/auth/qr/${MOBILE_TICKET}/confirm`
const SMS_CODE_PATH = '/api/v1/member/auth/sms-code'
const SMS_SENT = { status: 200, json: { success: true, data: { sent: true, cooldownSeconds: 60, expiresInSeconds: 300 } } }

function pendingTicket(deviceLabel?: string) {
  return {
    status: 200,
    json: { success: true, data: { status: 'pending', ...(deviceLabel ? { deviceLabel } : {}), returnTo: '/', expiresInSeconds: 142 } },
  }
}

async function attachProjectScreenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const path = testInfo.outputPath(`${name}-${testInfo.project.name}.png`)
  await page.screenshot({ path, animations: 'disabled' })
  await testInfo.attach(name, { path, contentType: 'image/png' })
}

async function sendCodeAndFill(root: Locator, code: string): Promise<void> {
  await root.getByLabel('手机号，11 位数字').fill(MEMBER_PHONE)
  await root.getByRole('button', { name: '获取短信验证码' }).click()
  await expect(root).toHaveAttribute('data-mobile-qr-state', 'code-sent')
  await root.getByLabel('短信验证码，6 位数字').fill(code)
}

test('Mobile QR 按回执走完发码、填错、确认，成功屏只说已确认不说已登录 @mobile @kiosk', async ({ page, api }, testInfo) => {
  api.respond('GET', MOBILE_STATUS_PATH, pendingTicket('就业大厅 3 号机'))
  api.respond('POST', SMS_CODE_PATH, SMS_SENT)
  api.respondWith('POST', MOBILE_CONFIRM_PATH, (attempt) => attempt === 1
    ? { status: 401, json: { success: false, error: { code: 'SMS_CODE_INVALID', message: '验证码不正确' } } }
    : { status: 200, json: { success: true, data: { status: 'confirmed' } } })
  const confirmBodies: unknown[] = []
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/confirm')) confirmBodies.push(request.postDataJSON())
  })

  await page.goto(`/member/qr-login?ticketId=${MOBILE_TICKET}`)
  const root = page.locator('main[data-kiosk-screen="member-qr-login"]')
  await expect(root).toHaveAttribute('data-mobile-qr-state', 'ready')
  await expect(root.getByRole('heading', { level: 1, name: '就业大厅 3 号机' })).toBeVisible()
  await expect(root.getByText('142 秒', { exact: true })).toBeVisible()
  const codeInput = root.getByLabel('短信验证码，6 位数字')
  const confirm = root.getByRole('button', { name: '确认本次一体机登录请求' })
  await expect(codeInput).toBeDisabled()
  await expect(confirm).toHaveAttribute('aria-disabled', 'true')
  await expectNoHorizontalOverflow(page)
  await attachProjectScreenshot(page, testInfo, 'mobile-qr-ready')

  await sendCodeAndFill(root, '000000')
  await expect(root.getByText('+86 138****8000', { exact: true })).toBeVisible()
  await expect(root.getByLabel('手机号，11 位数字')).toHaveCount(0)
  await confirm.click()
  await expect(root).toHaveAttribute('data-mobile-qr-state', 'confirm-code-invalid')
  await expect(root.getByRole('alert').filter({ hasText: '验证码不正确' })).toBeVisible()
  await expect(codeInput).toHaveValue('')
  await expect(codeInput).toBeEnabled()
  await expectNoHorizontalOverflow(page)
  await attachProjectScreenshot(page, testInfo, 'mobile-qr-code-invalid')

  await codeInput.fill('123456')
  await confirm.click()
  await expect(root).toHaveAttribute('data-mobile-qr-state', 'confirmed')
  await expect(root.getByRole('heading', { name: '已确认，请回一体机继续', exact: true })).toBeVisible()
  await expect(root.getByText(/登录成功|已登录/)).toHaveCount(0)
  await expect(root.getByRole('button')).toHaveCount(0)
  expect(confirmBodies.at(-1)).toEqual({ phone: MEMBER_PHONE, code: '123456' })
  expect(api.requestCount('POST', MOBILE_CONFIRM_PATH)).toBe(2)
  expect(api.requestCount('POST', SMS_CODE_PATH)).toBe(1)
  await expectNoHorizontalOverflow(page)
  await attachProjectScreenshot(page, testInfo, 'mobile-qr-confirmed')
})

test('Mobile QR 确认结果未知时不盲重试，重新检查读到死票据后不给重试 @mobile @kiosk', async ({ page, api }, testInfo) => {
  api.respondWith('GET', MOBILE_STATUS_PATH, (read) => read === 1
    ? pendingTicket()
    : { status: 410, json: { success: false, error: { code: 'QR_LOGIN_ALREADY_CLAIMED', message: '扫码登录已被领取' } } })
  api.respond('POST', SMS_CODE_PATH, SMS_SENT)
  api.abort('POST', MOBILE_CONFIRM_PATH, 'internetdisconnected')

  await page.goto(`/member/qr-login?ticketId=${MOBILE_TICKET}`)
  const root = page.locator('main[data-kiosk-screen="member-qr-login"]')
  await expect(root).toHaveAttribute('data-mobile-qr-state', 'device-missing')
  await expect(root.getByRole('heading', { level: 1, name: '一体机名称未提供' })).toBeVisible()

  await sendCodeAndFill(root, '123456')
  await root.getByRole('button', { name: '确认本次一体机登录请求' }).click()
  await expect(root).toHaveAttribute('data-mobile-qr-state', 'confirm-unknown')
  await expect(root.getByText('这次确认有没有成功，本页不知道', { exact: true })).toBeVisible()
  await expect(root.getByRole('button', { name: '确认本次一体机登录请求' })).toHaveCount(0)
  await expect(root.getByLabel('短信验证码，6 位数字')).toHaveValue('123456')
  await expect(root.getByLabel('短信验证码，6 位数字')).toBeDisabled()
  await expectNoHorizontalOverflow(page)
  await attachProjectScreenshot(page, testInfo, 'mobile-qr-confirm-unknown')

  await root.getByRole('button', { name: '重新检查这张二维码的状态' }).click()
  await expect(root).toHaveAttribute('data-mobile-qr-state', 'ticket-expired')
  await expect(root.getByRole('heading', { name: '这个二维码不能再确认了', exact: true })).toBeVisible()
  await expect(root.getByRole('button')).toHaveCount(0)
  expect(api.requestCount('POST', MOBILE_CONFIRM_PATH)).toBe(1)
  expect(api.requestCount('GET', MOBILE_STATUS_PATH)).toBe(2)
  await attachProjectScreenshot(page, testInfo, 'mobile-qr-ticket-expired')
})

test('Mobile QR 同一页面换票据后丢弃旧票据的会话，迟到的旧确认回执不把新票据标成已确认 @mobile', async ({ page, api }, testInfo) => {
  const nextTicket = 'mobile_next_ticket_0123456789abcdefghijk'
  let releaseStaleConfirm: (() => void) | undefined
  const staleConfirmGate = new Promise<void>((resolve) => { releaseStaleConfirm = resolve })
  api.respond('GET', MOBILE_STATUS_PATH, pendingTicket('就业大厅 3 号机'))
  api.respond('GET', `/api/v1/member/auth/qr/${nextTicket}/status`, pendingTicket('就业大厅 5 号机'))
  api.respond('POST', SMS_CODE_PATH, SMS_SENT)
  api.respondWith('POST', MOBILE_CONFIRM_PATH, async () => {
    await staleConfirmGate
    return { status: 200, json: { success: true, data: { status: 'confirmed' } } }
  })

  try {
    await page.goto(`/member/qr-login?ticketId=${MOBILE_TICKET}`)
    const root = page.locator('main[data-kiosk-screen="member-qr-login"]')
    await expect(root).toHaveAttribute('data-mobile-qr-state', 'ready')
    await sendCodeAndFill(root, '123456')
    await root.getByRole('button', { name: '确认本次一体机登录请求' }).click()
    await expect(root).toHaveAttribute('data-mobile-qr-state', 'confirming')

    // 不整页刷新、只换地址栏里的票据：页面实例还在，旧票据的号码、验证码与在途确认都不能带进新票据。
    await page.evaluate((url) => {
      window.history.pushState(null, '', url)
      window.dispatchEvent(new PopStateEvent('popstate'))
    }, `/member/qr-login?ticketId=${nextTicket}`)
    await expect(root.getByRole('heading', { level: 1, name: '就业大厅 5 号机' })).toBeVisible()
    await expect(root).toHaveAttribute('data-mobile-qr-state', 'ready')
    await expect(root.getByLabel('手机号，11 位数字')).toHaveValue('')
    await expect(root.getByLabel('短信验证码，6 位数字')).toHaveValue('')
    await expect(root.getByLabel('短信验证码，6 位数字')).toBeDisabled()

    const staleConfirmed = page.waitForResponse((response) => response.url().endsWith(MOBILE_CONFIRM_PATH))
    releaseStaleConfirm?.()
    await staleConfirmed
    await page.evaluate(() => new Promise((resolve) => window.setTimeout(resolve, 300)))
    await expect(root).toHaveAttribute('data-mobile-qr-state', 'ready')
    await expect(root.getByRole('heading', { name: '已确认，请回一体机继续', exact: true })).toHaveCount(0)
    await expect(root.getByRole('heading', { level: 1, name: '就业大厅 5 号机' })).toBeVisible()
    expect(api.requestCount('POST', `/api/v1/member/auth/qr/${nextTicket}/confirm`)).toBe(0)
    await attachProjectScreenshot(page, testInfo, 'mobile-qr-ticket-switched')
  } finally {
    releaseStaleConfirm?.()
  }
})

// W4 L1: business messages must keep their meaning; raw codes use the correct recovery.
for (const scenario of [
  { code: 'SMS_SEND_FAILED', status: 502, message: 'SMS_SEND_FAILED', expected: '可以立刻重新获取', state: 'phone-send-failed' },
  { code: 'SMS_TOO_FREQUENT', status: 429, message: 'SMS_TOO_FREQUENT', expected: '稍后再试', state: 'phone-send-limited' },
  { code: 'SMS_IP_LIMIT', status: 429, message: 'SMS_IP_LIMIT', expected: '稍后再试', state: 'phone-send-limited' },
  { code: 'SMS_DEVICE_LIMIT', status: 429, message: 'SMS_DEVICE_LIMIT', expected: '稍后再试', state: 'phone-send-limited' },
  { code: 'SMS_PROVIDER_RATE_LIMIT', status: 429, message: 'SMS_PROVIDER_RATE_LIMIT', expected: '稍后再试', state: 'phone-send-limited' },
  { code: 'SMS_DAILY_LIMIT', status: 429, message: 'SMS_DAILY_LIMIT', expected: '明天再试', state: 'phone-send-limited' },
  { code: 'SMS_PROVIDER_PHONE_DAILY_LIMIT', status: 429, message: 'SMS_PROVIDER_PHONE_DAILY_LIMIT', expected: '明天再试', state: 'phone-send-limited' },
  { code: 'SMS_TOO_FREQUENT', status: 429, message: '当前使用的人较多，请稍后再试', expected: '当前使用的人较多，请稍后再试', state: 'phone-send-limited' },
]) {
  test(`W4 SMS recovery ${scenario.code}: ${scenario.message} @kiosk`, async ({ page, api }) => {
    registerKioskShell(api)
    api.respond('POST', '/api/v1/member/auth/sms-code', { status: scenario.status, json: { success: false, error: { code: scenario.code, message: scenario.message } } })
    await page.goto('/login')
    await expect(page.locator('.qx-topbar button')).toHaveCount(1)
    await expect(page.locator('.qx-topbar button')).toHaveAccessibleName('返回首页')
    await expect(page.locator('.qx-step-prev')).toHaveText('返回首页')
    await expect(page.getByTestId('login-gate-keypad')).toHaveCount(0)
    if (scenario.code === 'SMS_SEND_FAILED') {
      expect((await page.getByTestId('login-gate-tab-phone').boundingBox())!.y).toBeGreaterThanOrEqual(500)
      expect(await page.locator('.k1-login .qx-scroll').evaluate((el) => el.scrollHeight - el.clientHeight), '登录默认态首屏放得下').toBeLessThanOrEqual(1)
      await expect(page.getByRole('checkbox', { name: /我已阅读并同意/ })).toBeInViewport()
    }
    await enterMemberPhone(page)
    await page.getByRole('button', { name: '收起键盘', exact: true }).click()
    expect(await page.locator('body').innerText()).not.toContain(MEMBER_PHONE)
    await page.getByTestId('login-gate-send').click()
    await expect(page.getByTestId(`login-gate-state-${scenario.state}`)).toBeVisible()
    await expect(page.getByRole('alert')).toContainText(scenario.expected)
    await expect(page.getByRole('alert')).not.toContainText(scenario.code)
    if (scenario.message.startsWith('当前')) await expect(page.getByRole('alert')).toHaveText(scenario.message)
    if (scenario.code === 'SMS_SEND_FAILED') {
      await expect(page.getByTestId('login-gate-send')).toBeEnabled()
      await page.getByTestId('login-gate-send').click()
      expect(api.requestCount('POST', '/api/v1/member/auth/sms-code')).toBe(2)
    }
  })
}

// 这台机器 / 全站今天发不了码：重试无用，主按钮直接换到扫码登录；发码请求带终端会话票（按台计额度）。
for (const scenario of [
  { code: 'SMS_TERMINAL_DAILY_LIMIT', status: 429, message: '这台机器今天发出的短信验证码已达上限，请明天再试', expected: '这台机器今天发出的短信验证码已达上限' },
  { code: 'SMS_DAILY_TOTAL_LIMIT', status: 429, message: '今天的短信验证码发送量已达上限，请明天再试', expected: '发送量已达上限' },
  { code: 'SMS_BUDGET_UNAVAILABLE', status: 503, message: '短信发送量暂时无法核对，为防止验证码被滥发，先暂停发送，请稍后再试', expected: '暂时无法核对' },
  { code: 'TERMINAL_SESSION_INVALID', status: 401, message: '终端安全会话无效', expected: '这台机器现在发不了验证码，请改用扫码登录' },
]) {
  test(`SMS unavailable on this machine ${scenario.code} → 改用扫码登录 @kiosk`, async ({ page, api }) => {
    registerKioskShell(api)
    api.respond('POST', '/api/v1/member/auth/sms-code', { status: scenario.status, json: { success: false, error: { code: scenario.code, message: scenario.message } } })
    // 会话票被拒时 terminalAttributedFetch 会换一次票；换票同样被拒，页面落到扫码退路。
    api.respond('POST', '/api/v1/terminals/session-token/refresh', { status: 401, json: { success: false, error: { code: 'TERMINAL_SESSION_INVALID', message: '终端安全会话无效' } } })
    await page.goto('/login')
    await enterMemberPhone(page)
    await page.getByRole('button', { name: '收起键盘', exact: true }).click()
    const sent = page.waitForRequest((request) => request.url().endsWith('/api/v1/member/auth/sms-code') && request.method() === 'POST')
    await page.getByTestId('login-gate-send').click()
    const headers = (await sent).headers()
    expect(headers['x-terminal-id'], '发码按台计：带终端编号').toBeTruthy()
    expect(headers['x-terminal-session-token'], '发码按台计：带终端会话票').toBeTruthy()
    await expect(page.getByTestId('login-gate-state-phone-sms-unavailable')).toBeVisible()
    await expect(page.getByRole('alert')).toContainText(scenario.expected)
    await expect(page.getByRole('alert')).not.toContainText(scenario.code)
    await expect(page.getByText('再试一次发码')).toHaveCount(0)
    await expect(page.getByTestId('login-gate-send')).toHaveText('暂时不能发')
    await expect(page.getByTestId('login-gate-send')).toBeDisabled()
    await expect(page.getByText('获取验证码', { exact: true })).toHaveCount(0)
    const head = page.locator('.qx-pagehead')
    if (scenario.code === 'SMS_TERMINAL_DAILY_LIMIT') await expect(head).toContainText('这台机器今天的短信已经发完')
    if (scenario.code === 'SMS_DAILY_TOTAL_LIMIT') {
      await expect(head).toContainText('今天的短信验证码已经发完')
      await expect(head).not.toContainText('这台机器')
    }
    await expect(page.getByTestId('login-gate-anonymous')).toHaveText('不登录，继续使用')
    const primary = page.getByTestId('login-gate-primary')
    await expect(primary).toHaveText('改用扫码登录')
    await primary.click()
    await expect(page.locator('[data-screen="login-gate"]')).toHaveAttribute('data-mode', 'qr')
  })
}

test('W-19 这个号码今天用完后不再写成重新获取验证码 @kiosk', async ({ page, api }) => {
  registerKioskShell(api)
  api.respond('POST', '/api/v1/member/auth/sms-code', {
    status: 429,
    json: { success: false, error: { code: 'SMS_DAILY_LIMIT', message: 'SMS_DAILY_LIMIT' } },
  })
  await page.goto('/login')
  await enterMemberPhone(page)
  await page.getByRole('button', { name: '收起键盘', exact: true }).click()
  await page.getByTestId('login-gate-send').click()
  await expect(page.getByTestId('login-gate-state-phone-send-limited')).toBeVisible()
  await expect(page.locator('.qx-pagehead')).toContainText('这个号码今天不能再收验证码')
  await expect(page.getByRole('alert')).toContainText('这个号码今天的验证码次数已用完')
  await expect(page.getByTestId('login-gate-send')).toHaveText('今天不能再发')
  await expect(page.getByTestId('login-gate-send')).toBeDisabled()
  await expect(page.getByTestId('login-gate-primary')).toHaveText('改用扫码登录')
  await expect(page.getByTestId('login-gate-anonymous')).toHaveText('不登录，继续使用')
  await expect(page.getByText('重新获取验证码', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '手机号（11 位本人号码）', exact: true }).click()
  await page.getByRole('button', { name: '删除', exact: true }).click()
  await expect(page.getByTestId('login-gate-send')).toHaveText('获取验证码')
})

for (const [code, state] of [['SMS_CODE_INVALID', 'phone-code-invalid'], ['SMS_CODE_EXPIRED', 'phone-code-expired'], ['SMS_CODE_LOCKED', 'phone-code-locked']]) {
  test(`W4 verification recovery ${code} @kiosk`, async ({ page, api }) => {
    registerKioskShell(api)
    api.respond('POST', '/api/v1/member/auth/sms-code', { status: 200, json: { success: true, data: { sent: true, cooldownSeconds: 17, expiresInSeconds: 91 } } })
    for (const kind of ['terms_of_service', 'privacy_policy']) api.respond('GET', `/api/v1/kiosk/legal/${kind}`, { status: 200, json: { success: true, data: null } })
    api.respond('POST', '/api/v1/member/auth/login', { status: 400, json: { success: false, error: { code, message: code } } })
    await page.goto('/login'); await enterMemberPhone(page)
    await page.getByRole('button', { name: '收起键盘', exact: true }).click()
    await page.getByTestId('login-gate-send').click()
    await expect(page.getByRole('status')).toContainText('有效期 91 秒')
    await page.getByRole('button', { name: '短信验证码', exact: true }).click()
    for (const digit of '123456') await page.getByRole('button', { name: digit, exact: true }).click()
    await page.getByRole('button', { name: '收起键盘', exact: true }).click()
    await page.getByRole('button', { name: '确认登录', exact: true }).click()
    await expect(page.getByTestId(`login-gate-state-${state}`)).toBeVisible()
    await expect(page.getByRole('alert')).not.toContainText(code)
    const input = page.getByRole('button', { name: '短信验证码', exact: true })
    if (code === 'SMS_CODE_INVALID') await expect(input).toBeEnabled()
    else await expect(input).toBeDisabled()
  })
}
