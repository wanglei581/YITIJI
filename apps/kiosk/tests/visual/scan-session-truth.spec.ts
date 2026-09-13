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
  api.respond('GET', '/api/v1/terminals/KSK-001/capabilities', {
    status: 200,
    json: { capabilities: [] },
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
  await page.waitForURL(/\/scan\?stage=settings/)
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
  await page.waitForURL(/\/scan\?stage=settings/)
  const stored = await page.evaluate((key) => JSON.parse(window.sessionStorage.getItem(key) ?? '{}') as { scanType?: string }, 'ai-job-print:current-scan-workbench')
  expect(stored).toMatchObject({ scanType: 'resume' })
})

test('direct scan settings access never posts a session @kiosk', async ({ page, api }) => {
  registerShell(api)
  const createRequests = countRequests(page, 'POST', '/api/v1/scan/sessions')

  await page.goto('/scan/settings')
  await expect(page.getByText('\u672a\u521b\u5efa\u626b\u63cf\u4efb\u52a1', { exact: true }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: '\u5b89\u5168\u8fd4\u56de\u626b\u63cf\u9996\u9875' }).first()).toBeVisible()
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
  await expect(page.getByRole('button', { name: '\u5b89\u5168\u8fd4\u56de\u626b\u63cf\u9996\u9875' }).first()).toBeVisible()
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
  const persisted = await page.evaluate((token) => {
    const inLocal = Array.from({ length: window.localStorage.length }, (_, index) => window.localStorage.key(index))
      .some((key) => key !== null && (window.localStorage.getItem(key) ?? '').includes(token))
    const workbench = window.sessionStorage.getItem('ai-job-print:current-scan-workbench') ?? ''
    return {
      inLocal,
      inWorkbench: workbench.includes(token),
      inUrl: window.location.href.includes(token),
    }
  }, CONTROL_TOKEN)
  expect(persisted.inLocal).toBe(false)
  expect(persisted.inUrl).toBe(false)
  expect(persisted.inWorkbench).toBe(true)

  await page.getByRole('button', { name: '\u8fd4\u56de\uff08\u53d6\u6d88\u4efb\u52a1\uff09' }).click()
  await page.waitForURL(/\/scan(\?stage=start)?$|\/scan\?stage=start/)
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
  await page.waitForURL(/\/scan(\?stage=start)?$|\/scan\?stage=start/)
  releaseCreate?.()
  await expect.poll(cancelRequests).toBe(1)
})

// ── 扫描会话撤销契约（2026-09-13） ─────────────────────────────────────────
//
// 背景：本机 sessionStorage 里的 scan session 只是一份凭证副本，真正决定「面板扫出来的
// 文件投给谁」的是服务端 ScanTask。以前离开扫描流程 / 本机放弃轮询只清本地，服务端任务
// 停在 waiting —— 下一位用户在面板上按下扫描，文件会投给上一位。下面两组用例钉住
// 「清本地之前先撤服务端」，以及创建请求必须带终端身份。
//
// 每条用例自己注册 api.respond：ApiRouter 对未注册请求一律 abort 并在拆卸时报
// Unhandled API，共享兜底会让「本该没发生的请求」悄悄变成绿的。

const REVOKE_CONTROL_TOKEN = 'revoke-control-token'

function seedLiveScanSession(page: Page, stage: 'settings' | 'progress'): Promise<void> {
  return page.evaluate(
    ({ taskId, controlToken, seedStage }) => {
      window.sessionStorage.setItem('ai-job-print:current-scan-workbench', JSON.stringify({
        stage: seedStage,
        scanType: 'resume',
        live: {
          scanTaskId: taskId,
          controlToken,
          instructions: ['服务端指引：第一步', '服务端指引：第二步'],
          expiresAt: '2099-01-01T00:00:00.000Z',
        },
      }))
    },
    { taskId: SCAN_TASK_ID, controlToken: REVOKE_CONTROL_TOKEN, seedStage: stage },
  )
}

/** 记录每一次 DELETE 及其请求头，用于断言「用谁的身份撤销」。 */
function recordRevokeRequests(page: Page): () => Array<Record<string, string>> {
  const seen: Array<Record<string, string>> = []
  page.on('request', (request) => {
    if (request.method() !== 'DELETE') return
    if (new URL(request.url()).pathname !== `/api/v1/scan/sessions/${SCAN_TASK_ID}`) return
    seen.push(request.headers())
  })
  return () => [...seen]
}

