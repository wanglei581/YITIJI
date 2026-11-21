/**
 * 模拟面试按次付款（P2e-3）：
 * - 收费机器「付 1.00 元开始练」+ 稿 329 说明条；全 0 免费机器不出付款 UI
 * - 付款前先确认年满 14 周岁（不确认不建单；确认后进付款屏，付成返回自动开场不弹第二次）
 * - 开场 POST /mock-interviews/:id/start 带 x-kiosk-session-id 与 x-service-order-id 请求头
 * - 没开成 → 免费再试一次 → 同一订单号
 * - 报告失败 → 免费再试一次 → 成功
 * - 报告再失败 → 「钱在退回」只在服务单为 refunding/refunded 时出；refund_failed 用标准句；未 refunded 绝不写「已退」
 * - 小青 / 模拟面试不可用 → 无付款按钮，仍是「打印通用题目单」
 * - 402 SERVICE_PAYMENT_REQUIRED → 兜底回付款屏
 */
import type { Page } from '@playwright/test'
import type { ApiRouter } from '../fixtures/api-router'
import { expect, test } from '../fixtures/kiosk-test'
import { attachMachinePricing, KIOSK_CONFIG_PATH, type MachineServicePrices } from '../fixtures/machine-pricing'
import {
  SERVICE_ORDERS_PATH,
  apiError,
  ok,
  recordServiceOrderCalls,
  serviceOrderClosePath,
  serviceOrderPath,
  serviceOrderView,
  type FixtureOrder,
} from '../fixtures/service-orders'
import { registerW6Api } from './fixtures/fusion-w6-api'

const INTERVIEW_ID = 'iv-pay-p2e3-001'
const INTERVIEW_START_PATH = `/api/v1/mock-interviews/${INTERVIEW_ID}/start`
const INTERVIEW_ANSWER_PATH = `/api/v1/mock-interviews/${INTERVIEW_ID}/answer`
const INTERVIEW_END_PATH = `/api/v1/mock-interviews/${INTERVIEW_ID}/end`
const INTERVIEW_REPORT_PATH = `/api/v1/mock-interviews/${INTERVIEW_ID}/report`
const TRIP_KEY = 'ai-job-print:service-trip:v1'

const ORDER_INTERVIEW: Omit<FixtureOrder, 'createdAt'> = {
  id: 'cmi8p2e3iv0001s6h9k2v8w4n',
  providerOrderNo: 'svc9c41f2a7be03d85e1f602a8d',
  serviceKey: 'mock_interview',
  amountCents: 100,
  provider: 'sandbox',
}

const CREATED_INTERVIEW = {
  success: true,
  data: { sessionId: INTERVIEW_ID, questionTarget: 4, accessToken: 'iv-pay-token-001' },
}

const STARTED_INTERVIEW = {
  success: true,
  data: {
    done: false,
    question: '请先做一个简短的自我介绍，并说明你为什么应聘这个岗位。',
    qType: 'intro',
    questionIndex: 1,
    questionTarget: 4,
  },
}

const ANSWERED_INTERVIEW = {
  success: true,
  data: {
    done: false,
    question: '请讲一段你解决过具体问题的真实经历。',
    qType: 'experience',
    questionIndex: 2,
    questionTarget: 4,
  },
}

const INTERVIEW_REPORT = {
  success: true,
  data: {
    sessionId: INTERVIEW_ID,
    position: '行政专员',
    industry: '制造业',
    interviewerType: 'hr',
    interviewerLabel: 'HR 面试',
    durationMin: 5,
    endedAt: new Date().toISOString(),
    report: {
      overall: { level: 'pass', summary: '回答结构清晰，能够结合具体经历说明职责。' },
      expression: ['表达清楚，条理明确'],
      positionFit: ['与行政专员日常工作贴合'],
      credibility: ['举出了具体登记台账的例子'],
      professional: ['具备基本流程意识'],
      adaptability: ['面对追问反应平稳'],
      risks: ['建议补充可核实的量化结果'],
      predictedQuestions: [{ question: '高峰期如何保证台账不漏记？', why: '考察执行细节', approach: '按步骤说明分栏与复核动作' }],
      starAdvice: { s: '交代背景', t: '说明任务', a: '突出个人行动', r: '补充真实结果', reminder: '数字由本人核实' },
      checklist: ['准备 1 分钟自我介绍', '梳理两段具体经历'],
    },
  },
}

