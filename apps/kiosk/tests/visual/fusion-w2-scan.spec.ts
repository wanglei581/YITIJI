import type { Locator, Page, Route } from '@playwright/test'
import type { ApiRouter } from '../fixtures/api-router'
import { test, expect } from '../fixtures/kiosk-test'
import { assertNoHorizontalOverflow, assertQxPillReadable, assertTapTargetPointerHit } from './assert-layout'
import { setReactRouterState, writeScanWorkbenchSession, SCAN_WORKBENCH_SESSION_KEY, W2_FILE } from './fixtures/fusion-w2-state'
import { FusionW2BinaryRoute } from './fixtures/fusion-w2-binary-route'

const SCAN_TASK_ID = 'w2-scan-001'
const CONTROL_TOKEN = 'w2-scan-control'
const LATER = new Date(Date.now() + 10 * 60 * 1000).toISOString()

function collectRuntimeErrors(page: Page, ignoredDocumentPath?: string): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
  page.on('requestfailed', (request) => {
    if (request.resourceType() === 'document' && new URL(request.url()).pathname === ignoredDocumentPath) return
    if (['document', 'script', 'stylesheet'].includes(request.resourceType())) {
      errors.push(`${request.resourceType()}: ${request.url()} (${request.failure()?.errorText ?? 'unknown'})`)
    }
  })
  return errors
}

function registerShell(api: ApiRouter): void {
  api.respond('GET', '/api/v1/terminals/KSK-001/screensaver', {
    status: 200,
    json: { enabled: false, idleTimeoutSec: 180, items: [] },
  })
  api.respond('GET', '/api/v1/terminals/KSK-001/printer-status', {
    status: 200,
    json: { printerStatus: 'ready', paperLevel: 'sufficient', isOnline: true },
  })
  // ScanStart 深链/取消回退可能拉取能力；默认空覆盖 = managed 未配置放行。
  api.respond('GET', '/api/v1/terminals/KSK-001/capabilities', {
    status: 200,
    json: { capabilities: [] },
  })
}

function registerScanCapability(
  api: ApiRouter,
  status: 'available' | 'maintenance' | 'not_verified' = 'available',
  note: string | null = null,
): void {
  api.respond('GET', '/api/v1/terminals/KSK-001/capabilities', {
    status: 200,
    json: {
      capabilities: [
        {
          capabilityKey: 'scan',
          status,
          note,
          configured: true,
          updatedAt: new Date().toISOString(),
        },
      ],
    },
  })
}

async function expectHealthy(page: Page, errors: string[]): Promise<void> {
  const path = new URL(page.url()).pathname
  if (path === '/scan' || path.startsWith('/scan/')) {
    await expect(page.locator('[data-qx-frame="true"]').first()).toBeVisible()
    await expect(page.locator('[data-qx-page="scan-workbench"]').first()).toBeVisible()
  } else {
    await expect(page.locator('[data-kiosk-presentation="fusion-youth"]').first()).toBeVisible()
  }
  await assertNoHorizontalOverflow(page)
  expect(errors).toEqual([])
}

async function expectPdfCompleted(binary: FusionW2BinaryRoute): Promise<void> {
  await expect.poll(() => {
    try {
      binary.assertPdfCompleted()
      return true
    } catch {
      return false
    }
  }).toBe(true)
}

function registerCreatedScan(api: ApiRouter): void {
  api.respond('POST', '/api/v1/scan/sessions', {
    status: 200,
    json: {
      success: true,
      data: {
        scanTaskId: SCAN_TASK_ID,
        controlToken: CONTROL_TOKEN,
        status: 'waiting',
        scanType: 'resume',
        instructions: ['放好原件', '在打印机面板开始扫描'],
        expiresAt: LATER,
      },
    },
  })
  api.respond('DELETE', `/api/v1/scan/sessions/${SCAN_TASK_ID}`, {
    status: 200,
    json: { success: true, data: { scanTaskId: SCAN_TASK_ID, status: 'cancelled' } },
  })
}

// ── 投递确认（ACK）（2026-09-14） ─────────────────────────────────────────────
//
// 服务端把「建成」和「可投递」拆成了两段：新建会话一律 `deliveryAckedAt = null`，
// 只有本机确认自己握着这一场的控制凭据之后，面板上扫出来的文件才会投给它
// （契约见 src/pages/scan/scanDeliveryAck.ts）。设置页与等待页因此**挂载即确认**：
// 确认之前设置页停在「正在确认投递授权」而不出「在打印机面板开始扫描」，
// 等待页的标题是「正在确认投递授权」而不是「等待打印机端扫描完成」，
// 主行动也从「立即检查」换成「再确认一次」。
//
// 所以本文件里凡是会走到这两屏的用例，都必须**自己**把这个端点注册上。
// 仍然逐条用例注册、**不挂兜底路由**：ApiRouter 对未注册请求一律 abort 并在拆卸时
// 报 Unhandled API，而「这几条路径上一次确认都不许发生」（能力不可用、直达设置页、
// U 盘面板、结果页）正是这一层要钉的东西 —— 一条 catch-all 会把它们全部悄悄变绿。

/** 这一场 ACK 端点的路径。反面用例只数它，不注册它。 */
const ACK_PATH = `/api/v1/scan/sessions/${SCAN_TASK_ID}/ack`
/** 服务端写下投递授权的那一刻。固定值：用例断言的是「确认过」，不是具体几点。 */
const DELIVERY_ACKED_AT = '2026-09-14T00:00:00.000Z'
// playwright.w2.config.ts 的 webServer 用 VITE_E2E_MOCK_TERMINAL_SESSION_TOKEN 构建出这个值，
// terminalAuth 在 E2E 构建下拿它当终端会话票。逐字对齐它而不是只判非空：判非空的话，
// 只要将来有谁往请求里塞了同名但无关的头，用例照样绿。
const TERMINAL_SESSION_FIXTURE = 'playwright-terminal-session-fixture'

interface ScanAckProbe {
  /** 到此刻为止确认过几次。 */
  count: () => number
  /**
   * 断言恰好确认过 `count` 次，且**每一次**都带齐服务端要校验的三样凭据、且不带 body。
   *
   * 只 respond 不看请求的话，「本机漏带凭据」在这里永远不会红：真实服务端回的是
   * 401（没有终端会话票 / 终端 id）或 403（控制凭据对不上），而一份只按路径应答的
   * 夹具会照样回 200，页面照样把「已确认」画出来。
   */
  expectAcked: (count: number) => Promise<void>
}

/**
 * 注册这一场的投递确认端点（**按 taskId 精确注册**，不是通配），并记下每一次的请求。
 *
 * 服务端在这个端点上同时校验终端会话票（TerminalIdentityGuard）、`x-terminal-id`
 * 归属，以及这一场的 `X-Scan-Session-Control`（见 scan-tasks.controller.ts 的 `ack()`
 * 与 src/services/api/scanTasks.ts 的 `ackScanSession`）。三样都记下来交给用例断言。
 */
function registerScanAck(page: Page, api: ApiRouter): ScanAckProbe {
  const calls: Array<{ headers: Record<string, string>; postData: string | null }> = []
  page.on('request', (request) => {
    if (request.method() !== 'POST') return
    if (new URL(request.url()).pathname !== ACK_PATH) return
    calls.push({ headers: request.headers(), postData: request.postData() })
  })
  api.respond('POST', ACK_PATH, {
    status: 200,
    json: { success: true, data: { scanTaskId: SCAN_TASK_ID, deliveryAckedAt: DELIVERY_ACKED_AT } },
  })
  return {
    count: () => calls.length,
    expectAcked: async (count) => {
      await expect.poll(() => calls.length, {
        message: `期望恰好确认 ${count} 次投递授权`,
      }).toBe(count)
      /* 数到了还要停一下再数一次。`expect.poll` 一够数就返回，而这条断言要钉的恰恰是
       * 「不会再多」：确认 effect 与创建 effect 曾经能互相喂招，把刚确认好的 'acked'
       * 打回 'pending' 并永不停（ackRequestedForRef 守的就是它）。那种循环的头几次
       * 正好就是正确次数，不停一下的话它每次都绿。 */
      await page.waitForTimeout(400)
      expect(calls.length, `确认了 ${calls.length} 次，多出来的是 effect 在互相喂招`).toBe(count)
      for (const call of calls) {
        expect(call.headers['x-terminal-id']).toBe('KSK-001')
        expect(call.headers['x-terminal-session-token']).toBe(TERMINAL_SESSION_FIXTURE)
        expect(call.headers['x-scan-session-control']).toBe(CONTROL_TOKEN)
        // 服务端这个端点一个 body 字段都不读（@Param + 两个 @Headers）。凭据写进 body
        // 就会被网关 / 访问日志原样留下，而 header 那条路是刻意选的（同 controlToken
        // 不进 query string 的理由）。所以「没有 body」本身是契约的一部分。
        expect(call.postData, 'ACK 的凭据只走请求头，不许出现在请求体里').toBeNull()
      }
    },
  }
}

