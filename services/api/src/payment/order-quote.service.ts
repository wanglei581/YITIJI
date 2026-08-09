import { BadRequestException, Injectable } from '@nestjs/common'
import { countPagesInRange } from '../print-jobs/page-range.util'
import { PrintPageCountService } from '../print-jobs/print-page-count.service'
import { assertVerifiedPrintParameters } from '../print-jobs/verified-print-parameters'
import type { QuotePrintOrderDto } from './dto/quote-print-order.dto'
import { PricingService } from './pricing.service'
import type { PrintPriceQuote } from './payment.types'

const DEFAULT_COPIES = 1
const DEFAULT_COLOR_MODE = 'black_white' as const

/**
 * P0-1 打印报价（支付域，不落库）。
 *
 * 复用 PrintPageCountService（签名 fileUrl 验签 + 真实页数识别）与 PricingService（PriceConfig），
 * 并接入 countPagesInRange，使报价与建单 / Agent 出纸页数一致。
 *
 * 硬约束：
 * - **不落库**：不建 Order / PrintTask，不写 PriceConfig，不触发 markPaid。
 * - **不信任前端金额 / 页数**：只接受签名 fileUrl + 打印参数。
 * - **fail-closed**：签名无效 / 页数识别失败 / 页码范围非法 / 无 active 价目 → 抛错。
 */
@Injectable()
export class OrderQuoteService {
  constructor(
    private readonly pageCount: PrintPageCountService,
    private readonly pricing: PricingService,
  ) {}

  async quote(dto: QuotePrintOrderDto): Promise<PrintPriceQuote> {
    assertVerifiedPrintParameters(dto.params)
    const { billablePages: documentPages, billingPageSource } =
      await this.pageCount.resolveBillablePages(dto.fileUrl)

    const billablePages = countPagesInRange(dto.params?.pageRange, documentPages)
    if (billablePages === null) {
      throw new BadRequestException({
        error: {
          code: 'PRINT_PAGE_RANGE_INVALID',
          message: '页码范围无效或未选中任何页面',
        },
      })
    }

    const copies = dto.params?.copies ?? DEFAULT_COPIES
    const colorMode = dto.params?.colorMode ?? DEFAULT_COLOR_MODE
    return this.pricing.quotePrint({ billablePages, billingPageSource, copies, colorMode })
  }
}
