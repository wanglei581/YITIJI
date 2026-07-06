/**
 * PricingService + PriceConfig 价目 SSOT verification.
 *
 * 直接调用生产 service（不走 HTTP）：
 * - 开发默认价 seed 幂等写入 PriceConfig，且与 PRINT_UNIT_PRICE_CENTS 不漂移。
 * - quotePrint 依据 PriceConfig 计算 amountCents（整数分），不信任前端金额。
 * - 无 active 价目 / 非法页数或份数 → fail-closed（抛错，绝不默认 0 元）。
 *
 * 注：这是 Task 5 的直接断言；报价接入建单落库（Order.amountCents）在 Task 6，故 verify:order 仍 RED。
 */
import 'dotenv/config'
import { PrismaService } from '../src/prisma/prisma.service'
import { PricingService } from '../src/payment/pricing.service'
import { seedDevDefaultPriceConfig } from '../src/payment/price-config.seed'
import { PRINT_UNIT_PRICE_CENTS } from '../src/print-jobs/print-pricing'

function pass(message: string): void {
  console.log(`  PASS ${message}`)
}

function fail(message: string): never {
  console.error(`  FAIL ${message}`)
  process.exit(1)
}

async function assertThrows(label: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn()
    fail(`${label} — expected fail-closed throw, but resolved`)
  } catch {
    pass(label)
  }
}

