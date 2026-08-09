import type { PublishStatus, ReviewStatus } from './job'

/** 统一招聘信息治理对象的发布阻塞码。后台按码展示原因，不据此绕过服务端门禁。 */
export type RecruitmentPublicationBlocker =
  | 'archived'
  | 'inactive'
  | 'review_not_approved'
  | 'publish_not_published'
  | 'content_hash_missing'
  | 'hash_algorithm_missing'
  | 'approved_hash_mismatch'
  | 'outside_validity_window'
  | 'organization_trust_not_active'
  | 'organization_type_not_eligible'
  | 'service_scope_invalid'
  | 'landing_url_invalid'
  | 'official_domains_invalid'
  | 'landing_domain_not_allowed'
  | 'link_check_not_valid'
  | 'active_branch_missing'
  | 'required_qualification_missing'
  | 'qualification_not_valid'

export interface RecruitmentPublicationReadiness {
  ready: boolean
  blockers: RecruitmentPublicationBlocker[]
}

export type OnlinePlatformDirectoryStatus = 'active' | 'inactive'
export type PlatformLinkCheckStatus = 'pending' | 'valid' | 'invalid' | 'error'

/** Admin 只读目录投影；不包含接入端点、凭证、Webhook 或字段映射。 */
export interface OnlinePlatformDirectoryAdminView {
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
  status: OnlinePlatformDirectoryStatus
  reviewStatus: ReviewStatus
  publishStatus: PublishStatus
  contentVersion: number
  contentHash: string | null
  approvedContentHash: string | null
  hashAlgorithmVersion: string | null
  linkCheckStatus: PlatformLinkCheckStatus
  lastLinkCheckedAt: string | null
  lastLinkCheckError: string | null
  validFrom: string | null
  validUntil: string | null
  archivedAt: string | null
  createdAt: string
  updatedAt: string
  publicationReadiness: RecruitmentPublicationReadiness
}

export interface OnlinePlatformDirectoryListResponse {
  items: OnlinePlatformDirectoryAdminView[]
  total: number
  page: number
  pageSize: number
}
