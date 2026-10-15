import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import type { AuthedUser } from '../common/decorators/current-user.decorator'
import { hashPhone, isValidCnMobile, maskPhone, maskPhoneFromEnc, normalizePhone } from '../common/crypto/phone-identity'
import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import type { BenefitSourceType, BenefitStatus, BenefitType, MemberBenefitItem } from './member-benefits.types'
import type { GrantBenefitDto, RevokeBenefitDto } from './dto/admin-member-benefits.dto'

export interface AdminEndUserSearchItem {
  endUserId: string
  phoneMasked: string
  nickname: string | null
  enabled: boolean
}

export interface AdminBenefitGrantItem extends MemberBenefitItem {
  endUserId: string
  phoneMasked: string
  nickname: string | null
}

const BENEFIT_TYPES: readonly BenefitType[] = ['coupon', 'free_quota', 'package_entitlement', 'subsidy_eligibility_hint']
const SOURCE_TYPES: readonly BenefitSourceType[] = ['platform', 'campus', 'gov', 'fair', 'partner']
const STATUS_TYPES: readonly BenefitStatus[] = ['active', 'used_up', 'expired', 'revoked']
const FORBIDDEN_COPY = /到账|已发放金额|发放金额|保证|通过率|录用|面试|候选人推荐|平台投递|一键投递|立即投递/

