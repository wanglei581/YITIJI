import type { Page, Route } from '@playwright/test'
import { test, expect } from '../fixtures/kiosk-test'
import type { ApiRouter } from '../fixtures/api-router'
import { KIOSK_AI_CAPABILITIES_PATH, kioskAiCapabilitiesResponse } from '../fixtures/ai-capabilities'
import { RECRUITMENT_HOSTING_OFF, RECRUITMENT_HOSTING_ON, terminalConfigWithHosting } from '../fixtures/recruitment-hosting'
import { assertDialogWithinViewport, assertKioskShellFillsViewport, assertNoHorizontalOverflow, assertQxPillReadable, assertTapTargetPointerHit, readEnabledStageScale } from './assert-layout'
import {
  ASSISTANT_MOCK_FALLBACK_REPLY_TEXT, assistantMockFallbackReply,
  assistantReply, diagnosis, interviewAnswered, interviewCreated,
  interviewReport, interviewReportRich, interviewStarted, uploadedResume,
} from './fixtures/fusion-w3-states'
import { longestBlankRun } from './fixtures/blank-run'
import { VISIBLE_PDF } from './fixtures/fusion-w2-binary-route'
import { registerW6Api } from './fixtures/fusion-w6-api'
import { changeStoredResumeFileId, clearResumeParseIntents, readResumeParseIntents } from './fixtures/resume-parse-intent-state'
import { mockAssistantVoice } from './fixtures/assistant-voice'
import { chooseGenericResumeDirection, chooseTargetedResumeDirection, expectResumeDirectionUnselected, expectInterviewDirectionUnselected, chooseInterviewExperience, openResumeDirection, startResumeDiagnosis, startResumeOptimize, advanceInterviewSetupToStart } from './fixtures/direction-selection'

function terminalBaseline(api: ApiRouter): void {
  api.respond('GET', '/api/v1/terminals/KSK-001/printer-status', {
    status: 200,
    json: { printerStatus: 'ready', paperLevel: 'sufficient', isOnline: true },
  })
  api.respond('GET', '/api/v1/terminals/KSK-001/config', {
    status: 200,
    json: { smartCampus: { enabled: false, modules: {}, items: [] }, toolbox: { enabled: false, items: [] }, ...RECRUITMENT_HOSTING_ON, configVersion: 'w3', refreshIntervalMs: 300000, serverTime: '2026-07-24T00:00:00.000Z' },
  })
  api.respond('GET', '/api/v1/terminals/KSK-001/screensaver', { status: 200, json: { enabled: false, idleTimeoutSec: 180, items: [] } })
  // 包 I：助手页「按住说话」挂载时探测语音能力；基线里按未配置处理，按钮应置灰而不是打断页面。
  api.respond('GET', '/api/v1/mock-interviews/capabilities/voice', { status: 200, json: { data: { asrEnabled: false, ttsEnabled: false } } })
}

/** 解析页此刻的真实态：一次性读完（失败 / 未知态 700ms 后就会转去报告页，分多次断言会追不上）。 */
async function parseViewSnapshot(page: Page) {
  return page.evaluate(() => {
    const root = document.querySelector('[data-kiosk-screen="resume-parse"]')
    const text = document.body.innerText
    return {
      state: root?.getAttribute('data-state') ?? null,
      current: document.querySelector('.qxt-rail [aria-current="step"]')?.textContent?.replace(/^\d/, '').trim() ?? null,
      bad: document.querySelector('.qxt-rail [data-mark="bad"]')?.textContent?.replace(/^\d/, '').replace(/（.*）$/, '').trim() ?? null,
      wait: document.querySelector('.qxt-rail [data-mark="wait"]')?.textContent?.replace(/^\d/, '').replace(/（.*）$/, '').trim() ?? null,
      pill: document.querySelector('.qx-pill')?.textContent?.trim() ?? null,
      saysReceived: text.includes('文件收到了'),
      saysError: text.includes('解析出错'),
    }
  })
}

/**
 * 解析页右栏的块不叠、不被压扁：被压扁的块（带 min-height 的声明、维度条）会让文字叠到下一块上。
 * 逐对比较相邻块的上下沿；再看每个块自己的内容有没有超出它自己的盒子。
 * toBeVisible() 对被 overflow 裁掉或叠住的元素也会通过，所以这里直接量几何。
 */
async function expectParseColumnBlocksClear(page: Page, label: string) {
  const problems = await page.evaluate(() => {
    const card = document.querySelector('[data-kiosk-screen="resume-parse"] .qxt-rcol')
    if (!card) return ['找不到右栏卡片 .qxt-rcol']
    const blocks = Array.from(card.children) as HTMLElement[]
    const out: string[] = []
    for (let index = 0; index < blocks.length; index += 1) {
      const block = blocks[index]
      const name = `${block.tagName.toLowerCase()}.${String(block.className).split(' ')[0] || '-'}#${index}`
      if (block.scrollHeight > block.clientHeight + 1) out.push(`${name} 内容超出自己的盒子（${block.scrollHeight} > ${block.clientHeight}）`)
      if (index === 0) continue
      const before = blocks[index - 1].getBoundingClientRect()
      const here = block.getBoundingClientRect()
      if (before.bottom > here.top + 0.5) out.push(`${name} 压在上一块上（上一块下沿 ${Math.round(before.bottom)} > 本块上沿 ${Math.round(here.top)}）`)
    }
    return out
  })
  expect(problems, label).toEqual([])
}

/** 青序顶栏几何：文字折成几行、胶囊有没有被裁、返回键多大。只量 CSS 像素（舞台缩放关闭时 = 屏幕像素）。 */
async function qxTopbarMetrics(page: Page) {
  await expect(page.locator('.qxt-band')).toBeVisible()
  return page.evaluate(() => {
    const lineCount = (el: Element | null) => {
      if (!el) return 0
      const node = Array.from(el.childNodes).reverse().find((child) => child.nodeType === Node.TEXT_NODE && child.textContent?.trim())
      if (!node) return 0
      const range = document.createRange()
      range.selectNodeContents(node)
      return new Set(Array.from(range.getClientRects()).map((rect) => Math.round(rect.top))).size
    }
    const band = document.querySelector('.qxt-band') as HTMLElement
    const pill = document.querySelector('.qxt-band .qx-pill') as HTMLElement
    const back = document.querySelector('.qxt-back') as HTMLElement | null
    return {
      height: band.offsetHeight,
      brandLines: lineCount(document.querySelector('.qxt-brand b')),
      pillLines: lineCount(pill),
      pillClipped: pill.scrollWidth > pill.clientWidth + 1 || pill.getBoundingClientRect().right > window.innerWidth + 0.5,
      pillText: pill.textContent?.trim() ?? '',
      pillW: Math.round(pill.getBoundingClientRect().width),
      pillRight: Math.round(pill.getBoundingClientRect().right),
      backW: back?.offsetWidth ?? 0,
      subShown: false,
      stageFit: document.querySelector('[data-kiosk-stage-fit]')?.getAttribute('data-kiosk-stage-fit') ?? null,
    }
  })
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
  const parseBodies: Array<{ targetContext?: Record<string, unknown> }> = []
  await page.route('**/api/v1/resume/parse', async (route) => {
    parseBodies.push(route.request().postDataJSON() as { targetContext?: Record<string, unknown> })
    await new Promise((resolve) => setTimeout(resolve, 700))
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(diagnosis) })
  })
  await page.goto('/resume/source')
  await assertKioskShellFillsViewport(page)
  await page.getByLabel('选择本机简历文件').setInputFiles({ name: '求职简历.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-w3') })
  await expectResumeDirectionUnselected(page)
  await page.getByRole('button', { name: /^定向诊断/ }).click()
  await page.getByRole('button', { name: '选择行业方向' }).click()
  const diagnosisIndustryDialog = page.getByRole('dialog', { name: '选择行业门类' })
  await expect(diagnosisIndustryDialog).toBeVisible()
  await assertDialogWithinViewport(page)
  await expect(diagnosisIndustryDialog.getByText('当前：暂不指定', { exact: true })).toBeVisible()
  await expect(diagnosisIndustryDialog.locator('button[aria-pressed="true"]')).toHaveText('暂不指定')
  await diagnosisIndustryDialog.getByRole('button', { name: '制造业', exact: true }).click()
  await diagnosisIndustryDialog.getByRole('button', { name: '完成' }).click()
  // 经验 / 学历在「更多条件」一步，不再收进专业与学历抽屉。
  await page.getByRole('button', { name: '更多条件（可不填）' }).click()
  const experience = page.getByRole('group', { name: '经历' })
  await experience.getByRole('button', { name: '1年以内', exact: true }).click()
  await expect(experience.getByRole('button', { name: '1年以内', exact: true })).toHaveAttribute('aria-pressed', 'true')
  const degree = page.getByRole('group', { name: '学历（选填）' })
  await degree.getByRole('button', { name: '本科', exact: true }).click()
  await expect(degree.getByRole('button', { name: '本科', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: '好了，回去开始诊断', exact: true }).click()
  // 原件预览在「简历在哪里」一步的文件卡里（稿 resume-src）；从诊断方向返回过去看一眼，再回来开始诊断。
  await page.locator('.qxt-dock').getByRole('button', { name: '返回', exact: true }).click()
  await page.locator('.qx-rt-preview > summary').click()
  const preview = page.locator('[data-file-preview-kind="pdf"]')
  await expect(preview).toBeVisible()
  await expect(preview.locator('[data-pdf-preview-host]')).toHaveAttribute('data-preview-src', '/w3-fixtures/resume.pdf')
  await expect.poll(() => previewLoaded).toBe(true)
  await startResumeDiagnosis(page)
  // 稿 reading：列头只写一次「处理内容」，「在进行」下面写「不代表实时进度」。
  await expect(page.getByText('处理内容', { exact: true })).toBeVisible()
  await expect(page.getByText('不代表实时进度', { exact: false })).toBeVisible()
  await expect(page.getByText(/进行中…|已完成|逐项点亮/)).toHaveCount(0)
  await assertNoHorizontalOverflow(page)
  await page.waitForURL('/resume/report')
  expect(parseBodies[0]?.targetContext).toMatchObject({ industry: '制造业', experience: '1年以内', degree: '本科', skipped: false })
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
    const origin = new URL(page.url()).origin
    expect(request.headers()['origin']).toBe(origin)
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
  await page.getByRole('button', { name: /在 U 盘里/ }).click()
  await page.getByRole('button', { name: /U盘简历\.pdf/ }).click()
  await page.getByRole('button', { name: '导入这份文件' }).click()
  await chooseTargetedResumeDirection(page)
  await page.locator('.qx-rt-preview > summary').click()
  await expect(page.locator('[data-file-preview-kind="pdf"]')).toBeVisible()
  expect(uploadBody).toEqual({ safeId: 'usb-safe-resume', purpose: 'resume_upload' })
  await startResumeDiagnosis(page)
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
    const origin = new URL(page.url()).origin
    expect(request.headers()['origin']).toBe(origin)
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
  await page.getByRole('button', { name: /在 U 盘里/ }).click()
  await expect(page.getByRole('button', { name: /my_pdf_resume\.jpg/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /too-large\.pdf/ })).toHaveCount(0)
  await page.getByRole('button', { name: /my_pdf_resume\.jpg/ }).click()
  await page.getByRole('button', { name: '导入这份文件' }).click()
  await page.locator('.qx-rt-preview > summary').click()
  const preview = page.locator('[data-file-preview-kind="image"]')
  await expect(preview).toBeVisible()
  await expect(preview.locator('img')).toHaveAttribute('src', '/w3-fixtures/my_pdf_resume.jpg')
  await expect(preview.locator('iframe')).toHaveCount(0)
})

function resumeUsbCapability(status: string) {
  return {
    status: 200,
    json: {
      terminalCode: 'KSK-001',
      capabilities: [{
        capabilityKey: 'usb_import',
        status,
        note: null,
        configured: true,
        updatedAt: '2026-10-04T00:00:00.000Z',
      }],
    },
  }
}

async function installResumeUsbBridge(page: Page, hits: { count: number }): Promise<void> {
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
    if (request.method() === 'GET' && (path.endsWith('/status') || path.endsWith('/files'))) hits.count += 1
    if (path.endsWith('/status')) {
      await route.fulfill({
        status: 200,
        headers: corsHeaders,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { present: true, driveLabel: 'W125-USB' } }),
      })
      return
    }
    await route.fulfill({
      status: 200,
      headers: corsHeaders,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          present: true,
          driveLabel: 'W125-USB',
          files: [{ safeId: 'w125-resume', filename: '求职材料.pdf', extension: '.pdf', sizeBytes: 2048 }],
        },
      }),
    })
  })
}

test('resume usb card stays closed when usb import is not verified @w3-kiosk', async ({ page, api }) => {
  const hits = { count: 0 }
  await installResumeUsbBridge(page, hits)
  terminalBaseline(api)
  api.respond('GET', '/api/v1/terminals/KSK-001/capabilities', resumeUsbCapability('not_verified'))

  await page.goto('/resume/source')
  const card = page.getByRole('button', { name: /在 U 盘里/ })
  await expect(card).toBeEnabled()
  await card.click()
  await expect(page.getByText('U盘上传现在不能用', { exact: true })).toBeVisible()
  await expect(page.getByText('本机暂未开通', { exact: true })).toBeVisible()
  await expect(page.getByText('等待插入U盘')).toHaveCount(0)
  // 轮询是放行后立刻发出的。先看到拒绝文案，再等一小段，才能证明没有迟到的读盘请求。
  await page.evaluate(() => new Promise((resolve) => { setTimeout(resolve, 400) }))
  expect(hits.count).toBe(0)
})

test('resume usb card opens when usb import is available @w3-kiosk', async ({ page, api }) => {
  // 上一条的反向对照：配成可用后，卡片可以点，并且能看到盘里的文件。
  await installResumeUsbBridge(page, { count: 0 })
  terminalBaseline(api)
  api.respond('GET', '/api/v1/terminals/KSK-001/capabilities', resumeUsbCapability('available'))

  await page.goto('/resume/source')
  const card = page.getByRole('button', { name: /在 U 盘里/ })
  await expect(card).toBeEnabled()
  await card.click()
  await expect(page.getByRole('button', { name: /求职材料\.pdf/ })).toBeVisible()
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
  api.respond('GET', '/api/v1/resume/export/pricing', {
    status: 200,
    json: { mode: 'free', unitCents: 0, unit: 'item', benefit: null, label: '免费试运营' },
  })
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
  // 触屏版：总览、编辑、导出是同一页的三屏；这份结果没有可对照的条目，直接进编辑区。
  // 编辑区「去导出」→ 核对事实 → 导出页（PDF 默认）→「导出」才出文件。
  await expect(page.getByTestId('resume-optimize-overview')).toHaveCount(0)
  await page.getByRole('button', { name: '去导出', exact: true }).click()
  await page.getByRole('checkbox', { name: /测试大学/ }).click()
  await page.getByRole('button', { name: '确认导出' }).click()
  await page.getByRole('button', { name: '导出', exact: true }).click()
  await expect(page.getByRole('button', { name: '扫码带走' })).toBeVisible()
  const pageCount = page.context().pages().length
  // 包 F：导出成功后页面会自动打开真实 PDF 预览（预览 = 导出 = 打印同一份）；未自动打开时再点按钮。
  const dialog = page.getByRole('dialog', { name: '优化版简历.pdf' })
  if (!(await dialog.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: '扫码带走' }).click()
  }
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('[data-file-preview-kind="pdf"] [data-pdf-preview-host]')).toHaveAttribute('data-preview-src', '/w3-fixtures/optimized-resume.pdf')
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
  await chooseGenericResumeDirection(page)
  const input = page.getByLabel('选择本机简历文件')
  await input.setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('broken') })
  await page.locator('.qx-rt-preview > summary').click()
  await expect(page.locator('[data-file-preview-kind="unavailable"]')).toBeVisible()
  await input.setInputFiles({ name: 'recovered.pdf', mimeType: 'application/pdf', buffer: Buffer.from(VISIBLE_PDF) })
  await page.locator('.qx-rt-preview > summary').click()
  await expect(page.locator('[data-file-preview-kind="pdf"]')).toBeVisible()
  await expect(page.locator('[data-file-preview-kind="pdf"] [data-pdf-preview-host]')).toHaveAttribute('data-preview-src', '/w3-fixtures/recovered.pdf')
  await input.setInputFiles({ name: 'resume_pdf_final.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from('synthetic-docx') })
  await page.locator('.qx-rt-preview > summary').click()
  await expect(page.locator('[data-file-preview-kind="unsupported"]')).toBeVisible()
  await expect(page.locator('[data-file-preview-kind="unsupported"] iframe')).toHaveCount(0)
})

test('direct resume parse stays fail-closed without fake stages @w3-kiosk', async ({ page, api }) => {
  const runtimeErrors: string[] = []
  page.on('pageerror', (error) => runtimeErrors.push(error.message))
  terminalBaseline(api)
  await page.goto('/resume/parse')
  await expect(page.getByText('未找到简历文件', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '回到来源选择' })).toBeVisible()
  await expect(page.getByText(/正在识别|正在提取|已完成|进行中…/)).toHaveCount(0)
  await expect(page).toHaveURL(/\/resume\/parse$/)
  // 缺文件不是「解析中」：四步轨停在第 1 步，不说「文件收到了」，胶囊说这一步没有文件。
  expect(await parseViewSnapshot(page)).toMatchObject({ state: 'missing-file', current: '上传与方向', pill: '这一步没有文件', saysReceived: false })
  // 没有文件也是完整的读简历版式（空白页小样 + 一句说明 + 处理内容 + 两句声明），不是一句话下面空一整屏。
  await expect(page.locator('[data-kiosk-screen="resume-parse"] .qxt-live[data-tone="paused"]')).toContainText('请回到来源选择，把简历交进来后，再开始 AI 诊断。')
  await expect(page.getByRole('button', { name: '回到来源选择' })).toBeInViewport({ ratio: 1 })
  await assertNoHorizontalOverflow(page)
  await page.getByRole('button', { name: '回到来源选择' }).click()
  await page.waitForURL('/resume/source')
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
  // 结果未知（没拿到可信答复）≠ 解析失败：留在解析页，不转失败屏、不自动再提交。
  // 假时钟推过原先 700ms 的转页计时，确定性地证明「不会自己跳走、不会自己重发」。
  let parseCalls = 0
  const parseReplies: Array<(route: Route) => Promise<void>> = [
    (route) => route.abort('internetdisconnected'),
    (route) => route.fulfill({ status: 504, contentType: 'text/html', body: '<html>504 Gateway Time-out</html>' }),
    // 带 API 业务信封的 5xx 也不算明确失败：服务端可能处理完了，只是回包失败。
    (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ success: false, error: { code: 'AI_PROVIDER_ERROR', message: 'upstream' } }) }),
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(diagnosis) }),
  ]
  await page.route('**/api/v1/resume/parse', async (route) => {
    parseCalls += 1
    const reply = parseReplies.shift()
    await (reply ? reply(route) : route.abort('failed'))
  })
  await page.clock.install()
  await page.goto('/resume/source')
  await chooseGenericResumeDirection(page)
  await page.getByLabel('选择本机简历文件').setInputFiles({ name: '求职简历.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-w3') })
  await page.locator('.qx-rt-preview > summary').click()
  const preview = page.locator('[data-file-preview-kind="pdf"]')
  await expect(preview).toBeVisible()
  await expect(preview.locator('[data-pdf-preview-host]')).toHaveAttribute('data-preview-src', '/w3-fixtures/resume.pdf')
  await expect.poll(() => previewLoaded).toBe(true)
  await startResumeDiagnosis(page)
  const resubmit = page.getByRole('button', { name: '重新提交解析（新的一次）' })
  for (const [label, calls] of [['network drop', 1], ['gateway 504 without an API envelope', 2], ['503 with an API envelope', 3]] as const) {
    await expect(page.getByText('没等到解析结果', { exact: true }), label).toBeVisible()
    expect(await parseViewSnapshot(page), label).toMatchObject({ state: 'unknown', current: null, pill: '解析结果未知', saysReceived: false, saysError: false })
    await expect(page.locator('.resume-parse-unknown'), label).toContainText('暂时无法确认')
    await expect(page.getByTestId('resume-parse-unknown-next'), label).toContainText('当前未登录')
    await expect(page.getByTestId('resume-parse-unknown-next'), label).not.toContainText('我的简历')
    await expect(page.getByText(/解析中断|解析出错/), label).toHaveCount(0)
    await page.clock.runFor(5_000)
    await expect(page, label).toHaveURL((url) => url.pathname === '/resume/parse')
    expect(parseCalls, `${label}: no automatic re-POST`).toBe(calls)
    await expect(resubmit, label).toBeVisible()
    if (calls === 1) await assertNoHorizontalOverflow(page)
    // 新的一次要过两级确认。同一刻连点不得跳过任一级，确认完成前不得 POST。
    await resubmit.evaluate((button: HTMLElement) => { button.click(); button.click() })
    const firstDialog = page.getByRole('dialog', { name: '重新提交是新的一次' })
    await expect(firstDialog, label).toBeVisible()
    await expect(firstDialog.getByRole('button', { name: '开始新的一次' }), label).toHaveCount(0)
    expect(parseCalls, `${label}: opening confirm does not POST`).toBe(calls)
    await firstDialog.getByRole('button', { name: '继续确认' }).evaluate((button: HTMLElement) => { button.click(); button.click() })
    const secondDialog = page.getByRole('dialog', { name: '再次确认' })
    await expect(secondDialog, label).toBeVisible()
    expect(parseCalls, `${label}: first confirm does not POST`).toBe(calls)
    await secondDialog.getByRole('button', { name: '开始新的一次' }).evaluate((button: HTMLElement) => { button.click(); button.click() })
    await expect.poll(() => parseCalls, `${label}: second confirm posts once`).toBe(calls + 1)
  }
  await page.waitForURL('/resume/report')
  await expect(page.locator('[data-kiosk-screen="resume-report"]')).toHaveAttribute('data-state', /^report(?:-minimal)?$/)
  expect(parseCalls).toBe(4)
  expect(runtimeErrors).toEqual([])
})

/*
 * 拿到了编号但不是最终结果（2xx + status=processing；AiTaskStatus 合同允许，现有 provider 不产出）：
 * 用既有 GET /resume/records/:taskId 按同一编号只读再查，一次性令牌只走请求头，不进地址栏，
 * 全程不再 POST 解析。
 */
test('resume parse unknown with a task id rechecks the same record instead of re-posting @w3-kiosk', async ({ page, api }) => {
  const runtimeErrors: string[] = []
  page.on('pageerror', (error) => runtimeErrors.push(error.message))
  terminalBaseline(api)
  api.respond('POST', '/api/v1/files/kiosk-upload', { status: 200, json: uploadedResume })
  let parseCalls = 0
  await page.route('**/api/v1/resume/parse', async (route) => {
    parseCalls += 1
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ taskId: 'resume-w3-pending', status: 'processing', accessToken: 'w3-pending-access' }) })
  })
  const recordReads: Array<{ url: string; access: string | undefined }> = []
  await page.route('**/api/v1/resume/records/resume-w3-pending', async (route) => {
    recordReads.push({ url: route.request().url(), access: route.request().headers()['x-resume-access-token'] })
    const body = recordReads.length === 1
      ? { taskId: 'resume-w3-pending', status: 'processing' }
      : { ...diagnosis, taskId: 'resume-w3-pending' }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
  await page.goto('/resume/source')
  await chooseGenericResumeDirection(page)
  await page.getByLabel('选择本机简历文件').setInputFiles({ name: '求职简历.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-w3') })
  await startResumeDiagnosis(page)
  await expect(page.getByText('解析还没出最终结果', { exact: true })).toBeVisible()
  expect(await parseViewSnapshot(page)).toMatchObject({ state: 'unknown', pill: '解析结果未知', saysError: false })
  await expect(page.getByRole('button', { name: '重新提交解析（新的一次）' })).toHaveCount(0)
  const recheck = page.getByRole('button', { name: '按同一编号再查结果' })
  await expect(recheck).toBeInViewport({ ratio: 1 })
  await assertTapTargetPointerHit(recheck)
  await expect(page.locator('.qxt-dock').getByRole('button', { name: '按同一编号再查结果' })).toHaveCount(1)
  await expectParseColumnBlocksClear(page, '结果未知（有编号）右栏')
  await recheck.click()
  await expect(page.getByTestId('resume-parse-recheck-result')).toContainText('仍不是最终结果')
  await expect(page).toHaveURL((url) => url.pathname === '/resume/parse')
  await recheck.click()
  await page.waitForURL('/resume/report')
  await expect(page.locator('[data-kiosk-screen="resume-report"]')).toHaveAttribute('data-state', /^report(?:-minimal)?$/)
  expect(parseCalls).toBe(1)
  expect(recordReads.map((read) => read.access)).toEqual(['w3-pending-access', 'w3-pending-access'])
  for (const read of recordReads) expect(read.url).not.toContain('w3-pending-access')
  expect(page.url()).not.toContain('w3-pending-access')
  expect(runtimeErrors).toEqual([])
})

/*
 * 稿 21 upload-unknown：没拿到服务端的可信答复 ≠ 上传失败。
 * 每次上传请求都记下 multipart 里的文件名，最后与用户的每一次选择逐条比对：页面若在「结果未知」后
 * 自己重发，名单就会多出一条 —— 不靠固定等待证明「没有自动重发」。
 * 上一份成功的 A 在用户换成下一份后，无论下一份失败还是结果未知，都不能再被交给解析。
 */
