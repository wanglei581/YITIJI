// 政策搜索（2026-11-17）：点框搜索、原文翻页、没结果三条出路、没连上再搜、超过 30 字不发请求、没绑机构空态。
import type { Page, Route } from '@playwright/test'
import { expect, test } from '../fixtures/kiosk-test'
import { registerW4Api } from '../fixtures/fusion-w4-api'

const LONG = [
  ...Array.from({ length: 22 }, (_, index) => `第${index + 1}行正文，占满阅读层的这一页。`),
  '第二页这一句只在翻页后出现，网址 https://hrss.example.gov.cn/policy 只当文字。',
].join('\n')

const HIT = {
  id: 'policy-startup', kind: 'policy_guide', title: '高校毕业生创业补贴',
  summary: '毕业年度内可申请一次性创业补贴。', audience: 'startup', content: LONG,
  whoCanApply: '毕业年度内高校毕业生', requiredMaterials: '身份证\n营业执照',
  whereToApply: '户籍地公共就业服务机构', sourceName: '示例人社局',
  syncTime: '2026-09-20T00:00:00.000Z', publishedDate: '2026-09-01', validThrough: '2026-12-31',
  externalUrl: 'https://hrss.example.gov.cn/startup', externalUrlVerified: false,
}
const JIANXI = {
  ...HIT, id: 'policy-jianxi', title: '就业见习补贴', summary: '见习基地可申请补贴。',
  audience: 'general', content: '见习补贴正文很短。', validThrough: '2026-12-15',
}
const NOTICE = {
  id: 'notice-1', kind: 'notice', title: '窗口时间调整通知', summary: '公告不参与搜索。',
  category: 'notice', sourceName: '示例人社局', syncTime: '2026-09-20T00:00:00.000Z', publishedDate: '2026-09-02',
}
const GUIDES = [HIT, JIANXI]
const LIST_PATH = '/api/v1/policies'
const DETAIL_PATH = /^\/api\/v1\/policies\/([^/]+)$/

function isPolicyRequest(url: URL): boolean {
  return url.pathname === LIST_PATH || DETAIL_PATH.test(url.pathname)
}

interface RouteOptions {
  holdKeyword?: string
  failOnceKeyword?: string
  tooLongKeyword?: string
}

async function routePolicies(page: Page, options: RouteOptions = {}): Promise<{ release: () => void }> {
  let releaseHold = () => {}
  let hold: Promise<void> | null = options.holdKeyword
    ? new Promise((resolve) => { releaseHold = resolve })
    : null
  let failedOnce = false
  const fulfill = (route: Route, status: number, json: unknown) => route.fulfill({
    status, contentType: 'application/json', body: JSON.stringify(json),
  })
  await page.route(isPolicyRequest, async (route) => {
    const url = new URL(route.request().url())
    const detail = url.pathname.match(DETAIL_PATH)
    if (detail) {
      const id = decodeURIComponent(detail[1] ?? '')
      const found = GUIDES.find((item) => item.id === id) ?? (id === NOTICE.id ? NOTICE : undefined)
      if (!found) {
        await fulfill(route, 404, { error: { code: 'POLICY_NOT_FOUND' } })
        return
      }
      await fulfill(route, 200, { success: true, data: found })
      return
    }
    const keyword = url.searchParams.get('keyword')?.trim() ?? ''
    if (options.tooLongKeyword && keyword === options.tooLongKeyword) {
      await fulfill(route, 400, { error: { code: 'POLICY_KEYWORD_TOO_LONG', message: '关键词最长 30 字' } })
      return
    }
    if (options.failOnceKeyword && keyword === options.failOnceKeyword && !failedOnce) {
      failedOnce = true
      await route.abort('internetdisconnected')
      return
    }
    if (hold && keyword === options.holdKeyword) {
      const gate = hold
      hold = null
      await gate
    }
    const kind = url.searchParams.get('kind')
    const audience = url.searchParams.get('audience')
    const pageNo = Math.max(1, Number(url.searchParams.get('page')) || 1)
    const pageSize = Math.max(1, Number(url.searchParams.get('pageSize')) || 200)
    let feed = kind === 'notice' ? [NOTICE] : kind === 'policy_guide' ? GUIDES : []
    if (audience) feed = feed.filter((item) => item.audience === audience)
    if (keyword) feed = feed.filter((item) => item.title.includes(keyword) || (item.summary ?? '').includes(keyword))
    await fulfill(route, 200, {
      success: true,
      data: feed.slice((pageNo - 1) * pageSize, pageNo * pageSize),
      pagination: { page: pageNo, pageSize, total: feed.length, totalPages: Math.max(1, Math.ceil(feed.length / pageSize)) },
    })
  })
  return { release: () => releaseHold() }
}