async function main(): Promise<void> {
  console.log('\n=== PricingService + PriceConfig verification ===')

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const pricing = new PricingService(prisma)

  async function cleanup(): Promise<void> {
    await prisma.priceConfig.deleteMany({
      where: { serviceKey: { in: ['print_bw_page', 'print_color_page'] } },
    })
  }

  try {
    await cleanup()

    // 1) 开发默认价 seed 幂等写入
    await seedDevDefaultPriceConfig(prisma)
    await seedDevDefaultPriceConfig(prisma) // 再次调用应幂等，不重复/不报错
    const bw = await prisma.priceConfig.findUnique({ where: { serviceKey: 'print_bw_page' } })
    const color = await prisma.priceConfig.findUnique({ where: { serviceKey: 'print_color_page' } })
    if (bw?.active && color?.active && bw.unit === 'page' && color.unit === 'page') {
      pass('dev default price seed is idempotent and writes active PriceConfig rows')
    } else {
      fail(`seed rows unexpected: bw=${JSON.stringify(bw)} color=${JSON.stringify(color)}`)
    }

    // 2) 不漂移：PriceConfig 单价 == PRINT_UNIT_PRICE_CENTS（唯一 seed 源）
    if (bw?.unitCents === PRINT_UNIT_PRICE_CENTS.black_white && color?.unitCents === PRINT_UNIT_PRICE_CENTS.color) {
      pass('PriceConfig unit prices do not drift from PRINT_UNIT_PRICE_CENTS seed source')
    } else {
      fail(`price drift: bw=${bw?.unitCents} vs ${PRINT_UNIT_PRICE_CENTS.black_white}, color=${color?.unitCents} vs ${PRINT_UNIT_PRICE_CENTS.color}`)
    }

    // 3) 报价（彩色 3 页 × 2 份）= 50 × 3 × 2 = 300 分
    const q1 = await pricing.quotePrint({
      billablePages: 3,
      billingPageSource: 'pdf_lightweight_scan',
      copies: 2,
      colorMode: 'color',
    })
    if (
      q1.amountCents === 300 &&
      q1.billablePages === 3 &&
      q1.billingPageSource === 'pdf_lightweight_scan' &&
      q1.lines.length === 1 &&
      q1.lines[0]?.serviceKey === 'print_color_page' &&
      q1.lines[0]?.unitCents === 50 &&
      q1.lines[0]?.quantity === 6 &&
      q1.lines[0]?.subtotalCents === 300
    ) {
      pass('quotePrint color 3 pages × 2 copies = 300 cents with correct breakdown')
    } else {
      fail(`color quote mismatch: ${JSON.stringify(q1)}`)
    }

    // 4) 报价（黑白 5 页 × 1 份）= 20 × 5 = 100 分；billingPageSource 原样透传
    const q2 = await pricing.quotePrint({
      billablePages: 5,
      billingPageSource: 'image_single_page',
      copies: 1,
      colorMode: 'black_white',
    })
    if (q2.amountCents === 100 && q2.lines[0]?.serviceKey === 'print_bw_page' && q2.billingPageSource === 'image_single_page') {
      pass('quotePrint bw 5 pages × 1 copy = 100 cents; billingPageSource passthrough')
    } else {
      fail(`bw quote mismatch: ${JSON.stringify(q2)}`)
    }

    // 5) fail-closed：非法页数 / 份数
    await assertThrows('quotePrint rejects billablePages <= 0 (fail-closed, not 0 cents)', () =>
      pricing.quotePrint({ billablePages: 0, billingPageSource: 'pdf_lightweight_scan', copies: 1, colorMode: 'color' }),
    )
    await assertThrows('quotePrint rejects copies <= 0 (fail-closed)', () =>
      pricing.quotePrint({ billablePages: 2, billingPageSource: 'pdf_lightweight_scan', copies: 0, colorMode: 'color' }),
    )

    // 6) fail-closed：价目被停用
    await prisma.priceConfig.update({ where: { serviceKey: 'print_color_page' }, data: { active: false } })
    await assertThrows('quotePrint fail-closed when PriceConfig inactive (never defaults to 0)', () =>
      pricing.quotePrint({ billablePages: 1, billingPageSource: 'pdf_lightweight_scan', copies: 1, colorMode: 'color' }),
    )

    // 7) fail-closed：价目缺失（删空后彩色报价必抛）
    await cleanup()
    await assertThrows('quotePrint fail-closed when PriceConfig missing', () =>
      pricing.quotePrint({ billablePages: 1, billingPageSource: 'pdf_lightweight_scan', copies: 1, colorMode: 'color' }),
    )

    // 8) W-A：公开价目视图（Kiosk 预览/确认页展示价唯一来源）
    await seedDevDefaultPriceConfig(prisma)
    const view = await pricing.listActivePriceConfig()
    const vBw = view.items.find((i) => i.serviceKey === 'print_bw_page')
    const vColor = view.items.find((i) => i.serviceKey === 'print_color_page')
    if (
      view.billingEnabled === true &&
      vBw?.unitCents === PRINT_UNIT_PRICE_CENTS.black_white &&
      vColor?.unitCents === PRINT_UNIT_PRICE_CENTS.color &&
      vBw.unit === 'page' &&
      vColor.unit === 'page'
    ) {
      pass('listActivePriceConfig exposes seeded bw/color prices with billingEnabled=true')
    } else {
      fail(`price-config view mismatch: ${JSON.stringify(view)}`)
    }
    // 只含安全展示字段（无 id/时间戳/内部字段泄漏）
    const viewKeys = Object.keys(vBw as Record<string, unknown>).sort()
    if (JSON.stringify(viewKeys) === JSON.stringify(['description', 'serviceKey', 'unit', 'unitCents'])) {
      pass('price-config view contains only safe display fields')
    } else {
      fail(`unexpected view fields: ${viewKeys.join(',')}`)
    }
    // inactive 项不出现在公开视图
    await prisma.priceConfig.update({ where: { serviceKey: 'print_color_page' }, data: { active: false } })
    const view2 = await pricing.listActivePriceConfig()
    if (!view2.items.some((i) => i.serviceKey === 'print_color_page')) {
      pass('inactive price rows are excluded from public view')
    } else {
      fail('inactive price row leaked into public view')
    }
    // fail-closed：无任何 active 价目 → 抛错（仅当整表确无其它 active 行时可严格断言）
    await prisma.priceConfig.update({ where: { serviceKey: 'print_bw_page' }, data: { active: false } })
    const remainingActive = await prisma.priceConfig.count({ where: { active: true } })
    if (remainingActive === 0) {
      await assertThrows('listActivePriceConfig fail-closed when no active price rows', () =>
        pricing.listActivePriceConfig(),
      )
    } else {
      pass(`listActivePriceConfig fail-closed assertion skipped (${remainingActive} unrelated active rows in shared dev DB)`)
    }
    await seedDevDefaultPriceConfig(prisma) // 复位
  } finally {
    await cleanup()
    await prisma.onModuleDestroy()
  }

  console.log('\nALL PASS')
}

main().catch((error: unknown) => {
  console.error('\nFatal error:', (error as Error).message)
  console.error((error as Error).stack)
  process.exit(1)
})
