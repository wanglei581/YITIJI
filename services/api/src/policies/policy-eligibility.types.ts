// ============================================================
// P21 政策条件核对（S3-2）—— 问项字典与结果契约
//
// 本文件只放「数据 + 类型」，不含任何 I/O、不引 Nest、不引 Prisma，
// 便于 verify 脚本直接断言字典本身的性质。
//
// 三态是本能力的地基（红线，不可退化成布尔）：
//   matched  与已录入条件相符
//   conflict 与已录入条件不符
//   unknown  无法判定 —— 用户没答、答了「不确定」、
//            或该取值在政策条件里根本没被表达
//
// 「无法判定」永远不许折叠成「不符合」。少填一项 = unknown，不是 false。
// ============================================================

/** 问项字典版本。改动选项集合必须同步升版，前端据此判断缓存的作答是否还有效。 */
export const POLICY_ELIGIBILITY_QUESTION_SET_VERSION = 'policy-eligibility-questions-v1'

/**
 * 全局「不确定」取值。
 *
 * 这个取值是三态的守门员：它**永远不得**出现在任何一条条件的
 * satisfiedValues / conflictValues 里（由 assertValidRuleClauses 强制），
 * 因此用户选「不确定」必然落到 unknown，不可能被某条规则算成满足或不满足。
 */
export const POLICY_ELIGIBILITY_UNSURE = 'unsure'

export interface PolicyEligibilityQuestionOption {
  value: string
  label: string
}

export interface PolicyEligibilityQuestion {
  key: string
  label: string
  /**
   * 该问项是否属于敏感个人信息。
   * 服务端不落库任何作答值（见 policy-eligibility.service.ts 的隐私口径），
   * 这个标记只用于前端就地提示「这项可以不填」。
   */
  sensitive: boolean
  options: PolicyEligibilityQuestionOption[]
}

/**
 * 九项问项。取自 V6 原型 21-policy.html 的九个问项，
 * 但做了两处工程化修正：
 *   1. 取值改成稳定的 ASCII 标识，不用中文字面量当主键 —— 中文文案会随排版改，
 *      改一次文案就会把库里所有已录入条件的匹配集打散。
 *   2. 毕业年份不写死年号（原型写的是「2026 应届」）。年号会过期，
 *      改成相对区间，避免政策条件在跨年后静默失配。
 */
export const POLICY_ELIGIBILITY_QUESTIONS: readonly PolicyEligibilityQuestion[] = [
  {
    key: 'employment_status',
    label: '现在状态',
    sensitive: false,
    options: [
      { value: 'seeking_after_leaving', label: '离职找工作中' },
      { value: 'employed_switching', label: '在职想换工作' },
      { value: 'fresh_graduate', label: '应届毕业生' },
      { value: 'starting_business', label: '想创业 / 已创业' },
      { value: POLICY_ELIGIBILITY_UNSURE, label: '不确定' },
    ],
  },
  {
    key: 'household_social',
    label: '户籍社保',
    sensitive: true,
    options: [
      { value: 'local_household', label: '本市户籍' },
      { value: 'nonlocal_with_local_insurance', label: '外地 · 本市缴社保' },
      { value: 'nonlocal_without_insurance', label: '外地 · 未缴社保' },
      { value: POLICY_ELIGIBILITY_UNSURE, label: '不确定' },
    ],
  },
  {
    key: 'unemployed_duration',
    label: '离职多久',
    sensitive: false,
    options: [
      { value: 'within_1_month', label: '1 个月内' },
      { value: 'months_1_to_6', label: '1–6 个月' },
      { value: 'over_6_months', label: '6 个月以上' },
      { value: 'never_employed', label: '没工作过' },
      { value: POLICY_ELIGIBILITY_UNSURE, label: '不确定' },
    ],
  },
  {
    key: 'age_range',
    label: '年龄段',
    sensitive: true,
    options: [
      { value: 'age_16_24', label: '16–24 岁' },
      { value: 'age_25_35', label: '25–35 岁' },
      { value: 'age_36_45', label: '36–45 岁' },
      { value: 'age_46_plus', label: '46 岁以上' },
      { value: POLICY_ELIGIBILITY_UNSURE, label: '不确定' },
    ],
  },
  {
    key: 'graduation_year',
    label: '毕业年份',
    sensitive: false,
    options: [
      { value: 'current_year', label: '本年度应届' },
      { value: 'within_2_years', label: '毕业 2 年内' },
      { value: 'over_2_years', label: '毕业超过 2 年' },
      { value: 'not_applicable', label: '不适用' },
      { value: POLICY_ELIGIBILITY_UNSURE, label: '不确定' },
    ],
  },
  {
    key: 'unemployment_registration',
    label: '失业登记',
    sensitive: true,
    options: [
      { value: 'registered', label: '已办' },
      { value: 'not_registered', label: '没办' },
      { value: POLICY_ELIGIBILITY_UNSURE, label: '不确定' },
    ],
  },
  {
    key: 'social_insurance_months',
    label: '连续缴费',
    sensitive: true,
    options: [
      { value: 'none', label: '未缴' },
      { value: 'under_3_months', label: '不满 3 个月' },
      { value: 'at_least_3_months', label: '满 3 个月以上' },
      { value: POLICY_ELIGIBILITY_UNSURE, label: '不确定' },
    ],
  },
  {
    key: 'separation_reason',
    label: '离职原因',
    sensitive: true,
    options: [
      { value: 'layoff_or_contract_end', label: '裁员 / 合同到期' },
      { value: 'voluntary_resignation', label: '本人主动辞职' },
      { value: 'other', label: '其他' },
      { value: POLICY_ELIGIBILITY_UNSURE, label: '不确定' },
    ],
  },
  {
    key: 'prior_subsidy',
    label: '领过同类补贴',
    sensitive: false,
    options: [
      { value: 'never_received', label: '没领过' },
      { value: 'received', label: '领过' },
      { value: POLICY_ELIGIBILITY_UNSURE, label: '不确定' },
    ],
  },
] as const

