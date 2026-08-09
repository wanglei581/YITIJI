import { assertNoHighConfidencePii, type ContractMaskPage } from './contract-review-pii-masker'
import { BASIS_ALLOWLIST, CONTRACT_RULE_PACK_VERSION } from './contract-review.rules'
import { assertNoForbiddenContractSemantics } from './contract-review-safety-semantics'
import type { ContractReviewFinding, ContractReviewResult } from './contract-review.types'

const COMPLIANCE_FORBIDDEN_TERMS = [
  '一键投递',
  '立即投递',
  '平台投递',
  '投递简历',
  '企业收简历',
  '候选人管理',
  '一键报名',
] as const

export const CONTRACT_SAFETY_LOW_OCR_NOTICE = '文字识别置信度较低，请以合同原件为准。'
export const CONTRACT_SAFETY_TRUNCATED_NOTICE = '本次仅分析了部分内容，未覆盖部分需要人工核对。'
export const CONTRACT_SAFETY_FIELD_CONFLICT_NOTICE = '提取字段存在冲突，请结合合同原件人工核对。'

export interface ContractReviewSafetyContext {
  readonly expectedDisclaimerVersion: string
  readonly expectedOcrConfidence: 'high' | 'medium' | 'low'
  readonly expectedCoverage: 'complete' | 'truncated'
  readonly hasFieldConflict: boolean
  readonly authoritativeRuleFindings: readonly ContractReviewFinding[]
}

const RESULT_KEYS = [
  'priorityCheckCount', 'attentionCount', 'insufficientInfoCount', 'coverage', 'ocrConfidence',
  'disclaimerVersion', 'rulePackVersion', 'generatedByAi', 'findings',
] as const
const FINDING_KEYS = [
  'id', 'category', 'priority', 'title', 'evidence', 'explanation', 'basisRef',
  'verificationQuestion', 'uncertainty', 'source',
] as const
const EVIDENCE_KEYS = ['pageNumber', 'excerpt', 'charStart', 'charEnd'] as const
const PAGE_KEYS = ['pageNumber', 'text'] as const
const CONTEXT_KEYS = [
  'expectedDisclaimerVersion', 'expectedOcrConfidence', 'expectedCoverage', 'hasFieldConflict',
  'authoritativeRuleFindings',
] as const
const CATEGORIES = new Set([
  'parties', 'term', 'probation', 'compensation', 'position_location', 'working_time',
  'social_insurance', 'training_service', 'penalty', 'non_compete', 'deposit_documents',
  'termination', 'imbalance', 'offer_conditions',
])
const PRIORITIES = new Set(['priority_check', 'attention', 'insufficient_info'])
const SOURCES = new Set(['rule', 'ai', 'rule_and_ai'])
const OCR_CONFIDENCE = new Set(['high', 'medium', 'low'])
const COVERAGE = new Set(['complete', 'truncated'])

export class ContractReviewSafetyGate {
  validate(result: unknown, pages: unknown, context: unknown): ContractReviewResult {
    try {
      const checked = assertResultShape(result)
      const canonicalPages = assertCanonicalPages(pages)
      const safetyContext = assertSafetyContext(context)
      assertExpectedTaskTruth(checked, safetyContext)
      assertFindingPolicies(checked.findings, canonicalPages)
      assertFindingPolicies(safetyContext.authoritativeRuleFindings, canonicalPages)
      assertNoForbiddenConclusions(checked.findings)
      assertNoFindingPii([...checked.findings, ...safetyContext.authoritativeRuleFindings])
      assertAuthoritativeRulesPreserved(checked.findings, safetyContext.authoritativeRuleFindings)
      return addMandatoryUncertaintyAndFreeze(checked, safetyContext)
    } catch {
      throw new Error('CONTRACT_SAFETY_GATE_REJECTED')
    }
  }
}

