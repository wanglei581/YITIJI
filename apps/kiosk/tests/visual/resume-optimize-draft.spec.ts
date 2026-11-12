import { readFileSync } from 'node:fs'
import type { Locator, Page } from '@playwright/test'
import { expect, test } from '../fixtures/kiosk-test'
import { registerW6Api } from './fixtures/fusion-w6-api'
import { VISIBLE_PDF } from './fixtures/fusion-w2-binary-route'

const TASK_ID = 'l2-draft-2099'
const DRAFT_UPDATED_AT = '2099-03-15T08:30:00.000Z'
const W6_MEMBER_PHONE = '13800138000'
const W6_MEMBER_CODE = '123456'
const EMPTY_TASK_ID = 'optimize-empty-2099'
const EMPTY_ACCESS_TOKEN = 'optimize-empty-access-token'
const HONEST_SWITCH_TASK_ID = 'optimize-honest-switch-2099'
const HONEST_SWITCH_ACCESS_TOKEN = 'optimize-honest-switch-access-token'
const OPTIMIZE_PROTOTYPE = readFileSync(
  new URL('../../../../docs/design/kiosk-redesign-2026-08-v2/23-resume-optimize.html', import.meta.url),
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
  await page.getByRole('button', { name: '手机号（11 位本人号码）', exact: true }).click()
  for (const digit of W6_MEMBER_PHONE) {
    await page.getByRole('button', { name: digit, exact: true }).click()
  }
  await page.getByRole('button', { name: '收起键盘', exact: true }).click()
  await page.getByRole('button', { name: '获取验证码', exact: true }).click()
  await page.getByRole('button', { name: '短信验证码', exact: true }).click()
  for (const digit of W6_MEMBER_CODE) {
    await page.getByRole('button', { name: digit, exact: true }).click()
  }
  await page.getByRole('button', { name: '收起键盘', exact: true }).click()
  await page.getByRole('button', { name: '确认登录', exact: true }).click()
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
    // 触屏版的出路行是大圆角（稿的圆角 28px 上下），矩形外框的四角本来就点不到：
    // 四个取点沿圆角往里收，落在圆角以内；仍然是「整块目标没被别的东西盖住」的判据。
    const radius = parseFloat(getComputedStyle(target).borderTopLeftRadius) || 0
    const inset = Math.max(3, radius * 0.3 + 3)
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

async function openAnonymousOptimize(
  page: Page,
  api: Parameters<typeof registerW6Api>[0],
  optimize: { providerName: string; modules: Array<{ title: string; before: string; after: string }> },
): Promise<void> {
  registerOptimizeShell(api)
  api.respond('GET', `/api/v1/resume/records/${HONEST_SWITCH_TASK_ID}/optimize`, {
    status: 200,
    json: {
      taskId: HONEST_SWITCH_TASK_ID,
      status: 'completed',
      ...optimize,
      optimizedResume: {
        ...OPTIMIZE_RESUME,
        experience: [{ company: '示例公司', role: '前端开发', period: '2022-2024', description: '负责页面开发并完成上线。' }],
      },
    },
  })
  await page.addInitScript(({ taskId, accessToken }) => {
    window.sessionStorage.setItem('ai-job-print:current-ai-resume', JSON.stringify({ taskId, accessToken }))
  }, { taskId: HONEST_SWITCH_TASK_ID, accessToken: HONEST_SWITCH_ACCESS_TOKEN })
  await page.goto('/resume/optimize')
  await expect(page.getByTestId('resume-optimize-overview')).toBeVisible()
}

async function textareaValues(page: Page): Promise<string[]> {
  return page.locator('textarea').evaluateAll((areas) => areas.map((area) => (area as HTMLTextAreaElement).value))
}

// 服务端只校验 before 出自原文，不要求 after 原样写进优化稿；切换靠在正文里找 after。
// 找不到时不能画开关、更不能在点了之后说「你在编辑区里改过」——用户什么都没改。
test('改写没有原样写进优化稿的条目标为只能手改，能切换的照常切换 @kiosk', async ({ page, api }) => {
  await openAnonymousOptimize(page, api, {
    providerName: 'llm',
    modules: [
      { title: '第一条经历', before: '负责页面开发。', after: '负责页面开发并完成上线。' },
      { title: '第二条经历', before: '参与项目协作。', after: '建议改为：推动项目协作。' },
    ],
  })
  const rows = page.getByTestId('resume-optimize-list').locator('li')
  const counts = page.getByTestId('resume-optimize-counts')
  await expect(rows).toHaveCount(2)
  await expect(rows.nth(0).getByRole('button', { name: '保留原文', exact: true })).toBeVisible()
  await expect(rows.nth(1).getByTestId('resume-optimize-row-manual')).toHaveText('这条改写没有原样写进优化稿，这里没法切换；要用哪一版，请在编辑区里对照着改。')
  expect(await rows.nth(1).getByRole('button', { name: /^(用改写|保留原文)$/ }).count()).toBe(0)
  await expect(counts.locator('[data-d="optimized"] b')).toHaveText('1 / 1')
  await expect(counts.locator('[data-d="manual"]')).toHaveText('只能手改1')

  await rows.nth(0).getByRole('button', { name: '保留原文', exact: true }).click()
  await expect(counts.locator('[data-d="original"] b')).toHaveText('1')
  await expect(counts.locator('[data-d="optimized"] b')).toHaveText('0 / 1')
  await expect(page.getByTestId('resume-optimize-batch').getByRole('button', { name: /全部保留原文/ })).toBeDisabled()
  await page.getByTestId('resume-optimize-open-editor').click()
  await expect(page.locator('textarea').first()).toBeVisible()
  const values = await textareaValues(page)
  expect(values.some((value) => value.includes('负责页面开发。'))).toBe(true)
  expect(values.some((value) => value.includes('负责页面开发并完成上线。'))).toBe(false)
  for (const blame of ['在编辑区里改过', '在编辑区里已经变了']) expect(await page.getByText(blame).count()).toBe(0)
})

test('一条都切换不了时（演示建议句）不画切换、计数与批量 @kiosk', async ({ page, api }) => {
  await openAnonymousOptimize(page, api, {
    providerName: 'mock',
    modules: [
      { title: '个人简介表达优化', before: '热爱工作，积极向上。', after: '建议改为具体可量化的表达。' },
      { title: '项目经历表达优化', before: '参与了系统开发。', after: '建议改为具体职责加成果。' },
    ],
  })
  const list = page.getByTestId('resume-optimize-list')
  const counts = page.getByTestId('resume-optimize-counts')
  await expect(list.getByTestId('resume-optimize-row-manual')).toHaveCount(2)
  await expect(counts.locator('[data-d="manual"] b')).toHaveText('2')
  await expect(page.getByText('上面这几条都没法在这里切换，要用哪一版，请在编辑区里对照着改')).toBeVisible()
  expect(await list.getByRole('button', { name: /^(用改写|保留原文)$/ }).count()).toBe(0)
  expect(await counts.locator('[data-d="optimized"], [data-d="original"]').count()).toBe(0)
  expect(await page.getByTestId('resume-optimize-batch').count()).toBe(0)
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
    // 「手动逐项修改」的去向 2026-09 按稿 23-resume-optimize.html:961 从 /me/resumes
    // 改到了 /resume/generate（依据写在 OptimizeEmptyState.tsx 的注释里：此前它和
    // 下面「打开我的简历」同去向，读起来像两张重复的卡）。本行原先钉的是旧去向，
    // 用例又从未在 CI 跑过，所以一直没红。按稿更新，不是照行为改断言。
    { testId: 'resume-optimize-empty-manual', path: '/resume/generate' },
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
  await expect(page.locator('.qx-pill')).toHaveText('AI 暂时用不了')
  await expect(page.locator('.qx-pill')).not.toContainText('等待优化建议')
  await expect(page.getByText('简历优化当前不可用', { exact: true })).toBeVisible()
  // 现场不安排人：如实说这项 AI 服务没开，出路是不用 AI 的手动方式（下面的 fallback 区就是），不叫人联系现场。
  // 原因句从共享错误码表来（原先是「AI 能力尚未启用，请联系现场工作人员」，main #1517 换成这一句）；
  // 说明后面可能带一句服务电话（号码读得到才加），所以只钉原因这句，不钉整段。
  await expect(page.getByText('这项 AI 服务暂时没开，你可以先按这一页的手动方式继续', { exact: false })).toBeVisible()
  await expect(page.getByText('请联系现场工作人员')).toHaveCount(0)
  await expect(page.getByTestId('resume-optimize-empty-fallback')).toBeVisible()
  await expect(page.getByTestId('resume-optimize-empty-paths').getByRole('button')).toHaveCount(3)
  await expect(page.getByTestId('resume-optimize-empty-steps').locator('li')).toHaveCount(8)
})

const LONG_COMPANY = '在门店负责日常运营并完成季度复盘'
const SHORT_COMPANY = '青序门店'

function entryResume(experience: Array<{ company: string; role: string; period: string; description: string }>) {
  return {
    basic: { name: '标题样本', city: '青岛' },
    intention: { position: '门店运营', city: '青岛' },
    summary: '核对过的经历摘要。',
    education: [{ school: '青岛大学', major: '工商管理', degree: '本科', period: '2018-2022' }],
    experience,
    projects: [{ name: '门店陈列项目', role: '执行', period: '2023', description: '按店里的陈列标准摆货。' }],
    skills: [] as string[],
    certificates: [] as string[],
  }
}

/** 没有可对照条目时直接进编辑区，和总览里点「打开编辑区」是同一个编辑组件。 */
async function openEntryEditor(
  page: Page,
  api: Parameters<typeof registerW6Api>[0],
  taskId: string,
  experience: Array<{ company: string; role: string; period: string; description: string }>,
): Promise<void> {
  registerOptimizeShell(api)
  api.respond('GET', `/api/v1/resume/records/${taskId}/optimize`, {
    status: 200,
    json: {
      taskId,
      status: 'completed',
      providerName: 'llm',
      modules: [],
      optimizedResume: entryResume(experience),
    },
  })
  api.respond('POST', '/api/v1/resume/generate/export', {
    status: 200,
    json: {
      fileId: 'entry-file',
      filename: '优化版简历.pdf',
      sizeBytes: 2048,
      pageCount: 1,
      signedUrl: '/e2e-fixtures/entry-resume.pdf',
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
      printFileUrl: '/api/v1/files/entry-file/content?expires=1&sig=test',
    },
  })
  // 导出后的页内预览取同站地址（F-20），不是下载直链。
  await page.route('**/api/v1/files/entry-file/content**', (route) => route.fulfill({ status: 200, contentType: 'application/pdf', body: '%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n' }))
  await page.route('**/e2e-fixtures/entry-resume.pdf', (route) => route.fulfill({
    status: 200,
    contentType: 'application/pdf',
    body: VISIBLE_PDF,
  }))
  await page.goto(`/resume/optimize?taskId=${encodeURIComponent(taskId)}`)
  await expect(page.getByTestId('resume-optimize-overview')).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: '第 1 条经历的公司' })).toBeVisible()
}