function registerPrintScanHub(api: ApiRouter): void {
  api.respond('GET', '/api/v1/terminals/KSK-001/config', {
    status: 200,
    json: {
      smartCampus: { enabled: false, modules: {}, items: [] },
      toolbox: { enabled: false, items: [] },
      configVersion: 'scan-revoke-fixture',
      refreshIntervalMs: 300_000,
      serverTime: '2026-09-13T00:00:00.000Z',
    },
  })
}

test('creating a scan session carries the terminal session token, not just the terminal id @kiosk', async ({ page, api }) => {
  registerShell(api)
  registerLegacyReadyDevice(api)
  const createHeaders: Array<Record<string, string>> = []
  page.on('request', (request) => {
    if (request.method() !== 'POST') return
    if (new URL(request.url()).pathname !== '/api/v1/scan/sessions') return
    createHeaders.push(request.headers())
  })
  api.respond('POST', '/api/v1/scan/sessions', { status: 200, json: createdSession() })

  await enterSettingsFromVisibleStart(page)
  await expect(page.getByText('扫描任务已创建', { exact: true })).toBeVisible()

  // 服务端在 POST /scan/sessions 上挂了 TerminalIdentityGuard：只带 x-terminal-id 会 401。
  // 这条断言就是「创建必须走 terminalProtectedFetch」的运行时判据。
  expect(createHeaders).toHaveLength(1)
  expect(createHeaders[0]?.['x-terminal-session-token']).toBe('playwright-terminal-session-fixture')
  expect(createHeaders[0]?.['x-terminal-id']).toBe('KSK-001')
})

test('a revoked terminal session fails the creation closed and is not retried @kiosk', async ({ page, api }) => {
  registerShell(api)
  registerLegacyReadyDevice(api)
  const createRequests = countRequests(page, 'POST', '/api/v1/scan/sessions')
  api.respond('POST', '/api/v1/scan/sessions', {
    status: 401,
    json: { success: false, error: { code: 'TERMINAL_SESSION_INVALID', message: '终端安全会话无效' } },
  })
  // 401 会触发终端会话换票；换票也被吊销时立即 fail-closed（不重试、不改判）。
  api.respond('POST', '/api/v1/terminals/session-token/refresh', {
    status: 401,
    json: { success: false, error: { code: 'TERMINAL_SESSION_INVALID', message: '终端安全会话无效' } },
  })

  await enterSettingsFromVisibleStart(page)
  // 换票失败后还会向本机 Agent 要一张新引导票（默认配置里配了桥接令牌），
  // 连不上要等一次 4 秒超时才落到 fail-closed —— 这条断言要能等过那一段。
  await expect(page.getByText('终端安全校验失败', { exact: true }).first()).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText('终端安全校验失败，请联系现场工作人员', { exact: false }).first()).toBeVisible()
  await expect(page.getByText('扫描任务已创建', { exact: true })).toHaveCount(0)
  await expect(page.getByText(SCAN_TASK_ID, { exact: true })).toHaveCount(0)
  await page.waitForTimeout(500)
  // 换票失败后不再自动重发创建请求（吊销的终端重试不会变好）。
  expect(createRequests()).toBe(1)
})

// ── 离开整条扫描流程：四个阶段 × 四个出口（2026-09-13） ───────────────────────
//
// 一张工作台四个阶段共用一个壳，壳上有四个出口：顶栏「返回打印扫描」和底栏三项主导航
// （首页 / AI 顾问 / 我的）。四个都是「离开这条流程」——用户走了，本机这一场结束了。
//
// 当天只有顶栏返回会撤服务端任务，底栏三项是裸 navigate：按「首页 / AI 顾问 / 我的」
// 离开的用户，服务端那个任务仍停在 waiting 等这台机器的下一份投递，本机登记也还在。
// 下一位走到面板前按下扫描，文件就投给了上一位 —— 同一屏上两个出口两种命运。
//
// 逐个阶段 × 逐个出口断言同一件事，而不是只抽查一个：出口是各写各的时候，
// 抽查任何一个都证明不了其余几个。

type SeedStage = 'start' | 'settings' | 'progress' | 'result'