export function parsePersistedContractReviewResult(value: unknown): ContractReviewResult {
  try {
    return assertResultShape(value)
  } catch {
    throw new Error('CONTRACT_REVIEW_RESULT_INVALID')
  }
}

function assertResultShape(value: unknown): ContractReviewResult {
  const result = exactRecord(value, RESULT_KEYS)
  const priorityCheckCount = safeCount(result.priorityCheckCount)
  const attentionCount = safeCount(result.attentionCount)
  const insufficientInfoCount = safeCount(result.insufficientInfoCount)
  enumValue(result.coverage, COVERAGE)
  enumValue(result.ocrConfidence, OCR_CONFIDENCE)
  boundedString(result.disclaimerVersion, 1, 120)
  if (result.rulePackVersion !== CONTRACT_RULE_PACK_VERSION || result.generatedByAi !== true) reject()
  const findings = strictArray(result.findings, 100).map(assertFindingShape)
  const ids = new Set<string>()
  const actualCounts = { priority_check: 0, attention: 0, insufficient_info: 0 }
  for (const finding of findings) {
    if (ids.has(finding.id)) reject()
    ids.add(finding.id)
    actualCounts[finding.priority] += 1
  }
  if (
    priorityCheckCount !== actualCounts.priority_check || attentionCount !== actualCounts.attention ||
    insufficientInfoCount !== actualCounts.insufficient_info ||
    priorityCheckCount + attentionCount + insufficientInfoCount !== findings.length
  ) reject()
  return result as unknown as ContractReviewResult
}

function assertFindingShape(value: unknown): ContractReviewFinding {
  const finding = exactRecord(value, FINDING_KEYS)
  boundedString(finding.id, 1, 64)
  enumValue(finding.category, CATEGORIES)
  enumValue(finding.priority, PRIORITIES)
  boundedString(finding.title, 1, 120)
  boundedString(finding.explanation, 1, 2_000)
  boundedString(finding.verificationQuestion, 1, 500)
  boundedString(finding.uncertainty, 0, 500)
  if (finding.basisRef !== null) boundedString(finding.basisRef, 1, 120)
  enumValue(finding.source, SOURCES)
  if (assertEvidenceShape(finding.evidence) === 'empty' && finding.priority !== 'insufficient_info') {
    reject()
  }
  return finding as unknown as ContractReviewFinding
}

function assertEvidenceShape(value: unknown): 'empty' | 'present' {
  const evidence = exactRecord(value, EVIDENCE_KEYS)
  boundedString(evidence.excerpt, 0, 500)
  for (const key of ['pageNumber', 'charStart', 'charEnd'] as const) {
    if (evidence[key] !== null && !isSafeInteger(evidence[key], 0)) reject()
  }
  const empty = evidence.pageNumber === null && evidence.excerpt === '' &&
    evidence.charStart === null && evidence.charEnd === null
  if (empty) return 'empty'
  if (
    !isSafeInteger(evidence.pageNumber, 1) ||
    !isSafeInteger(evidence.charStart, 0) ||
    !isSafeInteger(evidence.charEnd, 1) ||
    evidence.excerpt.length === 0 ||
    evidence.charEnd <= evidence.charStart ||
    evidence.charEnd - evidence.charStart !== evidence.excerpt.length
  ) reject()
  return 'present'
}

function assertCanonicalPages(value: unknown): readonly ContractMaskPage[] {
  const pages = strictArray(value, 50, 1)
  let total = 0
  for (let index = 0; index < pages.length; index += 1) {
    const page = exactRecord(pages[index], PAGE_KEYS)
    if (page.pageNumber !== index + 1 || typeof page.text !== 'string') reject()
    if (page.text.length > 200_000 || page.text !== page.text.normalize('NFC') || /\r/u.test(page.text)) reject()
    total += page.text.length
    if (!Number.isSafeInteger(total) || total > 2_000_000) reject()
  }
  return pages as readonly ContractMaskPage[]
}

