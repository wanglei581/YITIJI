import { expect, type BrowserContext, type Page } from '@playwright/test'
import type { ApiRouter } from '../../fixtures/api-router'
import {
  loginThroughVisibleUi,
  registerAuthenticatedMemberApis,
  registerEvidenceShell,
  registerMemberLogin,
} from './kiosk-p1-evidence-capture-api'
import { VISIBLE_PDF } from './fusion-w2-binary-route'
import { PRINT_HANDOFF_KEY, W2_FILE, W2_MATERIAL_CHECK, W2_ORDER, W2_PRINT_PARAMS, writePrintHandoff } from './fusion-w2-state'

export const PRINT_CAPS = [
  { capabilityKey: 'document_print', status: 'available', note: null, configured: true, updatedAt: null },
  { capabilityKey: 'phone_upload', status: 'available', note: null, configured: true, updatedAt: null },
  { capabilityKey: 'usb_import', status: 'available', note: null, configured: true, updatedAt: null },
  { capabilityKey: 'scan', status: 'available', note: null, configured: true, updatedAt: null },
  { capabilityKey: 'format_convert', status: 'available', note: null, configured: true, updatedAt: null },
]

export async function see(page: Page, selector: string, timeout = 15_000): Promise<void> {
  await page.locator(selector).first().waitFor({ state: 'visible', timeout })
}

export function registerTouchShell(
  api: ApiRouter,
  printer: { isOnline: boolean; printerStatus: string; paperLevel?: string } = {
    isOnline: true,
    printerStatus: 'ready',
    paperLevel: 'sufficient',
  },
): void {
  registerEvidenceShell(api)
  // policy-favorite-walk.spec.ts 的正式构建会话应答。
  for (const action of ['start', 'heartbeat', 'end']) {
    api.respond('POST', `/api/v1/kiosk/session/${action}`, { status: 200, json: { success: true } })
  }
  const session = { sessionToken: 'pair-terminal-session-token-0123456789abcd' }
  api.respond('POST', '/api/v1/terminals/session-token', { status: 200, json: session })
  api.respond('POST', '/api/v1/terminals/session-token/refresh', { status: 200, json: session })
  api.respond('GET', '/api/v1/terminals/KSK-001/printer-status', {
    status: 200,
    json: {
      printerStatus: printer.printerStatus,
      paperLevel: printer.paperLevel ?? 'sufficient',
      isOnline: printer.isOnline,
    },
  })
  api.respond('GET', '/api/v1/terminals/KSK-001/capabilities', {
    status: 200,
    json: { capabilities: PRINT_CAPS },
  })
}

/** 正式构建的本机网桥：沿用 policy-favorite-walk / fusion-w3 的 CORS 造法。 */
export async function installLocalBridge(context: BrowserContext): Promise<void> {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Private-Network': 'true',
  }
  for (const [endpoint, method, json] of [
    ['terminal-identity', 'GET', { success: true, data: { terminalId: 'KSK-001', terminalCode: 'KSK-001' } }],
    ['terminal-boot-ticket', 'POST', { data: { bootTicket: 'pairboot-ticket-0123456789abcdef0123456789' } }],
  ] as const) {
    await context.route(`http://127.0.0.1:9527/local/${endpoint}`, async (route) => {
      if (route.request().method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers: cors })
      } else if (route.request().method() === method) {
        await route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(json) })
      } else {
        await route.abort('blockedbyclient')
      }
    })
  }
}

/** 标题出现不代表换票清场已结束；写业务种子前必须等票落定。 */
export async function terminalReady(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('terminal_session_token_v1')))
    .toBe('pair-terminal-session-token-0123456789abcd')
  await expect(page.getByText('这台机器的安全校验没通过', { exact: true })).toHaveCount(0)
}

