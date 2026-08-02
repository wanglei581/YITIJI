import type { ContractModelDraft } from './contract-review-provider.service'
import type { ContractMaskPage } from './contract-review-pii-masker'
import type { ContractReviewRuleFinding } from './contract-review-rule-engine'
import { BASIS_ALLOWLIST, CONTRACT_RULE_PACK_VERSION } from './contract-review.rules'
import type {
  ContractReviewCategory,
  ContractReviewFinding,
  ContractReviewResult,
} from './contract-review.types'

const MAX_FINDINGS = 100
const AI_CATEGORIES = new Set([
  'parties',
  'term',
  'probation',
  'compensation',
  'position_location',
  'working_time',
  'social_insurance',
  'training_service',
  'penalty',
  'non_compete',
  'deposit_documents',
  'termination',
  'imbalance',
  'offer_conditions',
])
const AI_PRIORITIES = new Set(['priority_check', 'attention', 'insufficient_info'])

const RULE_MAPPING = Object.freeze({
  'labor.probation.term': Object.freeze({
    category: 'probation',
    verificationQuestion: '合同期限与试用期期限分别是多少？',
  }),
  'labor.probation.local_wage': Object.freeze({
    category: 'compensation',
    verificationQuestion: '试用期工资标准及工作所在地分别是什么？',
  }),
  'labor.non_compete.compensation': Object.freeze({
    category: 'non_compete',
    verificationQuestion: '竞业限制补偿标准、支付周期和所在地规则是什么？',
  }),
  'labor.non_compete.term': Object.freeze({
    category: 'non_compete',
    verificationQuestion: '竞业限制期限是多少？',
  }),
  'labor.documents.retention': Object.freeze({
    category: 'deposit_documents',
    verificationQuestion: '用人单位是否会扣押或保管劳动者身份证件？',
  }),
  'labor.property.collection': Object.freeze({
    category: 'deposit_documents',
    verificationQuestion: '用人单位是否会向劳动者收取押金、保证金或其他财物？',
  }),
  'labor.penalty.scope': Object.freeze({
    category: 'penalty',
    verificationQuestion: '违约金对应的具体事项是什么？',
  }),
} as const satisfies Readonly<
  Record<string, Readonly<{ category: ContractReviewCategory; verificationQuestion: string }>>
>)

type RuleId = keyof typeof RULE_MAPPING

export interface ContractReviewComposeResultInput {
  readonly ruleFindings: readonly ContractReviewFinding[]
  readonly aiFindings: readonly ContractReviewFinding[]
  readonly coverage: 'complete' | 'truncated'
  readonly ocrConfidence: 'high' | 'medium' | 'low'
  readonly disclaimerVersion: string
}

export type FrozenContractReviewResult = Readonly<
  Omit<ContractReviewResult, 'findings'> & {
    readonly findings: readonly ContractReviewFinding[]
  }
>

function isRuleId(value: string): value is RuleId {
  return Object.prototype.hasOwnProperty.call(RULE_MAPPING, value)
}

function freezeEvidence(
  evidence: ContractReviewFinding['evidence'],
): Readonly<ContractReviewFinding['evidence']> {
  return Object.freeze({ ...evidence })
}

function freezeFinding(finding: ContractReviewFinding): Readonly<ContractReviewFinding> {
  return Object.freeze({ ...finding, evidence: freezeEvidence(finding.evidence) })
}

function validatePages(
  pages: readonly ContractMaskPage[],
): ReadonlyMap<number, string> {
  if (!Array.isArray(pages) || pages.length < 1 || pages.length > 50) {
    throw new Error('CONTRACT_REVIEW_AI_MAPPING_INVALID')
  }
  const byPage = new Map<number, string>()
  let total = 0
  for (let index = 0; index < pages.length; index += 1) {
    const page = pages[index]
    if (
      !page ||
      page.pageNumber !== index + 1 ||
      typeof page.text !== 'string' ||
      page.text.length > 200_000 ||
      page.text !== page.text.normalize('NFC') ||
      /\r/u.test(page.text)
    ) {
      throw new Error('CONTRACT_REVIEW_AI_MAPPING_INVALID')
    }
    total += page.text.length
    if (!Number.isSafeInteger(total) || total > 2_000_000) {
      throw new Error('CONTRACT_REVIEW_AI_MAPPING_INVALID')
    }
    byPage.set(page.pageNumber, page.text)
  }
  return byPage
}

function aiId(index: number, category: string, priority: string): string {
  const id = `ai-${String(index + 1).padStart(4, '0')}-${category}-${priority}`
  if (id.length > 64) throw new Error('CONTRACT_REVIEW_AI_MAPPING_INVALID')
  return id
}

function mapAiEvidence(
  finding: ContractModelDraft['findings'][number],
  pages: ReadonlyMap<number, string>,
): ContractReviewFinding['evidence'] {
  if (finding.pageNumber === null) {
    if (finding.priority !== 'insufficient_info') {
      throw new Error('CONTRACT_REVIEW_AI_MAPPING_INVALID')
    }
    return { pageNumber: null, excerpt: '', charStart: null, charEnd: null }
  }
  if (!Number.isSafeInteger(finding.pageNumber) || finding.pageNumber < 1 || !finding.excerpt) {
    throw new Error('CONTRACT_REVIEW_AI_MAPPING_INVALID')
  }
  const page = pages.get(finding.pageNumber)
  if (page === undefined) throw new Error('CONTRACT_REVIEW_AI_MAPPING_INVALID')
  const charStart = page.indexOf(finding.excerpt)
  if (charStart < 0 || page.indexOf(finding.excerpt, charStart + 1) >= 0) {
    throw new Error('CONTRACT_REVIEW_AI_MAPPING_INVALID')
  }
  return {
    pageNumber: finding.pageNumber,
    excerpt: finding.excerpt,
    charStart,
    charEnd: charStart + finding.excerpt.length,
  }
}

