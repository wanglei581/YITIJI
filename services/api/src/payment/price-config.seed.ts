import type { PrismaService } from '../prisma/prisma.service'
import { PRINT_UNIT_PRICE_CENTS } from '../print-jobs/print-pricing'

/**
 * 集中式**开发默认价目**（P0a 支付域）。
 *
 * ⚠️ 仅用于本地 verify / dev 数据库初始化，**不代表正式对外价格**。
 * 正式定价策略、Admin 价格 CRUD、运营价格表另批。
 *
 * `unitCents` 取自 `PRINT_UNIT_PRICE_CENTS`（唯一 seed 源），使开发默认价与 Kiosk 展示价
 * 不漂移；运行期价目真相源是数据库 `PriceConfig`（本 seed 幂等写入）。
 *
 * 说明：本批按「内容页」计价（unitCents × billablePages × copies）。duplex / pagesPerSheet
 * 影响的是物理纸张而非计费内容页，不改本批单价；按张/双面折扣属后续定价规则扩展。
 */
export const DEV_DEFAULT_PRICE_CONFIG = [
  {
    serviceKey: 'print_bw_page',
    unitCents: PRINT_UNIT_PRICE_CENTS.black_white,
    unit: 'page',
    description: '黑白打印每页（开发默认价，非正式价）',
  },
  {
    serviceKey: 'print_color_page',
    unitCents: PRINT_UNIT_PRICE_CENTS.color,
    unit: 'page',
    description: '彩色打印每页（开发默认价，非正式价）',
  },
] as const

/** 幂等写入开发默认价目（upsert by serviceKey）。仅供 seed / verify 使用。 */
export async function seedDevDefaultPriceConfig(prisma: PrismaService): Promise<void> {
  for (const p of DEV_DEFAULT_PRICE_CONFIG) {
    await prisma.priceConfig.upsert({
      where: { serviceKey: p.serviceKey },
      create: {
        serviceKey: p.serviceKey,
        unitCents: p.unitCents,
        unit: p.unit,
        active: true,
        description: p.description,
      },
      update: {
        unitCents: p.unitCents,
        unit: p.unit,
        active: true,
        description: p.description,
      },
    })
  }
}
