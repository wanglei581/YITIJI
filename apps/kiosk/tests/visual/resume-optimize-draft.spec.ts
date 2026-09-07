import { readFileSync } from 'node:fs'
import type { Locator, Page } from '@playwright/test'
import { expect, test } from '../fixtures/kiosk-test'
import { registerW6Api } from './fixtures/fusion-w6-api'

const TASK_ID = 'l2-draft-2099'
const DRAFT_UPDATED_AT = '2099-03-15T08:30:00.000Z'
const W6_MEMBER_PHONE = '13800138000'
const W6_MEMBER_CODE = '123456'
const EMPTY_TASK_ID = 'optimize-empty-2099'
const EMPTY_ACCESS_TOKEN = 'optimize-empty-access-token'
const OPTIMIZE_PROTOTYPE = readFileSync(
  new URL('../../../../docs/design/kiosk-redesign-2026-08/23-resume-optimize.html', import.meta.url),
  'utf8',
)

const MANUAL_STEPS = [
  '先改诊断报告里排在最前面的那一条',
  '每段经历只保留一个最想被看到的结果',
  '把「负责」换成你实际做到的动作',
  '数字只写你自己核对过的',
  '技能写工具名称，再写做到什么程度',
  '删掉与目标岗位无关的段落',
  '同一件事不要在两个板块重复写',
  '改完通读一遍，再导出 PDF',
] as const

const OPTIMIZE_RESUME = {
  basic: { name: '优化样本', phone: '13800000000', city: '青岛' },
  intention: { position: '前端开发', city: '青岛' },
  summary: '这是优化结果摘要，不是草稿。',
  education: [{ school: '优化大学', major: '计算机', degree: '本科', period: '2018-2022' }],
  experience: [],
  projects: [],
  skills: ['TypeScript'],
  certificates: [],
}

const DRAFT_RESUME = {
  basic: { name: '草稿样本', phone: '13800000000', city: '青岛' },
  intention: { position: '前端开发', city: '青岛' },
  summary: '这是上次编辑留下的草稿内容。',
  education: [{ school: '草稿大学', major: '计算机', degree: '本科', period: '2018-2022' }],
  experience: [],
  projects: [],
  skills: ['TypeScript'],
  certificates: [],
}

async function loginThroughVisibleUi(page: Page, returnTo: string): Promise<void> {
  await page.goto(`/login?from=${encodeURIComponent(returnTo)}`)
  await page.getByRole('checkbox', { name: /我已阅读并同意/ }).click()
  for (const digit of W6_MEMBER_PHONE) {
    await page.getByRole('button', { name: digit, exact: true }).click()
  }
  await page.getByRole('button', { name: '获取验证码', exact: true }).click()
  await page.getByRole('button', { name: '短信验证码', exact: true }).click()
  for (const digit of W6_MEMBER_CODE) {
    await page.getByRole('button', { name: digit, exact: true }).click()
  }
  await page.getByRole('button', { name: '验证并登录', exact: true }).click()
  await page.waitForURL((url) => url.pathname === '/resume/optimize' && url.searchParams.get('taskId') === TASK_ID)
}

function registerOptimizeShell(api: Parameters<typeof registerW6Api>[0]): void {
  registerW6Api(api)
  api.respond('GET', '/api/v1/job-materials/templates', {
    status: 200,
    json: { success: true, data: [] },
  })
}

function registerEmptyOptimize(api: Parameters<typeof registerW6Api>[0]): void {
  api.respond('GET', `/api/v1/resume/records/${EMPTY_TASK_ID}/optimize`, {
    status: 200,
    json: {
      taskId: EMPTY_TASK_ID,
      status: 'completed',
      providerName: 'llm',
      modules: [],
    },
  })
}

async function seedAnonymousOptimizeSession(page: Page): Promise<void> {
  await page.addInitScript(({ taskId, accessToken }) => {
    window.sessionStorage.setItem('ai-job-print:current-ai-resume', JSON.stringify({ taskId, accessToken }))
  }, { taskId: EMPTY_TASK_ID, accessToken: EMPTY_ACCESS_TOKEN })
}

