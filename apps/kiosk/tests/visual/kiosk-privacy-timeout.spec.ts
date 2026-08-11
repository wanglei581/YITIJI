import type { Page, Route } from '@playwright/test'
import type { ApiRouter } from '../fixtures/api-router'
import { expect, test } from '../fixtures/kiosk-test'

const MEMBER_TOKEN = 'privacy-member-memory-token'
const MEMBER_PHONE = '13800138000'
const MEMBER_CODE = '123456'
const MEMBER_REPORT_POSITION = '隐私回归高级前端工程师'
const PAYMENT_SESSION_TOKEN = 'privacy-payment-session-token'
const PAYMENT_ORDER_ID = 'privacy-payment-order'
const PRINT_TASK_ID = 'privacy-print-task'
const SCAN_TASK_ID = 'privacy-scan-task'
const SCAN_CONTROL_TOKEN = 'privacy-scan-control-token'
const HARD_PRIVACY_SETTLE_MS = 3_800
const POLL_CLEANUP_OBSERVATION_MS = 3_400

const SENSITIVE_SESSION_KEYS = [
  'ai-job-print:current-print-material-check',
  'ai-job-print:current-ai-resume',
  'ai-job-print:job-material-draft:v1',
] as const

function registerKioskShell(api: ApiRouter): void {
  api.respond('GET', '/api/v1/terminals/KSK-001/screensaver', {
    status: 200,
    json: { enabled: false, idleTimeoutSec: 180, items: [] },
  })
  api.respond('GET', '/api/v1/terminals/KSK-001/printer-status', {
    status: 200,
    json: { printerStatus: 'ready', paperLevel: 'sufficient', isOnline: true },
  })
  api.respond('GET', '/api/v1/terminals/KSK-001/smart-campus', {
    status: 200,
    json: { enabled: false, modules: { welcome: false, bigdata: false, luggage: false, panorama: false }, items: [] },
  })
  api.respond('GET', '/api/v1/terminals/KSK-001/config', {
    status: 200,
    json: {
      smartCampus: { enabled: false, modules: {}, items: [] },
      toolbox: { enabled: false, items: [] },
      configVersion: 'privacy-browser-fixture',
      refreshIntervalMs: 300_000,
      serverTime: '2026-07-29T00:00:00.000Z',
    },
  })
  api.respond('GET', '/api/v1/me/favorites', {
    status: 200,
    json: { success: true, data: { items: [], nextCursor: null, total: 0 } },
  })
  api.respond('GET', '/api/v1/me/ai-records', {
    status: 200,
    json: { success: true, data: { items: [], nextCursor: null, total: 0 } },
  })
  api.respond('GET', '/api/v1/me/documents', {
    status: 200,
    json: { success: true, data: { items: [], nextCursor: null, total: 0 } },
  })
  api.respond('GET', '/api/v1/me/resumes', {
    status: 200,
    json: { success: true, data: { items: [], nextCursor: null, total: 0 } },
  })
  api.respond('GET', '/api/v1/me/print-orders', {
    status: 200,
    json: { success: true, data: { items: [], nextCursor: null, total: 0 } },
  })
}

function registerMemberLogin(api: ApiRouter): void {
  api.respond('GET', '/api/v1/kiosk/legal/terms_of_service', {
    status: 200,
    json: { success: true, data: null },
  })
  api.respond('GET', '/api/v1/kiosk/legal/privacy_policy', {
    status: 200,
    json: { success: true, data: null },
  })
  api.respond('POST', '/api/v1/member/auth/sms-code', {
    status: 200,
    json: { success: true, data: { sent: true, cooldownSeconds: 60, expiresInSeconds: 300 } },
  })
  api.respond('POST', '/api/v1/member/auth/login', {
    status: 200,
    json: {
      success: true,
      data: {
        token: MEMBER_TOKEN,
        user: { id: 'privacy-member', phoneMasked: '138****8000', nickname: '隐私回归会员' },
      },
    },
  })
}

async function routeExact(
  page: Page,
  method: string,
  path: string,
  handler: (route: Route) => Promise<void>,
): Promise<void> {
  await page.route(`**${path}`, async (route) => {
    const request = route.request()
    if (request.method() !== method || new URL(request.url()).pathname !== path) {
      await route.fallback()
      return
    }
    await handler(route)
  })
}

async function loginThroughVisibleUi(page: Page, returnTo = '/interview/reports'): Promise<void> {
  await page.goto(`/login?from=${encodeURIComponent(returnTo)}`)
  await page.getByRole('checkbox', { name: /我已阅读并同意/ }).click()
  for (const digit of MEMBER_PHONE) {
    await page.getByRole('button', { name: digit, exact: true }).click()
  }
  await page.getByRole('button', { name: '获取验证码', exact: true }).click()
  await page.getByRole('button', { name: '短信验证码', exact: true }).click()
  for (const digit of MEMBER_CODE) {
    await page.getByRole('button', { name: digit, exact: true }).click()
  }
  await page.getByRole('button', { name: '验证并登录', exact: true }).click()
  await page.waitForURL((url) => url.pathname === returnTo)
}

