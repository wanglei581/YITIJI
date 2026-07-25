import type { PrismaService } from '../prisma/prisma.service'
import { PRINT_UNIT_PRICE_CENTS } from '../print-jobs/print-pricing'

/**
 * 集中式**开发默认价目**（P0a 支付域）。
 *
 * ⚠️ 仅用于本地 verify / 临时开发库初始化，**不代表正式对外价格**。
 * 正式定价由运营在生产 / 预生产库显式写入 `PriceConfig`（见
 * `docs/operations/price-config-production.md`）；Admin 价目 CRUD 另批（P1-3）。
 *
 * `unitCents` 取自 `PRINT_UNIT_PRICE_CENTS`（开发 seed 唯一源）。
 * 运行期价目真相源永远是数据库 `PriceConfig`；Kiosk 报价走 `POST /orders/quote`，
 * **不得**再把本常量当页面展示价。
 *
 * 危险点：本函数的 `update` 分支会覆盖已有行的 `unitCents`。
 * 因此 **NODE_ENV=production 时一律拒绝执行**，防止 verify 误连生产库时把运营价
 * 静默改回开发默认价（20/50 分）。
 *
 * 说明：本批按「内容页」计价（unitCents × billablePages × copies）。duplex / pagesPerSheet
 * 影响的是物理纸张而非计费内容页，不改本批单价；按张/双面折扣属后续定价规则扩展。
 *
 * 注：`PriceConfig.effectiveFrom` 当前是假能力字段——`PricingService` 只读 `active`，
 * 从不按生效时间切换价目；生产写入时不要依赖该列做排期改价。
 */

export const DEV_PRICE_SEED_FORBIDDEN_IN_PRODUCTION =
  'DEV_PRICE_SEED_FORBIDDEN_IN_PRODUCTION'

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

/** 纯函数：生产环境禁止开发价 seed（供 seed 与 verify 共用）。 */
export function assertDevPriceSeedAllowed(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): void {
  if (env['NODE_ENV'] === 'production') {
    throw new Error(DEV_PRICE_SEED_FORBIDDEN_IN_PRODUCTION)
  }
}

/** 幂等写入开发默认价目（upsert by serviceKey）。仅供 seed / verify 使用。 */
export async function seedDevDefaultPriceConfig(prisma: PrismaService): Promise<void> {
  assertDevPriceSeedAllowed()

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
        // 开发库故意覆盖 unitCents，保证 verify 可回到已知默认价。
        // 生产已被 assertDevPriceSeedAllowed 拦截，不会走到这里。
        unitCents: p.unitCents,
        unit: p.unit,
        active: true,
        description: p.description,
      },
    })
  }
}
