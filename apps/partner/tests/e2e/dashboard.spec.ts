import { test, expect } from '@playwright/test'
import { collectPageFaults, gotoPartner, injectPartnerAuth, waitForMockList, assertPageHonest } from './helpers'

test.describe('工作台（mock 口径）', () => {
  test.beforeEach(async ({ page }) => {
    await injectPartnerAuth(page)
  })

  test('今天要处理、招聘内容概况与报障入口可点', async ({ page }) => {
    const { errors } = collectPageFaults(page)
    await gotoPartner(page, '/', '工作台')
    await waitForMockList(page)

    await expect(page.getByRole('region', { name: '今天要处理' })).toBeVisible()
    await expect(page.getByText('待确认交付')).toHaveCount(0)
    await expect(page.getByText('暂不能按本机构终端统计')).toBeVisible()
    await expect(page.getByText('样本不足')).toBeVisible()
    await expect(page.getByText('2 条政策等你审核')).toBeVisible()
    await expect(page.getByRole('region', { name: '平台处置通知' })).toBeVisible()

    const overview = page.getByRole('region', { name: '招聘内容概况' })
    await expect(overview.getByText('已上传岗位', { exact: true })).toBeVisible()
    await expect(overview.getByText('待审核数据', { exact: true })).toBeVisible()
    await expect(overview.getByText('含审核中与企业资料，与统计页相同')).toBeVisible()
    await expect(overview.getByText('市人才网 API（演示）')).toBeVisible()
    await expect(page.getByRole('heading', { name: '最近同步记录' })).toBeVisible()

    await page.getByRole('link', { name: '去审核' }).click()
    await page.waitForURL(/\/policy/)
    await expect(page.getByRole('heading', { level: 1, name: '政策公告' })).toBeVisible()

    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await waitForMockList(page)
    await page.getByRole('region', { name: '最近同步记录' }).getByRole('button', { name: '查看全部' }).click()
    await page.waitForURL(/\/sync-logs/)
    await expect(page.getByRole('heading', { level: 1, name: '同步日志' })).toBeVisible()

    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await waitForMockList(page)
    await page.getByRole('region', { name: '招聘内容概况' }).locator('p').filter({ hasText: /^数据源$/ }).click()
    await page.waitForURL(/\/sources/)
    await expect(page.getByRole('heading', { level: 1, name: '数据源管理' })).toBeVisible()

    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await waitForMockList(page)
    await page.getByRole('link', { name: '报障', exact: true }).click()
    await page.waitForURL(/\/terminals\?tab=delivery&section=incidents/)
    await expect(page.getByText('项目交付与服务需要连接真实后端')).toBeVisible()
    await assertPageHonest(page, errors)
  })

  test('1280 宽度下同步表在自己的容器滚动', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await gotoPartner(page, '/', '工作台')
    await waitForMockList(page)
    await expect(page.getByRole('region', { name: '今天要处理' })).toBeVisible()
    const section = page.getByRole('region', { name: '最近同步记录' })
    await expect(section.getByText('市人才网 API（演示）')).toBeVisible()
    const table = section.locator('table')
    await expect(table.locator('thead th', { hasText: /^数据源$/ })).toBeVisible()
    const scroller = table.locator('..')
    await expect(scroller).toHaveCSS('overflow-x', 'auto')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })

  test('退出登录回到登录页', async ({ page }) => {
    const logoutCalls: string[] = []
    page.on('request', (request) => {
      if (request.url().includes('/auth/logout')) logoutCalls.push(request.url())
    })
    await gotoPartner(page, '/', '工作台')
    await page.getByRole('button', { name: '退出登录' }).click()
    await page.waitForURL(/\/login/)
    await expect(page.getByRole('heading', { name: '合作机构登录' })).toBeVisible({ timeout: 15_000 })
    expect(logoutCalls).toEqual([])
  })
})