test('resume source Qingxu frame keeps intent, the 10MB limit and separates an upload rejection from an unknown result @w3-kiosk', async ({ page, api }) => {
  const runtimeErrors: string[] = []
  page.on('pageerror', (error) => runtimeErrors.push(error.message))
  terminalBaseline(api)
  // 顶栏返回落到简历服务台，它会探一次后端健康（与本用例无关）。
  api.respond('GET', '/api/v1/health', { status: 200, json: { success: true, data: { status: 'ok' } } })
  await page.route('**/w3-fixtures/resume.pdf', (route) =>
    route.fulfill({ status: 200, contentType: 'application/pdf', body: VISIBLE_PDF }),
  )
  const uploadNames: string[] = []
  const uploadReplies: Array<(route: Route) => Promise<void>> = []
  await page.route('**/api/v1/files/kiosk-upload', async (route) => {
    uploadNames.push(route.request().postDataBuffer()?.toString('latin1').match(/filename="([^"]+)"/)?.[1] ?? '?')
    const reply = uploadReplies.shift()
    await (reply ? reply(route) : route.abort('failed'))
  })
  const parseFileIds: string[] = []
  await page.route('**/api/v1/resume/parse', async (route) => {
    parseFileIds.push((route.request().postDataJSON() as { fileId?: string }).fileId ?? '')
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ success: false, error: { code: 'AI_PROVIDER_ERROR', message: 'x' } }) })
  })
  const reply = (status: number, body: string, contentType = 'application/json') =>
    (route: Route) => route.fulfill({ status, contentType, body })
  const uploaded = (fileId: string, filename: string) =>
    reply(200, JSON.stringify({ success: true, data: { ...uploadedResume.data, fileId, filename } }))

  await page.goto('/resume/source?intent=optimize')
  await chooseGenericResumeDirection(page)
  const source = page.locator('[data-kiosk-screen="resume-source"]')
  await expect(source).toBeVisible()
  await expect(page.getByRole('heading', { level: 1, name: '你的简历在哪里？' })).toBeVisible()
  await expect(page.locator('.qxt-rail [aria-current="step"]')).toHaveText(/上传与方向/)
  const primary = page.getByRole('button', { name: '请先上传简历文件' })
  await expect(primary).toBeDisabled()
  const input = page.getByLabel('选择本机简历文件')
  await input.setInputFiles({ name: 'too-big.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(10 * 1024 * 1024 + 1) })
  await expect(page.locator('.resume-source-error')).toContainText('文件超过 10MB')
  expect(uploadNames).toEqual([])
  await page.locator('.qxt-dock').getByRole('button', { name: '上一步' }).click()
  await page.waitForURL('/resume-service')
  await page.goto('/resume/source?intent=optimize')
  await chooseGenericResumeDirection(page)
  await expect(source).toBeVisible()

  const pick = async (name: string, next: (route: Route) => Promise<void>) => {
    uploadReplies.push(next)
    await input.setInputFiles({ name, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-w3') })
  }
  await pick('resume-a.pdf', uploaded('file-w3-a', 'resume-a.pdf'))
  await expect(source).toHaveAttribute('data-state', 'staged')
  await openResumeDirection(page)
  await expect(page.getByRole('button', { name: '上传并生成优化建议' })).toBeEnabled()
  // 诊断方向这一步的底栏返回键写「返回」（稿 resume-direction），回到「简历在哪里」。
  await page.locator('.qxt-dock').getByRole('button', { name: '返回', exact: true }).click()

  const unknownReplies: Array<[string, (route: Route) => Promise<void>]> = [
    ['network drop', (route) => route.abort('internetdisconnected')],
    ['2xx with a truncated body', reply(200, '{"success":true,"data":{"fileId":"file-w3-cut')],
    ['2xx without data (FILE_UPLOAD_EMPTY)', reply(200, '{"success":true}')],
    ['2xx without a file id', reply(200, JSON.stringify({ success: true, data: { ...uploadedResume.data, fileId: '' } }))],
    ['gateway timeout without an error envelope', reply(504, '<html>504 Gateway Time-out</html>', 'text/html')],
    ['proxy 503 without an error envelope', reply(503, '<html>503 Service Unavailable</html>', 'text/html')],
    // 带业务信封的 5xx 也不能说「没传上」：文件可能已落成 active，只是后面的签名 / 补偿失败了。
    ['500 with an API error envelope', reply(500, JSON.stringify({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: '服务器内部错误' } }))],
    // API 对 4xx 一律写 error.code；没有信封的 4xx 是代理代回的，不冒充已知失败。
    ['proxy 413 without an error envelope', reply(413, '<html>413 Request Entity Too Large</html>', 'text/html')],
  ]
  for (const [index, [label, next]] of unknownReplies.entries()) {
    await pick(`resume-unknown-${index}.pdf`, next)
    await expect(source, label).toHaveAttribute('data-state', 'upload-unknown')
    await expect(page.locator('.resume-source-unknown'), label).toContainText('暂时无法确认')
    // 未登录：不断言文件归属，也不指去「我的文档」。
    await expect(page.getByTestId('resume-source-unknown-next'), label).toContainText('当前未登录')
    await expect(page.getByTestId('resume-source-unknown-next'), label).not.toContainText('我的文档')
    await expect(page.locator('.resume-source-error'), label).toHaveCount(0)
    await expect(page.locator('.qx-pill'), label).toHaveText('上传结果未知 · 不重发')
    await expect(primary, label).toBeDisabled()
    await expect(page.getByText('resume-a.pdf'), `${label}: the earlier file must not stand in for this one`).toHaveCount(0)
    await expect(page.locator('[data-file-preview-kind]'), label).toHaveCount(0)
    await expect(page.getByRole('button', { name: /重试|重新上传|再查/ }), label).toHaveCount(0)
  }
  await expect(page.getByText(/没能传到服务器|Failed to fetch|JSON|服务器内部错误|请求失败/)).toHaveCount(0)
  await assertNoHorizontalOverflow(page)

  // 服务端明确拒收：仍是已知失败，原因照常透出，不被改写成「结果未知」。
  await pick('resume-rejected.pdf', reply(400, JSON.stringify({ success: false, error: { code: 'FILE_TYPE_NOT_ALLOWED', message: '不支持的文件类型，请上传 PDF 或图片' } })))
  await expect(source).toHaveAttribute('data-state', 'upload-failed')
  await expect(page.locator('.resume-source-error')).toContainText('不支持的文件类型')
  await expect(page.locator('.resume-source-unknown')).toHaveCount(0)
  await expect(primary).toBeDisabled()

  // 用户主动再选一份并成功：恢复正常，交给解析的是这一份，不是 A。
  await pick('resume-c.pdf', uploaded('file-w3-c', 'resume-c.pdf'))
  await expect(source).toHaveAttribute('data-state', 'staged')
  await startResumeOptimize(page)
  await page.waitForURL('/resume/parse')
  await expect.poll(() => parseFileIds).toEqual(['file-w3-c'])
  expect(uploadNames).toEqual([
    'resume-a.pdf',
    ...unknownReplies.map((_, index) => `resume-unknown-${index}.pdf`),
    'resume-rejected.pdf',
    'resume-c.pdf',
  ])
  expect(runtimeErrors).toEqual([])
})

test('resume parse: a result arriving after leaving never hijacks navigation @w3-kiosk', async ({ page, api }) => {
  let parseCalls = 0
  let release: () => void = () => {}
  const held = new Promise<void>((resolve) => { release = resolve })
  terminalBaseline(api)
  api.respond('POST', '/api/v1/files/kiosk-upload', { status: 200, json: uploadedResume })
  await page.route('**/api/v1/resume/parse', async (route) => {
    parseCalls += 1
    await held
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(diagnosis) }).catch(() => undefined)
  })
  await page.goto('/resume/source')
  await chooseGenericResumeDirection(page)
  await page.getByLabel('选择本机简历文件').setInputFiles({ name: '求职简历.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-w3') })
  await startResumeDiagnosis(page)
  await page.waitForURL('/resume/parse')
  await expect(page.locator('[data-kiosk-screen="resume-parse"]')).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: '在进行' })).toBeVisible()
  await expect(page.locator('.qxt-rail [aria-current="step"]')).toHaveText(/AI 解析/)
  await expect(page.getByText('返回仅停止本机等待，不会撤回已提交的服务请求', { exact: false })).toBeVisible()
  await expect.poll(() => parseCalls).toBe(1)
  await page.getByRole('button', { name: '返回上一步' }).click()
  await page.waitForURL('/resume/source')
  // 放行迟到的结果并等它真正送达页面，再多走两帧让 React 处理完——不用固定等待时长。
  const lateResponse = page.waitForResponse('**/api/v1/resume/parse')
  release()
  await lateResponse
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  await expect(page).toHaveURL(/\/resume\/source$/)
  await expect(page.locator('[data-kiosk-screen="resume-report"]')).toHaveCount(0)
  expect(parseCalls).toBe(1)
})

/*
 * 游客等待态（稿 reading）：右栏只有「在进行 + 四条处理内容 + 六个维度 + 两句声明」，
 * 游客说明与「识别不清怎么办」放在左栏文件名下面，不挤右栏。
 * 此前右栏塞满后，第 5 个维度被第一块声明盖住一半、第 6 个看不见，toBeVisible 却照样通过，所以量几何。
 */
test('resume parse waiting keeps all six dimensions clear of the declarations and the guest notes in the left column @w3-kiosk', async ({ page, api }) => {
  const runtimeErrors: string[] = []
  page.on('pageerror', (error) => runtimeErrors.push(error.message))
  terminalBaseline(api)
  api.respond('POST', '/api/v1/files/kiosk-upload', { status: 200, json: uploadedResume })
  let release: () => void = () => {}
  const held = new Promise<void>((resolve) => { release = resolve })
  await page.route('**/api/v1/resume/parse', async (route) => {
    await held
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(diagnosis) }).catch(() => undefined)
  })
  await page.goto('/resume/source')
  await chooseGenericResumeDirection(page)
  await page.getByLabel('选择本机简历文件').setInputFiles({ name: '求职简历.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-w3') })
  await startResumeDiagnosis(page)
  await page.waitForURL('/resume/parse')
  const root = page.locator('[data-kiosk-screen="resume-parse"][data-state="waiting"]')
  await expect(root).toBeVisible()
  const dimensions = root.locator('.qxt-rochips span')
  await expect(dimensions).toHaveCount(6)
  for (let index = 0; index < 6; index += 1) await expect(dimensions.nth(index)).toBeInViewport({ ratio: 1 })
  const rects = await root.evaluate((el) => {
    const box = (node: Element) => { const r = node.getBoundingClientRect(); return { top: r.top, bottom: r.bottom } }
    return {
      dims: Array.from(el.querySelectorAll('.qxt-rochips span')).map(box),
      firstWhy: box(el.querySelector('.qxt-rcol .qxt-why') as Element),
      card: box(el.querySelector('.qxt-rcol') as Element),
      cardWhys: Array.from(el.querySelectorAll('.qxt-rcol .qxt-why')).map(box),
    }
  })
  // 最后一个维度条的下沿不大于第一块声明的上沿；声明整块落在右栏卡片里。
  expect(rects.dims[5].bottom).toBeLessThanOrEqual(rects.firstWhy.top)
  for (let index = 1; index < rects.dims.length; index += 1) expect(rects.dims[index - 1].bottom).toBeLessThanOrEqual(rects.dims[index].top)
  for (const why of rects.cardWhys) expect(why.bottom).toBeLessThanOrEqual(rects.card.bottom)
  await expectParseColumnBlocksClear(page, '等待态右栏')
  // 游客说明、识别不清怎么办在左栏；右栏里一句也不留（它们不是稿里右栏的内容）。
  const left = root.locator('.qxt-reader-notes')
  await expect(left.getByTestId('resume-ai-guest-notice')).toContainText('未登录使用简历 AI')
  await expect(left).toContainText('识别不清或解析失败时会说明下一步怎么做。诊断结果由 AI 生成，仅供参考。')
  await expect(root.locator('.qxt-rcol .qx-rt-note')).toHaveCount(0)
  await assertNoHorizontalOverflow(page)
  release()
  await page.waitForURL('/resume/report')
  expect(runtimeErrors).toEqual([])
})

test('resume parse first POST carries both intent headers and a lost reply replays the same pair @w3-kiosk', async ({ page, api }) => {
  const calls: Array<{ intent: string; proof: string }> = []
  terminalBaseline(api)
  api.respond('POST', '/api/v1/files/kiosk-upload', { status: 200, json: uploadedResume })
  await page.route('**/api/v1/resume/parse', async (route) => {
    const headers = route.request().headers()
    calls.push({
      intent: headers['x-resume-parse-intent'] ?? '',
      proof: headers['x-resume-parse-proof'] ?? '',
    })
    if (calls.length === 1) {
      await route.abort('failed')
      return
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(diagnosis) })
  })
  await page.goto('/resume/source')
  await chooseGenericResumeDirection(page)
  await page.getByLabel('选择本机简历文件').setInputFiles({ name: '求职简历.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-w3') })
  await startResumeDiagnosis(page)
  await page.waitForURL('/resume/parse')
  await expect.poll(() => calls.length).toBe(1)
  expect(calls[0].intent).toMatch(/^[A-Za-z0-9_-]{43}$/)
  expect(calls[0].proof).toMatch(/^[A-Za-z0-9_-]{43}$/)
  expect(calls[0].intent).not.toBe(calls[0].proof)
  await expect(page.locator('b').filter({ hasText: /^结果未知$/ })).toBeVisible()
  await expect(page.getByTestId('resume-parse-replay')).toHaveText('原样再试一次')
  // 恢复动作在底栏主按钮里：整颗在屏内、真的点得到。右栏说明再长也不能把它挤到屏外（toBeVisible 对被裁掉的元素也会通过）。
  await expect(page.getByTestId('resume-parse-replay')).toBeInViewport({ ratio: 1 })
  await assertTapTargetPointerHit(page.getByTestId('resume-parse-replay'))
  await expect(page.locator('.qxt-dock').getByTestId('resume-parse-replay')).toHaveCount(1)
  await expectParseColumnBlocksClear(page, '结果未知（无编号）右栏')
  await page.getByTestId('resume-parse-replay').click()
  await page.waitForURL('/resume/report')
  expect(calls).toHaveLength(2)
  expect(calls[1]).toEqual(calls[0])
})

test('resume parse server failure is labelled failed, never as the running step @w3-kiosk', async ({ page, api }) => {
  const posts: Array<{ intent: string; proof: string }> = []
  const failedBody = { taskId: 'resume-w3-failed', status: 'failed', failReason: '文字识别失败，请确保文件清晰', accessToken: 'w3-failed-access' }
  terminalBaseline(api)
  api.respond('POST', '/api/v1/files/kiosk-upload', { status: 200, json: uploadedResume })
  // 2xx + status=failed：先把编号和令牌放进失败报告，清掉这次意图后，「重新解析」必须铸新的一对请求头。
  await page.route('**/api/v1/resume/parse', async (route) => {
    const headers = route.request().headers()
    posts.push({
      intent: headers['x-resume-parse-intent'] ?? '',
      proof: headers['x-resume-parse-proof'] ?? '',
    })
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(failedBody) })
  })
  await page.goto('/resume/source')
  await chooseGenericResumeDirection(page)
  await page.getByLabel('选择本机简历文件').setInputFiles({ name: '求职简历.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-w3') })
  await startResumeDiagnosis(page)
  await expect(page.getByText('解析出错', { exact: true })).toBeVisible()
  expect(await parseViewSnapshot(page)).toMatchObject({ state: 'failed', current: null, bad: 'AI 解析', pill: '解析失败 · 可重试', saysReceived: false })
  // 明确失败才进报告页失败屏；非 AI 出路是触屏版出路行（.qxt-slab），重新解析在底栏主按钮里。
  await page.waitForURL('/resume/report')
  await expect(page.getByTestId('resume-report-state-diagnose-failed')).toBeVisible()
  const exits = page.getByTestId('resume-report-fail-exits').locator('.qxt-slab')
  await expect(exits).toHaveCount(4)
  for (let index = 0; index < 4; index += 1) await assertTapTargetPointerHit(exits.nth(index))
  await expect(page.getByTestId('resume-report-fallback')).toBeVisible()
  const retry = page.locator('.qx-btn[data-testid="resume-report-primary"]')
  await expect(retry).toHaveText('重新解析')
  const failureRouteState = () => page.evaluate(() => {
    const usr = (window.history.state as { usr?: { taskId?: string; accessToken?: string } } | null)?.usr
    return { taskId: usr?.taskId, accessToken: usr?.accessToken }
  })
  await expect.poll(failureRouteState).toEqual({ taskId: 'resume-w3-failed', accessToken: 'w3-failed-access' })
  await retry.click()
  await page.waitForURL('/resume/parse')
  await page.waitForURL('/resume/report')
  await expect(page.getByText('文字识别失败，请确保文件清晰', { exact: false })).toBeVisible()
  expect(posts).toHaveLength(2)
  expect(posts[0].intent).toMatch(/^[A-Za-z0-9_-]{43}$/)
  expect(posts[0].proof).toMatch(/^[A-Za-z0-9_-]{43}$/)
  expect(posts[1].intent).not.toBe(posts[0].intent)
  expect(posts[1].proof).not.toBe(posts[0].proof)
  expect(posts[1].intent).not.toBe(posts[1].proof)
  // 重新解析铸了新意图，原来这次失败的编号和令牌仍只留在失败报告的路由 state，不进地址栏。
  expect(await failureRouteState()).toEqual({ taskId: 'resume-w3-failed', accessToken: 'w3-failed-access' })
  expect(page.url()).not.toContain('w3-failed-access')
  await expect(page.getByRole('button', { name: /重试|重新/ })).toBeVisible()
})

/**
 * 诊断失败屏上的「打印我上传的原件」：用户自己的简历原件（resume_upload · original）。
 * 生产强制 PRINT_REQUIRE_PII_SCAN=true，没做完隐私检查就建单会被拒 PRINT_PII_SCAN_REQUIRED，
 * 所以它必须带着**这一份文件的 fileId** 去打印台材料检查，不直达报价确认页（商用收口 P0-5）。
 * fileId 来自上传结果：来源页把它放在解析页 state 顶层，失败时整份 state 转给报告页。
 */
test('diagnosis failure prints the uploaded original through the print desk material check @w3-kiosk', async ({ page, api }) => {
  const inspection = {
    id: 'w3-original-inspection', kind: 'inspection', status: 'processing', requesterMode: 'anonymous',
    accessToken: 'w3-original-inspection-token', sourceFileId: uploadedResume.data.fileId, resultFileId: null, endUserId: null,
    params: {}, result: null, errorCode: null, errorMessage: null,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  }
  terminalBaseline(api)
  api.respond('POST', '/api/v1/files/kiosk-upload', { status: 200, json: uploadedResume })
  api.respond('POST', '/api/v1/materials/tasks', { status: 200, json: { success: true, data: inspection } })
  api.respond('GET', `/api/v1/materials/tasks/${inspection.id}`, { status: 200, json: { success: true, data: inspection } })
  await page.route('**/w3-fixtures/resume.pdf', (route) =>
    route.fulfill({ status: 200, contentType: 'application/pdf', body: VISIBLE_PDF }),
  )
  await page.route('**/api/v1/resume/parse', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ taskId: 'resume-w3-failed', status: 'failed', failReason: '文字识别失败，请确保文件清晰', accessToken: 'w3-failed-access' }),
  }))

  await page.goto('/resume/source')
  await chooseGenericResumeDirection(page)
  await page.getByLabel('选择本机简历文件').setInputFiles({ name: '求职简历.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-w3') })
  await startResumeDiagnosis(page)
  await page.waitForURL('/resume/report')
  await expect(page.getByTestId('resume-report-state-diagnose-failed')).toBeVisible()

  const inspectionCreated = page.waitForRequest((request) =>
    request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/materials/tasks',
  )
  await page.getByTestId('resume-report-fail-exits').getByRole('button', { name: /打印我上传的原件/ }).click()
  await page.waitForURL(/\/print\/desk\?step=check$/)
  await expect(page.locator('[data-w2-page="print-material-check"]')).toBeVisible()
  // 带过去的是**这一份**：体检任务按上传结果的 fileId 建，预览画的是上传时那条签名内容链接。
  // （W3 用例只走真实界面、不读写浏览器存储 —— verify-fusion-w3 钉着这一条，会话内容由 W2 / W5 用例核对。）
  expect((await inspectionCreated).postDataJSON()).toMatchObject({ kind: 'inspection', sourceFileId: uploadedResume.data.fileId })
  await expect(page.locator('.qpd-preview-meta strong')).toHaveText('求职简历.pdf')
  await expect(page.getByTitle('求职简历.pdf 预览')).toHaveAttribute('data-preview-src', uploadedResume.data.signedUrl)
  expect(api.requestCount('POST', '/api/v1/orders/quote'), '原件检查完之前不报价').toBe(0)
})

test('resume parse public quota rejection clears the local intent before the failure report @w3-kiosk', async ({ page, api }) => {
  const posts: Array<{ intent: string; proof: string }> = []
  terminalBaseline(api)
  api.respond('POST', '/api/v1/files/kiosk-upload', { status: 200, json: uploadedResume })
  await page.route('**/api/v1/resume/parse', async (route) => {
    const headers = route.request().headers()
    posts.push({
      intent: headers['x-resume-parse-intent'] ?? '',
      proof: headers['x-resume-parse-proof'] ?? '',
    })
    const body = posts.length === 1
      ? { success: false, error: { code: 'AI_PUBLIC_QUOTA_EXCEEDED', message: '今日次数已用完' } }
      : diagnosis
    await route.fulfill({
      status: posts.length === 1 ? 429 : 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    })
  })
  await page.goto('/resume/source')
  await chooseGenericResumeDirection(page)
  await page.getByLabel('选择本机简历文件').setInputFiles({ name: '求职简历.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-w3') })
  await startResumeDiagnosis(page)
  await page.waitForURL('/resume/report')
  await expect(page.getByText('今天的 AI 次数用完了', { exact: false })).toBeVisible()
  await expect(page.getByText('使用的人较多')).toHaveCount(0)
  // Trace 已证实第二次请求会在 click 完成前返回；先监听临时解析路由，仍要求它真实经过。
  await Promise.all([
    page.waitForURL('/resume/parse'),
    page.getByTestId('resume-report-primary').click(),
  ])
  await page.waitForURL('/resume/report')
  expect(posts).toHaveLength(2)
  expect(posts[0].intent).toMatch(/^[A-Za-z0-9_-]{43}$/)
  expect(posts[0].proof).toMatch(/^[A-Za-z0-9_-]{43}$/)
  expect(posts[1].intent).not.toBe(posts[0].intent)
  expect(posts[1].proof).not.toBe(posts[0].proof)
})

test('resume parse AI paused lands on the failure report with non-AI exits and no re-parse @w3-kiosk', async ({ page, api }) => {
  const tickets: string[] = []
  terminalBaseline(api)
  api.respond('POST', '/api/v1/files/kiosk-upload', { status: 200, json: uploadedResume })
  await page.route('**/api/v1/resume/parse', async (route) => {
    tickets.push(route.request().headers()['x-terminal-session-token'] ?? '')
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ success: false, error: { code: 'AI_PAUSED', message: 'AI 服务暂停中，打印扫描照常' } }),
    })
  })
  await page.goto('/resume/source')
  await chooseGenericResumeDirection(page)
  await page.getByLabel('选择本机简历文件').setInputFiles({ name: '求职简历.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-w3') })
  await startResumeDiagnosis(page)
  // AI 停用是能力级：不留在解析页叫人「原样再试」，转明确失败屏。
  await page.waitForURL('/resume/report')
  await expect(page.getByTestId('resume-report-state-diagnose-failed')).toBeVisible()
  await expect(page.getByText('AI 服务暂停中', { exact: false }).first()).toBeVisible()
  // 不用 AI 的出路在，「重新解析」不在。
  await expect(page.getByTestId('resume-report-fail-exits')).toBeVisible()
  await expect(page.getByRole('button', { name: '重新解析' })).toHaveCount(0)
  await expect(page.getByTestId('resume-report-primary')).toHaveText('打印我上传的原件')
  expect(tickets, '只提交一次，且 AI 请求带终端会话票').toEqual([expect.stringMatching(/.+/)])
})

test('resume parse public quota rejection stays on the parse page when the intent cannot be cleared @w3-kiosk', async ({ page, api }) => {
  const posts: string[] = []
  terminalBaseline(api)
  api.respond('POST', '/api/v1/files/kiosk-upload', { status: 200, json: uploadedResume })
  await page.route('**/api/v1/resume/parse', async (route) => {
    posts.push(route.request().headers()['x-resume-parse-intent'] ?? '')
    await route.fulfill({
      status: 429,
      contentType: 'application/json',
      body: JSON.stringify({ success: false, error: { code: 'AI_PUBLIC_QUOTA_EXCEEDED', message: '今日次数已用完' } }),
    })
  })
  await page.goto('/resume/source')
  await chooseGenericResumeDirection(page)
  await page.evaluate(() => {
    const store = (window as Window & Record<string, Storage>)[['session', 'Storage'].join('')]
    const key = 'ai-job-print:kiosk-resume-parse-intent'
    const write = store.setItem.bind(store)
    let writes = 0
    store.setItem = (name: string, value: string) => {
      if (name === key && ++writes > 1) return
      write(name, value)
    }
  })
  await page.getByLabel('选择本机简历文件').setInputFiles({ name: '求职简历.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-w3') })
  await startResumeDiagnosis(page)
  await expect(page.locator('b').filter({ hasText: /^结果未知$/ })).toBeVisible()
  await expect(page).toHaveURL((url) => url.pathname === '/resume/parse')
  await expect(page.getByRole('button', { name: '重新提交解析（新的一次）' })).toHaveCount(0)
  expect(posts).toEqual([expect.stringMatching(/^[A-Za-z0-9_-]{43}$/)])
})