function scanFile() {
  return {
    fileId: 'w2-scan-file',
    filename: 'w2-scan.pdf',
    sizeBytes: 131072,
    mimeType: 'application/pdf',
    sha256: 'b'.repeat(64),
    fileUrl: W2_FILE.fileUrl,
  }
}

async function seedScanLive(page: Page, extras: Record<string, unknown> = {}): Promise<void> {
  await page.goto('/scan')
  await writeScanWorkbenchSession(page, {
    stage: 'progress',
    scanType: 'resume',
    live: {
      scanTaskId: SCAN_TASK_ID,
      controlToken: CONTROL_TOKEN,
      instructions: ['放好原件', '在打印机面板开始扫描'],
      expiresAt: LATER,
    },
    ...extras,
  })
}

async function seedScanResult(page: Page, result: Record<string, unknown>): Promise<void> {
  // 必须显式请求 start：裸 `/scan` 会沿用 sessionStorage 里上一步的 stage，
  // 若那是 progress + live，进度页就会挂载并开始轮询——轮询回调会 patch 同一个
  // sessionStorage 键，和下面这次写入抢，慢机器上把种进去的 result 冲掉。
  // 表现是 30 行开外一句 `getByText('w2-scan.pdf')` 找不到元素，极难归因。
  await page.goto('/scan?stage=start')
  await writeScanWorkbenchSession(page, {
    stage: 'result',
    scanType: typeof result.scanType === 'string' ? result.scanType : 'resume',
    extras: {
      source: result.source,
      pageMode: result.pageMode,
      color: result.color,
      dpi: result.dpi,
    },
    result: {
      outcome: result.outcome ?? (result.success === true ? 'completed' : 'failed'),
      success: result.success === true,
      reason: result.reason,
      file: result.file,
    },
  })
  // 写完当场核一次：万一还是被别的写入冲掉，就在这里失败并说清原因，
  // 而不是让调用方在 30 行开外收到一句「元素找不到」。
  await expect
    .poll(async () => page.evaluate((key) => {
      try {
        const raw = window.sessionStorage.getItem(key)
        return raw ? (JSON.parse(raw) as { stage?: string }).stage ?? null : null
      } catch {
        return null
      }
    }, SCAN_WORKBENCH_SESSION_KEY), { message: '种进去的 result 阶段被别的写入冲掉了' })
    .toBe('result')
}

function scanStatus(status: 'waiting' | 'completed') {
  return {
    success: true,
    data: {
      scanTaskId: SCAN_TASK_ID,
      status,
      scanType: 'resume',
      file: status === 'completed' ? scanFile() : null,
      errorCode: null,
      errorMessage: null,
      expiresAt: LATER,
    },
  }
}

async function routeExact(
  page: Page,
  method: string,
  path: string,
  handler: (route: Route) => Promise<void>,
): Promise<void> {
  await page.route(`**${path}`, async (route) => {
    if (route.request().method() !== method || new URL(route.request().url()).pathname !== path) {
      await route.fallback()
      return
    }
    await handler(route)
  })
}

test('scan start creates only after explicit continuation @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  registerScanCapability(api, 'available')
  registerCreatedScan(api)
  // 建成之后设置页立刻确认投递授权；确认到 'acked' 之前那句面板指引不许出现。
  const ack = registerScanAck(page, api)
  let legacyDeviceRequests = 0
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/v1/kiosk/device/status') legacyDeviceRequests += 1
  })

  await page.goto('/scan/start')
  await expect(page.getByText(/下一步会创建真实扫描会话/).first()).toBeVisible()
  await expect(page.getByText('可创建扫描任务 · 需面板操作', { exact: true })).toBeVisible()
  const next = page.getByRole('button', { name: /下一步 · 创建扫描会话/ })
  await expect(next).toBeEnabled()
  // 稿 18：底部三列口径是一次性说明，只在选类型这一屏出现，后面各屏不复读。
  await expect(page.getByTestId('scan-workbench-truth')).toBeVisible()
  expect(legacyDeviceRequests).toBe(0)
  const createRequest = page.waitForRequest((request) =>
    request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/scan/sessions',
  )
  await next.click()
  const posted = await createRequest
  const postedBody = posted.postDataJSON() as { scanType?: string; terminalId?: string }
  expect(postedBody.scanType).toBe('resume')
  expect(postedBody.terminalId, 'create session must bind the current terminal').toBeTruthy()
  await page.waitForURL(/\/scan\?stage=settings/)
  await expect(page.getByText('在打印机面板开始扫描', { exact: true })).toBeVisible()
  await expect(page.getByTestId('scan-workbench-truth')).toHaveCount(0)
  // 这一场只建了一次，所以也只确认一次；多出来的一次意味着确认与创建两个 effect
  // 互相喂招（ackRequestedForRef 守的就是它）。
  await ack.expectAcked(1)
  await expectHealthy(page, errors)
})

test('scan start blocks continuation while scan capability is unavailable @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  registerScanCapability(api, 'maintenance', '扫描仪正在保养')

  await page.goto('/scan/start')
  await expect(page.getByText('扫描能力暂未开放', { exact: true }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: /下一步 · 创建扫描会话/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '改用上传文件打印' })).toBeVisible()
  await expectHealthy(page, errors)
})

test('direct scan settings access does not create a session @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)

  await page.goto('/scan/settings')
  await expect(page.getByText('未创建扫描任务', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('扫描任务已创建', { exact: true })).toHaveCount(0)
  await expect(page.getByText('任务编号', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /安全返回扫描首页/ }).first()).toBeVisible()
  await expectHealthy(page, errors)
})

test('scan settings uses server instructions and waiting-to-completed polling reaches result @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  registerCreatedScan(api)
  // 设置页建成后确认一次；按下「我已操作，开始等待」切到等待页，那一屏挂载时再确认一次
  // （幂等，见 scanDeliveryAck）。没有第二次的话等待页会停在「正在确认投递授权」。
  const ack = registerScanAck(page, api)
  let polls = 0
  await routeExact(page, 'GET', `/api/v1/scan/sessions/${SCAN_TASK_ID}`, async (route) => {
    const body = scanStatus(polls++ === 0 ? 'waiting' : 'completed')
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })

  const previewPaths: string[] = []
  page.on('request', (request) => {
    previewPaths.push(new URL(request.url()).pathname)
  })
  await page.goto('/scan?stage=settings')
  await setReactRouterState(page, '/scan?stage=settings', { scanType: 'resume' })
  await expect(page.getByText('在打印机面板开始扫描', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '我已操作，开始等待' }).click()
  await page.waitForURL(/\/scan\?stage=result/, { timeout: 8_000 })
  await expect(page.getByText('w2-scan.pdf', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => window.sessionStorage.getItem('w2-scan-control'))).toBeNull()
  await expect(page.locator('[data-file-preview-kind="pdf"]').locator('iframe')).toHaveAttribute('src', W2_FILE.fileUrl)
  expect(previewPaths.some((path) => path.includes('/preview-url'))).toBe(false)
  // 设置页一次 + 等待页挂载一次。结果页不确认 —— 这一场已经结束，再确认只会拿回 409。
  await ack.expectAcked(2)
  await expectHealthy(page, errors)
})

