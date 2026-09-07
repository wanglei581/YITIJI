import type { Page, Request } from '@playwright/test'
import { expect, test } from '../fixtures/kiosk-test'
import { registerW4Api } from '../fixtures/fusion-w4-api'

const COMPARE_TASK_ID = 'visible-compare'
const COMPARE_ACCESS_TOKEN = 'visible-compare-access'

const COMPARE_RESUME = {
  basic: { name: '对照样本', phone: '13800000000', city: '青岛' },
  intention: { position: '运营', city: '青岛' },
  summary: '对齐需求，持续跟进问题至闭环。',
  education: [],
  experience: [{
    company: '对照公司',
    role: '专员',
    period: '2023-2024',
    description: '主导数据整理，完成 5000 条记录校验。',
  }],
  projects: [],
  skills: ['TypeScript'],
  certificates: [],
}

function registerResumeCompare(api: Parameters<typeof registerW4Api>[0]) {
  api.respond('GET', `/api/v1/resume/records/${COMPARE_TASK_ID}/optimize`, {
    status: 200,
    json: {
      taskId: COMPARE_TASK_ID,
      status: 'completed',
      providerName: 'deepseek',
      modules: [
        { title: '项目成果', before: '参与数据整理。', after: '主导数据整理，完成 5000 条记录校验。' },
        { title: '团队协作', before: '沟通需求并跟进问题。', after: '对齐需求，持续跟进问题至闭环。' },
      ],
      optimizedResume: COMPARE_RESUME,
    },
  })
}

async function openResumeCompare(page: Page, api: Parameters<typeof registerW4Api>[0]): Promise<Request> {
  registerW4Api(api)
  api.respond('GET', '/api/v1/job-materials/templates', { status: 200, json: { success: true, data: [] } })
  registerResumeCompare(api)
  await page.addInitScript(({ taskId, accessToken }) => {
    window.sessionStorage.setItem('ai-job-print:current-ai-resume', JSON.stringify({ taskId, accessToken }))
  }, { taskId: COMPARE_TASK_ID, accessToken: COMPARE_ACCESS_TOKEN })
  const optimizeRequest = page.waitForRequest((request) => (
    request.method() === 'GET' && new URL(request.url()).pathname.endsWith(`/${COMPARE_TASK_ID}/optimize`)
  ))
  await page.goto('/resume/optimize/compare')
  await expect(page.getByText('第 1 / 2 条')).toBeVisible()
  return optimizeRequest
}

test('线下机构搜索提交真实 keyword 并可清空 @kiosk', async ({ page, api }) => {
  registerW4Api(api)
  api.respond('GET', '/api/v1/kiosk/offline-agencies', {
    status: 200,
    json: { data: [], total: 21, page: 1, pageSize: 10 },
  })
  const requests: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/v1/kiosk/offline-agencies') {
      requests.push(request.url())
    }
  })

  await page.goto('/offline-agencies')
  const search = page.getByRole('searchbox', { name: '搜索机构名称' })
  await search.fill('  青岛合规  ')
  await page.getByRole('button', { name: '搜索' }).click()
  await expect.poll(() => requests.at(-1)).toContain('keyword=%E9%9D%92%E5%B2%9B%E5%90%88%E8%A7%84')

  await page.getByRole('button', { name: '下一页' }).click()
  await expect.poll(() => requests.at(-1)).toContain('page=2')
  await expect.poll(() => requests.at(-1)).toContain('keyword=%E9%9D%92%E5%B2%9B%E5%90%88%E8%A7%84')
  const nextPageButton = page.getByRole('button', { name: '下一页' })
  await expect.poll(() => (
    nextPageButton.evaluate((button) => button.getBoundingClientRect().height).catch(() => 0)
  )).toBeGreaterThanOrEqual(48)

  await page.getByRole('button', { name: '清除搜索' }).click()
  await expect.poll(() => requests.at(-1)).not.toContain('keyword=')
  await expect.poll(() => requests.at(-1)).toContain('page=1')

  await page.setViewportSize({ width: 390, height: 844 })
  await search.fill('移动端无横向溢出')
  await page.getByRole('button', { name: '搜索' }).click()
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
})

test('场馆导览只进入既有可打印材料页 @kiosk', async ({ page, api }) => {
  registerW4Api(api)
  api.respond('GET', '/api/v1/job-fairs/fair-001/map', {
    status: 200,
    json: { success: true, data: { mapImageUrl: null, zones: [], booths: [] } },
  })
  api.respond('GET', '/api/v1/job-fairs/fair-001/materials', {
    status: 200,
    json: { success: true, data: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } },
  })
  await page.goto('/job-fairs/fair-001/map')
  await expect(page.getByText('暂无场馆导览数据')).toBeVisible()
  const materialsButton = page.getByRole('button', { name: '查看可打印导览资料' })
  expect(await materialsButton.evaluate((button) => button.getBoundingClientRect().height)).toBeGreaterThanOrEqual(48)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  await materialsButton.click()
  await expect(page).toHaveURL(/\/job-fairs\/fair-001\/materials$/)
  await expect(page.getByText('暂无可用活动资料')).toBeVisible()
})

