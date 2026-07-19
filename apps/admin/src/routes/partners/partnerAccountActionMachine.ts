export type PartnerAccountAction = 'delete_account' | 'rebind_phone'
export type PartnerAccountVerificationMethod = 'sms' | 'password'

export type PartnerAccountActionStep =
  | 'closed'
  | 'confirm'
  | 'confirm_rebind'
  | 'choose_method'
  | 'admin_reauth'
  | 'sms_verify'
  | 'password_verify'
  | 'delete_ready'
  | 'new_phone_input'
  | 'new_phone_sms_verify'
  | 'delete_committing'
  | 'rebind_committing'
  | 'result_uncertain'
  | 'success'

export type PartnerAccountActionErrorCode =
  | 'ADMIN_REAUTH_REQUIRED'
  | 'ADMIN_CREDENTIAL_INVALID'
  | 'ADMIN_CREDENTIAL_LOCKED'
  | 'ACCOUNT_ACTION_STEP_UP_REQUIRED'
  | 'ACCOUNT_ACTION_CHALLENGE_UNAVAILABLE'
  | 'ACCOUNT_ACTION_TICKET_STALE'
  | 'ACCOUNT_COMMIT_CONFLICT'
  | 'ACCOUNT_ACTION_METHOD_UNAVAILABLE'
  | 'ACCOUNT_PASSWORD_PROOF_NOT_READY'
  | 'ACCOUNT_CREDENTIAL_INVALID'
  | 'ACCOUNT_CREDENTIAL_LOCKED'
  | 'PHONE_TAKEN'
  | 'LAST_ACTIVE_PARTNER_ACCOUNT_REQUIRED'
  | 'ACCOUNT_NOT_FOUND'
  | (string & {})

export interface PartnerAccountActionState {
  step: PartnerAccountActionStep
  action?: PartnerAccountAction
  targetAccountId?: string
  verifyMethod?: PartnerAccountVerificationMethod
  challengeId?: string
  actionTicket?: string
  rebindTicket?: string
  busy: boolean
  needsRefresh: boolean
  resultUncertain: boolean
  errorCode?: PartnerAccountActionErrorCode
}

export type PartnerAccountActionEvent =
  | { type: 'OPEN'; action: PartnerAccountAction; targetAccountId: string }
  | { type: 'CLOSE' }
  | { type: 'CONFIRM' }
  | { type: 'SWITCH_ACTION'; action: PartnerAccountAction }
  | { type: 'CHOOSE_METHOD'; method: PartnerAccountVerificationMethod }
  | { type: 'ADMIN_REAUTH_REQUIRED' }
  | { type: 'ADMIN_REAUTHENTICATED' }
  | { type: 'CHALLENGE_CREATED'; challengeId: string }
  | { type: 'CREDENTIAL_VERIFIED'; actionTicket: string }
  | { type: 'PHONE_REBIND_STARTED'; rebindTicket: string }
  | { type: 'COMMIT_DELETE' }
  | { type: 'COMMIT_REBIND' }
  | { type: 'REQUEST_STARTED' }
  | { type: 'REQUEST_FINISHED' }
  | { type: 'EXPIRED'; resource: 'challenge' | 'action_ticket' | 'rebind_ticket' }
  | { type: 'ERROR'; code: PartnerAccountActionErrorCode }
  | { type: 'FINAL_RESULT_UNCERTAIN' }
  | { type: 'SUCCESS' }

export const initialPartnerAccountActionState: PartnerAccountActionState = Object.freeze({
  step: 'closed',
  busy: false,
  needsRefresh: false,
  resultUncertain: false,
})

const RESPONSE_EVENTS = new Set<PartnerAccountActionEvent['type']>([
  'REQUEST_FINISHED',
  'ADMIN_REAUTH_REQUIRED',
  'ADMIN_REAUTHENTICATED',
  'CHALLENGE_CREATED',
  'CREDENTIAL_VERIFIED',
  'PHONE_REBIND_STARTED',
  'ERROR',
  'FINAL_RESULT_UNCERTAIN',
  'SUCCESS',
])

