import { expect } from '@playwright/test'
import { resumeReading } from './touch-pair-resume-seeds'
import { W2_FILE, W2_ORDER, W2_PRINT_PARAMS } from './fusion-w2-state'
import { registerTouchShell, see, spaGo, stubTakeaway, terminalReady } from './touch-pair-shell'
import type { TouchPair } from './touch-pair-types'

export function statePairs(): TouchPair[] {
  return [
    {
      item: '状态样式板', screen: 'st-loading', state: 'print-capabilities', route: '/print-scan',
      seeds: ['GET capabilities hang'],
      missingReason: null,
      prepare: async (page, api) => {
        registerTouchShell(api)
        api.respondWith('GET', '/api/v1/terminals/KSK-001/capabilities', () => new Promise(() => undefined))
        await page.goto('/print-scan')
        await see(page, '[data-testid="print-hub-state-capability-loading"]')
      },
    },
    {
      item: '状态样式板', screen: 'st-empty', state: 'print-no-file', route: '/print/desk?step=preview',
      seeds: ['直接打开 /print/preview，不写入文件'],
      missingReason: null,
      prepare: async (page, api) => {
        registerTouchShell(api)
        await page.goto('/print/preview')
        await see(page, 'text=这一页没有待处理的文件')
      },
    },
    {
      item: '状态样式板', screen: 'st-error', state: 'upload-failed',
      seeds: ['registerTouchShell', 'qingxu-pair-seeds phone-gen-failed: POST upload-sessions 500'],
      missingReason: null,
      // 状态样式板配同类出错：二维码创建失败，不把手机端的 23.6MB 拒收冒充成一体机事实。
      route: '/print/upload?source=document&tab=qr',
      prepare: async (page, api) => {
        registerTouchShell(api)
        api.respond('POST', '/api/v1/upload-sessions', {
          status: 500, json: { error: { code: 'UPLOAD_SESSION_FAILED', message: '二维码生成失败' } },
        })
        await page.goto('/print/upload?source=document&tab=qr')
        await expect(page.getByRole('heading', { name: '二维码没出来，文件没传上来', exact: true })).toBeVisible()
      },
    },
    {
      item: '状态样式板', screen: 'st-unavailable', state: 'resume-health', route: '/resume-service',
      seeds: ['GET /api/v1/health 503'],
      missingReason: null,
      prepare: async (page, api) => {
        registerTouchShell(api)
        api.respond('GET', '/api/v1/health', { status: 503, json: { error: { code: 'SERVICE_UNAVAILABLE', message: 'down' } } })
        await page.goto('/resume-service')
        await see(page, 'text=在线服务暂时连不上')
      },
    },
    {
      item: '状态样式板', screen: 'st-device-off', state: 'paper-empty', route: '/print-scan',
      seeds: ['printer-status paper_empty'],
      missingReason: null,
      prepare: async (page, api) => {
        registerTouchShell(api, { isOnline: true, printerStatus: 'paper_empty' })
        await page.goto('/print-scan')
        await see(page, 'text=缺纸')
      },
    },
    {
      item: '状态样式板', screen: 'st-unconfirmed', state: 'print-job', route: '/print/done',
      seeds: ['GET print/jobs PRINT_JOB_UNCONFIRMED', 'terminalReady + spaGo + W2_ORDER'],
      missingReason: null,
      prepare: async (page, api) => {
        registerTouchShell(api)
        stubTakeaway(api, W2_ORDER.taskId)
        api.respond('GET', `/api/v1/print/jobs/${W2_ORDER.taskId}`, {
          status: 200,
          json: {
            taskId: W2_ORDER.taskId,
            status: 'failed',
            errorCode: 'PRINT_JOB_UNCONFIRMED',
            failureReasonForUser: '打印作业已提交到打印队列，但未确认完成',
          },
        })
        await page.goto('/print-scan')
        await terminalReady(page)
        await spaGo(page, '/print/done', {
          ...W2_ORDER,
          file: W2_FILE,
          params: W2_PRINT_PARAMS,
          source: 'document',
        })
        await see(page, 'text=打印结果未确认')
      },
    },
    {
      item: '状态样式板', screen: 'st-ai-down', state: 'resume-diagnosis', route: '/resume/report',
      seeds: ['resumeReading AI_QUOTA_EXHAUSTED', 'USB 原件', 'POST resume/parse 429 → diagnose-failed'],
      missingReason: null,
      prepare: (page, api) => resumeReading(page, api, true, 'AI_QUOTA_EXHAUSTED'),
    },
  ]
}
