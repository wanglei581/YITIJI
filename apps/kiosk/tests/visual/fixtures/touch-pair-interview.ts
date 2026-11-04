import { expect } from '@playwright/test'
import { kioskAiCapabilitiesResponse } from '../../fixtures/ai-capabilities'
import { interviewCreated, interviewReport, interviewStarted } from './fusion-w3-states'
import { loginTo, registerTouchShell, see, spaGo, terminalReady, writeSession } from './touch-pair-shell'
import { chooseInterviewExperience } from './direction-selection'
import type { TouchPair } from './touch-pair-types'

const KEY = 'ai-job-print:current-interview-workbench'
const SESSION = 'interview-w3-public-fixture'
const TOKEN = 'w3-interview-browser-only'

async function remember(page: import('@playwright/test').Page, value: unknown): Promise<void> {
  // 等正式构建换票清场完成，再写会话、软跳。标题出现本身不能证明换票完成。
  await page.goto('/interview-service', { waitUntil: 'domcontentloaded' })
  await terminalReady(page)
  await writeSession(page, KEY, value)
}

function stubReport(api: import('../../fixtures/api-router').ApiRouter, status = 200, json: unknown = interviewReport): void {
  api.respond('GET', `/api/v1/mock-interviews/${SESSION}/report`, { status, json })
}

/** fusion-w3 beginTextInterview：每一步都通过现有可见控件，不用查询参数冒充第 2/3 步。 */
async function openSetup(page: import('@playwright/test').Page, api: import('../../fixtures/api-router').ApiRouter, step: 1 | 2 | 3): Promise<void> {
  registerTouchShell(api)
  await page.goto('/interview?stage=setup')
  await terminalReady(page)
  await see(page, '[data-setup-step="1"]')
  if (step === 1) return
  // 按钮可及名是「选择行业 (20) 尚未选择」，照 fusion-w3 用包含匹配。
  await page.getByRole('button', { name: '选择行业 (20)' }).click()
  const dialog = page.getByRole('dialog', { name: '选择面试行业' })
  await dialog.getByRole('button', { name: '制造业', exact: true }).click()
  await dialog.getByRole('button', { name: '完成', exact: true }).click()
  await chooseInterviewExperience(page)
  await page.getByPlaceholder(/输入目标岗位/).fill('前端开发工程师')
  await page.getByRole('button', { name: '下一步', exact: true }).click()
  await see(page, '[data-setup-step="2"]')
  if (step === 3) {
    await page.getByRole('button', { name: '下一步', exact: true }).click()
    await see(page, '[data-setup-step="3"]')
  }
}

