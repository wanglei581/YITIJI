import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Page, Request } from '@playwright/test'
import { test, expect } from '../fixtures/kiosk-test'
import type { ApiRouter } from '../fixtures/api-router'
import { RECRUITMENT_HOSTING_OFF, terminalConfigWithHosting } from '../fixtures/recruitment-hosting'

/**
 * W-16 / 合规 C6：一体机第一次用到 AI 时先确认年满 14 周岁，录音再单独同意。
 * 正式构建不注入 VITE_E2E_MOCK_TERMINAL_SESSION_TOKEN。终端身份走本机 Agent 夹具，
 * 引导票换成会话票之后才能读到「使用声明」开关。
 */

const EVIDENCE = join(homedir(), '.cache/walk0929/evidence/fix-declaration')
const CONFIG = '/api/v1/terminals/KSK-001/config'
const CHAT = '/api/v1/assistant/chat'
const TRTC = '/api/v1/trtc/session'
const BOOT = 'http://127.0.0.1:9527/local/terminal-boot-ticket'
const BOOT_TICKET = 'w16boot0123456789abcdefABCDEF0123456789ab'
const NOTE = '使用 AI 即表示你已年满 14 周岁'
const QUESTION = '我想把仓库管理员这段经历写成三段，方便下周内投。'
const FOLLOW_UP = '那三段里，盘点准确率该怎么写才不像空话？'

const ASSISTANT_REPLY = {
  sessionId: 'assistant-w16-chen-20260929',
  reply: '可以按「管过什么、怎么做的、结果如何」来写。例如：负责日均出库 800 单的日用品仓，把盘点从每月一次改成每周抽盘，三个月里账实差异从 1.8% 降到 0.4%。',
  intent: 'general',
  actions: [{ label: '去做简历诊断', route: '/resume/source' }],
  providerLabel: 'llm:deepseek',
  aiGenerated: true,
}

test.beforeAll(() => {
  mkdirSync(EVIDENCE, { recursive: true })
})

test.beforeEach(async ({ page }) => {
  await page.route(BOOT, async (route) => {
    const headers = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'X-Local-Bridge-Token, Accept, Content-Type',
    }
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers })
      return
    }
    await route.fulfill({
      status: 200,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { bootTicket: BOOT_TICKET } }),
    })
  })
})

function arm(api: ApiRouter, enforced: boolean): void {
  api.respond('GET', CONFIG, {
    status: 200,
    json: {
      ...terminalConfigWithHosting(RECRUITMENT_HOSTING_OFF, 'w16-declaration'),
      ai: { loginGate: 'off', declarationEnforced: enforced, paused: false },
    },
  })
  api.respond('GET', '/api/v1/terminals/KSK-001/printer-status', {
    status: 200,
    json: { printerStatus: 'ready', paperLevel: 'sufficient', isOnline: true },
  })
  api.respond('GET', '/api/v1/terminals/KSK-001/screensaver', {
    status: 200,
    json: { enabled: false, idleTimeoutSec: 180, items: [] },
  })
  api.respond('GET', '/api/v1/terminals/KSK-001/smart-campus', {
    status: 200,
    json: { enabled: false, modules: { welcome: false, bigdata: false, luggage: false, panorama: false }, items: [] },
  })
  api.respond('GET', '/api/v1/mock-interviews/capabilities/voice', {
    status: 200,
    json: { data: { asrEnabled: false, ttsEnabled: false } },
  })
  api.respond('GET', '/api/v1/jobs', {
    status: 200,
    json: { data: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } },
  })
  api.respond('GET', '/api/v1/job-fairs', {
    status: 200,
    json: { data: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } },
  })
  api.respond('POST', '/api/v1/terminals/session-token', {
    status: 200,
    json: { sessionToken: 'w16-terminal-session-0929' },
  })
  api.respond('POST', '/api/v1/terminals/session-token/refresh', {
    status: 200,
    json: { sessionToken: 'w16-terminal-session-0929' },
  })
  api.respond('POST', CHAT, { status: 200, json: ASSISTANT_REPLY })
  api.respond('POST', TRTC, {
    status: 503,
    json: { error: { code: 'AI_PROVIDER_NOT_CONFIGURED', message: '语音通话这会儿接不上' } },
  })
  // 正式构建会上报服务人次。这里只让请求有去处，不把人次写成页面上的成功。
  const visit = { success: true, data: { recorded: true } }
  api.respond('POST', '/api/v1/kiosk/session/start', { status: 200, json: visit })
  api.respond('POST', '/api/v1/kiosk/session/heartbeat', { status: 200, json: visit })
  api.respond('POST', '/api/v1/kiosk/session/end', { status: 200, json: visit })
}

