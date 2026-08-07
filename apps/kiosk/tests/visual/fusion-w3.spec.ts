import { test, expect } from '../fixtures/kiosk-test'
import type { ApiRouter } from '../fixtures/api-router'
import { assertDialogWithinViewport, assertKioskShellFillsViewport, assertNoHorizontalOverflow } from './assert-layout'
import {
  assistantReply, diagnosis, interviewAnswered, interviewCreated,
  interviewReport, interviewStarted, uploadedResume,
} from './fixtures/fusion-w3-states'
import { VISIBLE_PDF } from './fixtures/fusion-w2-binary-route'

function terminalBaseline(api: ApiRouter): void {
  api.respond('GET', '/api/v1/terminals/KSK-001/printer-status', {
    status: 200,
    json: { printerStatus: 'ready', paperLevel: 'sufficient', isOnline: true },
  })
  api.respond('GET', '/api/v1/terminals/KSK-001/config', {
    status: 200,
    json: { smartCampus: { enabled: false, modules: {}, items: [] }, toolbox: { enabled: false, items: [] }, configVersion: 'w3', refreshIntervalMs: 300000, serverTime: '2026-07-24T00:00:00.000Z' },
  })
  api.respond('GET', '/api/v1/terminals/KSK-001/screensaver', { status: 200, json: { enabled: false, idleTimeoutSec: 180, items: [] } })
}

test('resume upload → parse → OCR report @w3-kiosk', async ({ page, api }) => {
  const runtimeErrors: string[] = []
  let previewLoaded = false
  page.on('pageerror', (error) => runtimeErrors.push(error.message))
  page.on('response', (response) => {
    if (new URL(response.url()).pathname === '/w3-fixtures/resume.pdf' && response.status() === 200) {
      previewLoaded = true
    }
  })
  await page.route('**/w3-fixtures/resume.pdf', (route) =>
    route.fulfill({ status: 200, contentType: 'application/pdf', body: VISIBLE_PDF }),
  )
  terminalBaseline(api)
  api.respond('POST', '/api/v1/files/kiosk-upload', { status: 200, json: uploadedResume })
  await page.route('**/api/v1/resume/parse', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 700))
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(diagnosis) })
  })
  await page.goto('/resume/source')
  await assertKioskShellFillsViewport(page)
  await page.getByRole('button', { name: '选择行业方向' }).click()
  const diagnosisIndustryDialog = page.getByRole('dialog', { name: '选择行业门类' })
  await expect(diagnosisIndustryDialog).toBeVisible()
  await assertDialogWithinViewport(page)
  await diagnosisIndustryDialog.getByRole('button', { name: '制造业', exact: true }).click()
  await diagnosisIndustryDialog.getByRole('button', { name: '完成' }).click()
  await page.getByLabel('经验级别').selectOption('1年以内')
  await page.getByLabel('学历（选填）').selectOption('本科')
  await page.getByLabel('选择本机简历文件').setInputFiles({ name: '求职简历.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-w3') })
  const preview = page.locator('[data-file-preview-kind="pdf"]')
  await expect(preview).toBeVisible()
  await expect(preview.locator('iframe')).toHaveAttribute('src', '/w3-fixtures/resume.pdf')
  await expect.poll(() => previewLoaded).toBe(true)
  await page.getByRole('button', { name: '开始 AI 诊断' }).click()
  await expect(page.getByText('处理内容说明 · 非实时阶段', { exact: true })).toBeVisible()
  await expect(page.getByText('不代表服务端实时阶段', { exact: false })).toBeVisible()
  await expect(page.getByText(/进行中…|已完成|逐项点亮/)).toHaveCount(0)
  await assertNoHorizontalOverflow(page)
  await page.waitForURL('/resume/report')
  await expect(page.locator('[data-kiosk-screen="resume-report"]')).toBeVisible()
  await expect(page.getByText('部分图片文字需要本人复核')).toBeVisible()
  for (const section of diagnosis.report.sections) await expect(page.getByText(section.label, { exact: true }).first()).toBeVisible()
  await assertNoHorizontalOverflow(page)
  expect(runtimeErrors).toEqual([])
})

