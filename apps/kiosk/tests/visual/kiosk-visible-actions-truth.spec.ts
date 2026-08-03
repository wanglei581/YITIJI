import { expect, test } from '../fixtures/kiosk-test'
import { registerW4Api } from '../fixtures/fusion-w4-api'

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

test('导出直达保持无真实产物守门 @kiosk', async ({ page, api }) => {
  registerW4Api(api)
  await page.goto('/resume/export')
  await expect(page.getByRole('button', { name: '保存到我的简历' })).toBeDisabled()
  await expect(page.getByRole('button', { name: '打印', exact: true })).toBeDisabled()

  const shellBox = await page.locator('.resume-lightflow__shell').boundingBox()
  expect(shellBox?.width ?? 0).toBeGreaterThanOrEqual(900)
  const buttonHeights = await page.locator('button:visible').evaluateAll((buttons) => (
    buttons.map((button) => button.getBoundingClientRect().height)
  ))
  expect(Math.min(...buttonHeights)).toBeGreaterThanOrEqual(48)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)

  await page.getByRole('button', { name: /返回真实简历流程/ }).click()
  await expect(page).toHaveURL(/\/resume\/source$/)
})
