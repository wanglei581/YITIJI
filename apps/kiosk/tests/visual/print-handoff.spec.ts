// ============================================================
// 打印交接统一（商用收口 P0-5 第二、三批）—— 浏览器回归 H1–H7
//
// 规格：docs/reviews/print-handoff-unification-2026-09-28.md 第 4.5 节。
// 同一份打印文件以前有两个来源、两种相反的读法：打印台和预览信「打印材料会话」，
// 报价确认页信跳转时带的临时状态。临时状态一丢（登录回跳、返回预览、旧地址重定向），
// 页面就退回会话里那一份 —— 可能是上一位的、或上一次的文件。
//
// 这些用例都从**真实来源页**出发（优化稿、求职材料、小青作业、我的文档），
// 在跳转丢失临时状态的那一步断言：屏幕上和报价请求里都还是这一份，上一份 0 次出现。
// 旧代码（候选 56bd387f2）上 H1–H6 必须红；H7 是清场的回归保护，旧代码上也是绿的。
//
// 文件名以 print-handoff.spec.ts 结尾、打 @w2，由 playwright.w2.config.ts 接进 CI。
// ============================================================

import type { Page } from '@playwright/test'
import type { ApiRouter } from '../fixtures/api-router'
import { test, expect } from '../fixtures/kiosk-test'
import { VISIBLE_PDF } from './fixtures/fusion-w2-binary-route'
import { FusionW2BinaryRoute } from './fixtures/fusion-w2-binary-route'
import { W2_FILE, seedPrintHandoff, writePrintHandoff } from './fixtures/fusion-w2-state'

const NOW = '2026-09-29T00:00:00.000Z'
/** 2100-01-01：打印链接的 expires（毫秒）。交接上下文会解析它，过期的链接不许进报价。 */
const FAR_EXPIRES = 4102444800000
const MEMBER_TOKEN = 'p05-handoff-member-token'
const STALE_NAME = W2_FILE.name

const CAPABILITY_KEYS = [
  'document_print', 'phone_upload', 'cloud_upload', 'usb_import', 'material_pack',
  'scan', 'copy', 'id_photo', 'format_convert', 'signature_stamp',
  'color_print', 'duplex_print',
]

function capabilities(available: string[] = []): unknown {
  return {
    terminalCode: 'KSK-001',
    capabilities: CAPABILITY_KEYS.map((capabilityKey) =>
      available.includes(capabilityKey)
        ? { capabilityKey, status: 'available', note: null, configured: true, updatedAt: NOW }
        : { capabilityKey, status: 'not_verified', note: null, configured: false, updatedAt: null },
    ),
  }
}

function runtimeErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
  return errors
}

/** 终端壳层 + 打印确认页要读的价目 / 报价。 */
function registerPrintShell(api: ApiRouter, available: string[] = []): void {
  api.respond('GET', '/api/v1/terminals/KSK-001/screensaver', { status: 200, json: { enabled: false, idleTimeoutSec: 180, items: [] } })
  api.respond('GET', '/api/v1/terminals/KSK-001/printer-status', { status: 200, json: { printerStatus: 'ready', paperLevel: 'sufficient', isOnline: true } })
  api.respond('GET', '/api/v1/terminals/KSK-001/capabilities', { status: 200, json: capabilities(available) })
  api.respond('GET', '/api/v1/mock-interviews/capabilities/voice', { status: 200, json: { data: { asrEnabled: false, ttsEnabled: false } } })
  api.respond('GET', '/api/v1/print/price-config', {
    status: 200,
    json: {
      billingEnabled: true,
      items: [
        { serviceKey: 'print_bw_page', unitCents: 100, unit: 'page', description: '黑白打印' },
        { serviceKey: 'print_color_page', unitCents: 200, unit: 'page', description: '彩色打印' },
      ],
    },
  })
  api.respond('POST', '/api/v1/orders/quote', {
    status: 200,
    json: {
      amountCents: 200,
      billablePages: 2,
      billingPageSource: 'detected',
      priceLines: [{ serviceKey: 'print_bw_page', description: '黑白打印', unitCents: 100, quantity: 2, amountCents: 200 }],
    },
  })
}