async function openResumedPaymentCashier(page: Page, api: ApiRouter): Promise<{
  paymentRequests: () => Array<{ authorization: string; paymentSessionToken: string }>
}> {
  registerKioskShell(api)
  registerMemberLogin(api)
  api.respond('GET', '/api/v1/payment/channels', {
    status: 200,
    json: { channels: ['sandbox'] },
  })
  api.respond('POST', '/api/v1/member/auth/logout', {
    status: 200,
    json: { success: true, data: { loggedOut: true } },
  })

  await routeExact(page, 'GET', '/api/v1/me/pending-tasks', async (route) => {
    expect((await route.request().allHeaders()).authorization).toBe(`Bearer ${MEMBER_TOKEN}`)
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: [{
          id: 'privacy-resume-print-task',
          type: 'print',
          status: 'pending',
          payStatus: 'unpaid',
          fileName: '隐私回归待支付材料.pdf',
          updatedAt: '2026-08-09T08:00:00.000Z',
          resume: {
            kind: 'payment',
            orderId: PAYMENT_ORDER_ID,
            orderNo: 'ORD-PRIVACY-HISTORY',
            amountCents: 200,
            priceLines: [{ serviceKey: 'print_bw_page', unitCents: 100, quantity: 2, subtotalCents: 200 }],
            paymentSessionToken: PAYMENT_SESSION_TOKEN,
          },
        }],
      }),
    })
  })

  const paymentRequests: Array<{ authorization: string; paymentSessionToken: string }> = []
  await routeExact(page, 'GET', `/api/v1/orders/${PAYMENT_ORDER_ID}/pay-status`, async (route) => {
    const headers = await route.request().allHeaders()
    paymentRequests.push({
      authorization: headers.authorization ?? '',
      paymentSessionToken: headers['x-payment-session-token'] ?? '',
    })
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        orderId: PAYMENT_ORDER_ID,
        orderNo: 'ORD-PRIVACY-HISTORY',
        payStatus: 'unpaid',
        paymentSource: null,
        payChannel: null,
        amountCents: 200,
        paidAt: null,
        pickupCode: null,
        attempt: null,
      }),
    })
  })

  await loginThroughVisibleUi(page, '/session-resume')
  await page.getByRole('button', { name: /隐私回归待支付材料/ }).click()
  await page.waitForURL((url) => url.pathname === '/print/cashier')
  await expect.poll(() => paymentRequests.length).toBeGreaterThan(0)
  expect(paymentRequests[0]).toEqual({ authorization: '', paymentSessionToken: PAYMENT_SESSION_TOKEN })
  expect(await page.evaluate(() => {
    const state = window.history.state as { usr?: { paymentSessionToken?: string } } | null
    return state?.usr?.paymentSessionToken ?? null
  })).toBe(PAYMENT_SESSION_TOKEN)

  return { paymentRequests: () => [...paymentRequests] }
}

async function walkHistory(page: Page, direction: 'back' | 'forward'): Promise<Array<{ path: string; token: string | null }>> {
  const snapshots: Array<{ path: string; token: string | null }> = []
  for (let step = 0; step < 5; step += 1) {
    const move = direction === 'back' ? page.goBack.bind(page) : page.goForward.bind(page)
    await move({ waitUntil: 'domcontentloaded' }).catch(() => null)
    await page.waitForTimeout(150)
    snapshots.push(await page.evaluate(() => {
      const state = window.history.state as { usr?: { paymentSessionToken?: string } } | null
      return { path: window.location.pathname, token: state?.usr?.paymentSessionToken ?? null }
    }))
  }
  return snapshots
}

async function installMemberReportRoutes(page: Page): Promise<{
  reportRequestCount: () => number
  reportAuthorization: () => string[]
  logoutAuthorization: () => string[]
}> {
  let reportRequests = 0
  const reportAuthHeaders: string[] = []
  const logoutAuthHeaders: string[] = []

  await routeExact(page, 'GET', '/api/v1/me/mock-interviews', async (route) => {
    reportRequests += 1
    reportAuthHeaders.push(route.request().headers()['authorization'] ?? '')
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          items: [{
            sessionId: 'privacy-member-report',
            interviewerType: 'tech',
            interviewerLabel: '技术面试官',
            industry: '软件与信息服务',
            position: MEMBER_REPORT_POSITION,
            durationMin: 8,
            createdAt: '2026-07-29T01:00:00.000Z',
            endedAt: '2026-07-29T01:08:00.000Z',
            hasReport: true,
          }],
          nextCursor: null,
        },
      }),
    })
  })
  await routeExact(page, 'POST', '/api/v1/member/auth/logout', async (route) => {
    logoutAuthHeaders.push(route.request().headers()['authorization'] ?? '')
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { loggedOut: true } }),
    })
  })

  return {
    reportRequestCount: () => reportRequests,
    reportAuthorization: () => [...reportAuthHeaders],
    logoutAuthorization: () => [...logoutAuthHeaders],
  }
}

async function openAuthenticatedMemberReport(page: Page, api: ApiRouter) {
  registerKioskShell(api)
  registerMemberLogin(api)
  const requests = await installMemberReportRoutes(page)
  await loginThroughVisibleUi(page)
  await expect(page.getByText(MEMBER_REPORT_POSITION, { exact: false })).toBeVisible()
  expect(requests.reportAuthorization()).toEqual([`Bearer ${MEMBER_TOKEN}`])
  return requests
}

