// ============================================================
// Admin 线下机构「治理档案」只读 Service
//
// 后端域：/admin/recruitment-content/*（Wave 1B，只读，无任何 mutation 端点）
// 与 offlineAgenciesAdmin.ts（/admin/offline-agencies/*）是**两套不同的数据模型**：
//
//   legacy   OfflineAgency          ← offlineAgenciesAdmin.ts 增删改查的对象
//   governance OfflineAgencyProfile ← 本文件读取的对象（挂在 Organization 下）
//
// 两者在 Prisma schema 里**没有外键**（schema.prisma 2465 行附近注释：
// 「本波只增加不可见的数据结构；不切换现有读写，不回填 legacy 状态」）。
// 唯一可用的桥是 legacy 侧可空、无外键的 `OfflineAgency.sourceOrgId`，
// 它在 offline-agencies.service.ts 的发布闸门里被当作 Organization.id 使用
// （assertOrgContentTrustActive(prisma, agency.sourceOrgId)）。
//
// 因此调用方必须处理「这条 legacy 机构根本没有来源机构」这一状态，
// 它既不是「没有资质」也不是「拉取失败」。见 GovernanceDrawer.tsx 的状态机。
//
// ── 合规：资质材料取证只有一条门 ──────────────────────────────────────────
// CLAUDE.md §11「管理员访问文件必须记录日志」。
// 后端 recruitment-content-read.service.ts 的做法是：
//   1. 列表/详情视图**不返回** evidenceFileId，只返回 evidenceAvailable: boolean，
//      前端拿不到 fileId，构造不出任何绕过用的文件 URL；
//   2. 只有 GET .../qualifications/:id/evidence-access 会签发 URL，且它在
//      $transaction 里用 audit.writeRequired 写 'recruitment.qualification_evidence_access'
//      审计——审计写失败会整体回滚，URL 发不出去（fail-closed）。
//      对照：通用的 GET /files/:id/url 用的是 audit.write，吞掉审计异常照样返回 URL
//      （fail-open），而且只记 targetType='file'，不带 qualificationId 上下文。
// 结论：**任何时候要给管理员看资质材料，必须现调 evidence-access，一次查看一次请求。**
// 不缓存返回的 url 复用，不在抽屉打开时预取（会给没真正看过的材料留下审计记录）。
// ============================================================

import { API_BASE_URL, API_MODE, ApiHttpError } from './client'
import { authHeader, redirectToLogin } from '../auth'

// ─── 类型（逐字对齐 services/api/src/recruitment-content/recruitment-content.types.ts）──

export interface PublicationReadiness {
  ready: boolean
  blockers: string[]
}

