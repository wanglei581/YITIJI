import type { PrintJobParams } from '@ai-job-print/shared'
import type { PrintPriceChangedQuote } from '../../services/print/printJobsApi'
import type { QuoteView } from './printConfirmModel'

type PriceCfgView =
  | { status: 'loading' }
  | { status: 'ready'; unitCents: number | null }
  | { status: 'error' }

/** 报价接口与 409 PRICE_CHANGED 带回的现价共用同一换算，两处展示口径一致。 */
export function readyQuoteView(q: PrintPriceChangedQuote, copies: number): QuoteView {
  const line = q.priceLines[0]
  return {
    status: 'ready',
    amountCents: q.amountCents,
    billablePages: q.billablePages,
    unitCents: line?.unitCents ?? 0,
    quantity: line?.quantity ?? q.billablePages * copies,
  }
}

/** 报价键：最终出纸文件 + 全部打印参数。 */
export function quoteKeyOf(fileUrl: string | null | undefined, params: PrintJobParams): string {
  return `${fileUrl ?? ''}|${JSON.stringify(params)}`
}

/**
 * 409 已经把屏上换成服务端现价、并写了「请核对新金额后再点确认」时，
 * 权益卡以这一笔现价为准，不再拿另一次公示价判成「不要按本屏金额付款」。
 * 公示价没读回来时不顶替，仍走「取不到现行价目」。
 * 没有这条提示时，开页报价和公示价对不上仍是 repriced。
 */
export function priceConfigForBenefit(
  quote: QuoteView,
  priceCfg: PriceCfgView,
  trustOnScreenQuote: boolean,
): { status: 'loading' | 'ready' | 'error'; unitCents: number | null } {
  if (trustOnScreenQuote && quote.status === 'ready' && priceCfg.status !== 'error') {
    return { status: 'ready', unitCents: quote.unitCents }
  }
  if (priceCfg.status === 'ready') return { status: 'ready', unitCents: priceCfg.unitCents }
  return { status: priceCfg.status, unitCents: null }
}

const STAY_WHEN_FREE = '提交后请留在机器旁，任务确认后自动开始打印。'
const STAY_WHEN_PAID = '提交后请留在机器旁，任务确认后自动开始打印（免费任务直接进入打印队列，付费任务完成支付后开始）。'
/** 价目没读到。状态条上已有这句，提醒和须知不再另说免费或付费。 */
const STAY_WHEN_PRICE_UNKNOWN = '本机没能取到现行价目'

/** 提醒条和打印须知共用。价没读到时两处都不说免费，也不说付费。 */
export function confirmStayLine(priceKnown: boolean, free: boolean): string {
  if (!priceKnown) return STAY_WHEN_PRICE_UNKNOWN
  return free ? STAY_WHEN_FREE : STAY_WHEN_PAID
}
