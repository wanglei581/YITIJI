export const END_USER_STATUSES = ['active', 'disabled', 'closing', 'anonymized'] as const
export type EndUserStatus = (typeof END_USER_STATUSES)[number]

export const MEMBER_STEP_UP_ACTIONS = [
  'export_data_request',
  'export_data_download',
  'close_account',
] as const
export type MemberStepUpAction = (typeof MEMBER_STEP_UP_ACTIONS)[number]

export const MEMBER_DATA_REQUEST_TYPES = ['export', 'delete', 'revoke_consent'] as const
export type MemberDataRequestType = (typeof MEMBER_DATA_REQUEST_TYPES)[number]

export const MEMBER_DATA_REQUEST_STATUSES = [
  'pending',
  'handling',
  'ready',
  'completed',
  'expired',
  'failed',
  'rejected',
  'cancelled',
] as const
export type MemberDataRequestStatus = (typeof MEMBER_DATA_REQUEST_STATUSES)[number]
