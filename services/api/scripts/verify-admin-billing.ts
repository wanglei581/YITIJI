/**
 * W-C part1 Admin 计费配置 verification（verify:admin-billing）。
 *
 * 直接调用生产 service/controller（不走 HTTP），断言全表：
 * - 管理端列表：含 inactive 项 + 完整字段（unitCents/unit/active/description/时间戳）。
 * - 改价（唯一合法路径）：即时生效（PricingService 报价随之变化，无缓存漂移）+
 *   审计 `price.updated` 带 old/new 快照与 operatorId，恰 1 条。
 * - 启停：active=false → 对应报价 fail-closed（PRICE_CONFIG_UNAVAILABLE，绝不默认 0 元）；
 *   恢复后报价复原。
 * - fail-closed：空 patch / 无实际变化 / 未知 serviceKey 拒绝且零审计；
 *   DTO 层拒绝非整数、负数、超上限单价（ValidationPipe 语义用 class-validator 直接断言）。
 * - 权限口径（源码级断言）：controller 挂 JwtAuthGuard + RolesGuard + @Roles('admin')；
 *   本波不开放新建/删除价目端点。
 */
import 'dotenv/config'
import { randomUUID } from 'crypto'
import { validate } from 'class-validator'
import { plainToInstance } from 'class-transformer'
import { readFileSync } from 'fs'
import { join } from 'path'
import { AuditService } from '../src/audit/audit.service'
import { AdminBillingService } from '../src/payment/admin-billing.service'
import { AdminUpdatePriceConfigDto } from '../src/payment/dto/admin-billing.dto'
import { PricingService } from '../src/payment/pricing.service'
import { seedDevDefaultPriceConfig } from '../src/payment/price-config.seed'
import { PrismaService } from '../src/prisma/prisma.service'

let passCount = 0
function pass(message: string): void {
  passCount += 1
  console.log(`  PASS ${message}`)
}
function fail(message: string): never {
  console.error(`  FAIL ${message}`)
  process.exit(1)
}
async function expectCode(label: string, code: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn()
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e)
    if (msg.includes(code)) return pass(label)
    fail(`${label} — expected ${code}, got: ${msg}`)
  }
  fail(`${label} — expected error ${code}, but resolved`)
}

