import { Injectable } from '@nestjs/common'
import type {
  BenefitSourceType,
  BenefitStatus,
  BenefitType,
  MemberBenefitItem,
  MemberRedemptionItem,
} from './member-benefits.types'
import { PrismaService } from '../prisma/prisma.service'
import { buildMemberPage, memberPageArgs, type MemberPageQuery } from '../common/utils/member-page'

// ============================================================
// 会员权益只读服务（Phase C-2C 底座 + Wave 3 核销记录查看）。
//
// 只读：本阶段不做发放 / 核销真实逻辑、不接支付。权益数据由后续活动(C-3) / 套餐(C-4) /
// 支付核销(C-5) 阶段写入；当前仅提供"我的权益"列表展示与"我的核销记录"查看。
//
// 全部查询都以传入的 endUserId（来自 EndUserAuthGuard 注入的 req.endUser）为唯一过滤维度，
// 绝不接受任意 id 参数 → 跨用户越权天然不可能。
//
// 合规（next-tasks §五）：subsidy_eligibility_hint 仅 info-only 资格提示；返回的 description
// 是运营预先录入的政策说明，绝不出现"到账 / 已发放金额"等承诺性文案（由写入侧 + 文案审核把关）。
// 本服务只回安全字段，不含任何支付凭证 / 密钥。
// ============================================================

@Injectable()
export class MemberBenefitsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 我的权益列表（本人），游标分页（C-2D，不做无界查询）。
   * 排序：发放时间倒序（游标分页要求全程稳定排序，原"active 在前"的内存重排会跨页
   * 错乱游标，改为页内按状态标签如实展示——前端有清晰状态徽标，不影响诚实性）。
   */
  async list(
    endUserId: string,
    page: MemberPageQuery,
  ): Promise<{ items: MemberBenefitItem[]; nextCursor: string | null; total: number }> {
    const where = { endUserId }
    const total = await this.prisma.benefitGrant.count({ where })
    const rows = await this.prisma.benefitGrant.findMany({
      where,
      select: {
        id: true,
        benefitType: true,
        title: true,
        description: true,
        quantityTotal: true,
        quantityRemaining: true,
        status: true,
        sourceType: true,
        validFrom: true,
        validUntil: true,
        createdAt: true,
      },
      ...memberPageArgs(page),
    })
    return buildMemberPage(rows, page, total, (r) => ({
      id: r.id,
      benefitType: r.benefitType as BenefitType,
      title: r.title,
      description: r.description,
      quantityTotal: r.quantityTotal,
      quantityRemaining: r.quantityRemaining,
      status: r.status as BenefitStatus,
      sourceType: r.sourceType as BenefitSourceType,
      validFrom: r.validFrom ? r.validFrom.toISOString() : null,
      validUntil: r.validUntil ? r.validUntil.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
    }))
  }

  /**
   * 我的核销记录列表（Wave 3）。
   *
   * 返回本人所有 RedemptionRecord，游标分页，按核销时间倒序。
   * 仅读取安全字段（不含 idempotencyKey）；amountCents 代表平台 credit 抵扣额（非资金）。
   * 全查询以 endUserId 为唯一过滤维度，跨用户越权天然不可能。
   */
  async listRedemptions(
    endUserId: string,
    page: MemberPageQuery,
  ): Promise<{ items: MemberRedemptionItem[]; nextCursor: string | null; total: number }> {
    const where = { endUserId }
    const total = await this.prisma.redemptionRecord.count({ where })
    type RedemptionRow = {
      id: string; kind: string; benefitRef: string; serviceType: string
      serviceRefId: string; orderId: string | null; amountCents: number
      quantity: number; createdAt: Date
    }
    const rows = await this.prisma.redemptionRecord.findMany({
      where,
      select: {
        id: true,
        kind: true,
        benefitRef: true,
        serviceType: true,
        serviceRefId: true,
        orderId: true,
        amountCents: true,
        quantity: true,
        createdAt: true,
      },
      // memberPageArgs 已包含 orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
      ...memberPageArgs(page),
    }) as unknown as RedemptionRow[]
    return buildMemberPage(rows, page, total, (r) => ({
      id: r.id,
      kind: r.kind,
      benefitRef: r.benefitRef,
      serviceType: r.serviceType,
      serviceRefId: r.serviceRefId,
      orderId: r.orderId,
      amountCents: r.amountCents,
      quantity: r.quantity,
      createdAt: r.createdAt.toISOString(),
    }))
  }
}
