import type { Locator, Page } from '@playwright/test'
import type { ApiRouter } from '../fixtures/api-router'
import { expect, test } from '../fixtures/kiosk-test'
import { assertNoHorizontalOverflow } from './assert-layout'

function homeFair(): Record<string, unknown> {
  const startTime = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
  const endTime = new Date(startTime.getTime() + 8 * 60 * 60 * 1000)
  return {
    id: 'qx-home-fair',
    name: '2026 青岛秋季高校毕业生招聘会',
    organizer: '青岛市公共就业服务中心',
    startTime: startTime.toISOString(),
    endTime: endTime.toISOString(),
    venue: '青岛国际会展中心',
    status: 'upcoming',
    sourceOrgId: 'source-qx',
    externalId: 'external-qx-home-fair',
    sourceName: '青岛公共就业服务网',
    sourceUrl: 'https://jobs.example.gov.cn/fairs/qx-home-fair',
    syncTime: '2026-09-07T00:00:00.000Z',
    hasManagedData: false,
    managedCompanyCount: 0,
    managedMaterialCount: 0,
    dataSourceNote: '招聘会信息由官方来源提供。',
  }
}

function registerHomeApi(api: ApiRouter, fairs: unknown[] = [homeFair()]): void {
  // 本套件最后一步会点主 CTA 进 /assistant，助手页挂载即请求语音能力。
  // 不 stub 的话，fixture 拆卸时会以「未处理请求」判失败——那是竞态不是缺陷。
  api.respond('GET', '/api/v1/mock-interviews/capabilities/voice', {
    status: 200,
    json: { asrEnabled: false, ttsEnabled: false },
  })
  api.respond('GET', '/api/v1/terminals/KSK-001/screensaver', {
    status: 200,
    json: { enabled: false, idleTimeoutSec: 180, items: [] },
  })
  api.respond('GET', '/api/v1/terminals/KSK-001/printer-status', {
    status: 200,
    json: { printerStatus: null, isOnline: true },
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
      configVersion: 'qx-home-e2e',
      refreshIntervalMs: 300000,
      serverTime: '2026-09-07T00:00:00.000Z',
    },
  })
  api.respond('GET', '/api/v1/job-fairs', {
    status: 200,
    json: { data: fairs, pagination: { page: 1, pageSize: 20, total: fairs.length, totalPages: fairs.length ? 1 : 0 } },
  })
}

async function expectTouchFloor(locator: Locator, minimumCssHeight: number): Promise<void> {
  const scale = await locator.first().evaluate((element) => {
    const host = element.closest('[data-kiosk-stage-fit]') as HTMLElement | null
    if (host?.dataset.kioskStageFit === 'off') return 1
    const stage = element.closest('.kiosk-stage') as HTMLElement | null
    if (!stage) return 1
    const rect = stage.getBoundingClientRect()
    return rect.width / 1080 || 1
  })
  const count = await locator.count()
  expect(count).toBeGreaterThan(0)
  for (let index = 0; index < count; index += 1) {
    const target = locator.nth(index)
    if (!(await target.isVisible())) continue
    await target.scrollIntoViewIfNeeded()
    const box = await target.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.width / scale).toBeGreaterThanOrEqual(48)
    expect(box!.height / scale).toBeGreaterThanOrEqual(minimumCssHeight)
    const hitTested = await target.evaluate((element) => {
      const rect = element.getBoundingClientRect()
      // 圆角元素的四角在几何上不在元素内：半径 r 时，距角 3px 的点会落到外面，
      // elementFromPoint 必然命中别人。按实际圆角算最小内缩——
      // 45° 方向要退 r(1-√2/2) 才回到圆弧内侧，再留 2px 余量。
      const radius = Number.parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0
      const effectiveRadius = Math.min(radius, rect.width / 2, rect.height / 2)
      const cornerInset = effectiveRadius * (1 - Math.SQRT1_2) + 2
      const inset = Math.max(Math.min(3, rect.width / 4, rect.height / 4), cornerInset)
      const points = [
        [rect.left + inset, rect.top + inset],
        [rect.right - inset, rect.top + inset],
        [rect.left + inset, rect.bottom - inset],
        [rect.right - inset, rect.bottom - inset],
        [rect.left + rect.width / 2, rect.top + rect.height / 2],
      ]
      let pointerEvents = 0
      const onPointerDown = () => { pointerEvents += 1 }
      element.addEventListener('pointerdown', onPointerDown)
      const allHit = points.every(([x, y]) => {
        const hit = document.elementFromPoint(x, y)
        if (hit == null || (hit !== element && !element.contains(hit))) return false
        hit.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y }))
        return true
      })
      element.removeEventListener('pointerdown', onPointerDown)
      return allHit && pointerEvents === points.length
    })
    expect(hitTested).toBe(true)
  }
}

function collectRuntimeErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('requestfailed', (request) => {
    if (['document', 'script', 'stylesheet'].includes(request.resourceType())) {
      errors.push(`${request.resourceType()}: ${request.url()}`)
    }
  })
  return errors
}

test('home uses the Qingxu frame, honest states, and real destinations @w1-kiosk', async ({ page, api }) => {
  const runtimeErrors = collectRuntimeErrors(page)
  registerHomeApi(api)
  const fairRequest = page.waitForRequest((request) => new URL(request.url()).pathname === '/api/v1/job-fairs')

  await page.goto('/', { waitUntil: 'domcontentloaded' })
  const fairRequestUrl = new URL((await fairRequest).url())

  const home = page.getByTestId('qx-home')
  await expect(home).toBeVisible()
  await expect(page.locator('[data-qx-frame="true"]')).toBeVisible()
  await expect(page.locator('.ui-kiosk-topbar')).toHaveCount(0)
  await expect(page.locator('.ui-kiosk-nav')).toHaveCount(0)
  await expect(page.locator('.ui-kiosk-shell')).not.toHaveClass(/kiosk-home-mobile/)
  await expect(page.getByText('状态未知', { exact: true }).first()).toBeVisible()
  await expect(home.getByText('2026 青岛秋季高校毕业生招聘会', { exact: true })).toBeVisible()
  expect(fairRequestUrl.searchParams.get('terminalId')).toBe('KSK-001')
  await expect(home.getByText('这台机器上没有待继续的办理')).toBeVisible()
  await expect(home.getByRole('button', { name: /百宝箱/ })).toBeDisabled()
  await expect(home.getByRole('button', { name: /智慧校园/ })).toBeDisabled()
  await expect(home.getByRole('button', { name: /更多服务/ })).toBeDisabled()
  await expect(home.getByRole('button', { name: /查看全部服务/ })).toBeDisabled()
  await expect(home.getByRole('button', { name: /没有待继续的办理/ })).toBeDisabled()
  await expect(home.getByText('本终端仅展示与跳转，不代收简历', { exact: false })).toBeVisible()
  await expect(home.getByRole('link', { name: '鲁ICP备2026023517号-2' })).toHaveAttribute('href', 'https://beian.miit.gov.cn/')
  await expect(home.getByRole('link', { name: '鲁公网安备37021402007308号' })).toHaveAttribute('href', /beian\.mps\.gov\.cn/)

  const primary = home.getByTestId('home-primary')
  await expectTouchFloor(primary, 56)
  await expectTouchFloor(home.locator('button:visible, a:visible'), 48)
  await primary.click()
  await expect(page).toHaveURL(/\/assistant$/)
  expect(runtimeErrors).toEqual([])
})

test('home exposes an honest job-fair error and a real retry @w1-kiosk', async ({ page, api }) => {
  registerHomeApi(api)
  api.abort('GET', '/api/v1/job-fairs', 'internetdisconnected')

  await page.goto('/', { waitUntil: 'domcontentloaded' })

  const retry = page.getByTestId('qx-home').getByRole('button', { name: /招聘会.*重新加载/ })
  await expect(retry).toBeVisible()
  await expect(retry.getByText('读取失败', { exact: true })).toBeVisible()
  await expect(retry.getByText('没有使用缓存或示例数据，请稍后重试。', { exact: true })).toBeVisible()
  expect(api.requestCount('GET', '/api/v1/job-fairs')).toBe(1)
  const retryRequest = page.waitForRequest((request) => new URL(request.url()).pathname === '/api/v1/job-fairs')
  await retry.click()
  expect(new URL((await retryRequest).url()).searchParams.get('terminalId')).toBe('KSK-001')
  await expect.poll(() => api.requestCount('GET', '/api/v1/job-fairs')).toBe(2)
})

test('home keeps one shell and a usable narrow layout @w1-mobile', async ({ page, api }) => {
  const runtimeErrors = collectRuntimeErrors(page)
  registerHomeApi(api)

  await page.goto('/', { waitUntil: 'domcontentloaded' })

  await expect(page.getByTestId('qx-home')).toBeVisible()
  await expect(page.locator('[data-qx-frame="true"]')).toHaveCount(1)
  await expect(page.locator('.ui-kiosk-topbar')).toHaveCount(0)
  await expect(page.locator('.ui-kiosk-nav')).toHaveCount(0)
  await expect(page.locator('.ui-kiosk-shell')).not.toHaveClass(/kiosk-home-mobile|v6-runtime-shell/)
  await assertNoHorizontalOverflow(page)
  await expectTouchFloor(page.getByTestId('qx-home').locator('button:visible, a:visible'), 48)
  expect(runtimeErrors).toEqual([])
})
