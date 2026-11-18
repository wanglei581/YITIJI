/**
 * 面板扫描完成页：`GET /me/documents` 第一页里有这份 fileId，才说已存进「我的文档」。
 * 没有、或接口 500，屏上是当场打印那句，不出现已存句。
 *
 * 不起真 API。请求由 `tests/fixtures/api-router.ts` 的 `page.route('**\/api/v1/**')` 应答。
 *
 * CI：作业 `kiosk-browser-smoke`（`.github/workflows/ci.yml`）的步骤
 * 「Run Kiosk browser smoke」执行 `pnpm --filter @ai-job-print/kiosk test:browser:w2`。
 * `apps/kiosk/package.json` 里该脚本是 `playwright test --config=playwright.w2.config.ts`。
 * `playwright.w2.config.ts` 的 testMatch 含本文件，project `kiosk-1080x1920` 的 grep 是 `/@w2/`。
 */
import type { Page } from '@playwright/test'
import type { ApiRouter } from '../fixtures/api-router'
import { test, expect } from '../fixtures/kiosk-test'
import { writeScanWorkbenchSession, W2_FILE } from './fixtures/fusion-w2-state'
import { FusionW2BinaryRoute } from './fixtures/fusion-w2-binary-route'
import { isAbortedPdfjsBlobImport } from './fixtures/pdf-preview-blob-abort'

const FILE_ID = 'panel-scan-doc-file'
const MEMBER_TOKEN = 's15b2-scan-note-token'
const MEMBER_PHONE = '13800138000'
const MEMBER_CODE = '123456'
const SAVED = '在「我的文档」查看与管理本次扫描件'
const PRINT_NOW = '当场打印：请在本次操作内完成打印或识别。'

function collectRuntimeErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
  page.on('requestfailed', (request) => {
    if (isAbortedPdfjsBlobImport(request)) return
    if (['document', 'script', 'stylesheet'].includes(request.resourceType())) {
      errors.push(`${request.resourceType()}: ${request.url()} (${request.failure()?.errorText ?? 'unknown'})`)
    }
  })
  return errors
}

function registerShell(api: ApiRouter): void {
  api.respond('GET', '/api/v1/terminals/KSK-001/screensaver', {
    status: 200,
    json: { enabled: false, idleTimeoutSec: 180, items: [] },
  })
  api.respond('GET', '/api/v1/terminals/KSK-001/printer-status', {
    status: 200,
    json: { printerStatus: 'ready', paperLevel: 'sufficient', isOnline: true },
  })
  api.respond('GET', '/api/v1/terminals/KSK-001/capabilities', {
    status: 200,
    json: { capabilities: [] },
  })
  api.respond('GET', '/api/v1/kiosk/legal/terms_of_service', { status: 200, json: { success: true, data: null } })
  api.respond('GET', '/api/v1/kiosk/legal/privacy_policy', { status: 200, json: { success: true, data: null } })
  api.respond('POST', '/api/v1/member/auth/sms-code', {
    status: 200,
    json: { success: true, data: { sent: true, cooldownSeconds: 60, expiresInSeconds: 300 } },
  })
  api.respond('POST', '/api/v1/member/auth/login', {
    status: 200,
    json: {
      success: true,
      data: {
        token: MEMBER_TOKEN,
        user: { id: 'member-s15b2-scan-note', phoneMasked: '138****8000', nickname: '扫描核对' },
      },
    },
  })
  api.respond('GET', '/api/v1/me/pending-tasks', { status: 200, json: { success: true, data: [] } })
  api.respond('GET', '/api/v1/me/favorites', {
    status: 200,
    json: { success: true, data: { items: [], nextCursor: null, total: 0 } },
  })
}

function documentsBody(ids: string[]) {
  return {
    success: true,
    data: {
      items: ids.map((id) => ({ id, filename: `${id}.pdf` })),
      nextCursor: null,
      total: ids.length,
    },
  }
}

function resultSession() {
  return {
    stage: 'result',
    scanType: 'document',
    extras: {},
    result: {
      outcome: 'completed',
      success: true,
      file: {
        fileId: FILE_ID,
        fileUrl: W2_FILE.fileUrl,
        name: 'panel-scan.pdf',
        size: '128 KB',
        pages: 1,
        format: 'PDF',
        mimeType: 'application/pdf',
      },
    },
  }
}

