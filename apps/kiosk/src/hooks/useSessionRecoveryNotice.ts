import { useEffect, useState } from 'react'
import { AI_DECLARATION_SESSION_KEY } from '../ai/aiDeclarationVersions'
import { INTERVIEW_WORKBENCH_SESSION_KEY } from '../pages/interview/interviewWorkbenchSession'
import { SESSION_STORAGE_KEY as SELF_ASSESSMENT_SESSION_KEY } from '../pages/resume/selfAssessmentSession'
import { SCAN_WORKBENCH_SESSION_KEY } from '../pages/scan/scanWorkbenchSession'
import { ASSISTANT_DRAFT_KEY } from '../services/assistantDraft'
import { RESUME_PARSE_INTENT_STORAGE_KEY } from '../services/resumeParseIntent'
import {
  subscribeTerminalSession,
  takeTerminalSessionRecoveryCleared,
  terminalSessionState,
} from '../services/terminalAuth'

/** 换新票清场后给还站在机器前的人看的那一句。一个字不改。 */
export const SESSION_RECOVERY_NOTICE = '刚才选的材料已经清掉，要重新传'
const NOTICE_MS = 120_000
const CLEAR_BATCH_MIN = 3

// 与 kioskSensitiveSession 清掉的 sessionStorage 键一致。本机清场会在同一轮删掉一整批。
const CLEAR_KEYS = new Set<string>([
  'ai-job-print:current-print-material-check',
  'ai-job-print:current-ai-resume',
  RESUME_PARSE_INTENT_STORAGE_KEY,
  'ai-job-print:job-material-draft:v1',
  SELF_ASSESSMENT_SESSION_KEY,
  INTERVIEW_WORKBENCH_SESSION_KEY,
  SCAN_WORKBENCH_SESSION_KEY,
  ASSISTANT_DRAFT_KEY,
  AI_DECLARATION_SESSION_KEY,
])

type Notice = { until: number; clearSeq: number }

let notice: Notice | null = null
let expiryTimer: number | null = null
let watching = false
let batchSerial = 0
let openBatch: { id: number; keys: Set<string> } | null = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

function arm(): void {
  if (!takeTerminalSessionRecoveryCleared()) return
  const seq = openBatch?.id ?? batchSerial
  notice = { until: Date.now() + NOTICE_MS, clearSeq: seq }
  if (expiryTimer !== null) window.clearTimeout(expiryTimer)
  expiryTimer = window.setTimeout(() => {
    expiryTimer = null
    if (!notice || notice.until > Date.now()) return
    notice = null
    emit()
  }, NOTICE_MS)
  emit()
}

export function dismissSessionRecoveryNotice(): void {
  if (!notice) return
  notice = null
  if (expiryTimer !== null) {
    window.clearTimeout(expiryTimer)
    expiryTimer = null
  }
  emit()
}

function noteSensitiveRemoval(key: string): void {
  if (!CLEAR_KEYS.has(key)) return
  if (!openBatch) {
    batchSerial += 1
    const batch = { id: batchSerial, keys: new Set<string>() }
    openBatch = batch
    queueMicrotask(() => {
      if (openBatch === batch) openBatch = null
      if (!notice) return
      if (batch.keys.size >= CLEAR_BATCH_MIN && notice.clearSeq < batch.id) dismissSessionRecoveryNotice()
    })
  }
  openBatch.keys.add(key)
}

function ensureWatch(): void {
  if (watching || typeof window === 'undefined') return
  watching = true
  subscribeTerminalSession((next) => {
    if (next === 'ready') arm()
  })
  const storage = window.sessionStorage
  const original = storage.removeItem.bind(storage)
  storage.removeItem = (key: string) => {
    original(key)
    noteSensitiveRemoval(key)
  }
}

/** 首页挂载时读一次：恢复可能发生在订阅建立之前。 */
export function readSessionRecoveryOnHomeMount(): void {
  ensureWatch()
  if (terminalSessionState() === 'ready') arm()
}

export function useSessionRecoveryNotice(): string | null {
  const [version, setVersion] = useState(0)
  useEffect(() => {
    ensureWatch()
    const listener = () => setVersion((value) => value + 1)
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }, [])
  void version
  if (!notice || Date.now() >= notice.until) return null
  return SESSION_RECOVERY_NOTICE
}