test('resume parse terminal keyed 4xx tells the truth and does not start another parse @w3-kiosk', async ({ page, api }) => {
  const posts: Array<{ intent: string; proof: string; body: string }> = []
  let next: { status: number; code: string; mutate?: 'payload' } = { status: 409, code: 'RESUME_PARSE_INTENT_REVOKED' }
  terminalBaseline(api)
  api.respond('POST', '/api/v1/files/kiosk-upload', { status: 200, json: uploadedResume })
  await page.route('**/api/v1/resume/parse', async (route) => {
    const headers = route.request().headers()
    posts.push({
      intent: headers['x-resume-parse-intent'] ?? '',
      proof: headers['x-resume-parse-proof'] ?? '',
      body: route.request().postData() ?? '',
    })
    if (next.mutate === 'payload') {
      await changeStoredResumeFileId(page, 'other-file')
    }
    const status = next.status
    const code = next.code
    await route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify({ success: false, error: { code, message: 'server' } }),
    })
  })
  const stored = () => readResumeParseIntents(page)
  const start = async () => {
    await page.goto('/resume/source')
    await clearResumeParseIntents(page)
    await page.reload()
    await chooseGenericResumeDirection(page)
    await page.getByLabel('选择本机简历文件').setInputFiles({ name: '求职简历.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-w3') })
    await startResumeDiagnosis(page)
    await page.waitForURL('/resume/parse')
  }

  next = { status: 409, code: 'RESUME_PARSE_INTENT_REVOKED' }
  await start()
  await expect(page.getByTestId('resume-parse-terminal')).toContainText('这次解析已撤销')
  await expect(page.getByTestId('resume-parse-terminal-next')).toContainText('连续确认两次')
  await expect(page.getByText('没有调用模型')).toHaveCount(0)
  await expect(page.getByTestId('resume-parse-replay')).toHaveCount(0)
  // 终态的恢复动作同样在底栏、整颗在屏内。
  await expect(page.getByTestId('resume-parse-new-attempt')).toBeInViewport({ ratio: 1 })
  await assertTapTargetPointerHit(page.getByTestId('resume-parse-new-attempt'))
  await expect(page.locator('.qxt-dock').getByTestId('resume-parse-new-attempt')).toHaveCount(1)
  await expectParseColumnBlocksClear(page, '终态（已撤销）右栏')
  expect(await stored()).toHaveLength(1)
  expect(posts).toHaveLength(1)
  const revokedIntent = posts[0].intent
  await page.getByTestId('resume-parse-new-attempt').click()
  const firstDialog = page.getByRole('dialog', { name: '重新提交是新的一次' })
  await expect(firstDialog).toContainText('再次调用 AI')
  await firstDialog.getByRole('button', { name: '先不提交' }).click()
  expect(posts).toHaveLength(1)
  expect((await stored())[0]?.intent).toBe(revokedIntent)
  await page.getByTestId('resume-parse-new-attempt').click()
  await page.getByRole('dialog', { name: '重新提交是新的一次' }).getByRole('button', { name: '继续确认' }).click()
  await expect(page.getByRole('dialog', { name: '再次确认' })).toContainText('这一次已结束的解析标识')
  expect(posts).toHaveLength(1)
  await page.getByRole('dialog', { name: '再次确认' }).getByRole('button', { name: '先不提交' }).click()
  expect(posts).toHaveLength(1)
  expect((await stored())[0]?.intent).toBe(revokedIntent)
  next = { status: 200, code: 'OK' }
  await page.unroute('**/api/v1/resume/parse')
  await page.route('**/api/v1/resume/parse', async (route) => {
    const headers = route.request().headers()
    posts.push({
      intent: headers['x-resume-parse-intent'] ?? '',
      proof: headers['x-resume-parse-proof'] ?? '',
      body: route.request().postData() ?? '',
    })
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(diagnosis) })
  })
  await page.getByTestId('resume-parse-new-attempt').click()
  await page.getByRole('dialog', { name: '重新提交是新的一次' }).getByRole('button', { name: '继续确认' }).click()
  await page.getByRole('dialog', { name: '再次确认' }).getByRole('button', { name: '开始新的一次' }).click()
  await page.waitForURL('/resume/report')
  expect(posts).toHaveLength(2)
  expect(posts[1].intent).not.toBe(revokedIntent)
  expect(posts[1].body).toBe(posts[0].body)

  await page.unroute('**/api/v1/resume/parse')
  await page.route('**/api/v1/resume/parse', async (route) => {
    const headers = route.request().headers()
    posts.push({
      intent: headers['x-resume-parse-intent'] ?? '',
      proof: headers['x-resume-parse-proof'] ?? '',
      body: route.request().postData() ?? '',
    })
    if (next.mutate === 'payload') {
      await changeStoredResumeFileId(page, 'other-file')
    }
    await route.fulfill({
      status: next.status,
      contentType: 'application/json',
      body: JSON.stringify(next.status === 200 ? diagnosis : { success: false, error: { code: next.code, message: 'server' } }),
    })
  })

  for (const [code, title] of [
    ['RESUME_PARSE_RESULT_EXPIRED', '解析结果已过期'],
    ['RESUME_PARSE_RESULT_MISSING', '解析结果已不在'],
  ] as const) {
    const before = posts.length
    next = { status: 404, code }
    await start()
    await expect(page.getByTestId('resume-parse-terminal')).toContainText(title)
    await expect(page.getByText('没有调用模型')).toHaveCount(0)
    await expect(page.getByTestId('resume-parse-replay')).toHaveCount(0)
    expect(posts).toHaveLength(before + 1)
    expect(await stored()).toHaveLength(1)
    await page.getByTestId('resume-parse-new-attempt').click()
    await page.getByRole('dialog', { name: '重新提交是新的一次' }).getByRole('button', { name: '先不提交' }).click()
    expect(posts).toHaveLength(before + 1)
  }

  const changedBefore = posts.length
  next = { status: 409, code: 'FILE_CONTENT_CHANGED' }
  await start()
  await expect(page.getByTestId('resume-parse-terminal')).toContainText('文件内容已变化')
  await expect(page.getByTestId('resume-parse-terminal-next')).toContainText('重新上传')
  await expect(page.getByText('文件内容已变化，已停止使用。这次没有调用模型。', { exact: true })).toBeVisible()
  await expect(page.getByTestId('resume-parse-reupload')).toBeInViewport({ ratio: 1 })
  await assertTapTargetPointerHit(page.getByTestId('resume-parse-reupload'))
  await expectParseColumnBlocksClear(page, '终态（文件已变化）右栏')
  await expect(page.getByTestId('resume-parse-replay')).toHaveCount(0)
  await expect(page.getByTestId('resume-parse-new-attempt')).toHaveCount(0)
  expect(await stored()).toEqual([])
  expect(posts).toHaveLength(changedBefore + 1)
  const changedIntent = posts[changedBefore].intent
  await page.getByTestId('resume-parse-reupload').click()
  await page.waitForURL((url) => url.pathname === '/resume/source')
  await chooseGenericResumeDirection(page)
  expect(posts).toHaveLength(changedBefore + 1)
  next = { status: 200, code: 'OK' }
  await page.getByLabel('选择本机简历文件').setInputFiles({ name: '求职简历.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-w3') })
  await startResumeDiagnosis(page)
  await page.waitForURL('/resume/report')
  expect(posts).toHaveLength(changedBefore + 2)
  expect(posts[changedBefore + 1].intent).not.toBe(changedIntent)

  const mismatchBefore = posts.length
  next = { status: 409, code: 'FILE_CONTENT_CHANGED', mutate: 'payload' }
  await start()
  await expect(page.getByTestId('resume-parse-terminal')).toContainText('对不上')
  await expect(page.getByTestId('resume-parse-reupload')).toHaveCount(0)
  await expect(page.getByTestId('resume-parse-new-attempt')).toHaveCount(0)
  expect((await stored())[0]?.payload.fileId).toBe('other-file')
  expect(posts).toHaveLength(mismatchBefore + 1)

  for (const reply of [
    { status: 404, code: 'FILE_NOT_FOUND' },
    { status: 409, code: 'RESUME_PARSE_INTENT_PAYLOAD_MISMATCH' },
    { status: 500, code: 'RESUME_PARSE_INTENT_REVOKED' },
    { status: 408, code: 'FILE_CONTENT_CHANGED' },
    { status: 404, code: 'AI_TASK_NOT_FOUND' },
  ]) {
    const before = posts.length
    next = reply
    await start()
    if (reply.status >= 500 || reply.status === 408 || reply.code === 'AI_TASK_NOT_FOUND') {
      await expect(page.getByText('没等到解析结果', { exact: true })).toBeVisible()
      expect(await stored()).toHaveLength(1)
      const kept = posts[before].intent
      await page.getByTestId('resume-parse-replay').click()
      await expect.poll(() => posts.length).toBe(before + 2)
      expect(posts[before + 1].intent).toBe(kept)
    } else {
      await page.waitForURL('/resume/report')
      expect(await stored()).toHaveLength(1)
      const kept = posts[before].intent
      await page.getByTestId('resume-report-primary').click()
      await page.waitForURL('/resume/parse')
      await expect.poll(() => posts.length).toBe(before + 2)
      expect(posts[before + 1].intent).toBe(kept)
      expect(posts[before + 1].body).toBe(posts[before].body)
    }
  }
})

test('resume parse consent gate pauses the rail and sends nothing until granted @w3-kiosk', async ({ page, api }) => {
  let parseCalls = 0
  terminalBaseline(api)
  api.respond('GET', '/api/v1/kiosk/legal/terms_of_service', { status: 200, json: { success: true, data: null } })
  api.respond('GET', '/api/v1/kiosk/legal/privacy_policy', { status: 200, json: { success: true, data: null } })
  api.respond('POST', '/api/v1/member/auth/sms-code', { status: 200, json: { success: true, data: { sent: true, cooldownSeconds: 60, expiresInSeconds: 300 } } })
  api.respond('POST', '/api/v1/member/auth/login', { status: 200, json: { success: true, data: { token: 'w3-consent-member', user: { id: 'w3-consent', phoneMasked: '138****8000', nickname: '授权闸会员' } } } })
  api.respond('GET', '/api/v1/me/ai-consents/status', { status: 200, json: { success: true, data: [{ scope: 'resume_ai', granted: false }] } })
  // 登录后会员壳层会顺手读一次收藏（与本用例无关，给空列表）。
  api.respond('GET', '/api/v1/me/favorites', { status: 200, json: { success: true, data: { items: [], nextCursor: null, total: 0 } } })
  api.respond('POST', '/api/v1/files/kiosk-upload', { status: 200, json: uploadedResume })
  await page.route('**/api/v1/resume/parse', async (route) => {
    parseCalls += 1
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ success: false, error: { code: 'AI_PROVIDER_ERROR', message: 'x' } }) })
  })
  await page.goto(`/login?from=${encodeURIComponent('/resume/source')}`)
  await page.getByRole('checkbox', { name: /我已阅读并同意/ }).click()
  await page.getByRole('button', { name: '手机号（11 位本人号码）', exact: true }).click()
  for (const digit of '13800138000') await page.getByRole('button', { name: digit, exact: true }).click()
  await page.getByRole('button', { name: '收起键盘', exact: true }).click()
  await page.getByRole('button', { name: '获取验证码', exact: true }).click()
  await page.getByRole('button', { name: '短信验证码', exact: true }).click()
  for (const digit of '123456') await page.getByRole('button', { name: digit, exact: true }).click()
  await page.getByRole('button', { name: '收起键盘', exact: true }).click()
  await page.getByRole('button', { name: '确认登录', exact: true }).click()
  await page.waitForURL((url) => url.pathname === '/resume/source')
  await chooseGenericResumeDirection(page)
  await page.getByLabel('选择本机简历文件').setInputFiles({ name: '求职简历.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-w3') })
  await startResumeDiagnosis(page)
  await page.waitForURL('/resume/parse')
  await expect(page.getByRole('dialog')).toBeVisible()
  expect(await parseViewSnapshot(page)).toMatchObject({ state: 'consent-needed', current: null, wait: 'AI 解析', pill: '等待授权', saysReceived: false })
  expect(parseCalls).toBe(0)
  // 授权弹层是触屏弹层，盖在这一屏上：正文 20px 以上、两颗按钮都 ≥64 高；底下的页面被盖住（不可点、不被读屏），
  // 但仍是完整的读简历版式（等你授权的说明、处理内容、六个维度、两句声明），不是一整屏空白。
  const consentDialog = page.getByRole('dialog', { name: '确认使用简历 AI' })
  await expect(consentDialog).toBeVisible()
  const consentGeometry = await consentDialog.evaluate((dialog) => {
    const sizes = Array.from(dialog.querySelectorAll('p')).map((node) => parseFloat(getComputedStyle(node).fontSize))
    const buttons = Array.from(dialog.querySelectorAll('button')).map((button) => button.getBoundingClientRect())
    const under = document.querySelector('.qxt-under')
    return { minFont: Math.min(...sizes), buttonHeights: buttons.map((rect) => rect.height), underInert: under?.hasAttribute('inert') ?? false }
  })
  expect(consentGeometry.minFont).toBeGreaterThanOrEqual(20)
  for (const height of consentGeometry.buttonHeights) expect(height).toBeGreaterThanOrEqual(64)
  expect(consentGeometry.underInert).toBe(true)
  await expect(page.locator('[data-kiosk-screen="resume-parse"] .qxt-live[data-tone="paused"]')).toContainText('使用简历 AI 前需要先确认授权')
  await expect(page.locator('[data-kiosk-screen="resume-parse"] .qxt-rochips span')).toHaveCount(6)
  await page.getByRole('button', { name: '暂不使用' }).click()
  await page.waitForURL((url) => url.pathname === '/resume/source')
  expect(parseCalls).toBe(0)
  // 取消授权同样换掉解析页那条历史：浏览器后退回到交文件之前的来源页，不会把解析页连同授权弹窗翻回来。
  await page.goBack()
  await expect(page).toHaveURL((url) => url.pathname === '/resume/source')
  await expect(page.locator('[data-kiosk-screen="resume-parse"]')).toHaveCount(0)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(parseCalls).toBe(0)
})

/*
 * 顶栏返回必须把解析页这条历史换掉（replace），不能压在来源页底下：否则浏览器 / 系统后退会让解析页
 * 带着原来的路由 state 重新挂载，用同一个 fileId、同一条签名链接再提交一次解析，文件名也重新摆回屏幕。
 * 1080 与 390（舞台不缩放，顶栏返回键与胶囊走窄屏规则）各走一遍；优化 intent 要原样带回来源页。
 */
for (const viewport of [{ width: 1080, height: 1920 }, { width: 390, height: 844 }]) {
  test(`resume parse top back replaces the parse entry so browser back never re-posts (${viewport.width}x${viewport.height}) @w3-kiosk`, async ({ page, api }) => {
    const runtimeErrors: string[] = []
    page.on('pageerror', (error) => runtimeErrors.push(error.message))
    await page.setViewportSize(viewport)
    terminalBaseline(api)
    api.respond('POST', '/api/v1/files/kiosk-upload', { status: 200, json: uploadedResume })
    const parseBodies: Array<{ fileId?: string; source?: string }> = []
    let release: () => void = () => {}
    const held = new Promise<void>((resolve) => { release = resolve })
    await page.route('**/api/v1/resume/parse', async (route) => {
      parseBodies.push(route.request().postDataJSON() as { fileId?: string; source?: string })
      await held
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(diagnosis) }).catch(() => undefined)
    })
    await page.goto('/resume/source?intent=optimize')
    await chooseGenericResumeDirection(page)
    await page.getByLabel('选择本机简历文件').setInputFiles({ name: '求职简历.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-w3') })
    await startResumeOptimize(page)
    await page.waitForURL('/resume/parse')
    await expect.poll(() => parseBodies.length).toBe(1)
    expect(parseBodies[0]).toMatchObject({ fileId: uploadedResume.data.fileId, source: 'upload' })
    await expect(page.getByText('求职简历.pdf', { exact: true })).toBeVisible()
    await expect(page.locator('.qx-pill')).toHaveText('正在解析 · 一次性出结果')
    await assertQxPillReadable(page, `/resume/parse ${viewport.width}`)
    const historyBefore = await page.evaluate(() => window.history.length)

    await page.getByLabel('返回简历来源').click()
    await page.waitForURL((url) => url.pathname === '/resume/source' && url.search === '?intent=optimize')
    // 换掉而不是压栈：历史条目数不变。
    expect(await page.evaluate(() => window.history.length)).toBe(historyBefore)

    await page.goBack()
    // 后退落在交文件之前的那条来源页，解析页不再挂载，也不再把这份文件摆出来。
    await expect(page).toHaveURL((url) => url.pathname === '/resume/source' && url.search === '?intent=optimize')
    await expect(page.locator('[data-kiosk-screen="resume-parse"]')).toHaveCount(0)
    await expect(page.getByText('求职简历.pdf', { exact: true })).toHaveCount(0)

    // 放行第一次请求的迟到结果：既不把人带去报告页，也始终只有这一次提交。
    const late = page.waitForResponse('**/api/v1/resume/parse')
    release()
    await late
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    await expect(page).toHaveURL((url) => url.pathname === '/resume/source')
    await expect(page.locator('[data-kiosk-screen="resume-report"]')).toHaveCount(0)
    expect(parseBodies).toHaveLength(1)
    expect(runtimeErrors).toEqual([])
  })
}

test('Qingxu topbar stays on one line at 390 and 1080 keeps its full layout @w3-kiosk', async ({ page, api }) => {
  terminalBaseline(api)
  // 简历服务台会探一次后端健康（相邻青序页，只为量它的顶栏）。
  api.respond('GET', '/api/v1/health', { status: 200, json: { success: true, data: { status: 'ok' } } })
  api.respond('POST', '/api/v1/files/kiosk-upload', { status: 200, json: uploadedResume })
  await page.goto('/resume/source')
  // 触屏意图带不锁 104 高。1080 上返回键至少 64，品牌一行，胶囊不裁。
  const wideBar = await qxTopbarMetrics(page)
  expect(wideBar.backW).toBeGreaterThanOrEqual(64)
  expect(wideBar).toMatchObject({ subShown: false, brandLines: 1, pillClipped: false })
  await assertQxPillReadable(page, '/resume/source 1080')

  await page.setViewportSize({ width: 390, height: 844 })
  // 本批两页 + 相邻的已迁青序页（报告页在 KioskRoot 内、岗位匹配是整屏路由），都走同一条共用顶栏规则。
  // 稿 22 的任务头只读；返回移到共享顶栏，仍检查同一触摸尺寸下限。
  // 岗位匹配页不在这里量：它有自己页内的手机顶栏规则（.jfq-root，胶囊按设计省略号截断），不走这条共用规则。
  for (const [route, hasTopbarBack] of [['/resume/source', true], ['/resume/parse', true], ['/resume/report', true], ['/resume-service', null]] as Array<[string, boolean | null]>) {
    await page.goto(route)
    const metrics = await qxTopbarMetrics(page)
    expect(metrics.stageFit, route).toBe('off')
    expect(metrics, route).toMatchObject({ brandLines: 1, pillClipped: false, subShown: false })
    // 状态胶囊允许收窄折两行（服务台那句整句说明），但不许逐字竖排：每行至少四个字，最多两行。
    expect(metrics.pillLines, `${route} 「${metrics.pillText}」`).toBeLessThanOrEqual(Math.min(2, Math.ceil(metrics.pillText.length / 4)))
    // 折两行时按词组断：不许最后一个字单独掉到第二行，带「 · 」的标签不许把短语拆开。
    await assertQxPillReadable(page, route)
    if (hasTopbarBack === true) expect(metrics.backW, route).toBeGreaterThanOrEqual(48)
    else if (hasTopbarBack === false) expect(metrics.backW, route).toBe(0)
    else expect(metrics.backW === 0 || metrics.backW >= 48, `${route} back ${metrics.backW}`).toBe(true)
  }

  // 390 下来源选择要一眼可见；隐私说明字号可读、滚到时不被底部操作条压住；维度块不把最后一个字挤下行。
  await page.goto('/resume/source')
  await expect(page.getByRole('group', { name: '选择简历来源' })).toBeInViewport()
  const privacy = page.locator('.resume-source-privacy')
  await privacy.scrollIntoViewIfNeeded()
  const legible = await privacy.evaluate((el) => {
    const rect = el.getBoundingClientRect()
    const bar = document.querySelector('.qxt-dock')!.getBoundingClientRect()
    return { font: parseFloat(getComputedStyle(el).fontSize), bottom: rect.bottom, barTop: bar.top }
  })
  expect(legible.font).toBeGreaterThanOrEqual(14)
  expect(legible.bottom).toBeLessThanOrEqual(legible.barTop + 0.5)
  await page.getByText('点击展开', { exact: false }).click()
  const brokenChips = await page.locator('.qx-rt-dim, .qx-rt-dimchip .tx').evaluateAll((els) => els
    .map((el) => {
      const range = document.createRange()
      range.selectNodeContents(el)
      return { text: el.textContent ?? '', lines: new Set(Array.from(range.getClientRects()).map((rect) => Math.round(rect.top))).size }
    })
    .filter((item) => item.lines > 1))
  expect(brokenChips).toEqual([])
  await assertNoHorizontalOverflow(page)
})

test('R1 2.0 keeps resume controls below the read-only header and preserves the direction width @w3-kiosk', async ({ page, api }) => {
  terminalBaseline(api)
  const taskId = 'qx2-r1-layout'
  api.respond('GET', `/api/v1/resume/records/${taskId}`, { status: 200, json: { ...diagnosis, taskId } })
  api.respond('GET', '/api/v1/job-materials/templates', { status: 200, json: { success: true, data: [] } })
  api.respond('GET', '/api/v1/resume/export/pricing', { status: 200, json: { mode: 'free', unitCents: 0, unit: 'item', benefit: null } })
  api.respond('GET', `/api/v1/resume/records/${taskId}/optimize`, {
    status: 200,
    json: {
      taskId, status: 'completed', providerName: 'llm',
      modules: [{ title: '个人简介', before: '参与项目沟通。', after: '参与项目沟通，跟进需求。' }],
      optimizedResume: { basic: { name: '版式测试' }, intention: {}, summary: '参与项目沟通，跟进需求。', education: [], experience: [], projects: [], skills: [], certificates: [] },
    },
  })
  for (const [route, ready] of [
    ['/resume/source', '[data-kiosk-screen="resume-source"]'],
    [`/resume/report?taskId=${taskId}`, '[data-testid="resume-report-dims"]'],
    // 稿 23（2.0）：总览与编辑区用按钮切换，没有页签；有可对照的条目时先落在总览。
    [`/resume/optimize?taskId=${taskId}`, '[data-testid="resume-optimize-overview"]'],
    [`/resume/optimize/compare?taskId=${taskId}`, '[aria-label="改写选择统计"]'],
  ]) {
    await page.goto(route)
    await expect(page.locator(ready)).toBeVisible()
    const docks = page.locator('.qxt-dock .qxt-btn')
    const dockCount = await docks.count()
    for (let i = 0; i < dockCount; i += 1) {
      const box = await docks.nth(i).boundingBox()
      expect(box?.height ?? 0, route).toBeGreaterThanOrEqual(64)
    }
    await assertNoHorizontalOverflow(page)
    await expect(page.locator('[data-kiosk-screen]').first()).not.toContainText(/服务端|能力探测|未验收|终端编号|内部文件号/)
    await expect(page.getByRole('button', { name: /^问小青：/ })).toBeVisible()
  }
})

test('resume report folds the seven blocks, keeps one page scroller, and keeps the takeaway row @w3-kiosk', async ({ page, api }) => {
  terminalBaseline(api)
  api.respond('GET', '/api/v1/resume/export/pricing', { status: 200, json: { mode: 'free', unitCents: 0, unit: 'item', benefit: null } })
  await page.goto('/resume/report?capture=1&state=report&taskId=paircapture01')
  await expect(page.getByTestId('resume-report-state-report')).toBeVisible()
  // 2.0 规则 4：出处标记不上屏。空的 .rrp-prov 没有文字，底色和边框仍会画出浅色小方块。
  await expect(page.locator('.rrp-prov')).toHaveCount(0)

  // 触屏版（稿 diagnosis）：简历内容结构折在一个 <details> 里，点开才看到各块；整页只有外层一个滚动区，没有内部滚动区。
  const structure = page.getByTestId('resume-report-structure')
  await expect(structure).not.toHaveAttribute('open', '')
  await structure.locator('summary').click()
  const blockKeys = ['basic', 'objective', 'education', 'experience', 'project', 'skill', 'selfintro']
  for (const key of blockKeys) {
    const block = page.getByTestId(`resume-report-block-${key}`)
    await block.scrollIntoViewIfNeeded()
    await expect(block).toBeInViewport()
  }
  await expect(page.getByTestId('resume-report-block-basic')).toContainText('命中 1 条问题 · 1 条证据')
  await expect(page.getByTestId('resume-report-block-experience')).toContainText('命中 1 条问题 · 2 条证据')
  await expect(page.getByTestId('resume-report-block-selfintro')).toContainText('本块没有命中问题')
  // 被问题引用的那几行原文要标出来（data-ev），没被引用的不标。
  expect(await page.getByTestId('resume-report-block-basic').locator('p[data-ev="1"]').count()).toBeGreaterThan(0)
  await expect(page.getByTestId('resume-report-block-selfintro').locator('p[data-ev="1"]')).toHaveCount(0)

  const structureOverflow = await structure.evaluate((el) => getComputedStyle(el).overflowY)
  expect(structureOverflow).not.toBe('auto')
  expect(structureOverflow).not.toBe('scroll')
  const innerScrollers = await page.locator('[data-kiosk-screen="resume-report"] *').evaluateAll((els) => els.filter((el) => {
    const overflow = getComputedStyle(el).overflowY
    return (overflow === 'auto' || overflow === 'scroll') && el.scrollHeight > el.clientHeight + 1
  }).length)
  expect(innerScrollers).toBe(0)

  await expect(page.getByTestId('resume-report-takeaway-title')).toHaveText('带走这份报告')
  const takeawayButtons = page.locator('[data-testid="resume-report-export-actions"] .rrp-export > button')
  await expect(takeawayButtons).toHaveCount(4)
  const takeawayRow = await takeawayButtons.evaluateAll((els) => els.map((el) => {
    const rect = el.getBoundingClientRect()
    return { top: Math.round(rect.top), height: rect.height }
  }))
  expect(new Set(takeawayRow.map((item) => item.top)).size).toBe(1)
  for (const item of takeawayRow) expect(item.height).toBeGreaterThanOrEqual(64)

  // 底栏固定：页面内容滚动时底栏不动；主按钮在底栏里，文字不被裁。
  const barBefore = await page.locator('.qxt-dock').boundingBox()
  await page.getByTestId('resume-report-block-selfintro').scrollIntoViewIfNeeded()
  const barAfter = await page.locator('.qxt-dock').boundingBox()
  expect(Math.abs((barBefore?.y ?? 0) - (barAfter?.y ?? 1))).toBeLessThan(2)
  const primary = await page.getByTestId('resume-report-primary').evaluate((el) => ({ height: el.getBoundingClientRect().height, clipped: el.scrollWidth > el.clientWidth + 1 }))
  expect(primary.height).toBeGreaterThanOrEqual(64)
  expect(primary.clipped).toBe(false)

  // 简历对照、自我探索两个入口在报告正文的页尾，各自可点。
  await page.getByRole('button', { name: '简历对照' }).scrollIntoViewIfNeeded()
  await expect(page.getByRole('button', { name: '简历对照' })).toBeVisible()
  await expect(page.getByRole('button', { name: '自我探索' })).toBeVisible()

  await page.goto('/resume/report?capture=1&state=diagnose-failed&taskId=paircapture01')
  await expect(page.getByTestId('resume-report-state-diagnose-failed')).toBeVisible()
  const failPrimary = await page.getByTestId('resume-report-primary').evaluate((el) => ({ height: el.getBoundingClientRect().height, clipped: el.scrollWidth > el.clientWidth + 1 }))
  expect(failPrimary.height).toBeGreaterThanOrEqual(64)
  expect(failPrimary.clipped).toBe(false)
})

