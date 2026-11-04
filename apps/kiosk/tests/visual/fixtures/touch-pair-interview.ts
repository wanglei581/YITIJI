import { kioskAiCapabilitiesResponse } from '../../fixtures/ai-capabilities'
import { interviewReport, interviewStarted } from './fusion-w3-states'
import { loginTo, registerTouchShell, see, spaGo, writeSession } from './touch-pair-shell'
import type { TouchPair } from './touch-pair-types'

const KEY = 'ai-job-print:current-interview-workbench'
const SESSION = 'interview-w3-public-fixture'
const TOKEN = 'w3-interview-browser-only'

async function remember(page: import('@playwright/test').Page, value: unknown): Promise<void> {
  // 换票会清掉面试会话。等服务台标题出来再写，后面的软跳才读得到。
  await page.goto('/interview', { waitUntil: 'domcontentloaded' })
  await see(page, 'text=把表达练熟，不替你下结论')
  await writeSession(page, KEY, value)
}

function stubReport(api: import('../../fixtures/api-router').ApiRouter, status = 200, json: unknown = interviewReport): void {
  api.respond('GET', `/api/v1/mock-interviews/${SESSION}/report`, { status, json })
}

export function interviewPairs(): TouchPair[] {
  const setup = (screen: string, state: string): TouchPair => ({
    item: '面试',
    screen,
    state,
    route: '/interview?stage=setup',
    seeds: ['registerTouchShell'],
    missingReason: null,
    prepare: async (page, api) => {
      registerTouchShell(api)
      await page.goto('/interview?stage=setup')
      await see(page, '[data-kiosk-screen="interview-setup"]')
    },
  })
  return [
    {
      item: '面试', screen: 'interview', state: 'default', route: '/interview-service',
      seeds: ['registerTouchShell'],
      missingReason: null,
      prepare: async (page, api) => {
        registerTouchShell(api)
        await page.goto('/interview-service')
        await see(page, 'h1')
      },
    },
    {
      item: '面试', screen: 'interview', state: 'ai-down', route: '/interview-service',
      seeds: ['kioskAiCapabilitiesResponse mock_interview off'],
      missingReason: null,
      proto: { query: { ai: 'down' } },
      prepare: async (page, api) => {
        registerTouchShell(api)
        api.respond('GET', '/api/v1/kiosk/ai/capabilities', {
          status: 200,
          json: kioskAiCapabilitiesResponse({ mock_interview: { status: 'off', reason: 'AI_PAUSED' } }),
        })
        await page.goto('/interview-service')
        await see(page, 'h1')
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
    setup('iv-1', 'default'),
    setup('iv-2', 'default'),
    setup('iv-3', 'default'),
    {
      item: '面试', screen: 'iv-3', state: 'start-fail', route: '/interview?stage=setup',
      seeds: [],
      missingReason: '开始失败要先提交创建面试再吃到失败响应。现成注册器没有不经填表就提交的一键入口，空表不能当成已开始。',
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
        await see(page, '[data-kiosk-screen="interview-session"]')
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
        await see(page, '[data-kiosk-screen="interview-session"]')
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
        await see(page, '[data-kiosk-screen="interview-report"]')
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
        await see(page, '[data-kiosk-screen="interview-report"]')
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
        await see(page, '[data-kiosk-screen="interview-reports"]')
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
        await page.getByRole('button', { name: /回看报告|训练报告|历史报告/ }).first().click()
        await see(page, '[data-kiosk-screen="interview-reports"]')
      },
    },
  ]
}
