import type { Page } from '@playwright/test'
import { test, expect } from '../fixtures/kiosk-test'
import { assertNoHorizontalOverflow } from './assert-layout'
import { registerW6Api } from './fixtures/fusion-w6-api'
import { w6KioskCases, w6MobileCases, type W6RouteCase } from './fixtures/fusion-w6-route-cases'

function collectRuntimeErrors(page: Page): string[] {
  const errors: string[] = []
  const forbiddenLog = /http proxy error|ECONNREFUSED|Unhandled API requests/i
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (forbiddenLog.test(message.text())) errors.push(`console: ${message.text()}`)
  })
  page.on('requestfailed', (request) => {
    if (['document', 'script', 'stylesheet'].includes(request.resourceType())) {
      errors.push(`${request.resourceType()}: ${request.url()} (${request.failure()?.errorText ?? 'unknown'})`)
    }
  })
  return errors
}

async function expectTouchTargets(page: Page): Promise<void> {
  const targets = page.locator('button:not(:disabled), a[href], input:not([type="file"]):not(.sr-only):not(:disabled), select:not(:disabled), textarea:not(:disabled), [role="button"]:not([aria-disabled="true"])')
  let visible = 0
  for (let index = 0; index < await targets.count(); index += 1) {
    const target = targets.nth(index)
    if (!(await target.isVisible())) continue
    visible += 1
    const box = await target.boundingBox()
    const identity = await target.evaluate((element) => {
      const label = element.getAttribute('aria-label') ?? element.textContent?.trim() ?? ''
      return `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}${element.className ? `.${String(element.className).trim().replaceAll(' ', '.')}` : ''} ${label}`.trim()
    })
    expect(box, `触控目标 ${index}（${identity}）必须有可计算尺寸`).not.toBeNull()
    expect(box!.width, `触控目标 ${index}（${identity}）宽度不得小于 48px`).toBeGreaterThanOrEqual(48)
    expect(box!.height, `触控目标 ${index}（${identity}）高度不得小于 48px`).toBeGreaterThanOrEqual(48)
  }
  expect(visible, '触控优先页面必须至少有一个可见交互目标').toBeGreaterThan(0)
}

function screenshotName(route: W6RouteCase): string {
  const name = route.pattern === '/' ? 'home' : route.pattern.slice(1).replaceAll('/', '__').replaceAll(':', '_')
  return `${name}.png`
}

async function acceptRoute(page: Page, route: W6RouteCase, errors: string[]): Promise<void> {
  if (route.seed) await route.seed(page)
  await page.goto(route.url, { waitUntil: 'domcontentloaded' })
  if (route.expectedPath) await expect(page).toHaveURL((url) => url.pathname === route.expectedPath)

  await expect(page.locator(route.marker).first(), `稳定 marker: ${route.marker}`).toBeVisible()
  if (route.featureText) await expect(page.getByText(route.featureText, { exact: false }).first()).toBeVisible()
  if (route.longText) await expect(page.getByText(route.longText, { exact: true })).toBeVisible()

  await page.screenshot({ path: test.info().outputPath('routes', screenshotName(route)), fullPage: true })
  if (route.landmark === 'main') {
    await expect(page.locator('main:visible'), `${route.pattern} 必须恰好有一个可见 main`).toHaveCount(1)
    await expect(page.locator('main main'), `${route.pattern} 不得嵌套 main`).toHaveCount(0)
  } else if (route.landmark === 'presentation') {
    await expect(page.locator('[role="presentation"]:visible'), `${route.pattern} 必须恰好有一个 presentation`).toHaveCount(1)
    await expect(page.locator('main:visible'), `${route.pattern} 的全屏演示层不应伪造 main`).toHaveCount(0)
  } else {
    await expect(page.locator('main:visible'), `${route.pattern} 不应渲染 main landmark`).toHaveCount(0)
    await expect(page.locator('main main'), `${route.pattern} 不得嵌套 main`).toHaveCount(0)
  }
  if (route.requiresFusionRoot) {
    await expect(page.locator('[data-kiosk-presentation="fusion-youth"]').first(), `${route.pattern} 必须使用融合展示根`).toBeVisible()
  }
  const overflowingElements = await page.locator('body *').evaluateAll((elements) => {
    const viewportWidth = document.documentElement.clientWidth
    return elements.flatMap((element) => {
      const rect = element.getBoundingClientRect()
      if (rect.right <= viewportWidth + 0.5 && rect.left >= -0.5) return []

      let clippedByHorizontalScroller = false
      for (let ancestor = element.parentElement; ancestor && ancestor !== document.body; ancestor = ancestor.parentElement) {
        const overflowX = window.getComputedStyle(ancestor).overflowX
        if (!['auto', 'scroll'].includes(overflowX) || ancestor.scrollWidth <= ancestor.clientWidth + 0.5) continue
        const ancestorRect = ancestor.getBoundingClientRect()
        const ancestorInsideViewport = ancestorRect.left >= -0.5 && ancestorRect.right <= viewportWidth + 0.5
        if (ancestorInsideViewport && (rect.left < ancestorRect.left || rect.right > ancestorRect.right)) {
          clippedByHorizontalScroller = true
          break
        }
      }
      if (clippedByHorizontalScroller) return []

      const name = `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}${element.className ? `.${String(element.className).trim().replaceAll(' ', '.')}` : ''}`
      return [`${name} left=${rect.left.toFixed(1)} right=${rect.right.toFixed(1)}`]
    }).slice(0, 12)
  })
  expect(overflowingElements, `${route.pattern} 不得包含越过视口边界的元素`).toEqual([])
  await assertNoHorizontalOverflow(page)
  if (route.requiresTouchTargets) await expectTouchTargets(page)
  expect(errors, `路由 ${route.pattern} 不得产生脚本错误或关键资源失败`).toEqual([])
}

for (const route of w6KioskCases) {
  test(`${route.pattern} route surface @w6-kiosk`, async ({ page, api }) => {
    const errors = collectRuntimeErrors(page)
    registerW6Api(api)
    await acceptRoute(page, route, errors)
  })
}

for (const route of w6MobileCases) {
  test(`${route.pattern} mobile surface @w6-mobile`, async ({ page, api }) => {
    const errors = collectRuntimeErrors(page)
    registerW6Api(api)
    await acceptRoute(page, route, errors)
  })
}
