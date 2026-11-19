import type { Page } from '@playwright/test'
import type { ApiRouter, JsonResponse } from '../fixtures/api-router'
import { test, expect } from '../fixtures/kiosk-test'
import { machinePricing } from '../fixtures/machine-pricing'
import { RECRUITMENT_HOSTING_OFF, terminalConfigWithHosting } from '../fixtures/recruitment-hosting'

// 首页顶栏胶囊遇到打印机卡纸时写什么（S15c8 的 homeBandStatus 与 HomePage 接线；S15c9 收货条件 C1）。
// 放在 W2：这套构建带本机网桥令牌，本机程序不在时探针判「连不上」，才走得到「卡纸不被盖成状态未知」那一支。
// 不带令牌的构建里探针是「未配置」，HomePage 把 errorCode 接成 null 也照样写卡纸，这几条就红不了。
// 终端配置按我方云上默认（托管 a）：招聘内容托管关、向个人收费关、本机价全是 0。

const PRINTER_STATUS = '/api/v1/terminals/KSK-001/printer-status'
const PROBE = 'http://127.0.0.1:9527/local/usb/status'

/** 我方云上默认的终端配置：服务端没设 RECRUITMENT_CONTENT_HOSTING_ENABLED、没开向个人收费时下发的样子。 */
function cloudDefaultTerminalConfig(): Record<string, unknown> {
  return {
    ...terminalConfigWithHosting(RECRUITMENT_HOSTING_OFF, 'home-printer-jam-cloud-default'),
    pricing: { ...machinePricing(0, 0), personalChargeEnabled: false, userChargeMode: 'org_pays' },
  }
}

function homeApi(api: ApiRouter, printer: JsonResponse): void {
  api.respond('GET', '/api/v1/terminals/KSK-001/config', { status: 200, json: cloudDefaultTerminalConfig() })
  api.respond('GET', '/api/v1/mock-interviews/capabilities/voice', { status: 200, json: { asrEnabled: false, ttsEnabled: false } })
  api.respond('GET', '/api/v1/terminals/KSK-001/screensaver', { status: 200, json: { enabled: false, idleTimeoutSec: 180, items: [] } })
  api.respond('GET', PRINTER_STATUS, printer)
}

const JAM: JsonResponse = { status: 200, json: { printerStatus: 'paper_jam', isOnline: true } }

const capsule = (page: Page) => page.locator('[data-testid="qx-home"] .qxt-status')

/**
 * 本机程序不在：探针请求被拒连。打开首页后等探针真的失败，再留一点时间让顶栏按「连不上」重画，
 * 之后才断言——探针判完之前顶栏本来就会写卡纸，那时断言证明不了接线。
 */
async function openHomeWithAgentDown(page: Page): Promise<void> {
  await page.route(PROBE, (route) => route.abort('connectionrefused'))
  const probed = page.waitForEvent('requestfailed', (request) => request.url() === PROBE)
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('qx-home')).toBeVisible()
  await probed
  await page.waitForTimeout(1_500)
}

test('home jam: public paper_jam with the local agent down still reads 打印机卡纸 in amber @w2', async ({ page, api }) => {
  homeApi(api, JAM)
  await openHomeWithAgentDown(page)
  await expect(capsule(page)).toHaveText('打印机卡纸')
  // 和打印失败页同一句「打印机卡纸」同一档琥珀色（--qxt-warn-*），不是偏红的 bad 档。
  await expect(capsule(page)).toHaveClass(/\bqxt-status-warn\b/)
  await expect(capsule(page)).not.toHaveClass(/\bqxt-status-bad\b/)
})

test('home jam: ready with the local agent down keeps 状态未知 @w2', async ({ page, api }) => {
  homeApi(api, { status: 200, json: { printerStatus: 'ready', isOnline: true } })
  await openHomeWithAgentDown(page)
  await expect(capsule(page)).toHaveText('状态未知')
})

test('home jam: paper_empty with the local agent down keeps 状态未知 @w2', async ({ page, api }) => {
  homeApi(api, { status: 200, json: { printerStatus: 'paper_empty', isOnline: true } })
  await openHomeWithAgentDown(page)
  await expect(capsule(page)).toHaveText('状态未知')
})

test('home jam: printer status HTTP 500 reads 服务暂时连不上, never a jam @w2', async ({ page, api }) => {
  homeApi(api, { status: 500, json: { error: { message: 'boom' } } })
  await openHomeWithAgentDown(page)
  await expect(capsule(page)).toHaveText('服务暂时连不上')
})

test('home jam: a status request that never returns reads 设备检查中, then 服务暂时连不上; a late jam does not rewrite it @w2', async ({ page, api }) => {
  test.setTimeout(60_000)
  homeApi(api, JAM)
  api.respondWith('GET', PRINTER_STATUS, async () => {
    await new Promise((resolve) => setTimeout(resolve, 11_000))
    return JAM
  })
  await page.route(PROBE, (route) => route.abort('connectionrefused'))
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('qx-home')).toBeVisible()
  await page.waitForTimeout(1_500)
  await expect(capsule(page)).toHaveText('设备检查中')
  await expect(capsule(page)).toHaveText('服务暂时连不上', { timeout: 12_000 })
  await page.waitForTimeout(4_000)
  await expect(capsule(page)).toHaveText('服务暂时连不上')
})

test('home jam: public paper_jam with the local agent reachable reads 打印机卡纸 @w2', async ({ page, api }) => {
  homeApi(api, JAM)
  await page.route(PROBE, async (route) => {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
    }
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors })
      return
    }
    await route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ success: true, data: {} }) })
  })
  const probed = page.waitForResponse((response) => response.url() === PROBE && response.request().method() === 'GET')
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('qx-home')).toBeVisible()
  await probed
  await page.waitForTimeout(1_500)
  await expect(capsule(page)).toHaveText('打印机卡纸')
})

test('home jam: our cloud default config shows no 社会招聘 or 校园招聘 tile @w2', async ({ page, api }) => {
  homeApi(api, JAM)
  await openHomeWithAgentDown(page)
  const home = page.getByTestId('qx-home')
  // 托管关的答复已经到了（不是「还没读到」时的默认关）：底部合规句说本终端未开放。
  await expect(home.getByText('本终端未开放岗位与招聘会信息，也不代收简历。', { exact: false })).toBeVisible()
  await expect(home).toHaveAttribute('data-recruitment', 'closed')
  for (const action of ['jobs-hub', 'jobs-retry', 'fairs-retry', 'campus-zone']) {
    await expect(home.locator(`[data-action="${action}"]`), `我方云上默认不摆 ${action}`).toHaveCount(0)
  }
  await expect(home.getByRole('button', { name: /社会招聘/ })).toHaveCount(0)
  await expect(home.getByRole('button', { name: /校园招聘/ })).toHaveCount(0)
  const tiles = await home.locator('.qxt-home-tiles > [data-action]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-action')))
  expect(tiles).toEqual(['pickup-claim', 'help'])
  await expect(capsule(page)).toHaveText('打印机卡纸')
})
