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
const SCAN_OBSERVATION_MS = 3_000

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

interface ScanBusyRecorder {
  statusRequests: () => number
  deleteRequests: () => number
}

async function installScanProgressRoute(
  page: Page,
  options: ScanBusyOptions = {},
): Promise<ScanBusyRecorder> {
  // 每次新装一个 recorder 之前,先把上一个 endpoint handler 卸掉。每个测试用同一
  // 个 endpoint,如果不显式 unroute,多个 closure 会并存,后续 route.fulfill 的
  // 行为变得不可预测——recorder 计数也会跟着漂。直接清掉旧 handler 让本次
  // install 成为唯一所有者。
  await page.unroute(`**/api/v1/scan/sessions/${SCAN_TASK_ID}`).catch(() => undefined)

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

test('scan busy stays released when the scan task id is missing @scan-busy @warning-kiosk', async ({
  page,
  api,
}) => {
  registerKioskShell(api)
  await page.goto('/')
  await page.evaluate(
    ({ token }) => {
      window.history.pushState(
        { usr: { scanType: 'resume', controlToken: token }, key: 'scan-busy-missing-id', idx: 1 },
        '',
        '/scan/progress',
      )
    },
    { token: SCAN_CONTROL_TOKEN },
  )
  await page.reload({ waitUntil: 'domcontentloaded' })

  // 缺少 scanTaskId 时,组件第一时间 navigate('/scan/start');busy 的作用是
  // 抑制空闲警告(suppresses idle warning),不会拦截路由跳转。这条断言要
  // 证明的是:active===false 让 useBusyLock 退出 active 持锁分支,本页的
  // 隐私计时器能正常运行,/session-timeout 能在 3s 内弹。
  await expectWarningWithinThreeSeconds(page)
})

test('scan busy stays released when the scan control token is missing @scan-busy @warning-kiosk', async ({
  page,
  api,
}) => {
  registerKioskShell(api)
  await page.goto('/')
  await page.evaluate(
    ({ taskId }) => {
      window.history.pushState(
        { usr: { scanType: 'resume', scanTaskId: taskId }, key: 'scan-busy-missing-token', idx: 1 },
        '',
        '/scan/progress',
      )
    },
    { taskId: SCAN_TASK_ID },
  )
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

  // 3000ms 的观察窗口覆盖到至少一次完整 poll 周期,如果 lock 在中途失效,
  // /session-timeout 必然在这窗口内弹。窗口长度是回归测试粒度的选择,
  // 跟组件里 POLL_INTERVAL_MS=3000 没有一一对应关系。
  await expectNoWarningWithin(page, SCAN_OBSERVATION_MS)
  await expect(page).toHaveURL(/\/scan\/progress$/)
  await expect(page.getByText('等待打印机端扫描完成', { exact: true })).toBeVisible()
  expect(waitingCount.statusRequests()).toBeGreaterThanOrEqual(1)
  expect(waitingCount.deleteRequests()).toBe(0)

  // Switch the backend to 'processing'——这是 ScanSessionStatus 的合法 active
  // 取值,代表 Agent 端已经上传完成、正在后端生成 PDF。和后续 networkError
  // 分支对应的「服务端正常但本次 fetch 抛错,触发 scheduleNext 重试」是两条
  // 不同的执行路径,需要分别覆盖到。
  const processingCount = await installScanProgressRoute(page, {
    scanTaskId: SCAN_TASK_ID,
    controlToken: SCAN_CONTROL_TOKEN,
    status: 'processing',
  })
  await expectNoWarningWithin(page, SCAN_OBSERVATION_MS)
  await expect(page).toHaveURL(/\/scan\/progress$/)
  await expect(page.getByText('等待打印机端扫描完成', { exact: true })).toBeVisible()
  expect(processingCount.statusRequests()).toBeGreaterThanOrEqual(1)

  const networkRetryCount = await installScanProgressRoute(page, {
    scanTaskId: SCAN_TASK_ID,
    controlToken: SCAN_CONTROL_TOKEN,
    networkError: true,
  })
  await expectNoWarningWithin(page, SCAN_OBSERVATION_MS)
  await expect(page).toHaveURL(/\/scan\/progress$/)
  await expect(page.getByText('等待打印机端扫描完成', { exact: true })).toBeVisible()
  expect(networkRetryCount.statusRequests()).toBeGreaterThanOrEqual(1)
  expect(networkRetryCount.deleteRequests()).toBe(0)
})

test('completed poll status navigates to /scan/result without sending DELETE @scan-busy @warning-kiosk', async ({
  page,
  api,
}) => {
  registerKioskShell(api)
  const counts = await installScanProgressRoute(page, {
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
  await gotoScanProgressWithHistory(page, {
    scanTaskId: SCAN_TASK_ID,
    controlToken: SCAN_CONTROL_TOKEN,
  })
  await expect(page).toHaveURL(/\/scan\/result$/, { timeout: 6_000 })
  await expectWarningWithinThreeSeconds(page)
  // 终态由 poll 触发,页面走 unmount 而非 handleCancel,DELETE 不应被发送。
  expect(counts.deleteRequests()).toBe(0)
})

test('expired poll status navigates to /scan/result without sending DELETE @scan-busy @warning-kiosk', async ({
  page,
  api,
}) => {
  registerKioskShell(api)
  const counts = await installScanProgressRoute(page, {
    scanTaskId: SCAN_TASK_ID,
    controlToken: SCAN_CONTROL_TOKEN,
    status: 'expired',
  })
  await gotoScanProgressWithHistory(page, {
    scanTaskId: SCAN_TASK_ID,
    controlToken: SCAN_CONTROL_TOKEN,
  })
  await expect(page).toHaveURL(/\/scan\/result$/, { timeout: 6_000 })
  await expectWarningWithinThreeSeconds(page)
  expect(counts.deleteRequests()).toBe(0)
})

test('failed poll status navigates to /scan/result without sending DELETE @scan-busy @warning-kiosk', async ({
  page,
  api,
}) => {
  registerKioskShell(api)
  const counts = await installScanProgressRoute(page, {
    scanTaskId: SCAN_TASK_ID,
    controlToken: SCAN_CONTROL_TOKEN,
    status: 'failed',
  })
  await gotoScanProgressWithHistory(page, {
    scanTaskId: SCAN_TASK_ID,
    controlToken: SCAN_CONTROL_TOKEN,
  })
  await expect(page).toHaveURL(/\/scan\/result$/, { timeout: 6_000 })
  await expectWarningWithinThreeSeconds(page)
  expect(counts.deleteRequests()).toBe(0)
})

test('server-cancelled poll status navigates back to /scan/start without sending DELETE @scan-busy @warning-kiosk', async ({
  page,
  api,
}) => {
  registerKioskShell(api)
  const counts = await installScanProgressRoute(page, {
    scanTaskId: SCAN_TASK_ID,
    controlToken: SCAN_CONTROL_TOKEN,
    status: 'cancelled',
  })
  await gotoScanProgressWithHistory(page, {
    scanTaskId: SCAN_TASK_ID,
    controlToken: SCAN_CONTROL_TOKEN,
  })
  await expect(page).toHaveURL(/\/scan\/start$/, { timeout: 6_000 })
  await expectWarningWithinThreeSeconds(page)
  expect(counts.deleteRequests()).toBe(0)
})

test('explicit user cancel sends exactly one DELETE before navigating away @scan-busy @warning-kiosk', async ({
  page,
  api,
}) => {
  registerKioskShell(api)
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
  await expect.poll(() => cancelCounts.statusRequests()).toBeGreaterThanOrEqual(1)

  const deleteBefore = cancelCounts.deleteRequests()
  await page.getByRole('button', { name: '取消扫描', exact: true }).click()

  await expect(page).toHaveURL(/\/scan\/start$/, { timeout: 6_000 })
  await expectWarningWithinThreeSeconds(page)
  // 每次 install 都 unroute 旧 handler,所以 cancelCounts 严格只数这一次
  // install 内收到的 DELETE 流量;不需要再去手工减去历史基准。
  expect(cancelCounts.deleteRequests() - deleteBefore).toBe(1)
})