test('USB resume keeps its purpose and reaches AI parsing @w3-kiosk', async ({ page, api }) => {
  const runtimeErrors: string[] = []
  let uploadBody: { safeId?: string; purpose?: string } | null = null
  page.on('pageerror', (error) => runtimeErrors.push(error.message))
  await page.route('**/w3-fixtures/usb-resume.pdf', (route) =>
    route.fulfill({ status: 200, contentType: 'application/pdf', body: VISIBLE_PDF }),
  )
  await page.route('http://127.0.0.1:9527/local/usb/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const corsHeaders = {
      'Access-Control-Allow-Origin': 'http://127.0.0.1:4183',
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
      await route.fulfill({ status: 200, headers: corsHeaders, contentType: 'application/json', body: JSON.stringify({ success: true, data: { present: true, driveLabel: 'TEST-USB', files: [{ safeId: 'usb-safe-resume', filename: 'U盘简历.pdf', extension: '.pdf', sizeBytes: 2048 }] } }) })
      return
    }
    uploadBody = request.postDataJSON() as { safeId?: string; purpose?: string }
    await route.fulfill({
      status: 200,
      headers: corsHeaders,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { fileId: 'file-usb-resume', filename: 'U盘简历.pdf', sizeBytes: 2048, mimeType: 'application/pdf', sha256: 'c'.repeat(64), fileUrl: '/w3-fixtures/usb-resume.pdf', fileUrlExpiresAt: new Date(Date.now() + 300_000).toISOString() } }),
    })
  })
  terminalBaseline(api)
  api.respond('POST', '/api/v1/resume/parse', { status: 200, json: diagnosis })

  await page.goto('/resume/source')
  await page.getByRole('button', { name: /U盘上传/ }).click()
  await page.getByRole('button', { name: /U盘简历\.pdf/ }).click()
  await expect(page.locator('[data-file-preview-kind="pdf"]')).toBeVisible()
  expect(uploadBody).toEqual({ safeId: 'usb-safe-resume', purpose: 'resume_upload' })
  await page.getByRole('button', { name: '开始 AI 诊断' }).click()
  await page.waitForURL('/resume/report')
  await expect(page.locator('[data-kiosk-screen="resume-report"]')).toBeVisible()
  await assertNoHorizontalOverflow(page)
  expect(runtimeErrors).toEqual([])
})

test('USB resume filters oversize files and trusts exact image MIME @w3-kiosk', async ({ page, api }) => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
  await page.route('**/w3-fixtures/my_pdf_resume.jpg', (route) =>
    route.fulfill({ status: 200, contentType: 'image/jpeg', body: png }),
  )
  await page.route('http://127.0.0.1:9527/local/usb/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const corsHeaders = {
      'Access-Control-Allow-Origin': 'http://127.0.0.1:4183',
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
      await route.fulfill({
        status: 200,
        headers: corsHeaders,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            present: true,
            driveLabel: 'TEST-USB',
            files: [
              { safeId: 'usb-image', filename: 'my_pdf_resume.jpg', extension: '.jpg', sizeBytes: 2048 },
              { safeId: 'usb-oversize', filename: 'too-large.pdf', extension: '.pdf', sizeBytes: 11 * 1024 * 1024 },
            ],
          },
        }),
      })
      return
    }
    await route.fulfill({
      status: 200,
      headers: corsHeaders,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { fileId: 'file-usb-image', filename: 'my_pdf_resume.jpg', sizeBytes: 2048, mimeType: 'image/jpeg', sha256: 'd'.repeat(64), fileUrl: '/w3-fixtures/my_pdf_resume.jpg', fileUrlExpiresAt: new Date(Date.now() + 300_000).toISOString() } }),
    })
  })
  terminalBaseline(api)

  await page.goto('/resume/source')
  await page.getByRole('button', { name: /U盘上传/ }).click()
  await expect(page.getByRole('button', { name: /my_pdf_resume\.jpg/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /too-large\.pdf/ })).toHaveCount(0)
  await page.getByRole('button', { name: /my_pdf_resume\.jpg/ }).click()
  const preview = page.locator('[data-file-preview-kind="image"]')
  await expect(preview).toBeVisible()
  await expect(preview.locator('img')).toHaveAttribute('src', '/w3-fixtures/my_pdf_resume.jpg')
  await expect(preview.locator('iframe')).toHaveCount(0)
})

