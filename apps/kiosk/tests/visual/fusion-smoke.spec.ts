import type { Page } from '@playwright/test'
import { test, expect } from '../fixtures/kiosk-test'
import { assertNoHorizontalOverflow } from './assert-layout'
import { productionRoutePatterns } from './route-manifest'

const kioskScenarios = [
  { path: '/session-timeout', landmark: '还在使用吗？' },
  { path: '/error-offline', landmark: '网络连接中断', registerHealthProbe: true },
] as const

const mobileScenarios = [
  { path: '/member/qr-login', landmark: '暂时无法确认登录' },
  { path: '/upload/phone', landmark: '上传链接已失效' },
] as const

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

async function assertHomeFilingInfo(page: Page) {
  const filingInfo = page.getByRole('contentinfo', { name: '网站备案信息' })
  await expect(filingInfo).toBeVisible()
  await expect(filingInfo.getByRole('link', { name: '鲁ICP备2026023517号-2' })).toHaveAttribute(
    'href',
    'https://beian.miit.gov.cn/',
  )
  await expect(filingInfo.getByRole('link', { name: '鲁公网安备37021402007308号' })).toHaveAttribute(
    'href',
    'https://beian.mps.gov.cn/#/query/webSearch?code=37021402007308',
  )
  await expect(filingInfo.getByText('职易达AI', { exact: true })).toBeVisible()
}

for (const projectTag of ['@kiosk', '@mobile'] as const) {
  test(`home renders filing information ${projectTag}`, async ({ page, api }) => {
    void api
    const runtimeErrors = collectRuntimeErrors(page)

    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await assertHomeFilingInfo(page)
    await assertNoHorizontalOverflow(page)
    expect(runtimeErrors).toEqual([])
  })
}

for (const scenario of kioskScenarios) {
  test(`${scenario.path} renders the fusion state @kiosk`, async ({ page, api }) => {
    expect(productionRoutePatterns).toContain(scenario.path)
    const runtimeErrors = collectRuntimeErrors(page)

    if ('registerHealthProbe' in scenario && scenario.registerHealthProbe) {
      api.respond('GET', '/api/v1/health', {
        status: 503,
        json: { success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'offline' } },
      })
    }

    await page.goto(scenario.path, { waitUntil: 'domcontentloaded' })
    await expect(page.locator('main')).toBeVisible()
    await expect(page.getByText(scenario.landmark, { exact: false }).first()).toBeVisible()
    await assertNoHorizontalOverflow(page)
    expect(runtimeErrors).toEqual([])
  })
}

for (const scenario of mobileScenarios) {
  test(`${scenario.path} renders the fusion state @mobile`, async ({ page, api }) => {
    void api
    expect(productionRoutePatterns).toContain(scenario.path)
    const runtimeErrors = collectRuntimeErrors(page)

    await page.goto(scenario.path, { waitUntil: 'domcontentloaded' })
    await expect(page.locator('main')).toBeVisible()
    await expect(page.getByText(scenario.landmark, { exact: false }).first()).toBeVisible()
    await assertNoHorizontalOverflow(page)
    expect(runtimeErrors).toEqual([])
  })
}