async function markCurrentDocument(page: Page, marker: string): Promise<void> {
  await page.evaluate((value) => {
    Object.assign(window, { __privacyDocumentMarker: value })
  }, marker)
}

async function readDocumentMarker(page: Page): Promise<string | null> {
  let lastError: unknown
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      return await page.evaluate(() => {
        const candidate = window as typeof window & { __privacyDocumentMarker?: string }
        return candidate.__privacyDocumentMarker ?? null
      })
    } catch (error) {
      lastError = error
      if (!(error instanceof Error) || !error.message.includes('Execution context was destroyed')) throw error
      await page.waitForLoadState('domcontentloaded').catch(() => undefined)
      await page.waitForTimeout(25)
    }
  }
  throw lastError
}

test('member report hard-replaces a clean homepage after the privacy deadline @privacy-kiosk', async ({ page, api }) => {
  await openAuthenticatedMemberReport(page, api)
  await markCurrentDocument(page, 'member-report-document')

  await page.waitForTimeout(HARD_PRIVACY_SETTLE_MS)

  expect(new URL(page.url()).pathname).toBe('/')
  expect(await readDocumentMarker(page)).toBeNull()
  await expect(page.getByRole('button', { name: /登录 \/ 注册/ })).toBeVisible()
})

test('member privacy clear sends the original bearer and blocks authenticated re-entry @privacy-kiosk', async ({ page, api }) => {
  const requests = await openAuthenticatedMemberReport(page, api)

  await page.waitForTimeout(HARD_PRIVACY_SETTLE_MS)

  expect.soft(requests.logoutAuthorization()).toEqual([`Bearer ${MEMBER_TOKEN}`])
  if (new URL(page.url()).pathname !== '/') {
    await page.getByRole('button', { name: '返回', exact: true }).click()
  }
  api.respond('GET', '/api/v1/health', {
    status: 200,
    json: { success: true, data: { status: 'ok' } },
  })
  await page.getByRole('button', { name: /AI面试训练/ }).click()
  await page.getByRole('button', { name: /训练报告/ }).click()
  await expect(page.locator('[data-kiosk-screen="interview-reports"]')).toBeVisible()
  expect.soft(requests.reportRequestCount()).toBe(1)
  await expect.soft(page.getByText(MEMBER_REPORT_POSITION, { exact: false })).toHaveCount(0)
  await expect.soft(page.getByText('登录后可保存练习报告', { exact: true })).toBeVisible()
})

test('manual profile logout clears token-bearing cashier history @privacy-kiosk @privacy-manual-logout', async ({ page, api }) => {
  const requests = await openResumedPaymentCashier(page, api)
  await page.getByRole('button', { name: '退出支付', exact: true }).click()
  await page.waitForURL((url) => url.pathname === '/')
  await page.getByRole('button', { name: '我的', exact: true }).click()
  await page.waitForURL((url) => url.pathname === '/profile')

  await page.getByRole('button', { name: '退出登录', exact: true }).click()
  await expect(page.getByRole('button', { name: '手机号登录', exact: true })).toBeVisible()
  const requestCountAfterLogout = requests.paymentRequests().length

  for (const direction of ['back', 'forward'] as const) {
    const snapshots = await walkHistory(page, direction)
    expect(snapshots).not.toContainEqual(expect.objectContaining({ token: PAYMENT_SESSION_TOKEN }))
    expect(snapshots).not.toContainEqual(expect.objectContaining({ path: '/print/cashier' }))
  }
  expect(requests.paymentRequests()).toHaveLength(requestCountAfterLogout)
})

test('legal documents cannot suspend an authenticated kiosk privacy deadline @privacy-kiosk', async ({ page, api }) => {
  const requests = await openAuthenticatedMemberReport(page, api)
  await page.evaluate(() => {
    window.history.pushState({ usr: null, key: 'privacy-legal', idx: 2 }, '', '/legal/privacy')
    window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }))
  })
  await expect(page.locator('[data-kiosk-screen="legal-doc"]')).toBeVisible()
  await markCurrentDocument(page, 'authenticated-legal-document')

  await page.waitForTimeout(HARD_PRIVACY_SETTLE_MS)

  expect(new URL(page.url()).pathname).toBe('/')
  expect(await readDocumentMarker(page)).toBeNull()
  expect(requests.logoutAuthorization()).toEqual([`Bearer ${MEMBER_TOKEN}`])
  await expect(page.getByRole('button', { name: /登录 \/ 注册/ })).toBeVisible()
})

