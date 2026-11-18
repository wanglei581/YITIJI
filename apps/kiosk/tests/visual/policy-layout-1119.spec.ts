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

test('搜索结果卡之间是 16，政策列表卡之间仍是 18 @kiosk', async ({ page, api }) => {
  registerW4Api(api)
  await routePolicies(page, [1, 2, 3, 4].map(searchHit))
  await page.goto('/policy-service')
  await page.getByTestId('policy-search-input').click()
  await page.getByTestId('policy-search-input').fill('专搜')
  await page.getByTestId('policy-search-go').click()
  await expect(page.getByRole('heading', { level: 1, name: '找到 4 条含「专搜」的政策' })).toBeVisible()
  const searchGaps = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.policy-search-list .policy-min-card')].map((el) => el.getBoundingClientRect())
    return rows.slice(1).map((box, index) => Math.round(box.top - rows[index]!.bottom))
  })
  expect(searchGaps).toEqual([16, 16, 16])
  await page.goto('/renshi?audience=startup')
  const list = page.locator('.policy-min-list:not(.policy-search-list) .policy-min-card')
  await expect(list).toHaveCount(4)
  const listGaps = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.policy-min-list:not(.policy-search-list) .policy-min-card')].map((el) => el.getBoundingClientRect())
    return rows.slice(1).map((box, index) => Math.round(box.top - rows[index]!.bottom))
  })
  expect(listGaps).toEqual([18, 18, 18])
})

test('有原文摘录时详情收紧，去哪办压到一枚域名小签，两张卡在底栏之上 @kiosk', async ({ page, api }) => {
  registerW4Api(api)
  const verified = {
    ...BASE,
    id: 'policy-verified',
    externalUrl: 'https://hrss.example.gov.cn/policy',
    externalUrlVerified: true,
    content: LONG,
  }
  const bare = { ...verified, id: 'policy-bare', title: '没有正文的补贴', content: '  ' }
  await routePolicies(page, [verified, bare])
  await page.goto('/renshi?policy=policy-verified')
  await expect(page.getByRole('heading', { level: 1, name: '高校毕业生创业补贴' })).toBeVisible()
  const body = page.locator('.policy-detail-excerpt')
  await expect(body).toHaveCSS('row-gap', '14px')
  const section = body.locator('.policy-min-section').first()
  await expect(section).toHaveCSS('padding-top', '24px')
  await expect(section).toHaveCSS('padding-right', '32px')
  await expect(section).toHaveCSS('padding-bottom', '24px')
  await expect(section).toHaveCSS('padding-left', '32px')
  await expect(section.locator('li').first()).toHaveCSS('line-height', '40.5px')
  const source = page.locator('.policy-min-source')
  const sourceBox = await source.boundingBox()
  expect(sourceBox).toBeTruthy()
  expect(sourceBox!.height).toBeGreaterThanOrEqual(240)
  expect(sourceBox!.height).toBeLessThanOrEqual(330)
  const qr = page.locator('.policy-min-qr')
  await expect(qr.locator('.policy-info-chip')).toHaveText('hrss.example.gov.cn')
  await expect(qr.locator('svg')).toHaveCount(1)
  await expect(page.getByText('扫码打开原文')).toHaveCount(0)
  const tiles = page.locator('.policy-min-actions .qxt-tile')
  await expect(tiles).toHaveCount(2)
  await expect(tiles.first()).toHaveCSS('min-height', '116px')
  await expect(tiles.first()).toHaveCSS('padding-top', '14px')
  await expect(tiles.nth(1)).toHaveCSS('min-height', '116px')
  const fit = await page.evaluate(() => {
    const dock = document.querySelector('.qxt-dock')!.getBoundingClientRect()
    const cards = [...document.querySelectorAll('.policy-min-actions .qxt-tile')].map((el) => el.getBoundingClientRect())
    return { dockTop: dock.top, bottoms: cards.map((card) => card.bottom) }
  })
  expect(Math.max(...fit.bottoms)).toBeLessThanOrEqual(fit.dockTop)
  await page.goto('/renshi?policy=policy-bare')
  await expect(page.getByRole('heading', { level: 1, name: '没有正文的补贴' })).toBeVisible()
  await expect(page.locator('.policy-detail-excerpt')).toHaveCount(0)
  await expect(page.locator('.policy-min-actions .qxt-tile').first()).toHaveCSS('min-height', '132px')
  await expect(page.locator('.policy-min-qr .policy-info-chip')).toHaveText('hrss.example.gov.cn')
  await page.goto('/renshi?policy=policy-startup')
  await expect(page.getByRole('heading', { level: 1, name: '高校毕业生创业补贴' })).toBeVisible()
  await expect(page.getByText('链接发布时已核对属于发布机构登记的官方网站')).toHaveCount(0)
})

test('原文摘录标题下留 10，正文不再被段落外边距撑高，两张卡离底栏至少 20 @kiosk', async ({ page, api }) => {
  registerW4Api(api)
  const dense = {
    ...BASE,
    id: 'policy-dense',
    externalUrl: 'https://hrss.example.gov.cn/policy',
    externalUrlVerified: true,
    whoCanApply: '毕业学年内的普通高校毕业生\n属于城乡低保家庭、脱贫家庭、残疾或获得国家助学贷款等情形之一\n完整条件以发布机构原文为准',
    requiredMaterials: '本人身份证\n学生证或学籍证明\n对应困难类型的证明材料\n本人银行卡',
    whereToApply: '学校就业指导中心统一申报（学生活动中心二楼）\n补贴标准和申报时间以原文为准',
    content: LONG,
  }
  await routePolicies(page, [dense])
  await page.goto('/renshi?policy=policy-dense')
  await expect(page.getByTestId('policy-excerpt')).toBeVisible()
  const box = await page.evaluate(() => {
    const head = document.querySelector('[data-testid="policy-excerpt"] .policy-excerpt-head')!
    const text = document.querySelector('[data-testid="policy-excerpt"] .policy-excerpt')!
    const tiles = [...document.querySelectorAll('.policy-min-actions .qxt-tile')].map((el) => el.getBoundingClientRect().bottom)
    const dock = document.querySelector('.qxt-dock')!.getBoundingClientRect().top
    return {
      gap: text.getBoundingClientRect().top - head.getBoundingClientRect().bottom,
      bottoms: tiles,
      dock,
    }
  })
  const bottom = Math.max(...box.bottoms)
  expect(box.gap).toBeGreaterThanOrEqual(9)
  expect(box.gap).toBeLessThanOrEqual(11)
  // 正文区底边落在 1654.95。按整数不超过 1655，并离底栏至少 20。
  expect(bottom).toBeLessThanOrEqual(1655)
  expect(box.dock - bottom).toBeGreaterThanOrEqual(20)
})
