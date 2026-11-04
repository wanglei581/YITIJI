import { diagnosis } from './fusion-w3-states'
import { W2_FILE, W2_ORDER, W2_PRINT_PARAMS, setReactRouterState } from './fusion-w2-state'
import { registerTouchShell, see, spaGo, stubTakeaway, writeSession } from './touch-pair-shell'
import type { TouchPair } from './touch-pair-types'

const RESUME_KEY = 'ai-job-print:current-ai-resume'

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
      item: '状态样式板', screen: 'st-error', state: 'upload-failed', route: '/print/upload',
      seeds: [],
      missingReason: '稿画的是手机上传过大拒收（phoneUploadModel too-large）。现成注册器没有一键造出这一屏，不许伪造上传失败。',
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
      seeds: ['GET print/jobs PRINT_JOB_UNCONFIRMED', 'setReactRouterState'],
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
        await page.goto('/print/done')
        await setReactRouterState(page, '/print/done', {
          taskId: W2_ORDER.taskId,
          file: W2_FILE,
          params: W2_PRINT_PARAMS,
          source: 'document',
        })
        await see(page, 'text=打印结果未确认')
      },
    },
    {
      item: '状态样式板', screen: 'st-ai-down', state: 'resume-diagnosis', route: '/resume/report',
      seeds: ['session current-ai-resume', 'GET record status failed failCode AI_PAUSED'],
      missingReason: null,
      prepare: async (page, api) => {
        registerTouchShell(api)
        api.respond('GET', `/api/v1/resume/records/${diagnosis.taskId}`, {
          status: 200,
          json: {
            taskId: diagnosis.taskId,
            accessToken: diagnosis.accessToken,
            status: 'failed',
            failCode: 'AI_PAUSED',
            failReason: 'AI 暂停，这次没有生成诊断',
            providerName: 'llm',
          },
        })
        await page.goto('/resume-service', { waitUntil: 'domcontentloaded' })
        await see(page, 'text=你手上有简历吗？')
        await writeSession(page, RESUME_KEY, { taskId: diagnosis.taskId, accessToken: diagnosis.accessToken })
        await spaGo(page, '/resume/report')
        await see(page, '[data-kiosk-screen="resume-report"]')
      },
    },
  ]
}