test('optimized resume previews inline without opening a new tab @w3-kiosk', async ({ page, api }) => {
  const optimizedResume = {
    basic: { name: '测试用户', city: '青岛' },
    intention: { position: '前端开发工程师', city: '青岛' },
    summary: '基于本人真实经历整理的简历摘要。',
    education: [{ school: '测试大学', major: '计算机科学', degree: '本科' }],
    experience: [],
    projects: [],
    skills: ['TypeScript', 'React'],
    certificates: [],
  }
  await page.route('**/w3-fixtures/optimized-resume.pdf', (route) =>
    route.fulfill({ status: 200, contentType: 'application/pdf', body: VISIBLE_PDF }),
  )
  terminalBaseline(api)
  api.respond('GET', '/api/v1/job-materials/templates', { status: 200, json: { success: true, data: [] } })
  api.respond('GET', '/api/v1/resume/records/resume-w3-inline-preview/optimize', {
    status: 200,
    json: { taskId: 'resume-w3-inline-preview', status: 'completed', providerName: 'llm', modules: [], optimizedResume },
  })
  api.respond('POST', '/api/v1/resume/generate/export', {
    status: 200,
    json: {
      fileId: 'optimized-file-w3',
      filename: '优化版简历.pdf',
      sizeBytes: 4096,
      pageCount: 1,
      signedUrl: '/w3-fixtures/optimized-resume.pdf',
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
      printFileUrl: '/api/v1/files/optimized-file-w3/content?expires=1&sig=test',
    },
  })

  await page.goto('/resume/optimize?taskId=resume-w3-inline-preview')
  await expect(page.locator('[data-kiosk-screen="resume-optimize"]')).toBeVisible()
  await page.getByRole('button', { name: '导出 PDF', exact: true }).click()
  await expect(page.getByRole('button', { name: '查看或手机保存PDF' })).toBeVisible()
  const pageCount = page.context().pages().length
  await page.getByRole('button', { name: '查看或手机保存PDF' }).click()
  const dialog = page.getByRole('dialog', { name: '优化版简历.pdf' })
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('[data-file-preview-kind="pdf"] iframe')).toHaveAttribute('src', '/w3-fixtures/optimized-resume.pdf')
  await expect(dialog.getByText('手机扫码保存')).toBeVisible()
  expect(page.context().pages()).toHaveLength(pageCount)
  await page.getByRole('button', { name: '关闭文件预览' }).click()
  await expect(dialog).toHaveCount(0)
  expect(page.context().pages()).toHaveLength(pageCount)
})

