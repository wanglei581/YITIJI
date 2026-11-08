import { mkdirSync } from 'node:fs'
import type { Page } from '@playwright/test'
import type { ApiRouter } from '../fixtures/api-router'
import { expect, test } from '../fixtures/kiosk-test'

const SHOT_DIR = 'test-results/k1b1v'
const SCAN_TASK_ID = 'k1b-scan-001'
const CONTROL_TOKEN = 'k1b-scan-control'

mkdirSync(SHOT_DIR, { recursive: true })

function registerShell(api: ApiRouter): void {
  api.respond('GET', '/api/v1/terminals/KSK-001/screensaver', {
    status: 200,
    json: { enabled: false, idleTimeoutSec: 180, items: [] },
  })
  api.respond('GET', '/api/v1/terminals/KSK-001/printer-status', {
    status: 200,
    json: { data: { printerStatus: 'ready', isOnline: true, scanInputHealth: 'healthy' } },
  })
  api.respond('GET', '/api/v1/health', { status: 200, json: { data: { status: 'ok' } } })
  api.respond('GET', '/api/v1/terminals/KSK-001/capabilities', {
    status: 200,
    json: { capabilities: [] },
  })
}

function registerScanDevice(api: ApiRouter, screen: 'available' | 'off'): void {
  const capabilities = [
    {
      capabilityKey: 'scan',
      status: 'available',
      note: null,
      configured: true,
      updatedAt: '2026-11-03T00:00:00.000Z',
    },
  ]
  if (screen === 'available') {
    capabilities.push({
      capabilityKey: 'scan_device',
      status: 'available',
      note: null,
      configured: true,
      updatedAt: '2026-11-03T00:00:00.000Z',
    })
  }
  api.respond('GET', '/api/v1/terminals/KSK-001/capabilities', {
    status: 200,
    json: { capabilities },
  })
}

/** W2 构建带网桥令牌。设备页会去问本机程序；不回应时打印机行改写成「这次没有读到」。 */
async function routeUsbStatus(page: Page): Promise<void> {
  await page.route('http://127.0.0.1:9527/local/usb/status', async (route) => {
    const origin = route.request().headers()['origin'] ?? '*'
    const headers = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept, X-Local-Bridge-Token',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Private-Network': 'true',
    }
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers,
      body: JSON.stringify({ success: true, data: { present: false, driveLabel: null } }),
    })
  })
}

async function routeProbe(page: Page, status: number, body: unknown): Promise<void> {
  await page.route('http://127.0.0.1:9527/local/scan/**', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
        },
      })
      return
    }
    await route.fulfill({
      status,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(body),
    })
  })
}

function probeBody(state: string) {
  return { success: true, data: { state, pageCount: 0, errorCode: null } }
}

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `${SHOT_DIR}/${name}.png`, fullPage: false })
}

async function pickAndOpenHow(page: Page, material: 'resume' | 'id' | 'document' | 'contract'): Promise<void> {
  await page.goto('/scan?stage=start')
  await expect(page.getByRole('heading', { name: '扫什么？' })).toBeVisible()
  await page.getByTestId(`scan-workbench-type-${material}`).click()
  await page.getByRole('button', { name: '下一步', exact: true }).click()
}

test('screen scan stays off when scan_device is not opened @w2', async ({ page, api }) => {
  registerShell(api)
  registerScanDevice(api, 'off')
  await routeProbe(page, 200, probeBody('ready'))
  await page.goto('/scan?stage=start')
  await expect(page.getByRole('heading', { name: '扫什么？' })).toBeVisible()
  await expect(page.getByText('扫描仪就绪')).toHaveCount(0)
  await page.getByTestId('scan-workbench-type-document').click()
  await shot(page, 'cs-scan-what')
  await page.getByTestId('scan-workbench-type-resume').click()
  await page.getByRole('button', { name: '下一步', exact: true }).click()
  await expect(page.getByRole('heading', { name: '这台机器还不能在屏上开始扫描' })).toBeVisible()
  await expect(page.getByTestId('scan-way-screen')).toBeDisabled()
  await expect(page.getByText('这台机器还没开通', { exact: true })).toBeVisible()
  await expect(page.getByTestId('scan-way-panel')).toBeEnabled()
  await expect(page.getByText('扫描仪就绪')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '开始扫描', exact: true })).toHaveCount(0)
  await shot(page, 'cs-scan-off')
})