test('anonymous interview state is hard-cleared and browser back cannot restore it @privacy-kiosk', async ({ page, api }) => {
  registerKioskShell(api)
  api.respond('GET', '/api/v1/mock-interviews/capabilities/voice', {
    status: 200,
    json: { success: true, data: { asrEnabled: false, ttsEnabled: false } },
  })
  const sensitiveQuestion = '隐私回归：请讲述上一位求职者的敏感项目经历。'
  const routeState = {
    sessionId: 'privacy-anonymous-session',
    accessToken: 'privacy-anonymous-access-token',
    questionTarget: 3,
    durationMin: 5,
    interviewerType: 'tech',
    position: '匿名隐私回归岗位',
    firstQuestion: sensitiveQuestion,
    firstQType: 'experience',
  }

  await page.goto('/')
  await page.evaluate(
    ({ state, keys }) => {
      window.history.pushState({ usr: state, key: 'privacy-interview', idx: 1 }, '', '/interview/session')
      keys.forEach((key, index) => window.sessionStorage.setItem(key, `sensitive-fixture-${index}`))
    },
    { state: routeState, keys: SENSITIVE_SESSION_KEYS },
  )
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByText(sensitiveQuestion, { exact: true })).toBeVisible()
  await markCurrentDocument(page, 'anonymous-interview-document')

  await page.waitForTimeout(HARD_PRIVACY_SETTLE_MS)

  expect.soft(new URL(page.url()).pathname).toBe('/')
  expect.soft(await readDocumentMarker(page)).toBeNull()
  const storedAfterDeadline = await page.evaluate(
    (keys) => keys.map((key) => window.sessionStorage.getItem(key)),
    SENSITIVE_SESSION_KEYS,
  )
  expect.soft(storedAfterDeadline).toEqual([null, null, null])

  await page.goBack({ waitUntil: 'domcontentloaded' })
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 1_000 }).toBe('/')
  await expect.soft(page.getByText(sensitiveQuestion, { exact: true })).toHaveCount(0)
  const storedAfterBack = await page.evaluate(
    (keys) => keys.map((key) => window.sessionStorage.getItem(key)),
    SENSITIVE_SESSION_KEYS,
  )
  expect.soft(storedAfterBack).toEqual([null, null, null])
})

test('older sensitive history entries are sanitized after a privacy boundary @privacy-kiosk', async ({ page, api }) => {
  registerKioskShell(api)
  api.respond('GET', '/api/v1/mock-interviews/capabilities/voice', {
    status: 200,
    json: { success: true, data: { asrEnabled: false, ttsEnabled: false } },
  })
  const olderQuestion = '历史隐私回归：不得恢复上一位求职者的项目经历。'
  const currentQuestion = '当前隐私回归：本页应先被硬清场。'
  const stateFor = (question: string, suffix: string) => ({
    sessionId: `privacy-history-${suffix}`,
    accessToken: `privacy-history-access-${suffix}`,
    questionTarget: 3,
    durationMin: 5,
    interviewerType: 'tech',
    position: `隐私历史岗位-${suffix}`,
    firstQuestion: question,
    firstQType: 'experience',
  })

  await page.goto('/')
  await page.evaluate(
    ({ older, current }) => {
      window.history.pushState({ usr: older, key: 'privacy-history-older', idx: 1 }, '', '/interview/session')
      window.history.pushState({ usr: current, key: 'privacy-history-current', idx: 2 }, '', '/interview/session')
    },
    { older: stateFor(olderQuestion, 'older'), current: stateFor(currentQuestion, 'current') },
  )
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByText(currentQuestion, { exact: true })).toBeVisible()

  await page.waitForTimeout(HARD_PRIVACY_SETTLE_MS)
  expect(new URL(page.url()).pathname).toBe('/')

  const backStartedAt = Date.now()
  await page.goBack({ waitUntil: 'domcontentloaded' })
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 1_000 }).toBe('/')
  expect(Date.now() - backStartedAt).toBeLessThan(1_500)
  await expect(page.getByText(olderQuestion, { exact: true })).toHaveCount(0)
  const restoredState = await page.evaluate(() => window.history.state as { usr?: { accessToken?: string } } | null)
  expect(restoredState?.usr?.accessToken).toBeUndefined()
})

test('privacy clear truncates sensitive forward history after the user went back @privacy-kiosk', async ({ page, api }) => {
  registerKioskShell(api)
  api.respond('GET', '/api/v1/mock-interviews/capabilities/voice', {
    status: 200,
    json: { success: true, data: { asrEnabled: false, ttsEnabled: false } },
  })
  const forwardQuestion = '前进历史回归：旧的未来页绝不能恢复。'
  const forwardState = {
    sessionId: 'privacy-forward-future',
    accessToken: 'privacy-forward-access-future',
    questionTarget: 3,
    durationMin: 5,
    interviewerType: 'tech',
    position: '前进历史岗位-future',
    firstQuestion: forwardQuestion,
    firstQType: 'experience',
  }

  await page.goto('/')
  await page.evaluate(
    ({ forward }) => {
      window.history.pushState({ usr: null, key: 'privacy-forward-current', idx: 1 }, '', '/interview/tips')
      window.history.pushState({ usr: forward, key: 'privacy-forward-future', idx: 2 }, '', '/interview/session')
    },
    { forward: forwardState },
  )
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByText(forwardQuestion, { exact: true })).toBeVisible()
  await page.goBack({ waitUntil: 'domcontentloaded' })
  await expect(page.locator('[data-kiosk-screen="interview-tips"]')).toBeVisible()

  await page.waitForTimeout(HARD_PRIVACY_SETTLE_MS)
  expect(new URL(page.url()).pathname).toBe('/')

  await page.goForward({ waitUntil: 'domcontentloaded' })
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 1_000 }).toBe('/')
  await expect(page.getByText(forwardQuestion, { exact: true })).toHaveCount(0)
  const restoredState = await page.evaluate(() => window.history.state as { usr?: { accessToken?: string } } | null)
  expect(restoredState?.usr?.accessToken).toBeUndefined()
})