/** 每个阶段都带一场「还活着」的服务端任务：离开时该撤的就是它。 */
function seedScanWorkbenchStage(page: Page, stage: SeedStage): Promise<void> {
  return page.evaluate(
    ({ taskId, controlToken, seedStage }) => {
      window.sessionStorage.setItem('ai-job-print:current-scan-workbench', JSON.stringify({
        stage: seedStage,
        scanType: 'resume',
        live: {
          scanTaskId: taskId,
          controlToken,
          instructions: ['服务端指引：第一步', '服务端指引：第二步'],
          expiresAt: '2099-01-01T00:00:00.000Z',
        },
        // result 阶段要有结果快照才准入（URL 是意图不是授权）。
        // 刻意选「完成但没拿到文件」：它同样是终态，但不需要再造一份文件夹具。
        result: seedStage === 'result'
          ? { outcome: 'completed-no-file', success: false, reason: '扫描已完成但未拿到文件，请重新扫描' }
          : undefined,
      }))
    },
    { taskId: SCAN_TASK_ID, controlToken: REVOKE_CONTROL_TOKEN, seedStage: stage },
  )
}

/** 四个阶段各自的「已经落到这一屏」判据，避免还没渲染完就去点出口。 */
const SCAN_STAGE_LANDMARK: Record<SeedStage, string> = {
  start: '下一步会创建真实扫描会话',
  settings: '扫描任务已创建',
  progress: '等待打印机端扫描完成',
  result: '服务端说已完成，但这次回执里没有可用文件',
}

/**
 * 四个出口。顶栏返回按 `.qx-topbar-back` 取 —— result 阶段的 CTA 条上另有一个同名
 * 「返回打印扫描」按钮（ScanResultPage 的终态出口，不在本次改动范围内），
 * 按可访问名取会一次命中两个。
 */
const SCAN_EXITS = [
  { label: '返回打印扫描', destination: '/print-scan', topbar: true },
  { label: '首页', destination: '/', topbar: false },
  { label: 'AI 顾问', destination: '/assistant', topbar: false },
  { label: '我的', destination: '/profile', topbar: false },
] as const

/** 离开扫描流程之后会落到的四个目的地，各自挂载时要读的接口。 */
function registerScanExitDestinations(api: ApiRouter): void {
  registerPrintScanHub(api)
  api.respond('GET', '/api/v1/terminals/KSK-001/smart-campus', {
    status: 200,
    json: { enabled: false, modules: { welcome: false, bigdata: false, luggage: false, panorama: false }, items: [] },
  })
  api.respond('GET', '/api/v1/jobs', {
    status: 200,
    json: { data: [], pagination: { page: 1, pageSize: 1, total: 0, totalPages: 0 } },
  })
  api.respond('GET', '/api/v1/job-fairs', {
    status: 200,
    json: { data: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 } },
  })
  api.respond('GET', '/api/v1/health', { status: 200, json: { success: true, data: { status: 'ok' } } })
  // /assistant 挂载即探语音能力。按「未开放」诚实应答，不伪造可用的语音通道。
  api.respond('GET', '/api/v1/mock-interviews/capabilities/voice', {
    status: 200,
    json: { success: true, data: { asrEnabled: false, ttsEnabled: false } },
  })
}

