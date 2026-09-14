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

// ── 投递确认（ACK）（2026-09-14） ─────────────────────────────────────────────
//
// 服务端把「建成」和「可投递」拆成了两段：新建会话一律 `deliveryAckedAt = null`，
// 只有本机确认自己握着这一场的控制凭据之后，面板上扫出来的文件才会投给它
// （契约见 src/pages/scan/scanDeliveryAck.ts）。设置页与等待页因此**挂载即确认**，
// 确认之前两屏都停在「正在确认投递授权」—— 凡是要走到「扫描任务已创建」或
// 「等待打印机端扫描完成」的用例，都必须自己把这个端点注册上。
//
// 仍然逐条用例注册，**不挂兜底路由**（同本文件其余部分的惯例）：ApiRouter 对未注册
// 请求一律 abort 并在拆卸时报 Unhandled API，而「哪几条路径上一次确认都不许发生」
// —— 创建失败、响应畸形、终端身份失效、用户已经走了 —— 正是这一层要钉的东西。
// 一条 catch-all 会把这几条用例全部悄悄变绿。

/** 这一场 ACK 端点的路径。反面用例只数它，不注册它。 */
const ACK_PATH = `/api/v1/scan/sessions/${SCAN_TASK_ID}/ack`
/** 服务端写下投递授权的那一刻。固定值：用例断言的是「确认过」，不是具体几点。 */
const DELIVERY_ACKED_AT = '2026-09-14T00:00:00.000Z'

interface ScanAckProbe {
  /** 每一次 ACK 的请求头，按发生顺序。 */
  calls: () => Array<Record<string, string>>
  /**
   * 断言恰好确认过 `count` 次，且**每一次**都带齐服务端要校验的三样凭据。
   *
   * 只 respond 不看请求头的话，「本机漏带凭据」在这里永远不会红：真实服务端回的是
   * 401（没有终端会话票 / 终端 id）或 403（控制凭据对不上），而一份只按路径应答的
   * 夹具会照样回 200，页面照样把「已确认」画出来。
   */
  expectAcked: (count: number) => Promise<void>
}

/**
 * 注册这一场的投递确认端点（**按 taskId 精确注册**，不是通配），并记下每一次的凭据。
 *
 * 服务端在这个端点上同时校验终端会话票（TerminalIdentityGuard）、`x-terminal-id`
 * 归属，以及这一场的 `X-Scan-Session-Control`（见 src/services/api/scanTasks.ts 的
 * `ackScanSession`）。三样都记下来交给用例断言。
 */
function registerScanAck(
  page: Page,
  api: ApiRouter,
  expected: { controlToken: string; scanTaskId?: string; terminalSessionToken?: string },
): ScanAckProbe {
  const scanTaskId = expected.scanTaskId ?? SCAN_TASK_ID
  const path = `/api/v1/scan/sessions/${scanTaskId}/ack`
  const calls: Array<Record<string, string>> = []
  page.on('request', (request) => {
    if (request.method() !== 'POST') return
    if (new URL(request.url()).pathname !== path) return
    calls.push(request.headers())
  })
  api.respond('POST', path, {
    status: 200,
    json: { success: true, data: { scanTaskId, deliveryAckedAt: DELIVERY_ACKED_AT } },
  })
  return {
    calls: () => [...calls],
    expectAcked: async (count) => {
      await expect.poll(() => calls.length).toBe(count)
      for (const headers of calls) {
        expect(headers['x-terminal-id']).toBe('KSK-001')
        /* 给了具体值就按具体值断言。「非空」在换票场景里是不够的：本机拿**旧票**
         * 发出去，这个字段照样非空，而真实服务端会 401 —— 会话停在不可投递，
         * 用户照着指引扫出来的纸不会进他的记录。只有对上换回来的那一张才算过。 */
        if (expected.terminalSessionToken !== undefined) {
          expect(headers['x-terminal-session-token']).toBe(expected.terminalSessionToken)
        } else {
          expect(headers['x-terminal-session-token'] ?? '').not.toBe('')
        }
        expect(headers['x-scan-session-control']).toBe(expected.controlToken)
      }
    },
  }
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
  const ack = registerScanAck(page, api, { controlToken: CONTROL_TOKEN })
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
  // 建成不等于可投递：编号和服务端指引上屏之前，本机必须已经拿到投递授权。
  await ack.expectAcked(1)
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
  const ack = registerScanAck(page, api, { controlToken: CONTROL_TOKEN })
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
  // 过期是确认之后才发生的事：这一场确认过一次，且只有那一次。
  await ack.expectAcked(1)
})