async function expectWholeTargetHit(locator: Locator): Promise<void> {
  const hit = await locator.evaluate((target) => {
    const rect = target.getBoundingClientRect()
    const scaler = document.querySelector('.kiosk-stage')
    const transform = scaler ? getComputedStyle(scaler).transform : 'none'
    const scale = transform === 'none' ? 1 : Number(transform.match(/^matrix\(([^,]+)/)?.[1] ?? 1)
    const inset = 3
    const points = [
      [rect.left + inset, rect.top + inset],
      [rect.right - inset, rect.top + inset],
      [rect.left + inset, rect.bottom - inset],
      [rect.right - inset, rect.bottom - inset],
      [rect.left + rect.width / 2, rect.top + rect.height / 2],
    ]
    let pointerEvents = 0
    const onPointer = () => { pointerEvents += 1 }
    target.addEventListener('pointerdown', onPointer)
    const uncovered = points.every(([x, y]) => {
      const hitElement = document.elementFromPoint(x, y)
      if (!hitElement || !(hitElement === target || target.contains(hitElement))) return false
      hitElement.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y }))
      return true
    })
    target.removeEventListener('pointerdown', onPointer)
    return {
      width: rect.width / scale,
      height: rect.height / scale,
      uncovered,
      pointerEvents,
    }
  })
  expect(hit.width).toBeGreaterThanOrEqual(48)
  expect(hit.height).toBeGreaterThanOrEqual(48)
  expect(hit.uncovered).toBe(true)
  expect(hit.pointerEvents).toBe(5)
}

test('member draft banner asks before rendering editor and continue restores draft @kiosk', async ({ page, api }) => {
  test.setTimeout(60_000)
  registerW6Api(api)
  api.respond('GET', '/api/v1/me/ai-consents/status', {
    status: 200,
    json: { success: true, data: [{ scope: 'resume_ai', granted: true }] },
  })
  api.respond('GET', `/api/v1/resume/records/${TASK_ID}/optimize`, {
    status: 200,
    json: {
      taskId: TASK_ID,
      status: 'completed',
      providerName: 'llm',
      modules: [{ title: '经历表达', before: '参与前端开发。', after: '参与前端开发并完成交付。' }],
      optimizedResume: OPTIMIZE_RESUME,
    },
  })
  api.respond('GET', `/api/v1/resume/records/${TASK_ID}/draft`, {
    status: 200,
    json: {
      taskId: TASK_ID,
      draft: {
        resume: DRAFT_RESUME,
        decisions: { 'm0:经历表达': 'original' },
        updatedAt: DRAFT_UPDATED_AT,
      },
    },
  })
  api.respond('GET', `/api/v1/resume/records/${TASK_ID}/versions`, {
    status: 200,
    json: { taskId: TASK_ID, latestVersion: null, items: [] },
  })

  await loginThroughVisibleUi(page, `/resume/optimize?taskId=${TASK_ID}`)
  await expect(page.locator('[data-kiosk-screen="resume-optimize"]')).toBeVisible()
  await expect(page.locator('[data-draft-banner="choice"]')).toBeVisible()
  await expect(page.getByRole('button', { name: /继续上次编辑/ })).toBeVisible()
  await expect(page.getByRole('button', { name: '从优化结果重新开始' })).toBeVisible()
  await expect(page.getByText('草稿样本')).toHaveCount(0)
  await expect(page.getByText('优化样本')).toHaveCount(0)
  await expect(page.locator('textarea')).toHaveCount(0)

  await page.getByRole('button', { name: /继续上次编辑/ }).click()
  await expect(page.locator('[data-draft-banner="choice"]')).toHaveCount(0)
  await expect(page.getByText('草稿样本')).toBeVisible()
  await expect(page.getByText('这是上次编辑留下的草稿内容。')).toBeVisible()
  await expect(page.getByText('优化样本')).toHaveCount(0)
})

