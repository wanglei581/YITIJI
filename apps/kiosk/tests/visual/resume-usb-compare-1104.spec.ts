import type { Page } from '@playwright/test'
import { test, expect } from '../fixtures/kiosk-test'
import type { ApiRouter } from '../fixtures/api-router'
import { RECRUITMENT_HOSTING_ON } from '../fixtures/recruitment-hosting'
import { diagnosis } from './fixtures/fusion-w3-states'

const USB_UNCONFIRMED = '这次导入没有等到结果，请重新选择文件再导一次'
const TASK_ID = diagnosis.taskId
const SESSION = 'w1104-phone'

const OPTIMIZED_RESUME = {
  basic: { name: '夹具' },
  intention: {},
  summary: '参与项目沟通，跟进需求。',
  education: [],
  experience: [{ company: '夹具公司', title: '工程师', startDate: '2024-01', endDate: '2024-06', description: '负责页面联调并核对上线结果。' }],
  projects: [],
  skills: [],
  certificates: [],
}

const OPTIMIZE_MODULES = [
  { title: '个人简介', before: '参与项目沟通。', after: '参与项目沟通，跟进需求。' },
  { title: '项目经历', before: '负责页面联调。', after: '负责页面联调并核对上线结果。' },
]

function terminalBaseline(api: ApiRouter): void {
  api.respond('GET', '/api/v1/terminals/KSK-001/printer-status', {
    status: 200,
    json: { printerStatus: 'ready', paperLevel: 'sufficient', isOnline: true },
  })
  api.respond('GET', '/api/v1/terminals/KSK-001/config', {
    status: 200,
    json: { smartCampus: { enabled: false, modules: {}, items: [] }, toolbox: { enabled: false, items: [] }, ...RECRUITMENT_HOSTING_ON, configVersion: 'w1104', refreshIntervalMs: 300000, serverTime: '2026-11-04T00:00:00.000Z' },
  })
  api.respond('GET', '/api/v1/terminals/KSK-001/screensaver', { status: 200, json: { enabled: false, idleTimeoutSec: 180, items: [] } })
  api.respond('GET', '/api/v1/mock-interviews/capabilities/voice', { status: 200, json: { data: { asrEnabled: false, ttsEnabled: false } } })
}

async function hangUsbUpload(page: Page): Promise<{ uploads: () => number; release: () => void }> {
  let uploads = 0
  let releaseUpload = (): void => {}
  const held = new Promise<void>((resolve) => { releaseUpload = resolve })
  await page.route('http://127.0.0.1:9527/local/usb/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const origin = new URL(page.url()).origin
    const corsHeaders = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Local-Bridge-Token',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Private-Network': 'true',
    }
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: corsHeaders })
      return
    }
    if (path.endsWith('/status')) {
      await route.fulfill({ status: 200, headers: corsHeaders, contentType: 'application/json', body: JSON.stringify({ success: true, data: { present: true, driveLabel: 'TEST-USB' } }) })
      return
    }
    if (path.endsWith('/files')) {
      await route.fulfill({ status: 200, headers: corsHeaders, contentType: 'application/json', body: JSON.stringify({ success: true, data: { present: true, driveLabel: 'TEST-USB', files: [{ safeId: 'usb-safe-hang', filename: 'U盘简历.pdf', extension: '.pdf', sizeBytes: 2048 }] } }) })
      return
    }
    uploads += 1
    await held
    await route.abort('timedout').catch(() => undefined)
  })
  return { uploads: () => uploads, release: () => releaseUpload() }
}

function registerPhoneToOptimize(api: ApiRouter): void {
  const file = {
    fileId: 'w1104-phone-file',
    filename: '手机传来的简历.pdf',
    sizeBytes: 2048,
    mimeType: 'application/pdf',
    sha256: 'e'.repeat(64),
    fileExpiresAt: null,
    fileUrl: '/w3-fixtures/resume.pdf',
  }
  api.respond('POST', '/api/v1/upload-sessions', {
    status: 201,
    json: { success: true, data: { sessionId: SESSION, uploadUrl: '/upload/phone', uploadToken: 'w1104-up', controlToken: 'w1104-ctl', expiresAt: '2099-01-01T00:00:00.000Z' } },
  })
  api.respond('GET', `/api/v1/upload-sessions/${SESSION}`, {
    status: 200,
    json: { success: true, data: { sessionId: SESSION, status: 'uploaded', purpose: 'resume_upload', mode: 'temporary', file, requiresKioskConfirmation: false, expiresAt: '2099-01-01T00:00:00.000Z' } },
  })
  api.respond('POST', `/api/v1/upload-sessions/${SESSION}/confirm`, {
    status: 200,
    json: { success: true, data: { sessionId: SESSION, status: 'confirmed', file } },
  })
  api.respond('POST', '/api/v1/resume/parse', { status: 200, json: diagnosis })
  api.respond('GET', `/api/v1/resume/records/${TASK_ID}`, { status: 200, json: diagnosis })
  api.respond('GET', `/api/v1/resume/records/${TASK_ID}/optimize`, {
    status: 200,
    json: {
      taskId: TASK_ID,
      status: 'completed',
      providerName: 'llm',
      modules: OPTIMIZE_MODULES,
      optimizedResume: OPTIMIZED_RESUME,
    },
  })
}

