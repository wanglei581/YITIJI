// 稿 29：模拟面试。设置、作答、报告、记录、技巧相关态配运行时；稿上的演示跳转不造。
import type { Page } from '@playwright/test'
import type { ApiRouter } from '../../../fixtures/api-router'
import { registerAuthenticatedMemberApis, registerMemberLogin } from '../kiosk-p1-evidence-capture-api'
import { chooseInterviewExperience } from '../direction-selection'
import type { QingxuPairTarget } from '../qingxu-pair-targets'
import type { ResumePageFixture, ResumePagesPlan } from './types'

const WORKBENCH_KEY = 'ai-job-print:current-interview-workbench'

const WAREHOUSE_REPORT = {
  sessionId: 'pair-warehouse-report',
  position: '仓储主管',
  industry: '交通运输、仓储和邮政业',
  interviewerType: 'manager',
  interviewerLabel: '业务主管',
  durationMin: 8,
  endedAt: '2026-10-05T09:20:00.000Z',
  includeAnswersInPrint: false,
  qaExcerpts: [{
    question: '请讲一次你把库存差异查清楚的经历。',
    answerExcerpt: '上个月盘点有一排货对不上。我按货位把进出记录对了一遍，发现夜班把两箱货记到了隔壁库位。我改了账，也跟夜班对过交接。',
    skipped: false,
  }],
  report: {
    overall: {
      level: 'pass',
      summary: '你把仓储现场的事讲清楚了，数字和你自己做的动作都在。下一步可以把少了多少、后来怎样说得更短。',
    },
    expression: ['先说事情，再说自己做了什么，听得懂。'],
    positionFit: ['说的是收货、盘点和发货，和仓储主管每天要做的事对得上。'],
    credibility: ['夜班记错库位这件事有时间、有地点，不像临时编的。'],
    professional: ['会用货位和交接来解释差异，不是只说自己很负责。'],
    adaptability: ['被追问夜班交接时，你补了是和谁对过。'],
    risks: ['少了具体箱数和改账用了多久，听的人还要再问一次。'],
    predictedQuestions: [{
      question: '如果旺季到货比平时多一倍，你先保哪一件事？',
      why: '看你会不会先排轻重',
      approach: '先说不能停的发货，再说临时加人怎么排班',
    }],
    starAdvice: {
      s: '旺季前两周，有一排货连续三天对不上。',
      t: '当天要把差异收口，不能带到第二天发货。',
      a: '你按货位把进出记录对完，改账，并跟夜班重对了交接。',
      r: '第二天这排货能发出去，后面一周没有再错到隔壁库位。',
      reminder: '只说你自己经手的事，箱数记不清就说记不清。',
    },
    checklist: ['把最近一次盘点的箱数写在纸上', '准备一个夜班交接的例子', '想好旺季先保发货还是先保上架'],
  },
}

const MEMBER_PHONE = '13800138000'
const MEMBER_CODE = '123456'

const WAREHOUSE_ANSWER = '上个月盘点有一排货对不上。我按货位把进出记录对了一遍，发现夜班把两箱货记到了隔壁库位。我改了账，也跟夜班对过交接。'
const WAREHOUSE_FOLLOWUP = '如果旺季到货比平时多一倍，你先保哪一件事？'
const WINDOW_QUESTION = '请用一两分钟说说，你在市南区社区服务中心窗口接待居民时，怎么把一件事办清楚。'

function hit(marker: string, runtimePath: string): ResumePagesPlan {
  return { plan: { kind: 'resume-pages' }, marker, runtimePath, reason: null }
}

function hang(api: ApiRouter, method: string, path: string): void {
  api.respondWith(method, path, () => new Promise(() => {}))
}

async function seedWorkbench(page: Page, session: unknown): Promise<void> {
  await page.addInitScript(([key, value]) => {
    sessionStorage.setItem(key, JSON.stringify(value))
  }, [WORKBENCH_KEY, session] as const)
}

