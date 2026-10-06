import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures/kiosk-test'
import { readEnabledStageScale } from './assert-layout'
import { registerW6Api } from './fixtures/fusion-w6-api'

/**
 * 电脑横屏上每一页都按 1080×1920 竖屏等比缩小居中。
 * 挂在 test:browser:journeys（--project=kiosk-1080x1920，grep @kiosk）；
 * 视口在用例里改，不另开 playwright project。
 */
const LANDSCAPE = [
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
] as const

const PAGES = [
  { path: '/', button: '[data-testid="home-primary"]' },
  { path: '/print-scan', button: '[data-testid="print-hub-primary"]' },
  { path: '/login', button: '[data-testid="login-gate-anonymous"]' },
  { path: '/resume/source', button: '.resume-primary-action' },
  { path: '/profile', button: '[data-testid="profile-primary"]' },
] as const

async function expectedStageScale(page: Page): Promise<number> {
  return page.evaluate(() => {
    const viewport = window.visualViewport
    const width = viewport && viewport.width > 0 ? Math.round(viewport.width) : window.innerWidth
    const height = viewport && viewport.height > 0 ? Math.round(viewport.height) : window.innerHeight
    return Math.max(0.01, Math.min(width / 1080, height / 1920))
  })
}

test('横屏电脑各页共用同一 1080×1920 舞台缩放 @kiosk', async ({ page, api }) => {
  registerW6Api(api)
  for (const viewport of LANDSCAPE) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    const scales: number[] = []
    for (const entry of PAGES) {
      await page.goto(entry.path)
      const where = `${entry.path} @ ${viewport.width}x${viewport.height}`
      await expect(page.locator('[data-kiosk-stage-fit="on"]'), where).toHaveCount(1)
      await expect(page.locator('.kiosk-stage .kiosk-stage'), where).toHaveCount(0)
      const scale = await readEnabledStageScale(page)
      expect(scale, where).toBeCloseTo(await expectedStageScale(page), 3)
      scales.push(scale)
      const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
      expect(fits, `${where} 不得出现横向滚动条`).toBe(true)
      const button = page.locator(entry.button).first()
      await expect(button, where).toBeVisible()
      const box = await button.boundingBox()
      expect(box, `${where} 主按钮必须有包围盒`).not.toBeNull()
      expect(box!.x, where).toBeGreaterThanOrEqual(-1)
      expect(box!.y, where).toBeGreaterThanOrEqual(-1)
      expect(box!.x + box!.width, where).toBeLessThanOrEqual(viewport.width + 1)
      expect(box!.y + box!.height, where).toBeLessThanOrEqual(viewport.height + 1)
    }
    for (const scale of scales) expect(scale).toBeCloseTo(scales[0], 3)
  }
})

test('手机首页保持不缩放的流式布局 @kiosk', async ({ page, api }) => {
  registerW6Api(api)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.locator('[data-kiosk-stage-fit="off"]')).toHaveCount(1)
  await expect(page.locator('[data-kiosk-stage-fit="on"]')).toHaveCount(0)
})
