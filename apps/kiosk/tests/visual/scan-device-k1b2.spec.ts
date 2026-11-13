import { mkdirSync } from 'node:fs'
import type { Page } from '@playwright/test'
import type { ApiRouter } from '../fixtures/api-router'
import { expect, test } from '../fixtures/kiosk-test'
import { fillPhoneLogin, memberDocument } from './fixtures/privacy-clear-shell'
import { expectScanUnknownChip } from './fixtures/scan-device-k1b3a'

const SHOT_DIR = 'test-results/k1b2'
const TASK = 'k1b2-scan-001'
const CONTROL = 'k1b2-control'
const FILE_ID = 'k1b2-file-1'
const FILE_NAME = 'k1b2-feeder.pdf'
const BRIDGE = 'w2-synthetic-bridge-token'
// 游客三条带走的办法（设计窗口 11/08 答复），与面板结果页同一份（scanGuestWays）。
// 默认夹具里小程序没发布，第三条不说手机上能看到。
const GUEST_LEAD = '未登录扫描件不会进入「我的文档」。带走的办法：'
const GUEST_WAYS = [
  '当场打印：请在本次操作内完成打印或识别。',
  '存 U 盘：在打印机面板上选「扫描到 U 盘」，这台机器暂未开通。',
  '存进「我的文档」：下次先扫码登录再扫。',
]

mkdirSync(SHOT_DIR, { recursive: true })

interface Cloud {
  status: 'waiting' | 'matched' | 'completed' | 'failed'
  deviceState: 'ready' | 'scanning' | 'page_ready' | 'composing' | 'delivering' | 'error' | null
  devicePageCount: number
  deviceErrorCode: string | null
  deviceSource: 'feeder' | 'flatbed'
  deviceColorMode: 'gray' | 'color'
  deviceMaxPages: number | null
  withFile: boolean
}

function cloudJson(cloud: Cloud) {
  return {
    success: true,
    data: {
      scanTaskId: TASK,
      status: cloud.status,
      scanType: 'document',
      file: cloud.withFile
        ? {
          fileId: FILE_ID,
          filename: FILE_NAME,
          sizeBytes: 876543,
          mimeType: 'application/pdf',
          sha256: 'k1b2',
          fileUrl: '/mock/k1b2-feeder.pdf',
        }
        : null,
      errorCode: null,
      errorMessage: null,
      expiresAt: '2099-01-01T00:00:00.000Z',
      startMode: 'device',
      deviceState: cloud.deviceState,
      devicePageCount: cloud.devicePageCount,
      deviceErrorCode: cloud.deviceErrorCode,
      deviceSource: cloud.deviceSource,
      deviceColorMode: cloud.deviceColorMode,
      deviceUpdatedAt: '2026-11-04T00:00:00.000Z',
      ...(cloud.deviceMaxPages != null ? { deviceMaxPages: cloud.deviceMaxPages } : {}),
    },
  }
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

function registerSession(api: ApiRouter, cloud: Cloud): { creates: () => number } {
  let creates = 0
  api.respond('POST', '/api/v1/scan/sessions', {
    status: 200,
    json: {
      success: true,
      data: {
        scanTaskId: TASK,
        controlToken: CONTROL,
        status: 'waiting',
        scanType: 'document',
        instructions: ['放好原件'],
        expiresAt: '2099-01-01T00:00:00.000Z',
      },
    },
  })
  api.respond('POST', `/api/v1/scan/sessions/${TASK}/ack`, {
    status: 200,
    json: { success: true, data: { scanTaskId: TASK, deliveryAckedAt: '2026-11-04T00:00:00.000Z' } },
  })
  api.respond('DELETE', `/api/v1/scan/sessions/${TASK}`, {
    status: 200,
    json: { success: true, data: { scanTaskId: TASK, status: 'cancelled' } },
  })
  api.respondWith('GET', `/api/v1/scan/sessions/${TASK}`, () => ({
    status: 200,
    json: cloudJson(cloud),
  }))
  return {
    creates: () => creates,
    noteCreate: () => { creates += 1 },
  } as { creates: () => number; noteCreate: () => void }
}

async function routeLocal(page: Page, cloud: Cloud, mode: 'ok' | 'unreachable'): Promise<{
  starts: () => number
  nexts: () => number
}> {
  let starts = 0
  let nexts = 0
  await page.route('http://127.0.0.1:9527/local/scan/**', async (route) => {
    const request = route.request()
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    }
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors })
      return
    }
    const path = new URL(request.url()).pathname
    if (request.method() === 'GET' && path.endsWith('/probe')) {
      await route.fulfill({
        status: 200,
        headers: cors,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { state: 'ready', pageCount: 0, errorCode: null } }),
      })
      return
    }
    if (request.method() === 'POST' && path.endsWith('/start') && mode === 'unreachable') {
      await route.abort('connectionrefused')
      return
    }
    if (request.method() === 'POST' && (path.endsWith('/start') || path.endsWith('/next-page') || path.endsWith('/finish') || path.endsWith('/abort'))) {
      const body = request.postDataJSON() as { scanTaskId?: string }
      expect(body).toEqual({ scanTaskId: TASK })
      expect(request.headers()['x-local-bridge-token']).toBe(BRIDGE)
      expect(request.headers()['x-scan-session-control']).toBeUndefined()
      if (path.endsWith('/start')) {
        starts += 1
        if (cloud.deviceState === 'ready') {
          cloud.deviceState = 'scanning'
          cloud.devicePageCount = 0
        }
      }
      if (path.endsWith('/next-page')) nexts += 1
      const state = path.endsWith('/abort') ? 'aborted' : 'scanning'
      await route.fulfill({
        status: 200,
        headers: cors,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { state, pageCount: 0, errorCode: null } }),
      })
      return
    }
    await route.fulfill({ status: 404, headers: cors, body: '{}' })
  })
  return { starts: () => starts, nexts: () => nexts }
}