async function main(): Promise<void> {
  console.log('\n=== W-C Admin billing (PriceConfig 管理) verification ===')

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const audit = new AuditService(prisma)
  const billing = new AdminBillingService(prisma, audit)
  const pricing = new PricingService(prisma)
  const operatorId = `admin_verify_${randomUUID().slice(0, 8)}`

  const auditCount = () =>
    prisma.auditLog.count({ where: { action: 'price.updated', payloadJson: { contains: operatorId } } })

  try {
    await seedDevDefaultPriceConfig(prisma)

    // (1) 管理端列表：含全部字段（对照公开视图，管理端额外可见 active/时间戳）
    const list = await billing.listPriceConfig()
    const bw = list.items.find((i) => i.serviceKey === 'print_bw_page')
    if (
      bw &&
      typeof bw.unitCents === 'number' &&
      bw.unit === 'page' &&
      typeof bw.active === 'boolean' &&
      typeof bw.effectiveFrom === 'string' &&
      typeof bw.updatedAt === 'string'
    ) {
      pass('管理端列表含完整字段（unitCents/unit/active/时间戳）')
    } else {
      fail(`admin list mismatch: ${JSON.stringify(bw)}`)
    }

    // (2) 改价：即时生效 + 审计 old/new 快照恰 1 条
    const oldBw = bw.unitCents
    const newBw = oldBw + 5
    const updated = await billing.updatePriceConfig('print_bw_page', { unitCents: newBw }, operatorId)
    if (updated.unitCents !== newBw) fail('update did not apply')
    const quote = await pricing.quotePrint({
      billablePages: 2,
      billingPageSource: 'pdf_lightweight_scan',
      copies: 1,
      colorMode: 'black_white',
    })
    if (quote.amountCents === newBw * 2 && quote.lines[0]?.unitCents === newBw) {
      pass(`改价即时生效：报价随 PriceConfig 变化（${oldBw}→${newBw} 分）`)
    } else {
      fail(`quote not reflecting new price: ${JSON.stringify(quote)}`)
    }
    const auditRow = await prisma.auditLog.findFirst({
      where: { action: 'price.updated', targetId: 'print_bw_page', payloadJson: { contains: operatorId } },
      orderBy: { createdAt: 'desc' },
    })
    const payload = auditRow ? (JSON.parse(auditRow.payloadJson ?? '{}') as Record<string, { unitCents?: number }>) : null
    if (
      auditRow &&
      payload?.['old']?.unitCents === oldBw &&
      payload?.['new']?.unitCents === newBw &&
      (await auditCount()) === 1
    ) {
      pass('改价审计 price.updated：old/new 快照 + operatorId，恰 1 条')
    } else {
      fail(`price.updated audit mismatch: ${auditRow?.payloadJson}`)
    }

    // (3) 停用：报价 fail-closed；恢复后复原
    await billing.updatePriceConfig('print_bw_page', { active: false }, operatorId)
    await expectCode('停用后对应报价 fail-closed（绝不默认 0 元）', 'PRICE_CONFIG_UNAVAILABLE', () =>
      pricing.quotePrint({ billablePages: 1, billingPageSource: 'pdf_lightweight_scan', copies: 1, colorMode: 'black_white' }),
    )
    await billing.updatePriceConfig('print_bw_page', { active: true, unitCents: oldBw }, operatorId)
    const restored = await pricing.quotePrint({
      billablePages: 1,
      billingPageSource: 'pdf_lightweight_scan',
      copies: 1,
      colorMode: 'black_white',
    })
    if (restored.amountCents === oldBw && (await auditCount()) === 3) {
      pass('恢复启用 + 复原单价：报价复原，启停/复原各留审计（累计 3 条）')
    } else {
      fail(`restore failed: ${JSON.stringify(restored)}, audits=${await auditCount()}`)
    }

    // (4) fail-closed：空 patch / 无变化 / 未知 serviceKey，且零新增审计
    const auditsBefore = await auditCount()
    await expectCode('空 patch 拒绝', 'PRICE_PATCH_EMPTY', () =>
      billing.updatePriceConfig('print_bw_page', {}, operatorId),
    )
    await expectCode('无实际变化拒绝', 'PRICE_PATCH_NO_CHANGE', () =>
      billing.updatePriceConfig('print_bw_page', { unitCents: oldBw }, operatorId),
    )
    await expectCode('未知 serviceKey 拒绝（本波不开放新建）', 'PRICE_CONFIG_NOT_FOUND', () =>
      billing.updatePriceConfig('print_nonexistent_item', { unitCents: 100 }, operatorId),
    )
    if ((await auditCount()) === auditsBefore) pass('全部拒绝路径零新增审计')
    else fail('rejected paths wrote audits')

    // (5) DTO 校验（ValidationPipe 语义）：非整数 / 负数 / 超上限 / 超长描述拒绝
    for (const [label, input] of [
      ['非整数单价', { unitCents: 0.5 }],
      ['负单价', { unitCents: -1 }],
      ['超上限单价（>1,000,000 分）', { unitCents: 1_000_001 }],
      ['超长描述', { description: 'x'.repeat(201) }],
    ] as const) {
      const dto = plainToInstance(AdminUpdatePriceConfigDto, input)
      const errors = await validate(dto)
      if (errors.length > 0) pass(`DTO 拒绝${label}`)
      else fail(`DTO accepted invalid input: ${label}`)
    }

    // (6) 权限与端点面（源码级断言）
    const controllerSrc = readFileSync(join(__dirname, '../src/payment/admin-billing.controller.ts'), 'utf8')
    if (
      controllerSrc.includes('@UseGuards(JwtAuthGuard, RolesGuard)') &&
      controllerSrc.includes("@Roles('admin')")
    ) {
      pass('controller 强制 JwtAuthGuard + RolesGuard + admin role')
    } else {
      fail('admin billing controller missing auth guards')
    }
    if (!/@(Post|Delete)\(/.test(controllerSrc)) {
      pass('本波不开放新建/删除价目端点（仅 GET/PUT）')
    } else {
      fail('unexpected create/delete endpoint exposed')
    }

    console.log(`\n  ✅ verify:admin-billing 全部通过（${passCount} checks）\n`)
  } finally {
    await seedDevDefaultPriceConfig(prisma) // 复位开发默认价
    await prisma.auditLog.deleteMany({ where: { action: 'price.updated', payloadJson: { contains: operatorId } } })
    await prisma.onModuleDestroy()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
