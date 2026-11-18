import type { Page } from '@playwright/test'
import type { ApiRouter } from '../fixtures/api-router'
import { test, expect } from '../fixtures/kiosk-test'
import { setReactRouterState, W2_FILE, W2_ORDER, W2_PRINT_PARAMS } from './fixtures/fusion-w2-state'

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

const flowState = {
  file: W2_FILE,
  params: W2_PRINT_PARAMS,
  source: 'document',
  ...W2_ORDER,
}

const FREE_JAM_PILL = '免费试运营，本单 0 元 · 打印机出了故障（可能卡纸）'

async function lineCount(locator: ReturnType<Page['locator']>): Promise<number> {
  return locator.evaluate((el) => {
    const range = document.createRange()
    range.selectNodeContents(el)
    return range.getClientRects().length
  })
}

test('free paper-jam header keeps brand and clock on one line while the long pill stays whole @w2', async ({ page, api }) => {
  registerShell(api)
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

  await page.goto('/print/done')
  await setReactRouterState(page, '/print/done', { ...flowState, amountCents: 0 })
  await expect(page.locator('[data-testid="print-fulfill-state-paper-jam"]')).toBeVisible()

  const brand = page.locator('[data-qx-page="print-done"] .qxt-brand b')
  await expect(brand).toHaveText('职易达')
  expect(await lineCount(brand)).toBe(1)
  const brandBox = await brand.evaluate((el) => {
    const box = el.getBoundingClientRect()
    return {
      height: box.height,
      width: box.width,
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      fontSize: getComputedStyle(el).fontSize,
    }
  })
  expect(brandBox.height).toBeLessThan(40)
  expect(brandBox.width).toBeGreaterThanOrEqual(72)
  expect(brandBox.scrollWidth).toBeLessThanOrEqual(brandBox.clientWidth + 1)
  expect(brandBox.fontSize).toBe('28px')

  const date = page.locator('[data-qx-page="print-done"] .qxt-clock small')
  const dateText = (await date.innerText()).replace(/\s+/g, ' ').trim()
  expect(dateText).toMatch(/^\d+月\d+日 周.$/)
  expect(await lineCount(date)).toBe(1)
  const dateBox = await date.evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
    whiteSpace: getComputedStyle(el).whiteSpace,
  }))
  expect(dateBox.whiteSpace).toBe('nowrap')
  expect(dateBox.scrollWidth).toBeLessThanOrEqual(dateBox.clientWidth + 1)

  const pill = page.locator('[data-qx-page="print-done"] .qxt-status')
  await expect(pill).toContainText(FREE_JAM_PILL)
  const pillFit = await pill.evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
  }))
  expect(pillFit.scrollWidth).toBeLessThanOrEqual(pillFit.clientWidth + 1)
  expect(pillFit.scrollHeight).toBeLessThanOrEqual(pillFit.clientHeight + 1)
})
