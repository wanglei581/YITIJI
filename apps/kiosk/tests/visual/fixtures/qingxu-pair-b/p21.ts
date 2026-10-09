// 稿 21：来源首屏、目标工作台、确认屏、上传 / 解析十态，以及运行页真能走到的通道整屏。
import type { Page } from '@playwright/test'
import type { ApiRouter } from '../../../fixtures/api-router'
import type { QingxuPairTarget } from '../qingxu-pair-targets'
import { setReactRouterState } from '../fusion-w2-state'
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

const USB_PAIR = new Set(['usb-wait', 'usb-detecting', 'usb-list', 'usb-empty', 'usb-read-failed', 'usb-agent-offline', 'usb-importing', 'usb-import-failed', 'usb-ready'])
const LOCAL_PAIR = new Set(['local-guide', 'local-cancelled', 'local-oversize', 'local-unreadable', 'local-ready'])
const PHONE_PAIR = new Set(['phone-generating', 'phone-gen-failed', 'phone-ready', 'phone-waiting', 'phone-expired', 'phone-uploaded', 'phone-confirm-failed'])
const CHANNEL_SKIP: Record<string, string> = {
  'usb-selected': '点一份就立刻导入，没有先看再确认的中间页',
  'usb-unavailable': '未开通时卡片锁住，进不了整屏',
  'local-picking': '系统文件框不归本页画，不造示例目录',
  'local-selected': '选中文件立刻上传，不插入确认步',
  'local-rejected': '服务端明确拒收已经由 upload-failed 配上；引导路径会退回来源页的错误条',
  'phone-status-unknown': '连续三次查不到状态会收成过期，没有单独画面',
  'phone-cancelling': '冻结的扫码面板取消是尽力而为，不展示撤销中',
  'phone-cancelled': '取消后直接清掉二维码，没有已撤销画面',
  'phone-cancel-failed': '取消失败被吞掉，不会停在失败画面',
  'scan-expired': '过期的扫描交接停在扫描结果页，不会来到来源页',
  'scan-unavailable': '来源页没有扫描能力开关，进不了这一屏',
  'scan-failed': '交接失败停在扫描结果页，不会来到来源页',
}

const USB_FILES = [
  { safeId: 'usb-sun-warehouse', filename: SAMPLE, extension: '.pdf', sizeBytes: 892_416 },
  { safeId: 'usb-final', filename: '简历（最终版）.pdf', extension: '.pdf', sizeBytes: 860_160 },
]

type UsbMode = 'list' | 'wait' | 'empty' | 'detecting' | 'read-failed' | 'offline' | 'importing' | 'import-failed'

async function routeUsb(page: Page, mode: UsbMode = 'list'): Promise<void> {
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
    if (mode === 'offline') {
      await route.abort('failed')
      return
    }
    if (mode === 'detecting') {
      await new Promise(() => undefined)
      return
    }
    if (mode === 'read-failed') {
      await route.fulfill({ status: 500, headers, contentType: 'application/json', body: JSON.stringify({ success: false, error: { code: 'USB_READ_FAILED', message: '读盘失败' } }) })
      return
    }
    const uploading = request.method() === 'POST'
    if (uploading && (mode === 'importing' || mode === 'import-failed')) {
      if (mode === 'importing') {
        await new Promise(() => undefined)
        return
      }
      await route.fulfill({ status: 500, headers, contentType: 'application/json', body: JSON.stringify({ success: false, error: { code: 'USB_IMPORT_FAILED', message: '导入失败' } }) })
      return
    }
    if (path.endsWith('/status')) {
      const present = mode !== 'wait'
      await route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify({ success: true, data: { present, driveLabel: present ? 'RESUME' : null } }) })
      return
    }
    if (path.endsWith('/files')) {
      const files = mode === 'empty' || mode === 'wait' ? [] : USB_FILES
      await route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify({ success: true, data: { present: mode !== 'wait', driveLabel: 'RESUME', files } }) })
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

const PHONE_FILE = {
  fileId: 'file-sun-phone', filename: SAMPLE, sizeBytes: 892_416, mimeType: 'application/pdf',
  sha256: 'ab'.repeat(32), fileExpiresAt: '2026-10-06T01:00:00.000Z', fileUrl: '/pair-fixtures/sun-resume.pdf',
}