async function confirmExportFacts(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog', { name: '导出前核对事实' })
  await expect(dialog).toBeVisible()
  const boxes = dialog.getByRole('checkbox')
  const count = await boxes.count()
  expect(count).toBeGreaterThan(0)
  for (let i = 0; i < count; i += 1) await boxes.nth(i).click()
  await dialog.getByRole('button', { name: '确认导出' }).click()
}

/** 触屏版（稿 resume-edit → resume-export）：编辑页「去导出」→ 核对事实 → 进导出页选格式 → 「导出」才真正发请求。 */
async function exportBody(page: Page): Promise<{ experience?: Array<{ company?: string }> }> {
  await page.getByRole('button', { name: '去导出', exact: true }).click()
  await confirmExportFacts(page)
  const pending = page.waitForRequest((request) => (
    request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/resume/generate/export'
  ))
  await page.getByRole('button', { name: '导出', exact: true }).click()
  return (await pending).postDataJSON() as { experience?: Array<{ company?: string }> }
}

test('改经历公司名后预览和导出都用改后的短名 @kiosk', async ({ page, api }) => {
  await openEntryEditor(page, api, 'r6-title-edit-2099', [
    { company: LONG_COMPANY, role: '店员', period: '2022-2024', description: '负责门店日常运营。' },
  ])
  const company = page.getByRole('textbox', { name: '第 1 条经历的公司' })
  await expect(company).toHaveValue(LONG_COMPANY)
  await expect(page.getByRole('textbox', { name: '第 1 条教育的学校' })).toHaveValue('青岛大学')
  await expect(page.getByRole('textbox', { name: '第 1 条教育的专业' })).toHaveValue('工商管理')
  await expect(page.getByText('本科 · 2018-2022', { exact: true })).toBeVisible()
  await expect(page.locator('p', { hasText: '门店陈列项目 · 执行' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: /项目的名称|项目的职务/ })).toHaveCount(0)

  await company.fill(SHORT_COMPANY)
  await expect(company).toHaveValue(SHORT_COMPANY)
  const body = await exportBody(page)
  expect(body.experience?.map((item) => item.company)).toEqual([SHORT_COMPANY])
})

