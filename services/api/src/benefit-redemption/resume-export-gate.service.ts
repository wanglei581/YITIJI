import { createHash } from 'crypto'
import { BadRequestException, Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import {
  ensureResumeExportPriceConfig,
  RESUME_EXPORT_SERVICE_KEY,
} from '../payment/price-config.seed'
import { REDEEMABLE_BENEFIT_TYPES } from './benefit-redemption.types'
import { BenefitRedemptionService } from './benefit-redemption.service'

export type ResumeExportMode = 'free' | 'charged' | 'unavailable'

export interface ResumeExportPricingView {
  mode: ResumeExportMode
  unitCents: number
  unit: string
  benefit: { available: number; serviceType: 'resume_export' } | null
  label: string
}

export interface ResumeExportGateContext {
  endUserId: string | null
  taskId?: string | null
  benefitGrantId?: string | null
  contentHash: string
}

export interface ResumeExportGateDecision {
  mode: ResumeExportMode
  alreadyPaid: boolean
  serviceRefId: string
  benefitGrantId: string | null
  endUserId: string | null
}

const SERVICE_TYPE = 'resume_export' as const

export function hashResumeExportContent(resume: {
  basic: unknown
  intention: unknown
  summary: unknown
  education: unknown
  experience: unknown
  projects: unknown
  skills: unknown
  certificates: unknown
}): string {
  return createHash('sha256')
    .update(JSON.stringify({
      basic: resume.basic,
      intention: resume.intention,
      summary: resume.summary,
      education: resume.education,
      experience: resume.experience,
      projects: resume.projects,
      skills: resume.skills,
      certificates: resume.certificates,
    }))
    .digest('hex')
}

export function resumeExportModeFromPrice(row: { active: boolean; unitCents: number } | null): ResumeExportMode {
  if (!row || !row.active) return 'unavailable'
  if (row.unitCents === 0) return 'free'
  if (row.unitCents > 0) return 'charged'
  return 'unavailable'
}

export function buildResumeExportServiceRefId(
  endUserId: string,
  taskId: string | null | undefined,
  contentHash: string,
): string {
  const taskPart = taskId && taskId.trim() ? taskId.trim() : 'notask'
  return `${endUserId}:${taskPart}:${contentHash}`
}

function unavailable(): never {
  throw new BadRequestException({
    error: {
      code: 'RESUME_EXPORT_UNAVAILABLE',
      message: '简历导出当前不可用（价目已停用，不是免费）。请待管理员在计费管理中启用后再试。',
    },
  })
}

@Injectable()
export class ResumeExportGateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redemption: BenefitRedemptionService,
  ) {}

  async getPricing(endUserId: string | null): Promise<ResumeExportPricingView> {
    const row = await this.loadPriceRow()
    const mode = resumeExportModeFromPrice(row)
    const unitCents = row?.unitCents ?? 0
    const unit = row?.unit ?? 'item'
    let benefit: ResumeExportPricingView['benefit'] = null
    if (mode === 'charged' && endUserId) {
      benefit = { available: await this.countAvailableBenefits(endUserId), serviceType: SERVICE_TYPE }
    }
    return { mode, unitCents, unit, benefit, label: labelFor(mode, unitCents) }
  }

  /**
   * 导出前闸门：unavailable 拒绝；free 放行；charged 校验登录 + 权益（或同内容已核销），不扣次。
   */
  async assertExportAllowed(ctx: ResumeExportGateContext): Promise<ResumeExportGateDecision> {
    const row = await this.loadPriceRow()
    const mode = resumeExportModeFromPrice(row)
    if (mode === 'unavailable') unavailable()
    if (mode === 'free') {
      return { mode, alreadyPaid: true, serviceRefId: '', benefitGrantId: null, endUserId: ctx.endUserId }
    }

    if (!ctx.endUserId) {
      throw new BadRequestException({
        error: { code: 'REDEEM_REQUIRES_LOGIN', message: '收费导出需登录会员账号' },
      })
    }

    const serviceRefId = buildResumeExportServiceRefId(ctx.endUserId, ctx.taskId, ctx.contentHash)
    const existing = await this.prisma.redemptionRecord.findFirst({
      where: { serviceType: SERVICE_TYPE, serviceRefId },
    })
    if (existing) {
      if (existing.endUserId !== ctx.endUserId) {
        throw new BadRequestException({
          error: { code: 'BENEFIT_OUTPUT_ALREADY_REDEEMED', message: '该导出内容已核销，不能重复核销' },
        })
      }
      return {
        mode,
        alreadyPaid: true,
        serviceRefId,
        benefitGrantId: existing.benefitRef,
        endUserId: ctx.endUserId,
      }
    }

    const benefitGrantId = ctx.benefitGrantId?.trim()
    if (!benefitGrantId) {
      throw new BadRequestException({
        error: {
          code: 'RESUME_EXPORT_BENEFIT_REQUIRED',
          message: '本次导出需核销 1 次权益。请选择可用权益后再导出。',
        },
      })
    }
    await this.assertGrantRedeemable(ctx.endUserId, benefitGrantId)
    return {
      mode,
      alreadyPaid: false,
      serviceRefId,
      benefitGrantId,
      endUserId: ctx.endUserId,
    }
  }

  /** 文件成功生成后再落账。生成失败不得调用。alreadyPaid / free 为 no-op。 */
  async commitExportRedemption(decision: ResumeExportGateDecision): Promise<void> {
    if (decision.mode !== 'charged' || decision.alreadyPaid) return
    if (!decision.endUserId || !decision.benefitGrantId || !decision.serviceRefId) {
      throw new BadRequestException({
        error: { code: 'RESUME_EXPORT_BENEFIT_REQUIRED', message: '本次导出需核销 1 次权益。' },
      })
    }
    await this.redemption.redeem({
      endUserId: decision.endUserId,
      benefitGrantId: decision.benefitGrantId,
      serviceType: SERVICE_TYPE,
      serviceRefId: decision.serviceRefId,
    })
  }

  private async loadPriceRow(): Promise<{ unitCents: number; unit: string; active: boolean } | null> {
    await ensureResumeExportPriceConfig(this.prisma)
    return this.prisma.priceConfig.findUnique({
      where: { serviceKey: RESUME_EXPORT_SERVICE_KEY },
      select: { unitCents: true, unit: true, active: true },
    })
  }

  private async countAvailableBenefits(endUserId: string): Promise<number> {
    const now = new Date()
    const grants = await this.prisma.benefitGrant.findMany({
      where: {
        endUserId,
        status: 'active',
        benefitType: { in: [...REDEEMABLE_BENEFIT_TYPES] },
        quantityRemaining: { gt: 0 },
        AND: [
          { OR: [{ validUntil: null }, { validUntil: { gte: now } }] },
          { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
        ],
      },
      select: { quantityRemaining: true },
    })
    return grants.reduce((sum, g) => sum + (g.quantityRemaining ?? 0), 0)
  }

  private async assertGrantRedeemable(endUserId: string, benefitGrantId: string): Promise<void> {
    const grant = await this.prisma.benefitGrant.findUnique({ where: { id: benefitGrantId } })
    if (!grant || grant.endUserId !== endUserId) {
      throw new BadRequestException({
        error: { code: 'BENEFIT_GRANT_NOT_FOUND', message: '权益不存在或不属于本人' },
      })
    }
    if (!(REDEEMABLE_BENEFIT_TYPES as readonly string[]).includes(grant.benefitType)) {
      throw new BadRequestException({
        error: { code: 'BENEFIT_NOT_REDEEMABLE', message: '该权益类型不支持核销' },
      })
    }
    if (grant.status !== 'active') {
      throw new BadRequestException({
        error: { code: 'BENEFIT_NOT_ACTIVE', message: '权益当前不可用' },
      })
    }
    const now = Date.now()
    if (grant.validFrom && grant.validFrom.getTime() > now) {
      throw new BadRequestException({
        error: { code: 'BENEFIT_NOT_STARTED', message: '权益未到生效时间' },
      })
    }
    if (grant.validUntil && grant.validUntil.getTime() < now) {
      throw new BadRequestException({
        error: { code: 'BENEFIT_EXPIRED', message: '权益已过期' },
      })
    }
    if (grant.quantityRemaining === null) {
      throw new BadRequestException({
        error: { code: 'BENEFIT_NOT_QUANTIFIED', message: '该权益无可核销额度' },
      })
    }
    if (grant.quantityRemaining <= 0) {
      throw new BadRequestException({
        error: { code: 'BENEFIT_USED_UP', message: '权益次数已用完' },
      })
    }
  }
}

function labelFor(mode: ResumeExportMode, unitCents: number): string {
  if (mode === 'free') return '当前免费，不扣权益'
  if (mode === 'charged') return `本次导出需核销 1 次权益（定价 ¥${(unitCents / 100).toFixed(2)} / 次）`
  return '简历导出当前不可用（价目已停用，不是免费）'
}