test('resume report page scroll keeps the takeaway reachable and the dock in place @w3-kiosk', async ({ page, api }) => {
  terminalBaseline(api)
  api.respond('GET', '/api/v1/resume/export/pricing', { status: 200, json: { mode: 'free', unitCents: 0, unit: 'item', benefit: null } })
  await page.goto('/resume/report?capture=1&state=report&taskId=paircapture01')
  await expect(page.getByTestId('resume-report-state-report')).toBeVisible()
  // 触屏版整页滚动取代了原来内部结构区的「下滑还有 N 块」提示：先改这几处在顶部，带走这份报告在滚动正文里，都能到达。
  const scroller = page.locator('.qxt-body')
  const dockTop = await page.locator('.qxt-dock').evaluate((el) => el.getBoundingClientRect().top)
  await scroller.evaluate((el) => { el.scrollTop = el.scrollHeight })
  await expect(page.getByTestId('resume-report-takeaway-title')).toBeInViewport()
  expect(await page.getByTestId('resume-report-export-actions').evaluate((el) => el.getBoundingClientRect().bottom)).toBeLessThanOrEqual(dockTop + 1)

  await scroller.evaluate((el) => { el.scrollTop = 0 })
  await expect(page.getByTestId('resume-report-priorities')).toBeInViewport()
  expect(Math.abs(await page.locator('.qxt-dock').evaluate((el) => el.getBoundingClientRect().top) - dockTop)).toBeLessThan(2)
})

test('resume report exit rows keep an icon, an arrow to the destination, and a 64px hit area @w3-kiosk', async ({ page, api }) => {
  terminalBaseline(api)
  for (const state of ['unavailable', 'diagnose-failed', 'read-error', 'no-context'] as const) {
    await page.goto(`/resume/report?capture=1&state=${state}&taskId=paircapture01`)
    await expect(page.getByTestId(`resume-report-state-${state}`)).toBeVisible()
    const rows = page.locator('.qxt-exit-col .qxt-slab')
    const count = await rows.count()
    expect(count).toBeGreaterThan(0)
    for (let i = 0; i < count; i += 1) {
      const row = rows.nth(i)
      await row.scrollIntoViewIfNeeded()
      const box = await row.boundingBox()
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(64)
      await expect(row.locator('.qxt-vis')).toHaveCount(1)
      const disabled = await row.getAttribute('aria-disabled')
      await expect(row.locator('.qxt-take')).toHaveCount(disabled === 'true' ? 0 : 1)
    }
    if (state === 'diagnose-failed') {
      await expect(page.getByRole('button', { name: /打印我上传的原件/ })).toContainText('本次不可用')
      await expect(page.getByText('这里拿不到你刚上传的那份原件（离开这一页再回来就拿不到了）。请回到简历来源重新选取文件，再去打印。')).toBeVisible()
    }
  }

  // 自查清单在滚动正文的最下面，滚到底后不能被底栏盖住。
  for (const state of ['no-context', 'read-error', 'unavailable', 'illegal', 'diagnose-failed'] as const) {
    await page.goto(`/resume/report?capture=1&state=${state}&taskId=paircapture01`)
    await expect(page.locator('.qxt-howto').first()).toBeVisible()
    await page.locator('.qxt-body').evaluate((el) => { el.scrollTop = el.scrollHeight })
    const checksBottom = await page.getByTestId('resume-report-fallback').evaluate((el) => el.getBoundingClientRect().bottom)
    const barTop = await page.locator('.qxt-dock').evaluate((el) => el.getBoundingClientRect().top)
    expect(checksBottom).toBeLessThanOrEqual(barTop + 1)
  }
})

test('assistant first screen keeps composer and send above the Qingxu navbar @w3-kiosk', async ({ page, api }) => {
  terminalBaseline(api)
  await page.goto('/assistant')
  await expect(page.locator('[data-kiosk-screen="assistant"]')).toBeVisible()
  // 触屏稿：意图带标题是座舱文案，底栏当前项仍是「AI 顾问」，全页只有一个 h1。
  await expect(page.locator('h1')).toHaveCount(1)
  await expect(page.getByRole('heading', { level: 1, name: '你想解决什么？' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'AI 顾问咨询工作台' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: 'AI 顾问' })).toHaveAttribute('aria-current', 'page')
  const navTop = await page.locator('.qxt-nav').evaluate((el) => el.getBoundingClientRect().top)
  const input = await page.getByLabel('输入咨询问题').evaluate((el) => el.getBoundingClientRect().toJSON())
  const send = await page.locator('.assistant-send').evaluate((el) => el.getBoundingClientRect().toJSON())
  expect(send.bottom).toBeLessThan(navTop - 24)
  expect(input.bottom).toBeLessThan(navTop - 24)
  // 触屏稿：「本机 AI 专项」收在底部弹层里，开一下再量它的列数，量完收起。
  await page.getByRole('button', { name: /本机 AI 专项/ }).click()
  const cols = await page.locator('.assistant-ai-tools-grid').evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length)
  expect(cols).toBeGreaterThanOrEqual(1)
  console.log(`assistant-geometry navTop=${navTop} inputTop=${input.top} sendBottom=${send.bottom} toolCols=${cols}`)
  await page.screenshot({ path: 'test-results/assistant-qx-r4-1080x1920.png' })
  await page.getByRole('button', { name: '收起', exact: true }).click()

  await page.setViewportSize({ width: 390, height: 844 })
  // 等窄屏重排真正落地（导航贴回 844 视口底部），并回到首屏顶部再量 —— 否则量到的是 1080 版式的残影。
  // 触屏稿默认正文是一行入口加四张主题卡；稿里的「最近办理」是示例行，运行页没有真实的最近办理数据，不画，换成「本机 AI 专项」入口。
  await page.waitForFunction(() => Math.abs(document.querySelector('.qxt-nav')!.getBoundingClientRect().bottom - window.innerHeight) <= 1)
  await page.locator('.kassist').evaluate((el) => { el.scrollTop = 0 })
  const narrow = await page.evaluate(() => {
    const box = (sel: string) => document.querySelector(sel)!.getBoundingClientRect()
    return {
      recent: box('.assistant-tools-open'),
      firstTask: box('.assistant-task'),
      navTop: box('.qxt-nav').top,
      overflowX: document.documentElement.scrollWidth - window.innerWidth,
    }
  })
  console.log(`assistant-geometry-390 recentW=${narrow.recent.width} recentH=${narrow.recent.height} taskTop=${narrow.firstTask.top} taskH=${narrow.firstTask.height} navTop=${narrow.navTop} overflowX=${narrow.overflowX}`)
  await page.screenshot({ path: 'test-results/assistant-qx-r4-390x844.png' })
  expect(narrow.overflowX).toBeLessThanOrEqual(0)
  expect(narrow.recent.width).toBeGreaterThan(200)
  expect(narrow.recent.width).toBeLessThanOrEqual(390)
  expect(narrow.recent.height).toBeGreaterThanOrEqual(64)
  expect(narrow.recent.height).toBeLessThan(140)
  await expect(page.locator('.assistant-tools-open b')).toHaveText('本机 AI 专项')
  await expect(page.locator('.assistant-tools-open small')).toHaveText('8 项 · 首轮提问后确认可用性')
  await expect(page.locator('.assistant-task strong')).toHaveText(['简历与求职材料', '面试与沟通', '岗位与选择', '入职与职场'])
  expect(narrow.firstTask.top).toBeGreaterThanOrEqual(0)
  expect(narrow.firstTask.top).toBeLessThan(narrow.navTop)
  expect(narrow.firstTask.height).toBeGreaterThanOrEqual(64)
  await expect(page.getByRole('button', { name: /不经过 AI，直接去办/ })).toBeVisible()
  await page.locator('.kassist').evaluate((el) => { el.scrollTop = el.scrollHeight })
  const sendButton = page.locator('.assistant-send')
  await expect(sendButton).toBeVisible()
  const narrowNavTop = await page.locator('.qxt-nav').evaluate((el) => el.getBoundingClientRect().top)
  const narrowSend = await sendButton.evaluate((el) => el.getBoundingClientRect().bottom)
  const narrowInput = await page.getByLabel('输入咨询问题').evaluate((el) => el.getBoundingClientRect().bottom)
  console.log(`assistant-geometry-390-scrolled sendBottom=${narrowSend} inputBottom=${narrowInput} navTop=${narrowNavTop}`)
  await page.screenshot({ path: 'test-results/assistant-qx-r4-390x844-composer.png' })
  expect(narrowSend).toBeLessThanOrEqual(narrowNavTop)
  expect(narrowInput).toBeLessThanOrEqual(narrowNavTop)
  await expect(page.locator('.assistant-voice-trigger')).toBeVisible()
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

  // S2-5：providerLabel 是 `llm:*` 时才允许呈现为 AI 回答，且必须挂 E3 与 AI 生成可见标识。
  await expect(page.locator('[data-message-kind="ai"]')).toHaveCount(1)
  await expect(page.locator('[data-message-kind="ai"] [data-evidence="E3"]')).toBeVisible()
  await expect(page.getByText('AI 生成 · 供参考', { exact: true })).toBeVisible()
  // 四态：真的拿到结果才是 done。
  await expect(page.locator('.assistant-ai-status')).toHaveAttribute('data-aitask', 'done')

  api.abort('POST', '/api/v1/assistant/chat', 'internetdisconnected')
  await input.fill('再给一个建议')
  await page.getByRole('group', { name: '虚拟键盘' }).getByRole('button', { name: '发送', exact: true }).click()
  // 稿 05 的 reply-error 标题；断网时说的是断网，不笼统说「AI 暂不可用」
  // （「AI 服务暂不可用」留给服务器只回了工程串的情况，见下面的用户话用例）。
  await expect(page.getByText('请求失败，没有回答', { exact: true })).toBeVisible()
  await expect(page.getByText('网络连接失败，请检查网络后重试', { exact: true })).toBeVisible()

  // 失败停在 failed，且降级是 ① manual —— 功能不消失，四条不依赖 AI 的真实入口在。
  await expect(page.locator('.assistant-ai-status')).toHaveAttribute('data-aitask', 'failed')
  await expect(page.locator('.assistant-ai-status .kiosk-ai-fallback')).toHaveAttribute('data-ai-fallback-mode', 'manual')
  await expect(page.getByRole('navigation', { name: '不依赖 AI 的功能入口' })).toBeVisible()
  await expect(page.getByRole('button', { name: /^打印扫描/ })).toBeVisible()
  // 一次网络失败不是「模型没接上」，不该锁死：稿 reply-error 给「重试这一轮」，且没有「重新检查」那条锁定路径。
  await expect(page.getByRole('button', { name: /重试这一轮/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /^重新检查/ })).toHaveCount(0)

  await expect(page.locator('[data-kiosk-screen="assistant"]')).toBeVisible()
  await assertNoHorizontalOverflow(page)
  expect(runtimeErrors).toEqual([])
})

test('assistant: AI budget exhausted locks the composer and offers non-AI entries instead of a retry @w3-kiosk', async ({ page, api }) => {
  const runtimeErrors: string[] = []
  page.on('pageerror', (error) => runtimeErrors.push(error.message))
  terminalBaseline(api)
  const tickets: string[] = []
  await page.route('**/api/v1/assistant/chat', async (route) => {
    tickets.push(route.request().headers()['x-terminal-session-token'] ?? '')
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ success: false, error: { code: 'AI_BUDGET_EXHAUSTED', details: ['terminal'], message: '这台机器今天的 AI 额度已用完' } }),
    })
  })
  await page.goto('/assistant')
  await page.getByLabel('输入咨询问题').fill('我该先做简历还是先看岗位？')
  await page.getByRole('group', { name: '虚拟键盘' }).getByRole('button', { name: '发送', exact: true }).click()
  await expect(page.getByRole('button', { name: /^重新检查/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /重试这一轮/ })).toHaveCount(0)
  // 稿 ai-down：这一态不画输入坞，不留一个按不出结果的发送键，也没有可输入的框。
  await expect(page.locator('.assistant-send')).toHaveCount(0)
  await expect(page.getByLabel('输入咨询问题')).toHaveCount(0)
  await expect(page.getByRole('navigation', { name: '不依赖 AI 的功能入口' })).toBeVisible()
  await expect(page.getByRole('button', { name: /^打印扫描/ })).toBeVisible()
  expect(tickets, 'AI 请求带终端会话票').toEqual([expect.stringMatching(/.+/)])
  expect(runtimeErrors).toEqual([])
})

test('assistant refuses to present mock fallback as an AI answer @w3-kiosk', async ({ page, api }) => {
  const runtimeErrors: string[] = []
  page.on('pageerror', (error) => runtimeErrors.push(error.message))
  terminalBaseline(api)
  // 后端 assistant_chat 未就绪 → 回落 mock provider（风险 R1）。
  api.respond('POST', '/api/v1/assistant/chat', { status: 200, json: assistantMockFallbackReply })
  await page.goto('/assistant')

  const input = page.getByLabel('输入咨询问题')
  await input.fill('我该先做简历还是先看岗位？')
  await page.getByRole('group', { name: '虚拟键盘' }).getByRole('button', { name: '发送', exact: true }).click()

  // 最关键的一条：预置话术正文一个字都不许出现在页面上。
  await expect(page.getByText('这一轮没有 AI 回答').first()).toBeVisible()
  await expect(page.getByText(ASSISTANT_MOCK_FALLBACK_REPLY_TEXT)).toHaveCount(0)
  await expect(page.locator('[data-message-kind="ai"]')).toHaveCount(0)
  await expect(page.locator('[data-message-kind="not-ai"]')).toHaveCount(1)
  // 不冒充 AI，也就不许挂 E3「AI 判断」徽章。
  await expect(page.locator('.assistant-transcript [data-evidence="E3"]')).toHaveCount(0)
  // mock 的 action 同样是预置的，不该被当成「AI 建议的下一步」。
  await expect(page.getByText('未确认是 AI 回答', { exact: true })).toBeVisible()

  // ai-down 硬钳位：四态恒为 failed。
  await expect(page.locator('.assistant-ai-status')).toHaveAttribute('data-aitask', 'failed')
  await expect(page.locator('.assistant-ai-status .kiosk-ai-fallback')).toHaveAttribute('data-ai-fallback-mode', 'manual')
  await expect(page.getByRole('navigation', { name: '不依赖 AI 的功能入口' })).toBeVisible()

  // 稿：这一轮不是 AI 生成时不画输入坞，没有发送键可按；也没有可输入的框。
  const send = page.locator('.assistant-send')
  await expect(send).toHaveCount(0)
  await expect(page.getByLabel('输入咨询问题')).toHaveCount(0)

  // 锁上之后不再发请求，也不会再冒出第二条假回答。
  let extraChatCalls = 0
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/v1/assistant/chat') extraChatCalls += 1
  })
  await expect(page.locator('[data-message-kind="not-ai"]')).toHaveCount(1)

  // 「重新提问」仍受不可用事实约束，不能靠切换画面解除锁定：落在 AI 暂不可用，输入坞依旧没有。
  await page.getByRole('button', { name: /^重新提问/ }).click()
  await expect(page.getByTestId('ai-cockpit-state-ai-unavailable')).toBeVisible()
  await expect(send).toHaveCount(0)

  // 置灰一律 aria-disabled，绝不用原生 disabled（触屏无 hover，原生 disabled 掉出 tab 序）。专项工具收在「本机 AI 专项」弹层里。
  await page.getByRole('button', { name: /本机 AI 专项/ }).click()
  const toolCard = page.locator('.assistant-ai-tool-card').first()
  await expect(toolCard).toHaveAttribute('aria-disabled', 'true')
  expect(await toolCard.evaluate((el) => (el as HTMLButtonElement).disabled)).toBe(false)
  // 置灰原因常驻可见，不是 tooltip。
  await expect(page.locator('.assistant-ai-tools-reason')).toBeVisible()
  // force:true 绕过 Playwright 的可操作性检查 —— 它把 aria-disabled 当作不可点，
  // 但真实浏览器里 aria-disabled 的按钮**照样会派发 click**（没有原生 disabled）。
  // 用户在触屏上真的按得下去，所以这里必须模拟真按，才能验证按下去确实没有副作用。
  await toolCard.click({ force: true })
  expect(extraChatCalls).toBe(0)
  await page.getByRole('button', { name: '收起', exact: true }).click()

  // 但不是死局：可以显式重新检查，输入坞随之回来。
  await page.getByRole('button', { name: /^重新检查/ }).click()
  await expect(page.getByLabel('输入咨询问题')).toBeVisible()
  await expect(page.locator('.assistant-send')).not.toHaveAttribute('aria-disabled', 'true')

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

for (const provenance of [
  { providerLabel: 'mock', aiGenerated: true },
  { providerLabel: 'llm:test', aiGenerated: false },
  { providerLabel: 'llm:test', aiGenerated: undefined },
  { providerLabel: undefined, aiGenerated: true },
]) {
  test(`assistant double provenance gate rejects ${JSON.stringify(provenance)} @w3-kiosk`, async ({ page, api }) => {
    terminalBaseline(api)
    api.respond('POST', '/api/v1/assistant/chat', { status: 200, json: { ...assistantMockFallbackReply, ...provenance } })
    await page.goto('/assistant')
    await page.getByLabel('输入咨询问题').fill('帮我准备一份材料清单')
    await page.getByRole('group', { name: '虚拟键盘' }).getByRole('button', { name: '发送', exact: true }).click()
    await expect(page.getByTestId('ai-cockpit-state-reply-not-ai')).toBeVisible()
    await expect(page.locator('[data-message-kind="ai"]')).toHaveCount(0)
    await expect(page.locator('.assistant-transcript [data-evidence="E3"]')).toHaveCount(0)
    await expect(page.getByText(ASSISTANT_MOCK_FALLBACK_REPLY_TEXT)).toHaveCount(0)
    await expect(page.getByRole('navigation', { name: '不依赖 AI 的功能入口' })).toBeVisible()
  })
}

for (const [message, expected] of [
  ['当前使用的人较多，请稍后再试', '当前使用的人较多，请稍后再试'],
  ['服务端能力探测失败：AI_BUSY pending', 'AI 服务暂不可用，请稍后再试'],
]) {
  test(`assistant preserves user error meaning and filters technical text: ${message} @w3-kiosk`, async ({ page, api }) => {
    terminalBaseline(api)
    api.respond('GET', '/api/v1/terminals/KSK-001/config', { status: 200, json: terminalConfigWithHosting(RECRUITMENT_HOSTING_OFF) })
    api.respond('POST', '/api/v1/assistant/chat', { status: 503, json: { error: { code: 'AI_BUSY', message } } })
    await page.goto('/assistant')
    await page.getByLabel('输入咨询问题').fill('帮我准备面试')
    await page.getByRole('group', { name: '虚拟键盘' }).getByRole('button', { name: '发送', exact: true }).click()
    await expect(page.getByTestId('ai-cockpit-state-reply-error')).toBeVisible()
    await expect(page.getByText(expected, { exact: true })).toHaveCount(1)
    await expect(page.getByText(expected, { exact: true })).toBeVisible()
    await expect(page.getByText('今日次数已用完', { exact: true })).toHaveCount(0)
    if (message !== expected) await expect(page.getByText(message, { exact: true })).toHaveCount(0)
    const manual = page.getByRole('navigation', { name: '不依赖 AI 的功能入口' })
    await expect(manual.getByRole('button')).toHaveCount(4)
    await expect(manual.getByRole('button', { name: /^帮助中心/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /查看岗位信息|查看招聘会|找企业/ })).toHaveCount(0)
    // 失败不是锁定：给「重试这一轮」，没有「重新检查」那条锁定路径。
    await expect(page.getByRole('button', { name: /重试这一轮/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /^重新检查/ })).toHaveCount(0)
  })
}

test('assistant masks displayed contact details while sending original input @w3-kiosk', async ({ page, api }) => {
  terminalBaseline(api)
  const raw = '我的电话 13812345678，邮箱 user@example.com，请帮我写自我介绍。'
  let sent = ''
  await page.route('**/api/v1/assistant/chat', async (route) => {
    sent = route.request().postDataJSON().message
    await route.fulfill({ json: { ...assistantReply, reply: raw } })
  })
  await page.goto('/assistant')
  await page.getByLabel('输入咨询问题').fill(raw)
  await expect(page.getByTestId('cockpit-draft')).toContainText('138****5678')
  await page.getByRole('group', { name: '虚拟键盘' }).getByRole('button', { name: '发送', exact: true }).click()
  await expect(page.locator('[data-message-kind="ai"]')).toContainText('u***@example.com')
  await expect(page.locator('[data-message-kind="user"]')).toContainText('138****5678')
  await expect(page.locator('.assistant-transcript')).not.toContainText('13812345678')
  expect(sent).toBe(raw)
})

for (const micDenied of [false, true]) {
  test(`assistant voice controls retain consent and cleanup (mic denied: ${micDenied}) @w3-kiosk`, async ({ page, api }) => {
    terminalBaseline(api)
    await mockAssistantVoice(page, api, micDenied)
    await page.goto('/assistant')
    await page.getByRole('button', { name: '语音咨询', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '和小青语音咨询' })
    await expect(dialog).toHaveAttribute('data-state', 'voice-gate')
    expect(api.requestCount('POST', '/api/v1/trtc/session')).toBe(0)
    await dialog.getByRole('button', { name: /直接语音通话/ }).click()
    await expect(dialog).toHaveAttribute('data-state', micDenied ? 'mic-denied' : 'voice-live')
    await expect(dialog.getByText('可以先说说你最想解决的问题。', { exact: true })).toBeVisible()
    await dialog.getByRole('button', { name: '字幕已开', exact: true }).click()
    await expect(dialog.getByText('可以先说说你最想解决的问题。', { exact: true })).toHaveCount(0)
    await dialog.getByRole('button', { name: '字幕已关', exact: true }).click()
    await expect(dialog.getByText('可以先说说你最想解决的问题。', { exact: true })).toBeVisible()
    if (micDenied) {
      await expect(dialog.getByRole('button', { name: '重新尝试授权', exact: true })).toBeVisible()
      await dialog.getByRole('button', { name: '改用文字咨询', exact: true }).click()
      await expect(dialog).toHaveCount(0)
    } else {
      await dialog.getByRole('button', { name: '静音', exact: true }).click()
      await expect(dialog.getByRole('button', { name: '取消静音', exact: true })).toHaveAttribute('aria-pressed', 'true')
      await dialog.getByRole('button', { name: '结束通话', exact: true }).click()
      await expect(dialog).toHaveAttribute('data-state', 'voice-gate')
    }
    await expect.poll(() => api.requestCount('POST', '/api/v1/trtc/session/stop')).toBe(1)
    expect(api.requestCount('POST', '/api/v1/trtc/session')).toBe(1)
  })
}

