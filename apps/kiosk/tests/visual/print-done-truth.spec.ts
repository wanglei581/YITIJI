import type { Page } from '@playwright/test'
import type { PrintJobTakeawayUrl } from '@ai-job-print/shared'
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
const PHONE = '拨打服务电话 18369161921（工作日 9:00–18:00）'
const SENTENCE_2 = `这台机器暂时打不了，我们已经收到提醒，会尽快处理。请稍后再来；需要帮助请${PHONE}。`
const SENTENCE_5 = `如需退款，请${PHONE}，我们核实后原路退回。`

function supportContact(api: ApiRouter, patch: { miniapp?: boolean }): void {
  api.respond('GET', '/api/v1/public/support-contact', {
    status: 200,
    json: {
      success: true,
      data: {
        servicePhone: '18369161921',
        serviceHours: '工作日 9:00–18:00',
        otherOnlineTerminalNearby: false,
        miniappPublished: patch.miniapp === true,
      },
    },
  })
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
  // 失败态会主动申请「带走链接」；真值页无归属凭证 → 404，页面须能承受
  api.respond('POST', `/api/v1/print/jobs/${TASK_ID}/takeaway-url`, {
    status: 404,
    json: { error: { code: 'PRINT_TASK_NOT_FOUND', message: '任务不存在' } },
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
  // 服务端原话仍叫人找现场工作人员。屏上整句换成标准句 2，默认单点位、小程序未发布。
  await expect(page.getByText('打印机暂时离线，请联系现场工作人员', { exact: true })).toHaveCount(0)
  await expect(page.locator('[data-testid="print-fulfill-state-failed"]')).toContainText(SENTENCE_2)
  await expect(page.locator('[data-testid="print-fulfill-state-failed"]')).not.toContainText('换一台机器')
  await expect(page.locator('[data-testid="print-fulfill-state-failed"]')).not.toContainText('这单还在，手机上能看到')
  await expect(page.getByText('private agent stack must remain hidden')).toHaveCount(0)
})

// `PRINT_JOB_UNCONFIRMED` 的全部含义是「派发已开始，但重启后无法确认纸出没出」。
// 整条链路都按「无法确认」处理：Agent 拒绝断言 completed，服务端在任何写入之前拒绝重排
// 以防重复出纸（PRINT_RETRY_UNCONFIRMED_FORBIDDEN），Admin 只引导人工核查。
// 唯独用户终态页此前把它和普通失败混成一屏，副标题写「打印任务已由服务端确认失败」——
// 服务端恰恰没有确认任何事。两个方向都会害人：纸真出来了，用户以为失败去要退款；
// 纸没出来，他也拿不到「系统承认不确定、请找人核查」这个说法。
// 断言刻意放在可见文本上，不依赖 data 钩子，钩子被重构掉时仍然成立。
test('an unconfirmed print is never presented as a confirmed failure @kiosk', async ({ page, api }) => {
  registerShell(api)
  api.respond('GET', `/api/v1/print/jobs/${TASK_ID}`, {
    status: 200,
    json: {
      taskId: TASK_ID,
      status: 'failed',
      errorCode: 'PRINT_JOB_UNCONFIRMED',
      failureReasonForUser: '打印作业已提交到打印队列，但未确认完成，请工作人员检查纸张、卡纸和出纸状态',
    },
  })

  await openDoneWithState(page, taskState)

  // 事故本体：系统不知道结果，却告诉用户「已确认失败」。
  await expect(page.getByText('打印任务已由服务端确认失败')).toHaveCount(0)
  await expect(page.getByText('打印失败', { exact: true })).toHaveCount(0)

  await expect(page.getByText('打印结果未确认', { exact: true }).first()).toBeVisible()
  const state = page.locator('[data-testid="print-fulfill-state-result-unconfirmed"]')
  await expect(state).toContainText('出纸口')
  // 底栏按钮统一叫「求助」，标准句 4 留在正文；这一单没带金额，不写退款。
  await expect(page.getByTestId('print-fulfill-primary')).toHaveText('求助')
  await expect(page.getByTestId('print-fulfill-state-result-unconfirmed')).toContainText(`打印有问题？${PHONE}，或问小青`)
  await expect(state).toContainText(SENTENCE_2)
  await expect(state).not.toContainText('联系现场工作人员')
  await expect(state).not.toContainText('联系工作人员')
  await expect(state).not.toContainText('请工作人员检查')
  await expect(state).not.toContainText('已为你退款')
  await expect(state).not.toContainText('如需退款')
  await expect(state).not.toContainText('换一台机器')
  await page.getByTestId('print-fulfill-primary').click()
  await expect(page).toHaveURL(/\/help$/)
})

// 反向锁：没有该错误码时不得被误改成「未确认」，否则真失败也被说成不确定。
test('a paid unconfirmed print offers the check line and a refund line @kiosk', async ({ page, api }) => {
  registerShell(api)
  api.respond('GET', `/api/v1/print/jobs/${TASK_ID}`, {
    status: 200,
    json: {
      taskId: TASK_ID,
      status: 'failed',
      errorCode: 'PRINT_JOB_UNCONFIRMED',
      failureReasonForUser: '打印作业已提交到打印队列，但未确认完成，请工作人员检查纸张、卡纸和出纸状态',
    },
  })
  await openDoneWithState(page, { ...taskState, amountCents: 200 })
  const state = page.locator('[data-testid="print-fulfill-state-result-unconfirmed"]')
  // 标准句 4 是正文提示；底栏入口显示「求助」，点击仍去 /help。
  await expect(page.getByTestId('print-fulfill-primary')).toHaveText('求助')
  await expect(page.getByTestId('print-fulfill-state-result-unconfirmed')).toContainText(`打印有问题？${PHONE}，或问小青`)
  await expect(state).toContainText(SENTENCE_5)
  await expect(state).not.toContainText('在手机上申请')
  await expect(state).not.toContainText('联系工作人员')
})

// 2026-10-10 走查：未确认屏只说「等待人工核查」「请稍后再来」，没说过 5 分钟可以自己再输同一个码。
// 后端规则：实付 0 元的到机码单，未确认满 5 分钟后同机同码可以整份重打；付费单走原路退款，不说接着打。
test('a zero-yuan pickup-code unconfirmed print says to re-enter the same code after 5 minutes @kiosk', async ({ page, api }) => {
  registerShell(api)
  api.respond('GET', `/api/v1/print/jobs/${TASK_ID}`, {
    status: 200,
    json: { taskId: TASK_ID, status: 'failed', errorCode: 'PRINT_JOB_UNCONFIRMED' },
  })
  await openDoneWithState(page, { ...taskState, amountCents: 0, pickupSource: true })
  const state = page.getByTestId('print-fulfill-state-result-unconfirmed')
  await expect(state).toContainText('没有的话，过 5 分钟回到这台机器，再输一次同一个到机码，可以整份重打（每单最多 2 次）。')
  await expect(state).toContainText('系统已登记，这次结果没能确认')
  await expect(state).toContainText('过 5 分钟可以回这台机器再输一次同一个到机码')
  await expect(state).not.toContainText('等待人工核查')
  await expect(state).not.toContainText('核实后给出结论')
  await expect(state).not.toContainText('退款')
  // 未确认时本页不给「重新提交打印」：5 分钟内点了也会被拒。
  await expect(page.getByRole('button', { name: '重新提交打印' })).toHaveCount(0)
})

test('paid or on-site unconfirmed prints never mention the same-code resume @kiosk', async ({ page, api }) => {
  registerShell(api)
  api.respond('GET', `/api/v1/print/jobs/${TASK_ID}`, {
    status: 200,
    json: { taskId: TASK_ID, status: 'failed', errorCode: 'PRINT_JOB_UNCONFIRMED' },
  })
  await openDoneWithState(page, { ...taskState, amountCents: 200, pickupSource: true })
  const state = page.getByTestId('print-fulfill-state-result-unconfirmed')
  await expect(state).toBeVisible()
  await expect(state).not.toContainText('同一个到机码')
  await openDoneWithState(page, { ...taskState, amountCents: 0 })
  await expect(state).toBeVisible()
  await expect(state).not.toContainText('同一个到机码')
})

test('a zero-yuan unconfirmed print does not mention a refund @kiosk', async ({ page, api }) => {
  registerShell(api)
  api.respond('GET', `/api/v1/print/jobs/${TASK_ID}`, {
    status: 200,
    json: { taskId: TASK_ID, status: 'failed', errorCode: 'PRINT_JOB_UNCONFIRMED' },
  })
  await openDoneWithState(page, { ...taskState, amountCents: 0 })
  await expect(page.getByText('免费试运营，本单 0 元')).toBeVisible()
  // 标准句 4 是正文提示；底栏入口显示「求助」，点击仍去 /help。
  await expect(page.getByTestId('print-fulfill-primary')).toHaveText('求助')
  await expect(page.getByTestId('print-fulfill-state-result-unconfirmed')).toContainText(`打印有问题？${PHONE}，或问小青`)
  await expect(page.getByText('退款')).toHaveCount(0)
  await expect(page.getByText('换一台机器')).toHaveCount(0)
})

test('a plain failure is still shown as a confirmed failure @kiosk', async ({ page, api }) => {
  registerShell(api)
  api.respond('GET', `/api/v1/print/jobs/${TASK_ID}`, {
    status: 200,
    json: {
      taskId: TASK_ID,
      status: 'failed',
      failureReasonForUser: '打印机暂时离线，请联系现场工作人员',
    },
  })

  await openDoneWithState(page, taskState)

  await expect(page.getByText('打印失败', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('打印结果未确认', { exact: true })).toHaveCount(0)
})

test('completed backend status overrides a forged failure state @kiosk', async ({ page, api }) => {
  registerShell(api)
  api.respond('GET', `/api/v1/print/jobs/${TASK_ID}`, {
    status: 200,
    json: { taskId: TASK_ID, status: 'completed', completedAt: '2026-07-26T00:00:00.000Z' },
  })

  await openDoneWithState(page, { ...taskState, success: false, reason: '伪造失败' })

  await expect(page.getByText('打印完成', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('都打好了，拿走前核一下', { exact: true })).toBeVisible()
  await expect(page.getByText('请取走文件', { exact: true })).toHaveCount(0)
  await expect(page.getByText('请取走纸张', { exact: true })).toHaveCount(0)
  await expect(page.getByText('伪造失败')).toHaveCount(0)
  // 2026-09-08 反向变异：原先这里只有 `toHaveCount(0)`。满意度分组长在反馈弹层里、
  // 弹层默认关闭（PrintDonePage 的 feedbackOpen 初值 false），所以那条断言**永远为真** ——
  // 无论满意度功能是否还活着都不会红，属「断言所在的分支从不执行」。
  // 现在改成两段：先确认它不裸露在完成页主界面，再驱动出弹层正向断言完成态收得到分
  // （PrintDonePage 传 showSatisfaction={resultState === 'completed'}）。
  await expect(page.getByRole('group', { name: '满意度评分' })).toHaveCount(0)
  await page.getByRole('button', { name: '反馈问题' }).click()
  await expect(page.getByRole('group', { name: '满意度评分' })).toBeVisible()
  await page.keyboard.press('Escape')
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
  api.respond('POST', `/api/v1/print/jobs/${nextTaskId}/takeaway-url`, {
    status: 404,
    json: { error: { code: 'PRINT_TASK_NOT_FOUND', message: '任务不存在' } },
  })

  await openDoneWithState(page, {
    ...taskState,
    orderId,
    paymentSessionToken: 'truth-payment-session',
  })
  await expect(page.getByText('已在本机出纸', { exact: true })).toBeVisible()
  await expect(page.getByText('OLD-PICKUP-001', { exact: true })).toHaveCount(0)
  await expect(page.getByText('取件码', { exact: true })).toHaveCount(0)

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
  await expect(page.getByText('已在本机出纸', { exact: true })).toHaveCount(0)
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

for (const errorCode of ['PRINTER_ERROR', 'PAPER_EMPTY']) {
  test(`old agent retry rejection stays beside the actions in the first viewport (${errorCode}) @kiosk`, async ({ page, api }) => {
    registerShell(api)
    api.respond('GET', `/api/v1/print/jobs/${TASK_ID}`, {
      status: 200,
      json: { taskId: TASK_ID, status: 'failed', errorCode, failureReasonForUser: '打印未完成' },
    })
    api.respond('POST', `/api/v1/print/jobs/${TASK_ID}/takeaway-url`, {
      status: 200,
      json: {
        orderId: 'truth-retry-order', orderNo: 'ORD-TRUTH-RETRY',
        filename: W2_FILE.name, signedUrl: 'https://example.com/print-takeaway',
        mimeType: 'application/pdf', sizeBytes: 2048,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        canRetry: true, amountCents: 200, payStatus: 'paid',
      } satisfies PrintJobTakeawayUrl,
    })
    const retries: unknown[] = []
    await page.route(`**/api/v1/print/jobs/${TASK_ID}/retry`, async (route) => {
      retries.push(route.request().headers()['x-payment-session-token'])
      await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: {
        code: 'PRINT_RETRY_AGENT_VERSION',
        message: '这台终端的打印程序版本过旧，升级到 0.4.13 后才能重新提交',
      } }) })
    })
    await openDoneWithState(page, { ...taskState, paymentSessionToken: 'truth-retry-session' })
    await expect(page.getByRole('region', { name: '文件带走' })).toBeVisible()
    const retryButton = page.getByRole('button', { name: '重新提交打印', exact: true })
    await expect(retryButton).toBeInViewport({ ratio: 1 })
    // 重试失败文案在点击时拼好，不再跟着后续的联系方式刷新。先等号码上屏。
    await expect(page.getByText(PHONE).first()).toBeVisible()
    await retryButton.click()

    const alert = page.locator('.qx-ctabar').getByRole('alert')
    // 旧 Agent 拒绝重试后改为升级原因加标准句 1，首屏与禁止重放断言保留。
    await expect(alert).toHaveText(`这台机器的打印程序需要升级后才能重新提交。需要帮助？${PHONE}`)
    // 不滚动找提示：toBeVisible 不能证明没有落在二维码下面的滚动区。
    await expect(alert).toBeInViewport({ ratio: 1 })
    const box = await alert.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.y).toBeGreaterThanOrEqual(0)
    expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height)
    await expect(page.getByText('重新提交失败，请联系工作人员补打', { exact: true })).toHaveCount(0)
    await expect(retryButton).toBeEnabled()
    await expect(page).toHaveURL(/\/print\/done$/)
    expect(retries).toEqual(['truth-retry-session'])
  })
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

  // 限流原话里夹了「联系现场工作人员」，屏上改成登记过的限流句，不把找人那半句留下。
  await expect(page.getByRole('alert')).toContainText('反馈提交过于频繁，请稍后再试')
  await expect(page.getByRole('alert')).not.toContainText('联系现场工作人员')
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

