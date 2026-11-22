/**
 * 简历这一趟的按次付款接线（P2e-2）：
 * - 诊断页：收费出「付 X.XX 元并开始」与「带走这份报告」价格说明；全 0 / 公共点位 / 读不到价不出；已付过（paid / 可免费再试）直接进优化。
 * - 完整链路：诊断页点付款 → 付款屏付成 → 进优化带 x-kiosk-session-id 与 x-service-order-id（排版调整也带头）→ 导出写「导出不另收钱」。
 * - 优化首次失败 → 查单为可免费再试 → 出「免费再试一次」与 RETRY 句 → 点击后仍带同一订单号出稿（不新建单）。
 * - 402 SERVICE_PAYMENT_REQUIRED / SERVICE_* → 回付款屏，不落到「优化结果读取失败，请返回重新解析」。
 * - 对照页 compare：带服务单头；首次失败可免费再试复用同一订单号；不画「这一趟已包含」。
 * - st-ai-down：收费机器未付 / 已付两句各自准确；不收费机器保持原样。
 * - 导出与从零生成：收费机器写「导出不另收钱」且不加付款入口；免费机器仍写「免费试运营」。
 */
import type { Page, Request } from '@playwright/test'
import type { ApiRouter } from '../fixtures/api-router'
import { expect, test } from '../fixtures/kiosk-test'
import {
  attachRawMachinePricing,
  freeMachinePricing,
  publicSiteMachinePricing,
  resumeOnlyMachinePricing,
} from '../fixtures/machine-pricing'
import {
  ORDER_A,
  SERVICE_ORDERS_PATH,
  apiError,
  ok,
  paidServiceOrderView,
  recordServiceOrderCalls,
  refundingServiceOrderView,
  retryFreeServiceOrderView,
  serviceOrderClosePath,
  serviceOrderPath,
  serviceOrderView,
  type FixtureOrder,
} from '../fixtures/service-orders'
import { diagnosis } from './fixtures/fusion-w3-states'
import { registerW6Api } from './fixtures/fusion-w6-api'
import { VISIBLE_PDF } from './fixtures/fusion-w2-binary-route'

const TRIP_KEY = 'ai-job-print:service-trip:v1'
const RESUME_SESSION_KEY = 'ai-job-print:current-ai-resume'
const TASK_ID = diagnosis.taskId
const ACCESS_TOKEN = diagnosis.accessToken
const SESSION_ID = '11111111-2222-4333-8444-555555555555'

const REPORT_WITH_FOUR_ISSUES = {
  ...diagnosis,
  report: {
    ...diagnosis.report,
    issues: [
      { id: 'I1', dim: 'quantification', title: '工作经历', evidence: [{ blockKey: 'experience', lineIndex: 0, quote: '负责学院公众号的选题、撰写和排版。' }], impact: '看不出做了多少、做成了什么。', fixIt: '只在原文已有的事实里补周期和篇数，没有的数字不要写上。' },
      { id: 'I2', dim: 'objective', title: '求职目标', evidence: [{ blockKey: 'objective', lineIndex: 0, quote: '希望找一份稳定的工作。' }], impact: '全篇没有岗位名，后面的经历对不上具体职位。', fixIt: '写成目标岗位，让经历围着它写。' },
      { id: 'I3', dim: 'experience', title: '项目经历', evidence: [{ blockKey: 'project', lineIndex: 0, quote: '参与迎新志愿服务。' }], impact: '只有活动名，没有具体做了什么。', fixIt: '补上你负责的那一段，不新加没做过的项目。' },
      { id: 'I4', dim: 'keyword', title: '技能', evidence: [{ blockKey: 'skill', lineIndex: 0, quote: '熟悉办公软件。' }], impact: '看不出会哪些工具。', fixIt: '写成你真实用过的软件名，例如 Excel、Word。' },
    ],
  },
}

