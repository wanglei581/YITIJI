// ============================================================
// 自我探索 · 倾向参考 —— 评分纯函数（v1）
//
// 合规口径（与 docs/compliance/compliance-boundary.md §4.5 同档）：
// - 非临床 / 非诊断 / 本人自助参考；不复用 MBTI / 大五 / DISC / 霍兰德 / SCL /
//   PHQ / GAD / MMPI 等任何标签或量表。
// - 维度分（strength）只由「本人作答的 choice.weight」累加产生，不引入任何
//   「匹配 / 排序 / 排名 / 适合 / 不适合」结论；evidence 仅记录被采用的题号，
//   不含答案原文。
// - 纯函数：给定题目 seed + 答案 → 输出 `SelfAssessmentScoringOutput`。
//   不读取数据库 / 不写日志 / 不调 LLM。
// - 不依赖 @ai-job-print/shared：评分核心必须可在没有打包链路的前提下被
//   服务端其它模块直接 import（避免 ESM/CJS 路径配置回归）。
// ============================================================

import { createHash } from 'node:crypto'

export type SelfAssessmentDimensionKey =
  | 'interest'      // 兴趣偏好
  | 'style'         // 工作风格
  | 'team'          // 团队偏好
  | 'value'         // 价值取向
  | 'motivation'    // 求职动机

export const SELF_ASSESSMENT_DIMENSIONS: ReadonlyArray<{ key: SelfAssessmentDimensionKey; label: string }> = [
  { key: 'interest',   label: '兴趣偏好' },
  { key: 'style',      label: '工作风格' },
  { key: 'team',       label: '团队偏向' },
  { key: 'value',      label: '价值取向' },
  { key: 'motivation', label: '求职动机' },
]

export interface SelfAssessmentQuestionV1 {
  idx: number
  prompt: string
  choices: Array<{ key: string; label: string; weight: number }>
  /** 题目是否触及敏感话题（健康/家庭/信仰等）。不强制回答但需单独勾选同意。 */
  sensitive?: boolean
}

export interface SelfAssessmentDimensionV1 {
  key: SelfAssessmentDimensionKey
  label: string
  questions: SelfAssessmentQuestionV1[]
}

export interface SelfAssessmentQuestionsV1 {
  version: 'v1'
  dimensions: SelfAssessmentDimensionV1[]
}

export interface SelfAssessmentAnswerV1 {
  dim: SelfAssessmentDimensionKey
  idx: number
  choice: string
}

export interface SelfAssessmentDimensionResult {
  key: SelfAssessmentDimensionKey
  label: string
  /** 0..5：5 题 weight 累加后归一化。 */
  strength: 0 | 1 | 2 | 3 | 4 | 5
  /** 自然语言解读（≤300 字）。命中合规词或服务端拒答时为 null。 */
  note: string | null
  /** 推导依据：被采用的题号（v1 内 idx，仅 key 不含答案）。 */
  evidenceQuestionIdx: number[]
}

export interface SelfAssessmentScoringInput {
  /** 答案数组（前端原序 / 去重均可；服务端以 dim+idx 维度去重） */
  answers: SelfAssessmentAnswerV1[]
  /** 题目种子；注入可解耦前后端版本 */
  questions: SelfAssessmentQuestionsV1
}

export interface SelfAssessmentScoringOutput {
  /** 5 维度结果（顺序与 SELF_ASSESSMENT_DIMENSIONS 一致） */
  dimensions: SelfAssessmentDimensionResult[]
  /** SHA-256(JSON.stringify(answers))，原文不入库 */
  answersHash: string
  /** 校验摘要：未匹配的答案（题号不存在 / 维度不匹配 / 选项不匹配） */
  unmatched: Array<{ dim: SelfAssessmentDimensionKey; idx: number; reason: 'unknown_dim' | 'unknown_idx' | 'unknown_choice' }>
}

/** 强制限制：每维度 strength ∈ [0,5] 整数；超出归一化截断。 */
function clampStrength(raw: number): 0 | 1 | 2 | 3 | 4 | 5 {
  if (!Number.isFinite(raw)) return 0
  const n = Math.max(0, Math.min(5, Math.round(raw)))
  return n as 0 | 1 | 2 | 3 | 4 | 5
}

function makeDeterministicHash(answers: SelfAssessmentAnswerV1[]): string {
  // 同步规范化：按 (dim, idx) 排序后 JSON 序列化；服务端只取 SHA-256 摘要，不存原文。
  const sorted = [...answers]
    .map((a) => ({ dim: a.dim, idx: a.idx, choice: a.choice }))
    .sort((a, b) => (a.dim === b.dim ? a.idx - b.idx : a.dim.localeCompare(b.dim)))
  return createHash('sha256').update(JSON.stringify(sorted), 'utf8').digest('hex')
}

export function scoreSelfAssessment(input: SelfAssessmentScoringInput): SelfAssessmentScoringOutput {
  const questions = input.questions
  const byDim = new Map(questions.dimensions.map((d) => [d.key, d]))
  const answersHash = makeDeterministicHash(input.answers)
  const unmatched: SelfAssessmentScoringOutput['unmatched'] = []

  // 5 维度累加 + 命中题号收集
  const acc = new Map<SelfAssessmentDimensionKey, { raw: number; idx: number[] }>()
  for (const k of SELF_ASSESSMENT_DIMENSIONS) acc.set(k.key, { raw: 0, idx: [] })

  // 容错：同一题号若出现多次（用户回退重答），最后一条生效
  const lastByKey = new Map<string, SelfAssessmentAnswerV1>()
  for (const a of input.answers) lastByKey.set(`${a.dim}:${a.idx}`, a)

  for (const a of lastByKey.values()) {
    const dim = byDim.get(a.dim)
    if (!dim) { unmatched.push({ dim: a.dim, idx: a.idx, reason: 'unknown_dim' }); continue }
    const q = dim.questions.find((qq) => qq.idx === a.idx)
    if (!q) { unmatched.push({ dim: a.dim, idx: a.idx, reason: 'unknown_idx' }); continue }
    const choice = q.choices.find((c) => c.key === a.choice)
    if (!choice) { unmatched.push({ dim: a.dim, idx: a.idx, reason: 'unknown_choice' }); continue }
    const weight = Number(choice.weight)
    if (!Number.isFinite(weight)) continue
    const cell = acc.get(a.dim)
    if (!cell) continue
    cell.raw += weight
    cell.idx.push(a.idx)
  }

  const dimensions: SelfAssessmentDimensionResult[] = SELF_ASSESSMENT_DIMENSIONS.map((meta) => {
    const cell = acc.get(meta.key) ?? { raw: 0, idx: [] }
    return {
      key: meta.key,
      label: meta.label,
      strength: clampStrength(cell.raw),
      note: null, // note 由 LLM 注入；纯函数负责 strength/evidence
      evidenceQuestionIdx: [...cell.idx].sort((a, b) => a - b),
    }
  })

  return { dimensions, answersHash, unmatched }
}