test('a malformed success without a control token stays in the safe error state @kiosk', async ({ page, api }) => {
  registerShell(api)
  registerLegacyReadyDevice(api)
  // 刻意不注册 ACK：这一场没有控制凭据，本机既不该也无从确认投递授权。
  const ackRequests = countRequests(page, 'POST', ACK_PATH)
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
  expect(ackRequests()).toBe(0)
})

test('a malformed created session with cancellation credentials is cleaned up once @kiosk', async ({ page, api }) => {
  registerShell(api)
  const cancelRequests = countRequests(page, 'DELETE', `/api/v1/scan/sessions/${SCAN_TASK_ID}`)
  // 刻意不注册 ACK：响应缺字段，本页判这一场不成立并撤掉它，不该去确认投递授权。
  const ackRequests = countRequests(page, 'POST', ACK_PATH)
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
  expect(ackRequests()).toBe(0)
})

test('leaving while creation is in flight cancels the late-created session once @kiosk', async ({ page, api }) => {
  registerShell(api)
  const cancelRequests = countRequests(page, 'DELETE', `/api/v1/scan/sessions/${SCAN_TASK_ID}`)
  // 刻意不注册 ACK：用户已经走了，这一场迟到的会话只该被撤掉 ——
  // 确认它等于把一个没人看着的收件箱变成可投递的，那正是 ACK 要消灭的东西。
  const ackRequests = countRequests(page, 'POST', ACK_PATH)
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
  expect(ackRequests()).toBe(0)
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
  const ack = registerScanAck(page, api, { controlToken: CONTROL_TOKEN })
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
  // 投递确认挂的是同一道终端身份闸门，凭据要求只多不少（还要带这一场的控制凭证）。
  await ack.expectAcked(1)
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
      /* settings / progress 两屏挂载即确认投递授权（幂等，见 scanDeliveryAck）：
       * 没确认之前它们停在「正在确认投递授权」，landmark 根本不会出现。
       * start / result 不挂那两屏 —— 刻意不注册，一次确认都不该发生。 */
      const ack = stage === 'settings' || stage === 'progress'
        ? registerScanAck(page, api, { controlToken: REVOKE_CONTROL_TOKEN })
        : null
      const ackRequests = countRequests(page, 'POST', ACK_PATH)
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
      // 4) 投递确认只发生在真正挂起会话的那两屏，且带的是本机登记里那份控制凭证。
      if (ack) await ack.expectAcked(1)
      else expect(ackRequests()).toBe(0)
    })
  }
}

test('leaving the whole scan flow from the top bar revokes the server task once @kiosk', async ({ page, api }) => {
  registerShell(api)
  registerPrintScanHub(api)
  const revokes = recordRevokeRequests(page)
  const ack = registerScanAck(page, api, { controlToken: REVOKE_CONTROL_TOKEN })
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
  // 复水进来的这一场也确认过一次：本机不知道当初确认过没有，而 ACK 幂等。
  await ack.expectAcked(1)
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
  // 刻意不注册 ACK：清场已经落地，这份迟到的凭证只能用来撤销。
  const ackRequests = countRequests(page, 'POST', ACK_PATH)
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
  // 4) 也没有确认它：确认会让这条已经没人看着的任务在服务端变得可投递。
  expect(ackRequests()).toBe(0)
  await expect(page.getByText('扫描任务已创建', { exact: true })).toHaveCount(0)
})

// 反面用例：正常走完 settings → progress **不得**出现任何取消。
// 上面那道闸门如果写成「只要本页卸载就撤」，这条会当场红 ——
// 确认之后进入等待页，settings 同样会卸载，而那个任务正要被用户使用。
test('confirming the created session and entering the wait stage cancels nothing @kiosk', async ({ page, api }) => {
  registerShell(api)
  registerLegacyReadyDevice(api)
  const cancelRequests = countRequests(page, 'DELETE', `/api/v1/scan/sessions/${SCAN_TASK_ID}`)
  const ack = registerScanAck(page, api, { controlToken: CONTROL_TOKEN })
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
  // 两屏各确认一次：设置页建成后一次，等待页挂载时再一次。ACK 幂等，所以再问一次
  // 永远是对的 —— 等待页并不知道当初确认过没有（看门狗整页重载走的就是这条）。
  await ack.expectAcked(2)
})

