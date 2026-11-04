import { expect, type Page } from '@playwright/test'
import type { ApiRouter } from '../../fixtures/api-router'
import { RECRUITMENT_HOSTING_OFF, terminalConfigWithHosting } from '../../fixtures/recruitment-hosting'
import { VISIBLE_PDF } from './fusion-w2-binary-route'
import { openResumeDirection, startResumeDiagnosis } from './direction-selection'
import { registerTouchShell, see, terminalReady } from './touch-pair-shell'

// 应答与可见操作来源：fusion-w3.spec.ts「USB resume keeps its purpose」及手机确认用例。
export function stubResumePhone(api: ApiRouter): void {
  const sessionId = 'w118-resume-upload'
  const expiresAt = '2099-01-01T00:00:00.000Z'
  api.respond('POST', '/api/v1/upload-sessions', { status: 201, json: { success: true, data: {
    sessionId, uploadUrl: '/upload/phone', uploadToken: 'w118-upload', controlToken: 'w118-control', expiresAt,
  } } })
  api.respond('GET', `/api/v1/upload-sessions/${sessionId}`, { status: 200, json: { success: true, data: {
    sessionId, status: 'pending', purpose: 'resume_upload', mode: 'temporary',
    file: null, requiresKioskConfirmation: false, expiresAt,
  } } })
  api.respond('DELETE', `/api/v1/upload-sessions/${sessionId}`, { status: 200, json: { success: true, data: { sessionId, status: 'cancelled' } } })
}

export function resumeShell(api: ApiRouter): void {
  registerTouchShell(api)
  // 一体机来源页默认就是手机扫码，不能只在点击「在手机里」后注册。
  stubResumePhone(api)
}

/** resume-walkfix-fusion-w3.spec.ts I-35：服务台读 config.ai.paused，不能用能力表替代。 */
export function pauseResumeAi(api: ApiRouter): void {
  api.respond('GET', '/api/v1/terminals/KSK-001/config', {
    status: 200,
    json: { ...terminalConfigWithHosting(RECRUITMENT_HOSTING_OFF, 'touch-pairs-paused'), ai: { paused: true } },
  })
}

/** 本机 USB 正常态，不依赖真实硬件；端点、文件结构、purpose 均照 fusion-w3。 */
export async function stubResumeUsb(page: Page): Promise<void> {
  await page.route('**/w3-fixtures/usb-resume.pdf', (route) =>
    route.fulfill({ status: 200, contentType: 'application/pdf', body: VISIBLE_PDF }))
  await page.route('http://127.0.0.1:9527/local/usb/**', async (route) => {
    const request = route.request()
    const pathname = new URL(request.url()).pathname
    const cors = {
      'Access-Control-Allow-Origin': new URL(page.url()).origin,
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Local-Bridge-Token',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Private-Network': 'true',
    }
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors })
      return
    }
    let data: unknown
    if (request.method() === 'GET' && pathname.endsWith('/status')) {
      data = { present: true, driveLabel: 'TEST-USB' }
    } else if (request.method() === 'GET' && pathname.endsWith('/files')) {
      data = { present: true, driveLabel: 'TEST-USB', files: [
        { safeId: 'usb-safe-resume', filename: 'U盘简历.pdf', extension: '.pdf', sizeBytes: 2048 },
      ] }
    } else if (request.method() === 'POST' && pathname.endsWith('/upload')) {
      expect(request.postDataJSON()).toEqual({ safeId: 'usb-safe-resume', purpose: 'resume_upload' })
      data = {
        fileId: 'file-usb-resume', filename: 'U盘简历.pdf', sizeBytes: 2048,
        mimeType: 'application/pdf', sha256: 'c'.repeat(64), fileUrl: '/w3-fixtures/usb-resume.pdf',
        fileUrlExpiresAt: new Date(Date.now() + 300_000).toISOString(),
      }
    } else {
      throw new Error(`未登记的 USB 请求：${request.method()} ${pathname}`)
    }
    await route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ success: true, data }) })
  })
}

export async function openResumeUsb(page: Page, api: ApiRouter): Promise<void> {
  resumeShell(api)
  await stubResumeUsb(page)
  await page.goto('/resume/source')
  await terminalReady(page)
  await page.getByRole('button', { name: /在 U 盘里/ }).click()
  await expect(page.getByRole('button', { name: /U盘简历\.pdf/ })).toBeVisible()
  await expect(page.locator('body')).not.toContainText('网络连接失败')
}

export async function resumeDirection(page: Page, api: ApiRouter, more = false): Promise<void> {
  await openResumeUsb(page, api)
  await page.getByRole('button', { name: /U盘简历\.pdf/ }).click()
  await page.getByRole('button', { name: '导入这份文件', exact: true }).click()
  await openResumeDirection(page)
  await see(page, '[data-resume-step="direction"]')
  if (more) {
    await page.getByRole('button', { name: /^定向诊断/ }).click()
    await page.getByRole('button', { name: '更多条件（可不填）', exact: true }).click()
    await see(page, '[data-resume-step="more"]')
  }
}

/** reading 正常等待来自在途解析，AI 停用则让同一请求明确失败并走真实失败报告。 */
export async function resumeReading(page: Page, api: ApiRouter, down = false, failureCode = 'AI_PAUSED'): Promise<void> {
  if (down) {
    api.respond('POST', '/api/v1/resume/parse', {
      status: failureCode === 'AI_QUOTA_EXHAUSTED' ? 429 : 503,
      json: { success: false, error: { code: failureCode, message: failureCode === 'AI_QUOTA_EXHAUSTED' ? '今天的 AI 次数用完了，明天 0 点恢复' : 'AI 服务暂停中' } },
    })
  } else {
    api.respondWith('POST', '/api/v1/resume/parse', () => new Promise(() => undefined))
  }
  await resumeDirection(page, api)
  await startResumeDiagnosis(page)
  if (down) {
    await page.waitForURL('**/resume/report')
    await expect(page.getByText('这次没诊断出来', { exact: true })).toBeVisible()
    await expect(page.locator('[data-qxt-ask="off"]')).toBeVisible()
    await expect(page.getByRole('button', { name: '打印我上传的原件', exact: true })).toBeEnabled()
  } else {
    await see(page, '[data-kiosk-screen="resume-parse"][data-state="waiting"]')
    await see(page, 'text=不代表实时进度')
  }
}