test('cancel-completed race rechecks status and recovers the real scan file @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  // 等待页是复水进来的（seedScanLive 直接写登记），挂载时本机并不知道当初确认过没有，
  // 所以照样确认一次。
  const ack = registerScanAck(page, api)
  let cancelled = false
  await routeExact(page, 'GET', `/api/v1/scan/sessions/${SCAN_TASK_ID}`, async (route) => {
    const body = scanStatus(cancelled ? 'completed' : 'waiting')
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
  await routeExact(page, 'DELETE', `/api/v1/scan/sessions/${SCAN_TASK_ID}`, async (route) => {
    cancelled = true
    await route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({ success: false, error: { code: 'SCAN_TASK_ALREADY_COMPLETED', message: '扫描已完成' } }),
    })
  })

  await seedScanLive(page)
  await page.goto('/scan?stage=progress')
  await page.getByRole('button', { name: '取消扫描' }).click()
  await page.waitForURL(/\/scan\?stage=result/)
  await expect(page.getByText('w2-scan.pdf', { exact: true })).toBeVisible()
  // 等待页挂载那一次。走到结果页之后不许再确认。
  await ack.expectAcked(1)
  await expectHealthy(page, errors)
})

const resultState = {
  scanType: 'resume',
  success: true,
  file: {
    fileId: 'w2-scan-file',
    fileUrl: W2_FILE.fileUrl,
    name: 'w2-scan.pdf',
    size: '128 KB',
    pages: 2,
    format: 'PDF',
    mimeType: 'application/pdf',
  },
}

test('successful scan result can continue to printing @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page, new URL(W2_FILE.fileUrl, 'http://fixture.local').pathname)
  const binary = new FusionW2BinaryRoute(page)
  await binary.install()
  registerShell(api)
  api.respond('GET', '/api/v1/print/price-config', {
    status: 200,
    json: { billingEnabled: true, items: [{ serviceKey: 'print_bw_page', unitCents: 100, unit: 'page', description: '黑白打印' }] },
  })
  api.respond('POST', '/api/v1/orders/quote', {
    status: 200,
    json: {
      amountCents: 200,
      billablePages: 2,
      billingPageSource: 'detected',
      priceLines: [
        {
          serviceKey: 'print_bw_page',
          description: '黑白打印',
          unitCents: 100,
          quantity: 2,
          amountCents: 200,
        },
      ],
    },
  })

  await seedScanResult(page, resultState)
  await page.goto('/scan?stage=result')
  const preview = page.locator('[data-file-preview-kind="pdf"]')
  await expect(preview).toBeVisible()
  await expect(preview.locator('iframe')).toHaveAttribute('src', W2_FILE.fileUrl)
  await expectPdfCompleted(binary)
  const quoteResponse = page.waitForResponse((response) =>
    response.request().method() === 'POST'
      && new URL(response.url()).pathname === '/api/v1/orders/quote',
  )
  await page.getByRole('button', { name: /直接打印/ }).first().click()
  await page.waitForURL('**/print/confirm')
  await quoteResponse
  await expect(page.locator('[data-w2-page="print-confirm"]')).toBeVisible()
  await expect(page.getByText('¥1.00/页 × 2 页', { exact: true })).toBeVisible()
  await expect(page.locator('[data-w2-page="print-confirm"] .print-file-name')).toHaveText('w2-scan.pdf')
  await expectHealthy(page, errors)
})

test('successful resume scan can continue to AI parsing @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page, new URL(W2_FILE.fileUrl, 'http://fixture.local').pathname)
  const binary = new FusionW2BinaryRoute(page)
  await binary.install()
  registerShell(api)
  api.respond('POST', '/api/v1/resume/parse', {
    status: 503,
    json: { success: false, error: { code: 'W2_STOP_AFTER_NAV', message: 'synthetic stop' } },
  })

  await seedScanResult(page, resultState)
  await page.goto('/scan?stage=result')
  await expectPdfCompleted(binary)
  await page.getByRole('button', { name: /AI 简历识别/ }).click()
  await page.waitForURL('**/resume/parse')
  await expectHealthy(page, errors)
})

/** 只滚手指滚得动的容器（overflow-y: auto / scroll），把目标露到容器中间；overflow:hidden 的舞台一律不碰。 */
async function revealByUserScroll(target: Locator, block: 'start' | 'center' | 'end' = 'center'): Promise<void> {
  await target.evaluate((el, where) => {
    for (let node = el.parentElement; node; node = node.parentElement) {
      if (!['auto', 'scroll'].includes(getComputedStyle(node).overflowY) || node.scrollHeight <= node.clientHeight) continue
      const box = node.getBoundingClientRect()
      const rect = el.getBoundingClientRect()
      const slack = where === 'start' ? 0 : where === 'end' ? box.height - rect.height : (box.height - rect.height) / 2
      node.scrollTop += rect.top - box.top - Math.max(0, slack)
    }
  }, block)
}

type Box = { x: number; y: number; width: number; height: number }

async function boxOf(locator: Locator, what: string): Promise<Box> {
  const box = await locator.boundingBox()
  expect(box, `${what} 必须有包围盒`).not.toBeNull()
  return box!
}

function boxesOverlap(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

function expectInside(inner: Box, outer: Box, message: string): void {
  expect(
    inner.y >= outer.y - 0.5 && inner.y + inner.height <= outer.y + outer.height + 0.5
      && inner.x >= outer.x - 0.5 && inner.x + inner.width <= outer.x + outer.width + 0.5,
    message,
  ).toBe(true)
}

/*
 * 2026-09-23 实测：390×844 下舞台不缩放，扫描工作台的横幅（541px）与底注（324px）钉死在 329px 的
 * 正文区里，可滚区被挤成 20px 落到底栏下面，横幅还压在操作条上。「AI 简历识别」手指点不到——
 * Playwright 只能靠滚动 overflow:hidden 的舞台摸到它，点下去仍被 .sw-xq / .sw-truth 拦截。
 * 本用例只做用户做得到的事：滚手指滚得动的容器，再在按钮坐标上真按一下（touchscreen.tap，
 * 不经 Playwright 的自动滚动与重试），必须进到解析页、带着这份扫描件提交。
 */
test.describe('scan result at 390x844', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

  test('resume scan AI button is reachable and tappable at 390x844 @w2', async ({ page, api }, testInfo) => {
    const errors = collectRuntimeErrors(page, new URL(W2_FILE.fileUrl, 'http://fixture.local').pathname)
    const binary = new FusionW2BinaryRoute(page)
    await binary.install()
    registerShell(api)
    const parseBodies: Array<{ fileId?: string; source?: string }> = []
    await page.route('**/api/v1/resume/parse', async (route) => {
      parseBodies.push(route.request().postDataJSON() as { fileId?: string; source?: string })
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ success: false, error: { code: 'W2_STOP_AFTER_NAV', message: 'synthetic stop' } }) })
    })

    const viewport = { x: 0, y: 0, width: 390, height: 844 }
    const scroller = page.locator('[data-qx-page="scan-workbench"]')
    const hero = page.locator('.sw-xq')
    const truth = page.getByTestId('scan-workbench-truth')

    // 底注按稿 18 只在选类型那一屏出现：在那一屏上它必须随正文整块滚得到，不被操作条 / 底栏盖住。
    await page.goto('/scan?stage=start')
    await expect(page.locator('[data-kiosk-stage-fit]')).toHaveAttribute('data-kiosk-stage-fit', 'off')
    await expect(truth).toBeVisible()
    await revealByUserScroll(truth, 'end')
    const truthBox = await boxOf(truth, '底注')
    expectInside(truthBox, await boxOf(scroller, '扫描工作台滚动区'), '底注必须能整块滚进可视区')
    // 操作条在底栏之上：底注下沿不越过操作条上沿（与 expectInside 同一个 0.5px 容差），也就压不到底栏。
    const ctabarTop = (await boxOf(page.locator('.qx-ctabar'), '操作条')).y
    expect(truthBox.y + truthBox.height, '底注滚到底时不得压到操作条下面').toBeLessThanOrEqual(ctabarTop + 0.5)

    await seedScanResult(page, resultState)
    await page.goto('/scan?stage=result')
    await expectPdfCompleted(binary)
    await expect(page.locator('[data-kiosk-stage-fit]')).toHaveAttribute('data-kiosk-stage-fit', 'off')
    const ctabar = page.locator('.qx-ctabar')
    const navbar = page.getByRole('navigation', { name: '主导航' })
    const aiButton = page.getByRole('button', { name: /AI 简历识别/ })
    await expect(aiButton).toBeEnabled()

    // 顶栏、操作条、底栏不许被横幅盖住（修复前 .sw-xq 溢出正文区，压在「直接打印」上）。
    await assertTapTargetPointerHit(page.getByRole('button', { name: '返回打印扫描' }))
    await assertTapTargetPointerHit(ctabar.getByRole('button', { name: '重新扫描' }))
    await assertTapTargetPointerHit(ctabar.getByRole('button', { name: '直接打印' }))
    for (const item of await navbar.getByRole('button').all()) await assertTapTargetPointerHit(item)

    // 横幅一字不删，只是随正文一起滚，整块露得出来；结果页不再复读底注。
    await expect(hero).toBeVisible()
    await expect(truth).toHaveCount(0)
    await revealByUserScroll(hero, 'start')
    expectInside(await boxOf(hero, '横幅'), await boxOf(scroller, '扫描工作台滚动区'), '横幅必须能整块滚进可视区')

    await revealByUserScroll(aiButton)
    const view = await boxOf(scroller, '扫描工作台滚动区')
    const button = await boxOf(aiButton, '「AI 简历识别」')
    expectInside(button, view, '「AI 简历识别」必须能整块滚进可视区，不靠滚动 overflow:hidden 的舞台')
    expectInside(button, viewport, '「AI 简历识别」必须整块在视口内')
    for (const [what, layer] of [['横幅', hero], ['操作条', ctabar], ['底栏', navbar]] as const) {
      expect(boxesOverlap(button, await boxOf(layer, what)), `「AI 简历识别」不得与${what}重叠`).toBe(false)
    }
    await assertTapTargetPointerHit(aiButton)
    // 三列时每个出口只剩 95px 宽，标题逐字竖排；单列后「AI 简历识别」最多折两行。
    const titleLines = await aiButton.locator('.sw-exit-title').evaluate((el) => {
      const range = document.createRange()
      range.selectNodeContents(el)
      const centers = Array.from(range.getClientRects()).map((rect) => rect.top + rect.height / 2).sort((a, b) => a - b)
      const tolerance = parseFloat(getComputedStyle(el).fontSize) * 0.6
      return centers.filter((center, index) => index === 0 || center - centers[index - 1] > tolerance).length
    })
    expect(titleLines, '「AI 简历识别」标题不得逐字竖排').toBeLessThanOrEqual(2)
    await page.screenshot({ path: testInfo.outputPath('qx-scan-result-390-ai-exit.png'), fullPage: false })

    await page.touchscreen.tap(button.x + button.width / 2, button.y + button.height / 2)
    await page.waitForURL('**/resume/parse')
    await expect.poll(() => parseBodies.length).toBe(1)
    expect(parseBodies[0]).toMatchObject({ fileId: 'w2-scan-file', source: 'scan' })
    await expectHealthy(page, errors)
  })
})

