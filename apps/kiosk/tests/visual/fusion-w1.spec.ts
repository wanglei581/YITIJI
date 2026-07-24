import type { Locator, Page } from '@playwright/test'
import { test, expect } from '../fixtures/kiosk-test'
import { assertNoHorizontalOverflow } from './assert-layout'

const FIXTURE_KIOSK_URL = 'http://127.0.0.1:4178/?viewport=kiosk'
const FIXTURE_MOBILE_URL = 'http://127.0.0.1:4178/?viewport=mobile'

function collectRuntimeErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
  page.on('requestfailed', (request) => {
    if (request.resourceType() === 'stylesheet' || request.resourceType() === 'script') {
      errors.push(
        `${request.resourceType()} request failed: ${request.url()} (${request.failure()?.errorText ?? 'unknown'})`,
      )
    }
  })
  return errors
}

async function expectMinimumTargets(locator: Locator, minimumHeight: number): Promise<void> {
  const targets = locator
  const count = await targets.count()
  expect(count, 'expected at least one matching touch target').toBeGreaterThan(0)
  let visibleCount = 0

  for (let index = 0; index < count; index += 1) {
    const target = targets.nth(index)
    if (!(await target.isVisible())) continue
    visibleCount += 1
    const identity = await target.evaluate((element) => ({
      className: element.className,
      label: element.getAttribute('aria-label'),
      text: element.textContent?.trim().replace(/\s+/g, ' '),
    }))
    const box = await target.boundingBox()
    const targetDescription = `touch target ${index} ${JSON.stringify(identity)}`
    expect(box, `${targetDescription} must have a bounding box`).not.toBeNull()
    expect(box!.width, `${targetDescription} must be at least 48px wide`).toBeGreaterThanOrEqual(48)
    expect(box!.height, `${targetDescription} must be at least ${minimumHeight}px high`).toBeGreaterThanOrEqual(minimumHeight)
  }

  expect(visibleCount, 'expected at least one visible touch target').toBeGreaterThan(0)
}

async function expectWithinViewport(page: Page, locator: Locator): Promise<void> {
  const viewport = page.viewportSize()
  expect(viewport).not.toBeNull()
  const count = await locator.count()
  expect(count, 'expected at least one primitive instance').toBeGreaterThan(0)

  for (let index = 0; index < count; index += 1) {
    const box = await locator.nth(index).boundingBox()
    expect(box, `primitive ${index} must have a bounding box`).not.toBeNull()
    expect(box!.x, `primitive ${index} must not leak left`).toBeGreaterThanOrEqual(0)
    expect(box!.width, `primitive ${index} must fit viewport width`).toBeLessThanOrEqual(viewport!.width)
    expect(box!.x + box!.width, `primitive ${index} must not leak right`).toBeLessThanOrEqual(viewport!.width)
  }
}

test('production home exposes the fusion frame and touch-safe real controls @w1-kiosk', async ({ page, api }) => {
  const runtimeErrors = collectRuntimeErrors(page)
  api.respond('GET', '/api/v1/terminals/KSK-001/printer-status', {
    status: 200,
    json: { printerStatus: 'ready', paperLevel: 'sufficient', isOnline: true },
  })
  api.respond('GET', '/api/v1/terminals/KSK-001/config', {
    status: 200,
    json: {
      smartCampus: {
        enabled: false,
        modules: { welcome: false, bigdata: false, luggage: false, panorama: false },
        items: [],
      },
      toolbox: { enabled: false, items: [] },
      configVersion: 'w1-browser-fixture',
      refreshIntervalMs: 300000,
      serverTime: '2026-07-24T00:00:00.000Z',
    },
  })
  api.respond('GET', '/api/v1/terminals/KSK-001/screensaver', {
    status: 200,
    json: { enabled: false, idleTimeoutSec: 180, items: [] },
  })

  await page.goto('/', { waitUntil: 'domcontentloaded' })

  const shell = page.locator('.ui-kiosk-shell[data-kiosk-presentation="fusion-youth"]')
  await expect(shell).toHaveAttribute('data-kiosk-viewport', 'kiosk')
  const frame = page.locator('.kpv1[data-kiosk-component="page-frame"]')
  await expect(frame).toBeVisible()
  await expect(frame.getByRole('heading', { name: '简历、打印、岗位信息一趟办完' })).toBeVisible()
  await expect(frame.getByText('游客可直接使用大部分功能 · 触摸下方卡片开始', { exact: true })).toBeVisible()
  await expect(frame.getByText('岗位与招聘会信息均来自第三方 / 官方来源', { exact: false })).toBeVisible()
  await expectMinimumTargets(frame.locator('button:not(:disabled)'), 48)
  await expectMinimumTargets(frame.locator('.login-btn, .tile:not(:disabled), .nav-item'), 56)
  await expectMinimumTargets(frame.locator('.tile.primary:not(:disabled)'), 56)
  await assertNoHorizontalOverflow(page)
  expect(runtimeErrors).toEqual([])
})

