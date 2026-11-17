import { BadRequestException, Injectable, Logger } from '@nestjs/common'
import { PrismaService, type PrismaTransactionClient } from '../prisma/prisma.service'
import type { BillingPageSource } from '../print-jobs/print-page-count.types'
import type { PrintPriceConfigView, PrintPriceLine, PrintPriceQuote } from './payment.types'
import { descriptionContradictsAmount } from './price-description'
import { assertUserPaysUnit, getEffectiveUserPrices } from './effective-user-prices'

/** 报价输入：后端识别页数（来自 PrintPageCountService）+ 打印参数。 */
export interface PrintPriceInput {
  billablePages: number
  billingPageSource: BillingPageSource
  copies: number
  colorMode: 'black_white' | 'color'
  /**
   * 有终端时按该机 print_bw_page / print_color_page 的生效价。
   * 不传（手机先下单、到机取件）本包一律 0 元。到机补价由 P2 做。
   */
  terminalId?: string | null
}

export type PrintPriceServiceKey = 'print_bw_page' | 'print_color_page'

export type PrintUnitPrice =
  | { ok: true; serviceKey: PrintPriceServiceKey; unitCents: number; description: string | null }
  | { ok: false; code: 'PRICE_CONFIG_UNAVAILABLE' | 'PRICE_CONFIG_INVALID' }

/**
 * 按颜色读全站 PriceConfig 的描述。11/13 起用户实付不读这里的单价。
 * 缺行或停用 → PRICE_CONFIG_UNAVAILABLE；单价不是非负整数 → PRICE_CONFIG_INVALID；不读 effectiveFrom。
 */
export async function readPrintUnitPrice(
  db: Pick<PrismaTransactionClient, 'priceConfig'>,
  colorMode: PrintPriceInput['colorMode'],
): Promise<PrintUnitPrice> {
  const serviceKey: PrintPriceServiceKey = colorMode === 'color' ? 'print_color_page' : 'print_bw_page'
  const config = await db.priceConfig.findUnique({ where: { serviceKey } })
  if (!config || !config.active) return { ok: false, code: 'PRICE_CONFIG_UNAVAILABLE' }
  if (!Number.isInteger(config.unitCents) || config.unitCents < 0) return { ok: false, code: 'PRICE_CONFIG_INVALID' }
  return { ok: true, serviceKey, unitCents: config.unitCents, description: config.description ?? null }
}

/**
 * 打印报价。用户实付单价只来自 getEffectiveUserPrices（每台机器的生效价）。
 * 全站 PriceConfig 的打印两行不再决定用户付多少钱，只在描述不矛盾时附在报价上。
 * amountCents = 本机生效单价 × billablePages × copies，整数「分」。
 *
 * 硬约束：
 * - **绝不信任前端金额**。
 * - 没传终端：一律 0 元（到机补价由 P2 做），不查终端表。
 * - 向用户收费且配置价不是 0 到上限的整数 → PRICE_CONFIG_INVALID，不按 0 放行。
 * - 非法页数或份数仍拒绝。缺 PriceConfig 不再让报价失败。
 * - 本批按内容页计价，duplex / pagesPerSheet 不影响单价。
 */