test('resume scan return keeps the same scanned file and a late parse result never hijacks it @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page, new URL(W2_FILE.fileUrl, 'http://fixture.local').pathname)
  const binary = new FusionW2BinaryRoute(page)
  await binary.install()
  registerShell(api)
  const parseBodies: Array<{ fileId?: string; source?: string }> = []
  let releaseFirst: () => void = () => {}
  const firstHeld = new Promise<void>((resolve) => { releaseFirst = resolve })
  await page.route('**/api/v1/resume/parse', async (route) => {
    parseBodies.push(route.request().postDataJSON() as { fileId?: string; source?: string })
    if (parseBodies.length === 1) {
      await firstHeld
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ success: false, error: { code: 'W2_LATE', message: 'late' } }) }).catch(() => undefined)
      return
    }
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ success: false, error: { code: 'W2_STOP_AFTER_NAV', message: 'synthetic stop' } }) })
  })

  await seedScanResult(page, resultState)
  await page.goto('/scan?stage=result')
  await expectPdfCompleted(binary)
  await page.getByRole('button', { name: /AI 简历识别/ }).click()
  await page.waitForURL('**/resume/parse')
  await expect.poll(() => parseBodies.length).toBe(1)
  expect(parseBodies[0]).toMatchObject({ fileId: 'w2-scan-file', source: 'scan' })

  // 扫描工作台是 replace 交接的：顶栏返回必须把同一份扫描件带回来源页（稿 21 scan-ready），不能丢。
  await page.getByRole('button', { name: '返回简历来源' }).click()
  await page.waitForURL((url) => url.pathname === '/resume/source')
  const scanBlock = page.getByRole('region', { name: '扫描件交接' })
  await expect(scanBlock).toBeVisible()
  await expect(scanBlock.getByText('w2-scan.pdf', { exact: true })).toBeVisible()
  await expect(scanBlock.getByText('扫描原件 · 由扫描工作台交接')).toBeVisible()
  await expect(page.locator('.qx-pill')).toHaveText('扫描件已交接 · 待确认')

  // 晚到的第一次结果放行后，页面仍停在来源页 —— 不被带去报告页。
  const late = page.waitForResponse('**/api/v1/resume/parse')
  releaseFirst()
  await late
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  await expect(page).toHaveURL(/\/resume\/source$/)
  await expect(scanBlock).toBeVisible()

  // 再次开始：仍按扫描件、同一个文件身份提交。
  await page.getByRole('button', { name: '开始 AI 诊断' }).click()
  await page.waitForURL('**/resume/parse')
  await expect.poll(() => parseBodies.length).toBe(2)
  expect(parseBodies[1]).toMatchObject({ fileId: 'w2-scan-file', source: 'scan' })
  await expectHealthy(page, errors)
})

/*
 * 顶栏返回把解析页这条历史换成来源页（replace）。浏览器 / 系统后退不能再把解析页翻回来——
 * 那会让它带着原来的路由 state 重新挂载，用同一个 fileId、同一条签名链接再提交一次解析。
 * 扫描件交接本身要保住：回到来源页仍落在 scan-ready、仍是同一份文件。
 * 两种视口都从扫描结果页起步、在本视口里点「AI 简历识别」交接（390 的遮挡已修，见上面 390×844 那条）。
 */
for (const viewport of [{ width: 1080, height: 1920 }, { width: 390, height: 844 }]) {
  test(`resume scan top back leaves no parse entry so browser back never re-posts (${viewport.width}x${viewport.height}) @w2`, async ({ page, api }) => {
    const errors = collectRuntimeErrors(page, new URL(W2_FILE.fileUrl, 'http://fixture.local').pathname)
    const binary = new FusionW2BinaryRoute(page)
    await binary.install()
    registerShell(api)
    const parseBodies: Array<{ fileId?: string; source?: string }> = []
    let release: () => void = () => {}
    const held = new Promise<void>((resolve) => { release = resolve })
    await page.route('**/api/v1/resume/parse', async (route) => {
      parseBodies.push(route.request().postDataJSON() as { fileId?: string; source?: string })
      await held
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ success: false, error: { code: 'W2_LATE', message: 'late' } }) }).catch(() => undefined)
    })

    await page.setViewportSize(viewport)
    await seedScanResult(page, resultState)
    await page.goto('/scan?stage=result')
    await expectPdfCompleted(binary)
    await page.getByRole('button', { name: /AI 简历识别/ }).click()
    await page.waitForURL('**/resume/parse')
    await expect.poll(() => parseBodies.length).toBe(1)
    expect(parseBodies[0]).toMatchObject({ fileId: 'w2-scan-file', source: 'scan' })
    const historyBefore = await page.evaluate(() => window.history.length)

    await page.getByRole('button', { name: '返回简历来源' }).click()
    await page.waitForURL((url) => url.pathname === '/resume/source')
    // 换掉而不是压栈：历史条目数不变；同一份扫描件原样落在 scan-ready。
    expect(await page.evaluate(() => window.history.length)).toBe(historyBefore)
    const scanBlock = page.getByRole('region', { name: '扫描件交接' })
    await expect(scanBlock.getByText('w2-scan.pdf', { exact: true })).toBeVisible()
    await expectHealthy(page, errors)

    await page.goBack()
    // 后退不再落回解析页：它不重新挂载、不再提交，也不把这份扫描件重新摆出来。
    await expect(page).not.toHaveURL(/\/resume\/parse/)
    await expect(page.locator('[data-kiosk-screen="resume-parse"]')).toHaveCount(0)
    await expect(page.getByText('w2-scan.pdf', { exact: true })).toHaveCount(0)

    // 放行第一次请求的迟到结果后，仍然只有这一次提交。
    release()
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    await expect(page.locator('[data-kiosk-screen="resume-parse"]')).toHaveCount(0)
    expect(parseBodies).toHaveLength(1)
    expect(errors).toEqual([])
  })
}

