import type { ContractMaskPage } from './contract-review-pii-masker'
import type { ContractReviewRuleInput, LiquidatedDamagesReason } from './contract-review-rule-engine'

type MergedFactKey =
  | 'contractMonths'
  | 'isOpenEnded'
  | 'probationMonths'
  | 'nonCompeteMonths'
  | 'retainsIdentityDocument'
  | 'collectsProperty'
  | 'liquidatedDamagesReason'

export type ContractReviewMergedFacts = Readonly<
  Pick<ContractReviewRuleInput, MergedFactKey>
>

export interface ContractReviewFactMergeResult {
  readonly facts: ContractReviewMergedFacts
  readonly hasFieldConflict: boolean
}

type FactValue = number | boolean | null | LiquidatedDamagesReason
type CandidateMap = Record<MergedFactKey, Map<string, FactValue>>

const MAX_PAGES = 50
const MAX_PAGE_CODE_UNITS = 200_000
const MAX_TOTAL_CODE_UNITS = 2_000_000

const NUMBER_TOKEN =
  '(?:[1-9][0-9]{0,2}|零|〇|一|二|两|三|四|五|六|七|八|九|十|十一|十二|十三|十四|十五|十六|十七|十八|十九|二十|二十一|二十二|二十三|二十四|二十五|二十六|二十七|二十八|二十九|三十|四十|五十|六十|七十|八十|九十)'

const EMPLOYER = '(?:甲方|用人单位|公司|雇主|\\[用人单位_[1-9][0-9]*\\])'
const WORKER = '(?:乙方|劳动者|员工|受聘方|\\[劳动者_[1-9][0-9]*\\])'
const NEGATION =
  /(?:不得|禁止|严禁|不可|不应|无权|未曾|从未|未|不予|不)[^，,。；;\n]{0,12}$/u

function emptyCandidates(): CandidateMap {
  return {
    contractMonths: new Map(),
    isOpenEnded: new Map(),
    probationMonths: new Map(),
    nonCompeteMonths: new Map(),
    retainsIdentityDocument: new Map(),
    collectsProperty: new Map(),
    liquidatedDamagesReason: new Map(),
  }
}

function candidateKey(value: FactValue): string {
  return value === null ? 'null' : `${typeof value}:${String(value)}`
}

function addCandidate<K extends MergedFactKey>(
  candidates: CandidateMap,
  field: K,
  value: NonNullable<ContractReviewMergedFacts[K]> | null,
): void {
  candidates[field].set(candidateKey(value as FactValue), value as FactValue)
}

function parseChineseNumber(token: string): number | undefined {
  const digitValues: Readonly<Record<string, number>> = Object.freeze({
    零: 0,
    〇: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  })
  if (Object.prototype.hasOwnProperty.call(digitValues, token)) return digitValues[token]
  const tenIndex = token.indexOf('十')
  if (tenIndex < 0 || token.indexOf('十', tenIndex + 1) >= 0) return undefined
  const tensToken = token.slice(0, tenIndex)
  const unitsToken = token.slice(tenIndex + 1)
  const tens = tensToken === '' ? 1 : digitValues[tensToken]
  const units = unitsToken === '' ? 0 : digitValues[unitsToken]
  if (tens === undefined || units === undefined || tens === 0) return undefined
  return tens * 10 + units
}

function parseNumber(token: string): number | undefined {
  if (/^[1-9][0-9]{0,2}$/u.test(token)) return Number(token)
  return parseChineseNumber(token)
}

function addDurations(
  candidates: CandidateMap,
  text: string,
  field: 'contractMonths' | 'probationMonths' | 'nonCompeteMonths',
  subject: string,
  maxMonths: number,
): void {
  const pattern = new RegExp(
    `${subject}(?:期限)?(?:\\s*为|\\s*是|\\s*约定为|\\s*[：:])?\\s*(${NUMBER_TOKEN})\\s*(年|个?月)`,
    'gu',
  )
  for (const match of text.matchAll(pattern)) {
    const amount = parseNumber(match[1] ?? '')
    if (amount === undefined || amount <= 0) continue
    const months = match[2] === '年' ? amount * 12 : amount
    if (!Number.isSafeInteger(months) || months > maxMonths) continue
    addCandidate(candidates, field, months)
  }
}

function sentenceSegments(text: string): readonly string[] {
  return text.split(/[。；;\n]+/u).map((value) => value.trim()).filter(Boolean)
}

function addTermFacts(candidates: CandidateMap, text: string): void {
  if (/无固定期限(?:劳动)?合同/u.test(text)) addCandidate(candidates, 'isOpenEnded', true)
  const withoutOpenEnded = text.replace(/无固定期限/gu, '')
  if (/(?:固定期限(?:劳动)?合同|(?:劳动)?合同为固定期限)/u.test(withoutOpenEnded)) {
    addCandidate(candidates, 'isOpenEnded', false)
  }
  addDurations(candidates, text, 'contractMonths', '(?:劳动)?合同(?:的)?期限', 600)
}

function addOptionalDurationFacts(candidates: CandidateMap, text: string): void {
  if (/(?:不|未|没有|无)(?:再)?(?:约定|设置)?试用期/u.test(text)) {
    addCandidate(candidates, 'probationMonths', null)
  }
  if (/(?:不|未|没有|无)(?:再)?(?:约定|设置)?竞业限制/u.test(text)) {
    addCandidate(candidates, 'nonCompeteMonths', null)
  }
  addDurations(candidates, text, 'probationMonths', '试用期', 12)
  addDurations(candidates, text, 'nonCompeteMonths', '竞业限制', 120)
}

