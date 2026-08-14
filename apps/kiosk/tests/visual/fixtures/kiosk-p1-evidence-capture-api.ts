import { expect, type Frame, type Page } from '@playwright/test'
import type { ApiRouter } from '../../fixtures/api-router'
import { registerW6Api } from './fusion-w6-api'
import { VISIBLE_PDF } from './fusion-w2-binary-route'
import { setReactRouterState, W2_FILE, W2_ORDER, W2_PRINT_PARAMS } from './fusion-w2-state'

const MEMBER_PHONE = '13800138000'
const MEMBER_CODE = '123456'
const MEMBER_TOKEN = 'p1-evidence-member-token'
const P1_MATERIAL_SESSION_KEY = 'ai-job-print:current-print-material-check'

async function seedP1MaterialSession(page: Page): Promise<void> {
  await page.addInitScript(
    ({ key, file, params }) => {
      if (window.top !== window) return
      const storage = window.sessionStorage
      storage.setItem(key, JSON.stringify({
        file,
        source: 'document',
        materialCheck: {
          inspectionTaskId: 'w2-inspection-001',
          normalizeTaskId: 'w2-normalize-001',
          piiTaskId: 'w2-pii-001',
          checkedAt: '2026-07-24T00:00:00.000Z',
          findingCount: 0,
          redactedCount: 0,
          keptCount: 0,
          mode: 'checked',
        },
        printParams: params,
        updatedAt: '2026-07-24T00:00:00.000Z',
      }))
    },
    { key: P1_MATERIAL_SESSION_KEY, file: W2_FILE, params: W2_PRINT_PARAMS },
  )
}

export function registerEvidenceShell(api: ApiRouter): void {
  registerW6Api(api)
  api.respond('GET', '/api/v1/terminals/KSK-001/screensaver', {
    status: 200,
    json: { enabled: false, idleTimeoutSec: 180, items: [] },
  })
  api.respond('GET', '/api/v1/terminals/KSK-001/printer-status', {
    status: 200,
    json: { printerStatus: 'ready', paperLevel: 'sufficient', isOnline: true },
  })
  api.respond('GET', '/api/v1/terminals/KSK-001/config', {
    status: 200,
    json: {
      smartCampus: { enabled: true, modules: { welcome: true, bigdata: false, luggage: true, panorama: true }, items: [] },
      toolbox: {
        enabled: true,
        items: [{
          key: 'policy-guide',
          title: '政策指引',
          description: '合成百宝箱服务',
          icon: 'book-open',
          to: '/policy-service',
          disabled: false,
          sortOrder: 1,
          launchMode: 'internal_route',
          placements: ['toolbox'],
        }],
      },
      configVersion: 'p1-evidence',
      refreshIntervalMs: 300000,
      serverTime: '2026-07-26T00:00:00.000Z',
    },
  })
}

export function registerMemberLogin(api: ApiRouter): void {
  api.respond('GET', '/api/v1/kiosk/legal/terms_of_service', {
    status: 200,
    json: { success: true, data: null },
  })
  api.respond('GET', '/api/v1/kiosk/legal/privacy_policy', {
    status: 200,
    json: { success: true, data: null },
  })
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
        user: { id: 'member-p1', phoneMasked: '138****8000', nickname: '视觉验收用户' },
      },
    },
  })
}

export function registerAuthenticatedMemberApis(api: ApiRouter): void {
  const emptyList = { success: true, data: { items: [], nextCursor: null, total: 0 } }
  for (const path of [
    '/api/v1/me/resumes',
    '/api/v1/me/documents',
    '/api/v1/me/print-orders',
    '/api/v1/me/ai-records',
    '/api/v1/me/favorites',
    '/api/v1/me/benefits',
    '/api/v1/me/activity',
    '/api/v1/me/notifications',
    '/api/v1/me/feedback',
    '/api/v1/me/privacy-requests',
  ]) {
    api.respond('GET', path, { status: 200, json: emptyList })
  }
  api.respond('GET', '/api/v1/me/settings', {
    status: 200,
    json: {
      success: true,
      data: {
        phoneMasked: '138****8000',
        nickname: '视觉验收用户',
        consents: { job_ai: { status: 'granted' } },
      },
    },
  })
  api.respond('GET', '/api/v1/me/overview', {
    status: 200,
    json: {
      success: true,
      data: {
        resumeCount: 0,
        documentCount: 0,
        printOrderCount: 0,
        aiRecordCount: 0,
        favoriteCount: 0,
        benefitCount: 0,
      },
    },
  })
  api.respond('GET', '/api/v1/me', {
    status: 200,
    json: {
      success: true,
      data: { id: 'member-p1', phoneMasked: '138****8000', nickname: '视觉验收用户' },
    },
  })
}