export interface QualificationAdminView {
  id: string
  organizationId: string
  qualificationType: string
  /** 后端已脱敏，前端拿不到完整证照号。 */
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
  /** 只是「有一份当前可用的证据文件」，不含 fileId，也不含内容。 */
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
  /** 注意是 items，不是 legacy offline-agencies 的 data。 */
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

export interface QualificationListFilters {
  status?: string
  qualificationType?: string
  page?: number
  pageSize?: number
}

/**
 * 刻意只封装 4 条端点。后端另有 4 条同域端点没有接进来，理由如下，改动前先看这里：
 *
 * - `GET agency-profiles/:profileId`
 * - `GET agency-profiles/:profileId/branches/:branchId`
 *   `OfflineAgencyProfile.organizationId` 是 `@unique`，按 organizationId 过滤的列表
 *   必然只返回那一条，且后端 include 已把 branches 与 qualifications 整体内联返回
 *   （见 recruitment-content-read.service.ts listAgencyProfiles 的 include）。
 *   再按主键取一次拿到的是逐字节相同的数据，纯属多余请求，故不接。
 *
 * - `GET platform-directories`
 * - `GET platform-directories/:id`
 *   对象是 OnlinePlatformDirectory（线上招聘平台目录：landingUrl / officialDomains /
 *   linkCheckStatus），与线下机构不是同一类对象，两者只是各自挂在 Organization 下的兄弟，
 *   没有主从关系。放进「线下机构管理」页会造成语义错位，应另择归属页面。
 */
export interface OfflineAgencyGovernanceServiceInterface {
  /** 按来源机构找治理档案。机构存在但没建档 → items 为空数组（不是 404）。 */
  listProfilesByOrganization(organizationId: string): Promise<PageResult<AgencyProfileAdminView>>
  /** 机构不存在 → 404 RECRUITMENT_ORGANIZATION_NOT_FOUND（≠ 该机构没有资质）。 */
  listQualifications(organizationId: string, filters?: QualificationListFilters): Promise<PageResult<QualificationAdminView>>
  /** 单条权威读取：用于列表快照与 evidence-access 结果自相矛盾时重新对账。 */
  getQualification(organizationId: string, qualificationId: string): Promise<QualificationAdminView>
  /** 唯一会留下 recruitment.qualification_evidence_access 审计的取证路径。 */
  getQualificationEvidence(organizationId: string, qualificationId: string): Promise<EvidenceAccessResponse>
}

/** 后端 requireOrganization 抛的错误码：sourceOrgId 指向的机构不存在。 */
export const ORGANIZATION_NOT_FOUND_CODE = 'RECRUITMENT_ORGANIZATION_NOT_FOUND'
/** 资质证据缺失/过期/被删/可见性不对时 evidence-access 的错误码。 */
export const EVIDENCE_NOT_FOUND_CODE = 'QUALIFICATION_EVIDENCE_NOT_FOUND'

export const QUALIFICATION_TYPE_LABELS: Record<string, string> = {
  business_license: '营业执照',
  hr_service_license: '人力资源服务许可证',
  labor_dispatch_permit: '劳务派遣经营许可证',
  public_service_authority: '公共就业服务机构授权',
  organizer_authorization: '主办方授权文件',
}

export const QUALIFICATION_STATUS_LABELS: Record<string, string> = {
  pending: '待核验',
  valid: '有效',
  expired: '已过期',
  revoked: '已吊销',
  rejected: '已驳回',
}

/** 后端 recruitment-content-readiness.ts contentBlockers() 产出的全部取值。 */
export const BLOCKER_LABELS: Record<string, string> = {
  archived: '已归档',
  inactive: '状态非 active',
  review_not_approved: '审核未通过',
  publish_not_published: '未发布',
  content_hash_missing: '缺内容哈希',
  approved_hash_mismatch: '内容已改动，与审核通过版本不一致',
  hash_algorithm_missing: '缺哈希算法版本',
  organization_trust_not_active: '来源机构内容信任状态非 active',
  service_scope_invalid: '服务范围 JSON 非法',
  active_branch_missing: '没有任何可公开的网点',
  organization_type_not_eligible: '机构类型不在可公开名单内',
  required_qualification_missing: '缺少必备资质',
  official_domains_invalid: '官方域名配置非法',
  landing_url_invalid: '落地页 URL 非法',
  landing_domain_not_allowed: '落地页域名不在官方域名内',
  link_check_not_valid: '链接可用性校验未通过',
  outside_validity_window: '不在有效期内',
}

// ─── HTTP adapter ─────────────────────────────────────────────────────────────

const BASE = '/admin/recruitment-content'

async function parseError(res: Response): Promise<never> {
  let code = `HTTP_${res.status}`
  let message = res.statusText
  try {
    const body = (await res.json()) as {
      error?: { code?: string; message?: string; details?: string[] }
      message?: string | string[]
    }
    if (body.error?.code) code = body.error.code
    if (body.error?.message) message = body.error.message
    else if (typeof body.message === 'string') message = body.message
    else if (Array.isArray(body.message) && body.message.length > 0) message = body.message.join('；')
    if (body.error?.details?.length) message = `${message}：${body.error.details.join('；')}`
  } catch { /* keep defaults */ }
  if (res.status === 401) {
    redirectToLogin()
    throw new ApiHttpError(code || 'AUTH_REQUIRED', '登录已过期', res.status)
  }
  throw new ApiHttpError(code, message, res.status)
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'GET',
    headers: { Accept: 'application/json', ...authHeader() },
    credentials: 'include',
  })
  if (!res.ok) await parseError(res)
  const json = (await res.json()) as { success: boolean; data: T }
  return json.data
}