test('giving up on polling revokes the server task instead of orphaning it @kiosk', async ({ page, api }) => {
  test.setTimeout(120_000)
  registerShell(api)
  const revokes = recordRevokeRequests(page)
  const ack = registerScanAck(page, api, { controlToken: REVOKE_CONTROL_TOKEN })
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
  // 「立即检查」只在拿到投递授权之后才画得出来，所以这条路径必然确认过、且只确认一次。
  await ack.expectAcked(1)
  expect(revokes()[0]?.['x-scan-session-control']).toBe(REVOKE_CONTROL_TOKEN)
})

// ── 丢弃之后终端恢复：不许把已撤销的任务接回来（2026-09-13） ──────────────────
//
// 上面那条「迟到的响应」用例钉住的是前半段：创建在飞时终端 fail-closed，响应回来把
// 任务撤掉、不回写本机登记。后半段一直没人跑过 —— 终端身份随后**恢复**了
// （续期换到新票，或从本机 Agent 重新取到引导票）。
//
// 创建 effect 的依赖就是终端会话状态，failed → ready 会让它再跑一次；而
// sessionPromiseRef 里那个 promise 已经 resolve 了。ready 分支把 terminalFailClosedRef
// 清成 false 之后若直接把这个 promise 重新挂上，闸门这一轮会全部判否
// （代次没变、页面没卸载、fail-closed 刚被清掉），于是一个**已经 DELETE 掉的任务**
// 被写成「扫描任务已创建」：编号上屏、控制凭证写回本机登记。用户照着屏上的编号去面板
// 上扫，扫出来的文件没有任何任务认领 —— 而这一刻页面说的是「已创建」。
//
// 终端状态全部由真实代码写：用例控制的只有「续期应答回什么」和「本机 Agent 取不取得到票」。

const RECOVERED_TERMINAL_TOKEN = 'recovered-terminal-session-token'
const ROTATED_TERMINAL_TOKEN = 'rotated-terminal-session-token'
/** 本机 Agent 桥接取票端点：E2E 构建里配了桥接令牌，fail-closed 之前一定会走一次。 */
const LOCAL_BOOT_TICKET_URL = 'http://127.0.0.1:9527/local/terminal-boot-ticket'

/** 用 terminalAuth 只在 E2E 构建挂出的测试缝发起一次**真实**续期（同十分钟定时器那一次）。 */
async function startTerminalSessionRefresh(page: Page): Promise<void> {
  await page.evaluate(() => {
    const hooks = (window as unknown as { __terminalSessionE2E?: { startRefresh: () => void } }).__terminalSessionE2E
    // 缺了测试缝就是构建没带 E2E 标记：必须当场失败，否则用例会退化成
    // 「会话一直是 ready」的假绿，钉不住任何状态迁移。
    if (!hooks) throw new Error('terminalAuth 的 E2E 测试缝缺失，无法驱动终端会话状态')
    hooks.startRefresh()
  })
}

async function terminalSessionStateOf(page: Page): Promise<string> {
  return page.evaluate(() => {
    const hooks = (window as unknown as { __terminalSessionE2E?: { state: () => string } }).__terminalSessionE2E
    return hooks ? hooks.state() : 'missing'
  })
}

