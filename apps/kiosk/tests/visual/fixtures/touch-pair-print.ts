import { expect, type Page } from '@playwright/test'
import type { ApiRouter } from '../../fixtures/api-router'
import { W2_FILE, W2_ORDER, W2_PRINT_PARAMS, writePrintHandoff } from './fusion-w2-state'
import { loginTo, openCashier, openConfirm, registerTouchShell, routeVisiblePdf, see, spaGo, stubTakeaway, terminalReady } from './touch-pair-shell'
import { openConvert } from './touch-pair-convert'
import { stubResumeUsb } from './touch-pair-resume-seeds'
import type { TouchPair } from './touch-pair-types'

function shell(api: ApiRouter, printer?: { isOnline: boolean; printerStatus: string }): void {
  registerTouchShell(api, printer)
}

async function openUpload(page: Page, api: ApiRouter, path: string): Promise<void> {
  shell(api)
  await page.goto(path, { waitUntil: 'domcontentloaded' })
  await see(page, '[data-w2-page="print-upload"]')
}

/** 材料检查三步都当场完成、隐私扫描 0 命中。页面自己发 POST，不能靠交接里的旧结论冒充。 */
// 稿 pii 默认画的是「有 2 处要你拿主意」：第 1 页身份证号、第 2 页手机号，都还没决定。
// 字段形状照 services/api/materials.ts 的 PiiFindingView；运行页读 piiFindings。
const PII_FINDINGS = [
  { id: 'pair-finding-idcard', taskId: 'pair-pii_scan', type: 'id_card', label: '身份证号', pageNumber: 1, snippet: '370202********2316', confidence: 0.93, action: 'pending', createdAt: '2026-07-24T00:00:00.000Z' },
  { id: 'pair-finding-phone', taskId: 'pair-pii_scan', type: 'phone', label: '手机号', pageNumber: 2, snippet: '138****5621', confidence: 0.91, action: 'pending', createdAt: '2026-07-24T00:00:00.000Z' },
]

async function stubMaterialChecks(page: Page, piiFindings: unknown[] = []): Promise<void> {
  const now = '2026-07-24T00:00:00.000Z'
  const expiresAt = '2026-07-25T00:00:00.000Z'
  const allowed = new Set(['inspection', 'normalize_a4', 'pii_scan'])
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
    if (!kind || !allowed.has(kind)) {
      await route.abort('blockedbyclient')
      return
    }
    const checks = kind === 'inspection'
      ? { pageCount: 2, canPrint: true, messages: [] }
      : kind === 'normalize_a4'
        ? { targetPaperSize: 'A4', canNormalize: true, messages: [] }
        : undefined
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          id: `pair-${kind}`,
          kind,
          status: 'completed',
          requesterMode: 'anonymous',
          accessToken: 'pair-material-access',
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
          ...(kind === 'pii_scan' ? { piiFindings } : {}),
        },
      }),
    })
  })
}

/** 预览页会读参数建议。不打桩时卡片显示网络失败，那不是产品文案。 */
function stubParamSuggestions(api: ApiRouter): void {
  const item = (field: 'colorMode' | 'duplex' | 'copies', label: string, suggestedValue: string | number) => ({
    field,
    label,
    status: 'suggested',
    suggestedValue,
    basis: { code: 'PAGE_COUNT', evidenceLevel: 'E1', text: '按文件页数', facts: {} },
    reason: null,
    blockedPreference: null,
    editable: true,
  })
  api.respond('GET', '/api/v1/materials/tasks/w2-inspection-001/print-param-suggestions', {
    status: 200,
    json: {
      success: true,
      data: {
        taskId: 'w2-inspection-001',
        featureKey: 'print_param_prefill',
        derivation: 'deterministic_rules',
        advisory: true,
        available: true,
        unavailableReason: null,
        capabilityProfile: {
          paperSize: 'A4',
          verifiedColorModes: ['black_white'],
          verifiedDuplexModes: ['simplex'],
          verifiedPagesPerSheet: [1],
          copiesRange: { min: 1, max: 99 },
          note: '本机已开通黑白、单面。',
        },
        items: [
          item('colorMode', '颜色', 'black_white'),
          item('duplex', '单双面', 'simplex'),
          item('copies', '份数', 1),
        ],
        notices: [],
        evidence: null,
        disclaimer: '建议可以改，不会自动下单。',
        generatedAt: '2026-11-04T00:00:00.000Z',
      },
    },
  })
}