@Injectable()
export class PricingService {
  private readonly logger = new Logger(PricingService.name)

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 公开只读价目视图。这是全站参考价，用户实付按每台机器（见 getEffectiveUserPrices）。
   * 只回 active 项的安全字段（serviceKey/unitCents/unit/description），无任何敏感信息。
   * `billingEnabled` 为政企 E1「整机免费模式」预留位（当前恒 true；免费模式落地时改由配置驱动）。
   * fail-closed：无任何 active 价目时抛错 —— 前端据此显示「价格暂不可用」，绝不回退硬编码价。
   *
   * description 另有一条约束：**自相矛盾的描述不外发**。
   * 库里可能存着早于写入闸门的坏行（2026-09-09 生产实测：彩色 unitCents=100，
   * 描述却是「免费试运营：彩色打印 0 元/页」）。本接口匿名可读，
   * 把这句原样播出去等于对外声明一个假价。处置是**只摘描述、不动金额**：
   * 金额照发，估价不受影响；description 回 null，前端渲染不出东西好过渲染一句假话。
   * 不在这里抛错 —— 价目本身是可用的，拒绝服务反而会让整台机器无法报价。
   * 管理端 `GET /admin/billing/price-config` 仍原样返回，改价的人看得见矛盾。
   */
  async listActivePriceConfig(): Promise<PrintPriceConfigView> {
    const rows = await this.prisma.priceConfig.findMany({
      where: { active: true },
      orderBy: { serviceKey: 'asc' },
      select: { serviceKey: true, unitCents: true, unit: true, description: true },
    })
    if (rows.length === 0) throw new BadRequestException('PRICE_CONFIG_UNAVAILABLE')
    const printKeys = new Set(['print_bw_page', 'print_color_page'])
    const items = rows
      .filter((r) => printKeys.has(r.serviceKey))
      .map((r) => {
        const contradicts = descriptionContradictsAmount(r.description, r.unitCents)
        if (contradicts) {
          this.logger.warn(
            `价目 ${r.serviceKey} 的描述与单价矛盾（单价 ${(r.unitCents / 100).toFixed(2)} 元），`
            + '公开接口已摘掉该描述；请在管理后台把描述改对。',
          )
        }
        return {
          serviceKey: r.serviceKey,
          unitCents: r.unitCents,
          unit: r.unit,
          description: contradicts ? null : (r.description ?? null),
        }
      })
    if (items.length === 0) throw new BadRequestException('PRICE_CONFIG_UNAVAILABLE')
    return {
      billingEnabled: true,
      items,
    }
  }

  async quotePrint(input: PrintPriceInput): Promise<PrintPriceQuote> {
    const { billablePages, billingPageSource, copies, colorMode } = input

    if (!Number.isInteger(billablePages) || billablePages <= 0) {
      throw new BadRequestException('PRICE_INVALID_PAGES')
    }
    if (!Number.isInteger(copies) || copies <= 0) {
      throw new BadRequestException('PRICE_INVALID_COPIES')
    }

    const serviceKey: PrintPriceServiceKey = colorMode === 'color' ? 'print_color_page' : 'print_bw_page'
    const unitCents = await this.resolveEffectivePrintUnit(input.terminalId, serviceKey)
    const description = await this.referenceDescription(colorMode, unitCents)

    const quantity = billablePages * copies
    const subtotalCents = unitCents * quantity
    const line: PrintPriceLine = {
      serviceKey,
      unitCents,
      quantity,
      subtotalCents,
      description: description ?? undefined,
    }

    return {
      amountCents: subtotalCents,
      billablePages,
      billingPageSource,
      lines: [line],
    }
  }

  /**
   * 没传终端时不查终端表，直接 0。到机补价由 P2 做。
   * 有终端时只认生效价；向用户收费且配置价非法则拒绝。
   */
  private async resolveEffectivePrintUnit(
    terminalId: string | null | undefined,
    serviceKey: PrintPriceServiceKey,
  ): Promise<number> {
    if (!terminalId?.trim()) return 0
    const prices = await getEffectiveUserPrices(this.prisma, terminalId)
    const row = prices.prices[serviceKey]
    try {
      assertUserPaysUnit(row)
    } catch (error) {
      if (error instanceof Error && error.message === 'PRICE_CONFIG_INVALID') {
        throw new BadRequestException('PRICE_CONFIG_INVALID')
      }
      throw error
    }
    return row.effectiveCents
  }

  /** 全站参考价的描述。与本机生效单价矛盾、或缺行时不附上，金额不受影响。 */
  private async referenceDescription(
    colorMode: PrintPriceInput['colorMode'],
    effectiveUnitCents: number,
  ): Promise<string | null> {
    const listed = await readPrintUnitPrice(this.prisma, colorMode)
    if (!listed.ok || descriptionContradictsAmount(listed.description, effectiveUnitCents)) return null
    return listed.description
  }
}
