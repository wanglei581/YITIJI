// 青序并排截图的造状态。只拦截 /api/v1、写会话、点可见控件、走页面已有的 URL 门。
// 本机 Terminal Agent（127.0.0.1:9527）与既有 terminal-identity 拦截同一条，页面自己会去读。
import fs from 'node:fs'
import type { Page, Route } from '@playwright/test'
import type { ApiRouter } from '../../fixtures/api-router'
import {
  loginThroughVisibleUi,
  registerMemberLogin,
  seedPrintFlow,
} from './kiosk-p1-evidence-capture-api'
import { setReactRouterState, W2_FILE, W2_ORDER, writeScanWorkbenchSession } from './fusion-w2-state'
import type { QingxuPairTarget, RuntimePlan } from './qingxu-pair-targets'

export interface PriorityPlan {
  plan: RuntimePlan
  reason: string | null
  marker: string | null
  runtimePath: string | null
}

const NONE = (reason: string): PriorityPlan => ({
  plan: { kind: 'none' },
  reason,
  marker: null,
  runtimePath: null,
})

const HIT = (marker: string, runtimePath: string): PriorityPlan => ({
  plan: { kind: 'priority' },
  reason: null,
  marker,
  runtimePath,
})

const LATER = '2099-01-01T00:00:00.000Z'
const PHONE = '13800138000'
const CODE = '123456'
const UPLOAD_ID = 'pair-upload-1'
const SCAN_ID = 'pair-scan-001'
const SCAN_TOKEN = 'pair-scan-control'
const MATERIAL_KEY = 'ai-job-print:current-print-material-check'
const ASSET_PATHS = [
  '/api/v1/me/resumes',
  '/api/v1/me/documents',
  '/api/v1/me/print-orders',
  '/api/v1/me/favorites',
  '/api/v1/me/benefits',
  '/api/v1/me/ai-records',
]

const DESK_NONE: Record<string, string> = {
  'illegal-context': '打印台不读 ?state=。认不出的查询不会单独成屏，缺文件时只落到 missing-context',
  'expired-context': '材料会话没有「链接已过期」这一屏；过期文件不会被单独画出来',
  'check-skip-confirm': '材料检查写明隐私预检不可跳过，没有跳过确认屏',
  'capability-doc-locked': '预览只按 color_print / duplex_print 锁控件，没有单独的文档能力锁屏',
}

const CASHIER_NONE: Record<string, string> = {}

const PROGRESS_NONE: Record<string, string> = {
  'client-status-timeout': '进度页要连续 10 分钟没拿到终态才翻到查询超时，本轮不加速时钟',
  'partial-output': '打印状态合同不回已出页数，完成页不渲染「出了 N 页」',
}

const SOURCE_NONE: Record<string, string> = {
  'missing-file': 'deriveFileSourceScreen 没有路径进入 missing-file，视图分支在但状态机不进',
  unknown: 'deriveFileSourceScreen 没有路径进入 unknown',
  'local-picking': 'local-picking 只在系统文件框打开的那一帧，设文件不会停在这一态',
  'usb-unavailable': '本次预览构建注入了桥接令牌，usb-unavailable 要未配置令牌的构建',
}

const SCAN_NONE: Record<string, string> = {
  'session-lost': '扫描运行时没有 session-lost 屏，缺会话时直接回到开始',
  'cancel-failed': '取消失败会离开进度页回到开始，没有单独停留屏',
  cancelled: '服务端回 cancelled 后进度页直接回开始，不停留',
  'cancel-race': '取消与完成赛跑被收成回开始或完成结果，没有单独的 cancel-race 屏',
  'cancel-conflict': '取消冲突没有单独停留屏，页面按最新一次状态查询离开进度',
  'cancel-recheck': '取消后的补查没有单独停留屏',
  'cancel-race-unknown': '取消后补查失败没有单独停留屏',
  'preview-loading': '扫描结果预览没有单独的加载屏，内容区直接挂签名链接',
  'preview-failed': '预览打不开只在内容区留一句，不改判完成，也没有单独的 preview-failed 屏',
}

const LOGIN_NONE: Record<string, string> = {}

const PROFILE_NONE: Record<string, string> = {
  switching: '点「退出并切换」后立刻清会话离开设置页，没有 switching 停留屏',
  'switch-failed': '切换账号不看登出接口成败，失败也不会留在设置页',
  'phone-clearing': '换绑成功后的清会话没有单独一屏，完成句在 phone-done',
  'phone-relogin-failed': '换绑完成只给出「去登录」，不再次登录，没有 relogin-failed 屏',
}

function hitOf(nn: string, screen: string, state: string): PriorityPlan | null {
  if (nn === '13') {
    if (DESK_NONE[state]) return NONE(DESK_NONE[state])
    const preview = state === 'preview' || state.startsWith('capability-') || state.startsWith('device-') || state === 'file-unsupported'
    return HIT(
      preview ? '[data-w2-page="print-preview"]' : '[data-w2-page="print-material-check"]',
      preview ? '/print/desk?step=preview' : '/print/desk?step=check',
    )
  }
  if (nn === '32') {
    if (CASHIER_NONE[state]) return NONE(CASHIER_NONE[state])
    return HIT(`[data-qx-state="${state}"]`, '/print/cashier')
  }
  if (nn === '15') {
    if (PROGRESS_NONE[state]) return NONE(PROGRESS_NONE[state])
    if (state === 'printing') return HIT('[data-testid="print-fulfill-state-printing"]', '/print/progress')
    if (state === 'completed') return HIT('[data-testid="print-fulfill-state-completed"]', '/print/done')
    if (state === 'refund-info') return HIT('[data-testid="print-fulfill-state-fee-info"]', '/print/done')
    if (state === 'out-of-paper') return HIT('[data-testid="print-fulfill-state-out-of-paper"]', '/print/done')
    return HIT('[data-w2-page="print-done"]', '/print/done')
  }
  if (nn === '12') {
    if (SOURCE_NONE[state]) return NONE(SOURCE_NONE[state])
    const tab = state.startsWith('local-') ? 'file' : state.startsWith('phone-') ? 'qr' : state.startsWith('usb-') ? 'usb' : ''
    const path = tab ? `/print/upload?tab=${tab}` : '/print/upload'
    return HIT(`[data-testid="file-source-state-${state}"]`, path)
  }
  if (nn === '18') {
    if (SCAN_NONE[state]) return NONE(SCAN_NONE[state])
    if (state === 'setup' || state === 'blocked' || state === 'usb-panel') {
      const path = state === 'usb-panel' ? '/scan?stage=start&mode=usb-panel' : '/scan?stage=start'
      return HIT(`[data-state="${state === 'setup' ? 'setup' : state}"]`, path)
    }
    if (state === 'create-loading' || state === 'create-failed' || state === 'panel-instruction') {
      return HIT(`[data-state="${state === 'panel-instruction' ? 'panel-instruction' : state}"]`, '/scan?stage=settings')
    }
    if (state.startsWith('waiting') || state === 'polling' || state === 'poll-failed' || state === 'cancelling') {
      return HIT(`[data-state="${state === 'waiting-delivery' ? 'waiting-delivery' : state}"]`, '/scan?stage=progress')
    }
    return HIT('[data-w2-page="scan-result"], [data-state]', '/scan?stage=result')
  }
  if (nn === '03') {
    if (LOGIN_NONE[state]) return NONE(LOGIN_NONE[state])
    return HIT(`[data-testid="login-gate-state-${state}"]`, '/login')
  }
  if (nn === '30') {
    if (PROFILE_NONE[state]) return NONE(PROFILE_NONE[state])
    if (screen === 'settings') return HIT('[data-kiosk-screen="member-settings"], [role="dialog"]', '/me/settings')
    return HIT(`[data-testid="profile-state-${state}"]`, '/profile')
  }
  return null
}