test('live empty optimize response keeps the zero-model fallback and sends the anonymous access credential @kiosk', async ({ page, api }) => {
  registerOptimizeShell(api)
  await seedAnonymousOptimizeSession(page)
  registerEmptyOptimize(api)
  await page.route('**/prototype-resume-optimize?*', (route) => route.fulfill({
    status: 200,
    contentType: 'text/html; charset=utf-8',
    body: OPTIMIZE_PROTOTYPE,
  }))

  await page.goto('/prototype-resume-optimize?capture=1&flat=1')
  await expect(page.getByTestId('resume-optimize-state-no-context')).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('screenshots', 'prototype-resume-optimize-empty-1080x1920.png') })

  const requestPromise = page.waitForRequest((request) => (
    request.method() === 'GET'
    && new URL(request.url()).pathname === `/api/v1/resume/records/${EMPTY_TASK_ID}/optimize`
  ))
  await page.goto('/resume/optimize')
  const request = await requestPromise

  expect((await request.allHeaders())['x-resume-access-token']).toBe(EMPTY_ACCESS_TOKEN)
  await expect(page.locator('[data-kiosk-screen="resume-optimize"]')).toHaveAttribute('data-optimize-state', 'optimize-failed')
  await expect(page.getByTestId('resume-optimize-empty-paths').getByRole('button')).toHaveCount(3)
  await expect(page.getByTestId('resume-optimize-empty-steps').locator('li')).toHaveCount(8)
  for (const step of MANUAL_STEPS) await expect(page.getByText(step, { exact: true })).toBeVisible()

  for (const testId of ['resume-optimize-empty-report', 'resume-optimize-empty-manual', 'resume-optimize-empty-resumes']) {
    const target = page.getByTestId(testId)
    await target.scrollIntoViewIfNeeded()
    await expectWholeTargetHit(target)
  }
  for (const testId of ['resume-optimize-nav-home', 'resume-optimize-nav-advisor', 'resume-optimize-nav-profile']) {
    await expectWholeTargetHit(page.getByTestId(testId))
  }
  await page.getByText(MANUAL_STEPS[7], { exact: true }).scrollIntoViewIfNeeded()
  await expect(page.getByText(MANUAL_STEPS[7], { exact: true })).toBeVisible()
  await page.locator('[data-kiosk-screen="resume-optimize"]').evaluate((element) => element.scrollTo({ top: 0 }))
  await page.screenshot({ path: test.info().outputPath('screenshots', 'runtime-resume-optimize-empty-1080x1920.png') })
})

test('all three fallback paths and the navbar perform real registered-route navigation @kiosk', async ({ page, api }) => {
  registerOptimizeShell(api)
  await seedAnonymousOptimizeSession(page)
  registerEmptyOptimize(api)
  api.respond('GET', `/api/v1/resume/records/${EMPTY_TASK_ID}`, {
    status: 200,
    json: { taskId: EMPTY_TASK_ID, status: 'completed' },
  })

  const cases = [
    { testId: 'resume-optimize-empty-report', path: '/resume/report' },
    { testId: 'resume-optimize-empty-manual', path: '/me/resumes' },
    { testId: 'resume-optimize-empty-resumes', path: '/me/resumes' },
    { testId: 'resume-optimize-nav-home', path: '/' },
    { testId: 'resume-optimize-nav-advisor', path: '/assistant' },
    { testId: 'resume-optimize-nav-profile', path: '/profile' },
  ] as const

  for (const routeCase of cases) {
    await page.goto('/resume/optimize')
    await expect(page.locator('[data-kiosk-screen="resume-optimize"]')).toHaveAttribute('data-optimize-state', 'optimize-failed')
    const reportRequest = routeCase.path === '/resume/report'
      ? page.waitForRequest((request) => new URL(request.url()).pathname === `/api/v1/resume/records/${EMPTY_TASK_ID}`)
      : null
    await page.getByTestId(routeCase.testId).click()
    await expect(page).toHaveURL((url) => url.pathname === routeCase.path)
    if (reportRequest) {
      const request = await reportRequest
      expect((await request.allHeaders())['x-resume-access-token']).toBe(EMPTY_ACCESS_TOKEN)
    }
  }
})

test('AI provider outage shows an honest unavailable state without removing the manual fallback @kiosk', async ({ page, api }) => {
  registerOptimizeShell(api)
  await seedAnonymousOptimizeSession(page)
  api.respond('GET', `/api/v1/resume/records/${EMPTY_TASK_ID}/optimize`, {
    status: 503,
    json: { error: { code: 'AI_PROVIDER_NOT_CONFIGURED', message: 'provider key missing' } },
  })

  await page.goto('/resume/optimize')

  await expect(page.locator('[data-kiosk-screen="resume-optimize"]')).toHaveAttribute('data-optimize-state', 'unavailable')
  await expect(page.getByText('简历优化当前不可用', { exact: true })).toBeVisible()
  await expect(page.getByText('AI 能力尚未启用，请联系现场工作人员', { exact: true })).toBeVisible()
  await expect(page.getByTestId('resume-optimize-empty-fallback')).toBeVisible()
  await expect(page.getByTestId('resume-optimize-empty-paths').getByRole('button')).toHaveCount(3)
  await expect(page.getByTestId('resume-optimize-empty-steps').locator('li')).toHaveCount(8)
})
