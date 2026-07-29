import type { Page } from '@playwright/test'
import type { ApiRouter } from '../fixtures/api-router'
import { expect, test } from '../fixtures/kiosk-test'

const SENSITIVE_SESSION_KEY = 'ai-job-print:current-ai-resume'

interface KioskShellOptions {
  screensaverEnabled?: boolean
  idleTimeoutSec?: number
}

function registerKioskShell(api: ApiRouter, options: KioskShellOptions = {}): void {
  const enabled = options.screensaverEnabled ?? false
  const idleTimeoutSec = options.idleTimeoutSec ?? 4

  api.respond('GET', '/api/v1/terminals/KSK-001/screensaver', {
    status: 200,
    json: {
      enabled,
      idleTimeoutSec,
      items: enabled
        ? [
            {
              id: 'warning-screensaver',
              type: 'image',
              url: 'https://warning.invalid/screensaver.png',
              mimeType: 'image/png',
              durationSec: 30,
              sha256: 'warning-screen-fixture',
            },
          ]
        : [],
    },
  })
  api.respond('GET', '/api/v1/terminals/KSK-001/printer-status', {
    status: 200,
    json: { printerStatus: 'ready', paperLevel: 'sufficient', isOnline: true },
  })
  api.respond('GET', '/api/v1/terminals/KSK-001/capabilities', {
    status: 200,
    json: { capabilities: [] },
  })
  api.respond('GET', '/api/v1/terminals/KSK-001/config', {
    status: 200,
    json: {
      smartCampus: { enabled: false, modules: {}, items: [] },
      toolbox: { enabled: false, items: [] },
      configVersion: 'warning-browser-fixture',
      refreshIntervalMs: 300_000,
      serverTime: '2026-07-29T00:00:00.000Z',
    },
  })
}

async function expectWarningWithinThreeSeconds(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/session-timeout$/, { timeout: 3_000 })
  await expect(page.getByRole('heading', { name: '还在使用吗？', exact: true })).toBeVisible()
}

test('hardware warning tells anonymous users that background work continues without recovery', async ({
  page,
  api,
}) => {
  registerKioskShell(api, { screensaverEnabled: false })
  await page.goto('/scan/start')
  await expect(page).toHaveURL(/\/scan\/start$/)

  // Assert real page rendered (not a wildcard error page)
  await expect(page.getByRole('heading', { name: '材料扫描' })).toBeVisible()
  await expect(
    page.getByText('请先选择扫描类型；本页尚未创建任务。下一步会创建真实扫描会话')
  ).toBeVisible()

  await expectWarningWithinThreeSeconds(page)
  await expect(
    page.getByText('已创建的打印/扫描任务会继续运行，终端页面将清除', { exact: true })
  ).toBeVisible()
  await expect(page.getByText('匿名任务退出后无法恢复', { exact: true })).toBeVisible()
  await expect(page.getByText(/已保存到.*我的|可恢复/)).toHaveCount(0)

  // anonymous users must not see login-related labels
  await expect(page.getByText('当前登录', { exact: false })).toHaveCount(0)
  await expect(page.getByText('登录状态', { exact: false })).toHaveCount(0)
  await expect(page.getByText('退出账号', { exact: false })).toHaveCount(0)
  await expect(page.getByText('下次需重新验证', { exact: false })).toHaveCount(0)

  // anonymous branch shows session-appropriate labels
  await expect(page.getByText('当前会话：', { exact: false })).toBeVisible()
  await expect(page.getByText('匿名使用', { exact: false })).toBeVisible()
  await expect(page.getByText('清除本次匿名会话', { exact: false })).toBeVisible()
})

test('ordinary idle warns before clearing and can resume the previous route', async ({
  page,
  api,
}) => {
  registerKioskShell(api)
  await page.goto('/interview/tips')
  await expect(page).toHaveURL(/\/interview\/tips$/)

  await expectWarningWithinThreeSeconds(page)
  await expect(page.getByText('未保存的填写内容或练习内容会清除', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '继续使用', exact: true }).click()

  await expect(page).toHaveURL(/\/interview\/tips$/)
})