export const POLICY_ELIGIBILITY_QUESTION_KEYS: readonly string[] =
  POLICY_ELIGIBILITY_QUESTIONS.map((q) => q.key)

export function findEligibilityQuestion(key: string): PolicyEligibilityQuestion | undefined {
  return POLICY_ELIGIBILITY_QUESTIONS.find((q) => q.key === key)
}

// ── 条件（规则）模型 ─────────────────────────────────────────────────────────

/**
 * 条件的判定方式（不只是「多子句合取方式」）：
 *   all    机械比对：全部子句都要满足
 *   any    机械比对：任一子句满足即可
 *   manual **只能人工核对** —— 该条款天然无法机器判定
 *
 * 为什么必须有 manual（P21-PARTNER-UI 补齐）：
 * 真实政策里有大量「经街道办核实的困难家庭」「经认定的就业困难人员」这类条款，
 * 它们的事实来源在窗口和外部系统，不在用户的九项自述里。若录入面只允许
 * all/any，运营面对这类条款只有两条路：要么硬塞一个能比对但与政策原文不符的
 * 规则（＝替政策编造口径，违反红线「政策口径不得由 AI / 任何人猜测补全」），
 * 要么干脆不录（＝条件在核对结果里彻底消失，用户以为不存在这一关）。
 * manual 是第三条路：条款照录、原文照留、结论恒为 unknown +「需人工核对」。
 *
 * 实现上复用既有 matchMode 字符串列，不新增数据库列 —— 存量行默认 'all' 不受影响。
 */
export const POLICY_RULE_MATCH_MODES = ['all', 'any', 'manual'] as const
export type PolicyRuleMatchMode = (typeof POLICY_RULE_MATCH_MODES)[number]

/** 只能人工核对：不参与机械比对，结论恒为 unknown。 */
export const POLICY_RULE_MANUAL_MODE = 'manual'

/** 机械比对模式（manual 之外的取值）。 */
export const POLICY_RULE_AUTOMATIC_MODES = ['all', 'any'] as const

export function isManualRuleMode(mode: string): boolean {
  return mode === POLICY_RULE_MANUAL_MODE
}

export interface PolicyEligibilityClause {
  questionKey: string
  /** 命中即判 matched 的取值集合（不得为空，不得含 unsure） */
  satisfiedValues: string[]
  /** 命中即判 conflict 的取值集合（可空，不得含 unsure） */
  conflictValues: string[]
}

export interface PolicyEligibilityRuleInput {
  label: string
  /** 政策原文摘录，一字不改 —— 判定唯一可追溯的依据 */
  sourceText: string
  matchMode: PolicyRuleMatchMode
  /** manual 模式必须为空数组：人工核对条款不得挂任何机械比对子句 */
  clauses: PolicyEligibilityClause[]
}

export interface PolicyEligibilityRuleRecord extends PolicyEligibilityRuleInput {
  id: string
  orderIndex: number
}

// ── 判定结果契约 ─────────────────────────────────────────────────────────────

export const POLICY_CONDITION_RESULTS = ['matched', 'conflict', 'unknown'] as const
export type PolicyConditionResult = (typeof POLICY_CONDITION_RESULTS)[number]

/**
 * 机读原因码。前端不得自己拼原因文案 —— 「为什么判不出来」是合规表述，
 * 由服务端一处给定。
 */