test('场馆导览加载失败后可原页重试并进入诚实空态 @kiosk', async ({ page, api }) => {
  registerW4Api(api)
  api.abort('GET', '/api/v1/job-fairs/fair-001/map', 'internetdisconnected')

  await page.goto('/job-fairs/fair-001/map')
  await expect(page.getByText('加载失败，请稍后重试')).toBeVisible()

  api.respond('GET', '/api/v1/job-fairs/fair-001/map', {
    status: 200,
    json: { success: true, data: { mapImageUrl: null, zones: [], booths: [] } },
  })
  await page.getByRole('button', { name: '重试' }).click()
  await expect(page.getByText('暂无场馆导览数据')).toBeVisible()
})

test('导出直达已下线为优化页兼容重定向 @kiosk', async ({ page, api }) => {
  registerW4Api(api)
  api.respond('GET', '/api/v1/job-materials/templates', { status: 200, json: { success: true, data: [] } })
  await page.goto('/resume/export')
  await expect(page).toHaveURL(/\/resume\/optimize$/)
  await expect(page.getByText('请先上传简历完成诊断')).toBeVisible()
  const buttonHeights = await page.locator('button:visible').evaluateAll((buttons) => (
    buttons.map((button) => button.getBoundingClientRect().height)
  ))
  expect(Math.min(...buttonHeights)).toBeGreaterThanOrEqual(48)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
})

test('逐条对照要求新增事实确认并回传裁决 @kiosk', async ({ page, api }) => {
  const optimizeRequest = await openResumeCompare(page, api)
  expect((await optimizeRequest.allHeaders())['x-resume-access-token']).toBe(COMPARE_ACCESS_TOKEN)

  const useRewrite = page.getByRole('button', { name: '用改写' })
  await expect(useRewrite).toBeDisabled()
  await expect(page.getByText('5000', { exact: true }).first()).toBeVisible()
  await page.getByRole('checkbox', { name: /5000/ }).check()
  await page.getByRole('checkbox', { name: /主导/ }).check()
  await useRewrite.click()
  await page.getByRole('button', { name: '下一条' }).click()
  await expect(page.getByText('第 2 / 2 条')).toBeVisible()
  await expect(page.getByText('对齐需求，持续跟进问题至闭环。')).toBeVisible()
  await page.getByRole('button', { name: '保留原文', exact: true }).click()
  await page.getByRole('button', { name: '下一条' }).click()
  await expect(page).toHaveURL(/\/resume\/optimize$/)
  const returnedState = await page.evaluate(() => window.history.state?.usr)
  expect(returnedState).toEqual({
    taskId: COMPARE_TASK_ID,
    accessToken: COMPARE_ACCESS_TOKEN,
    // 裁决键与优化页同源（resume-deliver/resumeDecisions.ts moduleKeyOf：`m<序号>:<标题>`）
    decisions: { 'm0:项目成果': 'optimized', 'm1:团队协作': 'original' },
  })
  await expect(page.getByRole('dialog', { name: '对照页有 2 条裁决' })).toBeVisible()
  await expect(page.getByText('应用后会改写下面编辑区的对应文字；只有编辑区的内容会进入导出。')).toBeVisible()
  await expect(page.locator('textarea').first()).toHaveValue('对齐需求，持续跟进问题至闭环。')
  await page.getByRole('button', { name: '暂不应用' }).click()
  await expect(page.getByRole('dialog', { name: '对照页有 2 条裁决' })).toHaveCount(0)
  await expect(page.locator('textarea').first()).toHaveValue('对齐需求，持续跟进问题至闭环。')
  await expect(page.getByText('沟通需求并跟进问题。')).toHaveCount(0)
})