/** 登录链路（短信）+ 登录后外壳会读的几条会员接口。 */
function registerMemberLogin(api: ApiRouter): void {
  api.respond('GET', '/api/v1/kiosk/legal/terms_of_service', { status: 200, json: { success: true, data: null } })
  api.respond('GET', '/api/v1/kiosk/legal/privacy_policy', { status: 200, json: { success: true, data: null } })
  api.respond('POST', '/api/v1/member/auth/sms-code', { status: 200, json: { success: true, data: { sent: true, cooldownSeconds: 60, expiresInSeconds: 300 } } })
  api.respond('POST', '/api/v1/member/auth/login', {
    status: 200,
    json: { success: true, data: { token: MEMBER_TOKEN, user: { id: 'p05-handoff-member', phoneMasked: '138****8000', nickname: '交接验收会员' } } },
  })
  api.respond('POST', '/api/v1/member/auth/logout', { status: 200, json: { success: true, data: { loggedOut: true } } })
  api.respond('GET', '/api/v1/me/pending-tasks', { status: 200, json: { success: true, data: [] } })
  api.respond('GET', '/api/v1/me/favorites', { status: 200, json: { success: true, data: { items: [], nextCursor: null, total: 0 } } })
  api.respond('GET', '/api/v1/me/benefits', { status: 200, json: { success: true, data: { items: [], nextCursor: null, total: 0 } } })
}

/** 打印台参数页对「检查过的文件」会读一次参数建议；这里如实回「这次没有建议」。 */
function registerNoSuggestions(api: ApiRouter): void {
  api.respond('GET', '/api/v1/materials/tasks/w2-inspection-001/print-param-suggestions', {
    status: 200,
    json: { success: true, data: { taskId: 'w2-inspection-001', featureKey: 'print_param_prefill', derivation: 'deterministic_rules', advisory: true, available: false, unavailableReason: { code: 'W2_NONE', text: '这次没有建议' }, capabilityProfile: null, items: [], notices: [], evidence: null, disclaimer: '', generatedAt: NOW } },
  })
}

/** 已经停在登录页时，用屏幕键盘完成短信登录（不重开页面：一体机登录态只在内存里，重开就丢）。 */
async function loginOnCurrentPage(page: Page, returnPath: string): Promise<void> {
  await page.getByRole('checkbox', { name: /我已阅读并同意/ }).click()
  await page.getByRole('button', { name: '手机号（11 位本人号码）', exact: true }).click()
  for (const digit of '13800138000') await page.getByRole('button', { name: digit, exact: true }).click()
  await page.getByRole('button', { name: '收起键盘', exact: true }).click()
  await page.getByRole('button', { name: '获取验证码', exact: true }).click()
  await page.getByRole('button', { name: '短信验证码', exact: true }).click()
  for (const digit of '123456') await page.getByRole('button', { name: digit, exact: true }).click()
  await page.getByRole('button', { name: '收起键盘', exact: true }).click()
  await page.getByRole('button', { name: '确认登录', exact: true }).click()
  await page.waitForURL((url) => `${url.pathname}${url.search}` === returnPath)
}

/**
 * 在页面 fetch 出口记下每一次报价请求体。
 * SPA 跳转窗口里 Playwright 读已拦截 POST 的 postDataJSON() 会是空的（fusion-w2-print 有同样的记录），
 * 所以在页面里抓，应答仍只由 ApiRouter 给。
 */
async function captureQuoteBodies(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window)
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const method = String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase()
      if (method === 'POST' && String(url).includes('/orders/quote')) {
        const marker = window as Window & { __p05QuoteBodies?: unknown[] }
        marker.__p05QuoteBodies = marker.__p05QuoteBodies ?? []
        const body = typeof init?.body === 'string' ? init.body : null
        try {
          marker.__p05QuoteBodies.push(body ? JSON.parse(body) : null)
        } catch {
          marker.__p05QuoteBodies.push(body)
        }
      }
      return originalFetch(input, init)
    }
  })
}