for (const stage of ['start', 'settings', 'progress', 'result'] as const) {
  for (const exit of SCAN_EXITS) {
    test(`leaving the ${stage} stage through 「${exit.label}」 revokes the server task once @kiosk`, async ({ page, api }) => {
      registerShell(api)
      registerScanExitDestinations(api)
      const revokes = recordRevokeRequests(page)
      const createRequests = countRequests(page, 'POST', '/api/v1/scan/sessions')
      api.respond('DELETE', `/api/v1/scan/sessions/${SCAN_TASK_ID}`, {
        status: 200,
        json: { success: true, data: { scanTaskId: SCAN_TASK_ID, status: 'cancelled' } },
      })
      if (stage === 'progress') {
        // 等待页会自动轮询；给一个「还在等」的诚实回答，别让它改判。
        api.respond('GET', `/api/v1/scan/sessions/${SCAN_TASK_ID}`, {
          status: 200,
          json: {
            success: true,
            data: {
              scanTaskId: SCAN_TASK_ID,
              status: 'waiting',
              scanType: 'resume',
              file: null,
              errorCode: null,
              errorMessage: null,
              expiresAt: '2099-01-01T00:00:00.000Z',
            },
          },
        })
      }

      await page.goto('/scan')
      await seedScanWorkbenchStage(page, stage)
      await page.goto(`/scan?stage=${stage}`)
      await expect(page.getByText(SCAN_STAGE_LANDMARK[stage], { exact: false }).first()).toBeVisible()

      await (exit.topbar
        ? page.locator('.qx-topbar-back')
        : page.getByRole('button', { name: exit.label, exact: true })
      ).click()
      await page.waitForURL((url) => url.pathname === exit.destination)

      // 1) 服务端那个任务被撤掉了，且只撤一次，用的是本机登记里那份控制凭证。
      //    result 阶段例外且必须例外：结果快照存在 = 服务端已经给过终态，
      //    再 DELETE 只会换回 400 / 404，是一次纯噪音请求。
      const expectedRevokes = stage === 'result' ? 0 : 1
      if (expectedRevokes === 0) await page.waitForTimeout(300)
      await expect.poll(() => revokes().length).toBe(expectedRevokes)
      if (expectedRevokes === 1) {
        expect(revokes()[0]?.['x-scan-session-control']).toBe(REVOKE_CONTROL_TOKEN)
      }
      // 2) 本机登记也清掉了：留着它，下一次进 /scan 会复水到一个已经被撤的任务。
      expect(await page.evaluate(() => window.sessionStorage.getItem('ai-job-print:current-scan-workbench'))).toBeNull()
      // 3) 离开不等于重建：这条路径上不许出现新的创建请求。
      expect(createRequests()).toBe(0)
    })
  }
}

test('leaving the whole scan flow from the top bar revokes the server task once @kiosk', async ({ page, api }) => {
  registerShell(api)
  registerPrintScanHub(api)
  const revokes = recordRevokeRequests(page)
  api.respond('DELETE', `/api/v1/scan/sessions/${SCAN_TASK_ID}`, {
    status: 200,
    json: { success: true, data: { scanTaskId: SCAN_TASK_ID, status: 'cancelled' } },
  })

  await page.goto('/scan')
  await seedLiveScanSession(page, 'settings')
  await page.goto('/scan?stage=settings')
  await expect(page.getByText('扫描任务已创建', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: '返回打印扫描' }).click()
  await page.waitForURL(/\/print-scan$/)
  await expect.poll(() => revokes().length).toBe(1)
  expect(revokes()[0]?.['x-scan-session-control']).toBe(REVOKE_CONTROL_TOKEN)
  // 撤销之后本机登记也必须清掉：留着它，下一次进 /scan 会复水到一个已经被撤的任务。
  expect(await page.evaluate(() => window.sessionStorage.getItem('ai-job-print:current-scan-workbench'))).toBeNull()
})

// ── 创建在飞时被清场（2026-09-13） ────────────────────────────────────────────
//
// POST /scan/sessions 还没回来的那一刻，本机登记里没有 live —— 清场读不到任何可撤的
// 东西，只能把本地那份抹掉。等响应回来，旧代码照旧把 live 写回去：刚被清掉那一位的
// 收件箱又立了起来，服务端任务停在 waiting，下一位在面板上按下扫描，文件投给了上一位。
//
// 下面这条用底栏「首页」制造清场（它和隐私清场、退出、屏保走的是同一个
// clearScanWorkbenchSession，代次在抹掉登记之前同步 +1），因为它是**页内**导航，
// 不重载文档 —— 「响应晚于清场落地」这件事才能被确定性地复现。
test('a scan session that arrives after the user left is revoked and never written back @kiosk', async ({ page, api }) => {
  registerShell(api)
  registerScanExitDestinations(api)
  const revokes = recordRevokeRequests(page)
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
  await page.getByRole('button', { name: /下一步/ }).click()
  await createReceived
  await expect(page.getByText('正在创建扫描任务', { exact: false }).first()).toBeVisible()

  await page.getByRole('button', { name: '首页', exact: true }).click()
  await page.waitForURL((url) => url.pathname === '/')
  // 清场已经落地：此刻本机登记必须是空的。
  expect(await page.evaluate(() => window.sessionStorage.getItem('ai-job-print:current-scan-workbench'))).toBeNull()

  releaseCreate?.()

  // 1) 迟到的响应把任务撤掉了 —— 而且只撤一次，用的是响应里那份控制凭证
  //    （本机登记已经没了，凭证只可能来自响应本身）。
  await expect.poll(() => revokes().length).toBe(1)
  expect(revokes()[0]?.['x-scan-session-control']).toBe(CONTROL_TOKEN)
  // 2) 也没有把 live 写回本机登记。写回去等于把已清场那一位的收件箱重新立起来。
  await expect
    .poll(() => page.evaluate(() => window.sessionStorage.getItem('ai-job-print:current-scan-workbench')))
    .toBeNull()
  // 3) 页面没有因为这个迟到的响应跳回扫描流程或宣告成功。
  expect(new URL(page.url()).pathname).toBe('/')
  await expect(page.getByText('扫描任务已创建', { exact: true })).toHaveCount(0)
})

