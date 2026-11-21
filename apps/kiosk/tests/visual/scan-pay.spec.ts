/**
 * 扫描按次付款接线浏览器回归（P2e-4）：
 * 1. 两条建会话路径前付款：面板扫描（ScanHowPage）与屏上扫描（ScanDeviceSettingsPage），
 *    收费出「付 X.XX 元开始扫描」+ 稿 359 说明条，全 0 / 公共点位 / 读不到价保持原样；
 * 2. 付成后自动回原步骤并建会话，断言 POST /scan/sessions 带 x-kiosk-session-id 与 x-service-order-id；
 * 3. 重扫（X-Scan-Retry-Control）与响应丢失重放（scanCreateReplay.ts）带同一个订单号；
 * 4. 409 SERVICE_ORDER_IN_USE 按「接着这一次」处理绝不让再付；402 SERVICE_PAYMENT_REQUIRED 回付款屏；
 * 5. 结果页：失败已付可免费再试 → 「免费再试一次」+ 单独一行 RETRY 句；退款中/已退/失败照状态说
 *    （未 refunded 绝不写「已退」）；成功已付写稿 376 行并取订单 amountCents；没付过的完成页不标价。
 */
import type { Page, Request } from '@playwright/test'
import type { ApiRouter } from '../fixtures/api-router'
import { expect, test } from '../fixtures/kiosk-test'
import {
  KIOSK_CONFIG_PATH,
  allFreeMachinePricing,
  publicSiteMachinePricing,
  scanOnlyChargedPricing,
} from '../fixtures/machine-pricing'
import {
  ORDER_SCAN,
  SERVICE_ORDERS_PATH,
  apiError,
  ok,
  recordServiceOrderCalls,
  serviceOrderClosePath,
  serviceOrderPath,
  serviceOrderView,
  serviceOrderViewByState,
  type FixtureOrder,
  type FixtureOrderStateKind,
} from '../fixtures/service-orders'
import { registerW6Api } from './fixtures/fusion-w6-api'
import { W2_FILE, writeScanWorkbenchSession } from './fixtures/fusion-w2-state'
import { routeVisiblePdf, spaGo } from './fixtures/touch-pair-shell'

const TRIP_KEY = 'ai-job-print:service-trip:v1'
const BAR_DESC = '扫描。付好了才建立这次扫描。没扫成可免费再试一次；再不成，钱自动退回原付款账户，到账时间以支付渠道为准。打印另按页计价。'
const RETRY_LINE = '这一次没做成。可以免费再试一次；不试了或再不成，钱自动退回原付款账户，到账时间以支付渠道为准。'

const SCAN_FILE = {
  fileId: 'scan-pay-file-1',
  fileUrl: W2_FILE.fileUrl,
  name: '简历扫描件.pdf',
  size: '128 KB',
  pages: 1,
  format: 'PDF',
  mimeType: 'application/pdf',
}

interface ScanCreateRecord {
  headers: Record<string, string>
  body: Record<string, unknown> | null
}

function recordScanCreates(page: Page): ScanCreateRecord[] {
  const list: ScanCreateRecord[] = []
  page.on('request', (request: Request) => {
    if (request.method() !== 'POST') return
    if (new URL(request.url()).pathname !== '/api/v1/scan/sessions') return
    let body: Record<string, unknown> | null = null
    try {
      body = request.postDataJSON() as Record<string, unknown> | null
    } catch {
      body = null
    }
    list.push({ headers: request.headers(), body })
  })
  return list
}

function registerScanCapabilities(api: ApiRouter, screen: 'available' | 'off'): void {
  const capabilities = [
    { capabilityKey: 'scan', status: 'available', note: null, configured: true, updatedAt: '2026-11-21T00:00:00.000Z' },
  ]
  if (screen === 'available') {
    capabilities.push({
      capabilityKey: 'scan_device',
      status: 'available',
      note: null,
      configured: true,
      updatedAt: '2026-11-21T00:00:00.000Z',
    })
  }
  api.respond('GET', '/api/v1/terminals/KSK-001/capabilities', {
    status: 200,
    json: { capabilities },
  })
}

async function routeLocalScannerReady(page: Page): Promise<void> {
  await page.route('http://127.0.0.1:9527/local/scan/**', async (route) => {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    }
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors })
      return
    }
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/probe')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: cors,
        body: JSON.stringify({ success: true, data: { state: 'ready', pageCount: 0, errorCode: null } }),
      })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: cors,
      body: JSON.stringify({ success: true, data: { state: 'scanning', pageCount: 0, errorCode: null } }),
    })
  })
}

function setPricing(api: ApiRouter, pricing: Record<string, unknown> | null): void {
  api.mapJson('GET', KIOSK_CONFIG_PATH, (json) => {
    const base = json && typeof json === 'object' ? { ...(json as Record<string, unknown>) } : {}
    if (pricing === null) {
      delete base.pricing
      return base
    }
    return { ...base, pricing }
  })
}

function registerPricing(api: ApiRouter, pricing: Record<string, unknown> | null): void {
  registerW6Api(api)
  setPricing(api, pricing)
}

function registerScanOrder(
  api: ApiRouter,
  order: FixtureOrder,
  view: (n: number) => Record<string, unknown>,
): void {
  api.respondWith('POST', SERVICE_ORDERS_PATH, () => ok(serviceOrderView(order)))
  api.respondWith('GET', serviceOrderPath(order.id), (n) => ok(view(n)))
  api.respondWith('POST', serviceOrderClosePath(order.id), () => ok(serviceOrderView(order, { status: 'closed', closeReason: 'user_cancelled' })))
}

