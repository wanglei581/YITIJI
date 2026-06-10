import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import type { AuthedUser } from '../common/decorators/current-user.decorator'
import type { CreatePolicyPostDto, UpdatePolicyPostDto } from './dto/policy.dto'
import type { ReviewAction } from '../jobs/dto/review.dto'
import type { PublishAction } from '../jobs/dto/publish.dto'

// ============================================================
// PoliciesService — 阶段1D:政策服务(政策扶持条目 + 政策公告)
//
// 数据流:Partner 录入/编辑(回 pending 重审)→ Admin 审核/发布 → Kiosk 展示。
// 状态机与 Job/JobFair 完全一致(approve→draft 待发布;reject 必填原因;
// 编辑强制回 pending+draft)。
//
// 合规:info-only —— 政策说明 / 官方入口;不承诺补贴到账、不代申请;
// 所有写操作落 AuditLog。
// ============================================================

export interface PolicyPostDto {
  id: string
  kind: string
  title: string
  summary?: string
  content?: string
  audience?: string
  category?: string
  externalUrl?: string
  publishedDate?: string
  sourceOrgId: string
  sourceName: string
  reviewStatus: string
  publishStatus: string
  rejectReason: string | null
  syncTime: string
  updatedAt: string
}

interface PrismaPolicyRow {
  id: string
  kind: string
  title: string
  summary: string | null
  content: string | null
  audience: string | null
  category: string | null
  externalUrl: string | null
  publishedDate: Date | null
  sourceOrgId: string
  sourceName: string
  reviewStatus: string
  publishStatus: string
  rejectReason: string | null
  syncTime: Date
  updatedAt: Date
}

function mapPolicy(p: PrismaPolicyRow): PolicyPostDto {
  return {
    id: p.id,
    kind: p.kind,
    title: p.title,
    summary: p.summary ?? undefined,
    content: p.content ?? undefined,
    audience: p.audience ?? undefined,
    category: p.category ?? undefined,
    externalUrl: p.externalUrl ?? undefined,
    publishedDate: p.publishedDate ? p.publishedDate.toISOString().slice(0, 10) : undefined,
    sourceOrgId: p.sourceOrgId,
    sourceName: p.sourceName,
    reviewStatus: p.reviewStatus,
    publishStatus: p.publishStatus,
    rejectReason: p.rejectReason,
    syncTime: p.syncTime.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  }
}

