import { COPY_COLOR_MODES, COPY_DUPLEX_MODES } from '../copy-jobs/copy-job.types'
import type { CopyPriceInput, CopyPriceRow, CopyQuoteResult } from '../copy-jobs/copy-job.types'

/** 纯报价：按面计费，双面不折半。只有有效的明确 0 价才是免费。 */
export function quoteCopy(input: CopyPriceInput, rows: readonly CopyPriceRow[]): CopyQuoteResult {
  if (!Number.isSafeInteger(input.pageCount) || input.pageCount <= 0
    || !Number.isSafeInteger(input.copies) || input.copies <= 0
    || !COPY_COLOR_MODES.includes(input.colorMode) || !COPY_DUPLEX_MODES.includes(input.duplex)) {
    return { quotable: false, code: 'COPY_INVALID_PARAMETERS' }
  }
  const serviceKey = input.colorMode === 'color' ? 'copy_color_page' : 'copy_bw_page'
  const config = rows.find((row) => row.serviceKey === serviceKey)
  if (!config || !config.active) return { quotable: false, code: 'COPY_PRICE_UNAVAILABLE' }
  if (config.unit !== 'page' || !Number.isSafeInteger(config.unitCents) || config.unitCents < 0) {
    return { quotable: false, code: 'COPY_PRICE_INVALID' }
  }
  const billableSides = input.pageCount * input.copies
  const amountCents = billableSides * config.unitCents
  if (!Number.isSafeInteger(billableSides) || !Number.isSafeInteger(amountCents)) {
    return { quotable: false, code: 'COPY_PRICE_INVALID' }
  }
  return { quotable: true, quote: {
    serviceKey, unitCents: config.unitCents,
    pageCount: input.pageCount, copies: input.copies, colorMode: input.colorMode, duplex: input.duplex,
    billableSides, amountCents,
  } }
}
