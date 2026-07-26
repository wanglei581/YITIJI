import type { Page, Request, Route } from '@playwright/test'
import type { ApiRouter } from '../fixtures/api-router'
import { expect, test } from '../fixtures/kiosk-test'

const SCAN_TASK_ID = 'truth-scan-001'
const CONTROL_TOKEN = 'truth-control-token'
const LATER = new Date(Date.now() + 10 * 60 * 1000).toISOString()

function registerShell(api: ApiRouter): void {
  api.respond('GET', '/api/v1/terminals/KSK-001/screensaver', {
    status: 200,
    json: { enabled: false, idleTimeoutSec: 180, items: [] },
  })
  api.respond('GET', '/api/v1/terminals/KSK-001/printer-status', {
    status: 200,
    json: { printerStatus: 'ready', paperLevel: 'sufficient', isOnline: true },
  })
}

function registerLegacyReadyDevice(api: ApiRouter): void {
  api.respond('GET', '/api/v1/kiosk/device/status', {
    status: 200,
    json: { data: { scanner: { status: 'ready', online: true, busy: false } } },
  })
}

function countRequests(page: Page, method: string, path: string): () => number {
  let count = 0
  const listener = (request: Request) => {
    if (request.method() === method && new URL(request.url()).pathname === path) count += 1
  }
  page.on('request', listener)
  return () => count
}

function createdSession(instructions: string[] = ['服务端指引：第一步', '服务端指引：第二步']) {
  return {
    success: true,
    data: {
      scanTaskId: SCAN_TASK_ID,
      controlToken: CONTROL_TOKEN,
      status: 'waiting',
      scanType: 'resume',
      instructions,
      expiresAt: LATER,
    },
  }
}

async function fulfillCreatedSession(route: Route): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(createdSession()),
  })
}

async function enterSettingsFromVisibleStart(page: Page): Promise<void> {
  await page.goto('/scan/start')
  await page.getByRole('button', { name: /\u4e0b\u4e00\u6b65/ }).click()
  await page.waitForURL('**/scan/settings')
}

test('scan start does not probe a nonexistent device endpoint and carries explicit state @kiosk', async ({ page, api }) => {
  registerShell(api)
  const deviceRequests = countRequests(page, 'GET', '/api/v1/kiosk/device/status')
  api.respond('POST', '/api/v1/scan/sessions', {
    status: 503,
    json: { success: false, error: { code: 'SCAN_UNAVAILABLE', message: '\u626b\u63cf\u670d\u52a1\u6682\u4e0d\u53ef\u7528' } },
  })

  await page.goto('/scan/start')
  await expect(page.getByText('\u4e0b\u4e00\u6b65\u4f1a\u521b\u5efa\u771f\u5b9e\u626b\u63cf\u4f1a\u8bdd', { exact: false }).first()).toBeVisible()
  const next = page.getByRole('button', { name: /\u4e0b\u4e00\u6b65/ })
  await expect(next).toBeEnabled()
  expect(deviceRequests()).toBe(0)

  await next.click()
  await page.waitForURL('**/scan/settings')
  expect(await page.evaluate(() => window.history.state?.usr)).toMatchObject({ scanType: 'resume' })
})

test('direct scan settings access never posts a session @kiosk', async ({ page, api }) => {
  registerShell(api)
  const createRequests = countRequests(page, 'POST', '/api/v1/scan/sessions')

  await page.goto('/scan/settings')
  await expect(page.getByText('\u672a\u521b\u5efa\u626b\u63cf\u4efb\u52a1', { exact: true }).first()).toBeVisible()
  await expect(page.locator('footer').getByRole('button', { name: '\u5b89\u5168\u8fd4\u56de\u626b\u63cf\u9996\u9875' })).toBeVisible()
  await expect(page.getByText('\u4efb\u52a1\u7f16\u53f7', { exact: true })).toHaveCount(0)
  await expect(page.getByText('\u653e\u597d\u539f\u4ef6', { exact: true })).toHaveCount(0)
  await page.waitForTimeout(300)
  expect(createRequests()).toBe(0)
})

