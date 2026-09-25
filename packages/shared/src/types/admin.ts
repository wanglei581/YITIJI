/**
 * Admin 审核 / 发布动作的契约类型。
 *
 * Phase #4 下沉到 shared 包,前后端共用,杜绝 admin app
 * http adapter 用 `any` 顶上的债务。
 *
 * 后端的 class-validator DTO(services/api/src/jobs/dto/*)实现
 * 这些 interface 即可,验证装饰器只在后端落地。
 */

/**
 * 审核动作:
 *   - reviewing:placeholder 状态,标记"审核中"(可选)
 *   - approve:通过 → reviewStatus = approved,publishStatus 重置为 draft
 *   - reject:拒绝 → reviewStatus = rejected;若曾发布,publishStatus 强制 draft
 *
 * 终态(approved / rejected)禁止回退到 pending,
 * 需要 reopen 走独立接口(本阶段不实现)。
 */
export type ReviewAction = 'reviewing' | 'approve' | 'reject'

export interface ReviewActionPayload {
  action: ReviewAction
  /** reject 时必填(后端校验),approve / reviewing 可不传 */
  reason?: string
}

/**
 * 发布动作:
 *   - publish:发布 → publishStatus = published
 *     **前置条件:reviewStatus 必须为 approved**(合规红线)
 *   - unpublish:下架 → publishStatus = unpublished,不动 reviewStatus
 */
export type PublishAction = 'publish' | 'unpublish'

export interface PublishActionPayload {
  action: PublishAction
}

/**
 * `GET /api/v1/admin/system/recruitment-hosting` 的 `data`。
 *
 * 信封是 `{ success: true, data }`。`enabled` 与 `deploymentEnabled` 都等于
 * 部署开关，不看请求参数。管理员招聘类页面用它决定只留查看与紧急下架。
 */
export interface AdminRecruitmentHostingStatus {
  recruitmentHosting: {
    enabled: boolean
    deploymentEnabled: boolean
  }
}

// ============================================================
// 招聘类内容紧急下架与熔断（3.13）
//
// 契约源是服务端 services/api/src/recruitment-hosting/：
//   POST /admin/recruitment-emergency/takedown       单条紧急下架
//   POST /admin/recruitment-emergency/circuit-break  按机构 / 按来源熔断
//   GET  /partner/org-notices                        机构读取下架 / 熔断通知
// services/api 是 CommonJS、本包是 ESM，服务端保留自己的副本（EMERGENCY_REASON_CODES），
// 两边任一改动必须同步。
//
// 语义：单向。只能下架，不能恢复；必选事由并填写说明；自动通知所属机构。
// 不提供按筛选条件的日常批量下架，只保留按机构或按来源整体熔断。
// 这三个接口返回裸对象（不套 ApiResponse），前端解包时两种形状都要接受。
// ============================================================

export type RecruitmentEmergencyReasonCode =
  | 'illegal_content'
  | 'false_information'
  | 'rights_complaint'
  | 'authority_order'
  | 'other'

/** 事由码的中文名，顺序即下拉顺序。 */
export const RECRUITMENT_EMERGENCY_REASON_LABELS: Readonly<Record<RecruitmentEmergencyReasonCode, string>> = {
  illegal_content: '违法违规内容',
  false_information: '虚假或误导信息',
  rights_complaint: '权利人投诉',
  authority_order: '主管部门要求',
  other: '其他（须在说明中写清）',
}

/** 说明的长度上限，与服务端 DTO 的 @MaxLength(200) 一致。 */
export const RECRUITMENT_EMERGENCY_NOTE_MAX = 200

export type RecruitmentEmergencyTargetType =
  | 'job'
  | 'job_fair'
  | 'company'
  | 'policy'
  | 'fair_material'
  | 'offline_agency'

export const RECRUITMENT_EMERGENCY_TARGET_LABELS: Readonly<Record<RecruitmentEmergencyTargetType, string>> = {
  job: '岗位',
  job_fair: '招聘会',
  company: '企业资料',
  policy: '政策',
  fair_material: '招聘会资料',
  offline_agency: '线下机构',
}

export interface RecruitmentEmergencyTakedownInput {
  targetType: RecruitmentEmergencyTargetType
  targetId: string
  reasonCode: RecruitmentEmergencyReasonCode
  reasonText: string
}

/** 服务端单条下架的返回。 */
export interface RecruitmentEmergencyTakedownResult {
  targetType: RecruitmentEmergencyTargetType
  targetId: string
  publishStatus: string
  irreversible: boolean
}

export type RecruitmentCircuitBreakScope = 'org' | 'source'

export interface RecruitmentCircuitBreakInput {
  scope: RecruitmentCircuitBreakScope
  id: string
  reasonCode: RecruitmentEmergencyReasonCode
  reasonText: string
}

/** 服务端熔断的返回。`unpublished` 是本次一并下架并锁定的内容条数。 */
export interface RecruitmentCircuitBreakResult {
  scope: RecruitmentCircuitBreakScope
  id: string
  unpublished: number
  irreversible: boolean
}

/** `GET /partner/org-notices` 的单条通知。 */
export interface PartnerOrgNotice {
  id: string
  kind: string
  title: string
  body: string
  /** 服务端存的 JSON 字符串（targetType / targetId / reasonCode / mode），前端按需解析。 */
  payloadJson: string
  readAt: string | null
  createdAt: string
}

/**
 * `GET /partner/org-notices` 的响应（裸对象）。服务端只回最新 50 条，
 * `truncated` 为 true 时页面必须如实写出 `total`，不能把这一页当成全部。
 */
export interface PartnerOrgNoticeList {
  items: PartnerOrgNotice[]
  total: number
  truncated: boolean
}
