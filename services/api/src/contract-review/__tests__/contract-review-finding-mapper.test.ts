import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ContractReviewFindingMapper,
  type ContractReviewComposeResultInput,
} from '../contract-review-finding-mapper'
import type { ContractModelDraft } from '../contract-review-provider.service'
import type { ContractReviewRuleFinding } from '../contract-review-rule-engine'
import { CONTRACT_RULE_PACK_VERSION } from '../contract-review.rules'
import type { ContractReviewFinding } from '../contract-review.types'

const mapper = new ContractReviewFindingMapper()

const RULE_CASES = [
  ['labor.probation.term', 'probation', '合同期限与试用期期限分别是多少？'],
  ['labor.probation.local_wage', 'compensation', '试用期工资标准及工作所在地分别是什么？'],
  ['labor.non_compete.compensation', 'non_compete', '竞业限制补偿标准、支付周期和所在地规则是什么？'],
  ['labor.non_compete.term', 'non_compete', '竞业限制期限是多少？'],
  ['labor.documents.retention', 'deposit_documents', '用人单位是否会扣押或保管劳动者身份证件？'],
  ['labor.property.collection', 'deposit_documents', '用人单位是否会向劳动者收取押金、保证金或其他财物？'],
  ['labor.penalty.scope', 'penalty', '违约金对应的具体事项是什么？'],
] as const

function rule(ruleId: string, index = 0): ContractReviewRuleFinding {
  const excerpt = `条款${index}`
  return {
    ruleId,
    rulePackVersion: CONTRACT_RULE_PACK_VERSION,
    priority: 'priority_check',
    title: `标题${index}`,
    explanation: `说明${index}`,
    basisRef: 'labor-contract-law:19',
    evidence: { pageNumber: 1, excerpt, charStart: index, charEnd: index + excerpt.length },
    requiredFacts: Object.freeze([]),
    source: 'rule',
  }
}

function aiDraft(overrides: Partial<ContractModelDraft['findings'][number]> = {}): ContractModelDraft {
  return {
    findings: [
      {
        category: 'imbalance',
        priority: 'attention',
        title: '建议核实单方调整条款',
        pageNumber: 1,
        excerpt: '😀单方调整工作地点',
        explanation: '建议确认调整边界。',
        basisRef: null,
        verificationQuestion: '调整是否需要协商？',
        uncertainty: '仍需结合完整合同核实。',
        ...overrides,
      },
    ],
  }
}

test('maps the exact seven rule ids through a fixed category and question allowlist', () => {
  const inputs = RULE_CASES.map(([ruleId], index) => rule(ruleId, index))
  const snapshot = structuredClone(inputs)
  const mapped = mapper.mapRules(inputs)

  assert.equal(mapped.length, RULE_CASES.length)
  for (let index = 0; index < mapped.length; index += 1) {
    const actual = mapped[index]!
    const input = inputs[index]!
    const [ruleId, category, verificationQuestion] = RULE_CASES[index]!
    assert.deepEqual(actual, {
      id: ruleId,
      category,
      priority: input.priority,
      title: input.title,
      evidence: input.evidence,
      explanation: input.explanation,
      basisRef: input.basisRef,
      verificationQuestion,
      uncertainty: '',
      source: 'rule',
    })
    assert.equal(Object.isFrozen(actual), true)
    assert.equal(Object.isFrozen(actual.evidence), true)
  }
  assert.equal(Object.isFrozen(mapped), true)
  assert.deepEqual(inputs, snapshot)
})

test('rejects unknown, duplicate, or wrong-version authoritative rules', () => {
  for (const input of [
    [rule('labor.unknown')],
    [rule('labor.probation.term'), rule('labor.probation.term', 1)],
    [{ ...rule('labor.probation.term'), rulePackVersion: 'future-pack' }],
  ]) {
    assert.throws(
      () => mapper.mapRules(input as readonly ContractReviewRuleFinding[]),
      (error) => error instanceof Error && error.message === 'CONTRACT_REVIEW_RULE_MAPPING_INVALID',
    )
  }
})

test('maps AI evidence only from a unique exact masked-page match using UTF-16 offsets', () => {
  const pages = [{ pageNumber: 1, text: '前😀单方调整工作地点后' }]
  const draft = aiDraft()
  const snapshot = structuredClone(draft)
  const mapped = mapper.mapAi(draft, pages)

  assert.equal(mapped.length, 1)
  assert.deepEqual(mapped[0]!.evidence, {
    pageNumber: 1,
    excerpt: '😀单方调整工作地点',
    charStart: 1,
    charEnd: 11,
  })
  assert.equal(mapped[0]!.source, 'ai')
  assert.match(mapped[0]!.id, /^ai-[0-9]{4}-[a-z_]+-[a-z_]+$/u)
  assert.ok(mapped[0]!.id.length <= 64)
  assert.equal(mapped[0]!.id.includes('单方'), false)
  assert.equal(Object.isFrozen(mapped), true)
  assert.equal(Object.isFrozen(mapped[0]), true)
  assert.equal(Object.isFrozen(mapped[0]!.evidence), true)
  assert.deepEqual(draft, snapshot)
})

