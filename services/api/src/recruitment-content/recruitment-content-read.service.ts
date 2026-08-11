import { Injectable, NotFoundException } from '@nestjs/common'
import type { AuthedUser } from '../common/decorators/current-user.decorator'
import { AuditService } from '../audit/audit.service'
import { FilesService } from '../files/files.service'
import { PrismaService } from '../prisma/prisma.service'
import type {
  AgencyProfileAdminView,
  BranchAdminView,
  DirectoryAdminView,
  EvidenceAccessResponse,
  PageResult,
  QualificationAdminView,
} from './recruitment-content.types'
import type {
  AgencyProfileListQueryDto,
  DirectoryListQueryDto,
  QualificationListQueryDto,
} from './dto/admin-recruitment-content-query.dto'
import {
  EVIDENCE_FILE_SELECT,
  contentBlockers,
  isUsableEvidence,
  iso,
  maskLicenseNumber,
  parseDomainPolicy,
  parseStringArrayPolicy,
  readiness,
  requiredQualificationTypes,
  validateLandingUrl,
  type EvidenceFileShape,
} from './recruitment-content-readiness'

interface RequestAuditContext {
  ipAddress: string | null
  userAgent: string | null
  requestId: string | null
}

interface QualificationShape {
  id: string
  organizationId: string
  qualificationType: string
  licenseNumber: string | null
  issuerName: string | null
  jurisdiction: string | null
  appliesToBranchId: string | null
  validFrom: Date | null
  validUntil: Date | null
  status: string
  contentVersion: number
  contentHash: string | null
  approvedContentHash: string | null
  hashAlgorithmVersion: string | null
  evidenceFileId: string | null
  evidenceFile: EvidenceFileShape | null
  verificationSource: string | null
  verifiedBy: string | null
  verifiedAt: Date | null
  rejectReason: string | null
  archivedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

interface BranchShape {
  id: string
  agencyProfileId: string
  branchName: string
  provinceCode: string | null
  cityCode: string | null
  districtCode: string | null
  address: string
  lat: number | null
  lng: number | null
  geoSource: string | null
  serviceHours: string | null
  serviceHoursSource: string | null
  publicPhone: string | null
  website: string | null
  status: string
  reviewStatus: string
  publishStatus: string
  contentVersion: number
  contentHash: string | null
  approvedContentHash: string | null
  hashAlgorithmVersion: string | null
  lastVerifiedAt: Date | null
  archivedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

@Injectable()
export class RecruitmentContentReadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
    private readonly audit: AuditService,
  ) {}

