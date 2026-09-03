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
  api.respond('GET', '/api/v1/job-fairs', {
    status: 200,
    json: {
      success: true,
      data: [],
      pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
    },
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

async function readSensitiveSession(page: Page): Promise<string | null | undefined> {
  try {
    return await page.evaluate((key) => window.sessionStorage.getItem(key), SENSITIVE_SESSION_KEY)
  } catch (error) {
    // The hard-clear contract deliberately reloads the document. A navigation can
    // begin between a URL assertion and evaluate; retry once its new context exists.
    if (error instanceof Error && error.message.includes('Execution context was destroyed')) return undefined
    throw error
  }
}

async function expectSensitiveSessionCleared(page: Page): Promise<void> {
  await expect.poll(() => readSensitiveSession(page)).toBeNull()
}

const MEMBER_PHONE = '13800138000'
const MEMBER_CODE = '123456'

function registerMemberLogin(api: ApiRouter): void {
  // 登录后首页会拉「我的」摘要；给不含身份细节的空列表即可，倒计时断言不依赖其内容。
  for (const path of ['/api/v1/me/favorites', '/api/v1/me/print-orders', '/api/v1/me/resumes']) {
    api.respond('GET', path, {
      status: 200,
      json: { success: true, data: { items: [], nextCursor: null, total: 0 } },
    })
  }
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
        token: 'standby-member-token',
        user: { id: 'standby-member', phoneMasked: '138****8000', nickname: '待机回归会员' },
      },
    },
  })
}

async function loginThroughVisibleUi(page: Page, returnTo: string): Promise<void> {
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
  await expectSensitiveSessionCleared(page)
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
  await expectSensitiveSessionCleared(page)
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
  await expectSensitiveSessionCleared(page)

  await page.goBack({ waitUntil: 'domcontentloaded' })
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 1_500 }).toBe('/')
  await expect(page.locator('[data-kiosk-screen="interview-tips"]')).toHaveCount(0)

  await page.goForward({ waitUntil: 'domcontentloaded' })
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 1_500 }).toBe('/')
  await expect(page.locator('[data-kiosk-screen="interview-tips"]')).toHaveCount(0)
})

test('screensaver-mode immediate exit always hard-clears and never falls into the screensaver route @warning-kiosk', async ({
  page,
  api,
}) => {
  registerKioskShell(api, { screensaverEnabled: true, idleTimeoutSec: 4 })
  await page.goto('/interview/tips')
  await expect(page).toHaveURL(/\/interview\/tips$/)
  await page.evaluate(({ key, value }) => window.sessionStorage.setItem(key, value), {
    key: SENSITIVE_SESSION_KEY,
    value: 'screensaver-exit-sensitive',
  })

  await expectWarningWithinThreeSeconds(page)
  // 屏保模式预警倒计时自然结束应进 /screensaver,但用户点击"立即退出并清除本机会话"
  // 必须立即 hardClear 回干净首页——按钮共享倒计时动作会把用户带进屏保。
  await page.getByRole('button', { name: '立即退出并清除本机会话', exact: true }).click()

  await expect(page).toHaveURL('http://127.0.0.1:4188/', { timeout: 3_500 })
  await expectSensitiveSessionCleared(page)
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 1_500 }).toBe('/')
  await expect(page.locator('[data-kiosk-screen="screensaver"]')).toHaveCount(0)
  await expect(page.locator('[data-kiosk-screen="session-timeout"]')).toHaveCount(0)
})

