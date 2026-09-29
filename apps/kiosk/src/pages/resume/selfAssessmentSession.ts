// ============================================================
// 自我探索 · 倾向参考 —— 会话、知情同意与题库裁剪（无 UI，可单独推理）
//
// 从 `SelfAssessmentFlow.tsx` 抽出来的原因很实际：S2-7 接线把该页推过了
// CLAUDE.md §8 的 800 行硬线。按矩阵 §3.0「拆文件 ≠ 拆页」的判据，四个阶段
// 是同一件事的连续推进，拆页会增加步数 —— 所以拆的是文件，不是页。
// 这里只放**不含 JSX、不碰网络**的东西：会话读写、同意门禁、题库裁剪、格式化。
// ============================================================

import type {
  SelfAssessmentAnswerV1,
  SelfAssessmentDimensionKey,
  SelfAssessmentQuestionsV1,
  SelfAssessmentSubmitResponse,
} from '@ai-job-print/shared'
import { SELF_ASSESSMENT_QUESTIONS_V1 } from '@ai-job-print/shared'

export const SESSION_STORAGE_KEY = 'self_assessment_session_v1'
export const IDLE_TIMEOUT_MS = 60_000

// 知情同意的条款、勾选框文字、链接与版本号不在本机声明：一律取同一次
// GET /resume/self-assessment/questions 的下发（见 `selfAssessmentConsent.ts`）。
// 会话里只记「用户勾选的是哪一版」（下发的原值），提交时原样送给服务端，
// 服务端逐字比对，不是当前版就 400 `SELF_ASSESSMENT_CONSENT_VERSION_STALE`。

/** 题库里被标为敏感的题。v1 题库实测 0 题 —— 按题库真值算，不写死数字。 */
export const SENSITIVE_QUESTIONS: readonly string[] = SELF_ASSESSMENT_QUESTIONS_V1.dimensions.flatMap((d) =>
  d.questions.filter((q) => q.sensitive === true).map((q) => `${d.key}:${q.idx}`),
)

export interface SelfAssessmentSession {
  answers: Partial<Record<SelfAssessmentDimensionKey, Record<number, string>>>
  consent: { nonSensitive: boolean; sensitive: boolean }
  /** 勾选时生效的同意版本；与当前版本不一致的会话必须重新同意。 */
  consentVersion?: string
  /** 勾选时刻（ISO8601），结果页与记录页回显用。 */
  consentedAt?: string
  /** 同意页里还没点「开始」的勾选状态：去读隐私政策再回来时原样恢复（只对同一版说明有效）。 */
  consentDraft?: { checkedVersion: string | null; sensitive: boolean }
  /** 服务端说版本已更新时置真：重新确认说明后自动重交一次，已答的题不清空。 */
  resubmitAfterConsent?: boolean
  taskId?: string
  accessToken?: string
  result?: SelfAssessmentSubmitResponse
}

export function emptySelfAssessmentSession(): SelfAssessmentSession {
  return { answers: {}, consent: { nonSensitive: false, sensitive: false } }
}

export function loadSession(): SelfAssessmentSession {
  try {
    const raw = sessionStorage.getItem(SESSION_STORAGE_KEY)
    if (!raw) return emptySelfAssessmentSession()
    return JSON.parse(raw) as SelfAssessmentSession
  } catch {
    return emptySelfAssessmentSession()
  }
}

export function saveSession(s: SelfAssessmentSession): void {
  try { sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(s)) } catch { /* ignore */ }
}

export function clearSession(): void {
  try { sessionStorage.removeItem(SESSION_STORAGE_KEY) } catch { /* ignore */ }
}

/**
 * 按同意颗粒度裁剪题库：没勾选敏感题同意时，被标 `sensitive` 的题不出现、也不计入进度。
 * v1 题库 0 道敏感题 ⇒ 行为与裁剪前完全一致；题库将来标了敏感题，这条门禁自动生效
 * （题库在 `packages/shared`，本批不改它）。
 */
export function questionsFor(consentSensitive: boolean): SelfAssessmentQuestionsV1 {
  if (consentSensitive || SENSITIVE_QUESTIONS.length === 0) return SELF_ASSESSMENT_QUESTIONS_V1
  return {
    ...SELF_ASSESSMENT_QUESTIONS_V1,
    dimensions: SELF_ASSESSMENT_QUESTIONS_V1.dimensions
      .map((d) => ({ ...d, questions: d.questions.filter((q) => q.sensitive !== true) }))
      .filter((d) => d.questions.length > 0),
  }
}

export function flattenAnswers(
  map: Partial<Record<SelfAssessmentDimensionKey, Record<number, string>>>,
): SelfAssessmentAnswerV1[] {
  const out: SelfAssessmentAnswerV1[] = []
  for (const dim of Object.keys(map) as SelfAssessmentDimensionKey[]) {
    const sub = map[dim] ?? {}
    for (const idx of Object.keys(sub)) out.push({ dim, idx: Number(idx), choice: sub[Number(idx)] ?? '' })
  }
  return out
}

export function progress(
  questions: SelfAssessmentQuestionsV1,
  answers: Partial<Record<SelfAssessmentDimensionKey, Record<number, string>>>,
): { done: number; total: number } {
  const total = questions.dimensions.reduce((acc, d) => acc + d.questions.length, 0)
  let done = 0
  for (const dim of questions.dimensions) {
    for (const q of dim.questions) {
      if (answers[dim.key]?.[q.idx]) done += 1
    }
  }
  return { done, total }
}

/** 服务端没给时间就返回 null —— 不用「刚刚」「未知」之类的话把空值糊过去。 */
export function formatDateTime(iso: string | null | undefined): string | null {
  if (!iso) return null
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return null
  return at.toLocaleString('zh-CN', { hour12: false })
}

export function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

/** 历史链接始终重新核验；只复用同一条匿名结果的凭证，不复用答案或旧正文。 */
export function sessionForAssessmentRecord(linkedTaskId: string | null, saved: SelfAssessmentSession): SelfAssessmentSession {
  return linkedTaskId ? { ...emptySelfAssessmentSession(), taskId: linkedTaskId, accessToken: saved.taskId === linkedTaskId ? saved.accessToken : undefined } : saved
}
