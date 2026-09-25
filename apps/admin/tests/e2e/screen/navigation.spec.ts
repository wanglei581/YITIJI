import { test, expect } from '@playwright/test'
import { clickDistrict, open, serveHappy } from './helpers'

/**
 * 页签地址、展示档、轻量模式、区名牌、少于 5、展示档告警行。
 * 这些是数字孪生改版后新增的产品要求。
 */

const TABS = [
  { label: '政务总览', path: '/screen/gov', title: '职易达 · 就业服务终端运行态势' },
  { label: '服务调用', path: '/screen/usage', title: '职易达 · 系统使用与服务调用态势' },
  { label: '运营看板', path: '/screen/ops', title: '终端运营看板' },
  { label: '终端孪生', path: '/screen/terminal', title: '终端数字孪生' },
] as const

test.describe('admin screen navigation', () => {
  test.beforeEach(async ({ page }) => {
    await serveHappy(page)
  })

  test('每个页签有独立地址，点击后地址与标题一起变', async ({ page }) => {
    await open(page, '/screen/gov')
    for (const tab of TABS) {
      await page.getByRole('link', { name: tab.label }).click()
      await expect(page).toHaveURL(new RegExp(`${tab.path}$`))
      await expect(page.getByRole('heading', { name: tab.title })).toBeVisible()
    }
  })

  test('旧地址 profile=ops 改写成 /screen/ops', async ({ page }) => {
    await open(page, '/screen?profile=ops')
    await expect(page).toHaveURL(/\/screen\/ops$/)
    await expect(page.getByRole('heading', { name: '终端运营看板' })).toBeVisible()
    await expect(page).not.toHaveURL(/profile=/)
  })

  test('展示档没有筛选栏；退出展示回到桌面档且地址去掉 display', async ({ page }) => {
    await open(page, '/screen/gov?display=1')
    await expect(page.locator('.twin-toolbar')).toHaveCount(0)
    await expect(page.locator('h1')).toHaveCount(1)
    await expect(page.locator('.twin-hd h1')).toHaveText('职易达 · 就业服务终端运行态势')
    await page.getByRole('button', { name: '退出展示' }).click()
    await expect(page).toHaveURL(/\/screen\/gov$/)
    await expect(page.locator('h1')).toHaveText('数据大屏')
    await expect(page.locator('.twin-hd h2')).toBeVisible()
    await expect(page.locator('.twin-toolbar')).toBeVisible()
  })

  test('轻量模式渲染格子墙，不渲染 3D 场景', async ({ page }) => {
    await open(page, '/screen/gov?lite=1')
    await expect(page.locator('.ops-fleet')).toBeVisible()
    await expect(page.locator('.tw3-scene')).toHaveCount(0)
    await page.getByRole('button', { name: '轻量模式' }).click()
    await expect(page).not.toHaveURL(/lite=/)
    await expect(page.locator('.tw3-scene')).toBeVisible()
  })

  test('区名牌是按钮，点击写入 area，再点退出聚焦', async ({ page }) => {
    await open(page, '/screen/gov')
    const area = await clickDistrict(page, '海珠区')
    await expect.poll(() => new URL(page.url()).searchParams.get('area')).toBe(area)
    await expect(page.getByRole('heading', { name: `${area}终端`, exact: true })).toBeVisible()
    await clickDistrict(page, area, true)
    await expect(page).not.toHaveURL(/[?&]area=/)
    await expect(page.getByRole('heading', { name: '终端与服务' })).toBeVisible()
  })

  test('夹具里的 null 计数显示「少于 5」，同一格不出现 0', async ({ page }) => {
    await open(page, '/screen/usage')
    const row = page.locator('.twin-bar-row', { hasText: '合同审查' })
    await expect(row.locator('b')).toHaveText('少于 5')
    await expect(row.locator('b')).not.toContainText('0')
  })

  test('展示档点告警行进入终端孪生，地址仍带 display=1', async ({ page }) => {
    await open(page, '/screen/gov?display=1')
    const row = page.locator('.twin-panel').filter({ hasText: '实时告警' }).locator('.twin-alert').filter({ hasText: 'GZ-HZ-007' })
    await expect(row).toBeVisible()
    await row.click()
    await expect(page).toHaveURL(/\/screen\/terminal/)
    await expect(page).toHaveURL(/display=1/)
    await expect(page).toHaveURL(/id=t-gz-hz-007/)
    await expect(page).not.toHaveURL(/\/alerts/)
    await expect(page.getByRole('heading', { name: '终端数字孪生' })).toBeVisible()
  })

  test('服务调用的非法 range 被纠正后才发出', async ({ page }) => {
    const log = { urls: [] as string[] }
    page.on('request', (request) => {
      const url = new URL(request.url())
      if (url.pathname.includes('/admin/screen/')) log.urls.push(url.pathname + url.search)
    })
    await open(page, '/screen/usage?range=bogus')
    await expect(page.getByRole('heading', { name: '职易达 · 系统使用与服务调用态势' })).toBeVisible()
    const usage = log.urls.filter((url) => url.includes('/usage'))
    expect(usage.length).toBeGreaterThan(0)
    expect(usage.every((url) => url.endsWith('/admin/screen/usage?range=today'))).toBe(true)
  })
})