test('resume preview recovers after replacing a failed file @w3-kiosk', async ({ page, api }) => {
  let uploadCount = 0
  terminalBaseline(api)
  await page.route('**/w3-fixtures/broken.png', (route) => route.abort('failed'))
  await page.route('**/w3-fixtures/recovered.pdf', (route) =>
    route.fulfill({ status: 200, contentType: 'application/pdf', body: VISIBLE_PDF }),
  )
  await page.route('**/api/v1/files/kiosk-upload', async (route) => {
    uploadCount += 1
    const isBroken = uploadCount === 1
    const isUnsupportedDocx = uploadCount === 3
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          ...uploadedResume.data,
          fileId: `preview-file-${uploadCount}`,
          filename: isBroken ? 'broken.png' : isUnsupportedDocx ? 'resume_pdf_final.docx' : 'recovered.pdf',
          mimeType: isBroken ? 'image/png' : isUnsupportedDocx ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/pdf',
          signedUrl: isBroken ? '/w3-fixtures/broken.png' : isUnsupportedDocx ? '/w3-fixtures/document.docx' : '/w3-fixtures/recovered.pdf',
        },
      }),
    })
  })

  await page.goto('/resume/source')
  const input = page.getByLabel('选择本机简历文件')
  await input.setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('broken') })
  await expect(page.locator('[data-file-preview-kind="unavailable"]')).toBeVisible()
  await input.setInputFiles({ name: 'recovered.pdf', mimeType: 'application/pdf', buffer: Buffer.from(VISIBLE_PDF) })
  await expect(page.locator('[data-file-preview-kind="pdf"]')).toBeVisible()
  await expect(page.locator('[data-file-preview-kind="pdf"] iframe')).toHaveAttribute('src', '/w3-fixtures/recovered.pdf')
  await input.setInputFiles({ name: 'resume_pdf_final.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from('synthetic-docx') })
  await expect(page.locator('[data-file-preview-kind="unsupported"]')).toBeVisible()
  await expect(page.locator('[data-file-preview-kind="unsupported"] iframe')).toHaveCount(0)
})

test('direct resume parse stays fail-closed without fake stages @w3-kiosk', async ({ page, api }) => {
  const runtimeErrors: string[] = []
  page.on('pageerror', (error) => runtimeErrors.push(error.message))
  terminalBaseline(api)
  await page.goto('/resume/parse')
  await expect(page.getByText('未找到简历文件', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '返回上传简历' })).toBeVisible()
  await expect(page.getByText(/正在识别|正在提取|已完成|进行中…/)).toHaveCount(0)
  await expect(page).toHaveURL(/\/resume\/parse$/)
  await assertNoHorizontalOverflow(page)
  expect(runtimeErrors).toEqual([])
})

test('resume parse failure remains honest @w3-kiosk', async ({ page, api }) => {
  const runtimeErrors: string[] = []
  let previewLoaded = false
  page.on('pageerror', (error) => runtimeErrors.push(error.message))
  page.on('response', (response) => {
    if (new URL(response.url()).pathname === '/w3-fixtures/resume.pdf' && response.status() === 200) {
      previewLoaded = true
    }
  })
  await page.route('**/w3-fixtures/resume.pdf', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/pdf',
      body: '%PDF-1.4\n%%EOF',
    }),
  )
  terminalBaseline(api)
  api.respond('POST', '/api/v1/files/kiosk-upload', { status: 200, json: uploadedResume })
  api.abort('POST', '/api/v1/resume/parse', 'internetdisconnected')
  await page.goto('/resume/source')
  await page.getByLabel('选择本机简历文件').setInputFiles({ name: '求职简历.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-w3') })
  const preview = page.locator('[data-file-preview-kind="pdf"]')
  await expect(preview).toBeVisible()
  await expect(preview.locator('iframe')).toHaveAttribute('src', '/w3-fixtures/resume.pdf')
  await expect.poll(() => previewLoaded).toBe(true)
  await page.getByRole('button', { name: '开始 AI 诊断' }).click()
  await expect(page.getByText('解析出错', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /重试|重新/ })).toBeVisible()
  await assertNoHorizontalOverflow(page)
  expect(runtimeErrors).toEqual([])
})

test('assistant filters actions and survives service failure @w3-kiosk', async ({ page, api }) => {
  const runtimeErrors: string[] = []
  page.on('pageerror', (error) => runtimeErrors.push(error.message))
  terminalBaseline(api)
  api.respond('POST', '/api/v1/assistant/chat', { status: 200, json: assistantReply })
  await page.goto('/assistant')
  const input = page.getByLabel('输入咨询问题')
  await input.fill('如何整理项目经历？')
  await page.getByRole('group', { name: '虚拟键盘' }).getByRole('button', { name: '发送', exact: true }).click()
  await expect(page.getByRole('button', { name: '去做简历诊断' })).toBeVisible()
  await expect(page.getByText('禁止动作', { exact: true })).toHaveCount(0)
  api.abort('POST', '/api/v1/assistant/chat', 'internetdisconnected')
  await input.fill('再给一个建议')
  await page.getByRole('group', { name: '虚拟键盘' }).getByRole('button', { name: '发送', exact: true }).click()
  await expect(page.getByText('AI 服务暂不可用，请稍后再试', { exact: true })).toBeVisible()
  await expect(page.locator('[data-kiosk-screen="assistant"]')).toBeVisible()
  await assertNoHorizontalOverflow(page)
  expect(runtimeErrors).toEqual([])
})