function assertAiDraft(draft: ContractModelDraft): void {
  if (!draft || typeof draft !== 'object' || !Array.isArray(draft.findings)) {
    throw new Error('CONTRACT_REVIEW_AI_MAPPING_INVALID')
  }
  if (draft.findings.length > MAX_FINDINGS) {
    throw new Error('CONTRACT_REVIEW_RESULT_OVERFLOW')
  }
}

export class ContractReviewFindingMapper {
  mapRules(ruleFindings: readonly ContractReviewRuleFinding[]): readonly ContractReviewFinding[] {
    if (!Array.isArray(ruleFindings)) {
      throw new Error('CONTRACT_REVIEW_RULE_MAPPING_INVALID')
    }
    const ids = new Set<string>()
    const mapped = ruleFindings.map((finding) => {
      const ruleId = finding?.ruleId
      if (
        !finding ||
        typeof ruleId !== 'string' ||
        !isRuleId(ruleId) ||
        ids.has(ruleId) ||
        finding.rulePackVersion !== CONTRACT_RULE_PACK_VERSION ||
        finding.source !== 'rule' ||
        !BASIS_ALLOWLIST.has(finding.basisRef)
      ) {
        throw new Error('CONTRACT_REVIEW_RULE_MAPPING_INVALID')
      }
      ids.add(ruleId)
      const mapping = RULE_MAPPING[ruleId]
      return freezeFinding({
        id: ruleId,
        category: mapping.category,
        priority: finding.priority,
        title: finding.title,
        evidence: { ...finding.evidence },
        explanation: finding.explanation,
        basisRef: finding.basisRef,
        verificationQuestion: mapping.verificationQuestion,
        uncertainty: '',
        source: 'rule',
      })
    })
    return Object.freeze(mapped)
  }

  mapAi(
    draft: ContractModelDraft,
    pages: readonly ContractMaskPage[],
    ruleIds: readonly string[] = Object.freeze([]),
  ): readonly ContractReviewFinding[] {
    assertAiDraft(draft)
    const pageText = validatePages(pages)
    if (!Array.isArray(ruleIds) || ruleIds.some((id) => typeof id !== 'string')) {
      throw new Error('CONTRACT_REVIEW_AI_MAPPING_INVALID')
    }
    const ids = new Set(ruleIds)
    const mapped = draft.findings.map((finding, index) => {
      if (
        !finding ||
        typeof finding.category !== 'string' ||
        !AI_CATEGORIES.has(finding.category) ||
        typeof finding.priority !== 'string' ||
        !AI_PRIORITIES.has(finding.priority) ||
        typeof finding.title !== 'string' ||
        typeof finding.excerpt !== 'string' ||
        typeof finding.explanation !== 'string' ||
        typeof finding.verificationQuestion !== 'string' ||
        typeof finding.uncertainty !== 'string' ||
        (finding.basisRef !== null && !BASIS_ALLOWLIST.has(finding.basisRef))
      ) {
        throw new Error('CONTRACT_REVIEW_AI_MAPPING_INVALID')
      }
      const id = aiId(index, finding.category, finding.priority)
      if (ids.has(id)) throw new Error('CONTRACT_REVIEW_AI_MAPPING_INVALID')
      ids.add(id)
      return freezeFinding({
        id,
        category: finding.category,
        priority: finding.priority,
        title: finding.title,
        evidence: mapAiEvidence(finding, pageText),
        explanation: finding.explanation,
        basisRef: finding.basisRef,
        verificationQuestion: finding.verificationQuestion,
        uncertainty: finding.uncertainty,
        source: 'ai',
      })
    })
    return Object.freeze(mapped)
  }

  composeResult(input: ContractReviewComposeResultInput): FrozenContractReviewResult {
    if (
      !input ||
      !Array.isArray(input.ruleFindings) ||
      !Array.isArray(input.aiFindings) ||
      (input.coverage !== 'complete' && input.coverage !== 'truncated') ||
      !['high', 'medium', 'low'].includes(input.ocrConfidence) ||
      typeof input.disclaimerVersion !== 'string' ||
      input.disclaimerVersion.length < 1
    ) {
      throw new Error('CONTRACT_REVIEW_RESULT_INVALID')
    }
    const total = input.ruleFindings.length + input.aiFindings.length
    if (total > MAX_FINDINGS) throw new Error('CONTRACT_REVIEW_RESULT_OVERFLOW')
    const ids = new Set<string>()
    const findings = [...input.ruleFindings, ...input.aiFindings].map((finding) => {
      if (!finding || typeof finding.id !== 'string' || ids.has(finding.id)) {
        throw new Error('CONTRACT_REVIEW_RESULT_ID_CONFLICT')
      }
      ids.add(finding.id)
      return freezeFinding(finding)
    })
    const priorityCheckCount = findings.filter((item) => item.priority === 'priority_check').length
    const attentionCount = findings.filter((item) => item.priority === 'attention').length
    const insufficientInfoCount = findings.filter(
      (item) => item.priority === 'insufficient_info',
    ).length
    return Object.freeze({
      priorityCheckCount,
      attentionCount,
      insufficientInfoCount,
      coverage: input.coverage,
      ocrConfidence: input.ocrConfidence,
      disclaimerVersion: input.disclaimerVersion,
      rulePackVersion: CONTRACT_RULE_PACK_VERSION,
      generatedByAi: true,
      findings: Object.freeze(findings),
    })
  }
}