// 反面用例：正常走完 settings → progress **不得**出现任何取消。
// 上面那道闸门如果写成「只要本页卸载就撤」，这条会当场红 ——
// 确认之后进入等待页，settings 同样会卸载，而那个任务正要被用户使用。
test('confirming the created session and entering the wait stage cancels nothing @kiosk', async ({ page, api }) => {
  registerShell(api)
  registerLegacyReadyDevice(api)
  const cancelRequests = countRequests(page, 'DELETE', `/api/v1/scan/sessions/${SCAN_TASK_ID}`)
  api.respond('POST', '/api/v1/scan/sessions', { status: 200, json: createdSession() })
  api.respond('GET', `/api/v1/scan/sessions/${SCAN_TASK_ID}`, {
    status: 200,
    json: {
      success: true,
      data: {
        scanTaskId: SCAN_TASK_ID,
        status: 'waiting',
        scanType: 'resume',
        file: null,
        errorCode: null,
        errorMessage: null,
        expiresAt: LATER,
      },
    },
  })

  await enterSettingsFromVisibleStart(page)
  await expect(page.getByText('扫描任务已创建', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: '我已操作，开始等待' }).click()
  await page.waitForURL(/\/scan\?stage=progress/)
  await expect(page.getByText('等待打印机端扫描完成', { exact: true })).toBeVisible()

  // 多等一会儿：迟到的取消也是取消，立刻断言只能证明「这一帧还没撤」。
  await page.waitForTimeout(1_500)
  expect(cancelRequests()).toBe(0)
  // 本机登记仍然指着这场还活着的会话（progress 阶段要靠它认领回传的文件）。
  const stored = await page.evaluate(() => window.sessionStorage.getItem('ai-job-print:current-scan-workbench'))
  expect(stored).not.toBeNull()
  expect(stored).toContain(SCAN_TASK_ID)
})

test('giving up on polling revokes the server task instead of orphaning it @kiosk', async ({ page, api }) => {
  test.setTimeout(120_000)
  registerShell(api)
  const revokes = recordRevokeRequests(page)
  api.respond('GET', `/api/v1/scan/sessions/${SCAN_TASK_ID}`, {
    status: 500,
    json: { success: false, error: { code: 'INTERNAL_ERROR', message: '服务端暂时不可用' } },
  })
  api.respond('DELETE', `/api/v1/scan/sessions/${SCAN_TASK_ID}`, {
    status: 200,
    json: { success: true, data: { scanTaskId: SCAN_TASK_ID, status: 'cancelled' } },
  })

  await page.goto('/scan')
  await seedLiveScanSession(page, 'progress')
  await page.goto('/scan?stage=progress')
  await expect(page.getByText('等待打印机端扫描完成', { exact: true })).toBeVisible()

  // 连续 20 次查不动才判放弃（MAX_SCAN_POLL_FAILS）。「立即检查」只是插队查一次，
  // 不改变判据，这里用它把 20 次失败压缩到几秒内，而不是等 20 个 3 秒轮询周期。
  const checkNow = page.getByRole('button', { name: '立即检查', exact: true })
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (new URL(page.url()).searchParams.get('stage') === 'result') break
    if (!(await checkNow.isVisible().catch(() => false))) break
    if (await checkNow.isEnabled().catch(() => false)) await checkNow.click().catch(() => undefined)
    await page.waitForTimeout(120)
  }

  await expect(page).toHaveURL(/\/scan\?stage=result/, { timeout: 70_000 })
  await expect(page.getByText('长时间无法查询扫描状态', { exact: false }).first()).toBeVisible()
  await expect.poll(() => revokes().length).toBe(1)
  expect(revokes()[0]?.['x-scan-session-control']).toBe(REVOKE_CONTROL_TOKEN)
})