test('privacy clear remains fail-closed when session storage rejects the boundary write @privacy-kiosk', async ({ page, api }) => {
  await page.addInitScript((boundaryKey) => {
    const originalSetItem = Storage.prototype.setItem
    Storage.prototype.setItem = function setItem(key: string, value: string): void {
      if (key === boundaryKey) {
        throw new DOMException('Boundary storage blocked by privacy policy', 'SecurityError')
      }
      originalSetItem.call(this, key, value)
    }
  }, 'ai-job-print:kiosk-privacy-boundary:v1')
  registerKioskShell(api)
  api.respond('GET', '/api/v1/mock-interviews/capabilities/voice', {
    status: 200,
    json: { success: true, data: { asrEnabled: false, ttsEnabled: false } },
  })
  const sensitiveQuestion = '存储故障回归：边界写失败也必须立即清场。'

  await page.goto('/')
  await page.evaluate(
    ({ question, keys }) => {
      window.history.pushState({ usr: null, key: 'privacy-screensaver-current', idx: 1 }, '', '/interview/tips')
      window.history.pushState({
        usr: {
          sessionId: 'privacy-storage-failure',
          accessToken: 'privacy-storage-failure-token',
          questionTarget: 3,
          durationMin: 5,
          interviewerType: 'tech',
          position: '存储故障隐私岗位',
          firstQuestion: question,
          firstQType: 'experience',
        },
        key: 'privacy-storage-failure',
        idx: 1,
      }, '', '/interview/session')
      keys.forEach((key, index) => window.sessionStorage.setItem(key, `storage-failure-sensitive-${index}`))
    },
    { question: sensitiveQuestion, keys: SENSITIVE_SESSION_KEYS },
  )
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByText(sensitiveQuestion, { exact: true })).toBeVisible()
  await markCurrentDocument(page, 'storage-failure-document')

  await page.waitForTimeout(HARD_PRIVACY_SETTLE_MS)

  expect(new URL(page.url()).pathname).toBe('/')
  expect(await readDocumentMarker(page)).toBeNull()
  const storedAfterDeadline = await page.evaluate(
    (keys) => keys.map((key) => window.sessionStorage.getItem(key)),
    SENSITIVE_SESSION_KEYS,
  )
  expect(storedAfterDeadline).toEqual([null, null, null])
  await page.evaluate(() => {
    window.name = 'external-origin-clobber-simulation'
  })
  await page.goBack({ waitUntil: 'domcontentloaded' })
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 1_000 }).toBe('/')
  await expect(page.getByText(sensitiveQuestion, { exact: true })).toHaveCount(0)
})

test('an unknown terminal route remains inside the privacy guard @privacy-kiosk', async ({ page, api }) => {
  const requests = await openAuthenticatedMemberReport(page, api)
  await page.evaluate(() => {
    window.history.pushState({ usr: null, key: 'privacy-unknown', idx: 2 }, '', '/privacy-unknown-route')
    window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }))
  })
  await expect(page.locator('[data-kiosk-screen="route-error"]')).toBeVisible()

  await page.waitForTimeout(HARD_PRIVACY_SETTLE_MS)

  expect(new URL(page.url()).pathname).toBe('/')
  expect(requests.logoutAuthorization()).toEqual([`Bearer ${MEMBER_TOKEN}`])
  await expect(page.getByRole('button', { name: /登录 \/ 注册/ })).toBeVisible()
})

test('hard clear stops active scan polling without cancelling the backend task @privacy-kiosk', async ({ page, api }) => {
  registerKioskShell(api)
  let pollRequests = 0
  let cancelRequests = 0
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname === `/api/v1/scan/sessions/${SCAN_TASK_ID}` && request.method() === 'DELETE') {
      cancelRequests += 1
    }
  })
  await routeExact(page, 'GET', `/api/v1/scan/sessions/${SCAN_TASK_ID}`, async (route) => {
    pollRequests += 1
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          scanTaskId: SCAN_TASK_ID,
          status: 'waiting',
          scanType: 'resume',
          file: null,
          errorCode: null,
          errorMessage: null,
          expiresAt: '2026-07-29T02:00:00.000Z',
        },
      }),
    })
  })

  await page.goto('/')
  await page.evaluate(
    ({ taskId, controlToken }) => {
      window.history.pushState(
        { usr: { scanTaskId: taskId, scanType: 'resume', controlToken }, key: 'privacy-scan', idx: 1 },
        '',
        '/scan/progress',
      )
    },
    { taskId: SCAN_TASK_ID, controlToken: SCAN_CONTROL_TOKEN },
  )
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByText('等待打印机端扫描完成', { exact: true })).toBeVisible()
  await expect.poll(() => pollRequests).toBeGreaterThan(0)
  await markCurrentDocument(page, 'scan-progress-document')

  await page.waitForTimeout(HARD_PRIVACY_SETTLE_MS)

  expect.soft(new URL(page.url()).pathname).toBe('/')
  expect.soft(await readDocumentMarker(page)).toBeNull()
  const pollsAfterClear = pollRequests
  await page.waitForTimeout(POLL_CLEANUP_OBSERVATION_MS)
  expect.soft(pollRequests).toBe(pollsAfterClear)
  expect(cancelRequests).toBe(0)
})