function watchKeywords(page: Page): URL[] {
  const urls: URL[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (request.method() === 'GET' && url.pathname === LIST_PATH && url.searchParams.has('keyword')) urls.push(url)
  })
  return urls
}

async function openHome(page: Page): Promise<void> {
  await page.goto('/policy-service')
  await expect(page.getByTestId('policy-search-input')).toBeVisible()
}

test('点搜索框搜到政策，进详情展开原文翻页后收起并返回 @kiosk', async ({ page, api }) => {
  registerW4Api(api)
  const keywords = watchKeywords(page)
  const browse: string[] = []
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/activity/browse') {
      browse.push(request.postData() ?? '')
    }
  })
  const gate = await routePolicies(page, { holdKeyword: '创业' })
  await openHome(page)
  await expect(page.getByText('条数从发布数据读')).toHaveCount(0)
  await expect(page.getByText('政策由发布机构自行审核发布，以官方原文为准')).toBeVisible()
  await page.getByTestId('policy-search-input').click()
  await page.getByTestId('policy-search-input').fill('创业')
  await page.getByTestId('policy-search-go').click()
  await expect(page.getByRole('heading', { name: '正在按标题和摘要找' })).toBeVisible()
  await expect(page.getByRole('progressbar')).toHaveCount(0)
  gate.release()
  await expect(page.getByRole('heading', { level: 1, name: '找到 1 条含「创业」的政策' })).toBeVisible()
  await expect(page).toHaveURL(/\/renshi\?search=1$/)
  const startup = keywords.filter((url) => url.searchParams.get('keyword') === '创业')
  expect(startup.length).toBeGreaterThan(0)
  expect(startup.every((url) => url.searchParams.get('kind') === 'policy_guide' && url.searchParams.get('pageSize') === '4')).toBe(true)
  expect(page.url().includes('创业')).toBe(false)
  await expect(page.locator('mark.policy-kw', { hasText: '创业' }).first()).toBeVisible()
  await expect(page.getByText('示例人社局').first()).toBeVisible()
  await expect(page.getByText('更新于 2026-09-01').first()).toBeVisible()
  await expect(page.getByText('创业扶持').first()).toBeVisible()
  await expect(page.getByText('12 月 31 日截止').first()).toBeVisible()
  expect(browse).toEqual([])
  const stored = await page.evaluate(() => JSON.stringify(sessionStorage))
  expect(stored.includes('创业')).toBe(false)
  await page.getByRole('button', { name: /高校毕业生创业补贴/ }).click()
  await expect(page.getByRole('heading', { level: 1, name: '高校毕业生创业补贴' })).toBeVisible()
  await expect(page.getByText(/12 月 31 日截止/)).toBeVisible()
  await page.getByTestId('policy-excerpt-open').click()
  await expect(page.getByTestId('policy-excerpt-page')).toContainText('第1行正文')
  await expect(page.getByText('第 1 / 2 页')).toBeVisible()
  await page.getByRole('button', { name: '下一页', exact: true }).click()
  await expect(page.getByText('第 2 / 2 页')).toBeVisible()
  await expect(page.getByTestId('policy-excerpt-page')).toContainText('第二页这一句只在翻页后出现')
  await expect(page.getByTestId('policy-excerpt-page')).toContainText('https://hrss.example.gov.cn/policy')
  await expect(page.locator('a[href*="hrss.example.gov.cn"]')).toHaveCount(0)
  await page.getByTestId('policy-excerpt-close').click()
  await expect(page.getByTestId('policy-excerpt-page')).toHaveCount(0)
  await page.getByRole('button', { name: '返回政策首页', exact: true }).click()
  await expect(page).toHaveURL(/\/policy-service$/)
})