test('assistant submitting waits for a response and preserves manual entries @w3-kiosk', async ({ page, api }) => {
  terminalBaseline(api)
  let release!: () => void
  const waiting = new Promise<void>((resolve) => { release = resolve })
  api.respondWith('POST', '/api/v1/assistant/chat', async () => {
    await waiting
    return { status: 200, json: assistantReply }
  })
  await page.goto('/assistant')
  await page.getByLabel('输入咨询问题').fill('简历怎么排到一页？')
  await page.getByRole('group', { name: '虚拟键盘' }).getByRole('button', { name: '发送', exact: true }).click()
  try {
    await expect(page.getByTestId('ai-cockpit-state-submitting')).toBeVisible()
    // 第一问时还没有哪一次回答确认过 AI 可用（availability 为 unknown）。共享 useAiTask 的约定
    // （src/ai/useAiTask.ts）是这时停在 idle，不把「在等回答」说成「AI 正在算」；等待由驾驶舱的
    // submitting 态表达。确认可用之后的 running 在下面第二问里验。
    await expect(page.locator('.assistant-ai-status')).toHaveAttribute('data-aitask', 'idle')
    await expect(page.locator('[data-message-kind="ai"]')).toHaveCount(0)
    await expect(page.getByRole('progressbar')).toHaveCount(0)
    await expect(page.locator('.assistant-send')).toBeDisabled()
    // 稿：等待态不另画四个入口，页面明说「办事入口照常可用」，离开靠顶栏返回与底部主导航，都不被等待锁住。
    await expect(page.getByText('这一轮还在等待，办事入口照常可用。')).toBeVisible()
    await expect(page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '首页' })).toBeEnabled()
    await expect(page.getByRole('button', { name: '返回首页' })).toBeEnabled()
  } finally {
    release()
  }
  await expect(page.getByTestId('ai-cockpit-state-reply-real')).toBeVisible()

  // 第二问：上一轮是真 AI 回答，可用已确认，这时在等的回答才是 running。
  let releaseSecond!: () => void
  const waitingSecond = new Promise<void>((resolve) => { releaseSecond = resolve })
  api.respondWith('POST', '/api/v1/assistant/chat', async () => {
    await waitingSecond
    return { status: 200, json: assistantReply }
  })
  await page.getByLabel('输入咨询问题').fill('还有别的写法吗？')
  await page.getByRole('group', { name: '虚拟键盘' }).getByRole('button', { name: '发送', exact: true }).click()
  try {
    await expect(page.getByTestId('ai-cockpit-state-submitting')).toBeVisible()
    await expect(page.locator('.assistant-ai-status')).toHaveAttribute('data-aitask', 'running')
    await expect(page.locator('.assistant-ai-status')).toHaveAttribute('aria-busy', 'true')
    await expect(page.getByRole('progressbar')).toHaveCount(0)
  } finally {
    releaseSecond()
  }
  await expect(page.locator('.assistant-ai-status')).toHaveAttribute('data-aitask', 'done')
})

test('assistant voice connecting can cancel and stops a late room response @w3-kiosk', async ({ page, api }) => {
  terminalBaseline(api)
  await mockAssistantVoice(page, api)
  let release!: () => void
  const waiting = new Promise<void>((resolve) => { release = resolve })
  api.respondWith('POST', '/api/v1/trtc/session', async () => {
    await waiting
    return { status: 200, json: { sdkAppId: 1, roomId: 'late-room', userId: 'fixture-user', userSig: 'synthetic', taskId: 'late-task' } }
  })
  await page.goto('/assistant')
  await page.getByRole('button', { name: '语音咨询', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '和小青语音咨询' })
  await dialog.getByRole('button', { name: /直接语音通话/ }).click()
  try {
    await expect(dialog).toHaveAttribute('data-state', 'voice-connecting')
    await expect(dialog.locator('time')).toHaveCount(0)
    await expect(dialog.getByRole('navigation', { name: '不依赖 AI 的功能入口' })).toBeVisible()
    await dialog.getByRole('button', { name: '取消尝试', exact: true }).click()
    await expect(dialog).toHaveAttribute('data-state', 'voice-gate')
  } finally {
    release()
  }
  await expect.poll(() => api.requestCount('POST', '/api/v1/trtc/session/stop')).toBe(1)
  await expect(dialog).toHaveAttribute('data-state', 'voice-gate')
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
  await expect(page.getByText('HR 初筛')).toHaveCount(0)
  await assertKioskShellFillsViewport(page)
  await expectInterviewDirectionUnselected(page)
  await page.getByRole('button', { name: '选择行业 (20)' }).click()
  const interviewIndustryDialog = page.getByRole('dialog', { name: '选择面试行业' })
  await expect(interviewIndustryDialog).toBeVisible()
  await assertDialogWithinViewport(page)
  await expect(interviewIndustryDialog.getByText('当前：尚未选择', { exact: true })).toBeVisible()
  await expect(interviewIndustryDialog.getByRole('button', { pressed: true })).toHaveCount(0)
  await interviewIndustryDialog.getByRole('button', { name: '制造业', exact: true }).click()
  await interviewIndustryDialog.getByRole('button', { name: '完成' }).click()
  await chooseInterviewExperience(page)
  await page.getByPlaceholder(/输入目标岗位/).fill('前端开发工程师')
  await advanceInterviewSetupToStart(page)
  await page.getByRole('button', { name: '创建并开始练习' }).click()
  await page.waitForURL(/\/interview\?stage=session/)
  await page.reload()
  await expect(page).toHaveURL(/\/interview\?stage=session/)
  await page.getByRole('textbox').fill('我基于真实经历完成了一个可访问性项目。')
  await page.getByRole('button', { name: '提交回答', exact: true }).click()
  await page.getByRole('button', { name: '结束本场练习', exact: true }).click()
  await page.waitForURL(/\/interview\?stage=report/)
  // 3.5c：横幅以 AI 可见标识开头（审计表一「模拟面试报告（一体机）」），不发给企业的边界不变。
  const reportNote = page.getByRole('note', { name: '合规提示' })
  await expect(reportNote).toContainText('AI 生成，仅供参考，只用于本人练习复盘。')
  await expect(reportNote).toContainText('也不会发送给任何企业。')
  await expect(page.getByText('模拟练习结果，仅供练习参考，不代表任何用人单位的评价或录用意见。')).toBeVisible()
  await expect(page.getByRole('heading', { name: '和目标岗位要求的对照' })).toBeVisible()
  await expect(page.getByText('前端开发工程师 · 互联网/科技 · HR 面试')).toHaveCount(1)
  await page.getByRole('button', { name: '预测题、STAR、清单、摘录' }).click()
  await expect(page.getByRole('heading', { name: '高频问题预测' })).toBeVisible()
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await expect(page.getByRole('heading', { name: '和目标岗位要求的对照' })).toBeVisible()
  await expect(page).toHaveURL(/\/interview\?stage=report/)
  await expect(page.getByText('岗位匹配度参考')).toHaveCount(0)
  await expect(page.getByText('HR 初筛')).toHaveCount(0)
  await expect(page.getByText('基础达标')).toHaveCount(0)
  await expect(page.getByText('练习表现等级')).toHaveCount(0)
  await assertNoHorizontalOverflow(page)
  expect(runtimeErrors).toEqual([])
})

const INTERVIEW_ID = 'interview-w3-public-fixture'
const INTERVIEW_ANSWER = '我做过一个可访问性改造项目。'

function armInterviewSession(api: ApiRouter): void {
  terminalBaseline(api)
  api.respond('POST', '/api/v1/mock-interviews', { status: 200, json: interviewCreated })
  api.respond('POST', `/api/v1/mock-interviews/${INTERVIEW_ID}/start`, { status: 200, json: interviewStarted })
}

async function beginTextInterview(page: Page): Promise<void> {
  await page.goto('/interview/setup')
  await page.getByRole('button', { name: '选择行业 (20)' }).click()
  const dialog = page.getByRole('dialog', { name: '选择面试行业' })
  await dialog.getByRole('button', { name: '制造业', exact: true }).click()
  await dialog.getByRole('button', { name: '完成' }).click()
  await chooseInterviewExperience(page)
  await page.getByPlaceholder(/输入目标岗位/).fill('前端开发工程师')
  await advanceInterviewSetupToStart(page)
  await page.getByRole('button', { name: '创建并开始练习' }).click()
  await page.waitForURL(/\/interview\?stage=session/)
}

test('interview answer outage drops the unsent turn and restores the draft @w3-kiosk', async ({ page, api }) => {
  armInterviewSession(api)
  api.respond('POST', `/api/v1/mock-interviews/${INTERVIEW_ID}/answer`, {
    status: 503,
    json: { success: false, error: { code: 'AI_PAUSED', message: 'AI 服务暂停中' } },
  })
  await beginTextInterview(page)
  await page.getByRole('textbox', { name: '本题回答' }).fill(INTERVIEW_ANSWER)
  await page.getByRole('button', { name: '提交回答', exact: true }).click()
  const alert = page.locator('.interview-session__error')
  await expect(alert).toContainText('你刚才的回答还在输入框里')
  await expect(alert).toContainText('AI 现在停用')
  await expect(page.locator('.interview-session__history')).not.toContainText(INTERVIEW_ANSWER)
  await expect(page.getByRole('textbox', { name: '本题回答' })).toHaveValue(INTERVIEW_ANSWER)
  // 作答故障同步到顶栏；本场还没有已保存的回答，出口是「看面试要点 / 离开」，不写「稍后再试生成报告」。
  await expect(page.locator('.qxt-status')).toHaveText('AI 暂时不能出题')
  const recovery = page.getByTestId('interview-finish-recovery')
  await expect(recovery.getByRole('button', { name: '看面试要点', exact: true })).toBeVisible()
  await expect(recovery.getByRole('button', { name: '离开', exact: true })).toBeVisible()
  await expect(recovery.getByRole('button', { name: '稍后再试生成报告', exact: true })).toHaveCount(0)
  // AI_PAUSED 是服务端 AI 闸门，小青这次也用不了：底栏问小青换停用态，位置不动，文字作答照常。
  await expect(page.locator('[data-qxt-ask="off"]')).toHaveText('小青暂时不可用，可继续作答')
  await expect(page.getByRole('button', { name: '提交回答', exact: true })).toBeEnabled()
})

test('interview answer outage after a saved answer offers the report retry, and only a gate-class outage disables 小青 @w3-kiosk', async ({ page, api }) => {
  armInterviewSession(api)
  // 第一次成功（记下一条回答），第二次起模型没配：能力级故障，但不是服务端 AI 闸门。
  api.respondWith('POST', `/api/v1/mock-interviews/${INTERVIEW_ID}/answer`, (n) => (n === 1
    ? { status: 200, json: interviewAnswered }
    : { status: 503, json: { success: false, error: { code: 'AI_NOT_CONFIGURED', message: 'x' } } }))
  await beginTextInterview(page)
  await page.getByRole('textbox', { name: '本题回答' }).fill(INTERVIEW_ANSWER)
  await page.getByRole('button', { name: '提交回答', exact: true }).click()
  await expect(page.locator('.interview-session__history')).toContainText(INTERVIEW_ANSWER)
  await page.getByRole('textbox', { name: '本题回答' }).fill('第二次回答')
  await page.getByRole('button', { name: '提交回答', exact: true }).click()
  await expect(page.locator('.qxt-status')).toHaveText('AI 暂时不能出题')
  // 有已保存的回答：出口是「看面试要点 / 稍后再试生成报告」，不再出现「离开」。
  const recovery = page.getByTestId('interview-finish-recovery')
  await expect(recovery.getByRole('button', { name: '看面试要点', exact: true })).toBeVisible()
  await expect(recovery.getByRole('button', { name: '稍后再试生成报告', exact: true })).toBeVisible()
  await expect(recovery.getByRole('button', { name: '离开', exact: true })).toHaveCount(0)
  // 只是「这一项没配」，不是服务端 AI 闸门：不拿它去判小青，问小青照常可点。
  await expect(page.getByRole('button', { name: '问小青：这一题怎么答' })).toBeEnabled()
  await expect(page.locator('[data-qxt-ask="off"]')).toHaveCount(0)
})

test('interview 最近对话 lists only the user own last two answers, with the draft empty line before the first @w3-kiosk', async ({ page, api }) => {
  armInterviewSession(api)
  const questions = ['请说明一次解决困难的真实经历。', '你怎么保证开学周高峰时登记不漏项？', '最后，你有什么想问我们的吗？']
  api.respondWith('POST', `/api/v1/mock-interviews/${INTERVIEW_ID}/answer`, (n) => ({
    status: 200,
    json: { data: { done: false, question: questions[Math.min(n - 1, questions.length - 1)], qType: 'experience', questionIndex: n + 1, questionTarget: 5 } },
  }))
  await beginTextInterview(page)
  const history = page.locator('.interview-session__history')
  await expect(history).toContainText('这场还没有记下的对话')
  for (const [n, answer] of ['第一次回答', '第二次回答', '第三次回答'].entries()) {
    await page.getByRole('textbox', { name: '本题回答' }).fill(answer)
    await page.getByRole('button', { name: '提交回答', exact: true }).click()
    await expect(page.locator('.interview-session__question-text')).toContainText(questions[n]!)
  }
  // 稿 slice(-2)：只留本人最近两次回答；第一次回答、面试官的题都不在这块里（题在题目卡）。
  await expect(history).toContainText('第三次回答')
  await expect(history).toContainText('第二次回答')
  await expect(history).not.toContainText('第一次回答')
  await expect(history).not.toContainText(questions[2]!)
  await expect(history).not.toContainText('这场还没有记下的对话')
  await expect(history.locator(':scope > span')).toHaveCount(3)
})

test('ending an interview with no saved answers does not say retry @w3-kiosk', async ({ page, api }) => {
  armInterviewSession(api)
  api.respond('POST', `/api/v1/mock-interviews/${INTERVIEW_ID}/end`, {
    status: 400,
    json: { success: false, error: { code: 'INTERVIEW_NO_ANSWERS', message: 'no answers' } },
  })
  await beginTextInterview(page)
  await page.getByRole('button', { name: '结束本场练习', exact: true }).click()
  const alert = page.locator('.interview-session__error')
  await expect(alert).toContainText('还没有记下的回答')
  await expect(alert).not.toContainText('重试')
  await expect(alert).not.toContainText('已保存')
  const recovery = page.getByTestId('interview-finish-recovery')
  await expect(recovery).not.toContainText('重试')
  await expect(recovery.getByRole('button', { name: '继续答题', exact: true })).toBeVisible()
  await recovery.getByRole('button', { name: '离开', exact: true }).click()
  await page.waitForURL(/\/interview-service\/?$/)
})

test('ending an interview during an AI outage keeps the saved answers and offers a non-AI exit @w3-kiosk', async ({ page, api }) => {
  armInterviewSession(api)
  // 「看面试要点」进的面试服务页会查一次服务健康状态。
  api.respond('GET', '/api/v1/health', { status: 200, json: { success: true, data: { status: 'ok' } } })
  api.respond('POST', `/api/v1/mock-interviews/${INTERVIEW_ID}/answer`, { status: 200, json: interviewAnswered })
  api.respond('POST', `/api/v1/mock-interviews/${INTERVIEW_ID}/end`, {
    status: 503,
    json: { success: false, error: { code: 'AI_PAUSED', message: 'AI 服务暂停中' } },
  })
  await beginTextInterview(page)
  await page.getByRole('textbox', { name: '本题回答' }).fill(INTERVIEW_ANSWER)
  await page.getByRole('button', { name: '提交回答', exact: true }).click()
  // 下一题进题目卡；「最近对话」只列本人记下的回答（稿 slice(-2)），不再重复面试官的题。
  await expect(page.locator('.interview-session__question-text')).toContainText('请说明一次解决困难的真实经历。')
  await expect(page.locator('.interview-session__history')).toContainText(INTERVIEW_ANSWER)
  await page.getByRole('button', { name: '结束本场练习', exact: true }).click()
  const alert = page.locator('.interview-session__error')
  await expect(alert).toContainText('你的回答已保存')
  // 出报告的故障同步到顶栏；AI_PAUSED 是服务端 AI 闸门，小青这次也用不了。
  await expect(page.locator('.qxt-status')).toHaveText('AI 暂时不能出题')
  await expect(page.locator('[data-qxt-ask="off"]')).toHaveText('小青暂时不可用，可继续作答')
  const recovery = page.getByTestId('interview-finish-recovery')
  await recovery.getByRole('button', { name: '稍后再试生成报告', exact: true }).click()
  await expect.poll(() => api.requestCount('POST', `/api/v1/mock-interviews/${INTERVIEW_ID}/end`)).toBe(2)
  await expect(page).toHaveURL(/\/interview\?stage=session/)
  await expect(alert).toContainText('你的回答已保存')
  await recovery.getByRole('button', { name: '看面试要点', exact: true }).click()
  await expect(page.locator('[data-kiosk-screen="interview-tips"]')).toBeVisible()
  await expect(page).toHaveURL(/stage=tips/)
})

test('ending an interview during an AI outage does not claim answers were saved when none succeeded @w3-kiosk', async ({ page, api }) => {
  armInterviewSession(api)
  // 「离开」回到的面试服务台会查一次服务健康状态。
  api.respond('GET', '/api/v1/health', { status: 200, json: { success: true, data: { status: 'ok' } } })
  api.respond('POST', `/api/v1/mock-interviews/${INTERVIEW_ID}/end`, {
    status: 503,
    json: { success: false, error: { code: 'AI_PAUSED', message: 'AI 服务暂停中' } },
  })
  await beginTextInterview(page)
  await page.getByRole('button', { name: '结束本场练习', exact: true }).click()
  await expect(page.locator('.interview-session__error')).toContainText('AI 暂时用不了，报告现在生成不了')
  await expect(page.getByText('你的回答已保存')).toHaveCount(0)
  const recovery = page.getByTestId('interview-finish-recovery')
  await expect(recovery.getByRole('button', { name: '看面试要点', exact: true })).toBeVisible()
  // 没有已保存的回答就没有报告可以「稍后再试」：出口是离开，不写重试。
  await expect(recovery.getByRole('button', { name: '稍后再试生成报告', exact: true })).toHaveCount(0)
  await expect(page.locator('.qxt-status')).toHaveText('AI 暂时不能出题')
  await recovery.getByRole('button', { name: '离开', exact: true }).click()
  await page.waitForURL(/\/interview-service\/?$/)
})

/** 触屏练面试页里真正在滚的容器：整页只能有这一个。 */
const INTERVIEW_SCROLLERS = '.interview-flow__scroll, .interview-session__content, .qxt-ivhub'

/** 页内可见的滚动容器（内容超出一屏的才算）。 */
async function interviewScrollContainers(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = []
    for (const el of document.querySelectorAll('.qxt-screen *')) {
      const cs = getComputedStyle(el)
      if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 1) out.push(el.className.toString())
    }
    return out
  })
}

/** 每张说明卡、维度行、宽按钮都装得下自己的字：scrollHeight 不大于 clientHeight（被压扁的卡会大于）。 */
async function expectInterviewCardsWhole(page: Page): Promise<void> {
  const squeezed = await page.evaluate(() => [...document.querySelectorAll('.qxt-iv-note, .qxt-iv-ab, .qxt-iv-wide, .qxt-iv-banner, .qxt-iv-cells > div')]
    .filter((el) => el.scrollHeight > el.clientHeight + 1)
    .map((el) => `${el.className} ${el.scrollHeight}>${el.clientHeight} ${(el.textContent ?? '').slice(0, 16)}`))
  expect(squeezed, '说明卡里的字被压出盒子').toEqual([])
}

/** 这一行字在滚动容器的可见范围里，而且中点没有被别的元素盖住（不在底栏、提示条后面）。 */
async function expectVisibleInInterviewScroller(page: Page, text: string): Promise<void> {
  const target = page.getByText(text, { exact: false }).last()
  await target.scrollIntoViewIfNeeded()
  const probe = await target.evaluate((el, selector) => {
    const scroller = el.closest(selector) as HTMLElement | null
    const box = el.getBoundingClientRect()
    const area = scroller?.getBoundingClientRect()
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
    return {
      inside: Boolean(area && box.top >= area.top - 1 && box.bottom <= area.bottom + 1),
      covered: !(hit && (el === hit || el.contains(hit) || hit.contains(el))),
    }
  }, INTERVIEW_SCROLLERS)
  expect(probe, `「${text}」应在可见范围内且没被盖住`).toEqual({ inside: true, covered: false })
}

test('interview report with many items keeps every card whole and reachable, 更多 opens at its first question @w3-kiosk', async ({ page, api }) => {
  armInterviewSession(api)
  api.respond('POST', `/api/v1/mock-interviews/${INTERVIEW_ID}/answer`, { status: 200, json: interviewAnswered })
  api.respond('POST', `/api/v1/mock-interviews/${INTERVIEW_ID}/end`, { status: 200, json: interviewReportRich })
  api.respond('GET', `/api/v1/mock-interviews/${INTERVIEW_ID}/report`, { status: 200, json: interviewReportRich })
  await beginTextInterview(page)
  await page.getByRole('textbox', { name: '本题回答' }).fill(INTERVIEW_ANSWER)
  await page.getByRole('button', { name: '提交回答', exact: true }).click()
  await page.getByRole('button', { name: '结束本场练习', exact: true }).click()
  await page.waitForURL(/\/interview\?stage=report/)

  // 主视图：条目多，超出一屏。只有一个滚动容器，提示出现，每张卡都完整。
  await expect(page.getByRole('heading', { name: '风险点与改进建议' })).toBeVisible()
  await expectInterviewCardsWhole(page)
  expect(await interviewScrollContainers(page)).toHaveLength(1)
  await expect(page.locator('.iv-scrollcue')).toBeVisible()
  // 滑到底：最后一句看得见，提示收起；风险点卡里三条都在。
  await page.locator('.interview-flow__scroll').evaluate((el) => el.scrollTo(0, el.scrollHeight))
  await expect(page.locator('.iv-scrollcue')).toBeHidden()
  await expectVisibleInInterviewScroller(page, '失败时仍停在报告页并写明原因')
  await expectVisibleInInterviewScroller(page, '回答时间偏长，超过一分钟')

  // 从底部点进「更多」：第一屏就是「高频问题预测」和第一道题，不停在中间。
  await page.getByRole('button', { name: '预测题、STAR、清单、摘录' }).click()
  await expect(page.getByRole('heading', { name: '高频问题预测' })).toBeFocused()
  expect(await page.locator('.interview-flow__scroll').evaluate((el) => el.scrollTop)).toBe(0)
  await expectVisibleInInterviewScroller(page, '1. 你的具体贡献是什么？')
  // 四张卡的每一条都完整：第五道题、清单第八条、跳过的摘录与第三条摘录、STAR 的 R 与提醒。
  await expectInterviewCardsWhole(page)
  for (const text of ['3. 为什么想做这个岗位？', '5. 遇到来访人员不配合怎么办？', '想好薪资期待的区间', '回答：（跳过）', '3. 你为什么想做这个岗位？', 'R 结果：', '数字和成果不用编造。']) {
    await expectVisibleInInterviewScroller(page, text)
  }

  // 返回仍回主视图，不是离开报告。
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await expect(page.getByRole('heading', { name: '风险点与改进建议' })).toBeVisible()
  await expect(page).toHaveURL(/\/interview\?stage=report/)
})

test('interview pages that overflow show the swipe cue, and it goes away at the end @w3-kiosk', async ({ page, api }) => {
  armInterviewSession(api)
  api.respond('POST', `/api/v1/mock-interviews/${INTERVIEW_ID}/answer`, { status: 200, json: interviewAnswered })
  await beginTextInterview(page)
  // 麦克风探测落定后，语音原因卡常显；再答完一题，最近对话多出一条本人回答。作答页比一屏高一截（不靠刚好卡线）。
  // 整页只有 .interview-session__content 一个滚动容器。
  await expect(page.locator('[data-mic-reason]')).toBeVisible()
  await page.getByRole('textbox', { name: '本题回答' }).fill(INTERVIEW_ANSWER)
  await page.getByRole('button', { name: '提交回答', exact: true }).click()
  // 下一题进题目卡；「最近对话」只列本人记下的回答（稿 slice(-2)），不再重复面试官的题。
  await expect(page.locator('.interview-session__question-text')).toContainText('请说明一次解决困难的真实经历。')
  await expect(page.locator('.interview-session__history')).toContainText(INTERVIEW_ANSWER)
  expect(await interviewScrollContainers(page)).toEqual(['interview-session__content'])
  const overflow = await page.locator('.interview-session__content').evaluate((el) => el.scrollHeight - el.clientHeight)
  expect(overflow, '作答页要明显超出一屏，滑动提示才有判据').toBeGreaterThan(60)
  const cue = page.locator('.iv-scrollcue')
  await expect(cue).toBeVisible()
  await page.locator('.interview-session__content').evaluate((el) => el.scrollTo(0, el.scrollHeight))
  await expect(cue).toBeHidden()
  // 回到顶又出现：提示盯的是真正在滚的那一层，不是外面一层。
  await page.locator('.interview-session__content').evaluate((el) => el.scrollTo(0, 0))
  await expect(cue).toBeVisible()
})

test('interview setup industry picker keeps readable text, 64px taps and a visible chosen state @w3-kiosk', async ({ page, api }) => {
  terminalBaseline(api)
  await page.goto('/interview/setup')
  await page.getByRole('button', { name: '选择行业 (20)' }).click()
  const dialog = page.getByRole('dialog', { name: '选择面试行业' })
  const picked = dialog.getByRole('button', { name: '制造业', exact: true })
  const idle = dialog.getByRole('button', { name: '采矿业', exact: true })
  await picked.click()
  // 选中态要看得出来：选中的是深底，没选的是卡片底，没选的也有边。
  await expect(picked).toHaveAttribute('aria-pressed', 'true')
  const look = (button: typeof picked) => button.evaluate((el) => {
    const style = getComputedStyle(el)
    return { background: style.backgroundColor, border: style.borderTopWidth }
  })
  const chosenLook = await look(picked)
  const idleLook = await look(idle)
  expect(chosenLook.background, '选中的行业要有和其他选项不同的底色').not.toBe(idleLook.background)
  expect(idleLook.border, '没选的行业也要看得出是个按钮').not.toBe('0px')
  // 字不小于 20px，可点的不小于 64×64（只量看得见的文字和按钮）。
  const found = await dialog.evaluate((root) => {
    const smallText: string[] = []
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) {
      const node = walker.currentNode as Text
      const label = (node.textContent ?? '').trim()
      const host = node.parentElement
      if (!label || !host) continue
      const box = host.getBoundingClientRect()
      if (box.width < 2 || box.height < 2) continue
      const size = parseFloat(getComputedStyle(host).fontSize)
      if (size < 20) smallText.push(`${size}px ${label.slice(0, 16)}`)
    }
    const smallTaps = [...root.querySelectorAll('button')]
      .map((button) => ({ label: (button.textContent ?? '').trim().slice(0, 12), box: button.getBoundingClientRect() }))
      .filter(({ box }) => box.width < 63.5 || box.height < 63.5)
      .map(({ label, box }) => `${label || '关闭'} ${Math.round(box.width)}×${Math.round(box.height)}`)
    return { smallText, smallTaps }
  })
  expect(found.smallText, '行业弹窗里的字不小于 20px').toEqual([])
  expect(found.smallTaps, '行业弹窗里的按钮不小于 64×64').toEqual([])
})