// 后端 ValidationPipe 开了 forbidNonWhitelisted（verify-recruitment-content-http.ts
// 断言 ?unknown=1 → 400 VALIDATION_FAILED），所以这里只允许拼 DTO 声明过的字段。
function qs(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value))
  }
  const text = search.toString()
  return text ? `?${text}` : ''
}

const httpAdapter: OfflineAgencyGovernanceServiceInterface = {
  listProfilesByOrganization: (organizationId) =>
    get(`${BASE}/agency-profiles${qs({ organizationId, page: 1, pageSize: 20 })}`),
  listQualifications: (organizationId, filters = {}) =>
    get(`${BASE}/organizations/${encodeURIComponent(organizationId)}/qualifications${qs({
      status: filters.status,
      qualificationType: filters.qualificationType,
      page: filters.page ?? 1,
      pageSize: filters.pageSize ?? 50,
    })}`),
  getQualification: (organizationId, qualificationId) =>
    get(`${BASE}/organizations/${encodeURIComponent(organizationId)}/qualifications/${encodeURIComponent(qualificationId)}`),
  getQualificationEvidence: (organizationId, qualificationId) =>
    get(`${BASE}/organizations/${encodeURIComponent(organizationId)}/qualifications/${encodeURIComponent(qualificationId)}/evidence-access`),
}

// ─── Mock adapter ─────────────────────────────────────────────────────────────
//
// mock 只为让「有资质 / 无资质 / 机构不存在 / 接口失败」四种界面表现可被人工点到，
// 不代表真实链路通。真实校验必须在 VITE_API_MODE=http + 真后端下重跑。
// organizationId 前缀决定走哪条剧本，见 MOCK_ORG_SCRIPTS。

export const MOCK_ORG_SCRIPTS = {
  full: 'mock-org-full',
  noQualification: 'mock-org-empty',
  noProfile: 'mock-org-noprofile',
  missing: 'mock-org-missing',
  unstable: 'mock-org-unstable',
} as const

/** mock 下 createAgency 轮流分配，保证四种状态都能点到；null 表示后台自录无来源机构。 */
export const MOCK_SOURCE_ORG_ROTATION: Array<string | null> = [
  MOCK_ORG_SCRIPTS.full,
  MOCK_ORG_SCRIPTS.noQualification,
  MOCK_ORG_SCRIPTS.missing,
  MOCK_ORG_SCRIPTS.unstable,
  null,
  MOCK_ORG_SCRIPTS.noProfile,
]

const MOCK_NOW = '2026-09-01T00:00:00.000Z'

function mockQualification(
  organizationId: string,
  over: Partial<QualificationAdminView> & { id: string; qualificationType: string },
): QualificationAdminView {
  return {
    organizationId,
    licenseNumberMasked: null,
    issuerName: null,
    jurisdiction: null,
    appliesToBranchId: null,
    validFrom: null,
    validUntil: null,
    status: 'valid',
    contentVersion: 1,
    contentHash: 'mockhash',
    approvedContentHash: 'mockhash',
    hashAlgorithmVersion: 'v1',
    verificationSource: null,
    verifiedBy: null,
    verifiedAt: null,
    rejectReason: null,
    evidenceAvailable: false,
    archivedAt: null,
    createdAt: MOCK_NOW,
    updatedAt: MOCK_NOW,
    effectiveValid: false,
    ...over,
  }
}

/** 列表里写着 evidenceAvailable=true，但 evidence-access 会 404 —— 用来演示对账路径。 */
const MOCK_STALE_EVIDENCE_ID = 'mock-qual-stale'