async function lastQuoteBody(page: Page): Promise<{ fileUrl?: string; params?: Record<string, unknown> } | null> {
  return page.evaluate(() => {
    const bodies = (window as Window & { __p05QuoteBodies?: Array<{ fileUrl?: string; params?: Record<string, unknown> }> }).__p05QuoteBodies
    return bodies?.[bodies.length - 1] ?? null
  })
}

// ── 来源：优化稿（W3 已有的导出夹具，打印链接的到期时间改成远期）───────────────────

const OPT_TASK = 'p05-opt-task'
const OPT_FILE = {
  fileId: 'optimized-file-p05',
  filename: '优化版简历-交接验收.pdf',
  sizeBytes: 4096,
  pageCount: 1,
  signedUrl: '/p05-fixtures/optimized-resume.pdf',
  printFileUrl: `/api/v1/files/optimized-file-p05/content?expires=${FAR_EXPIRES}&sig=p05opt`,
}

async function registerOptimizeSource(page: Page, api: ApiRouter): Promise<void> {
  const optimizedResume = {
    basic: { name: '测试用户', city: '青岛' },
    intention: { position: '前端开发工程师', city: '青岛' },
    summary: '基于本人真实经历整理的简历摘要。',
    education: [{ school: '交接验收大学', major: '计算机科学', degree: '本科' }],
    experience: [],
    projects: [],
    skills: ['TypeScript'],
    certificates: [],
  }
  await page.route('**/p05-fixtures/optimized-resume.pdf', (route) => route.fulfill({ status: 200, contentType: 'application/pdf', body: VISIBLE_PDF }))
  // 打印链接本身也是真能读到的 PDF：返回预览时参数页要画出这一份。
  await page.route((url) => url.pathname === '/api/v1/files/optimized-file-p05/content', (route) =>
    route.fulfill({ status: 200, contentType: 'application/pdf', body: VISIBLE_PDF }))
  api.respond('GET', `/api/v1/resume/records/${OPT_TASK}/optimize`, {
    status: 200,
    json: { taskId: OPT_TASK, status: 'completed', providerName: 'llm', modules: [], optimizedResume },
  })
  api.respond('POST', '/api/v1/resume/generate/export', {
    status: 200,
    json: { ...OPT_FILE, expiresAt: new Date(FAR_EXPIRES).toISOString() },
  })
}

/** 在优化稿页导出 PDF：导出后预览层会自动弹出（B-14 的那一层）。返回这层对话框。 */
async function exportOptimized(page: Page) {
  await page.goto(`/resume/optimize?taskId=${OPT_TASK}`)
  await expect(page.locator('[data-kiosk-screen="resume-optimize"]')).toBeVisible()
  await page.getByRole('button', { name: '导出 PDF', exact: true }).first().click()
  await page.getByRole('checkbox', { name: /交接验收大学/ }).click()
  await page.getByRole('button', { name: '确认导出' }).click()
  // 导出成功后预览层自动弹出（预览 = 导出 = 打印同一份）。
  const dialog = page.getByRole('dialog', { name: OPT_FILE.filename })
  await expect(dialog).toBeVisible({ timeout: 10_000 })
  return dialog
}

/** 关掉预览层，点「去打印优化版」进报价确认页。 */
async function printOptimizedFromPanel(page: Page): Promise<void> {
  await page.getByRole('button', { name: '关闭文件预览' }).click()
  await expect(page.getByRole('dialog', { name: OPT_FILE.filename })).toHaveCount(0)
  await page.getByRole('button', { name: '去打印优化版' }).click()
  await page.waitForURL((url) => url.pathname === '/print/confirm')
  await expect(page.locator('[data-w2-page="print-confirm"]')).toBeVisible()
  await expect(page.locator('.print-file-name')).toHaveText(OPT_FILE.filename)
}