export const POLICY_CONDITION_REASON_CODES = [
  'ANSWER_MATCHES_RECORDED_CONDITION',
  'ANSWER_CONFLICTS_WITH_RECORDED_CONDITION',
  'ANSWER_MISSING',
  'ANSWER_UNSURE',
  'ANSWER_NOT_COVERED_BY_RECORDED_CONDITION',
  'MIXED_CLAUSE_RESULTS',
  'MANUAL_REVIEW_ONLY',
] as const
export type PolicyConditionReasonCode = (typeof POLICY_CONDITION_REASON_CODES)[number]

export const POLICY_CONDITION_REASON_TEXT: Record<PolicyConditionReasonCode, string> = {
  ANSWER_MATCHES_RECORDED_CONDITION: '你填写的内容与该条已录入条件一致。',
  ANSWER_CONFLICTS_WITH_RECORDED_CONDITION: '你填写的内容与该条已录入条件不一致。',
  ANSWER_MISSING: '这一项你没有填写，本条无法判定，需人工核对。',
  ANSWER_UNSURE: '这一项你选了「不确定」，本条无法判定，需人工核对。',
  ANSWER_NOT_COVERED_BY_RECORDED_CONDITION:
    '你填写的取值没有被这条政策的已录入条件覆盖，本条无法判定，需人工核对。',
  MIXED_CLAUSE_RESULTS: '本条包含多项子条件，其中有子条件无法判定，需人工核对。',
  MANUAL_REVIEW_ONLY: '本条按政策原文只能由经办窗口人工核对，本机不做机械比对。',
}

export interface PolicyConditionBasis {
  questionKey: string
  questionLabel: string
  /** 用户填写的取值；未填写为 null。仅在本次响应中回显，不落库。 */
  answerValue: string | null
  answerLabel: string | null
  clauseResult: PolicyConditionResult
}

export interface PolicyConditionCheck {
  ruleId: string
  orderIndex: number
  label: string
  result: PolicyConditionResult
  reasonCode: PolicyConditionReasonCode
  reason: string
  /** 政策原文摘录 —— 判定依据，一字不改地回传 */
  sourceText: string
  basis: PolicyConditionBasis[]
}

/** 与 Job / JobFair 同口径的来源标识（CLAUDE.md §10）。 */
export interface PolicySourceRef {
  sourceOrgId: string
  sourceName: string
  /** 来源方原始编号；来源未提供为 null，不得伪造 */
  externalId: string | null
  /** 官方入口链接；未提供为 null */
  sourceUrl: string | null
  syncTime: string
  reviewStatus: string
  publishStatus: string
}

export const POLICY_ELIGIBILITY_OVERALLS = [
  'all_recorded_conditions_matched',
  'some_conditions_conflict',
  'some_conditions_unknown',
  'no_recorded_conditions',
] as const
export type PolicyEligibilityOverall = (typeof POLICY_ELIGIBILITY_OVERALLS)[number]

export interface PolicyEligibilityCheckItem {
  policyId: string
  title: string
  kind: string
  audience: string | null
  category: string | null
  source: PolicySourceRef
  /**
   * 证据分级恒为 E2（来源方事实）。
   * 判定是确定性比对，不调模型 —— 按矩阵 §3.0「确定性逻辑不得标 E3」，
   * 这里绝不标 E3，也绝不出现「AI 判断」字样。
   */
  evidenceLevel: 'E2'
  /** 该政策是否录入了可机械比对的条件 */
  conditionsRecorded: boolean
  conditions: PolicyConditionCheck[]
  summary: { matched: number; conflict: number; unknown: number; total: number }
  overall: PolicyEligibilityOverall
  /** 合规表述：只说「已录入条件的比对结果」，不说「你符合申领资格」 */
  overallLabel: string
  manualReviewRequired: boolean
}

export interface PolicyEligibilityCheckResult {
  questionSetVersion: string
  checkedAt: string
  answeredCount: number
  /** 用户填写但不在字典里 / 取值非法的问项键，原样回传键名（不回传取值） */
  ignoredQuestionKeys: string[]
  disclaimer: string
  method: 'deterministic_comparison'
  items: PolicyEligibilityCheckItem[]
}

/**
 * 全局免责口径（红线：结果是参考不是裁定）。
 * 与 21-policy.html 的常驻口径「本机不做资格认定、不代办、不收费」保持一致。
 */
export const POLICY_ELIGIBILITY_DISCLAIMER =
  '本结果是把你填写的信息与已录入的政策条件做机械比对，不是资格认定。' +
  '本机不做资格认定、不代办、不收费；能不能办以经办窗口审核为准。'

/** 作答只在本次请求内参与计算，不写库、不进日志（服务端实现保证）。 */
export const POLICY_ELIGIBILITY_PRIVACY_NOTICE =
  '你填写的答案只用于本次条件比对，不保存、不上传给任何政府或第三方系统，' +
  '结果只在本次会话内展示；任何一项都可以不填，不填的条件会标为「无法判定」。'