test('逐条对照手机断点无横向溢出且操作区换算合格 @mobile', async ({ page, api }) => {
  await openResumeCompare(page, api)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  const stage = page.locator('.kiosk-stage')
  const transform = await stage.evaluate((element) => getComputedStyle(element).transform)
  const scale = transform === 'none' ? 1 : Number(transform.match(/^matrix\(([^,]+)/)?.[1] ?? 1)
  for (const name of [/^用改写$/, /^保留原文$/, /^下一条$/, /可采纳的全部采纳/, /其余保留原文/, /清空全部裁决/]) {
    const box = await page.getByRole('button', { name }).boundingBox()
    expect(box).not.toBeNull()
    expect(box!.height / scale).toBeGreaterThanOrEqual(56)
    expect(box!.width / scale).toBeGreaterThanOrEqual(48)
  }
})

test('对照页批量采纳跳过未确认事实且清空后回到待定 @kiosk', async ({ page, api }) => {
  await openResumeCompare(page, api)

  await page.getByRole('button', { name: '可采纳的全部采纳' }).click()
  await expect(page.getByText('已采纳 1 条；跳过 1 条 —— 那几条的改写里有原文没有的事实，要逐项确认后才能采纳。批量动作不会绕过这道拦截。')).toBeVisible()
  await expect(page.getByRole('button', { name: '用改写' })).toBeDisabled()
  await page.getByText('裁决草稿').click()
  await expect(page.getByText('项目成果 · 待定')).toBeVisible()
  await expect(page.getByText('团队协作 · 已采纳')).toBeVisible()

  await page.getByRole('checkbox', { name: /5000/ }).check()
  await page.getByRole('checkbox', { name: /主导/ }).check()
  await page.getByRole('button', { name: '用改写' }).click()
  await expect(page.getByRole('button', { name: '用改写' })).toHaveAttribute('aria-pressed', 'true')

  await page.getByRole('button', { name: '清空全部裁决' }).click()
  await expect(page.getByText('已清空全部裁决，连事实确认标记一起清掉 —— 回到刚读到建议时的样子。')).toBeVisible()
  await expect(page.getByRole('button', { name: '用改写' })).toBeDisabled()
  await expect(page.getByRole('checkbox', { name: /5000/ })).not.toBeChecked()
  await expect(page.getByRole('checkbox', { name: /主导/ })).not.toBeChecked()
  await expect(page.getByText('项目成果 · 待定')).toBeVisible()
  await expect(page.getByText('团队协作 · 待定')).toBeVisible()
const GENERATE_TASK_ID = 'gen-preview-1'
const GENERATE_RESUME = {
  basic: { name: '青岛求职者', phone: '13800001111', city: '青岛' },
  intention: { position: '前端开发', city: '青岛' },
  summary: '按本人填写内容润色的摘要。',
  education: [{ school: '青岛理工', major: '计算机', degree: '本科', period: '2018-2022', description: '完成本科学业。' }],
  experience: [{ company: '青岛示例科技', role: '实习生', period: '2022-2023', description: '参与前端页面开发。' }],
  projects: [{ name: '校园活动站', role: '成员', description: '按任务书完成页面改版。' }],
  skills: ['TypeScript', 'React'],
  certificates: ['英语四级'],
}

function registerGeneratePreviewBaseline(api: Parameters<typeof registerW4Api>[0]) {
  registerW4Api(api)
  api.respond('GET', '/api/v1/job-materials/templates', { status: 200, json: { success: true, data: [] } })
}

async function stageScaleOf(page: Page): Promise<number> {
  const transform = await page.locator('.kiosk-stage').evaluate((element) => getComputedStyle(element).transform)
  return transform === 'none' ? 1 : Number(transform.match(/^matrix\(([^,]+)/)?.[1] ?? 1)
}

test('生成预览空态按稿只留两个出口且都能到达 @kiosk', async ({ page, api }) => {
  registerGeneratePreviewBaseline(api)
  await page.goto('/resume/generate/preview')
  await expect(page.locator('[data-kiosk-screen="resume-generate-preview"]')).toBeVisible()
  await expect(page.getByText('生成结果已清除')).toBeVisible()
  await expect(page.getByRole('button', { name: '重新填写生成', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '重新填写', exact: true })).toHaveCount(0)
  await expect(page.getByTestId('resume-generate-preview-cta-home')).toHaveText('返回服务大厅')
  await expect(page.getByTestId('resume-generate-preview-cta-refill')).toHaveText('重新填一份')
  await expect(page.getByRole('button', { name: '重新填一份' })).toHaveCount(1)
  const scale = await stageScaleOf(page)
  for (const testid of ['resume-generate-preview-cta-home', 'resume-generate-preview-cta-refill']) {
    const control = page.getByTestId(testid)
    const box = await control.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.height / scale).toBeGreaterThanOrEqual(56)
    expect(box!.width / scale).toBeGreaterThanOrEqual(48)
    const hits = await control.evaluate((element) => {
      const rect = element.getBoundingClientRect()
      const inset = Math.min(8, rect.width / 4, rect.height / 4)
      return [
        [rect.left + inset, rect.top + inset],
        [rect.left + rect.width / 2, rect.top + rect.height / 2],
        [rect.right - inset, rect.bottom - inset],
      ].map(([x, y]) => {
        const top = document.elementFromPoint(x, y)
        return Boolean(top && (element === top || element.contains(top)))
      })
    })
    expect(hits).toEqual([true, true, true])
  }
  await page.screenshot({ path: test.info().outputPath('generate-preview-empty-1080x1920.png') })

  await page.getByTestId('resume-generate-preview-cta-refill').click()
  await expect(page).toHaveURL(/\/resume\/generate$/)
  await expect(page.locator('[data-kiosk-screen="resume-generate"]')).toBeVisible()
  await expect(page.getByText('AI 简历生成').first()).toBeVisible()

  await page.goto('/resume/generate/preview')
  await page.getByTestId('resume-generate-preview-cta-home').click()
  await expect(page).toHaveURL(/\/$/)
})

test('生成预览读回真实结果后导出 payload 正确 @kiosk', async ({ page, api }) => {
  registerGeneratePreviewBaseline(api)
  api.respond('GET', `/api/v1/resume/generate/${GENERATE_TASK_ID}`, {
    status: 200,
    json: {
      taskId: GENERATE_TASK_ID,
      status: 'completed',
      providerName: 'deepseek',
      resume: GENERATE_RESUME,
      missingHints: ['未填写联系邮箱，招聘方可能无法联系你'],
    },
  })
  api.respond('POST', '/api/v1/resume/generate/export', {
    status: 200,
    json: {
      fileId: 'gen-export-1',
      filename: 'AI简历_青岛求职者.pdf',
      sizeBytes: 4096,
      pageCount: 1,
      signedUrl: '/e2e-fixtures/generated-resume.pdf',
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
      printFileUrl: '/api/v1/files/gen-export-1/content?expires=1&sig=test',
    },
  })
  await page.route('**/e2e-fixtures/generated-resume.pdf', (route) =>
    route.fulfill({ status: 200, contentType: 'application/pdf', body: '%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n' }),
  )

  const generateGet = page.waitForRequest((request) => (
    request.method() === 'GET' && new URL(request.url()).pathname === `/api/v1/resume/generate/${GENERATE_TASK_ID}`
  ))
  await page.goto(`/resume/generate/preview?taskId=${GENERATE_TASK_ID}`)
  await generateGet
  await expect(page.getByText('青岛求职者', { exact: true })).toBeVisible()
  await expect(page.getByText('未填写联系邮箱，招聘方可能无法联系你')).toBeVisible()
  await expect(page.getByTestId('resume-generate-preview-cta-refill')).toHaveText('回去改资料')
  await expect(page.getByTestId('resume-generate-preview-cta-export')).toHaveText('内容没问题，去导出')
  await page.screenshot({ path: test.info().outputPath('generate-preview-ready-1080x1920.png') })

  const exportRequest = page.waitForRequest((request) => (
    request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/resume/generate/export'
  ))
  await page.getByTestId('resume-generate-preview-cta-export').click()
  for (const box of await page.getByRole('checkbox').all()) {
    await box.check()
  }
  await page.getByRole('button', { name: '确认导出' }).click()
  const posted = await exportRequest
  const payload = posted.postDataJSON() as { taskId?: string; format?: string; basic?: { name?: string }; factsConfirmedAt?: string }
  expect(payload.taskId).toBe(GENERATE_TASK_ID)
  expect(payload.format).toBe('pdf')
  expect(payload.basic?.name).toBe('青岛求职者')
  expect(payload.factsConfirmedAt).toBeUndefined()
  await expect(page.getByRole('dialog', { name: 'AI简历_青岛求职者.pdf' })).toBeVisible()
})

test('生成预览读回失败展示空态而不是伪造结果 @kiosk', async ({ page, api }) => {
  registerGeneratePreviewBaseline(api)
  api.respond('GET', '/api/v1/resume/generate/missing-task', {
    status: 404,
    json: { error: { code: 'AI_TASK_NOT_FOUND', message: '任务不存在，请重新生成简历' } },
  })
  await page.goto('/resume/generate/preview?taskId=missing-task')
  await expect(page.getByText('没有可看的结果')).toBeVisible()
  await expect(page.getByText('青岛求职者')).toHaveCount(0)
  await expect(page.getByTestId('resume-generate-preview-cta-source')).toHaveText('返回简历服务')
  await expect(page.getByTestId('resume-generate-preview-cta-refill')).toHaveText('去填资料')
  await page.getByTestId('resume-generate-preview-cta-source').click()
  await expect(page).toHaveURL(/\/resume\/source$/)
  await expect(page.locator('[data-kiosk-screen="resume-source"]')).toBeVisible()
})