test('hard clear does not cancel a created scan settings session @privacy-kiosk', async ({ page, api }) => {
  registerKioskShell(api)
  let cancelRequests = 0
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname === `/api/v1/scan/sessions/${SCAN_TASK_ID}` && request.method() === 'DELETE') {
      cancelRequests += 1
    }
  })
  api.respond('POST', '/api/v1/scan/sessions', {
    status: 200,
    json: {
      success: true,
      data: {
        scanTaskId: SCAN_TASK_ID,
        controlToken: SCAN_CONTROL_TOKEN,
        status: 'waiting',
        scanType: 'resume',
        instructions: ['请在本机放好材料，并按设备面板指引开始扫描。'],
        expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      },
    },
  })
  api.respond('DELETE', `/api/v1/scan/sessions/${SCAN_TASK_ID}`, {
    status: 200,
    json: { success: true, data: { scanTaskId: SCAN_TASK_ID, status: 'cancelled' } },
  })

  await page.goto('/')
  await page.evaluate(() => {
    window.history.pushState(
      { usr: { scanType: 'resume' }, key: 'privacy-scan-settings', idx: 1 },
      '',
      '/scan/settings',
    )
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByText('扫描任务已创建', { exact: true })).toBeVisible()
  expect(cancelRequests).toBe(0)

  await page.waitForTimeout(HARD_PRIVACY_SETTLE_MS)

  expect.soft(new URL(page.url()).pathname).toBe('/')
  await page.waitForTimeout(300)
  expect(cancelRequests).toBe(0)
})

test('hard clear stops active print polling without cancelling the backend task @privacy-kiosk', async ({ page, api }) => {
  registerKioskShell(api)
  let pollRequests = 0
  let mutationRequests = 0
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname === `/api/v1/print/jobs/${PRINT_TASK_ID}` && request.method() !== 'GET') {
      mutationRequests += 1
    }
  })
  await routeExact(page, 'GET', `/api/v1/print/jobs/${PRINT_TASK_ID}`, async (route) => {
    pollRequests += 1
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ taskId: PRINT_TASK_ID, status: 'pending' }),
    })
  })

  await page.goto('/')
  await page.evaluate((taskId) => {
    window.history.pushState(
      { usr: { taskId, amountCents: 0 }, key: 'privacy-print', idx: 1 },
      '',
      '/print/progress',
    )
  }, PRINT_TASK_ID)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByText('任务已进入队列，终端尚未领取，请留在机器旁', { exact: true })).toBeVisible()
  await expect.poll(() => pollRequests).toBeGreaterThan(0)

  await page.waitForTimeout(HARD_PRIVACY_SETTLE_MS)

  expect.soft(new URL(page.url()).pathname).toBe('/')
  const pollsAfterClear = pollRequests
  await page.waitForTimeout(POLL_CLEANUP_OBSERVATION_MS)
  expect.soft(pollRequests).toBe(pollsAfterClear)
  expect(mutationRequests).toBe(0)
})

test('entering screensaver clears the session and establishes a history boundary @privacy-kiosk', async ({ page, api }) => {
  registerKioskShell(api)
  api.respond('GET', '/api/v1/terminals/KSK-001/screensaver', {
    status: 200,
    json: {
      enabled: true,
      idleTimeoutSec: 2,
      items: [{
        id: 'privacy-screensaver',
        type: 'image',
        url: 'https://privacy.invalid/screensaver.png',
        mimeType: 'image/png',
        durationSec: 30,
        sha256: 'privacy-screensaver-fixture',
      }],
    },
  })
  api.respond('GET', '/api/v1/mock-interviews/capabilities/voice', {
    status: 200,
    json: { success: true, data: { asrEnabled: false, ttsEnabled: false } },
  })
  const sensitiveQuestion = '屏保隐私回归：进入待机后不得恢复本页。'

  await page.goto('/')
  await page.evaluate(
    ({ question, keys }) => {
      window.history.pushState({
        usr: {
          sessionId: 'privacy-screensaver-session',
          accessToken: 'privacy-screensaver-access-token',
          questionTarget: 3,
          durationMin: 5,
          interviewerType: 'tech',
          position: '屏保隐私岗位',
          firstQuestion: question,
          firstQType: 'experience',
        },
        key: 'privacy-screensaver-route',
        idx: 2,
      }, '', '/interview/session')
      keys.forEach((key, index) => window.sessionStorage.setItem(key, `screensaver-sensitive-${index}`))
    },
    { question: sensitiveQuestion, keys: SENSITIVE_SESSION_KEYS },
  )
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByText(sensitiveQuestion, { exact: true })).toBeVisible()
  await page.goBack({ waitUntil: 'domcontentloaded' })

  await page.waitForURL((url) => url.pathname === '/screensaver', { timeout: 2_900 })
  await expect(page.locator('[data-kiosk-screen="screensaver"]')).toBeVisible()
  const storedOnScreensaver = await page.evaluate(
    (keys) => keys.map((key) => window.sessionStorage.getItem(key)),
    SENSITIVE_SESSION_KEYS,
  )
  expect(storedOnScreensaver).toEqual([null, null, null])

  await page.keyboard.press('Enter')
  await page.waitForURL((url) => url.pathname === '/')
  await page.goForward({ waitUntil: 'domcontentloaded' })
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 1_000 }).toBe('/')
  await expect(page.getByText(sensitiveQuestion, { exact: true })).toHaveCount(0)
  await page.goBack({ waitUntil: 'domcontentloaded' })
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 1_000 }).toBe('/')
  await expect(page.getByText(sensitiveQuestion, { exact: true })).toHaveCount(0)
})