export function interviewPairs(): TouchPair[] {
  const setup = (screen: string, step: 1 | 2 | 3): TouchPair => ({
    item: '面试', screen, state: 'default', route: '/interview?stage=setup',
    seeds: ['openSetup', `可见操作进入第 ${step} 步`], missingReason: null,
    prepare: (page, api) => openSetup(page, api, step),
  })
  return [
    {
      item: '面试', screen: 'interview', state: 'default', route: '/interview-service',
      seeds: ['registerTouchShell'],
      missingReason: null,
      prepare: async (page, api) => {
        registerTouchShell(api)
        await page.goto('/interview-service')
        await expect(page.getByRole('button', { name: /马上练一场/ })).toBeEnabled()
      },
    },
    {
      item: '面试', screen: 'interview', state: 'ai-down', route: '/interview-service',
      seeds: ['kioskAiCapabilitiesResponse mock_interview + assistant_chat off'],
      missingReason: null,
      proto: { query: { ai: 'down' } },
      prepare: async (page, api) => {
        registerTouchShell(api)
        api.respond('GET', '/api/v1/kiosk/ai/capabilities', {
          status: 200,
          json: kioskAiCapabilitiesResponse({
            mock_interview: { status: 'off', reason: 'AI_PAUSED' },
            assistant_chat: { status: 'off', reason: 'AI_PAUSED' },
          }),
        })
        await page.goto('/interview-service')
        await see(page, 'text=可以先看面试技巧')
        await expect(page.locator('[data-qxt-ask="off"]')).toBeVisible()
      },
    },
    {
      item: '面试', screen: 'interview-more', state: 'open', route: '/interview-service',
      seeds: ['registerTouchShell', 'click 其余 4 项'],
      missingReason: null,
      prepare: async (page, api) => {
        registerTouchShell(api)
        await page.goto('/interview-service')
        await page.getByRole('button', { name: /其余 4 项/ }).click()
        await see(page, 'text=返回练面试')
      },
    },
    setup('iv-1', 1),
    setup('iv-2', 2),
    setup('iv-3', 3),
    {
      item: '面试', screen: 'iv-3', state: 'start-fail', route: '/interview?stage=setup',
      seeds: ['openSetup step 3', 'POST mock-interviews → interviewCreated', 'POST start → 503 AI_BUSY'],
      missingReason: null,
      proto: { patch: { fiStartFail: 1, fiCreating: 0 } },
      prepare: async (page, api) => {
        api.respond('POST', '/api/v1/mock-interviews', { status: 200, json: interviewCreated })
        // fusion-w3 失败用例同一 /start 端点；暂时繁忙不伪装成会话已开始。
        api.respond('POST', `/api/v1/mock-interviews/${SESSION}/start`, {
          status: 503, json: { success: false, error: { code: 'AI_BUSY', message: '当前使用的人较多，请稍后再试' } },
        })
        await openSetup(page, api, 3)
        await page.getByRole('button', { name: '创建并开始练习', exact: true }).click()
        await expect(page.locator('[data-setup-step="3"]')).toBeVisible()
        await see(page, 'text=本次没有进入面试间')
      },
    },
    {
      item: '面试', screen: 'iv-run', state: 'live', route: '/interview?stage=session',
      seeds: ['sessionStorage live', 'interviewStarted.firstQuestion'],
      missingReason: null,
      prepare: async (page, api) => {
        registerTouchShell(api)
        await remember(page, {
          stage: 'session',
          live: {
            sessionId: SESSION,
            accessToken: TOKEN,
            questionTarget: interviewStarted.data.questionTarget,
            durationMin: 5,
            interviewerType: 'hr',
            position: '前端开发工程师',
            firstQuestion: interviewStarted.data.question,
            messages: [],
            questionIndex: 1,
            remainingSec: 240,
          },
        })
        await spaGo(page, '/interview?stage=session')
        await see(page, `text=${interviewStarted.data.question}`)
        await expect(page.getByRole('textbox', { name: '本题回答' })).toBeVisible()
      },
    },
    {
      item: '面试', screen: 'iv-run', state: 'expired', route: '/interview?stage=session',
      seeds: ['无会话直达 stage=session'],
      missingReason: null,
      proto: { patch: { fiPhase: 'expired' } },
      prepare: async (page, api) => {
        registerTouchShell(api)
        await page.goto('/interview?stage=session')
        await see(page, 'text=这场练习已过期，需要重新开始')
      },
    },
    {
      item: '面试', screen: 'iv-report', state: 'default', route: '/interview?stage=report',
      seeds: ['sessionStorage report', 'GET mock-interviews/:id/report'],
      missingReason: null,
      prepare: async (page, api) => {
        registerTouchShell(api)
        stubReport(api)
        await remember(page, { stage: 'report', report: { sessionId: SESSION, accessToken: TOKEN } })
        await spaGo(page, '/interview?stage=report')
        await see(page, 'text=预测题、STAR、清单、摘录')
      },
    },
    {
      item: '面试', screen: 'iv-report', state: 'loading', route: '/interview?stage=report',
      seeds: ['GET report hang'],
      missingReason: null,
      proto: { patch: { fiRep: 'loading' } },
      prepare: async (page, api) => {
        registerTouchShell(api)
        api.respondWith('GET', `/api/v1/mock-interviews/${SESSION}/report`, () => new Promise(() => undefined))
        await remember(page, { stage: 'report', report: { sessionId: SESSION, accessToken: TOKEN } })
        await spaGo(page, '/interview?stage=report')
        await see(page, 'text=正在核对报告状态。')
      },
    },
    {
      item: '面试', screen: 'iv-report', state: 'gone', route: '/interview?stage=report',
      seeds: ['GET report 404'],
      missingReason: null,
      proto: { patch: { fiRep: 'gone' } },
      prepare: async (page, api) => {
        registerTouchShell(api)
        stubReport(api, 404, { error: { code: 'NOT_FOUND', message: '报告不存在或已过期' } })
        await remember(page, { stage: 'report', report: { sessionId: SESSION, accessToken: TOKEN } })
        await spaGo(page, '/interview?stage=report')
        await see(page, 'text=报告不存在或已过期')
      },
    },
    {
      item: '面试', screen: 'iv-report-more', state: 'more', route: '/interview?stage=report',
      seeds: ['GET report', 'click 预测题、STAR、清单、摘录'],
      missingReason: null,
      prepare: async (page, api) => {
        registerTouchShell(api)
        stubReport(api)
        await remember(page, { stage: 'report', report: { sessionId: SESSION, accessToken: TOKEN } })
        await spaGo(page, '/interview?stage=report')
        await page.getByRole('button', { name: /预测题、STAR、清单、摘录/ }).click()
        await see(page, 'text=高频问题预测')
      },
    },
    {
      item: '面试', screen: 'iv-tips', state: 'default', route: '/interview?stage=tips',
      seeds: ['registerTouchShell'],
      missingReason: null,
      prepare: async (page, api) => {
        registerTouchShell(api)
        await page.goto('/interview?stage=tips')
        await see(page, '[data-kiosk-screen="interview-tips"]')
      },
    },
    {
      item: '面试', screen: 'iv-reports', state: 'logged-out', route: '/interview?stage=reports',
      seeds: ['registerTouchShell'],
      missingReason: null,
      prepare: async (page, api) => {
        registerTouchShell(api)
        await page.goto('/interview?stage=reports')
        await see(page, 'text=未登录不列出历史')
      },
    },
    {
      item: '面试', screen: 'iv-reports', state: 'logged-empty', route: '/interview?stage=reports',
      seeds: ['loginThroughVisibleUi', 'GET /me/mock-interviews items []'],
      missingReason: null,
      proto: { query: { login: '1' } },
      prepare: async (page, api) => {
        registerTouchShell(api)
        api.respond('GET', '/api/v1/me/mock-interviews', {
          status: 200,
          json: { data: { items: [], nextCursor: null } },
        })
        await loginTo(page, api, '/interview-service')
        await spaGo(page, '/interview?stage=reports')
        await see(page, 'text=还没有练习报告')
      },
    },
  ]
}