const RESTART_AUTH_ERRORS = new Set<PartnerAccountActionErrorCode>([
  'ACCOUNT_CREDENTIAL_LOCKED',
  'ADMIN_CREDENTIAL_LOCKED',
  'ACCOUNT_ACTION_STEP_UP_REQUIRED',
])

function startStep(action: PartnerAccountAction): PartnerAccountActionStep {
  return action === 'delete_account' ? 'confirm' : 'confirm_rebind'
}

function verificationStep(method: PartnerAccountVerificationMethod): PartnerAccountActionStep {
  return method === 'sms' ? 'sms_verify' : 'password_verify'
}

function operationStart(state: PartnerAccountActionState, needsRefresh = false): PartnerAccountActionState {
  if (!state.action || !state.targetAccountId) return initialPartnerAccountActionState
  return {
    step: startStep(state.action),
    action: state.action,
    targetAccountId: state.targetAccountId,
    busy: false,
    needsRefresh,
    resultUncertain: false,
  }
}

function clearAuthorization(
  state: PartnerAccountActionState,
  patch: Partial<PartnerAccountActionState>,
): PartnerAccountActionState {
  return {
    step: state.step,
    action: state.action,
    targetAccountId: state.targetAccountId,
    busy: false,
    needsRefresh: false,
    resultUncertain: false,
    ...patch,
    verifyMethod: patch.verifyMethod,
    challengeId: undefined,
    actionTicket: undefined,
    rebindTicket: undefined,
    errorCode: patch.errorCode,
  }
}

function reduceError(
  state: PartnerAccountActionState,
  code: PartnerAccountActionErrorCode,
): PartnerAccountActionState {
  if (code === 'ACCOUNT_CREDENTIAL_INVALID' && state.step === 'rebind_committing') {
    return { ...state, step: 'new_phone_sms_verify', busy: false, errorCode: code }
  }

  if (code === 'ACCOUNT_CREDENTIAL_INVALID' || code === 'ADMIN_CREDENTIAL_INVALID') {
    return { ...state, busy: false, errorCode: code }
  }

  if (code.startsWith('SMS_')) {
    if (state.step === 'new_phone_input') return { ...operationStart(state), errorCode: code }
    if (state.step === 'sms_verify') {
      return clearAuthorization(state, { step: 'choose_method', errorCode: code })
    }
    return { ...state, busy: false, errorCode: code }
  }

  if (code === 'ACCOUNT_COMMIT_CONFLICT' && state.step === 'delete_committing' && state.actionTicket) {
    return { ...state, step: 'delete_ready', busy: false, errorCode: code }
  }

  if (code === 'ACCOUNT_ACTION_METHOD_UNAVAILABLE' || code === 'ACCOUNT_PASSWORD_PROOF_NOT_READY') {
    return clearAuthorization(state, { step: 'choose_method', errorCode: code })
  }

  if (code === 'PHONE_TAKEN') {
    return { ...operationStart(state, true), errorCode: code }
  }

  if (
    code === 'ACCOUNT_ACTION_TICKET_STALE' ||
    code === 'ACCOUNT_ACTION_CHALLENGE_UNAVAILABLE' ||
    code === 'ACCOUNT_NOT_FOUND' ||
    code === 'LAST_ACTIVE_PARTNER_ACCOUNT_REQUIRED'
  ) {
    return { ...operationStart(state, true), errorCode: code }
  }

  if (RESTART_AUTH_ERRORS.has(code)) {
    return { ...operationStart(state), errorCode: code }
  }

  return { ...state, busy: false, errorCode: code }
}

export function shouldExpirePartnerAccountResource(
  state: Readonly<PartnerAccountActionState>,
  ticket: string | undefined,
  deadline: number,
  nowMs: number,
): boolean {
  return !state.busy && Boolean(ticket) && deadline !== 0 && deadline <= nowMs
}