test('returning to a visible tab immediately compensates for throttled privacy time @privacy-kiosk', async ({ page, api }) => {
  registerKioskShell(api)
  await page.goto('/')
  await markCurrentDocument(page, 'visibility-compensation-document')
  await page.evaluate((keys) => {
    keys.forEach((key, index) => window.sessionStorage.setItem(key, `visibility-sensitive-${index}`))
  }, SENSITIVE_SESSION_KEYS)

  await page.waitForTimeout(100)
  const reloaded = page.waitForEvent('framenavigated', (frame) => frame === page.mainFrame())
  await page.evaluate(() => {
    const realDateNow = Date.now.bind(Date)
    Object.defineProperty(Date, 'now', {
      configurable: true,
      value: () => realDateNow() + 4_000,
    })
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    })
    document.dispatchEvent(new Event('visibilitychange'))
  })

  await reloaded
  await page.waitForLoadState('domcontentloaded')
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 1_000 }).toBe('/')
  await expect.poll(async () => {
    try {
      return await readDocumentMarker(page)
    } catch {
      return 'navigation-in-progress'
    }
  }, { timeout: 2_000 }).toBeNull()
  const storedAfterVisibility = await page.evaluate(
    (keys) => keys.map((key) => window.sessionStorage.getItem(key)),
    SENSITIVE_SESSION_KEYS,
  )
  expect(storedAfterVisibility).toEqual([null, null, null])
})

test('a newer stored boundary overrides an older sanitized landing entry @privacy-kiosk', async ({ page, api }) => {
  registerKioskShell(api)
  api.respond('GET', '/api/v1/mock-interviews/capabilities/voice', {
    status: 200,
    json: { success: true, data: { asrEnabled: false, ttsEnabled: false } },
  })
  const sensitiveQuestion = '边界代次回归：旧 landing 不得放行更新边界之前的敏感页。'

  await page.goto('/')
  await page.evaluate((question) => {
    window.history.pushState({
      usr: null,
      key: 'privacy-old-landing',
      idx: 1,
      __kioskPrivacyBoundary: 'privacy-old-boundary',
      __kioskPrivacyBoundaryCreatedAt: 100,
    }, '', '/')
    window.history.pushState({
      usr: {
        sessionId: 'privacy-generation-future',
        accessToken: 'privacy-generation-future-token',
        questionTarget: 3,
        durationMin: 5,
        interviewerType: 'tech',
        position: '边界代次隐私岗位',
        firstQuestion: question,
        firstQType: 'experience',
      },
      key: 'privacy-generation-future',
      idx: 2,
    }, '', '/interview/session')
  }, sensitiveQuestion)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByText(sensitiveQuestion, { exact: true })).toBeVisible()
  await page.goBack({ waitUntil: 'domcontentloaded' })
  await page.evaluate(() => {
    window.sessionStorage.setItem('ai-job-print:kiosk-privacy-boundary:v1', JSON.stringify({
      token: 'privacy-newer-stored-boundary',
      minHistoryIndex: 3,
      createdAt: 200,
    }))
  })
  await page.reload({ waitUntil: 'domcontentloaded' })

  await expect.poll(async () => {
    try {
      const token = await page.evaluate(
        () => (window.history.state as { __kioskPrivacyBoundary?: string } | null)?.__kioskPrivacyBoundary ?? null,
      )
      return token !== null && token !== 'privacy-old-boundary'
    } catch {
      return false
    }
  }, { timeout: 1_500 }).toBe(true)
  await page.goForward({ waitUntil: 'domcontentloaded' })
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 1_000 }).toBe('/')
  await expect(page.getByText(sensitiveQuestion, { exact: true })).toHaveCount(0)
})