const mockQualificationsByOrg: Record<string, QualificationAdminView[]> = {
  [MOCK_ORG_SCRIPTS.full]: [
    mockQualification(MOCK_ORG_SCRIPTS.full, {
      id: 'mock-qual-business',
      qualificationType: 'business_license',
      licenseNumberMasked: '91************78',
      issuerName: '上海市市场监督管理局',
      jurisdiction: '310000',
      verificationSource: 'admin_manual',
      verifiedBy: 'admin-mock',
      verifiedAt: MOCK_NOW,
      evidenceAvailable: true,
      effectiveValid: true,
    }),
    mockQualification(MOCK_ORG_SCRIPTS.full, {
      id: MOCK_STALE_EVIDENCE_ID,
      qualificationType: 'hr_service_license',
      licenseNumberMasked: 'HR********56',
      issuerName: '上海市人力资源和社会保障局',
      jurisdiction: '310000',
      verificationSource: 'admin_manual',
      verifiedBy: 'admin-mock',
      verifiedAt: MOCK_NOW,
      evidenceAvailable: true,
      effectiveValid: true,
    }),
    mockQualification(MOCK_ORG_SCRIPTS.full, {
      id: 'mock-qual-dispatch',
      qualificationType: 'labor_dispatch_permit',
      status: 'expired',
      validUntil: '2026-01-01T00:00:00.000Z',
      issuerName: '上海市人力资源和社会保障局',
      evidenceAvailable: false,
      effectiveValid: false,
    }),
  ],
  [MOCK_ORG_SCRIPTS.noQualification]: [],
  [MOCK_ORG_SCRIPTS.noProfile]: [
    mockQualification(MOCK_ORG_SCRIPTS.noProfile, {
      id: 'mock-qual-orphan',
      qualificationType: 'business_license',
      licenseNumberMasked: '91************01',
      issuerName: '北京市市场监督管理局',
      evidenceAvailable: false,
      effectiveValid: false,
    }),
  ],
}

function mockBranch(over: Partial<BranchAdminView> & { id: string; branchName: string; address: string }): BranchAdminView {
  return {
    agencyProfileId: 'mock-profile-full',
    provinceCode: null, cityCode: null, districtCode: null,
    lat: null, lng: null, geoSource: null,
    serviceHours: null, serviceHoursSource: null,
    publicPhone: null, website: null,
    status: 'active', reviewStatus: 'approved', publishStatus: 'published',
    contentVersion: 1, contentHash: 'mockhash', approvedContentHash: 'mockhash', hashAlgorithmVersion: 'v1',
    lastVerifiedAt: MOCK_NOW, archivedAt: null, createdAt: MOCK_NOW, updatedAt: MOCK_NOW,
    localPublicationReadiness: { ready: true, blockers: [] },
    ...over,
  }
}

const mockProfilesByOrg: Record<string, AgencyProfileAdminView> = {
  [MOCK_ORG_SCRIPTS.full]: {
    id: 'mock-profile-full',
    organizationId: MOCK_ORG_SCRIPTS.full,
    organizationName: '示例人力资源服务有限公司',
    organizationType: 'licensed_hr_agency',
    organizationContentTrustStatus: 'active',
    displayName: '示例人力资源服务有限公司',
    description: 'mock 数据，仅用于界面状态验证。',
    serviceScope: ['recruitment_service', 'labor_dispatch'],
    reviewStatus: 'approved', publishStatus: 'published',
    contentVersion: 1, contentHash: 'mockhash', approvedContentHash: 'mockhash', hashAlgorithmVersion: 'v1',
    archivedAt: null, createdAt: MOCK_NOW, updatedAt: MOCK_NOW,
    branches: [
      mockBranch({ id: 'mock-branch-a', branchName: '徐汇门店', address: '上海市徐汇区示例路 1 号',
        serviceHours: '09:00-18:00', serviceHoursSource: 'onsite_verified', publicPhone: '021-00000000' }),
      mockBranch({ id: 'mock-branch-b', branchName: '浦东门店', address: '上海市浦东新区示例路 2 号',
        status: 'suspended', reviewStatus: 'pending', publishStatus: 'draft',
        localPublicationReadiness: { ready: false, blockers: ['inactive', 'review_not_approved', 'publish_not_published'] } }),
    ],
    qualifications: mockQualificationsByOrg[MOCK_ORG_SCRIPTS.full] ?? [],
    publicationReadiness: { ready: false, blockers: ['required_qualification_missing'] },
  },
  [MOCK_ORG_SCRIPTS.noQualification]: {
    id: 'mock-profile-empty',
    organizationId: MOCK_ORG_SCRIPTS.noQualification,
    organizationName: '未上传资质的示例机构',
    organizationType: 'licensed_hr_agency',
    organizationContentTrustStatus: null,
    displayName: '未上传资质的示例机构',
    description: null,
    serviceScope: ['recruitment_service'],
    reviewStatus: 'pending', publishStatus: 'draft',
    contentVersion: 1, contentHash: null, approvedContentHash: null, hashAlgorithmVersion: null,
    archivedAt: null, createdAt: MOCK_NOW, updatedAt: MOCK_NOW,
    branches: [],
    qualifications: [],
    publicationReadiness: {
      ready: false,
      blockers: ['review_not_approved', 'publish_not_published', 'content_hash_missing',
        'hash_algorithm_missing', 'organization_trust_not_active', 'active_branch_missing'],
    },
  },
}