function liveSession(sessionId: string, interactionMode: 'text' | 'voice', messages: Array<{ role: 'interviewer' | 'candidate'; content: string }>, position: string) {
  return {
    stage: 'session',
    live: {
      sessionId,
      accessToken: 'pair-interview-token',
      questionTarget: 4,
      durationMin: 8,
      interviewerType: position.includes('窗口') ? 'hr' : 'manager',
      position,
      messages,
      questionIndex: messages.filter((item) => item.role === 'interviewer').length,
      remainingSec: 240,
      omitPrintAnswers: false,
      answersRecorded: messages.some((item) => item.role === 'candidate'),
      interactionMode,
    },
  }
}

function voiceCapability(api: ApiRouter, asrEnabled: boolean): void {
  api.respond('GET', '/api/v1/mock-interviews/capabilities/voice', {
    status: 200,
    json: { data: { asrEnabled, ttsEnabled: false } },
  })
}

function created(sessionId: string) {
  return { status: 200, json: { data: { sessionId, questionTarget: 4, accessToken: 'pair-interview-token' } } }
}

async function chooseIndustry(page: Page, label: string): Promise<void> {
  await page.getByRole('button', { name: '选择行业 (20)' }).click()
  const dialog = page.getByRole('dialog', { name: '选择面试行业' })
  await dialog.getByRole('button', { name: label, exact: true }).click()
  await dialog.getByRole('button', { name: '完成' }).click()
}

async function seedResumePreview(page: Page): Promise<void> {
  await page.addInitScript((key) => {
    const canvas = document.createElement('canvas')
    canvas.width = 640
    canvas.height = 840
    const ctx = canvas.getContext('2d')
    let fileUrl = ''
    if (ctx) {
      ctx.fillStyle = '#fffdf8'
      ctx.fillRect(0, 0, 640, 840)
      ctx.fillStyle = '#10302b'
      ctx.font = '32px sans-serif'
      ctx.fillText('王磊', 48, 88)
      ctx.font = '22px sans-serif'
      ctx.fillText('求职：仓储主管', 48, 142)
      ctx.fillText('青岛 · 仓储与配送', 48, 186)
      ctx.fillText('2019 年至 2024 年在物流园做仓储主管。', 48, 260)
      ctx.fillText('负责收货、上架、盘点和发货核对。', 48, 304)
      fileUrl = canvas.toDataURL('image/png')
    }
    sessionStorage.setItem(key, JSON.stringify({
      stage: 'setup',
      setup: {
        directionSelectionVersion: 1,
        interviewerType: 'manager',
        industry: '交通运输、仓储和邮政业',
        position: '仓储主管',
        experience: 'y3_5',
        difficulty: 'standard',
        duration: 8,
        interactionMode: 'text',
        resumeFile: {
          fileId: 'resume-warehouse-png',
          name: '王磊-仓储主管简历.png',
          mimeType: 'image/png',
          fileUrl,
        },
        pendingSession: null,
        aiOutage: null,
        startFailed: false,
        probed: false,
      },
    }))
  }, WORKBENCH_KEY)
}

function reportListItem(input: {
  sessionId: string
  position: string
  industry: string
  interviewerType: string
  interviewerLabel: string
  createdAt: string
}) {
  return {
    ...input,
    durationMin: 8,
    endedAt: input.createdAt,
    hasReport: true,
  }
}

async function loginToReports(page: Page): Promise<void> {
  await page.goto(`/login?from=${encodeURIComponent('/interview?stage=reports')}`)
  const phoneTab = page.getByRole('button', { name: '手机号登录', exact: true })
  if (await phoneTab.count()) await phoneTab.click()
  await page.getByRole('checkbox', { name: /我已阅读并同意/ }).click()
  await page.getByRole('button', { name: '手机号（11 位本人号码）', exact: true }).click()
  for (const digit of MEMBER_PHONE) await page.getByRole('button', { name: digit, exact: true }).click()
  await page.getByRole('button', { name: '收起键盘', exact: true }).click()
  await page.getByRole('button', { name: '获取验证码', exact: true }).click()
  const smsTab = page.getByRole('button', { name: '短信验证码', exact: true })
  if (await smsTab.count()) await smsTab.click()
  for (const digit of MEMBER_CODE) await page.getByRole('button', { name: digit, exact: true }).click()
  await page.getByRole('button', { name: '收起键盘', exact: true }).click()
  await page.getByRole('button', { name: '确认登录', exact: true }).click()
  await page.waitForURL(/\/interview\?stage=reports/)
}

