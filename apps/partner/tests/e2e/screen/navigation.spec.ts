import { test, expect } from '@playwright/test'
import { clickPlace, open, serveHappy } from './helpers'

const TABS = [
  { label: '机构总览', path: '/screen/overview', title: '本机构运营概览' },
  { label: '信息使用', path: '/screen/usage', title: '本机构信息使用态势' },
  { label: '终端孪生', path: '/screen/terminal', title: '终端数字孪生' },
] as const

test.describe('partner screen navigation', () => {
  test.beforeEach(async ({ page }) => {
    await serveHappy(page)
  })

  test('每个页签有独立地址，点击后地址与标题一起变', async ({ page }) => {
    await open(page, '/screen/overview')
    for (const tab of TABS) {
      await page.getByRole('link', { name: tab.label }).click()
      await expect(page).toHaveURL(new RegExp(`${tab.path}$`))
      await expect(page.getByRole('heading', { name: tab.title })).toBeVisible()
    }
  })

  test('旧地址 /screen 改写成 /screen/overview', async ({ page }) => {
    await open(page, '/screen')
    await expect(page).toHaveURL(/\/screen\/overview$/)
    await expect(page.getByRole('heading', { name: '本机构运营概览' })).toBeVisible()
  })

  test('展示档没有筛选栏；退出展示回到桌面档', async ({ page }) => {
    await open(page, '/screen/overview?display=1')
    await expect(page.locator('.twin-toolbar')).toHaveCount(0)
    await expect(page.locator('h1')).toHaveCount(1)
    await expect(page.locator('.twin-hd h1')).toHaveText('本机构运营概览')
    await page.getByRole('button', { name: '退出展示' }).click()
    await expect(page).toHaveURL(/\/screen\/overview$/)
    await expect(page.locator('h1')).toHaveText('数据大屏')
    await expect(page.locator('.twin-toolbar')).toBeVisible()
  })

  test('轻量模式渲染格子墙，不渲染 3D 场景', async ({ page }) => {
    await open(page, '/screen/overview?lite=1')
    await expect(page.locator('.ops-fleet')).toBeVisible()
    await expect(page.locator('.tw3-scene')).toHaveCount(0)
  })

  test('点位牌是按钮，点击写入 place，再点退出聚焦', async ({ page }) => {
    await open(page, '/screen/overview')
    const place = await clickPlace(page, '中大南校区')
    await expect.poll(() => new URL(page.url()).searchParams.get('place')).toBe(place)
    await expect(page.getByRole('heading', { name: `${place}终端`, exact: true })).toBeVisible()
    await clickPlace(page, place, true)
    await expect(page).not.toHaveURL(/[?&]place=/)
  })

  test('null 收藏显示「少于 5」，收藏条里不出现 0', async ({ page }) => {
    await open(page, '/screen/usage')
    const fav = page.locator('.twin-panel').filter({ has: page.getByRole('heading', { name: '收藏', exact: true }) })
    await expect(fav).toContainText('少于 5 次：招聘会、政策公告、企业资料')
    const values = await fav.locator('.twin-bar-row b').allTextContents()
    expect(values).not.toContain('0')
    expect(values.join(' ')).not.toContain('0')
  })

  test('展示档点告警行进入终端孪生，地址仍带 display=1', async ({ page }) => {
    await open(page, '/screen/overview?display=1')
    const row = page.locator('.twin-panel').filter({ hasText: '本机构终端告警' }).locator('.twin-alert').first()
    await expect(row).toBeVisible()
    await row.click()
    await expect(page).toHaveURL(/\/screen\/terminal/)
    await expect(page).toHaveURL(/display=1/)
    await expect(page).not.toHaveURL(/orgId/i)
    await expect(page.getByRole('heading', { name: '终端数字孪生' })).toBeVisible()
  })

  test('所有机构大屏请求都不带 orgId；快照与终端无 query；非法 range 先纠正为 today', async ({ page }) => {
    const urls: string[] = []
    page.on('request', (request) => {
      const url = new URL(request.url())
      if (url.pathname.includes('/partner/screen/')) urls.push(url.pathname + url.search)
    })
    await open(page, '/screen/usage?range=bogus&orgId=org-evil')
    await expect(page.getByRole('heading', { name: '本机构信息使用态势' })).toBeVisible()
    await page.getByRole('link', { name: '机构总览' }).click()
    await expect(page).toHaveURL(/\/screen\/overview$/)
    await page.getByRole('link', { name: '终端孪生' }).click()
    await expect(page.getByRole('heading', { name: '终端数字孪生' })).toBeVisible()
    await expect.poll(() => urls.some((url) => url.includes('/terminals/'))).toBe(true)
    expect(urls.length).toBeGreaterThan(0)
    for (const url of urls) expect(url).not.toMatch(/orgId|org-evil/i)
    expect(urls.filter((url) => url.includes('/snapshot')).every((url) => url === '/api/v1/partner/screen/snapshot')).toBe(true)
    const usage = urls.filter((url) => url.includes('/usage'))
    expect(usage.length).toBeGreaterThan(0)
    expect(usage.every((url) => url === '/api/v1/partner/screen/usage?range=today')).toBe(true)
    const twins = urls.filter((url) => url.includes('/terminals/'))
    expect(twins.every((url) => /^\/api\/v1\/partner\/screen\/terminals\/[^?]+$/.test(url))).toBe(true)
  })
})