async function expectConfirmShows(page: Page, name: string): Promise<void> {
  await expect(page.locator('[data-w2-page="print-confirm"]')).toBeVisible()
  // 先断「没换成上一份」「没丢」：旧代码上红在这两句，失败信息直接说出换成了谁 / 落到了空态。
  await expect(page.getByText(STALE_NAME)).toHaveCount(0)
  await expect(page.locator('[data-w2-page="print-confirm"]')).not.toHaveAttribute('data-state', 'missing-context')
  await expect(page.locator('.print-file-name')).toHaveText(name)
}

// ── H1 登录回跳 ───────────────────────────────────────────────────────────────

for (const scenario of [
  { name: 'H1 login return keeps this file and never falls back to a stale one', withStale: true },
  { name: 'H1b login return keeps this file when no earlier context exists', withStale: false },
]) {
  test(`${scenario.name} @w2`, async ({ page, api }) => {
    const errors = runtimeErrors(page)
    registerPrintShell(api)
    registerMemberLogin(api)
    await registerOptimizeSource(page, api)
    await captureQuoteBodies(page)

    const dialog = await exportOptimized(page)
    await expect(dialog).toBeVisible()
    // 旧会话 A：上一次办理留下的、检查齐全的另一份文件（W2_FILE）。
    if (scenario.withStale) await writePrintHandoff(page, { contextId: 'stale-ctx-000000000001' })
    await printOptimizedFromPanel(page)

    await page.getByRole('button', { name: '去登录查看我的权益' }).click()
    await page.waitForURL((url) => url.pathname === '/login')
    // 回跳地址只放路由路径：不带文件编号、打印链接、签名，也不带交接编号。
    const loginUrl = decodeURIComponent(page.url())
    expect(loginUrl).toContain('from=/print/confirm')
    expect(loginUrl).not.toMatch(/fileId|fileUrl|optimized-file|sig=|content\?|contextId|printContext/)

    await loginOnCurrentPage(page, '/print/confirm')
    await expectConfirmShows(page, OPT_FILE.filename)
    await expect.poll(() => lastQuoteBody(page).then((body) => body?.fileUrl ?? null)).toBe(OPT_FILE.printFileUrl)
    expect(errors).toEqual([])
  })
}

// ── H2 返回预览 ───────────────────────────────────────────────────────────────

test('H2 back to preview keeps this file instead of rehydrating a stale one @w2', async ({ page, api }) => {
  const errors = runtimeErrors(page)
  registerPrintShell(api)
  await registerOptimizeSource(page, api)
  // 上一份 A 检查过、带着体检任务编号：参数页拿到 A 时会去要 A 的参数建议。登记上，免得失败信息被「未登记请求」盖住。
  registerNoSuggestions(api)
  const binary = new FusionW2BinaryRoute(page)
  await binary.install()

  await exportOptimized(page)
  await writePrintHandoff(page, { contextId: 'stale-ctx-000000000002' })
  await printOptimizedFromPanel(page)

  await page.getByRole('button', { name: '返回预览与参数' }).click()
  await page.waitForURL((url) => url.pathname === '/print/desk' && url.searchParams.get('step') === 'preview')
  // 优化稿是派生产物，免检查：直接进参数页，画的是这一份。
  await expect(page.locator('[data-w2-page="print-preview"]')).toHaveAttribute('data-qx-state', 'preview')
  await expect(page.getByText(STALE_NAME)).toHaveCount(0)
  await expect(page.getByText(OPT_FILE.filename).first()).toBeVisible()
  expect(errors).toEqual([])
})

// ── H3 F02：带进来的双面本机没开通，报价页不拦截 ─────────────────────────────