export async function loginThroughVisibleUi(page: Page, returnTo: string): Promise<void> {
  await page.goto(`/login?from=${encodeURIComponent(returnTo)}`)
  const phoneTab = page.getByRole('button', { name: '手机号登录', exact: true })
  if (await phoneTab.count()) await phoneTab.click()
  await page.getByRole('checkbox', { name: /我已阅读并同意/ }).click()
  for (const digit of MEMBER_PHONE) await page.getByRole('button', { name: digit, exact: true }).click()
  await page.getByRole('button', { name: '获取验证码', exact: true }).click()
  const smsTab = page.getByRole('button', { name: '短信验证码', exact: true })
  if (await smsTab.count()) await smsTab.click()
  for (const digit of MEMBER_CODE) await page.getByRole('button', { name: digit, exact: true }).click()
  await page.getByRole('button', { name: '验证并登录', exact: true }).click()
  await page.waitForURL((url) => url.pathname === returnTo)
}

export async function prepareSessionTimeoutCapture(page: Page, api: ApiRouter): Promise<void> {
  api.respond('GET', '/api/v1/terminals/KSK-001/screensaver', {
    status: 200,
    json: { enabled: false, idleTimeoutSec: 4, items: [] },
  })
  await page.goto('/interview/tips', { waitUntil: 'domcontentloaded' })
  await page.waitForURL((url) => url.pathname === '/session-timeout', { timeout: 220_000 })
  await page.locator('[data-kiosk-screen="session-timeout"]').waitFor({ state: 'visible', timeout: 5_000 })
}

export async function seedPrintFlow(page: Page, path: string, extra: Record<string, unknown> = {}): Promise<void> {
  await seedP1MaterialSession(page)
  await page.goto(path)
  await setReactRouterState(page, path, {
    file: W2_FILE,
    params: W2_PRINT_PARAMS,
    source: 'document',
    materialCheck: {
      inspectionTaskId: 'w2-inspection-001',
      normalizeTaskId: 'w2-normalize-001',
      piiTaskId: 'w2-pii-001',
      checkedAt: '2026-07-24T00:00:00.000Z',
      findingCount: 0,
      redactedCount: 0,
      keptCount: 0,
      mode: 'checked',
    },
    ...extra,
  })
}

export async function seedMaterialCheckReview(page: Page): Promise<string> {
  const accessToken = 'raw-p1-material-fixture-token'
  const now = '2026-07-24T00:00:00.000Z'
  const expiresAt = '2026-07-25T00:00:00.000Z'
  const allowedKinds = new Set(['inspection', 'normalize_a4', 'pii_scan'])

  await page.route('**/api/v1/materials/tasks', async (route) => {
    const request = route.request()
    if (request.method() !== 'POST' || new URL(request.url()).pathname !== '/api/v1/materials/tasks') {
      await route.fallback()
      return
    }

    let kind: string | undefined
    try {
      kind = (request.postDataJSON() as { kind?: unknown }).kind as string | undefined
    } catch {
      await route.abort('blockedbyclient')
      return
    }
    if (!kind || !allowedKinds.has(kind)) {
      await route.abort('blockedbyclient')
      return
    }

    const checks = kind === 'inspection'
      ? { pageCount: 2, canPrint: true, messages: [] }
      : kind === 'normalize_a4'
        ? { targetPaperSize: 'A4', canNormalize: true, messages: [] }
        : undefined
    const task = {
      id: `p1-${kind}`,
      kind,
      status: 'completed',
      requesterMode: 'anonymous',
      accessToken,
      sourceFileId: W2_FILE.fileId,
      resultFileId: null,
      endUserId: null,
      params: {},
      result: checks ? { mode: 'real', checks } : { mode: 'real' },
      errorCode: null,
      errorMessage: null,
      expiresAt,
      createdAt: now,
      updatedAt: now,
      ...(kind === 'pii_scan' ? { piiFindings: [] } : {}),
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: task }),
    })
  })

  await seedPrintFlow(page, '/print/material-check')
  await page.getByText('可以继续设置打印参数', { exact: true }).waitFor({ state: 'visible' })
  return accessToken
}