export function reducePartnerAccountAction(
  state: Readonly<PartnerAccountActionState>,
  event: Readonly<PartnerAccountActionEvent>,
): PartnerAccountActionState {
  if (state.busy && !RESPONSE_EVENTS.has(event.type)) return state

  switch (event.type) {
    case 'OPEN':
      return {
        step: startStep(event.action),
        action: event.action,
        targetAccountId: event.targetAccountId,
        busy: false,
        needsRefresh: false,
        resultUncertain: false,
      }
    case 'CLOSE':
      return initialPartnerAccountActionState
    case 'CONFIRM':
      if (state.step !== 'confirm' && state.step !== 'confirm_rebind') return state
      return { ...state, step: 'choose_method', errorCode: undefined }
    case 'SWITCH_ACTION':
      if (!state.targetAccountId) return state
      return {
        step: startStep(event.action),
        action: event.action,
        targetAccountId: state.targetAccountId,
        busy: false,
        needsRefresh: false,
        resultUncertain: false,
      }
    case 'CHOOSE_METHOD':
      if (!state.action || !state.targetAccountId || state.step === 'closed' || state.step === 'result_uncertain') {
        return state
      }
      return clearAuthorization(state, {
        step: verificationStep(event.method),
        verifyMethod: event.method,
      })
    case 'ADMIN_REAUTH_REQUIRED':
      if (state.step !== 'sms_verify' && state.step !== 'password_verify') return state
      return { ...state, step: 'admin_reauth', busy: false, errorCode: undefined }
    case 'ADMIN_REAUTHENTICATED':
      if (state.step !== 'admin_reauth' || !state.verifyMethod) return state
      return { ...state, step: verificationStep(state.verifyMethod), busy: false, errorCode: undefined }
    case 'CHALLENGE_CREATED':
      if (state.step !== 'sms_verify' && state.step !== 'password_verify') return state
      return { ...state, challengeId: event.challengeId, busy: false, errorCode: undefined }
    case 'CREDENTIAL_VERIFIED':
      if (state.step !== 'sms_verify' && state.step !== 'password_verify') return state
      return {
        ...state,
        step: state.action === 'delete_account' ? 'delete_ready' : 'new_phone_input',
        challengeId: undefined,
        actionTicket: event.actionTicket,
        busy: false,
        errorCode: undefined,
      }
    case 'PHONE_REBIND_STARTED':
      if (state.step !== 'new_phone_input' || state.action !== 'rebind_phone' || !state.actionTicket) return state
      return {
        ...state,
        step: 'new_phone_sms_verify',
        actionTicket: undefined,
        rebindTicket: event.rebindTicket,
        busy: false,
        errorCode: undefined,
      }
    case 'COMMIT_DELETE':
      if (state.step !== 'delete_ready' || state.action !== 'delete_account' || !state.actionTicket) return state
      return { ...state, step: 'delete_committing', busy: true, errorCode: undefined }
    case 'COMMIT_REBIND':
      if (state.step !== 'new_phone_sms_verify' || state.action !== 'rebind_phone' || !state.rebindTicket) return state
      return { ...state, step: 'rebind_committing', busy: true, errorCode: undefined }
    case 'REQUEST_STARTED':
      return { ...state, busy: true, errorCode: undefined }
    case 'REQUEST_FINISHED':
      return { ...state, busy: false }
    case 'EXPIRED':
      if (event.resource === 'rebind_ticket' && state.action !== 'rebind_phone') return state
      return operationStart(state)
    case 'ERROR':
      return reduceError(state as PartnerAccountActionState, event.code)
    case 'FINAL_RESULT_UNCERTAIN':
      if (state.step !== 'delete_committing' && state.step !== 'rebind_committing') return state
      return clearAuthorization(state as PartnerAccountActionState, {
        step: 'result_uncertain',
        needsRefresh: true,
        resultUncertain: true,
      })
    case 'SUCCESS':
      if (state.step === 'closed') return state
      return clearAuthorization(state as PartnerAccountActionState, { step: 'success' })
  }
}