  async listDirectories(query: DirectoryListQueryDto): Promise<PageResult<DirectoryAdminView>> {
    const where: {
      reviewStatus?: string
      publishStatus?: string
      linkCheckStatus?: string
      organizationId?: string
    } = {}
    if (query.reviewStatus) where.reviewStatus = query.reviewStatus
    if (query.publishStatus) where.publishStatus = query.publishStatus
    if (query.linkCheckStatus) where.linkCheckStatus = query.linkCheckStatus
    if (query.organizationId) where.organizationId = query.organizationId
    const [rows, total] = await Promise.all([
      this.prisma.onlinePlatformDirectory.findMany({
        where,
        include: { organization: { select: { name: true, contentTrustStatus: true, archivedAt: true } } },
        orderBy: [{ displayOrder: 'asc' }, { createdAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.onlinePlatformDirectory.count({ where }),
    ])
    return { items: rows.map((row) => this.toDirectory(row)), total, page: query.page, pageSize: query.pageSize }
  }

  async getDirectory(id: string): Promise<DirectoryAdminView> {
    const row = await this.prisma.onlinePlatformDirectory.findUnique({
      where: { id },
      include: { organization: { select: { name: true, contentTrustStatus: true, archivedAt: true } } },
    })
    if (!row) this.notFound('RECRUITMENT_DIRECTORY_NOT_FOUND', '平台目录不存在')
    return this.toDirectory(row)
  }

  async listAgencyProfiles(query: AgencyProfileListQueryDto): Promise<PageResult<AgencyProfileAdminView>> {
    const where: { reviewStatus?: string; publishStatus?: string; organizationId?: string } = {}
    if (query.reviewStatus) where.reviewStatus = query.reviewStatus
    if (query.publishStatus) where.publishStatus = query.publishStatus
    if (query.organizationId) where.organizationId = query.organizationId
    const include = {
      organization: {
        select: {
          name: true,
          type: true,
          contentTrustStatus: true,
          archivedAt: true,
          qualificationRecords: {
            include: { evidenceFile: { select: EVIDENCE_FILE_SELECT } },
            orderBy: { createdAt: 'desc' as const },
          },
        },
      },
      branches: { orderBy: { createdAt: 'asc' as const } },
    }
    const [rows, total] = await Promise.all([
      this.prisma.offlineAgencyProfile.findMany({
        where,
        include,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.offlineAgencyProfile.count({ where }),
    ])
    return { items: rows.map((row) => this.toAgencyProfile(row)), total, page: query.page, pageSize: query.pageSize }
  }

  async getAgencyProfile(id: string): Promise<AgencyProfileAdminView> {
    const row = await this.prisma.offlineAgencyProfile.findUnique({
      where: { id },
      include: {
        organization: {
          select: {
            name: true,
            type: true,
            contentTrustStatus: true,
            archivedAt: true,
            qualificationRecords: {
              include: { evidenceFile: { select: EVIDENCE_FILE_SELECT } },
              orderBy: { createdAt: 'desc' },
            },
          },
        },
        branches: { orderBy: { createdAt: 'asc' } },
      },
    })
    if (!row) this.notFound('RECRUITMENT_AGENCY_NOT_FOUND', '机构资料不存在')
    return this.toAgencyProfile(row)
  }

  async getAgencyBranch(profileId: string, branchId: string): Promise<BranchAdminView> {
    const row = await this.prisma.offlineAgencyBranch.findFirst({
      where: { id: branchId, agencyProfileId: profileId },
    })
    if (!row) this.notFound('RECRUITMENT_BRANCH_NOT_FOUND', '门店不存在')
    return this.toBranch(row)
  }

  async listQualifications(
    organizationId: string,
    query: QualificationListQueryDto,
  ): Promise<PageResult<QualificationAdminView>> {
    await this.requireOrganization(organizationId)
    const where: { organizationId: string; status?: string; qualificationType?: string } = { organizationId }
    if (query.status) where.status = query.status
    if (query.qualificationType) where.qualificationType = query.qualificationType
    const [rows, total] = await Promise.all([
      this.prisma.qualificationRecord.findMany({
        where,
        include: { evidenceFile: { select: EVIDENCE_FILE_SELECT } },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.qualificationRecord.count({ where }),
    ])
    return { items: rows.map((row) => this.toQualification(row)), total, page: query.page, pageSize: query.pageSize }
  }

  async getQualification(organizationId: string, id: string): Promise<QualificationAdminView> {
    const row = await this.requireQualification(organizationId, id)
    return this.toQualification(row)
  }

  async getQualificationEvidence(
    organizationId: string,
    qualificationId: string,
    user: AuthedUser,
    context: RequestAuditContext,
  ): Promise<EvidenceAccessResponse> {
    const qualification = await this.prisma.qualificationRecord.findFirst({
      where: { id: qualificationId, organizationId },
      include: { evidenceFile: true },
    })
    const file = qualification?.evidenceFile
    if (!qualification || !file || !isUsableEvidence(file)) {
      this.notFound('QUALIFICATION_EVIDENCE_NOT_FOUND', '资质证据不存在或不可访问')
    }
    const access = await this.files.getAccessUrl(file.id, {
      kind: 'user', userId: user.userId, role: user.role, orgId: user.orgId,
    }, 'inline')
    await this.prisma.$transaction((tx) => this.audit.writeRequired(tx, {
      actorId: user.userId,
      actorRole: user.role,
      action: 'recruitment.qualification_evidence_access',
      targetType: 'file_object',
      targetId: file.id,
      payload: {
        qualificationId: qualification.id,
        purpose: 'qualification_evidence',
        disposition: 'inline',
      },
      ...context,
    }))
    return { fileId: file.id, url: access.response.url, expiresAt: access.response.expiresAt }
  }

  private async requireOrganization(id: string): Promise<void> {
    const row = await this.prisma.organization.findUnique({ where: { id }, select: { id: true } })
    if (!row) this.notFound('RECRUITMENT_ORGANIZATION_NOT_FOUND', '机构不存在')
  }

  private async requireQualification(organizationId: string, id: string): Promise<QualificationShape> {
    const row = await this.prisma.qualificationRecord.findFirst({
      where: { id, organizationId },
      include: { evidenceFile: { select: EVIDENCE_FILE_SELECT } },
    })
    if (!row) this.notFound('RECRUITMENT_QUALIFICATION_NOT_FOUND', '资质记录不存在')
    return row
  }

  private toDirectory(row: {
    id: string; organizationId: string | null
    organization: { name: string; contentTrustStatus: string | null; archivedAt: Date | null } | null
    name: string; slug: string; category: string | null; neutralDescription: string | null
    officialDomainsJson: string; landingUrl: string; operatorLegalName: string; logoFileId: string | null
    evidenceFileId: string | null; displayOrder: number; status: string; reviewStatus: string; publishStatus: string
    contentVersion: number; contentHash: string | null; approvedContentHash: string | null; hashAlgorithmVersion: string | null
    linkCheckStatus: string; lastLinkCheckedAt: Date | null; lastLinkCheckError: string | null
    validFrom: Date | null; validUntil: Date | null; archivedAt: Date | null; createdAt: Date; updatedAt: Date
  }): DirectoryAdminView {
    const domainPolicy = parseDomainPolicy(row.officialDomainsJson)
    const blockers = contentBlockers(row)
    if (row.validFrom && row.validFrom.getTime() > Date.now()) blockers.push('outside_validity_window')
    if (row.validUntil && row.validUntil.getTime() <= Date.now()) blockers.push('outside_validity_window')
    if (row.organization && (row.organization.contentTrustStatus !== 'active' || row.organization.archivedAt)) {
      blockers.push('organization_trust_not_active')
    }
    if (!domainPolicy.valid) blockers.push('official_domains_invalid')
    const landing = validateLandingUrl(row.landingUrl, domainPolicy.domains)
    if (!landing.validUrl) blockers.push('landing_url_invalid')
    else if (!landing.allowedDomain) blockers.push('landing_domain_not_allowed')
    if (row.linkCheckStatus !== 'valid') blockers.push('link_check_not_valid')
    return {
      id: row.id, organizationId: row.organizationId, organizationName: row.organization?.name ?? null,
      name: row.name, slug: row.slug, category: row.category, neutralDescription: row.neutralDescription,
      officialDomains: domainPolicy.domains, landingUrl: row.landingUrl, operatorLegalName: row.operatorLegalName,
      logoFileId: row.logoFileId, evidenceFileId: row.evidenceFileId, displayOrder: row.displayOrder,
      status: row.status, reviewStatus: row.reviewStatus, publishStatus: row.publishStatus,
      contentVersion: row.contentVersion, contentHash: row.contentHash, approvedContentHash: row.approvedContentHash,
      hashAlgorithmVersion: row.hashAlgorithmVersion, linkCheckStatus: row.linkCheckStatus,
      lastLinkCheckedAt: iso(row.lastLinkCheckedAt), lastLinkCheckError: row.lastLinkCheckError,
      validFrom: iso(row.validFrom), validUntil: iso(row.validUntil), archivedAt: iso(row.archivedAt),
      createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
      publicationReadiness: readiness(blockers),
    }
  }

  private toAgencyProfile(row: {
    id: string; organizationId: string; displayName: string; description: string | null; serviceScopeJson: string
    reviewStatus: string; publishStatus: string; contentVersion: number; contentHash: string | null
    approvedContentHash: string | null; hashAlgorithmVersion: string | null; archivedAt: Date | null
    createdAt: Date; updatedAt: Date
    organization: {
      name: string; type: string; contentTrustStatus: string | null; archivedAt: Date | null
      qualificationRecords: QualificationShape[]
    }
    branches: BranchShape[]
  }): AgencyProfileAdminView {
    const serviceScopePolicy = parseStringArrayPolicy(row.serviceScopeJson)
    const serviceScope = serviceScopePolicy.values
    const branches = row.branches.map((branch) => this.toBranch(branch))
    const qualifications = row.organization.qualificationRecords.map((item) => this.toQualification(item))
    const blockers = contentBlockers(row)
    if (row.organization.contentTrustStatus !== 'active' || row.organization.archivedAt) {
      blockers.push('organization_trust_not_active')
    }
    if (!serviceScopePolicy.valid) blockers.push('service_scope_invalid')
    const publishableBranches = branches.filter((branch) => branch.localPublicationReadiness.ready)
    if (publishableBranches.length === 0) blockers.push('active_branch_missing')
    const required = requiredQualificationTypes(row.organization.type, serviceScope)
    if (!required) blockers.push('organization_type_not_eligible')
    else if (!publishableBranches.some((branch) => required.every((type) => qualifications.some((item) =>
      item.qualificationType === type
      && item.effectiveValid
      && (item.appliesToBranchId === null || item.appliesToBranchId === branch.id))))) {
      blockers.push('required_qualification_missing')
    }
    return {
      id: row.id, organizationId: row.organizationId, organizationName: row.organization.name,
      organizationType: row.organization.type, organizationContentTrustStatus: row.organization.contentTrustStatus,
      displayName: row.displayName, description: row.description, serviceScope,
      reviewStatus: row.reviewStatus, publishStatus: row.publishStatus, contentVersion: row.contentVersion,
      contentHash: row.contentHash, approvedContentHash: row.approvedContentHash,
      hashAlgorithmVersion: row.hashAlgorithmVersion, archivedAt: iso(row.archivedAt),
      createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), branches, qualifications,
      publicationReadiness: readiness(blockers),
    }
  }

  private toBranch(row: BranchShape): BranchAdminView {
    const blockers = contentBlockers(row)
    return {
      id: row.id, agencyProfileId: row.agencyProfileId, branchName: row.branchName,
      provinceCode: row.provinceCode, cityCode: row.cityCode, districtCode: row.districtCode,
      address: row.address, lat: row.lat, lng: row.lng, geoSource: row.geoSource,
      serviceHours: row.serviceHours, serviceHoursSource: row.serviceHoursSource,
      publicPhone: row.publicPhone, website: row.website, status: row.status,
      reviewStatus: row.reviewStatus, publishStatus: row.publishStatus, contentVersion: row.contentVersion,
      contentHash: row.contentHash, approvedContentHash: row.approvedContentHash,
      hashAlgorithmVersion: row.hashAlgorithmVersion, lastVerifiedAt: iso(row.lastVerifiedAt),
      archivedAt: iso(row.archivedAt), createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
      localPublicationReadiness: readiness(blockers),
    }
  }

  private toQualification(row: QualificationShape): QualificationAdminView {
    const effectiveValid = row.status === 'valid' && !row.archivedAt
      && Boolean(row.contentHash) && row.contentHash === row.approvedContentHash
      && Boolean(row.hashAlgorithmVersion)
      && isUsableEvidence(row.evidenceFile)
      && Boolean(row.issuerName?.trim())
      && Boolean(row.jurisdiction?.trim())
      && Boolean(row.verificationSource?.trim())
      && Boolean(row.verifiedBy?.trim())
      && Boolean(row.verifiedAt)
      && (!row.validFrom || row.validFrom.getTime() <= Date.now())
      && (!row.validUntil || row.validUntil.getTime() > Date.now())
    return {
      id: row.id, organizationId: row.organizationId, qualificationType: row.qualificationType,
      licenseNumberMasked: maskLicenseNumber(row.licenseNumber), issuerName: row.issuerName,
      jurisdiction: row.jurisdiction, appliesToBranchId: row.appliesToBranchId,
      validFrom: iso(row.validFrom), validUntil: iso(row.validUntil), status: row.status,
      contentVersion: row.contentVersion, contentHash: row.contentHash, approvedContentHash: row.approvedContentHash,
      hashAlgorithmVersion: row.hashAlgorithmVersion, verificationSource: row.verificationSource,
      verifiedBy: row.verifiedBy, verifiedAt: iso(row.verifiedAt), rejectReason: row.rejectReason,
      evidenceAvailable: isUsableEvidence(row.evidenceFile), archivedAt: iso(row.archivedAt),
      createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), effectiveValid,
    }
  }

  private notFound(code: string, message: string): never {
    throw new NotFoundException({ error: { code, message } })
  }
}
