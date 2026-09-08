import type { Page, Route } from '@playwright/test'
import type { ApiRouter } from '../fixtures/api-router'
import { test, expect } from '../fixtures/kiosk-test'
import { assertNoHorizontalOverflow } from './assert-layout'
import { setReactRouterState, W2_FILE } from './fixtures/fusion-w2-state'
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
  if (path.startsWith('/scan/')) {
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
  await page.waitForURL('**/scan/settings')
  await expect(page.getByText('在打印机面板开始扫描', { exact: true })).toBeVisible()
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
  let polls = 0
  await routeExact(page, 'GET', `/api/v1/scan/sessions/${SCAN_TASK_ID}`, async (route) => {
    const body = scanStatus(polls++ === 0 ? 'waiting' : 'completed')
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })

  const previewPaths: string[] = []
  page.on('request', (request) => {
    previewPaths.push(new URL(request.url()).pathname)
  })
  await page.goto('/scan/settings')
  await setReactRouterState(page, '/scan/settings', { scanType: 'resume' })
  await expect(page.getByText('在打印机面板开始扫描', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '我已操作，开始等待' }).click()
  await page.waitForURL('**/scan/result', { timeout: 8_000 })
  await expect(page.getByText('w2-scan.pdf', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => window.sessionStorage.getItem('w2-scan-control'))).toBeNull()
  await expect(page.locator('[data-file-preview-kind="pdf"]').locator('iframe')).toHaveAttribute('src', W2_FILE.fileUrl)
  expect(previewPaths.some((path) => path.includes('/preview-url'))).toBe(false)
  await expectHealthy(page, errors)
})

test('cancel-completed race rechecks status and recovers the real scan file @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
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

  await page.goto('/scan/progress')
  await setReactRouterState(page, '/scan/progress', { scanTaskId: SCAN_TASK_ID, scanType: 'resume', controlToken: CONTROL_TOKEN })
  await page.getByRole('button', { name: '取消扫描' }).click()
  await page.waitForURL('**/scan/result')
  await expect(page.getByText('w2-scan.pdf', { exact: true })).toBeVisible()
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

  await page.goto('/scan/result')
  await setReactRouterState(page, '/scan/result', resultState)
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

  await page.goto('/scan/result')
  await setReactRouterState(page, '/scan/result', resultState)
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

  await page.goto('/scan/result')
  await setReactRouterState(page, '/scan/result', resultState)
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
  const failureState = {
    scanType: 'document', source: 'feeder', pageMode: 'multi', color: 'gray', dpi: 300,
    success: false, reason: '合成扫描失败', simulateFailure: true, failReason: 'raw', file: resultState.file,
  }

  await page.goto('/scan/result')
  await setReactRouterState(page, '/scan/result', failureState)
  const createResponse = page.waitForResponse((response) =>
    response.request().method() === 'POST'
      && new URL(response.url()).pathname === '/api/v1/scan/sessions',
  )
  await page.getByRole('button', { name: '重试扫描' }).click()
  await page.waitForURL('**/scan/settings')
  await createResponse
  await expect(page.locator('[data-w2-page="scan-settings"]')).toBeVisible()
  await expect(page.getByText('在打印机面板开始扫描', { exact: true })).toBeVisible()
  const retryState = await page.evaluate(() => window.history.state?.usr as Record<string, unknown>)
  expect(retryState).toMatchObject({ scanType: 'document', source: 'feeder', pageMode: 'multi', color: 'gray', dpi: 300 })
  for (const field of ['success', 'reason', 'simulateFailure', 'failReason', 'file']) expect(retryState).not.toHaveProperty(field)
  await expectHealthy(page, errors)
})

test('completed scan without a file is a terminal no-file state @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
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

  await page.goto('/scan/progress')
  await setReactRouterState(page, '/scan/progress', { scanTaskId: SCAN_TASK_ID, scanType: 'resume', controlToken: CONTROL_TOKEN })
  await page.waitForURL('**/scan/result')
  await expect(page.getByText('服务端说已完成，但这次回执里没有可用文件').first()).toBeVisible()
  await expect(page.getByText('w2-scan.pdf')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '重试扫描' })).toBeVisible()
  await expectHealthy(page, errors)
})

test('poll requests send the in-memory control token header @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  let seenControlHeader: string | null = null
  await routeExact(page, 'GET', `/api/v1/scan/sessions/${SCAN_TASK_ID}`, async (route) => {
    seenControlHeader = route.request().headers()['x-scan-session-control'] ?? null
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(scanStatus('waiting')),
    })
  })

  await page.goto('/scan/progress')
  await setReactRouterState(page, '/scan/progress', { scanTaskId: SCAN_TASK_ID, scanType: 'resume', controlToken: CONTROL_TOKEN })
  await expect.poll(() => seenControlHeader).toBe(CONTROL_TOKEN)
  await expect(page.getByRole('button', { name: '立即检查' })).toBeEnabled()
  await expectHealthy(page, errors)
})

test('qingxu scan workbench captures 1080x1920 evidence @w2', async ({ page, api }, testInfo) => {
  const errors = collectRuntimeErrors(page, new URL(W2_FILE.fileUrl, 'http://fixture.local').pathname)
  const binary = new FusionW2BinaryRoute(page)
  await binary.install()
  registerShell(api)
  registerScanCapability(api, 'available')
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
  await page.goto('/scan/settings')
  await setReactRouterState(page, '/scan/settings', { scanType: 'resume' })
  await expect(page.getByText('在打印机面板开始扫描', { exact: true })).toBeVisible()
  await shot('qx-scan-settings.png')

  await routeExact(page, 'GET', `/api/v1/scan/sessions/${SCAN_TASK_ID}`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(scanStatus('waiting')) })
  })
  await page.goto('/scan/progress')
  await setReactRouterState(page, '/scan/progress', { scanTaskId: SCAN_TASK_ID, scanType: 'resume', controlToken: CONTROL_TOKEN })
  await expect(page.getByRole('button', { name: '立即检查' })).toBeVisible()
  await shot('qx-scan-progress.png')

  await page.goto('/scan/result')
  await setReactRouterState(page, '/scan/result', resultState)
  await expect(page.getByText('w2-scan.pdf', { exact: true })).toBeVisible()
  await shot('qx-scan-result.png')

  await expectHealthy(page, errors)
})

test('usb-panel path does not create a platform scan session @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  let createCount = 0
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/scan/sessions') createCount += 1
  })

  await page.goto('/scan/start?mode=usb-panel')
  await expect(page.getByText('文件只进你的 U 盘').first()).toBeVisible()
  await expect(page.getByRole('button', { name: '完成后回打印扫描' })).toBeVisible()
  expect(createCount).toBe(0)
  await expectHealthy(page, errors)
})
