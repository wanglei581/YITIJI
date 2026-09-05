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
import { partnerOrgTypeCan } from '../jobs/partner-capabilities'
import { assertOrgContentTrustActive, type OrgTrustReader } from '../common/content-trust'
import { normalizeOptionalHttpUrl } from '../jobs/jobs-shared'

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
  /** 来源方原始编号(CLAUDE.md §10 外部ID);来源未提供为 null,不得伪造 */
  externalId: string | null
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
  externalId: string | null
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
    externalId: p.externalId ?? null,
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

  async getPublishedPolicies(params?: {
    kind?: string; audience?: string; category?: string; page?: number | string; pageSize?: number | string
  }): Promise<{ data: PolicyPostDto[]; pagination: { page: number; pageSize: number; total: number; totalPages: number } }> {
    const parsedPage = Number.parseInt(String(params?.page ?? 1), 10)
    const page = Math.min(10_000, Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1)
    const parsedPageSize = Number.parseInt(String(params?.pageSize ?? 200), 10)
    const pageSize = Math.min(200, Number.isFinite(parsedPageSize) && parsedPageSize > 0 ? parsedPageSize : 200)
    const where = {
        reviewStatus: 'approved',
        publishStatus: 'published',
        ...(params?.kind ? { kind: params.kind } : {}),
        ...(params?.audience ? { audience: params.audience } : {}),
        ...(params?.category ? { category: params.category } : {}),
    }
    const [rows, total] = await Promise.all([
      this.prisma.policyPost.findMany({
        where,
        orderBy: [{ publishedDate: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.policyPost.count({ where }),
    ])
    return {
      data: rows.map(mapPolicy),
      pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    }
  }

  async getPublishedPolicyById(id: string): Promise<{ data: PolicyPostDto; success: true }> {
    const row = await this.prisma.policyPost.findFirst({
      where: { id, reviewStatus: 'approved', publishStatus: 'published' },
    })
    if (!row) {
      throw new NotFoundException({ error: { code: 'POLICY_NOT_FOUND', message: `Policy ${id} not found` } })
    }
    return { data: mapPolicy(row), success: true }
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
    this.assertPolicyCapableOrgType(org)
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
        externalUrl: normalizeOptionalHttpUrl(dto.externalUrl, 'externalUrl') ?? null,
        externalId: dto.externalId ?? null,
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
        ...(dto.externalUrl !== undefined ? { externalUrl: normalizeOptionalHttpUrl(dto.externalUrl, 'externalUrl') ?? null } : {}),
        ...(dto.externalId !== undefined ? { externalId: dto.externalId } : {}),
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
    if (action === 'publish') {
      // 发布闸门:来源机构必须 contentTrustStatus='active' 且未归档(fail-closed)。
      // 详见 src/common/content-trust.ts 顶部注释。unpublish 不受闸门限制。
      await assertOrgContentTrustActive(this.prisma as unknown as OrgTrustReader, post.sourceOrgId, {
        contentType: '政策内容',
        contentId: id,
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

  /**
   * 仅在**创建**时校验机构类型。
   * 更新/下架/删除不校验：存量数据若由不该发布的机构创建，仍需允许其下架与删除，
   * 否则收紧权限反而会把违规内容锁死在已发布状态。
   *
   * ⚠️ 2026-08-11 新增。此前 createPartnerPolicy 只调 assertPartnerOrg——
   * 只检查账号挂靠与机构启用，**不检查机构类型**，导致持证人力资源机构、
   * 招聘会主办方、企业数据来源方同样能发布「政策公告」。
   *
   * 这是合规风险而非权限洁癖：政策内容是就业政策与补贴指引，属官方性质，
   * 且 Kiosk 侧带扫码办理入口。商业机构以「政策公告」名义发布内容，
   * 求职者会误认为是官方政策——政策涉及补贴与社保，是最敏感的内容类型。
   * `partner-permission-matrix.md` 本就规定只有人社与高校可管政策。
   *
   * 2026-09-02：原先此处自带一份 POLICY_CAPABLE_ORG_TYPES 常量，
   * 改为读 `partner-capabilities.ts` 的 `canManagePolicies`——那份矩阵同时也是
   * `GET /partner/data-sources/capabilities` 的返回内容，Partner 控制台按它决定
   * 「新增政策内容」是否可点。两处各存一份必然漂移（前端放行、后端拒写）。
   * 错误码与文案保持不变。
   */
  private assertPolicyCapableOrgType(org: { type: string; name: string }): void {
    if (!partnerOrgTypeCan(org.type, 'managePolicies')) {
      throw new BadRequestException({
        error: {
          code: 'ORG_TYPE_NOT_ALLOWED_FOR_POLICY',
          message: '仅公共就业服务机构与高校就业中心可发布政策内容',
        },
      })
    }
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
