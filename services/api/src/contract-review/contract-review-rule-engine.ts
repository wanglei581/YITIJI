import type { ContractType } from './contract-review.types'
import { BASIS_ALLOWLIST, CONTRACT_RULE_PACK_VERSION } from './contract-review.rules'

export interface ContractReviewCanonicalPage {
  readonly pageNumber: number
  readonly text: string
}

export type LiquidatedDamagesReason =
  | 'training_service_period'
  | 'confidentiality'
  | 'non_compete'
  | 'other'

export interface ContractReviewRuleInput {
  readonly contractType?: ContractType
  readonly contractMonths?: number | null
  readonly isOpenEnded?: boolean
  readonly probationMonths?: number | null
  readonly probationSalary?: number | null
  readonly locality?: string | null
  readonly nonCompeteMonths?: number | null
  readonly nonCompeteCompensation?: number | null
  readonly retainsIdentityDocument?: boolean | null
  readonly collectsProperty?: boolean | null
  readonly liquidatedDamagesReason?: LiquidatedDamagesReason | null
  readonly canonicalPages?: readonly ContractReviewCanonicalPage[]
}

export type ContractReviewRulePriority = 'priority_check' | 'insufficient_info'

export interface ContractReviewRuleEvidence {
  readonly pageNumber: number | null
  readonly excerpt: string
  readonly charStart: number | null
  readonly charEnd: number | null
}

export interface ContractReviewRuleFinding {
  readonly ruleId: string
  readonly rulePackVersion: typeof CONTRACT_RULE_PACK_VERSION
  readonly priority: ContractReviewRulePriority
  readonly title: string
  readonly explanation: string
  readonly basisRef: string
  readonly evidence: ContractReviewRuleEvidence
  readonly requiredFacts: readonly string[]
  readonly source: 'rule'
  readonly localityDatasetVersion?: null
}

interface LocatedEvidence {
  pageNumber: number
  excerpt: string
  charStart: number
  charEnd: number
}

interface FindingOptions {
  ruleId: string
  priority: ContractReviewRulePriority
  title: string
  explanation: string
  basisRef: string
  evidence?: LocatedEvidence
  requiredFacts?: readonly string[]
  localityDatasetVersion?: null
}

const EMPTY_EVIDENCE = Object.freeze({
  pageNumber: null,
  excerpt: '',
  charStart: null,
  charEnd: null,
})

const ALLOWED_PENALTY_REASONS: ReadonlySet<LiquidatedDamagesReason> = new Set([
  'training_service_period',
  'non_compete',
])

function sortedPages(
  pages: readonly ContractReviewCanonicalPage[] | undefined,
): readonly ContractReviewCanonicalPage[] {
  if (!Array.isArray(pages)) return []
  const seenPageNumbers = new Set<number>()
  const validated: Array<{ page: ContractReviewCanonicalPage; index: number }> = []
  for (const [index, candidate] of (pages as readonly unknown[]).entries()) {
    if (
      typeof candidate !== 'object' ||
      candidate === null ||
      !Number.isSafeInteger((candidate as ContractReviewCanonicalPage).pageNumber) ||
      (candidate as ContractReviewCanonicalPage).pageNumber < 1 ||
      typeof (candidate as ContractReviewCanonicalPage).text !== 'string'
    ) {
      return []
    }
    const page = candidate as ContractReviewCanonicalPage
    if (seenPageNumbers.has(page.pageNumber)) return []
    seenPageNumbers.add(page.pageNumber)
    validated.push({ page, index })
  }
  return validated
    .sort((left, right) => left.page.pageNumber - right.page.pageNumber || left.index - right.index)
    .map(({ page }) => page)
}

