import type { Page } from '@playwright/test'
import type { ApiRouter } from '../fixtures/api-router'
import { test, expect } from '../fixtures/kiosk-test'
import { setReactRouterState, W2_FILE, W2_PRINT_PARAMS } from './fixtures/fusion-w2-state'

const TASK_ID = 'truth-task-001'
const taskState = {
  taskId: TASK_ID,
  file: W2_FILE,
  params: W2_PRINT_PARAMS,
  source: 'document',
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

async function openDoneWithState(page: Page, state: Record<string, unknown>): Promise<void> {
  await page.goto('/print/done')
  await setReactRouterState(page, '/print/done', state)
}

test('direct visit without a task context cannot claim success @kiosk', async ({ page, api }) => {
  registerShell(api)

  await page.goto('/print/done')

  await expect(page.getByText('无法确认打印结果', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('打印完成', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '异常反馈' })).toHaveCount(0)
  await expect(page.getByRole('group', { name: '满意度评分' })).toHaveCount(0)
})

test('forged success cannot override pending or failed backend status @kiosk', async ({ page, api }) => {
  registerShell(api)
  api.respond('GET', `/api/v1/print/jobs/${TASK_ID}`, {
    status: 200,
    json: { taskId: TASK_ID, status: 'pending' },
  })

  await openDoneWithState(page, { ...taskState, success: true })
  await page.waitForURL('**/print/progress')
  await expect(page.locator('[data-w2-page="print-progress"]')).toBeVisible()
  await expect(page.getByText('打印完成', { exact: true })).toHaveCount(0)

  api.respond('GET', `/api/v1/print/jobs/${TASK_ID}`, {
    status: 200,
    json: {
      taskId: TASK_ID,
      status: 'failed',
      errorMessage: 'private agent stack must remain hidden',
      failureReasonForUser: '打印机暂时离线，请联系现场工作人员',
    },
  })
  await openDoneWithState(page, { ...taskState, success: true, reason: '伪造成功' })
  await expect(page.getByText('打印失败', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('打印机暂时离线，请联系现场工作人员', { exact: true })).toBeVisible()
  await expect(page.getByText('private agent stack must remain hidden')).toHaveCount(0)
})

test('completed backend status overrides a forged failure state @kiosk', async ({ page, api }) => {
  registerShell(api)
  api.respond('GET', `/api/v1/print/jobs/${TASK_ID}`, {
    status: 200,
    json: { taskId: TASK_ID, status: 'completed', completedAt: '2026-07-26T00:00:00.000Z' },
  })

  await openDoneWithState(page, { ...taskState, success: false, reason: '伪造失败' })

  await expect(page.getByText('打印完成', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('请取走文件', { exact: true })).toBeVisible()
  await expect(page.getByText('伪造失败')).toHaveCount(0)
  await expect(page.getByRole('group', { name: '满意度评分' })).toHaveCount(0)

  await page.getByRole('button', { name: '使用帮助' }).click()
  await expect(page).toHaveURL(/\/help$/)
})

test('a response for a different task cannot confirm the current task @kiosk', async ({ page, api }) => {
  registerShell(api)
  api.respond('GET', `/api/v1/print/jobs/${TASK_ID}`, {
    status: 200,
    json: { taskId: 'another-task', status: 'completed', completedAt: '2026-07-26T00:00:00.000Z' },
  })

  await openDoneWithState(page, taskState)

  await expect(page.getByText('无法确认打印结果', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('打印完成', { exact: true })).toHaveCount(0)
})

test('same-page task switch hides the previous task and pickup code immediately @kiosk', async ({ page, api }) => {
  const nextTaskId = 'truth-task-002'
  const orderId = 'truth-order-001'
  registerShell(api)
  api.respond('GET', `/api/v1/print/jobs/${TASK_ID}`, {
    status: 200,
    json: { taskId: TASK_ID, status: 'completed', completedAt: '2026-07-26T00:00:00.000Z' },
  })
  api.respond('GET', `/api/v1/orders/${orderId}/pay-status`, {
    status: 200,
    json: {
      orderId,
      orderNo: 'TRUTH-ORDER-001',
      payStatus: 'paid',
      paymentSource: 'wechat',
      payChannel: 'wechat',
      amountCents: 200,
      paidAt: '2026-07-26T00:00:00.000Z',
      pickupCode: 'OLD-PICKUP-001',
      attempt: null,
    },
  })
  api.respond('GET', `/api/v1/print/jobs/${nextTaskId}`, {
    status: 200,
    json: { taskId: nextTaskId, status: 'failed', failureReasonForUser: '新任务已确认失败' },
  })

  await openDoneWithState(page, {
    ...taskState,
    orderId,
    paymentSessionToken: 'truth-payment-session',
  })
  await expect(page.getByText('OLD-PICKUP-001', { exact: true })).toBeVisible()

  await page.evaluate((nextState) => {
    const browserState = {
      ...(window.history.state ?? {}),
      usr: nextState,
      key: 'truth-task-switch',
    }
    window.history.replaceState(browserState, '', '/print/done')
    window.dispatchEvent(new PopStateEvent('popstate', { state: browserState }))
  }, { ...taskState, taskId: nextTaskId })

  await expect(page.getByText('新任务已确认失败', { exact: true })).toBeVisible()
  await expect(page.getByText('打印完成', { exact: true })).toHaveCount(0)
  await expect(page.getByText('OLD-PICKUP-001', { exact: true })).toHaveCount(0)
})

for (const status of ['claimed', 'printing'] as const) {
  test(`${status} remains an active task instead of claiming completion @kiosk`, async ({ page, api }) => {
    registerShell(api)
    api.respond('GET', `/api/v1/print/jobs/${TASK_ID}`, {
      status: 200,
      json: { taskId: TASK_ID, status },
    })

    await openDoneWithState(page, taskState)

    await page.waitForURL('**/print/progress')
    await expect(page.getByText('打印完成', { exact: true })).toHaveCount(0)
  })
}

for (const unavailable of [
  { name: '404', register: (api: ApiRouter) => api.respond('GET', `/api/v1/print/jobs/${TASK_ID}`, { status: 404, json: { message: 'not found' } }) },
  { name: 'network', register: (api: ApiRouter) => api.abort('GET', `/api/v1/print/jobs/${TASK_ID}`, 'internetdisconnected') },
] as const) {
  test(`${unavailable.name} and network failures remain unknown @kiosk`, async ({ page, api }) => {
    registerShell(api)
    unavailable.register(api)

    await openDoneWithState(page, { ...taskState, success: true })

    await expect(page.getByText('无法确认打印结果', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('打印完成', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '重试打印' })).toHaveCount(0)
  })
}

test('task-aware feedback uses the existing print feedback contract @kiosk', async ({ page, api }) => {
  registerShell(api)
  api.respond('GET', `/api/v1/print/jobs/${TASK_ID}`, {
    status: 200,
    json: { taskId: TASK_ID, status: 'failed', failureReasonForUser: '打印未完成' },
  })

  await openDoneWithState(page, { ...taskState, success: true })
  await page.getByRole('button', { name: '异常反馈' }).click()

  await expect(page).toHaveURL(`/me/feedback?category=print&relatedPrintTaskId=${TASK_ID}`)
})
