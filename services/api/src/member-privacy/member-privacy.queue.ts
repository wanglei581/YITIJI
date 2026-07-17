export const MEMBER_PRIVACY_QUEUE = 'member-privacy'
export const MEMBER_EXPORT_JOB = 'member.export'
export const MEMBER_EXPORT_RECONCILE_JOB = 'member.export.reconcile'

export interface MemberExportJobData {
  requestId: string
  executionVersion: number
}

export interface MemberExportReconcileJobData {
  requestId?: string
  reason: 'delivery_finished' | 'periodic_sweep' | 'admin_retry'
  executionVersion?: number
}

export type MemberPrivacyJobData = MemberExportJobData | MemberExportReconcileJobData