test('resume scan-ready track title stays horizontal at 390x844 @w2', async ({ page, api }, testInfo) => {
  // 2026-09-23 实拍：390 下「换一种来源」把交接标题挤成两字一列（7 行竖排）。
  // 交接链路全程在 390 下走：扫描结果页点「AI 简历识别」→ 解析页 → 返回来源页再量。
  const errors = collectRuntimeErrors(page, new URL(W2_FILE.fileUrl, 'http://fixture.local').pathname)
  const binary = new FusionW2BinaryRoute(page)
  await binary.install()
  registerShell(api)
  api.respond('POST', '/api/v1/resume/parse', {
    status: 503,
    json: { success: false, error: { code: 'W2_STOP_AFTER_NAV', message: 'synthetic stop' } },
  })

  await page.setViewportSize({ width: 390, height: 844 })
  await seedScanResult(page, resultState)
  await page.goto('/scan?stage=result')
  await expectPdfCompleted(binary)
  await expect(page.locator('[data-kiosk-stage-fit]')).toHaveAttribute('data-kiosk-stage-fit', 'off')
  await page.getByRole('button', { name: /AI 简历识别/ }).click()
  await page.waitForURL('**/resume/parse')
  await page.getByRole('button', { name: '返回简历来源' }).click()
  await page.waitForURL((url) => url.pathname === '/resume/source')
  await expect(page.getByRole('region', { name: '扫描件交接' })).toBeVisible()

  const track = page.getByRole('region', { name: '扫描件交接' }).locator('.qx-rt-track')
  const title = track.getByText('扫描原件 · 由扫描工作台交接', { exact: true })
  const swap = track.getByRole('button', { name: '换一种来源' })
  await expect(title).toBeVisible()
  await track.scrollIntoViewIfNeeded()
  const lines = await title.evaluate((el) => {
    const range = document.createRange()
    range.selectNodeContents(el)
    return new Set(Array.from(range.getClientRects()).map((rect) => Math.round(rect.top))).size
  })
  // 与 W3 顶栏胶囊同一口径：允许折两行，不许逐字竖排（每行至少四个字，最多两行）。
  expect(lines, '交接标题不得被按钮挤成竖排').toBeLessThanOrEqual(2)
  const titleBox = await title.boundingBox()
  const swapBox = await swap.boundingBox()
  expect(titleBox && swapBox, '标题与按钮都必须有包围盒').toBeTruthy()
  const overlaps = titleBox!.x < swapBox!.x + swapBox!.width && swapBox!.x < titleBox!.x + titleBox!.width
    && titleBox!.y < swapBox!.y + swapBox!.height && swapBox!.y < titleBox!.y + titleBox!.height
  expect(overlaps, '「换一种来源」不得与标题重叠').toBe(false)
  expect(swapBox!.height).toBeGreaterThanOrEqual(48)
  expect(swapBox!.width).toBeGreaterThanOrEqual(48)
  // 顶栏胶囊在 390 下折两行：原先逐字断行，第二行只剩一个「认」。现在只在「 · 」处断，不裁字、不藏字。
  await expect(page.locator('.qx-pill')).toHaveText('扫描件已交接 · 待确认')
  await assertQxPillReadable(page, '/resume/source scan-ready 390')
  await page.screenshot({ path: testInfo.outputPath('qx-resume-scan-ready-390.png'), fullPage: false })
  await expectHealthy(page, errors)
})

test('successful scan tells a guest the file will not reach 我的文档 @w2', async ({ page, api }) => {
  // 本用例全程未登录。原版断言按钮是「登录后管理文件」并点进 /login——
  // 那句承诺是假的：游客扫描件 ownerType='system'，没有认领机制，登录后
  // 「我的文档」里根本不会出现（体检 MSC-04）。所以这里断言的是修正后的真话：
  // 明说本次不进我的文档，并且按钮禁用——不能把用户送去一个去了也没用的登录页。
  const errors = collectRuntimeErrors(page, new URL(W2_FILE.fileUrl, 'http://fixture.local').pathname)
  const binary = new FusionW2BinaryRoute(page)
  await binary.install()
  registerShell(api)

  await seedScanResult(page, resultState)
  await page.goto('/scan?stage=result')
  await expectPdfCompleted(binary)

  const destination = page.getByRole('button', { name: /本次不进入我的文档/ })
  await expect(destination).toBeVisible()
  await expect(destination).toBeDisabled()
  await expect(page.getByText('未登录扫描件不会进入「我的文档」，请在本次操作内完成打印或识别')).toBeVisible()

  // 旧的不实承诺不得再出现在页面上。
  await expect(page.getByText(/登录后管理文件|登录后可在「我的文档」管理/)).toHaveCount(0)
  await expectHealthy(page, errors)
})

test('failed scan retry strips control fields but preserves scan parameters @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  registerCreatedScan(api)
  // 「重新开始一次扫描」建出新会话后，设置页照例确认一次投递授权。
  const ack = registerScanAck(page, api)
  const failureState = {
    scanType: 'document', source: 'feeder', pageMode: 'multi', color: 'gray', dpi: 300,
    success: false, reason: '合成扫描失败', simulateFailure: true, failReason: 'raw', file: resultState.file,
  }

  await seedScanResult(page, failureState)
  await page.goto('/scan?stage=result')
  const createResponse = page.waitForResponse((response) =>
    response.request().method() === 'POST'
      && new URL(response.url()).pathname === '/api/v1/scan/sessions',
  )
  // 这一场没有任何安全重扫凭据（种进去的登记里没有 live），所以主行动是显式的
  // 「重新开始一次扫描」——它不是安全同字节重扫，页面也不许把它说成重试。
  await page.getByRole('button', { name: '重新开始一次扫描', exact: true }).click()
  await page.waitForURL(/\/scan\?stage=settings/)
  await createResponse
  await expect(page.locator('[data-w2-page="scan-settings"]')).toBeVisible()
  await expect(page.getByText('在打印机面板开始扫描', { exact: true })).toBeVisible()
  const retrySession = await page.evaluate((key) => JSON.parse(window.sessionStorage.getItem(key) ?? '{}') as Record<string, unknown>, 'ai-job-print:current-scan-workbench')
  expect(retrySession).toMatchObject({ scanType: 'document', extras: { source: 'feeder', pageMode: 'multi', color: 'gray', dpi: 300 } })
  expect(retrySession.result).toBeUndefined()
  expect(retrySession.live).toMatchObject({ scanTaskId: SCAN_TASK_ID })
  await ack.expectAcked(1)
  await expectHealthy(page, errors)
})

/* 结果快照 outcome 'expired' 有两个来源：服务端回执 expired，以及本机轮询到 10 分钟自己放弃
 * （ScanProgressPage 的 localGiveUp，撤销没有回执）。两条路写下的快照一字不差，
 * 所以这一屏只能说「等待超时」，不能替服务端说「会话已过期」「服务端确认」或「编号已作废」。 */
test('expired result never claims a server-confirmed expiry it cannot tell apart @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  await seedScanResult(page, { scanType: 'resume', outcome: 'expired', success: false, reason: '扫描超时，请返回重新开始' })
  await page.goto('/scan?stage=result')
  await expect(page.locator('[data-w2-page="scan-result"]')).toHaveAttribute('data-state', 'wait-timeout')
  await expect(page.getByRole('heading', { level: 1, name: '等待超时', exact: true })).toBeVisible()
  await expect(page.getByText('等待超时，这次没有拿到文件', { exact: true })).toBeVisible()
  await expect(page.getByText('扫描超时，请返回重新开始', { exact: true })).toBeVisible()
  for (const claim of [/会话已过期/, /会话过期了/, /服务端确认/, /编号已作废/]) {
    await expect(page.getByText(claim), `不得出现 ${claim}`).toHaveCount(0)
  }
  await expect(page.getByTestId('scan-workbench-truth')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '重新开始一次扫描', exact: true })).toBeVisible()
  await expectHealthy(page, errors)
})