export function priorityPlan(file: string, screen: string, state: string): PriorityPlan | null {
  return hitOf(file.slice(0, 2), screen, state)
}

function hang(): Promise<never> {
  return new Promise(() => undefined)
}

async function see(page: Page, selector: string): Promise<void> {
  await page.locator(selector).first().waitFor({ state: 'visible', timeout: 12_000 })
}

function json(route: Route, status: number, body: unknown): Promise<void> {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })
}

function envelope(data: unknown, status = 200): { status: number; json: unknown } {
  return { status, json: { success: true, data } }
}

async function seedDeskFile(page: Page, file: Record<string, unknown> = W2_FILE, checked = false): Promise<void> {
  await page.addInitScript(
    ({ key, value }) => {
      window.sessionStorage.setItem(key, JSON.stringify(value))
    },
    {
      key: MATERIAL_KEY,
      value: {
        file,
        source: 'document',
        ...(checked ? {
          materialCheck: {
            inspectionTaskId: 'w2-inspection-001',
            normalizeTaskId: 'w2-normalize-001',
            piiTaskId: 'w2-pii-001',
            piiRedactTaskId: 'w2-pii-redact-001',
            checkedAt: '2026-07-24T00:00:00.000Z',
            findingCount: 0,
            redactedCount: 0,
            keptCount: 0,
            redaction: {
              claim: 'nothing_to_redact',
              redactedFileId: null,
              appliedRedactedCount: 0,
              failedNoPositionCount: 0,
              keptCount: 0,
              reverifyRemainingCount: null,
              reverifyRan: false,
            },
            mode: 'checked',
          },
        } : {}),
        updatedAt: '2026-07-24T00:00:00.000Z',
      },
    },
  )
}

function materialTask(kind: string, status: string, extra: Record<string, unknown> = {}) {
  return {
    id: `pair-${kind}`,
    kind,
    status,
    requesterMode: 'anonymous',
    accessToken: 'pair-access',
    sourceFileId: W2_FILE.fileId,
    resultFileId: null,
    endUserId: null,
    params: {},
    result: extra.result ?? { mode: 'real', checks: { pageCount: 2, canPrint: true, canNormalize: true, targetPaperSize: 'A4', messages: [] } },
    errorCode: extra.errorCode ?? null,
    errorMessage: extra.errorMessage ?? null,
    expiresAt: LATER,
    createdAt: '2026-07-24T00:00:00.000Z',
    updatedAt: '2026-07-24T00:00:00.000Z',
    ...(extra.findings ? { piiFindings: extra.findings } : {}),
  }
}

const FINDING = {
  id: 'finding-phone',
  taskId: 'pair-pii_scan',
  type: 'phone',
  label: '手机号',
  pageNumber: 1,
  snippet: '13800138000',
  confidence: 0.91,
  action: 'pending',
  createdAt: '2026-07-24T00:00:00.000Z',
}

async function routeMaterials(page: Page, mode: string): Promise<void> {
  let posts = 0
  await page.route('**/api/v1/materials/tasks**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (request.method() === 'GET') {
      await json(route, 200, { success: true, data: materialTask('inspection', 'completed') })
      return
    }
    if (request.method() !== 'POST' || path !== '/api/v1/materials/tasks') {
      await route.fallback()
      return
    }
    posts += 1
    const kind = (request.postDataJSON() as { kind?: string }).kind ?? 'inspection'
    if (mode === 'loading' || (mode === 'retry' && posts > 1)) {
      await hang()
      return
    }
    if (mode === 'failed' || (mode === 'retry' && posts === 1)) {
      await json(route, 200, {
        success: true,
        data: materialTask(kind, 'failed', { errorCode: 'MATERIAL_CHECK_FAILED', errorMessage: '文件体检失败，请重试' }),
      })
      return
    }
    if (kind === 'pii_scan' && (mode === 'flagged' || mode === 'decided')) {
      await json(route, 200, { success: true, data: materialTask(kind, 'completed', { findings: [FINDING], result: { mode: 'real' } }) })
      return
    }
    if (kind === 'pii_scan' && mode === 'partial') {
      await json(route, 200, {
        success: true,
        data: materialTask(kind, 'completed', { result: { mode: 'partial', scannedPages: 1, totalPages: 4 } }),
      })
      return
    }
    await json(route, 200, { success: true, data: materialTask(kind, 'completed', mode === 'clean' && kind === 'pii_scan' ? { findings: [], result: { mode: 'real' } } : {}) })
  })
}

