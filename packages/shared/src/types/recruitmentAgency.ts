import type { PublishStatus, ReviewStatus } from './job'
import type { RecruitmentPublicationReadiness } from './recruitmentDirectory'

export type QualificationType =
  | 'business_license'
  | 'hr_service_license'
  | 'labor_dispatch_permit'
  | 'public_service_authority'
  | 'school_authority'
  | 'organizer_authorization'

export type QualificationStatus = 'pending' | 'valid' | 'expired' | 'revoked' | 'rejected'
export type OfflineAgencyBranchStatus = 'active' | 'suspended' | 'closed'

export interface QualificationRecordAdminView {
  id: string
  organizationId: string
  qualificationType: QualificationType | string
  /** 管理页只回显掩码，完整证号和证据文件不进入通用列表日志。 */
  licenseNumberMasked: string | null
  issuerName: string | null
  jurisdiction: string | null
  appliesToBranchId: string | null
  validFrom: string | null
  validUntil: string | null
  status: QualificationStatus | string
  contentVersion: number
  contentHash: string | null
  approvedContentHash: string | null
  hashAlgorithmVersion: string | null
  verificationSource: string | null
  verifiedBy: string | null
  verifiedAt: string | null
  rejectReason: string | null
  evidenceAvailable: boolean
  archivedAt: string | null
  createdAt: string
  updatedAt: string
  effectiveValid: boolean
}

export interface OfflineAgencyBranchAdminView {
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
  status: OfflineAgencyBranchStatus
  reviewStatus: ReviewStatus
  publishStatus: PublishStatus
  contentVersion: number
  contentHash: string | null
  approvedContentHash: string | null
  hashAlgorithmVersion: string | null
  lastVerifiedAt: string | null
  archivedAt: string | null
  createdAt: string
  updatedAt: string
  /** 仅表示门店自身状态；机构/主体/资质依赖由 Profile.publicationReadiness 汇总。 */
  localPublicationReadiness: RecruitmentPublicationReadiness
}

export interface OfflineAgencyProfileAdminView {
  id: string
  organizationId: string
  organizationName: string
  organizationType: string
  organizationContentTrustStatus: string | null
  displayName: string
  description: string | null
  serviceScope: string[]
  reviewStatus: ReviewStatus
  publishStatus: PublishStatus
  contentVersion: number
  contentHash: string | null
  approvedContentHash: string | null
  hashAlgorithmVersion: string | null
  archivedAt: string | null
  createdAt: string
  updatedAt: string
  branches: OfflineAgencyBranchAdminView[]
  qualifications: QualificationRecordAdminView[]
  publicationReadiness: RecruitmentPublicationReadiness
}

export interface OfflineAgencyProfileListResponse {
  items: OfflineAgencyProfileAdminView[]
  total: number
  page: number
  pageSize: number
}

export interface QualificationRecordListResponse {
  items: QualificationRecordAdminView[]
  total: number
  page: number
  pageSize: number
}

export interface QualificationEvidenceAccessResponse {
  fileId: string
  url: string
  expiresAt: string
}
