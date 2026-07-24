import type { ActivityJumpAction, ActivityTargetType } from '@ai-job-print/shared'

export const TYPE_LABEL: Record<ActivityTargetType, string> = {
  job: '岗位',
  job_fair: '招聘会',
  policy: '政策',
  company_profile: '企业',
  fair_company: '参展企业',
}

const ACTION_LABEL: Record<ActivityJumpAction, string> = {
  external_apply: '岗位来源入口',
  external_appointment: '招聘会来源入口',
  external_checkin_open: '招聘会签到来源入口',
  external_open: '官方入口',
}

export function detailRoute(
  targetType: ActivityTargetType,
  targetId: string,
  externalId?: string | null,
): string {
  switch (targetType) {
    case 'job':
      return `/jobs/${targetId}`
    case 'job_fair':
      return `/job-fairs/${targetId}`
    case 'company_profile':
      return `/companies/${targetId}`
    case 'fair_company':
      return externalId ? `/job-fairs/${externalId}/companies/${targetId}` : '/job-fairs'
    default:
      return '/renshi'
  }
}

export function actionLabel(action: ActivityJumpAction, targetType: ActivityTargetType): string {
  if (action === 'external_apply' && targetType === 'fair_company') return '参展企业来源入口'
  if (action === 'external_apply') return '岗位来源入口'
  return ACTION_LABEL[action]
}
