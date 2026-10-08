// 稿 21：来源首屏、目标工作台、确认屏，以及上传 / 解析十态。通道整屏留给下一包。
import type { Page } from '@playwright/test'
import type { ApiRouter } from '../../../fixtures/api-router'
import type { QingxuPairTarget } from '../qingxu-pair-targets'
import type { ResumePageFixture, ResumePagesPlan } from './types'

const PLAN = { kind: 'resume-pages' } as const
const PAIRED = new Set(['source', 'target', 'target-context', 'target-profile', 'target-industry', 'summary'])
const SAMPLE = '孙晓雯-仓储主管简历.pdf'
const UPLOAD_STATES = new Set(['uploading', 'upload-failed', 'upload-unknown', 'upload-rechecking'])
const PARSE_STATES = new Set(['parsing', 'parse-failed', 'parse-unknown', 'parse-rechecking'])

const hit = (state: string): ResumePagesPlan => ({
  plan: PLAN,
  reason: null,
  marker: `[data-kiosk-screen="resume-source"][data-screen="${state}"]`,
  runtimePath: `/resume/source?screen=${state}`,
})
const driven = (marker: string, runtimePath: string): ResumePagesPlan => ({
  plan: PLAN,
  reason: null,
  marker,
  runtimePath,
})
const none = (reason: string): ResumePagesPlan => ({ plan: { kind: 'none' }, reason, marker: null, runtimePath: null })

const USB_FILES = [
  { safeId: 'usb-sun-warehouse', filename: SAMPLE, extension: '.pdf', sizeBytes: 892_416 },
  { safeId: 'usb-final', filename: '简历（最终版）.pdf', extension: '.pdf', sizeBytes: 860_160 },
]

async function routeUsb(page: Page): Promise<void> {
  await page.route('http://127.0.0.1:9527/local/usb/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const origin = new URL(page.url()).origin
    const headers = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Local-Bridge-Token',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Private-Network': 'true',
    }
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers })
      return
    }
    if (path.endsWith('/status')) {
      await route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify({ success: true, data: { present: true, driveLabel: 'RESUME' } }) })
      return
    }
    if (path.endsWith('/files')) {
      await route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify({ success: true, data: { present: true, driveLabel: 'RESUME', files: USB_FILES } }) })
      return
    }
    const chosen = USB_FILES.find((item) => request.postData()?.includes(item.safeId)) ?? USB_FILES[0]
    await route.fulfill({
      status: 200,
      headers,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          fileId: 'file-sun-warehouse',
          filename: chosen.filename,
          sizeBytes: chosen.sizeBytes,
          mimeType: 'application/pdf',
          sha256: 'ab'.repeat(32),
          fileUrl: '/pair-fixtures/sun-resume.pdf',
          fileUrlExpiresAt: new Date(Date.now() + 300_000).toISOString(),
        },
      }),
    })
  })
}

async function stageLocalFile(page: Page): Promise<void> {
  await page.goto('/resume/source?screen=source', { waitUntil: 'domcontentloaded' })
  await page.getByLabel('选择本机简历文件').setInputFiles({
    name: SAMPLE,
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\n%%EOF'),
  })
}

function uploadBody(status: number, body: string): string {
  return JSON.stringify(status === 200
    ? { success: true, data: { fileId: 'file-sun-warehouse', filename: SAMPLE, sizeBytes: 892_416, mimeType: 'application/pdf', sha256: 'ab'.repeat(32), signedUrl: '/pair-fixtures/sun-resume.pdf', signedUrlExpiresAt: '2026-10-06T00:05:00.000Z', fileExpiresAt: null } }
    : { success: false, error: { code: 'FILE_TYPE_NOT_ALLOWED', message: body } })
}

async function openParse(page: Page): Promise<void> {
  await page.route('**/api/v1/files/kiosk-upload', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: uploadBody(200, '') })
  })
  await stageLocalFile(page)
  await page.locator('[data-kiosk-screen="resume-source"][data-screen="summary"]').waitFor({ state: 'visible' })
  await page.getByRole('button', { name: 'AI 诊断，看改进建议' }).click()
  await page.waitForURL((url) => url.pathname === '/resume/parse')
}