@Injectable()
export class PoliciesService {
  private readonly logger = new Logger(PoliciesService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ── Kiosk 公开读(只放出 approved+published)──────────────────────────────

  async getPublishedPolicies(params?: { kind?: string; audience?: string; category?: string }): Promise<{ data: PolicyPostDto[] }> {
    const rows = await this.prisma.policyPost.findMany({
      where: {
        reviewStatus: 'approved',
        publishStatus: 'published',
        ...(params?.kind ? { kind: params.kind } : {}),
        ...(params?.audience ? { audience: params.audience } : {}),
        ...(params?.category ? { category: params.category } : {}),
      },
      orderBy: [{ publishedDate: 'desc' }, { createdAt: 'desc' }],
      take: 200,
    })
    return { data: rows.map(mapPolicy) }
  }

  // ── Partner:本机构 CRUD(编辑回 pending 重审)─────────────────────────────

  async getPartnerPolicies(user: AuthedUser): Promise<PolicyPostDto[]> {
    if (!user.orgId) return []
    const rows = await this.prisma.policyPost.findMany({
      where: { sourceOrgId: user.orgId },
      orderBy: { createdAt: 'desc' },
    })
    return rows.map(mapPolicy)
  }

  async createPartnerPolicy(dto: CreatePolicyPostDto, user: AuthedUser): Promise<PolicyPostDto> {
    const org = await this.assertPartnerOrg(user)
    this.assertKindFields(dto.kind, dto.audience, dto.category)
    const created = await this.prisma.policyPost.create({
      data: {
        sourceOrgId: org.id,
        sourceName: org.name,
        kind: dto.kind,
        title: dto.title,
        summary: dto.summary ?? null,
        content: dto.content ?? null,
        audience: dto.audience ?? null,
        category: dto.category ?? null,
        externalUrl: dto.externalUrl ?? null,
        publishedDate: dto.publishedDate ? new Date(dto.publishedDate) : null,
      },
    })
    await this.audit.write({
      actorId: user.userId,
      actorRole: 'partner',
      action: 'policy.create',
      targetType: 'policy',
      targetId: created.id,
      payload: { kind: dto.kind, title: dto.title },
    })
    this.logger.log(`createPartnerPolicy: id=${created.id} orgId=${org.id}`)
    return mapPolicy(created)
  }

  async updatePartnerPolicy(id: string, dto: UpdatePolicyPostDto, user: AuthedUser): Promise<PolicyPostDto> {
    const org = await this.assertPartnerOrg(user)
    const post = await this.prisma.policyPost.findUnique({ where: { id } })
    if (!post || post.sourceOrgId !== org.id) {
      throw new NotFoundException({ error: { code: 'POLICY_NOT_FOUND', message: `Policy ${id} not found` } })
    }
    const kind = dto.kind ?? post.kind
    this.assertKindFields(kind, dto.audience ?? post.audience ?? undefined, dto.category ?? post.category ?? undefined)

    const changedFields = Object.keys(dto).filter((k) => (dto as Record<string, unknown>)[k] !== undefined)
    const updated = await this.prisma.policyPost.update({
      where: { id },
      data: {
        ...(dto.kind !== undefined ? { kind: dto.kind } : {}),
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.summary !== undefined ? { summary: dto.summary } : {}),
        ...(dto.content !== undefined ? { content: dto.content } : {}),
        ...(dto.audience !== undefined ? { audience: dto.audience } : {}),
        ...(dto.category !== undefined ? { category: dto.category } : {}),
        ...(dto.externalUrl !== undefined ? { externalUrl: dto.externalUrl } : {}),
        ...(dto.publishedDate !== undefined ? { publishedDate: new Date(dto.publishedDate) } : {}),
        // 状态机:内容修订 → 强制重审(与岗位/招聘会一致)
        reviewStatus: 'pending',
        publishStatus: 'draft',
        rejectReason: null,
        reviewedBy: null,
        reviewedAt: null,
        syncTime: new Date(),
      },
    })
    await this.audit.write({
      actorId: user.userId,
      actorRole: 'partner',
      action: 'policy.partner_update',
      targetType: 'policy',
      targetId: id,
      payload: { changedFields, fromReviewStatus: post.reviewStatus, fromPublishStatus: post.publishStatus },
    })
    return mapPolicy(updated)
  }

  async unpublishPartnerPolicy(id: string, user: AuthedUser): Promise<PolicyPostDto> {
    const org = await this.assertPartnerOrg(user)
    const post = await this.prisma.policyPost.findUnique({ where: { id } })
    if (!post || post.sourceOrgId !== org.id) {
      throw new NotFoundException({ error: { code: 'POLICY_NOT_FOUND', message: `Policy ${id} not found` } })
    }
    const updated = await this.prisma.policyPost.update({ where: { id }, data: { publishStatus: 'unpublished' } })
    await this.audit.write({
      actorId: user.userId,
      actorRole: 'partner',
      action: 'policy.unpublish',
      targetType: 'policy',
      targetId: id,
      payload: { fromPublishStatus: post.publishStatus },
    })
    return mapPolicy(updated)
  }

  async deletePartnerPolicy(id: string, user: AuthedUser): Promise<{ success: true }> {
    const org = await this.assertPartnerOrg(user)
    const post = await this.prisma.policyPost.findUnique({ where: { id } })
    if (!post || post.sourceOrgId !== org.id) {
      throw new NotFoundException({ error: { code: 'POLICY_NOT_FOUND', message: `Policy ${id} not found` } })
    }
    await this.prisma.policyPost.delete({ where: { id } })
    await this.audit.write({
      actorId: user.userId,
      actorRole: 'partner',
      action: 'policy.delete',
      targetType: 'policy',
      targetId: id,
      payload: { title: post.title, kind: post.kind },
    })
    return { success: true }
  }

  // ── Admin:全量 + 审核/发布(状态机与 fair-sources 一致)──────────────────

