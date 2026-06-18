import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { Prisma } from '../generated/prisma/client'
import type { AuthedUser } from '../common/decorators/current-user.decorator'
import { maskPhoneFromEnc } from '../common/crypto/phone-identity'
import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import type { MemberBenefitItem } from '../member-benefits/member-benefits.types'
import type {
  BenefitActivityClaimItem,
  BenefitActivityListItem,
  BenefitActivitySourceType,
  BenefitActivityStatus,
  BenefitActivityType,
} from './benefit-activities.types'
import type { AdminListBenefitActivitiesQueryDto, ListBenefitActivitiesQueryDto, UpsertBenefitActivityDto } from './dto/benefit-activities.dto'

const FORBIDDEN_COPY = /到账|已发放金额|发放金额|保证|通过率|录用|面试|候选人推荐|平台投递|一键投递|立即投递/
const STATUS_TYPES: readonly BenefitActivityStatus[] = ['draft', 'published', 'ended']

@Injectable()
export class BenefitActivitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async adminList(query: AdminListBenefitActivitiesQueryDto): Promise<{ items: BenefitActivityListItem[] }> {
    const where: Record<string, unknown> = {}
    if (query.status) where['status'] = query.status
    if (query.source) where['sourceType'] = query.source
    const rows = await this.prisma.benefitActivity.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
    })
    return { items: rows.map((row) => this.toActivityItem(row, false)) }
  }

  async create(admin: AuthedUser, dto: UpsertBenefitActivityDto): Promise<BenefitActivityListItem> {
    this.validateActivityInput(dto)
    const stockTotal = normalizeOptionalInt(dto.stockTotal)
    const created = await this.prisma.benefitActivity.create({
      data: {
        title: dto.title.trim(),
        description: cleanNullable(dto.description),
        rulesText: cleanNullable(dto.rulesText),
        benefitType: dto.benefitType,
        sourceType: dto.sourceType,
        quantityTotal: dto.benefitType === 'subsidy_eligibility_hint' ? null : normalizeOptionalInt(dto.quantityTotal),
        stockTotal,
        stockRemaining: stockTotal,
        claimLimitPerUser: 1,
        status: 'draft',
        validFrom: parseOptionalDate(dto.validFrom),
        validUntil: parseOptionalDate(dto.validUntil),
        grantValidDays: normalizeOptionalInt(dto.grantValidDays),
        createdById: admin.userId,
      },
    })
    await this.writeAdminAudit(admin, 'benefit_activity.create', created)
    return this.toActivityItem(created, false)
  }

  async update(admin: AuthedUser, id: string, dto: UpsertBenefitActivityDto): Promise<BenefitActivityListItem> {
    this.validateActivityInput(dto)
    const current = await this.findActivity(id)
    if (current.status !== 'draft') {
      throw new ConflictException({ error: { code: 'BENEFIT_ACTIVITY_NOT_EDITABLE', message: '只有草稿活动可以编辑' } })
    }
    const stockTotal = normalizeOptionalInt(dto.stockTotal)
    const updated = await this.prisma.benefitActivity.update({
      where: { id },
      data: {
        title: dto.title.trim(),
        description: cleanNullable(dto.description),
        rulesText: cleanNullable(dto.rulesText),
        benefitType: dto.benefitType,
        sourceType: dto.sourceType,
        quantityTotal: dto.benefitType === 'subsidy_eligibility_hint' ? null : normalizeOptionalInt(dto.quantityTotal),
        stockTotal,
        stockRemaining: stockTotal,
        claimLimitPerUser: 1,
        validFrom: parseOptionalDate(dto.validFrom),
        validUntil: parseOptionalDate(dto.validUntil),
        grantValidDays: normalizeOptionalInt(dto.grantValidDays),
      },
    })
    await this.writeAdminAudit(admin, 'benefit_activity.update', updated)
    return this.toActivityItem(updated, false)
  }

  async publish(admin: AuthedUser, id: string): Promise<BenefitActivityListItem> {
    const current = await this.findActivity(id)
    if (current.status !== 'draft') {
      throw new ConflictException({ error: { code: 'BENEFIT_ACTIVITY_NOT_DRAFT', message: '只有草稿活动可以发布' } })
    }
    this.validateStoredActivity(current)
    const updated = await this.prisma.benefitActivity.update({
      where: { id },
      data: { status: 'published' },
    })
    await this.writeAdminAudit(admin, 'benefit_activity.publish', updated)
    return this.toActivityItem(updated, false)
  }

  async end(admin: AuthedUser, id: string): Promise<BenefitActivityListItem> {
    const current = await this.findActivity(id)
    if (current.status !== 'published') {
      throw new ConflictException({ error: { code: 'BENEFIT_ACTIVITY_NOT_PUBLISHED', message: '只有已发布活动可以下架' } })
    }
    const updated = await this.prisma.benefitActivity.update({
      where: { id },
      data: { status: 'ended' },
    })
    await this.writeAdminAudit(admin, 'benefit_activity.end', updated)
    return this.toActivityItem(updated, false)
  }

  async listClaims(id: string): Promise<{ items: BenefitActivityClaimItem[] }> {
    await this.findActivity(id)
    const rows = await this.prisma.benefitClaim.findMany({
      where: { activityId: id },
      include: {
        endUser: { select: { phoneEnc: true } },
        benefitGrant: { select: { status: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    })
    return {
      items: rows.map((row) => ({
        id: row.id,
        activityId: row.activityId,
        endUserId: row.endUserId,
        phoneMasked: maskPhoneFromEnc(row.endUser.phoneEnc),
        benefitGrantId: row.benefitGrantId,
        grantStatus: row.benefitGrant.status,
        createdAt: row.createdAt.toISOString(),
      })),
    }
  }

  async listVisible(query: ListBenefitActivitiesQueryDto, endUserId?: string | null): Promise<{ items: BenefitActivityListItem[] }> {
    const rows = await this.prisma.benefitActivity.findMany({
      where: this.visibleWhere(query.source),
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
    const claimedIds = await this.claimedActivityIds(endUserId, rows.map((row) => row.id))
    return { items: rows.map((row) => this.toActivityItem(row, claimedIds.has(row.id))) }
  }

  async detail(id: string, endUserId?: string | null): Promise<BenefitActivityListItem> {
    const row = await this.prisma.benefitActivity.findFirst({
      where: { id, ...this.visibleWhere() },
    })
    if (!row) {
      throw new NotFoundException({ error: { code: 'BENEFIT_ACTIVITY_NOT_FOUND', message: '权益活动不存在或已结束' } })
    }
    const claimedIds = await this.claimedActivityIds(endUserId, [id])
    return this.toActivityItem(row, claimedIds.has(id))
  }

  async claim(endUserId: string, activityId: string): Promise<MemberBenefitItem> {
    const user = await this.prisma.endUser.findUnique({
      where: { id: endUserId },
      select: { enabled: true },
    })
    if (!user || !user.enabled) {
      throw new ConflictException({ error: { code: 'BENEFIT_ACTIVITY_USER_DISABLED', message: '账号不可领取权益' } })
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const activity = await tx.benefitActivity.findUnique({ where: { id: activityId } })
      if (!activity || !this.isActivityVisible(activity)) {
        throw new ConflictException({ error: { code: 'BENEFIT_ACTIVITY_NOT_CLAIMABLE', message: '活动暂不可领取' } })
      }

      const now = new Date()
      const validUntil = activity.grantValidDays
        ? new Date(now.getTime() + activity.grantValidDays * 24 * 60 * 60 * 1000)
        : activity.validUntil
      const quantityTotal = activity.benefitType === 'subsidy_eligibility_hint' ? null : activity.quantityTotal
      const grant = await tx.benefitGrant.create({
        data: {
          endUserId,
          benefitType: activity.benefitType,
          title: activity.title,
          description: activity.description,
          quantityTotal,
          quantityRemaining: quantityTotal,
          status: 'active',
          sourceType: activity.sourceType,
          sourceRef: activity.id,
          validFrom: now,
          validUntil,
        },
      })

      try {
        await tx.benefitClaim.create({
          data: { activityId: activity.id, endUserId, benefitGrantId: grant.id },
        })
      } catch (error) {
        if (isUniqueError(error)) {
          throw new ConflictException({ error: { code: 'BENEFIT_ACTIVITY_ALREADY_CLAIMED', message: '该活动已领取' } })
        }
        throw error
      }

      if (activity.stockRemaining !== null) {
        const updated = await tx.benefitActivity.updateMany({
          where: { id: activity.id, stockRemaining: { gt: 0 } },
          data: { stockRemaining: { decrement: 1 } },
        })
        if (updated.count !== 1) {
          throw new ConflictException({ error: { code: 'BENEFIT_ACTIVITY_SOLD_OUT', message: '活动名额已领完' } })
        }
      }

      return { grant, activity }
    })

    await this.audit.write({
      actorId: null,
      actorRole: 'end_user',
      action: 'benefit_activity.claim',
      targetType: 'BenefitActivity',
      targetId: activityId,
      payload: {
        endUserId,
        benefitGrantId: result.grant.id,
        benefitType: result.activity.benefitType,
        sourceType: result.activity.sourceType,
      },
    })

    return this.toMemberBenefitItem(result.grant)
  }

  private validateActivityInput(dto: UpsertBenefitActivityDto): void {
    const title = dto.title.trim()
    if (!title) {
      throw new BadRequestException({ error: { code: 'BENEFIT_ACTIVITY_TITLE_REQUIRED', message: '活动标题不能为空' } })
    }
    const text = `${title} ${dto.description ?? ''} ${dto.rulesText ?? ''}`
    if (FORBIDDEN_COPY.test(text)) {
      throw new BadRequestException({ error: { code: 'BENEFIT_ACTIVITY_COPY_FORBIDDEN', message: '活动文案含有不合规承诺，请调整为信息说明' } })
    }
    if (dto.benefitType === 'subsidy_eligibility_hint' && dto.quantityTotal !== null && dto.quantityTotal !== undefined) {
      throw new BadRequestException({ error: { code: 'BENEFIT_ACTIVITY_QUANTITY_FORBIDDEN', message: '政策资格提示不允许设置额度' } })
    }
    const validFrom = parseOptionalDate(dto.validFrom)
    const validUntil = parseOptionalDate(dto.validUntil)
    if (validFrom && validUntil && validFrom.getTime() > validUntil.getTime()) {
      throw new BadRequestException({ error: { code: 'BENEFIT_ACTIVITY_DATE_INVALID', message: '活动开始时间不能晚于结束时间' } })
    }
  }

  private validateStoredActivity(row: ActivityRow): void {
    this.validateActivityInput({
      title: row.title,
      description: row.description,
      rulesText: row.rulesText,
      benefitType: row.benefitType,
      sourceType: row.sourceType,
      quantityTotal: row.quantityTotal,
      stockTotal: row.stockTotal,
      validFrom: row.validFrom?.toISOString() ?? null,
      validUntil: row.validUntil?.toISOString() ?? null,
      grantValidDays: row.grantValidDays,
    })
  }

  private async findActivity(id: string): Promise<ActivityRow> {
    const row = await this.prisma.benefitActivity.findUnique({ where: { id } })
    if (!row) {
      throw new NotFoundException({ error: { code: 'BENEFIT_ACTIVITY_NOT_FOUND', message: '权益活动不存在' } })
    }
    return row
  }

  private visibleWhere(source?: string | null): Record<string, unknown> {
    const now = new Date()
    return {
      status: 'published',
      ...(source ? { sourceType: source } : {}),
      AND: [
        { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
        { OR: [{ validUntil: null }, { validUntil: { gte: now } }] },
      ],
    }
  }

  private isActivityVisible(row: ActivityRow): boolean {
    const now = Date.now()
    return row.status === 'published'
      && (!row.validFrom || row.validFrom.getTime() <= now)
      && (!row.validUntil || row.validUntil.getTime() >= now)
  }

  private async claimedActivityIds(endUserId: string | null | undefined, ids: string[]): Promise<Set<string>> {
    if (!endUserId || ids.length === 0) return new Set()
    const rows = await this.prisma.benefitClaim.findMany({
      where: { endUserId, activityId: { in: ids } },
      select: { activityId: true },
    })
    return new Set(rows.map((row) => row.activityId))
  }

  private toActivityItem(row: ActivityRow, claimed: boolean): BenefitActivityListItem {
    const soldOut = row.stockRemaining !== null && row.stockRemaining <= 0
    const ended = !this.isActivityVisible(row)
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      rulesText: row.rulesText,
      benefitType: row.benefitType as BenefitActivityType,
      sourceType: row.sourceType as BenefitActivitySourceType,
      quantityTotal: row.quantityTotal,
      stockTotal: row.stockTotal,
      stockRemaining: row.stockRemaining,
      claimLimitPerUser: row.claimLimitPerUser,
      status: STATUS_TYPES.includes(row.status as BenefitActivityStatus) ? (row.status as BenefitActivityStatus) : 'ended',
      validFrom: row.validFrom ? row.validFrom.toISOString() : null,
      validUntil: row.validUntil ? row.validUntil.toISOString() : null,
      grantValidDays: row.grantValidDays,
      claimable: !claimed && !soldOut && !ended,
      claimed,
      soldOut,
      ended,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }
  }

  private toMemberBenefitItem(row: GrantRow): MemberBenefitItem {
    return {
      id: row.id,
      benefitType: row.benefitType as MemberBenefitItem['benefitType'],
      title: row.title,
      description: row.description,
      quantityTotal: row.quantityTotal,
      quantityRemaining: row.quantityRemaining,
      status: row.status as MemberBenefitItem['status'],
      sourceType: row.sourceType as MemberBenefitItem['sourceType'],
      validFrom: row.validFrom ? row.validFrom.toISOString() : null,
      validUntil: row.validUntil ? row.validUntil.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
    }
  }

  private async writeAdminAudit(admin: AuthedUser, action: string, row: ActivityRow): Promise<void> {
    await this.audit.write({
      actorId: admin.userId,
      actorRole: admin.role,
      action,
      targetType: 'BenefitActivity',
      targetId: row.id,
      payload: {
        title: row.title,
        benefitType: row.benefitType,
        sourceType: row.sourceType,
        status: row.status,
      },
    })
  }
}

type ActivityRow = {
  id: string
  title: string
  description: string | null
  rulesText: string | null
  benefitType: string
  sourceType: string
  quantityTotal: number | null
  stockTotal: number | null
  stockRemaining: number | null
  claimLimitPerUser: number
  status: string
  validFrom: Date | null
  validUntil: Date | null
  grantValidDays: number | null
  createdAt: Date
  updatedAt: Date
}

type GrantRow = {
  id: string
  benefitType: string
  title: string
  description: string | null
  quantityTotal: number | null
  quantityRemaining: number | null
  status: string
  sourceType: string
  validFrom: Date | null
  validUntil: Date | null
  createdAt: Date
}

function cleanNullable(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function normalizeOptionalInt(value: number | null | undefined): number | null {
  return value === null || value === undefined ? null : Number(value)
}

function parseOptionalDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException({ error: { code: 'BENEFIT_ACTIVITY_DATE_INVALID', message: '活动时间格式不正确' } })
  }
  return date
}

function isUniqueError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}
