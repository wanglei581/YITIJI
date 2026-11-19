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