test('screensaver history metadata survives storage rejection and a screensaver refresh @privacy-kiosk', async ({ page, api }) => {
  await page.addInitScript(({ sessionKey, localKey, cookieKey }) => {
    const originalSetItem = Storage.prototype.setItem
    Storage.prototype.setItem = function setItem(key: string, value: string): void {
      if (key === sessionKey || key === localKey) {
        throw new DOMException('Boundary storage blocked by privacy policy', 'SecurityError')
      }
      originalSetItem.call(this, key, value)
    }
    const cookieDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie')
    if (cookieDescriptor?.get && cookieDescriptor.set) {
      Object.defineProperty(Document.prototype, 'cookie', {
        configurable: true,
        get: cookieDescriptor.get,
        set(value: string) {
          if (value.startsWith(`${cookieKey}=`)) {
            throw new DOMException('Boundary cookie blocked by privacy policy', 'SecurityError')
          }
          cookieDescriptor.set?.call(this, value)
        },
      })
    }
  }, {
    sessionKey: 'ai-job-print:kiosk-privacy-boundary:v1',
    localKey: 'ai-job-print:kiosk-privacy-boundary-fallback:v1',
    cookieKey: 'ai_job_print_kiosk_privacy_boundary_v1',
  })
  registerKioskShell(api)
  api.respond('GET', '/api/v1/terminals/KSK-001/screensaver', {
    status: 200,
    json: {
      enabled: true,
      idleTimeoutSec: 2,
      items: [{
        id: 'privacy-storage-rejected-screensaver',
        type: 'image',
        url: 'https://privacy.invalid/storage-rejected.png',
        mimeType: 'image/png',
        durationSec: 30,
        sha256: 'privacy-storage-rejected-screensaver',
      }],
    },
  })
  api.respond('GET', '/api/v1/mock-interviews/capabilities/voice', {
    status: 200,
    json: { success: true, data: { asrEnabled: false, ttsEnabled: false } },
  })
  const sensitiveQuestion = '屏保存储拒绝回归：刷新屏幕后也不得恢复本页。'

  await page.goto('/')
  await page.evaluate((question) => {
    window.history.pushState({
      usr: {
        sessionId: 'privacy-screen-storage-future',
        accessToken: 'privacy-screen-storage-future-token',
        questionTarget: 3,
        durationMin: 5,
        interviewerType: 'tech',
        position: '屏保存储拒绝岗位',
        firstQuestion: question,
        firstQType: 'experience',
      },
      key: 'privacy-screen-storage-future',
      idx: 1,
    }, '', '/interview/session')
  }, sensitiveQuestion)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByText(sensitiveQuestion, { exact: true })).toBeVisible()
  await page.waitForURL((url) => url.pathname === '/screensaver', { timeout: 2_900 })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.locator('[data-kiosk-screen="screensaver"]')).toBeVisible()

  await page.keyboard.press('Enter')
  await page.waitForURL((url) => url.pathname === '/')
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.goBack({ waitUntil: 'domcontentloaded' })
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 1_500 }).toBe('/')
  await expect(page.getByText(sensitiveQuestion, { exact: true })).toHaveCount(0)
})

test('a BFCache pageshow restore is fail-closed before reuse @privacy-kiosk', async ({ page, api }) => {
  registerKioskShell(api)
  await page.goto('/')
  await markCurrentDocument(page, 'bfcache-restored-document')
  await page.evaluate((keys) => {
    keys.forEach((key, index) => window.sessionStorage.setItem(key, `bfcache-sensitive-${index}`))
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
  }, SENSITIVE_SESSION_KEYS)

  await expect.poll(async () => {
    try {
      return await readDocumentMarker(page)
    } catch {
      return 'navigation-in-progress'
    }
  }, { timeout: 2_000 }).toBeNull()
  const storedAfterRestore = await page.evaluate(
    (keys) => keys.map((key) => window.sessionStorage.getItem(key)),
    SENSITIVE_SESSION_KEYS,
  )
  expect(storedAfterRestore).toEqual([null, null, null])
})

test('mobile QR login is exempt from the kiosk hard privacy deadline @privacy-mobile', async ({ page, api }) => {
  api.respond('GET', '/api/v1/member/auth/qr/privacy-mobile-ticket/status', {
    status: 200,
    json: {
      success: true,
      data: {
        status: 'pending',
        deviceLabel: '隐私回归一体机',
        returnTo: '/interview/reports',
        expiresInSeconds: 180,
      },
    },
  })
  await page.goto('/member/qr-login?ticketId=privacy-mobile-ticket')
  await expect(page.locator('main[data-kiosk-screen="member-qr-login"]')).toBeVisible()
  await markCurrentDocument(page, 'mobile-qr-document')

  await page.waitForTimeout(HARD_PRIVACY_SETTLE_MS)

  expect(new URL(page.url()).pathname).toBe('/member/qr-login')
  expect(await readDocumentMarker(page)).toBe('mobile-qr-document')
  await expect(page.getByText('手机确认登录', { exact: true })).toBeVisible()
})

test('phone upload is exempt from the kiosk hard privacy deadline @privacy-mobile', async ({ page }) => {
  await page.goto('/upload/phone')
  await expect(page.locator('main[data-kiosk-screen="phone-upload"]')).toBeVisible()
  await expect(page.getByText('上传链接已失效', { exact: true })).toBeVisible()
  await markCurrentDocument(page, 'phone-upload-document')

  await page.waitForTimeout(HARD_PRIVACY_SETTLE_MS)

  expect(new URL(page.url()).pathname).toBe('/upload/phone')
  expect(await readDocumentMarker(page)).toBe('phone-upload-document')
  await expect(page.getByText('上传链接已失效', { exact: true })).toBeVisible()
})