async function openSet(page: Page): Promise<void> {
  await page.goto('/scan?stage=start')
  await page.getByTestId('scan-workbench-type-document').click()
  await page.getByRole('button', { name: '下一步', exact: true }).click()
  await expect(page.getByRole('heading', { name: '怎么扫？' })).toBeVisible()
  await page.getByRole('button', { name: '下一步', exact: true }).click()
  await expect(page.getByRole('heading', { name: '纸放哪？扫成黑白还是彩色？' })).toBeVisible()
}

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `${SHOT_DIR}/${name}.png`, fullPage: false })
}

test('feeder reports pages only from the cloud, reloads, then finishes for a guest @w2', async ({ page, api }) => {
  test.setTimeout(120_000)
  const cloud: Cloud = {
    status: 'waiting',
    deviceState: 'ready',
    devicePageCount: 0,
    deviceErrorCode: null,
    deviceSource: 'feeder',
    deviceColorMode: 'gray',
    deviceMaxPages: null,
    withFile: false,
  }
  registerShell(api)
  const session = registerSession(api, cloud) as { creates: () => number; noteCreate: () => void }
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/scan/sessions') {
      session.noteCreate()
      const body = request.postDataJSON() as Record<string, unknown>
      expect(body).toEqual({
        startMode: 'device',
        source: 'feeder',
        colorMode: 'gray',
        scanType: 'document',
        terminalId: 'KSK-001',
      })
    }
    if (request.method() === 'POST' && request.url().includes(`/scan/sessions/${TASK}/ack`)) {
      const headers = request.headers()
      expect(headers['x-terminal-id']).toBe('KSK-001')
      expect(headers['x-terminal-session-token']).toBe('playwright-terminal-session-fixture')
      expect(headers['x-scan-session-control']).toBe(CONTROL)
    }
  })
  const local = await routeLocal(page, cloud, 'ok')
  await openSet(page)
  await page.getByTestId('scan-device-start').click()
  await expect(page.getByRole('heading', { name: '正在扫描' })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('scan-device-page-count')).toHaveCount(0)
  await expect(page.getByText('已收到 1 页')).toHaveCount(0)
  await shot(page, 'cs-scan-run-none')
  cloud.devicePageCount = 1
  await expect(page.getByText('已收到 1 页').first()).toBeVisible({ timeout: 15_000 })
  cloud.devicePageCount = 2
  await expect(page.getByText('已收到 2 页').first()).toBeVisible({ timeout: 15_000 })
  await shot(page, 'cs-scan-run')
  const starts = local.starts()
  expect(starts).toBe(1)
  expect(session.creates()).toBe(1)
  await page.reload()
  await expect(page.getByText('已收到 2 页').first()).toBeVisible({ timeout: 15_000 })
  expect(local.starts()).toBe(1)
  expect(session.creates()).toBe(1)
  cloud.devicePageCount = 3
  await expect(page.getByText('已收到 3 页').first()).toBeVisible({ timeout: 15_000 })
  cloud.deviceState = 'composing'
  await expect(page.getByTestId('scan-device-make')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('heading', { name: '正在生成文件' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '扫描完成，文件已传回' })).toHaveCount(0)
  await shot(page, 'cs-scan-make')
  cloud.deviceState = 'delivering'
  await expect(page.getByText('传回这台机器').first()).toBeVisible({ timeout: 15_000 })
  cloud.status = 'completed'
  cloud.withFile = true
  await expect(page.getByTestId('scan-device-done')).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('.cs-fhead b', { hasText: FILE_NAME })).toBeVisible()
  const guestWays = page.getByTestId('scan-guest-ways')
  await expect(guestWays.getByText(GUEST_LEAD, { exact: true })).toBeVisible()
  await expect(guestWays.locator('li')).toHaveText(GUEST_WAYS)
  await expect(page.getByText('已存进')).toHaveCount(0)
  await shot(page, 'cs-scan-done')
  await page.getByTestId('scan-device-again').click()
  await expect(page.getByRole('heading', { name: '扫什么？' })).toBeVisible()
  expect(local.starts()).toBe(1)
})

