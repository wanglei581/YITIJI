// 政策页照稿第三轮：搜索结果行的尺寸，以及详情两张卡是否回到首屏。量的是算出来的样式和位置。
import type { Page, Route } from '@playwright/test'
import { expect, test } from '../fixtures/kiosk-test'
import { registerW4Api } from '../fixtures/fusion-w4-api'

const LONG = Array.from({ length: 8 }, (_, index) => `第${index + 1}行正文，用来把详情撑开。`).join('\n')

const BASE = {
  id: 'policy-startup', kind: 'policy_guide', title: '高校毕业生创业补贴',
  summary: '毕业年度内可申请一次性创业补贴。', audience: 'startup', content: LONG,
  whoCanApply: '毕业年度内高校毕业生', requiredMaterials: '身份证\n营业执照',
  whereToApply: '户籍地公共就业服务机构\n工作日现场办理\n材料交齐当场受理',
  sourceName: '示例人社局', syncTime: '2026-09-20T00:00:00.000Z', publishedDate: '2026-09-01',
  validThrough: '2026-12-31', externalUrl: 'https://hrss.example.gov.cn/startup', externalUrlVerified: false,
}

function searchHit(index: number): typeof BASE {
  return {
    ...BASE,
    id: `policy-search-${index}`,
    title: `专搜补贴 ${index}`,
    summary: '一句摘要，用来撑开结果行。',
    audience: 'startup',
    content: '短正文。',
    requiredMaterials: '',
  }
}

async function routePolicies(page: Page, extra: Array<typeof BASE>): Promise<void> {
  const fulfill = (route: Route, status: number, json: unknown) => route.fulfill({
    status, contentType: 'application/json', body: JSON.stringify(json),
  })
  await page.route((url) => url.pathname === '/api/v1/policies' || /^\/api\/v1\/policies\/[^/]+$/.test(url.pathname), async (route) => {
    const url = new URL(route.request().url())
    const detail = url.pathname.match(/^\/api\/v1\/policies\/([^/]+)$/)
    const feed = [BASE, ...extra]
    if (detail) {
      const found = feed.find((item) => item.id === decodeURIComponent(detail[1] ?? ''))
      await fulfill(route, found ? 200 : 404, found ? { success: true, data: found } : { error: { code: 'POLICY_NOT_FOUND' } })
      return
    }
    const kind = url.searchParams.get('kind')
    const audience = url.searchParams.get('audience')
    const keyword = url.searchParams.get('keyword')?.trim() ?? ''
    const pageNo = Math.max(1, Number(url.searchParams.get('page')) || 1)
    const pageSize = Math.max(1, Number(url.searchParams.get('pageSize')) || 200)
    let items = kind === 'policy_guide' ? feed : []
    if (audience) items = items.filter((item) => item.audience === audience)
    if (keyword) items = items.filter((item) => item.title.includes(keyword) || (item.summary ?? '').includes(keyword))
    await fulfill(route, 200, {
      success: true,
      data: items.slice((pageNo - 1) * pageSize, pageNo * pageSize),
      pagination: { page: pageNo, pageSize, total: items.length, totalPages: Math.max(1, Math.ceil(items.length / pageSize)) },
    })
  })
}

test('搜索结果行最低 220、内边距 26/34、间距 10，四条和页脚都在底栏之上 @kiosk', async ({ page, api }) => {
  registerW4Api(api)
  await routePolicies(page, [1, 2, 3, 4].map(searchHit))
  await page.goto('/policy-service')
  await page.getByTestId('policy-search-input').click()
  await page.getByTestId('policy-search-input').fill('专搜')
  await page.getByTestId('policy-search-go').click()
  await expect(page.getByRole('heading', { level: 1, name: '找到 4 条含「专搜」的政策' })).toBeVisible()
  const cards = page.locator('.policy-search-list .policy-min-card')
  await expect(cards).toHaveCount(4)
  await expect(cards.first()).toHaveCSS('min-height', '220px')
  await expect(cards.first()).toHaveCSS('padding-top', '26px')
  await expect(cards.first()).toHaveCSS('padding-bottom', '26px')
  await expect(cards.first()).toHaveCSS('padding-left', '34px')
  await expect(cards.first()).toHaveCSS('padding-right', '34px')
  await expect(cards.first()).toHaveCSS('row-gap', '10px')
  const fit = await page.evaluate(() => {
    const dock = document.querySelector('.qxt-dock')!.getBoundingClientRect()
    const rows = [...document.querySelectorAll('.policy-search-list .policy-min-card')].map((el) => el.getBoundingClientRect())
    const foot = [...document.querySelectorAll('.policy-min-body .policy-min-fine')].at(-1)!.getBoundingClientRect()
    return { dockTop: dock.top, fourthBottom: rows[3]!.bottom, footBottom: foot.bottom }
  })
  expect(fit.fourthBottom).toBeLessThanOrEqual(fit.dockTop)
  expect(fit.footBottom).toBeLessThanOrEqual(fit.dockTop)
  await page.goto('/renshi?audience=startup')
  await expect(page.locator('.policy-min-list:not(.policy-search-list) .policy-min-card').first()).toHaveCSS('min-height', '252px')
})