test('warning keeps sensitive history state only on the original adjacent entry', async ({
  page,
  api,
}) => {
  registerKioskShell(api)
  await page.goto('/interview/tips')
  await expect(page).toHaveURL(/\/interview\/tips$/)
  await page.evaluate(() => {
    window.history.replaceState(
      {
        ...window.history.state,
        usr: { accessToken: 'must-stay-on-original-entry' },
      },
      ''
    )
  })

  await expectWarningWithinThreeSeconds(page)
  expect(await page.evaluate(() => window.history.state?.usr ?? null)).toBeNull()

  await page.getByRole('button', { name: '继续使用', exact: true }).click()
  await expect(page).toHaveURL(/\/interview\/tips$/)
  expect(await page.evaluate(() => window.history.state?.usr?.accessToken ?? null)).toBe(
    'must-stay-on-original-entry'
  )
})

test('warning expiry clears sensitive session state and returns home', async ({ page, api }) => {
  registerKioskShell(api)
  await page.goto('/interview/tips')
  await page.evaluate(({ key, value }) => window.sessionStorage.setItem(key, value), {
    key: SENSITIVE_SESSION_KEY,
    value: 'sensitive',
  })

  await expectWarningWithinThreeSeconds(page)
  await expect(page).toHaveURL('http://127.0.0.1:4188/', { timeout: 3_500 })
  await expect
    .poll(() => page.evaluate((key) => window.sessionStorage.getItem(key), SENSITIVE_SESSION_KEY))
    .toBeNull()
})

test('screensaver idle warns before expiry and wakes to a clean homepage', async ({
  page,
  api,
}) => {
  registerKioskShell(api, { screensaverEnabled: true, idleTimeoutSec: 4 })
  await page.goto('/interview/tips')
  await expect(page).toHaveURL(/\/interview\/tips$/)

  await expectWarningWithinThreeSeconds(page)
  await expect(page).toHaveURL(/\/screensaver$/, { timeout: 3_500 })
  await expect(page.locator('[data-kiosk-screen="screensaver"]')).toBeVisible()
  await page.keyboard.press('Enter')

  await expect(page).toHaveURL('http://127.0.0.1:4188/')
})

test('session warning actions remain touch-safe without horizontal overflow', async ({
  page,
  api,
}) => {
  registerKioskShell(api)
  await page.goto('/interview/tips')
  await expect(page).toHaveURL(/\/interview\/tips$/)

  await expectWarningWithinThreeSeconds(page)

  const continueButton = page.getByRole('button', { name: '继续使用', exact: true })
  const exitButton = page.getByRole('button', { name: '立即退出并清除本机会话', exact: true })
  await expect(continueButton).toBeVisible()
  await expect(exitButton).toBeVisible()

  expect(
    await continueButton.evaluate((element) => element.getBoundingClientRect().height)
  ).toBeGreaterThanOrEqual(72)
  expect(
    await exitButton.evaluate((element) => element.getBoundingClientRect().height)
  ).toBeGreaterThanOrEqual(72)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  )
})

test('refreshing a warning fails closed instead of restoring the previous task', async ({
  page,
  api,
}) => {
  registerKioskShell(api)
  await page.goto('/interview/tips')
  await page.evaluate(({ key, value }) => window.sessionStorage.setItem(key, value), {
    key: SENSITIVE_SESSION_KEY,
    value: 'refresh-sensitive',
  })

  await expectWarningWithinThreeSeconds(page)
  await page.reload({ waitUntil: 'domcontentloaded' })

  await expect(page).toHaveURL('http://127.0.0.1:4188/', { timeout: 3_500 })
  await expect
    .poll(() => page.evaluate((key) => window.sessionStorage.getItem(key), SENSITIVE_SESSION_KEY))
    .toBeNull()
  await expect(page.getByText('未保存的填写内容或练习内容会清除', { exact: true })).toHaveCount(0)
})