function capabilities(api: ApiRouter, color: string, duplex: string, scan = 'available'): void {
  const row = (capabilityKey: string, status: string) => ({
    capabilityKey,
    status,
    note: status === 'available' ? null : '本机尚未完成该项真机验证',
    configured: true,
    updatedAt: '2026-07-24T00:00:00.000Z',
  })
  api.respond('GET', '/api/v1/terminals/KSK-001/capabilities', {
    status: 200,
    json: { capabilities: [row('color_print', color), row('duplex_print', duplex), row('scan', scan)] },
  })
}

function printer(api: ApiRouter, isOnline: boolean, printerStatus: string | null): void {
  api.respond('GET', '/api/v1/terminals/KSK-001/printer-status', {
    status: 200,
    json: { isOnline, printerStatus },
  })
}

async function openDesk(page: Page, api: ApiRouter, state: string): Promise<void> {
  if (state === 'missing-context') {
    await page.goto('/print/desk?step=check', { waitUntil: 'domcontentloaded' })
    await see(page, 'h2:text-is("这一页没有待处理的文件")')
    return
  }
  if (state.startsWith('check-')) {
    const mode = state === 'check-loading' ? 'loading'
      : state === 'check-failed' ? 'failed'
        : state === 'check-retrying' ? 'retry'
          : state === 'check-flagged' || state === 'check-flagged-decided' ? 'flagged'
            : state === 'check-flagged-partial' ? 'partial'
              : 'clean'
    await routeMaterials(page, mode === 'decided' ? 'flagged' : mode)
    await seedDeskFile(page)
    await page.goto('/print/desk?step=check', { waitUntil: 'domcontentloaded' })
    if (state === 'check-retrying') {
      await page.getByRole('button', { name: '重试检查' }).click()
      await see(page, '[data-qx-state="inspection"]')
      return
    }
    if (state === 'check-flagged-decided') {
      await page.getByRole('button', { name: '全部保留' }).click()
      await page.getByRole('button', { name: '下一步：预览与参数' }).waitFor({ state: 'visible' })
      return
    }
    if (state === 'check-flagged-partial') {
      await see(page, 'text=本次仅检查了前')
      return
    }
    if (state === 'check-clean') await see(page, 'text=没有待处理的隐私片段')
    else if (state === 'check-flagged') await see(page, 'text=逐条裁决')
    else if (state === 'check-failed') await see(page, 'text=材料检查未完成')
    else await see(page, '[data-qx-state="inspection"]')
    return
  }
  capabilities(
    api,
    state === 'capability-color-locked' ? 'not_verified' : 'available',
    state === 'capability-duplex-locked' || state === 'capability-error' ? 'not_verified' : 'available',
  )
  if (state === 'capability-error') {
    api.respond('GET', '/api/v1/terminals/KSK-001/capabilities', { status: 503, json: { error: { code: 'CAPABILITIES_UNAVAILABLE', message: '能力暂时读不到' } } })
  }
  if (state === 'capability-loading') {
    api.respondWith('GET', '/api/v1/terminals/KSK-001/capabilities', async () => {
      await new Promise((resolve) => setTimeout(resolve, 8_000))
      return { status: 200, json: { capabilities: [] } }
    })
  }
  if (state === 'device-offline') printer(api, false, 'offline')
  else if (state === 'device-error') printer(api, true, 'error')
  else if (state === 'device-unknown') printer(api, true, 'unknown')
  else if (state === 'device-loading') {
    api.respondWith('GET', '/api/v1/terminals/KSK-001/printer-status', () => hang())
  } else printer(api, true, 'ready')
  const file = state === 'file-unsupported'
    ? { ...W2_FILE, name: 'notes.txt', mimeType: 'text/plain' }
    : W2_FILE
  await seedDeskFile(page, file, true)
  await page.goto('/print/desk?step=preview', { waitUntil: 'domcontentloaded' })
  if (state === 'file-unsupported') await see(page, '[data-qx-state="file-unsupported"]')
  else if (state === 'capability-loading') await see(page, 'text=正在确认本机打印能力')
  else if (state === 'device-loading') await see(page, 'text=检测设备中')
  else if (state === 'device-offline') await see(page, 'text=打印机离线')
  else if (state === 'device-error') await see(page, 'text=打印机异常')
  else if (state === 'device-unknown') await see(page, 'text=状态未知')
  else if (state === 'capability-error') await see(page, 'text=暂时无法确认本机打印能力')
  else if (state === 'capability-color-locked' || state === 'capability-duplex-locked') {
    await see(page, 'text=本机尚未完成该项真机验证')
  } else await see(page, '[data-qx-state="preview"]')
}

function payBody(payStatus: string, attempt: Record<string, unknown> | null = null) {
  return {
    orderId: W2_ORDER.orderId,
    orderNo: W2_ORDER.orderNo,
    payStatus,
    paymentSource: null,
    payChannel: null,
    amountCents: W2_ORDER.amountCents,
    paidAt: null,
    pickupCode: null,
    attempt,
  }
}

