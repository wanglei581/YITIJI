import type { Page } from '@playwright/test'
import type { ApiRouter } from '../fixtures/api-router'
import { test, expect } from '../fixtures/kiosk-test'
import {
  assertNoElementCrossesViewport,
  assertNoHorizontalOverflow,
  assertTapTargetPointerHit,
} from './assert-layout'
import { setReactRouterState, W2_FILE, W2_ORDER, W2_PRINT_PARAMS } from './fixtures/fusion-w2-state'

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

const flowState = {
  file: W2_FILE,
  params: W2_PRINT_PARAMS,
  source: 'document',
  ...W2_ORDER,
}

async function expectTouchAndBounds(page: Page): Promise<void> {
  await assertNoHorizontalOverflow(page)
  await assertNoElementCrossesViewport(page)
  const buttons = page.locator('.qx-ctabar .qx-btn:not([disabled]):not([aria-disabled="true"]), .qx-nav-item')
  const count = await buttons.count()
  expect(count, '交付页必须有可点出口').toBeGreaterThan(0)
  for (let i = 0; i < count; i += 1) {
    const button = buttons.nth(i)
    if (await button.isVisible()) await assertTapTargetPointerHit(button)
  }
  const help = page.locator('.pff-help-btn').first()
  if (await help.count() && await help.isVisible()) {
    await help.scrollIntoViewIfNeeded()
    await assertTapTargetPointerHit(help)
  }
}

test('progress renders Agent-polled pending job fields and never claims printed @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  const polls: string[] = []
  api.respondWith('GET', `/api/v1/print/jobs/${W2_ORDER.taskId}`, async () => {
    polls.push('pending')
    return { status: 200, json: { taskId: W2_ORDER.taskId, status: 'pending' } }
  })

  await page.goto('/print/progress')
  await setReactRouterState(page, '/print/progress', flowState)

  await expect(page.locator('[data-w2-page="print-progress"]')).toBeVisible()
  await expect(page.locator('[data-testid="print-fulfill-state-printing"]')).toBeVisible()
  await expect(page.getByText(W2_FILE.name, { exact: true })).toBeVisible()
  await expect(page.getByText('等待终端领取', { exact: false }).first()).toBeVisible()
  await expect(page.getByText('共 2 页', { exact: true })).toBeVisible()
  await expect(page.getByText('打印完成', { exact: true })).toHaveCount(0)
  await expect(page.getByText('已打印', { exact: true })).toHaveCount(0)
  await expect(page.getByText('机身灯亮绿')).toHaveCount(0)
  expect(polls.length, '必须向 GET /print/jobs/:taskId 发出真实轮询').toBeGreaterThan(0)
  await expectTouchAndBounds(page)
  await page.screenshot({ path: test.info().outputPath('fulfill-printing.png'), fullPage: true })
  expect(errors).toEqual([])
})

test('PAPER_EMPTY failure shows out-of-paper copy from Agent errorCode @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  api.respond('GET', `/api/v1/print/jobs/${W2_ORDER.taskId}`, {
    status: 200,
    json: {
      taskId: W2_ORDER.taskId,
      status: 'failed',
      errorCode: 'PAPER_EMPTY',
      errorMessage: 'agent stack must stay hidden',
      failureReasonForUser: '打印机缺纸，当前无法打印，请联系工作人员补纸后重试',
    },
  })
  api.respond('POST', `/api/v1/print/jobs/${W2_ORDER.taskId}/takeaway-url`, {
    status: 404,
    json: { error: { code: 'PRINT_TASK_NOT_FOUND', message: '打印任务不存在或无权访问' } },
  })

  await page.goto('/print/progress')
  await setReactRouterState(page, '/print/progress', flowState)
  await page.waitForURL('**/print/done')

  await expect(page.locator('[data-testid="print-fulfill-state-out-of-paper"]')).toBeVisible()
  await expect(page.getByText('打印机缺纸', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('打印机缺纸，当前无法打印，请联系工作人员补纸后重试', { exact: true })).toBeVisible()
  await expect(page.getByText('agent stack must stay hidden')).toHaveCount(0)
  await expect(page.getByText('打印完成', { exact: true })).toHaveCount(0)
  await expectTouchAndBounds(page)
  await page.screenshot({ path: test.info().outputPath('fulfill-out-of-paper.png'), fullPage: true })
  expect(errors).toEqual([])
})

