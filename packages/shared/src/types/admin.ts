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