test('a terminal session that recovers after the abandoned task was revoked never revives it @kiosk', async ({ page, api }) => {
  test.setTimeout(90_000)
  registerShell(api)
  const revokes = recordRevokeRequests(page)
  const createRequests = countRequests(page, 'POST', '/api/v1/scan/sessions')
  // 刻意不注册 ACK：这一场在创建还在飞时就被丢弃并撤掉了，终端身份恢复也不该接回来。
  const ackRequests = countRequests(page, 'POST', ACK_PATH)
  api.respond('DELETE', `/api/v1/scan/sessions/${SCAN_TASK_ID}`, {
    status: 200,
    json: { success: true, data: { scanTaskId: SCAN_TASK_ID, status: 'cancelled' } },
  })
  // 第一次续期：票已被吊销（401 按设计不重试，立即 fail-closed）；第二次：换到新票，终端恢复。
  api.respondWith('POST', '/api/v1/terminals/session-token/refresh', (requestNumber) => (
    requestNumber === 1
      ? {
          status: 401,
          json: { success: false, error: { code: 'TERMINAL_SESSION_INVALID', message: '终端安全会话无效' } },
        }
      : { status: 200, json: { sessionToken: RECOVERED_TERMINAL_TOKEN } }
  ))
  // 本机 Agent 取不到引导票 —— 第一次续期失败后就真的落到 fail-closed，
  // 而不是取决于这台开发机 / CI runner 的 9527 端口上有没有人在听。
  await page.route(LOCAL_BOOT_TICKET_URL, (route) => route.abort('connectionrefused'))

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

  // 创建还在飞的那一刻终端身份被吊销：页面据此对用户宣告失败。
  await startTerminalSessionRefresh(page)
  await expect(page.getByText('终端安全校验失败', { exact: true }).first()).toBeVisible({ timeout: 20_000 })
  expect(await terminalSessionStateOf(page), '换票 401 且本机 Agent 取不到票时必须 fail-closed').toBe('failed')

  // 迟到的创建响应：任务撤掉、不回写本机登记（已有闸门，先确认它成立，后半段才谈得上）。
  releaseCreate?.()
  await expect.poll(() => revokes().length).toBe(1)
  expect(revokes()[0]?.['x-scan-session-control']).toBe(CONTROL_TOKEN)

  // 终端身份恢复：这是本用例真正要钉的那一步。
  await startTerminalSessionRefresh(page)
  await expect.poll(() => terminalSessionStateOf(page)).toBe('ready')
  // 错误的写回是异步的（重新挂上的 then 要等一个微任务）：立刻断言只能证明「这一帧还没写」。
  await page.waitForTimeout(1_000)

  // 1) 页面不得把一个已经撤掉的任务宣告成功，也不得把编号上屏。
  await expect(page.getByText('扫描任务已创建', { exact: true })).toHaveCount(0)
  await expect(page.getByText(SCAN_TASK_ID, { exact: true })).toHaveCount(0)
  // 2) 已经对用户说过的失败结论仍然在屏上：恢复的是终端身份，不是这一场扫描。
  await expect(page.getByText('终端安全校验失败', { exact: true }).first()).toBeVisible()
  // 3) 作废的凭证不得写回本机登记 —— 写回去，下一次进 /scan 会复水到一个已被撤销的任务。
  const stored = await page.evaluate(() => window.sessionStorage.getItem('ai-job-print:current-scan-workbench') ?? '')
  expect(stored).not.toContain(SCAN_TASK_ID)
  expect(stored).not.toContain(CONTROL_TOKEN)
  // 4) 只撤一次；也不因为终端恢复就自动重建一场（页面已经宣告失败，重不重扫由用户决定）。
  expect(revokes()).toHaveLength(1)
  // 也一次都没确认过：确认会让一条已经撤掉的任务在服务端重新变得可投递。
  expect(ackRequests()).toBe(0)
  expect(createRequests(), '恢复不等于重建：这条路径上不许出现第二次创建').toBe(1)
})

// 反面用例：上面那道「丢弃即终局」的闸门不许误伤**正常的** checking → ready。
// 它如果写成「只要终端状态变过就不再创建」，这条会当场红：一体机每十分钟续一次票，
// 用户恰好在那一两秒里走到设置页，就再也建不出扫描会话了。
test('a create deferred by a terminal refresh still goes out once the new ticket is back @kiosk', async ({ page, api }) => {
  registerShell(api)
  const createRequests = countRequests(page, 'POST', '/api/v1/scan/sessions')
  const createHeaders: Array<Record<string, string>> = []
  // 确认走的是同一道终端身份闸门，所以它也必须带**换回来的那一张**票，
  // 不是「某一张非空的票」：带旧票发出去，服务端 401，这一场永远不会变得可投递。
  const ack = registerScanAck(page, api, {
    controlToken: CONTROL_TOKEN,
    terminalSessionToken: ROTATED_TERMINAL_TOKEN,
  })
  page.on('request', (request) => {
    if (request.method() !== 'POST') return
    if (new URL(request.url()).pathname !== '/api/v1/scan/sessions') return
    createHeaders.push(request.headers())
  })
  api.respond('POST', '/api/v1/scan/sessions', { status: 200, json: createdSession() })

  let openRefresh: () => void = () => undefined
  const refreshGate = new Promise<void>((resolve) => { openRefresh = resolve })
  let markRefreshArrived: () => void = () => undefined
  const refreshArrived = new Promise<void>((resolve) => { markRefreshArrived = resolve })
  api.respondWith('POST', '/api/v1/terminals/session-token/refresh', async () => {
    markRefreshArrived()
    await refreshGate
    return { status: 200, json: { sessionToken: ROTATED_TERMINAL_TOKEN } }
  })

  await page.goto('/scan/start')
  await startTerminalSessionRefresh(page)
  await refreshArrived
  expect(await terminalSessionStateOf(page), '续期在飞时会话状态必须真的是 checking').toBe('checking')

  await page.getByRole('button', { name: /下一步/ }).click()
  await page.waitForURL(/\/scan\?stage=settings/)
  // 换票没出结果之前：不抢跑创建请求（抢跑只会拿回 401），也不谎称正在建扫描会话。
  await expect(page.getByText('正在做终端安全校验', { exact: true }).first()).toBeVisible()
  expect(createRequests(), '终端会话还在换票时不许发创建请求').toBe(0)

  openRefresh()
  await expect(page.getByText('扫描任务已创建', { exact: true })).toBeVisible()
  expect(createRequests(), '换票回来之后补发且只发一次').toBe(1)
  // 补发的这一次必须带换回来的新票：带旧票发出去，后端照样 401。
  expect(createHeaders[0]?.['x-terminal-session-token']).toBe(ROTATED_TERMINAL_TOKEN)
  // 补发的创建之后紧跟着确认，它走的是同一道终端身份闸门，同样要带换回来的新票。
  await ack.expectAcked(1)
})

