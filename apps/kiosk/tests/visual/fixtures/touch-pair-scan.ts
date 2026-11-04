import { expect } from '@playwright/test'
import { W2_FILE, writeScanWorkbenchSession } from './fusion-w2-state'
import { registerTouchShell, routeVisiblePdf, see, spaGo, terminalReady } from './touch-pair-shell'
import type { TouchPair } from './touch-pair-types'

const FILE = {
  fileId: 'scan-file-1',
  fileUrl: W2_FILE.fileUrl,
  name: '扫描件.pdf',
  size: '128 KB',
  pages: 1,
  format: 'pdf',
  mimeType: 'application/pdf',
}

function resultSession(outcome: 'completed' | 'completed-no-file' | 'failed' | 'expired') {
  return {
    stage: 'result',
    scanType: 'resume',
    result: {
      outcome,
      success: outcome === 'completed',
      reason: outcome === 'completed' ? undefined : '这次没有拿到可用文件',
      file: outcome === 'completed' ? FILE : undefined,
    },
  }
}

async function openResult(
  page: import('@playwright/test').Page,
  outcome: 'completed' | 'completed-no-file' | 'failed' | 'expired',
): Promise<void> {
  await routeVisiblePdf(page)
  await page.goto('/scan?stage=start', { waitUntil: 'domcontentloaded' })
  await terminalReady(page)
  await see(page, '[data-scan-stage="start"]')
  await writeScanWorkbenchSession(page, resultSession(outcome))
  // 第二次整页打开会换终端票并清掉扫描会话。软跳才读得到刚写入的结果。
  await spaGo(page, '/scan?stage=result')
  await see(page, '[data-scan-stage="result"]')
  const title = { completed: '扫描完成', expired: '等待超时', failed: '扫描未完成', 'completed-no-file': '已完成 · 结果里没有文件' }[outcome]
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
}

/** fusion-w2-scan.spec.ts 的 seedScanLive + registerScanAck，等 ACK 后才算正常指引/等待。 */
async function openScanLive(page: import('@playwright/test').Page, api: import('../../fixtures/api-router').ApiRouter, stage: 'settings' | 'progress'): Promise<void> {
  registerTouchShell(api)
  const scanTaskId = 'w2-scan-001'
  api.respond('POST', `/api/v1/scan/sessions/${scanTaskId}/ack`, {
    status: 200, json: { success: true, data: { scanTaskId, deliveryAckedAt: '2026-09-14T00:00:00.000Z' } },
  })
  api.respond('GET', `/api/v1/scan/sessions/${scanTaskId}`, {
    status: 200, json: { success: true, data: {
      scanTaskId, status: 'waiting', scanType: 'resume', file: null, errorCode: null, errorMessage: null,
    } },
  })
  api.respond('DELETE', `/api/v1/scan/sessions/${scanTaskId}`, {
    status: 200, json: { success: true, data: { scanTaskId, status: 'cancelled' } },
  })
  await page.goto('/scan?stage=start')
  await terminalReady(page)
  await see(page, '[data-scan-stage="start"]')
  await writeScanWorkbenchSession(page, {
    stage, scanType: 'resume', live: {
      scanTaskId, controlToken: 'w2-scan-control',
      instructions: ['放好原件', '在打印机面板开始扫描'], expiresAt: '2099-01-01T00:00:00.000Z',
    },
  })
  await spaGo(page, `/scan?stage=${stage}`)
  await see(page, `[data-scan-stage="${stage}"]`)
  await expect.poll(() => api.requestCount('POST', `/api/v1/scan/sessions/${scanTaskId}/ack`)).toBe(1)
  await see(page, stage === 'settings' ? 'text=在打印机面板开始扫描' : 'text=等待打印机端扫描完成')
}

export function scanPairs(): TouchPair[] {
  return [
    {
      item: '扫描', screen: 'scan-type', state: 'default', route: '/scan',
      seeds: ['registerTouchShell'],
      missingReason: null,
      prepare: async (page, api) => {
        registerTouchShell(api)
        await page.goto('/scan')
        await see(page, '[data-scan-stage="start"]')
      },
    },
    {
      item: '扫描', screen: 'scan-guide', state: 'settings', route: '/scan?stage=settings',
      seeds: ['openScanLive settings', 'writeScanWorkbenchSession live', 'POST scan/sessions/:id/ack'],
      missingReason: null,
      prepare: (page, api) => openScanLive(page, api, 'settings'),
    },
    {
      item: '扫描', screen: 'scan-wait', state: 'waiting', route: '/scan?stage=progress',
      seeds: ['openScanLive progress', 'GET scan/sessions waiting', 'POST scan/sessions/:id/ack'],
      missingReason: null,
      prepare: (page, api) => openScanLive(page, api, 'progress'),
    },
    {
      item: '扫描', screen: 'scan-result', state: 'completed', route: '/scan?stage=result',
      seeds: ['writeScanWorkbenchSession outcome completed'],
      missingReason: null,
      prepare: async (page, api) => {
        registerTouchShell(api)
        await openResult(page, 'completed')
      },
    },
    {
      item: '扫描', screen: 'scan-result', state: 'timeout', route: '/scan?stage=result',
      seeds: ['writeScanWorkbenchSession outcome expired'],
      missingReason: null,
      proto: { patch: { fsResult: 'timeout' } },
      prepare: async (page, api) => {
        registerTouchShell(api)
        await openResult(page, 'expired')
      },
    },
    {
      item: '扫描', screen: 'scan-result', state: 'incomplete', route: '/scan?stage=result',
      seeds: ['writeScanWorkbenchSession outcome failed'],
      missingReason: null,
      proto: { patch: { fsResult: 'incomplete' } },
      prepare: async (page, api) => {
        registerTouchShell(api)
        await openResult(page, 'failed')
      },
    },
    {
      item: '扫描', screen: 'scan-result', state: 'nofile', route: '/scan?stage=result',
      seeds: ['writeScanWorkbenchSession outcome completed-no-file'],
      missingReason: null,
      proto: { patch: { fsResult: 'nofile' } },
      prepare: async (page, api) => {
        registerTouchShell(api)
        await openResult(page, 'completed-no-file')
      },
    },
  ]
}
