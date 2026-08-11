/**
 * API 本地契约副本。
 * SSOT: packages/shared/src/types/recruitmentDirectory.ts 与 recruitmentAgency.ts。
 * services/api 为 CJS，不直接加载 shared 的 ESM TypeScript 入口。
 */
export interface PublicationReadiness {
  ready: boolean
  blockers: string[]
}

export interface DirectoryAdminView {
  id: string
  organizationId: string | null
  organizationName: string | null
  name: string
  slug: string
  category: string | null
  neutralDescription: string | null
  officialDomains: string[]
  landingUrl: string
  operatorLegalName: string
  logoFileId: string | null
  evidenceFileId: string | null
  displayOrder: number
  status: string
  reviewStatus: string
  publishStatus: string
  contentVersion: number
  contentHash: string | null
  approvedContentHash: string | null
  hashAlgorithmVersion: string | null
  linkCheckStatus: string
  lastLinkCheckedAt: string | null
  lastLinkCheckError: string | null
  validFrom: string | null
  validUntil: string | null
  archivedAt: string | null
  createdAt: string
  updatedAt: string
  publicationReadiness: PublicationReadiness
}

export interface QualificationAdminView {
  id: string
  organizationId: string
  qualificationType: string
  licenseNumberMasked: string | null
  issuerName: string | null
  jurisdiction: string | null
  appliesToBranchId: string | null
  validFrom: string | null
  validUntil: string | null
  status: string
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

export interface BranchAdminView {
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
  lastVerifiedAt: string | null
  archivedAt: string | null
  createdAt: string
  updatedAt: string
  /** 仅门店自身状态；不代表父机构及资质已满足公开门禁。 */
  localPublicationReadiness: PublicationReadiness
}

export interface AgencyProfileAdminView {
  id: string
  organizationId: string
  organizationName: string
  organizationType: string
  organizationContentTrustStatus: string | null
  displayName: string
  description: string | null
  serviceScope: string[]
  reviewStatus: string
  publishStatus: string
  contentVersion: number
  contentHash: string | null
  approvedContentHash: string | null
  hashAlgorithmVersion: string | null
  archivedAt: string | null
  createdAt: string
  updatedAt: string
  branches: BranchAdminView[]
  qualifications: QualificationAdminView[]
  publicationReadiness: PublicationReadiness
}

export interface PageResult<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

export interface EvidenceAccessResponse {
  fileId: string
  url: string
  expiresAt: string
}