test('failed done retry posts the real taskId and payment session @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  let jobStatus: 'failed' | 'pending' = 'failed'
  api.respondWith('GET', `/api/v1/print/jobs/${W2_ORDER.taskId}`, () => {
    if (jobStatus === 'failed') {
      return {
        status: 200,
        json: {
          taskId: W2_ORDER.taskId,
          status: 'failed',
          errorCode: 'PRINTER_ERROR',
          failureReasonForUser: '打印机可能卡纸或发生设备故障，当前暂时无法继续使用，请联系工作人员处理',
        },
      }
    }
    return { status: 200, json: { taskId: W2_ORDER.taskId, status: 'pending' } }
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
      amountCents: W2_ORDER.amountCents,
      canRetry: true,
    },
  })
  const retries: Array<{ path: string; method: string; paymentSession: string | undefined }> = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (request.method() === 'POST' && url.pathname === `/api/v1/print/jobs/${W2_ORDER.taskId}/retry`) {
      retries.push({
        path: url.pathname,
        method: request.method(),
        paymentSession: request.headers()['x-payment-session-token'],
      })
    }
  })
  api.respondWith('POST', `/api/v1/print/jobs/${W2_ORDER.taskId}/retry`, () => {
    jobStatus = 'pending'
    return {
      status: 200,
      json: {
        taskId: W2_ORDER.taskId,
        orderId: W2_ORDER.orderId,
        orderNo: W2_ORDER.orderNo,
        amountCents: W2_ORDER.amountCents,
        payStatus: 'paid',
        status: 'pending',
      },
    }
  })

  await page.goto('/print/done')
  await setReactRouterState(page, '/print/done', flowState)

  await expect(page.locator('[data-testid="print-fulfill-state-paper-jam"]')).toBeVisible()
  await expect(page.getByRole('button', { name: '重新提交打印' })).toBeVisible()
  await expectTouchAndBounds(page)
  await page.screenshot({ path: test.info().outputPath('fulfill-paper-jam.png'), fullPage: true })

  await page.getByRole('button', { name: '重新提交打印' }).click()
  await page.waitForURL('**/print/progress')

  expect(retries).toEqual([
    {
      path: `/api/v1/print/jobs/${W2_ORDER.taskId}/retry`,
      method: 'POST',
      paymentSession: W2_ORDER.paymentSessionToken,
    },
  ])
  await expect(page.locator('[data-w2-page="print-progress"]')).toBeVisible()
  await expect(page.getByText('打印完成', { exact: true })).toHaveCount(0)
  expect(errors).toEqual([])
})

test('completed done renders pickup code from pay-status and never invents it @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  api.respond('GET', `/api/v1/print/jobs/${W2_ORDER.taskId}`, {
    status: 200,
    json: { taskId: W2_ORDER.taskId, status: 'completed', completedAt: '2026-07-26T00:00:00.000Z' },
  })
  api.respond('GET', `/api/v1/orders/${W2_ORDER.orderId}/pay-status`, {
    status: 200,
    json: {
      orderId: W2_ORDER.orderId,
      orderNo: W2_ORDER.orderNo,
      payStatus: 'paid',
      paymentSource: 'wechat',
      payChannel: 'wechat',
      amountCents: W2_ORDER.amountCents,
      paidAt: '2026-07-26T00:00:00.000Z',
      pickupCode: 'W2-PICKUP-7391',
      attempt: null,
    },
  })

  await page.goto('/print/done')
  await setReactRouterState(page, '/print/done', flowState)

  await expect(page.locator('[data-testid="print-fulfill-state-completed"]')).toBeVisible()
  await expect(page.getByText('打印完成', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('请取走纸张', { exact: true })).toBeVisible()
  await expect(page.getByText('请取走文件', { exact: true })).toBeVisible()
  await expect(page.getByText('W2-PICKUP-7391', { exact: true })).toBeVisible()
  await expect(page.getByText('已打印', { exact: true })).toHaveCount(0)
  await expectTouchAndBounds(page)
  await page.screenshot({ path: test.info().outputPath('fulfill-completed.png'), fullPage: true })
  expect(errors).toEqual([])
})

test('direct done visit without task context stays unknown @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  await page.goto('/print/done')
  await expect(page.getByText('无法确认打印结果', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('打印完成', { exact: true })).toHaveCount(0)
  await expect(page.locator('[data-testid="print-fulfill-state-unknown"]')).toBeVisible()
  await expectTouchAndBounds(page)
  await page.screenshot({ path: test.info().outputPath('fulfill-unknown.png'), fullPage: true })
  expect(errors).toEqual([])
})
