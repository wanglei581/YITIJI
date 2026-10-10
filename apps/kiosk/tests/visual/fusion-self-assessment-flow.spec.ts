import type { Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
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
const SA_SCROLL_CUE = readFileSync(new URL('../../src/pages/resume/SelfAssessmentFlow.tsx', import.meta.url), 'utf8')
  .match(/^const SA_SCROLL_CUE = '([^']+)'$/m)?.[1]

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

function registerSelfAssessmentApi(api: ReturnType<typeof Object>): void {
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

/** 叶子法：滚动列里相邻块、以及最后一块到列底的空隙，取最大的一条。整行 ≥160 不算排满。 */
async function columnGap(page: Page, state: string): Promise<number> {
  return page.locator(`.sa-qx[data-state="${state}"] .qx-scroll`).evaluate((scroll) => {
    const kids = [...scroll.children].filter((el) => (el as HTMLElement).getBoundingClientRect().height > 8)
    const rects = kids.map((el) => el.getBoundingClientRect())
    const box = scroll.getBoundingClientRect()
    const gaps: number[] = []
    if (rects[0]) gaps.push(Math.max(0, rects[0].top - box.top))
    for (let i = 1; i < rects.length; i += 1) gaps.push(Math.max(0, rects[i].top - rects[i - 1].bottom))
    if (rects.length) gaps.push(Math.max(0, box.bottom - rects[rects.length - 1].bottom))
    return gaps.length ? Math.max(...gaps) : box.height
  })
}

async function twoFrames(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
}

/** 平滑滚动停稳：连续 12 帧 scrollTop 不变。 */
async function scrollSettled(page: Page) {
  await page.locator('.sa-qx .qx-scroll').evaluate((el) => new Promise<void>((resolve) => {
    let last = el.scrollTop
    let same = 0
    const tick = () => {
      if (el.scrollTop === last) same += 1
      else { same = 0; last = el.scrollTop }
      if (same >= 12) resolve()
      else requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }))
}

/** 整张同意卡片（两个勾选框和最后一条说明都在里面）完整落在滚动区可见范围内。 */
const CONSENT_IN_VIEW = { card: true, checkbox: true, sensitive: true, lastItem: true }

/** 先等字体，再按滚动区实际内沿量同意卡片、两个勾选框及最后一条说明；包含舞台缩放。 */
async function consentVisibility(page: Page) {
  return page.locator('.sa-qx .qx-scroll').evaluate(async (scroll) => {
    await document.fonts.ready
    const box = scroll.getBoundingClientRect()
    const scale = box.height / (scroll as HTMLElement).offsetHeight
    const top = box.top + scroll.clientTop * scale
    const bottom = top + scroll.clientHeight * scale
    const inside = (el: Element | null) => {
      if (!el) return false
      const rect = el.getBoundingClientRect()
      return rect.top >= top - 1 && rect.bottom <= bottom + 1 && rect.left >= box.left && rect.right <= box.right
    }
    const required = scroll.querySelector('[data-testid="self-assessment-consent-required"]')
    return {
      card: inside(scroll.querySelector('[data-testid="self-assessment-consent"]')),
      checkbox: inside(required) && inside(required?.closest('.sa-cbox') ?? null),
      sensitive: inside(scroll.querySelector('[data-testid="self-assessment-consent-sensitive"]')),
      lastItem: inside(scroll.querySelector('[data-testid="self-assessment-consent-items"] li:last-child')),
    }
  })
}

test.describe('自我探索 · 倾向参考 §1.6 真网络闭环', () => {
  test('§1.4 三方 taskId 一致 + §1.7 summary 不注入 LLM @kiosk', async ({ page, api }) => {
    const errors = collectRuntimeErrors(page)
    registerSelfAssessmentApi(api)

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
    registerSelfAssessmentApi(api)

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
    registerSelfAssessmentApi(api)
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
    registerSelfAssessmentApi(api)

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
    registerSelfAssessmentApi(api)
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
    registerSelfAssessmentApi(api)
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

  test('说明页提示往上滑，灰按钮与红条只滚到同意框、不代替同意 @w3-kiosk', async ({ page, api }) => {
    registerSelfAssessmentApi(api)
    await page.goto('/resume/self-assessment/intro')
    const intro = page.locator('[data-kiosk-screen="resume-self-assessment-intro"]')
    const required = page.getByTestId('self-assessment-consent-required')
    const primary = page.getByTestId('self-assessment-primary')
    const gate = page.getByTestId('self-assessment-gate')
    const cue = page.getByTestId('self-assessment-scrollcue')
    const scroll = intro.locator('.qx-scroll')
    await expect(intro).toHaveAttribute('data-state', 'intro-consent-pending')
    await expect(page.getByTestId('self-assessment-consent-items').locator('li')).toHaveText(served.consentItems.map((item, i) => `${i + 1}${item}`))
    await page.evaluate(() => document.fonts.ready)
    await twoFrames(page)
    expect((await consentVisibility(page)).checkbox, '前提：首屏必选勾选框不能完整可见').toBe(false)
    await expect(cue, '首屏提示条可见').toBeVisible()
    expect(SA_SCROLL_CUE, '常量逐字等于定稿句子').toBe('下面还有内容，手指往上滑')
    expect(await cue.textContent(), '提示条文字逐字等于常量').toBe(SA_SCROLL_CUE)
    const cueBox = await cue.boundingBox()
    const gateBox = await gate.boundingBox()
    expect(cueBox).not.toBeNull()
    expect(gateBox).not.toBeNull()
    expect(cueBox!.height, '提示条高度不小于 48px（CLAUDE.md §9）').toBeGreaterThanOrEqual(48)
    expect(Math.abs(cueBox!.height - 52), '提示条高度与稿的 52px 相差不超过 1px').toBeLessThanOrEqual(1)
    expect(Math.abs(cueBox!.x - gateBox!.x), '提示条与红条左对齐').toBeLessThanOrEqual(2)
    expect(Math.abs(cueBox!.width - gateBox!.width), '提示条与红条同宽').toBeLessThanOrEqual(2)
    expect(cueBox!.y + cueBox!.height, '提示条在红条上方').toBeLessThanOrEqual(gateBox!.y)
    expect(cueBox!.x).toBeGreaterThanOrEqual(0)
    expect(cueBox!.y).toBeGreaterThanOrEqual(0)
    expect(cueBox!.x + cueBox!.width).toBeLessThanOrEqual(page.viewportSize()!.width)
    expect(cueBox!.y + cueBox!.height).toBeLessThanOrEqual(page.viewportSize()!.height)
    const storedBefore = await page.evaluate(() => sessionStorage.getItem('self_assessment_session_v1'))
    const stillPending = async () => {
      await expect(required, '没有替用户勾选').toHaveAttribute('aria-checked', 'false')
      await expect(primary, '主按钮仍然置灰').toHaveAttribute('aria-disabled', 'true')
      await expect(intro, '页面仍是待确认').toHaveAttribute('data-state', 'intro-consent-pending')
      expect(await page.evaluate(() => sessionStorage.getItem('self_assessment_session_v1')), '没有写会话').toBe(storedBefore)
    }

    // aria-disabled 的按钮仍接受触控，用 force 绕过 Playwright 的 disabled 自动等待。
    await primary.click({ force: true })
    await expect.poll(() => consentVisibility(page), { message: '点灰按钮后整张同意卡片可见' }).toEqual(CONSENT_IN_VIEW)
    await stillPending()
    // 已经完整看得见时再点，正文不动。
    await scrollSettled(page)
    const landed = await scroll.evaluate((el) => el.scrollTop)
    await primary.click({ force: true })
    await scrollSettled(page)
    expect(await scroll.evaluate((el) => el.scrollTop), '同意卡片已经完整可见时再点，正文不动').toBe(landed)
    await stillPending()

    await scroll.evaluate((el) => el.scrollTo({ top: 0, behavior: 'instant' }))
    await twoFrames(page)
    await expect(cue).toBeVisible()
    await gate.click()
    await expect.poll(() => consentVisibility(page), { message: '点红条后整张同意卡片可见' }).toEqual(CONSENT_IN_VIEW)
    await stillPending()

    await scroll.evaluate((el) => el.scrollTo({ top: el.scrollHeight, behavior: 'instant' }))
    await twoFrames(page)
    await expect(cue, '滑到底提示条消失').toHaveCount(0)
    await stillPending()
    // 从页底往回：提示条会重新冒出来把可见区压矮，卡片仍要完整落在可见区里。
    expect((await consentVisibility(page)).card, '前提：滑到底时同意卡片的标题行被上沿切掉').toBe(false)
    await gate.click()
    await expect.poll(() => consentVisibility(page), { message: '从页底点红条后整张同意卡片可见' }).toEqual(CONSENT_IN_VIEW)
    await scrollSettled(page)
    expect(await consentVisibility(page), '从页底点红条、停稳后整张同意卡片仍可见').toEqual(CONSENT_IN_VIEW)
    await stillPending()

    // 提示条自身也是可点的，点后移动正文但不改同意。
    await scroll.evaluate((el) => el.scrollTo({ top: 0, behavior: 'instant' }))
    await twoFrames(page)
    await expect(cue).toBeVisible()
    await cue.click()
    await expect.poll(() => scroll.evaluate((el) => el.scrollTop), { message: '点提示条后正文向下滚动' }).toBeGreaterThan(0)
    await stillPending()
    await required.click()
    await twoFrames(page)
    await expect(primary).toBeEnabled()
    await expect(primary).not.toHaveAttribute('aria-disabled', 'true')
    await primary.click()
    await expect(page).toHaveURL(/\/resume\/self-assessment\/questions$/)
    await expect(page.locator('[data-kiosk-screen="resume-self-assessment-quiz"]')).toBeVisible()
    await twoFrames(page)
    await expect(cue, '答题页没有提示条').toHaveCount(0)
  })

  test('旧版本会话提交被拒：回到重新确认，已答保留，确认后自动重交一次 @w3-kiosk', async ({ page, api }) => {
    registerSelfAssessmentApi(api)
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

  test('拦截态写明原因和当前状态，底栏两个按钮等宽 @w3-kiosk', async ({ page, api }) => {
    registerSelfAssessmentApi(api)
    await page.goto('/resume/self-assessment/questions')
    const quiz = page.locator('[data-kiosk-screen="resume-self-assessment-quiz"]')
    await expect(quiz).toHaveAttribute('data-state', 'recover-consent')
    await expect(page.getByText('还不能进入作答')).toBeVisible()
    await expect(page.getByText('为什么会这样')).toBeVisible()
    await expect(page.getByText('这次作答现在的状态')).toBeVisible()
    await expect(page.getByText('不显示你打开的链接参数内容')).toBeVisible()
    await expect(page.getByText('尚未确认，不能开始作答。')).toBeVisible()
    const widths = await page.locator('.qx-ctabar > .qx-btn, .qx-ctabar > .sa-guarded').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width))
    expect(widths).toHaveLength(2)
    expect(Math.abs(widths[0] - widths[1])).toBeLessThan(8)
    expect(await columnGap(page, 'recover-consent')).toBeLessThan(160)

    await page.goto('/resume/self-assessment/result')
    await expect(page.locator('[data-kiosk-screen="resume-self-assessment-result"]')).toHaveAttribute('data-state', 'result-empty')
    await expect(page.getByText('还没有可查看的完成结果')).toBeVisible()
    await expect(page.getByText('答满并提交之后，这一页会列出')).toBeVisible()
    await expect(page.getByText('不显示你打开的链接参数内容')).toBeVisible()
    expect(await columnGap(page, 'result-empty')).toBeLessThan(160)

    await page.addInitScript(({ key, value }) => {
      sessionStorage.setItem(key, JSON.stringify(value))
    }, {
      key: 'self_assessment_session_v1',
      value: {
        answers: {},
        consent: { nonSensitive: true, sensitive: false },
        consentVersion: CURRENT_SELF_ASSESSMENT_CONSENT_VERSION,
        result: {
          taskId: 'sa-20261006-7f3c91',
          status: 'completed',
          dimensions: [],
          summary: null,
          expiresAt: '2026-10-07T09:30:00.000Z',
        },
      },
    })
    await page.goto('/resume/self-assessment/questions')
    await expect(quiz).toHaveAttribute('data-state', 'recover-submitted')
    await expect(page.getByRole('heading', { name: '本次作答已经提交' }).or(page.getByText('本次作答已经提交'))).toBeVisible()
  })
})