test('fixture exposes all six state roles with scoped computed styles @w1-kiosk', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page)
  await page.goto(FIXTURE_KIOSK_URL, { waitUntil: 'domcontentloaded' })

  const root = page.getByTestId('fixture-root')
  await expect(root).toHaveAttribute('data-kiosk-viewport', 'kiosk')
  await expect(root.locator('.ui-kiosk-state-panel')).toHaveCount(6)
  for (const tone of ['loading', 'empty', 'error', 'offline', 'success', 'permission']) {
    await expect(root.locator(`.ui-kiosk-state-panel[data-tone="${tone}"]`)).toBeVisible()
  }
  await expect(root.getByRole('status')).toHaveCount(3)
  await expect(root.getByRole('alert')).toHaveCount(3)
  await expect(root.locator('.ui-kiosk-state-panel[data-tone="loading"]')).toHaveAttribute('aria-busy', 'true')
  await expect(root.locator('.ui-kiosk-state-panel[data-tone="error"]')).toHaveAttribute('aria-live', 'assertive')
  await expect(root.locator('.ui-kiosk-page-frame')).toHaveCSS('background-color', 'rgb(244, 241, 232)')
  await expect(root.locator('.ui-kiosk-state-panel').first()).toHaveCSS('border-radius', '18px')
  await expect(root.locator('.ui-kiosk-back-button')).toHaveCSS('transition-duration', '0s')
  await assertNoHorizontalOverflow(page)
  expect(runtimeErrors).toEqual([])
})

test('fixture modal manages accessible names, focus, dismissal, and body scroll @w1-kiosk', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page)
  await page.goto(FIXTURE_KIOSK_URL, { waitUntil: 'domcontentloaded' })

  const dialog = page.getByRole('dialog', { name: '示例确认弹窗' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toHaveAttribute('aria-modal', 'true')
  const linkage = await dialog.evaluate((element) => ({
    labelledBy: element.getAttribute('aria-labelledby'),
    describedBy: element.getAttribute('aria-describedby'),
  }))
  expect(linkage.labelledBy).toBeTruthy()
  expect(linkage.describedBy).toBeTruthy()
  await expect(page.locator(`[id="${linkage.labelledBy}"]`)).toHaveText('示例确认弹窗')
  await expect(page.locator(`[id="${linkage.describedBy}"]`)).toHaveText('用于验证焦点、关闭与滚动锁定。')
  await expect(dialog).toBeFocused()
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('hidden')

  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('auto')

  const opener = page.getByTestId('open-modal')
  await opener.click()
  await expect(dialog).toBeFocused()
  await page.locator('.ui-kiosk-modal-backdrop').click({ position: { x: 4, y: 4 } })
  await expect(dialog).toBeHidden()
  await expect(opener).toBeFocused()
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('auto')
  expect(runtimeErrors).toEqual([])
})

test('mobile fixture keeps every primitive inside the 390px viewport @w1-mobile', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page)
  await page.goto(FIXTURE_MOBILE_URL, { waitUntil: 'domcontentloaded' })

  const root = page.getByTestId('fixture-root')
  await expect(root).toHaveAttribute('data-kiosk-viewport', 'mobile')
  await expect(root.locator('.ui-kiosk-page-frame')).toHaveCSS('max-width', 'none')
  for (const selector of [
    '.ui-kiosk-page-frame',
    '.ui-kiosk-page-header',
    '.ui-kiosk-action-bar',
    '.ui-kiosk-state-panel',
    '.ui-kiosk-modal-dialog',
  ]) {
    await expectWithinViewport(page, root.locator(selector))
  }
  await assertNoHorizontalOverflow(page)
  expect(runtimeErrors).toEqual([])
})

for (const scenario of [
  { path: '/member/qr-login', landmark: '暂时无法确认登录' },
  { path: '/upload/phone', landmark: '上传链接已失效' },
] as const) {
  test(`production ${scenario.path} keeps the mobile fusion contract @w1-mobile`, async ({ page, api }) => {
    void api
    const runtimeErrors = collectRuntimeErrors(page)
    await page.goto(scenario.path, { waitUntil: 'domcontentloaded' })

    const landmark = page.locator('main[data-kiosk-presentation="fusion-youth"]')
    await expect(landmark).toHaveAttribute('data-kiosk-viewport', 'mobile')
    await expect(landmark.getByText(scenario.landmark, { exact: true })).toBeVisible()
    await assertNoHorizontalOverflow(page)
    expect(runtimeErrors).toEqual([])
  })
}