test('immediate exit hard-clears the session and blocks back-forward task recovery', async ({
  page,
  api,
}) => {
  registerKioskShell(api)
  await page.goto('/interview/tips')
  await page.evaluate(({ key, value }) => window.sessionStorage.setItem(key, value), {
    key: SENSITIVE_SESSION_KEY,
    value: 'exit-sensitive',
  })

  await expectWarningWithinThreeSeconds(page)
  await page.getByRole('button', { name: '立即退出并清除本机会话', exact: true }).click()

  await expect(page).toHaveURL('http://127.0.0.1:4188/', { timeout: 3_500 })
  await expect
    .poll(() => page.evaluate((key) => window.sessionStorage.getItem(key), SENSITIVE_SESSION_KEY))
    .toBeNull()

  await page.goBack({ waitUntil: 'domcontentloaded' })
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 1_500 }).toBe('/')
  await expect(page.locator('[data-kiosk-screen="interview-tips"]')).toHaveCount(0)

  await page.goForward({ waitUntil: 'domcontentloaded' })
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 1_500 }).toBe('/')
  await expect(page.locator('[data-kiosk-screen="interview-tips"]')).toHaveCount(0)
})

const SCAN_TASK_ID = 'scan-busy-task'
const SCAN_CONTROL_TOKEN = 'scan-busy-control-token'
const SCAN_OBSERVATION_MS = 6_000

interface ScanBusyOptions {
  scanTaskId?: string
  controlToken?: string
  status?: 'waiting' | 'processing' | 'completed' | 'expired' | 'failed' | 'cancelled'
  networkError?: boolean
  resultFile?: {
    fileId: string
    fileUrl: string
    filename: string
    sizeBytes: number
    mimeType: string
  }
}

async function installScanProgressRoute(
  page: Page,
  options: ScanBusyOptions = {},
): Promise<{ statusRequests: () => number; deleteRequests: () => number }> {
  let statusReq = 0
  let deleteReq = 0
  await page.route(`**/api/v1/scan/sessions/${SCAN_TASK_ID}`, async (route) => {
    const request = route.request()
    if (request.method() === 'DELETE') {
      deleteReq += 1
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: { scanTaskId: SCAN_TASK_ID, status: 'cancelled' },
        }),
      })
      return
    }
    if (request.method() !== 'GET') {
      await route.fallback()
      return
    }
    statusReq += 1
    if (options.networkError) {
      await route.abort('internetdisconnected')
      return
    }
    const status = options.status ?? 'waiting'
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          scanTaskId: SCAN_TASK_ID,
          scanType: 'resume',
          status,
          file: status === 'completed' ? options.resultFile ?? null : null,
          errorCode: null,
          errorMessage: null,
          expiresAt: '2026-07-29T02:00:00.000Z',
        },
      }),
    })
  })
  return {
    statusRequests: () => statusReq,
    deleteRequests: () => deleteReq,
  }
}

async function gotoScanProgressWithHistory(
  page: Page,
  options: ScanBusyOptions,
): Promise<void> {
  await page.goto('/')
  await page.evaluate(
    ({ state }) => {
      window.history.pushState({ usr: state, key: 'scan-busy-route', idx: 1 }, '', '/scan/progress')
    },
    {
      state: {
        scanTaskId: options.scanTaskId,
        scanType: 'resume',
        controlToken: options.controlToken,
      },
    },
  )
  await page.reload({ waitUntil: 'domcontentloaded' })
}

async function expectNoWarningWithin(
  page: Page,
  ms: number,
): Promise<void> {
  await page.waitForTimeout(ms)
  await expect(page).not.toHaveURL(/\/session-timeout$/)
  await expect(page.getByRole('heading', { name: '还在使用吗？', exact: true })).toHaveCount(0)
}

test('scan busy stays released when the scan identity is missing @scan-busy @warning-kiosk', async ({
  page,
  api,
}) => {
  registerKioskShell(api)
  await page.evaluate(() => undefined)

  await page.goto('/')
  await page.evaluate(() => {
    window.history.pushState(
      { usr: { scanType: 'resume' }, key: 'scan-busy-missing', idx: 1 },
      '',
      '/scan/progress',
    )
  })
  await page.reload({ waitUntil: 'domcontentloaded' })

  await expectWarningWithinThreeSeconds(page)
})

