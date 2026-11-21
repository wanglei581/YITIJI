/**
 * 扫描按次付款纯逻辑单测（P2e-4）：直接转译运行 src/pages/scan/scanPayModel.ts，
 * 覆盖终端生效价读取、免费/公共点位/读不到价兜底、可免费再试与退款中/已退/失败文案、
 * 成功页已付/未付金额、409 IN_USE 与 402/SERVICE_* 分流。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const kioskRoot = join(dirname(fileURLToPath(import.meta.url)), '../..')
const toDataUrl = (code) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
const transpile = (rel) => ts.transpileModule(readFileSync(join(kioskRoot, rel), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: rel,
}).outputText

const httpAdapterUrl = toDataUrl(
  'export class ApiHttpError extends Error { constructor(code, message, status) { super(message); this.code = code; this.status = status } }',
)
const unattendedUrl = toDataUrl(transpile('src/copy/unattendedCopy.ts'))
const userErrorsUrl = toDataUrl(
  transpile('src/services/api/userErrorMessage.ts')
    .replaceAll("'./httpAdapter'", `'${httpAdapterUrl}'`)
    .replaceAll("'../../copy/unattendedCopy'", `'${unattendedUrl}'`),
)
const serviceOrdersUrl = toDataUrl(
  transpile('src/services/api/serviceOrders.ts')
    .replaceAll("from '../terminalAuth'", `from '${toDataUrl('export async function terminalProtectedFetch() { throw new Error("unused") }')}'`)
    .replaceAll("from './client'", `from '${toDataUrl('export const API_BASE_URL = "/api/v1"; export const API_MODE = "http"')}'`)
    .replaceAll("from './httpAdapter'", `from '${httpAdapterUrl}'`)
    .replaceAll("from './throwHttpError'", `from '${toDataUrl('export function networkError(e) { return e }; export async function readHttpError() { return { code: "ERR", message: "err" } }')}'`),
)
const payModelUrl = toDataUrl(
  transpile('src/pages/pay/payServiceModel.ts')
    .replaceAll("'../../copy/unattendedCopy'", `'${unattendedUrl}'`)
    .replaceAll("'../../services/api/userErrorMessage'", `'${userErrorsUrl}'`),
)
const scanPayModelUrl = toDataUrl(
  transpile('src/pages/scan/scanPayModel.ts')
    .replaceAll("'../../copy/unattendedCopy'", `'${unattendedUrl}'`)
    .replaceAll("'../../services/api/httpAdapter'", `'${httpAdapterUrl}'`)
    .replaceAll("'../../services/api/serviceOrders'", `'${serviceOrdersUrl}'`)
    .replaceAll("'../../services/api/userErrorMessage'", `'${userErrorsUrl}'`)
    .replaceAll("'../pay/payServiceModel'", `'${payModelUrl}'`),
)

const { ApiHttpError } = await import(httpAdapterUrl)
const mod = await import(scanPayModelUrl)

const NOW = Date.parse('2026-11-21T08:00:00.000Z')

function makeOrder(overrides = {}) {
  return {
    id: 'ord-scan-1',
    serviceKey: 'scan',
    serviceName: '扫描',
    status: 'paid',
    amountCents: 100,
    expiresAt: new Date(NOW + 5 * 60_000).toISOString(),
    qrCodeContent: null,
    paidAt: new Date(NOW - 30_000).toISOString(),
    refundReason: null,
    refundedAt: null,
    failureReason: null,
    retryUntil: null,
    attemptsUsed: 0,
    settledAt: null,
    closeReason: null,
    paymentFailed: false,
    checking: false,
    consumedAt: null,
    provider: 'sandbox',
    ...overrides,
  }
}

test('readScanEffectiveCents 正确处理收费、0 元、公共点位、总开关关闭、机构付、读不到价', () => {
  assert.equal(mod.readScanEffectiveCents({
    pricing: { personalChargeEnabled: true, userChargeMode: 'user_pays', isPublicSite: false, effective: { scan: 100 } },
  }), 100)
  assert.equal(mod.readScanEffectiveCents({
    pricing: { personalChargeEnabled: true, userChargeMode: 'user_pays', isPublicSite: false, effective: { scan: 0 } },
  }), 0)
  assert.equal(mod.readScanEffectiveCents({
    pricing: { personalChargeEnabled: true, userChargeMode: 'user_pays', isPublicSite: true, effective: { scan: 100 } },
  }), 0)
  assert.equal(mod.readScanEffectiveCents({
    pricing: { personalChargeEnabled: false, userChargeMode: 'user_pays', isPublicSite: false, effective: { scan: 100 } },
  }), 0)
  assert.equal(mod.readScanEffectiveCents({
    pricing: { personalChargeEnabled: true, userChargeMode: 'org_pays', isPublicSite: false, effective: { scan: 100 } },
  }), 0)
  assert.equal(mod.readScanEffectiveCents({}), null)
  assert.equal(mod.readScanEffectiveCents(null), null)
  assert.equal(mod.readScanEffectiveCents({ pricing: { effective: { scan: -1 } } }), null)
})

test('scanTripAllowsStartWithoutPay 对 paid、可免费再试与首次未结案 consumed 放行，其余拦截', () => {
  assert.equal(mod.scanTripAllowsStartWithoutPay(makeOrder({ status: 'paid', attemptsUsed: 0 }), NOW), true)
  assert.equal(mod.scanTripAllowsStartWithoutPay(makeOrder({
    status: 'paid', attemptsUsed: 1, retryUntil: new Date(NOW + 60_000).toISOString(),
  }), NOW), true)
  assert.equal(mod.scanTripAllowsStartWithoutPay(makeOrder({
    status: 'consumed', attemptsUsed: 1, settledAt: null,
  }), NOW), true)
  assert.equal(mod.scanTripAllowsStartWithoutPay(makeOrder({
    status: 'consumed', attemptsUsed: 2, settledAt: null,
  }), NOW), false)
  assert.equal(mod.scanTripAllowsStartWithoutPay(makeOrder({
    status: 'consumed', attemptsUsed: 1, settledAt: new Date(NOW).toISOString(),
  }), NOW), false)
  assert.equal(mod.scanTripAllowsStartWithoutPay(makeOrder({ status: 'pending' }), NOW), false)
  assert.equal(mod.scanTripAllowsStartWithoutPay(makeOrder({ status: 'refunding', attemptsUsed: 2 }), NOW), false)
  assert.equal(mod.scanTripAllowsStartWithoutPay(makeOrder({ status: 'refunded', attemptsUsed: 2 }), NOW), false)
})

test('scanFailedOrderNotice 严格按服务单状态说话：未 refunded 绝不出现「已退」', () => {
  const retry = mod.scanFailedOrderNotice(
    makeOrder({ status: 'paid', attemptsUsed: 1, retryUntil: new Date(NOW + 60_000).toISOString() }),
    NOW,
    'expired',
  )
  assert.equal(retry.kind, 'retry_free')
  assert.equal(retry.text, mod.SCAN_RETRY_EXPLAIN)
  assert.doesNotMatch(retry.text, /已退|¥|工作人员|微信或支付宝/)

  const consumed1 = mod.scanFailedOrderNotice(
    makeOrder({ status: 'consumed', attemptsUsed: 1, settledAt: null }),
    NOW,
    'failed',
  )
  assert.equal(consumed1.kind, 'retry_free')
  assert.equal(consumed1.text, mod.SCAN_RETRY_EXPLAIN)

  const consumed2 = mod.scanFailedOrderNotice(
    makeOrder({ status: 'consumed', attemptsUsed: 2, settledAt: null }),
    NOW,
    'failed',
  )
  assert.equal(consumed2.kind, 'consumed_exhausted')
  assert.doesNotMatch(consumed2.text, /已退|¥|工作人员/)

  const refunding = mod.scanFailedOrderNotice(makeOrder({ status: 'refunding', attemptsUsed: 2 }), NOW, 'failed')
  assert.equal(refunding.kind, 'refunding')
  assert.match(refunding.text, /正在退回/)
  assert.doesNotMatch(refunding.text, /已退|¥|工作人员/)

  const refunded = mod.scanFailedOrderNotice(makeOrder({ status: 'refunded', attemptsUsed: 2 }), NOW, 'failed')
  assert.equal(refunded.kind, 'refunded')
  assert.match(refunded.text, /钱已退回原付款账户/)
  assert.doesNotMatch(refunded.text, /¥|工作人员/)

  const refundFailed = mod.scanFailedOrderNotice(makeOrder({ status: 'refund_failed', attemptsUsed: 2 }), NOW, 'failed')
  assert.equal(refundFailed.kind, 'refund_failed')
  assert.doesNotMatch(refundFailed.text, /已退|¥|工作人员/)

  const unpaid = mod.scanFailedOrderNotice(null, NOW, 'failed')
  assert.deepEqual(unpaid, { kind: 'none', text: null })
})

test('scanPaidAmountCentsForDone 仅对已付/已消费且正金额返回分值，没付过返回 null', () => {
  assert.equal(mod.scanPaidAmountCentsForDone(makeOrder({ status: 'consumed', amountCents: 150 })), 150)
  assert.equal(mod.scanPaidAmountCentsForDone(makeOrder({ status: 'paid', amountCents: 100 })), 100)
  assert.equal(mod.scanPaidAmountCentsForDone(makeOrder({ status: 'pending', amountCents: 100 })), null)
  assert.equal(mod.scanPaidAmountCentsForDone(makeOrder({ status: 'refunded', amountCents: 100 })), null)
  assert.equal(mod.scanPaidAmountCentsForDone(makeOrder({ status: 'consumed', amountCents: 0 })), null)
  assert.equal(mod.scanPaidAmountCentsForDone(null), null)
})

test('409 SERVICE_ORDER_IN_USE 不回付款屏；402 与其它 SERVICE_* 回付款屏', () => {
  const inUse = new ApiHttpError('SERVICE_ORDER_IN_USE', '这一次已经在进行', 409)
  const payReq = new ApiHttpError('SERVICE_PAYMENT_REQUIRED', '这一次要先付款', 402)
  const notFound = new ApiHttpError('SERVICE_ORDER_NOT_FOUND', '没有这一张付款单', 404)
  const refOcc = new ApiHttpError('SERVICE_ORDER_REF_OCCUPIED', '已占用', 409)
  const busy = new ApiHttpError('SCAN_TERMINAL_BUSY', '忙', 409)

  assert.equal(mod.isScanOrderInUseError(inUse), true)
  assert.equal(mod.shouldReturnToScanPay(inUse), false)
  assert.equal(mod.shouldReturnToScanPay(payReq), true)
  assert.equal(mod.shouldReturnToScanPay(notFound), true)
  assert.equal(mod.shouldReturnToScanPay(refOcc), true)
  assert.equal(mod.shouldReturnToScanPay(busy), false)

  for (const code of [
    'SERVICE_ORDER_NOT_FOUND',
    'SERVICE_ORDER_EXPIRED',
    'SERVICE_ORDER_REFUNDED',
    'SERVICE_ORDER_USED',
    'SERVICE_ORDER_REF_OCCUPIED',
  ]) {
    assert.equal(mod.shouldForgetScanTripOnPayError(new ApiHttpError(code, 'err', 402)), true, code)
  }
  assert.equal(mod.shouldForgetScanTripOnPayError(payReq), false)
  assert.equal(mod.shouldForgetScanTripOnPayError(inUse), false)
})

test('scanOrderIsEndedForNewTrip 识别已结案与不可复用旧单，保留待付/已付/可免费再试单', () => {
  assert.equal(mod.scanOrderIsEndedForNewTrip(makeOrder({ status: 'consumed', attemptsUsed: 1, settledAt: new Date(NOW).toISOString() }), NOW), true)
  assert.equal(mod.scanOrderIsEndedForNewTrip(makeOrder({ status: 'consumed', attemptsUsed: 2, settledAt: null }), NOW), true)
  assert.equal(mod.scanOrderIsEndedForNewTrip(makeOrder({ status: 'refunded', attemptsUsed: 2 }), NOW), true)
  assert.equal(mod.scanOrderIsEndedForNewTrip(makeOrder({ status: 'refunding', attemptsUsed: 2 }), NOW), true)
  assert.equal(mod.scanOrderIsEndedForNewTrip(makeOrder({ status: 'refund_failed', attemptsUsed: 2 }), NOW), true)
  assert.equal(mod.scanOrderIsEndedForNewTrip(makeOrder({ status: 'closed', closeReason: 'user_cancelled' }), NOW), true)
  assert.equal(mod.scanOrderIsEndedForNewTrip(makeOrder({ status: 'closed', closeReason: 'expired' }), NOW), true)
  assert.equal(mod.scanOrderIsEndedForNewTrip(makeOrder({ status: 'closed', closeReason: 'price_changed' }), NOW), true)
  assert.equal(mod.scanOrderIsEndedForNewTrip(makeOrder({ status: 'paid', attemptsUsed: 1, retryUntil: new Date(NOW - 1000).toISOString() }), NOW), true)
  assert.equal(mod.scanOrderIsEndedForNewTrip(makeOrder({ status: 'pending', expiresAt: new Date(NOW - 1000).toISOString() }), NOW), true)

  assert.equal(mod.scanOrderIsEndedForNewTrip(makeOrder({ status: 'paid', attemptsUsed: 0 }), NOW), false)
  assert.equal(mod.scanOrderIsEndedForNewTrip(makeOrder({ status: 'paid', attemptsUsed: 1, retryUntil: new Date(NOW + 60_000).toISOString() }), NOW), false)
  assert.equal(mod.scanOrderIsEndedForNewTrip(makeOrder({ status: 'consumed', attemptsUsed: 1, settledAt: null }), NOW), false)
  assert.equal(mod.scanOrderIsEndedForNewTrip(makeOrder({ status: 'pending', expiresAt: new Date(NOW + 60_000).toISOString() }), NOW), false)
  assert.equal(mod.scanOrderIsEndedForNewTrip(makeOrder({ status: 'pending', checking: true, expiresAt: new Date(NOW - 1000).toISOString() }), NOW), false)
})

test('scanOrderBelongsToScanTask 与 scanPaidAmountCentsForDone 按任务归属核对，绝不串旧单金额', () => {
  const settledOld = makeOrder({ id: 'ord-old', status: 'consumed', amountCents: 137, attemptsUsed: 1, settledAt: new Date(NOW).toISOString() })
  const liveOld = makeOrder({ id: 'ord-old', status: 'consumed', amountCents: 137, attemptsUsed: 1, settledAt: null })

  // 未绑定当前任务/代次的已结案旧单：拒绝展示旧金额
  assert.equal(mod.scanOrderBelongsToScanTask(settledOld, { taskId: null, boundOrderId: undefined, generationMatched: false }), false)
  assert.equal(mod.scanPaidAmountCentsForDone(settledOld, { taskId: null, boundOrderId: undefined, generationMatched: false }), null)

  // 当前任务明确未付新建（boundOrderId: null）：无论旧单是否结案都不借用金额
  assert.equal(mod.scanPaidAmountCentsForDone(liveOld, { taskId: 'task-unpaid-2', boundOrderId: null, generationMatched: false }), null)
  assert.equal(mod.scanPaidAmountCentsForDone(settledOld, { taskId: 'task-unpaid-2', boundOrderId: null, generationMatched: false }), null)

  // 当前任务绑定了另一张单号：拒绝
  assert.equal(mod.scanPaidAmountCentsForDone(settledOld, { taskId: 'task-2', boundOrderId: 'ord-new', generationMatched: true }), null)

  // 订单带非空 resourceId 且与当前任务不一致：拒绝；一致：放行
  const withRef = { ...settledOld, resourceId: 'task-1' }
  assert.equal(mod.scanPaidAmountCentsForDone(withRef, { taskId: 'task-2' }), null)
  assert.equal(mod.scanPaidAmountCentsForDone(withRef, { taskId: null }), null)
  assert.equal(mod.scanPaidAmountCentsForDone(withRef, { taskId: 'task-1' }), 137)

  // 当前任务正是用这张单建出来的：即使服务端已结案（settledAt 非空）仍如实展示实付额
  assert.equal(mod.scanPaidAmountCentsForDone(settledOld, { taskId: 'task-1', boundOrderId: 'ord-old', generationMatched: true }), 137)

  // 订单在内存里已绑定给别的任务：拒绝借给未知新任务
  assert.equal(mod.scanPaidAmountCentsForDone(liveOld, { taskId: 'task-other', boundOrderId: undefined, orderBoundToOtherTask: true }), null)
})

test('文案拼接符合稿 359 行且不含禁止词', () => {
  assert.equal(mod.scanPayButtonLabel(100), '付 1.00 元开始扫描')
  assert.equal(mod.scanPayBarTitle(150), '这一次 1.50 元')
  assert.equal(
    mod.SCAN_PAY_BAR_DESC,
    '扫描。付好了才建立这次扫描。没扫成可免费再试一次；再不成，钱自动退回原付款账户，到账时间以支付渠道为准。打印另按页计价。',
  )
  assert.doesNotMatch(`${mod.SCAN_PAY_BAR_DESC}${mod.SCAN_RETRY_EXPLAIN}${mod.SCAN_ORDER_IN_USE_NOTICE}`, /¥|工作人员|微信或支付宝/)
})