test('没找到时可以换个词、按类别看、看机构公告 @kiosk', async ({ page, api }) => {
  registerW4Api(api)
  await routePolicies(page)
  await openHome(page)
  await page.getByTestId('policy-search-input').click()
  await page.getByTestId('policy-search-input').fill('失业金')
  await page.getByTestId('policy-search-go').click()
  await expect(page.getByRole('heading', { level: 1, name: '没有找到含「失业金」的政策' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '可以这样再找' })).toBeVisible()
  await expect(page.getByRole('button', { name: /换个词再搜/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /按类别看全部政策/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /机构公告/ })).toBeVisible()
  // 点「换个词」会让输入框重新聚焦、字数行撑开，下面的按钮跟着上移，点击会落空。先走公告和类别。
  await page.getByRole('button', { name: /机构公告/ }).click()
  await expect(page).toHaveURL(/tab=notice/)
  await expect(page.getByText('窗口时间调整通知')).toBeVisible()
  await page.goto('/policy-service')
  await page.getByTestId('policy-search-input').click()
  await page.getByTestId('policy-search-input').fill('失业金')
  await page.getByTestId('policy-search-go').click()
  await page.getByRole('button', { name: /按类别看全部政策/ }).click()
  await expect(page).toHaveURL(/\/policy-service$/)
  await expect(page.getByTestId('policy-categories')).toBeVisible()
  await page.getByTestId('policy-search-input').click()
  await page.getByTestId('policy-search-input').fill('失业金')
  await page.getByTestId('policy-search-go').click()
  await page.getByRole('button', { name: /换个词再搜/ }).click()
  await expect(page.getByTestId('policy-search-input')).toBeFocused()
})

test('没连上时关键词还在，再搜一次能出结果 @kiosk', async ({ page, api }) => {
  registerW4Api(api)
  await routePolicies(page, { failOnceKeyword: '见习' })
  await openHome(page)
  await page.getByTestId('policy-search-input').click()
  await page.getByTestId('policy-search-input').fill('见习')
  await page.getByTestId('policy-search-go').click()
  await expect(page.getByRole('heading', { level: 1, name: '这次没读到搜索结果' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '这次没连上' })).toBeVisible()
  await expect(page.getByRole('heading', { name: /没有找到/ })).toHaveCount(0)
  await expect(page.getByTestId('policy-search-input')).toHaveValue('见习')
  await page.getByRole('button', { name: /再搜一次/ }).click()
  await expect(page.getByRole('heading', { level: 1, name: '找到 1 条含「见习」的政策' })).toBeVisible()
  await expect(page.getByText('就业见习补贴')).toBeVisible()
})

test('超过 30 个字时搜索停用，不发出搜索请求 @kiosk', async ({ page, api }) => {
  registerW4Api(api)
  const keywords = watchKeywords(page)
  await routePolicies(page)
  await openHome(page)
  const word = '补'.repeat(31)
  await page.getByTestId('policy-search-input').click()
  await page.getByTestId('policy-search-input').fill(word)
  await expect(page.getByText('最多 30 个字，现在 31 个字')).toBeVisible()
  await expect(page.getByText(/输入一个词就够/)).toBeVisible()
  await expect(page.getByTestId('policy-search-go')).toBeDisabled()
  await page.getByTestId('policy-search-input').press('Enter')
  await page.getByTestId('policy-search-go').click({ force: true })
  await page.waitForTimeout(400)
  expect(keywords).toEqual([])
  await expect(page).toHaveURL(/\/policy-service$/)
})

test('服务端回关键词超长时按超过 30 字显示，不当成没连上 @kiosk', async ({ page, api }) => {
  registerW4Api(api)
  await routePolicies(page, { tooLongKeyword: '补贴' })
  await openHome(page)
  await page.getByTestId('policy-search-input').click()
  await page.getByTestId('policy-search-input').fill('补贴')
  await page.getByTestId('policy-search-go').click()
  await expect(page.getByRole('heading', { level: 1, name: '这个词超过 30 个字' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '最多 30 个字，现在 2 个字' })).toBeVisible()
  await expect(page.getByText('这次没有按没连上处理，也没有发出搜索。')).toBeVisible()
  await expect(page.getByRole('heading', { name: '这次没连上' })).toHaveCount(0)
  await expect(page.getByText(/没有找到/)).toHaveCount(0)
})

test('没绑定机构且一条没有时写本机还没有运营机构发布的政策 @kiosk', async ({ page, api }) => {
  registerW4Api(api)
  api.respond('GET', '/api/v1/policies', {
    status: 200,
    json: { success: true, data: [], scope: 'unbound', pagination: { page: 1, pageSize: 200, total: 0, totalPages: 1 } },
  })
  await page.goto('/renshi')
  await expect(page).toHaveURL((url) => url.pathname === '/policy-service')
  await expect(page.getByRole('heading', { level: 1, name: '本机还没有运营机构发布的政策' })).toBeVisible()
  await expect(page.getByText('本机不自己编写政策，也不拿别处的内容顶替')).toBeVisible()
  await expect(page.getByText('政策由发布机构自行审核发布，以官方原文为准')).toBeVisible()
  await expect(page.getByTestId('policy-search-input')).toHaveCount(0)
  await expect(page.getByText('这里还没有发布的政策')).toHaveCount(0)
  await expect(page.getByText('工作人员')).toHaveCount(0)
})
