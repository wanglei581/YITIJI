import type { Page, Route } from '@playwright/test'
import type { ApiRouter } from '../fixtures/api-router'
import { test, expect } from '../fixtures/kiosk-test'
import { assertNoHorizontalOverflow } from './assert-layout'
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