function chineseNumber(value: number): string | null {
  const digits = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九']
  if (!Number.isSafeInteger(value) || value < 0 || value > 99) return null
  if (value < 10) return digits[value] ?? null
  const tens = Math.floor(value / 10)
  const units = value % 10
  return `${tens === 1 ? '' : digits[tens]}十${units === 0 ? '' : digits[units]}`
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function hasUncertainSemantics(text: string): boolean {
  return /[?？]|是否|可能|或许|也许|视情况|拟|预计|暂定/u.test(text)
}

function durationEvidence(
  pages: readonly ContractReviewCanonicalPage[] | undefined,
  subject: '试用期' | '竞业限制',
  months: number,
): LocatedEvidence | undefined {
  const alternatives = [`${escapeRegex(String(months))}\\s*个?\\s*月`]
  const chinese = chineseNumber(months)
  if (chinese) alternatives.push(`${escapeRegex(chinese)}\\s*个?\\s*月`)
  const subjectPrefix =
    subject === '试用期'
      ? '试用期(?:期限)?(?:为|是|约定为)?'
      : '竞业限制(?:期限)?(?:为|是|约定为)?'
  const pattern = new RegExp(
    `${subjectPrefix}\\s*(?:${alternatives.join('|')})(?!\\s*(?:后|标准))`,
    'u',
  )
  for (const page of sortedPages(pages)) {
    for (const segment of sentenceSegments(page.text)) {
      const match = pattern.exec(segment.excerpt)
      if (!match || match.index < 0 || match[0].length === 0) continue
      const prefix = segment.excerpt.slice(0, match.index)
      const suffix = segment.excerpt.slice(match.index + match[0].length)
      const semanticPrefix = prefix.replace(/无固定期限/gu, '')
      const negatedBefore =
        /(?:并未|未|没有|从未|不曾|并非|不是|非|无意|无须|无需|不(?:予|再)?约定)[^，,。；;\n]{0,48}(?:约定)?$/u.test(
          semanticPrefix,
        )
      const negatedAfter =
        /并不存在|不存在|不成立|未生效|取消|撤销|撤回|废止|作废/u.test(suffix)
      if (negatedBefore || negatedAfter || hasUncertainSemantics(segment.excerpt)) continue
      const charStart = segment.charStart + match.index
      return {
        pageNumber: page.pageNumber,
        excerpt: match[0],
        charStart,
        charEnd: charStart + match[0].length,
      }
    }
  }
  return undefined
}

interface TextSegment {
  excerpt: string
  charStart: number
  charEnd: number
}

function segmentOf(text: string, charStart: number, charEnd: number): TextSegment | null {
  const raw = text.slice(charStart, charEnd)
  const leadingWhitespace = raw.length - raw.trimStart().length
  const excerpt = raw.trim()
  if (!excerpt) return null
  const trimmedStart = charStart + leadingWhitespace
  return { excerpt, charStart: trimmedStart, charEnd: trimmedStart + excerpt.length }
}

function* sentenceSegments(text: string): IterableIterator<TextSegment> {
  const boundaries = /[。；;\n]+/gu
  let segmentStart = 0
  for (const boundary of text.matchAll(boundaries)) {
    if (boundary.index === undefined) continue
    const segment = segmentOf(text, segmentStart, boundary.index)
    if (segment) yield segment
    segmentStart = boundary.index + boundary[0].length
  }
  const finalSegment = segmentOf(text, segmentStart, text.length)
  if (finalSegment) yield finalSegment
}

function* contrastSegments(text: string): IterableIterator<TextSegment> {
  const boundaries = /[，,。；;\n]+|但是|但|然而|不过/gu
  let segmentStart = 0
  for (const boundary of text.matchAll(boundaries)) {
    if (boundary.index === undefined) continue
    const segment = segmentOf(text, segmentStart, boundary.index)
    if (segment) yield segment
    segmentStart = boundary.index + boundary[0].length
  }
  const finalSegment = segmentOf(text, segmentStart, text.length)
  if (finalSegment) yield finalSegment
}

function hasNegatedAction(excerpt: string, action: '扣押' | '收取'): boolean {
  const actionIndex = excerpt.indexOf(action)
  if (actionIndex < 0) return false
  const prefix = excerpt.slice(Math.max(0, actionIndex - 28), actionIndex)
  const strongNegation =
    /(?:不得|禁止|严禁|无权|没有权限|没有权力|没有权利|并非有权|非有权|不具有|不应|不可|不予|无需|不必)[^，,。；;\n]{0,24}$/u
  const directNegation = /(?:未曾|从未|未|不)(?:再|予以)?\s*$/u
  return strongNegation.test(prefix) || directNegation.test(prefix)
}

type PartyRole = 'employer' | 'worker'
type PossessionKind = 'document' | 'property'

function leadingPartyRole(excerpt: string): PartyRole | null {
  const match = /^(?:如|若)?\s*(劳动者|乙方|员工|受聘方|甲方|用人单位|公司)/u.exec(excerpt)
  if (!match) return null
  return /^(?:劳动者|乙方|员工|受聘方)$/u.test(match[1] ?? '') ? 'worker' : 'employer'
}

function partyRoleBeforeAction(
  excerpt: string,
  actionIndex: number,
  inheritedRole: PartyRole | null,
): PartyRole | null {
  const party = /劳动者|乙方|员工|受聘方|甲方|用人单位|公司|雇主/gu
  const workers = new Set(['劳动者', '乙方', '员工', '受聘方'])
  const prefix = excerpt.slice(0, actionIndex)
  let nearestRole: PartyRole | null = null
  for (const match of prefix.matchAll(party)) {
    if (match.index === undefined) continue
    const beforeParty = prefix.slice(0, match.index)
    if (/(?:向|给|对|从)\s*$/u.test(beforeParty)) continue
    nearestRole = workers.has(match[0]) ? 'worker' : 'employer'
  }
  return nearestRole ?? inheritedRole
}

function hasWorkerDirection(excerpt: string, actionIndex: number, kind: PossessionKind): boolean {
  if (kind === 'document') {
    const worker = '(?:劳动者|乙方|员工|受聘方)'
    const directedWorker = new RegExp(`(?:向|从)\\s*${worker}(?:处)?\\s*$`, 'u').test(
      excerpt.slice(0, actionIndex),
    )
    return (
      directedWorker ||
      /(?:劳动者|乙方|员工|受聘方)(?:的)?[^，,。；;\n]{0,8}(?:身份证|居民身份证|证件|资格证|毕业证)/u.test(
        excerpt.slice(actionIndex),
      )
    )
  }
  const prefix = excerpt.slice(0, actionIndex)
  const suffix = excerpt.slice(actionIndex)
  const directRecipient = /(?:向|从)\s*(?:劳动者|乙方|员工|受聘方)(?:处)?\s*$/u.test(prefix)
  const workerOwnedProperty =
    /^收取\s*(?:(?:劳动者|乙方|员工|受聘方)(?:的)?)\s*[^，,。；;\n]{0,8}(?:押金|保证金|担保金|财物)/u.test(
      suffix,
    )
  const workerConditionBeforeEmployer =
    /(?:劳动者|乙方|员工|受聘方)[^，,。；;\n]{0,20}(?:未|违反)[^，,。；;\n]{0,20}(?:甲方|用人单位|公司)[^，,。；;\n]{0,12}$/u.test(
      prefix,
    )
  const collectedProperty = /^收取[^，,。；;\n]{0,12}(?:押金|保证金|担保金|财物)/u.test(suffix)
  return workerOwnedProperty || ((directRecipient || workerConditionBeforeEmployer) && collectedProperty)
}

function hasTrustedPossessionMarker(excerpt: string, actionIndex: number): boolean {
  if (hasUncertainSemantics(excerpt)) return false
  const prefix = excerpt.slice(0, actionIndex)
  const markerPattern = /有权|可以|应当|予以|须|将|可|应/gu
  let marker: RegExpMatchArray | undefined
  for (const match of prefix.matchAll(markerPattern)) marker = match
  if (!marker || marker.index === undefined) return false
  if (actionIndex - marker.index - marker[0].length > 12) return false
  let polarityStart = 0
  for (const employer of prefix.slice(0, marker.index).matchAll(/甲方|用人单位|公司|雇主/gu)) {
    if (employer.index !== undefined) polarityStart = employer.index + employer[0].length
  }
  const polarity = prefix.slice(polarityStart, marker.index)
  return !/不|未|无|非|毋|否/u.test(polarity)
}

function hasInheritablePossessionAuthority(excerpt: string): boolean {
  return hasTrustedPossessionMarker(excerpt, excerpt.length)
}

function locatePossessionEvidence(
  pages: readonly ContractReviewCanonicalPage[] | undefined,
  action: '扣押' | '收取',
  kind: PossessionKind,
): { evidence?: LocatedEvidence; sawCandidate: boolean } {
  const object =
    kind === 'document'
      ? /身份证|居民身份证|证件|资格证|毕业证/u
      : /押金|保证金|担保金|财物/u
  let sawCandidate = false
  for (const page of sortedPages(pages)) {
    let inheritedRole: PartyRole | null = null
    let inheritedAuthority = false
    for (const segment of contrastSegments(page.text)) {
      const actionIndex = segment.excerpt.indexOf(action)
      if (actionIndex < 0) {
        inheritedRole = leadingPartyRole(segment.excerpt) ?? inheritedRole
        inheritedAuthority = hasInheritablePossessionAuthority(segment.excerpt)
        continue
      }
      if (!object.test(segment.excerpt)) continue
      sawCandidate = true
      const role = partyRoleBeforeAction(segment.excerpt, actionIndex, inheritedRole)
      if (role) inheritedRole = role
      const hasAuthority =
        hasTrustedPossessionMarker(segment.excerpt, actionIndex) ||
        (inheritedAuthority && /^(?:并|且|以及)/u.test(segment.excerpt))
      if (
        role !== 'employer' ||
        !hasWorkerDirection(segment.excerpt, actionIndex, kind) ||
        !hasAuthority ||
        hasNegatedAction(segment.excerpt, action)
      ) {
        continue
      }
      return {
        sawCandidate,
        evidence: { pageNumber: page.pageNumber, ...segment },
      }
    }
  }
  return { sawCandidate }
}

function createFinding(options: FindingOptions): ContractReviewRuleFinding {
  if (!BASIS_ALLOWLIST.has(options.basisRef)) throw new TypeError('CONTRACT_RULE_BASIS_INVALID')
  if (options.priority === 'priority_check' && !options.evidence) {
    throw new TypeError('CONTRACT_RULE_PRIORITY_EVIDENCE_REQUIRED')
  }
  const evidence = options.evidence ? Object.freeze({ ...options.evidence }) : EMPTY_EVIDENCE
  return Object.freeze({
    ruleId: options.ruleId,
    rulePackVersion: CONTRACT_RULE_PACK_VERSION,
    priority: options.priority,
    title: options.title,
    explanation: options.explanation,
    basisRef: options.basisRef,
    evidence,
    requiredFacts: Object.freeze([...(options.requiredFacts ?? [])]),
    source: 'rule' as const,
    ...(options.localityDatasetVersion === null ? { localityDatasetVersion: null } : {}),
  })
}

function insufficient(options: Omit<FindingOptions, 'priority'>): ContractReviewRuleFinding {
  return createFinding({ ...options, priority: 'insufficient_info' })
}

function probationLimit(input: ContractReviewRuleInput): number | null {
  if (input.isOpenEnded !== undefined && typeof input.isOpenEnded !== 'boolean') return null
  if (input.isOpenEnded === true) {
    return input.contractMonths === undefined || input.contractMonths === null ? 6 : null
  }
  const months = input.contractMonths
  if (typeof months !== 'number' || !Number.isSafeInteger(months) || months <= 0) return null
  if (months < 3) return 0
  if (months < 12) return 1
  if (months < 36) return 2
  return 6
}

function evaluateProbation(input: ContractReviewRuleInput): ContractReviewRuleFinding[] {
  if (input.probationMonths === undefined) {
    return [
      insufficient({
        ruleId: 'labor.probation.term',
        title: '试用期期限信息需核实',
        explanation: '尚未取得是否约定试用期及其期限的完整事实，建议核实。',
        basisRef: 'labor-contract-law:19',
        requiredFacts: ['probationMonths'],
      }),
    ]
  }
  if (input.probationMonths === null) return []
  const probation = input.probationMonths
  const limit = probationLimit(input)
  if (!Number.isSafeInteger(probation) || probation < 0 || limit === null) {
    return [
      insufficient({
        ruleId: 'labor.probation.term',
        title: '试用期期限信息需核实',
        explanation: '缺少完整、有效的合同期限或试用期期限信息，建议核实。',
        basisRef: 'labor-contract-law:19',
        requiredFacts: ['contractMonthsOrOpenEnded', 'probationMonths'],
      }),
    ]
  }
  if (probation === 0) return []
  const evidence = durationEvidence(input.canonicalPages, '试用期', probation)
  if (!evidence) {
    return [
      insufficient({
        ruleId: 'labor.probation.term',
        title: '试用期期限信息需核实',
        explanation: '结构化期限与合同原文缺少可核验的一致证据，建议核实。',
        basisRef: 'labor-contract-law:19',
        requiredFacts: ['canonicalPages.exactProbationClause'],
      }),
    ]
  }
  if (probation <= limit) return []
  return [
    createFinding({
      ruleId: 'labor.probation.term',
      priority: 'priority_check',
      title: '建议核实试用期期限',
      explanation: '该约定与对应合同期限的法定试用期上限不一致，建议核实。',
      basisRef: 'labor-contract-law:19',
      evidence,
    }),
  ]
}

function evaluateLocality(input: ContractReviewRuleInput): ContractReviewRuleFinding[] {
  const findings: ContractReviewRuleFinding[] = []
  if (
    input.probationSalary !== null &&
    (input.probationSalary !== undefined || input.probationMonths !== null)
  ) {
    findings.push(
      insufficient({
        ruleId: 'labor.probation.local_wage',
        title: '试用期工资地域标准需核实',
        explanation: '当前未加载经签署的地域工资数据集，不能作确定性判断。',
        basisRef: 'labor-contract-law:20',
        requiredFacts: [
          ...(input.probationSalary === undefined ? ['probationSalary'] : []),
          'signedLocalityWageDataset',
        ],
        localityDatasetVersion: null,
      }),
    )
  }
  if (
    input.nonCompeteCompensation !== null &&
    (input.nonCompeteCompensation !== undefined || input.nonCompeteMonths !== null)
  ) {
    findings.push(
      insufficient({
        ruleId: 'labor.non_compete.compensation',
        title: '竞业限制补偿标准需核实',
        explanation: '当前未加载经签署的地域补偿数据集，不能作确定性判断。',
        basisRef: 'labor-contract-law:23',
        requiredFacts: [
          ...(input.nonCompeteCompensation === undefined ? ['nonCompeteCompensation'] : []),
          'signedNonCompeteCompensationDataset',
        ],
        localityDatasetVersion: null,
      }),
    )
  }
  return findings
}

function evaluateNonCompete(input: ContractReviewRuleInput): ContractReviewRuleFinding[] {
  const months = input.nonCompeteMonths
  if (months === undefined) {
    return [
      insufficient({
        ruleId: 'labor.non_compete.term',
        title: '竞业限制期限需核实',
        explanation: '尚未取得是否约定竞业限制及其期限的完整事实，建议核实。',
        basisRef: 'labor-contract-law:24',
        requiredFacts: ['nonCompeteMonths'],
      }),
    ]
  }
  if (months === null) return []
  if (!Number.isSafeInteger(months) || months < 0) {
    return [
      insufficient({
        ruleId: 'labor.non_compete.term',
        title: '竞业限制期限需核实',
        explanation: '竞业限制期限信息不完整，建议核实。',
        basisRef: 'labor-contract-law:24',
        requiredFacts: ['nonCompeteMonths'],
      }),
    ]
  }
  if (months === 0) return []
  const evidence = durationEvidence(input.canonicalPages, '竞业限制', months)
  if (!evidence) {
    return [
      insufficient({
        ruleId: 'labor.non_compete.term',
        title: '竞业限制期限需核实',
        explanation: '结构化期限与合同原文缺少可核验的一致证据，建议核实。',
        basisRef: 'labor-contract-law:24',
        requiredFacts: ['canonicalPages.exactNonCompeteClause'],
      }),
    ]
  }
  if (months <= 24) return []
  return [
    createFinding({
          ruleId: 'labor.non_compete.term',
          priority: 'priority_check',
          title: '建议核实竞业限制期限',
          explanation: '该期限与二十四个月的法定上限不一致，建议核实。',
          basisRef: 'labor-contract-law:24',
          evidence,
        }),
  ]
}

function evaluatePossession(input: ContractReviewRuleInput): ContractReviewRuleFinding[] {
  const checks = [
    {
      value: input.retainsIdentityDocument,
      ruleId: 'labor.documents.retention',
      title: '建议核实证件保管约定',
      actionText: '扣押' as const,
      kind: 'document' as const,
      requiredFact: 'canonicalPages.exactDocumentRetentionClause',
    },
    {
      value: input.collectsProperty,
      ruleId: 'labor.property.collection',
      title: '建议核实财物收取约定',
      actionText: '收取' as const,
      kind: 'property' as const,
      requiredFact: 'canonicalPages.exactPropertyCollectionClause',
    },
  ]
  return checks.flatMap((check) => {
    if (check.value === false) return []
    if (check.value !== true) {
      return [
        insufficient({
          ruleId: check.ruleId,
          title: check.title,
          explanation: '尚未取得该类条款是否存在的完整事实，建议核实。',
          basisRef: 'labor-contract-law:9',
          requiredFacts: [
            check.ruleId === 'labor.documents.retention'
              ? 'retainsIdentityDocument'
              : 'collectsProperty',
          ],
        }),
      ]
    }
    const located = locatePossessionEvidence(input.canonicalPages, check.actionText, check.kind)
    const evidence = located.evidence
    return [
      evidence
        ? createFinding({
            ruleId: check.ruleId,
            priority: 'priority_check',
            title: check.title,
            explanation: '该约定属于需要优先核实的用工条款，建议向专业人士确认。',
            basisRef: 'labor-contract-law:9',
            evidence,
          })
        : insufficient({
            ruleId: check.ruleId,
            title: check.title,
            explanation:
              located.sawCandidate
                ? '结构化事实与合同中的主体、方向或否定表述不一致，建议核实。'
                : '缺少可精确还原且能排除否定语境的合同原文，建议核实。',
            basisRef: 'labor-contract-law:9',
            requiredFacts: [check.requiredFact],
          }),
    ]
  })
}

function* penaltySegments(text: string): IterableIterator<TextSegment> {
  yield* sentenceSegments(text)
}

function locateWorkerPenaltyEvidence(
  pages: readonly ContractReviewCanonicalPage[] | undefined,
  reason: 'other' | 'confidentiality',
): { evidence?: LocatedEvidence; sawScopeConflict: boolean } {
  const party = /劳动者|乙方|员工|受聘方|甲方|用人单位|公司|雇主/gu
  const workers = new Set(['劳动者', '乙方', '员工', '受聘方'])
  const affirmativeObligation = /(?:应当|应|须|需要|需|必须|将)[^，,。；;\n]{0,16}(?:支付|承担)[^，,。；;\n]{0,16}违约金/gu
  let sawScopeConflict = false
  for (const page of sortedPages(pages)) {
    for (const segment of penaltySegments(page.text)) {
      const excerpt = segment.excerpt
      for (const obligation of excerpt.matchAll(affirmativeObligation)) {
        if (obligation.index === undefined) continue
        const commaStart = Math.max(
          excerpt.lastIndexOf('，', obligation.index - 1),
          excerpt.lastIndexOf(',', obligation.index - 1),
        )
        const nextChineseComma = excerpt.indexOf('，', obligation.index)
        const nextAsciiComma = excerpt.indexOf(',', obligation.index)
        const commaEnds = [nextChineseComma, nextAsciiComma].filter((index) => index >= 0)
        const commaEnd = commaEnds.length > 0 ? Math.min(...commaEnds) : excerpt.length
        const localClause = excerpt.slice(commaStart + 1, commaEnd)
        if (hasUncertainSemantics(localClause)) continue
        const actionOffset = obligation[0].search(/支付|承担/u)
        if (actionOffset < 0) continue
        const actionIndex = obligation.index + actionOffset
        const localPrefix = excerpt.slice(Math.max(0, obligation.index - 8), obligation.index)
        const modalToAction = excerpt.slice(obligation.index, actionIndex)
        const hasNegativePolarity =
          /(?:不|未|无|非|毋|否)[^，,。；;\n]{0,4}$/u.test(localPrefix) ||
          /不|未|无|非|毋|否/u.test(modalToAction)
        if (hasNegativePolarity) continue
        let nearestParty: string | undefined
        let nearestPartyIndex = -1
        const payerPrefix = excerpt.slice(0, actionIndex)
        for (const partyMatch of payerPrefix.matchAll(party)) {
          if (partyMatch.index === undefined) continue
          const beforeParty = payerPrefix.slice(0, partyMatch.index)
          if (/(?:向|给|对)\s*$/u.test(beforeParty)) continue
          nearestParty = partyMatch[0]
          nearestPartyIndex = partyMatch.index
        }
        if (!nearestParty || !workers.has(nearestParty)) continue
        const evidence = {
          pageNumber: page.pageNumber,
          excerpt: excerpt.slice(nearestPartyIndex),
          charStart: segment.charStart + nearestPartyIndex,
          charEnd: segment.charEnd,
        }
        if (!penaltyEvidenceMatchesReason(reason, evidence)) {
          sawScopeConflict = true
          continue
        }
        return { evidence, sawScopeConflict }
      }
    }
  }
  return { sawScopeConflict }
}

function penaltyEvidenceMatchesReason(
  reason: 'other' | 'confidentiality',
  evidence: LocatedEvidence,
): boolean {
  if (reason === 'confidentiality') {
    return /保密/u.test(evidence.excerpt) && !/竞业(?:限制)?|培训|服务期/u.test(evidence.excerpt)
  }
  return !/保密|竞业(?:限制)?|培训|服务期/u.test(evidence.excerpt)
}

function evaluatePenalty(input: ContractReviewRuleInput): ContractReviewRuleFinding[] {
  const reason = input.liquidatedDamagesReason
  if (reason === null) return []
  if (reason === undefined) {
    return [
      insufficient({
        ruleId: 'labor.penalty.scope',
        title: '违约金适用范围需核实',
        explanation: '尚未取得是否约定违约金及其适用原因的完整事实，建议核实。',
        basisRef: 'labor-contract-law:25',
        requiredFacts: ['liquidatedDamagesReason'],
      }),
    ]
  }
  if (ALLOWED_PENALTY_REASONS.has(reason)) return []
  if (reason !== 'other' && reason !== 'confidentiality') {
    return [
      insufficient({
        ruleId: 'labor.penalty.scope',
        title: '违约金适用范围需核实',
        explanation: '违约金适用原因信息不完整，不能作确定性判断。',
        basisRef: 'labor-contract-law:25',
        requiredFacts: ['liquidatedDamagesReason'],
      }),
    ]
  }
  const located = locateWorkerPenaltyEvidence(input.canonicalPages, reason)
  const evidence = located.evidence
  return [
    evidence
      ? createFinding({
          ruleId: 'labor.penalty.scope',
          priority: 'priority_check',
          title: '建议核实违约金适用范围',
          explanation: '该违约金约定未落入培训服务期或竞业限制范围，建议核实。',
          basisRef: 'labor-contract-law:25',
          evidence,
        })
      : insufficient({
          ruleId: 'labor.penalty.scope',
          title: '违约金适用范围需核实',
          explanation: located.sawScopeConflict
            ? '结构化适用原因与合同原文所述范围不一致，建议核实。'
            : '缺少可精确还原且能绑定劳动者义务的违约金原文，不能作确定性判断。',
          basisRef: 'labor-contract-law:25',
          requiredFacts: ['canonicalPages.exactLiquidatedDamagesClause'],
        }),
  ]
}

export class ContractReviewRuleEngine {
  evaluate(input: ContractReviewRuleInput): readonly ContractReviewRuleFinding[] {
    if (!input || typeof input !== 'object' || input.contractType !== 'labor_contract') {
      return Object.freeze([])
    }
    const findings = [
      ...evaluateProbation(input),
      ...evaluateLocality(input),
      ...evaluateNonCompete(input),
      ...evaluatePossession(input),
      ...evaluatePenalty(input),
    ]
    return Object.freeze(findings)
  }
}
