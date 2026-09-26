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

  // 缺纸页不得承诺「补纸之后这次打印会自己接着打」。服务端没有这条链路：
  // PrintTask 已是 failed 终态，唯一的重来是 POST /print/jobs/:taskId/retry，
  // 它要服务端先给出 canRetry，而且重打整份文件、不是"剩下没打的部分"。
  // 本用例的 takeaway-url 故意回 404 → canRetry 拿不到 →「重新提交打印」按钮根本不存在，
  // 正是"页面没给出重试出口"的那一态：此时更不能让用户以为补个纸就能等到结果。
  const outOfPaper = page.locator('[data-testid="print-fulfill-state-out-of-paper"]')
  await expect(outOfPaper).toContainText('不会在加纸后自动继续')
  await expect(outOfPaper).toContainText('联系现场工作人员')
  await expect(outOfPaper).toContainText('订单和已付金额都保留着')
  // 「只有出现按钮时才能自己重打」——重试必须被说成有条件的，不是无条件可用。
  await expect(outOfPaper).toContainText('只有本页出现「重新提交打印」按钮时')
  await expect(page.getByRole('button', { name: '重新提交打印' })).toHaveCount(0)

  // 旧文案的四种说法一句都不许回来（含「不需要重新下单」这种把重试说成理所当然的兜底）。
  for (const banned of [
    '加纸后可以继续',
    '加纸后可继续打印',
    '剩下没打的部分会在加纸后继续',
    '不需要重新下单',
  ]) {
    await expect(outOfPaper, `缺纸页不得再出现「${banned}」`).not.toContainText(banned)
  }

  // 稿 15 out-of-paper 的结构：小青区即页头 → 任务卡（真实单文件 + 缺纸说明 + 费用边界）→ 现场三步 → 底栏两出口。
  await expect(outOfPaper.locator('.pff-xq-ask')).toHaveText('机器里没纸了。')
  const taskCard = outOfPaper.getByTestId('print-fulfill-list')
  await expect(taskCard).toContainText(W2_FILE.name)
  await expect(taskCard).toContainText('缺纸中断')
  await expect(taskCard).toContainText(`任务号 ${W2_ORDER.taskId}`)
  await expect(taskCard.getByTestId('print-fulfill-fallback')).toContainText('打印机缺纸')
  await expect(taskCard).toContainText('费用与订单边界')
  // takeaway-url 404：订单号与金额退回进页时带来的真值，不编退款状态。
  await expect(taskCard.locator('.pff-inbar-kv')).toContainText(`订单 ${W2_ORDER.orderNo}`)
  await expect(taskCard.locator('.pff-inbar-kv')).toContainText('支付状态 已付 ¥2.00')
  await expect(page.locator('.qx-pill')).toHaveText('已付 ¥2.00 · 缺纸')
  const steps = outOfPaper.locator('.pff-step')
  await expect(steps).toHaveCount(3)
  await expect(steps.nth(0)).toContainText('本机不知道出了几页')
  await expect(steps.nth(2)).toContainText(`订单号 ${W2_ORDER.orderNo}`)
  // 服务端不回已出页数、也没有费用处理结果：不许出现页数进度或退款承诺。
  for (const banned of ['已出 1', '等待加纸', '退款', '自动续打后']) {
    await expect(outOfPaper, `缺纸页不得出现「${banned}」`).not.toContainText(banned)
  }
  await expect(page.getByRole('button', { name: '查看费用说明' })).toBeVisible()
  await expect(page.getByTestId('print-fulfill-primary')).toHaveText('联系工作人员处理')
  await expect(outOfPaper.getByRole('status')).toContainText('暂时无法签发带走链接，请联系工作人员')

  await expectTouchAndBounds(page)
  await page.screenshot({ path: test.info().outputPath('fulfill-out-of-paper.png'), fullPage: true })
  expect(errors).toEqual([])
})

test('PAPER_EMPTY with server canRetry offers whole-file resubmit and server order facts @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  api.respond('GET', `/api/v1/print/jobs/${W2_ORDER.taskId}`, {
    status: 200,
    json: {
      taskId: W2_ORDER.taskId,
      status: 'failed',
      errorCode: 'PAPER_EMPTY',
      failureReasonForUser: '打印机缺纸，当前无法打印，请联系工作人员补纸后重试',
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
      orderNo: 'SRV-ORDER-777',
      payStatus: 'paid',
      amountCents: 350,
      canRetry: true,
    },
  })

  await page.goto('/print/done')
  await setReactRouterState(page, '/print/done', flowState)

  const outOfPaper = page.locator('[data-testid="print-fulfill-state-out-of-paper"]')
  await expect(outOfPaper).toBeVisible()
  // 带走接口回了订单：订单号与金额以服务端为准，不用进页时带来的值。
  await expect(page.locator('.qx-pill')).toHaveText('已付 ¥3.50 · 缺纸')
  await expect(outOfPaper.locator('.pff-inbar-kv')).toContainText('订单 SRV-ORDER-777')
  await expect(outOfPaper.locator('.pff-inbar-kv')).toContainText('支付状态 已付 ¥3.50')
  await expect(outOfPaper).not.toContainText(W2_ORDER.orderNo)
  // canRetry 为真才出现重打出口，且说清是整份重打、不再收费，不是「续打剩下的」。
  await expect(page.getByRole('button', { name: '重新提交打印' })).toBeVisible()
  await expect(outOfPaper.locator('.pff-step').nth(2)).toContainText('整份重打')
  await expect(outOfPaper).toContainText('不会在加纸后自动继续')
  await expect(outOfPaper.getByRole('region', { name: '文件带走' })).toBeVisible()

  await expectTouchAndBounds(page)
  await page.screenshot({ path: test.info().outputPath('fulfill-out-of-paper-retry.png'), fullPage: true })
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