export const page21: ResumePageFixture = {
  prefix: '21-',
  plan(screen, state) {
    if (screen !== 'main') return none('稿 21 的状态都挂在 main，这一屏不是取件工作台')
    if (PAIRED.has(state)) return hit(state)
    if (UPLOAD_STATES.has(state)) {
      return driven(`[data-kiosk-screen="resume-source"][data-state="${state}"]`, '/resume/source')
    }
    if (state === 'parsing') return driven('[data-kiosk-screen="resume-parse"][data-state="waiting"]', '/resume/parse')
    if (state === 'parse-failed') return driven('[data-kiosk-screen="resume-parse"][data-state="failed"]', '/resume/parse')
    if (state === 'parse-unknown') return driven('[data-kiosk-screen="resume-parse"][data-state="unknown"]', '/resume/parse')
    if (state === 'parse-rechecking') return driven('[data-kiosk-screen="resume-parse"][data-recheck="checking"]', '/resume/parse')
    if (state === 'missing-file') return driven('[data-kiosk-screen="resume-parse"][data-state="missing-file"]', '/resume/parse')
    if (state === 'unknown') return driven('[data-kiosk-screen="resume-source"][data-state="unknown"]', '/resume/source')
    if (/^(usb|local|phone|scan)-/.test(state)) return none('通道整屏这次不配，下一包再做')
    return none('这一态没有对应的运行页画面')
  },
  async prepare(page: Page, _api: ApiRouter, target: QingxuPairTarget): Promise<void> {
    if (target.state === 'summary') {
      await routeUsb(page)
      await page.goto('/resume/source?screen=source', { waitUntil: 'domcontentloaded' })
      await page.getByRole('button', { name: 'U盘上传' }).click()
      await page.getByRole('button', { name: new RegExp(SAMPLE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).click()
      await page.locator('[data-kiosk-screen="resume-source"][data-screen="summary"]').waitFor({ state: 'visible' })
      return
    }
    if (target.state === 'uploading') {
      await page.route('**/api/v1/files/kiosk-upload', () => new Promise(() => undefined))
      await stageLocalFile(page)
      return
    }
    if (target.state === 'upload-failed') {
      await page.route('**/api/v1/files/kiosk-upload', async (route) => {
        await route.fulfill({ status: 400, contentType: 'application/json', body: uploadBody(400, '不支持的文件类型，请上传 PDF 或图片') })
      })
      await stageLocalFile(page)
      return
    }
    if (target.state === 'upload-unknown' || target.state === 'upload-rechecking') {
      await page.route('**/api/v1/files/kiosk-upload', (route) => route.abort('internetdisconnected'))
      await stageLocalFile(page)
      await page.locator('[data-kiosk-screen="resume-source"][data-state="upload-unknown"]').waitFor({ state: 'visible' })
      if (target.state === 'upload-rechecking') {
        await page.getByRole('button', { name: '再查刚才这一次的结果' }).click()
      }
      return
    }
    if (target.state === 'parsing') {
      await page.route('**/api/v1/resume/parse', () => new Promise(() => undefined))
      await openParse(page)
      return
    }
    if (target.state === 'parse-failed') {
      await page.clock.install()
      await page.route('**/api/v1/resume/parse', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ taskId: 'pair-parse-failed', status: 'failed', failReason: '文字识别失败，请确保文件清晰', accessToken: 'pair-failed-access' }),
        })
      })
      await openParse(page)
      return
    }
    if (target.state === 'parse-unknown' || target.state === 'parse-rechecking') {
      await page.route('**/api/v1/resume/parse', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ taskId: 'pair-parse-pending', status: 'processing', accessToken: 'pair-pending-access' }),
        })
      })
      if (target.state === 'parse-rechecking') {
        await page.route('**/api/v1/resume/records/pair-parse-pending', () => new Promise(() => undefined))
      }
      await openParse(page)
      if (target.state === 'parse-rechecking') {
        await page.getByRole('button', { name: '再查刚才这一次的结果' }).click()
      }
      return
    }
    if (target.state === 'missing-file') {
      await page.goto('/resume/parse', { waitUntil: 'domcontentloaded' })
      return
    }
    if (target.state === 'unknown') {
      await page.goto('/resume/source?screen=not-a-step', { waitUntil: 'domcontentloaded' })
      return
    }
    await page.goto(`/resume/source?screen=${target.state}`, { waitUntil: 'domcontentloaded' })
  },
}
