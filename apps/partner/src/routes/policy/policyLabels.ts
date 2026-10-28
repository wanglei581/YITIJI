import { PARTNER_TYPE_LABELS } from '@ai-job-print/shared'

export const KIND_LABELS: Record<string, string> = { policy_guide: '政策扶持', notice: '政策公告' }
export const AUDIENCE_LABELS: Record<string, string> = {
  graduate: '应届高校毕业生', flexible: '灵活就业人员', migrant: '返乡务工人员', hardship: '困难群体就业援助', startup: '创业扶持', general: '通用',
}
export const CATEGORY_LABELS: Record<string, string> = {
  policy: '政策', announcement: '公告', notice: '通知', recruitment: '招募',
}

/** 与服务端 canManagePolicies 为 true 的机构类型一致，文案用各端共用的中文标签。 */
const POLICY_PUBLISHER_LABELS = [
  PARTNER_TYPE_LABELS.public_employment_service,
  PARTNER_TYPE_LABELS.school_employment_center,
  PARTNER_TYPE_LABELS.gig_worker_home,
  PARTNER_TYPE_LABELS.employment_service_station,
]

export const CANNOT_CREATE_HINT = `政策内容属官方性质，仅${POLICY_PUBLISHER_LABELS.join('、')}可发布。本机构不能新增，只能处理已有内容（查看、审核发布、下架）。`

export const RECRUITMENT_POLICY_BLOCKED_REASON = '本平台未开放招聘类内容，招募类公告不能再提审或发布，可以下架或删除'

