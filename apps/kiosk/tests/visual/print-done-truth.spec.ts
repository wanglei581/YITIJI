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
  await expect(page.getByRole('button', { name: '反馈问题' })).toHaveCount(0)
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

// ============================================================
// 反馈问题入口（匿名可提交）。
//
// 旧断言在这里期望点击后跳到 /me/feedback —— 那是会员面，必须登录。
// 刚打印失败的人绝大多数没登录，等于把报障挡在登录墙外，所以那条契约本身是 bug，
// 已随本批次改为就地打匿名端点 POST /kiosk/feedback。
// ============================================================

/** 让页面停在「后端确认失败」态：报障最典型的入口。 */
async function openFailedDone(page: Page, api: ApiRouter): Promise<void> {
  registerShell(api)
  api.respond('GET', `/api/v1/print/jobs/${TASK_ID}`, {
    status: 200,
    json: { taskId: TASK_ID, status: 'failed', failureReasonForUser: '打印未完成' },
  })
  await openDoneWithState(page, { ...taskState, success: true })
}

test('anonymous user can submit print feedback without logging in @kiosk', async ({ page, api }) => {
  const submissions: { headers: Record<string, string>; body: unknown }[] = []
  await page.route('**/api/v1/kiosk/feedback', async (route) => {
    const request = route.request()
    submissions.push({ headers: request.headers(), body: request.postDataJSON() })
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          ticketId: 'FBK-ANON-001',
          submitterType: 'anonymous_kiosk',
          category: 'print',
          issueCode: 'print_incomplete_or_jam',
          satisfaction: null,
          status: 'pending',
          deduplicated: false,
          createdAt: '2026-08-16T10:00:00.000Z',
        },
      }),
    })
  })

  await openFailedDone(page, api)

  // 没有任何登录动作：直接开弹层、选类型、提交。
  await page.getByRole('button', { name: '反馈问题' }).click()
  await page.getByRole('button', { name: '卡住没出完' }).click()
  await page.getByRole('button', { name: '提交反馈' }).click()

  await expect(page.getByText('已收到你的反馈')).toBeVisible()
  await expect(page.getByText('FBK-ANON-001')).toBeVisible()
  // 不跳登录墙。
  await expect(page).not.toHaveURL(/\/me\/feedback/)

  expect(submissions).toHaveLength(1)
  const [submission] = submissions
  // 匿名：不带 Authorization，也不捎带会话 Cookie。
  expect(submission.headers['authorization']).toBeUndefined()
  expect(submission.headers['cookie']).toBeUndefined()
  // 只上报定位现场问题所需的字段，不夹带联系方式等个人信息。
  expect(submission.body).toEqual({
    terminalId: 'KSK-001',
    issueCode: 'print_incomplete_or_jam',
    relatedPrintTaskId: TASK_ID,
  })
})

test('a rejected submission is shown honestly and never fakes success @kiosk', async ({ page, api }) => {
  await page.route('**/api/v1/kiosk/feedback', async (route) => {
    await route.fulfill({
      status: 429,
      contentType: 'application/json',
      body: JSON.stringify({
        error: {
          code: 'KIOSK_FEEDBACK_RATE_LIMITED',
          message: '该设备反馈提交过于频繁，请稍后再试或联系现场工作人员',
        },
      }),
    })
  })

  await openFailedDone(page, api)

  await page.getByRole('button', { name: '反馈问题' }).click()
  await page.getByRole('button', { name: '卡住没出完' }).click()
  await page.getByRole('button', { name: '提交反馈' }).click()

  // 服务端的真实原因原样展示。
  await expect(page.getByRole('alert')).toContainText('该设备反馈提交过于频繁')
  // 绝不出现回执 / 成功态。
  await expect(page.getByText('已收到你的反馈')).toHaveCount(0)
  await expect(page.locator('[data-kiosk-feedback-result="submitted"]')).toHaveCount(0)
  // 表单仍在，用户可以重试。
  await expect(page.getByRole('button', { name: '提交反馈' })).toBeVisible()
})

test('network failure does not fabricate a receipt @kiosk', async ({ page, api }) => {
  await page.route('**/api/v1/kiosk/feedback', (route) => route.abort('internetdisconnected'))

  await openFailedDone(page, api)

  await page.getByRole('button', { name: '反馈问题' }).click()
  await page.getByRole('button', { name: '页数与预期不符' }).click()
  await page.getByRole('button', { name: '提交反馈' }).click()

  await expect(page.getByRole('alert')).toContainText('网络连接失败')
  await expect(page.getByText('已收到你的反馈')).toHaveCount(0)
})

test('the feedback surface never promises a refund @kiosk', async ({ page, api }) => {
  await openFailedDone(page, api)
  await page.getByRole('button', { name: '反馈问题' }).click()

  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  // 退款裁决权在后台。一体机只上报，绝不出现「点一下就能拿到钱」的暗示。
  for (const forbidden of ['退款', '申请退款', '赔付', '理赔', '已退款']) {
    await expect(dialog.getByText(forbidden, { exact: false })).toHaveCount(0)
  }
})