const MATERIAL_TEMPLATE = {
  id: 'campus-cover-letter', type: 'cover_letter', title: '校招自荐信', description: '适合应届生在校招现场生成一页自荐材料。',
  tags: ['校招'], status: 'published', recommendedFor: '应届毕业生', outputFilename: '校招自荐信.pdf',
  fields: [
    { key: 'applicantName', label: '姓名', required: true, maxLength: 40, placeholder: '例：王同学' },
    { key: 'targetRole', label: '目标岗位', required: true, maxLength: 60, placeholder: '例：前端开发工程师' },
  ],
}
const MATERIAL_FILE = {
  templateId: 'campus-cover-letter', templateTitle: '校招自荐信', documentType: 'cover_letter', fileId: 'jm-p05-001',
  filename: '校招自荐信-交接验收.pdf', mimeType: 'application/pdf', sizeBytes: 132096, pageCount: 2,
  signedUrl: '/api/v1/files/jm-p05-001/content?sig=download', signedUrlExpiresAt: '2099-01-01T02:30:00.000Z',
  fileExpiresAt: '2099-03-01T00:00:00.000Z', previewUrlPath: '/files/jm-p05-001/preview-url',
  downloadUrlPath: '/files/jm-p05-001/download-url', printFileUrl: `/api/v1/files/jm-p05-001/content?expires=${FAR_EXPIRES}&sig=p05jm`,
}

test('H3 F02 a two-page job material on a simplex-only terminal is quoted single-sided without blocking @w2', async ({ page, api }) => {
  const errors = runtimeErrors(page)
  registerPrintShell(api) // 双面未登记 = 本机暂未开通
  registerMemberLogin(api)
  api.respond('GET', '/api/v1/job-materials/templates', { status: 200, json: { success: true, data: [MATERIAL_TEMPLATE] } })
  api.respond('POST', '/api/v1/job-materials/generate', { status: 200, json: { success: true, data: MATERIAL_FILE } })
  await captureQuoteBodies(page)

  await page.goto(`/login?from=${encodeURIComponent('/resume/materials')}`)
  await loginOnCurrentPage(page, '/resume/materials')
  await page.locator('#material-field-applicantName').fill('王同学')
  await page.locator('#material-field-targetRole').fill('用户运营专员')
  await page.locator('.qx-ctabar').getByRole('button', { name: '生成可打印版', exact: true }).click()
  await expect(page.getByTestId('material-workshop-file')).toHaveAttribute('data-print-ready', '1')
  await page.locator('.qx-ctabar').getByRole('button', { name: '打印材料', exact: true }).click()
  await page.waitForURL((url) => url.pathname === '/print/confirm')

  const confirm = page.locator('[data-w2-page="print-confirm"]')
  await expect(page.locator('.print-file-name')).toHaveText(MATERIAL_FILE.filename)
  // 不拦截：不再出「参数回到黑白单面后可确认」的锁死按钮（旧代码红在这一句）。
  await expect(page.getByRole('button', { name: '参数回到黑白单面后可确认' })).toHaveCount(0)
  // 被改的那一项就地写明「已按单面报价」，价格照常报出来，主按钮能点。
  await expect(confirm.getByText('已按单面报价')).toBeVisible()
  await expect.poll(() => lastQuoteBody(page).then((body) => body?.params?.['duplex'] ?? null)).toBe('simplex')
  await expect(page.getByTestId('print-confirm-amount')).toHaveText(/2\.00/)
  await expect(page.getByRole('button', { name: /确认并去付款/ })).toBeEnabled()
  expect(errors).toEqual([])
})

// ── H4 F20：预览页的彩色 / 双面选择在往返后保留 ──────────────────────────────

