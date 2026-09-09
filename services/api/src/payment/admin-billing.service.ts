/**
 * Admin 计费配置服务（W-C part1）。
 *
 * 职责：PriceConfig 的管理端只读列表 + 改价/启停（**唯一合法改价路径**，改价必审计）。
 *
 * 硬约束：
 * - 只允许更新已存在的价目项；本波不开放新建/删除（新增计费项须随对应业务闭环评审落地，
 *   删除会破坏历史订单 itemsJson 的可解释性 —— 停用用 active=false）。
 * - 改价审计 `price.updated` 必须带 old/new 快照（对账与追责依据）；无变化的空 patch 拒绝。
 * - 改价即时生效（PricingService 每次报价实时读库，W-A 后前端展示价同源），无缓存一致性问题。
 * - 停用某项后对应报价 fail-closed（PRICE_CONFIG_UNAVAILABLE，绝不默认 0 元）——这是有意的
 *   管理动作语义；「整机免费模式」是政企 E1 的独立配置形态，不要用停用价目冒充。
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import { PrismaService } from '../prisma/prisma.service'
import type { AdminUpdatePriceConfigDto } from './dto/admin-billing.dto'
import { ensureResumeExportPriceConfig } from './price-config.seed'

export interface AdminPriceConfigItem {
  serviceKey: string
  unitCents: number
  unit: string
  active: boolean
  description: string | null
  effectiveFrom: string
  updatedAt: string
}

@Injectable()
export class AdminBillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** 管理端全量价目（含 inactive；含时间戳，供审计对照）。 */
  async listPriceConfig(): Promise<{ items: AdminPriceConfigItem[] }> {
    await ensureResumeExportPriceConfig(this.prisma)
    const rows = await this.prisma.priceConfig.findMany({ orderBy: { serviceKey: 'asc' } })
    return {
      items: rows.map((r) => ({
        serviceKey: r.serviceKey,
        unitCents: r.unitCents,
        unit: r.unit,
        active: r.active,
        description: r.description ?? null,
        effectiveFrom: r.effectiveFrom.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      })),
    }
  }

  /** 打印两档互为对侧：设其中一档为 0 时，把另一档的现价一起说出来。 */
  private static readonly PRINT_PRICE_SIBLING: Readonly<Record<string, string>> = {
    print_bw_page: 'print_color_page',
    print_color_page: 'print_bw_page',
  }

  /**
   * 0 元确认提示。默认只说「会跳过收银」；如果这是打印两档之一、而对侧仍在收费，
   * 额外把对侧价格和可预见的后果说清楚 —— 用户会一直选免费那一档。
   */
  private async zeroPriceMessage(serviceKey: string): Promise<string> {
    const base = '设置 0 元会跳过收银，需明确确认'
    const siblingKey = AdminBillingService.PRINT_PRICE_SIBLING[serviceKey]
    if (!siblingKey) return base
    const sibling = await this.prisma.priceConfig.findUnique({ where: { serviceKey: siblingKey } })
    if (!sibling || !sibling.active || sibling.unitCents <= 0) return base
    const yuan = (sibling.unitCents / 100).toFixed(2)
    const thisLabel = serviceKey === 'print_color_page' ? '彩色' : '黑白'
    const siblingLabel = serviceKey === 'print_color_page' ? '黑白' : '彩色'
    return (
      `${base}。注意：${siblingLabel}打印当前仍按 ${yuan} 元/页收费，`
      + `把${thisLabel}设为 0 后用户只要选${thisLabel}就免单，${siblingLabel}这档实际收不到钱。`
      + '若确为免费试运营，应当两档一起设 0；若只想暂不开放这一档，应当停用它而不是标价 0。'
    )
  }

  /**
   * 描述里写出的价格必须和实际单价对得上。
   *
   * 为什么需要这条：改价和改描述是两个字段，只改其中一个不会有任何提示。
   * 2026-09-09 生产实测就是这个状态 —— 彩色 `unitCents=100`（1.00 元/页），
   * 描述却仍是上一轮免费试运营时期的「免费试运营：彩色打印 0 元/页」。
   * Kiosk 与小程序都只读 `unitCents` 不读 description，所以终端用户看不到假价；
   * 但 `GET /admin/billing/price-config` 会把 description 原样返回，
   * **下一个改价的人看到的价目表是自相矛盾的**，而他正是要据此决策的人。
   *
   * 判据故意留松：描述里但凡有**一个** N 元与实际单价相等就放行
   * （允许「原价 2 元，现 1 元」这类写法）；一个都对不上才拒。
   * 描述里根本没写金额（如「黑白打印每页」）不受约束 —— 那不是在陈述价格。
   */
  private static assertDescriptionMatchesAmount(description: string | null, unitCents: number): void {
    if (!description) return
    const stated = [...description.matchAll(/(\d+(?:\.\d+)?)\s*元/g)].map((m) => Number(m[1]))
    if (stated.length === 0) return
    const actualYuan = unitCents / 100
    if (stated.some((y) => Math.abs(y - actualYuan) < 1e-9)) return
    throw new BadRequestException({
      error: {
        code: 'PRICE_DESCRIPTION_CONTRADICTS_AMOUNT',
        message:
          `描述里写的价格（${stated.map((y) => `${y} 元`).join('、')}）和实际单价 `
          + `${actualYuan.toFixed(2)} 元对不上。改价时请把描述一起改，`
          + '否则管理后台的价目表会自相矛盾，下一个改价的人会照着错的那句决策。'
          + '（描述里不写金额也可以，那样不受本校验约束。）',
      },
    })
  }

  /** 改价/启停（唯一合法改价路径）：old/new 快照进审计，空 patch / 无实际变化拒绝。 */
  async updatePriceConfig(
    serviceKey: string,
    patch: AdminUpdatePriceConfigDto,
    operatorId: string,
  ): Promise<AdminPriceConfigItem> {
    if (patch.unitCents === undefined && patch.active === undefined && patch.description === undefined) {
      throw new BadRequestException('PRICE_PATCH_EMPTY')
    }
    const existing = await this.prisma.priceConfig.findUnique({ where: { serviceKey } })
    if (!existing) throw new NotFoundException('PRICE_CONFIG_NOT_FOUND')

    const next = {
      unitCents: patch.unitCents ?? existing.unitCents,
      active: patch.active ?? existing.active,
      description: patch.description ?? existing.description,
    }
    const changed =
      next.unitCents !== existing.unitCents ||
      next.active !== existing.active ||
      (next.description ?? null) !== (existing.description ?? null)
    if (!changed) throw new BadRequestException('PRICE_PATCH_NO_CHANGE')
    if (next.unitCents === 0 && patch.confirmZeroPrice !== true) {
      // 单项确认看不见**组合后果**：把彩色设成 0 而黑白仍收费时，用户只要选彩色就免单，
      // 而彩色的耗材成本更高 —— 于是「收便宜的、送贵的」。
      // 2026-09-08 生产实测就是这个状态（黑白 50 分 / 彩色 0 分，且描述是人为配的），
      // 说明当时确认的人只看到了「这一项会跳过收银」，没看到「另一项还在收费」。
      // 所以提示语要把对侧价格一起说出来，让确认的人知道自己在确认什么。
      throw new BadRequestException({
        error: {
          code: 'ZERO_PRICE_CONFIRMATION_REQUIRED',
          message: await this.zeroPriceMessage(serviceKey),
        },
      })
    }

    AdminBillingService.assertDescriptionMatchesAmount(next.description ?? null, next.unitCents)

    const updated = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.priceConfig.update({
        where: { serviceKey },
        data: { unitCents: next.unitCents, active: next.active, description: next.description },
      })

      await this.audit.writeRequired(tx, {
        // actorId 是 User 外键；管理端操作员放 payload（与 order 域 Admin 动作同口径）。
        actorId: null,
        actorRole: 'system',
        action: 'price.updated',
        targetType: 'price_config',
        targetId: serviceKey,
        payload: {
          operatorId,
          old: { unitCents: existing.unitCents, active: existing.active, description: existing.description ?? null },
          new: { unitCents: saved.unitCents, active: saved.active, description: saved.description ?? null },
          ...(saved.unitCents === 0 ? { zeroPriceConfirmed: true, zeroPriceCashierBypass: 'paid/free' } : {}),
        },
      })
      return saved
    })

    return {
      serviceKey: updated.serviceKey,
      unitCents: updated.unitCents,
      unit: updated.unit,
      active: updated.active,
      description: updated.description ?? null,
      effectiveFrom: updated.effectiveFrom.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    }
  }
}