export async function preparePrintPreviewCapture(page: Page): Promise<void> {
  const fixturePath = '/w2-fixtures/sample-visible.pdf'
  await page.route('**/w2-fixtures/**', async (route) => {
    if (new URL(route.request().url()).pathname !== fixturePath) {
      await route.abort('blockedbyclient')
      return
    }
    await route.fulfill({ status: 200, contentType: 'application/pdf', body: VISIBLE_PDF })
  })

  const pdfResponse = page.waitForResponse((response) => {
    return new URL(response.url()).pathname === fixturePath && response.status() === 200
  })
  await seedPrintFlow(page, '/print/preview')
  await page.getByTitle(`${W2_FILE.name} 预览`).waitFor({ state: 'visible' })
  const response = await pdfResponse
  if (response.status() !== 200) throw new Error(`synthetic preview PDF returned HTTP ${response.status()}`)

  const isInFrameChain = (frame: Frame, root: Frame): boolean => {
    let current: Frame | null = frame
    while (current) {
      if (current === root) return true
      current = current.parentFrame()
    }
    return false
  }
  const parseFrameUrl = (frameUrl: string): URL | null => {
    try {
      return new URL(frameUrl)
    } catch {
      return null
    }
  }

  const readyState = {
    outerPdfFrameUnique: true,
    viewerFrameUnique: true,
    contentFrameUnique: true,
    pdfViewerUnique: true,
    shadowRootFound: true,
    pluginFound: true,
    pluginTagEmbed: true,
    pluginTypePdf: true,
    originalUrlPresent: true,
    originalUrlExact: true,
    outerPluginPositiveSize: true,
    innerDocPositiveSize: true,
    innerSizerFound: true,
    innerSizerPositiveSize: true,
    innerEmbedUnique: true,
    innerEmbedTagEmbed: true,
    innerEmbedTypePdf: true,
    innerEmbedPositiveSize: true,
  }

  await expect.poll(async () => {
    const state = Object.fromEntries(
      Object.keys(readyState).map((key) => [key, false]),
    ) as typeof readyState
    const frames = page.frames()
    const pageOrigin = new URL(page.url()).origin
    const outerPdfFrames = frames.filter((frame) => {
      const url = parseFrameUrl(frame.url())
      return url?.origin === pageOrigin
        && url.pathname === fixturePath
        && frame.parentFrame() === page.mainFrame()
    })
    state.outerPdfFrameUnique = outerPdfFrames.length === 1
    if (!state.outerPdfFrameUnique) return state

    const outerPdfFrame = outerPdfFrames[0]
    const viewerFrames = frames.filter((frame) => {
      const url = parseFrameUrl(frame.url())
      return url?.protocol === 'chrome-extension:'
        && url.pathname === '/index.html'
        && isInFrameChain(frame, outerPdfFrame)
    })
    state.viewerFrameUnique = viewerFrames.length === 1
    if (!state.viewerFrameUnique) return state

    const viewerFrame = viewerFrames[0]
    const viewerChain = frames.filter((frame) => isInFrameChain(frame, viewerFrame))
    const innerContentFrames = viewerChain.filter((frame) => {
      if (frame === viewerFrame) return false
      const url = parseFrameUrl(frame.url())
      return url?.origin === pageOrigin && url.pathname === fixturePath
    })
    state.contentFrameUnique = innerContentFrames.length === 1
    if (!state.contentFrameUnique) return state
    const innerContentFrame = innerContentFrames[0]

    try {
      const pdfViewers = viewerFrame.locator('pdf-viewer')
      state.pdfViewerUnique = await pdfViewers.count() === 1
      if (!state.pdfViewerUnique) return state

      const outerShadowState = await pdfViewers.evaluate((viewer, expected) => {
        const shadowRoot = viewer.shadowRoot
        if (!shadowRoot) {
          return {
            shadowRootFound: false,
            pluginFound: false,
            pluginTagEmbed: false,
            pluginTypePdf: false,
            originalUrlPresent: false,
            originalUrlExact: false,
            outerPluginPositiveSize: false,
          }
        }

        const plugin = shadowRoot.querySelector('#plugin')
        const originalUrl = plugin?.getAttribute('original-url')?.trim() ?? ''
        let originalUrlExact = false
        if (originalUrl) {
          try {
            const parsed = new URL(originalUrl)
            originalUrlExact = parsed.origin === expected.pageOrigin
              && parsed.pathname === expected.fixturePath
          } catch {
            originalUrlExact = false
          }
        }

        const pluginBox = plugin?.getBoundingClientRect()
        return {
          shadowRootFound: true,
          pluginFound: Boolean(plugin),
          pluginTagEmbed: plugin?.tagName === 'EMBED',
          pluginTypePdf: plugin?.getAttribute('type') === 'application/x-google-chrome-pdf',
          originalUrlPresent: originalUrl.length > 0,
          originalUrlExact,
          outerPluginPositiveSize: Boolean(
            pluginBox && pluginBox.width > 0 && pluginBox.height > 0,
          ),
        }
      }, { pageOrigin, fixturePath })

      const innerState = await innerContentFrame.evaluate(() => {
        const docElementBox = document.documentElement?.getBoundingClientRect()
        const bodyBox = document.body?.getBoundingClientRect()
        const docElementPositive = Boolean(
          docElementBox && docElementBox.width > 0 && docElementBox.height > 0,
        )
        const bodyPositive = Boolean(
          bodyBox && bodyBox.width > 0 && bodyBox.height > 0,
        )

        const sizer = document.querySelector('#sizer')
        const sizerBox = sizer?.getBoundingClientRect()
        const embeds = Array.from(document.querySelectorAll('embed'))
        const embed = embeds.length === 1 ? embeds[0] : null
        const embedBox = embed?.getBoundingClientRect()

        return {
          innerDocPositiveSize: docElementPositive && bodyPositive,
          innerSizerFound: Boolean(sizer),
          innerSizerPositiveSize: Boolean(
            sizerBox && sizerBox.width > 0 && sizerBox.height > 0,
          ),
          innerEmbedUnique: embeds.length === 1,
          innerEmbedTagEmbed: embed?.tagName === 'EMBED',
          innerEmbedTypePdf: embed?.getAttribute('type') === 'application/x-google-chrome-pdf',
          innerEmbedPositiveSize: Boolean(
            embedBox && embedBox.width > 0 && embedBox.height > 0,
          ),
        }
      })

      return { ...state, ...outerShadowState, ...innerState }
    } catch {
      return state
    }
  }, {
    message: 'official Chrome PDF viewer must render the exact synthetic PDF in the unique inner content frame with positive-size DOM',
    timeout: 15_000,
  }).toEqual(readyState)
}