const RETRY_COPY = '这一次没做成。可以免费再试一次；不试了或再不成，钱自动退回原付款账户，到账时间以支付渠道为准。'
const DIAGNOSIS_PRICE_NOTE = '这一次 1.00 元。诊断免费，付好了才开始改。没做成可免费再试一次，再不成钱自动退回。'
const ST_AI_DOWN_UNPAID = '这次没有生成诊断结论，可以先打印原件。'
const ST_AI_DOWN_PAID = '这次没有生成诊断结论。付过的钱会自动退回原付款账户，到账时间以支付渠道为准。可以先打印原件。'
const ST_AI_DOWN_FREE = '再解析一次也不会变好。下面这些不需要 AI，现在就能做。'

const OPTIMIZED_RESUME = {
  basic: { name: '李佳怡', phone: '13800138000', city: '青岛' },
  intention: { position: '内容运营', city: '青岛' },
  summary: '能主动沟通、整理反馈，并在协作中持续学习。',
  education: [{ school: '青岛大学', major: '新闻学', degree: '本科', period: '2022.09-2026.06' }],
  experience: [{
    company: '学院新媒体中心',
    role: '公众号编辑',
    period: '2024.09-2025.06',
    description: '负责学院公众号选题、撰写和排版，周更 2 篇。',
  }],
  projects: [{ name: '迎新志愿服务', role: '志愿者', description: '协助新生办理报到、指引宿舍位置。' }],
  skills: ['Excel', 'Word', '公众号排版'],
  certificates: [],
}

const OPTIMIZE_OK = {
  taskId: TASK_ID,
  status: 'completed',
  providerName: 'deepseek',
  modules: [
    { title: '求职目标', before: '希望找一份稳定的工作。', after: '内容运营' },
    { title: '项目经历', before: '参与迎新志愿服务。', after: '协助新生办理报到、指引宿舍位置。' },
  ],
  optimizedResume: OPTIMIZED_RESUME,
}

const GENERATE_OK = {
  taskId: 'gen-p2e2-001',
  status: 'completed',
  providerName: 'deepseek',
  resume: OPTIMIZED_RESUME,
  missingHints: ['可以补充具体项目结果'],
}

const EXPORT_OK = {
  fileId: 'file-p2e2-export',
  filename: 'AI简历_李佳怡.pdf',
  sizeBytes: 64_000,
  pageCount: 1,
  signedUrl: '/w2-fixtures/sample-visible.pdf',
  printFileUrl: '/w2-fixtures/sample-visible.pdf',
  expiresAt: '2099-01-01T00:00:00.000Z',
}

async function routeSamplePdf(page: Page): Promise<void> {
  await page.route('**/w2-fixtures/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/pdf', body: VISIBLE_PDF })
  })
}

function registerResumeShell(api: ApiRouter, pricing: Record<string, unknown> | undefined): void {
  registerW6Api(api)
  attachRawMachinePricing(api, pricing)
  api.respond('GET', `/api/v1/resume/records/${TASK_ID}`, { status: 200, json: REPORT_WITH_FOUR_ISSUES })
  api.respond('GET', '/api/v1/resume/export/pricing', {
    status: 200,
    json: { mode: 'free', unitCents: 0, unit: 'item', benefit: null, label: '免费试运营' },
  })
  api.respond('GET', '/api/v1/job-materials/templates', { status: 200, json: { success: true, data: [] } })
  api.respond('POST', '/api/v1/resume/generate/export', { status: 200, json: EXPORT_OK })
  api.respond('GET', `/api/v1/resume/generate/${GENERATE_OK.taskId}`, { status: 200, json: GENERATE_OK })
  api.respond('POST', `/api/v1/resume/records/${TASK_ID}/layout-adjust`, {
    status: 200,
    json: { resume: OPTIMIZED_RESUME, warnings: [] },
  })
}

async function confirmAllFacts(page: Page): Promise<void> {
  const boxes = page.getByRole('checkbox')
  const count = await boxes.count()
  for (let i = 0; i < count; i += 1) {
    await boxes.nth(i).check()
  }
  await page.getByRole('button', { name: '确认导出', exact: true }).click()
}

