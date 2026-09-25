import { test, expect } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { clickDistrict, geometry, open, serveHappy } from './helpers'

/**
 * 几何。展示档在 1920×1080 量面板是否落在视口、是否互相重叠、子元素是否溢出面板。
 * 桌面档量 1440×900 与 1100 宽的横向滚动，以及字号下限。
 * 城区牌子在聚焦前后各量一次。
 */

const SHOT_DIR = join(process.cwd(), '..', '..', 'test-results', 'console-screen-shots')
mkdirSync(SHOT_DIR, { recursive: true })

const TABS = [
  { path: '/screen/gov', title: '职易达 · 就业服务终端运行态势', scene: true },
  { path: '/screen/usage', title: '职易达 · 系统使用与服务调用态势', scene: true },
  { path: '/screen/ops', title: '终端运营看板', scene: false },
  { path: '/screen/terminal', title: '终端数字孪生', scene: false },
] as const

async function settle(page: import('@playwright/test').Page) {
  await expect(page.locator('.twin-panel, .ops-card').first()).toBeVisible()
  await page.waitForTimeout(400)
}

test.describe('admin screen geometry', () => {
  test.beforeEach(async ({ page }) => {
    await serveHappy(page)
  })

  for (const tab of TABS) {
    test(`${tab.path}：面板、字号与滚动`, async ({ page }, testInfo) => {
      test.setTimeout(90_000)
      const wall = testInfo.project.name.includes('wall')
      const path = wall ? `${tab.path}?display=1` : tab.path
      await open(page, path)
      await expect(page.getByRole('heading', { name: tab.title })).toBeVisible()
      await settle(page)
      const floor = wall ? 13 : 12
      const report = await geometry(page, floor, wall)
      expect(report.panels.length, '至少有一块面板').toBeGreaterThan(0)
      expect(report.footless, '每块都要有来源口径').toEqual([])
      expect(report.nested, '面板不能套面板').toBe(0)
      expect(report.tinyText, `可见文字不得小于 ${floor}px`).toEqual([])
      expect(report.scrollW, '不得横向滚动').toBeLessThanOrEqual(report.clientW + 1)
      if (wall) {
        expect(report.outsideViewport, '展示档面板必须完全落在视口内').toEqual([])
        expect(report.panelOverlaps, '展示档面板不得互相重叠').toEqual([])
        expect(report.childOverflow, '面板内子元素不得溢出面板').toEqual([])
        expect(report.scrollH, '展示档不得纵向滚动').toBeLessThanOrEqual(report.clientH + 1)
      }
      if (tab.path === '/screen/ops') {
        expect(report.cards, '运营看板仍是 12 块卡片').toBe(12)
        expect(report.hues.length, `色彩需多于 4 种，实际 ${JSON.stringify(report.hues)}`).toBeGreaterThanOrEqual(4)
      }
      if (!wall) {
        await page.setViewportSize({ width: 1100, height: 900 })
        await page.waitForTimeout(300)
        const narrow = await geometry(page, 12)
        expect(narrow.scrollW, '1100 宽不得横向滚动').toBeLessThanOrEqual(narrow.clientW + 1)
        expect(narrow.tinyText, '1100 宽可见文字不得小于 12px').toEqual([])
      }
      const shot = join(SHOT_DIR, `admin-${tab.path.split('/').pop()}-${testInfo.project.name}.png`)
      await page.screenshot({ path: shot, animations: 'disabled' })
      await testInfo.attach(`admin-${tab.path}-${testInfo.project.name}`, { path: shot, contentType: 'image/png' })
    })
  }

  test('城区牌子聚焦前后两两不重叠', async ({ page }, testInfo) => {
    test.setTimeout(90_000)
    const wall = testInfo.project.name.includes('wall')
    await open(page, wall ? '/screen/gov?display=1' : '/screen/gov')
    await expect(page.locator('button.tw3-district-btn').first()).toBeVisible()
    await page.waitForTimeout(500)
    const before = await geometry(page, wall ? 13 : 12, wall)
    expect(before.labelOverlaps, `聚焦前牌子重叠：${before.labelOverlaps.join('；')}`).toEqual([])
    const area = await clickDistrict(page, '海珠区')
    await expect.poll(() => new URL(page.url()).searchParams.get('area')).toBe(area)
    await page.waitForTimeout(500)
    const after = await geometry(page, wall ? 13 : 12, wall)
    expect(after.labelOverlaps, `聚焦后牌子重叠：${after.labelOverlaps.join('；')}`).toEqual([])
    await clickDistrict(page, area, true)
    await expect(page).not.toHaveURL(/[?&]area=/)
  })
})
