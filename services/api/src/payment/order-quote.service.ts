import { BadRequestException, Injectable } from '@nestjs/common'
import { countPagesInRange } from '../print-jobs/page-range.util'
import { PrintPageCountService } from '../print-jobs/print-page-count.service'
import { assertVerifiedPrintParameters } from '../print-jobs/verified-print-parameters'
import { TerminalCapabilitiesService } from '../terminals/terminal-capabilities.service'
import { requiredPrintCapabilityKeys } from '../terminals/terminal-capabilities.types'
import { PrismaService } from '../prisma/prisma.service'
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
    private readonly capabilities: TerminalCapabilitiesService,
    private readonly prisma: PrismaService,
  ) {}

  async quote(dto: QuotePrintOrderDto): Promise<PrintPriceQuote> {
    // 门禁第 1 层：全局产品边界（N-up 恒拒）。
    assertVerifiedPrintParameters(dto.params)
    // 门禁第 2 层：彩色/双面必须在**计价之前**证明这台机器验过。
    // 报价就是用户看到的价；先按彩色报价、建单再拒，等于用错价把人骗到付款页。
    await this.assertTerminalAllowsParams(dto)
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

  /**
   * 报价路径的终端能力门禁。
   *
   * 黑白单面（基线组合）不需要 terminalId，历史调用方不受影响。
   * 一旦请求彩色 / 双面，terminalId 变成必填：没有终端就无法判断「验过没有」，
   * 此时**拒绝**而不是悄悄按黑白计价 —— 后者会让用户以为选中了彩色。
   */
  private async assertTerminalAllowsParams(dto: QuotePrintOrderDto): Promise<void> {
    const required = requiredPrintCapabilityKeys(dto.params ?? {})
    if (required.length === 0) return

    if (!dto.terminalId) {
      throw new BadRequestException({
        error: {
          code: 'PRINT_TERMINAL_REQUIRED_FOR_PARAMS',
          message: '彩色 / 双面报价必须指定目标终端，才能确认该终端已通过真机验证',
        },
      })
    }

    const terminal = await this.prisma.terminal.findFirst({
      where: { OR: [{ id: dto.terminalId }, { terminalCode: dto.terminalId }] },
      select: { id: true },
    })
    if (!terminal) {
      throw new BadRequestException({
        error: { code: 'PRINT_TERMINAL_NOT_FOUND', message: '目标终端不存在' },
      })
    }

    await this.capabilities.assertPrintParamsAllowed(terminal.id, dto.params)
  }
}
