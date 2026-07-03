import { BadRequestException, Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import type { BillingPageSource } from '../print-jobs/print-page-count.types'
import type { PrintPriceLine, PrintPriceQuote } from './payment.types'

/** 报价输入：后端识别页数（来自 PrintPageCountService）+ 打印参数。 */
export interface PrintPriceInput {
  billablePages: number
  billingPageSource: BillingPageSource
  copies: number
  colorMode: 'black_white' | 'color'
}

/**
 * P0a 打印报价（支付域，无 live 网关）。
 *
 * 价目真相源是数据库 `PriceConfig`（开发默认价由 price-config.seed 幂等写入）。
 * amountCents = 单价(PriceConfig) × billablePages × copies，整数「分」。
 *
 * 硬约束：
 * - **绝不信任前端金额**：金额只由本 service 依据 PriceConfig 计算。
 * - **fail-closed**：无 active 价目 / 价目异常 / 非法页数或份数 → 抛错拒绝，**绝不默认 0 元**。
 * - 本批按内容页计价，duplex / pagesPerSheet 不影响单价（见 price-config.seed 说明）。
 *
 * 注：本 service 只计算报价，不落库、不改 Order 状态机、不接建单（接线留 Task 6）。
 */
@Injectable()
export class PricingService {
  constructor(private readonly prisma: PrismaService) {}

  async quotePrint(input: PrintPriceInput): Promise<PrintPriceQuote> {
    const { billablePages, billingPageSource, copies, colorMode } = input

    if (!Number.isInteger(billablePages) || billablePages <= 0) {
      throw new BadRequestException('PRICE_INVALID_PAGES')
    }
    if (!Number.isInteger(copies) || copies <= 0) {
      throw new BadRequestException('PRICE_INVALID_COPIES')
    }

    const serviceKey = colorMode === 'color' ? 'print_color_page' : 'print_bw_page'
    const config = await this.prisma.priceConfig.findUnique({ where: { serviceKey } })
    if (!config || !config.active) {
      throw new BadRequestException('PRICE_CONFIG_UNAVAILABLE')
    }
    if (!Number.isInteger(config.unitCents) || config.unitCents < 0) {
      throw new BadRequestException('PRICE_CONFIG_INVALID')
    }

    const quantity = billablePages * copies
    const subtotalCents = config.unitCents * quantity
    const line: PrintPriceLine = {
      serviceKey,
      unitCents: config.unitCents,
      quantity,
      subtotalCents,
      description: config.description ?? undefined,
    }

    return {
      amountCents: subtotalCents,
      billablePages,
      billingPageSource,
      lines: [line],
    }
  }
}