function setupMachine(api: ApiRouter, services: MachineServicePrices, options?: { declarationEnforced?: boolean }): void {
  registerW6Api(api)
  attachMachinePricing(api, 0, 0, services)
  if (options?.declarationEnforced !== undefined) {
    api.mapJson('GET', KIOSK_CONFIG_PATH, (json) => {
      const base = json && typeof json === 'object' ? (json as Record<string, unknown>) : {}
      return {
        ...base,
        ai: { loginGate: 'off', declarationEnforced: options.declarationEnforced, paused: false },
      }
    })
  }
  api.respond('GET', '/api/v1/health', { status: 200, json: { success: true, data: { status: 'ok' } } })
  api.respond('POST', '/api/v1/mock-interviews', { status: 200, json: CREATED_INTERVIEW })
  api.respond('POST', INTERVIEW_START_PATH, { status: 200, json: STARTED_INTERVIEW })
  api.respond('POST', INTERVIEW_ANSWER_PATH, { status: 200, json: ANSWERED_INTERVIEW })
  api.respond('POST', INTERVIEW_END_PATH, { status: 200, json: INTERVIEW_REPORT })
  api.respond('GET', INTERVIEW_REPORT_PATH, { status: 200, json: INTERVIEW_REPORT })
}

async function expectNoForbiddenCopy(page: Page): Promise<void> {
  const text = await page.locator('body').innerText()
  expect(text).not.toContain('¥')
  expect(text).not.toContain('工作人员')
  expect(text).not.toContain('微信或支付宝')
  expect(text).not.toContain('如需退款')
}

/** 从 /interview 填写第 1 步 → 第 2 步 → 停在第 3 步核对开始。 */
async function reachSetupStep3(page: Page): Promise<void> {
  await page.goto('/interview')
  await page.getByPlaceholder(/输入目标岗位/).fill('行政专员')
  await page.getByRole('button', { name: /选择行业/ }).click()
  const dialog = page.getByRole('dialog', { name: '选择面试行业' })
  await dialog.getByRole('button', { name: '制造业', exact: true }).click()
  await dialog.getByRole('button', { name: '完成' }).click()
  await page.getByRole('button', { name: '应届生', exact: true }).click()
  await page.getByRole('button', { name: '下一步', exact: true }).click()
  await page.getByRole('button', { name: '下一步', exact: true }).click()
  await expect(page.locator('[data-setup-step="3"]')).toBeVisible()
}

/** 确认 14 周岁弹窗。 */
async function confirmAge14(page: Page): Promise<void> {
  await expect(page.getByRole('dialog', { name: '你已年满 14 周岁吗？' })).toBeVisible()
  await page.locator('[data-ai-declaration-scope="age_14_plus"][data-ai-declaration-choice="yes"]').click()
}