async function seedStorage(
  page: Page,
  options: { resume?: boolean; tripOrderId?: string; kioskSessionId?: string },
): Promise<void> {
  await page.goto('/')
  await page.evaluate(
    ({ tripKey, resumeKey, taskId, accessToken, opts, sessionId }) => {
      if (opts.resume) {
        window.sessionStorage.setItem(resumeKey, JSON.stringify({ taskId, accessToken }))
      }
      if (opts.tripOrderId) {
        window.sessionStorage.setItem(tripKey, JSON.stringify({
          v: 1,
          trips: {
            resume_optimize: {
              serviceKey: 'resume_optimize',
              orderId: opts.tripOrderId,
              kioskSessionId: opts.kioskSessionId ?? sessionId,
              owner: { kind: 'guest' },
              savedAt: Date.now(),
            },
          },
        }))
      }
    },
    { tripKey: TRIP_KEY, resumeKey: RESUME_SESSION_KEY, taskId: TASK_ID, accessToken: ACCESS_TOKEN, opts: options, sessionId: SESSION_ID },
  )
}

async function spaNavigate(page: Page, pathname: string, state?: unknown): Promise<void> {
  await page.evaluate(({ path, navState }) => {
    window.history.pushState(navState === undefined ? null : { usr: navState, key: 'p2e2-nav', idx: 1 }, '', path)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, { path: pathname, navState: state })
}

async function expectNoChargingForbiddenCopy(page: Page): Promise<void> {
  const text = await page.locator('body').innerText()
  expect(text).not.toContain('¥')
  expect(text).not.toContain('微信或支付宝')
  expect(text).not.toContain('免费试运营')
  expect(text).not.toContain('今天还剩')
  expect(text).not.toContain('如需退款')
}

function recordHeaders(page: Page, pathMatch: string, method?: string): Array<Record<string, string>> {
  const captured: Array<Record<string, string>> = []
  page.on('request', (req: Request) => {
    const url = new URL(req.url())
    if (url.pathname !== pathMatch) return
    if (method && req.method() !== method) return
    captured.push(req.headers())
  })
  return captured
}

test.describe('简历按次付款接线（P2e-2） @kiosk', () => {
  test('诊断页收费：出「付 1.00 元并开始」、价格说明与「导出不另收钱」 @kiosk', async ({ page, api }) => {
    registerResumeShell(api, resumeOnlyMachinePricing(100))
    await seedStorage(page, { resume: true })
    await spaNavigate(page, '/resume/report')

    await expect(page.getByTestId('resume-report-primary')).toHaveText('付 1.00 元并开始')
    await expect(page.getByTestId('resume-report-charge-note')).toHaveText(DIAGNOSIS_PRICE_NOTE)
    await expect(page.getByTestId('resume-report-export-actions')).toContainText('导出不另收钱')
    await expectNoChargingForbiddenCopy(page)
  })

  test('诊断页免费（全 0）、公共点位与读不到价均不出付款按钮与价格说明 @kiosk', async ({ page, api }) => {
    for (const pricing of [freeMachinePricing(), publicSiteMachinePricing(100), undefined]) {
      registerResumeShell(api, pricing)
      await seedStorage(page, { resume: true })
      await spaNavigate(page, '/resume/report')

      await expect(page.getByTestId('resume-report-primary')).toHaveText('查看优化建议（4 条）')
      await expect(page.getByTestId('resume-report-charge-note')).toHaveCount(0)
      await expect(page.getByTestId('resume-report-export-actions')).toContainText('免费试运营')
    }
  })

  test('诊断页已付过（paid 与可免费再试）直接进优化，不出付款按钮 @kiosk', async ({ page, api }) => {
    const order: FixtureOrder = { ...ORDER_A, createdAt: Date.now() }
    for (const view of [paidServiceOrderView(order), retryFreeServiceOrderView(order)]) {
      registerResumeShell(api, resumeOnlyMachinePricing(100))
      api.respond('GET', serviceOrderPath(order.id), ok(view))
      api.respond('GET', `/api/v1/resume/records/${TASK_ID}/optimize`, { status: 200, json: OPTIMIZE_OK })

      await seedStorage(page, { resume: true, tripOrderId: order.id })
      await spaNavigate(page, '/resume/report')

      await expect(page.getByTestId('resume-report-primary')).toHaveText('查看优化建议（4 条）')
      await expect(page.getByTestId('resume-report-charge-note')).toHaveCount(0)
      await page.getByTestId('resume-report-primary').click()
      await page.waitForURL('**/resume/optimize')
      await expect(page.locator('[data-kiosk-screen="resume-optimize"]')).toBeVisible()
    }
  })

  test('完整链路：诊断页付款 → 付款屏付成 → 优化与排版调整带头 → 导出写「导出不另收钱」 @kiosk', async ({ page, api }) => {
    await routeSamplePdf(page)
    registerResumeShell(api, resumeOnlyMachinePricing(100))
    const order: FixtureOrder = { ...ORDER_A, createdAt: Date.now() }
    api.respondWith('POST', SERVICE_ORDERS_PATH, () => ok(serviceOrderView(order)))
    api.respondWith('GET', serviceOrderPath(order.id), (n) =>
      ok(n >= 1 ? paidServiceOrderView(order) : serviceOrderView(order)))
    api.respond('POST', serviceOrderClosePath(order.id), ok(serviceOrderView(order, { status: 'closed', closeReason: 'user_cancelled' })))
    api.respond('GET', `/api/v1/resume/records/${TASK_ID}/optimize`, { status: 200, json: OPTIMIZE_OK })

    const orderCalls = recordServiceOrderCalls(page)
    const optimizeHeaders = recordHeaders(page, `/api/v1/resume/records/${TASK_ID}/optimize`, 'GET')
    const adjustHeaders = recordHeaders(page, `/api/v1/resume/records/${TASK_ID}/layout-adjust`, 'POST')

    await seedStorage(page, { resume: true })
    await spaNavigate(page, '/resume/report')
    await expect(page.getByTestId('resume-report-primary')).toHaveText('付 1.00 元并开始')
    await page.getByTestId('resume-report-primary').click()

    await page.waitForURL('**/pay/resume?next=optimize&back=report')
    await expect(page.locator('[data-qx-page="pay-service"]')).toHaveAttribute('data-qxt-state', 'wait')

    // 点一次刷新让查单拿到已付，再直接点「马上开始」进优化页。
    await page.getByTestId('pay-service-primary').click()
    await expect(page.locator('[data-qx-page="pay-service"]')).toHaveAttribute('data-qxt-state', 'ok')
    await page.getByTestId('pay-service-primary').click()

    await page.waitForURL('**/resume/optimize')
    await expect(page.locator('[data-kiosk-screen="resume-optimize"][data-optimize-state="ready"]')).toBeVisible()

    const created = orderCalls.find((call) => call.method === 'POST' && call.path === SERVICE_ORDERS_PATH)
    const expectedSessionId = String(created?.body?.kioskSessionId ?? '')
    expect(expectedSessionId).toMatch(/^[0-9a-f-]{36}$/)
    expect(optimizeHeaders.length).toBeGreaterThanOrEqual(1)
    expect(optimizeHeaders[0]?.['x-service-order-id']).toBe(order.id)
    expect(optimizeHeaders[0]?.['x-kiosk-session-id']).toBe(expectedSessionId)

    // 进编辑页点「AI 精简」，确认排版调整请求也带同一组头。
    await page.getByTestId('resume-optimize-open-editor').click()
    await page.getByRole('button', { name: 'AI 精简', exact: true }).click()
    await expect.poll(() => adjustHeaders.length).toBeGreaterThanOrEqual(1)
    expect(adjustHeaders[0]?.['x-service-order-id']).toBe(order.id)
    expect(adjustHeaders[0]?.['x-kiosk-session-id']).toBe(expectedSessionId)

    // 进导出页：收费机器写「导出不另收钱」，导出后卡片也写「导出不另收钱」。
    await page.getByTestId('resume-optimize-to-export').click()
    await confirmAllFacts(page)
    await expect(page.locator('[data-qx-page="resume-export"]')).toContainText('导出不另收钱')
    await expectNoChargingForbiddenCopy(page)

    await page.getByTestId('resume-optimize-export').click()
    // 关闭导出后自动弹出的预览窗，核对导出结果卡上的价格句。
    await page.getByRole('button', { name: '关闭文件预览' }).click()
    await expect(page.locator('.qxt-out')).toContainText('导出不另收钱')
    await expectNoChargingForbiddenCopy(page)
  })

  test('优化首次失败 → 免费再试一次 → 仍带同一订单号出稿（不新建单） @kiosk', async ({ page, api }) => {
    registerResumeShell(api, resumeOnlyMachinePricing(100))
    const order: FixtureOrder = { ...ORDER_A, createdAt: Date.now() }
    api.respond('GET', serviceOrderPath(order.id), ok(retryFreeServiceOrderView(order)))
    api.respondWith('GET', `/api/v1/resume/records/${TASK_ID}/optimize`, (n) => (
      n === 1
        ? { status: 200, json: { taskId: TASK_ID, status: 'failed', failReason: '模型响应失败，请稍后重试' } }
        : { status: 200, json: OPTIMIZE_OK }
    ))

    const orderCalls = recordServiceOrderCalls(page)
    const optimizeHeaders = recordHeaders(page, `/api/v1/resume/records/${TASK_ID}/optimize`, 'GET')

    await seedStorage(page, { resume: true, tripOrderId: order.id })
    await spaNavigate(page, '/resume/optimize')

    await expect(page.getByRole('button', { name: '免费再试一次', exact: true })).toBeVisible()
    await expect(page.locator('[data-kiosk-screen="resume-optimize"]')).toContainText(RETRY_COPY)
    await expectNoChargingForbiddenCopy(page)

    await page.getByRole('button', { name: '免费再试一次', exact: true }).click()
    await expect(page.locator('[data-kiosk-screen="resume-optimize"][data-optimize-state="ready"]')).toBeVisible()

    expect(orderCalls.filter((call) => call.method === 'POST' && call.path === SERVICE_ORDERS_PATH)).toHaveLength(0)
    expect(optimizeHeaders).toHaveLength(2)
    expect(optimizeHeaders[0]?.['x-service-order-id']).toBe(order.id)
    expect(optimizeHeaders[1]?.['x-service-order-id']).toBe(order.id)
    expect(optimizeHeaders[0]?.['x-kiosk-session-id']).toBe(SESSION_ID)
    expect(optimizeHeaders[1]?.['x-kiosk-session-id']).toBe(SESSION_ID)
  })

  test('优化遇到 402 SERVICE_PAYMENT_REQUIRED 回付款屏，不落入「优化结果读取失败」 @kiosk', async ({ page, api }) => {
    registerResumeShell(api, resumeOnlyMachinePricing(100))
    const order: FixtureOrder = { ...ORDER_A, createdAt: Date.now() }
    api.respond('GET', `/api/v1/resume/records/${TASK_ID}/optimize`, apiError(402, 'SERVICE_PAYMENT_REQUIRED', '这一次要先付款'))
    api.respondWith('POST', SERVICE_ORDERS_PATH, () => ok(serviceOrderView(order)))
    api.respond('GET', serviceOrderPath(order.id), ok(serviceOrderView(order)))

    await seedStorage(page, { resume: true })
    await spaNavigate(page, '/resume/optimize')

    await page.waitForURL('**/pay/resume?next=optimize&back=report')
    await expect(page.locator('[data-qx-page="pay-service"]')).toHaveAttribute('data-qxt-state', 'wait')
    await expect(page.locator('body')).not.toContainText('优化结果读取失败')
  })

  test('对照页 compare：带头、首次失败出「免费再试一次」与 RETRY 句，同单重发且不画「这一趟已包含」 @kiosk', async ({ page, api }) => {
    registerResumeShell(api, resumeOnlyMachinePricing(100))
    const order: FixtureOrder = { ...ORDER_A, createdAt: Date.now() }
    api.respond('GET', serviceOrderPath(order.id), ok(retryFreeServiceOrderView(order)))
    api.respondWith('GET', `/api/v1/resume/records/${TASK_ID}/optimize`, (n) => (
      n === 1
        ? { status: 200, json: { taskId: TASK_ID, status: 'failed', failReason: '模型暂时没返回候选' } }
        : { status: 200, json: OPTIMIZE_OK }
    ))

    const orderCalls = recordServiceOrderCalls(page)
    const optimizeHeaders = recordHeaders(page, `/api/v1/resume/records/${TASK_ID}/optimize`, 'GET')

    await seedStorage(page, { resume: true, tripOrderId: order.id })
    await spaNavigate(page, '/resume/optimize/compare')

    await expect(page.getByRole('button', { name: '免费再试一次', exact: true })).toBeVisible()
    await expect(page.locator('[data-qx-page="compare"]')).toContainText(RETRY_COPY)
    await expect(page.locator('body')).not.toContainText('这一趟已包含')
    await expect(page.locator('body')).not.toContainText('这一条已经换过')
    await expectNoChargingForbiddenCopy(page)

    await page.getByRole('button', { name: '免费再试一次', exact: true }).click()
    await expect(page.getByRole('heading', { name: /第 1 \/ 2 条/ })).toBeVisible()
    await expect(page.locator('body')).not.toContainText('这一趟已包含')

    expect(orderCalls.filter((call) => call.method === 'POST' && call.path === SERVICE_ORDERS_PATH)).toHaveLength(0)
    expect(optimizeHeaders).toHaveLength(2)
    expect(optimizeHeaders[0]?.['x-service-order-id']).toBe(order.id)
    expect(optimizeHeaders[1]?.['x-service-order-id']).toBe(order.id)
  })

  test('st-ai-down：收费机器未付 / 已付两句各自准确，不收费机器保持原样 @kiosk', async ({ page, api }) => {
    await routeSamplePdf(page)
    const order: FixtureOrder = { ...ORDER_A, createdAt: Date.now() }
    const failState = {
      success: false,
      aiDown: true,
      reason: 'AI 服务暂停中',
      failureCode: 'AI_PAUSED',
      fileId: 'file-orig-01',
      file: { name: '李佳怡-简历.pdf', size: '120 KB', format: 'pdf', fileUrl: '/w2-fixtures/sample-visible.pdf' },
    }

    // 1) 收费机器 + 没付过
    registerResumeShell(api, resumeOnlyMachinePricing(100))
    await seedStorage(page, {})
    await spaNavigate(page, '/resume/report', failState)
    await expect(page.locator('.qxt-ask-t > p')).toHaveText(ST_AI_DOWN_UNPAID)
    await expect(page.locator('body')).not.toContainText('自动退回原付款账户')

    // 2) 收费机器 + 这一趟已付（paid）与退款中（refunding）都给出退款句
    for (const view of [paidServiceOrderView(order), refundingServiceOrderView(order)]) {
      registerResumeShell(api, resumeOnlyMachinePricing(100))
      api.respond('GET', serviceOrderPath(order.id), ok(view))
      await seedStorage(page, { tripOrderId: order.id })
      await spaNavigate(page, '/resume/report', failState)
      await expect(page.locator('.qxt-ask-t > p')).toHaveText(ST_AI_DOWN_PAID)
    }

    // 3) 不收费机器（全 0）保持原样
    registerResumeShell(api, freeMachinePricing())
    await seedStorage(page, {})
    await spaNavigate(page, '/resume/report', failState)
    await expect(page.locator('.qxt-ask-t > p')).toHaveText(ST_AI_DOWN_FREE)
  })

  test('导出与从零生成：收费机器写「导出不另收钱」且不加付款入口，免费机器仍写「免费试运营」 @kiosk', async ({ page, api }) => {
    await routeSamplePdf(page)
    // 收费机器：gen-preview 预览屏 + 选格式屏都写「导出不另收钱」，不加付款按钮。
    registerResumeShell(api, resumeOnlyMachinePricing(100))
    await seedStorage(page, {})
    await spaNavigate(page, `/resume/generate/preview?taskId=${GENERATE_OK.taskId}`)

    await expect(page.getByTestId('resume-generate-export-no-extra')).toHaveText('导出不另收钱')
    await expect(page.locator('body')).not.toContainText('付 1.00 元')
    await expectNoChargingForbiddenCopy(page)

    await page.getByTestId('resume-generate-preview-cta-export').click()
    await expect(page.locator('[data-kiosk-screen="resume-generate-preview"][data-deliver-phase="export"]')).toBeVisible()
    await expect(page.locator('[data-kiosk-screen="resume-generate-preview"] .qx-rd-price')).toHaveText('导出不另收钱')
    await expectNoChargingForbiddenCopy(page)

    // 免费机器：选格式屏仍写「免费试运营」，不出「导出不另收钱」；优化导出也写「免费试运营，本单 0 元」。
    registerResumeShell(api, freeMachinePricing())
    api.respond('GET', `/api/v1/resume/records/${TASK_ID}/optimize`, { status: 200, json: OPTIMIZE_OK })
    await seedStorage(page, { resume: true })
    await spaNavigate(page, `/resume/generate/preview?taskId=${GENERATE_OK.taskId}`)
    await expect(page.getByTestId('resume-generate-export-no-extra')).toHaveCount(0)
    await page.getByTestId('resume-generate-preview-cta-export').click()
    await expect(page.locator('[data-kiosk-screen="resume-generate-preview"][data-deliver-phase="export"]')).toBeVisible()
    await expect(page.locator('[data-kiosk-screen="resume-generate-preview"] .qx-rd-price')).toContainText('免费试运营')
    await expect(page.locator('body')).not.toContainText('导出不另收钱')

    await spaNavigate(page, '/resume/optimize')
    await page.getByTestId('resume-optimize-open-editor').click()
    await page.getByTestId('resume-optimize-to-export').click()
    await confirmAllFacts(page)
    await expect(page.locator('[data-qx-page="resume-export"]')).toContainText('免费试运营')
    await page.getByTestId('resume-optimize-export').click()
    await page.getByRole('button', { name: '关闭文件预览' }).click()
    await expect(page.locator('.qxt-out')).toContainText('免费试运营，本单 0 元')
  })

  test('诊断页免费再试窗口到点实时过期：无需刷新即恢复「付 1.00 元并开始」与价格说明 @kiosk', async ({ page, api }) => {
    const start = Date.now()
    await page.clock.install({ time: start })
    registerResumeShell(api, resumeOnlyMachinePricing(100))
    const order: FixtureOrder = { ...ORDER_A, createdAt: start - 20_000 }
    api.respond(
      'GET',
      serviceOrderPath(order.id),
      ok(serviceOrderView(order, {
        status: 'paid',
        paidAt: new Date(start - 15_000).toISOString(),
        attemptsUsed: 1,
        failureReason: 'optimize_failed',
        retryUntil: new Date(start + 10_000).toISOString(),
      })),
    )

    await seedStorage(page, { resume: true, tripOrderId: order.id })
    await spaNavigate(page, '/resume/report')

    await expect(page.getByTestId('resume-report-primary')).toHaveText('查看优化建议（4 条）')
    await expect(page.getByTestId('resume-report-charge-note')).toHaveCount(0)

    // 9 秒时仍在免费再试窗口内
    await page.clock.runFor(9_000)
    await expect(page.getByTestId('resume-report-primary')).toHaveText('查看优化建议（4 条）')
    await expect(page.getByTestId('resume-report-charge-note')).toHaveCount(0)

    // 跨过 retryUntil：无需刷新或重新查单，精准定时器立即恢复付款入口与价格说明
    await page.clock.runFor(1_500)
    await expect(page.getByTestId('resume-report-primary')).toHaveText('付 1.00 元并开始')
    await expect(page.getByTestId('resume-report-charge-note')).toHaveText(DIAGNOSIS_PRICE_NOTE)
    await expectNoChargingForbiddenCopy(page)
  })

  test('旧用户查单在途切新会员：晚到已付响应不得污染新用户诊断页状态 @kiosk', async ({ page, api }) => {
    registerResumeShell(api, resumeOnlyMachinePricing(100))
    const order: FixtureOrder = { ...ORDER_A, createdAt: Date.now() }
    let releaseStaleOrder!: () => void
    let staleOrderStarted!: () => void
    const staleStarted = new Promise<void>((resolve) => { staleOrderStarted = resolve })
    const staleGate = new Promise<void>((resolve) => { releaseStaleOrder = resolve })

    await page.route(`**${serviceOrderPath(order.id)}*`, async (route) => {
      staleOrderStarted()
      await staleGate
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(ok(paidServiceOrderView(order)).json),
      })
    })

    // 1) 游客进诊断页发起旧单查单，请求挂在在途
    await seedStorage(page, { resume: true, tripOrderId: order.id })
    await spaNavigate(page, '/resume/report')
    await staleStarted

    // 2) 另一位用户走可见登录界面切为会员（触发 login_handover 清掉游客单号）
    await spaNavigate(page, '/login?from=%2Fresume%2Freport')
    await page.getByRole('checkbox', { name: /我已阅读并同意/ }).click()
    await page.getByRole('button', { name: '手机号（11 位本人号码）', exact: true }).click()
    for (const digit of '13800138000') await page.getByRole('button', { name: digit, exact: true }).click()
    await page.getByRole('button', { name: '收起键盘', exact: true }).click()
    await page.getByRole('button', { name: '获取验证码', exact: true }).click()
    await page.getByRole('button', { name: '短信验证码', exact: true }).click()
    for (const digit of '123456') await page.getByRole('button', { name: digit, exact: true }).click()
    await page.getByRole('button', { name: '收起键盘', exact: true }).click()
    await page.getByRole('button', { name: '确认登录', exact: true }).click()

    // 3) 此时放回旧游客的晚到已付响应
    releaseStaleOrder()

    await page.waitForURL((url) => url.pathname === '/resume/report', { timeout: 15_000 })
    await expect(page.getByTestId('resume-report-primary')).toHaveText('付 1.00 元并开始')
    await expect(page.getByTestId('resume-report-charge-note')).toHaveText(DIAGNOSIS_PRICE_NOTE)
    const storedRaw = await page.evaluate((key) => window.sessionStorage.getItem(key), TRIP_KEY)
    expect(storedRaw ?? '').not.toContain(order.id)
  })

  test('HTTP 返回 providerName=mock 演示报告在收费机器上不出付款入口与收费说明 @kiosk', async ({ page, api }) => {
    registerResumeShell(api, resumeOnlyMachinePricing(100))
    api.respond('GET', `/api/v1/resume/records/${TASK_ID}`, {
      status: 200,
      json: { ...REPORT_WITH_FOUR_ISSUES, providerName: 'mock' },
    })

    await seedStorage(page, { resume: true })
    await spaNavigate(page, '/resume/report')

    await expect(page.locator('.rrp-ai-label')).toContainText('演示')
    await expect(page.getByTestId('resume-report-primary')).toHaveText('查看优化建议（4 条）')
    await expect(page.getByTestId('resume-report-charge-note')).toHaveCount(0)
    await expect(page.locator('body')).not.toContainText('付 1.00 元')
  })
})
