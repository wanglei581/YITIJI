// ============================================================
// P21 政策条件核对（S3-2）—— 纯判定引擎
//
// 本文件是确定性的：不引 Nest、不引 Prisma、不读环境变量、不调 LLM、
// 不产生任何副作用。给同一组（条件, 作答）永远得到同一结果。
//
// 为什么必须是确定性的（红线）：政策口径不得由 AI 编造。每条判定的依据
// 是一段入库的政策原文摘录（rule.sourceText）；库里没有对应的结构化表达，
// 结果只能是 unknown + 「需人工核对」，绝不允许让模型猜一个 true/false。
// 也正因为不调模型，证据分级是 E2（来源方事实）而不是 E3
// —— 见矩阵 §3.0「确定性逻辑（计数、排序、映射）不得标 E3」。
//
// ⚠️ 与原型的一处刻意偏离：21-policy.html:451 把这块标成
//    「E3 · AI 核对，仅供参考」。本实现不调模型，标 E3 反而是伪造 AI 参与，
//    因此按上述判据落 E2。原型该处标注应随之更正。
// ============================================================

import {
  POLICY_CONDITION_REASON_TEXT,
  POLICY_ELIGIBILITY_DISCLAIMER,
  POLICY_ELIGIBILITY_QUESTION_SET_VERSION,
  POLICY_ELIGIBILITY_UNSURE,
  POLICY_RULE_MATCH_MODES,
  findEligibilityQuestion,
  type PolicyConditionBasis,
  type PolicyConditionCheck,
  type PolicyConditionResult,
  type PolicyConditionReasonCode,
  type PolicyEligibilityCheckItem,
  type PolicyEligibilityCheckResult,
  type PolicyEligibilityClause,
  type PolicyEligibilityOverall,
  type PolicyEligibilityRuleInput,
  type PolicyEligibilityRuleRecord,
  type PolicySourceRef,
} from './policy-eligibility.types'

// ── 一、条件（规则）校验 ─────────────────────────────────────────────────────

export interface PolicyRuleValidationError {
  code: string
  message: string
}

export const MAX_RULES_PER_POLICY = 12
export const MAX_CLAUSES_PER_RULE = 4

/**
 * 校验一组待写入的条件。返回 null 表示通过。
 *
 * 这里守住三态的地基：
 *   - 「不确定」不得出现在 satisfiedValues / conflictValues 任一侧。
 *     否则用户选「不确定」就可能被算成满足或不满足，三态退化。
 *   - 取值必须是问项字典里登记过的取值，杜绝自造取值让判定悄悄失配。
 *   - satisfiedValues 与 conflictValues 不得相交，否则同一取值既满足又冲突。
 *   - sourceText 必填：没有政策原文摘录的条件不许入库 —— 判定必须可追溯。
 */
export function validatePolicyEligibilityRules(
  rules: PolicyEligibilityRuleInput[],
): PolicyRuleValidationError | null {
  if (rules.length > MAX_RULES_PER_POLICY) {
    return {
      code: 'POLICY_RULES_TOO_MANY',
      message: `单条政策最多录入 ${MAX_RULES_PER_POLICY} 条申领条件`,
    }
  }

  for (const [i, rule] of rules.entries()) {
    const at = `第 ${i + 1} 条`

    if (!rule.label?.trim()) {
      return { code: 'POLICY_RULE_LABEL_REQUIRED', message: `${at}缺少条件标题` }
    }
    if (!rule.sourceText?.trim()) {
      return {
        code: 'POLICY_RULE_SOURCE_TEXT_REQUIRED',
        message: `${at}缺少政策原文摘录 —— 没有原文依据的条件不得用于核对`,
      }
    }
    if (!(POLICY_RULE_MATCH_MODES as readonly string[]).includes(rule.matchMode)) {
      return { code: 'POLICY_RULE_MATCH_MODE_INVALID', message: `${at}的 matchMode 非法` }
    }
    if (!Array.isArray(rule.clauses) || rule.clauses.length === 0) {
      return { code: 'POLICY_RULE_CLAUSES_REQUIRED', message: `${at}至少需要一个判定子句` }
    }
    if (rule.clauses.length > MAX_CLAUSES_PER_RULE) {
      return {
        code: 'POLICY_RULE_CLAUSES_TOO_MANY',
        message: `${at}最多 ${MAX_CLAUSES_PER_RULE} 个判定子句`,
      }
    }

    const seenKeys = new Set<string>()
    for (const clause of rule.clauses) {
      const question = findEligibilityQuestion(clause.questionKey)
      if (!question) {
        return {
          code: 'POLICY_RULE_QUESTION_UNKNOWN',
          message: `${at}引用了未登记的问项 ${clause.questionKey}`,
        }
      }
      if (seenKeys.has(clause.questionKey)) {
        return {
          code: 'POLICY_RULE_QUESTION_DUPLICATED',
          message: `${at}重复引用问项 ${clause.questionKey}`,
        }
      }
      seenKeys.add(clause.questionKey)

      const allowed = new Set(question.options.map((o) => o.value))
      const satisfied = clause.satisfiedValues ?? []
      const conflict = clause.conflictValues ?? []

      if (satisfied.length === 0) {
        return {
          code: 'POLICY_RULE_SATISFIED_VALUES_REQUIRED',
          message: `${at}的问项 ${clause.questionKey} 必须至少给出一个「相符」取值`,
        }
      }
      for (const value of [...satisfied, ...conflict]) {
        if (value === POLICY_ELIGIBILITY_UNSURE) {
          return {
            code: 'POLICY_RULE_UNSURE_NOT_ALLOWED',
            message: `${at}不得把「不确定」写进相符/不符集合 —— 不确定必须落「无法判定」`,
          }
        }
        if (!allowed.has(value)) {
          return {
            code: 'POLICY_RULE_VALUE_UNKNOWN',
            message: `${at}的取值 ${value} 不在问项 ${clause.questionKey} 的选项内`,
          }
        }
      }
      const overlap = satisfied.find((v) => conflict.includes(v))
      if (overlap) {
        return {
          code: 'POLICY_RULE_VALUE_CONFLICT',
          message: `${at}的取值 ${overlap} 同时出现在相符与不符集合`,
        }
      }
    }
  }

  return null
}

