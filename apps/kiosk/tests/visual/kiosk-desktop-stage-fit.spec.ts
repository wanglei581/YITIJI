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

/** 模拟浏览器提供的可见区/键盘几何；不把 fill 或鼠标焦点当成系统输入法验收。 */
async function visibleHeight(page: Page, height: number, scale = 1): Promise<void> {
  await page.evaluate(({ height, scale }) => {
    Object.defineProperty(window.visualViewport, 'height', { configurable: true, get: () => height })
    Object.defineProperty(window.visualViewport, 'scale', { configurable: true, get: () => scale })
    window.visualViewport!.dispatchEvent(new Event('resize'))
  }, { height, scale })
}

async function expectInputAndActionVisible(page: Page, height: number): Promise<void> {
  const input = page.locator('input').first()
  const action = page.getByRole('button', { name: '下一步：求职意向', exact: true })
  await expect.poll(async () => (await input.boundingBox())!.height).toBeGreaterThanOrEqual(63.9)
  await expect.poll(async () => (await action.boundingBox())!.height).toBeGreaterThanOrEqual(63.9)
  for (const target of [input, action]) {
    const box = (await target.boundingBox())!
    expect(box.y).toBeGreaterThanOrEqual(0)
    expect(box.y + box.height).toBeLessThanOrEqual(height + 1)
    expect(await target.evaluate((el) => {
      const r = el.getBoundingClientRect()
      return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2))
    })).toBe(true)
  }
}

test('触屏输入时只缩可用内容高，保留字号触控尺寸和底栏，收起恢复 @kiosk', async ({ page, api }, testInfo) => {
  registerW6Api(api)
  await page.setViewportSize({ width: 1080, height: 1920 })
  await page.goto('/resume/generate')
  const input = page.locator('input').first()
  await input.fill('测试姓名')
  await input.evaluate((el: HTMLInputElement) => el.setSelectionRange(2, 2))
  await visibleHeight(page, 1300)
  await expect.poll(() => readEnabledStageScale(page)).toBeCloseTo(1, 3)
  await expectInputAndActionVisible(page, 1300)
  await expect(input).toHaveValue('测试姓名')
  expect(await input.evaluate((el: HTMLInputElement) => el.selectionStart)).toBe(2)
  const lastInput = page.locator('input').last()
  await lastInput.focus()
  await expect.poll(async () => { const box = (await lastInput.boundingBox())!; return box.y + box.height }).toBeLessThanOrEqual(1301)
  await input.focus()
  await expect.poll(() => input.evaluate((el) => {
    const label = el.closest('label')!.getBoundingClientRect()
    const card = el.closest('.qx-rg-card')!.getBoundingClientRect()
    return label.top - card.top
  })).toBeGreaterThanOrEqual(-1)
  await page.screenshot({ path: testInfo.outputPath('keyboard-viewport.png'), fullPage: true })
  // 点非输入处（候选栏/按钮造成 focusout 的同类信号）不能在键盘仍遮挡时骤然恢复大舞台。
  await input.evaluate((el: HTMLInputElement) => el.blur())
  await expectInputAndActionVisible(page, 1300)
  await visibleHeight(page, 1920)
  await expect(page.locator('[data-kiosk-input-occluded="true"]')).toHaveCount(0)
  await expect.poll(() => readEnabledStageScale(page)).toBeCloseTo(1, 3)
  await expect(input).toHaveValue('测试姓名')
})

test('明确键盘几何下布局视口一起缩小时仍用输入前尺度 @kiosk', async ({ page, api }) => {
  registerW6Api(api)
  await page.addInitScript(() => {
    const keyboard = Object.assign(new EventTarget(), { boundingRect: { height: 0 } })
    Object.defineProperty(navigator, 'virtualKeyboard', { configurable: true, value: keyboard })
  })
  await page.setViewportSize({ width: 1080, height: 1920 })
  await page.goto('/resume/generate')
  await page.locator('input').first().focus()
  await page.evaluate(() => {
    const keyboard = (navigator as Navigator & { virtualKeyboard: EventTarget & { boundingRect: { height: number } } }).virtualKeyboard
    keyboard.boundingRect.height = 620
  })
  await page.setViewportSize({ width: 1080, height: 1300 })
  await expect.poll(() => readEnabledStageScale(page)).toBeCloseTo(1, 3)
  await expectInputAndActionVisible(page, 1300)
})

