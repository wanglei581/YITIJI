import { expect, type Page } from '@playwright/test'
import type { ApiRouter } from '../../fixtures/api-router'
import type { CopyJobView, CopySettings } from '../../../src/services/api/copyJobs'
import { COPY_CONTROL, COPY_ID, copyFixture } from './copy-c3a'

// 独立的合成 JPEG，不含用户材料；所有预览仍经过真实 POST 字节响应。
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAQAAwDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3CiiigD//2Q==', 'base64')
export async function copyDeviceFixture(page: Page, api: ApiRouter, options: {
  pages?: number; copies?: number; duplex?: boolean; feeder?: boolean; color?: boolean; amount?: number; quoteChanged?: boolean
  printState?: string; noPhone?: boolean; statusAfterPrintFails?: boolean
  fail?: 'print' | 'abort' | 'cancel' | 'clear' | 'preview' | 'confirm' | 'status'; clearDelayed?: boolean
} = {}) {
  await page.clock.install()
  const base = await copyFixture(page, api, { noPhone: options.noPhone })
  // 登出会整页重载；实际 revoke 调用推到测试进程记账，不能随新文档归零。
  const revokedUrls: string[] = []
  await page.exposeFunction('__copyReportRevoke', (url: string) => { revokedUrls.push(url) })
  await page.addInitScript(() => {
    const original = URL.revokeObjectURL.bind(URL)
    URL.revokeObjectURL = (url) => {
      original(url)
      const report = (window as unknown as { __copyReportRevoke: (url: string) => Promise<void> }).__copyReportRevoke
      void report(url)
    }
  })
  const settings: CopySettings = { source: options.feeder ? 'feeder' : 'flatbed', copies: options.copies ?? 2,
    colorMode: options.color ? 'color' : 'black_white', duplex: options.duplex ? 'duplex_long_edge' : 'simplex' }
  const pages = options.pages ?? 3
  let copyId = COPY_ID
  let local = { state: 'starting', pageCount: 0, errorCode: null as string | null }
  let cloudState: CopyJobView['state'] = 'scanned'
  let printed = false
  let version = 'a'.repeat(64)
  const localCalls: { action: string; body: Record<string, unknown>; headers: Record<string, string> }[] = []
  const cloudCalls: { action: string; body: Record<string, unknown>; headers: Record<string, string> }[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (!url.pathname.includes('/copy/jobs/')) return
    cloudCalls.push({ action: request.method() === 'GET' ? 'quote' : url.pathname.split('/').at(-1)!,
      body: request.postData() ? request.postDataJSON() : {}, headers: request.headers() })
  })
  const job = (patch: Partial<CopyJobView> = {}): CopyJobView => ({
    ...base.receipt, ...settings, copyId, pageCount: pages, state: cloudState, orderId: printed || cloudState === 'confirmed' ? 'synthetic-copy-order' : null,
    quoteVersion: version, quoteError: null, quote: { serviceKey: settings.colorMode === 'color' ? 'copy_color_page' : 'copy_bw_page', unitCents: options.amount ?? 0,
      amountCents: (options.amount ?? 0) * pages * settings.copies, pageCount: pages, copies: settings.copies,
      colorMode: settings.colorMode, duplex: settings.duplex, billableSides: pages * settings.copies }, ...patch,
  })
  const ok = (data: unknown) => ({ status: 200, json: { success: true, data } })
  api.respondWith('POST', '/api/v1/copy/jobs', (n) => {
    copyId = n === 1 ? COPY_ID : `${COPY_ID}-${n}`
    local = { state: 'starting', pageCount: 0, errorCode: null }
    return ok(job({ state: 'ready', pageCount: 0, controlToken: COPY_CONTROL }))
  })
  for (const id of [COPY_ID, `${COPY_ID}-2`]) {
    api.respond('GET', `/api/v1/copy/jobs/${id}`, ok(job()))
    api.respondWith('GET', `/api/v1/copy/jobs/${id}`, () => ok(job()))
    api.respondWith('POST', `/api/v1/copy/jobs/${id}/cancel`, () => options.fail === 'cancel'
      ? { abort: 'connectionrefused' } : ok(job({ state: 'cancelled' })))
    api.respondWith('POST', `/api/v1/copy/jobs/${id}/confirm`, (n) => {
      if (options.fail === 'confirm') return { abort: 'connectionrefused' }
      if (options.quoteChanged && n === 1) {
        version = 'b'.repeat(64)
        return { status: 409, json: { success: false, error: { code: 'COPY_QUOTE_CHANGED' } } }
      }
      cloudState = 'confirmed'
      return ok(job({ state: 'confirmed', orderId: 'synthetic-copy-order', authorizationVersion: 2 }))
    })
  }
  let releaseClear: (() => void) | undefined
  const clearWait = new Promise<void>((resolve) => { releaseClear = resolve })
  await page.route('http://127.0.0.1:9527/local/copy/**', async (route) => {
    const request = route.request()
    const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Cache-Control': 'no-store' }
    if (request.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers }); return }
    const action = new URL(request.url()).pathname.split('/').at(-1)!
    const body = request.postDataJSON()
    localCalls.push({ action, body, headers: request.headers() })
    if (action === 'print') {
      printed = true
      local = { ...local, state: options.printState ?? 'printing' }
    }
    if (options.fail === action || (action === 'status' && printed && options.statusAfterPrintFails)) { await route.abort('connectionrefused'); return }
    if (action === 'clear' && options.clearDelayed) await clearWait
    if (action === 'preview') { await route.fulfill({ status: 200, headers, contentType: 'image/jpeg', body: JPEG }); return }
    if (action === 'next-page') local = { ...local, state: 'starting' }
    if (action === 'finish') local = { ...local, state: 'scanned' }
    const state = action === 'abort' ? 'cancelled' : action === 'clear' ? 'cleared' : action === 'finish' ? 'composing' : local.state
    await route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify(ok({ ...local, state, generation: body.generation,
      ...(['abort', 'clear'].includes(action) ? { purged: true } : {}) }).json) })
  })
  const start = async () => {
    await base.goto('set')
    if (settings.source === 'feeder') await page.getByRole('button', { name: /^进纸器/ }).click()
    for (let i = 1; i < settings.copies; i++) await page.getByRole('button', { name: '多一份', exact: true }).click()
    if (options.duplex) await page.getByRole('button', { name: '双面', exact: true }).click()
    if (options.color) await page.getByRole('button', { name: '彩色', exact: true }).click()
    const started = page.waitForResponse((response) => response.request().method() === 'POST'
      && response.url() === 'http://127.0.0.1:9527/local/copy/start')
    await page.getByTestId('copy-primary').click()
    const response = await started
    expect(response.ok()).toBe(true)
    expect(await response.json()).toMatchObject({ success: true, data: { state: 'starting', generation: 1 } })
    expect(localCalls.filter((call) => call.action === 'start')).toMatchObject([
      { body: { copyId, generation: 1, source: settings.source, scanColor: 'color' } },
    ])
    // busy 时按钮叫「正在停止」；等回包被页面处理后再允许 report 推进假时钟。
    await expect(page.getByRole('button', { name: '停止复印', exact: true })).toBeEnabled()
  }
  const report = async (state: string, pageCount: number | null = pages, errorCode: string | null = null) => {
    if (['handed', 'unconfirmed', 'failed'].includes(state)) cloudState = state as CopyJobView['state']
    local = { state, pageCount: pageCount ?? 0, errorCode }
    await page.clock.fastForward(3100)
  }
  return { ...base, localCalls, cloudCalls, revokedUrls, start, report, job, releaseClear: () => releaseClear?.() }
}