export async function loginTo(page: Page, api: ApiRouter, returnTo: string): Promise<void> {
  registerMemberLogin(api)
  registerAuthenticatedMemberApis(api)
  // 并排预览是正式构建（不设 E2E token）。正式构建读到 data:null 会当成协议未发布，
  // 确认登录后停在「暂时无法登录」，不会进 returnTo。注册器之后补两份已发布版本（后写覆盖先写）。
  const published = { success: true, data: { version: '2026-10-01' } }
  api.respond('GET', '/api/v1/kiosk/legal/terms_of_service', { status: 200, json: published })
  api.respond('GET', '/api/v1/kiosk/legal/privacy_policy', { status: 200, json: published })
  page.setDefaultTimeout(60_000)
  page.setDefaultNavigationTimeout(60_000)
  await loginThroughVisibleUi(page, returnTo)
}

/** 交接里的 fileUrl 指向这份夹具 PDF。不挂上的话，缩略图画布读不到文件，屏上会写「预览没生成」。 */
export async function routeVisiblePdf(page: Page): Promise<void> {
  await page.route('**/w2-fixtures/**', async (route) => {
    if (new URL(route.request().url()).pathname !== '/w2-fixtures/sample-visible.pdf') {
      await route.fallback()
      return
    }
    await route.fulfill({ status: 200, contentType: 'application/pdf', body: VISIBLE_PDF })
  })
}

export async function openConfirm(page: Page, api: ApiRouter, billing: 'free' | 'fee'): Promise<void> {
  // 核对页要等终端会话 ready、打印机状态回来，按钮才会变成「确认并打印 / 去付款」。
  // 不注册这两条，正式构建会停在「安全校验没通过」和「状态未知」。
  registerTouchShell(api)
  await routeVisiblePdf(page)
  const free = billing === 'free'
  api.respond('GET', '/api/v1/print/price-config', {
    status: 200,
    json: {
      billingEnabled: !free,
      items: free
        ? []
        : [
            { serviceKey: 'print_bw_page', unitCents: 100, unit: 'page', description: '黑白打印' },
            { serviceKey: 'print_color_page', unitCents: 100, unit: 'page', description: '彩色打印' },
          ],
    },
  })
  api.respond('POST', '/api/v1/orders/quote', {
    status: 200,
    json: {
      amountCents: free ? 0 : 200,
      billablePages: W2_FILE.pages,
      billingPageSource: 'detected',
      priceLines: free
        ? []
        : [{
            serviceKey: 'print_bw_page',
            description: '黑白打印',
            unitCents: 100,
            quantity: W2_FILE.pages,
            amountCents: 200,
          }],
    },
  })
  // seedPrintFlow 的刷新和换票抢时间：票还没落下就刷新，交接会被清掉，核对页变成「没有待确认的任务」。
  // 先在服务台等会话落定，再写交接，软跳进核对页。
  await page.goto('/print-scan')
  await see(page, '[data-testid="print-hub-state-default"]')
  await terminalReady(page)
  await writePrintHandoff(page, { contextId: 'p1-evidence-000000001' })
  await spaGo(page, '/print/confirm', { printContextId: 'p1-evidence-000000001' })
  await see(page, '[data-w2-page="print-confirm"]')
  await expect(page.getByRole('button', { name: free ? '确认并打印' : '去付款', exact: true })).toBeEnabled()
  // 设备停用标准句带逗号；收费态正常出现的「这台机器暂时不能用优惠券」不算异常。
  await expect(page.locator('body')).not.toContainText(/状态未知|这台机器暂时不能用，|安全校验没通过|暂时打不了/)
}

/**
 * 收银台读的是 pay-status 快照，形状与 qingxu-pair-seeds 里未导出的 openCashier 相同。
 * 正式构建整页打开会换终端票：先在服务台等票落定，再带路由状态软跳进收银台（不再整页刷新）。
 */