async function acknowledge(page: Page): Promise<void> {
  await page.locator('button[data-ai-declaration-choice="no"][data-variant="primary"]').click()
}

function watch(page: Page, path: string): () => Record<string, string>[] {
  const seen: Record<string, string>[] = []
  const onRequest = (request: Request) => {
    if (request.method() !== 'POST') return
    if (new URL(request.url()).pathname !== path) return
    seen.push(request.headers())
  }
  page.on('request', onRequest)
  return () => seen
}

async function openAssistant(page: Page, api: ApiRouter): Promise<void> {
  await page.goto('/assistant')
  await expect(page.getByLabel('输入咨询问题')).toBeVisible()
  await expect.poll(() => api.requestCount('GET', CONFIG), { timeout: 20_000 }).toBeGreaterThan(0)
}

async function sendQuestion(page: Page, text: string): Promise<void> {
  await page.getByLabel('输入咨询问题').fill(text)
  await page.getByRole('group', { name: '虚拟键盘' }).getByRole('button', { name: '发送', exact: true }).click()
}

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: join(EVIDENCE, `W-16-${name}.png`) })
}

test('W-16 未声明就问，确认已满后请求带年龄声明并得到回答 @w3-kiosk', async ({ page, api }) => {
  arm(api, true)
  const chats = watch(page, CHAT)
  await openAssistant(page, api)
  await expect(page.getByText(NOTE, { exact: true })).toBeVisible()
  const before = api.requestCount('POST', CHAT)
  await sendQuestion(page, QUESTION)
  await expect(page.getByRole('heading', { name: '你已年满 14 周岁吗？' })).toBeVisible()
  expect(api.requestCount('POST', CHAT)).toBe(before)
  await shot(page, '01-age-ask')
  await page.getByRole('button', { name: '已满', exact: true }).click()
  await expect(page.getByText('三个月里账实差异从 1.8% 降到 0.4%。')).toBeVisible()
  expect(api.requestCount('POST', CHAT)).toBe(before + 1)
  expect(chats()).toHaveLength(1)
  expect(chats()[0]?.['x-age-14-plus']).toBe('declared')
  expect(chats()[0]?.['x-age-14-plus-version']).toBe('age-14-plus-v1')
  expect(chats()[0]?.['x-voice-recording']).toBeUndefined()
  await shot(page, '01-replied')

  await page.setViewportSize({ width: 390, height: 844 })
  const note = page.getByText(NOTE, { exact: true })
  const collapse = page.getByRole('button', { name: '收起', exact: true })
  if (await collapse.isVisible()) await collapse.click()
  await note.scrollIntoViewIfNeeded()
  await expect(note).toBeInViewport()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(1)
  await shot(page, '01-note-390')
})

test('W-16 选未满就不发这次请求，并说明不用 AI 也能办 @w3-kiosk', async ({ page, api }) => {
  arm(api, true)
  await openAssistant(page, api)
  const before = api.requestCount('POST', CHAT)
  await sendQuestion(page, QUESTION)
  await page.getByRole('button', { name: '未满', exact: true }).click()
  await expect(page.getByRole('heading', { name: '这台机器暂时办不了' })).toBeVisible()
  await acknowledge(page)
  await expect(page.getByText('打印、扫描和已有材料照常可办。')).toBeVisible()
  await expect(page.getByRole('navigation', { name: '不依赖 AI 的功能入口' }).getByRole('button', { name: /打印扫描/ })).toBeVisible()
  expect(api.requestCount('POST', CHAT)).toBe(before)
  await shot(page, '02-under-14')
})

