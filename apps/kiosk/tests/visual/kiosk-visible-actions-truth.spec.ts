import type { Page, Request } from '@playwright/test'
import { expect, test } from '../fixtures/kiosk-test'
import { registerW4Api } from '../fixtures/fusion-w4-api'

const COMPARE_TASK_ID = 'visible-compare'
const COMPARE_ACCESS_TOKEN = 'visible-compare-access'

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
  await page.getByRole('button', { name: '保留原文' }).click()
  await page.getByRole('button', { name: '下一条' }).click()
  await expect(page).toHaveURL(/\/resume\/optimize$/)
  const returnedState = await page.evaluate(() => window.history.state?.usr)
  expect(returnedState).toEqual({
    taskId: COMPARE_TASK_ID,
    accessToken: COMPARE_ACCESS_TOKEN,
    // 裁决键与优化页同源（resume-deliver/resumeDecisions.ts moduleKeyOf：`m<序号>:<标题>`）
    decisions: { 'm0:项目成果': 'optimized', 'm1:团队协作': 'original' },
  })
})

test('逐条对照手机断点无横向溢出且操作区换算合格 @mobile', async ({ page, api }) => {
  await openResumeCompare(page, api)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  const stage = page.locator('.kiosk-stage')
  const transform = await stage.evaluate((element) => getComputedStyle(element).transform)
  const scale = transform === 'none' ? 1 : Number(transform.match(/^matrix\(([^,]+)/)?.[1] ?? 1)
  for (const name of ['用改写', '保留原文', '下一条']) {
    const box = await page.getByRole('button', { name }).boundingBox()
    expect(box).not.toBeNull()
    expect(box!.height / scale).toBeGreaterThanOrEqual(56)
    expect(box!.width / scale).toBeGreaterThanOrEqual(48)
  }
})