test('普通窗口resize和pinch不能误当成触摸键盘 @kiosk', async ({ page, api }) => {
  registerW6Api(api)
  await page.setViewportSize({ width: 1080, height: 1920 })
  await page.goto('/resume/generate')
  await page.locator('input').first().focus()
  await page.setViewportSize({ width: 1080, height: 1300 })
  await expect.poll(() => readEnabledStageScale(page)).toBeCloseTo(1300 / 1920, 3)
  await expect(page.locator('[data-kiosk-input-occluded="true"]')).toHaveCount(0)
  await visibleHeight(page, 1000, 1.5)
  await expect.poll(() => readEnabledStageScale(page)).toBeCloseTo(1000 / 1920, 3)
  await expect(page.locator('[data-kiosk-input-occluded="true"]')).toHaveCount(0)
})

test('手机原生输入保持流式布局，横竖屏变化不锁住输入前尺寸 @kiosk', async ({ page, api }) => {
  registerW6Api(api)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/resume/generate')
  await page.locator('input').first().focus()
  await visibleHeight(page, 500)
  await expect(page.locator('[data-kiosk-stage-fit="off"]')).toHaveCount(1)
  await expect(page.locator('[data-kiosk-input-occluded="true"]')).toHaveCount(0)
  await page.setViewportSize({ width: 1080, height: 1920 })
  await visibleHeight(page, 1920)
  await expect(page.locator('[data-kiosk-stage-fit="on"]')).toHaveCount(1)
  await expect.poll(() => readEnabledStageScale(page)).toBeCloseTo(1, 3)
  await page.setViewportSize({ width: 1920, height: 1080 })
  await visibleHeight(page, 1080)
  await expect.poll(() => readEnabledStageScale(page)).toBeCloseTo(1080 / 1920, 3)
  await expect(page.locator('[data-kiosk-input-occluded="true"]')).toHaveCount(0)
})

test('键盘连续小步展开不能不断下移输入前基线 @kiosk', async ({ page, api }) => {
  registerW6Api(api)
  await page.setViewportSize({ width: 1080, height: 1920 })
  await page.goto('/resume/generate')
  await page.locator('input').first().focus()
  for (const height of [1860, 1800, 1740, 1680, 1620, 1560, 1500, 1440, 1380, 1320, 1300]) {
    await visibleHeight(page, height)
    // 让每个resize在不同帧结算，不能只测最后一个大跳变。
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())))
    await expect.poll(() => readEnabledStageScale(page)).toBeCloseTo(1, 3)
  }
  await expect.poll(() => readEnabledStageScale(page)).toBeCloseTo(1, 3)
  await expectInputAndActionVisible(page, 1300)
})


test('可见区有上偏移时输入和操作仍在范围内，手动滚动不被抢回 @kiosk', async ({ page, api }) => {
  registerW6Api(api)
  await page.setViewportSize({ width: 1080, height: 1920 })
  await page.goto('/resume/generate')
  await page.locator('input').first().focus()
  await page.evaluate(() => Object.defineProperty(visualViewport, 'offsetTop', { configurable: true, get: () => 80 }))
  await visibleHeight(page, 1300)
  const host = page.locator('[data-kiosk-input-occluded="true"]')
  await expect.poll(async () => (await host.boundingBox())!.y).toBe(80)
  await expect.poll(async () => { const b = (await host.boundingBox())!; return b.y + b.height }).toBe(1380)
  await expectInputAndActionVisible(page, 1380)
  const card = page.locator('.qx-rg-card')
  await card.hover()
  const before = await card.evaluate((el) => el.scrollTop)
  await page.mouse.wheel(0, 160)
  await expect.poll(() => card.evaluate((el) => el.scrollTop)).toBeGreaterThan(before)
  const after = await card.evaluate((el) => el.scrollTop)
  await page.evaluate(() => visualViewport!.dispatchEvent(new Event('scroll')))
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  expect(await card.evaluate((el) => el.scrollTop)).toBe(after)
})

test('横屏电脑输入遮挡时仍水平居中，不把左侧当舞台中心 @kiosk', async ({ page, api }) => {
  registerW6Api(api)
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.goto('/resume/generate')
  await page.locator('input').first().focus()
  await visibleHeight(page, 850)
  await expect.poll(() => readEnabledStageScale(page)).toBeCloseTo(1080 / 1920, 3)
  const box = (await page.locator('.kiosk-stage-scaler').boundingBox())!
  expect(box.x + box.width / 2).toBeCloseTo(960, 1)
})