test('删掉多出来的经历需确认，取消不变，确认后预览和导出都不再带它 @kiosk', async ({ page, api }) => {
  await openEntryEditor(page, api, 'r6-title-delete-2099', [
    { company: SHORT_COMPANY, role: '店员', period: '2022-2024', description: '负责门店日常运营。' },
    { company: LONG_COMPANY, role: '运营', period: '2020-2021', description: '这一条是解析多出来的。' },
  ])
  const extra = page.getByRole('button', { name: '删掉这一条，第 2 条经历' })
  await extra.click()
  const dialog = page.getByRole('dialog', { name: '确定删掉这一条吗？' })
  await expect(dialog.getByRole('heading', { name: '确定删掉这一条吗？' })).toBeVisible()
  await expect(dialog.getByText('删了以后导出和打印都不会再带这一条。')).toBeVisible()
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '第 1 条经历的公司' })).toHaveValue(SHORT_COMPANY)
  await expect(page.getByRole('textbox', { name: '第 2 条经历的公司' })).toHaveValue(LONG_COMPANY)

  await extra.click()
  await dialog.getByRole('button', { name: '确定', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '第 2 条经历的公司' })).toHaveCount(0)
  await expect(page.getByText(LONG_COMPANY)).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: '第 1 条经历的公司' })).toHaveValue(SHORT_COMPANY)

  const body = await exportBody(page)
  expect(JSON.stringify(body.experience ?? [])).not.toContain(LONG_COMPANY)

  await page.getByRole('button', { name: '关闭文件预览' }).click()
  // 导出页与编辑页是两屏；回到编辑页再继续删。
  await page.locator('.qxt-dock').getByRole('button', { name: '返回', exact: true }).click()
  await page.getByRole('button', { name: '删掉这一条，第 1 条经历' }).click()
  await page.getByRole('dialog', { name: '确定删掉这一条吗？' }).getByRole('button', { name: '确定', exact: true }).click()
  await expect(page.getByRole('textbox', { name: /条经历的公司/ })).toHaveCount(0)
  await expect(page.getByText('实习 / 工作经历', { exact: true })).toHaveCount(0)
})