test('interview setup failure stays inside the first screen @w3-kiosk', async ({ page, api }) => {
  terminalBaseline(api)
  api.respond('POST', '/api/v1/mock-interviews', {
    status: 503,
    json: { success: false, error: { code: 'AI_PAUSED', message: 'AI 服务暂停中' } },
  })
  await page.goto('/interview/setup')
  await page.getByRole('button', { name: '选择行业 (20)' }).click()
  const dialog = page.getByRole('dialog', { name: '选择面试行业' })
  await dialog.getByRole('button', { name: '制造业', exact: true }).click()
  await dialog.getByRole('button', { name: '完成' }).click()
  await chooseInterviewExperience(page)
  await page.getByPlaceholder(/输入目标岗位/).fill('前端开发工程师')
  await advanceInterviewSetupToStart(page)
  await page.getByRole('button', { name: '创建并开始练习' }).click()
  const alert = page.locator('[data-testid="interview-setup-error"]')
  await expect(alert).toBeVisible()
  await expect(alert).toBeInViewport()
  await expect(alert).toContainText('AI 服务暂停中')
  // AI_PAUSED 是服务端 AI 闸门：小青这次也用不了，底栏问小青换停用态，设置仍可继续手动改。
  await expect(page.locator('[data-qxt-ask="off"]')).toHaveText('小青暂时不可用，可继续手动设置')
})

// ── 练面试设置页 / 作答页按各 AI 能力的配置状态放行（GET /kiosk/ai/capabilities） ──
// 读不到按没确认处理，不当成可用；服务端给的内部原因（管理员关闭）不上屏。

const CAPABILITY_OFF = { status: 'off', reason: '管理员已关闭该能力' } as const
const CAPABILITIES_UNREADABLE = { status: 503, json: { success: false, error: { code: 'CAPABILITIES_UNAVAILABLE', message: 'x' } } }

async function fillInterviewSetupToStep3(page: Page): Promise<void> {
  await page.goto('/interview/setup')
  await page.getByRole('button', { name: '选择行业 (20)' }).click()
  const dialog = page.getByRole('dialog', { name: '选择面试行业' })
  await dialog.getByRole('button', { name: '制造业', exact: true }).click()
  await dialog.getByRole('button', { name: '完成' }).click()
  await chooseInterviewExperience(page)
  await page.getByPlaceholder(/输入目标岗位/).fill('前端开发工程师')
  await advanceInterviewSetupToStart(page)
}

test('interview setup: mock_interview off keeps creation shut, says why, and sends no create request @w3-kiosk', async ({ page, api }) => {
  armInterviewSession(api)
  api.respond('GET', KIOSK_AI_CAPABILITIES_PATH, { status: 200, json: kioskAiCapabilitiesResponse({ mock_interview: CAPABILITY_OFF }) })
  await fillInterviewSetupToStep3(page)
  const primary = page.getByTestId('interview-primary')
  await expect(primary).toBeDisabled()
  await expect(page.locator('.qxt-status')).toHaveText('AI 暂时不能出题')
  const note = page.locator('.qxt-iv-note', { hasText: '暂时不能开始 AI 面试' })
  await expect(note).toContainText('AI能力当前不可用')
  await expect(page.getByText('管理员已关闭')).toHaveCount(0)
  // 出口：页内不依赖 AI 的面试技巧。问小青没关（assistant_chat 可用），照常可点。
  await expect(page.getByRole('button', { name: /先看面试技巧/ })).toBeVisible()
  await expect(page.locator('[data-qxt-ask="on"]')).toHaveText('问小青：这场练习怎么设')
  await primary.dispatchEvent('click')
  expect(api.requestCount('POST', '/api/v1/mock-interviews')).toBe(0)
})

test('interview setup: the not-ready note shows from step 1, so nobody fills three steps before finding out @w3-kiosk', async ({ page, api }) => {
  armInterviewSession(api)
  api.respond('GET', KIOSK_AI_CAPABILITIES_PATH, { status: 200, json: kioskAiCapabilitiesResponse({ mock_interview: CAPABILITY_OFF }) })
  await page.goto('/interview/setup')
  const note = page.locator('.qxt-iv-note', { hasText: '暂时不能开始 AI 面试' })
  await expect(note).toBeVisible()
  await expect(note).toContainText('AI能力当前不可用')
  await expect(page.locator('.qxt-status')).toHaveText('AI 暂时不能出题')
  // 第 1 步照常能填、能往下走（手填不依赖 AI）；只是创建在第 3 步不放行。
  await page.getByPlaceholder(/输入目标岗位/).fill('前端开发工程师')
  await expect(page.getByRole('button', { name: '下一步', exact: true })).toBeEnabled()
})

test('interview setup: unreadable capabilities count as unconfirmed, not available, for creation and 小青 @w3-kiosk', async ({ page, api }) => {
  armInterviewSession(api)
  api.respond('GET', KIOSK_AI_CAPABILITIES_PATH, CAPABILITIES_UNREADABLE)
  await fillInterviewSetupToStep3(page)
  await expect(page.getByTestId('interview-primary')).toBeDisabled()
  await expect(page.locator('.qxt-status')).toHaveText('AI 状态未确认')
  await expect(page.locator('.qxt-iv-note', { hasText: '暂时不能开始 AI 面试' })).toContainText('暂时无法确认AI能力状态')
  await expect(page.locator('[data-qxt-ask="off"]')).toHaveText('小青状态未确认，可继续手动设置')
  expect(api.requestCount('POST', '/api/v1/mock-interviews')).toBe(0)
})

test('interview setup: positive control, available capabilities let the same button create @w3-kiosk', async ({ page, api }) => {
  armInterviewSession(api)
  await fillInterviewSetupToStep3(page)
  const primary = page.getByTestId('interview-primary')
  await expect(primary).toBeEnabled()
  await expect(page.locator('.qxt-status')).toHaveText('AI 模拟面试')
  await primary.click()
  await page.waitForURL(/\/interview\?stage=session/)
  expect(api.requestCount('POST', '/api/v1/mock-interviews')).toBe(1)
})

test('interview setup: while creating, the task region is data-aitask=running with the preparing copy @w3-kiosk', async ({ page, api }) => {
  armInterviewSession(api)
  api.respondWith('POST', '/api/v1/mock-interviews', async () => {
    await new Promise((resolve) => setTimeout(resolve, 30_000))
    return { status: 200, json: interviewCreated }
  })
  await fillInterviewSetupToStep3(page)
  await page.getByTestId('interview-primary').click()
  const region = page.locator('section.kiosk-ai-task')
  await expect(region).toHaveAttribute('data-aitask', 'running')
  await expect(region).toContainText('正在为你准备面试官…')
  await expect(page.getByTestId('interview-primary')).toBeDisabled()
})

test('interview setup: a non-outage start failure says only what happened, never that the AI service is fine @w3-kiosk', async ({ page, api }) => {
  armInterviewSession(api)
  // 建会话成功、出第一题时上游这一次没成（不是能力级故障）。
  api.respond('POST', `/api/v1/mock-interviews/${INTERVIEW_ID}/start`, {
    status: 502,
    json: { success: false, error: { code: 'AI_PROVIDER_ERROR', message: 'x' } },
  })
  await fillInterviewSetupToStep3(page)
  await page.getByTestId('interview-primary').click()
  const region = page.locator('section.kiosk-ai-task')
  await expect(region).toHaveAttribute('data-aitask', 'failed')
  await expect(region).toContainText('本次没有进入面试间')
  await expect(page.getByText('本身是通的')).toHaveCount(0)
  await expect(page.getByText('服务本身')).toHaveCount(0)
  // 不是能力级故障：创建键仍可再点，问小青也不受影响。
  await expect(page.getByTestId('interview-primary')).toBeEnabled()
  await expect(page.locator('[data-qxt-ask="on"]')).toBeVisible()
})

test('interview session: mock_interview off or unreadable shows on the top bar, 小青 off follows its own capability @w3-kiosk', async ({ page, api }) => {
  armInterviewSession(api)
  let reads = 0
  // 设置页读到的都可用；进入作答页那一次：模拟面试关闭、小青关闭。
  api.respondWith('GET', KIOSK_AI_CAPABILITIES_PATH, () => {
    reads += 1
    return { status: 200, json: kioskAiCapabilitiesResponse(reads >= 2 ? { mock_interview: CAPABILITY_OFF, assistant_chat: CAPABILITY_OFF } : {}) }
  })
  await beginTextInterview(page)
  await expect(page.locator('.qxt-status')).toHaveText('AI 暂时不能出题')
  await expect(page.locator('[data-qxt-ask="off"]')).toHaveText('小青暂时不可用，可继续作答')
  // 已建好的这一场照常能作答：提交键不被停用。
  await page.getByRole('textbox', { name: '本题回答' }).fill(INTERVIEW_ANSWER)
  await expect(page.getByRole('button', { name: '提交回答', exact: true })).toBeEnabled()
})

test('interview session: unreadable capabilities show unconfirmed on the top bar and the 小青 dock @w3-kiosk', async ({ page, api }) => {
  armInterviewSession(api)
  let reads = 0
  api.respondWith('GET', KIOSK_AI_CAPABILITIES_PATH, () => {
    reads += 1
    return reads >= 2 ? CAPABILITIES_UNREADABLE : { status: 200, json: kioskAiCapabilitiesResponse() }
  })
  await beginTextInterview(page)
  await expect(page.locator('.qxt-status')).toHaveText('AI 状态未确认')
  await expect(page.locator('[data-qxt-ask="off"]')).toHaveText('小青状态未确认，可继续作答')
  await expect(page.getByRole('button', { name: '提交回答', exact: true })).toBeVisible()
})

test('interview session: capabilities still loading do not flash the top bar or the 小青 dock; unreadable ones do show up @w3-kiosk', async ({ page, api }) => {
  armInterviewSession(api)
  let reads = 0
  // 设置页读得到；进入作答页这一次一直不回（读取中），4 秒后 hook 自己按「没确认」处理。
  api.respondWith('GET', KIOSK_AI_CAPABILITIES_PATH, async () => {
    reads += 1
    if (reads < 2) return { status: 200, json: kioskAiCapabilitiesResponse() }
    await new Promise((resolve) => setTimeout(resolve, 30_000))
    return { status: 200, json: kioskAiCapabilitiesResponse() }
  })
  await beginTextInterview(page)
  // 会话刚建好、正在作答：还没读回来时不闪「确认中」，作答不受影响。
  await expect(page.locator('.qxt-status')).toHaveText('AI 模拟面试')
  await expect(page.locator('[data-qxt-ask="on"]')).toHaveText('问小青：这一题怎么答')
  // 读不回来才写没确认。
  await expect(page.locator('.qxt-status')).toHaveText('AI 状态未确认', { timeout: 8_000 })
  await expect(page.locator('[data-qxt-ask="off"]')).toHaveText('小青状态未确认，可继续作答')
})

test('interview session: a gate-class outage turns 小青 off, and the next successful answer turns it back on @w3-kiosk', async ({ page, api }) => {
  armInterviewSession(api)
  api.respondWith('POST', `/api/v1/mock-interviews/${INTERVIEW_ID}/answer`, (n) => (n === 1
    ? { status: 503, json: { success: false, error: { code: 'AI_PAUSED', message: 'AI 服务暂停中' } } }
    : { status: 200, json: interviewAnswered }))
  await beginTextInterview(page)
  await page.getByRole('textbox', { name: '本题回答' }).fill(INTERVIEW_ANSWER)
  await page.getByRole('button', { name: '提交回答', exact: true }).click()
  await expect(page.locator('[data-qxt-ask="off"]')).toHaveText('小青暂时不可用，可继续作答')
  await expect(page.locator('.qxt-status')).toHaveText('AI 暂时不能出题')
  // 输入框里还留着刚才的回答；再提交一次成功：顶栏与小青都恢复。
  await expect(page.getByRole('textbox', { name: '本题回答' })).toHaveValue(INTERVIEW_ANSWER)
  await page.getByRole('button', { name: '提交回答', exact: true }).click()
  await expect(page.locator('.interview-session__history')).toContainText(INTERVIEW_ANSWER)
  await expect(page.locator('.qxt-status')).toHaveText('AI 模拟面试')
  await expect(page.locator('[data-qxt-ask="on"]')).toHaveText('问小青：这一题怎么答')
  await expect(page.locator('[data-qxt-ask="off"]')).toHaveCount(0)
})

test('interview session: while analysing the answer, the task region is data-aitask=running and the copy is kept @w3-kiosk', async ({ page, api }) => {
  armInterviewSession(api)
  api.respondWith('POST', `/api/v1/mock-interviews/${INTERVIEW_ID}/answer`, async () => {
    await new Promise((resolve) => setTimeout(resolve, 30_000))
    return { status: 200, json: interviewAnswered }
  })
  await beginTextInterview(page)
  await page.getByRole('textbox', { name: '本题回答' }).fill(INTERVIEW_ANSWER)
  await page.getByRole('button', { name: '提交回答', exact: true }).click()
  const region = page.locator('section.kiosk-ai-task')
  await expect(region).toHaveAttribute('data-aitask', 'running')
  await expect(region).toContainText('面试官正在分析你的回答…')
  await expect(page.getByRole('button', { name: '正在分析你的回答…' })).toBeDisabled()
})

const COVERED_EVIDENCE ='我做过两年社群运营，最多同时管 6 个群'

function advisorCompareSession() {
  return {
    sessionId: 'w3-art-sess',
    expiresAt: '2099-01-01T00:00:00.000Z',
    artifacts: [{
      artifactId: 'w3-art-1',
      kind: 'compare_report',
      status: 'completed',
      payload: {
        kind: 'compare_report',
        summary: '逐条比对',
        extras: [{ point: '有基础的平面设计能力', note: '岗位没提，面试时可以主动说' }],
        items: [
          { requirement: '两年以上社群或用户运营经验', verdict: 'covered', evidence: COVERED_EVIDENCE },
          { requirement: '本科及以上学历', verdict: 'not_a_capability', evidence: '这是硬性条件，不是能写进材料的能力，本机不做判定。' },
        ],
      },
      provider: 'llm:deepseek',
      printedFileId: null,
      createdAt: '2026-09-07T00:00:00.000Z',
      updatedAt: '2026-09-07T00:00:00.000Z',
      expiresAt: '2099-01-01T00:00:00.000Z',
    }],
  }
}

const PROTO_STATES = [
  'no-artifact',
  'qa-pins',
  'slot-draft',
  'slot-draft-blanks',
  'compare-report',
  'compare-all-covered',
  'print-unavailable',
  'expired',
] as const

test('advisor artifact eight proto states fit the kiosk stage @w3-kiosk', async ({ page, api }) => {
  const runtimeErrors: string[] = []
  page.on('pageerror', (error) => runtimeErrors.push(error.message))
  terminalBaseline(api)
  for (const state of PROTO_STATES) {
    await page.goto(`/ai/plan?state=${state}&capture=1`)
    await expect(page.locator('[data-kiosk-screen="advisor-artifact"]')).toHaveAttribute('data-state', state)
    await expect(page.getByText('一键投递')).toHaveCount(0)
    await expect(page.getByText('工作人员')).toHaveCount(0)
    await expect(page.getByText('服务台')).toHaveCount(0)
    await assertNoHorizontalOverflow(page)
    await page.screenshot({ path: test.info().outputPath(`advisor-artifact-${state}.png`) })
  }
  expect(runtimeErrors).toEqual([])
})

test('advisor artifact renders covered evidence as a quotation @w3-kiosk', async ({ page, api }) => {
  const runtimeErrors: string[] = []
  page.on('pageerror', (error) => runtimeErrors.push(error.message))
  terminalBaseline(api)

  await page.goto('/ai/plan?state=compare-report&capture=1')
  await expect(page.locator('[data-kiosk-screen="advisor-artifact"]')).toHaveAttribute('data-state', 'compare-report')
  await expect(page.getByTestId('advisor-artifact-legend')).toBeVisible()
  await expect(page.getByText('E1你自己说过的原话', { exact: false })).toBeVisible()
  await expect(page.getByText('E2本机已有的数据', { exact: false })).toBeVisible()
  await expect(page.getByText('E3AI 的判断，仅供参考', { exact: false })).toBeVisible()
  const quote = page.getByTestId('advisor-artifact-quote').first()
  await expect(quote).toBeVisible()
  await expect(quote).toHaveJSProperty('tagName', 'BLOCKQUOTE')
  await expect(quote).toContainText(`「${COVERED_EVIDENCE}」`)

  await page.goto('/ai/plan?state=qa-pins&capture=1')
  await expect(page.getByTestId('advisor-artifact-qa')).toBeVisible()
  await expect(page.getByText('对话未保存')).toBeVisible()
  await expect(page.getByText('第 2 轮问答', { exact: false })).toHaveCount(0)

  await page.goto('/ai/plan?state=slot-draft-blanks&capture=1')
  await expect(page.getByTestId('advisor-artifact-slot')).toBeVisible()
  await expect(page.getByText('这段话依据的原话（打印时一并带出）')).toBeVisible()
  await expect(page.getByText('还有 2 处你没答，我留了空')).toBeVisible()

  await expect(page.getByText('一键投递')).toHaveCount(0)
  await expect(page.getByText('已打印')).toHaveCount(0)
  await assertNoHorizontalOverflow(page)
  expect(runtimeErrors).toEqual([])
})

test('advisor artifact print-unavailable state has no print button @w3-kiosk', async ({ page, api }) => {
  const runtimeErrors: string[] = []
  page.on('pageerror', (error) => runtimeErrors.push(error.message))
  terminalBaseline(api)

  await page.goto('/ai/plan?state=print-unavailable&capture=1')
  await expect(page.locator('[data-kiosk-screen="advisor-artifact"]')).toHaveAttribute('data-state', 'print-unavailable')
  await expect(page.getByTestId('advisor-artifact-print-unavailable')).toBeVisible()
  await expect(page.getByTestId('advisor-artifact-legend')).toBeVisible()
  await expect(page.getByTestId('advisor-artifact-qa')).toBeVisible()
  await expect(page.getByText('我做过两年社群运营，最多同时管 6 个群。')).toBeVisible()
  await expect(page.getByTestId('advisor-artifact-take')).toBeVisible()
  await expect(page.getByText('带走这一页')).toBeVisible()
  await expect(page.getByTestId('advisor-artifact-cta-print')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '打印带走' })).toHaveCount(0)
  await expect(page.getByText('打印能力读不到，按钮先不放出来', { exact: false })).toBeVisible()
  await expect(page.getByRole('button', { name: '再问一轮' })).toBeVisible()
  await assertTapTargetPointerHit(page.getByTestId('advisor-artifact-cta-back'))
  await page.getByTestId('advisor-artifact-cta-back').click()
  await page.waitForURL('/assistant')
  await expect(page.locator('[data-kiosk-screen="assistant"]')).toBeVisible()
  expect(runtimeErrors).toEqual([])
})

test('advisor artifact print waits for the server receipt @w3-kiosk', async ({ page, api }) => {
  const runtimeErrors: string[] = []
  page.on('pageerror', (error) => runtimeErrors.push(error.message))
  terminalBaseline(api)
  api.respond('GET', '/api/v1/advisor/sessions/w3-art-sess', {
    status: 200,
    json: advisorCompareSession(),
  })
  let printPath = ''
  api.respondWith('POST', '/api/v1/advisor/sessions/w3-art-sess/artifacts/w3-art-1/print', async () => {
    await new Promise((resolve) => { setTimeout(resolve, 250) })
    return {
      status: 200,
      json: {
        artifactId: 'w3-art-1',
        kind: 'compare_report',
        fileId: 'file-w3-art',
        filename: 'AI顾问-逐条比对表.pdf',
        sizeBytes: 2048,
        pageCount: 1,
        signedUrl: '/signed/file-w3-art',
        expiresAt: '2099-01-01T00:00:00.000Z',
        printFileUrl: '/print/file-w3-art',
      },
    }
  })
  // 进打印链之后报价确认页会读的几条（本机能力、价目、报价）。
  api.respond('GET', '/api/v1/terminals/KSK-001/capabilities', { status: 200, json: { terminalCode: 'KSK-001', capabilities: [] } })
  api.respond('GET', '/api/v1/print/price-config', { status: 200, json: { billingEnabled: true, items: [{ serviceKey: 'print_bw_page', unitCents: 100, unit: 'page', description: '黑白打印' }] } })
  api.respond('POST', '/api/v1/orders/quote', { status: 200, json: { amountCents: 100, billablePages: 1, billingPageSource: 'detected', priceLines: [{ serviceKey: 'print_bw_page', description: '黑白打印', unitCents: 100, quantity: 1, amountCents: 100 }] } })
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/artifacts/w3-art-1/print')) {
      printPath = new URL(request.url()).pathname
    }
  })

  await page.goto('/ai/plan?sessionId=w3-art-sess&artifactId=w3-art-1')
  await expect(page.getByTestId('advisor-artifact-compare')).toBeVisible()
  await expect(page.getByTestId('advisor-artifact-quote')).toContainText(`「${COVERED_EVIDENCE}」`)
  await expect(page.getByText('已打印')).toHaveCount(0)
  const printButton = page.getByTestId('advisor-artifact-cta-print')
  await expect(printButton).toBeEnabled()
  await assertTapTargetPointerHit(printButton)
  await printButton.click()
  await expect(printButton).toHaveText(/正在生成打印稿/)
  await expect(page.getByText('已打印')).toHaveCount(0)
  // 2026-09-29（P0-5，F09 / 稿 52）：打印稿生成后直接进打印链，先看价格再决定；
  // 不再写「已保存到我的文档」—— 文件归属跟顾问会话走，游客时不属于任何人。
  await page.waitForURL((url) => url.pathname === '/print/confirm')
  await expect(page.locator('.print-file-name')).toHaveText('AI顾问-逐条比对表.pdf')
  await expect(page.getByText('已保存到我的文档')).toHaveCount(0)
  expect(printPath).toBe('/api/v1/advisor/sessions/w3-art-sess/artifacts/w3-art-1/print')
  await expect(page.getByText('已打印')).toHaveCount(0)
  await assertNoHorizontalOverflow(page)
  expect(runtimeErrors).toEqual([])
})

test('advisor artifact no-artifact shows the three jobs and opens AI records @w3-kiosk', async ({ page, api }) => {
  const runtimeErrors: string[] = []
  page.on('pageerror', (error) => runtimeErrors.push(error.message))
  terminalBaseline(api)

  await page.goto('/ai/plan?state=no-artifact&capture=1')
  await expect(page.locator('[data-kiosk-screen="advisor-artifact"]')).toHaveAttribute('data-state', 'no-artifact')
  await expect(page.getByTestId('advisor-artifact-kinds')).toBeVisible()
  await expect(page.locator('.aa-kind')).toHaveCount(3)
  await expect(page.getByText('边问边钉住')).toBeVisible()
  await expect(page.getByText('她问，你答，拼成一段话')).toBeVisible()
  await expect(page.getByText('逐条比：有没有写到')).toBeVisible()
  await expect(page.getByText('做完以后怎么带走')).toBeVisible()
  await expect(page.getByTestId('advisor-artifact-cta-records')).toHaveText('打开我的 AI 记录')
  await page.getByTestId('advisor-artifact-cta-records').click()
  await page.waitForURL((url) => url.pathname === '/me/ai-records')
  expect(runtimeErrors).toEqual([])
})

test('advisor artifact expired offers only a redo @w3-kiosk', async ({ page, api }) => {
  const runtimeErrors: string[] = []
  page.on('pageerror', (error) => runtimeErrors.push(error.message))
  terminalBaseline(api)

  await page.goto('/ai/plan?state=expired&capture=1')
  await expect(page.locator('[data-kiosk-screen="advisor-artifact"]')).toHaveAttribute('data-state', 'expired')
  await expect(page.getByTestId('advisor-artifact-cta-redo')).toHaveText('回去重做一次')
  await expect(page.getByTestId('advisor-artifact-cta-back')).toHaveCount(0)
  await expect(page.getByTestId('advisor-artifact-cta-print')).toHaveCount(0)
  await expect(page.getByTestId('advisor-artifact-cta-records')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '打印带走' })).toHaveCount(0)
  await page.getByTestId('advisor-artifact-cta-redo').click()
  await page.waitForURL((url) => url.pathname === '/assistant')
  await expect(page.locator('[data-kiosk-screen="assistant"]')).toBeVisible()
  expect(runtimeErrors).toEqual([])
})

test('advisor artifact content state opens my documents @w3-kiosk', async ({ page, api }) => {
  const runtimeErrors: string[] = []
  page.on('pageerror', (error) => runtimeErrors.push(error.message))
  terminalBaseline(api)

  await page.goto('/ai/plan?state=qa-pins&capture=1')
  await expect(page.getByTestId('advisor-artifact-take')).toBeVisible()
  const documentsLink = page.getByRole('link', { name: '我的文档' })
  // 1080×1920 视口下舞台缩放是 1；换算后再比，避免别的视口把屏幕像素当成 CSS 像素。
  const scale = await readEnabledStageScale(page)
  const documentsBox = await documentsLink.boundingBox()
  expect(documentsBox, '我的文档链接必须有点击框').not.toBeNull()
  expect(documentsBox!.height / scale, '我的文档链接点击框换算到舞台 CSS px 后高度不得小于 48').toBeGreaterThanOrEqual(48)
  await documentsLink.click()
  await page.waitForURL((url) => url.pathname === '/me/documents')
  expect(runtimeErrors).toEqual([])
})