/** 手机扫码默认态：码已出来、还在等手机。不应答上传会话时，这一屏会落成「二维码没出来」。 */
function stubPhoneQr(api: ApiRouter): void {
  const sessionId = 'pair-print-upload'
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()
  api.respond('POST', '/api/v1/upload-sessions', {
    status: 200,
    json: {
      success: true,
      data: {
        sessionId,
        uploadUrl: '/upload/phone',
        uploadToken: 'pair-upload-token',
        controlToken: 'pair-control',
        expiresAt,
      },
    },
  })
  api.respond('GET', `/api/v1/upload-sessions/${sessionId}`, {
    status: 200,
    json: {
      success: true,
      data: {
        sessionId,
        status: 'pending',
        purpose: 'print_doc',
        mode: 'temporary',
        file: null,
        requiresKioskConfirmation: true,
        expiresAt,
      },
    },
  })
}

/** print-fulfill-qx 的 flowState；先等正式构建换票，再软跳，避免旧 seedPrintFlow 与清场竞争。 */
async function openPrintTask(page: Page, api: ApiRouter, status: 'confirming' | 'printing' | 'completed'): Promise<void> {
  if (status === 'confirming') {
    // 稿 printing 默认态是「正在确认任务状态」：还没拿到终端处理状态。状态请求挂着不回，停在这一态。
    api.respondWith('GET', `/api/v1/print/jobs/${W2_ORDER.taskId}`, () => new Promise(() => undefined))
  } else {
    api.respond('GET', `/api/v1/print/jobs/${W2_ORDER.taskId}`, {
      status: 200,
      json: { taskId: W2_ORDER.taskId, status, ...(status === 'printing' ? { progressPercent: 42 } : { completedAt: '2026-07-26T00:00:00.000Z' }) },
    })
  }
  await page.goto('/print-scan')
  await terminalReady(page)
  await spaGo(page, status === 'completed' ? '/print/done' : '/print/progress', {
    ...W2_ORDER, file: W2_FILE, params: W2_PRINT_PARAMS, source: 'document',
  })
}

const pdfPhases = ['edit', 'uploading', 'composing', 'result', 'unknown', 'conflict', 'closed', 'usb'] as const

