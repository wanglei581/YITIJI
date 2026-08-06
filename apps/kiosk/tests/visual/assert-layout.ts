import { expect, type Page } from '@playwright/test'

export async function assertNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    body: document.body.scrollWidth - document.body.clientWidth,
    root: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }))
  expect(overflow, '页面不得产生横向溢出').toEqual({ body: 0, root: 0 })
}

export async function assertKioskShellFillsViewport(page: Page): Promise<void> {
  const dimensions = await page.locator('.ui-kiosk-shell').evaluate((shell) => {
    const rect = shell.getBoundingClientRect()
    return {
      left: Math.round(rect.left),
      top: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    }
  })
  expect(dimensions, 'Kiosk 外层壳必须完整覆盖当前视口').toEqual({
    left: 0,
    top: 0,
    width: dimensions.viewportWidth,
    height: dimensions.viewportHeight,
    viewportWidth: dimensions.viewportWidth,
    viewportHeight: dimensions.viewportHeight,
  })
}

export async function assertDialogWithinViewport(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog')
  const bounds = await dialog.boundingBox()
  const viewport = page.viewportSize()
  expect(bounds, '筛选弹层必须可见').not.toBeNull()
  expect(viewport, 'Playwright 项目必须配置固定视口').not.toBeNull()
  if (!bounds || !viewport) return
  expect(bounds.x).toBeGreaterThanOrEqual(0)
  expect(bounds.y).toBeGreaterThanOrEqual(0)
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width)
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height)
}