test('H4 F20 color and duplex picked on a verified terminal survive the round trip to confirm @w2', async ({ page, api }) => {
  const errors = runtimeErrors(page)
  registerPrintShell(api, ['color_print', 'duplex_print'])
  registerNoSuggestions(api)
  const binary = new FusionW2BinaryRoute(page)
  await binary.install()
  await seedPrintHandoff(page, { printParams: null })

  await page.goto('/print/desk?step=preview')
  const preview = page.locator('[data-w2-page="print-preview"]')
  await expect(preview).toHaveAttribute('data-qx-state', 'preview')
  await preview.getByRole('button', { name: '彩色', exact: true }).click()
  await preview.getByRole('button', { name: '双面（长边）', exact: true }).click()
  await expect(preview.getByRole('button', { name: '彩色', exact: true })).toHaveAttribute('data-selected', 'true')
  await page.getByRole('button', { name: '下一步：核对价格' }).click()
  await page.waitForURL((url) => url.pathname === '/print/confirm')
  await expect(page.locator('[data-sum-row="色彩模式"] .v')).toHaveText('彩色')

  await page.getByRole('button', { name: '返回预览与参数' }).click()
  await page.waitForURL((url) => url.pathname === '/print/desk' && url.searchParams.get('step') === 'preview')
  await expect(preview).toHaveAttribute('data-qx-state', 'preview')
  await expect(preview.getByRole('button', { name: '彩色', exact: true })).toHaveAttribute('data-selected', 'true')
  await expect(preview.getByRole('button', { name: '双面（长边）', exact: true })).toHaveAttribute('data-selected', 'true')
  expect(errors).toEqual([])
})

// ── H5 F09：小青作业「打印带走」进打印链 ─────────────────────────────────────

test('H5 F09 advisor work print enters the print chain and a guest is never told it was saved @w2', async ({ page, api }) => {
  const errors = runtimeErrors(page)
  registerPrintShell(api)
  api.respond('GET', '/api/v1/advisor/sessions/p05-art-sess', {
    status: 200,
    json: {
      sessionId: 'p05-art-sess',
      expiresAt: '2099-01-01T00:00:00.000Z',
      artifacts: [{
        artifactId: 'p05-art-1',
        kind: 'compare_report',
        status: 'completed',
        payload: {
          kind: 'compare_report',
          summary: '逐条比对',
          extras: [],
          items: [{ requirement: '两年以上社群运营经验', verdict: 'covered', evidence: '我做过两年社群运营' }],
        },
        provider: 'llm:deepseek',
        printedFileId: null,
        createdAt: NOW,
        updatedAt: NOW,
        expiresAt: '2099-01-01T00:00:00.000Z',
      }],
    },
  })
  api.respond('POST', '/api/v1/advisor/sessions/p05-art-sess/artifacts/p05-art-1/print', {
    status: 200,
    json: {
      artifactId: 'p05-art-1',
      kind: 'compare_report',
      fileId: 'file-p05-art',
      filename: 'AI顾问-逐条比对表-交接验收.pdf',
      sizeBytes: 2048,
      pageCount: 1,
      signedUrl: '/signed/file-p05-art',
      expiresAt: '2099-01-01T00:00:00.000Z',
      printFileUrl: `/api/v1/files/file-p05-art/content?expires=${FAR_EXPIRES}&sig=p05art`,
      savedToDocuments: false,
    },
  })

  await page.goto('/ai/plan?sessionId=p05-art-sess&artifactId=p05-art-1')
  await expect(page.getByTestId('advisor-artifact-compare')).toBeVisible()
  await page.getByTestId('advisor-artifact-cta-print').click()
  // 旧代码停在原页、写「已保存到我的文档」：红在这里（地址没有变成 /print/confirm）。
  await expect(page).toHaveURL(/\/print\/confirm$/, { timeout: 10_000 })
  await expect(page.locator('.print-file-name')).toHaveText('AI顾问-逐条比对表-交接验收.pdf')
  await expect(page.getByText('已保存到我的文档')).toHaveCount(0)
  expect(errors).toEqual([])
})

// ── H6 B-14：导出后自动弹出的预览层里就能去打印 ─────────────────────────────

test('H6 B-14 the auto-opened optimized preview offers print for this very file @w2', async ({ page, api }) => {
  const errors = runtimeErrors(page)
  registerPrintShell(api)
  await registerOptimizeSource(page, api)

  const dialog = await exportOptimized(page)
  await dialog.getByRole('button', { name: '去打印这一份' }).click()
  await page.waitForURL((url) => url.pathname === '/print/confirm')
  await expect(page.locator('.print-file-name')).toHaveText(OPT_FILE.filename)
  expect(errors).toEqual([])
})