// ── 二、三值判定 ─────────────────────────────────────────────────────────────

interface ClauseOutcome {
  basis: PolicyConditionBasis
  result: PolicyConditionResult
  reasonCode: PolicyConditionReasonCode
}

/**
 * 单个子句的三值判定。
 *
 * 未填 / 「不确定」/ 两侧集合都没覆盖的取值 → 一律 unknown。
 * 最后一种最关键：一个取值只是「没被这条政策的条件表达过」，
 * 不等于「不满足」。默认成 false 就是替政策编造口径。
 */
function evaluateClause(
  clause: PolicyEligibilityClause,
  answers: Readonly<Record<string, string>>,
): ClauseOutcome {
  const question = findEligibilityQuestion(clause.questionKey)
  const questionLabel = question?.label ?? clause.questionKey
  const raw = answers[clause.questionKey]
  const option = question?.options.find((o) => o.value === raw)

  const base = {
    questionKey: clause.questionKey,
    questionLabel,
    answerValue: option ? option.value : null,
    answerLabel: option ? option.label : null,
  }

  if (!option) {
    return {
      basis: { ...base, clauseResult: 'unknown' },
      result: 'unknown',
      reasonCode: 'ANSWER_MISSING',
    }
  }
  if (option.value === POLICY_ELIGIBILITY_UNSURE) {
    return {
      basis: { ...base, clauseResult: 'unknown' },
      result: 'unknown',
      reasonCode: 'ANSWER_UNSURE',
    }
  }
  if ((clause.satisfiedValues ?? []).includes(option.value)) {
    return {
      basis: { ...base, clauseResult: 'matched' },
      result: 'matched',
      reasonCode: 'ANSWER_MATCHES_RECORDED_CONDITION',
    }
  }
  if ((clause.conflictValues ?? []).includes(option.value)) {
    return {
      basis: { ...base, clauseResult: 'conflict' },
      result: 'conflict',
      reasonCode: 'ANSWER_CONFLICTS_WITH_RECORDED_CONDITION',
    }
  }
  return {
    basis: { ...base, clauseResult: 'unknown' },
    result: 'unknown',
    reasonCode: 'ANSWER_NOT_COVERED_BY_RECORDED_CONDITION',
  }
}

/**
 * 多子句合取，Kleene 三值逻辑。
 *   all：有一个 conflict 即 conflict；否则有 unknown 即 unknown；否则 matched。
 *   any：有一个 matched 即 matched；否则全 conflict 才 conflict；否则 unknown。
 * 两种模式都不会把 unknown 折叠成 conflict。
 */
function combineClauseResults(
  mode: string,
  results: PolicyConditionResult[],
): PolicyConditionResult {
  if (mode === 'any') {
    if (results.includes('matched')) return 'matched'
    if (results.length > 0 && results.every((r) => r === 'conflict')) return 'conflict'
    return 'unknown'
  }
  if (results.includes('conflict')) return 'conflict'
  if (results.includes('unknown')) return 'unknown'
  return 'matched'
}

/** 结论已定后，挑一个能解释「为什么」的原因码。 */
function pickReasonCode(
  result: PolicyConditionResult,
  outcomes: ClauseOutcome[],
): PolicyConditionReasonCode {
  const decisive = outcomes.filter((o) => o.result === result)
  if (decisive.length === 1) return decisive[0].reasonCode
  const codes = new Set(decisive.map((o) => o.reasonCode))
  if (codes.size === 1) return decisive[0].reasonCode
  if (result === 'matched') return 'ANSWER_MATCHES_RECORDED_CONDITION'
  if (result === 'conflict') return 'ANSWER_CONFLICTS_WITH_RECORDED_CONDITION'
  return 'MIXED_CLAUSE_RESULTS'
}

