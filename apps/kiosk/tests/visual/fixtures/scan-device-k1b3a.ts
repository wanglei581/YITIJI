import type { Page } from '@playwright/test'
import type { ApiRouter } from '../../fixtures/api-router'
import { expect } from '../../fixtures/kiosk-test'

export const TASK = 'k1b3a-same-session'
export const CONTROL = 'k1b3a-control'
export const STOP_KEY = 'ai-job-print:scan-device-stop-receipt'
const BRIDGE = 'w2-synthetic-bridge-token'

/** 11/08 定第 9 条：屏上扫描的「状态未知」胶囊和复印一样用提醒色（橙）；读真实算出来的颜色，不只看类名。 */
export async function expectScanUnknownChip(page: Page): Promise<void> {
  const chip = page.locator('.qxt-band .qxt-status')
  await expect(chip).toHaveText('状态未知')
  await expect(chip).toHaveClass(/qxt-status-unknown/)
  await expect(chip).toHaveCSS('background-color', 'rgba(184, 104, 60, 0.25)')
  await expect(chip.locator('.qxt-dot')).toHaveCSS('background-color', 'rgb(240, 168, 115)')
}
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
    json: {
      capabilities: [
        { capabilityKey: 'scan', status: 'available', note: null, configured: true, updatedAt: '2026-11-04T00:00:00.000Z' },
        { capabilityKey: 'scan_device', status: 'available', note: null, configured: true, updatedAt: '2026-11-04T00:00:00.000Z' },
      ],
    },
  })
}


export async function deviceFixture(page: Page, api: ApiRouter, options: {
  purged?: boolean; abortFailure?: boolean; cancelFailure?: boolean; quiet?: boolean; panelConflict?: boolean; noPhone?: boolean
} = {}) {
  registerShell(api)
  if (options.noPhone) api.respond('GET', '/api/v1/public/support-contact', { status: 200, json: { success: true, data: { servicePhone: null, serviceHours: null, otherOnlineTerminalNearby: false, miniappPublished: false } } })
  const cloud = {
    scanTaskId: TASK, status: 'waiting', scanType: 'document', file: null,
    errorCode: null, errorMessage: null, expiresAt: '2099-01-01T00:00:00.000Z', startMode: 'device',
    deviceState: 'ready', devicePageCount: 0, deviceErrorCode: null as string | null,
    deviceSource: 'feeder', deviceColorMode: 'gray', deviceMaxPages: 20,
  }
  const calls: { method: string; path: string; body: unknown; headers: Record<string, string> }[] = []
  page.on('request', (request) => {
    if (!request.url().includes('/scan/')) return
    calls.push({ method: request.method(), path: new URL(request.url()).pathname, body: request.postData() ? request.postDataJSON() : null, headers: request.headers() })
  })
  const ok = (data: unknown) => ({ status: 200, json: { success: true, data } })
  api.respond('POST', '/api/v1/scan/sessions', ok({ ...cloud, controlToken: CONTROL, instructions: ['放好原件'] }))
  api.respond('POST', `/api/v1/scan/sessions/${TASK}/ack`, ok({ scanTaskId: TASK, deliveryAckedAt: '2026-11-04T00:00:00Z' }))
  api.respondWith('GET', `/api/v1/scan/sessions/${TASK}`, () => ok({ ...cloud }))
  api.respondWith('DELETE', `/api/v1/scan/sessions/${TASK}`, () => {
    if (options.cancelFailure) return { abort: 'connectionrefused' }
    cloud.status = 'cancelled'
    return ok({ scanTaskId: TASK, status: 'cancelled', ...(options.quiet ? { serverNow: '2026-11-04T00:00:00Z', quietPeriodEndsAt: '2026-11-04T00:01:30Z' } : {}) })
  })
  api.respondWith('POST', `/api/v1/scan/sessions/${TASK}/device-settings`, () => {
    cloud.deviceState = 'ready'
    cloud.deviceSource = 'flatbed'
    cloud.deviceErrorCode = null
    return ok({ scanTaskId: TASK, startMode: 'device', source: 'flatbed', colorMode: 'gray', deviceState: 'ready', devicePageCount: 0, deviceErrorCode: null, expiresAt: cloud.expiresAt })
  })
  api.respondWith('POST', `/api/v1/scan/sessions/${TASK}/switch-to-panel`, () => {
    if (options.panelConflict) {
      cloud.deviceState = 'scanning'
      cloud.deviceErrorCode = null
      return { status: 409, json: { success: false, error: { code: 'SCAN_DEVICE_SETTINGS_LOCKED' } } }
    }
    cloud.startMode = 'panel'
    cloud.deviceState = 'ready'
    return ok({ scanTaskId: TASK, startMode: 'panel', expiresAt: cloud.expiresAt, instructions: ['在打印机面板上选扫描', '使用本次屏幕显示的路径'] })
  })
  await page.route('http://127.0.0.1:9527/local/scan/**', async (route) => {
    const request = route.request()
    const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' }
    if (request.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers }); return }
    const path = new URL(request.url()).pathname
    if (path.endsWith('/probe')) {
      await route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify(ok({ state: 'ready' }).json) }); return
    }
    expect(request.postDataJSON()).toEqual({ scanTaskId: TASK })
    expect(request.headers()['x-local-bridge-token']).toBe(BRIDGE)
    expect(request.headers()['x-scan-session-control']).toBeUndefined()
    if (path.endsWith('/abort') && options.abortFailure) { await route.abort('connectionrefused'); return }
    if (path.endsWith('/start')) { cloud.deviceState = 'scanning'; cloud.deviceErrorCode = null }
    const data = path.endsWith('/abort') ? { state: 'aborted', purged: options.purged ?? false } : { state: 'scanning' }
    await route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify({ success: true, data: { ...data, pageCount: 0, errorCode: null } }) })
  })
  const start = async (fault?: string) => {
    await page.goto('/scan?stage=start')
    await page.getByTestId('scan-workbench-type-document').click()
    await page.getByRole('button', { name: '下一步', exact: true }).click()
    await expect(page.getByRole('heading', { name: '怎么扫？' })).toBeVisible()
    await page.getByRole('button', { name: '下一步', exact: true }).click()
    await page.getByTestId('scan-device-start').click()
    await expect(page.getByRole('heading', { name: '正在扫描', exact: true })).toBeVisible({ timeout: 15000 })
    if (fault) { cloud.deviceState = 'error'; cloud.deviceErrorCode = fault }
  }
  const posts = (suffix: string) => calls.filter((r) => r.method === 'POST' && r.path.endsWith(suffix))
  return { cloud, calls, start, posts }
}
