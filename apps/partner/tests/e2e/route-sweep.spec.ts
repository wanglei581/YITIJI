import { test, expect } from '@playwright/test'
import {
  assertPageHonest,
  collectPageFaults,
  gotoPartner,
  injectPartnerAuth,
  waitForMockList,
} from './helpers'

/**
 * 从 `apps/partner/src/routes/index.tsx` 读出的已登录路由。
 * `/screen` 单独断言：旧地址改写到 `/screen/overview`，mock 不展示数值、不发大屏请求。
 * 每条：不是白屏、有 h1/页头、无 console error、无未捕获 rejection、无英文技术串。
 */
const AUTHED_ROUTES: Array<{ path: string; title: string | RegExp }> = [
  { path: '/', title: '工作台' },
  { path: '/profile', title: '机构资料' },
  { path: '/jobs', title: '岗位信息管理' },
  { path: '/companies', title: '企业资料管理' },
  { path: '/fairs', title: '招聘会信息管理' },
  { path: '/smart-campus', title: '智慧校园' },
  { path: '/policy', title: '政策公告' },
  { path: '/terminals', title: '终端数据' },
  { path: '/stats', title: '数据统计' },
  { path: '/sources', title: '数据源管理' },
  { path: '/sync-logs', title: '同步日志' },
  // #804（包 8）把这页从「账号权限」改名为「账号」——改密是自助的，权限不是。
  { path: '/account', title: '账号' },
]

test.describe('partner route sweep (mock)', () => {
  test('未登录访问 /login 渲染机构登录页，无白屏无技术串', async ({ page }) => {
    const { errors } = collectPageFaults(page)
    await page.goto('/login', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: '合作机构登录' })).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('#root')).not.toBeEmpty()
    await assertPageHonest(page, errors)
  })

  test('已登录访问 /screen 改写到机构总览，演示模式不发大屏请求', async ({ page }) => {
    const { errors } = collectPageFaults(page)
    const screenRequests: string[] = []
    page.on('request', (request) => {
      if (request.url().includes('/partner/screen')) screenRequests.push(request.url())
    })
    await injectPartnerAuth(page)
    await gotoPartner(page, '/screen', '数据大屏')
    await waitForMockList(page)
    await expect(page).toHaveURL(/\/screen\/overview$/)
    await expect(page.locator('h1')).toHaveCount(1)
    await expect(page.locator('h1')).toHaveText('数据大屏')
    await expect(page.getByText('演示模式不展示大屏数值')).toBeVisible()
    expect(screenRequests).toEqual([])
    await assertPageHonest(page, errors)
  })

  // 演示包里大屏一个请求都不发、一个数都不画：三个页签、桌面档与展示档都一样
  for (const [path, title] of [
    ['/screen/usage', '本机构信息使用态势'],
    ['/screen/terminal', '终端数字孪生'],
    ['/screen/overview?display=1', '本机构运营概览'],
    ['/screen/usage?display=1', '本机构信息使用态势'],
    ['/screen/terminal?display=1', '终端数字孪生'],
  ] as const) {
    test(`演示模式 ${path}：说明不展示数值，不发大屏请求`, async ({ page }) => {
      const { errors } = collectPageFaults(page)
      const screenRequests: string[] = []
      page.on('request', (request) => {
        if (request.url().includes('/partner/screen')) screenRequests.push(request.url())
      })
      await injectPartnerAuth(page)
      const display = path.includes('display=1')
      if (display) {
        await page.goto(path, { waitUntil: 'domcontentloaded' })
        await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible({ timeout: 15_000 })
      } else {
        await gotoPartner(page, path, '数据大屏')
        await expect(page.getByRole('heading', { level: 2, name: title })).toBeVisible()
      }
      await expect(page.locator('h1')).toHaveCount(1)
      await expect(page.getByText('演示模式不展示大屏数值')).toBeVisible()
      await expect(page.locator('[data-ops-screen]')).not.toContainText(/\d+\s*(条|台|次|场|家)/)
      expect(screenRequests).toEqual([])
      await assertPageHonest(page, errors)
    })
  }

  for (const route of AUTHED_ROUTES) {
    test(`已登录访问 ${route.path} 有页头且无运行时错误`, async ({ page }) => {
      const { errors } = collectPageFaults(page)
      await injectPartnerAuth(page)
      await gotoPartner(page, route.path, route.title)
      await waitForMockList(page)
      await expect(page.locator('h1')).toBeVisible()
      await assertPageHonest(page, errors)
    })
  }
})
