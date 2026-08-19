import type { Page } from '@playwright/test'
import { test, expect } from '../fixtures/kiosk-test'
import { assertNoHorizontalOverflow } from './assert-layout'
import { registerW6Api, W6_MEMBER_TOKEN } from './fixtures/fusion-w6-api'
import { matchV6RoutePattern } from '../../src/layouts/v6ShellRoutes'
import { V6_SHELL_ROUTE_PATTERNS, w6KioskCases, w6MobileCases, type W6RouteCase } from './fixtures/fusion-w6-route-cases'

/** 相对亮度，用来分辨「V6 暖纸顶栏」和「旧深藏青顶栏」，不锁具体色值。 */
function relativeLuminance(css: string): number | null {
  const srgb = css.match(/color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/)
  if (srgb) return 0.2126 * Number(srgb[1]) + 0.7152 * Number(srgb[2]) + 0.0722 * Number(srgb[3])
  const rgb = css.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
  if (rgb) return (0.2126 * Number(rgb[1]) + 0.7152 * Number(rgb[2]) + 0.0722 * Number(rgb[3])) / 255
  return null
}

/**
 * V6 壳一致性：白名单内的路由必须真的挂上 V6 壳、顶栏是浅色纸面；白名单外的不得被染色。
 * 这一条锁的是行为（渲染结果），不是类名写法。
 */
async function expectV6ShellConsistency(page: Page, route: W6RouteCase): Promise<void> {
  const state = await page.evaluate(() => {
    const shell = document.querySelector('.ui-kiosk-shell')
    const topbar = document.querySelector('.ui-kiosk-topbar')
    return {
      // 以真实落地路径判定，而不是声明的 route.pattern：/contract-review、/session-timeout
      // 这类 fail-closed 路由会被重定向回首页，壳归属应当按它们真正停在的那一页算。
      landedPath: window.location.pathname,
      hasV6Class: Boolean(shell?.classList.contains('v6-runtime-shell')),
      topbarBg: topbar ? getComputedStyle(topbar).backgroundColor : null,
    }
  })
  const expected = [...V6_SHELL_ROUTE_PATTERNS].some((pattern) => matchV6RoutePattern(pattern, state.landedPath))
  expect(
    state.hasV6Class,
    `${route.pattern}（落地于 ${state.landedPath}）的 V6 壳归属必须与 KioskRoot 的 V6_SHELL_ROUTES 一致（期望 ${expected}）`,
  ).toBe(expected)
  if (!expected || state.topbarBg === null) return
  const luminance = relativeLuminance(state.topbarBg)
  expect(luminance, `${route.pattern} 顶栏背景色无法解析: ${state.topbarBg}`).not.toBeNull()
  expect(
    luminance as number,
    `${state.landedPath} 是 V6 路由，顶栏必须是浅色纸面而不是旧深藏青（实测 ${state.topbarBg}）`,
  ).toBeGreaterThan(0.6)
}

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

const W6_MEMBER_PHONE = '13800138000'
const W6_MEMBER_CODE = '123456'

async function loginThroughVisibleUi(page: Page, returnTo: string): Promise<void> {
  await page.goto(`/login?from=${encodeURIComponent(returnTo)}`)
  await page.getByRole('checkbox', { name: /我已阅读并同意/ }).click()
  for (const digit of W6_MEMBER_PHONE) {
    await page.getByRole('button', { name: digit, exact: true }).click()
  }
  await page.getByRole('button', { name: '获取验证码', exact: true }).click()
  await page.getByRole('button', { name: '短信验证码', exact: true }).click()
  for (const digit of W6_MEMBER_CODE) {
    await page.getByRole('button', { name: digit, exact: true }).click()
  }

  const pendingTasksRequest = page.waitForRequest((request) =>
    request.method() === 'GET' && new URL(request.url()).pathname === '/api/v1/me/pending-tasks',
  )
  await page.getByRole('button', { name: '验证并登录', exact: true }).click()
  await page.waitForURL((url) => url.pathname === returnTo)

  const request = await pendingTasksRequest
  const headers = await request.allHeaders()
  expect(headers.authorization, '续办请求必须使用 AuthContext 内存 token 发送 Bearer').toBe(`Bearer ${W6_MEMBER_TOKEN}`)
}

async function acceptRoute(page: Page, route: W6RouteCase, errors: string[]): Promise<void> {
  if (route.seed) await route.seed(page)
  if (route.requiresMemberSession) {
    await loginThroughVisibleUi(page, route.url)
  } else {
    await page.goto(route.url, { waitUntil: 'domcontentloaded' })
  }
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
  await expectV6ShellConsistency(page, route)
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