test('a fresh probe lets the screen method through and does not start a scan @w2', async ({ page, api }) => {
  let creates = 0
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/scan/sessions') creates += 1
  })
  registerShell(api)
  registerScanDevice(api, 'available')
  await routeProbe(page, 200, probeBody('ready'))
  await pickAndOpenHow(page, 'document')
  await expect(page.getByRole('heading', { name: '怎么扫？' })).toBeVisible()
  await expect(page.getByText('扫描仪就绪 · 刚刚检查', { exact: true })).toBeVisible()
  await expect(page.getByTestId('scan-way-screen')).toBeEnabled()
  await expect(page.getByTestId('scan-way-screen')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText('先登录')).toBeVisible()
  await expect(page.getByText('这台机器暂未开通')).toBeVisible()
  await shot(page, 'cs-scan-how')
  await page.getByRole('button', { name: '下一步', exact: true }).click()
  await expect(page.getByRole('heading', { name: '纸放哪？扫成黑白还是彩色？' })).toBeVisible()
  await expect(page.getByTestId('scan-source-feeder')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('scan-color-gray')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('scan-device-start')).toBeVisible()
  await expect(page).toHaveURL(/stage=device-settings/)
  await shot(page, 'cs-scan-set')
  await page.getByRole('button', { name: '返回', exact: true }).first().click()
  await page.getByRole('button', { name: '返回', exact: true }).first().click()
  await page.getByTestId('scan-workbench-type-id').click()
  await page.getByRole('button', { name: '下一步', exact: true }).click()
  await expect(page.getByText('扫描仪就绪 · 刚刚检查', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '下一步', exact: true }).click()
  await expect(page.getByTestId('scan-source-flatbed')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('scan-color-color')).toHaveAttribute('aria-pressed', 'true')
  expect(creates).toBe(0)
})

for (const [name, status, body, reason] of [
  ['busy', 200, probeBody('busy'), '扫描仪正忙，请稍后再试'],
  ['not_found', 200, probeBody('not_found'), '未找到扫描仪，请先用面板扫描'],
  ['error', 200, probeBody('error'), '扫描仪状态暂时无法确认，请先用面板扫描'],
] as const) {
  test(`probe ${name} disables the screen method and does not say ready @w2`, async ({ page, api }) => {
    registerShell(api)
    registerScanDevice(api, 'available')
    await routeProbe(page, status, body)
    await pickAndOpenHow(page, 'document')
    await expect(page.getByRole('heading', { name: '怎么扫？' })).toBeVisible()
    await expect(page.getByTestId('scan-way-screen')).toBeDisabled()
    await expect(page.getByText(reason).first()).toBeVisible()
    await expect(page.getByText('扫描仪就绪')).toHaveCount(0)
    await expect(page.getByTestId('scan-way-panel')).toHaveAttribute('aria-pressed', 'true')
    if (name === 'busy') await shot(page, 'cs-scan-how-unavailable')
  })
}

test('an unreachable local program disables the screen method @w2', async ({ page, api }) => {
  registerShell(api)
  registerScanDevice(api, 'available')
  await page.route('http://127.0.0.1:9527/local/scan/**', (route) => route.abort('connectionrefused'))
  await pickAndOpenHow(page, 'resume')
  await expect(page.getByText('本机程序连不上，扫描仪状态未知，请先用面板扫描').first()).toBeVisible()
  await expect(page.getByTestId('scan-way-screen')).toBeDisabled()
  await expect(page.getByText('扫描仪就绪')).toHaveCount(0)
})

