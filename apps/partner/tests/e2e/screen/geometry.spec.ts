import { test, expect } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { clickPlace, geometry, open, serveHappy } from './helpers'

const SHOT_DIR = join(process.cwd(), '..', '..', 'test-results', 'console-screen-shots')
mkdirSync(SHOT_DIR, { recursive: true })

const TABS = [
  { path: '/screen/overview', title: '本机构运营概览', scene: true },
  { path: '/screen/usage', title: '本机构信息使用态势', scene: true },
  { path: '/screen/terminal', title: '终端数字孪生', scene: false },
] as const

test.describe('partner screen geometry', () => {
  test.beforeEach(async ({ page }) => {
    await serveHappy(page)
  })

  for (const tab of TABS) {
    test(`${tab.path}：面板、字号与滚动`, async ({ page }, testInfo) => {
      test.setTimeout(90_000)
      const wall = testInfo.project.name.includes('wall')
      await open(page, wall ? `${tab.path}?display=1` : tab.path)
      await expect(page.getByRole('heading', { name: tab.title })).toBeVisible()
      await expect(page.locator('.twin-panel').first()).toBeVisible()
      await page.waitForTimeout(400)
      const floor = wall ? 13 : 12
      const report = await geometry(page, floor, wall)
      expect(report.panels.length).toBeGreaterThan(0)
      expect(report.footless, '每块都要有来源口径').toEqual([])
      expect(report.nested).toBe(0)
      expect(report.tinyText, `可见文字不得小于 ${floor}px`).toEqual([])
      expect(report.scrollW, '不得横向滚动').toBeLessThanOrEqual(report.clientW + 1)
      if (wall) {
        expect(report.outsideViewport, '展示档面板必须完全落在视口内').toEqual([])
        expect(report.panelOverlaps, '展示档面板不得互相重叠').toEqual([])
        expect(report.childOverflow, '面板内子元素不得溢出面板').toEqual([])
        expect(report.scrollH).toBeLessThanOrEqual(report.clientH + 1)
      }
      if (!wall) {
        await page.setViewportSize({ width: 1100, height: 900 })
        await page.waitForTimeout(300)
        const narrow = await geometry(page, 12)
        expect(narrow.scrollW, '1100 宽不得横向滚动').toBeLessThanOrEqual(narrow.clientW + 1)
        expect(narrow.tinyText).toEqual([])
      }
      const shot = join(SHOT_DIR, `partner-${tab.path.split('/').pop()}-${testInfo.project.name}.png`)
      await page.screenshot({ path: shot, animations: 'disabled' })
      await testInfo.attach(`partner-${tab.path}`, { path: shot, contentType: 'image/png' })
    })
  }

  test('点位牌子聚焦前后两两不重叠', async ({ page }, testInfo) => {
    test.setTimeout(90_000)
    const wall = testInfo.project.name.includes('wall')
    await open(page, wall ? '/screen/overview?display=1' : '/screen/overview')
    await expect(page.locator('button.tw3-district-btn').first()).toBeVisible()
    await page.waitForTimeout(500)
    const before = await geometry(page, wall ? 13 : 12, wall)
    expect(before.labelOverlaps, before.labelOverlaps.join('；')).toEqual([])
    const place = await clickPlace(page, '中大南校区')
    await expect.poll(() => new URL(page.url()).searchParams.get('place')).toBe(place)
    await page.waitForTimeout(500)
    const after = await geometry(page, wall ? 13 : 12, wall)
    expect(after.labelOverlaps, after.labelOverlaps.join('；')).toEqual([])
  })
})
