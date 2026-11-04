import { writeScanWorkbenchSession } from './fusion-w2-state'
import { registerTouchShell, see, spaGo } from './touch-pair-shell'
import type { TouchPair } from './touch-pair-types'

const FILE = {
  fileId: 'scan-file-1',
  fileUrl: '/w2-fixtures/scan.pdf',
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
  await page.goto('/scan', { waitUntil: 'domcontentloaded' })
  await see(page, '[data-scan-stage="start"]')
  await writeScanWorkbenchSession(page, resultSession(outcome))
  // 第二次整页打开会换终端票并清掉扫描会话。软跳才读得到刚写入的结果。
  await spaGo(page, '/scan?stage=result')
  await see(page, '[data-scan-stage="result"]')
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
      seeds: ['registerTouchShell'],
      missingReason: null,
      prepare: async (page, api) => {
        registerTouchShell(api)
        await page.goto('/scan?stage=settings')
        await see(page, '[data-scan-stage="settings"]')
      },
    },
    {
      item: '扫描', screen: 'scan-wait', state: 'waiting', route: '/scan?stage=progress',
      seeds: ['scan session waiting', 'writeScanWorkbenchSession', 'spaGo'],
      missingReason: null,
      prepare: async (page, api) => {
        registerTouchShell(api)
        api.respond('GET', '/api/v1/scan/sessions/w2-scan-001', {
          status: 200,
          json: {
            success: true,
            data: {
              scanTaskId: 'w2-scan-001',
              status: 'waiting',
              scanType: 'resume',
              file: null,
              errorCode: null,
              errorMessage: null,
            },
          },
        })
        await page.goto('/scan', { waitUntil: 'domcontentloaded' })
        await see(page, '[data-scan-stage="start"]')
        await writeScanWorkbenchSession(page, {
          stage: 'progress',
          scanType: 'resume',
          live: {
            scanTaskId: 'w2-scan-001',
            controlToken: 'w2-scan-control',
            instructions: ['放好原件'],
            expiresAt: '2099-01-01T00:00:00.000Z',
          },
        })
        await spaGo(page, '/scan?stage=progress')
        await see(page, '[data-scan-stage="progress"]')
      },
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
