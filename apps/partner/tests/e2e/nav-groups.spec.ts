import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect, type Page } from '@playwright/test'
import { gotoPartner, injectPartnerAuth, waitForMockList } from './helpers'

const BASE_NAV = ['工作台', '机构与账号', '政策公告管理', '终端数据', '数据统计', '数据大屏']

async function loginWith(page: Page, storage: Record<string, string> = {}): Promise<void> {
  await injectPartnerAuth(page)
  if (Object.keys(storage).length === 0) return
  await page.evaluate((entries) => {
    for (const [key, value] of Object.entries(entries)) window.localStorage.setItem(key, value)
  }, storage)
}

function sideNav(page: Page) {
  return page.getByRole('navigation', { name: '侧边导航' })
}

async function navLabels(page: Page): Promise<string[]> {
  const nav = sideNav(page)
  await expect(nav.getByRole('link', { name: '工作台', exact: true })).toBeVisible()
  return nav.getByRole('link').allTextContents()
}

test.describe('侧栏分组与页内标签', () => {
  test('托管关闭且非学校时侧栏恰好 6 项且顺序一致', async ({ page }) => {
    await loginWith(page, { 'mock:recruitment-hosting': 'off' })
    await gotoPartner(page, '/', '工作台')
    await waitForMockList(page)
    const nav = sideNav(page)
    await expect(nav.getByRole('link', { name: '智慧校园', exact: true })).toHaveCount(0)
    await expect(nav.getByRole('link', { name: '招聘内容', exact: true })).toHaveCount(0)
    expect(await navLabels(page)).toEqual(BASE_NAV)
    await expect(nav.getByText('本机构', { exact: true })).toBeVisible()
    await expect(nav.getByText('内容管理', { exact: true })).toBeVisible()
    await expect(nav.getByText('终端与数据', { exact: true })).toBeVisible()
  })

  test('学校机构多出智慧校园，仍排在政策公告后面', async ({ page }) => {
    await loginWith(page, { 'mock:recruitment-hosting': 'off', 'mock:can-manage-smart-campus': 'on' })
    await gotoPartner(page, '/', '工作台')
    await waitForMockList(page)
    expect(await navLabels(page)).toEqual([
      '工作台', '机构与账号', '政策公告管理', '智慧校园', '终端数据', '数据统计', '数据大屏',
    ])
  })

  test('托管打开时多出招聘内容，数据源和同步日志不单独占侧栏', async ({ page }) => {
    await loginWith(page, { 'mock:recruitment-hosting': 'on' })
    await gotoPartner(page, '/', '工作台')
    await waitForMockList(page)
    const nav = sideNav(page)
    await expect(nav.getByRole('link', { name: '智慧校园', exact: true })).toHaveCount(0)
    expect(await navLabels(page)).toEqual([
      '工作台', '机构与账号', '政策公告管理', '招聘内容', '终端数据', '数据统计', '数据大屏',
    ])
    await expect(nav.getByRole('link', { name: '数据源管理', exact: true })).toHaveCount(0)
    await expect(nav.getByRole('link', { name: '同步日志', exact: true })).toHaveCount(0)
  })

  test('机构资料与账号共用标签，侧栏高亮机构与账号', async ({ page }) => {
    await loginWith(page)
    for (const [path, title, current] of [
      ['/profile', '机构资料', '机构资料'],
      ['/account', '账号', '账号'],
    ] as const) {
      await gotoPartner(page, path, title)
      const tabs = page.getByRole('navigation', { name: '机构与账号' })
      await expect(tabs.getByRole('link', { name: '机构资料', exact: true })).toBeVisible()
      await expect(tabs.getByRole('link', { name: '账号', exact: true })).toBeVisible()
      await expect(tabs.getByRole('link', { name: current, exact: true })).toHaveAttribute('aria-current', 'page')
      await expect(sideNav(page).getByRole('link', { name: '机构与账号', exact: true })).toHaveAttribute('aria-current', 'page')
    }
    await page.getByRole('navigation', { name: '机构与账号' }).getByRole('link', { name: '机构资料', exact: true }).click()
    await expect(page).toHaveURL(/\/profile$/)
    await expect(page.getByRole('heading', { level: 1, name: '机构资料' })).toBeVisible()
  })

  test('终端数据两个标签可切换，地址参数直达项目与服务', async ({ page }) => {
    await loginWith(page)
    await gotoPartner(page, '/terminals?period=month', '终端数据')
    const tabs = page.getByRole('tablist', { name: '终端数据分页' })
    await expect(tabs.getByRole('tab', { name: '终端运营', exact: true })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('button', { name: /导出 CSV/ })).toBeVisible()
    await tabs.getByRole('tab', { name: '项目与服务', exact: true }).click()
    await expect(page).toHaveURL(/period=month/)
    await expect(page).toHaveURL(/tab=delivery/)
    await expect(page.getByTestId('first-order-panel')).toBeVisible()
    await expect(page.getByRole('heading', { name: '项目交付与服务' })).toBeVisible()
    await expect(page.getByText('项目交付与服务需要连接真实后端')).toBeVisible()
    await expect(page.getByRole('button', { name: /导出 CSV/ })).toHaveCount(0)
    await tabs.getByRole('tab', { name: '终端运营', exact: true }).click()
    await expect(page).toHaveURL(/period=month/)
    await expect(page).not.toHaveURL(/tab=delivery/)
    await expect(page.getByRole('button', { name: /导出 CSV/ })).toBeVisible()

    await gotoPartner(page, '/terminals?tab=delivery', '终端数据')
    await expect(tabs.getByRole('tab', { name: '项目与服务', exact: true })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByTestId('first-order-panel')).toBeVisible()
  })

  test('能力读取失败时招聘内容标签条不出现', async ({ page }) => {
    await loginWith(page, { 'mock:recruitment-hosting': 'unavailable' })
    await gotoPartner(page, '/jobs', '岗位信息管理')
    await expect(page.getByRole('navigation', { name: '招聘内容' })).toHaveCount(0)
    await expect(sideNav(page).getByRole('link', { name: '招聘内容', exact: true })).toHaveCount(0)
  })

  test('390 宽没有页面级横向滚动', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await loginWith(page, { 'mock:recruitment-hosting': 'on' })
    await gotoPartner(page, '/profile', '机构资料')
    await expect(page.getByRole('navigation', { name: '机构与账号' })).toBeVisible()
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true)
    await gotoPartner(page, '/jobs', '岗位信息管理')
    await expect(page.getByRole('navigation', { name: '招聘内容' })).toBeVisible()
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true)
  })
})

test('退出登录在真实连接下会先通知后台，失败也不拦住本地退出', () => {
  const auth = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../src/services/auth/index.ts'), 'utf8')
  const logout = auth.slice(auth.indexOf('export function logout'), auth.indexOf('export async function changePassword'))
  expect(logout).toContain("API_MODE === 'http'")
  expect(logout).toContain("method: 'POST'")
  expect(logout).toContain('/auth/logout')
  expect(logout.indexOf('/auth/logout')).toBeLessThan(logout.indexOf('clearAuth()'))
  expect(logout).toContain('.catch(() => undefined)')
})