@Injectable()
export class AdminMemberBenefitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async searchEndUsersByPhone(admin: AuthedUser, phone: string): Promise<{ items: AdminEndUserSearchItem[] }> {
    const normalized = normalizePhone(phone)
    if (!isValidCnMobile(normalized)) {
      throw new BadRequestException({ error: { code: 'INVALID_PHONE', message: '请输入有效手机号' } })
    }
    const row = await this.prisma.endUser.findUnique({
      where: { phoneHash: hashPhone(normalized) },
      select: { id: true, phoneEnc: true, nickname: true, enabled: true },
    })
    const phoneMasked = row ? maskPhoneFromEnc(row.phoneEnc) : maskPhone(normalized)
    await this.audit.write({
      actorId: admin.userId,
      actorRole: admin.role,
      action: 'member_benefit.search',
      targetType: 'EndUser',
      targetId: row?.id ?? null,
      payload: { phoneMasked, matched: Boolean(row) },
    })
    if (!row) return { items: [] }
    return {
      items: [{
        endUserId: row.id,
        phoneMasked,
        nickname: row.nickname,
        enabled: row.enabled,
      }],
    }
  }

  async listForEndUser(endUserId: string): Promise<{ items: AdminBenefitGrantItem[] }> {
    const user = await this.findEndUser(endUserId)
    const phoneMasked = maskPhoneFromEnc(user.phoneEnc)
    const rows = await this.prisma.benefitGrant.findMany({
      where: { endUserId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
    return {
      items: rows.map((row) => this.toAdminItem(row, phoneMasked, user.nickname)),
    }
  }

  async grant(admin: AuthedUser, dto: GrantBenefitDto): Promise<AdminBenefitGrantItem> {
    const user = await this.findEndUser(dto.endUserId)
    if (!user.enabled) {
      throw new ConflictException({ error: { code: 'BENEFIT_END_USER_DISABLED', message: '该用户已停用，不能发放权益' } })
    }
    this.validateGrant(dto)

    const phoneMasked = maskPhoneFromEnc(user.phoneEnc)
    const quantityTotal = dto.benefitType === 'subsidy_eligibility_hint' ? null : (dto.quantityTotal ?? null)
    // info-only 政策资格提示既无额度也无面值：它不是券，绝不能被赋予任何抵扣能力。
    const valued = dto.benefitType !== 'subsidy_eligibility_hint'
    const created = await this.prisma.benefitGrant.create({
      data: {
        endUserId: dto.endUserId,
        benefitType: dto.benefitType,
        title: dto.title.trim(),
        description: cleanNullable(dto.description),
        quantityTotal,
        quantityRemaining: quantityTotal,
        amountCents: valued ? (dto.amountCents ?? null) : null,
        maxDiscountCents: valued ? (dto.maxDiscountCents ?? null) : null,
        serviceScope: valued ? cleanNullable(dto.serviceScope) : null,
        status: 'active',
        sourceType: dto.sourceType,
        validFrom: parseOptionalDate(dto.validFrom),
        validUntil: parseOptionalDate(dto.validUntil),
      },
    })

    await this.audit.write({
      actorId: admin.userId,
      actorRole: admin.role,
      action: 'member_benefit.grant',
      targetType: 'BenefitGrant',
      targetId: created.id,
      payload: {
        endUserId: dto.endUserId,
        phoneMasked,
        benefitType: created.benefitType,
        sourceType: created.sourceType,
        quantityTotal: created.quantityTotal,
        // 面值 / 上限 / 范围进审计：这三项决定这张券能抵多少钱，发放时的取值必须可追溯。
        amountCents: created.amountCents,
        maxDiscountCents: created.maxDiscountCents,
        serviceScope: created.serviceScope,
      },
    })

    return this.toAdminItem(created, phoneMasked, user.nickname)
  }

  async revoke(admin: AuthedUser, id: string, dto: RevokeBenefitDto): Promise<AdminBenefitGrantItem> {
    const current = await this.prisma.benefitGrant.findUnique({
      where: { id },
      include: { endUser: { select: { phoneEnc: true, nickname: true } } },
    })
    if (!current) {
      throw new NotFoundException({ error: { code: 'BENEFIT_NOT_FOUND', message: '权益记录不存在' } })
    }
    if (current.status !== 'active') {
      throw new ConflictException({ error: { code: 'BENEFIT_NOT_ACTIVE', message: '只有 active 状态的权益可以撤销' } })
    }
    const updated = await this.prisma.benefitGrant.update({
      where: { id },
      data: { status: 'revoked' },
      include: { endUser: { select: { phoneEnc: true, nickname: true } } },
    })
    const phoneMasked = maskPhoneFromEnc(updated.endUser.phoneEnc)
    await this.audit.write({
      actorId: admin.userId,
      actorRole: admin.role,
      action: 'member_benefit.revoke',
      targetType: 'BenefitGrant',
      targetId: updated.id,
      payload: {
        endUserId: updated.endUserId,
        phoneMasked,
        reason: cleanNullable(dto.reason),
      },
    })
    return this.toAdminItem(updated, phoneMasked, updated.endUser.nickname)
  }

  private validateGrant(dto: GrantBenefitDto): void {
    if (!BENEFIT_TYPES.includes(dto.benefitType)) {
      throw new BadRequestException({ error: { code: 'BENEFIT_TYPE_INVALID', message: '权益类型不支持' } })
    }
    if (!SOURCE_TYPES.includes(dto.sourceType)) {
      throw new BadRequestException({ error: { code: 'BENEFIT_SOURCE_INVALID', message: '权益来源不支持' } })
    }
    const title = dto.title.trim()
    if (!title) {
      throw new BadRequestException({ error: { code: 'BENEFIT_TITLE_REQUIRED', message: '权益名称不能为空' } })
    }
    const text = `${title} ${dto.description ?? ''}`
    if (FORBIDDEN_COPY.test(text)) {
      throw new BadRequestException({ error: { code: 'BENEFIT_COPY_FORBIDDEN', message: '权益文案含有不合规承诺，请调整为信息说明' } })
    }
    if (dto.benefitType === 'subsidy_eligibility_hint' && dto.quantityTotal !== null && dto.quantityTotal !== undefined) {
      throw new BadRequestException({ error: { code: 'BENEFIT_QUANTITY_FORBIDDEN', message: '政策资格提示不允许设置额度' } })
    }
    // info-only 资格提示是政策说明，不是券：给它填面值等于承诺一笔可抵扣金额，直接拒绝而不是静默丢弃。
    if (
      dto.benefitType === 'subsidy_eligibility_hint' &&
      (dto.amountCents !== null && dto.amountCents !== undefined)
    ) {
      throw new BadRequestException({ error: { code: 'BENEFIT_AMOUNT_FORBIDDEN', message: '政策资格提示不允许设置面值' } })
    }
    // 上限低于面值即等价于把面值改小，属于自相矛盾的录入 —— 明确拒绝，避免运营以为按面值抵扣。
    if (
      dto.amountCents !== null && dto.amountCents !== undefined &&
      dto.maxDiscountCents !== null && dto.maxDiscountCents !== undefined &&
      dto.maxDiscountCents < dto.amountCents
    ) {
      throw new BadRequestException({ error: { code: 'BENEFIT_DISCOUNT_CAP_INVALID', message: '抵扣上限不能低于面值' } })
    }
    // 只有面值缺席时上限才没有意义（没有可封顶的对象），这种组合多半是漏填面值。
    if (
      (dto.amountCents === null || dto.amountCents === undefined) &&
      dto.maxDiscountCents !== null && dto.maxDiscountCents !== undefined
    ) {
      throw new BadRequestException({ error: { code: 'BENEFIT_AMOUNT_REQUIRED', message: '设置抵扣上限前必须先设置面值' } })
    }
    const validFrom = parseOptionalDate(dto.validFrom)
    const validUntil = parseOptionalDate(dto.validUntil)
    if (validFrom && validUntil && validFrom.getTime() > validUntil.getTime()) {
      throw new BadRequestException({ error: { code: 'BENEFIT_DATE_INVALID', message: '有效期开始时间不能晚于结束时间' } })
    }
  }

  private async findEndUser(endUserId: string): Promise<{ id: string; phoneEnc: string; nickname: string | null; enabled: boolean }> {
    const user = await this.prisma.endUser.findUnique({
      where: { id: endUserId },
      select: { id: true, phoneEnc: true, nickname: true, enabled: true },
    })
    if (!user) {
      throw new NotFoundException({ error: { code: 'BENEFIT_END_USER_NOT_FOUND', message: '会员不存在' } })
    }
    return user
  }

  private toAdminItem(
    row: {
      id: string
      endUserId: string
      benefitType: string
      title: string
      description: string | null
      quantityTotal: number | null
      quantityRemaining: number | null
      amountCents: number | null
      maxDiscountCents: number | null
      serviceScope: string | null
      status: string
      sourceType: string
      validFrom: Date | null
      validUntil: Date | null
      createdAt: Date
    },
    phoneMasked: string,
    nickname: string | null,
  ): AdminBenefitGrantItem {
    return {
      id: row.id,
      endUserId: row.endUserId,
      phoneMasked,
      nickname,
      benefitType: row.benefitType as BenefitType,
      title: row.title,
      description: row.description,
      quantityTotal: row.quantityTotal,
      quantityRemaining: row.quantityRemaining,
      amountCents: row.amountCents,
      maxDiscountCents: row.maxDiscountCents,
      serviceScope: row.serviceScope,
      status: STATUS_TYPES.includes(row.status as BenefitStatus) ? (row.status as BenefitStatus) : 'revoked',
      sourceType: row.sourceType as BenefitSourceType,
      validFrom: row.validFrom ? row.validFrom.toISOString() : null,
      validUntil: row.validUntil ? row.validUntil.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
    }
  }
}

function cleanNullable(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function parseOptionalDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException({ error: { code: 'BENEFIT_DATE_INVALID', message: '有效期时间格式不正确' } })
  }
  return date
}