test('creates empty evidence only for page-less insufficient-information drafts', () => {
  const mapped = mapper.mapAi(
    aiDraft({ priority: 'insufficient_info', pageNumber: null, excerpt: '模型声称存在但无法定位的摘录' }),
    [{ pageNumber: 1, text: '正文' }],
  )
  assert.deepEqual(mapped[0]!.evidence, {
    pageNumber: null,
    excerpt: '',
    charStart: null,
    charEnd: null,
  })

  assert.throws(
    () => mapper.mapAi(aiDraft({ pageNumber: null, excerpt: '' }), [{ pageNumber: 1, text: '正文' }]),
    (error) => error instanceof Error && error.message === 'CONTRACT_REVIEW_AI_MAPPING_INVALID',
  )
})

test('rejects absent, repeated, or mismatched AI evidence and rule-id collisions', () => {
  const draft = aiDraft()
  const first = mapper.mapAi(draft, [{ pageNumber: 1, text: '😀单方调整工作地点' }])

  for (const action of [
    () => mapper.mapAi(draft, [{ pageNumber: 2, text: '😀单方调整工作地点' }]),
    () => mapper.mapAi(draft, [{ pageNumber: 1, text: '没有对应摘录' }]),
    () => mapper.mapAi(draft, [{ pageNumber: 1, text: '😀单方调整工作地点；😀单方调整工作地点' }]),
    () => mapper.mapAi(draft, [{ pageNumber: 1, text: '😀单方调整工作地点' }], [first[0]!.id]),
  ]) {
    assert.throws(
      action,
      (error) => error instanceof Error && error.message === 'CONTRACT_REVIEW_AI_MAPPING_INVALID',
    )
  }
})

test('AI ids are deterministic by index metadata and do not include body text', () => {
  const first = mapper.mapAi(aiDraft(), [{ pageNumber: 1, text: '😀单方调整工作地点' }])
  const second = mapper.mapAi(
    aiDraft({
      title: '另一标题',
      excerpt: '另一段唯一摘录',
      explanation: '另一说明',
      verificationQuestion: '另一个问题？',
      uncertainty: '另一不确定性。',
    }),
    [{ pageNumber: 1, text: '另一段唯一摘录' }],
  )
  assert.equal(first[0]!.id, second[0]!.id)
})

test('composes exact server truth and counts without dropping rule or AI findings', () => {
  const ruleFindings = mapper.mapRules([rule('labor.probation.term')])
  const aiFindings = mapper.mapAi(aiDraft(), [{ pageNumber: 1, text: '😀单方调整工作地点' }])
  const input: ContractReviewComposeResultInput = {
    ruleFindings,
    aiFindings,
    coverage: 'truncated',
    ocrConfidence: 'medium',
    disclaimerVersion: 'contract-review-v3',
  }
  const result = mapper.composeResult(input)

  assert.deepEqual(result, {
    priorityCheckCount: 1,
    attentionCount: 1,
    insufficientInfoCount: 0,
    coverage: 'truncated',
    ocrConfidence: 'medium',
    disclaimerVersion: 'contract-review-v3',
    rulePackVersion: CONTRACT_RULE_PACK_VERSION,
    generatedByAi: true,
    findings: [...ruleFindings, ...aiFindings],
  })
  assert.equal(Object.isFrozen(result), true)
  assert.equal(Object.isFrozen(result.findings), true)
})

test('rejects the whole result above 100 findings and never silently truncates AI', () => {
  const base = mapper.mapAi(aiDraft(), [{ pageNumber: 1, text: '😀单方调整工作地点' }])[0]!
  const aiFindings = Array.from({ length: 100 }, (_, index) => ({
    ...base,
    id: `ai-overflow-${index}`,
  })) as ContractReviewFinding[]

  assert.throws(
    () => mapper.composeResult({
      ruleFindings: mapper.mapRules([rule('labor.probation.term')]),
      aiFindings,
      coverage: 'complete',
      ocrConfidence: 'high',
      disclaimerVersion: 'v1',
    }),
    (error) => error instanceof Error && error.message === 'CONTRACT_REVIEW_RESULT_OVERFLOW',
  )
})

test('rejects duplicate ids while composing the result', () => {
  const finding = mapper.mapRules([rule('labor.probation.term')])[0]!
  assert.throws(
    () => mapper.composeResult({
      ruleFindings: [finding],
      aiFindings: [{ ...finding, source: 'ai' }],
      coverage: 'complete',
      ocrConfidence: 'high',
      disclaimerVersion: 'v1',
    }),
    (error) => error instanceof Error && error.message === 'CONTRACT_REVIEW_RESULT_ID_CONFLICT',
  )
})