test('scan busy blocks the idle warning while polling is waiting, processing, or retrying @scan-busy @warning-kiosk', async ({
  page,
  api,
}) => {
  registerKioskShell(api)

  const waitingCount = await installScanProgressRoute(page, {
    scanTaskId: SCAN_TASK_ID,
    controlToken: SCAN_CONTROL_TOKEN,
    status: 'waiting',
  })
  await gotoScanProgressWithHistory(page, {
    scanTaskId: SCAN_TASK_ID,
    controlToken: SCAN_CONTROL_TOKEN,
  })
  await expect(page.getByText('等待打印机端扫描完成', { exact: true })).toBeVisible()
  await expect.poll(() => waitingCount.statusRequests()).toBeGreaterThanOrEqual(1)

  await expectNoWarningWithin(page, SCAN_OBSERVATION_MS)
  expect(waitingCount.statusRequests()).toBeGreaterThanOrEqual(2)
  expect(waitingCount.deleteRequests()).toBe(0)

  // Switch the backend to a 5xx-equivalent status path that mirrors the network retry branch,
  // and confirm the busy lock still blocks the warning while poll() schedules the next attempt.
  const processingCount = await installScanProgressRoute(page, {
    scanTaskId: SCAN_TASK_ID,
    controlToken: SCAN_CONTROL_TOKEN,
    status: 'processing',
  })
  await expectNoWarningWithin(page, SCAN_OBSERVATION_MS)
  expect(processingCount.statusRequests()).toBeGreaterThanOrEqual(1)

  const networkRetryCount = await installScanProgressRoute(page, {
    scanTaskId: SCAN_TASK_ID,
    controlToken: SCAN_CONTROL_TOKEN,
    networkError: true,
  })
  await expectNoWarningWithin(page, SCAN_OBSERVATION_MS)
  expect(networkRetryCount.statusRequests()).toBeGreaterThanOrEqual(1)
  expect(networkRetryCount.deleteRequests()).toBe(0)
})

test('scan busy releases before navigating away on terminal status or user cancel @scan-busy @warning-kiosk', async ({
  page,
  api,
}) => {
  registerKioskShell(api)
  const counts = await installScanProgressRoute(page, {
    scanTaskId: SCAN_TASK_ID,
    controlToken: SCAN_CONTROL_TOKEN,
    status: 'waiting',
    resultFile: {
      fileId: 'scan-busy-result-file',
      fileUrl: 'https://scan-busy.invalid/result.pdf',
      filename: 'scan-busy-result.pdf',
      sizeBytes: 4096,
      mimeType: 'application/pdf',
    },
  })
  await gotoScanProgressWithHistory(page, {
    scanTaskId: SCAN_TASK_ID,
    controlToken: SCAN_CONTROL_TOKEN,
  })
  await expect(page.getByText('等待打印机端扫描完成', { exact: true })).toBeVisible()
  await expect.poll(() => counts.statusRequests()).toBeGreaterThanOrEqual(1)

  await installScanProgressRoute(page, {
    scanTaskId: SCAN_TASK_ID,
    controlToken: SCAN_CONTROL_TOKEN,
    status: 'completed',
    resultFile: {
      fileId: 'scan-busy-result-file',
      fileUrl: 'https://scan-busy.invalid/result.pdf',
      filename: 'scan-busy-result.pdf',
      sizeBytes: 4096,
      mimeType: 'application/pdf',
    },
  })
  await expect(page).toHaveURL(/\/scan\/result$/, { timeout: 6_000 })
  // Once we land on the result page the busy lock has been released by the time of navigate,
  // so the next idle window on the destination should surface the ordinary warning.
  await expectWarningWithinThreeSeconds(page)
  expect(counts.deleteRequests()).toBe(0)

  await page.goto('http://127.0.0.1:4188/')
  const cancelCounts = await installScanProgressRoute(page, {
    scanTaskId: SCAN_TASK_ID,
    controlToken: SCAN_CONTROL_TOKEN,
    status: 'waiting',
  })
  await gotoScanProgressWithHistory(page, {
    scanTaskId: SCAN_TASK_ID,
    controlToken: SCAN_CONTROL_TOKEN,
  })
  await expect(page.getByText('等待打印机端扫描完成', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '取消扫描', exact: true }).click()

  await expect(page).toHaveURL(/\/scan\/start$/, { timeout: 6_000 })
  await expectWarningWithinThreeSeconds(page)
  expect(cancelCounts.deleteRequests()).toBeGreaterThanOrEqual(1)
})
