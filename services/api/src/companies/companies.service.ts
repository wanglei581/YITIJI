import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { buildMemberPage, memberPageArgs, type MemberPageQuery } from '../common/utils/member-page'
import {
  COMPANY_INDUSTRIES,
  COMPANY_RECRUIT_TYPES,
  COMPANY_SOURCE_KINDS,
  COMPANY_TYPES,
  parseJsonArray,
} from './companies.types'
import type {
  AdminCreateCompanyDto, AdminLinkJobsDto, AdminPublishCompanyDto, AdminReviewCompanyDto,
  AdminUpdateCompanyDto, CompanyFieldsDto, PartnerImportCompaniesDto, PartnerUpdateCompanyDto,
} from './dto/company.dto'

// ============================================================
// 企业展示服务（CompanyProfile，来源企业与岗位导览）。
//
// 合规定位（长期红线）：不是招聘平台。
// - Kiosk 只读「approved + published」企业；列表/统计/筛选项全部为真实聚合，
//   没有任何写死数字。
// - 不收简历、无平台内投递；岗位行只引导既有「去来源平台投递」链路。
// - Partner 只能维护本机构来源数据（orgId 取自 JWT），导入/编辑一律回
//   pending + draft 强制重审（与 1C 岗位编辑同口径）。
// - Admin 审核/发布/关联岗位全部写审计。
// ============================================================

const PUBLISHED = { reviewStatus: 'approved', publishStatus: 'published' } as const

export interface PublicCompanyFilters {
  keyword?: string
  province?: string
  city?: string
  district?: string
  companyType?: string
  industry?: string
  recruitType?: string
  sourceKind?: string
}

function assertEnum(value: string | undefined, allowed: readonly string[], label: string): void {
  if (value !== undefined && !allowed.includes(value)) {
    throw new BadRequestException({ error: { code: 'COMPANY_INVALID_FILTER', message: `不支持的${label}筛选值` } })
  }
}

/** 把筛选条件编译为 Prisma where（只允许白名单枚举，地区为等值匹配）。 */
function publicWhere(f: PublicCompanyFilters) {
  assertEnum(f.companyType, COMPANY_TYPES, '企业类型')
  assertEnum(f.industry, COMPANY_INDUSTRIES, '行业')
  assertEnum(f.recruitType, COMPANY_RECRUIT_TYPES, '招聘类型')
  assertEnum(f.sourceKind, COMPANY_SOURCE_KINDS, '来源')

  const where: Record<string, unknown> = { ...PUBLISHED }
  if (f.province?.trim()) where['province'] = f.province.trim()
  if (f.city?.trim()) where['city'] = f.city.trim()
  if (f.district?.trim()) where['district'] = f.district.trim()
  if (f.companyType) where['companyType'] = f.companyType
  if (f.industry) where['industry'] = f.industry
  if (f.sourceKind) where['org'] = { type: f.sourceKind }
  if (f.recruitType === 'fair') {
    where['fairParticipant'] = true
  } else if (f.recruitType) {
    where['jobs'] = { some: { ...PUBLISHED, category: f.recruitType } }
  }
  const kw = f.keyword?.trim()
  if (kw) {
    where['OR'] = [
      { name: { contains: kw } },
      { description: { contains: kw } },
      { jobs: { some: { ...PUBLISHED, title: { contains: kw } } } },
    ]
  }
  return where
}