/* ══ 一次确认失败之后，屏幕上说的是不是实话（2026-09-14） ═══════════════════════
 *
 * `scanDeliveryAck` 那份纯函数用例已经把「哪些码算确定结论」逐条跑过了，但它证明不了
 * 这一层：**页面拿到那个结论之后做了什么**。判错的两个方向在屏幕上代价不对称 ——
 *
 *   · 把「没确认」画成「已确认」→ 用户照着面板指引扫一张纸，那份文件在服务端不会
 *     投给任何会话，人在机器前白等到轮询上限，屏幕全程一句解释都没有；
 *   · 把「服务端明确不认」画成「再试试」→ 页面对着一场自己根本碰不到的会话一直重试，
 *     而那条任务还占着这台终端的活动会话。
 *
 * 所以下面三条都走真实的设置页接线（真发创建、真发确认、真看 CTA 和指引），
 * 并且各自钉住「撤没撤」这一件最容易被文案掩盖的事：确定结论必须撤，
 * 不确定结论**必须不撤**（撤了就把一场服务端并没有拒绝的会话白白作废）。 */

/** 设置页四样「可以去面板操作了」的证据。一条都不许出现在没确认的那几屏上。 */
async function expectNoPanelGuidance(page: Page): Promise<void> {
  await expect(page.getByText('扫描任务已创建', { exact: true })).toHaveCount(0)
  await expect(page.getByText('服务端指引：第一步', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '我已操作，开始等待' })).toHaveCount(0)
  await expect(page.getByText(SCAN_TASK_ID, { exact: true })).toHaveCount(0)
}

test('a definitive ack refusal revokes the session and offers a plain restart, not a retry @kiosk', async ({ page, api }) => {
  registerShell(api)
  registerLegacyReadyDevice(api)
  const createRequests = countRequests(page, 'POST', '/api/v1/scan/sessions')
  const ackRequests = countRequests(page, 'POST', ACK_PATH)
  const revokes = recordRevokeRequests(page)
  api.respond('POST', '/api/v1/scan/sessions', { status: 200, json: createdSession() })
  // 服务端明确不认这一场：任务不是未过期的 waiting/matched，再问一百次也是同一个答案。
  api.respond('POST', ACK_PATH, {
    status: 409,
    json: { success: false, error: { code: 'SCAN_TASK_ACK_NOT_ALLOWED', message: '当前扫描任务状态不允许确认投递' } },
  })
  api.respond('DELETE', `/api/v1/scan/sessions/${SCAN_TASK_ID}`, {
    status: 200,
    json: { success: true, data: { scanTaskId: SCAN_TASK_ID, status: 'cancelled' } },
  })

  await enterSettingsFromVisibleStart(page)

  // ① 屏幕如实说这一场没拿到投递授权，并且**明说别去面板按开始**。
  await expect(page.getByText('这次扫描会话没能取得投递授权', { exact: true }).first()).toBeVisible()
  await expect(page.getByText(/现在请先别在面板上按开始/).first()).toBeVisible()
  await expectNoPanelGuidance(page)

  // ② 出路只有「重新开始一次扫描」。这一屏上「再确认一次」是错的主行动：
  //    服务端已经把话说死了，再问只会拿回同一个 409。
  await expect(page.getByRole('button', { name: '重新开始一次扫描', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '再确认一次' })).toHaveCount(0)

  // ③ 服务端那条任务必须被撤掉，且用的是本机手里那份控制凭证。
  //    只改屏幕不撤任务的话，它会留在终端上占住活动会话。
  await expect.poll(() => revokes().length).toBe(1)
  expect(revokes()[0]?.['x-scan-session-control']).toBe(CONTROL_TOKEN)

  // ④ 本机登记里那一场也必须抹掉：留着它，看门狗整页重载之后会复水成「有会话」。
  const stored = await page.evaluate(() => window.sessionStorage.getItem('ai-job-print:current-scan-workbench') ?? '')
  expect(stored).not.toContain(CONTROL_TOKEN)

  // ⑤ 确定结论不许自动重来：既不重发确认，也不顺手再建一场
  //    （页面刚对用户宣告过结论，重不重开由他自己按那颗按钮决定）。
  await page.waitForTimeout(1_500)
  expect(ackRequests()).toBe(1)
  expect(createRequests()).toBe(1)
})

