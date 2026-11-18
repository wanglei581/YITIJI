import type { Page } from '@playwright/test'
import type { ApiRouter } from '../fixtures/api-router'
import { test, expect } from '../fixtures/kiosk-test'
import { setReactRouterState, W2_FILE, W2_ORDER, W2_PRINT_PARAMS } from './fixtures/fusion-w2-state'

const PRINTER_STATUS_PATH = '/api/v1/terminals/KSK-001/printer-status'

function registerShell(api: ApiRouter): void {
  api.respond('GET', '/api/v1/terminals/KSK-001/screensaver', {
    status: 200,
    json: { enabled: false, idleTimeoutSec: 180, items: [] },
  })
}

const flowState = {
  file: W2_FILE,
  params: W2_PRINT_PARAMS,
  source: 'document',
  ...W2_ORDER,
  amountCents: 0,
}

function registerFailedJam(api: ApiRouter): void {
  api.respond('GET', `/api/v1/print/jobs/${W2_ORDER.taskId}`, {
    status: 200,
    json: {
      taskId: W2_ORDER.taskId,
      status: 'failed',
      errorCode: 'PRINTER_ERROR',
      failureReasonForUser: '打印机可能卡纸或发生设备故障，当前暂时无法继续使用。',
    },
  })
  api.respond('POST', `/api/v1/print/jobs/${W2_ORDER.taskId}/takeaway-url`, {
    status: 200,
    json: {
      signedUrl: '/api/v1/files/signed/takeaway-demo',
      expiresAt: '2099-01-01T00:00:00.000Z',
      filename: W2_FILE.name,
      mimeType: 'application/pdf',
      sizeBytes: 128,
      orderId: W2_ORDER.orderId,
      orderNo: W2_ORDER.orderNo,
      payStatus: 'paid',
      amountCents: 0,
      canRetry: false,
    },
  })
}

function registerPrinterStatus(api: ApiRouter, current: { value: string }): void {
  api.respondWith('GET', PRINTER_STATUS_PATH, () => ({
    status: 200,
    json: { printerStatus: current.value, paperLevel: 'sufficient', isOnline: true },
  }))
}

async function openFailedJam(page: Page): Promise<void> {
  await page.goto('/print/done')
  await setReactRouterState(page, '/print/done', flowState)
  await expect(page.locator('[data-testid="print-fulfill-state-paper-jam"]')).toBeVisible()
}

async function advancePrinterPoll(page: Page): Promise<void> {
  const seen = page.waitForResponse((res) => res.url().includes(PRINTER_STATUS_PATH) && res.request().method() === 'GET' && res.ok())
  await page.clock.runFor(21_000)
  await seen
}

test('confirmed paper jam keeps the title after the printer reports ready @w2', async ({ page, api }) => {
  test.setTimeout(60_000)
  await page.clock.install({ time: new Date('2026-11-19T08:00:00+08:00') })
  registerShell(api)
  registerFailedJam(api)
  const printer = { value: 'paper_jam' }
  registerPrinterStatus(api, printer)

  await openFailedJam(page)
  const heading = page.getByRole('heading', { level: 1 })
  await expect(heading).toHaveText('打印机卡纸')
  await expect(page.getByText('可能卡纸')).toHaveCount(0)
  await expect(page.getByText('打印机卡纸，当前无法打印。')).toBeVisible()

  printer.value = 'ready'
  await advancePrinterPoll(page)
  await expect(heading).toHaveText('打印机卡纸')
  await expect(page.getByText('可能卡纸')).toHaveCount(0)
  await expect(page.getByText('工作人员')).toHaveCount(0)
})

test('a fault that was never paper jam stays the unconfirmed title after the printer is ready @w2', async ({ page, api }) => {
  test.setTimeout(60_000)
  await page.clock.install({ time: new Date('2026-11-19T08:00:00+08:00') })
  registerShell(api)
  registerFailedJam(api)
  const printer = { value: 'error' }
  registerPrinterStatus(api, printer)

  await openFailedJam(page)
  const heading = page.getByRole('heading', { level: 1 })
  await expect(heading).toHaveText('打印机出了故障（可能卡纸）')
  await expect(page.getByText('打印机可能卡纸或发生设备故障，当前暂时无法继续使用。')).toBeVisible()

  printer.value = 'ready'
  await advancePrinterPoll(page)
  await expect(heading).toHaveText('打印机出了故障（可能卡纸）')
  await expect(page.getByRole('heading', { level: 1, name: '打印机卡纸', exact: true })).toHaveCount(0)
  await expect(page.getByText('工作人员')).toHaveCount(0)
})

test('out-of-paper takeaway expiry does not add a second service phone @w2', async ({ page, api }) => {
  test.setTimeout(60_000)
  await page.clock.install({ time: new Date('2026-11-19T08:00:00+08:00') })
  registerShell(api)
  api.respondWith('GET', PRINTER_STATUS_PATH, () => ({
    status: 200,
    json: { printerStatus: 'paper_empty', paperLevel: 'empty', isOnline: true },
  }))
  api.respond('GET', `/api/v1/print/jobs/${W2_ORDER.taskId}`, {
    status: 200,
    json: {
      taskId: W2_ORDER.taskId,
      status: 'failed',
      errorCode: 'PAPER_EMPTY',
      failureReasonForUser: '打印机缺纸，当前无法打印。',
    },
  })
  api.respond('POST', `/api/v1/print/jobs/${W2_ORDER.taskId}/takeaway-url`, {
    status: 200,
    json: {
      signedUrl: '/api/v1/files/signed/takeaway-demo',
      expiresAt: '2026-11-19T08:00:03+08:00',
      filename: W2_FILE.name,
      mimeType: 'application/pdf',
      sizeBytes: 128,
      orderId: W2_ORDER.orderId,
      orderNo: W2_ORDER.orderNo,
      payStatus: 'paid',
      amountCents: 0,
      canRetry: true,
    },
  })

  await page.goto('/print/done')
  await setReactRouterState(page, '/print/done', flowState)
  const paper = page.locator('[data-testid="print-fulfill-state-out-of-paper"]')
  await expect(paper).toBeVisible()
  await expect(paper.getByText('文件带走')).toBeVisible()
  await expect(paper.getByRole('button', { name: '重新提交打印' })).toBeVisible()
  const phoneHits = () => paper.evaluate((el) => (el.innerText.match(/服务电话/g) ?? []).length)
  expect(await phoneHits()).toBe(1)

  await page.clock.runFor(4_000)
  await expect(paper.getByText('手机带走链接已过期，不影响这笔订单。')).toBeVisible()
  await expect(paper.getByText('文件带走')).toHaveCount(0)
  expect(await phoneHits()).toBe(1)
  await expect(paper.getByText('工作人员')).toHaveCount(0)
})