// ── 岗位匹配参考（/resume/job-fit）──────────────────────────────────────────
// 这一组只断言「页面说的话有没有依据」和「取消之后还会不会被翻盘」，不比像素。
const JOB_FIT_JOB = { id: 'j1', title: '前端开发工程师', company: '示例来源企业', sourceName: '来源平台', externalId: 'X-1' }

function jobFitBaseline(api: ApiRouter): void {
  terminalBaseline(api)
  api.respond('GET', '/api/v1/jobs', { status: 200, json: { data: [JOB_FIT_JOB], pagination: { page: 1, pageSize: 8, total: 1, totalPages: 1 } } })
  // 解析还在、只是没做过匹配 → 放行到选岗屏（AI_TASK_NOT_FOUND 是另一条路）。
  api.respond('GET', '/api/v1/resume/job-fit/t-w3', { status: 404, json: { error: { code: 'JOB_FIT_NOT_FOUND', message: '尚未匹配' } } })
}

async function submitJobFit(page: Parameters<typeof assertNoHorizontalOverflow>[0]): Promise<void> {
  await page.getByText('前端开发工程师').first().click()
  await page.getByRole('button', { name: '继续并确认授权' }).click()
}

test('job fit keeps touch targets usable on a narrow screen @w3-kiosk', async ({ page, api }) => {
  jobFitBaseline(api)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/resume/job-fit?taskId=t-w3')
  await expect(page.locator('[data-kiosk-screen="resume-job-fit"]')).toHaveAttribute('data-state', 'pick')
  // 手机上必须关掉 1080 舞台缩放，否则整张稿被缩到 0.36，按钮量出来只有 35px。
  await expect(page.locator('.jfq-root')).toHaveAttribute('data-jfq-layout', 'phone')
  await expect(page.locator('[data-kiosk-stage-fit]')).toHaveAttribute('data-kiosk-stage-fit', 'off')
  for (const target of [page.locator('.qxt-back'), page.getByRole('button', { name: '继续并确认授权' })]) {
    const box = await target.boundingBox()
    expect(box, '可点区域必须可见').not.toBeNull()
    expect(box!.width).toBeGreaterThanOrEqual(48)
    expect(box!.height).toBeGreaterThanOrEqual(48)
  }
  await assertNoHorizontalOverflow(page)
})

test('job fit cancellation is not overturned by a late result @w3-kiosk', async ({ page, api }) => {
  jobFitBaseline(api)
  let releaseAnalyze: (() => void) | null = null
  const analyzeHeld = new Promise<void>((resolve) => { releaseAnalyze = resolve })
  api.respondWith('POST', '/api/v1/resume/job-fit', async () => {
    await analyzeHeld
    return { status: 200, json: { taskId: 't-w3', status: 'completed', fitLevel: 'reference_high', summary: '迟到的结果', job: JOB_FIT_JOB, matchPoints: [], gapPoints: [], targetedSuggestions: [] } }
  })

  await page.goto('/resume/job-fit?taskId=t-w3')
  await submitJobFit(page)
  await expect(page.locator('[data-kiosk-screen="resume-job-fit"]')).toHaveAttribute('data-state', 'analyzing')
  await page.getByRole('button', { name: '返回目标选择' }).click()
  await expect(page.locator('[data-kiosk-screen="resume-job-fit"]')).toHaveAttribute('data-state', 'pick')

  releaseAnalyze!()
  // 请求没有取消端点，所以真正要守的是：晚到的返回不许把用户从选岗屏翻回结果屏。
  await expect(page.locator('[data-kiosk-screen="resume-job-fit"]')).toHaveAttribute('data-state', 'pick')
  await expect(page.getByText('迟到的结果')).toHaveCount(0)
})

test('job fit outage and failure screens claim only what is provable @w3-kiosk', async ({ page, api }) => {
  jobFitBaseline(api)
  api.respond('POST', '/api/v1/resume/job-fit', { status: 503, json: { error: { code: 'AI_NOT_CONFIGURED', message: 'AI 能力未配置' } } })
  await page.goto('/resume/job-fit?taskId=t-w3')
  await submitJobFit(page)
  await expect(page.locator('[data-kiosk-screen="resume-job-fit"]')).toHaveAttribute('data-state', 'ai-down')
  // 本页确实没有任何支付调用；但配额回滚是 best-effort，「未产生任何扣费」没有服务端证明。
  await expect(page.getByText('本页没有发起支付')).toBeVisible()
  await expect(page.getByText('未产生任何扣费')).toHaveCount(0)
  // 恢复时间没有任何依据：屏上只如实写「还不确定」，不写「稍后自动恢复」这类预告，也不写给审稿人看的「不承诺…」「本页也不写…」。
  await expect(page.getByText('还不确定什么时候能用')).toBeVisible()
  await expect(page.locator('body')).not.toContainText(/不承诺恢复时间|本页也不写|稍后自动恢复/)
  // 底栏小字是对本人说的一句实话（稿 jobfit 这一态的原句）：说清这次没能对照，不写「服务不可用时不显示任何…也不保留半截结果」这类说页面规矩的话。
  await expect(page.locator('.qxt-dock').getByText('AI 暂时不可用，这次没能对照。', { exact: true })).toBeVisible()
  await expect(page.locator('body')).not.toContainText(/服务不可用时不显示任何匹配结论|也不保留半截结果/)

  api.respond('POST', '/api/v1/resume/job-fit', { status: 500, json: { error: { code: 'SERVER_ERROR', message: '分析失败' } } })
  await page.goto('/resume/job-fit?taskId=t-w3')
  await submitJobFit(page)
  await expect(page.locator('[data-kiosk-screen="resume-job-fit"]')).toHaveAttribute('data-state', 'failed')
  // 500 证明不了简历任务还在；能证明的只是「这次返回的不是任务失效」。
  await expect(page.getByText('这次失败没有指向简历任务')).toBeVisible()
  for (const claim of ['简历任务仍然可用', '任务本身没有失效']) {
    await expect(page.getByText(claim)).toHaveCount(0)
  }
})

test('job fit completed-but-empty result says未提供 rather than尚未返回 @w3-kiosk', async ({ page, api }) => {
  terminalBaseline(api)
  api.respond('GET', '/api/v1/jobs', { status: 200, json: { data: [JOB_FIT_JOB], pagination: { page: 1, pageSize: 8, total: 1, totalPages: 1 } } })
  // completed 且各数组为空：结果已经返回了，只是这次没给出匹配点。
  api.respond('GET', '/api/v1/resume/job-fit/t-empty', { status: 200, json: { taskId: 't-empty', status: 'completed', fitLevel: 'reference_medium', summary: '', matchPoints: [], gapPoints: [], targetedSuggestions: [] } })
  await page.goto('/resume/job-fit?taskId=t-empty')
  // 3.14 起结果页不分档：夹具里旧服务端留下的 fitLevel 也不再把页面切成 result-mid。
  await expect(page.locator('[data-kiosk-screen="resume-job-fit"]')).toHaveAttribute('data-state', 'result')
  // 结果明细按稿 46 分成「已写到 / 还没体现」两栏，两栏这次都是空数组：两处都照实写「本次未提供」。
  await expect(page.getByText('本次未提供')).toHaveCount(2)
  for (const slot of await page.getByText('本次未提供').all()) await expect(slot).toBeVisible()
  await expect(page.getByText('尚未返回')).toHaveCount(0)
})

// ── 简历决策工作台其余三条 route（稿 46：actions / career-plan / templates）────────
// 夹具逐条 respond，未登记的请求照常被 ApiRouter 中止并在收尾报错（fail-closed）。
// 三个视口都要量：1080×1920 一体机舞台、390×844 手机（关缩放走流式）、1440×900 横屏电脑（1080×1920 舞台缩放）。
const DECISION_VIEWPORTS = [
  { width: 1080, height: 1920 },
  { width: 390, height: 844 },
  { width: 1440, height: 900 },
] as const
const ACTIONS_JOB = { id: 'j-act', title: '行政专员', company: '示例来源企业', sourceName: '来源平台', externalId: 'X-ACT' }
const ACTIONS_RESULT = {
  taskId: 't-act', status: 'completed', fitLevel: 'reference_medium', summary: '有可补的地方', job: ACTIONS_JOB,
  matchPoints: [],
  gapPoints: [{ gap: '缺少 Excel 数据整理经历', suggestion: '把做过的报表整理写成一条经历' }],
  targetedSuggestions: ['把「协助行政」改写成具体做过的三件事'],
}
const CAREER_PLAN_READY = {
  taskId: 't-cp', status: 'completed',
  basedOn: { resume: true, jobFit: null, interview: null },
  summary: '经历偏执行落地，适合先从运营助理起步。',
  currentSnapshot: [{ point: '有活动执行经历', evidence: '负责过校园活动报名统计' }],
  directions: [{ title: '运营助理', why: '经历贴近落地执行', firstStep: '把活动结果写成数字' }],
  skillPlan: [{ skill: '表格整理', action: '补一门表格入门课', timeframe: '30 天' }],
  actionChecklist: ['把简历结果量化'],
}
const RESUME_TEMPLATE = {
  id: 'tpl-clean', type: 'resume_template', title: '清爽通用简历模板', description: '单栏清爽版式，突出个人总结、经历与技能。',
  tags: ['简历模板', '通用'], status: 'published', recommendedFor: '现场打印前版式参考', outputFilename: 'resume.pdf', fields: [],
  resumeLayoutPreset: { style: 'clean', defaultLayout: { columns: 1 }, sectionOrder: ['header', 'summary', 'experience', 'skills'] },
}

async function captureDecisionViewports(page: Parameters<typeof assertNoHorizontalOverflow>[0], name: string): Promise<void> {
  for (const size of DECISION_VIEWPORTS) {
    await page.setViewportSize(size)
    // 固定操作条不得压住滚动区，也不得掉出视口；返回键与主操作在真实像素上 ≥48px（手机不再被舞台缩成 23px）。
    // 换视口后舞台缩放开关要等一次 resize 渲染，几何量用轮询等它落定，不用固定等待。
    await expect.poll(async () => {
      const scroll = await page.locator('.qx-scroll').boundingBox()
      const ctabar = await page.locator('.qxt-dock').boundingBox()
      if (!scroll || !ctabar) return 'missing'
      if (scroll.y + scroll.height > ctabar.y + 0.5) return `scroll overlaps ctabar ${scroll.y + scroll.height} > ${ctabar.y}`
      if (ctabar.y + ctabar.height > size.height + 0.5) return `ctabar leaves viewport ${ctabar.y + ctabar.height}`
      return 'ok'
    }, { message: `${name} ${size.width}x${size.height} 操作条与滚动区` }).toBe('ok')
    await assertNoHorizontalOverflow(page)
    // 横屏电脑改为舞台缩放后，屏上像素要除回 scale；舞台关闭（手机）时 scale 取 1，门槛仍是 48。
    const scale = await readEnabledStageScale(page)
    for (const target of [page.locator('.qxt-back'), page.locator('.qxt-dock .qx-btn').last()]) {
      const box = await target.boundingBox()
      expect(box, '可点区域必须可见').not.toBeNull()
      expect(box!.height / scale, `${name} ${size.width}x${size.height} 触控高度`).toBeGreaterThanOrEqual(48)
      expect(box!.width / scale).toBeGreaterThanOrEqual(48)
    }
    await page.screenshot({ path: test.info().outputPath(`${name}-${size.width}x${size.height}.png`) })
  }
  await page.setViewportSize({ width: 1080, height: 1920 })
}

/** 用路由 state 带任务号进页（与页面间真实跳转同一通道），不碰浏览器存储。 */
async function openWithRouteState(page: Parameters<typeof assertNoHorizontalOverflow>[0], path: string, state: Record<string, string>): Promise<void> {
  await page.goto(path)
  await page.evaluate(([target, usr]) => {
    window.history.replaceState({ usr, key: 'w3-decision', idx: 0 }, '', target)
  }, [path, state] as const)
  await page.reload()
}

// ── 求职方案页底栏生成钮（稿 career）：已知 AI 停用 → 置灰、写明原因、点了不发请求；临时性错误 → 仍可点、字是「重试…」 ──
const CAREER_AI_DOWN_WHY = 'AI 暂时不可用。可以先打印求职参考单。'
const CAREER_AI_DOWN_WHY_WITH_PLAN = 'AI 暂时不可用。这份方案还在，重新生成先停着。'
const CAREER_PLAN_PATH = '/api/v1/resume/career-plan/t-cp'

/** 底栏的生成钮：aria-disabled=true、字照稿、原因（底栏小字）可见且读屏连着；点它（含强点）不发任何请求、屏不变。 */
async function expectCareerGenerateKeyGreyed(page: Page, api: ApiRouter, label: string, why: string): Promise<void> {
  const dock = page.locator('.qxt-dock')
  const key = dock.locator('[data-career-plan-generate]')
  await expect(key).toHaveText(label)
  await expect(key).toHaveAttribute('data-career-plan-generate', 'blocked')
  await expect(key).toHaveAttribute('aria-disabled', 'true')
  await expect(dock.getByText(why, { exact: true })).toBeVisible()
  await expect(key).toHaveAccessibleDescription(why)
  // 原因是对本人说的一句话（稿原句）：不带「不承诺恢复时间」这类写给审稿人看的批注，也不预告恢复。
  await expect(page.locator('body')).not.toContainText(/不承诺恢复时间|生成求职方案先停着|稍后自动恢复/)
  await expect(dock.getByRole('button', { name: /^重试生成/ })).toHaveCount(0)
  const posts = api.requestCount('POST', CAREER_PLAN_PATH)
  // Playwright 不肯点 aria-disabled 的按钮；强点一下真实指针、再直接触发 DOM click，确保页面的点击处理真的跑过、并自己短路。
  await key.click({ force: true })
  await key.evaluate((el) => (el as HTMLElement).click())
  // 不用定时等待（本文件的门禁禁了它）：先冲两帧让点击引起的重渲染落地，再等网络静默，之后请求数还没涨才算「没发」。
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  await page.waitForLoadState('networkidle')
  expect(api.requestCount('POST', CAREER_PLAN_PATH), '已知停用时点生成钮不得发请求').toBe(posts)
  await expect(key).toHaveText(label)
  await expect(key).toHaveAttribute('aria-disabled', 'true')
}

for (const code of ['AI_PAUSED', 'AI_BUDGET_EXHAUSTED'] as const) {
  test(`career plan: a known AI stop (${code}) greys the generate key, says why, sends no request and keeps print @w3-kiosk`, async ({ page, api }) => {
    terminalBaseline(api)
    // 首屏读取就撞上能力级停用码：没有发生任何生成请求，页面直接落到 ai-down。
    api.respond('GET', CAREER_PLAN_PATH, { status: 503, json: { error: { code, message: 'fixture ai stop' } } })
    await openWithRouteState(page, '/resume/career-plan', { taskId: 't-cp' })
    const screen = page.locator('[data-kiosk-screen="resume-career-plan"]')
    await expect(screen).toHaveAttribute('data-state', 'ai-down')
    await expect(page.getByRole('button', { name: '打印求职参考单（未含 AI 规划）' })).toBeEnabled()
    await expectCareerGenerateKeyGreyed(page, api, '生成求职方案', CAREER_AI_DOWN_WHY)
    expect(api.requestCount('POST', CAREER_PLAN_PATH)).toBe(0)
  })
}

test('career plan: a known AI stop after a plan exists greys 重新生成, keeps the plan and the print key @w3-kiosk', async ({ page, api }) => {
  terminalBaseline(api)
  api.respond('GET', CAREER_PLAN_PATH, { status: 200, json: CAREER_PLAN_READY })
  api.respond('POST', CAREER_PLAN_PATH, { status: 503, json: { error: { code: 'AI_PAUSED', message: 'fixture ai paused' } } })
  await openWithRouteState(page, '/resume/career-plan', { taskId: 't-cp' })
  const screen = page.locator('[data-kiosk-screen="resume-career-plan"]')
  await expect(screen).toHaveAttribute('data-state', 'ready')
  await expect(page.locator('.qxt-dock').locator('[data-career-plan-generate]')).toHaveAttribute('data-career-plan-generate', 'open')
  await page.locator('.qxt-dock').getByRole('button', { name: '重新生成' }).click()
  await expect.poll(() => api.requestCount('POST', CAREER_PLAN_PATH)).toBe(1)
  // 方案还在、仍是 ready 屏；重新生成置灰，打印建议单照常可点。
  await expect(screen).toHaveAttribute('data-state', 'ready')
  await expect(page.locator('.rdq-direction h3')).toContainText('运营助理')
  await expectCareerGenerateKeyGreyed(page, api, '重新生成', CAREER_AI_DOWN_WHY_WITH_PLAN)
  await expect(page.locator('.qxt-dock').getByRole('button', { name: '打印建议单' })).toBeEnabled()
})

for (const temporary of [
  { name: 'network drop', register: (api: ApiRouter) => api.abort('POST', CAREER_PLAN_PATH, 'internetdisconnected') },
  { name: 'timeout (504 AI_CAREER_PLAN_TIMEOUT)', register: (api: ApiRouter) => api.respond('POST', CAREER_PLAN_PATH, { status: 504, json: { error: { code: 'AI_CAREER_PLAN_TIMEOUT', message: 'fixture timeout' } } }) },
] as const) {
  test(`career plan: a temporary error (${temporary.name}) keeps the generate key live as 重试, and the retry really sends @w3-kiosk`, async ({ page, api }) => {
    terminalBaseline(api)
    api.respond('GET', CAREER_PLAN_PATH, { status: 404, json: { error: { code: 'CAREER_PLAN_NOT_FOUND', message: '尚未生成' } } })
    temporary.register(api)
    await openWithRouteState(page, '/resume/career-plan', { taskId: 't-cp' })
    const screen = page.locator('[data-kiosk-screen="resume-career-plan"]')
    await expect(screen).toHaveAttribute('data-state', 'guide')
    const key = page.locator('.qxt-dock').locator('[data-career-plan-generate]')
    await expect(key).toHaveText('生成求职方案')
    await key.click()
    await expect.poll(() => api.requestCount('POST', CAREER_PLAN_PATH)).toBe(1)
    // 临时性错误不是「AI 停了」：不落 ai-down，生成钮不置灰，字改成重试。
    await expect(screen).toHaveAttribute('data-state', 'guide')
    await expect(page.getByRole('alert')).toBeVisible()
    await expect(key).toHaveText('重试生成求职方案')
    await expect(key).toHaveAttribute('data-career-plan-generate', 'open')
    await expect(key).not.toHaveAttribute('aria-disabled', 'true')
    await expect(page.getByText('AI 暂时不可用。', { exact: false })).toHaveCount(0)
    // 重试真的再发一次请求，这回成功就拿到方案。
    api.respond('POST', CAREER_PLAN_PATH, { status: 200, json: CAREER_PLAN_READY })
    await key.click()
    await expect.poll(() => api.requestCount('POST', CAREER_PLAN_PATH)).toBe(2)
    await expect(screen).toHaveAttribute('data-state', 'ready')
  })
}

test('job fit actions lists only returned items and keeps print honest @w3-kiosk', async ({ page, api }) => {
  terminalBaseline(api)
  await page.goto('/resume/job-fit/actions')
  const screen = page.locator('[data-kiosk-screen="resume-job-fit-actions"]')
  await expect(screen).toHaveAttribute('data-state', 'missing-task')
  await expect(page.getByText('请先完成一次岗位匹配参考').first()).toBeVisible()
  await captureDecisionViewports(page, 'actions-missing-task')

  api.respond('GET', '/api/v1/resume/job-fit/t-act', { status: 200, json: ACTIONS_RESULT })
  await page.goto('/resume/job-fit/actions?taskId=t-act')
  await expect(screen).toHaveAttribute('data-state', 'ready')
  await expect(page.getByText('缺少 Excel 数据整理经历')).toBeVisible()
  await expect(page.getByText('把「协助行政」改写成具体做过的三件事')).toBeVisible()
  await expect(page.getByText('本平台不提供投递功能', { exact: false }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: '查看岗位' })).toBeVisible()
  for (const forbidden of ['一键投递', '立即投递', '平台投递']) await expect(page.getByText(forbidden)).toHaveCount(0)
  await captureDecisionViewports(page, 'actions-ready')

  api.respond('POST', '/api/v1/resume/job-fit/t-act/print', { status: 500, json: { error: { code: 'SERVER_ERROR', message: '生成失败' } } })
  await page.locator('.qxt-dock').getByRole('button', { name: '生成打印版' }).click()
  await expect(screen).toHaveAttribute('data-state', 'print-failed')
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByText('已打印')).toHaveCount(0)
  await captureDecisionViewports(page, 'actions-print-failed')
  await page.getByRole('button', { name: '返回行动清单' }).click()
  await expect(screen).toHaveAttribute('data-state', 'ready')
  expect(page.url()).not.toContain('/print/confirm')
})

// 差距行动清单 AI 停（稿 jobfit-actions 这一态）：一句对本人说的实话，加三张大行动卡 —— 去简历优化、去材料工坊、打印现有简历，三件都不经过 AI。
// 三张卡把整屏吃满：最长连续空白不超过 105px（改前托管开 442px、托管关 574px）。卡与去向不随托管口径变，所以两种口径各量一遍。
for (const hosting of [
  { name: 'hosting on', config: RECRUITMENT_HOSTING_ON },
  { name: 'hosting off', config: RECRUITMENT_HOSTING_OFF },
] as const) {
  test(`job fit actions: an AI stop is one plain sentence and three big action cards with no empty block (${hosting.name}) @w3-kiosk`, async ({ page, api }) => {
    terminalBaseline(api)
    api.respond('GET', '/api/v1/terminals/KSK-001/config', { status: 200, json: terminalConfigWithHosting(hosting.config, 'actions-ai-down') })
    api.respond('GET', '/api/v1/resume/job-fit/t-act', { status: 503, json: { error: { code: 'AI_NOT_CONFIGURED', message: 'AI 能力未配置' } } })
    await page.goto('/resume/job-fit/actions?taskId=t-act')
    const screen = page.locator('[data-kiosk-screen="resume-job-fit-actions"]')
    await expect(screen).toHaveAttribute('data-state', 'ai-down')
    // 一句实话（稿 jobfit-actions 这一态的原句）：不写「不承诺恢复时间」这类写给审稿人看的批注，也不预告恢复。
    await expect(screen.locator('.qxt-howto').getByText('AI 暂时不可用，这次没有行动清单。', { exact: true })).toBeVisible()
    await expect(page.locator('body')).not.toContainText(/不承诺恢复时间|稍后自动恢复|服务不可用时不显示任何清单内容/)
    // 没有清单，也不拿别的内容顶替；三张大行动卡照稿：名字、一句说明、顺序都对，AI 停了照常可点。
    await expect(page.getByText('缺少 Excel 数据整理经历')).toHaveCount(0)
    await expect(screen.locator('.rtp-acts .qxt-slab h3')).toHaveText(['去简历优化', '去材料工坊', '打印现有简历'])
    await expect(screen.locator('.rtp-acts .qxt-slab p')).toHaveText(['按你自己的判断改', '准备求职信或材料清单', '手上有文件就直接去打印'])
    for (const name of [/去简历优化/, /去材料工坊/, /打印现有简历/]) await expect(screen.getByRole('button', { name })).toBeEnabled()
    // 整屏没有大片空白：卡片吃满正文区，不是留一块空底。
    const blank = longestBlankRun(await page.screenshot())
    expect(blank.px, `最长连续空白 ${blank.px}px（起点 y=${blank.atY}）`).toBeLessThanOrEqual(105)
  })
}

test('job fit actions: each card of an AI stop leads to a real route that works without AI @w3-kiosk', async ({ page, api }) => {
  registerW6Api(api)
  api.respond('GET', '/api/v1/resume/job-fit/t-act', { status: 503, json: { error: { code: 'AI_NOT_CONFIGURED', message: 'AI 能力未配置' } } })
  // 简历优化页带着这次的任务号读已有的优化结果（读取不经过 AI 停掉的那条链路）。
  api.respond('GET', '/api/v1/resume/records/t-act/optimize', {
    status: 200,
    json: { taskId: 't-act', status: 'completed', providerName: 'deepseek', modules: [{ title: '项目成果', before: '参与数据整理工作。', after: '主导数据整理，完成 5000 条记录校验。' }] },
  })
  const screen = page.locator('[data-kiosk-screen="resume-job-fit-actions"]')
  for (const card of [
    { name: /去简历优化/, url: /\/resume\/optimize$/, marker: '[data-kiosk-screen="resume-optimize"]' },
    { name: /去材料工坊/, url: /\/resume\/materials$/, marker: '[data-kiosk-screen="resume-materials"]' },
    { name: /打印现有简历/, url: /\/print-scan$/, marker: '[data-w2-page="print-scan-home"]' },
  ]) {
    await page.goto('/resume/job-fit/actions?taskId=t-act')
    await expect(screen).toHaveAttribute('data-state', 'ai-down')
    await screen.getByRole('button', { name: card.name }).click()
    await expect(page).toHaveURL(card.url)
    await expect(page.locator(card.marker)).toBeVisible()
  }
})

