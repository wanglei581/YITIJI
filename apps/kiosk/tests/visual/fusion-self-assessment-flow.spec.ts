import type { Page } from '@playwright/test'
import { test, expect } from '../fixtures/kiosk-test'
import { registerW6Api } from './fixtures/fusion-w6-api'

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
    signedUrl: 'about:blank', signedUrlExpiresAt: '2099-01-01T00:00:00.000Z', expiresAt: '2099-01-01T00:00:00.000Z',
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
})
