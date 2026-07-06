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

    const updated = await this.prisma.priceConfig.update({
      where: { serviceKey },
      data: { unitCents: next.unitCents, active: next.active, description: next.description },
    })

    await this.audit.write({
      // actorId 是 User 外键；管理端操作员放 payload（与 order 域 Admin 动作同口径）。
      actorId: null,
      actorRole: 'system',
      action: 'price.updated',
      targetType: 'price_config',
      targetId: serviceKey,
      payload: {
        operatorId,
        old: { unitCents: existing.unitCents, active: existing.active, description: existing.description ?? null },
        new: { unitCents: updated.unitCents, active: updated.active, description: updated.description ?? null },
      },
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
