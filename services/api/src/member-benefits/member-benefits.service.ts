import { Injectable } from '@nestjs/common'
import type {
  BenefitSourceType,
  BenefitStatus,
  BenefitType,
  MemberBenefitItem,
} from './member-benefits.types'
import { PrismaService } from '../prisma/prisma.service'

// ============================================================
// 会员权益只读服务（Phase C-2C 底座）。
//
// 只读：本阶段不做发放 / 核销真实逻辑、不接支付。权益数据由后续活动(C-3) / 套餐(C-4) /
// 支付核销(C-5) 阶段写入；当前仅提供"我的权益"列表展示。
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
   * 我的权益列表（本人）。排序：active 优先，其后按发放时间倒序，
   * 便于"我的权益"先展示当前可用项；历史 / 失效项排在后面（诚实展示状态）。
   */
  async list(endUserId: string): Promise<MemberBenefitItem[]> {
    const rows = await this.prisma.benefitGrant.findMany({
      where: { endUserId },
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
      orderBy: { createdAt: 'desc' },
    })
    // active 优先（SQLite 无法直接按"active 在前"排序，这里在内存稳定排序）。
    const activeFirst = [...rows].sort((a, b) => {
      const aw = a.status === 'active' ? 0 : 1
      const bw = b.status === 'active' ? 0 : 1
      return aw - bw
    })
    return activeFirst.map((r) => ({
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
}
