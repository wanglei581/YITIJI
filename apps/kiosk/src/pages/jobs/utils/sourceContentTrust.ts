import {
  ORG_CONTENT_TRUST_STATUSES,
  type OrgContentTrustStatus,
} from '@ai-job-print/shared'

/**
 * 一体机岗位详情用来源机构核验状态的展示文案。
 * 不得把发布闸门的 active 说成岗位本身已经验真。
 */
export const KIOSK_SOURCE_ORG_TRUST_LABELS: Record<OrgContentTrustStatus, string> = {
  pending: '待核验',
  active: '已通过发布核验',
  suspended: '核验已暂停',
  revoked: '核验已撤销',
}

export const SOURCE_ORG_TRUST_UNSET_LABEL = '未标记'
export const SOURCE_ORG_TRUST_UNAVAILABLE_LABEL = '未能读取来源机构核验状态'
export const SOURCE_ORG_TRUST_UNKNOWN_LABEL = '未能识别的核验状态'
export const SOURCE_ORG_TRUST_DISCLAIMER =
  '来源核验只说明该机构是否被允许在本系统发布信息，不构成本平台对该岗位真实性的背书。'

export function describeSourceOrgTrust(
  status: string | null | undefined,
): { label: string; known: boolean } {
  if (status === undefined) {
    return { label: SOURCE_ORG_TRUST_UNAVAILABLE_LABEL, known: false }
  }
  if (status === null || status.trim() === '') {
    return { label: SOURCE_ORG_TRUST_UNSET_LABEL, known: true }
  }
  if ((ORG_CONTENT_TRUST_STATUSES as readonly string[]).includes(status)) {
    return {
      label: KIOSK_SOURCE_ORG_TRUST_LABELS[status as OrgContentTrustStatus],
      known: true,
    }
  }
  return { label: SOURCE_ORG_TRUST_UNKNOWN_LABEL, known: false }
}