export function printPairs(): TouchPair[] {
  const pairs: TouchPair[] = [
    {
      item: '打印', screen: 'print', state: 'default', route: '/print-scan',
      seeds: ['registerTouchShell', 'capabilities available'],
      missingReason: null,
      prepare: async (page, api) => {
        shell(api)
        await page.goto('/print-scan')
        await see(page, '[data-testid="print-hub-state-default"]')
      },
    },
    {
      item: '打印', screen: 'print', state: 'printer-down', route: '/print-scan',
      seeds: ['registerTouchShell', 'printer-status offline'],
      missingReason: null,
      proto: { query: { printer: 'down' } },
      prepare: async (page, api) => {
        shell(api, { isOnline: false, printerStatus: 'offline' })
        await page.goto('/print-scan')
        await see(page, '[data-testid="print-hub-state-device-off"]')
      },
    },
    {
      item: '打印', screen: 'print-src', state: 'default', route: '/print/upload?source=document',
      seeds: ['registerTouchShell'],
      missingReason: null,
      proto: { patch: { ctx: 'print' } },
      prepare: (page, api) => openUpload(page, api, '/print/upload?source=document'),
    },
    {
      item: '打印', screen: 'print-src', state: 'logged', route: '/print/upload',
      seeds: ['registerMemberLogin', 'registerAuthenticatedMemberApis', 'loginThroughVisibleUi'],
      missingReason: null,
      proto: { query: { login: '1' }, patch: { ctx: 'print' } },
      prepare: async (page, api) => {
        shell(api)
        await loginTo(page, api, '/print/upload')
        await see(page, '[data-w2-page="print-upload"]')
      },
    },
    {
      item: '打印', screen: 'print-src', state: 'printer-down', route: '/print/upload?source=document',
      seeds: ['registerTouchShell', 'printer-status offline'],
      missingReason: null,
      proto: { query: { printer: 'down' }, patch: { ctx: 'print' } },
      prepare: async (page, api) => {
        shell(api, { isOnline: false, printerStatus: 'offline' })
        await page.goto('/print/upload?source=document')
        await see(page, '[data-w2-page="print-upload"]')
      },
    },
    {
      item: '打印', screen: 'upload', state: 'phone', route: '/print/upload?source=document&tab=qr',
      seeds: ['registerTouchShell', 'POST upload-sessions pending'],
      missingReason: null,
      proto: { patch: { ctx: 'print' } },
      prepare: async (page, api) => {
        shell(api)
        stubPhoneQr(api)
        await page.goto('/print/upload?source=document&tab=qr', { waitUntil: 'domcontentloaded' })
        await see(page, 'text=用手机扫描下方二维码')
      },
    },
    {
      item: '打印', screen: 'usb', state: 'usb', route: '/print/upload?source=document&tab=usb',
      seeds: ['registerTouchShell', 'stubResumeUsb GET status/files（只拍列表）'],
      missingReason: null,
      proto: { patch: { ctx: 'print' } },
      prepare: async (page, api) => {
        await stubResumeUsb(page)
        await openUpload(page, api, '/print/upload?source=document&tab=usb')
        await expect(page.getByRole('button', { name: /U盘简历\.pdf/ })).toBeVisible()
      },
    },
    {
      item: '打印', screen: 'pii', state: 'flagged', route: '/print/desk?step=check',
      seeds: ['stubMaterialChecks 2 处命中（身份证号、手机号，都未决定）', 'writePrintHandoff', 'spaGo'],
      missingReason: null,
      prepare: async (page, api) => {
        // 先换票，再写入还没检查过的文件，软跳进检查。检查页自己打三步接口；稿画的是 2 处待决定。
        shell(api)
        await stubMaterialChecks(page, PII_FINDINGS)
        await page.goto('/print-scan')
        await see(page, '[data-testid="print-hub-state-default"]')
        await terminalReady(page)
        await writePrintHandoff(page, { contextId: 'p1-evidence-000000001', materialCheck: null })
        await spaGo(page, '/print/desk?step=check', { printContextId: 'p1-evidence-000000001' })
        // 运行页按类型重新打码（maskSnippet），只认两行页码，不认打码后的字。
        await see(page, 'text=第 1 页 ·')
        await see(page, 'text=第 2 页 ·')
      },
    },
    {
      item: '打印', screen: 'preview', state: 'default', route: '/print/desk?step=preview',
      seeds: ['writePrintHandoff', 'w2-fixtures PDF', 'print-param-suggestions', 'spaGo'],
      missingReason: null,
      prepare: async (page, api) => {
        // 先在服务台完成换票，再写入带遮挡结论的交接，然后软跳进预览。
        // 直接打开预览再跳回来时，打印台不会重读交接，右边仍是空桌面。
        shell(api)
        stubParamSuggestions(api)
        await routeVisiblePdf(page)
        await page.goto('/print-scan')
        await see(page, '[data-testid="print-hub-state-default"]')
        await terminalReady(page)
        await writePrintHandoff(page, { contextId: 'p1-evidence-000000001' })
        await spaGo(page, '/print/desk?step=preview', { printContextId: 'p1-evidence-000000001' })
        await see(page, '[data-w2-page="print-preview"][data-qx-state="preview"]')
        await see(page, 'text=采用这些建议')
      },
    },
    {
      item: '打印', screen: 'confirm', state: 'free', route: '/print/confirm',
      seeds: ['writePrintHandoff', 'price-config billingEnabled false', 'orders/quote', 'spaGo'],
      missingReason: null,
      prepare: (page, api) => openConfirm(page, api, 'free'),
    },
    {
      item: '打印', screen: 'confirm', state: 'fee', route: '/print/confirm',
      seeds: ['writePrintHandoff', 'price-config billingEnabled true', 'orders/quote', 'spaGo'],
      missingReason: null,
      proto: { query: { fee: '1' } },
      prepare: (page, api) => openConfirm(page, api, 'fee'),
    },
    {
      item: '打印', screen: 'cashier', state: 'pending-qr', route: '/print/cashier',
      seeds: ['pay-status pending-qr', 'payment/channels wechat'],
      missingReason: null,
      proto: { query: { fee: '1' } },
      prepare: (page, api) => openCashier(page, api, 'pending-qr'),
    },
    {
      item: '打印', screen: 'cashier', state: 'expired', route: '/print/cashier',
      seeds: ['pay-status expired', 'payment/channels wechat'],
      missingReason: null,
      proto: { query: { fee: '1' }, patch: { fmCash: 'expired' } },
      prepare: (page, api) => openCashier(page, api, 'expired'),
    },
    {
      item: '打印', screen: 'printing', state: 'default', route: '/print/progress',
      seeds: ['openPrintTask confirming', 'GET print/jobs 挂起（还没拿到终端状态）'],
      missingReason: null,
      prepare: async (page, api) => {
        shell(api)
        await openPrintTask(page, api, 'confirming')
        await see(page, '[data-w2-page="print-progress"]')
        await see(page, 'text=正在确认任务状态')
      },
    },
    {
      item: '打印', screen: 'printing', state: 'quiet', route: '/print/progress',
      seeds: ['openPrintTask printing', '相同进度持续 45 秒（真实静默计时器）'],
      missingReason: null,
      proto: { patch: { fmQuiet: true } },
      prepare: async (page, api) => {
        shell(api)
        await openPrintTask(page, api, 'printing')
        await page.locator('[data-progress-quiet="true"]').waitFor({ state: 'visible', timeout: 55_000 })
        await see(page, 'text=这台机器暂时没有回报打印进度')
      },
    },
    {
      item: '打印', screen: 'unconfirmed', state: 'default', route: '/print/done',
      seeds: ['GET print/jobs PRINT_JOB_UNCONFIRMED', 'terminalReady + spaGo + W2_ORDER'],
      missingReason: null,
      prepare: async (page, api) => {
        shell(api)
        stubTakeaway(api, W2_ORDER.taskId)
        api.respond('GET', `/api/v1/print/jobs/${W2_ORDER.taskId}`, {
          status: 200,
          json: {
            taskId: W2_ORDER.taskId,
            status: 'failed',
            errorCode: 'PRINT_JOB_UNCONFIRMED',
            failureReasonForUser: '打印作业已提交到打印队列，但未确认完成，请工作人员检查纸张、卡纸和出纸状态',
          },
        })
        await page.goto('/print-scan')
        await terminalReady(page)
        await spaGo(page, '/print/done', {
          ...W2_ORDER,
          file: W2_FILE,
          params: W2_PRINT_PARAMS,
          source: 'document',
        })
        await see(page, 'text=打印结果未确认')
      },
    },
    {
      item: '打印', screen: 'done', state: 'default', route: '/print/done',
      seeds: ['openPrintTask completed', 'GET print/jobs completed'],
      missingReason: null,
      prepare: async (page, api) => {
        shell(api)
        stubTakeaway(api, W2_ORDER.taskId)
        await openPrintTask(page, api, 'completed')
        await see(page, '[data-testid="print-fulfill-state-completed"]')
      },
    },
    {
      item: '打印', screen: 'pickup', state: 'default', route: '/print/pickup-claim',
      seeds: ['registerTouchShell'],
      missingReason: null,
      prepare: async (page, api) => {
        shell(api)
        await page.goto('/print/pickup-claim')
        await see(page, '[data-w2-page="pickup-claim"]')
      },
    },
    {
      item: '打印', screen: 'pickup-ok', state: 'unpaid', route: '/print/pickup-claim',
      seeds: ['POST print/jobs/claim-pickup'],
      missingReason: null,
      prepare: async (page, api) => {
        shell(api)
        await page.route('**/api/v1/print/jobs/claim-pickup', async (route) => {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              released: false,
              orderId: 'receipt-order',
              orderNo: 'ORD-RECEIPT',
              terminalId: 'KSK-001',
              amountCents: 100,
              fileName: W2_FILE.name,
              billablePages: W2_FILE.pages,
              priceLines: [],
              paymentSessionToken: 'receipt-payment-session',
            }),
          })
        })
        await page.goto('/print/pickup-claim')
        await terminalReady(page)
        await page.getByLabel('到机码输入框').fill('28491703')
        await see(page, 'text=订单核验成功')
      },
    },
    {
      item: '打印', screen: 'img2pdf', state: 'empty', route: '/print-scan/convert',
      seeds: ['registerTouchShell'],
      missingReason: null,
      prepare: async (page, api) => {
        shell(api)
        await page.goto('/print-scan/convert')
        await see(page, '[data-w2-page="print-scan-convert"]')
      },
    },
  ]
  for (const phase of pdfPhases) {
    pairs.push({
      item: '打印',
      screen: 'img2pdf',
      state: phase,
      route: '/print-scan/convert',
      seeds: phase === 'uploading' ? [] : phase === 'usb' ? ['openConvert', 'click img2pdf-add-usb'] : ['openConvert', 'UploadSessionQrPanel 手机确认', `images-to-pdf ${phase}`],
      missingReason: phase === 'uploading'
        ? 'runtime-missing：ConvertImagesPage.uploading 只由本机 input[type=file] 的 handleFile 设置；正式一体机不渲染该输入框，手机确认只调用 addImage，没有这一整屏上传中状态。'
        : null,
      proto: { patch: { fsPdf: phase } },
      prepare: phase === 'uploading' ? undefined : (page, api) => openConvert(page, api, phase),
    })
  }
  return pairs
}
