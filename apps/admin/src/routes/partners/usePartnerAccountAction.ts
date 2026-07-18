import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { ApiHttpError } from '../../services/api/client'
import {
  orgsAdminService,
  type AdminOrgAccount,
  type PartnerAccountAction,
  type PartnerAccountVerificationMethod,
} from '../../services/api/orgsAdmin'
import {
  initialPartnerAccountActionState,
  reducePartnerAccountAction,
  type PartnerAccountActionState,
} from './partnerAccountActionMachine'

type DeadlineKind = 'challenge' | 'action_ticket' | 'rebind_ticket'

export interface UsePartnerAccountActionResult {
  state: PartnerAccountActionState
  account: AdminOrgAccount | null
  organizationName: string
  phoneMasked: string | null
  nowMs: number
  challengeDeadline: number
  actionTicketDeadline: number
  rebindTicketDeadline: number
  resendAvailableAt: number
  statusMessage: string
  triggerElementRef: React.MutableRefObject<HTMLElement | null>
  open(action: PartnerAccountAction, account: AdminOrgAccount, trigger: HTMLElement): void
  close(): Promise<void>
  confirm(): void
  switchAction(action: PartnerAccountAction): Promise<void>
  chooseMethod(method: PartnerAccountVerificationMethod): Promise<void>
  submitAdminPassword(password: string): Promise<void>
  verifyCredential(value: string): Promise<void>
  startRebind(newPhone: string): Promise<void>
  resendNewPhoneCode(): Promise<void>
  verifyNewPhone(code: string): Promise<void>
  commitDelete(): Promise<void>
}

function errorCode(error: unknown): string {
  return error instanceof ApiHttpError ? error.code : 'NETWORK_ERROR'
}

function isUncertainFinalError(error: unknown): boolean {
  return !(error instanceof ApiHttpError) || error.status === 0 || error.status >= 500
}

