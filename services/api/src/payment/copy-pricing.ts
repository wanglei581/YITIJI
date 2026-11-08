import { COPY_COLOR_MODES, COPY_DUPLEX_MODES } from '../copy-jobs/copy-job.types'
import type { CopyPriceInput, CopyQuoteResult } from '../copy-jobs/copy-job.types'
import type { PrismaTransactionClient } from '../prisma/prisma.service'
import { readPrintUnitPrice } from './pricing.service'

/**
 * 报价：原件页 × 份数按面计费，双面不减价。
 * 逐机复印价是以后的包；在那之前复印没有自己的价目行，单价默认等于该机同色打印单价，
 * 与打印走同一个 readPrintUnitPrice，缺行、停用、单价非法时与打印同样不可报价。
 */
export async function quoteCopy(
  input: CopyPriceInput,
  db: Pick<PrismaTransactionClient, 'priceConfig'>,
): Promise<CopyQuoteResult> {
  if (!Number.isSafeInteger(input.pageCount) || input.pageCount <= 0
    || !Number.isSafeInteger(input.copies) || input.copies <= 0
    || !COPY_COLOR_MODES.includes(input.colorMode) || !COPY_DUPLEX_MODES.includes(input.duplex)) {
    return { quotable: false, code: 'COPY_INVALID_PARAMETERS' }
  }
  const price = await readPrintUnitPrice(db, input.colorMode)
  if (!price.ok) {
    return { quotable: false, code: price.code === 'PRICE_CONFIG_UNAVAILABLE' ? 'COPY_PRICE_UNAVAILABLE' : 'COPY_PRICE_INVALID' }
  }
  const billableSides = input.pageCount * input.copies
  const amountCents = billableSides * price.unitCents
  if (!Number.isSafeInteger(billableSides) || !Number.isSafeInteger(amountCents)) {
    return { quotable: false, code: 'COPY_PRICE_INVALID' }
  }
  return { quotable: true, quote: {
    serviceKey: price.serviceKey, unitCents: price.unitCents,
    pageCount: input.pageCount, copies: input.copies, colorMode: input.colorMode, duplex: input.duplex,
    billableSides, amountCents,
  } }
}