test('公司名空着不拦导出、超过 100 字才就地提示并拦住 @kiosk', async ({ page, api }) => {
  await openEntryEditor(page, api, 'r6-title-invalid-2099', [
    { company: SHORT_COMPANY, role: '店员', period: '2022-2024', description: '负责门店日常运营。' },
  ])
  const company = page.getByRole('textbox', { name: '第 1 条经历的公司' })
  const role = page.getByRole('textbox', { name: '第 1 条经历的职务' })
  // 触屏版只有一个导出入口：编辑页底栏的「去导出」（核对事实在它后面），不再有侧栏和底栏两颗导出键。
  const toExport = page.getByRole('button', { name: '去导出', exact: true })
  // 10/6：原件没写公司 / 职务时如实留空，和服务端 DTO 一致，空着不提示也不拦（走查 W-119 回归：没写职务的简历导不出）。
  await company.fill('')
  await role.fill('')
  await expect(page.getByText(/不能空/)).toHaveCount(0)
  await expect(toExport).not.toHaveAttribute('aria-disabled', 'true')
  await company.fill('司'.repeat(101))
  await expect(page.getByText('公司名最多 100 字', { exact: true })).toBeVisible()
  await expect(toExport).toHaveAttribute('aria-disabled', 'true')
  // aria-disabled 会被当成不可点；force 用来确认即使用户点下去，也不会打开发出导出。
  await toExport.click({ force: true })
  await expect(page.getByRole('heading', { name: '导出前核对事实' })).toHaveCount(0)
  await expect(page.locator('[data-entry-field="experience-0-company"]')).toBeFocused()

  await company.fill('司'.repeat(101))
  await expect(page.getByText('公司名最多 100 字', { exact: true })).toBeVisible()
  await expect(page.getByText('公司名不能空')).toHaveCount(0)
  await toExport.click({ force: true })
  await page.waitForTimeout(400)
  expect(api.requestCount('POST', '/api/v1/resume/generate/export')).toBe(0)
})