/** 不重载文档。会员令牌只在内存里，整页刷新会回到游客。 */
async function softNavigate(page: Page, path: string): Promise<void> {
  await page.evaluate((nextPath) => {
    const current = window.history.state as { idx?: number } | null
    const idx = typeof current?.idx === 'number' ? current.idx + 1 : 1
    window.history.pushState({ usr: null, key: 's15b2-scan-note', idx }, '', nextPath)
    window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }))
  }, path)
}

async function login(page: Page): Promise<void> {
  await page.goto('/login?from=%2Fscan')
  await page.getByRole('checkbox', { name: /我已阅读并同意/ }).click()
  await page.getByRole('button', { name: '手机号（11 位本人号码）', exact: true }).click()
  for (const digit of MEMBER_PHONE) await page.getByRole('button', { name: digit, exact: true }).click()
  await page.getByRole('button', { name: '收起键盘', exact: true }).click()
  await page.getByRole('button', { name: '获取验证码', exact: true }).click()
  await page.getByRole('button', { name: '短信验证码', exact: true }).click()
  for (const digit of MEMBER_CODE) await page.getByRole('button', { name: digit, exact: true }).click()
  await page.getByRole('button', { name: '收起键盘', exact: true }).click()
  await page.getByRole('button', { name: '确认登录', exact: true }).click()
  await page.waitForURL((url) => url.pathname === '/scan')
}

async function showResult(page: Page) {
  await writeScanWorkbenchSession(page, resultSession())
  await softNavigate(page, '/scan?stage=result')
  const exits = page.getByTestId('scan-workbench-exits')
  await expect(exits).toBeVisible()
  await expect(exits.getByRole('button', { name: /前往我的文档/ })).toBeEnabled()
  await expect(exits.getByTestId('scan-guest-ways')).toHaveCount(0)
  return exits
}

test('扫描完成页只在文档列表含这份 fileId 时说已存，没有或 500 时说当场打印 @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  const binary = new FusionW2BinaryRoute(page)
  await binary.install()
  registerShell(api)
  await login(page)

  api.respond('GET', '/api/v1/me/documents', { status: 200, json: documentsBody([FILE_ID, 'other-file']) })
  let before = api.requestCount('GET', '/api/v1/me/documents')
  let exits = await showResult(page)
  await expect.poll(() => api.requestCount('GET', '/api/v1/me/documents')).toBeGreaterThan(before)
  await expect(exits.getByText(SAVED, { exact: true })).toBeVisible()
  await expect(exits.getByText(PRINT_NOW, { exact: true })).toHaveCount(0)

  await softNavigate(page, '/scan?stage=start')
  await expect(page.getByTestId('scan-workbench-exits')).toHaveCount(0)

  api.respond('GET', '/api/v1/me/documents', { status: 200, json: documentsBody(['other-file']) })
  before = api.requestCount('GET', '/api/v1/me/documents')
  exits = await showResult(page)
  await expect.poll(() => api.requestCount('GET', '/api/v1/me/documents')).toBeGreaterThan(before)
  await expect(exits.getByText(PRINT_NOW, { exact: true })).toBeVisible()
  await expect(exits.getByText(SAVED, { exact: true })).toHaveCount(0)

  await softNavigate(page, '/scan?stage=start')
  await expect(page.getByTestId('scan-workbench-exits')).toHaveCount(0)

  api.respond('GET', '/api/v1/me/documents', {
    status: 500,
    json: { success: false, error: { code: 'DOCUMENTS_UNAVAILABLE', message: '列表暂时读不到' } },
  })
  before = api.requestCount('GET', '/api/v1/me/documents')
  exits = await showResult(page)
  await expect.poll(() => api.requestCount('GET', '/api/v1/me/documents')).toBeGreaterThan(before)
  await expect(exits.getByText(PRINT_NOW, { exact: true })).toBeVisible()
  await expect(exits.getByText(SAVED, { exact: true })).toHaveCount(0)

  expect(errors).toEqual([])
})
