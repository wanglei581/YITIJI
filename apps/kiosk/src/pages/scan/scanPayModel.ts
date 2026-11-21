// ============================================================
// 扫描这一趟的按次付款判定与文案（P2e-4，只做纯计算与固定句子，不发请求、不碰存储）。
//
// 句子出处：设计稿 docs/design/kiosk-touch-2026-10/pay-1113.js 26–32 行通用句、353–378 行扫描页。
// 价格一律从终端配置 pricing.effective.scan 或服务单视图 amountCents 读，绝不硬编码价格。
// ============================================================
import { helpNeededLine } from '../../copy/unattendedCopy'
import { ApiHttpError } from '../../services/api/httpAdapter'
import { serviceOrderPhase, type ServiceOrderView } from '../../services/api/serviceOrders'
import { errorCodeOf } from '../../services/api/userErrorMessage'
import { PAY_BACK, formatYuan } from '../pay/payServiceModel'
import type { ScanOutcome } from './scanWorkbenchSession'

/** 稿 359 行说明条正文。 */
export const SCAN_PAY_BAR_DESC = `扫描。付好了才建立这次扫描。没扫成可免费再试一次；再不成，钱${PAY_BACK}。打印另按页计价。`

/** 稿 367 行按钮名（面板与屏上扫描失败且可免费再试时共用）。 */
export const SCAN_RETRY_FREE_LABEL = '免费再试一次'

/** 稿 29 / 369 行失败且可免费再试时的单独一行说明。 */
export const SCAN_RETRY_EXPLAIN = `这一次没做成。可以免费再试一次；不试了或再不成，钱${PAY_BACK}。`

/** 409 SERVICE_ORDER_IN_USE（这一次已经在进行）：不让用户再付，提示接着这一次。 */
export const SCAN_ORDER_IN_USE_NOTICE = '这一次已经付过款并且正在进行，不用再付。等刚才那场办完后，可直接接着这一次开始扫描。'

export const SCAN_ORDER_IN_USE_TITLE = '这一次扫描已经在进行'
export const SCAN_ORDER_IN_USE_DESCRIPTION =
  '这一次已经付过款并且正在进行，不用再付。等刚才那场办完后，可直接点下方按钮接着这一次继续。'

/** 稿 359 行按钮：付 X.XX 元开始扫描。 */
export function scanPayButtonLabel(amountCents: number): string {
  return `付 ${formatYuan(amountCents)}开始扫描`
}

/** 稿 359 行说明条标题：这一次 X.XX 元。 */
export function scanPayBarTitle(amountCents: number): string {
  return `这一次 ${formatYuan(amountCents)}`
}

/**
 * 从终端配置读出「扫描」这一项的本机生效价（分）。
 * 公共就业点位、向个人收费总开关关着、机构承担 → 0；配置或键读不到、非法 → null（不按收费拦）。
 */
export function readScanEffectiveCents(config: unknown): number | null {
  if (!config || typeof config !== 'object') return null
  const pricing = (config as { pricing?: unknown }).pricing
  if (!pricing || typeof pricing !== 'object') return null
  const record = pricing as {
    isPublicSite?: unknown
    personalChargeEnabled?: unknown
    userChargeMode?: unknown
    effective?: unknown
  }
  if (record.isPublicSite === true) return 0
  if (record.personalChargeEnabled === false) return 0
  if (record.userChargeMode === 'org_pays') return 0
  const effective = record.effective
  if (!effective || typeof effective !== 'object') return null
  const raw = (effective as Record<string, unknown>).scan
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0) return null
  return raw
}

/**
 * 这一张扫描服务单当前能否直接用于开始/重扫而不再出付款按钮：
 * - paid（未用过）与 retry_free（首次未成、10 分钟内可免费再试）直接放行；
 * - in_use 且 attemptsUsed < 2（首次失败后服务端 15–30 秒清扫尚未跑完，重扫时后端
 *   reclaimFailedScan 会当场回收继续用同一单；若仍在扫则会回 409 IN_USE 接着这一次）同样不再要用户付第二笔。
 */
export function scanTripAllowsStartWithoutPay(view: ServiceOrderView | null, nowMs: number): boolean {
  if (!view) return false
  const phase = serviceOrderPhase(view, nowMs)
  if (phase === 'paid' || phase === 'retry_free') return true
  return phase === 'in_use' && view.attemptsUsed < 2
}

/**
 * 在准备开始新一趟扫描（怎么扫 / 放纸设置 / 面板建会话前置核验）时，
 * 本地留存的服务单是否已经终结或彻底耗尽、绝不可再用于新一趟：
 * - done（consumed && settledAt，上一趟已结案）
 * - refunded / refund_failed / refunding / closed / timed_out / retry_expired
 * - not_paid 且服务端已关单（非 pending）
 * - in_use 且 attemptsUsed >= 2（两次机会均已用完，等后台清扫退款）
 * 这些旧单必须及时清掉，避免新一趟进付款屏被 done/in_use 误判为 ok 或污染新结果页。
 */
