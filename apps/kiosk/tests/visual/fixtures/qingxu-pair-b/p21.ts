// 稿 21：简历取件与诊断方向。只配首屏、目标工作台四态和确认屏；其余通道整屏是下一包。
import type { Page } from '@playwright/test'
import type { ApiRouter } from '../../../fixtures/api-router'
import type { QingxuPairTarget } from '../qingxu-pair-targets'
import type { ResumePageFixture, ResumePagesPlan } from './types'

const PLAN = { kind: 'resume-pages' } as const
const PAIRED = new Set(['source', 'target', 'target-context', 'target-profile', 'target-industry', 'summary'])
const hit = (state: string): ResumePagesPlan => ({
  plan: PLAN,
  reason: null,
  marker: `[data-kiosk-screen="resume-source"][data-screen="${state}"]`,
  runtimePath: `/resume/source?screen=${state}`,
})
const none = (reason: string): ResumePagesPlan => ({ plan: { kind: 'none' }, reason, marker: null, runtimePath: null })

const USB_FILES = [
  { safeId: 'usb-wang-2026', filename: '王建国-简历-2026.pdf', extension: '.pdf', sizeBytes: 3_355_443 },
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
          fileId: 'file-wang-resume-2026',
          filename: chosen.filename,
          sizeBytes: chosen.sizeBytes,
          mimeType: 'application/pdf',
          sha256: 'ab'.repeat(32),
          fileUrl: '/pair-fixtures/wang-resume.pdf',
          fileUrlExpiresAt: new Date(Date.now() + 300_000).toISOString(),
        },
      }),
    })
  })
}

export const page21: ResumePageFixture = {
  prefix: '21-',
  plan(screen, state) {
    if (screen !== 'main') return none('稿 21 的状态都挂在 main，这一屏不是取件工作台')
    if (PAIRED.has(state)) return hit(state)
    return none('这一态是通道整屏或解析等待，T21a 只配来源首屏、目标工作台和确认屏')
  },
  async prepare(page: Page, _api: ApiRouter, target: QingxuPairTarget): Promise<void> {
    if (target.state === 'summary') {
      await routeUsb(page)
      await page.goto('/resume/source?screen=source', { waitUntil: 'domcontentloaded' })
      await page.getByRole('button', { name: 'U盘上传' }).click()
      await page.getByRole('button', { name: /王建国-简历-2026\.pdf/ }).click()
      await page.locator('[data-kiosk-screen="resume-source"][data-screen="summary"]').waitFor({ state: 'visible' })
      return
    }
    await page.goto(`/resume/source?screen=${target.state}`, { waitUntil: 'domcontentloaded' })
  },
}