test('creation failure shows no created state, task metadata, or operation steps @kiosk', async ({ page, api }) => {
  registerShell(api)
  registerLegacyReadyDevice(api)
  const createRequests = countRequests(page, 'POST', '/api/v1/scan/sessions')
  api.respond('POST', '/api/v1/scan/sessions', {
    status: 503,
    json: { success: false, error: { code: 'SCAN_UNAVAILABLE', message: '\u626b\u63cf\u670d\u52a1\u6682\u4e0d\u53ef\u7528' } },
  })

  await enterSettingsFromVisibleStart(page)
  await expect(page.getByText('\u626b\u63cf\u4efb\u52a1\u672a\u521b\u5efa', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('\u626b\u63cf\u4efb\u52a1\u5df2\u521b\u5efa', { exact: true })).toHaveCount(0)
  await expect(page.getByText('\u4efb\u52a1\u7f16\u53f7', { exact: true })).toHaveCount(0)
  await expect(page.getByText('\u653e\u597d\u539f\u4ef6', { exact: true })).toHaveCount(0)
  await expect(page.locator('footer').getByRole('button', { name: '\u5b89\u5168\u8fd4\u56de\u626b\u63cf\u9996\u9875' })).toBeVisible()
  expect(createRequests()).toBe(1)
})

test('unknown network outcome is not retried automatically @kiosk', async ({ page, api }) => {
  registerShell(api)
  registerLegacyReadyDevice(api)
  const createRequests = countRequests(page, 'POST', '/api/v1/scan/sessions')
  api.abort('POST', '/api/v1/scan/sessions', 'internetdisconnected')

  await enterSettingsFromVisibleStart(page)
  await expect(page.getByText('\u65e0\u6cd5\u786e\u8ba4\u626b\u63cf\u4efb\u52a1\u72b6\u6001', { exact: true }).first()).toBeVisible()
  await page.waitForTimeout(1_200)
  expect(createRequests()).toBe(1)
  await expect(page.getByRole('button', { name: /\u91cd\u8bd5|\u91cd\u65b0\u521b\u5efa/ })).toHaveCount(0)
})

test('success renders only server instructions and creates and cancels once in StrictMode @kiosk', async ({ page, api }) => {
  registerShell(api)
  registerLegacyReadyDevice(api)
  const createRequests = countRequests(page, 'POST', '/api/v1/scan/sessions')
  const cancelRequests = countRequests(page, 'DELETE', `/api/v1/scan/sessions/${SCAN_TASK_ID}`)
  api.respond('POST', '/api/v1/scan/sessions', {
    status: 200,
    json: createdSession(),
  })
  api.respond('DELETE', `/api/v1/scan/sessions/${SCAN_TASK_ID}`, {
    status: 200,
    json: { success: true, data: { scanTaskId: SCAN_TASK_ID, status: 'cancelled' } },
  })

  await enterSettingsFromVisibleStart(page)
  await expect(page.getByText('\u670d\u52a1\u7aef\u6307\u5f15\uff1a\u7b2c\u4e00\u6b65', { exact: true })).toBeVisible()
  await expect(page.getByText('\u670d\u52a1\u7aef\u6307\u5f15\uff1a\u7b2c\u4e8c\u6b65', { exact: true })).toBeVisible()
  await expect(page.getByText('\u653e\u597d\u539f\u4ef6', { exact: true })).toHaveCount(0)
  await expect(page.getByText(SCAN_TASK_ID, { exact: true })).toBeVisible()
  await expect(page.getByText('\u626b\u63cf\u4efb\u52a1\u5df2\u521b\u5efa', { exact: true })).toBeVisible()
  expect(createRequests()).toBe(1)
  const persistedControlToken = await page.evaluate((token) => {
    const values = (storage: Storage) => Array.from({ length: storage.length }, (_, index) => {
      const key = storage.key(index)
      return key === null ? null : storage.getItem(key)
    })
    return [...values(window.localStorage), ...values(window.sessionStorage)]
      .some((value) => value?.includes(token))
  }, CONTROL_TOKEN)
  expect(persistedControlToken).toBe(false)

  await page.getByRole('button', { name: '\u8fd4\u56de\uff08\u53d6\u6d88\u4efb\u52a1\uff09' }).click()
  await page.waitForURL('**/scan/start')
  await expect.poll(cancelRequests).toBe(1)
})

test('a session that expires while visible is cancelled and can no longer continue @kiosk', async ({ page, api }) => {
  registerShell(api)
  const cancelRequests = countRequests(page, 'DELETE', `/api/v1/scan/sessions/${SCAN_TASK_ID}`)
  api.respond('POST', '/api/v1/scan/sessions', {
    status: 200,
    json: {
      ...createdSession(),
      data: {
        ...createdSession().data,
        expiresAt: new Date(Date.now() + 1_500).toISOString(),
      },
    },
  })
  api.respond('DELETE', `/api/v1/scan/sessions/${SCAN_TASK_ID}`, {
    status: 200,
    json: { success: true, data: { scanTaskId: SCAN_TASK_ID, status: 'cancelled' } },
  })

  await enterSettingsFromVisibleStart(page)
  await expect(page.getByText('扫描任务已创建', { exact: true })).toBeVisible()
  await expect(page.getByText('扫描会话已过期', { exact: true }).first()).toBeVisible({ timeout: 5_000 })
  await expect(page.getByRole('button', { name: '我已操作，开始等待' })).toHaveCount(0)
  await expect.poll(cancelRequests).toBe(1)
})

test('a malformed success without a control token stays in the safe error state @kiosk', async ({ page, api }) => {
  registerShell(api)
  registerLegacyReadyDevice(api)
  api.respond('POST', '/api/v1/scan/sessions', {
    status: 200,
    json: {
      success: true,
      data: {
        scanTaskId: SCAN_TASK_ID,
        controlToken: '',
        status: 'waiting',
        scanType: 'resume',
        instructions: ['\u4e0d\u5e94\u663e\u793a\u7684\u670d\u52a1\u7aef\u6307\u5f15'],
        expiresAt: LATER,
      },
    },
  })

  await enterSettingsFromVisibleStart(page)
  await expect(page.getByText('\u626b\u63cf\u4efb\u52a1\u672a\u521b\u5efa', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('\u4e0d\u5e94\u663e\u793a\u7684\u670d\u52a1\u7aef\u6307\u5f15', { exact: true })).toHaveCount(0)
  await expect(page.getByText(SCAN_TASK_ID, { exact: true })).toHaveCount(0)
})

test('a malformed created session with cancellation credentials is cleaned up once @kiosk', async ({ page, api }) => {
  registerShell(api)
  const cancelRequests = countRequests(page, 'DELETE', `/api/v1/scan/sessions/${SCAN_TASK_ID}`)
  api.respond('POST', '/api/v1/scan/sessions', {
    status: 200,
    json: createdSession([]),
  })
  api.respond('DELETE', `/api/v1/scan/sessions/${SCAN_TASK_ID}`, {
    status: 200,
    json: { success: true, data: { scanTaskId: SCAN_TASK_ID, status: 'cancelled' } },
  })

  await enterSettingsFromVisibleStart(page)
  await expect(page.getByText('\u626b\u63cf\u4efb\u52a1\u672a\u521b\u5efa', { exact: true }).first()).toBeVisible()
  await expect(page.getByText(SCAN_TASK_ID, { exact: true })).toHaveCount(0)
  await expect.poll(cancelRequests).toBe(1)
})

test('leaving while creation is in flight cancels the late-created session once @kiosk', async ({ page, api }) => {
  registerShell(api)
  const cancelRequests = countRequests(page, 'DELETE', `/api/v1/scan/sessions/${SCAN_TASK_ID}`)
  api.respond('DELETE', `/api/v1/scan/sessions/${SCAN_TASK_ID}`, {
    status: 200,
    json: { success: true, data: { scanTaskId: SCAN_TASK_ID, status: 'cancelled' } },
  })

  let markCreateReceived: (() => void) | undefined
  const createReceived = new Promise<void>((resolve) => { markCreateReceived = resolve })
  let releaseCreate: (() => void) | undefined
  const createReleased = new Promise<void>((resolve) => { releaseCreate = resolve })
  await page.route('**/api/v1/scan/sessions', async (route) => {
    const request = route.request()
    if (request.method() !== 'POST' || new URL(request.url()).pathname !== '/api/v1/scan/sessions') {
      await route.fallback()
      return
    }
    markCreateReceived?.()
    await createReleased
    await fulfillCreatedSession(route)
  })

  await page.goto('/scan/start')
  await page.getByRole('button', { name: /\u4e0b\u4e00\u6b65/ }).click()
  await createReceived
  await page.getByRole('button', { name: '\u5b89\u5168\u8fd4\u56de\u626b\u63cf\u9996\u9875' }).first().click()
  await page.waitForURL('**/scan/start')
  releaseCreate?.()
  await expect.poll(cancelRequests).toBe(1)
})