test('orphan /session-timeout shows the clearing overlay on first frame and never renders the warning page DOM @warning-kiosk', async ({
  page,
  api,
}) => {
  registerKioskShell(api)

  // addInitScript 会在 hard reload(window.location.reload)后再次执行,startObserver
  // 必须先从 sessionStorage 读回已有的聚合快照并在此基础上继续合并,而不是清空后重
  // 写——否则 hardClear 触发的 reload 会把首帧的 overlay 证据抹掉。每次 MutationObserver
  // 回调都把"是否见过 Overlay"和"是否见过 SessionTimeoutPage 的 PII"取 max 后落盘,
  // 跨导航 / 跨 reload 单调累积,测试在最终导航落地后从 sessionStorage 读回结论。
  await page.addInitScript(() => {
    const STORAGE_KEY = 'kiosk-orphan-snapshot:v1'
    type OrphanSnapshot = {
      sessionCount: number
      headingCount: number
      exitButtonCount: number
      continueButtonCount: number
      accountLabelCount: number
      clearingCount: number
    }
    const empty: OrphanSnapshot = {
      sessionCount: 0,
      headingCount: 0,
      exitButtonCount: 0,
      continueButtonCount: 0,
      accountLabelCount: 0,
      clearingCount: 0,
    }
    const readAggregate = (): OrphanSnapshot => {
      try {
        const raw = window.sessionStorage.getItem(STORAGE_KEY)
        if (!raw) return { ...empty }
        const parsed = JSON.parse(raw) as Partial<OrphanSnapshot>
        return {
          sessionCount: typeof parsed.sessionCount === 'number' ? parsed.sessionCount : 0,
          headingCount: typeof parsed.headingCount === 'number' ? parsed.headingCount : 0,
          exitButtonCount:
            typeof parsed.exitButtonCount === 'number' ? parsed.exitButtonCount : 0,
          continueButtonCount:
            typeof parsed.continueButtonCount === 'number' ? parsed.continueButtonCount : 0,
          accountLabelCount:
            typeof parsed.accountLabelCount === 'number' ? parsed.accountLabelCount : 0,
          clearingCount: typeof parsed.clearingCount === 'number' ? parsed.clearingCount : 0,
        }
      } catch {
        return { ...empty }
      }
    }
    const mergeAggregate = (current: OrphanSnapshot, next: OrphanSnapshot): OrphanSnapshot => ({
      sessionCount: Math.max(current.sessionCount, next.sessionCount),
      headingCount: Math.max(current.headingCount, next.headingCount),
      exitButtonCount: Math.max(current.exitButtonCount, next.exitButtonCount),
      continueButtonCount: Math.max(current.continueButtonCount, next.continueButtonCount),
      accountLabelCount: Math.max(current.accountLabelCount, next.accountLabelCount),
      clearingCount: Math.max(current.clearingCount, next.clearingCount),
    })
    const writeAggregate = (snapshot: OrphanSnapshot): void => {
      try {
        window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot))
      } catch {
        // sessionStorage 不可写时聚合结论无法落盘;测试会拿到 null,自然判失败。
      }
    }
    const computeSnapshot = (): OrphanSnapshot => {
      const clearing = document.querySelector('[data-kiosk-privacy-clearing="true"]')
      const session = document.querySelector('[data-kiosk-screen="session-timeout"]')
      const heading = document.querySelector('#session-timeout-title')
      const buttons = Array.from(document.querySelectorAll('button'))
      const exitButton = buttons.find((button) =>
        /立即退出并清除本机会话/.test(button.textContent ?? '')
      )
      const continueButton = buttons.find((button) =>
        /继续使用|返回首页并清除本机会话/.test(button.textContent ?? '')
      )
      const accountLabel = Array.from(document.querySelectorAll('p, span, b')).find((el) =>
        /当前登录：|当前会话：/.test(el.textContent ?? '')
      )
      return {
        sessionCount: session ? 1 : 0,
        headingCount: heading ? 1 : 0,
        exitButtonCount: exitButton ? 1 : 0,
        continueButtonCount: continueButton ? 1 : 0,
        accountLabelCount: accountLabel ? 1 : 0,
        clearingCount: clearing ? 1 : 0,
      }
    }
    const startObserver = (): void => {
      if (!document.documentElement) return
      const observer = new MutationObserver(() => {
        const next = computeSnapshot()
        const merged = mergeAggregate(readAggregate(), next)
        writeAggregate(merged)
      })
      observer.observe(document.documentElement, { childList: true, subtree: true })
      // 把当前帧的观察结果立刻合并进去,确保 commit 同步完成也能落盘。
      const merged = mergeAggregate(readAggregate(), computeSnapshot())
      writeAggregate(merged)
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', startObserver, { once: true })
    } else {
      startObserver()
    }
  })

  // hard reload 后 home 页继承下来的聚合快照可能仍带上次测试的残留——清空只针对本测试
  // 在目标 fixture 加载前。cleanup 必须在 fixture 路由加载完成后再做,以免脚本自身也参与
  // 聚合,但 addInitScript 同步 install,本页脚本在 main bundle 之前执行;只有当脚本
  // 加载 / 执行发生在新 history entry 上时,这段清理才属于"新一次观察"。我们用
  // uniqueStorageKey 区分:每个测试一个 key 不会污染其他用例。
  await page.goto('/session-timeout')
  await expect(page).toHaveURL('http://127.0.0.1:4188/', { timeout: 5_000 })

  const snapshot = await page.evaluate(() => {
    const raw = window.sessionStorage.getItem('kiosk-orphan-snapshot:v1')
    if (!raw) return null
    return JSON.parse(raw) as {
      sessionCount: number
      headingCount: number
      exitButtonCount: number
      continueButtonCount: number
      accountLabelCount: number
      clearingCount: number
    }
  })

  expect(snapshot).not.toBeNull()
  expect(snapshot!.sessionCount).toBe(0)
  expect(snapshot!.headingCount).toBe(0)
  expect(snapshot!.exitButtonCount).toBe(0)
  expect(snapshot!.continueButtonCount).toBe(0)
  expect(snapshot!.accountLabelCount).toBe(0)
  expect(snapshot!.clearingCount).toBe(1)
})