test('guest login from how returns to how and keeps only the material @w2', async ({ page, api }) => {
  registerShell(api)
  registerScanDevice(api, 'available')
  await routeProbe(page, 200, probeBody('ready'))
  api.respond('GET', '/api/v1/kiosk/legal/terms_of_service', { status: 200, json: { success: true, data: null } })
  api.respond('GET', '/api/v1/kiosk/legal/privacy_policy', { status: 200, json: { success: true, data: null } })
  api.respond('POST', '/api/v1/member/auth/sms-code', {
    status: 200,
    json: { success: true, data: { sent: true, cooldownSeconds: 60, expiresInSeconds: 300 } },
  })
  api.respond('POST', '/api/v1/member/auth/login', {
    status: 200,
    json: {
      success: true,
      data: { token: 'k1b-member-token', user: { id: 'member-k1b', phoneMasked: '138****8000', nickname: '屏上扫描' } },
    },
  })
  api.respond('GET', '/api/v1/me/favorites', { status: 200, json: { success: true, data: { items: [], nextCursor: null, total: 0 } } })
  let probes = 0
  page.on('request', (request) => {
    if (request.method() === 'GET' && request.url().includes('/local/scan/probe')) probes += 1
  })
  await pickAndOpenHow(page, 'document')
  await expect(page.getByTestId('scan-how-login')).toBeVisible()
  const probesBeforeLogin = probes
  await page.getByTestId('scan-how-login').click()
  await expect(page).toHaveURL(/\/login\?/)
  const from = new URL(page.url()).searchParams.get('from')
  expect(from).toBe('/scan?stage=how')
  await page.getByRole('checkbox', { name: /我已阅读并同意/ }).click()
  await page.getByRole('button', { name: '手机号（11 位本人号码）', exact: true }).click()
  for (const digit of '13800138000') await page.getByRole('button', { name: digit, exact: true }).click()
  await page.getByRole('button', { name: '收起键盘', exact: true }).click()
  await page.getByRole('button', { name: '获取验证码', exact: true }).click()
  await page.getByRole('button', { name: '短信验证码', exact: true }).click()
  for (const digit of '123456') await page.getByRole('button', { name: digit, exact: true }).click()
  await page.getByRole('button', { name: '收起键盘', exact: true }).click()
  await page.getByRole('button', { name: '确认登录', exact: true }).click()
  await expect(page).toHaveURL(/\/scan\?stage=how/)
  await expect(page.getByRole('heading', { name: '怎么扫？' })).toBeVisible()
  await expect(page.getByText('屏上扫描 · 普通文档')).toBeVisible()
  await expect(page.getByTestId('scan-how-login')).toHaveCount(0)
  expect(probes).toBeGreaterThan(probesBeforeLogin)
})

test('panel route still creates the existing session, and a contract goes out as a document @w2', async ({ page, api }) => {
  registerShell(api)
  registerScanDevice(api, 'off')
  api.respond('POST', '/api/v1/scan/sessions', {
    status: 200,
    json: {
      success: true,
      data: {
        scanTaskId: SCAN_TASK_ID,
        controlToken: CONTROL_TOKEN,
        status: 'waiting',
        scanType: 'document',
        instructions: ['放好原件', '在打印机面板开始扫描'],
        expiresAt: '2099-01-01T00:00:00.000Z',
      },
    },
  })
  api.respond('POST', `/api/v1/scan/sessions/${SCAN_TASK_ID}/ack`, {
    status: 200,
    json: { success: true, data: { scanTaskId: SCAN_TASK_ID, deliveryAckedAt: '2026-11-03T00:00:00.000Z' } },
  })
  let posted: { scanType?: string } | null = null
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/scan/sessions') {
      posted = request.postDataJSON() as { scanType?: string }
    }
  })
  await pickAndOpenHow(page, 'contract')
  await expect(page.getByRole('heading', { name: '这台机器还不能在屏上开始扫描' })).toBeVisible()
  await page.getByTestId('scan-way-panel').click()
  await expect(page).toHaveURL(/stage=settings/)
  await expect.poll(() => posted).toMatchObject({ scanType: 'document' })
})

test('device status shows a fresh scanner row and drops it after one minute @w2', async ({ page, api }) => {
  await page.clock.install()
  registerShell(api)
  registerScanDevice(api, 'available')
  await routeUsbStatus(page)
  await routeProbe(page, 200, probeBody('ready'))
  await page.goto('/error-offline')
  const scanner = page.locator('[data-cap="scanner"]')
  await expect(scanner).toContainText('扫描仪')
  await expect(scanner).toContainText('这次读到就绪')
  await expect(scanner).toContainText('刚刚检查')
  await expect(page.locator('[data-cap="printer"]')).toContainText('这次读到可用')
  await expect(page.getByText('扫描仪就绪')).toHaveCount(0)
  await expect(page.locator('[data-cap="network"]')).toContainText('刚刚检查')
  await shot(page, 'cs-device')
  await page.clock.fastForward(61_000)
  await expect(scanner).toContainText('不算就绪')
  await expect(scanner).not.toContainText('这次读到就绪')
})