export async function seedCashierPending(page: Page, api: ApiRouter): Promise<void> {
  api.respond('GET', `/api/v1/print/orders/${W2_ORDER.orderId}`, {
    status: 200,
    json: {
      orderId: W2_ORDER.orderId,
      orderNo: W2_ORDER.orderNo,
      status: 'unpaid',
      amountCents: W2_ORDER.amountCents,
      paymentStatus: 'pending',
      taskId: W2_ORDER.taskId,
    },
  })
  await seedPrintFlow(page, '/print/cashier', { order: W2_ORDER })
}

export async function seedCashierFailed(page: Page, api: ApiRouter): Promise<void> {
  api.respond('GET', `/api/v1/print/orders/${W2_ORDER.orderId}`, {
    status: 200,
    json: {
      orderId: W2_ORDER.orderId,
      orderNo: W2_ORDER.orderNo,
      status: 'unpaid',
      amountCents: W2_ORDER.amountCents,
      paymentStatus: 'failed',
      failureReasonForUser: '支付未完成，请重新发起',
      taskId: W2_ORDER.taskId,
    },
  })
  await seedPrintFlow(page, '/print/cashier', { order: W2_ORDER, paymentState: 'failed' })
}

export async function seedPrintProgress(page: Page, api: ApiRouter): Promise<void> {
  api.respond('GET', `/api/v1/print/jobs/${W2_ORDER.taskId}`, {
    status: 200,
    json: { taskId: W2_ORDER.taskId, status: 'printing', progressPercent: 42 },
  })
  await seedPrintFlow(page, '/print/progress', { taskId: W2_ORDER.taskId, order: W2_ORDER })
}