const SCAN_TASK_ID = 'scan-busy-task'
const SCAN_CONTROL_TOKEN = 'scan-busy-control-token'
const SCAN_OBSERVATION_MS = 3_000

interface ScanBusyOptions {
  scanTaskId?: string
  controlToken?: string
  status?: 'waiting' | 'processing' | 'completed' | 'expired' | 'failed' | 'cancelled'
  networkError?: boolean
  deleteFailure?: 'abort' | 'server-error'
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
  await page.unroute(`**/api/v1/scan/sessions/${SCAN_TASK_ID}`)

  let statusReq = 0
  let deleteReq = 0
  await page.route(`**/api/v1/scan/sessions/${SCAN_TASK_ID}`, async (route) => {
    const request = route.request()
    if (request.method() === 'DELETE') {
      deleteReq += 1
      if (options.deleteFailure === 'abort') {
        await route.abort('internetdisconnected')
        return
      }
      if (options.deleteFailure === 'server-error') {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({
            success: false,
            error: { code: 'SCAN_INTERNAL', message: 'injected cancel failure' },
          }),
        })
        return
      }
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
  // 抑制空闲警告(suppresses idle warning),不会拦截路由跳转。E2E 这一组测试
  // 要锁住的是用户可见的承诺:身份不完整时,idle 计时器继续工作,提示用户在
  // 3s 内弹出 /session-timeout。不去对内部 active===false 这种实现细节
  // 做断言——它属于 hook 单测的职责范围。
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

test('user cancel with a failing DELETE sends exactly one attempt and falls back to /scan/start @scan-busy @warning-kiosk', async ({
  page,
  api,
}) => {
  registerKioskShell(api)
  const cancelCounts = await installScanProgressRoute(page, {
    scanTaskId: SCAN_TASK_ID,
    controlToken: SCAN_CONTROL_TOKEN,
    status: 'waiting',
    deleteFailure: 'abort',
  })
  await gotoScanProgressWithHistory(page, {
    scanTaskId: SCAN_TASK_ID,
    controlToken: SCAN_CONTROL_TOKEN,
  })
  await expect(page.getByText('等待打印机端扫描完成', { exact: true })).toBeVisible()
  await expect.poll(() => cancelCounts.statusRequests()).toBeGreaterThanOrEqual(1)

  const deleteBefore = cancelCounts.deleteRequests()
  await page.getByRole('button', { name: '取消扫描', exact: true }).click()

  // DELETE 抛错 → catch 走默认 fallback,busy 在 effect 渲染后释放,
  // 落地到 /scan/start。/scan/start 上 idle 计时器重新开始,3s 内
  // /session-timeout 弹出。
  await expect(page).toHaveURL(/\/scan\/start$/, { timeout: 6_000 })
  await expectWarningWithinThreeSeconds(page)
  expect(cancelCounts.deleteRequests() - deleteBefore).toBe(1)
})

// ── 待机 / 已退出态不得出现清场倒计时（公共设备现场反馈） ────────────────────
//
// 现场问题：一体机整天摆在人才市场大厅，没人使用时仍每隔一个 idle 周期弹出
// 「还在使用吗？30 秒后自动退出」并硬刷新一次。此时页面停在干净首页：没有登录、
// 没有 guestMode、没有任何敏感 sessionStorage —— 清场是一次不折不扣的空操作，
// 却把空操作包装成需要用户回答的隐私警告。
//
// 判定口径（必须保持严格）：只有当清场「什么都清不掉」时才允许跳过；
// 只要有登录态 / guestMode / 任一敏感会话键 / 处在非中性路由，倒计时一律照旧。
// 下面三条 must-still-fire 用例就是守这条线的，不允许为了让前两条变绿而放宽。

const SENSITIVE_SESSION_KEYS_ALL = [
  'ai-job-print:current-ai-resume',
  'ai-job-print:current-print-material-check',
  'ai-job-print:job-material-draft:v1',
  'self_assessment_session_v1',
] as const

const IDLE_WINDOW_SETTLE_MS = 7_000

/**
 * 跨导航累计「是否出现过 /session-timeout 清场页」。
 *
 * 不能只在结束时看一眼 URL：倒计时页会自己在 2s 后跳走，轮询很容易整段错过。
 * 用 addInitScript + MutationObserver 把「见过 session-timeout 屏」单调写进
 * sessionStorage，hardClear 触发的整页 reload 之后继续累计，最后统一读回。
 */
async function trackSessionTimeoutSightings(page: Page): Promise<() => Promise<number>> {
  await page.addInitScript(() => {
    const KEY = 'kiosk-standby-timeout-sightings:v1'
    const bump = (): void => {
      const seen =
        document.querySelector('[data-kiosk-screen="session-timeout"]') !== null ||
        location.pathname === '/session-timeout'
      if (!seen) return
      const prev = Number(window.sessionStorage.getItem(KEY) ?? '0')
      window.sessionStorage.setItem(KEY, String(prev + 1))
    }
    const start = (): void => {
      bump()
      new MutationObserver(bump).observe(document.documentElement, {
        childList: true,
        subtree: true,
      })
    }
    if (document.documentElement) start()
    else document.addEventListener('DOMContentLoaded', start, { once: true })
  })

  return async () => {
    const raw = await page.evaluate(() =>
      window.sessionStorage.getItem('kiosk-standby-timeout-sightings:v1'),
    )
    return Number(raw ?? '0')
  }
}

async function expectNothingToClear(page: Page): Promise<void> {
  const leftovers = await page.evaluate(
    (keys) => keys.filter((key) => window.sessionStorage.getItem(key) !== null),
    [...SENSITIVE_SESSION_KEYS_ALL],
  )
  expect(leftovers).toEqual([])
}

test('clean standby homepage never raises the privacy exit countdown @warning-kiosk', async ({
  page,
  api,
}) => {
  registerKioskShell(api, { screensaverEnabled: false })
  const sightings = await trackSessionTimeoutSightings(page)

  await page.goto('/')
  await expect(page).toHaveURL('http://127.0.0.1:4188/')
  // 先证明这确实是「干净待机」：匿名 + 无任何敏感会话残留。
  await expectNothingToClear(page)

  // 完整 idle 周期(4s)+ 预警窗(2s)+ 余量，全程不触摸。
  await page.waitForTimeout(IDLE_WINDOW_SETTLE_MS)

  expect(await sightings()).toBe(0)
  await expect(page).toHaveURL('http://127.0.0.1:4188/')
  await expect(page.getByRole('heading', { name: '还在使用吗？', exact: true })).toHaveCount(0)
})

test('a completed privacy clear does not immediately re-arm another countdown @warning-kiosk', async ({
  page,
  api,
}) => {
  registerKioskShell(api, { screensaverEnabled: false })
  await page.goto('/interview/tips')
  await page.evaluate(({ key, value }) => window.sessionStorage.setItem(key, value), {
    key: SENSITIVE_SESSION_KEY,
    value: 'standby-loop-sensitive',
  })

  // 第一次清场必须照常发生——这是真有东西要清的场景。
  await expectWarningWithinThreeSeconds(page)
  await expect(page).toHaveURL('http://127.0.0.1:4188/', { timeout: 3_500 })
  await expectSensitiveSessionCleared(page)

  // 落回干净首页之后，机器已经「退出完毕」，不该再自己弹第二次倒计时。
  const sightings = await trackSessionTimeoutSightings(page)
  await page.evaluate(() =>
    window.sessionStorage.removeItem('kiosk-standby-timeout-sightings:v1'),
  )
  await page.waitForTimeout(IDLE_WINDOW_SETTLE_MS)

  expect(await sightings()).toBe(0)
  await expect(page).toHaveURL('http://127.0.0.1:4188/')
})

test('screensaver standby enters the ad screen without a privacy countdown @warning-kiosk', async ({
  page,
  api,
}) => {
  registerKioskShell(api, { screensaverEnabled: true, idleTimeoutSec: 4 })
  const sightings = await trackSessionTimeoutSightings(page)

  await page.goto('/')
  await expect(page).toHaveURL('http://127.0.0.1:4188/')
  await expectNothingToClear(page)

  // 干净首页进待机宣传屏是产品行为，不是隐私清场：不该先问「还在使用吗？」。
  await expect(page).toHaveURL(/\/screensaver$/, { timeout: 8_000 })
  await expect(page.locator('[data-kiosk-screen="screensaver"]')).toBeVisible()
  expect(await sightings()).toBe(0)
})

// ── 以下三条守「不得削弱清场」：有东西可清时倒计时必须照常出现 ──────────────

test('standby countdown still fires when sensitive session data is present @warning-kiosk', async ({
  page,
  api,
}) => {
  registerKioskShell(api, { screensaverEnabled: false })
  await page.goto('/')
  await expect(page).toHaveURL('http://127.0.0.1:4188/')
  await page.evaluate(({ key, value }) => window.sessionStorage.setItem(key, value), {
    key: SENSITIVE_SESSION_KEY,
    value: 'homepage-leftover-from-previous-user',
  })

  // 上一位用户把匿名 AI 简历会话(含一次性 accessToken)留在了首页 —— 必须清。
  await expectWarningWithinThreeSeconds(page)
  await expect(page).toHaveURL('http://127.0.0.1:4188/', { timeout: 3_500 })
  await expectSensitiveSessionCleared(page)
})

test('standby countdown still fires when a print material session is present @warning-kiosk', async ({
  page,
  api,
}) => {
  registerKioskShell(api, { screensaverEnabled: false })
  await page.goto('/')
  await expect(page).toHaveURL('http://127.0.0.1:4188/')
  await page.evaluate(
    ({ key, value }) => window.sessionStorage.setItem(key, value),
    { key: 'ai-job-print:current-print-material-check', value: 'print-leftover' },
  )

  await expectWarningWithinThreeSeconds(page)
  await expect(page).toHaveURL('http://127.0.0.1:4188/', { timeout: 3_500 })
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.sessionStorage.getItem('ai-job-print:current-print-material-check'),
      ),
    )
    .toBeNull()
})