test('completed scan without a file is a terminal no-file state @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  const ack = registerScanAck(page, api)
  await routeExact(page, 'GET', `/api/v1/scan/sessions/${SCAN_TASK_ID}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          scanTaskId: SCAN_TASK_ID,
          status: 'completed',
          scanType: 'resume',
          file: null,
          errorCode: null,
          errorMessage: null,
          expiresAt: LATER,
        },
      }),
    })
  })

  await seedScanLive(page)
  await page.goto('/scan?stage=progress')
  await page.waitForURL(/\/scan\?stage=result/)
  await expect(page.getByText('服务端说已完成，但这次回执里没有可用文件').first()).toBeVisible()
  await expect(page.getByText('w2-scan.pdf')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '重新开始一次扫描', exact: true })).toBeVisible()
  await ack.expectAcked(1)
  await expectHealthy(page, errors)
})

test('poll requests send the in-memory control token header @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  // 「立即检查」只在拿到投递授权之后才出现（没确认时主行动是「再确认一次」），
  // 所以这一条不注册 ACK 就根本走不到轮询断言。
  const ack = registerScanAck(page, api)
  let seenControlHeader: string | null = null
  await routeExact(page, 'GET', `/api/v1/scan/sessions/${SCAN_TASK_ID}`, async (route) => {
    seenControlHeader = route.request().headers()['x-scan-session-control'] ?? null
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(scanStatus('waiting')),
    })
  })

  await seedScanLive(page)
  await page.goto('/scan?stage=progress')
  await expect.poll(() => seenControlHeader).toBe(CONTROL_TOKEN)
  await expect(page.getByRole('button', { name: '立即检查' })).toBeEnabled()
  await ack.expectAcked(1)
  await expectHealthy(page, errors)
})

/**
 * 这一条取证用例横跨四屏，投递确认发生的次数不是一目了然的，所以把它拆开写清楚：
 *
 *   ① `/scan?stage=settings` + 路由态 scanType → 建成 → 设置页确认；
 *   ② `seedScanLive` 里那次裸 `/scan` → 登记里还是 settings + live，设置页**复水**
 *      挂载一次（复水进来的会话一律重新确认，本机不知道当初确认过没有）；
 *   ③ `/scan?stage=progress` → 等待页挂载确认。
 *
 * 结果屏与两次 start 屏都不确认。数字变了就说明这条取证路径本身的挂载次序变了 ——
 * 那时要回来重新数一遍，而不是把它调大。
 */
const ACK_COUNT_EVIDENCE_WALKTHROUGH = 3

test('qingxu scan workbench captures 1080x1920 evidence @w2', async ({ page, api }, testInfo) => {
  const errors = collectRuntimeErrors(page, new URL(W2_FILE.fileUrl, 'http://fixture.local').pathname)
  const binary = new FusionW2BinaryRoute(page)
  await binary.install()
  registerShell(api)
  registerScanCapability(api, 'available')
  // 取证要拍的是**已确认**的设置页与等待页：没确认的话两屏拍出来都是
  // 「正在确认投递授权」，而那不是这份证据要留的东西。
  const ack = registerScanAck(page, api)
  const shot = async (name: string) => {
    await page.screenshot({ path: testInfo.outputPath(name), fullPage: false })
  }

  await page.goto('/scan/start')
  await expect(page.getByText('可创建扫描任务 · 需面板操作', { exact: true })).toBeVisible()
  await shot('qx-scan-start.png')

  registerScanCapability(api, 'maintenance', '扫描仪正在保养')
  await page.reload()
  await expect(page.getByText('扫描能力暂未开放', { exact: true }).first()).toBeVisible()
  await shot('qx-scan-start-blocked.png')

  registerScanCapability(api, 'available')
  registerCreatedScan(api)
  await page.goto('/scan?stage=settings')
  await setReactRouterState(page, '/scan?stage=settings', { scanType: 'resume' })
  await expect(page.getByText('在打印机面板开始扫描', { exact: true })).toBeVisible()
  await shot('qx-scan-settings.png')

  await routeExact(page, 'GET', `/api/v1/scan/sessions/${SCAN_TASK_ID}`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(scanStatus('waiting')) })
  })
  await seedScanLive(page)
  await page.goto('/scan?stage=progress')
  await expect(page.getByRole('button', { name: '立即检查' })).toBeVisible()
  await shot('qx-scan-progress.png')

  await seedScanResult(page, resultState)
  await page.goto('/scan?stage=result')
  await expect(page.getByText('w2-scan.pdf', { exact: true })).toBeVisible()
  await shot('qx-scan-result.png')

  await ack.expectAcked(ACK_COUNT_EVIDENCE_WALKTHROUGH)
  await expectHealthy(page, errors)
})

test('usb-panel path does not create a platform scan session @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  let createCount = 0
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/scan/sessions') createCount += 1
  })

  await page.goto('/scan?stage=start&mode=usb-panel')
  await expect(page.getByText('文件只进你的 U 盘').first()).toBeVisible()
  await expect(page.getByRole('button', { name: '完成后回打印扫描' })).toBeVisible()
  expect(createCount).toBe(0)
  await expectHealthy(page, errors)
})

test('legacy scan routes redirect with stage intent @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)

  await page.goto('/scan/start')
  await expect(page).toHaveURL(/\/scan\?stage=start/)
  await expect(page.locator('[data-scan-stage="start"]')).toHaveCount(1)

  await page.goto('/scan/settings')
  await expect(page).toHaveURL(/\/scan\?stage=settings/)
  await expect(page.getByText('未创建扫描任务', { exact: true }).first()).toBeVisible()

  await page.goto('/scan/progress')
  await expect(page).toHaveURL(/\/scan(\?stage=start)?$|\/scan\?stage=start/)
  await expect(page.locator('[data-w2-page="scan-start"]')).toBeVisible()
  await expect(page.locator('[data-w2-page="scan-progress"]')).toHaveCount(0)
  await expectHealthy(page, errors)
})

test('progress stage survives reload from sessionStorage @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  // 整页重载之后本机不知道当初确认过没有，等待页会再确认一遍（服务端幂等）。
  // 「等待打印机端扫描完成」这句话在两次挂载里都必须重新挣来。
  const ack = registerScanAck(page, api)
  await routeExact(page, 'GET', `/api/v1/scan/sessions/${SCAN_TASK_ID}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(scanStatus('waiting')),
    })
  })

  await seedScanLive(page)
  await page.goto('/scan?stage=progress')
  await expect(page.getByText('等待打印机端扫描完成', { exact: true })).toBeVisible()
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page).toHaveURL(/\/scan\?stage=progress/)
  await expect(page.locator('[data-scan-stage="progress"]')).toHaveCount(1)
  await expect(page.getByText('等待打印机端扫描完成', { exact: true })).toBeVisible()
  // 挂载一次 + 重载后再挂载一次。
  await ack.expectAcked(2)
  await expectHealthy(page, errors)
})