export async function openCashier(page: Page, api: ApiRouter, kind: 'pending-qr' | 'expired'): Promise<void> {
  registerTouchShell(api)
  const later = new Date(Date.now() + 10 * 60 * 1000).toISOString()
  const attempt = kind === 'expired'
    ? {
        attemptId: 'pair-attempt',
        channel: 'wechat',
        status: 'expired',
        qrCodeContent: 'weixin://pair-qr',
        expiresAt: '2000-01-01T00:00:00.000Z',
      }
    : {
        attemptId: 'pair-attempt',
        channel: 'wechat',
        status: 'pending',
        qrCodeContent: 'weixin://pair-qr',
        expiresAt: later,
      }
  api.respond('GET', '/api/v1/payment/channels', { status: 200, json: { channels: ['wechat'] } })
  // 付款链路先对账再决定能否放行，应答照 cashier-qx.spec.ts。
  api.respond('POST', `/api/v1/orders/${W2_ORDER.orderId}/pay/reconcile`, {
    status: 200,
    json: { success: true, data: { status: 'pending' } },
  })
  api.respond('GET', `/api/v1/orders/${W2_ORDER.orderId}/pay-status`, {
    status: 200,
    json: {
      orderId: W2_ORDER.orderId,
      orderNo: W2_ORDER.orderNo,
      payStatus: 'paying',
      paymentSource: null,
      payChannel: null,
      amountCents: W2_ORDER.amountCents,
      paidAt: null,
      pickupCode: null,
      attempt,
    },
  })
  await page.goto('/print-scan')
  await see(page, '[data-testid="print-hub-state-default"]')
  await terminalReady(page)
  await spaGo(page, '/print/cashier', {
    orderId: W2_ORDER.orderId,
    orderNo: W2_ORDER.orderNo,
    amountCents: W2_ORDER.amountCents,
    paymentSessionToken: W2_ORDER.paymentSessionToken,
    source: 'document',
    taskId: W2_ORDER.taskId,
    file: W2_FILE,
    priceLines: [{
      serviceKey: 'print_bw_page',
      description: '黑白打印',
      unitCents: 100,
      quantity: W2_FILE.pages,
      amountCents: 200,
    }],
  })
  await see(page, `[data-qx-state="${kind}"]`)
}

/**
 * 正式构建每次整页加载都会换终端票并清掉打印交接。
 * seedPrintFlow 的 initScript 写在清场之前，刷新后桌面是空的。
 * 这里在清场之后写回同一份交接，再用 pushState 软跳，避免再刷新。
 */
export async function restorePrintHandoff(page: Page): Promise<void> {
  await page.evaluate(
    ({ key, file, params, materialCheck }) => {
      const now = Date.now()
      window.sessionStorage.setItem(key, JSON.stringify({
        v: 2,
        contextId: 'p1-evidence-000000001',
        origin: 'upload',
        file,
        source: 'document',
        fileUrlExpiresAt: null,
        owner: { kind: 'guest' },
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + 30 * 60 * 1000).toISOString(),
        checkPolicy: 'required',
        materialCheck,
        printParams: params,
        updatedAt: new Date(now).toISOString(),
      }))
    },
    { key: PRINT_HANDOFF_KEY, file: W2_FILE, params: W2_PRINT_PARAMS, materialCheck: W2_MATERIAL_CHECK },
  )
}

export async function spaGo(page: Page, path: string, state: unknown = null): Promise<void> {
  await page.evaluate(
    ({ nextPath, usr }) => {
      const current = window.history.state as { idx?: number } | null
      const idx = typeof current?.idx === 'number' ? current.idx + 1 : 1
      window.history.pushState({ usr, key: `pair-${idx}`, idx }, '', nextPath)
      window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }))
    },
    { nextPath: path, usr: state },
  )
}

/** 先离开再进入，同一地址的软跳不会让打印台重读交接。 */
export async function openPrintDesk(page: Page, step: 'check' | 'preview'): Promise<void> {
  await restorePrintHandoff(page)
  await spaGo(page, '/print-scan')
  await spaGo(page, `/print/desk?step=${step}`, { printContextId: 'p1-evidence-000000001' })
}

export async function writeSession(page: Page, key: string, value: unknown): Promise<void> {
  await page.evaluate(
    ({ storageKey, storageValue }) => {
      window.sessionStorage.setItem(storageKey, JSON.stringify(storageValue))
    },
    { storageKey: key, storageValue: value },
  )
}

export function stubTakeaway(api: ApiRouter, taskId: string): void {
  api.respond('POST', `/api/v1/print/jobs/${taskId}/takeaway-url`, {
    status: 404,
    json: { error: { code: 'PRINT_TASK_NOT_FOUND', message: '任务不存在' } },
  })
}