async function openCashier(page: Page, api: ApiRouter, state: string): Promise<void> {
  const order = {
    orderId: W2_ORDER.orderId,
    orderNo: W2_ORDER.orderNo,
    amountCents: state === 'free-order' ? 0 : W2_ORDER.amountCents,
    paymentSessionToken: state === 'session-expired' ? undefined : W2_ORDER.paymentSessionToken,
    source: 'document',
    priceLines: [],
  }
  if (state === 'channel-loading') {
    api.respondWith('GET', '/api/v1/payment/channels', () => hang())
  } else if (state === 'channel-empty') {
    api.respond('GET', '/api/v1/payment/channels', { status: 200, json: { channels: [] } })
  } else if (state === 'channel-failed') {
    api.respond('GET', '/api/v1/payment/channels', { status: 503, json: { error: { code: 'CHANNELS_UNAVAILABLE', message: '支付通道服务暂不可用' } } })
  } else if (state === 'pending') {
    api.respond('GET', '/api/v1/payment/channels', { status: 200, json: { channels: ['wechat', 'alipay'] } })
  } else {
    api.respond('GET', '/api/v1/payment/channels', { status: 200, json: { channels: ['wechat'] } })
  }
  const attempt = (status: string, qr: string | null, expiresAt: string | null, channel: string | null = 'wechat') => ({
    attemptId: 'pair-attempt',
    channel,
    status,
    qrCodeContent: qr,
    expiresAt,
  })
  let snapshot = payBody('unpaid')
  if (state === 'pending-qr') snapshot = payBody('paying', attempt('pending', 'weixin://pair-qr', LATER))
  if (state === 'display-expired-reconciling') snapshot = payBody('paying', attempt('pending', 'weixin://pair-qr', '2000-01-01T00:00:00.000Z'))
  if (state === 'expired') snapshot = payBody('paying', attempt('expired', 'weixin://pair-qr', '2000-01-01T00:00:00.000Z'))
  if (state === 'pending-verification') snapshot = payBody('paying', attempt('expired', null, null))
  if (state === 'awaiting-code-confirmation') snapshot = payBody('paying', attempt('pending', null, null))
  if (state === 'attempt-failed') snapshot = payBody('unpaid', attempt('failed', null, null))
  if (state === 'attempt-channel-unknown') snapshot = payBody('paying', attempt('pending', null, null, null))
  if (state === 'paid' || state === 'release-failed') snapshot = payBody('paid')
  if (state === 'order-failed') snapshot = payBody('failed')
  if (state === 'closed') snapshot = payBody('closed')
  if (state === 'refunding') snapshot = payBody('refunding')
  if (state === 'partial-refunded') snapshot = payBody('partial_refunded')
  if (state === 'refunded') snapshot = payBody('refunded')
  if (state !== 'no-order' && state !== 'session-expired' && state !== 'free-order') {
    api.respond('GET', `/api/v1/orders/${W2_ORDER.orderId}/pay-status`, { status: 200, json: snapshot })
  }
  if (state === 'paid') {
    api.respondWith('POST', `/api/v1/print/jobs/${W2_ORDER.orderId}/release`, () => hang())
  }
  if (state === 'release-failed') {
    api.respond('POST', `/api/v1/print/jobs/${W2_ORDER.orderId}/release`, {
      status: 500,
      json: { error: { code: 'PRINT_RELEASE_FAILED', message: '创建打印任务失败' } },
    })
  }
  await page.goto('/print/cashier', { waitUntil: 'domcontentloaded' })
  if (state !== 'no-order') {
    await setReactRouterState(page, '/print/cashier', state === 'paid' || state === 'release-failed' ? order : { ...order, taskId: W2_ORDER.taskId })
  }
  if (state === 'pending-scan') {
    await page.getByRole('button', { name: '出示你的付款码' }).click()
  }
  await see(page, `[data-qx-state="${state}"]`)
}

async function openFulfill(page: Page, api: ApiRouter, state: string): Promise<void> {
  if (state === 'printing') {
    api.respond('GET', `/api/v1/print/jobs/${W2_ORDER.taskId}`, {
      status: 200,
      json: { taskId: W2_ORDER.taskId, status: 'printing' },
    })
    await seedPrintFlow(page, '/print/progress', { taskId: W2_ORDER.taskId, order: W2_ORDER, amountCents: W2_ORDER.amountCents })
    await see(page, '[data-testid="print-fulfill-state-printing"]')
    return
  }
  if (state === 'completed') {
    api.respond('GET', `/api/v1/print/jobs/${W2_ORDER.taskId}`, {
      status: 200,
      json: { taskId: W2_ORDER.taskId, status: 'completed', completedAt: '2026-07-26T00:00:00.000Z' },
    })
    await seedPrintFlow(page, '/print/done', { taskId: W2_ORDER.taskId, amountCents: W2_ORDER.amountCents, orderId: W2_ORDER.orderId, orderNo: W2_ORDER.orderNo })
    await see(page, '[data-testid="print-fulfill-state-completed"]')
    return
  }
  const errorCode = state === 'paper-jam' ? 'PRINTER_ERROR'
    : state === 'out-of-paper' ? 'PAPER_EMPTY'
      : state === 'result-unconfirmed' ? 'PRINT_JOB_UNCONFIRMED'
        : 'PRINT_COMMAND_FAILED'
  api.respond('GET', `/api/v1/print/jobs/${W2_ORDER.taskId}`, {
    status: 200,
    json: {
      taskId: W2_ORDER.taskId,
      status: 'failed',
      errorCode,
      failureReasonForUser: '打印任务未能完成，请联系现场工作人员',
    },
  })
  api.respond('POST', `/api/v1/print/jobs/${W2_ORDER.taskId}/takeaway-url`, {
    status: 200,
    json: {
      signedUrl: '/api/v1/files/pair-takeaway/content',
      expiresAt: LATER,
      filename: 'w2-sample.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 128,
      orderId: W2_ORDER.orderId,
      orderNo: W2_ORDER.orderNo,
      payStatus: 'paid',
      amountCents: W2_ORDER.amountCents,
      canRetry: false,
    },
  })
  await seedPrintFlow(page, '/print/done', {
    taskId: W2_ORDER.taskId,
    amountCents: W2_ORDER.amountCents,
    orderId: W2_ORDER.orderId,
    orderNo: W2_ORDER.orderNo,
    paymentSessionToken: W2_ORDER.paymentSessionToken,
  })
  if (state === 'refund-info') {
    await page.getByRole('button', { name: '查看费用说明' }).click()
    await see(page, '[data-testid="print-fulfill-state-fee-info"]')
    return
  }
  await see(page, '[data-w2-page="print-done"]')
}

function uploadFileView() {
  return {
    fileId: 'pair-phone-file',
    filename: '手机简历.pdf',
    sizeBytes: 12000,
    mimeType: 'application/pdf',
    sha256: 'b'.repeat(64),
    fileExpiresAt: LATER,
    fileUrl: '/api/v1/files/pair-phone-file/content',
  }
}

function installUpload(api: ApiRouter, status: string, expiresAt = LATER): void {
  api.respond('POST', '/api/v1/upload-sessions', envelope({
    sessionId: UPLOAD_ID,
    uploadUrl: '/upload/phone',
    uploadToken: 'pair-upload-token',
    controlToken: 'pair-control',
    expiresAt,
  }))
  api.respond('GET', `/api/v1/upload-sessions/${UPLOAD_ID}`, envelope({
    sessionId: UPLOAD_ID,
    status,
    purpose: 'print_doc',
    mode: 'temporary',
    file: status === 'uploaded' || status === 'confirmed' ? uploadFileView() : null,
    requiresKioskConfirmation: true,
    expiresAt,
  }))
  api.respond('POST', `/api/v1/upload-sessions/${UPLOAD_ID}/confirm`, envelope({
    sessionId: UPLOAD_ID,
    status: 'confirmed',
    file: uploadFileView(),
  }))
  api.respond('DELETE', `/api/v1/upload-sessions/${UPLOAD_ID}`, envelope({ sessionId: UPLOAD_ID, status: 'cancelled' }))
}