test('sensitive session clear returns the workbench to start without the previous task @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  const ack = registerScanAck(page, api)
  await routeExact(page, 'GET', `/api/v1/scan/sessions/${SCAN_TASK_ID}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(scanStatus('waiting')),
    })
  })

  await seedScanLive(page)
  await page.goto('/scan?stage=progress')
  await expect(page.getByText(SCAN_TASK_ID, { exact: true })).toBeVisible()

  await page.evaluate((key) => {
    window.sessionStorage.removeItem(key)
  }, 'ai-job-print:current-scan-workbench')
  await page.reload({ waitUntil: 'domcontentloaded' })

  await expect(page.locator('[data-w2-page="scan-start"]')).toBeVisible()
  await expect(page.getByText(SCAN_TASK_ID, { exact: true })).toHaveCount(0)
  await expect(page.locator('[data-w2-page="scan-progress"]')).toHaveCount(0)
  // 清场之前那一次挂载确认过一次；清场之后回到 start，**不许**再有第二次 ——
  // 那等于本机替一个已经没人看着的会话重新挣来投递资格。
  await ack.expectAcked(1)
  expect(errors).toEqual([])
})

// ── 扫描结果 · 整屏预览（稿 21 · rs-pv-*）────────────────────────────────────
//
// 工具条只摆「真能做到」的控件：PDF 交给浏览器自带查看器按 page= / view= 打开参数重新打开，
// 图片由本层 contain / 铺满宽度。无头 Chromium 不渲染 PDF，所以 PDF 这边钉的是交给查看器的
// 那组打开参数（iframe src 的 # 片段）；图片这边量真实排版。
// 夹具与回执一一对得上：说 2 页的那份就真是 2 页，说是图片的那份就真能解码。

const PREVIEW_FIXTURE_PREFIX = '/w2-scan-preview/'
const TWO_PAGE_PDF_PATH = `${PREVIEW_FIXTURE_PREFIX}two-page.pdf`
const PORTRAIT_PNG_PATH = `${PREVIEW_FIXTURE_PREFIX}portrait.png`
/** 60×120 灰底黑框的真 PNG（竖版 1:2），适应宽度后必然比可视区高。 */
const PORTRAIT_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAADwAAAB4CAAAAACLXs7UAAAAMklEQVR42u3LIQEAAAgDsPdPRiwyILja/BLq5kiWZVmWZVmWZVmWZVmWZVmWZVn+y1Qstg3S4njfphIAAAAASUVORK5CYII='

function buildPdf(pageStreams: string[]): string {
  const kids = pageStreams.map((_, index) => `${3 + index * 2} 0 R`).join(' ')
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    `2 0 obj\n<< /Type /Pages /Count ${pageStreams.length} /Kids [${kids}] >>\nendobj\n`,
    ...pageStreams.flatMap((stream, index) => {
      const pageId = 3 + index * 2
      return [
        `${pageId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents ${pageId + 1} 0 R >>\nendobj\n`,
        `${pageId + 1} 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}endstream\nendobj\n`,
      ]
    }),
  ]
  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf, 'ascii'))
    pdf += object
  }
  const xrefOffset = Buffer.byteLength(pdf, 'ascii')
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  return pdf
}

const TWO_PAGE_PDF = buildPdf(['0 0 0 rg\n30 30 40 140 re f\n', '0 0 0 rg\n130 30 40 140 re f\n'])

async function installPreviewFixtures(page: Page): Promise<void> {
  await page.route(`**${PREVIEW_FIXTURE_PREFIX}**`, async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === TWO_PAGE_PDF_PATH) {
      await route.fulfill({ status: 200, contentType: 'application/pdf', body: TWO_PAGE_PDF })
    } else if (path === PORTRAIT_PNG_PATH) {
      await route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from(PORTRAIT_PNG_BASE64, 'base64') })
    } else {
      await route.abort('blockedbyclient')
    }
  })
}

function previewResult(file: { fileUrl: string; name: string; pages: number | null; mimeType: string; format: string }) {
  return { ...resultState, file: { ...resultState.file, ...file } }
}

async function readScanSession(page: Page): Promise<string | null> {
  return page.evaluate((key) => window.sessionStorage.getItem(key), SCAN_WORKBENCH_SESSION_KEY)
}

async function openScanPreview(page: Page, name: string): Promise<Locator> {
  await page.getByTestId('scan-result-preview-open').click()
  const dialog = page.getByRole('dialog', { name: `文件预览：${name}` })
  await expect(dialog).toBeVisible()
  return dialog
}

test('scan result full-screen preview drives real PDF page and fit controls without leaving the result @w2', async ({ page, api }, testInfo) => {
  const errors = collectRuntimeErrors(page, TWO_PAGE_PDF_PATH)
  await installPreviewFixtures(page)
  registerShell(api)
  await seedScanResult(page, previewResult({
    fileUrl: TWO_PAGE_PDF_PATH,
    name: 'w2-scan-two-page.pdf',
    pages: 2,
    mimeType: 'application/pdf',
    format: 'PDF',
  }))
  await page.goto('/scan?stage=result')
  const inline = page.locator('.sw-pvstage [data-file-preview-kind="pdf"] iframe')
  await expect(inline).toHaveAttribute('src', TWO_PAGE_PDF_PATH)
  const urlBefore = page.url()
  const sessionBefore = await readScanSession(page)

  const dialog = await openScanPreview(page, 'w2-scan-two-page.pdf')
  // 整屏：盖满 1080×1920 舞台，底层整片 inert，焦点落在关闭键上。
  const scrim = await boxOf(page.getByTestId('rs-pv-scrim'), '整屏预览')
  const stage = await boxOf(page.locator('.kiosk-stage'), '舞台')
  expect(Math.abs(scrim.x - stage.x) + Math.abs(scrim.y - stage.y), '预览层从舞台左上角铺起').toBeLessThanOrEqual(1)
  expect(Math.abs(scrim.width - stage.width) + Math.abs(scrim.height - stage.height), '预览层与舞台同大').toBeLessThanOrEqual(1)
  for (const layer of ['.qx-topbar', '.qx-ctabar', '.qx-navbar', '[data-testid="scan-workbench-exits"]']) {
    await expect(page.locator(layer), `${layer} 在预览打开时不可达`).toHaveAttribute('inert', '')
  }
  await expect(dialog.getByTestId('rs-pv-close')).toBeFocused()
  await expect(dialog.getByTestId('rs-pv-meta')).toContainText('2 页')

  const viewer = dialog.locator('[data-testid="rs-pv-view"] [data-file-preview-kind="pdf"] iframe')
  const prev = dialog.getByTestId('rs-pv-prev')
  const next = dialog.getByTestId('rs-pv-next')
  const fitPage = dialog.getByTestId('rs-pv-fit-page')
  const fitWidth = dialog.getByTestId('rs-pv-fit-width')
  const indicator = dialog.getByTestId('rs-pv-page')
  for (const control of [prev, next, fitPage, fitWidth, dialog.getByTestId('rs-pv-close')]) {
    const box = await boxOf(control, '预览工具条按钮')
    expect(box.height, '一体机上预览控件 ≥88px').toBeGreaterThanOrEqual(88)
    expect(box.width).toBeGreaterThanOrEqual(88)
  }

  await expect(viewer).toHaveAttribute('src', `${TWO_PAGE_PDF_PATH}#page=1&view=Fit`)
  await expect(indicator).toHaveText('第 1 页 / 共 2 页')
  await expect(prev).toBeDisabled()
  await expect(next).toBeEnabled()
  await expect(fitPage).toHaveAttribute('aria-pressed', 'true')
  await expect(fitWidth).toHaveAttribute('aria-pressed', 'false')
  await page.screenshot({ path: testInfo.outputPath('qx-scan-result-preview-pdf-1080.png'), fullPage: false })

  await next.click()
  await expect(viewer).toHaveAttribute('src', `${TWO_PAGE_PDF_PATH}#page=2&view=Fit`)
  await expect(indicator).toHaveText('第 2 页 / 共 2 页')
  await expect(next, '到最后一页就停，不编出第 3 页').toBeDisabled()
  await expect(prev).toBeEnabled()

  await fitWidth.click()
  await expect(viewer).toHaveAttribute('src', `${TWO_PAGE_PDF_PATH}#page=2&view=FitH`)
  await expect(fitWidth).toHaveAttribute('aria-pressed', 'true')
  await expect(fitPage).toHaveAttribute('aria-pressed', 'false')
  await expect(dialog.getByTestId('rs-pv-zoom')).toHaveText('当前：适应宽度')

  await prev.click()
  await expect(viewer).toHaveAttribute('src', `${TWO_PAGE_PDF_PATH}#page=1&view=FitH`)
  await fitPage.click()
  await expect(viewer).toHaveAttribute('src', `${TWO_PAGE_PDF_PATH}#page=1&view=Fit`)

  // 关掉回到这一步：地址、历史、本机登记、页内小预览都原样，底层恢复可达，焦点还给打开键。
  await dialog.getByTestId('rs-pv-back').click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('[inert]')).toHaveCount(0)
  await expect(page.getByTestId('scan-result-preview-open')).toBeFocused()
  expect(page.url()).toBe(urlBefore)
  expect(await readScanSession(page)).toBe(sessionBefore)
  await expect(inline).toHaveAttribute('src', TWO_PAGE_PDF_PATH)

  // 视图状态不跨次保留；Esc 也能关。
  const again = await openScanPreview(page, 'w2-scan-two-page.pdf')
  await expect(again.locator('[data-testid="rs-pv-view"] iframe')).toHaveAttribute('src', `${TWO_PAGE_PDF_PATH}#page=1&view=Fit`)
  await page.keyboard.press('Escape')
  await expect(again).toHaveCount(0)
  expect(page.url()).toBe(urlBefore)
  await expectHealthy(page, errors)
})

