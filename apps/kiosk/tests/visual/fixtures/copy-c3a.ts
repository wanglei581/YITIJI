import type { Page } from '@playwright/test'
import type { ApiRouter } from '../../fixtures/api-router'

export const COPY_CONTROL = 'c3a-synthetic-control-token'
export const COPY_ID = 'c3a-copy-job'
export async function copyFixture(page: Page, api: ApiRouter, options: {
  copy?: boolean; scan?: boolean; color?: boolean; duplex?: boolean
  printer?: string; probe?: string; noPhone?: boolean; fail?: 409 | 413; missingToken?: boolean
} = {}) {
  const ok = (data: unknown) => ({ status: 200, json: { success: true, data } })
  api.respond('GET', '/api/v1/terminals/KSK-001/screensaver', {
    status: 200, json: { enabled: false, idleTimeoutSec: 180, items: [] },
  })
  api.respond('GET', '/api/v1/health', ok({ status: 'ok' }))
  // 离开复印区后的首页面板与问小青能力；形状沿用 privacy-clear-shell 的空响应。
  api.respond('GET', '/api/v1/jobs', {
    status: 200, json: { data: [], pagination: { page: 1, pageSize: 1, total: 0, totalPages: 0 } },
  })
  api.respond('GET', '/api/v1/job-fairs', {
    status: 200, json: { success: true, data: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } },
  })
  api.respond('GET', '/api/v1/mock-interviews/capabilities/voice', {
    status: 200, json: { asrEnabled: false, ttsEnabled: false },
  })
  api.respond('GET', '/api/v1/terminals/KSK-001/printer-status', ok({
    printerStatus: options.printer ?? 'ready', isOnline: options.printer !== 'offline', scanInputHealth: 'healthy',
  }))
  if (options.noPhone) api.respond('GET', '/api/v1/public/support-contact', ok({
    servicePhone: null, serviceHours: null, otherOnlineTerminalNearby: false, miniappPublished: false,
  }))
  const keys = { copy: options.copy ?? true, scan_device: options.scan ?? true,
    color_print: options.color ?? true, duplex_print: options.duplex ?? true }
  api.respond('GET', '/api/v1/terminals/KSK-001/capabilities', {
    status: 200, json: { capabilities: Object.entries(keys).map(([capabilityKey, available]) => ({
      capabilityKey, status: available ? 'available' : 'not_verified', configured: true, note: null,
    })) },
  })
  const calls: { path: string; body: Record<string, unknown>; headers: Record<string, string> }[] = []
  page.on('request', (request) => {
    if (request.method() !== 'POST' || !request.url().includes('/copy/jobs')) return
    calls.push({ path: new URL(request.url()).pathname, body: request.postDataJSON(), headers: request.headers() })
  })
  const receipt = { copyId: COPY_ID, terminalId: 'KSK-001', state: 'ready', source: 'flatbed', copies: 1,
    colorMode: 'black_white', duplex: 'simplex', generation: 1, authorizationVersion: 1, pageCount: 0,
    expiresAt: '2099-01-01T00:00:00Z', ...(options.missingToken ? {} : { controlToken: COPY_CONTROL }) }
  api.respond('POST', '/api/v1/copy/jobs', options.fail ? {
    status: options.fail, json: { success: false, error: { code: options.fail === 409 ? 'COPY_CAPABILITY_REVOKED' : 'COPY_LIMIT_EXCEEDED' } },
  } : ok(receipt))
  await page.route('http://127.0.0.1:9527/local/scan/**', async (route) => {
    const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' }
    if (route.request().method() === 'OPTIONS') { await route.fulfill({ status: 204, headers }); return }
    if (!route.request().url().endsWith('/probe')) throw new Error('C3a must not start scanning')
    await route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify(ok({ state: options.probe ?? 'ready' }).json) })
  })
  // C3b 接入后，C3a 仍只核建单；本机操作由 C3b 的夹具和用例细验。
  const localCalls: string[] = []
  await page.route('http://127.0.0.1:9527/local/copy/**', async (route) => {
    const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
    if (route.request().method() === 'OPTIONS') { await route.fulfill({ status: 204, headers }); return }
    const action = new URL(route.request().url()).pathname.split('/').at(-1)!
    localCalls.push(action)
    const body = route.request().postDataJSON()
    await route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify(ok({
      state: action === 'clear' ? 'cleared' : 'starting', generation: body.generation, pageCount: 0, errorCode: null, purged: true,
    }).json) })
  })
  const goto = (stage = '') => page.goto(`/print-scan/feature/copy-screen${stage ? `?stage=${stage}` : ''}`)
  return { calls, localCalls, receipt, goto }
}
