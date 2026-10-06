import type { MutableRefObject } from 'react'
import {
  releaseHeldResumeParseIntent,
  releaseResumeParseIntent,
  resumeParseIntentBlockMessage,
  resumeParseIntentHold,
  resumeParseTerminalBlockNote,
  type CanonicalResumeParsePayload,
} from '../../services/resumeParseIntent'
import { getResumeRecord } from '../../services/api'
import type { ShownTerminal } from './ResumeParseOutcomeNote'
import { isTaskNotFound, parseErrorOutcome } from './resumeParseGuards'

type ParseTask = { taskId: string; accessToken?: string }

export async function beginFreshParse(input: {
  terminal: ShownTerminal | null
  inFlightRef: MutableRefObject<boolean>
  identityStoppedRef: MutableRefObject<boolean>
  ownerRef: MutableRefObject<string | null>
  intentRef: MutableRefObject<string>
  payloadRef: MutableRefObject<CanonicalResumeParsePayload | null>
  keptTokenRef: MutableRefObject<ParseTask | null>
  cancelRef: MutableRefObject<boolean>
  samePerson: (ownerId: string | null) => boolean
  setConfirmFresh: (value: 0 | 1 | 2) => void
  setOutcome: (value: 'unknown') => void
  setStorageBlocked: (value: boolean) => void
  setTerminal: (value: ShownTerminal | null) => void
  setPendingTask: (value: ParseTask | null) => void
  setBlockNote: (value: string | null) => void
  submitAndWait: (mode: 'start' | 'replay') => Promise<void>
}): Promise<void> {
  if (input.inFlightRef.current || input.identityStoppedRef.current) return
  if (input.terminal?.mode === 'file_changed' || input.terminal?.mode === 'blocked') return
  const ownerId = input.ownerRef.current
  const charged = input.terminal?.mode === 'charged' ? input.terminal : null
  input.inFlightRef.current = true
  try {
    const intent = input.intentRef.current
    const payload = input.payloadRef.current
    if (charged && resumeParseIntentHold({ intent, ownerId, payload }) !== 'held') {
      input.setConfirmFresh(0)
      input.setOutcome('unknown')
      input.setStorageBlocked(true)
      input.setTerminal({ mode: 'blocked', note: resumeParseTerminalBlockNote(charged.source, 'mismatch') })
      return
    }
    const released = charged
      ? await releaseHeldResumeParseIntent(
        { intent, ownerId, payload },
        () => input.samePerson(ownerId) && input.intentRef.current === intent && input.payloadRef.current === payload,
      )
      : await releaseResumeParseIntent(ownerId)
    if (!input.samePerson(ownerId)) return
    if (!released.ok) {
      input.setConfirmFresh(0)
      input.setOutcome('unknown')
      if (charged) {
        input.setStorageBlocked(true)
        input.setTerminal({
          mode: 'blocked',
          note: resumeParseTerminalBlockNote(charged.source, released.code === 'INTENT_NOT_HELD' || released.code === 'IDENTITY_CHANGED' ? 'mismatch' : 'release_failed'),
        })
      } else {
        input.setBlockNote(released.code === 'STORAGE_WRITE_FAILED'
          ? '本机没能清除上一次未完成的解析，没有开始新的一次。'
          : resumeParseIntentBlockMessage(released.code))
      }
      return
    }
    input.intentRef.current = ''
    input.payloadRef.current = null
    input.keptTokenRef.current = null
    input.setPendingTask(null)
    input.setTerminal(null)
    input.setConfirmFresh(0)
    input.setBlockNote(null)
  } finally {
    input.inFlightRef.current = false
  }
  if (!input.samePerson(ownerId)) return
  input.cancelRef.current = false
  void input.submitAndWait('start')
}

/** 有任务时只读再查刚才这一次，不另起一次解析。 */
export async function recheckParseTask(input: {
  pendingTask: ParseTask | null
  recheck: string
  storageBlocked: boolean
  confirmFresh: number
  ownerRef: MutableRefObject<string | null>
  intentRef: MutableRefObject<string>
  payloadRef: MutableRefObject<CanonicalResumeParsePayload | null>
  getToken: () => string | null
  samePerson: (ownerId: string | null) => boolean
  setRecheck: (value: 'checking' | 'not-ready' | 'error' | 'replay' | 'not-found') => void
  setBlockNote: (value: string | null) => void
  acceptResult: (result: Awaited<ReturnType<typeof getResumeRecord>>, ownerId: string | null, knownTaskId: string) => Promise<void>
}): Promise<void> {
  const { pendingTask } = input
  if (!pendingTask || input.recheck === 'checking' || input.storageBlocked || input.confirmFresh !== 0) return
  const ownerId = input.ownerRef.current
  input.setRecheck('checking')
  try {
    const res = await getResumeRecord(pendingTask.taskId, { token: input.getToken(), accessToken: pendingTask.accessToken })
    if (!input.samePerson(ownerId)) return
    await input.acceptResult(res, ownerId, pendingTask.taskId)
    if ((res.status === 'pending' || res.status === 'processing') && (!res.taskId || res.taskId === pendingTask.taskId)) {
      input.setRecheck('not-ready')
    }
  } catch (err) {
    if (!input.samePerson(ownerId)) return
    const held = resumeParseIntentHold({
      intent: input.intentRef.current,
      ownerId,
      payload: input.payloadRef.current,
    }) !== 'absent'
    if (isTaskNotFound(err) && held) {
      input.setRecheck('replay')
      input.setBlockNote('解析已经提交，但结果还没有写完。请原样再试一次，不要开始新的解析。')
      return
    }
    if (isTaskNotFound(err)) {
      input.setRecheck('not-found')
      input.setBlockNote('按这台机器现在的登录状态，查不到这一次的结果。没有另起一次解析。')
      return
    }
    if (held && parseErrorOutcome(err) === 'unknown') {
      input.setRecheck('replay')
      input.setBlockNote('这次没核对到结果。请原样再试一次，不要开始新的解析。')
      return
    }
    input.setRecheck('error')
  }
}