test('scan result preview keeps page turning honestly unavailable when the receipt has no page count @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page, new URL(W2_FILE.fileUrl, 'http://fixture.local').pathname)
  const binary = new FusionW2BinaryRoute(page)
  await binary.install()
  registerShell(api)
  // 真实扫描链路今天就是这个形状：ScanProgressPage 组装结果时 pages 恒为 null。
  await seedScanResult(page, previewResult({
    fileUrl: W2_FILE.fileUrl,
    name: 'w2-scan.pdf',
    pages: null,
    mimeType: 'application/pdf',
    format: 'PDF',
  }))
  await page.goto('/scan?stage=result')
  await expectPdfCompleted(binary)

  const dialog = await openScanPreview(page, 'w2-scan.pdf')
  const viewer = dialog.locator('[data-testid="rs-pv-view"] [data-file-preview-kind="pdf"] iframe')
  await expect(viewer, '页数未知时不写 page=，不替文件编页码').toHaveAttribute('src', `${W2_FILE.fileUrl}#view=Fit`)
  await expect(dialog.getByTestId('rs-pv-prev')).toBeDisabled()
  await expect(dialog.getByTestId('rs-pv-next')).toBeDisabled()
  await expect(dialog.getByTestId('rs-pv-page')).toHaveText('页数未知 · 在预览里上下滑动翻页')
  await expect(dialog.getByTestId('rs-pv-meta')).toContainText('页数以文件为准')
  await expect(dialog.getByTestId('rs-pv-note')).toContainText('回执里没有页数，本页不替文件编页码')
  await expect(dialog.getByText(/第 \d+ 页/)).toHaveCount(0)

  await dialog.getByTestId('rs-pv-fit-width').click()
  await expect(viewer).toHaveAttribute('src', `${W2_FILE.fileUrl}#view=FitH`)
  await dialog.getByTestId('rs-pv-close').click()
  await expect(dialog).toHaveCount(0)
  await expectHealthy(page, errors)
})

test('scan result image preview fits the whole page or the full width by measured layout @w2', async ({ page, api }, testInfo) => {
  const errors = collectRuntimeErrors(page)
  await installPreviewFixtures(page)
  registerShell(api)
  await seedScanResult(page, previewResult({
    fileUrl: PORTRAIT_PNG_PATH,
    name: 'w2-scan.png',
    pages: null,
    mimeType: 'image/png',
    format: 'PNG',
  }))
  await page.goto('/scan?stage=result')

  const dialog = await openScanPreview(page, 'w2-scan.png')
  const view = dialog.getByTestId('rs-pv-view')
  const image = view.locator('[data-file-preview-kind="image"] img')
  await expect(image).toBeVisible()
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(60)
  // 一张图就是一整页：不摆翻页键，也不编页码。
  await expect(dialog.getByTestId('rs-pv-page')).toHaveText('整图 · 共 1 页')
  await expect(dialog.getByTestId('rs-pv-prev')).toHaveCount(0)
  await expect(dialog.getByTestId('rs-pv-next')).toHaveCount(0)

  const measure = () => view.evaluate((el) => {
    const img = el.querySelector('img') as HTMLImageElement
    const style = getComputedStyle(el)
    const frame = el.getBoundingClientRect()
    const box = img.getBoundingClientRect()
    return {
      innerWidth: el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
      scrollable: el.scrollHeight - el.clientHeight,
      imgWidth: box.width,
      imgHeight: box.height,
      objectFit: getComputedStyle(img).objectFit,
      inside: box.left >= frame.left - 0.5 && box.right <= frame.right + 0.5
        && box.top >= frame.top - 0.5 && box.bottom <= frame.bottom + 0.5,
    }
  })

  const whole = await measure()
  expect(whole.inside, '适应整页：整张图都在可视区里').toBe(true)
  expect(whole.objectFit, '适应整页：按原比例 contain，不裁不拉伸').toBe('contain')
  await page.screenshot({ path: testInfo.outputPath('qx-scan-result-preview-image-page-1080.png'), fullPage: false })
  expect(whole.scrollable, '适应整页：不需要滑动').toBeLessThanOrEqual(1)

  await dialog.getByTestId('rs-pv-fit-width').click()
  await expect(dialog.getByTestId('rs-pv-fit-width')).toHaveAttribute('aria-pressed', 'true')
  const wide = await measure()
  expect(Math.abs(wide.imgWidth - wide.innerWidth), '适应宽度：图宽等于可视区内宽').toBeLessThanOrEqual(1)
  expect(Math.abs(wide.imgHeight - wide.imgWidth * 2), '适应宽度：按原比例 1:2 放大，不拉伸').toBeLessThanOrEqual(2)
  expect(wide.scrollable, '适应宽度：竖版图比可视区高，要能滑到底').toBeGreaterThan(0)
  await view.evaluate((el) => { el.scrollTop = el.scrollHeight })
  expect(await view.evaluate((el) => el.scrollTop), '可视区是真实滚动容器').toBeGreaterThan(0)
  await page.screenshot({ path: testInfo.outputPath('qx-scan-result-preview-image-width-1080.png'), fullPage: false })

  await dialog.getByTestId('rs-pv-fit-page').click()
  const back = await measure()
  expect(back.inside).toBe(true)
  expect(back.scrollable).toBeLessThanOrEqual(1)
  await dialog.getByTestId('rs-pv-back').click()
  await expect(dialog).toHaveCount(0)
  await expectHealthy(page, errors)
})

test.describe('scan result full-screen preview at 390x844', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

  test('preview toolbar stays inside the phone viewport with tappable controls @w2', async ({ page, api }, testInfo) => {
    const errors = collectRuntimeErrors(page, TWO_PAGE_PDF_PATH)
    await installPreviewFixtures(page)
    registerShell(api)
    await seedScanResult(page, previewResult({
      fileUrl: TWO_PAGE_PDF_PATH,
      name: 'w2-scan-two-page.pdf',
      pages: 2,
      mimeType: 'application/pdf',
      format: 'PDF',
    }))
    await page.goto('/scan?stage=result')
    await expect(page.locator('[data-kiosk-stage-fit]')).toHaveAttribute('data-kiosk-stage-fit', 'off')

    const open = page.getByTestId('scan-result-preview-open')
    await revealByUserScroll(open)
    await assertTapTargetPointerHit(open)
    // 整屏查看键不许把文件卡标题挤成逐字竖排（曾被压到约 50px 宽，整行 280px 高）。
    const titleLines = await page.locator('.sw-pvh-t').evaluate((el) => {
      const range = document.createRange()
      range.selectNodeContents(el)
      const centers = Array.from(range.getClientRects()).map((rect) => rect.top + rect.height / 2).sort((a, b) => a - b)
      const tolerance = parseFloat(getComputedStyle(el).fontSize) * 0.6
      return centers.filter((center, index) => index === 0 || center - centers[index - 1] > tolerance).length
    })
    expect(titleLines, '文件卡标题不得逐字竖排').toBeLessThanOrEqual(2)
    await page.screenshot({ path: testInfo.outputPath('qx-scan-result-390-preview-entry.png'), fullPage: false })
    const openBox = await boxOf(open, '整屏查看')
    await page.touchscreen.tap(openBox.x + openBox.width / 2, openBox.y + openBox.height / 2)
    const dialog = page.getByRole('dialog', { name: '文件预览：w2-scan-two-page.pdf' })
    await expect(dialog).toBeVisible()

    const viewport = { x: 0, y: 0, width: 390, height: 844 }
    expectInside(await boxOf(page.getByTestId('rs-pv-scrim'), '整屏预览'), viewport, '预览层铺在视口内')
    for (const id of ['rs-pv-close', 'rs-pv-next', 'rs-pv-fit-page', 'rs-pv-fit-width', 'rs-pv-back']) {
      const control = dialog.getByTestId(id)
      await assertTapTargetPointerHit(control)
      expectInside(await boxOf(control, id), viewport, `${id} 整块在视口内`)
    }
    const stageBox = await boxOf(dialog.getByTestId('rs-pv-view'), '文件可视区')
    expect(stageBox.height, '手机上仍给文件留出可看的高度').toBeGreaterThanOrEqual(240)
    await page.screenshot({ path: testInfo.outputPath('qx-scan-result-preview-390.png'), fullPage: false })

    const nextBox = await boxOf(dialog.getByTestId('rs-pv-next'), '下一页')
    await page.touchscreen.tap(nextBox.x + nextBox.width / 2, nextBox.y + nextBox.height / 2)
    await expect(dialog.locator('[data-testid="rs-pv-view"] iframe')).toHaveAttribute('src', `${TWO_PAGE_PDF_PATH}#page=2&view=Fit`)
    await dialog.getByTestId('rs-pv-back').click()
    await expect(dialog).toHaveCount(0)
    await expectHealthy(page, errors)
  })
})