test('a retryable ack failure keeps the session, says so honestly, and recovers on retry @kiosk', async ({ page, api }) => {
  registerShell(api)
  registerLegacyReadyDevice(api)
  const ackRequests = countRequests(page, 'POST', ACK_PATH)
  const revokes = recordRevokeRequests(page)
  api.respond('POST', '/api/v1/scan/sessions', { status: 200, json: createdSession() })
  /* 第一次 5xx（服务端并没有拒绝这一场），第二次成功。
   * 「再确认一次」按下去必须真的能把人救回来 —— 只画一颗按不出结果的按钮，
   * 等于把用户困在一屏没有出路的诊断里。 */
  let ackAttempts = 0
  api.respondWith('POST', ACK_PATH, async () => {
    ackAttempts += 1
    if (ackAttempts === 1) {
      return { status: 500, json: { success: false, error: { code: 'INTERNAL_ERROR', message: '服务异常' } } }
    }
    return { status: 200, json: { success: true, data: { scanTaskId: SCAN_TASK_ID, deliveryAckedAt: DELIVERY_ACKED_AT } } }
  })

  await enterSettingsFromVisibleStart(page)

  // ① 不把话说死：会话确实建成了，缺的只是那一次确认。
  await expect(page.getByText('还没确认这台机器能收这份文件', { exact: true }).first()).toBeVisible()
  await expect(page.getByText(/现在按开始只会白扫一张纸/).first()).toBeVisible()
  await expectNoPanelGuidance(page)

  // ② 出路是「再确认一次」，不是「重新开始一次扫描」：重开一场只会白建一条任务。
  await expect(page.getByRole('button', { name: '再确认一次', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '重新开始一次扫描' })).toHaveCount(0)

  // ③ **不许撤**。服务端没有拒绝这一场，它仍然停在不可投递，谁都收不到那张纸；
  //    这时候撤掉等于把一场还能救回来的会话白白作废。
  await page.waitForTimeout(1_000)
  expect(revokes(), '不确定的失败不是拒绝：撤掉它等于替服务端做了它没做的决定').toHaveLength(0)
  expect(ackRequests(), '不确定的失败也不许自动重发：重发由用户按那颗按钮触发').toBe(1)

  // ④ 用户按下「再确认一次」：这一次成功，指引与「我已操作」才随之上屏。
  await page.getByRole('button', { name: '再确认一次', exact: true }).click()
  await expect(page.getByText('扫描任务已创建', { exact: true })).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('服务端指引：第一步', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '我已操作，开始等待' })).toBeVisible()
  await expect.poll(ackRequests).toBe(2)
  expect(revokes()).toHaveLength(0)
})

test('a 2xx ack without a delivery timestamp is not treated as confirmed @kiosk', async ({ page, api }) => {
  registerShell(api)
  registerLegacyReadyDevice(api)
  const ackRequests = countRequests(page, 'POST', ACK_PATH)
  const revokes = recordRevokeRequests(page)
  api.respond('POST', '/api/v1/scan/sessions', { status: 200, json: createdSession() })
  /* 200 但回执里没有那一笔 deliveryAckedAt。
   *
   * 这是最容易被放过去的一种：只看 HTTP 状态码的实现会当场放行，把用户支到面板上，
   * 而服务端那条任务此刻仍然不可投递 —— 他扫出来的纸不会进任何会话。
   * 放行的判据必须是「服务端真的写下了那一笔」。 */
  api.respond('POST', ACK_PATH, {
    status: 200,
    json: { success: true, data: { scanTaskId: SCAN_TASK_ID } },
  })

  await enterSettingsFromVisibleStart(page)

  await expect(page.getByText('还没确认这台机器能收这份文件', { exact: true }).first()).toBeVisible()
  await expectNoPanelGuidance(page)
  // 空回执不是「服务端明确不认」，所以出路仍然是再问一次，而且不许撤这一场。
  await expect(page.getByRole('button', { name: '再确认一次', exact: true })).toBeVisible()
  await page.waitForTimeout(1_000)
  expect(revokes(), '空回执证明不了服务端拒绝，不许据此撤掉用户的会话').toHaveLength(0)
  expect(ackRequests()).toBe(1)
})

