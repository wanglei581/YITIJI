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

/**
 * 知情同意版本号。改动 `CONSENT_ITEMS` 任意一条**必须**同时提高它 ——
 * 版本号的唯一作用就是让「用户上次同意的那份说明」和「现在这份说明」可比：
 * 版本不一致的旧会话一律回同意页重勾，不拿旧同意去调模型。
 *
 * 落点口径（诚实声明，UI 上不得说得比这更多）：
 *   - 版本号与勾选时刻记在本机会话（sessionStorage），用于门禁与结果页回显；
 *   - 服务端 `POST /resume/self-assessment` 当前只收 `{nonSensitive, sensitive}`
 *     两个布尔（`services/api/src/ai/self-assessment.controller.ts:70-76`），
 *     **不落版本号**。后端补 `consentVersion` 字段前，本页不得声称
 *     「同意版本已上报服务端」。
 */
export const SELF_ASSESSMENT_CONSENT_VERSION = 'sa-consent-v1.2026-08-16'

/** 用户勾选「我已了解上述说明」时，同意的就是这几条原文（同一份数组直接渲染给用户看）。 */
export const CONSENT_ITEMS: readonly string[] = [
  '本工具基于本人作答提供倾向参考，不是临床 / 心理 / 人格诊断。',
  '结果对本人可见，不向企业、合作机构、第三方推送。',
  '作答后可在结果页一键撤回 / 物理删除；不留存本人答案原文。',
  '本工具不评估「适合 / 不适合」任何岗位或职业，亦不构成能力证明。',
  '5 段解读由 AI 生成（E3 · 仅供参考）；维度强度由固定权重算出，不经过 AI。',
]

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

/** 同意门禁：没有当前版本的显式同意，就不允许作答，更不允许提交去调模型。 */
export function hasCurrentConsent(s: SelfAssessmentSession): boolean {
  return s.consent.nonSensitive === true && s.consentVersion === SELF_ASSESSMENT_CONSENT_VERSION
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