async function stubGrantedMic(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const devices = [{
      deviceId: 'pair-mic',
      groupId: 'pair',
      kind: 'audioinput' as const,
      label: '夹具麦克风',
      toJSON() { return this },
    }]
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        enumerateDevices: async () => devices,
        getUserMedia: async () => {
          const ctx = new AudioContext()
          const dest = ctx.createMediaStreamDestination()
          const osc = ctx.createOscillator()
          osc.frequency.value = 440
          osc.connect(dest)
          osc.start()
          await ctx.resume()
          return dest.stream
        },
        addEventListener() { /* noop */ },
        removeEventListener() { /* noop */ },
      },
    })
    Object.defineProperty(navigator, 'permissions', {
      configurable: true,
      value: { query: async () => ({ state: 'granted' }) },
    })
  })
}

async function stubDeniedMic(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const devices = [{
      deviceId: '',
      groupId: '',
      kind: 'audioinput' as const,
      label: '',
      toJSON() { return this },
    }]
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        enumerateDevices: async () => devices,
        getUserMedia: async () => {
          throw new DOMException('Permission denied', 'NotAllowedError')
        },
        addEventListener() { /* noop */ },
        removeEventListener() { /* noop */ },
      },
    })
    Object.defineProperty(navigator, 'permissions', {
      configurable: true,
      value: { query: async () => ({ state: 'denied' }) },
    })
  })
}

