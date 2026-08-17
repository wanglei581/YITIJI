// ============================================================
// 岗位要求计数（S3-JOBCOUNT）
//
// 为什么有这个端点：22-career-plan.html 的 `ai-down` 支线规定「AI 不可用时仍要给出
// 一张不依赖 AI 的岗位要求计数表」。它是 AI 降级规则①（有手动/确定性替代路径 →
// 退化成用户自己看）的落地，本身**绝不能依赖 AI**。
//
// 因此本服务：
//  - 不注入任何 LLM / AI 服务，不读 AI 相关 env，不落 AiServiceLog（没有模型调用可记）
//  - 只做 Prisma 读 + 纯函数聚合（job-requirement-stats.rules.ts）
//  - 证据分级恒 E2（来源信息）
//
// 合规（CLAUDE.md §2）：只返回聚合条数，**不返回任何岗位标识**（无 id / 标题 /
// 企业名 / 来源链接），不排序岗位、不产出推荐或投递建议。
// ============================================================

import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { buildPublishedJobWhere } from './jobs-shared'
import {
  aggregateJobRequirementStats,
  JOB_REQUIREMENT_SCAN_LIMIT,
  type JobRequirementSourceRow,
  type JobRequirementStatsData,
} from './job-requirement-stats.rules'

export interface JobRequirementStatsParams {
  keyword?: string
  city?: string
  industry?: string
  category?: string
  sourceOrgId?: string
}

function normalize(value: string | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

@Injectable()
export class JobRequirementStatsService {
  constructor(private readonly prisma: PrismaService) {}

  async getStats(params: JobRequirementStatsParams): Promise<{ data: JobRequirementStatsData; success: true }> {
    const filter = {
      keyword: normalize(params.keyword),
      city: normalize(params.city),
      industry: normalize(params.industry),
      category: normalize(params.category),
      sourceOrgId: normalize(params.sourceOrgId),
    }
    // 与 GET /jobs 完全同一份 where —— 计数表描述的必须是用户真能翻到的那批岗位
    const where = buildPublishedJobWhere({
      keyword: filter.keyword ?? undefined,
      city: filter.city ?? undefined,
      industry: filter.industry ?? undefined,
      category: filter.category ?? undefined,
      sourceOrgId: filter.sourceOrgId ?? undefined,
    })

    const [matchedTotal, rows] = await Promise.all([
      this.prisma.job.count({ where }),
      this.prisma.job.findMany({
        where,
        // 只取聚合真正要读的列：不取 id / title / company / sourceUrl，
        // 结果里也就不可能夹带岗位标识。
        select: {
          sourceOrgId: true,
          syncTime: true,
          description: true,
          requirements: true,
          educationRequirement: true,
          experienceRequirement: true,
          skillsJson: true,
        },
        // 截断时保留「最近同步的 N 条」，口径可解释；顺序稳定以保证计数可复现。
        orderBy: [{ syncTime: 'desc' }, { id: 'asc' }],
        take: JOB_REQUIREMENT_SCAN_LIMIT,
      }),
    ])

    return {
      data: aggregateJobRequirementStats({
        filter,
        matchedTotal,
        rows: rows as JobRequirementSourceRow[],
      }),
      success: true,
    }
  }
}