test('the wait page tells the truth when the ack is definitively refused @kiosk', async ({ page, api }) => {
  registerShell(api)
  const revokes = recordRevokeRequests(page)
  const ackPath = `/api/v1/scan/sessions/${SCAN_TASK_ID}/ack`
  const ackRequests = countRequests(page, 'POST', ackPath)
  /* 等待页几乎总是从设置页确认成功之后走过来的，但看门狗整页重载会让它凭
   * sessionStorage 里那份 live 直接挂起来 —— 那一场可能早就过期或被撤掉了。
   * 这一屏此刻绝不能继续说「请在打印机面板完成扫描」：那是假话。 */
  api.respond('POST', ackPath, {
    status: 409,
    json: { success: false, error: { code: 'SCAN_TASK_ACK_NOT_ALLOWED', message: '当前扫描任务状态不允许确认投递' } },
  })
  api.respond('DELETE', `/api/v1/scan/sessions/${SCAN_TASK_ID}`, {
    status: 200,
    json: { success: true, data: { scanTaskId: SCAN_TASK_ID, status: 'cancelled' } },
  })
  /* 等待页挂载即开轮询（和确认并行，互不依赖）。给一个「还在等」的诚实回答：
   * 这条用例要证明的是**确认被拒**这一支改判了这一屏，不是轮询替它改的判。 */
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

  await page.goto('/scan')
  await seedLiveScanSession(page, 'progress')
  await page.goto('/scan?stage=progress')

  // ① 如实落一个失败结果，不在这一屏继续假装还在等文件。
  await expect(page.getByText(/服务端没有给这一场投递授权/).first()).toBeVisible({ timeout: 10_000 })
  // ② 这一屏绝不许再出现那句把人支到面板上的话。
  await expect(page.getByText(/请在打印机面板完成扫描/)).toHaveCount(0)
  // ③ 服务端那条任务被撤掉（localGiveUp），用的是本机登记里那份控制凭证。
  await expect.poll(() => revokes().length).toBe(1)
  expect(revokes()[0]?.['x-scan-session-control']).toBe(REVOKE_CONTROL_TOKEN)
  // ④ 确定结论不许自动重发确认。
  await page.waitForTimeout(1_000)
  expect(ackRequests()).toBe(1)
})

// ── 凭据没能真正落进本机登记（2026-09-14 P1）─────────────────────────────────
//
// 设置页原先的顺序是：`patchScanWorkbenchSession({ live })` → 立刻 ACK。可那一句
// 是 void 的，底下的 `saveScanWorkbenchSession` 把 `setItem` 的异常吞掉了 ——
// 而更糟的一种是**根本不抛**：隐私模式、配额写满、被扩展改写过的 sessionStorage
// 都可能静默什么也不做。两种情况下页面都照旧往下走，把 ACK 发出去。
//
// ACK 一成功，服务端那条任务就变得可投递（deliveryAckedAt 非空，60 秒未确认回收器
// 再也收不到它），而本机其实一个字节都没记住：看门狗整页重载之后没有任何界面找得回
// 这一场，它会一直可投递到自然过期 —— 下一位走到面板前按下扫描，文件投给上一位。
// 这正是 ACK 这道闸本来要消灭的那种收件箱，只是换了一条路重新长出来。
//
// 所以放行判据改成了「写完读回来还是同一串字节」（patchScanWorkbenchSessionWithDurableLive）。
// 这条用例在**创建响应刚回来、正要落盘**的那一点上把写入静默掐掉，钉住四件事：
// 一个 ACK 都不发、刚建的那条任务被撤掉、屏上不出现任何「已创建 / 去面板操作」、
// 本机不留下任何凭据。

/** 只掐带 live 的那一笔写入，其余照写 —— 这样「读回来对不上」不会被误读成「存储整个坏了」。 */
async function silenceLiveSessionWrites(page: Page): Promise<void> {
  await page.addInitScript((sessionKey) => {
    const originalSetItem = Storage.prototype.setItem
    Storage.prototype.setItem = function setItem(key: string, value: string): void {
      // 静默丢弃（刻意不抛）：真实环境里配额写满 / 被扩展改写过的 storage 就是这样，
      // 而 try/catch 对它一个字都读不到。抛异常那一支由单元测试覆盖。
      if (key === sessionKey && String(value).includes('"live"')) return
      originalSetItem.call(this, key, value)
    }
  }, 'ai-job-print:current-scan-workbench')
}

