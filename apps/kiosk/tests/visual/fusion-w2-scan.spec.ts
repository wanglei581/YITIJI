import type { Page, Route } from '@playwright/test'
import type { ApiRouter } from '../fixtures/api-router'
import { test, expect } from '../fixtures/kiosk-test'
import { assertNoHorizontalOverflow } from './assert-layout'
import { setReactRouterState, W2_FILE } from './fixtures/fusion-w2-state'

const SCAN_TASK_ID = 'w2-scan-001'
const CONTROL_TOKEN = 'w2-scan-control'
const LATER = new Date(Date.now() + 10 * 60 * 1000).toISOString()

function collectRuntimeErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
  page.on('requestfailed', (request) => {
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
}

async function expectHealthy(page: Page, errors: string[]): Promise<void> {
  await expect(page.locator('[data-kiosk-presentation="fusion-youth"]').first()).toBeVisible()
  await assertNoHorizontalOverflow(page)
  expect(errors).toEqual([])
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

test('scan start reflects a ready device and allows continuation @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  registerCreatedScan(api)
  api.respond('GET', '/api/v1/kiosk/device/status', {
    status: 200,
    json: { data: { scanner: { status: 'ready', online: true, busy: false } } },
  })

  await page.goto('/scan/start')
  await expect(page.getByText('扫描仪就绪', { exact: true })).toBeVisible()
  const next = page.getByRole('button', { name: /下一步 · 查看扫描指引/ })
  await expect(next).toBeEnabled()
  await next.click()
  await page.waitForURL('**/scan/settings')
  await expect(page.getByText('在打印机面板开始扫描', { exact: true })).toBeVisible()
  await expectHealthy(page, errors)
})

test('scan start blocks continuation while the device is offline @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  api.respond('GET', '/api/v1/kiosk/device/status', {
    status: 200,
    json: { data: { scanner: { status: 'offline', online: false, busy: false } } },
  })

  await page.goto('/scan/start')
  await expect(page.getByText('扫描仪离线', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /下一步 · 查看扫描指引/ })).toBeDisabled()
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

  await page.goto('/scan/settings')
  await setReactRouterState(page, '/scan/settings', { scanType: 'resume' })
  await expect(page.getByText('在打印机面板开始扫描', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '我已操作，开始等待' }).click()
  await page.waitForURL('**/scan/result', { timeout: 8_000 })
  await expect(page.getByText('w2-scan.pdf', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => window.sessionStorage.getItem('w2-scan-control'))).toBeNull()
  await expectHealthy(page, errors)
})

test('cancel-completed race rechecks status and recovers the real scan file @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  api.respond('GET', '/api/v1/kiosk/device/status', {
    status: 200,
    json: { data: { scanner: { status: 'ready', online: true, busy: false } } },
  })
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
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  api.respond('GET', '/api/v1/print/price-config', {
    status: 200,
    json: { billingEnabled: true, items: [{ serviceKey: 'print_bw_page', unitCents: 100, unit: 'page', description: '黑白打印' }] },
  })

  await page.goto('/scan/result')
  await setReactRouterState(page, '/scan/result', resultState)
  const priceResponse = page.waitForResponse((response) =>
    response.request().method() === 'GET'
      && new URL(response.url()).pathname === '/api/v1/print/price-config',
  )
  const printerResponse = page.waitForResponse((response) =>
    response.request().method() === 'GET'
      && new URL(response.url()).pathname === '/api/v1/terminals/KSK-001/printer-status',
  )
  await page.getByRole('button', { name: /直接打印/ }).click()
  await page.waitForURL('**/print/confirm')
  await Promise.all([priceResponse, printerResponse])
  await expect(page.locator('[data-w2-page="print-confirm"]')).toBeVisible()
  await expect(page.getByText('¥1.00/页 × 2 页 × 1 份', { exact: true })).toBeVisible()
  await expect(page.locator('[data-w2-page="print-confirm"] .print-file-name')).toHaveText('w2-scan.pdf')
  await expectHealthy(page, errors)
})

test('successful resume scan can continue to AI parsing @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  api.respond('POST', '/api/v1/resume/parse', {
    status: 503,
    json: { success: false, error: { code: 'W2_STOP_AFTER_NAV', message: 'synthetic stop' } },
  })

  await page.goto('/scan/result')
  await setReactRouterState(page, '/scan/result', resultState)
  await page.getByRole('button', { name: /AI 简历识别/ }).click()
  await page.waitForURL('**/resume/parse')
  await expectHealthy(page, errors)
})

test('successful scan exposes the real save destination @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)

  await page.goto('/scan/result')
  await setReactRouterState(page, '/scan/result', resultState)
  await page.getByRole('button', { name: /保存到我的文档/ }).click()
  await page.waitForURL('**/me/documents')
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