function assertSafetyContext(value: unknown): ContractReviewSafetyContext {
  const context = exactRecord(value, CONTEXT_KEYS)
  boundedString(context.expectedDisclaimerVersion, 1, 120)
  enumValue(context.expectedOcrConfidence, OCR_CONFIDENCE)
  enumValue(context.expectedCoverage, COVERAGE)
  if (typeof context.hasFieldConflict !== 'boolean') reject()
  const rules = strictArray(context.authoritativeRuleFindings, 100).map(assertFindingShape)
  const ids = new Set<string>()
  for (const finding of rules) {
    if (finding.source !== 'rule' || ids.has(finding.id)) reject()
    ids.add(finding.id)
  }
  return context as unknown as ContractReviewSafetyContext
}

function assertExpectedTaskTruth(result: ContractReviewResult, context: ContractReviewSafetyContext): void {
  if (
    result.disclaimerVersion !== context.expectedDisclaimerVersion ||
    result.ocrConfidence !== context.expectedOcrConfidence || result.coverage !== context.expectedCoverage
  ) reject()
}

function assertFindingPolicies(findings: readonly ContractReviewFinding[], pages: readonly ContractMaskPage[]): void {
  for (const finding of findings) {
    if (finding.basisRef !== null && !BASIS_ALLOWLIST.has(finding.basisRef)) reject()
    if ((finding.priority === 'priority_check' || finding.source !== 'ai') && finding.basisRef === null) reject()
    assertEvidence(finding, pages)
  }
}

function assertEvidence(finding: ContractReviewFinding, pages: readonly ContractMaskPage[]): void {
  const { pageNumber, excerpt, charStart, charEnd } = finding.evidence
  const empty = pageNumber === null && excerpt === '' && charStart === null && charEnd === null
  if (empty) {
    if (finding.priority !== 'insufficient_info') reject()
    return
  }
  if (
    pageNumber === null || charStart === null || charEnd === null || excerpt.length === 0 ||
    !isSafeInteger(pageNumber, 1) || !isSafeInteger(charStart, 0) || !isSafeInteger(charEnd, 1) ||
    pageNumber > pages.length || charEnd <= charStart
  ) reject()
  const page = pages[pageNumber - 1]
  if (!page || charEnd > page.text.length || page.text.slice(charStart, charEnd) !== excerpt) reject()
}

function assertNoForbiddenConclusions(findings: readonly ContractReviewFinding[]): void {
  const groups = findingTextGroups(findings)
  assertNoForbiddenContractSemantics(groups.flat(), COMPLIANCE_FORBIDDEN_TERMS, groups)
}

function assertNoFindingPii(findings: readonly ContractReviewFinding[]): void {
  const fragments = findingTextFragments(findings)
  const pages: ContractMaskPage[] = []
  let text = ''
  for (const fragment of fragments) {
    if (text.length > 0 && text.length + fragment.length > 100_000) {
      pages.push({ pageNumber: pages.length + 1, text })
      text = ''
    }
    text += fragment
  }
  if (text.length > 0) pages.push({ pageNumber: pages.length + 1, text })
  if (pages.length > 0) assertNoHighConfidencePii(pages)
}

function findingTextFragments(findings: readonly ContractReviewFinding[]): string[] {
  return findingTextGroups(findings).flat()
}

function findingTextGroups(findings: readonly ContractReviewFinding[]): string[][] {
  return findings.map((finding) => [
    finding.id, finding.title, finding.evidence.excerpt, finding.explanation,
    ...(finding.basisRef === null ? [] : [finding.basisRef]),
    finding.verificationQuestion, stripOfficialNotices(finding.uncertainty),
  ])
}