async function routeAgent(page: Page, handle: (path: string, method: string, route: Route) => Promise<void>): Promise<void> {
  await page.route('http://127.0.0.1:9527/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/local/terminal-identity') {
      await route.fallback()
      return
    }
    await handle(path, route.request().method(), route)
  })
}

async function openSource(page: Page, api: ApiRouter, state: string, runtimePath: string): Promise<void> {
  if (state.startsWith('phone-')) {
    const status = state === 'phone-uploading' ? 'uploading'
      : state === 'phone-uploaded' || state === 'phone-confirming' || state === 'phone-confirm-failed' || state === 'phone-confirmed' || state === 'phone-cancel-requesting' || state === 'phone-cancel-failed'
        ? 'uploaded'
        : state === 'phone-cancelled' ? 'cancelled'
          : state === 'phone-expired' ? 'expired'
            : 'pending'
    installUpload(api, status, state === 'phone-expired' ? '2000-01-01T00:00:00.000Z' : LATER)
    if (state === 'phone-generating') api.respondWith('POST', '/api/v1/upload-sessions', () => hang())
    if (state === 'phone-gen-failed') {
      api.respond('POST', '/api/v1/upload-sessions', { status: 500, json: { error: { code: 'UPLOAD_SESSION_FAILED', message: '二维码生成失败' } } })
    }
    if (state === 'phone-status-unknown') {
      api.respondWith('GET', `/api/v1/upload-sessions/${UPLOAD_ID}`, (n) => n === 1
        ? { status: 503, json: { error: { code: 'UPLOAD_STATUS_UNKNOWN', message: '状态暂时读不到' } } }
        : envelope({ sessionId: UPLOAD_ID, status: 'pending', purpose: 'print_doc', mode: 'temporary', file: null, requiresKioskConfirmation: true, expiresAt: LATER }))
    }
    if (state === 'phone-waiting') api.respondWith('DELETE', `/api/v1/upload-sessions/${UPLOAD_ID}`, () => hang())
    if (state === 'phone-confirming') api.respondWith('POST', `/api/v1/upload-sessions/${UPLOAD_ID}/confirm`, () => hang())
    if (state === 'phone-confirm-failed') {
      api.respond('POST', `/api/v1/upload-sessions/${UPLOAD_ID}/confirm`, { status: 500, json: { error: { code: 'UPLOAD_CONFIRM_FAILED', message: '确认失败' } } })
    }
    if (state === 'phone-cancel-requesting') api.respondWith('DELETE', `/api/v1/upload-sessions/${UPLOAD_ID}`, () => hang())
    if (state === 'phone-cancel-failed') {
      api.respond('DELETE', `/api/v1/upload-sessions/${UPLOAD_ID}`, { status: 500, json: { error: { code: 'UPLOAD_CANCEL_FAILED', message: '这次会话没能取消' } } })
    }
  }
  if (state.startsWith('usb-') && state !== 'usb-agent-offline') {
    await routeAgent(page, async (path, method, route) => {
      if (path === '/local/usb/status' && method === 'GET') {
        const present = state !== 'usb-wait'
        await json(route, state === 'usb-read-failed' ? 500 : 200, state === 'usb-read-failed'
          ? { error: { code: 'USB_READ_FAILED', message: '读盘失败' } }
          : { success: true, data: { present, driveLabel: present ? 'PAIRUSB' : null } })
        return
      }
      if (path === '/local/usb/files' && method === 'GET') {
        if (state === 'usb-detecting') { await hang(); return }
        const files = state === 'usb-empty' ? [] : [{ safeId: 'safe-1', filename: '简历.pdf', extension: 'pdf', sizeBytes: 12000 }]
        await json(route, 200, { success: true, data: { present: true, driveLabel: 'PAIRUSB', files } })
        return
      }
      if (path === '/local/usb/upload' && method === 'POST') {
        if (state === 'usb-importing') { await hang(); return }
        if (state === 'usb-safeid-expired') {
          await json(route, 410, { error: { code: 'USB_SAFE_ID_EXPIRED', message: '标识已失效' } })
          return
        }
        if (state === 'usb-import-failed') {
          await json(route, 500, { error: { code: 'USB_IMPORT_FAILED', message: '导入失败' } })
          return
        }
        await json(route, 200, {
          success: true,
          data: { fileId: 'pair-usb-file', filename: '简历.pdf', sizeBytes: 12000, mimeType: 'application/pdf', sha256: 'd'.repeat(64), fileUrl: '/api/v1/files/pair-usb-file/content', fileUrlExpiresAt: LATER },
        })
        return
      }
      await json(route, 404, { error: { code: 'NOT_FOUND', message: '未实现' } })
    })
  }
  if (state === 'local-uploading') api.respondWith('POST', '/api/v1/files/kiosk-upload', () => hang())
  if (state === 'local-upload-failed') {
    api.respond('POST', '/api/v1/files/kiosk-upload', { status: 500, json: { error: { code: 'UPLOAD_FAILED', message: '上传失败，请重试' } } })
  }
  if (state === 'local-ready') {
    api.respond('POST', '/api/v1/files/kiosk-upload', envelope({
      fileId: 'pair-local-file',
      filename: 'sample.pdf',
      sizeBytes: 128,
      mimeType: 'application/pdf',
      sha256: 'c'.repeat(64),
      signedUrl: '/w2-fixtures/sample-visible.pdf',
    }))
  }
  await page.goto(runtimePath, { waitUntil: 'domcontentloaded' })
  if (state === 'phone-waiting') await page.getByTestId('file-source-refresh').click()
  if (state === 'phone-confirming' || state === 'phone-confirm-failed' || state === 'phone-confirmed') {
    await page.getByRole('button', { name: '确认使用这份文件' }).click()
  }
  if (state === 'phone-cancel-requesting' || state === 'phone-cancel-failed') {
    await page.getByTestId('file-source-cancel').click()
  }
  if (state === 'usb-selected' || state === 'usb-importing' || state === 'usb-safeid-expired' || state === 'usb-import-failed' || state === 'usb-ready') {
    await page.getByTestId('file-source-usb-file-safe-1').click()
    if (state !== 'usb-selected') await page.getByRole('button', { name: '导入这一份' }).click()
  }
  if (state.startsWith('local-') && state !== 'local-guide') {
    const input = page.locator('input[type="file"]')
    if (state === 'local-cancelled') {
      await input.evaluate((node: HTMLInputElement) => {
        node.dispatchEvent(new Event('change', { bubbles: true }))
      })
    } else if (state === 'local-rejected') {
      await input.setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') })
    } else if (state === 'local-unreadable') {
      await input.setInputFiles({ name: 'empty.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(0) })
    } else if (state === 'local-oversize') {
      const oversize = '/tmp/qx-pair-oversize.pdf'
      if (!fs.existsSync(oversize) || fs.statSync(oversize).size <= 15 * 1024 * 1024) {
        fs.writeFileSync(oversize, Buffer.alloc(15 * 1024 * 1024 + 1, 0x25))
      }
      await input.setInputFiles(oversize)
    } else {
      await input.setInputFiles({ name: 'sample.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.1\n') })
    }
  }
  await see(page, `[data-testid="file-source-state-${state}"]`)
}

async function openScan(page: Page, api: ApiRouter, state: string): Promise<void> {
  capabilities(api, 'available', 'available', state === 'blocked' ? 'not_verified' : 'available')
  if (state === 'blocked') {
    await page.goto('/scan?stage=start', { waitUntil: 'domcontentloaded' })
    await see(page, '[data-state="blocked"]')
    return
  }
  if (state === 'usb-panel') {
    await page.goto('/scan?stage=start&mode=usb-panel', { waitUntil: 'domcontentloaded' })
    await see(page, '[data-state="usb-panel"]')
    return
  }
  if (state === 'setup') {
    await page.goto('/scan?stage=start', { waitUntil: 'domcontentloaded' })
    await see(page, '[data-state="setup"]')
    return
  }
  const created = {
    scanTaskId: SCAN_ID,
    controlToken: SCAN_TOKEN,
    expiresAt: LATER,
    instructions: ['把简历朝下放入稿台'],
  }
  if (state === 'create-loading') api.respondWith('POST', '/api/v1/scan/sessions', () => hang())
  else if (state === 'create-failed') {
    api.respond('POST', '/api/v1/scan/sessions', { status: 503, json: { error: { code: 'SCAN_SESSION_UNAVAILABLE', message: '扫描任务未创建' } } })
  } else {
    api.respond('POST', '/api/v1/scan/sessions', envelope(created))
    api.respond('POST', `/api/v1/scan/sessions/${SCAN_ID}/ack`, envelope({ scanTaskId: SCAN_ID, deliveryAckedAt: '2026-07-24T00:00:01.000Z' }))
  }
  if (state === 'create-loading' || state === 'create-failed' || state === 'panel-instruction') {
    await page.goto('/scan?stage=start', { waitUntil: 'domcontentloaded' })
    await writeScanWorkbenchSession(page, { stage: 'settings', scanType: 'resume' })
    await page.goto('/scan?stage=settings', { waitUntil: 'domcontentloaded' })
    await see(page, `[data-state="${state}"]`)
    return
  }
  const live = { scanTaskId: SCAN_ID, controlToken: SCAN_TOKEN, instructions: ['把简历朝下放入稿台'], expiresAt: LATER }
  api.respond('POST', `/api/v1/scan/sessions/${SCAN_ID}/ack`, envelope({ scanTaskId: SCAN_ID, deliveryAckedAt: '2026-07-24T00:00:01.000Z' }))
  if (state === 'polling') api.respondWith('GET', `/api/v1/scan/sessions/${SCAN_ID}`, () => hang())
  else if (state === 'poll-failed') {
    api.respond('GET', `/api/v1/scan/sessions/${SCAN_ID}`, { status: 503, json: { error: { code: 'SCAN_STATUS_UNAVAILABLE', message: '查询扫描状态失败' } } })
  } else if (state === 'cancelling') api.respondWith('DELETE', `/api/v1/scan/sessions/${SCAN_ID}`, () => hang())
  else {
    api.respond('GET', `/api/v1/scan/sessions/${SCAN_ID}`, envelope({
      scanTaskId: SCAN_ID,
      status: 'waiting',
      scanType: 'resume',
      file: null,
      errorCode: null,
      errorMessage: null,
      expiresAt: LATER,
    }))
  }
  if (state === 'waiting-delivery' || state === 'polling' || state === 'poll-failed' || state === 'cancelling') {
    await page.goto('/scan?stage=start', { waitUntil: 'domcontentloaded' })
    await writeScanWorkbenchSession(page, { stage: 'progress', scanType: 'resume', live })
    await page.goto('/scan?stage=progress', { waitUntil: 'domcontentloaded' })
    if (state === 'cancelling') await page.getByRole('button', { name: '取消扫描' }).click()
    await see(page, `[data-state="${state}"]`)
    return
  }
  const file = {
    fileId: 'scan-file-001',
    fileUrl: '/api/v1/files/scan-file-001/content',
    name: '扫描件.pdf',
    size: '120 KB',
    pages: 1,
    format: 'pdf',
    mimeType: 'application/pdf',
  }
  const result = state === 'completed' || state === 'preview-ready'
    ? { outcome: 'completed', success: true, file }
    : state === 'completed-no-file'
      ? { outcome: 'completed-no-file', success: false, reason: '扫描已完成但未拿到文件' }
      : state === 'expired'
        ? { outcome: 'expired', success: false, reason: '扫描超时，请返回重新开始' }
        : { outcome: 'failed', success: false, reason: '扫描处理失败，请重试' }
  await page.goto('/scan?stage=start', { waitUntil: 'domcontentloaded' })
  await writeScanWorkbenchSession(page, { stage: 'result', scanType: 'resume', result })
  await page.goto('/scan?stage=result', { waitUntil: 'domcontentloaded' })
  if (state === 'preview-ready') {
    await page.getByTestId('scan-result-preview-open').click()
    await see(page, '[data-w2-page="scan-result"]')
    return
  }
  await see(page, '[data-w2-page="scan-result"]')
}

async function punchPhone(page: Page): Promise<void> {
  const phoneTab = page.getByRole('button', { name: '手机号登录', exact: true })
  if (await phoneTab.count()) await phoneTab.click()
  await page.getByRole('checkbox', { name: /我已阅读并同意/ }).click()
  for (const digit of PHONE) await page.getByRole('button', { name: digit, exact: true }).click()
}

async function openLogin(page: Page, api: ApiRouter, state: string): Promise<void> {
  registerMemberLogin(api)
  if (state.startsWith('qr-')) {
    await routeAgent(page, async (path, method, route) => {
      if (path === '/local/qr-login/create' && method === 'POST') {
        if (state === 'qr-loading') { await hang(); return }
        if (state === 'qr-error') {
          await json(route, 500, { error: { code: 'QR_TICKET_FAILED', message: '登录票据申请失败' } })
          return
        }
        await json(route, 200, {
          success: true,
          data: { ticketId: 'pair-ticket', qrUrl: 'https://example.invalid/qr', expiresInSeconds: state === 'qr-expired' ? 0 : 120, returnTo: '/' },
        })
        return
      }
      if (path === '/local/qr-login/claim') { await hang(); return }
      await json(route, 404, { error: { code: 'NOT_FOUND', message: '未实现' } })
    })
    api.respond('GET', '/api/v1/member/auth/qr/pair-ticket/status', envelope({
      status: state === 'qr-confirmed' ? 'confirmed' : 'pending',
      returnTo: '/',
      expiresInSeconds: state === 'qr-expired' ? 0 : 120,
    }))
    await page.goto('/login', { waitUntil: 'domcontentloaded' })
    await page.getByTestId('login-gate-tab-qr').click()
    if (state !== 'qr-loading') await page.getByRole('checkbox', { name: /我已阅读并同意/ }).click()
    await see(page, `[data-testid="login-gate-state-${state}"]`)
    return
  }
  if (state === 'phone-sending') api.respondWith('POST', '/api/v1/member/auth/sms-code', () => hang())
  if (state === 'phone-send-limited') {
    api.respond('POST', '/api/v1/member/auth/sms-code', { status: 429, json: { error: { code: 'SMS_TOO_FREQUENT', message: '发送过于频繁，请稍后再试' } } })
  }
  if (state === 'phone-send-failed') {
    api.respond('POST', '/api/v1/member/auth/sms-code', { status: 500, json: { error: { code: 'SMS_SEND_FAILED', message: '验证码发送失败' } } })
  }
  if (state === 'phone-verifying') api.respondWith('POST', '/api/v1/member/auth/login', () => hang())
  if (state === 'phone-code-expired') {
    api.respond('POST', '/api/v1/member/auth/login', { status: 401, json: { error: { code: 'SMS_CODE_EXPIRED', message: '验证码已过期' } } })
  }
  if (state === 'phone-code-invalid') {
    api.respond('POST', '/api/v1/member/auth/login', { status: 401, json: { error: { code: 'SMS_CODE_INVALID', message: '验证码不正确' } } })
  }
  await page.goto('/login', { waitUntil: 'domcontentloaded' })
  if (state === 'phone-idle') {
    await see(page, '[data-testid="login-gate-state-phone-idle"]')
    return
  }
  await punchPhone(page)
  await page.getByRole('button', { name: '获取验证码', exact: true }).click()
  if (state === 'phone-verifying' || state === 'phone-code-expired' || state === 'phone-code-invalid') {
    const smsTab = page.getByRole('button', { name: '短信验证码', exact: true })
    if (await smsTab.count()) await smsTab.click()
    for (const digit of CODE) await page.getByRole('button', { name: digit, exact: true }).click()
    await page.getByRole('button', { name: '验证并登录', exact: true }).click()
  }
  await see(page, `[data-testid="login-gate-state-${state}"]`)
}

function assetPage(total: number) {
  return envelope({ items: [], nextCursor: null, total })
}

function pendingTask(kind: 'payment' | 'printing') {
  return envelope([{
    id: 'pair-pending',
    type: 'print',
    status: kind === 'printing' ? 'printing' : 'pending',
    payStatus: kind === 'printing' ? 'paid' : 'unpaid',
    fileName: '简历.pdf',
    updatedAt: '2026-07-24T00:00:00.000Z',
    resume: kind === 'payment'
      ? { kind: 'payment', orderId: W2_ORDER.orderId, orderNo: W2_ORDER.orderNo, amountCents: W2_ORDER.amountCents, priceLines: [], paymentSessionToken: W2_ORDER.paymentSessionToken }
      : { kind: 'print-progress', orderId: W2_ORDER.orderId },
  }])
}

async function openProfile(page: Page, api: ApiRouter, state: string): Promise<void> {
  registerMemberLogin(api)
  api.respond('GET', '/api/v1/me/ai-consents/status', envelope([{
    scope: 'job_ai', consentVersion: '1', granted: false, grantedAt: null, revokedAt: null,
  }]))
  if (state === 'signed-out' || state === 'anonymous') {
    await page.goto(state === 'anonymous' ? '/me/settings' : '/profile', { waitUntil: 'domcontentloaded' })
    await see(page, state === 'anonymous' ? '[data-kiosk-screen="member-settings"]' : '[data-testid="profile-state-signed-out"]')
    return
  }
  const loggedIn = state === 'member' || state.startsWith('settings') || state.startsWith('phone-') || state === 'switch-confirm' || state === 'loading' || state === 'error' || state === 'empty' || state === 'ready' || state === 'printing'
  if (!loggedIn) return
  const total = state === 'member' ? 1 : 0
  for (const path of ASSET_PATHS) {
    if (state === 'loading' && path.endsWith('/resumes')) api.respondWith('GET', path, () => hang())
    else if (state === 'error') api.respond('GET', path, { status: 500, json: { error: { code: 'MEMBER_ASSETS_FAILED', message: '账号数据这次没取到' } } })
    else api.respond('GET', path, assetPage(total))
  }
  if (state === 'error') api.respond('GET', '/api/v1/me/pending-tasks', { status: 500, json: { error: { code: 'PENDING_TASKS_FAILED', message: '待办没取到' } } })
  else if (state === 'ready') api.respond('GET', '/api/v1/me/pending-tasks', pendingTask('payment'))
  else if (state === 'printing') api.respond('GET', '/api/v1/me/pending-tasks', pendingTask('printing'))
  else api.respond('GET', '/api/v1/me/pending-tasks', envelope([]))
  const dest = state.startsWith('settings') || state.startsWith('phone-') || state === 'switch-confirm' || state === 'anonymous'
    ? '/me/settings'
    : '/profile'
  if (state.startsWith('settings') || state.startsWith('phone-')) {
    if (state === 'settings-loading') api.respondWith('GET', '/api/v1/me/ai-consents/status', () => hang())
    if (state === 'settings-error') {
      api.respond('GET', '/api/v1/me/ai-consents/status', { status: 500, json: { error: { code: 'CONSENT_UNAVAILABLE', message: '授权状态没取到' } } })
    }
    api.respond('POST', '/api/v1/member/auth/step-up/sms-code', envelope({
      challengeId: 'pair-challenge', phoneMasked: '138****8000', expiresInSeconds: 300, cooldownSeconds: 60,
    }))
    api.respond('POST', '/api/v1/member/auth/step-up/verify', envelope({
      stepUpToken: 'pair-step-up', action: 'phone_rebind', expiresInSeconds: 300,
    }))
    api.respond('POST', '/api/v1/member/phone/rebind', envelope({ newPhoneMasked: '139****9000', sessionsRevoked: 1 }))
    if (state === 'phone-old-sending') api.respondWith('POST', '/api/v1/member/auth/step-up/sms-code', () => hang())
    if (state === 'phone-old-send-failed') {
      api.respond('POST', '/api/v1/member/auth/step-up/sms-code', { status: 500, json: { error: { code: 'SMS_SEND_FAILED', message: '验证码发送失败' } } })
    }
    if (state === 'phone-rate-limited') {
      api.respond('POST', '/api/v1/member/auth/step-up/sms-code', { status: 429, json: { error: { code: 'SMS_TOO_FREQUENT', message: '发送过于频繁，请稍后再试' } } })
    }
    if (state === 'phone-old-verify-failed' || state === 'phone-code-expired') {
      // 401 会被当成会员会话失效并拆掉弹层。用 400 让换绑层留下失败句。
      api.respond('POST', '/api/v1/member/auth/step-up/verify', {
        status: 400,
        json: { error: { code: 'VALIDATION_FAILED', message: state === 'phone-code-expired' ? '验证码已过期' : '验证码不正确' } },
      })
    }
    if (state === 'phone-new-send-failed') {
      api.respond('POST', '/api/v1/member/auth/sms-code', { status: 500, json: { error: { code: 'SMS_SEND_FAILED', message: '验证码发送失败' } } })
    }
    if (state === 'phone-new-verify-failed' || state === 'phone-rebind-failed') {
      api.respond('POST', '/api/v1/member/phone/rebind', { status: 400, json: { error: { code: 'PHONE_REBIND_FAILED', message: '换绑没有完成' } } })
    }
  }
  await loginThroughVisibleUi(page, dest)
  if (state === 'signed-out') return
  if (dest === '/profile') {
    await see(page, `[data-testid="profile-state-${state}"]`)
    return
  }
  if (state === 'settings-loading') {
    await see(page, 'text=查询中')
    return
  }
  if (state === 'settings-error') {
    await see(page, 'text=本次未取到')
    return
  }
  if (state === 'switch-confirm') {
    await page.getByTestId('member-settings-switch').click()
    await see(page, 'text=退出并切换')
    return
  }
  if (state === 'member' || state === 'settings-member') {
    await see(page, '[data-kiosk-screen="member-settings"]')
    return
  }
  await page.getByTestId('member-settings-rebind').click()
  await see(page, '[data-step="send_old"]')
  if (state === 'phone-old-code') return
  if (state === 'phone-old-sending' || state === 'phone-old-send-failed' || state === 'phone-rate-limited') {
    await page.getByRole('button', { name: '发送验证码' }).click()
    if (state === 'phone-old-sending') await see(page, 'text=发送中')
    else await see(page, '[role="alert"]')
    return
  }
  await page.getByRole('button', { name: '发送验证码' }).click()
  await see(page, '[data-step="verify_old"]')
  if (state === 'phone-old-verify') return
  await page.getByLabel('当前手机号验证码，已隐藏显示').fill(CODE)
  await page.getByRole('button', { name: '下一步' }).click()
  if (state === 'phone-old-verify-failed' || state === 'phone-code-expired') {
    await see(page, '[role="alert"]')
    return
  }
  await see(page, '[data-step="send_new"]')
  if (state === 'phone-new-code') return
  await page.getByLabel('新手机号').fill('13900139000')
  await page.getByRole('button', { name: '发送验证码' }).click()
  if (state === 'phone-new-send-failed') {
    await see(page, '[role="alert"]')
    return
  }
  await see(page, '[data-step="verify_new"]')
  if (state === 'phone-new-verify') return
  await page.getByLabel('新手机号验证码，已隐藏显示').fill(CODE)
  await page.getByRole('button', { name: '确认换绑' }).click()
  if (state === 'phone-done') await see(page, 'text=换绑成功')
  else await see(page, '[role="alert"]')
}

export async function preparePrioritySeed(page: Page, api: ApiRouter, target: QingxuPairTarget): Promise<void> {
  page.setDefaultTimeout(12_000)
  const state = target.state
  if (target.nn === '13') return openDesk(page, api, state)
  if (target.nn === '32') {
    if (state === 'no-order') {
      await page.goto('/print/cashier', { waitUntil: 'domcontentloaded' })
      await see(page, '[data-qx-state="no-order"]')
      return
    }
    return openCashier(page, api, state)
  }
  if (target.nn === '15') return openFulfill(page, api, state)
  if (target.nn === '12') return openSource(page, api, state, target.runtimeUrl ?? '/print/upload')
  if (target.nn === '18') return openScan(page, api, state)
  if (target.nn === '03') return openLogin(page, api, state)
  if (target.nn === '30') {
    if (target.screen === 'profile') return openProfile(page, api, state)
    if (state === 'member') return openProfile(page, api, 'settings-member')
    if (state === 'anonymous') return openProfile(page, api, 'anonymous')
    if (state === 'loading') return openProfile(page, api, 'settings-loading')
    if (state === 'error') return openProfile(page, api, 'settings-error')
    return openProfile(page, api, state)
  }
}
