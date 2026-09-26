import {
  RECRUITMENT_EMERGENCY_NOTE_MAX,
  type RecruitmentEmergencyReasonCode,
  type RecruitmentEmergencyTargetType,
} from '@ai-job-print/shared'

/** 要紧急下架的那一条内容。title / orgName 只用于弹窗里让人看清对象，不提交。 */
export interface EmergencyTakedownTarget {
  targetType: RecruitmentEmergencyTargetType
  targetId: string
  title: string
  orgName?: string
}

export interface EmergencyReasonValue {
  reasonCode: RecruitmentEmergencyReasonCode | ''
  reasonText: string
}

export const EMPTY_EMERGENCY_REASON: EmergencyReasonValue = { reasonCode: '', reasonText: '' }

/** 事由码与说明都必填；说明去掉首尾空白后不能为空，长度不超过服务端上限（@MaxLength(200)）。 */
export function emergencyReasonComplete(value: EmergencyReasonValue): value is {
  reasonCode: RecruitmentEmergencyReasonCode
  reasonText: string
} {
  const text = value.reasonText.trim()
  return value.reasonCode !== '' && text.length > 0 && text.length <= RECRUITMENT_EMERGENCY_NOTE_MAX
}