test('删掉一条经历后没删的那条仍在导出里 @kiosk', async ({ page, api }) => {
  await openEntryEditor(page, api, 'r6-title-kept-2099', [
    { company: SHORT_COMPANY, role: '店员', period: '2022-2024', description: '负责门店日常运营。' },
    { company: LONG_COMPANY, role: '运营', period: '2020-2021', description: '这一条是解析多出来的。' },
  ])
  await page.getByRole('button', { name: '删掉这一条，第 2 条经历' }).click()
  await page.getByRole('dialog', { name: '确定删掉这一条吗？' }).getByRole('button', { name: '确定', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '第 1 条经历的公司' })).toHaveValue(SHORT_COMPANY)

  const body = await exportBody(page)
  const companies = body.experience?.map((item) => item.company) ?? []
  expect(companies).toContain(SHORT_COMPANY)
  expect(companies).not.toContain(LONG_COMPANY)
})

const KEEP_MANUAL_TASK_ID = 'optimize-keep-manual-2099'
const KEEP_MANUAL_ACCESS_TOKEN = 'optimize-keep-manual-access-token'
const KEEP_NOTE = '这一段没有改动，保留原文'
const KEEP_SENTENCE = '2019年9月至2023年6月就读于山东财经大学新闻学本科。'
const SAME_SENTENCE = '协助整理学院公众号的选题目录和排版稿。'
const MANUAL_SENTENCE = '参与迎新志愿服务，协助新生报到和答疑。'
const MANUAL_AFTER = '在迎新志愿服务中协助新生完成报到和答疑。'
const SWITCH_SITE = '维护学院官网的栏目内容和活动通知。'
const SWITCH_SITE_AFTER = '把学院官网的栏目内容和活动通知写得更清楚。'
const SWITCH_FAIR = '整理招聘会的签到表和展位资料。'
const SWITCH_FAIR_AFTER = '把招聘会的签到表和展位资料按场次归档。'
const MANUAL_NOTE_NOT_FOUND = '这条改写没有原样写进优化稿，这里没法切换；要用哪一版，请在编辑区里对照着改。'
const LONG_SUMMARY = '本人在校期间持续整理新闻稿件与活动记录。'.repeat(35)
const LONG_DESCRIPTION = '完成一门课程的采访作业。'.repeat(100)

