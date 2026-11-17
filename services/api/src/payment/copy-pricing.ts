import { COPY_COLOR_MODES, COPY_DUPLEX_MODES } from '../copy-jobs/copy-job.types'
import type { CopyPriceInput, CopyQuoteResult } from '../copy-jobs/copy-job.types'
import type { PrismaTransactionClient } from '../prisma/prisma.service'
import { assertUserPaysUnit, getEffectiveUserPrices } from './effective-user-prices'

/**
 * 报价：原件页 × 份数按面计费，双面不减价。
 * 复印没有自己的价目行，单价等于该机同色打印的生效价（getEffectiveUserPrices）。
 * 不带终端一律 0 元。到机补价由 P2 做。
 * 向用户收费且配置价不是合法整数时不可报价（COPY_PRICE_INVALID）。
 * 金额不是 0 时，确认复印仍由 COPY_PAID_NOT_SUPPORTED 拒绝。
 */
export async function quoteCopy(
  input: CopyPriceInput & { terminalId?: string | null },
  db: Pick<PrismaTransactionClient, 'terminal' | 'platformSetting'>,
): Promise<CopyQuoteResult> {
  if (!Number.isSafeInteger(input.pageCount) || input.pageCount <= 0
    || !Number.isSafeInteger(input.copies) || input.copies <= 0
    || !COPY_COLOR_MODES.includes(input.colorMode) || !COPY_DUPLEX_MODES.includes(input.duplex)) {
    return { quotable: false, code: 'COPY_INVALID_PARAMETERS' }
  }
  const serviceKey = input.colorMode === 'color' ? 'print_color_page' : 'print_bw_page'
  let unitCents = 0
  if (input.terminalId?.trim()) {
    const prices = await getEffectiveUserPrices(db, input.terminalId)
    const row = prices.prices[serviceKey]
    try {
      assertUserPaysUnit(row)
    } catch (error) {
      if (error instanceof Error && error.message === 'PRICE_CONFIG_INVALID') {
        return { quotable: false, code: 'COPY_PRICE_INVALID' }
      }
      throw error
    }
    unitCents = row.effectiveCents
  }
  const billableSides = input.pageCount * input.copies
  const amountCents = billableSides * unitCents
  if (!Number.isSafeInteger(billableSides) || !Number.isSafeInteger(amountCents)) {
    return { quotable: false, code: 'COPY_PRICE_INVALID' }
  }
  return { quotable: true, quote: {
    serviceKey, unitCents,
    pageCount: input.pageCount, copies: input.copies, colorMode: input.colorMode, duplex: input.duplex,
    billableSides, amountCents,
  } }
}