export function scanOrderIsEndedForNewTrip(view: ServiceOrderView | null, nowMs: number): boolean {
  if (!view) return false
  const phase = serviceOrderPhase(view, nowMs)
  if (
    phase === 'done'
    || phase === 'refunded'
    || phase === 'refund_failed'
    || phase === 'refunding'
    || phase === 'closed'
    || phase === 'timed_out'
    || phase === 'retry_expired'
  ) {
    return true
  }
  if (phase === 'not_paid') return view.status !== 'pending'
  return phase === 'in_use' && view.attemptsUsed >= 2
}

export type ScanFailedOrderNoticeKind =
  | 'none'
  | 'retry_free'
  | 'consumed_exhausted'
  | 'refunding'
  | 'refunded'
  | 'refund_failed'
  | 'retry_expired'

export interface ScanFailedOrderNotice {
  kind: ScanFailedOrderNoticeKind
  text: string | null
}

/**
 * 扫描失败结果屏（面板 / 屏上共用）的服务单状态说明。
 * 严格按服务单状态说话：未到 refunded 绝不写「已退」。
 */
export function scanFailedOrderNotice(
  view: ServiceOrderView | null,
  nowMs: number,
  outcome: ScanOutcome,
): ScanFailedOrderNotice {
  if (!view) return { kind: 'none', text: null }
  const phase = serviceOrderPhase(view, nowMs)
  if (phase === 'retry_free' || phase === 'paid') {
    return { kind: 'retry_free', text: SCAN_RETRY_EXPLAIN }
  }
  if (phase === 'in_use') {
    if ((outcome === 'failed' || outcome === 'expired') && view.attemptsUsed < 2) {
      return { kind: 'retry_free', text: SCAN_RETRY_EXPLAIN }
    }
    if (view.attemptsUsed >= 2) {
      return {
        kind: 'consumed_exhausted',
        text: `这一次没做成。两次机会已用完，系统核实未出文件后，钱会${PAY_BACK}。`,
      }
    }
    return { kind: 'none', text: null }
  }
  if (phase === 'refunding') {
    return {
      kind: 'refunding',
      text: '这一次没做成。钱正在退回原付款账户，到账时间以支付渠道为准。',
    }
  }
  if (phase === 'refunded') {
    return {
      kind: 'refunded',
      text: '这一次没做成。钱已退回原付款账户，到账时间以支付渠道为准。',
    }
  }
  if (phase === 'refund_failed') {
    return {
      kind: 'refund_failed',
      text: `这一次没做成。退款暂时没退成，钱会退回原付款账户，到账时间以支付渠道为准。${helpNeededLine()}。`,
    }
  }
  if (phase === 'retry_expired') {
    return {
      kind: 'retry_expired',
      text: `这一次没做成。免费再试期限已过，钱会${PAY_BACK}。`,
    }
  }
  return { kind: 'none', text: null }
}

/** 成功完成页取这一趟已付金额（分）。没付过、未扣款、已退款一律返回 null（完成页一字不改）。 */
export function scanPaidAmountCentsForDone(view: ServiceOrderView | null): number | null {
  if (!view || view.amountCents <= 0) return null
  if (view.status === 'consumed' || view.status === 'paid') return view.amountCents
  return null
}

/** 服务单是不是还在等后端清扫落定（失败结果页需要轻轮询）。 */
export function scanOrderNeedsSettlePoll(view: ServiceOrderView | null): boolean {
  if (!view) return false
  return (view.status === 'consumed' && !view.settledAt) || view.status === 'refunding'
}

/** 409 SERVICE_ORDER_IN_USE：这一次已经在进行，绝不让再付。 */
export function isScanOrderInUseError(error: unknown): boolean {
  return errorCodeOf(error) === 'SERVICE_ORDER_IN_USE'
}

/** 402 或其它 SERVICE_*（排除 SERVICE_ORDER_IN_USE）：回付款屏完成这一趟付款。 */
export function shouldReturnToScanPay(error: unknown): boolean {
  if (isScanOrderInUseError(error)) return false
  if (error instanceof ApiHttpError && error.status === 402) return true
  const code = errorCodeOf(error)
  return Boolean(code && code.startsWith('SERVICE_'))
}

/** 服务端拒单时明确不可再复用的错误码：回付款屏前先忘掉旧单号，保证建新单。 */
export const SCAN_UNUSABLE_ORDER_ERROR_CODES: ReadonlySet<string> = new Set([
  'SERVICE_ORDER_NOT_FOUND',
  'SERVICE_ORDER_EXPIRED',
  'SERVICE_ORDER_REFUNDED',
  'SERVICE_ORDER_USED',
  'SERVICE_ORDER_REF_OCCUPIED',
])

export function shouldForgetScanTripOnPayError(error: unknown): boolean {
  const code = errorCodeOf(error)
  return Boolean(code && SCAN_UNUSABLE_ORDER_ERROR_CODES.has(code))
}
