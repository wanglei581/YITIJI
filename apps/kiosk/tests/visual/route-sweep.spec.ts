import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures/kiosk-test'
import type { ApiRouter } from '../fixtures/api-router'
import { registerW6Api } from './fixtures/fusion-w6-api'
import { productionRoutePatterns } from './route-manifest'
import {
  paramSampleKeys,
  parameterizedPatterns,
  sweepCases,
  type SweepCase,
} from './route-sweep-cases'

/** 白名单文案含「平台投递」子串，先剥掉再查禁词，避免把「去来源平台投递」判红。 */
const ALLOWED_APPLY_COPY = /去来源平台投递|扫码前往来源平台投递|来源平台投递页|来源平台投递/g
const FORBIDDEN_APPLY_COPY = /一键投递|立即投递|平台投递/
const TECH_LEAK = /\bTypeError\b|\[object Object\]|Failed to fetch|Cannot read|\bundefined\b/

/** 1080×1920 下舞台 scale=1，断言用视口像素即可，不必再除 scale。 */
const KIOSK_VIEWPORT = { width: 1080, height: 1920 } as const

const RENDER_SURFACE =
  'main, [data-kiosk-screen], [data-w2-page], .w4-page-frame, [role="presentation"], [data-kiosk-capability-gate], [data-v6-page], h1'

function collectRuntimeErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
  page.on('requestfailed', (request) => {
    if (request.resourceType() === 'document') {
      errors.push(`document request failed: ${request.url()} (${request.failure()?.errorText ?? 'unknown'})`)
    }
  })
  return errors
}

function registerSweepApi(api: ApiRouter, pattern: SweepCase['pattern']): void {
  registerW6Api(api)
  // 离线页会每 10s 探测 /health；给 503 让它停在本页，而不是被 200 带走。
  if (pattern === '/error-offline') {
    api.respond('GET', '/api/v1/health', {
      status: 503,
      json: { success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'offline' } },
    })
  }
}

async function assertPageRendered(page: Page, pattern: string): Promise<void> {
  await expect(
    page.locator('[data-kiosk-screen="route-error"]'),
    `${pattern} 不得落到路由错误页（白屏/抛错的失败态）`,
  ).toHaveCount(0)

  const surface = page.locator(RENDER_SURFACE).first()
  await expect(surface, `${pattern} 必须渲染出可见内容，不能是空壳`).toBeVisible({ timeout: 15_000 })

  const bodyText = (await page.locator('body').innerText()).replace(/\s+/g, ' ').trim()
  expect(bodyText.length, `${pattern} 正文过短，疑似白屏`).toBeGreaterThan(20)
  const scannedCopy = bodyText.replace(ALLOWED_APPLY_COPY, '')
  expect(scannedCopy, `${pattern} 出现合规禁词`).not.toMatch(FORBIDDEN_APPLY_COPY)
  expect(bodyText, `${pattern} 出现英文技术串`).not.toMatch(TECH_LEAK)
}

test.describe('Kiosk route sweep（mock 口径）', () => {
  test('扫描清单覆盖 productionRoutePatterns 每一条 @kiosk', () => {
    expect(sweepCases.map((route) => route.pattern)).toEqual([...productionRoutePatterns])
    expect(paramSampleKeys().sort()).toEqual([...parameterizedPatterns].sort())
    expect(sweepCases.length).toBe(productionRoutePatterns.length)
  })

  for (const route of sweepCases) {
    test(`${route.pattern} 渲染出内容且无运行时错误 @kiosk`, async ({ page, api }) => {
      const viewport = page.viewportSize()
      expect(viewport, '一体机扫描必须跑在 1080×1920（舞台 scale=1）').toEqual(KIOSK_VIEWPORT)

      registerSweepApi(api, route.pattern)
      const runtimeErrors = collectRuntimeErrors(page)

      await page.goto(route.url, { waitUntil: 'domcontentloaded' })
      await expect(page).toHaveURL((url) => url.pathname === route.landedPath, { timeout: 15_000 })
      await assertPageRendered(page, route.pattern)
      expect(runtimeErrors, `${route.pattern} 不得产生 pageerror 或 document 请求失败`).toEqual([])
    })
  }
})