test('flatbed asks for another page, then finishes without using 50 as the cap @w2', async ({ page, api }) => {
  test.setTimeout(120_000)
  const cloud: Cloud = {
    status: 'waiting',
    deviceState: 'ready',
    devicePageCount: 0,
    deviceErrorCode: null,
    deviceSource: 'flatbed',
    deviceColorMode: 'gray',
    deviceMaxPages: 20,
    withFile: false,
  }
  registerShell(api)
  registerSession(api, cloud)
  const local = await routeLocal(page, cloud, 'ok')
  await openSet(page)
  await page.getByTestId('scan-source-flatbed').click()
  await page.getByTestId('scan-device-start').click()
  cloud.deviceState = 'page_ready'
  cloud.devicePageCount = 1
  cloud.deviceSource = 'flatbed'
  await expect(page.getByTestId('scan-device-more')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('最多 20 页').first()).toBeVisible()
  await expect(page.getByText('10 分钟内没操作会自动结束').first()).toBeVisible()
  await expect(page.getByText('并删除已扫的页')).toHaveCount(0)
  await expect(page.getByText('50')).toHaveCount(0)
  await page.getByTestId('scan-device-next').click()
  await expect.poll(() => local.nexts()).toBe(1)
  cloud.devicePageCount = 2
  await expect(page.getByText('已收到 2 页').first()).toBeVisible({ timeout: 15_000 })
  await shot(page, 'cs-scan-more')
  await page.getByTestId('scan-device-finish').click()
  cloud.deviceState = 'composing'
  await expect(page.getByTestId('scan-device-make')).toBeVisible({ timeout: 15_000 })
  expect(local.nexts()).toBe(1)
})

test('an unreachable local program stays unknown and does not claim success or failure @w2', async ({ page, api }) => {
  test.setTimeout(90_000)
  const cloud: Cloud = {
    status: 'waiting',
    deviceState: 'ready',
    devicePageCount: 0,
    deviceErrorCode: null,
    deviceSource: 'feeder',
    deviceColorMode: 'gray',
    deviceMaxPages: null,
    withFile: false,
  }
  registerShell(api)
  registerSession(api, cloud)
  await routeLocal(page, cloud, 'unreachable')
  await openSet(page)
  await page.getByTestId('scan-device-start').click()
  await expect(page.getByTestId('scan-device-unknown')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('heading', { name: '状态未知' })).toBeVisible()
  await expect(page.getByText('本机程序连不上。这一步还没有结果。').first()).toBeVisible()
  await expectScanUnknownChip(page)
  await expect(page.getByRole('heading', { name: '扫描完成，文件已传回' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '扫描未完成' })).toHaveCount(0)
  await shot(page, 'cs-scan-unknown')
})

test('a known jam lands on the K1b-3a jam screen, not the generic failure view @w2', async ({ page, api }) => {
  test.setTimeout(90_000)
  const cloud: Cloud = {
    status: 'waiting',
    deviceState: 'ready',
    devicePageCount: 0,
    deviceErrorCode: null,
    deviceSource: 'feeder',
    deviceColorMode: 'gray',
    deviceMaxPages: null,
    withFile: false,
  }
  registerShell(api)
  registerSession(api, cloud)
  await routeLocal(page, cloud, 'ok')
  await openSet(page)
  await page.getByTestId('scan-device-start').click()
  await expect(page.getByTestId('scan-device-run')).toBeVisible({ timeout: 15_000 })
  cloud.deviceState = 'error'
  cloud.deviceErrorCode = 'paper_jam'
  // K1b-3a 起卡纸 / 盖板没合上走稿内 cs-scan-err-jam，不再落 K1b-2 的统一失败视图。
  await expect(page.getByRole('heading', { name: '卡纸或盖板没合上' })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('heading', { name: '扫描未完成' })).toHaveCount(0)
})