test('job fit actions: a print result arriving after leaving does not hijack navigation @w3-kiosk', async ({ page, api }) => {
  jobFitBaseline(api)
  api.respond('GET', '/api/v1/resume/job-fit/t-act', { status: 200, json: ACTIONS_RESULT })
  let releasePrint: (() => void) | null = null
  const printHeld = new Promise<void>((resolve) => { releasePrint = resolve })
  api.respondWith('POST', '/api/v1/resume/job-fit/t-act/print', async () => {
    await printHeld
    return { status: 200, json: { fileId: 'f-late', filename: '行动清单.pdf', sizeBytes: 2048, pageCount: 1, printFileUrl: '/api/v1/files/f-late/content?sig=late' } }
  })
  await page.goto('/resume/job-fit/actions?taskId=t-act')
  const screen = page.locator('[data-kiosk-screen="resume-job-fit-actions"]')
  await expect(screen).toHaveAttribute('data-state', 'ready')
  await page.locator('.qxt-dock').getByRole('button', { name: '生成打印版' }).click()
  await expect(screen).toHaveAttribute('data-state', 'print-pending')
  await expect(page.getByText('本页没有发起支付')).toBeVisible()
  await captureDecisionViewports(page, 'actions-print-pending')
  await page.locator('.qxt-dock').getByRole('button', { name: '返回比对结果' }).click()
  await expect(page).toHaveURL(/\/resume\/job-fit$/)
  releasePrint!()
  await expect.poll(() => api.requestCount('POST', '/api/v1/resume/job-fit/t-act/print')).toBe(1)
  await expect(page.locator('[data-kiosk-screen="resume-job-fit"]').first()).toBeVisible()
  await expect(page).toHaveURL(/\/resume\/job-fit$/)
})

// 生成中（稿 career 的 gen 屏）：边界声明只有稿的那一句「不承诺录用或收入。」。不写「不显示进度百分比或阶段名称」「也不生成打印文件、不发起支付」这类讲页面自己怎么做的话。
test('career plan: while generating, the one boundary line is the draft sentence, not review notes @w3-kiosk', async ({ page, api }) => {
  terminalBaseline(api)
  api.respond('GET', CAREER_PLAN_PATH, { status: 404, json: { error: { code: 'CAREER_PLAN_NOT_FOUND', message: '尚未生成' } } })
  let releaseGenerate: (() => void) | null = null
  const generateHeld = new Promise<void>((resolve) => { releaseGenerate = resolve })
  api.respondWith('POST', CAREER_PLAN_PATH, async () => {
    await generateHeld
    return { status: 200, json: CAREER_PLAN_READY }
  })
  await openWithRouteState(page, '/resume/career-plan', { taskId: 't-cp' })
  const screen = page.locator('[data-kiosk-screen="resume-career-plan"]')
  await expect(screen).toHaveAttribute('data-state', 'guide')
  await page.locator('.qxt-dock').locator('[data-career-plan-generate]').click()
  await expect(screen).toHaveAttribute('data-state', 'generating')
  await expect(screen.locator('.qxt-fine').getByText('不承诺录用或收入。', { exact: true })).toBeVisible()
  await expect(page.locator('body')).not.toContainText(/不显示进度百分比|阶段名称|不发起支付|不生成打印文件/)
  releaseGenerate!()
  await expect(screen).toHaveAttribute('data-state', 'ready')
})

test('career plan guide, ai-down and generated result keep print available @w3-kiosk', async ({ page, api }) => {
  terminalBaseline(api)
  await page.goto('/resume/career-plan')
  const screen = page.locator('[data-kiosk-screen="resume-career-plan"]')
  await expect(screen).toHaveAttribute('data-state', 'missing-task')
  await captureDecisionViewports(page, 'career-missing-task')

  api.respond('GET', '/api/v1/resume/career-plan/t-cp', { status: 404, json: { error: { code: 'CAREER_PLAN_NOT_FOUND', message: '尚未生成' } } })
  await openWithRouteState(page, '/resume/career-plan', { taskId: 't-cp' })
  await expect(screen).toHaveAttribute('data-state', 'guide')
  await expect(page.getByRole('button', { name: '打印求职参考单（未含 AI 规划）' })).toBeVisible()
  await captureDecisionViewports(page, 'career-guide')

  api.respond('POST', '/api/v1/resume/career-plan/t-cp', { status: 503, json: { error: { code: 'AI_NOT_CONFIGURED', message: 'AI 能力未配置' } } })
  await page.getByRole('button', { name: '生成求职方案' }).click()
  await expect(screen).toHaveAttribute('data-state', 'ai-down')
  await expect(page.getByText('这三条是通用建议，不是针对你这份简历的', { exact: false })).toBeVisible()
  // AI 能力级不可用时页面给固定人话和手动出路，不再透出服务端原文（#1241）。
  await expect(page.getByText('AI 暂时不可用，你可以先打印求职参考单（未含 AI 规划）')).toBeVisible()
  await expect(page.getByText('AI 能力未配置')).toHaveCount(0)
  // 出纸不依赖 AI：ai-down 时打印按钮仍在；生成钮也仍在（不被 canStart 藏掉），但已知停用 → 置灰、不发请求、原因写在旁边（稿 career 的 AI 停）。
  await expect(page.getByRole('button', { name: '打印求职参考单（未含 AI 规划）' })).toBeVisible()
  await expectCareerGenerateKeyGreyed(page, api, '生成求职方案', CAREER_AI_DOWN_WHY)
  await captureDecisionViewports(page, 'career-ai-down')

  // 离开再进来才会重新探测：这次服务好了，生成钮可点，点了拿到方案。
  api.respond('POST', '/api/v1/resume/career-plan/t-cp', { status: 200, json: CAREER_PLAN_READY })
  await openWithRouteState(page, '/resume/career-plan', { taskId: 't-cp' })
  await expect(screen).toHaveAttribute('data-state', 'guide')
  await page.getByRole('button', { name: '生成求职方案' }).click()
  await expect(screen).toHaveAttribute('data-state', 'ready')
  await expect(page.getByRole('heading', { name: '目标与方向' })).toBeVisible()
  await expect(page.locator('.rdq-direction h3')).toContainText('运营助理')
  await expect(page.getByText('未登录 · 本次结果不进入「我的」记录', { exact: false })).toBeVisible()
  await expect(page.locator('[data-career-plan-column="materials"]')).toContainText('登录后可看到你已保存的材料')
  expect(api.requestCount('GET', '/api/v1/me/resumes')).toBe(0)
  await captureDecisionViewports(page, 'career-ready')
})

test('career plan print failure and expired-plan degraded print both stop before print confirm @w3-kiosk', async ({ page, api }) => {
  terminalBaseline(api)
  api.respond('GET', '/api/v1/resume/career-plan/t-cp', { status: 200, json: CAREER_PLAN_READY })
  api.respond('POST', '/api/v1/resume/career-plan/t-cp/print', { status: 500, json: { error: { code: 'SERVER_ERROR', message: '生成失败' } } })
  await openWithRouteState(page, '/resume/career-plan', { taskId: 't-cp' })
  const screen = page.locator('[data-kiosk-screen="resume-career-plan"]')
  await expect(screen).toHaveAttribute('data-state', 'ready')
  await page.getByRole('button', { name: '打印建议单' }).click()
  await expect(screen).toHaveAttribute('data-state', 'print-failed')
  await expect(page.getByRole('alert').first()).toBeVisible()
  await captureDecisionViewports(page, 'career-print-failed')
  await page.getByRole('button', { name: '返回求职方案' }).click()
  await expect(screen).toHaveAttribute('data-state', 'ready')

  api.respond('POST', '/api/v1/resume/career-plan/t-cp/print', {
    status: 200,
    json: { fileId: 'f-cp', filename: '求职参考单.pdf', sizeBytes: 4096, pageCount: 2, signedUrl: 'https://files.invalid/f-cp', expiresAt: '2099-01-01T00:00:00.000Z', printFileUrl: '/api/v1/files/f-cp/content?sig=cp', variant: 'degraded' },
  })
  await page.getByRole('button', { name: '打印建议单' }).click()
  await expect(screen).toHaveAttribute('data-state', 'print-degraded')
  await expect(page.getByText('没有', { exact: true })).toBeVisible()
  await captureDecisionViewports(page, 'career-print-degraded')
  await page.getByRole('button', { name: '先不打印' }).click()
  await expect(screen).toHaveAttribute('data-state', 'ready')
  expect(page.url()).not.toContain('/print/confirm')
})

test('resume templates: empty, error with real retry, and selection that saves nothing @w3-kiosk', async ({ page, api }) => {
  terminalBaseline(api)
  await page.goto('/resume/templates')
  const screen = page.locator('[data-kiosk-screen="resume-templates"]')
  // ApiRouter 基线对模板列表应答空数组：读取成功但为空，不是故障。
  await expect(screen).toHaveAttribute('data-state', 'empty')
  await expect(page.getByRole('heading', { name: '当前没有已发布的简历模板' })).toBeVisible()
  await captureDecisionViewports(page, 'templates-empty')

  api.respond('GET', '/api/v1/job-materials/templates', { status: 500, json: { error: { code: 'SERVER_ERROR', message: 'fixture template failure' } } })
  await page.goto('/resume/templates')
  await expect(screen).toHaveAttribute('data-state', 'error')
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByText('fixture template failure')).toHaveCount(0)
  await captureDecisionViewports(page, 'templates-error')

  api.respond('GET', '/api/v1/job-materials/templates', { status: 200, json: { success: true, data: [RESUME_TEMPLATE] } })
  await page.locator('.qxt-dock').getByRole('button', { name: '重新读取模板' }).click()
  await expect(screen).toHaveAttribute('data-state', 'list')
  const card = page.getByTestId('resume-templates-template-tpl-clean')
  await expect(card).toHaveAttribute('aria-pressed', 'false')
  await captureDecisionViewports(page, 'templates-list')
  await card.click()
  await expect(screen).toHaveAttribute('data-state', 'selected')
  await expect(card).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.rdq-sections li')).toHaveText(['基本信息', '个人总结', '工作 / 实习经历', '技能'])
  await captureDecisionViewports(page, 'templates-selected')
  await page.getByRole('button', { name: '换一个版式' }).click()
  await expect(screen).toHaveAttribute('data-state', 'list')
  expect(api.requestCount('GET', '/api/v1/job-materials/templates')).toBeGreaterThanOrEqual(2)
})

test('assistant voice deadline warns then preserves text conversation @w3-kiosk', async ({ page, api }) => {
  terminalBaseline(api)
  await mockAssistantVoice(page, api)
  const now = new Date('2026-09-30T12:00:00.000Z')
  await page.clock.install({ time: now })
  api.respond('POST', '/api/v1/trtc/session', {
    status: 200,
    json: { sdkAppId: 1, roomId: 'deadline-room', userId: 'deadline-user', userSig: 'synthetic', taskId: 'deadline-task',
      maxSessionSeconds: 120, expiresAt: new Date(now.getTime() + 120_000).toISOString() },
  })
  api.respond('POST', '/api/v1/assistant/chat', { status: 200, json: assistantReply })
  await page.goto('/assistant')
  const transcript = page.locator('.assistant-transcript')
  const input = page.locator('textarea')
  await input.fill('我想整理简历')
  await page.getByRole('group', { name: '虚拟键盘' }).getByRole('button', { name: '发送', exact: true }).click()
  await expect(page.locator('[data-message-kind="ai"]')).toBeVisible()
  const beforeTurn = (await page.locator('[data-message-kind="ai"]').first().textContent())?.trim() ?? ''
  expect(beforeTurn.length).toBeGreaterThan(0)
  await input.fill('继续帮我整理简历')
  // 虚拟键盘的遮罩会挡住工具栏，先收起键盘再点语音咨询（与本文件其余用例同一做法）。
  await page.getByRole('button', { name: '收起键盘', exact: true }).click()
  await page.getByRole('button', { name: '语音咨询', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '和小青语音咨询' })
  await dialog.getByRole('button', { name: /直接语音通话/ }).click()
  await expect(dialog).toHaveAttribute('data-state', 'voice-live')
  await page.clock.fastForward(61_000)
  await expect(dialog.getByText(/本次语音通话还剩 1 分钟/)).toBeVisible()
  await page.clock.fastForward(60_000)
  await expect(dialog).toHaveCount(0)
  await expect(transcript).toContainText('语音通话已到本次上限，已为你转成文字对话，可以继续问')
  // 语音前的文字对话原样保留（用户这一句 + 小青的回答），到点提示只出现一次。
  await expect(transcript).toContainText('我想整理简历')
  await expect(transcript).toContainText(beforeTurn)
  await expect(transcript.getByText('语音通话已到本次上限，已为你转成文字对话，可以继续问')).toHaveCount(1)
  await expect(transcript).toContainText('可以先说说你最想解决的问题。')
  await expect(input).toHaveValue('继续帮我整理简历')
  await expect(input).toBeEnabled()
  await expect.poll(() => api.requestCount('POST', '/api/v1/trtc/session/stop')).toBe(1)
  expect(api.requestCount('POST', '/api/v1/trtc/session')).toBe(1)
})

const VOICE_SILENT_TEXT = '这次语音没有接通声音，已为你转成文字对话，可以接着问'

async function beginAdvisorCall(page: Page) {
  await page.goto('/assistant')
  await page.getByRole('button', { name: '语音咨询', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '和小青语音咨询' })
  await dialog.getByRole('button', { name: /直接语音通话/ }).click()
  await expect(dialog).toHaveAttribute('data-state', 'voice-live')
  return dialog
}

test('assistant voice silent prompt switches to text @w3-kiosk', async ({ page, api }) => {
  terminalBaseline(api)
  await mockAssistantVoice(page, api, false, { silent: true })
  await page.clock.install()
  const dialog = await beginAdvisorCall(page)
  await expect(dialog.getByTestId('assistant-voice-silent')).toHaveCount(0)
  await page.clock.fastForward(12_000)
  const notice = dialog.getByTestId('assistant-voice-silent')
  await expect(notice).toBeVisible()
  await expect(notice).toHaveAttribute('role', 'status')
  await expect(notice.getByRole('heading', { name: '小青这边没有声音，也没有字幕' })).toBeVisible()
  await expect(notice).toContainText('可能是网络或语音服务没接通。可以改用文字继续问。')
  const toText = dialog.getByTestId('assistant-voice-silent-to-text')
  const retry = notice.getByRole('button', { name: '重新连接', exact: true })
  expect(await toText.evaluate((el) => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(64)
  expect(await retry.evaluate((el) => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(64)
  await toText.click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByLabel('输入咨询问题')).toBeEnabled()
  await expect(page.getByText(VOICE_SILENT_TEXT)).toHaveCount(1)
  await expect.poll(() => api.requestCount('POST', '/api/v1/trtc/session/stop')).toBe(1)
})

test('assistant voice silent call switches to text at 30s @w3-kiosk', async ({ page, api }) => {
  terminalBaseline(api)
  await mockAssistantVoice(page, api, false, { silent: true })
  await page.clock.install()
  const dialog = await beginAdvisorCall(page)
  await page.clock.fastForward(30_000)
  await expect(dialog).toHaveCount(0)
  await expect(page.getByLabel('输入咨询问题')).toBeEnabled()
  await expect(page.getByText(VOICE_SILENT_TEXT)).toHaveCount(1)
  await expect.poll(() => api.requestCount('POST', '/api/v1/trtc/session/stop')).toBe(1)
})

test('assistant voice with subtitle stays in the call past 40s @w3-kiosk', async ({ page, api }) => {
  terminalBaseline(api)
  await mockAssistantVoice(page, api)
  await page.clock.install()
  const dialog = await beginAdvisorCall(page)
  await expect(dialog.getByText('可以先说说你最想解决的问题。', { exact: true })).toBeVisible()
  await page.clock.fastForward(40_000)
  await expect(dialog.getByTestId('assistant-voice-silent')).toHaveCount(0)
  await expect(dialog).toHaveAttribute('data-state', 'voice-live')
  expect(api.requestCount('POST', '/api/v1/trtc/session/stop')).toBe(0)
})

test('W-118 resume diagnosis phone entry creates only one upload session @w3-kiosk', async ({ page, api }) => {
  terminalBaseline(api)
  let creates = 0
  let release!: () => void
  const held = new Promise<void>((resolve) => { release = resolve })
  api.respondWith('POST', '/api/v1/upload-sessions', async () => {
    creates += 1
    // 正式构建只挂载一次；这里压住第一次请求，在它还在途时切走再切回，制造第二次挂载。
    await held
    return { status: 201, json: { success: true, data: {
      sessionId: 'w118-resume-upload', uploadUrl: '/upload/phone',
      uploadToken: 'w118-upload', controlToken: 'w118-control', expiresAt: '2099-01-01T00:00:00.000Z',
    } } }
  })
  api.respond('GET', '/api/v1/upload-sessions/w118-resume-upload', { status: 200, json: { success: true, data: {
    sessionId: 'w118-resume-upload', status: 'pending', purpose: 'resume_upload', mode: 'temporary',
    file: null, requiresKioskConfirmation: false, expiresAt: '2099-01-01T00:00:00.000Z',
  } } })
  await page.goto('/resume/source')
  await page.getByRole('button', { name: /在手机里/ }).click()
  await expect.poll(() => creates).toBe(1)
  try {
    await page.getByRole('button', { name: /本机文件/ }).click()
    await page.getByRole('button', { name: /在手机里/ }).click()
  } finally {
    release()
  }
  await expect(page.getByText('请用手机微信或浏览器扫码', { exact: true })).toBeVisible()
  await expect(page.locator('.resume-source-phone-session svg[width="150"]')).toBeVisible()
  expect(creates).toBe(1)
})

/*
 * 手机传来的简历：底栏「确认使用这份文件」。
 * 面板交给页面的确认函数曾是渲染期写进 ref 的旧闭包：确认一开始父页不重渲染，底栏仍写「确认使用这份文件」、
 * 没禁用，再点一下就把 /confirm 发第二遍。现在面板在确认开始时交回 null、底栏写「正在确认…」并禁用，
 * 面板里另有不随渲染变的在途标记，连同一帧内的两次点击也只发一次。
 */
test('resume source phone confirm sends one request per tap, shows 正在确认… while it runs and can be retried after a failure @w3-kiosk', async ({ page, api }) => {
  const runtimeErrors: string[] = []
  page.on('pageerror', (error) => runtimeErrors.push(error.message))
  terminalBaseline(api)
  const SESSION = 'w3-phone-confirm'
  const FILE = { fileId: 'w3-phone-file', filename: '手机传来的简历.pdf', sizeBytes: 253952, mimeType: 'application/pdf', sha256: 'b'.repeat(64), fileExpiresAt: null, fileUrl: '/w3-fixtures/resume.pdf' }
  api.respond('POST', '/api/v1/upload-sessions', { status: 201, json: { success: true, data: { sessionId: SESSION, uploadUrl: '/upload/phone', uploadToken: 'w3-up', controlToken: 'w3-ctl', expiresAt: '2099-01-01T00:00:00.000Z' } } })
  api.respond('GET', `/api/v1/upload-sessions/${SESSION}`, { status: 200, json: { success: true, data: { sessionId: SESSION, status: 'uploaded', purpose: 'resume_upload', mode: 'temporary', file: FILE, requiresKioskConfirmation: false, expiresAt: '2099-01-01T00:00:00.000Z' } } })
  await page.route('**/w3-fixtures/resume.pdf', (route) => route.fulfill({ status: 200, contentType: 'application/pdf', body: VISIBLE_PDF }))
  let confirms = 0
  let releaseFirst!: () => void
  const firstHeld = new Promise<void>((resolve) => { releaseFirst = resolve })
  await page.route(`**/api/v1/upload-sessions/${SESSION}/confirm`, async (route) => {
    confirms += 1
    if (confirms === 1) {
      // 第一次确认慢，而且最后失败：期间连点只能发这一次；失败后按钮要恢复，能再确认。
      await firstHeld
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ success: false, error: { code: 'INTERNAL_ERROR', message: 'x' } }) })
      return
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { sessionId: SESSION, status: 'confirmed', file: FILE } }) })
  })
  await page.goto('/resume/source')
  await page.getByRole('button', { name: /在手机里/ }).click()
  const dock = page.locator('.qxt-dock')
  const confirm = dock.getByRole('button', { name: '确认使用这份文件' })
  await expect(confirm).toBeEnabled({ timeout: 10_000 })
  // 同一帧里连点两次：只许发一次确认。
  await confirm.evaluate((button: HTMLElement) => { button.click(); button.click() })
  // 确认进行中：底栏改写「正在确认…」且不可点；再强点一次也没有第二次请求。
  const confirming = dock.getByRole('button', { name: '正在确认…' })
  await expect(confirming).toBeDisabled()
  await expect(dock.getByRole('button', { name: '确认使用这份文件' })).toHaveCount(0)
  await expect.poll(() => confirms).toBe(1)
  await confirming.click({ force: true, timeout: 2_000 }).catch(() => undefined)
  // 不靠固定等待：让两帧渲染与排队中的请求都过一遍，再数请求。
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  expect(confirms, '确认进行中连点只发一次').toBe(1)
  // 第一次确认失败：按钮恢复可点，再确认一次成功，文件进入「待你确认」的文件卡。
  releaseFirst()
  await expect(confirm).toBeEnabled({ timeout: 10_000 })
  expect(confirms).toBe(1)
  await confirm.click()
  await expect(page.locator('.qxt-filecard')).toContainText('手机传来的简历.pdf')
  expect(confirms, '失败后再确认才发第二次').toBe(2)
  await expect(dock.getByRole('button', { name: '确认使用这份文件' })).toHaveCount(0)
  expect(runtimeErrors).toEqual([])
})

/*
 * #1519 留给触屏版第四包的面板接线（UploadSessionQrPanel，简历来源页「在手机里」）：
 * 二维码旁的说明、手机传来文件后文件名下面的来源与「不是你传的文件就取消」提醒，句子都来自 copy/miniappLinkCopy.ts，面板不手写。
 * 小程序已发布才换掉码旁原句；没发布保持「请用手机微信或浏览器扫码」。来源读不到（旧会话没有这个字段）就不写那一行，
 * 提醒只在已收到文件后出现。
 */
const MINIAPP_UPLOAD_HINT = '用手机微信扫码：打开的是职易达小程序，就在里面选文件；打开的是网页，也能照常上传。'
const NOT_YOUR_FILE_HINT = '不是你传的文件？请点「取消」，再重新扫码。'

function supportContactMiniapp(published: boolean) {
  return {
    status: 200,
    json: { success: true, data: { servicePhone: '18369161921', serviceHours: '工作日 9:00–18:00', otherOnlineTerminalNearby: false, miniappPublished: published } },
  }
}

function mockResumePhoneSession(api: ApiRouter, status: 'pending' | 'uploaded', source?: string | null): void {
  const SESSION = 'w3-miniapp-hint'
  const file = status === 'uploaded'
    ? { fileId: 'w3-miniapp-file', filename: '手机传来的简历.pdf', sizeBytes: 253952, mimeType: 'application/pdf', sha256: 'c'.repeat(64), fileExpiresAt: null, fileUrl: '/w3-fixtures/resume.pdf', ...(source === undefined ? {} : { source }) }
    : null
  api.respond('POST', '/api/v1/upload-sessions', { status: 201, json: { success: true, data: { sessionId: SESSION, uploadUrl: '/upload/phone', uploadToken: 'w3-mini-up', controlToken: 'w3-mini-ctl', expiresAt: '2099-01-01T00:00:00.000Z' } } })
  api.respond('GET', `/api/v1/upload-sessions/${SESSION}`, { status: 200, json: { success: true, data: { sessionId: SESSION, status, purpose: 'resume_upload', mode: 'temporary', file, requiresKioskConfirmation: false, expiresAt: '2099-01-01T00:00:00.000Z' } } })
}

for (const published of [true, false]) {
  test(`resume source phone QR: miniapp ${published ? 'published swaps the sentence beside the code' : 'unpublished keeps the original sentence'} @w3-kiosk`, async ({ page, api }) => {
    terminalBaseline(api)
    api.respond('GET', '/api/v1/public/support-contact', supportContactMiniapp(published))
    mockResumePhoneSession(api, 'pending')
    await page.goto('/resume/source')
    await page.getByRole('button', { name: /在手机里/ }).click()
    const panel = page.locator('.resume-source-phone-session')
    await expect(panel.locator('svg[width="150"]')).toBeVisible()
    if (published) {
      await expect(panel.getByText(MINIAPP_UPLOAD_HINT, { exact: true })).toBeVisible()
      await expect(panel.getByText('请用手机微信或浏览器扫码', { exact: true })).toHaveCount(0)
    } else {
      await expect(panel.getByText('请用手机微信或浏览器扫码', { exact: true })).toBeVisible()
      await expect(panel).not.toContainText('小程序')
    }
    // 还没收到文件：不写来源，也没有「不是你传的」提醒。
    await expect(panel).not.toContainText('不是你传的文件')
    await assertNoHorizontalOverflow(page)
  })
}

for (const c of [
  { source: 'miniapp_documents', line: '来自职易达小程序「我的文档」' },
  { source: 'miniapp', line: '来自职易达小程序' },
  { source: 'web', line: '来自手机网页' },
  { source: undefined, line: null },
  { source: 'something-new', line: null },
] as const) {
  test(`resume source phone received: file source ${String(c.source)} shows ${c.line ?? 'no source line'} and the not-yours reminder @w3-kiosk`, async ({ page, api }) => {
    terminalBaseline(api)
    api.respond('GET', '/api/v1/public/support-contact', supportContactMiniapp(true))
    mockResumePhoneSession(api, 'uploaded', c.source)
    await page.route('**/w3-fixtures/resume.pdf', (route) => route.fulfill({ status: 200, contentType: 'application/pdf', body: VISIBLE_PDF }))
    await page.goto('/resume/source')
    await page.getByRole('button', { name: /在手机里/ }).click()
    const panel = page.locator('.resume-source-phone-session')
    await expect(panel.getByText('手机传来的简历.pdf', { exact: false }).first()).toBeVisible()
    if (c.line) await expect(panel.getByText(c.line, { exact: true })).toBeVisible()
    else await expect(panel).not.toContainText('来自')
    // 提醒是事实陈述，不管小程序发没发布、来源认不认得，只要已收到文件就在文件名下面。
    await expect(panel.getByText(NOT_YOUR_FILE_HINT, { exact: true })).toBeVisible()
    // 提醒说的是「取消」，面板里要真有一个叫「取消」的按钮。
    await expect(panel.getByRole('button', { name: '取消', exact: true })).toBeVisible()
    await assertNoHorizontalOverflow(page)
  })
}