export async function seedPrintDoneCompleted(page: Page, api: ApiRouter): Promise<void> {
  api.respond('GET', `/api/v1/print/jobs/${W2_ORDER.taskId}`, {
    status: 200,
    json: { taskId: W2_ORDER.taskId, status: 'completed', completedAt: '2026-07-26T00:00:00.000Z' },
  })
  await seedPrintFlow(page, '/print/done', { taskId: W2_ORDER.taskId, file: W2_FILE, params: W2_PRINT_PARAMS, source: 'document' })
}

export function registerEmptyToolbox(api: ApiRouter): void {
  api.respond('GET', '/api/v1/terminals/KSK-001/config', {
    status: 200,
    json: {
      smartCampus: {
        enabled: false,
        modules: { welcome: false, bigdata: false, luggage: false, panorama: false },
        items: [],
      },
      toolbox: { enabled: false, items: [] },
      configVersion: 'p1-evidence-empty-toolbox',
      refreshIntervalMs: 300000,
      serverTime: '2026-07-26T00:00:00.000Z',
    },
  })
}

export async function seedScreensaver(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (window.location.pathname !== '/screensaver') return
    window.history.replaceState({
      usr: {
        playlist: {
          enabled: true,
          idleTimeoutSec: 180,
          items: [{
            id: 'p1-screen',
            type: 'image',
            url: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/%3E',
            durationSec: 60,
            sortOrder: 0,
          }],
        },
      },
      key: 'p1-screen',
      idx: 0,
    }, '', '/screensaver')
  })
}

export async function seedScanProgress(page: Page, api: ApiRouter): Promise<void> {
  const scanTaskId = 'w2-scan-001'
  const controlToken = 'w2-scan-control'
  api.respond('GET', `/api/v1/scan/sessions/${scanTaskId}`, {
    status: 200,
    json: {
      success: true,
      data: {
        scanTaskId,
        status: 'waiting',
        scanType: 'resume',
        file: null,
        errorCode: null,
        errorMessage: null,
      },
    },
  })
  await page.goto('/scan/progress')
  await setReactRouterState(page, '/scan/progress', {
    scanTaskId,
    scanType: 'resume',
    controlToken,
  })
}

export async function openLoginVerificationError(page: Page, api: ApiRouter): Promise<void> {
  registerMemberLogin(api)
  api.respond('POST', '/api/v1/member/auth/login', {
    status: 401,
    json: {
      success: false,
      error: { code: 'SMS_CODE_INVALID', message: '验证码不正确或已过期' },
    },
  })
  await page.goto('/login')
  const phoneTab = page.getByRole('button', { name: '手机号登录', exact: true })
  if (await phoneTab.count()) await phoneTab.click()
  await page.getByRole('checkbox', { name: /我已阅读并同意/ }).click()
  for (const digit of MEMBER_PHONE) await page.getByRole('button', { name: digit, exact: true }).click()
  await page.getByRole('button', { name: '获取验证码', exact: true }).click()
  const smsTab = page.getByRole('button', { name: '短信验证码', exact: true })
  if (await smsTab.count()) await smsTab.click()
  for (const digit of MEMBER_CODE) await page.getByRole('button', { name: digit, exact: true }).click()
  await page.getByRole('button', { name: '验证并登录', exact: true }).click()
  await page.locator('[data-kiosk-screen="login"] [role="alert"]').first().waitFor({ state: 'visible', timeout: 15_000 })
}

export async function openScanSettingsCreateFailed(page: Page, api: ApiRouter): Promise<void> {
  api.respond('POST', '/api/v1/scan/sessions', {
    status: 503,
    json: {
      success: false,
      error: { code: 'SCAN_SESSION_UNAVAILABLE', message: '扫描任务未创建，请返回后重试' },
    },
  })
  await page.goto('/scan/start')
  const start = page.locator('[data-w2-page="scan-start"]')
  await start.waitFor({ state: 'visible', timeout: 15_000 })
  const cta = page.getByRole('button', { name: /开始扫描|创建扫描|文档扫描|继续/ }).first()
  if (await cta.count()) {
    await cta.click()
  } else {
    await page.goto('/scan/settings')
  }
}