test('pickup completed receipt shows real summary and directs reorders to phone @kiosk', async ({ page, api }) => {
  registerShell(api)
  api.respond('GET', `/api/v1/print/jobs/${TASK_ID}`, { status: 200, json: { taskId: TASK_ID, status: 'completed' } })
  await openDoneWithState(page, { taskId: TASK_ID, pickupSource: true, file: { name: '取件文件.pdf', size: '', pages: 3 }, params: { copies: 2, colorMode: 'color', duplex: 'duplex_long_edge' } })
  await expect(page.getByText('本次任务摘要', { exact: true })).toBeVisible()
  await expect(page.getByText('3 页 × 2 份', { exact: true })).toBeVisible()
  await expect(page.getByText('双面（长边）', { exact: true })).toBeVisible()
  await expect(page.getByText('彩色', { exact: true })).toBeVisible()
  // 到机码的单本来就是手机上下的，再打一份回手机下单；本机不给「再印一份」（取件码方案②）。
  await expect(page.getByTestId('print-fulfill-reprint')).toHaveCount(0)
  await expect(page.getByText('要再打一份请在手机上重新下单', { exact: true })).toBeVisible()
})

test('pickup completed receipt directs a reorder to the phone only after the miniapp is published @kiosk', async ({ page, api }) => {
  registerShell(api)
  supportContact(api, { miniapp: true })
  api.respond('GET', `/api/v1/print/jobs/${TASK_ID}`, { status: 200, json: { taskId: TASK_ID, status: 'completed' } })
  await openDoneWithState(page, { taskId: TASK_ID, pickupSource: true, file: { name: '取件文件.pdf', size: '', pages: 3 }, params: { copies: 2, colorMode: 'color', duplex: 'duplex_long_edge' } })
  await expect(page.getByText('要再打一份请在手机上重新下单', { exact: true })).toBeVisible()
  await expect(page.getByTestId('print-fulfill-reprint')).toHaveCount(0)
})