export function evaluateRule(
  rule: PolicyEligibilityRuleRecord,
  answers: Readonly<Record<string, string>>,
): PolicyConditionCheck {
  const outcomes = rule.clauses.map((clause) => evaluateClause(clause, answers))
  const result = combineClauseResults(
    rule.matchMode,
    outcomes.map((o) => o.result),
  )
  const reasonCode = pickReasonCode(result, outcomes)
  return {
    ruleId: rule.id,
    orderIndex: rule.orderIndex,
    label: rule.label,
    result,
    reasonCode,
    reason: POLICY_CONDITION_REASON_TEXT[reasonCode],
    // 原文摘录原样回传，一字不改
    sourceText: rule.sourceText,
    basis: outcomes.map((o) => o.basis),
  }
}

// ── 三、单条政策汇总 ─────────────────────────────────────────────────────────

function overallLabelFor(
  overall: PolicyEligibilityOverall,
  summary: { matched: number; conflict: number; unknown: number; total: number },
): string {
  switch (overall) {
    case 'no_recorded_conditions':
      return '该政策尚未录入可机械比对的条件，本次未做条件核对，需人工核对。'
    case 'some_conditions_conflict':
      return `按你填写的信息，有 ${summary.conflict} 条与已录入条件不一致；` +
        `另有 ${summary.matched} 条相符、${summary.unknown} 条无法判定。`
    case 'some_conditions_unknown':
      return `按你填写的信息，有 ${summary.matched} 条与已录入条件相符，` +
        `${summary.unknown} 条无法判定，需人工核对。`
    case 'all_recorded_conditions_matched':
      return `按你填写的信息，已录入的 ${summary.total} 条条件都相符；` +
        '是否能办仍以经办窗口审核为准。'
  }
}

export function evaluatePolicy(
  policy: {
    id: string
    title: string
    kind: string
    audience: string | null
    category: string | null
    source: PolicySourceRef
  },
  rules: PolicyEligibilityRuleRecord[],
  answers: Readonly<Record<string, string>>,
): PolicyEligibilityCheckItem {
  const conditions = [...rules]
    .sort((a, b) => a.orderIndex - b.orderIndex || a.id.localeCompare(b.id))
    .map((rule) => evaluateRule(rule, answers))

  const summary = {
    matched: conditions.filter((c) => c.result === 'matched').length,
    conflict: conditions.filter((c) => c.result === 'conflict').length,
    unknown: conditions.filter((c) => c.result === 'unknown').length,
    total: conditions.length,
  }

  let overall: PolicyEligibilityOverall
  if (summary.total === 0) overall = 'no_recorded_conditions'
  else if (summary.conflict > 0) overall = 'some_conditions_conflict'
  else if (summary.unknown > 0) overall = 'some_conditions_unknown'
  else overall = 'all_recorded_conditions_matched'

  return {
    policyId: policy.id,
    title: policy.title,
    kind: policy.kind,
    audience: policy.audience,
    category: policy.category,
    source: policy.source,
    evidenceLevel: 'E2',
    conditionsRecorded: summary.total > 0,
    conditions,
    summary,
    overall,
    overallLabel: overallLabelFor(overall, summary),
    manualReviewRequired: summary.total === 0 || summary.unknown > 0,
  }
}

// ── 四、整次核对 ─────────────────────────────────────────────────────────────

/**
 * 过滤作答：只保留字典里登记过的问项与取值。
 * 被丢弃的问项**只回传键名，不回传取值** —— 取值是用户填的个人信息。
 */
export function sanitizeAnswers(raw: Readonly<Record<string, unknown>>): {
  answers: Record<string, string>
  ignoredQuestionKeys: string[]
} {
  const answers: Record<string, string> = {}
  const ignoredQuestionKeys: string[] = []
  for (const [key, value] of Object.entries(raw ?? {})) {
    const question = findEligibilityQuestion(key)
    if (!question || typeof value !== 'string') {
      ignoredQuestionKeys.push(key)
      continue
    }
    if (!question.options.some((o) => o.value === value)) {
      ignoredQuestionKeys.push(key)
      continue
    }
    answers[key] = value
  }
  return { answers, ignoredQuestionKeys }
}

/** 已作答项数 —— 「不确定」不计入，它等价于没答。 */
export function countAnswered(answers: Readonly<Record<string, string>>): number {
  return Object.values(answers).filter((v) => v !== POLICY_ELIGIBILITY_UNSURE).length
}

export function buildCheckResult(
  items: PolicyEligibilityCheckItem[],
  answers: Readonly<Record<string, string>>,
  ignoredQuestionKeys: string[],
  checkedAt: Date,
): PolicyEligibilityCheckResult {
  return {
    questionSetVersion: POLICY_ELIGIBILITY_QUESTION_SET_VERSION,
    checkedAt: checkedAt.toISOString(),
    answeredCount: countAnswered(answers),
    ignoredQuestionKeys,
    disclaimer: POLICY_ELIGIBILITY_DISCLAIMER,
    method: 'deterministic_comparison',
    items,
  }
}