test.describe('模拟面试按次付款 P2e-3 @kiosk', () => {
  test('收费机器（面试 1.00 元、其余 0）显示「付 1.00 元开始练」与稿 329 说明条 @kiosk', async ({ page, api }) => {
    setupMachine(api, { mock_interview: 100, resume_optimize: 0, scan: 0 })
    await reachSetupStep3(page)

    await expect(page.getByTestId('interview-primary')).toHaveText('付 1.00 元开始练')
    const bar = page.getByTestId('interview-charge-bar')
    await expect(bar).toBeVisible()
    await expect(bar).toContainText('这一次 1.00 元')
    await expect(bar).toContainText(
      'AI 模拟面试。先确认年满 14 周岁，再付款。付好了才开始练。没练成可免费再试一次；再不成，钱自动退回原付款账户，到账时间以支付渠道为准。',
    )
    await expectNoForbiddenCopy(page)
  })

  test('免费机器（全 0）不出付款按钮与说明条，沿用「创建并开始练习」 @kiosk', async ({ page, api }) => {
    setupMachine(api, { mock_interview: 0, resume_optimize: 0, scan: 0 })
    const orderCalls = recordServiceOrderCalls(page)
    await reachSetupStep3(page)

    await expect(page.getByTestId('interview-primary')).toHaveText('创建并开始练习')
    await expect(page.getByTestId('interview-charge-bar')).toHaveCount(0)
    await page.getByTestId('interview-primary').click()
    await expect(page.locator('[data-kiosk-screen="interview-session"]')).toBeVisible()
    expect(orderCalls).toHaveLength(0)
  })

  test('付款前 14 岁不确认：留在开练页且发出 0 次建单请求 @kiosk', async ({ page, api }) => {
    setupMachine(api, { mock_interview: 100 }, { declarationEnforced: true })
    const orderCalls = recordServiceOrderCalls(page)
    await reachSetupStep3(page)

    await page.getByTestId('interview-primary').click()
    await expect(page.getByRole('dialog', { name: '你已年满 14 周岁吗？' })).toBeVisible()
    await page.locator('[data-ai-declaration-scope="age_14_plus"][data-ai-declaration-choice="no"]').click()
    await expect(page.locator('[data-ai-declaration-dialog="explain"]')).toBeAttached()
    await page.locator('[data-ai-declaration-scope="age_14_plus"][data-ai-declaration-choice="no"]').click()

    await expect(page).toHaveURL(/\/interview/)
    await expect(page.locator('[data-setup-step="3"]')).toBeVisible()
    await expect(page.getByTestId('interview-setup-error')).toContainText('未满 14 周岁')
    expect(orderCalls.filter((c) => c.method === 'POST' && c.path === SERVICE_ORDERS_PATH)).toHaveLength(0)
  })

  test('付款前确认 14 岁 → 进付款屏 → 付成自动开场不弹第二次且 start 带齐服务单双头 @kiosk', async ({ page, api }) => {
    setupMachine(api, { mock_interview: 100 }, { declarationEnforced: true })
    const order: FixtureOrder = { ...ORDER_INTERVIEW, createdAt: Date.now() }
    let orderPaid = false
    api.respondWith('POST', SERVICE_ORDERS_PATH, () => ok(serviceOrderView(order)))
    api.respondWith('GET', serviceOrderPath(order.id), () => ok(serviceOrderView(
      order,
      orderPaid ? { status: 'paid', paidAt: new Date().toISOString() } : {},
    )))
    api.respondWith('POST', serviceOrderClosePath(order.id), () => ok(serviceOrderView(order, { status: 'closed', closeReason: 'user_cancelled' })))

    const orderCalls = recordServiceOrderCalls(page)
    const startHeaders: Array<Record<string, string>> = []
    page.on('request', (req) => {
      if (req.method() === 'POST' && new URL(req.url()).pathname === INTERVIEW_START_PATH) {
        startHeaders.push(req.headers())
      }
    })

    await reachSetupStep3(page)
    await page.getByTestId('interview-primary').click()
    await confirmAge14(page)

    await expect(page).toHaveURL(/\/pay\/interview/)
    await expect(page.locator('[data-qx-page="pay-service"]')).toHaveAttribute('data-qxt-state', 'wait')
    const createCall = orderCalls.find((c) => c.method === 'POST' && c.path === SERVICE_ORDERS_PATH)
    expect(createCall?.body).toMatchObject({ serviceKey: 'mock_interview' })
    const kioskSessionId = String(createCall?.body?.kioskSessionId ?? '')
    expect(kioskSessionId.length).toBeGreaterThan(0)

    // 付成 → 付款屏自动回到 /interview?stage=setup 并直接开场，不弹第二次 14 岁框。
    orderPaid = true
    await expect(page.locator('[data-kiosk-screen="interview-session"]')).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('[data-ai-declaration-dialog]')).toHaveCount(0)
    expect(startHeaders).toHaveLength(1)
    expect(startHeaders[0]?.['x-kiosk-session-id']).toBe(kioskSessionId)
    expect(startHeaders[0]?.['x-service-order-id']).toBe(order.id)
    expect(startHeaders[0]?.['x-age-14-plus']).toBe('declared')
  })

  test('已付但没开成：显示 RETRY 句与「免费再试一次」，再开沿用同一订单号且不重建单 @kiosk', async ({ page, api }) => {
    setupMachine(api, { mock_interview: 100 })
    const order: FixtureOrder = { ...ORDER_INTERVIEW, createdAt: Date.now() }
    let startCalls = 0
    let orderState: 'pending' | 'paid' | 'retry_free' = 'pending'
    api.respondWith('POST', SERVICE_ORDERS_PATH, () => ok(serviceOrderView(order)))
    api.respondWith('GET', serviceOrderPath(order.id), () => {
      if (orderState === 'retry_free') {
        return ok(serviceOrderView(order, {
          status: 'paid',
          paidAt: new Date(order.createdAt + 1_000).toISOString(),
          attemptsUsed: 1,
          failureReason: '面试开场失败',
          retryUntil: new Date(Date.now() + 10 * 60_000).toISOString(),
        }))
      }
      if (orderState === 'paid') {
        return ok(serviceOrderView(order, { status: 'paid', paidAt: new Date(order.createdAt + 1_000).toISOString() }))
      }
      return ok(serviceOrderView(order))
    })
    api.respondWith('POST', INTERVIEW_START_PATH, () => {
      startCalls += 1
      if (startCalls === 1) {
        orderState = 'retry_free'
        return apiError(500, 'LLM_GENERATION_FAILED', 'AI 面试官开场失败')
      }
      return { status: 200, json: STARTED_INTERVIEW }
    })

    const orderCalls = recordServiceOrderCalls(page)
    const startOrderIds: string[] = []
    page.on('request', (req) => {
      if (req.method() === 'POST' && new URL(req.url()).pathname === INTERVIEW_START_PATH) {
        startOrderIds.push(req.headers()['x-service-order-id'] ?? '')
      }
    })

    await reachSetupStep3(page)
    await page.getByTestId('interview-primary').click()
    await confirmAge14(page)
    await expect(page.locator('[data-qx-page="pay-service"]')).toHaveAttribute('data-qxt-state', 'wait')
    orderState = 'paid'

    // 自动开场第 1 次失败 → 停在 iv-3，显示 RETRY 句和「免费再试一次」，不出收费条。
    await expect(page.locator('[data-setup-step="3"]')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('interview-primary')).toHaveText('免费再试一次')
    await expect(page.getByTestId('interview-charge-bar')).toHaveCount(0)
    await expect(page.locator('.interview-setup-fallback')).toContainText(
      '这一次没做成。可以免费再试一次；不试了或再不成，钱自动退回原付款账户，到账时间以支付渠道为准。',
    )
    await expectNoForbiddenCopy(page)

    // 点「免费再试一次」→ 用同一订单号成功进入作答页，全程只建过 1 张单。
    await page.getByTestId('interview-primary').click()
    await expect(page.locator('[data-kiosk-screen="interview-session"]')).toBeVisible({ timeout: 10_000 })
    expect(startOrderIds).toEqual([order.id, order.id])
    expect(orderCalls.filter((c) => c.method === 'POST' && c.path === SERVICE_ORDERS_PATH)).toHaveLength(1)
  })

  test('作答页报告失败 → 稿 467 句 + 主按钮「免费再试一次」→ 再试成功并清掉本趟服务单 @kiosk', async ({ page, api }) => {
    setupMachine(api, { mock_interview: 100 })
    const order: FixtureOrder = { ...ORDER_INTERVIEW, createdAt: Date.now() }
    let orderMode: 'pending' | 'paid' | 'report_retry' = 'pending'
    let endCalls = 0
    api.respondWith('POST', SERVICE_ORDERS_PATH, () => ok(serviceOrderView(order)))
    api.respondWith('GET', serviceOrderPath(order.id), () => {
      if (orderMode === 'report_retry') {
        return ok(serviceOrderView(order, {
          status: 'consumed',
          paidAt: new Date(order.createdAt + 1_000).toISOString(),
          consumedAt: new Date(order.createdAt + 2_000).toISOString(),
          settledAt: new Date(order.createdAt + 3_000).toISOString(),
          attemptsUsed: 1,
          failureReason: '报告没生成',
          retryUntil: new Date(Date.now() + 10 * 60_000).toISOString(),
        }))
      }
      if (orderMode === 'paid') {
        return ok(serviceOrderView(order, { status: 'paid', paidAt: new Date(order.createdAt + 1_000).toISOString() }))
      }
      return ok(serviceOrderView(order))
    })
    api.respondWith('POST', INTERVIEW_END_PATH, () => {
      endCalls += 1
      if (endCalls === 1) {
        orderMode = 'report_retry'
        return apiError(500, 'LLM_GENERATION_FAILED', '报告生成失败')
      }
      return { status: 200, json: INTERVIEW_REPORT }
    })

    await reachSetupStep3(page)
    await page.getByTestId('interview-primary').click()
    await confirmAge14(page)
    await expect(page.locator('[data-qx-page="pay-service"]')).toHaveAttribute('data-qxt-state', 'wait')
    orderMode = 'paid'
    await expect(page.locator('[data-kiosk-screen="interview-session"]')).toBeVisible({ timeout: 15_000 })

    // 作答一题 → 点结束本场练习 → 第 1 次报告失败 → 稿 467 句 + 主按钮「免费再试一次」。
    await page.getByRole('textbox', { name: '本题回答' }).fill('我在实习期间负责行政来访台账核对和文档整理。')
    await page.getByTestId('interview-primary').click()
    await expect(page.locator('.interview-session__history')).toContainText('行政来访台账')
    await page.getByRole('button', { name: '结束本场练习' }).click()

    await expect(page.locator('.interview-session__error')).toHaveText(
      '报告没生成。可以免费再试一次；不试了或再不成，钱自动退回原付款账户，到账时间以支付渠道为准。',
    )
    await expect(page.getByTestId('interview-primary')).toHaveText('免费再试一次')
    await expectNoForbiddenCopy(page)

    // 点「免费再试一次」→ 第 2 次出报告成功进入报告页，并清理本趟服务单记录。
    await page.getByTestId('interview-primary').click()
    await expect(page.locator('[data-interview-stage="report"]')).toBeVisible({ timeout: 10_000 })
    expect(endCalls).toBe(2)
    expect(await page.evaluate((key) => window.sessionStorage.getItem(key), TRIP_KEY)).toBeNull()
  })

  test('作答页报告再失败：「钱在退回」只在 refunding/refunded 时出现，未 refunded 绝不写「已退」 @kiosk', async ({ page, api }) => {
    setupMachine(api, { mock_interview: 100 })
    const order: FixtureOrder = { ...ORDER_INTERVIEW, createdAt: Date.now() }
    let orderMode: 'pending' | 'paid' | 'report_retry' | 'consumed_no_retry' | 'refunding' | 'refunded' = 'pending'
    let endCalls = 0
    let postFailGets = 0
    api.respondWith('POST', SERVICE_ORDERS_PATH, () => ok(serviceOrderView(order)))
    api.respondWith('GET', serviceOrderPath(order.id), () => {
      if (orderMode === 'consumed_no_retry') {
        postFailGets += 1
        // 第 1 次查仍为 consumed（无再试窗口）→ 不得写「钱在退回」；后续轮询依次推进到 refunding → refunded。
        if (postFailGets === 1) {
          return ok(serviceOrderView(order, {
            status: 'consumed',
            paidAt: new Date(order.createdAt + 1_000).toISOString(),
            settledAt: new Date(order.createdAt + 2_000).toISOString(),
            attemptsUsed: 1,
            retryUntil: null,
          }))
        }
        if (postFailGets === 2) {
          orderMode = 'refunding'
          return ok(serviceOrderView(order, {
            status: 'refunding',
            paidAt: new Date(order.createdAt + 1_000).toISOString(),
            refundReason: '报告没生成',
          }))
        }
        orderMode = 'refunded'
        return ok(serviceOrderView(order, {
          status: 'refunded',
          paidAt: new Date(order.createdAt + 1_000).toISOString(),
          refundReason: '报告没生成',
          refundedAt: new Date().toISOString(),
        }))
      }
      if (orderMode === 'refunding') {
        orderMode = 'refunded'
        return ok(serviceOrderView(order, {
          status: 'refunded',
          paidAt: new Date(order.createdAt + 1_000).toISOString(),
          refundReason: '报告没生成',
          refundedAt: new Date().toISOString(),
        }))
      }
      if (orderMode === 'refunded') {
        return ok(serviceOrderView(order, {
          status: 'refunded',
          paidAt: new Date(order.createdAt + 1_000).toISOString(),
          refundReason: '报告没生成',
          refundedAt: new Date().toISOString(),
        }))
      }
      if (orderMode === 'report_retry') {
        return ok(serviceOrderView(order, {
          status: 'consumed',
          paidAt: new Date(order.createdAt + 1_000).toISOString(),
          settledAt: new Date(order.createdAt + 2_000).toISOString(),
          attemptsUsed: 1,
          failureReason: '报告没生成',
          retryUntil: new Date(Date.now() + 10 * 60_000).toISOString(),
        }))
      }
      if (orderMode === 'paid') {
        return ok(serviceOrderView(order, { status: 'paid', paidAt: new Date(order.createdAt + 1_000).toISOString() }))
      }
      return ok(serviceOrderView(order))
    })
    api.respondWith('POST', INTERVIEW_END_PATH, () => {
      endCalls += 1
      orderMode = endCalls === 1 ? 'report_retry' : 'consumed_no_retry'
      return apiError(500, 'LLM_GENERATION_FAILED', '报告生成失败')
    })

    await reachSetupStep3(page)
    await page.getByTestId('interview-primary').click()
    await confirmAge14(page)
    await expect(page.locator('[data-qx-page="pay-service"]')).toHaveAttribute('data-qxt-state', 'wait')
    orderMode = 'paid'
    await expect(page.locator('[data-kiosk-screen="interview-session"]')).toBeVisible({ timeout: 15_000 })

    await page.getByRole('textbox', { name: '本题回答' }).fill('我负责每周会议纪要整理和跨部门事项跟进。')
    await page.getByTestId('interview-primary').click()
    await expect(page.locator('.interview-session__history')).toContainText('会议纪要整理')

    // 第 1 次报告失败 → 可免费再试一次
    await page.getByRole('button', { name: '结束本场练习' }).click()
    await expect(page.getByTestId('interview-primary')).toHaveText('免费再试一次')

    // 第 2 次报告失败：先是 consumed（无 retryUntil）→ 核对中，绝不写「钱在退回」和「已退」
    await page.getByTestId('interview-primary').click()
    const alert = page.locator('.interview-session__error')
    await expect(alert).toContainText('正在核对这一单的退款状态')
    await expect(alert).not.toContainText('钱在退回')
    await expect(alert).not.toContainText('已退')

    // 轮询进入 refunding → 写「钱在退回」，仍绝不写「已退」，且隐藏生成/重试按钮
    await expect(alert).toContainText('钱在退回原付款账户，到账时间以支付渠道为准。', { timeout: 10_000 })
    await expect(alert).not.toContainText('已退')
    await expect(page.getByTestId('interview-primary')).toHaveText('回到首页')
    await expect(page.getByRole('button', { name: '结束并生成练习报告' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '免费再试一次' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '结束本场练习' })).toHaveCount(0)

    // 轮询进入 refunded → 才允许写「已退回」，仍不允许第三次触发 end
    await expect(alert).toContainText('已退回', { timeout: 10_000 })
    await expect(alert).toContainText('钱在退回')
    await expect(page.getByTestId('interview-primary')).toHaveText('回到首页')
    expect(endCalls).toBe(2)
    await expectNoForbiddenCopy(page)
  })

  test('作答页免费再试过期 409 SERVICE_RETRY_EXPIRED：展示退款并隐藏生成/重试按钮，保留返回与带走问答 @kiosk', async ({ page, api }) => {
    setupMachine(api, { mock_interview: 100 })
    const order: FixtureOrder = { ...ORDER_INTERVIEW, createdAt: Date.now() }
    let orderMode: 'pending' | 'paid' | 'report_retry' | 'refunded' = 'pending'
    let endCalls = 0
    api.respondWith('POST', SERVICE_ORDERS_PATH, () => ok(serviceOrderView(order)))
    api.respondWith('GET', serviceOrderPath(order.id), () => {
      if (orderMode === 'refunded') {
        return ok(serviceOrderView(order, {
          status: 'refunded',
          paidAt: new Date(order.createdAt + 1_000).toISOString(),
          refundReason: '免费再试已过期',
          refundedAt: new Date().toISOString(),
        }))
      }
      if (orderMode === 'report_retry') {
        return ok(serviceOrderView(order, {
          status: 'consumed',
          paidAt: new Date(order.createdAt + 1_000).toISOString(),
          settledAt: new Date(order.createdAt + 2_000).toISOString(),
          attemptsUsed: 1,
          failureReason: '报告没生成',
          retryUntil: new Date(Date.now() + 10 * 60_000).toISOString(),
        }))
      }
      if (orderMode === 'paid') {
        return ok(serviceOrderView(order, { status: 'paid', paidAt: new Date(order.createdAt + 1_000).toISOString() }))
      }
      return ok(serviceOrderView(order))
    })
    api.respondWith('POST', INTERVIEW_END_PATH, () => {
      endCalls += 1
      if (endCalls === 1) {
        orderMode = 'report_retry'
        return apiError(503, 'AI_INTERVIEW_REPORT_FAILED', '报告生成失败')
      }
      orderMode = 'refunded'
      return apiError(409, 'SERVICE_RETRY_EXPIRED', '免费再试时间已过，这一次的费用会自动退回原付款账户')
    })

    await reachSetupStep3(page)
    await page.getByTestId('interview-primary').click()
    await confirmAge14(page)
    await expect(page.locator('[data-qx-page="pay-service"]')).toHaveAttribute('data-qxt-state', 'wait')
    orderMode = 'paid'
    await expect(page.locator('[data-kiosk-screen="interview-session"]')).toBeVisible({ timeout: 15_000 })

    await page.getByRole('textbox', { name: '本题回答' }).fill('我负责每周台账复核和进度同步。')
    await page.getByTestId('interview-primary').click()
    await expect(page.locator('.interview-session__history')).toContainText('台账复核')

    await page.getByRole('button', { name: '结束本场练习' }).click()
    await expect(page.getByTestId('interview-primary')).toHaveText('免费再试一次')

    // 模拟再试时服务端已判定过期 409 并走退款：隐藏生成/重试按钮、保留安全出口
    await page.getByTestId('interview-primary').click()
    const alert = page.locator('.interview-session__error')
    await expect(alert).toContainText('已退回')
    await expect(page.getByTestId('interview-primary')).toHaveText('回到首页')
    await expect(page.getByRole('button', { name: '结束并生成练习报告' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '免费再试一次' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '结束本场练习' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /带走本场问答/ })).toBeVisible()
    expect(endCalls).toBe(2)
    await expectNoForbiddenCopy(page)
  })

  test('作答页退款卡住（refund_failed）：给无人值守标准句，不写「钱在退回」和「已退」 @kiosk', async ({ page, api }) => {
    setupMachine(api, { mock_interview: 100 })
    const order: FixtureOrder = { ...ORDER_INTERVIEW, createdAt: Date.now() }
    let orderMode: 'pending' | 'paid' | 'refund_failed' = 'pending'
    api.respondWith('POST', SERVICE_ORDERS_PATH, () => ok(serviceOrderView(order)))
    api.respondWith('GET', serviceOrderPath(order.id), () => {
      if (orderMode === 'refund_failed') {
        return ok(serviceOrderView(order, {
          status: 'refund_failed',
          paidAt: new Date(order.createdAt + 1_000).toISOString(),
          refundReason: '报告没生成',
        }))
      }
      if (orderMode === 'paid') {
        return ok(serviceOrderView(order, { status: 'paid', paidAt: new Date(order.createdAt + 1_000).toISOString() }))
      }
      return ok(serviceOrderView(order))
    })
    api.respondWith('POST', INTERVIEW_END_PATH, () => {
      orderMode = 'refund_failed'
      return apiError(500, 'LLM_GENERATION_FAILED', '报告生成失败')
    })

    await reachSetupStep3(page)
    await page.getByTestId('interview-primary').click()
    await confirmAge14(page)
    await expect(page.locator('[data-qx-page="pay-service"]')).toHaveAttribute('data-qxt-state', 'wait')
    orderMode = 'paid'
    await expect(page.locator('[data-kiosk-screen="interview-session"]')).toBeVisible({ timeout: 15_000 })

    await page.getByRole('textbox', { name: '本题回答' }).fill('我做过半年客服质检和工单复盘。')
    await page.getByTestId('interview-primary').click()
    await expect(page.locator('.interview-session__history')).toContainText('客服质检')
    await page.getByRole('button', { name: '结束本场练习' }).click()

    const alert = page.locator('.interview-session__error')
    await expect(alert).toContainText('需要帮助？拨打服务电话')
    await expect(alert).not.toContainText('钱在退回')
    await expect(alert).not.toContainText('已退')
    await expect(page.getByTestId('interview-primary')).toHaveText('回到首页')
    await expect(page.getByRole('button', { name: '结束并生成练习报告' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '免费再试一次' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '结束本场练习' })).toHaveCount(0)
    await expectNoForbiddenCopy(page)
  })

  test('小青 / 模拟面试不可用：收费机器也不出付款按钮，仍是「打印通用题目单」 @kiosk', async ({ page, api }) => {
    setupMachine(api, { mock_interview: 100 })
    api.respond('GET', '/api/v1/mock-interviews/availability', {
      status: 200,
      json: { success: true, data: { available: false } },
    })
    const orderCalls = recordServiceOrderCalls(page)
    await reachSetupStep3(page)

    await expect(page.getByTestId('interview-primary')).toHaveText('打印通用题目单')
    await expect(page.getByTestId('interview-charge-bar')).toHaveCount(0)
    await expect(page.locator('body')).not.toContainText('付 1.00 元开始练')
    expect(orderCalls).toHaveLength(0)
  })

  test('402 SERVICE_PAYMENT_REQUIRED 兜底：补确认 14 岁 → 付款 → 付成自动带头开场无循环 @kiosk', async ({ page, api }) => {
    // 初始价目表显示 0 元（模拟管理员刚切收费、终端缓存未到期），start 回 402 时兜底回付款屏，付成后自动开场且仅建 1 单不循环。
    setupMachine(api, { mock_interview: 0 })
    const order: FixtureOrder = { ...ORDER_INTERVIEW, createdAt: Date.now() }
    let switchedToPaid = false
    let orderPaid = false
    let startCalls = 0
    const startHeaders: Array<Record<string, string>> = []
    page.on('request', (req) => {
      if (req.method() === 'POST' && new URL(req.url()).pathname === INTERVIEW_START_PATH) {
        startHeaders.push(req.headers())
      }
    })
    api.mapJson('GET', KIOSK_CONFIG_PATH, (json) => {
      const base = json && typeof json === 'object' ? (json as Record<string, unknown>) : {}
      const pricing = base.pricing && typeof base.pricing === 'object' ? (base.pricing as Record<string, unknown>) : {}
      const effective = pricing.effective && typeof pricing.effective === 'object'
        ? (pricing.effective as Record<string, unknown>)
        : {}
      return {
        ...base,
        pricing: { ...pricing, effective: { ...effective, mock_interview: switchedToPaid ? 100 : 0 } },
      }
    })
    api.respondWith('POST', INTERVIEW_START_PATH, () => {
      startCalls += 1
      if (startCalls === 1) {
        switchedToPaid = true
        return apiError(402, 'SERVICE_PAYMENT_REQUIRED', '这一次要先付款')
      }
      return { status: 200, json: STARTED_INTERVIEW }
    })
    api.respondWith('POST', SERVICE_ORDERS_PATH, () => ok(serviceOrderView(order)))
    api.respondWith('GET', serviceOrderPath(order.id), () => ok(serviceOrderView(
      order,
      orderPaid ? { status: 'paid', paidAt: new Date().toISOString() } : {},
    )))

    const orderCalls = recordServiceOrderCalls(page)
    await reachSetupStep3(page)
    await expect(page.getByTestId('interview-primary')).toHaveText('创建并开始练习')
    await page.getByTestId('interview-primary').click()
    await confirmAge14(page)
    await expect(page).toHaveURL(/\/pay\/interview/)
    await expect(page.locator('[data-qx-page="pay-service"]')).toHaveAttribute('data-qxt-state', 'wait')

    // 付成 → 返回开练页自动带头开场进入作答页，全程仅 1 次建单、绝不来回弹回付款屏
    orderPaid = true
    await expect(page.locator('[data-kiosk-screen="interview-session"]')).toBeVisible({ timeout: 15_000 })
    expect(orderCalls.filter((c) => c.method === 'POST' && c.path === SERVICE_ORDERS_PATH)).toHaveLength(1)
    expect(startHeaders).toHaveLength(2)
    expect(startHeaders[1]?.['x-service-order-id']).toBe(order.id)
    expect(String(startHeaders[1]?.['x-kiosk-session-id'] ?? '').length).toBeGreaterThan(0)
  })

  test('402 防循环边界：刷新后仍为 0 元时停在开练页提示，不反复跳转付款屏也不建单 @kiosk', async ({ page, api }) => {
    setupMachine(api, { mock_interview: 0 })
    api.respondWith('POST', INTERVIEW_START_PATH, () =>
      apiError(402, 'SERVICE_PAYMENT_REQUIRED', '这一次要先付款'),
    )
    const orderCalls = recordServiceOrderCalls(page)

    await reachSetupStep3(page)
    await expect(page.getByTestId('interview-primary')).toHaveText('创建并开始练习')
    await page.getByTestId('interview-primary').click()

    await expect(page).toHaveURL(/\/interview/)
    await expect(page.locator('[data-setup-step="3"]')).toBeVisible()
    await expect(page.getByTestId('interview-setup-error')).toContainText('要先付款')
    expect(orderCalls.filter((c) => c.method === 'POST' && c.path === SERVICE_ORDERS_PATH)).toHaveLength(0)
  })
})
