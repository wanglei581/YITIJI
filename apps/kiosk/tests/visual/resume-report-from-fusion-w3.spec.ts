import type { Page } from '@playwright/test'
import { test, expect } from '../fixtures/kiosk-test'
import type { ApiRouter } from '../fixtures/api-router'
import { RECRUITMENT_HOSTING_ON } from '../fixtures/recruitment-hosting'
import { diagnosis, uploadedResume } from './fixtures/fusion-w3-states'
import { chooseGenericResumeDirection } from './fixtures/direction-selection'

const CAREER_PLAN_RETURN = '继续做职业规划'
const EXPORT_PREVIEW_FAILURE = '预览没能生成，打印仍按原文件。报告已生成，可扫码带走或直接打印。'

function terminalBaseline(api: ApiRouter): void {
  api.respond('GET', '/api/v1/terminals/KSK-001/printer-status', {
    status: 200,
    json: { printerStatus: 'ready', paperLevel: 'sufficient', isOnline: true },
  })
  api.respond('GET', '/api/v1/terminals/KSK-001/config', {
    status: 200,
    json: {
      smartCampus: { enabled: false, modules: {}, items: [] },
      toolbox: { enabled: false, items: [] },
      ...RECRUITMENT_HOSTING_ON,
      configVersion: 'w3-report-from',
      refreshIntervalMs: 300000,
      serverTime: '2026-07-24T00:00:00.000Z',
    },
  })
  api.respond('GET', '/api/v1/terminals/KSK-001/screensaver', {
    status: 200,
    json: { enabled: false, idleTimeoutSec: 180, items: [] },
  })
  api.respond('GET', '/api/v1/mock-interviews/capabilities/voice', {
    status: 200,
    json: { data: { asrEnabled: false, ttsEnabled: false } },
  })
}

function registerDiagnosis(api: ApiRouter): void {
  api.respond('POST', '/api/v1/files/kiosk-upload', { status: 200, json: uploadedResume })
  api.respond('POST', '/api/v1/resume/parse', { status: 200, json: diagnosis })
}

async function uploadAndOpenReport(page: Page): Promise<void> {
  await chooseGenericResumeDirection(page)
  await page.getByLabel('选择本机简历文件').setInputFiles({
    name: '求职简历.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-w3'),
  })
  await page.getByRole('button', { name: 'AI 诊断，看改进建议' }).click()
  await page.waitForURL('/resume/report')
  await expect(page.locator('[data-kiosk-screen="resume-report"]')).toBeVisible()
}

test('career plan diagnosis keeps a return and the export preview names the finished report @w3-kiosk', async ({ page, api }) => {
  terminalBaseline(api)
  registerDiagnosis(api)
  api.respond('POST', '/api/v1/resume/records/resume-w3-public-fixture/export', {
    status: 200,
    json: {
      fileId: 'file-w3-report-export',
      filename: '诊断报告.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1200,
      pageCount: 1,
      signedUrl: '/w3-fixtures/report-export.pdf',
      expiresAt: '2099-01-01T00:00:00.000Z',
      printFileUrl: '/w3-fixtures/report-export-print.pdf',
      savedToDocuments: false,
      aiGenerated: true,
    },
  })
  await page.route('**/w3-fixtures/report-export.pdf', (route) => route.fulfill({ status: 404, body: 'missing' }))
  // 诊断写回会话后，点回职业规划会按这份简历再问一次规划。这份夹具还没生成过。
  api.respond('GET', '/api/v1/resume/career-plan/resume-w3-public-fixture', {
    status: 404,
    json: { error: { code: 'CAREER_PLAN_NOT_FOUND', message: '尚未生成' } },
  })

  await page.goto('/resume/career-plan')
  await expect(page.locator('[data-kiosk-screen="resume-career-plan"][data-state="missing-task"]')).toBeVisible()
  await page.getByRole('button', { name: '去上传简历', exact: true }).click()
  await expect(page).toHaveURL(/\/resume\/source\?intent=diagnose&from=career-plan$/)
  await uploadAndOpenReport(page)

  const back = page.getByTestId('resume-report-career-plan')
  await expect(back).toHaveText(CAREER_PLAN_RETURN)
  await page.getByTestId('resume-report-export-pdf').click()
  await expect(page.getByTestId('resume-report-export-actions')).toHaveAttribute('data-exported', '1')
  await page.getByTestId('resume-report-qr').click()
  const dialog = page.getByRole('dialog', { name: '诊断报告.pdf' })
  await expect(dialog.getByText(EXPORT_PREVIEW_FAILURE, { exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: '关闭文件预览' }).click()
  await expect(dialog).toHaveCount(0)

  await back.click()
  await page.waitForURL('/resume/career-plan')
  await expect(page.locator('[data-kiosk-screen="resume-career-plan"]')).toBeVisible()
})

test('resume hub diagnosis does not offer a return to career plan @w3-kiosk', async ({ page, api }) => {
  terminalBaseline(api)
  registerDiagnosis(api)
  api.respond('GET', '/api/v1/health', { status: 200, json: { success: true, data: { status: 'ok' } } })

  await page.goto('/resume-service')
  await page.getByRole('button', { name: '我有简历要体检', exact: true }).click()
  await expect(page).toHaveURL(/\/resume\/source\?intent=diagnose$/)
  expect(new URL(page.url()).searchParams.get('from')).toBeNull()
  await uploadAndOpenReport(page)
  await expect(page.getByTestId('resume-report-career-plan')).toHaveCount(0)
  await expect(page.getByRole('button', { name: CAREER_PLAN_RETURN })).toHaveCount(0)
})

test('an unrecognized from on the source page does not offer a return to career plan @w3-kiosk', async ({ page, api }) => {
  terminalBaseline(api)
  registerDiagnosis(api)

  await page.goto('/resume/source?intent=diagnose&from=home')
  await expect(page).toHaveURL(/from=home/)
  await uploadAndOpenReport(page)
  await expect(page.getByTestId('resume-report-career-plan')).toHaveCount(0)
  await expect(page.getByRole('button', { name: CAREER_PLAN_RETURN })).toHaveCount(0)
})