test('standby countdown still fires for a signed-in member on the homepage @warning-kiosk', async ({
  page,
  api,
}) => {
  registerKioskShell(api, { screensaverEnabled: false })
  registerMemberLogin(api)
  await loginThroughVisibleUi(page, '/')
  await expect(page).toHaveURL('http://127.0.0.1:4188/')

  // 登录态本身就是必须清的东西，即使 sessionStorage 里一片干净。
  await expectWarningWithinThreeSeconds(page)
  await expect(page.getByText('当前登录：', { exact: false })).toBeVisible()
})

/**
 * 打印进行中不得被普通 idle 倒计时清场。
 *
 * 用户站在机器前等出纸，整个过程完全不碰屏幕——这正是 idle 计时器最容易误判的场景。
 * 打印页通过 useBusyLock 持锁，普通 idle 全程暂停；这里用真实轮询把这条锁钉死，
 * 避免以后有人改动打印页的锁条件时无声退化。
 *
 * 注意边界：不受 busy 抑制的**硬隐私截止**仍会在最长安全时限后清场，这是刻意设计
 * （见 kiosk-privacy-timeout.spec.ts「hard clear stops active print polling without
 * cancelling the backend task」）：终端页面重置，但后台打印任务继续，纸照出。
 * 本用例只守「普通 30 秒倒计时不得打断打印」，不碰硬截止。
 */
test('an active print job is never interrupted by the ordinary idle countdown @warning-kiosk', async ({
  page,
  api,
}) => {
  registerKioskShell(api)
  const printTaskId = 'warning-print-task'
  let pollRequests = 0
  await page.route(`**/api/v1/print/jobs/${printTaskId}`, async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback()
      return
    }
    pollRequests += 1
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ taskId: printTaskId, status: 'printing' }),
    })
  })

  await page.goto('/')
  await page.evaluate((taskId) => {
    window.history.pushState(
      { usr: { taskId, amountCents: 0 }, key: 'warning-print', idx: 1 },
      '',
      '/print/progress',
    )
  }, printTaskId)
  await page.reload({ waitUntil: 'domcontentloaded' })

  // 先确认真的在打印中（轮询已经跑起来），否则「没弹倒计时」可能只是页面没加载。
  await expect(page).toHaveURL(/\/print\/progress$/)
  await expect.poll(() => pollRequests).toBeGreaterThan(0)

  // 远超一个完整 idle 周期(4s)，全程不触摸：倒计时一次都不许出现。
  await expectNoWarningWithin(page, IDLE_WINDOW_SETTLE_MS)
  await expect(page).toHaveURL(/\/print\/progress$/)
})
