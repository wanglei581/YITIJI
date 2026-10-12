import type { Page } from '@playwright/test'
import { test, expect } from '../fixtures/kiosk-test'
import type { ApiRouter } from '../fixtures/api-router'
import { RECRUITMENT_HOSTING_ON } from '../fixtures/recruitment-hosting'
import { VISIBLE_PDF } from './fixtures/fusion-w2-binary-route'
import { registerW6Api } from './fixtures/fusion-w6-api'
import { chooseGenericResumeDirection } from './fixtures/direction-selection'

/**
 * F-20b：已确认版本、Word 转 PDF 之后的页内预览改取同站地址。
 * 文件名以 fusion-w3.spec.ts 结尾，随 W3 浏览器组一起跑。
 * 不读写浏览器存储，不在 Node 里算时间。
 */

const TASK_ID = 'versions-preview-2099'
const VERSION_DIRECT = '/w3-fixtures/confirmed-version.pdf'
const VERSION_SAME = '/api/v1/files/ver-file-1/content?expires=1&sig=test'
const WORD_DIRECT = '/w3-fixtures/word-preview.pdf'
const WORD_SAME = '/api/v1/files/word-file-001/content?expires=1&sig=test'
const WORD_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

const OPTIMIZE_RESUME = {
  basic: { name: '优化样本', phone: '13800000000', city: '青岛' },
  intention: { position: '前端开发', city: '青岛' },
  summary: '这是优化结果摘要，不是草稿。',
  education: [{ school: '优化大学', major: '计算机', degree: '本科', period: '2018-2022' }],
  experience: [],
  projects: [],
  skills: ['TypeScript'],
  certificates: [],
}

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
      configVersion: 'w3',
      refreshIntervalMs: 300000,
      serverTime: '2026-07-24T00:00:00.000Z',
    },
  })
  api.respond('GET', '/api/v1/terminals/KSK-001/screensaver', {
    status: 200,
    json: { enabled: false, idleTimeoutSec: 180, items: [] },
  })
}

async function loginToOptimize(page: Page): Promise<void> {
  await page.goto(`/login?from=${encodeURIComponent(`/resume/optimize?taskId=${TASK_ID}`)}`)
  await page.getByRole('checkbox', { name: /我已阅读并同意/ }).click()
  await page.getByRole('button', { name: '手机号（11 位本人号码）', exact: true }).click()
  for (const digit of '13800138000') await page.getByRole('button', { name: digit, exact: true }).click()
  await page.getByRole('button', { name: '收起键盘', exact: true }).click()
  await page.getByRole('button', { name: '获取验证码', exact: true }).click()
  await page.getByRole('button', { name: '短信验证码', exact: true }).click()
  for (const digit of '123456') await page.getByRole('button', { name: digit, exact: true }).click()
  await page.getByRole('button', { name: '收起键盘', exact: true }).click()
  await page.getByRole('button', { name: '确认登录', exact: true }).click()
  await page.waitForURL((url) => url.pathname === '/resume/optimize' && url.searchParams.get('taskId') === TASK_ID)
}

function registerVersionApis(api: ApiRouter): void {
  registerW6Api(api)
  api.respond('GET', '/api/v1/me/ai-consents/status', {
    status: 200,
    json: { success: true, data: [{ scope: 'resume_ai', granted: true }] },
  })
  api.respond('GET', `/api/v1/resume/records/${TASK_ID}/optimize`, {
    status: 200,
    json: {
      taskId: TASK_ID,
      status: 'completed',
      providerName: 'llm',
      modules: [],
      optimizedResume: OPTIMIZE_RESUME,
    },
  })
  api.respond('GET', `/api/v1/resume/records/${TASK_ID}/draft`, {
    status: 200,
    json: { taskId: TASK_ID, draft: null },
  })
  api.respond('GET', `/api/v1/resume/records/${TASK_ID}/versions`, {
    status: 200,
    json: {
      taskId: TASK_ID,
      latestVersion: 2,
      items: [
        { version: 1, confirmedAt: '2099-01-01T00:00:00.000Z', fileId: 'ver-file-1', factsConfirmedAt: '2099-01-01T00:00:00.000Z' },
        { version: 2, confirmedAt: '2099-01-02T00:00:00.000Z', fileId: 'ver-file-2' },
      ],
    },
  })
  api.respond('GET', '/api/v1/files/ver-file-1/preview-url', {
    status: 200,
    json: {
      success: true,
      data: {
        fileId: 'ver-file-1',
        url: VERSION_DIRECT,
        printFileUrl: VERSION_SAME,
        expiresAt: '2099-01-01T00:00:00.000Z',
        disposition: 'inline',
      },
    },
  })
  api.respond('GET', '/api/v1/files/ver-file-2/preview-url', {
    status: 200,
    json: {
      success: true,
      data: {
        fileId: 'ver-file-2',
        url: VERSION_DIRECT,
        expiresAt: '2099-01-01T00:00:00.000Z',
        disposition: 'inline',
      },
    },
  })
}

