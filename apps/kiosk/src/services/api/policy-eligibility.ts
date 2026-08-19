// ============================================================
// Kiosk 政策条件核对 Service（P21 接线）
//
// 只接两个后端端点，二者都免登录（与 GET /policies 同口径）：
//   GET  /policies/eligibility-questions   问项字典（问项与取值一律服务端下发）
//   POST /policies/eligibility-check       确定性比对，纯计算、零落库
//
// ── 三条实现红线 ──────────────────────────────────────────────────────────
//
// 1. **不使用 AI。** 判定在服务端由 policy-eligibility.engine.ts 做确定性比对，
//    全程不调模型。因此本模块不引 ../ai/*、不读任何 AI 可用性状态：
//    AI 挂了，条件核对照常可用。V6 原型 21-policy.html 有 16 处 data-when="ai-down"
//    把这项能力整个关掉，与它自己 :458-459 注释「零 LLM」互相矛盾；
//    实现按「不依赖 AI」的那一边落地，原型的矛盾另案处理。
//
// 2. **问项不得前端硬编码。** 取值一旦与服务端字典漂移，已录入的政策条件会
//    静默失配、判定全变「无法判定」而没人发现。所以 mock 模式下宁可如实说
//    「未连接后端，本机无法做条件核对」，也不造一份本地字典。
//
// 3. **作答不落任何本地存储。** 户籍 / 年龄段 / 参保 / 失业登记 / 离职原因都是
//    个人信息；服务端已承诺零持久化（不写库、不进审计、不进日志），前端同样
//    只放 React state，不写 localStorage / sessionStorage / URL query。
// ============================================================

import { API_BASE_URL, API_MODE } from './client'

export interface EligibilityQuestionOption {
  value: string
  label: string
}

export interface EligibilityQuestion {
  key: string
  label: string
  /** 敏感项：前端据此就地提示「这项可以不填」，不做任何本地留存 */
  sensitive: boolean
  options: EligibilityQuestionOption[]
}

export interface EligibilityQuestionSet {
  questionSetVersion: string
  questions: EligibilityQuestion[]
  privacyNotice: string
  disclaimer: string
}

export type ConditionResult = 'matched' | 'conflict' | 'unknown'

export interface ConditionBasis {
  questionKey: string
  questionLabel: string
  answerValue: string | null
  answerLabel: string | null
  clauseResult: ConditionResult
}

export interface ConditionCheck {
  ruleId: string
  orderIndex: number
  label: string
  result: ConditionResult
  reasonCode: string
  /** 「为什么判成这样」的合规表述由服务端给定，前端不得自己拼 */
  reason: string
  /** 政策原文摘录 —— 判定唯一可追溯的依据，原样展示 */
  sourceText: string
  basis: ConditionBasis[]
}

export interface EligibilitySourceRef {
  sourceOrgId: string
  sourceName: string
  externalId: string | null
  sourceUrl: string | null
  syncTime: string
  reviewStatus: string
  publishStatus: string
}

export type EligibilityOverall =
  | 'all_recorded_conditions_matched'
  | 'some_conditions_conflict'
  | 'some_conditions_unknown'
  | 'no_recorded_conditions'

export interface EligibilityCheckItem {
  policyId: string
  title: string
  kind: string
  audience: string | null
  category: string | null
  source: EligibilitySourceRef
  /** 恒为 E2（来源方事实）—— 确定性比对不标 E3，也不写「AI 判断」 */
  evidenceLevel: 'E2'
  conditionsRecorded: boolean
  conditions: ConditionCheck[]
  summary: { matched: number; conflict: number; unknown: number; total: number }
  overall: EligibilityOverall
  /** 合规结论文案由服务端给定：只说「已录入条件的比对结果」，不说「你符合资格」 */
  overallLabel: string
  manualReviewRequired: boolean
}

export interface EligibilityCheckResult {
  questionSetVersion: string
  checkedAt: string
  answeredCount: number
  ignoredQuestionKeys: string[]
  disclaimer: string
  method: 'deterministic_comparison'
  items: EligibilityCheckItem[]
}

/** mock 模式（未连接后端）下抛出的哨兵错误，页面据此说明「本机现在做不了核对」。 */
export const ELIGIBILITY_BACKEND_REQUIRED = 'ELIGIBILITY_BACKEND_REQUIRED'

function assertHttpMode() {
  if (API_MODE !== 'http') throw new Error(ELIGIBILITY_BACKEND_REQUIRED)
}

export async function getEligibilityQuestions(): Promise<EligibilityQuestionSet> {
  assertHttpMode()
  const res = await fetch(`${API_BASE_URL}/policies/eligibility-questions`, {
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`请求失败（${res.status}）`)
  return (await res.json()) as EligibilityQuestionSet
}

/**
 * 条件核对。用 POST 而非 GET —— 作答含户籍 / 参保 / 失业登记等个人信息，
 * 不得出现在 URL query 里（会进网关与访问日志）。
 *
 * 空 answers 是**合法且有意义**的调用：它等价于「一项都没填」，
 * 服务端会把每条已录入条件判成 unknown，并原样回传当前可比对的政策集合。
 * 页面用它做「先探数据、再决定要不要向用户要个人信息」的探针。
 */
export async function checkEligibility(
  answers: Record<string, string>,
): Promise<EligibilityCheckResult> {
  assertHttpMode()
  const res = await fetch(`${API_BASE_URL}/policies/eligibility-check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ answers }),
  })
  if (!res.ok) throw new Error(`请求失败（${res.status}）`)
  return (await res.json()) as EligibilityCheckResult
}
