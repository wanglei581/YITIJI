import type { Page } from '@playwright/test'
import { test, expect } from '../fixtures/kiosk-test'
import type { ApiRouter } from '../fixtures/api-router'
import { assertNoHorizontalOverflow } from './assert-layout'
import { productionRoutePatterns } from './route-manifest'

const kioskScenarios = [
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

function registerHomeShellApi(api: ApiRouter) {
  api.respond('GET', '/api/v1/terminals/KSK-001/config', {
    status: 200,
    json: {
      smartCampus: {
        enabled: false,
        modules: { welcome: false, bigdata: false, luggage: false, panorama: false },
        items: [],
      },
      toolbox: { enabled: false, items: [] },
      configVersion: 'filing-smoke-fixture',
      refreshIntervalMs: 300000,
      serverTime: '2026-07-28T00:00:00.000Z',
    },
  })
  api.respond('GET', '/api/v1/terminals/KSK-001/printer-status', {
    status: 200,
    json: { printerStatus: 'ready', paperLevel: 'sufficient', isOnline: true },
  })
  api.respond('GET', '/api/v1/terminals/KSK-001/screensaver', {
    status: 200,
    json: { enabled: false, idleTimeoutSec: 180, items: [] },
  })
  api.respond('GET', '/api/v1/terminals/KSK-001/smart-campus', {
    status: 200,
    json: {
      enabled: false,
      modules: { welcome: false, bigdata: false, luggage: false, panorama: false },
      items: [],
    },
  })
  // V6 首页会真实请求招聘会列表；给精确的 200 空列表，让首页呈现诚实 empty 态。
  // 其余未注册 API 仍由 ApiRouter fail-closed。
  api.respond('GET', '/api/v1/job-fairs', {
    status: 200,
    json: { data: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 } },
  })
}

function registerPrivacyRuntimeApi(api: ApiRouter) {
  api.respond('GET', '/api/v1/terminals/KSK-001/screensaver', {
    status: 200,
    json: { enabled: false, idleTimeoutSec: 180, items: [] },
  })
}

async function assertHelpCenterFilingInfo(page: Page) {
  const filingInfo = page.locator('[aria-label="网站备案信息"]')
  await expect(filingInfo).toBeVisible()
  await expect(filingInfo.getByRole('link', { name: '鲁ICP备2026023517号-2' })).toHaveAttribute(
    'href',
    'https://beian.miit.gov.cn/',
  )
  await expect(filingInfo.getByRole('link', { name: '鲁公网安备37021402007308号' })).toHaveAttribute(
    'href',
    'https://beian.mps.gov.cn/#/query/webSearch?code=37021402007308',
  )
  await expect(filingInfo).toContainText('职易达AI')
}

test('orphan /session-timeout fails closed to a clean home @kiosk', async ({ page, api }) => {
  expect(productionRoutePatterns).toContain('/session-timeout')
  registerHomeShellApi(api)
  const runtimeErrors = collectRuntimeErrors(page)

  await page.goto('/session-timeout', { waitUntil: 'domcontentloaded' })

  await expect(page).toHaveURL(/\/$/)
  const homeMain = page.locator('main').first()
  await expect(homeMain).toBeVisible()
  // 断言意图是「已落到干净首页」，不是锁定某句营销文案。V6 首页不再有
  // 「简历、岗位、打印」，改用首页底部的合规声明作锚点：它是 CLAUDE.md §2/§10
  // 强制要求必须出现的文本，稳定且不会随视觉改版消失，断言它同时守住合规底线。
  await expect(
    page.getByText('本终端仅展示与跳转，不代收简历', { exact: false }).first()
  ).toBeVisible()
  await expect(page.locator('[data-kiosk-screen="session-timeout"]')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '还在使用吗？', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '继续使用', exact: true })).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: '立即退出并清除本机会话', exact: true })
  ).toHaveCount(0)
  await assertNoHorizontalOverflow(page)
  expect(runtimeErrors).toEqual([])
})

for (const projectTag of ['@kiosk', '@mobile'] as const) {
  test(`help center renders filing information ${projectTag}`, async ({ page, api }) => {
    registerHomeShellApi(api)
    const runtimeErrors = collectRuntimeErrors(page)

    await page.goto('/help', { waitUntil: 'domcontentloaded' })
    await assertHelpCenterFilingInfo(page)
    await assertNoHorizontalOverflow(page)
    expect(runtimeErrors).toEqual([])
  })
}

for (const scenario of kioskScenarios) {
  test(`${scenario.path} renders the fusion state @kiosk`, async ({ page, api }) => {
    expect(productionRoutePatterns).toContain(scenario.path)
    registerPrivacyRuntimeApi(api)
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