test('a created session whose credentials never reach storage is revoked, never acked @kiosk', async ({ page, api }) => {
  await silenceLiveSessionWrites(page)
  registerShell(api)
  registerLegacyReadyDevice(api)
  const createRequests = countRequests(page, 'POST', '/api/v1/scan/sessions')
  const createHeaders: Array<Record<string, string>> = []
  page.on('request', (request) => {
    if (request.method() !== 'POST') return
    if (new URL(request.url()).pathname !== '/api/v1/scan/sessions') return
    createHeaders.push(request.headers())
  })
  // 刻意**不注册** ACK：一次都不该发生。ApiRouter 对未注册请求一律 abort 并在拆卸时
  // 报 Unhandled API，所以就算下面的计数被改坏，这一层也会把它抓出来。
  const ackRequests = countRequests(page, 'POST', ACK_PATH)
  const revokes = recordRevokeRequests(page)
  api.respond('POST', '/api/v1/scan/sessions', { status: 200, json: createdSession() })
  api.respond('DELETE', `/api/v1/scan/sessions/${SCAN_TASK_ID}`, {
    status: 200,
    json: { success: true, data: { scanTaskId: SCAN_TASK_ID, status: 'cancelled' } },
  })

  await enterSettingsFromVisibleStart(page)

  // ① 如实说「本机没能记住」，并且这一屏是**结论**，不是还在加载。
  await expect(page.getByText('本机没能记住这次扫描会话', { exact: true }).first()).toBeVisible()
  await expect(page.getByTestId('scan-live-not-durable-notice')).toBeVisible()
  await expect(page.getByText(/先别在面板上按开始/).first()).toBeVisible()

  // ② 屏上一个字都不许出现「已创建 / 去面板操作」。
  await expectNoPanelGuidance(page)
  await expect(page.getByText(CONTROL_TOKEN, { exact: false })).toHaveCount(0)

  // ③ 刚建的那条任务必须被撤掉，用的是本机手里那份控制凭证 + **创建时那个身份**
  //    （服务端 cancel() 按 endUserId 校验；身份对不上只会 403 —— 看起来撤了，其实没撤）。
  await expect.poll(() => revokes().length).toBe(1)
  expect(revokes()[0]?.['x-scan-session-control']).toBe(CONTROL_TOKEN)
  expect(revokes()[0]?.['x-terminal-id']).toBe('KSK-001')
  expect(revokes()[0]?.authorization ?? null).toBe(createHeaders[0]?.authorization ?? null)

  // ④ 一个 ACK 都没发。这是这条修复的要害：ACK 一成功那条任务就可投递了，
  //    而本机根本没记住它 —— 那就是一个没有任何界面在看着的收件箱。
  await page.waitForTimeout(1_000)
  expect(ackRequests(), '没记住凭据就不许确认投递授权').toBe(0)

  // ⑤ 本机不留任何凭据；也没有被复水回来的 live。
  const stored = await page.evaluate(() => window.sessionStorage.getItem('ai-job-print:current-scan-workbench') ?? '')
  expect(stored).not.toContain(SCAN_TASK_ID)
  expect(stored).not.toContain(CONTROL_TOKEN)
  expect(stored).not.toContain('"live"')
  // 阳性对照：不带 live 的那一笔写照样落了盘 —— 所以上面那些 false 是「这一场没记住」，
  // 不是「这台机器的 storage 整个坏了，什么都写不进去」。
  expect(stored).toContain('"scanType":"resume"')

  // ⑥ 不自动重建：重来一次只会在同一处再失败，还多留一条要撤的服务端任务。
  //    这一屏因此也不给「重新开始一次扫描」，只给安全返回 + 叫工作人员。
  expect(createRequests(), '存储写不进去时不许自动再建一场').toBe(1)
  await expect(page.getByRole('button', { name: '重新开始一次扫描', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '再确认一次' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '安全返回扫描首页', exact: true })).toBeVisible()
  // 那颗禁用按钮也不许说「未创建扫描任务」：任务**建过**，随后被本页撤掉了。
  await expect(page.getByRole('button', { name: '本机存储不可用，无法建会话', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: '未创建扫描任务' })).toHaveCount(0)
})