function actionPolarity(segment: string, actionIndex: number): boolean {
  const prefix = segment.slice(Math.max(0, actionIndex - 16), actionIndex)
  return !NEGATION.test(prefix)
}

function addPossessionFacts(candidates: CandidateMap, segment: string): void {
  const documentPattern = new RegExp(
    `${EMPLOYER}[^。；;\\n]{0,48}?(扣押|保管)[^。；;\\n]{0,24}(?:${WORKER}[^。；;\\n]{0,12})?(?:身份证(?:件)?|居民身份证|证件|资格证|学历证)`,
    'gu',
  )
  for (const match of segment.matchAll(documentPattern)) {
    if (match.index === undefined) continue
    const actionOffset = match[0].indexOf(match[1] ?? '')
    if (actionOffset < 0) continue
    addCandidate(
      candidates,
      'retainsIdentityDocument',
      actionPolarity(segment, match.index + actionOffset),
    )
  }

  const propertyPattern = new RegExp(
    `${EMPLOYER}[^。；;\\n]{0,64}?(收取|缴纳|交纳)[^。；;\\n]{0,24}(?:${WORKER}[^。；;\\n]{0,12})?(?:押金|保证金|担保金|财物|费用)`,
    'gu',
  )
  for (const match of segment.matchAll(propertyPattern)) {
    if (match.index === undefined) continue
    const actionOffset = match[0].indexOf(match[1] ?? '')
    if (actionOffset < 0) continue
    addCandidate(
      candidates,
      'collectsProperty',
      actionPolarity(segment, match.index + actionOffset),
    )
  }
}

function addPenaltyFacts(candidates: CandidateMap, segment: string): void {
  if (/(?:不|未|没有|无)(?:再)?(?:约定|设置|承担|支付)?违约金/u.test(segment)) {
    addCandidate(candidates, 'liquidatedDamagesReason', null)
  }
  const obligation = new RegExp(
    `${WORKER}[^。；;\\n]{0,80}(?:应当|应|须|必须|需要)[^。；;\\n]{0,24}(?:支付|承担)[^。；;\\n]{0,24}违约金`,
    'u',
  )
  if (!obligation.test(segment)) return
  if (/专项培训|培训服务期|服务期/u.test(segment)) {
    addCandidate(candidates, 'liquidatedDamagesReason', 'training_service_period')
  } else if (/竞业(?:限制)?/u.test(segment)) {
    addCandidate(candidates, 'liquidatedDamagesReason', 'non_compete')
  } else if (/保密/u.test(segment)) {
    addCandidate(candidates, 'liquidatedDamagesReason', 'confidentiality')
  } else {
    addCandidate(candidates, 'liquidatedDamagesReason', 'other')
  }
}

function validatePages(pages: readonly ContractMaskPage[]): void {
  if (!Array.isArray(pages) || pages.length < 1 || pages.length > MAX_PAGES) {
    throw new Error('CONTRACT_REVIEW_FACT_INPUT_INVALID')
  }
  let total = 0
  for (let index = 0; index < pages.length; index += 1) {
    const page = pages[index] as unknown
    if (
      typeof page !== 'object' ||
      page === null ||
      (page as ContractMaskPage).pageNumber !== index + 1 ||
      typeof (page as ContractMaskPage).text !== 'string'
    ) {
      throw new Error('CONTRACT_REVIEW_FACT_INPUT_INVALID')
    }
    const text = (page as ContractMaskPage).text
    if (text.length > MAX_PAGE_CODE_UNITS || text !== text.normalize('NFC') || /\r/u.test(text)) {
      throw new Error('CONTRACT_REVIEW_FACT_INPUT_INVALID')
    }
    total += text.length
    if (!Number.isSafeInteger(total) || total > MAX_TOTAL_CODE_UNITS) {
      throw new Error('CONTRACT_REVIEW_FACT_INPUT_INVALID')
    }
  }
}

function finalize(candidates: CandidateMap): ContractReviewFactMergeResult {
  const facts: Partial<Record<MergedFactKey, FactValue>> = {}
  let hasFieldConflict = false
  for (const field of Object.keys(candidates) as MergedFactKey[]) {
    const values = [...candidates[field].values()]
    if (values.length > 1) {
      hasFieldConflict = true
      continue
    }
    if (values.length === 1) facts[field] = values[0]
  }
  if (candidates.isOpenEnded.has(candidateKey(true)) && candidates.contractMonths.size > 0) {
    delete facts.isOpenEnded
    delete facts.contractMonths
    hasFieldConflict = true
  }
  return Object.freeze({
    facts: Object.freeze(facts as ContractReviewMergedFacts),
    hasFieldConflict,
  })
}

export class ContractReviewFactMerger {
  merge(pages: readonly ContractMaskPage[]): ContractReviewFactMergeResult {
    validatePages(pages)
    const candidates = emptyCandidates()
    for (const page of pages) {
      addTermFacts(candidates, page.text)
      addOptionalDurationFacts(candidates, page.text)
      for (const segment of sentenceSegments(page.text)) {
        addPossessionFacts(candidates, segment)
        addPenaltyFacts(candidates, segment)
      }
    }
    return finalize(candidates)
  }
}