function keepManualResume() {
  return {
    basic: { name: '周启明', phone: '13800000000', city: '青岛' },
    intention: { position: '新闻编辑', city: '青岛' },
    summary: LONG_SUMMARY,
    education: [{
      school: KEEP_SENTENCE,
      major: '新闻学',
      degree: '本科',
      period: '2019-2023',
      description: LONG_DESCRIPTION,
    }],
    experience: [
      { company: '学院学生会', role: '干事', period: '2021-2022', description: MANUAL_SENTENCE },
      { company: '学院新媒体中心', role: '编辑', period: '2022-2023', description: SAME_SENTENCE },
      { company: '学院官网工作室', role: '编辑', period: '2023-2024', description: SWITCH_SITE },
    ],
    projects: [
      { name: '迎新志愿服务', role: '志愿者', description: MANUAL_SENTENCE },
      { name: '春季招聘会', role: '资料员', description: SWITCH_FAIR },
    ],
    skills: ['新闻写作'],
    certificates: [] as string[],
  }
}

async function openKeepManualOptimize(page: Page, api: Parameters<typeof registerW6Api>[0]): Promise<void> {
  registerOptimizeShell(api)
  api.respond('GET', `/api/v1/resume/records/${KEEP_MANUAL_TASK_ID}/optimize`, {
    status: 200,
    json: {
      taskId: KEEP_MANUAL_TASK_ID,
      status: 'completed',
      providerName: 'llm',
      optimizedResume: keepManualResume(),
      modules: [
        { title: '教育经历（保持原文）', before: KEEP_SENTENCE, after: KEEP_NOTE },
        { title: '公众号选题', before: SAME_SENTENCE, after: SAME_SENTENCE },
        { title: '迎新志愿服务', before: MANUAL_SENTENCE, after: MANUAL_AFTER },
        { title: '学院官网', before: SWITCH_SITE, after: SWITCH_SITE_AFTER },
        { title: '招聘会资料', before: SWITCH_FAIR, after: SWITCH_FAIR_AFTER },
      ],
    },
  })
  await page.addInitScript(({ taskId, accessToken }) => {
    window.sessionStorage.setItem('ai-job-print:current-ai-resume', JSON.stringify({ taskId, accessToken }))
  }, { taskId: KEEP_MANUAL_TASK_ID, accessToken: KEEP_MANUAL_ACCESS_TOKEN })
  await page.goto('/resume/optimize')
  await expect(page.getByTestId('resume-optimize-overview')).toBeVisible()
}

