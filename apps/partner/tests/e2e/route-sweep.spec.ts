import { test, expect } from '@playwright/test'
import {
  assertPageHonest,
  collectPageFaults,
  gotoPartner,
  injectPartnerAuth,
  waitForMockList,
} from './helpers'

/**
 * 从 `apps/partner/src/routes/index.tsx` 读出的全部 13 条路由。
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
  { path: '/account', title: '账号权限' },
]

test.describe('partner route sweep (mock)', () => {
  test('未登录访问 /login 渲染机构登录页，无白屏无技术串', async ({ page }) => {
    const { errors } = collectPageFaults(page)
    await page.goto('/login', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: '合作机构登录' })).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('#root')).not.toBeEmpty()
    await assertPageHonest(page, errors)
  })

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