function mockPage<T>(items: T[]): PageResult<T> {
  return { items, total: items.length, page: 1, pageSize: 50 }
}

async function mockGuard(organizationId: string): Promise<void> {
  await Promise.resolve()
  if (organizationId === MOCK_ORG_SCRIPTS.unstable) {
    throw new ApiHttpError('HTTP_503', 'mock：治理档案服务暂时不可用', 503)
  }
  if (organizationId === MOCK_ORG_SCRIPTS.missing) {
    throw new ApiHttpError(ORGANIZATION_NOT_FOUND_CODE, '机构不存在', 404)
  }
}

const mockAdapter: OfflineAgencyGovernanceServiceInterface = {
  async listProfilesByOrganization(organizationId) {
    // 真后端 listAgencyProfiles 不做 requireOrganization：机构不存在也只是空列表。
    // 这里同样不抛 404，让「机构不存在」的判定统一由资质端点给出。
    if (organizationId === MOCK_ORG_SCRIPTS.unstable) {
      throw new ApiHttpError('HTTP_503', 'mock：治理档案服务暂时不可用', 503)
    }
    await Promise.resolve()
    const profile = mockProfilesByOrg[organizationId]
    return mockPage(profile ? [profile] : [])
  },
  async listQualifications(organizationId) {
    await mockGuard(organizationId)
    return mockPage(mockQualificationsByOrg[organizationId] ?? [])
  },
  async getQualification(organizationId, qualificationId) {
    await mockGuard(organizationId)
    const found = (mockQualificationsByOrg[organizationId] ?? []).find((item) => item.id === qualificationId)
    if (!found) throw new ApiHttpError('RECRUITMENT_QUALIFICATION_NOT_FOUND', '资质记录不存在', 404)
    // 陈旧证据剧本：单条权威读取给出与列表快照相反的 evidenceAvailable。
    if (qualificationId === MOCK_STALE_EVIDENCE_ID) return { ...found, evidenceAvailable: false }
    return found
  },
  async getQualificationEvidence(organizationId, qualificationId) {
    await mockGuard(organizationId)
    const found = (mockQualificationsByOrg[organizationId] ?? []).find((item) => item.id === qualificationId)
    if (!found || !found.evidenceAvailable || qualificationId === MOCK_STALE_EVIDENCE_ID) {
      throw new ApiHttpError(EVIDENCE_NOT_FOUND_CODE, '资质证据不存在或不可访问', 404)
    }
    return {
      fileId: `mock-file-${qualificationId}`,
      url: `about:blank#mock-evidence-${qualificationId}`,
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    }
  },
}

// ─── Facade ───────────────────────────────────────────────────────────────────

export const offlineAgencyGovernanceService: OfflineAgencyGovernanceServiceInterface =
  API_MODE === 'http' ? httpAdapter : mockAdapter