test.describe('保持原文无需操作，换不上的去编辑区，长简介不再被截断', () => {
  test('总览把保持原文和同文标成无需操作，换不上的一点就停在那一栏 @kiosk', async ({ page, api }) => {
    expect(LONG_SUMMARY.length).toBe(700)
    expect(LONG_DESCRIPTION.length).toBe(1200)
    await openKeepManualOptimize(page, api)
    const list = page.getByTestId('resume-optimize-list')
    const rows = list.locator('li')
    const counts = page.getByTestId('resume-optimize-counts')
    await expect(rows).toHaveCount(5)
    const untouched = rows.filter({ hasText: '无需操作' })
    await expect(untouched).toHaveCount(2)
    await expect(untouched.getByText('这一段保持原文。')).toHaveCount(2)
    await expect(untouched.getByRole('button', { name: '打开' })).toHaveCount(0)
    await expect(untouched.getByText('这一条只能在编辑区里改。')).toHaveCount(0)
    await expect(counts.locator('[data-d="optimized"] b')).toHaveText('0 / 2')
    await expect(counts.locator('[data-d="original"] b')).toHaveText('2')
    await expect(counts.locator('[data-d="manual"] b')).toHaveText('1')

    // 总览原文行会去掉句末句号，再接说明；按标题定位这一条。
    const manualRow = rows.filter({ hasText: '迎新志愿服务' })
    const goEdit = manualRow.getByRole('button', { name: '去编辑区改这一条', exact: true })
    await goEdit.scrollIntoViewIfNeeded()
    await goEdit.click()
    const field = page.locator('[data-entry-field="experience-0-description"]')
    await expect(field).toBeFocused()
    await expect(field).toHaveValue(MANUAL_SENTENCE)
    const selected = await field.evaluate((element) => {
      const input = element as HTMLTextAreaElement
      return input.value.slice(input.selectionStart ?? 0, input.selectionEnd ?? 0)
    })
    expect(selected).toBe(MANUAL_SENTENCE)

    const summary = page.getByRole('textbox', { name: '个人简介' })
    await expect(summary).toHaveValue(LONG_SUMMARY)
    await summary.fill(`${LONG_SUMMARY}补`)
    await expect(summary).toHaveValue(`${LONG_SUMMARY}补`)
    const description = page.getByRole('textbox', { name: '第 1 条教育的描述' })
    await expect(description).toHaveValue(LONG_DESCRIPTION)
    await description.fill(`${LONG_DESCRIPTION}补`)
    await expect(description).toHaveValue(`${LONG_DESCRIPTION}补`)
  })

  test('对照页跳过无需操作条目，换不上的不被批量设成用改写 @kiosk', async ({ page, api }) => {
    await openKeepManualOptimize(page, api)
    const manualRow = page.getByTestId('resume-optimize-list').locator('li').filter({ hasText: '迎新志愿服务' })
    await manualRow.locator('button', { hasText: '打开' }).click()
    await expect(page.getByText('第 1 / 3 条 · 迎新志愿服务')).toBeVisible()
    await expect(page.getByText('无需操作')).toHaveCount(0)
    await expect(page.getByText(KEEP_SENTENCE)).toHaveCount(0)
    await expect(page.getByText(SAME_SENTENCE)).toHaveCount(0)
    await expect(page.getByText('这一段保持原文。')).toHaveCount(0)
    await expect(page.getByRole('button', { name: '用改写', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '保留原文', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '自己写', exact: true })).toHaveCount(0)
    await expect(page.getByTestId('compare-manual')).toContainText('只能手改')
    await expect(page.getByTestId('compare-manual')).toContainText(MANUAL_NOTE_NOT_FOUND)
    await expect(page.getByRole('button', { name: '去编辑区改这一条', exact: true })).toBeVisible()
    await expect(page.getByText('跳过有待确认事实、只能手改的那几条')).toBeVisible()
    await expect(page.getByRole('button', { name: '下一条', exact: true })).toBeEnabled()

    await page.getByRole('button', { name: '下一条', exact: true }).click()
    await expect(page.getByText('第 2 / 3 条 · 学院官网')).toBeVisible()
    await expect(page.getByText(SWITCH_SITE).first()).toBeVisible()
    await expect(page.getByText('无需操作')).toHaveCount(0)
    await page.getByRole('button', { name: '保留原文', exact: true }).click()
    await page.getByRole('button', { name: '下一条', exact: true }).click()
    await expect(page.getByText('第 3 / 3 条 · 招聘会资料')).toBeVisible()
    await expect(page.getByText(SWITCH_FAIR).first()).toBeVisible()
    await expect(page.getByText(KEEP_SENTENCE)).toHaveCount(0)
    await expect(page.getByText(SAME_SENTENCE)).toHaveCount(0)
    await expect(page.getByText('无需操作')).toHaveCount(0)

    await page.getByRole('button', { name: /可采纳的全部采纳/ }).click()
    await page.locator('.qxt-back').click()
    await expect(page.getByRole('dialog', { name: '对照页有 2 条裁决' })).toBeVisible()
    await page.getByRole('button', { name: '暂不应用' }).click()
    await page.locator('.qxt-back').click()
    const backRow = page.getByTestId('resume-optimize-list').locator('li').filter({ hasText: '迎新志愿服务' })
    await expect(backRow.getByRole('button', { name: '去编辑区改这一条', exact: true })).toBeVisible()
    await expect(backRow.getByRole('button', { name: '用改写', exact: true })).toHaveCount(0)
    await expect(page.getByText('没能自动放进稿里')).toHaveCount(0)
  })
})