async function seedScanTrip(page: Page, orderId: string, kioskSessionId = 'kiosk-scan-pay-sess-001'): Promise<void> {
  await page.evaluate(
    ([key, value]) => window.sessionStorage.setItem(key, value),
    [
      TRIP_KEY,
      JSON.stringify({
        v: 1,
        trips: {
          scan: {
            serviceKey: 'scan',
            orderId,
            kioskSessionId,
            owner: { kind: 'guest' },
            savedAt: Date.now(),
          },
        },
      }),
    ],
  )
}

async function enterHowFromStart(page: Page, material: 'resume' | 'document' = 'resume'): Promise<void> {
  await page.goto('/scan?stage=start')
  await expect(page.getByRole('heading', { name: '扫什么？' })).toBeVisible()
  await page.getByTestId(`scan-workbench-type-${material}`).click()
  await page.getByRole('button', { name: '下一步', exact: true }).click()
  await expect(page.locator('[data-scan-stage="how"]')).toBeVisible()
}

function expectNoBannedTokens(text: string): void {
  expect(text).not.toContain('¥')
  expect(text).not.toContain('工作人员')
  expect(text).not.toContain('微信或支付宝')
}

test.describe('扫描按次付款接线 @kiosk', () => {
  test('两条建会话路径：扫描 1.00 元各出「付 1.00 元开始扫描」与说明条；全 0 / 公共点位 / 读不到价照原样 @kiosk', async ({ page, api }) => {
    registerPricing(api, scanOnlyChargedPricing(100))
    registerScanCapabilities(api, 'available')
    await routeLocalScannerReady(page)
    const creates = recordScanCreates(page)

    await enterHowFromStart(page, 'resume')
    // 默认选屏上扫描：此时「下一步」去放纸设置、还不建会话，不出付款按钮
    await expect(page.getByRole('button', { name: '下一步', exact: true })).toBeVisible()
    await expect(page.getByTestId('scan-pay-bar')).toHaveCount(0)

    // 路径 1（面板扫描）：切到「到打印机面板上扫」，主按钮变「付 1.00 元开始扫描」并出稿 359 说明条
    await page.getByTestId('scan-way-panel').click()
    await expect(page.getByRole('button', { name: '付 1.00 元开始扫描' })).toBeVisible()
    await expect(page.getByTestId('scan-pay-bar')).toContainText('这一次 1.00 元')
    await expect(page.getByTestId('scan-pay-bar')).toContainText(BAR_DESC)
    expectNoBannedTokens(await page.locator('body').innerText())

    // 路径 2（屏上扫描）：切回屏上扫描进放纸设置，主按钮变「付 1.00 元开始扫描」并出说明条
    await page.getByTestId('scan-way-screen').click()
    await page.getByRole('button', { name: '下一步', exact: true }).click()
    await expect(page.locator('[data-scan-stage="device-settings"]')).toBeVisible()
    await expect(page.getByTestId('scan-device-start')).toHaveText('付 1.00 元开始扫描')
    await expect(page.getByTestId('scan-pay-bar')).toContainText('这一次 1.00 元')
    await expect(page.getByTestId('scan-pay-bar')).toContainText(BAR_DESC)
    expectNoBannedTokens(await page.locator('body').innerText())
    expect(creates).toHaveLength(0)

    // 全 0 免费机：两条路都不出付款按钮
    setPricing(api, allFreeMachinePricing())
    await enterHowFromStart(page, 'resume')
    await page.getByTestId('scan-way-panel').click()
    await expect(page.getByRole('button', { name: '下一步', exact: true })).toBeVisible()
    await expect(page.getByTestId('scan-pay-bar')).toHaveCount(0)
    await page.getByTestId('scan-way-screen').click()
    await page.getByRole('button', { name: '下一步', exact: true }).click()
    await expect(page.getByTestId('scan-device-start')).toHaveText('开始扫描')
    await expect(page.getByTestId('scan-pay-bar')).toHaveCount(0)

    // 公共点位：即使 effective.scan=100 也不出付款按钮
    setPricing(api, publicSiteMachinePricing({ scan: 100 }))
    await enterHowFromStart(page, 'resume')
    await page.getByTestId('scan-way-panel').click()
    await expect(page.getByRole('button', { name: '下一步', exact: true })).toBeVisible()
    await expect(page.getByTestId('scan-pay-bar')).toHaveCount(0)

    // 读不到价（缺少 pricing）：两条路照原样
    setPricing(api, null)
    await enterHowFromStart(page, 'resume')
    await page.getByTestId('scan-way-screen').click()
    await page.getByRole('button', { name: '下一步', exact: true }).click()
    await expect(page.getByTestId('scan-device-start')).toHaveText('开始扫描')
    await expect(page.getByTestId('scan-pay-bar')).toHaveCount(0)
  })

  test('面板扫描付款接线：点「付 1.00 元开始扫描」→ 付款屏付成 → 回扫描指引自动建会话并带两个头 @kiosk', async ({ page, api }) => {
    registerPricing(api, scanOnlyChargedPricing(100))
    registerScanCapabilities(api, 'off')
    const order = { ...ORDER_SCAN, createdAt: Date.now() }
    registerScanOrder(api, order, (n) => (n <= 1
      ? serviceOrderView(order)
      : serviceOrderViewByState(order, 'paid')))

    const taskId = 'scan-pay-panel-001'
    api.respond('POST', '/api/v1/scan/sessions', {
      status: 200,
      json: {
        success: true,
        data: {
          scanTaskId: taskId,
          controlToken: 'ctrl-panel-001',
          status: 'waiting',
          scanType: 'resume',
          instructions: ['在打印机面板选择扫描', '确认开始发送'],
          expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
        },
      },
    })
    api.respond('POST', `/api/v1/scan/sessions/${taskId}/ack`, {
      status: 200,
      json: { success: true, data: { scanTaskId: taskId, deliveryAckedAt: new Date().toISOString() } },
    })
    api.respond('DELETE', `/api/v1/scan/sessions/${taskId}`, {
      status: 200,
      json: { success: true, data: { scanTaskId: taskId, status: 'cancelled' } },
    })
    const creates = recordScanCreates(page)

    await enterHowFromStart(page, 'resume')
    await expect(page.getByRole('button', { name: '付 1.00 元开始扫描' })).toBeVisible()
    await expect(page.getByTestId('scan-pay-bar')).toContainText('这一次 1.00 元')
    expect(creates).toHaveLength(0)

    await page.getByRole('button', { name: '付 1.00 元开始扫描' }).click()
    await expect(page).toHaveURL(/\/pay\/scan\?next=settings&back=how/)
    expect(creates).toHaveLength(0)

    // 付款屏轮询拿到 paid → 自动进入 /scan?stage=settings 并带两个头建会话
    await expect(page.locator('[data-scan-stage="settings"]')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('扫描任务已创建')).toBeVisible({ timeout: 15_000 })

    expect(creates).toHaveLength(1)
    expect(creates[0]?.headers['x-service-order-id']).toBe(order.id)
    expect(creates[0]?.headers['x-kiosk-session-id']).toMatch(/^[0-9a-f-]{36}$/)
  })

  test('屏上扫描付款接线：点「付 1.00 元开始扫描」→ 付款屏付成 → 自动回放纸设置并带两个头建会话 @kiosk', async ({ page, api }) => {
    registerPricing(api, scanOnlyChargedPricing(100))
    registerScanCapabilities(api, 'available')
    await routeLocalScannerReady(page)
    const order = { ...ORDER_SCAN, createdAt: Date.now() }
    registerScanOrder(api, order, (n) => (n <= 1
      ? serviceOrderView(order)
      : serviceOrderViewByState(order, 'paid')))

    const taskId = 'scan-pay-device-001'
    api.respond('POST', '/api/v1/scan/sessions', {
      status: 200,
      json: {
        success: true,
        data: {
          scanTaskId: taskId,
          controlToken: 'ctrl-device-001',
          status: 'waiting',
          scanType: 'resume',
          instructions: ['放好纸张'],
          expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
        },
      },
    })
    api.respond('POST', `/api/v1/scan/sessions/${taskId}/ack`, {
      status: 200,
      json: { success: true, data: { scanTaskId: taskId, deliveryAckedAt: new Date().toISOString() } },
    })
    api.respond('GET', `/api/v1/scan/sessions/${taskId}`, {
      status: 200,
      json: {
        success: true,
        data: {
          scanTaskId: taskId,
          status: 'waiting',
          scanType: 'resume',
          startMode: 'device',
          source: 'flatbed',
          colorMode: 'color',
          deviceState: 'scanning',
          pageCount: 0,
          file: null,
          errorCode: null,
          errorMessage: null,
        },
      },
    })
    const creates = recordScanCreates(page)

    await enterHowFromStart(page, 'resume')
    await page.getByRole('button', { name: '下一步', exact: true }).click()
    await expect(page.locator('[data-scan-stage="device-settings"]')).toBeVisible()
    await page.getByTestId('scan-source-flatbed').click()
    await page.getByTestId('scan-color-color').click()
    await expect(page.getByTestId('scan-device-start')).toHaveText('付 1.00 元开始扫描')
    expect(creates).toHaveLength(0)

    await page.getByTestId('scan-device-start').click()
    await expect(page).toHaveURL(/\/pay\/scan\?next=device&back=how/)
    expect(creates).toHaveLength(0)

    // 付款屏付成 → 回 /scan?stage=device-settings → 自动续接建会话并进入进度
    await expect(page.locator('[data-scan-stage="progress"]')).toBeVisible({ timeout: 15_000 })
    expect(creates).toHaveLength(1)
    expect(creates[0]?.body).toMatchObject({ startMode: 'device', source: 'flatbed', colorMode: 'color' })
    expect(creates[0]?.headers['x-service-order-id']).toBe(order.id)
    expect(creates[0]?.headers['x-kiosk-session-id']).toMatch(/^[0-9a-f-]{36}$/)
  })

  test('重扫（X-Scan-Retry-Control）与响应丢失重放（scanCreateReplay）带同一个订单号 @kiosk', async ({ page, api }) => {
    registerPricing(api, scanOnlyChargedPricing(100))
    registerScanCapabilities(api, 'off')
    const order = { ...ORDER_SCAN, createdAt: Date.now() }
    const sessionId = 'kiosk-scan-replay-sess-001'
    api.respond('GET', serviceOrderPath(order.id), ok(serviceOrderViewByState(order, 'retry_free')))

    const childTaskId = 'scan-pay-replay-child-001'
    let attempts = 0
    await page.route('**/api/v1/scan/sessions', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.fallback()
        return
      }
      attempts += 1
      if (attempts === 1) {
        // 首次响应丢失（status 0 / NETWORK_ERROR），触发 scanCreateReplay 自动重放
        await route.abort('failed')
        return
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            scanTaskId: childTaskId,
            controlToken: 'prior-ctrl-token-001',
            status: 'waiting',
            scanType: 'resume',
            instructions: ['放回同一份材料', '在面板按开始'],
            expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
          },
        }),
      })
    })
    api.respond('POST', `/api/v1/scan/sessions/${childTaskId}/ack`, {
      status: 200,
      json: { success: true, data: { scanTaskId: childTaskId, deliveryAckedAt: new Date().toISOString() } },
    })
    const creates = recordScanCreates(page)

    await page.goto('/scan?stage=start')
    await seedScanTrip(page, order.id, sessionId)
    await writeScanWorkbenchSession(page, {
      stage: 'result',
      scanType: 'resume',
      live: {
        scanTaskId: 'prior-task-001',
        controlToken: 'prior-ctrl-token-001',
        instructions: ['旧指引'],
        expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      },
      result: { outcome: 'expired', success: false, reason: '等待超时，这次没有拿到文件' },
    })
    await spaGo(page, '/scan?stage=result')
    await expect(page.locator('[data-scan-stage="result"]')).toBeVisible()
    await expect(page.getByRole('button', { name: '免费再试一次' })).toBeVisible()
    await expect(page.getByTestId('scan-result-pay-notice')).toHaveText(RETRY_LINE)

    await page.getByRole('button', { name: '免费再试一次' }).click()
    await expect(page.getByText('扫描任务已创建')).toBeVisible({ timeout: 15_000 })
    expect(page.url()).not.toContain('/pay/scan')
    expect(creates.length).toBe(2)
    for (const call of creates) {
      expect(call.headers['x-scan-retry-control']).toBe('prior-ctrl-token-001')
      expect(call.body?.retryOfScanTaskId).toBe('prior-task-001')
      expect(call.headers['x-service-order-id']).toBe(order.id)
      expect(call.headers['x-kiosk-session-id']).toBe(sessionId)
    }
  })

  test('409 SERVICE_ORDER_IN_USE 两条路均按「接着这一次」处理，绝不让再付 @kiosk', async ({ page, api }) => {
    registerPricing(api, scanOnlyChargedPricing(100))
    registerScanCapabilities(api, 'available')
    await routeLocalScannerReady(page)
    const order = { ...ORDER_SCAN, createdAt: Date.now() }
    const sessionId = 'kiosk-scan-inuse-sess-001'
    api.respond('GET', serviceOrderPath(order.id), ok(serviceOrderViewByState(order, 'consumed')))

    const taskId = 'scan-pay-inuse-ok-001'
    let panelAttempt = 0
    api.respondWith('POST', '/api/v1/scan/sessions', () => {
      panelAttempt += 1
      if (panelAttempt === 1) {
        return {
          status: 409,
          json: {
            success: false,
            error: { code: 'SERVICE_ORDER_IN_USE', message: '这一次已经在进行', consumedRef: 'open-task-1' },
          },
        }
      }
      return {
        status: 200,
        json: {
          success: true,
          data: {
            scanTaskId: taskId,
            controlToken: 'ctrl-inuse-001',
            status: 'waiting',
            scanType: 'resume',
            instructions: ['接着完成面板扫描'],
            expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
          },
        },
      }
    })
    api.respond('POST', `/api/v1/scan/sessions/${taskId}/ack`, {
      status: 200,
      json: { success: true, data: { scanTaskId: taskId, deliveryAckedAt: new Date().toISOString() } },
    })
    const creates = recordScanCreates(page)

    // 1. 面板路径 409 SERVICE_ORDER_IN_USE：不跳付款屏，出「不用再付」与「接着这一次继续」
    await page.goto('/scan?stage=start')
    await seedScanTrip(page, order.id, sessionId)
    await writeScanWorkbenchSession(page, { stage: 'settings', scanType: 'resume' })
    await spaGo(page, '/scan?stage=settings')
    await expect(page.getByRole('heading', { name: '这一次扫描已经在进行' })).toBeVisible()
    await expect(page.locator('body')).toContainText('不用再付')
    expect(page.url()).not.toContain('/pay/scan')
    await expect(page.getByRole('button', { name: '付 1.00 元开始扫描' })).toHaveCount(0)

    await page.getByRole('button', { name: '接着这一次继续' }).click()
    await expect(page.getByText('扫描任务已创建')).toBeVisible({ timeout: 15_000 })
    expect(creates).toHaveLength(2)
    expect(creates[0]?.headers['x-service-order-id']).toBe(order.id)
    expect(creates[1]?.headers['x-service-order-id']).toBe(order.id)

    // 2. 屏上路径 409 SERVICE_ORDER_IN_USE：不跳付款屏、不改回付款按钮、提示不用再付
    api.respond('POST', '/api/v1/scan/sessions', {
      status: 409,
      json: {
        success: false,
        error: { code: 'SERVICE_ORDER_IN_USE', message: '这一次已经在进行', consumedRef: 'open-task-2' },
      },
    })
    await page.goto('/scan?stage=start')
    await seedScanTrip(page, order.id, sessionId)
    await writeScanWorkbenchSession(page, {
      stage: 'device-settings',
      material: 'resume',
      scanType: 'resume',
      deviceChoice: { source: 'feeder', colorMode: 'gray' },
    })
    await spaGo(page, '/scan?stage=device-settings')
    await expect(page.getByTestId('scan-device-start')).toHaveText('开始扫描')
    await page.getByTestId('scan-device-start').click()
    await expect(page.locator('.cs-warn')).toContainText('不用再付')
    expect(page.url()).not.toContain('/pay/scan')
    await expect(page.getByTestId('scan-device-start')).toHaveText('开始扫描')
  })

  test('402 SERVICE_PAYMENT_REQUIRED 两条路兜底回付款屏 @kiosk', async ({ page, api }) => {
    registerPricing(api, scanOnlyChargedPricing(100))
    registerScanCapabilities(api, 'available')
    await routeLocalScannerReady(page)
    const order = { ...ORDER_SCAN, createdAt: Date.now() }
    registerScanOrder(api, order, () => serviceOrderView(order))
    api.respond('POST', '/api/v1/scan/sessions', apiError(402, 'SERVICE_PAYMENT_REQUIRED', '这一次要先付款'))

    // 面板路径直接落设置页触发 402 → 回 /pay/scan
    await page.goto('/scan?stage=start')
    await writeScanWorkbenchSession(page, { stage: 'settings', scanType: 'resume' })
    await spaGo(page, '/scan?stage=settings')
    await expect(page).toHaveURL(/\/pay\/scan\?next=settings&back=how/)

    // 屏上路径带已失单号（但本地尚未查到/服务端拒 402）→ 回 /pay/scan
    api.respond('GET', serviceOrderPath('ord-stale-1'), ok(serviceOrderViewByState(order, 'paid')))
    await page.goto('/scan?stage=start')
    await seedScanTrip(page, 'ord-stale-1', 'sess-stale-1')
    await writeScanWorkbenchSession(page, {
      stage: 'device-settings',
      material: 'resume',
      scanType: 'resume',
      deviceChoice: { source: 'feeder', colorMode: 'gray' },
    })
    await spaGo(page, '/scan?stage=device-settings')
    await expect(page.getByTestId('scan-device-start')).toHaveText('开始扫描')
    await page.getByTestId('scan-device-start').click()
    await expect(page).toHaveURL(/\/pay\/scan\?next=device&back=how/)
  })

  test('结果页：失败已付可免费再试、退款中/已退/退款失败文案，以及屏上失败免费再试带同单 @kiosk', async ({ page, api }) => {
    registerPricing(api, scanOnlyChargedPricing(100))
    registerScanCapabilities(api, 'available')
    await routeLocalScannerReady(page)
    const order = { ...ORDER_SCAN, createdAt: Date.now() }
    const sessionId = 'kiosk-scan-result-fail-sess-001'

    const openFailed = async (
      kind: FixtureOrderStateKind,
      deviceFlow: boolean,
    ): Promise<void> => {
      api.respond('GET', serviceOrderPath(order.id), ok(serviceOrderViewByState(order, kind)))
      await page.goto('/scan?stage=start')
      await seedScanTrip(page, order.id, sessionId)
      await writeScanWorkbenchSession(page, {
        stage: 'result',
        material: 'resume',
        scanType: 'resume',
        deviceChoice: { source: 'feeder', colorMode: 'gray' },
        deviceFlow: deviceFlow ? true : undefined,
        live: {
          scanTaskId: 'fail-task-001',
          controlToken: 'fail-ctrl-001',
          instructions: ['步骤一'],
          expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
        },
        result: { outcome: 'expired', success: false, reason: '等待超时，这次没有拿到文件' },
      })
      await spaGo(page, '/scan?stage=result')
      await expect(page.locator('[data-scan-stage="result"]')).toBeVisible()
    }

    // 1. 面板失败 + retry_free → 「免费再试一次」+ RETRY 句
    await openFailed('retry_free', false)
    await expect(page.getByRole('button', { name: '免费再试一次' })).toBeVisible()
    await expect(page.getByTestId('scan-result-pay-notice')).toHaveText(RETRY_LINE)
    await expect(page.locator('body')).not.toContainText('重试扫描（同一份材料）')

    // 2. 退款中 refunding → 写正在退回，绝不写「已退」，不出「免费再试一次」
    await openFailed('refunding', false)
    await expect(page.getByTestId('scan-result-pay-notice')).toContainText('正在退回原付款账户')
    const refundingText = await page.getByTestId('scan-result-pay-notice').innerText()
    expect(refundingText).not.toContain('已退')
    await expect(page.getByRole('button', { name: '免费再试一次' })).toHaveCount(0)

    // 3. 已退 refunded → 写「钱已退回原付款账户」
    await openFailed('refunded', false)
    await expect(page.getByTestId('scan-result-pay-notice')).toContainText('钱已退回原付款账户')
    await expect(page.getByRole('button', { name: '免费再试一次' })).toHaveCount(0)

    // 4. 退款失败 refund_failed → 绝不写「已退」、不写「工作人员」
    await openFailed('refund_failed', false)
    const failedRefundText = await page.getByTestId('scan-result-pay-notice').innerText()
    expect(failedRefundText).not.toContain('已退')
    expectNoBannedTokens(failedRefundText)

    // 5. 屏上扫描失败 + retry_free → 换「免费再试一次」+ RETRY 句 → 回放纸设置不再出付款按钮并带同一单建会话
    const devTaskId = 'scan-pay-dev-retry-002'
    api.respond('POST', '/api/v1/scan/sessions', {
      status: 200,
      json: {
        success: true,
        data: {
          scanTaskId: devTaskId,
          controlToken: 'ctrl-dev-retry-002',
          status: 'waiting',
          scanType: 'resume',
          instructions: ['放纸'],
          expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
        },
      },
    })
    api.respond('POST', `/api/v1/scan/sessions/${devTaskId}/ack`, {
      status: 200,
      json: { success: true, data: { scanTaskId: devTaskId, deliveryAckedAt: new Date().toISOString() } },
    })
    api.respond('GET', `/api/v1/scan/sessions/${devTaskId}`, {
      status: 200,
      json: {
        success: true,
        data: {
          scanTaskId: devTaskId,
          status: 'waiting',
          scanType: 'resume',
          startMode: 'device',
          source: 'feeder',
          colorMode: 'gray',
          deviceState: 'scanning',
          pageCount: 0,
          file: null,
          errorCode: null,
          errorMessage: null,
        },
      },
    })
    const creates = recordScanCreates(page)

    await openFailed('retry_free', true)
    await expect(page.getByTestId('scan-device-failed-primary')).toHaveText('免费再试一次')
    await expect(page.getByTestId('scan-device-failed-again')).toContainText('免费再试一次')
    await expect(page.getByTestId('scan-result-pay-notice')).toHaveText(RETRY_LINE)

    await page.getByTestId('scan-device-failed-primary').click()
    await expect(page.locator('[data-scan-stage="device-settings"]')).toBeVisible()
    await expect(page.getByTestId('scan-device-start')).toHaveText('开始扫描')
    await expect(page.getByTestId('scan-pay-bar')).toHaveCount(0)

    await page.getByTestId('scan-device-start').click()
    await expect(page.locator('[data-scan-stage="progress"]')).toBeVisible({ timeout: 15_000 })
    expect(creates).toHaveLength(1)
    expect(creates[0]?.headers['x-service-order-id']).toBe(order.id)
    expect(creates[0]?.headers['x-kiosk-session-id']).toBe(sessionId)
  })

  test('完成页：已付写稿 376 行并取订单 amountCents；没付过的完成页不标价、一字不改 @kiosk', async ({ page, api }) => {
    registerPricing(api, scanOnlyChargedPricing(100))
    await routeVisiblePdf(page)
    const order100 = { ...ORDER_SCAN, amountCents: 100, createdAt: Date.now() }
    const order150 = { ...ORDER_SCAN, id: 'cmi5kp4n80027s6h9m1z8w4r9z', amountCents: 150, createdAt: Date.now() }

    // 1. 面板完成页（已付 1.00 元）
    api.respond('GET', serviceOrderPath(order100.id), ok(serviceOrderViewByState(order100, 'consumed')))
    await page.goto('/scan?stage=start')
    await seedScanTrip(page, order100.id)
    await writeScanWorkbenchSession(page, {
      stage: 'result',
      scanType: 'resume',
      result: { outcome: 'completed', success: true, file: SCAN_FILE },
    })
    await spaGo(page, '/scan?stage=result')
    await expect(page.getByTestId('scan-result-paid-copy')).toHaveText(
      '先检查文件和个人信息。打印另按页计价，到核对价格再看。扫描这一次已经付过 1.00 元。',
    )
    expectNoBannedTokens(await page.locator('body').innerText())

    // 2. 屏上完成页（已付 1.50 元，验证金额取订单 amountCents 而非硬编码）
    api.respond('GET', serviceOrderPath(order150.id), ok(serviceOrderViewByState(order150, 'consumed')))
    await page.goto('/scan?stage=start')
    await seedScanTrip(page, order150.id)
    await writeScanWorkbenchSession(page, {
      stage: 'result',
      material: 'resume',
      scanType: 'resume',
      deviceFlow: true,
      result: { outcome: 'completed', success: true, file: SCAN_FILE },
    })
    await spaGo(page, '/scan?stage=result')
    await expect(page.getByTestId('scan-result-paid-copy')).toHaveText(
      '先检查文件和个人信息。打印另按页计价，到核对价格再看。扫描这一次已经付过 1.50 元。',
    )

    // 3. 没付过的面板完成页：原句一字不改、不标价
    await page.goto('/scan?stage=start')
    await page.evaluate((key) => window.sessionStorage.removeItem(key), TRIP_KEY)
    await writeScanWorkbenchSession(page, {
      stage: 'result',
      scanType: 'resume',
      result: { outcome: 'completed', success: true, file: SCAN_FILE },
    })
    await spaGo(page, '/scan?stage=result')
    await expect(page.getByTestId('scan-result-paid-copy')).toHaveCount(0)
    await expect(page.getByTestId('scan-workbench-exits')).toContainText(
      '先检查文件和个人信息，再选打印参数。金额由系统报价决定，本页不给价格。',
    )
    await expect(page.getByTestId('scan-workbench-exits')).not.toContainText('已经付过')

    // 4. 没付过的屏上完成页：原句一字不改、不标价
    await page.goto('/scan?stage=start')
    await page.evaluate((key) => window.sessionStorage.removeItem(key), TRIP_KEY)
    await writeScanWorkbenchSession(page, {
      stage: 'result',
      material: 'resume',
      scanType: 'resume',
      deviceFlow: true,
      result: { outcome: 'completed', success: true, file: SCAN_FILE },
    })
    await spaGo(page, '/scan?stage=result')
    await expect(page.getByTestId('scan-result-paid-copy')).toHaveCount(0)
    await expect(page.getByTestId('scan-device-done')).toContainText('先检查文件和个人信息，再打印')
    await expect(page.getByTestId('scan-device-done')).not.toContainText('已经付过')
  })

  test('P2e-4b(1) 面板直达/刷新设置页：未付或仅留旧已结案单绝不发建会话请求，先清旧单直接跳付款屏 @kiosk', async ({ page, api }) => {
    registerPricing(api, scanOnlyChargedPricing(100))
    registerScanCapabilities(api, 'off')
    const freshOrder = { ...ORDER_SCAN, id: 'ord-fresh-panel-001', createdAt: Date.now() }
    const settledOrder = { ...ORDER_SCAN, id: 'ord-old-settled-panel', amountCents: 137, createdAt: Date.now() - 60_000 }
    registerScanOrder(api, freshOrder, () => serviceOrderView(freshOrder))
    api.respond('GET', serviceOrderPath(settledOrder.id), ok(serviceOrderView(settledOrder, {
      status: 'consumed',
      paidAt: new Date(Date.now() - 50_000).toISOString(),
      consumedAt: new Date(Date.now() - 40_000).toISOString(),
      settledAt: new Date(Date.now() - 10_000).toISOString(),
      attemptsUsed: 1,
    })))
    const creates = recordScanCreates(page)
    const orderCalls = recordServiceOrderCalls(page)

    // 1. 保留 scanType 无单直达 /scan?stage=settings → 0 次 POST /scan/sessions，直接跳付款屏
    await page.goto('/scan?stage=start')
    await writeScanWorkbenchSession(page, { stage: 'settings', scanType: 'document' })
    await page.goto('/scan?stage=settings')
    await expect(page).toHaveURL(/\/pay\/scan\?next=settings&back=how/)
    expect(creates).toHaveLength(0)

    // 2. 留存旧已结案单（consumed+settledAt）直达 /scan?stage=settings → 先忘旧单、0 次建会话、跳付款屏建新单
    await page.goto('/scan?stage=start')
    await seedScanTrip(page, settledOrder.id, 'sess-old-settled-panel')
    await writeScanWorkbenchSession(page, { stage: 'settings', scanType: 'document' })
    await page.goto('/scan?stage=settings')
    await expect(page).toHaveURL(/\/pay\/scan\?next=settings&back=how/)
    await expect.poll(() => orderCalls.filter((c) => c.method === 'POST' && c.path === SERVICE_ORDERS_PATH).length).toBeGreaterThanOrEqual(1)
    expect(creates).toHaveLength(0)
  })

  test('P2e-4b(2) 屏上扫描价目/查单加载期间禁用主按钮防抢跑，加载完恢复正确状态 @kiosk', async ({ page, api }) => {
    registerPricing(api, scanOnlyChargedPricing(100))
    registerScanCapabilities(api, 'available')
    await routeLocalScannerReady(page)
    const creates = recordScanCreates(page)

    let releaseConfig: (() => void) | null = null
    let holdConfig = false
    let configPayload: Record<string, unknown> = {
      smartCampus: { enabled: false, modules: {}, items: [] },
      toolbox: { enabled: true, items: [] },
      recruitmentHosting: { enabled: false, deploymentEnabled: false, reason: 'deployment_off' },
      configVersion: 'p2e4b-hold',
      refreshIntervalMs: 300_000,
      serverTime: new Date().toISOString(),
      pricing: scanOnlyChargedPricing(100),
    }
    await page.route(`**${KIOSK_CONFIG_PATH}`, async (route) => {
      if (holdConfig) {
        await new Promise<void>((resolve) => { releaseConfig = resolve })
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(configPayload) })
    })

    // 1. 慢加载价目：加载中主按钮禁用（正在确认费用），不发出建会话
    await page.goto('/scan?stage=start')
    await writeScanWorkbenchSession(page, {
      stage: 'device-settings',
      material: 'resume',
      scanType: 'resume',
      deviceChoice: { source: 'feeder', colorMode: 'gray' },
    })
    holdConfig = true
    await page.goto('/scan?stage=device-settings')
    await expect(page.locator('[data-scan-stage="device-settings"]')).toBeVisible()
    await expect(page.getByTestId('scan-device-start')).toBeDisabled()
    await expect(page.getByTestId('scan-device-start')).toHaveText('正在确认费用')
    expect(creates).toHaveLength(0)

    // 放行收费价目 → 切「付 1.00 元开始扫描」并恢复可点
    holdConfig = false
    releaseConfig?.()
    await expect(page.getByTestId('scan-device-start')).toBeEnabled()
    await expect(page.getByTestId('scan-device-start')).toHaveText('付 1.00 元开始扫描')
    expect(creates).toHaveLength(0)

    // 2. 加载完读不到价（缺 pricing）→ 恢复可点「开始扫描」
    const { pricing: _drop, ...noPricing } = configPayload
    void _drop
    configPayload = noPricing
    holdConfig = true
    await page.goto('/scan?stage=device-settings')
    await expect(page.getByTestId('scan-device-start')).toBeDisabled()
    holdConfig = false
    releaseConfig?.()
    await expect(page.getByTestId('scan-device-start')).toBeEnabled()
    await expect(page.getByTestId('scan-device-start')).toHaveText('开始扫描')
  })

  test('P2e-4b(3) 402 持续拒单 + 查单持续 paid：1 次点击仅建 1 次绝不循环自动启动；过期旧单先忘单建新单 @kiosk', async ({ page, api }) => {
    registerPricing(api, scanOnlyChargedPricing(100))
    registerScanCapabilities(api, 'available')
    await routeLocalScannerReady(page)
    const loopOrder = { ...ORDER_SCAN, id: 'ord-loop-paid-1', createdAt: Date.now() }
    const freshOrder = { ...ORDER_SCAN, id: 'ord-fresh-after-expired', createdAt: Date.now() }
    api.respond('GET', serviceOrderPath(loopOrder.id), ok(serviceOrderViewByState(loopOrder, 'paid')))
    api.respond('POST', SERVICE_ORDERS_PATH, ok(serviceOrderView(freshOrder)))
    api.respond('GET', serviceOrderPath(freshOrder.id), ok(serviceOrderView(freshOrder)))
    api.respond('POST', '/api/v1/scan/sessions', apiError(402, 'SERVICE_PAYMENT_REQUIRED', '这一次要先付款'))
    const creates = recordScanCreates(page)
    const orderCalls = recordServiceOrderCalls(page)

    await page.goto('/scan?stage=start')
    await seedScanTrip(page, loopOrder.id, 'sess-loop-1')
    await writeScanWorkbenchSession(page, {
      stage: 'device-settings',
      material: 'resume',
      scanType: 'resume',
      deviceChoice: { source: 'feeder', colorMode: 'gray' },
    })
    await spaGo(page, '/scan?stage=device-settings')
    await expect(page.getByTestId('scan-device-start')).toHaveText('开始扫描')

    // 1 次物理点击 → 402 回付款屏 → 付款屏查到 paid 在 1.6s 后跳回放纸设置 → 绝不再自动启动！
    await page.getByTestId('scan-device-start').click()
    await expect(page).toHaveURL(/\/pay\/scan\?next=device&back=how/)
    await expect(page.locator('[data-scan-stage="device-settings"]')).toBeVisible({ timeout: 10_000 })
    await page.waitForTimeout(2_500)
    await expect(page.locator('[data-scan-stage="device-settings"]')).toBeVisible()
    expect(creates).toHaveLength(1)

    // 2. 服务端返回 SERVICE_ORDER_EXPIRED（不可再用旧单）→ 先忘旧单，进付款屏后真实建新单
    api.respond('POST', '/api/v1/scan/sessions', apiError(402, 'SERVICE_ORDER_EXPIRED', '这张付款单已过期'))
    await page.getByTestId('scan-device-start').click()
    await expect(page).toHaveURL(/\/pay\/scan\?next=device&back=how/)
    await expect.poll(() => orderCalls.filter((c) => c.method === 'POST' && c.path === SERVICE_ORDERS_PATH).length).toBeGreaterThanOrEqual(1)
  })

  test('P2e-4b(4) 绕过完成页出口留存旧已结案单（consumed+settledAt 137 分）：新一趟清旧单建新单，未付结果页不串旧金额 @kiosk', async ({ page, api }) => {
    registerPricing(api, scanOnlyChargedPricing(100))
    registerScanCapabilities(api, 'available')
    await routeLocalScannerReady(page)
    await routeVisiblePdf(page)
    const oldSettled = { ...ORDER_SCAN, id: 'ord-old-settled-137', amountCents: 137, createdAt: Date.now() - 120_000 }
    const newOrder = { ...ORDER_SCAN, id: 'ord-new-trip-100', amountCents: 100, createdAt: Date.now() }
    api.respond('GET', serviceOrderPath(oldSettled.id), ok(serviceOrderView(oldSettled, {
      status: 'consumed',
      paidAt: new Date(Date.now() - 90_000).toISOString(),
      consumedAt: new Date(Date.now() - 60_000).toISOString(),
      settledAt: new Date(Date.now() - 30_000).toISOString(),
      attemptsUsed: 1,
    })))
    api.respond('POST', SERVICE_ORDERS_PATH, ok(serviceOrderView(newOrder)))
    api.respond('GET', serviceOrderPath(newOrder.id), ok(serviceOrderView(newOrder)))
    const orderCalls = recordServiceOrderCalls(page)

    // 1. 留存旧已结案单进入新一趟扫描 → 自动清旧单、出「付 1.00 元开始扫描」→ 进付款屏建新单（不判 ok 自动跳回）
    await page.goto('/scan?stage=start')
    await seedScanTrip(page, oldSettled.id, 'sess-old-137')
    await enterHowFromStart(page, 'resume')
    await page.getByRole('button', { name: '下一步', exact: true }).click()
    await expect(page.locator('[data-scan-stage="device-settings"]')).toBeVisible()
    await expect(page.getByTestId('scan-device-start')).toHaveText('付 1.00 元开始扫描')

    await page.getByTestId('scan-device-start').click()
    await expect(page).toHaveURL(/\/pay\/scan\?next=device&back=how/)
    await expect.poll(() => orderCalls.filter((c) => c.method === 'POST' && c.path === SERVICE_ORDERS_PATH).length).toBe(1)
    await expect(page.getByText('请完成这一次支付')).toBeVisible()

    // 2. 留存旧已结案单（137 分）直接落在新一趟未付面板/屏上结果页 → 绝不借用旧单金额 1.37 元
    await page.goto('/scan?stage=start')
    await seedScanTrip(page, oldSettled.id, 'sess-old-137')
    await writeScanWorkbenchSession(page, {
      stage: 'result',
      scanType: 'resume',
      live: {
        scanTaskId: 'new-unpaid-panel-task',
        controlToken: 'ctrl-new-panel',
        instructions: ['步骤一'],
        expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      },
      result: { outcome: 'completed', success: true, file: SCAN_FILE },
    })
    await spaGo(page, '/scan?stage=result')
    await expect(page.getByTestId('scan-result-paid-copy')).toHaveCount(0)
    await expect(page.getByTestId('scan-workbench-exits')).not.toContainText('1.37')
    await expect(page.getByTestId('scan-workbench-exits')).not.toContainText('已经付过')

    await page.goto('/scan?stage=start')
    await seedScanTrip(page, oldSettled.id, 'sess-old-137')
    await writeScanWorkbenchSession(page, {
      stage: 'result',
      material: 'resume',
      scanType: 'resume',
      deviceFlow: true,
      live: {
        scanTaskId: 'new-unpaid-device-task',
        controlToken: 'ctrl-new-device',
        instructions: ['步骤一'],
        expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      },
      result: { outcome: 'completed', success: true, file: SCAN_FILE },
    })
    await spaGo(page, '/scan?stage=result')
    await expect(page.getByTestId('scan-result-paid-copy')).toHaveCount(0)
    await expect(page.getByTestId('scan-device-done')).not.toContainText('1.37')
    await expect(page.getByTestId('scan-device-done')).not.toContainText('已经付过')
  })
})
