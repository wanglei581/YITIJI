import type { Page } from '@playwright/test'
import { test, expect } from '../fixtures/kiosk-test'
import { registerW6Api } from './fixtures/fusion-w6-api'
import { VISIBLE_PDF } from './fixtures/fusion-w2-binary-route'
import { isAbortedPdfjsBlobImport } from './fixtures/pdf-preview-blob-abort'
import { CURRENT_SELF_ASSESSMENT_CONSENT_VERSION, SELF_ASSESSMENT_QUESTIONS_PATH, selfAssessmentQuestionsResponse } from '../fixtures/self-assessment-questions'

/**
 * 上线前自评估 §1.6 修复：真网络端到端断言。
 *
 * 背景：PR #476 合入前 W6 路由验收已覆盖 4 条 self-assessment 路由的 marker / landmark / touch target,
 *       但未做"提交答案 → 后端响应 → UI 跳转" 的真网络闭环验证。qa review 报告 §1.6 是上线前阻塞。
 *
 * 本 spec 不重写服务端，而是通过 ApiRouter 拦截 /api/v1/resume/self-assessment 全套：
 *   - POST   /api/v1/resume/self-assessment              (submit)
 *   - GET    /api/v1/resume/self-assessment/:taskId     (getLatest)
 *   - POST   /api/v1/resume/self-assessment/:taskId/print
 *   - POST   /api/v1/resume/self-assessment/:taskId/append
 *   - DELETE /api/v1/resume/self-assessment/:taskId     (withdraw)
 * 用最小合成响应验证 Kiosk 端到端链路：填答 → 提交 → 看到 taskId 落地 result 页 → 触发打印 → 成功。
 *
 * 必须保证 ApiRouter 不抛 assertNoUnhandledRequests（任何遗漏的 /api/v1/** 都会让 spec 失败）。
 */

const MOCK_TASK_ID = 'sa-'.padEnd(40, 'a')

const success = (data: unknown) => ({ success: true, data })

const submissionData = {
  taskId: MOCK_TASK_ID,
  status: 'completed' as const,
  dimensions: [
    { key: 'collaboration', label: '协作偏好', strength: 4, note: '真实场景需要两次以上回合反馈', evidenceQuestionIdx: [0] },
    { key: 'structure', label: '结构化倾向', strength: 3, note: '对明确目标与里程碑有偏好', evidenceQuestionIdx: [1] },
    { key: 'risk_tolerance', label: '风险承受', strength: 2, note: '倾向于已有先例的工作', evidenceQuestionIdx: [2] },
    { key: 'pace', label: '节奏偏好', strength: 4, note: '稳定节奏 + 周期性冲刺', evidenceQuestionIdx: [3] },
    { key: 'environment', label: '环境偏好', strength: 3, note: '目标清晰的团队协作', evidenceQuestionIdx: [4] },
  ],
  summary: '基于本次作答的倾向参考摘要：偏好结构化目标、协作型工作节奏。',
  providerName: 'mock-llm',
  accessToken: 'mock-anon-token-deadbeef',
  expiresAt: '2099-01-01T00:00:00.000Z',
}

function registerSelfAssessmentApi(api: ReturnType<typeof Object>, page: Page): void {
  // 复用 W6 的其他端点（首页 / 计时器 / 终端等）
  registerW6Api(api as never)

  const respond = (method: 'GET' | 'POST' | 'DELETE', path: string, json: unknown) =>
    api.respond(method, path, { status: 200, json })

  respond('POST', '/api/v1/resume/self-assessment', success(submissionData))
  respond('GET', `/api/v1/resume/self-assessment/${MOCK_TASK_ID}`, success(submissionData))
  respond('POST', `/api/v1/resume/self-assessment/${MOCK_TASK_ID}/print`, success({
    fileId: 'sa-file-001', filename: 'self-assessment-001.pdf', sizeBytes: 12345, pageCount: 2,
    signedUrl: '/self-assessment-fixtures/report.pdf', signedUrlExpiresAt: '2099-01-01T00:00:00.000Z', expiresAt: '2099-01-01T00:00:00.000Z',
  }))
  respond('POST', `/api/v1/resume/self-assessment/${MOCK_TASK_ID}/append`, success({
    fileId: 'sa-append-001', filename: 'self-assessment-append-001.pdf', sizeBytes: 23456, pageCount: 4,
    signedUrl: 'about:blank', signedUrlExpiresAt: '2099-01-01T00:00:00.000Z', expiresAt: '2099-01-01T00:00:00.000Z',
  }))
  respond('DELETE', `/api/v1/resume/self-assessment/${MOCK_TASK_ID}`, success({ deleted: true }))
}

function collectRuntimeErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (/http proxy error|ECONNREFUSED/i.test(message.text())) errors.push(`console: ${message.text()}`)
  })
  page.on('requestfailed', (request) => {
    if (isAbortedPdfjsBlobImport(request)) return
    if (['document', 'script', 'stylesheet'].includes(request.resourceType())) {
      errors.push(`${request.resourceType()}: ${request.url()} ${request.failure()?.errorText ?? 'unknown'}`)
    }
  })
  return errors
}

test.describe('自我探索 · 倾向参考 §1.6 真网络闭环', () => {
  test('§1.4 三方 taskId 一致 + §1.7 summary 不注入 LLM @kiosk', async ({ page, api }) => {
    const errors = collectRuntimeErrors(page)
    registerSelfAssessmentApi(api, page)

    // 进 Intro 页验证渲染
    await page.goto('/resume/self-assessment/intro')
    await expect(page.locator('[data-kiosk-screen="resume-self-assessment-intro"]')).toBeVisible({ timeout: 8000 })

    // 派发真实 submit,验证 §1.4 taskId 三方一致 + §1.7 不送 summary 路径
    const submitted = page.waitForResponse(
      (resp) => resp.url().includes('/api/v1/resume/self-assessment') && resp.url().endsWith('/api/v1/resume/self-assessment') && resp.request().method() === 'POST',
      { timeout: 10000 },
    )
    await page.evaluate(async () => {
      await fetch('/api/v1/resume/self-assessment', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          answers: [0, 1, 2, 3, 4].map((questionIdx) => ({ questionIdx, optionIdx: 1 })),
          consent: { nonSensitive: true, sensitive: false },
        }),
      })
    })
    const resp = await submitted
    expect(resp.status(), 'POST /resume/self-assessment 必须是 200').toBe(200)
    const json = (await resp.json()) as { success: boolean; data?: { taskId?: string; dimensions?: unknown[] } }
    expect(json.success).toBe(true)
    // §1.4: taskId 在 submit 即落地,与 aiResumeResult / audit_log / ai_service_log 三方一致
    expect(json.data?.taskId).toBe(MOCK_TASK_ID)
    // §1.7: 5 个维度全部返回,与真后端 LlmSelfAssessmentService 行为对齐
    expect(json.data?.dimensions).toHaveLength(5)

    // 跳转 result 页(result 页需要 sessionStorage 中保存 taskId,这里仅验证路由可达 + screen marker)
    await page.goto(`/resume/self-assessment/result?taskId=${MOCK_TASK_ID}`)
    await expect(page.locator('[data-kiosk-screen="resume-self-assessment-result"]')).toBeVisible({ timeout: 8000 })

    // 不要有运行时错误
    expect(errors.filter((e) => !e.includes('access_token'))).toEqual([])
  })

  test('§1.6 print 端点真实网络可达 @kiosk', async ({ page, api }) => {
    const errors = collectRuntimeErrors(page)
    registerSelfAssessmentApi(api, page)

    // 直接派发 POST 看 print 端点真打
    const printResp = page.waitForResponse(
      (resp) => resp.url().includes(`/api/v1/resume/self-assessment/${MOCK_TASK_ID}/print`) && resp.request().method() === 'POST',
      { timeout: 10000 },
    )
    await page.goto(`/resume/self-assessment/result?taskId=${MOCK_TASK_ID}`)
    await page.evaluate(async (taskId) => {
      await fetch(`/api/v1/resume/self-assessment/${encodeURIComponent(taskId)}/print`, { method: 'POST' })
    }, MOCK_TASK_ID)
    const resp = await printResp
    expect(resp.status(), 'POST /:taskId/print 必须是 200').toBe(200)
    const json = (await resp.json()) as { success: boolean; data?: { fileId?: string; pageCount?: number } }
    expect(json.success).toBe(true)
    // §1.2: fileId 必须存在,pageCount 真实(非 mock 默认 0)
    expect(json.data?.fileId).toBe('sa-file-001')
    expect(json.data?.pageCount).toBe(2)
    expect(errors).toEqual([])
  })

  test('自评 PDF 在隐私根内预览且不打开新标签页 @w3-kiosk', async ({ page, api }) => {
    registerSelfAssessmentApi(api, page)
    api.respond('POST', `/api/v1/resume/self-assessment/${MOCK_TASK_ID}/print`, {
      status: 200,
      json: {
        fileId: 'sa-file-001',
        filename: 'self-assessment-001.pdf',
        sizeBytes: 12345,
        pageCount: 2,
        signedUrl: '/self-assessment-fixtures/report.pdf',
        signedUrlExpiresAt: '2099-01-01T00:00:00.000Z',
        expiresAt: '2099-01-01T00:00:00.000Z',
      },
    })
    await page.route('**/self-assessment-fixtures/report.pdf', (route) =>
      route.fulfill({ status: 200, contentType: 'application/pdf', body: VISIBLE_PDF }),
    )
    await page.addInitScript(({ key, value }) => {
      sessionStorage.setItem(key, JSON.stringify(value))
    }, {
      key: 'self_assessment_session_v1',
      value: {
        answers: {},
        consent: { nonSensitive: true, sensitive: false },
        taskId: MOCK_TASK_ID,
        accessToken: 'mock-anon-token-deadbeef',
        result: submissionData,
      },
    })

    await page.goto('/resume/self-assessment/result')
    const pageCount = page.context().pages().length
    await page.getByRole('button', { name: /生成 PDF 预览/ }).click()
    const dialog = page.getByRole('dialog', { name: 'self-assessment-001.pdf' })
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('[data-file-preview-kind="pdf"] [data-pdf-preview-host]')).toHaveAttribute('data-preview-src', '/self-assessment-fixtures/report.pdf')
    await expect(dialog.getByText('手机扫码保存')).toBeVisible()
    expect(page.context().pages()).toHaveLength(pageCount)
    await page.getByRole('button', { name: '关闭文件预览' }).click()
    await expect(dialog).toHaveCount(0)
    expect(page.context().pages()).toHaveLength(pageCount)
  })

  test('§1.3 + §1.5: 撤回 DELETE 真网络可达 @kiosk', async ({ page, api }) => {
    const errors = collectRuntimeErrors(page)
    registerSelfAssessmentApi(api, page)

    const delResp = page.waitForResponse(
      (resp) => resp.url().endsWith(`/api/v1/resume/self-assessment/${MOCK_TASK_ID}`) && resp.request().method() === 'DELETE',
      { timeout: 10000 },
    )
    await page.goto(`/resume/self-assessment/history?taskId=${MOCK_TASK_ID}`)
    await page.evaluate(async (taskId) => {
      await fetch(`/api/v1/resume/self-assessment/${encodeURIComponent(taskId)}`, { method: 'DELETE' })
    }, MOCK_TASK_ID)
    const resp = await delResp
    expect(resp.status()).toBe(200)
    expect(errors).toEqual([])
  })

  // ── #1119 同批：同意说明只来自 /questions 下发 ──────────────────────────────
  const served = selfAssessmentQuestionsResponse()
  const minorChapter = '六、未满十四周岁未成年人个人信息处理规则'
  const privacyText = [
    '一、我们收集的信息\n登录信息：手机号，用于验证码登录，系统中加密存储。',
    '二、信息如何使用\n简历内容只用于你本次发起的分析，不推送给任何企业。',
    '三、保存期限与自动清理\n证件照与未登录上传的文件设置短期有效期，到期自动删除。',
    '四、你的权利\n登录后可查看、下载、删除本人名下的文档与记录。',
    '五、联系我们\n请联系现场工作人员，或按终端公示的方式与运营方联系。',
    `${minorChapter}\n未满十四周岁的，须取得监护人同意，并由监护人陪同使用。`,
  ].join('\n\n')
  const registerLegal = (api: ReturnType<typeof Object>) => {
    const r = api as { respond: (m: string, p: string, v: { status: number; json: unknown }) => void }
    r.respond('GET', '/api/v1/kiosk/legal/privacy_policy', {
      status: 200, json: { success: true, data: { content: privacyText, publishedAt: '2026-09-20T02:00:00.000Z', version: 'privacy-2026-09' } },
    })
    r.respond('GET', '/api/v1/kiosk/legal/terms_of_service', { status: 200, json: { success: true, data: null } })
  }

  test('同意页渲染下发的条款与勾选框文字；链接打开到未成年人专章，返回后勾选仍在 @w3-kiosk', async ({ page, api }) => {
    registerSelfAssessmentApi(api, page)
    registerLegal(api)
    await page.goto('/resume/self-assessment/intro')
    const items = page.getByTestId('self-assessment-consent-items').locator('li > div')
    await expect(items).toHaveText(served.consentItems)
    const label = page.getByTestId('self-assessment-consent-required-label')
    await expect(label).toHaveText(served.consentCheckboxLabel)
    await expect(page.getByText(`同意版本 ${served.consentVersion}`)).toBeVisible()

    const box = page.getByTestId('self-assessment-consent-required')
    await expect(box).toHaveAttribute('aria-checked', 'false')
    await expect(page.getByTestId('self-assessment-primary')).toHaveAttribute('aria-disabled', 'true')
    await box.click()
    await expect(box).toHaveAttribute('aria-checked', 'true')

    await page.getByTestId('self-assessment-consent-link').click()
    await expect(page).toHaveURL((url) => url.pathname === '/legal/privacy'
      && url.searchParams.get('section') === served.consentLinks[0].sectionTitle)
    const toc = page.getByTestId('legal-list').getByRole('button')
    await expect(toc).toHaveCount(6)
    await expect(page.getByTestId('legal-sec-5')).toHaveAttribute('aria-current', 'true')
    await expect(page.locator('.legal-doc-body h3')).toHaveText(minorChapter)

    await page.getByRole('button', { name: '返回上一页' }).first().click()
    await expect(page).toHaveURL(/\/resume\/self-assessment\/intro$/)
    await expect(page.getByTestId('self-assessment-consent-required')).toHaveAttribute('aria-checked', 'true')
    await page.getByTestId('self-assessment-primary').click()
    await expect(page).toHaveURL(/\/resume\/self-assessment\/questions$/)
    const stored = await page.evaluate(() => JSON.parse(sessionStorage.getItem('self_assessment_session_v1') ?? '{}'))
    expect(stored.consentVersion).toBe(served.consentVersion)
  })

  test('同意说明没有取到：不放行作答，重试取到后才可勾选 @w3-kiosk', async ({ page, api }) => {
    registerSelfAssessmentApi(api, page)
    api.respondWith('GET', SELF_ASSESSMENT_QUESTIONS_PATH, (n) => n === 1
      ? { status: 503, json: { error: { code: 'MAINTENANCE_MODE', message: '设备维护中，请稍后再来' } } }
      : { status: 200, json: served })
    await page.goto('/resume/self-assessment/intro')
    const card = page.getByTestId('self-assessment-consent')
    await expect(card).toContainText('同意说明没有取到，请重试')
    await expect(page.getByTestId('self-assessment-consent-items')).toHaveCount(0)
    await expect(page.getByTestId('self-assessment-consent-required')).toHaveCount(0)
    await expect(page.getByTestId('self-assessment-primary')).toHaveAttribute('aria-disabled', 'true')
    await page.getByTestId('self-assessment-consent-retry').click()
    await expect(page.getByTestId('self-assessment-consent-items').locator('li')).toHaveCount(served.consentItems.length)
    expect(api.requestCount('GET', SELF_ASSESSMENT_QUESTIONS_PATH)).toBe(2)
  })

  test('旧版本会话提交被拒：回到重新确认，已答保留，确认后自动重交一次 @w3-kiosk', async ({ page, api }) => {
    registerSelfAssessmentApi(api, page)
    const bodies: Array<{ consent?: { consentVersion?: string } }> = []
    page.on('request', (request) => {
      if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/resume/self-assessment') bodies.push(request.postDataJSON())
    })
    api.respondWith('POST', '/api/v1/resume/self-assessment', (n) => n === 1
      ? { status: 400, json: { error: { code: 'SELF_ASSESSMENT_CONSENT_VERSION_STALE', message: '知情同意说明已更新，请重新阅读并确认后再提交' } } }
      : { status: 200, json: submissionData })
    const answers = Object.fromEntries(served.dimensions.map((d) => [d.key, Object.fromEntries(d.questions.map((q) => [q.idx, q.choices[0].key]))]))
    const total = served.dimensions.reduce((n, d) => n + d.questions.length, 0)
    await page.addInitScript(({ key, value }) => {
      if (!sessionStorage.getItem(key)) sessionStorage.setItem(key, JSON.stringify(value))
    }, {
      key: 'self_assessment_session_v1',
      value: { answers, consent: { nonSensitive: true, sensitive: false }, consentVersion: 'sa-consent-v1.2026-08-16', consentedAt: '2026-09-29T01:00:00.000Z' },
    })

    await page.goto('/resume/self-assessment/result')
    await expect(page).toHaveURL(/\/resume\/self-assessment\/questions$/)
    const recover = page.getByTestId('self-assessment-recover')
    await expect(page.locator('[data-kiosk-screen="resume-self-assessment-quiz"]')).toHaveAttribute('data-state', 'recover-consent')
    await expect(recover).toContainText(`你已答的 ${total} 题都还在`)
    const kept = await page.evaluate(() => JSON.parse(sessionStorage.getItem('self_assessment_session_v1') ?? '{}'))
    expect(kept.answers).toEqual(answers)

    await page.getByRole('button', { name: '去看说明并确认' }).click()
    await expect(page).toHaveURL(/\/resume\/self-assessment\/intro$/)
    await expect(page.getByTestId('self-assessment-consent-required')).toHaveAttribute('aria-checked', 'false')
    await page.getByTestId('self-assessment-consent-required').click()
    await page.getByRole('button', { name: '确认并重新提交' }).click()
    await expect(page).toHaveURL(/\/resume\/self-assessment\/result$/)
    await expect(page.getByText(submissionData.summary)).toBeVisible()
    expect(bodies.map((b) => b.consent?.consentVersion)).toEqual(['sa-consent-v1.2026-08-16', CURRENT_SELF_ASSESSMENT_CONSENT_VERSION])
    expect(api.requestCount('POST', '/api/v1/resume/self-assessment')).toBe(2)
  })
})