export const page29: ResumePageFixture = {
  prefix: '29-',
  plan(_screen, state): ResumePagesPlan | null {
    switch (state) {
      case 'setup':
        return hit('[data-testid="interview-interaction-mode"]', '/interview?stage=setup')
      case 'setup-resume-preview':
        return hit('[data-interview-state="setup-resume-preview"]', '/interview?stage=setup')
      case 'session-expired':
        return hit('[data-testid="interview-expired"]', '/interview?stage=session')
      case 'report-ready':
        return hit('[data-testid="interview-report-overview"]', '/interview?stage=report')
      case 'report-unavailable':
        return hit('text=报告不存在或已过期', '/interview?stage=report')
      case 'ai-down':
        return hit('.kiosk-ai-fallback', '/interview?stage=setup')
      case 'mic-denied':
        return hit('[data-mic-reason]', '/interview?stage=session')
      case 'session-text':
        return hit('.interview-session__question-text', '/interview?stage=session')
      case 'report-pending':
        return hit('[data-interview-state="report-pending"]', '/interview?stage=session')
      case 'report-loading':
        return hit('text=正在读取本场练习报告', '/interview?stage=report')
      case 'reports-ready':
        return hit('text=青岛某物流公司 · 仓储主管', '/interview?stage=reports')
      case 'reports-empty-member':
        return hit('text=还没有练习报告', '/interview?stage=reports')
      case 'network-error':
        return hit('text=这三种结果分别意味着', '/interview?stage=session')
      case 'transcript-review':
        return hit('text=转写结果（可编辑，确认后提交）', '/interview?stage=session')
      default:
        return null
    }
  },
  async prepare(page: Page, api: ApiRouter, target: QingxuPairTarget): Promise<void> {
    if (target.state === 'setup') {
      voiceCapability(api, true)
      await page.goto('/interview?stage=setup')
      return
    }
    if (target.state === 'setup-resume-preview') {
      voiceCapability(api, true)
      api.respond('GET', '/api/v1/document-conversion/capabilities', {
        status: 200,
        json: { data: { wordToPdf: false } },
      })
      await seedResumePreview(page)
      await page.goto('/interview?stage=setup')
      await page.getByRole('button', { name: '预览这份简历' }).click()
      return
    }
    if (target.state === 'session-expired') {
      voiceCapability(api, false)
      await page.goto('/interview?stage=session')
      return
    }
    if (target.state === 'report-ready') {
      api.respond('GET', '/api/v1/mock-interviews/pair-warehouse-report/report', {
        status: 200,
        json: { data: WAREHOUSE_REPORT },
      })
      await page.addInitScript((key) => {
        sessionStorage.setItem(key, JSON.stringify({
          stage: 'report',
          report: { sessionId: 'pair-warehouse-report' },
        }))
      }, WORKBENCH_KEY)
      await page.goto('/interview?stage=report')
      return
    }
    if (target.state === 'report-unavailable') {
      api.respond('GET', '/api/v1/mock-interviews/pair-warehouse-report/report', {
        status: 404,
        json: { error: { code: 'NOT_FOUND', message: '报告不存在或已过期' } },
      })
      await page.addInitScript((key) => {
        sessionStorage.setItem(key, JSON.stringify({
          stage: 'report',
          report: { sessionId: 'pair-warehouse-report' },
        }))
      }, WORKBENCH_KEY)
      await page.goto('/interview?stage=report')
      return
    }
    if (target.state === 'ai-down') {
      voiceCapability(api, false)
      api.respond('POST', '/api/v1/mock-interviews', created('pair-ai-down'))
      api.respond('POST', '/api/v1/mock-interviews/pair-ai-down/start', {
        status: 503,
        json: { success: false, error: { code: 'AI_PAUSED', message: 'AI 服务暂停中' } },
      })
      await page.goto('/interview?stage=setup')
      await chooseIndustry(page, '交通运输、仓储和邮政业')
      await chooseInterviewExperience(page)
      await page.getByPlaceholder(/输入目标岗位/).fill('仓储主管')
      await page.getByRole('button', { name: '创建并开始练习' }).click()
      await page.locator('.kiosk-ai-fallback').waitFor({ state: 'visible' })
      return
    }
    if (target.state === 'mic-denied') {
      await stubDeniedMic(page)
      voiceCapability(api, true)
      api.respond('POST', '/api/v1/mock-interviews', created('pair-mic-denied'))
      api.respond('POST', '/api/v1/mock-interviews/pair-mic-denied/start', {
        status: 200,
        json: {
          data: {
            done: false,
            question: '请用一两分钟说说，你在窗口接待居民时怎么把一件事办清楚。',
            qType: 'intro',
            questionIndex: 1,
            questionTarget: 4,
          },
        },
      })
      await page.goto('/interview?stage=setup')
      await chooseIndustry(page, '公共管理、社会保障和社会组织')
      await chooseInterviewExperience(page)
      await page.getByPlaceholder(/输入目标岗位/).fill('窗口服务专员')
      await page.getByRole('button', { name: '语音回合（文字兜底）', exact: true }).click()
      await page.getByRole('button', { name: '创建并开始练习' }).click()
      await page.locator('[data-mic-reason]').waitFor({ state: 'visible' })
      return
    }
    if (target.state === 'session-text') {
      voiceCapability(api, false)
      await seedWorkbench(page, liveSession('pair-session-text', 'text', [
        { role: 'interviewer', content: '请讲一次你把库存差异查清楚的经历。' },
        { role: 'candidate', content: WAREHOUSE_ANSWER },
        { role: 'interviewer', content: WAREHOUSE_FOLLOWUP },
      ], '仓储主管'))
      await page.goto('/interview?stage=session')
      await page.locator('.interview-session__question-text').filter({ hasText: WAREHOUSE_FOLLOWUP }).waitFor({ state: 'visible' })
      return
    }
    if (target.state === 'report-pending') {
      voiceCapability(api, false)
      hang(api, 'POST', '/api/v1/mock-interviews/pair-report-pending/end')
      await seedWorkbench(page, liveSession('pair-report-pending', 'text', [
        { role: 'interviewer', content: '请讲一次你把库存差异查清楚的经历。' },
        { role: 'candidate', content: WAREHOUSE_ANSWER },
      ], '仓储主管'))
      await page.goto('/interview?stage=session')
      await page.getByRole('button', { name: '结束本场练习', exact: true }).click()
      await page.locator('[data-interview-state="report-pending"]').waitFor({ state: 'visible' })
      return
    }
    if (target.state === 'report-loading') {
      hang(api, 'GET', '/api/v1/mock-interviews/pair-report-loading/report')
      await seedWorkbench(page, {
        stage: 'report',
        report: { sessionId: 'pair-report-loading', accessToken: 'pair-interview-token' },
      })
      await page.goto('/interview?stage=report')
      await page.getByText('正在读取本场练习报告').waitFor({ state: 'visible' })
      return
    }
    if (target.state === 'reports-ready' || target.state === 'reports-empty-member') {
      registerMemberLogin(api)
      registerAuthenticatedMemberApis(api)
      api.respond('GET', '/api/v1/me/mock-interviews', {
        status: 200,
        json: {
          data: {
            items: target.state === 'reports-ready' ? [
              reportListItem({
                sessionId: 'pair-reports-warehouse',
                position: '青岛某物流公司 · 仓储主管',
                industry: '交通运输、仓储和邮政业',
                interviewerType: 'manager',
                interviewerLabel: '业务主管',
                createdAt: '2026-10-05T09:20:00.000Z',
              }),
              reportListItem({
                sessionId: 'pair-reports-window',
                position: '市南区社区服务中心 · 窗口服务专员',
                industry: '公共管理、社会保障和社会组织',
                interviewerType: 'hr',
                interviewerLabel: 'HR 面试',
                createdAt: '2026-10-04T06:10:00.000Z',
              }),
            ] : [],
            nextCursor: null,
          },
        },
      })
      await loginToReports(page)
      const marker = target.state === 'reports-ready' ? '青岛某物流公司 · 仓储主管' : '还没有练习报告'
      await page.getByText(marker).waitFor({ state: 'visible' })
      return
    }
    if (target.state === 'network-error') {
      voiceCapability(api, false)
      api.abort('POST', '/api/v1/mock-interviews/pair-network/answer', 'internetdisconnected')
      await seedWorkbench(page, liveSession('pair-network', 'text', [
        { role: 'interviewer', content: '请讲一次你把库存差异查清楚的经历。' },
      ], '仓储主管'))
      await page.goto('/interview?stage=session')
      await page.getByRole('textbox', { name: '本题回答' }).fill('我先保住当天要发出的货，临时加人之前先把夜班交接写清楚。')
      await page.locator('.interview-session__answer-dock').getByRole('button', { name: '提交回答', exact: true }).click()
      await page.getByText('这三种结果分别意味着').waitFor({ state: 'visible' })
      return
    }
    if (target.state === 'transcript-review') {
      await stubGrantedMic(page)
      voiceCapability(api, true)
      api.respond('POST', '/api/v1/mock-interviews/pair-transcript/transcribe', {
        status: 200,
        json: { data: { text: '居民来办居住证明，我先核对姓名和住址，缺的材料写在回执上，约好下午再来取。' } },
      })
      await seedWorkbench(page, liveSession('pair-transcript', 'voice', [
        { role: 'interviewer', content: WINDOW_QUESTION },
      ], '窗口服务专员'))
      await page.goto('/interview?stage=session')
      await page.getByRole('button', { name: '开始回答（语音）', exact: true }).click()
      await page.getByRole('button', { name: /结束回答（已录/ }).click()
      await page.getByText('转写结果（可编辑，确认后提交）').waitFor({ state: 'visible' })
    }
  },
}