function assertAuthoritativeRulesPreserved(
  findings: readonly ContractReviewFinding[],
  authoritative: readonly ContractReviewFinding[],
): void {
  const byId = new Map(findings.map((finding) => [finding.id, finding]))
  const authoritativeIds = new Set(authoritative.map((finding) => finding.id))
  for (const rule of authoritative) {
    const final = byId.get(rule.id)
    if (!final || (final.source !== 'rule' && final.source !== 'rule_and_ai')) reject()
    if (
      final.category !== rule.category || final.priority !== rule.priority || final.basisRef !== rule.basisRef ||
      final.title !== rule.title || final.explanation !== rule.explanation ||
      final.verificationQuestion !== rule.verificationQuestion ||
      !sameEvidence(final.evidence, rule.evidence)
    ) reject()
  }
  for (const finding of findings) {
    if (finding.source !== 'ai' && !authoritativeIds.has(finding.id)) reject()
    if (finding.source === 'ai' && authoritativeIds.has(finding.id)) reject()
  }
}

function sameEvidence(left: ContractReviewFinding['evidence'], right: ContractReviewFinding['evidence']): boolean {
  return left.pageNumber === right.pageNumber && left.excerpt === right.excerpt &&
    left.charStart === right.charStart && left.charEnd === right.charEnd
}

function addMandatoryUncertaintyAndFreeze(
  result: ContractReviewResult,
  context: ContractReviewSafetyContext,
): ContractReviewResult {
  const notices = [
    ...(context.expectedOcrConfidence === 'low' ? [CONTRACT_SAFETY_LOW_OCR_NOTICE] : []),
    ...(context.expectedCoverage === 'truncated' ? [CONTRACT_SAFETY_TRUNCATED_NOTICE] : []),
    ...(context.hasFieldConflict ? [CONTRACT_SAFETY_FIELD_CONFLICT_NOTICE] : []),
  ]
  const findings = result.findings.map((finding) => {
    let uncertainty = stripOfficialNotices(finding.uncertainty)
    for (const notice of notices) {
      uncertainty = uncertainty ? `${uncertainty}；${notice}` : notice
    }
    if (uncertainty.length > 500) reject()
    return Object.freeze({
      ...finding,
      evidence: Object.freeze({ ...finding.evidence }),
      uncertainty,
    })
  })
  return Object.freeze({ ...result, findings: Object.freeze(findings) }) as unknown as ContractReviewResult
}

function stripOfficialNotices(value: string): string {
  let withoutNotices = value
  for (const notice of [
    CONTRACT_SAFETY_LOW_OCR_NOTICE,
    CONTRACT_SAFETY_TRUNCATED_NOTICE,
    CONTRACT_SAFETY_FIELD_CONFLICT_NOTICE,
  ]) {
    withoutNotices = withoutNotices.split(notice).join('')
  }
  return withoutNotices.split(/[；;]/u).map((part) => part.trim()).filter(Boolean).join('；')
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) reject()
  const ownKeys = Reflect.ownKeys(value)
  if (ownKeys.length !== keys.length || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))) reject()
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value') || !descriptor.enumerable) reject()
  }
  return value as Record<string, unknown>
}

function strictArray(value: unknown, max: number, min = 0): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length < min || value.length > max) reject()
  const names = Object.getOwnPropertyNames(value)
  if (names.length !== value.length + 1 || !names.includes('length')) reject()
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value') || !descriptor.enumerable) reject()
  }
  if (Object.getOwnPropertySymbols(value).length > 0) reject()
  return value
}

function safeCount(value: unknown): number {
  if (!isSafeInteger(value, 0)) reject()
  return value
}

function isSafeInteger(value: unknown, min: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min
}

function boundedString(value: unknown, min: number, max: number): asserts value is string {
  if (typeof value !== 'string' || value.length < min || value.length > max) reject()
}

function enumValue(value: unknown, allowed: ReadonlySet<string>): asserts value is string {
  if (typeof value !== 'string' || !allowed.has(value)) reject()
}

function reject(): never {
  throw new Error('CONTRACT_SAFETY_GATE_REJECTED')
}