  async getAllPolicySources(): Promise<PolicyPostDto[]> {
    const rows = await this.prisma.policyPost.findMany({ orderBy: { createdAt: 'desc' } })
    return rows.map(mapPolicy)
  }

  async reviewPolicy(id: string, action: ReviewAction, reason: string | undefined, user: AuthedUser): Promise<PolicyPostDto> {
    const post = await this.prisma.policyPost.findUnique({ where: { id } })
    if (!post) {
      throw new NotFoundException({ error: { code: 'POLICY_NOT_FOUND', message: `Policy ${id} not found` } })
    }
    if (post.reviewStatus === 'approved' || post.reviewStatus === 'rejected') {
      throw new BadRequestException({
        error: { code: 'INVALID_STATE_TRANSITION', message: `审核终态 ${post.reviewStatus} 不可回退,需机构重新编辑提审` },
      })
    }
    let data: { reviewStatus: string; publishStatus?: string; rejectReason?: string | null }
    if (action === 'reviewing') {
      data = { reviewStatus: 'reviewing' }
    } else if (action === 'approve') {
      data = { reviewStatus: 'approved', publishStatus: 'draft', rejectReason: null }
    } else {
      const trimmed = (reason ?? '').trim()
      if (trimmed.length === 0) {
        throw new BadRequestException({ error: { code: 'REJECT_REASON_REQUIRED', message: 'reject 必须提供 reason' } })
      }
      data = { reviewStatus: 'rejected', publishStatus: 'draft', rejectReason: trimmed }
    }
    const updated = await this.prisma.policyPost.update({
      where: { id },
      data: { ...data, reviewedBy: user.userId, reviewedAt: new Date() },
    })
    await this.audit.write({
      actorId: user.userId,
      actorRole: 'admin',
      action: 'policy.review',
      targetType: 'policy',
      targetId: id,
      payload: { action, reason: data.rejectReason ?? null, fromReviewStatus: post.reviewStatus, toReviewStatus: data.reviewStatus },
    })
    return mapPolicy(updated)
  }

  async publishPolicy(id: string, action: PublishAction, user: AuthedUser): Promise<PolicyPostDto> {
    const post = await this.prisma.policyPost.findUnique({ where: { id } })
    if (!post) {
      throw new NotFoundException({ error: { code: 'POLICY_NOT_FOUND', message: `Policy ${id} not found` } })
    }
    if (action === 'publish' && post.reviewStatus !== 'approved') {
      throw new BadRequestException({
        error: { code: 'PUBLISH_REQUIRES_APPROVAL', message: '未通过审核的政策内容不得发布' },
      })
    }
    const toStatus = action === 'publish' ? 'published' : 'unpublished'
    const updated = await this.prisma.policyPost.update({ where: { id }, data: { publishStatus: toStatus } })
    await this.audit.write({
      actorId: user.userId,
      actorRole: 'admin',
      action: 'policy.publish',
      targetType: 'policy',
      targetId: id,
      payload: { action, fromPublishStatus: post.publishStatus, toPublishStatus: toStatus },
    })
    return mapPolicy(updated)
  }

  // ── 内部 helpers ────────────────────────────────────────────────────────────

  private async assertPartnerOrg(user: AuthedUser) {
    if (user.role !== 'partner' || !user.orgId) {
      throw new BadRequestException({ error: { code: 'PARTNER_ORG_REQUIRED', message: 'partner 账号必须挂在机构下' } })
    }
    const org = await this.prisma.organization.findUnique({ where: { id: user.orgId } })
    if (!org || !org.enabled) {
      throw new BadRequestException({ error: { code: 'PARTNER_ORG_NOT_FOUND', message: '机构不存在或已停用' } })
    }
    return org
  }

  /** policy_guide 必须有 audience;notice 必须有 category(各自分组/标签的展示前提)。 */
  private assertKindFields(kind: string, audience: string | undefined, category: string | undefined): void {
    if (kind === 'policy_guide' && !audience) {
      throw new BadRequestException({ error: { code: 'AUDIENCE_REQUIRED', message: '政策扶持条目必须选择适用人群' } })
    }
    if (kind === 'notice' && !category) {
      throw new BadRequestException({ error: { code: 'CATEGORY_REQUIRED', message: '政策公告必须选择公告标签' } })
    }
  }
}