async function reachOptimizeSuggestions(page: Page): Promise<void> {
  await page.goto('/resume/source')
  await page.getByRole('button', { name: /在手机里/ }).click()
  const confirm = page.locator('.qxt-dock').getByRole('button', { name: '确认使用这份文件' })
  await expect(confirm).toBeEnabled({ timeout: 15_000 })
  await confirm.click()
  await page.getByRole('button', { name: '下一步：诊断方向', exact: true }).click()
  await page.getByRole('button', { name: '开始 AI 诊断', exact: true }).click()
  await page.waitForURL(/\/resume\/report/)
  await page.getByRole('button', { name: /查看优化建议/ }).click()
  await expect(page.getByTestId('resume-optimize-primary')).toBeVisible({ timeout: 15_000 })
}

test('resume USB import shows the unconfirmed sentence when the local upload never answers @w3-kiosk', async ({ page, api }) => {
  test.setTimeout(60_000)
  const clears: string[] = []
  page.on('console', (message) => {
    if (message.text().includes('[kiosk-clear]')) clears.push(message.text())
  })
  await page.clock.install()
  const usb = await hangUsbUpload(page)
  terminalBaseline(api)
  await page.goto('/resume/source')
  await page.getByRole('button', { name: /在 U 盘里/ }).click()
  await page.getByRole('button', { name: /U盘简历\.pdf/ }).click()
  const dock = page.locator('.qxt-dock')
  await dock.getByRole('button', { name: '导入这份文件' }).click()
  await expect(dock.getByRole('button', { name: '正在导入' })).toBeDisabled()
  await page.clock.fastForward(45_000)
  await expect(page.getByText(USB_UNCONFIRMED, { exact: true })).toBeVisible()
  await expect(page.getByText('U盘读取失败')).toHaveCount(0)
  await expect(dock.getByRole('button', { name: '导入这份文件' })).toBeEnabled()
  expect(usb.uploads()).toBe(1)
  await page.clock.fastForward(5_000)
  expect(usb.uploads()).toBe(1)
  expect(clears).toEqual([])
  await expect(page).toHaveURL(/\/resume\/source/)
  usb.release()
})

test('anonymous phone upload to compare stays on the chosen item @w3-kiosk', async ({ page, api }) => {
  test.setTimeout(90_000)
  const clears: string[] = []
  page.on('console', (message) => {
    if (message.text().includes('[kiosk-clear]')) clears.push(message.text())
  })
  terminalBaseline(api)
  registerPhoneToOptimize(api)
  await reachOptimizeSuggestions(page)

  await page.getByTestId('resume-optimize-primary').click()
  await expect(page.locator('[data-kiosk-screen="resume-optimize-compare"]')).toBeVisible()
  await expect(page.getByText(/第 1 \/ 2 条/)).toBeVisible()
  await page.waitForTimeout(4_000)
  await expect(page).toHaveURL(/\/resume\/optimize\/compare/)
  await expect(page.locator('[data-kiosk-screen="resume-optimize-compare"]')).toBeVisible()
  expect(clears, '立刻点逐条看不应清场').toEqual([])

  await page.goto(`/resume/optimize?taskId=${TASK_ID}`)
  await expect(page.getByTestId('resume-optimize-overview')).toBeVisible()
  await page.getByRole('group', { name: '第 2 条用哪一版' }).getByRole('button', { name: '保留原文', exact: true }).click()
  await page.getByRole('button', { name: /第 2 条 项目经历/ }).click()
  const leave = page.getByRole('dialog', { name: '离开前确认' })
  await expect(leave).toBeVisible()
  await leave.getByRole('button', { name: '确认离开' }).click()
  await expect(page.getByText(/第 2 \/ 2 条/)).toBeVisible()
  await expect(page.getByRole('button', { name: '保留原文', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.waitForTimeout(3_000)
  await expect(page).toHaveURL(/\/resume\/optimize\/compare/)
  expect(clears, '未保存编辑后进入第 2 条不应清场').toEqual([])
})

test('compare stays put after the optimize page has been idle for 60 seconds @w3-kiosk', async ({ page, api }) => {
  test.setTimeout(90_000)
  const clears: string[] = []
  page.on('console', (message) => {
    if (message.text().includes('[kiosk-clear]')) clears.push(message.text())
  })
  await page.clock.install()
  terminalBaseline(api)
  registerPhoneToOptimize(api)
  await reachOptimizeSuggestions(page)
  await page.clock.fastForward(60_000)
  await expect(page.getByTestId('resume-optimize-primary')).toBeVisible()
  await page.getByTestId('resume-optimize-primary').click()
  await expect(page.locator('[data-kiosk-screen="resume-optimize-compare"]')).toBeVisible()
  await page.clock.fastForward(5_000)
  await expect(page).toHaveURL(/\/resume\/optimize\/compare/)
  expect(clears, '等 60 秒后再点逐条看不应清场').toEqual([])
})