export function usePartnerAccountAction(
  orgId: string,
  onChanged: () => Promise<void> | void,
): UsePartnerAccountActionResult {
  const [state, dispatch] = useReducer(reducePartnerAccountAction, initialPartnerAccountActionState)
  const [account, setAccount] = useState<AdminOrgAccount | null>(null)
  const [organizationName, setOrganizationName] = useState('当前机构')
  const [phoneMasked, setPhoneMasked] = useState<string | null>(null)
  const [nowMs, setNowMs] = useState(Date.now())
  const [challengeDeadline, setChallengeDeadline] = useState(0)
  const [actionTicketDeadline, setActionTicketDeadline] = useState(0)
  const [rebindTicketDeadline, setRebindTicketDeadline] = useState(0)
  const [resendAvailableAt, setResendAvailableAt] = useState(0)
  const [statusMessage, setStatusMessage] = useState('')
  const operationIdRef = useRef(0)
  const controllerRef = useRef<AbortController | null>(null)
  const stateRef = useRef(state)
  const accountRef = useRef(account)
  const warnedTicketRef = useRef(false)
  const triggerElementRef = useRef<HTMLElement | null>(null)

  stateRef.current = state
  accountRef.current = account

  const revokeResources = useCallback(async (snapshot: PartnerAccountActionState, target: AdminOrgAccount | null) => {
    if (!target) return
    if (snapshot.busy && (snapshot.step === 'delete_committing' || snapshot.step === 'rebind_committing')) return
    const calls: Promise<void>[] = []
    if (snapshot.challengeId) calls.push(orgsAdminService.cancelActionChallenge(orgId, target.id, snapshot.challengeId))
    if (snapshot.actionTicket) calls.push(orgsAdminService.revokeActionTicket(orgId, target.id, snapshot.actionTicket))
    if (snapshot.rebindTicket) calls.push(orgsAdminService.revokePhoneRebindTicket(orgId, target.id, snapshot.rebindTicket))
    await Promise.allSettled(calls)
  }, [orgId])

  const invalidateOperation = useCallback(() => {
    operationIdRef.current += 1
    controllerRef.current?.abort()
    controllerRef.current = null
  }, [])

  const clearTiming = useCallback(() => {
    setChallengeDeadline(0)
    setActionTicketDeadline(0)
    setRebindTicketDeadline(0)
    setResendAvailableAt(0)
    setPhoneMasked(null)
    setStatusMessage('')
    warnedTicketRef.current = false
  }, [])

  const refreshForConvergence = useCallback(async () => {
    try { await onChanged() } catch { /* result remains explicitly uncertain in the UI */ }
  }, [onChanged])

  const handleError = useCallback((error: unknown) => {
    const code = errorCode(error)
    dispatch({ type: 'ERROR', code })
    if (['ACCOUNT_ACTION_TICKET_STALE', 'ACCOUNT_ACTION_CHALLENGE_UNAVAILABLE', 'ACCOUNT_NOT_FOUND', 'LAST_ACTIVE_PARTNER_ACCOUNT_REQUIRED', 'PHONE_TAKEN'].includes(code)) {
      void refreshForConvergence()
    }
  }, [refreshForConvergence])

  const createChallenge = useCallback(async (
    method: PartnerAccountVerificationMethod,
    adminCurrentPassword?: string,
  ) => {
    const target = accountRef.current
    const action = stateRef.current.action
    if (!target || !action) return
    const operationId = operationIdRef.current
    const controller = new AbortController()
    controllerRef.current = controller
    dispatch({ type: 'REQUEST_STARTED' })
    try {
      const response = await orgsAdminService.createActionChallenge(
        orgId,
        target.id,
        { action, verifyMethod: method, ...(adminCurrentPassword ? { adminCurrentPassword } : {}) },
        controller.signal,
      )
      if (operationId !== operationIdRef.current) {
        await orgsAdminService.cancelActionChallenge(orgId, target.id, response.challengeId).catch(() => undefined)
        return
      }
      if (adminCurrentPassword) dispatch({ type: 'ADMIN_REAUTHENTICATED' })
      dispatch({ type: 'CHALLENGE_CREATED', challengeId: response.challengeId })
      const createdAt = Date.now()
      setChallengeDeadline(createdAt + response.expiresInSeconds * 1_000)
      setResendAvailableAt(createdAt + response.cooldownSeconds * 1_000)
      setPhoneMasked(response.phoneMasked ?? null)
      setStatusMessage(method === 'sms' ? '验证码已发送' : '请输入目标账号当前密码')
    } catch (error) {
      if (operationId !== operationIdRef.current) return
      if (errorCode(error) === 'ADMIN_REAUTH_REQUIRED') dispatch({ type: 'ADMIN_REAUTH_REQUIRED' })
      else handleError(error)
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null
    }
  }, [handleError, orgId])

  const open = useCallback((action: PartnerAccountAction, target: AdminOrgAccount, trigger: HTMLElement) => {
    void revokeResources(stateRef.current, accountRef.current)
    invalidateOperation()
    clearTiming()
    triggerElementRef.current = trigger
    setAccount(target)
    dispatch({ type: 'OPEN', action, targetAccountId: target.id })
    const operationId = operationIdRef.current
    void orgsAdminService.getOrgDetail(orgId).then((detail) => {
      if (operationId === operationIdRef.current) setOrganizationName(detail.name)
    }).catch(() => undefined)
  }, [clearTiming, invalidateOperation, orgId, revokeResources])

  const close = useCallback(async () => {
    const snapshot = stateRef.current
    if (snapshot.busy) return
    const target = accountRef.current
    invalidateOperation()
    dispatch({ type: 'CLOSE' })
    setAccount(null)
    clearTiming()
    await revokeResources(snapshot, target)
  }, [clearTiming, invalidateOperation, revokeResources])

  const switchAction = useCallback(async (action: PartnerAccountAction) => {
    const snapshot = stateRef.current
    if (snapshot.busy) return
    invalidateOperation()
    clearTiming()
    dispatch({ type: 'SWITCH_ACTION', action })
    await revokeResources(snapshot, accountRef.current)
  }, [clearTiming, invalidateOperation, revokeResources])

  const chooseMethod = useCallback(async (method: PartnerAccountVerificationMethod) => {
    const snapshot = stateRef.current
    if (snapshot.busy) return
    invalidateOperation()
    clearTiming()
    dispatch({ type: 'CHOOSE_METHOD', method })
    await revokeResources(snapshot, accountRef.current)
    await createChallenge(method)
  }, [clearTiming, createChallenge, invalidateOperation, revokeResources])

  const verifyCredential = useCallback(async (value: string) => {
    const snapshot = stateRef.current
    const target = accountRef.current
    if (!target || !snapshot.challengeId || !snapshot.verifyMethod) return
    const operationId = operationIdRef.current
    const controller = new AbortController()
    controllerRef.current = controller
    dispatch({ type: 'REQUEST_STARTED' })
    try {
      const credential = snapshot.verifyMethod === 'sms' ? { code: value } : { currentPassword: value }
      const response = await orgsAdminService.verifyActionChallenge(
        orgId, target.id, snapshot.challengeId, credential, controller.signal,
      )
      if (operationId !== operationIdRef.current) {
        await orgsAdminService.revokeActionTicket(orgId, target.id, response.actionTicket).catch(() => undefined)
        return
      }
      dispatch({ type: 'CREDENTIAL_VERIFIED', actionTicket: response.actionTicket })
      setChallengeDeadline(0)
      setActionTicketDeadline(Date.now() + response.expiresInSeconds * 1_000)
      warnedTicketRef.current = false
      setStatusMessage('账号持有人验证已通过')
    } catch (error) {
      if (operationId === operationIdRef.current) handleError(error)
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null
    }
  }, [handleError, orgId])

  const startRebind = useCallback(async (newPhone: string) => {
    const snapshot = stateRef.current
    const target = accountRef.current
    if (!target || !snapshot.actionTicket) return
    const operationId = operationIdRef.current
    const controller = new AbortController()
    controllerRef.current = controller
    dispatch({ type: 'REQUEST_STARTED' })
    try {
      const response = await orgsAdminService.startPhoneRebind(
        orgId, target.id, snapshot.actionTicket, newPhone, controller.signal,
      )
      if (operationId !== operationIdRef.current) {
        await orgsAdminService.revokePhoneRebindTicket(orgId, target.id, response.rebindTicket).catch(() => undefined)
        return
      }
      dispatch({ type: 'PHONE_REBIND_STARTED', rebindTicket: response.rebindTicket })
      const createdAt = Date.now()
      setActionTicketDeadline(0)
      setRebindTicketDeadline(createdAt + response.expiresInSeconds * 1_000)
      setResendAvailableAt(createdAt + response.cooldownSeconds * 1_000)
      setPhoneMasked(response.phoneMasked)
      setStatusMessage('新手机号验证码已发送')
    } catch (error) {
      if (operationId === operationIdRef.current) handleError(error)
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null
    }
  }, [handleError, orgId])

  const resendNewPhoneCode = useCallback(async () => {
    const snapshot = stateRef.current
    const target = accountRef.current
    if (!target || !snapshot.rebindTicket || Date.now() < resendAvailableAt) return
    const operationId = operationIdRef.current
    const controller = new AbortController()
    controllerRef.current = controller
    dispatch({ type: 'REQUEST_STARTED' })
    try {
      const response = await orgsAdminService.resendNewPhoneCode(
        orgId, target.id, snapshot.rebindTicket, controller.signal,
      )
      if (operationId !== operationIdRef.current) return
      setPhoneMasked(response.phoneMasked)
      setRebindTicketDeadline(Date.now() + response.expiresInSeconds * 1_000)
      setResendAvailableAt(Date.now() + response.cooldownSeconds * 1_000)
      setStatusMessage('验证码已重新发送')
      dispatch({ type: 'REQUEST_FINISHED' })
    } catch (error) {
      if (operationId === operationIdRef.current) handleError(error)
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null
    }
  }, [handleError, orgId, resendAvailableAt])

  const finishSuccess = useCallback(async () => {
    try {
      await onChanged()
      dispatch({ type: 'SUCCESS' })
      clearTiming()
    } catch {
      dispatch({ type: 'FINAL_RESULT_UNCERTAIN' })
    }
  }, [clearTiming, onChanged])

  const verifyNewPhone = useCallback(async (code: string) => {
    const snapshot = stateRef.current
    const target = accountRef.current
    if (!target || !snapshot.rebindTicket) return
    const operationId = operationIdRef.current
    const controller = new AbortController()
    controllerRef.current = controller
    dispatch({ type: 'COMMIT_REBIND' })
    try {
      await orgsAdminService.verifyPhoneRebind(
        orgId, target.id, snapshot.rebindTicket, code, controller.signal,
      )
      if (operationId !== operationIdRef.current) return
      await finishSuccess()
    } catch (error) {
      if (operationId !== operationIdRef.current) return
      if (isUncertainFinalError(error)) {
        dispatch({ type: 'FINAL_RESULT_UNCERTAIN' })
        void refreshForConvergence()
      } else handleError(error)
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null
    }
  }, [finishSuccess, handleError, orgId, refreshForConvergence])

  const commitDelete = useCallback(async () => {
    const snapshot = stateRef.current
    const target = accountRef.current
    if (!target || !snapshot.actionTicket) return
    const operationId = operationIdRef.current
    const controller = new AbortController()
    controllerRef.current = controller
    dispatch({ type: 'COMMIT_DELETE' })
    try {
      await orgsAdminService.deleteAccount(orgId, target.id, snapshot.actionTicket, controller.signal)
      if (operationId !== operationIdRef.current) return
      await finishSuccess()
    } catch (error) {
      if (operationId !== operationIdRef.current) return
      if (isUncertainFinalError(error)) {
        dispatch({ type: 'FINAL_RESULT_UNCERTAIN' })
        void refreshForConvergence()
      } else handleError(error)
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null
    }
  }, [finishSuccess, handleError, orgId, refreshForConvergence])

  useEffect(() => {
    if (state.step === 'closed') return
    const timer = window.setInterval(() => setNowMs(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [state.step])

  useEffect(() => {
    const expire = (kind: DeadlineKind, ticket: string | undefined, deadline: number) => {
      if (!ticket || deadline === 0 || deadline > nowMs) return false
      const snapshot = stateRef.current
      invalidateOperation()
      void revokeResources(snapshot, accountRef.current)
      clearTiming()
      dispatch({ type: 'EXPIRED', resource: kind })
      return true
    }
    if (expire('challenge', state.challengeId, challengeDeadline)) return
    if (expire('action_ticket', state.actionTicket, actionTicketDeadline)) return
    expire('rebind_ticket', state.rebindTicket, rebindTicketDeadline)
  }, [actionTicketDeadline, challengeDeadline, clearTiming, invalidateOperation, nowMs, rebindTicketDeadline, revokeResources, state.actionTicket, state.challengeId, state.rebindTicket])

  useEffect(() => {
    const remaining = Math.ceil((actionTicketDeadline - nowMs) / 1_000)
    if (state.actionTicket && remaining > 0 && remaining <= 15 && !warnedTicketRef.current) {
      warnedTicketRef.current = true
      setStatusMessage('操作授权将在 15 秒内过期，请尽快完成')
    }
  }, [actionTicketDeadline, nowMs, state.actionTicket])

  useEffect(() => () => {
    invalidateOperation()
    void revokeResources(stateRef.current, accountRef.current)
  }, [invalidateOperation, revokeResources])

  return {
    state, account, organizationName, phoneMasked, nowMs, challengeDeadline, actionTicketDeadline,
    rebindTicketDeadline, resendAvailableAt, statusMessage, triggerElementRef,
    open, close, confirm: () => dispatch({ type: 'CONFIRM' }), switchAction, chooseMethod,
    submitAdminPassword: (password) => createChallenge(stateRef.current.verifyMethod ?? 'sms', password),
    verifyCredential, startRebind, resendNewPhoneCode, verifyNewPhone, commitDelete,
  }
}