test('TRTC explicit gate fails back to text safely @w3-kiosk', async ({ page, api }) => {
  const runtimeErrors: string[] = []
  page.on('pageerror', (error) => runtimeErrors.push(error.message))
  terminalBaseline(api)
  api.abort('POST', '/api/v1/trtc/session', 'internetdisconnected')
  await page.goto('/assistant')
  await page.getByRole('button', { name: '语音咨询' }).first().click()
  await page.getByRole('button', { name: /直接语音通话/ }).click()
  await expect(page.locator('[data-kiosk-screen="assistant-call"]')).toBeVisible()
  await expect(page.getByText(/暂不可用|连接失败|网络/).first()).toBeVisible()
  await page.getByRole('button', { name: /改用文字咨询|文字咨询/ }).first().click()
  await expect(page.locator('[data-kiosk-screen="assistant"]')).toBeVisible()
  await assertNoHorizontalOverflow(page)
  expect(runtimeErrors).toEqual([])
})

test('interview setup → text answer → report @w3-kiosk', async ({ page, api }) => {
  const runtimeErrors: string[] = []
  page.on('pageerror', (error) => runtimeErrors.push(error.message))
  terminalBaseline(api)
  api.respond('POST', '/api/v1/mock-interviews', { status: 200, json: interviewCreated })
  api.respond('POST', '/api/v1/mock-interviews/interview-w3-public-fixture/start', { status: 200, json: interviewStarted })
  api.respond('GET', '/api/v1/mock-interviews/capabilities/voice', { status: 200, json: { data: { asrEnabled: false, ttsEnabled: false } } })
  api.respond('POST', '/api/v1/mock-interviews/interview-w3-public-fixture/answer', { status: 200, json: interviewAnswered })
  api.respond('POST', '/api/v1/mock-interviews/interview-w3-public-fixture/end', { status: 200, json: interviewReport })
  api.respond('GET', '/api/v1/mock-interviews/interview-w3-public-fixture/report', { status: 200, json: interviewReport })
  await page.goto('/interview/setup')
  await assertKioskShellFillsViewport(page)
  await page.getByRole('button', { name: '选择行业 (20)' }).click()
  const interviewIndustryDialog = page.getByRole('dialog', { name: '选择面试行业' })
  await expect(interviewIndustryDialog).toBeVisible()
  await assertDialogWithinViewport(page)
  await interviewIndustryDialog.getByRole('button', { name: '制造业', exact: true }).click()
  await interviewIndustryDialog.getByRole('button', { name: '完成' }).click()
  await page.getByPlaceholder(/输入目标岗位/).fill('前端开发工程师')
  await page.getByRole('button', { name: '开始模拟面试' }).click()
  await page.waitForURL('/interview/session')
  await page.getByRole('textbox').fill('我基于真实经历完成了一个可访问性项目。')
  await page.getByRole('button', { name: '提交回答' }).click()
  await page.getByRole('button', { name: '结束面试' }).click()
  await page.waitForURL('/interview/report')
  await expect(page.getByText('表达结构基本完整，仍需用真实数据补充结果。')).toBeVisible()
  await expect(page.getByRole('note', { name: '合规提示' })).toContainText('练习结果仅供本人复盘，不会发送给任何企业。')
  await assertNoHorizontalOverflow(page)
  expect(runtimeErrors).toEqual([])
})