test('已确认版本预览取同站地址，没有 printFileUrl 时退回直链 @w3-kiosk', async ({ page, api }) => {
  test.setTimeout(90_000)
  registerVersionApis(api)
  const directLinkFetches: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === VERSION_DIRECT) directLinkFetches.push(request.resourceType())
  })
  await page.route('**/api/v1/files/ver-file-1/content**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/pdf', body: VISIBLE_PDF }),
  )
  await page.route(`**${VERSION_DIRECT}`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/pdf', body: VISIBLE_PDF }),
  )

  await loginToOptimize(page)
  await expect(page.getByRole('heading', { name: '已确认版本' })).toBeVisible()
  const sameFetch = page.waitForRequest((request) => new URL(request.url()).pathname === '/api/v1/files/ver-file-1/content')
  await page.getByRole('button', { name: /v1/ }).click()
  const dialog = page.getByRole('dialog', { name: '已确认版本 v1' })
  await expect(dialog.locator('[data-file-preview-kind="pdf"] [data-pdf-preview-host]')).toHaveAttribute('data-preview-src', VERSION_SAME)
  await sameFetch
  expect(directLinkFetches).toEqual([])
  await expect(dialog.getByText('手机扫码保存')).toBeVisible()
  expect(api.requestCount('GET', '/api/v1/files/ver-file-1/preview-url')).toBe(1)
  await dialog.getByRole('button', { name: '关闭文件预览' }).click()

  const directFetch = page.waitForRequest((request) => new URL(request.url()).pathname === VERSION_DIRECT)
  await page.getByRole('button', { name: /v2/ }).click()
  const fallback = page.getByRole('dialog', { name: '已确认版本 v2' })
  await expect(fallback.locator('[data-file-preview-kind="pdf"] [data-pdf-preview-host]')).toHaveAttribute('data-preview-src', VERSION_DIRECT)
  await directFetch
  await expect(fallback.getByText('手机扫码保存')).toBeVisible()
})

function registerWordUpload(api: ApiRouter, printFileUrl?: string): void {
  terminalBaseline(api)
  api.respond('GET', '/api/v1/document-conversion/capabilities', {
    status: 200,
    json: { data: { wordToPdf: true, engine: 'soffice', cjkFonts: true } },
  })
  api.respond('POST', '/api/v1/files/kiosk-upload', {
    status: 200,
    json: {
      success: true,
      data: {
        fileId: 'word-file-001',
        filename: '简历.docx',
        sizeBytes: 4096,
        mimeType: WORD_MIME,
        sha256: 'c'.repeat(64),
        signedUrl: '/w3-fixtures/resume.docx',
        signedUrlExpiresAt: '2099-01-01T00:00:00.000Z',
        fileExpiresAt: null,
      },
    },
  })
  api.respond('POST', '/api/v1/files/word-file-001/convert', {
    status: 200,
    json: {
      success: true,
      data: {
        fileId: 'word-file-001',
        filename: '简历.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
        pageCount: 1,
        signedUrl: WORD_DIRECT,
        expiresAt: '2099-01-01T00:00:00.000Z',
        ...(printFileUrl ? { printFileUrl } : {}),
        engine: 'soffice',
        warnings: [],
      },
    },
  })
}

async function uploadWordResume(page: Page): Promise<void> {
  await page.goto('/resume/source')
  await chooseGenericResumeDirection(page)
  await page.getByLabel('选择本机简历文件').setInputFiles({
    name: '简历.docx',
    mimeType: WORD_MIME,
    buffer: Buffer.from('PK'),
  })
}

test('Word 转 PDF 后的页内预览取同站地址 @w3-kiosk', async ({ page, api }) => {
  test.setTimeout(90_000)
  registerWordUpload(api, WORD_SAME)
  const directLinkFetches: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === WORD_DIRECT) directLinkFetches.push(request.resourceType())
  })
  await page.route('**/api/v1/files/word-file-001/content**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/pdf', body: VISIBLE_PDF }),
  )
  await page.route(`**${WORD_DIRECT}`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/pdf', body: VISIBLE_PDF }),
  )
  const sameFetch = page.waitForRequest((request) => new URL(request.url()).pathname === '/api/v1/files/word-file-001/content')
  await uploadWordResume(page)
  await expect(page.locator('[data-file-preview-kind="pdf"] [data-pdf-preview-host]')).toHaveAttribute('data-preview-src', WORD_SAME)
  await sameFetch
  expect(directLinkFetches).toEqual([])
})

test('Word 转 PDF 回包没有 printFileUrl 时页内预览退回直链 @w3-kiosk', async ({ page, api }) => {
  test.setTimeout(90_000)
  registerWordUpload(api)
  await page.route(`**${WORD_DIRECT}`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/pdf', body: VISIBLE_PDF }),
  )
  const directFetch = page.waitForRequest((request) => new URL(request.url()).pathname === WORD_DIRECT)
  await uploadWordResume(page)
  await expect(page.locator('[data-file-preview-kind="pdf"] [data-pdf-preview-host]')).toHaveAttribute('data-preview-src', WORD_DIRECT)
  await directFetch
})