function registerLogin(api: ApiRouter, documents: ReturnType<typeof memberDocument>[]): void {
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
      data: { token: 'k1b2-member-token', user: { id: 'member-k1b2', phoneMasked: '138****8000', nickname: '屏上扫描' } },
    },
  })
  api.respond('GET', '/api/v1/me/favorites', { status: 200, json: { success: true, data: { items: [], nextCursor: null, total: 0 } } })
  api.respond('GET', '/api/v1/me/documents', {
    status: 200,
    json: { success: true, data: { items: documents, nextCursor: null, total: documents.length } },
  })
}

async function loginFromHow(page: Page): Promise<void> {
  await page.goto('/scan?stage=start')
  await page.getByTestId('scan-workbench-type-document').click()
  await page.getByRole('button', { name: '下一步', exact: true }).click()
  await page.getByTestId('scan-how-login').click()
  await fillPhoneLogin(page, '13800138000')
  await expect(page.getByRole('heading', { name: '怎么扫？' })).toBeVisible()
  await page.getByRole('button', { name: '下一步', exact: true }).click()
  await expect(page.getByRole('heading', { name: '纸放哪？扫成黑白还是彩色？' })).toBeVisible()
}

test('a logged-in owner is told the file is in my documents, including the miniapp half @w2', async ({ page, api }) => {
  test.setTimeout(120_000)
  const cloud: Cloud = {
    status: 'waiting',
    deviceState: 'ready',
    devicePageCount: 0,
    deviceErrorCode: null,
    deviceSource: 'feeder',
    deviceColorMode: 'gray',
    deviceMaxPages: null,
    withFile: false,
  }
  registerShell(api)
  registerSession(api, cloud)
  registerLogin(api, [memberDocument(FILE_ID, FILE_NAME)])
  api.respond('GET', '/api/v1/public/support-contact', {
    status: 200,
    json: {
      success: true,
      data: {
        servicePhone: '18369161921',
        serviceHours: '工作日 9:00–18:00',
        otherOnlineTerminalNearby: false,
        miniappPublished: true,
      },
    },
  })
  await routeLocal(page, cloud, 'ok')
  await loginFromHow(page)
  await page.getByTestId('scan-device-start').click()
  cloud.deviceState = 'scanning'
  cloud.devicePageCount = 1
  await expect(page.getByTestId('scan-device-run')).toBeVisible({ timeout: 15_000 })
  cloud.status = 'completed'
  cloud.withFile = true
  await expect(page.getByTestId('scan-device-done')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('这份扫描件已存进「我的文档」，手机上打开职易达小程序也能看到')).toBeVisible()
  await expect(page.getByRole('button', { name: /前往我的文档/ })).toBeVisible()
  await expect(page.getByTestId('scan-guest-ways')).toHaveCount(0)
  await expect(page.getByText(GUEST_LEAD)).toHaveCount(0)
  await shot(page, 'cs-scan-done-login')
})

test('a logged-in user with an empty document list is not told the file was saved @w2', async ({ page, api }) => {
  test.setTimeout(120_000)
  const cloud: Cloud = {
    status: 'waiting',
    deviceState: 'ready',
    devicePageCount: 0,
    deviceErrorCode: null,
    deviceSource: 'feeder',
    deviceColorMode: 'gray',
    deviceMaxPages: null,
    withFile: false,
  }
  registerShell(api)
  registerSession(api, cloud)
  registerLogin(api, [])
  await routeLocal(page, cloud, 'ok')
  await loginFromHow(page)
  await page.getByTestId('scan-device-start').click()
  cloud.status = 'completed'
  cloud.withFile = true
  cloud.deviceState = 'scanning'
  await expect(page.getByTestId('scan-device-done')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('scan-device-done')).toHaveAttribute('data-owner', 'unproven')
  await expect(page.getByText('已存进')).toHaveCount(0)
  await expect(page.getByText('未登录扫描件不会进入')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /前往我的文档/ })).toHaveCount(0)
})