function phoneCreated(status: number, code = 'INTERNAL_SERVER_ERROR') {
  if (status !== 201) {
    return { status, json: { success: false, error: { code, message: '二维码这次没有生成' } } }
  }
  return { status: 201, json: { success: true, data: {
    sessionId: 'pair-phone', uploadUrl: '/upload/phone', uploadToken: 'pair-upload', controlToken: 'pair-control',
    expiresAt: '2099-01-01T00:00:00.000Z',
  } } }
}

function phoneStatus(status: string, file: typeof PHONE_FILE | null = null) {
  return { status: 200, json: { success: true, data: {
    sessionId: 'pair-phone', status, purpose: 'resume_upload', mode: 'temporary',
    file, requiresKioskConfirmation: false, expiresAt: '2099-01-01T00:00:00.000Z',
  } } }
}

async function openSource(page: Page): Promise<void> {
  await page.goto('/resume/source?screen=source', { waitUntil: 'domcontentloaded' })
}

async function prepareChannel(page: Page, api: ApiRouter, state: string): Promise<void> {
  const root = page.locator('[data-kiosk-screen="resume-source"]')
  if (state.startsWith('usb-')) {
    const mode = state === 'usb-agent-offline' ? 'offline'
      : state === 'usb-read-failed' ? 'read-failed'
      : state === 'usb-detecting' ? 'detecting'
      : state === 'usb-wait' ? 'wait'
      : state === 'usb-empty' ? 'empty'
      : state === 'usb-importing' ? 'importing'
      : state === 'usb-import-failed' ? 'import-failed'
      : 'list'
    await routeUsb(page, mode)
    await openSource(page)
    await page.getByRole('button', { name: /U盘上传/ }).click()
    const fileButton = page.getByRole('button', { name: new RegExp(SAMPLE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) })
    if (state === 'usb-list') await fileButton.waitFor({ state: 'visible' })
    if (state === 'usb-importing' || state === 'usb-import-failed' || state === 'usb-ready') await fileButton.click()
    await root.waitFor({ state: 'visible' })
    if (state === 'usb-ready') await page.getByRole('button', { name: '继续：确认这次办理' }).waitFor({ state: 'visible' })
    if (state === 'usb-importing') await page.getByText('正在导入').waitFor({ state: 'visible' })
    if (state === 'usb-import-failed') await page.getByText('导入失败').first().waitFor({ state: 'visible' })
    if (state === 'usb-wait') await page.getByText('还没有检测到 U 盘').waitFor({ state: 'visible' })
    if (state === 'usb-empty') await page.getByText('没有可用文件').first().waitFor({ state: 'visible', timeout: 20_000 })
    if (state === 'usb-detecting') await page.getByText('正在读取 U 盘').waitFor({ state: 'visible', timeout: 20_000 })
    if (state === 'usb-read-failed') await page.getByText('U盘读取失败').first().waitFor({ state: 'visible', timeout: 20_000 })
    if (state === 'usb-agent-offline') await page.getByText('读 U 盘暂时没连上').first().waitFor({ state: 'visible' })
    return
  }
  if (state.startsWith('local-')) {
    if (state === 'local-ready') {
      await page.route('**/api/v1/files/kiosk-upload', async (route) => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: uploadBody(200, '') })
      })
    }
    await openSource(page)
    await page.getByRole('button', { name: /本机文件/ }).click()
    await page.getByRole('button', { name: '打开文件选择' }).waitFor({ state: 'visible' })
    if (state === 'local-cancelled') {
      await page.getByLabel('选择本机简历文件').dispatchEvent('cancel')
      await page.getByText('这一步还没有文件').waitFor({ state: 'visible' })
    }
    if (state === 'local-oversize') {
      await page.getByLabel('选择本机简历文件').setInputFiles({ name: SAMPLE, mimeType: 'application/pdf', buffer: Buffer.alloc(10 * 1024 * 1024 + 1) })
      await page.getByText('超过 10MB').first().waitFor({ state: 'visible' })
    }
    if (state === 'local-unreadable') {
      await page.getByLabel('选择本机简历文件').setInputFiles({ name: SAMPLE, mimeType: 'application/pdf', buffer: Buffer.alloc(0) })
      await page.getByText('文件为空或大小未知').first().waitFor({ state: 'visible', timeout: 20_000 })
    }
    if (state === 'local-ready') {
      await page.getByLabel('选择本机简历文件').setInputFiles({ name: SAMPLE, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF') })
      await page.getByRole('button', { name: '继续：确认这次办理' }).waitFor({ state: 'visible' })
    }
    return
  }
  if (state.startsWith('phone-')) {
    if (state === 'phone-generating') {
      api.respondWith('POST', '/api/v1/upload-sessions', () => new Promise(() => undefined))
    } else if (state === 'phone-gen-failed') {
      api.respond('POST', '/api/v1/upload-sessions', phoneCreated(500))
    } else {
      api.respond('POST', '/api/v1/upload-sessions', phoneCreated(201))
      const uploaded = state === 'phone-uploaded' || state === 'phone-confirm-failed'
      const status = state === 'phone-waiting' ? 'uploading' : state === 'phone-expired' ? 'expired' : uploaded ? 'uploaded' : 'pending'
      api.respond('GET', '/api/v1/upload-sessions/pair-phone', phoneStatus(status, uploaded ? PHONE_FILE : null))
      if (state === 'phone-confirm-failed') {
        api.respond('POST', '/api/v1/upload-sessions/pair-phone/confirm', {
          status: 400, json: { success: false, error: { code: 'UPLOAD_CONFIRM_REJECTED', message: '这次确认没有完成' } },
        })
      }
    }
    await openSource(page)
    await page.getByRole('button', { name: /手机扫码/ }).click()
    if (state === 'phone-generating') await page.getByText('请用手机微信或浏览器扫码', { exact: true }).waitFor({ state: 'visible' })
    if (state === 'phone-gen-failed') await page.getByText('二维码生成失败，请稍后重试。').waitFor({ state: 'visible' })
    if (state === 'phone-ready' || state === 'phone-waiting') await page.locator('.resume-source-phone-session svg[width="150"]').waitFor({ state: 'visible' })
    if (state === 'phone-expired') await page.getByText('二维码已过期', { exact: true }).waitFor({ state: 'visible' })
    if (state === 'phone-uploaded' || state === 'phone-confirm-failed') {
      await page.getByText('手机端已上传文件', { exact: true }).waitFor({ state: 'visible', timeout: 20_000 })
      await page.getByText(SAMPLE).first().waitFor({ state: 'visible', timeout: 20_000 })
    }
    if (state === 'phone-confirm-failed') {
      await page.getByRole('button', { name: '确认使用这份简历' }).click()
      await page.getByText('确认失败，请刷新二维码重试。').waitFor({ state: 'visible' })
    }
    return
  }
  await openSource(page)
  await setReactRouterState(page, '/resume/source', {
    scanHandoff: {
      fileId: 'file-sun-scan',
      file: { name: SAMPLE, size: 892_416, format: 'pdf', fileUrl: '/pair-fixtures/sun-resume.pdf', mimeType: 'application/pdf' },
    },
  })
  await page.getByRole('region', { name: '扫描件交接' }).waitFor({ state: 'visible' })
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
    if (USB_PAIR.has(state) || LOCAL_PAIR.has(state)) {
      return driven(`[data-kiosk-screen="resume-source"][data-state="${state}"]`, '/resume/source')
    }
    if (PHONE_PAIR.has(state)) return driven('[data-kiosk-screen="resume-source"][data-state="phone"]', '/resume/source')
    if (state === 'scan-ready') return driven('[data-kiosk-screen="resume-source"][data-state="scan-ready"]', '/resume/source')
    if (state in CHANNEL_SKIP) return none(CHANNEL_SKIP[state]!)
    return none('这一态没有对应的运行页画面')
  },
  async prepare(page: Page, api: ApiRouter, target: QingxuPairTarget): Promise<void> {
    if (USB_PAIR.has(target.state) || LOCAL_PAIR.has(target.state) || PHONE_PAIR.has(target.state) || target.state === 'scan-ready') {
      await prepareChannel(page, api, target.state)
      return
    }
    if (target.state === 'summary') {
      await routeUsb(page)
      await page.goto('/resume/source?screen=source', { waitUntil: 'domcontentloaded' })
      await page.getByRole('button', { name: 'U盘上传' }).click()
      await page.getByRole('button', { name: new RegExp(SAMPLE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).click()
      await page.getByRole('button', { name: '继续：确认这次办理' }).click()
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