@Injectable()
export class CompaniesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ── Kiosk 公开读 ──────────────────────────────────────────────────────────

  /** 找企业列表（游标分页；openJobCount / 代表岗位均为真实统计）。 */
  async listPublic(filters: PublicCompanyFilters, page: MemberPageQuery) {
    const where = publicWhere(filters)
    const total = await this.prisma.companyProfile.count({ where })
    const rows = await this.prisma.companyProfile.findMany({
      where,
      select: {
        id: true, name: true, logoUrl: true, companyType: true, industry: true,
        sourceName: true, province: true, city: true, district: true,
        description: true, tagsJson: true, fairParticipant: true,
        _count: { select: { jobs: { where: { ...PUBLISHED } } } },
      },
      ...memberPageArgs(page),
    })
    // 代表岗位：当前页企业的已发布岗位标题各取前 3（真实数据，无则空数组）
    const ids = rows.map((r) => r.id)
    const jobRows = ids.length === 0 ? [] : await this.prisma.job.findMany({
      where: { companyProfileId: { in: ids }, ...PUBLISHED },
      select: { companyProfileId: true, title: true },
      orderBy: [{ syncTime: 'desc' }],
      take: ids.length * 6,
    })
    const repMap = new Map<string, string[]>()
    for (const j of jobRows) {
      const list = repMap.get(j.companyProfileId!) ?? []
      if (list.length < 3 && !list.includes(j.title)) list.push(j.title)
      repMap.set(j.companyProfileId!, list)
    }
    return buildMemberPage(rows, page, total, (r) => ({
      id: r.id,
      name: r.name,
      logoUrl: r.logoUrl,
      companyType: r.companyType,
      industry: r.industry,
      sourceName: r.sourceName,
      province: r.province,
      city: r.city,
      district: r.district,
      description: r.description,
      repJobTitles: repMap.get(r.id) ?? [],
      openJobCount: r._count.jobs,
      fairParticipant: r.fairParticipant,
      tags: parseJsonArray(r.tagsJson),
    }))
  }

  /** 找企业页统计条（全部真实聚合；按当前筛选范围计算）。 */
  async statsPublic(filters: PublicCompanyFilters) {
    const where = publicWhere(filters)
    const companyCount = await this.prisma.companyProfile.count({ where })
    const fairCompanyCount = await this.prisma.companyProfile.count({ where: { ...where, fairParticipant: true } })
    const jobWhere = { ...PUBLISHED, companyProfile: { is: where } }
    const openJobCount = await this.prisma.job.count({ where: jobWhere })
    const startOfToday = new Date()
    startOfToday.setHours(0, 0, 0, 0)
    const todayNewJobCount = await this.prisma.job.count({ where: { ...jobWhere, syncTime: { gte: startOfToday } } })
    return { companyCount, openJobCount, todayNewJobCount, fairCompanyCount }
  }

  /** 筛选可选项：只来自真实已发布企业（绝不渲染无数据支撑的地区/行业）。 */
  async filtersPublic() {
    const rows = await this.prisma.companyProfile.findMany({
      where: { ...PUBLISHED },
      select: { province: true, city: true, district: true, industry: true, companyType: true, org: { select: { type: true } } },
    })
    const regionMap = new Map<string, Map<string, Set<string>>>()
    const industries = new Set<string>()
    const companyTypes = new Set<string>()
    const sourceKinds = new Set<string>()
    for (const r of rows) {
      if (r.province) {
        const cities = regionMap.get(r.province) ?? new Map<string, Set<string>>()
        if (r.city) {
          const districts = cities.get(r.city) ?? new Set<string>()
          if (r.district) districts.add(r.district)
          cities.set(r.city, districts)
        }
        regionMap.set(r.province, cities)
      }
      if (r.industry) industries.add(r.industry)
      if (r.companyType) companyTypes.add(r.companyType)
      if ((COMPANY_SOURCE_KINDS as readonly string[]).includes(r.org.type)) sourceKinds.add(r.org.type)
    }
    return {
      regions: [...regionMap.entries()].sort(([a], [b]) => a.localeCompare(b, 'zh')).map(([province, cities]) => ({
        province,
        cities: [...cities.entries()].sort(([a], [b]) => a.localeCompare(b, 'zh')).map(([city, districts]) => ({
          city,
          districts: [...districts].sort((a, b) => a.localeCompare(b, 'zh')),
        })),
      })),
      industries: [...industries].sort(),
      companyTypes: [...companyTypes].sort(),
      sourceKinds: [...sourceKinds].sort(),
    }
  }

  /** 企业详情（已发布；右侧指标=开关开启且有真实数据的项，缺项不展示）。 */
  async getPublic(id: string) {
    const c = await this.prisma.companyProfile.findFirst({
      where: { id, ...PUBLISHED },
      include: { _count: { select: { jobs: { where: { ...PUBLISHED } } } } },
    })
    if (!c) {
      throw new NotFoundException({ error: { code: 'COMPANY_NOT_FOUND', message: '企业不存在或未发布' } })
    }
    const metrics: Record<string, unknown> = {}
    if (c.showOpenJobCount) metrics['openJobCount'] = c._count.jobs
    if (c.showCity && c.city) metrics['city'] = c.city
    if (c.showEmployeeScale && c.scale) metrics['employeeScale'] = c.scale
    if (c.showBoothNo && c.boothNo) metrics['boothNo'] = c.boothNo
    return {
      id: c.id,
      name: c.name,
      legalName: c.legalName,
      logoUrl: c.logoUrl,
      coverImageUrl: c.coverImageUrl,
      promoVideoUrl: c.promoVideoUrl,
      description: c.description,
      companyType: c.companyType,
      industry: c.industry,
      honorTags: parseJsonArray(c.honorTagsJson),
      tags: parseJsonArray(c.tagsJson),
      province: c.province,
      city: c.city,
      district: c.district,
      address: c.address,
      fairParticipant: c.fairParticipant,
      metrics,
      sourceName: c.sourceName,
      sourceUrl: c.sourceUrl,
      externalId: c.externalId,
      syncTime: c.syncTime.toISOString(),
      dataSourceNote: `本页仅展示来源机构「${c.sourceName}」提供的信息，本系统不接收简历，不参与招聘流程。`,
    }
  }

  /** 企业在招岗位（仅已发布；行内引导既有岗位详情/来源投递链路）。 */
  async listPublicJobs(companyId: string, page: MemberPageQuery) {
    const company = await this.prisma.companyProfile.findFirst({ where: { id: companyId, ...PUBLISHED }, select: { id: true } })
    if (!company) {
      throw new NotFoundException({ error: { code: 'COMPANY_NOT_FOUND', message: '企业不存在或未发布' } })
    }
    const where = { companyProfileId: companyId, ...PUBLISHED }
    const total = await this.prisma.job.count({ where })
    const rows = await this.prisma.job.findMany({
      where,
      select: {
        id: true, title: true, city: true, salary: true, category: true, tagsJson: true,
        sourceName: true, sourceUrl: true, externalId: true,
      },
      ...memberPageArgs(page),
    })
    return buildMemberPage(rows, page, total, (j) => ({
      id: j.id,
      title: j.title,
      city: j.city,
      salaryDisplay: j.salary?.trim() || '面议',
      category: j.category,
      tags: parseJsonArray(j.tagsJson),
      sourceName: j.sourceName,
      sourceUrl: j.sourceUrl,
      externalId: j.externalId,
    }))
  }

  // ── Admin ─────────────────────────────────────────────────────────────────

  private adminRow(c: {
    id: string; name: string; sourceOrgId: string; sourceName: string; externalId: string
    province: string | null; city: string | null; district: string | null
    industry: string | null; companyType: string | null; fairParticipant: boolean
    reviewStatus: string; publishStatus: string; rejectReason: string | null
    syncTime: Date; updatedAt: Date; _count?: { jobs: number }
  }) {
    return {
      id: c.id, name: c.name, sourceOrgId: c.sourceOrgId, sourceName: c.sourceName, externalId: c.externalId,
      province: c.province, city: c.city, district: c.district,
      industry: c.industry, companyType: c.companyType, fairParticipant: c.fairParticipant,
      reviewStatus: c.reviewStatus, publishStatus: c.publishStatus, rejectReason: c.rejectReason,
      linkedJobCount: c._count?.jobs ?? 0,
      syncTime: c.syncTime.toISOString(), updatedAt: c.updatedAt.toISOString(),
    }
  }

  async adminList(filters: { reviewStatus?: string; publishStatus?: string; keyword?: string }) {
    const where: Record<string, unknown> = {}
    if (filters.reviewStatus) where['reviewStatus'] = filters.reviewStatus
    if (filters.publishStatus) where['publishStatus'] = filters.publishStatus
    if (filters.keyword?.trim()) where['name'] = { contains: filters.keyword.trim() }
    const rows = await this.prisma.companyProfile.findMany({
      where,
      include: { _count: { select: { jobs: true } } },
      orderBy: [{ updatedAt: 'desc' }],
      take: 200,
    })
    return rows.map((c) => this.adminRow(c))
  }

  async adminGet(id: string) {
    const c = await this.prisma.companyProfile.findUnique({
      where: { id },
      include: {
        _count: { select: { jobs: true } },
        jobs: { select: { id: true, title: true, city: true, category: true, reviewStatus: true, publishStatus: true }, take: 100 },
      },
    })
    if (!c) throw new NotFoundException({ error: { code: 'COMPANY_NOT_FOUND', message: '企业不存在' } })
    return {
      ...this.adminRow(c),
      legalName: c.legalName, logoUrl: c.logoUrl, coverImageUrl: c.coverImageUrl, promoVideoUrl: c.promoVideoUrl,
      description: c.description, scale: c.scale, foundedAt: c.foundedAt?.toISOString() ?? null,
      address: c.address, boothNo: c.boothNo, sourceUrl: c.sourceUrl,
      honorTags: parseJsonArray(c.honorTagsJson), tags: parseJsonArray(c.tagsJson),
      showOpenJobCount: c.showOpenJobCount, showCity: c.showCity,
      showEmployeeScale: c.showEmployeeScale, showBoothNo: c.showBoothNo,
      linkedJobs: c.jobs,
    }
  }

  /** 把 DTO 字段映射成 Prisma data（只含出现过的字段）。 */
  private fieldsToData(dto: CompanyFieldsDto & { name?: string }) {
    const data: Record<string, unknown> = {}
    const direct = [
      'name', 'legalName', 'logoUrl', 'coverImageUrl', 'promoVideoUrl', 'description',
      'industry', 'companyType', 'scale', 'province', 'city', 'district', 'address',
      'boothNo', 'fairParticipant', 'sourceUrl',
      'showOpenJobCount', 'showCity', 'showEmployeeScale', 'showBoothNo',
    ] as const
    for (const k of direct) {
      const v = (dto as Record<string, unknown>)[k]
      if (v !== undefined) data[k] = v
    }
    if (dto.foundedAt !== undefined) data['foundedAt'] = new Date(dto.foundedAt)
    if (dto.honorTags !== undefined) data['honorTagsJson'] = JSON.stringify(dto.honorTags)
    if (dto.tags !== undefined) data['tagsJson'] = JSON.stringify(dto.tags)
    // name 为非空列：null（前端清空语义）不允许清掉企业名称
    if (data['name'] === null || data['name'] === '') delete data['name']
    return data
  }

  async adminCreate(dto: AdminCreateCompanyDto, actor: { userId: string }) {
    const org = await this.prisma.organization.findFirst({ where: { id: dto.sourceOrgId, enabled: true } })
    if (!org) {
      throw new BadRequestException({ error: { code: 'COMPANY_ORG_NOT_FOUND', message: '来源机构不存在或已停用' } })
    }
    const created = await this.prisma.companyProfile.create({
      data: {
        sourceOrgId: org.id,
        sourceName: org.name,
        externalId: dto.externalId,
        ...this.fieldsToData(dto),
        name: dto.name,
        reviewStatus: 'pending',
        publishStatus: 'draft',
      },
    })
    await this.audit.write({
      actorId: actor.userId, actorRole: 'admin', action: 'company.create',
      targetType: 'company_profile', targetId: created.id,
      payload: { name: dto.name, sourceOrgId: org.id },
    })
    return this.adminGet(created.id)
  }

  async adminUpdate(id: string, dto: AdminUpdateCompanyDto, actor: { userId: string }) {
    const existing = await this.prisma.companyProfile.findUnique({ where: { id }, select: { id: true } })
    if (!existing) throw new NotFoundException({ error: { code: 'COMPANY_NOT_FOUND', message: '企业不存在' } })
    await this.prisma.companyProfile.update({ where: { id }, data: this.fieldsToData(dto) })
    await this.audit.write({
      actorId: actor.userId, actorRole: 'admin', action: 'company.update',
      targetType: 'company_profile', targetId: id,
      payload: { fields: Object.keys(this.fieldsToData(dto)) },
    })
    return this.adminGet(id)
  }

  async adminReview(id: string, dto: AdminReviewCompanyDto, actor: { userId: string }) {
    const existing = await this.prisma.companyProfile.findUnique({ where: { id }, select: { id: true } })
    if (!existing) throw new NotFoundException({ error: { code: 'COMPANY_NOT_FOUND', message: '企业不存在' } })
    if (dto.action === 'reject' && !dto.rejectReason?.trim()) {
      throw new BadRequestException({ error: { code: 'COMPANY_REJECT_REASON_REQUIRED', message: '拒绝必须填写原因' } })
    }
    const updated = await this.prisma.companyProfile.update({
      where: { id },
      data: dto.action === 'approve'
        ? { reviewStatus: 'approved', reviewedBy: actor.userId, reviewedAt: new Date(), rejectReason: null }
        : { reviewStatus: 'rejected', reviewedBy: actor.userId, reviewedAt: new Date(), rejectReason: dto.rejectReason!.trim(), publishStatus: 'draft' },
    })
    await this.audit.write({
      actorId: actor.userId, actorRole: 'admin', action: 'company.review',
      targetType: 'company_profile', targetId: id,
      payload: { action: dto.action, rejectReason: dto.rejectReason ?? null },
    })
    return this.adminRow({ ...updated, _count: undefined })
  }

  async adminPublish(id: string, dto: AdminPublishCompanyDto, actor: { userId: string }) {
    const existing = await this.prisma.companyProfile.findUnique({ where: { id }, select: { reviewStatus: true } })
    if (!existing) throw new NotFoundException({ error: { code: 'COMPANY_NOT_FOUND', message: '企业不存在' } })
    // 合规红线：未审核通过的企业绝不能发布
    if (dto.publish && existing.reviewStatus !== 'approved') {
      throw new BadRequestException({ error: { code: 'COMPANY_NOT_APPROVED', message: '企业未审核通过，不能发布' } })
    }
    const updated = await this.prisma.companyProfile.update({
      where: { id },
      data: { publishStatus: dto.publish ? 'published' : 'unpublished' },
    })
    await this.audit.write({
      actorId: actor.userId, actorRole: 'admin', action: 'company.publish',
      targetType: 'company_profile', targetId: id,
      payload: { publish: dto.publish },
    })
    return this.adminRow({ ...updated, _count: undefined })
  }

  /** 可关联岗位：同来源机构 + 已审核发布 + 尚未关联到本企业。 */
  async adminLinkableJobs(id: string, keyword?: string) {
    const company = await this.prisma.companyProfile.findUnique({ where: { id }, select: { sourceOrgId: true } })
    if (!company) throw new NotFoundException({ error: { code: 'COMPANY_NOT_FOUND', message: '企业不存在' } })
    return this.prisma.job.findMany({
      where: {
        sourceOrgId: company.sourceOrgId,
        ...PUBLISHED,
        OR: [{ companyProfileId: null }, { companyProfileId: { not: id } }],
        ...(keyword?.trim() ? { title: { contains: keyword.trim() } } : {}),
      },
      select: { id: true, title: true, city: true, category: true, companyProfileId: true },
      take: 50,
      orderBy: [{ syncTime: 'desc' }],
    })
  }

  async adminLinkJobs(id: string, dto: AdminLinkJobsDto, actor: { userId: string }) {
    const company = await this.prisma.companyProfile.findUnique({ where: { id }, select: { sourceOrgId: true } })
    if (!company) throw new NotFoundException({ error: { code: 'COMPANY_NOT_FOUND', message: '企业不存在' } })
    // 只允许关联：同来源机构 + 已审核发布的岗位（合规：不能借关联夹带未审内容）
    const eligible = await this.prisma.job.findMany({
      where: { id: { in: dto.jobIds }, sourceOrgId: company.sourceOrgId, ...PUBLISHED },
      select: { id: true },
    })
    const eligibleIds = eligible.map((j) => j.id)
    const rejected = dto.jobIds.filter((x) => !eligibleIds.includes(x))
    if (eligibleIds.length > 0) {
      await this.prisma.job.updateMany({ where: { id: { in: eligibleIds } }, data: { companyProfileId: id } })
    }
    await this.audit.write({
      actorId: actor.userId, actorRole: 'admin', action: 'company.link_jobs',
      targetType: 'company_profile', targetId: id,
      payload: { linked: eligibleIds, rejected },
    })
    return { linked: eligibleIds.length, rejected }
  }

  async adminUnlinkJob(id: string, jobId: string, actor: { userId: string }) {
    const res = await this.prisma.job.updateMany({
      where: { id: jobId, companyProfileId: id },
      data: { companyProfileId: null },
    })
    if (res.count === 0) throw new NotFoundException({ error: { code: 'COMPANY_JOB_NOT_LINKED', message: '该岗位未关联本企业' } })
    await this.audit.write({
      actorId: actor.userId, actorRole: 'admin', action: 'company.unlink_job',
      targetType: 'company_profile', targetId: id,
      payload: { jobId },
    })
    return { unlinked: true }
  }

  // ── Partner（来源机构维护本机构数据；不是企业 HR 后台）─────────────────────

  async partnerList(orgId: string) {
    const rows = await this.prisma.companyProfile.findMany({
      where: { sourceOrgId: orgId },
      include: { _count: { select: { jobs: true } } },
      orderBy: [{ updatedAt: 'desc' }],
      take: 200,
    })
    return rows.map((c) => this.adminRow(c))
  }

  /** 按本机构岗位 externalId 关联岗位（跨机构 externalId 自然查不到，天然隔离）。 */
  private async linkOwnJobsByExternalIds(orgId: string, companyId: string, jobExternalIds: string[] | undefined) {
    if (!jobExternalIds || jobExternalIds.length === 0) return
    await this.prisma.job.updateMany({
      where: { sourceOrgId: orgId, externalId: { in: jobExternalIds } },
      data: { companyProfileId: companyId },
    })
  }

  async partnerImport(orgId: string, dto: PartnerImportCompaniesDto, actor: { userId: string }) {
    const org = await this.prisma.organization.findFirst({ where: { id: orgId, enabled: true } })
    if (!org) {
      throw new BadRequestException({ error: { code: 'COMPANY_ORG_DISABLED', message: '机构不存在或已被停用' } })
    }
    const existingRows = await this.prisma.companyProfile.findMany({
      where: { sourceOrgId: orgId, externalId: { in: dto.items.map((i) => i.externalId) } },
      select: { externalId: true },
    })
    const existingIds = new Set(existingRows.map((r) => r.externalId))
    let created = 0
    let updated = 0
    for (const item of dto.items) {
      const data = {
        ...this.fieldsToData(item),
        name: item.name,
        sourceName: org.name,
        // 导入/更新一律回 pending + draft 强制重审（与 1C 岗位编辑同口径）
        reviewStatus: 'pending',
        publishStatus: 'draft',
        rejectReason: null,
        syncTime: new Date(),
      }
      const row = await this.prisma.companyProfile.upsert({
        where: { sourceOrgId_externalId: { sourceOrgId: orgId, externalId: item.externalId } },
        create: { sourceOrgId: orgId, externalId: item.externalId, ...data },
        update: data,
      })
      if (existingIds.has(item.externalId)) updated += 1
      else created += 1
      await this.linkOwnJobsByExternalIds(orgId, row.id, item.jobExternalIds)
    }
    await this.audit.write({
      actorId: actor.userId, actorRole: 'partner', action: 'company.import',
      targetType: 'company_profile', targetId: null,
      payload: { orgId, total: dto.items.length, created, updated },
    })
    return { total: dto.items.length, created, updated }
  }

  async partnerUpdate(orgId: string, id: string, dto: PartnerUpdateCompanyDto, actor: { userId: string }) {
    const existing = await this.prisma.companyProfile.findFirst({ where: { id, sourceOrgId: orgId }, select: { id: true } })
    // 跨机构 / 不存在统一 404，不泄露存在性
    if (!existing) throw new NotFoundException({ error: { code: 'COMPANY_NOT_FOUND', message: '企业不存在' } })
    await this.prisma.companyProfile.update({
      where: { id },
      data: {
        ...this.fieldsToData(dto),
        // 编辑强制回 pending + draft 重审
        reviewStatus: 'pending',
        publishStatus: 'draft',
        rejectReason: null,
      },
    })
    await this.linkOwnJobsByExternalIds(orgId, id, dto.jobExternalIds)
    await this.audit.write({
      actorId: actor.userId, actorRole: 'partner', action: 'company.update',
      targetType: 'company_profile', targetId: id,
      payload: { orgId, fields: Object.keys(this.fieldsToData(dto)) },
    })
    return this.partnerList(orgId).then((list) => list.find((x) => x.id === id))
  }
}