// ── H7 归属（辅助）：结束使用后打印台只剩空态 ─────────────────────────────────

test('H7 after 结束使用 the print desk shows only the empty state @w2', async ({ page, api }) => {
  const errors = runtimeErrors(page)
  registerPrintShell(api)
  registerMemberLogin(api)
  const doc = {
    id: 'doc-p05-report', filename: '简历对照-交接验收.pdf', mimeType: 'application/pdf', sizeBytes: 245_760,
    purpose: 'print_doc', sensitiveLevel: 'normal', assetCategory: 'derived', retentionPolicy: 'months_3',
    allowedRetentionPolicies: ['months_3', 'months_6', 'long_term'], createdAt: NOW, expiresAt: '2099-03-01T00:00:00.000Z',
    downloadUrlPath: '/files/doc-p05-report/download-url', previewUrlPath: '/files/doc-p05-report/preview-url', reprintable: true,
  }
  api.respond('GET', '/api/v1/me/documents', { status: 200, json: { success: true, data: { items: [doc], nextCursor: null, total: 1 } } })
  // 「我的」页头的资产计数与首页（结束使用后回到首页）要读的接口，一律给空。
  api.respond('GET', '/api/v1/me/print-orders', { status: 200, json: { success: true, data: { items: [], nextCursor: null, total: 0 } } })
  api.respond('GET', '/api/v1/me/ai-records', { status: 200, json: { success: true, data: { items: [], nextCursor: null, total: 0 } } })
  api.respond('GET', '/api/v1/jobs', { status: 200, json: { data: [], pagination: { page: 1, pageSize: 1, total: 0, totalPages: 0 } } })
  api.respond('GET', '/api/v1/job-fairs', { status: 200, json: { data: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 } } })
  api.respond('GET', '/api/v1/files/doc-p05-report/preview-url', {
    status: 200,
    json: { success: true, data: { fileId: doc.id, url: '/api/v1/files/doc-p05-report/content?sig=preview', printFileUrl: `/api/v1/files/doc-p05-report/content?expires=${FAR_EXPIRES}&sig=print`, expiresAt: '2099-03-01T00:00:00.000Z', disposition: 'inline' } },
  })

  await page.goto(`/login?from=${encodeURIComponent('/me/documents')}`)
  await loginOnCurrentPage(page, '/me/documents')
  await page.getByTestId('member-assets-document').filter({ hasText: doc.filename }).getByRole('button', { name: '用于打印', exact: true }).click()
  await page.waitForURL((url) => url.pathname === '/print/confirm')
  await expect(page.locator('.print-file-name')).toHaveText(doc.filename)

  await page.getByRole('button', { name: '我的', exact: true }).first().click()
  await page.waitForURL((url) => url.pathname === '/profile')
  // 结束使用 = 同步清场 + 登出，再整页重载回首页（与闲置清场同一目的地）。等重载落定，别和它抢。
  const reloaded = page.waitForEvent('load')
  await page.getByTestId('profile-primary').click()
  await reloaded
  await expect(page).toHaveURL((url) => url.pathname === '/')
  await expect(page.getByTestId('qx-home')).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.sessionStorage.getItem('ai-job-print:current-print-material-check'))).toBeNull()

  // 清场立了隐私边界：地址栏直接打开的旧历史项会被当成边界之前的条目送回首页，
  // 所以用站内跳转（idx 在边界之后）去打印台，和用户在机器上点过去是同一条路。
  await page.evaluate(() => {
    const current = window.history.state as { idx?: number } | null
    const idx = typeof current?.idx === 'number' ? current.idx + 1 : 1
    window.history.pushState({ usr: null, key: 'p05-h7', idx }, '', '/print/desk')
    window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }))
  })
  await page.waitForURL((url) => url.pathname === '/print/desk')
  await expect(page.getByRole('heading', { name: '这一页没有待处理的文件' })).toBeVisible()
  await expect(page.getByText(doc.filename)).toHaveCount(0)
  expect(errors).toEqual([])
})
