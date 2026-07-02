// ============================================================
// 浏览 / 外部跳转记录类型（P1 闭环）。
//
// 合规红线（compliance-boundary §4.4）：系统只记录「浏览」和「打开来源平台
// 入口」两类本人行为；不记录、不建模第三方平台上的投递结果 / 预约结果 /
// 企业处理 / 录取通知 / 签到入场等任何流程状态。
// ============================================================

export const ACTIVITY_TARGET_TYPES = ['job', 'job_fair', 'policy', 'company_profile', 'fair_company'] as const
export type ActivityTargetType = (typeof ACTIVITY_TARGET_TYPES)[number]

/**
 * 外部跳转动作（只描述「打开了哪类入口」，不描述办理结果）：
 * - external_apply        岗位 / 参展企业：去来源平台投递 / 扫码投递
 * - external_appointment  招聘会：去来源平台预约 / 扫码预约
 * - external_checkin_open 招聘会：扫码前往来源平台签到，仅记录打开入口
 * - external_open         政策：打开官方入口 / 企业：打开来源平台页
 *
 * 每类 target 只允许其对应动作，杜绝「岗位 + external_appointment」之类的脏数据。
 */
export const JUMP_ACTIONS_BY_TARGET: Record<ActivityTargetType, readonly ActivityJumpAction[]> = {
  job: ['external_apply'],
  job_fair: ['external_appointment', 'external_checkin_open'],
  policy: ['external_open'],
  company_profile: ['external_open'],
  fair_company: ['external_apply'],
}
export type ActivityJumpAction = 'external_apply' | 'external_appointment' | 'external_checkin_open' | 'external_open'

/** 列表项（仅安全元数据：目标快照 + 时间；无任何状态字段）。 */
export interface MemberBrowseLogItem {
  id: string
  targetType: ActivityTargetType
  targetId: string
  targetTitle: string | null
  sourceName: string | null
  sourceUrl: string | null
  externalId: string | null
  createdAt: string
}

export interface MemberJumpLogItem extends MemberBrowseLogItem {
  action: ActivityJumpAction
}