test('W-16 语音通话先问年龄再单独同意，两项齐了才发出 @w3-kiosk', async ({ page, api }) => {
  arm(api, true)
  const calls = watch(page, TRTC)
  await openAssistant(page, api)
  await page.getByRole('button', { name: '语音咨询', exact: true }).click()
  await page.getByRole('button', { name: /直接语音通话/ }).click()
  await expect(page.getByRole('heading', { name: '你已年满 14 周岁吗？' })).toBeVisible()
  expect(api.requestCount('POST', TRTC)).toBe(0)
  await shot(page, '03-voice-age')
  await page.getByRole('button', { name: '已满', exact: true }).click()
  await expect(page.getByRole('heading', { name: '录音单独同意' })).toBeVisible()
  await expect(page.getByText('转完即删，不保存录音。')).toBeVisible()
  expect(api.requestCount('POST', TRTC)).toBe(0)
  await shot(page, '03-voice-consent')
  await page.getByRole('button', { name: '同意录音', exact: true }).click()
  await expect.poll(() => calls().length).toBe(1)
  expect(calls()[0]?.['x-age-14-plus']).toBe('declared')
  expect(calls()[0]?.['x-age-14-plus-version']).toBe('age-14-plus-v1')
  expect(calls()[0]?.['x-voice-recording']).toBe('granted')
  expect(calls()[0]?.['x-voice-recording-version']).toBe('voice-recording-v1')
  await shot(page, '03-voice-sent')
})

test('W-16 改用手打就不发起语音 @w3-kiosk', async ({ page, api }) => {
  arm(api, true)
  await openAssistant(page, api)
  await page.getByRole('button', { name: '语音咨询', exact: true }).click()
  await page.getByRole('button', { name: /直接语音通话/ }).click()
  await page.getByRole('button', { name: '已满', exact: true }).click()
  await page.getByRole('button', { name: '改用手打', exact: true }).click()
  await expect(page.getByRole('heading', { name: '这次不录音' })).toBeVisible()
  await acknowledge(page)
  await expect(page.getByRole('button', { name: /继续用文字/ })).toBeVisible()
  expect(api.requestCount('POST', TRTC)).toBe(0)
  await shot(page, '03b-voice-declined')
})

test('W-16 进待机清场后，再次提问会重新确认 @w3-kiosk', async ({ page, api }) => {
  arm(api, true)
  const chats = watch(page, CHAT)
  await openAssistant(page, api)
  await sendQuestion(page, QUESTION)
  await page.getByRole('button', { name: '已满', exact: true }).click()
  await expect(page.getByText('三个月里账实差异从 1.8% 降到 0.4%。')).toBeVisible()
  const afterYes = api.requestCount('POST', CHAT)

  await page.goto('/screensaver')
  await page.waitForURL('/')
  await page.goto('/assistant')
  await expect(page.getByLabel('输入咨询问题')).toBeVisible()
  await sendQuestion(page, FOLLOW_UP)
  await expect(page.getByRole('heading', { name: '你已年满 14 周岁吗？' })).toBeVisible()
  expect(api.requestCount('POST', CHAT)).toBe(afterYes)
  await shot(page, '04-after-clear')
  await page.getByRole('button', { name: '已满', exact: true }).click()
  await expect.poll(() => api.requestCount('POST', CHAT)).toBe(afterYes + 1)
  const again = chats().at(-1)
  expect(again?.['x-age-14-plus']).toBe('declared')
  expect(again?.['x-age-14-plus-version']).toBe('age-14-plus-v1')
})

test('W-16 使用声明关掉时不弹确认，请求也不带声明 @w3-kiosk', async ({ page, api }) => {
  arm(api, false)
  const chats = watch(page, CHAT)
  await openAssistant(page, api)
  await sendQuestion(page, QUESTION)
  await expect(page.getByText('三个月里账实差异从 1.8% 降到 0.4%。')).toBeVisible()
  await expect(page.getByRole('heading', { name: '你已年满 14 周岁吗？' })).toHaveCount(0)
  expect(chats()).toHaveLength(1)
  expect(chats()[0]?.['x-age-14-plus']).toBeUndefined()
  expect(chats()[0]?.['x-voice-recording']).toBeUndefined()
  await shot(page, '05-switch-off')
})
