import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ContractReviewRuleEngine,
  type ContractReviewRuleInput,
} from '../contract-review-rule-engine'
import { BASIS_ALLOWLIST, CONTRACT_RULE_PACK_VERSION } from '../contract-review.rules'

const engine = new ContractReviewRuleEngine()

function page(text: string, pageNumber = 1) {
  return { pageNumber, text }
}

function probationFinding(contractMonths: number | null, probationMonths: number) {
  const duration = probationMonths === 1 ? '一个月' : `${probationMonths}个月`
  return engine
    .evaluate({
      contractType: 'labor_contract',
      contractMonths,
      isOpenEnded: contractMonths === null,
      probationMonths,
      canonicalPages: [page(`双方约定试用期${duration}。`)],
    })
    .find((finding) => finding.ruleId === 'labor.probation.term')
}

test('probation term applies every statutory P0 boundary', () => {
  for (const sample of [
    { contractMonths: 2, probationMonths: 1 },
    { contractMonths: 3, probationMonths: 2 },
    { contractMonths: 11, probationMonths: 2 },
    { contractMonths: 12, probationMonths: 3 },
    { contractMonths: 35, probationMonths: 3 },
    { contractMonths: 36, probationMonths: 7 },
    { contractMonths: null, probationMonths: 7 },
  ]) {
    assert.equal(
      probationFinding(sample.contractMonths, sample.probationMonths)?.priority,
      'priority_check',
      JSON.stringify(sample),
    )
  }

  for (const sample of [
    { contractMonths: 2, probationMonths: 0 },
    { contractMonths: 3, probationMonths: 1 },
    { contractMonths: 11, probationMonths: 1 },
    { contractMonths: 12, probationMonths: 2 },
    { contractMonths: 35, probationMonths: 2 },
    { contractMonths: 36, probationMonths: 6 },
    { contractMonths: null, probationMonths: 6 },
  ]) {
    assert.equal(probationFinding(sample.contractMonths, sample.probationMonths), undefined)
  }
})

test('incomplete probation facts or missing exact evidence fail closed', () => {
  const incomplete = engine.evaluate({
    contractType: 'labor_contract',
    probationMonths: 3,
    canonicalPages: [page('双方约定试用期三个月。')],
  })
  assert.equal(
    incomplete.find((finding) => finding.ruleId === 'labor.probation.term')?.priority,
    'insufficient_info',
  )

  const noEvidence = engine.evaluate({
    contractType: 'labor_contract',
    contractMonths: 12,
    probationMonths: 3,
    canonicalPages: [page('劳动合同正文未记载对应原文。')],
  })
  assert.equal(
    noEvidence.find((finding) => finding.ruleId === 'labor.probation.term')?.priority,
    'insufficient_info',
  )

  for (const malformed of [Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5, 2 ** 53]) {
    const output = engine.evaluate({
      contractType: 'labor_contract',
      contractMonths: 12,
      probationMonths: malformed,
      canonicalPages: [page(`试用期${malformed}个月。`)],
    })
    assert.equal(output.some((finding) => finding.priority === 'priority_check'), false)
  }

  for (const contractMonths of [Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5, 2 ** 53]) {
    const output = engine.evaluate({
      contractType: 'labor_contract',
      contractMonths,
      probationMonths: 3,
      canonicalPages: [page('试用期三个月。')],
    })
    assert.equal(output.some((finding) => finding.priority === 'priority_check'), false)
  }

  const contradictory = engine.evaluate({
    contractType: 'labor_contract',
    contractMonths: 12,
    isOpenEnded: true,
    probationMonths: 7,
    canonicalPages: [page('试用期七个月。')],
  })
  assert.equal(contradictory.some((finding) => finding.priority === 'priority_check'), false)
})

test('non-compete duration over 24 months is a priority check with exact evidence', () => {
  const text = '双方约定竞业限制期限为25个月。'
  const finding = engine
    .evaluate({
      contractType: 'labor_contract',
      nonCompeteMonths: 25,
      canonicalPages: [page(text, 2)],
    })
    .find((item) => item.ruleId === 'labor.non_compete.term')

  assert.equal(finding?.priority, 'priority_check')
  assert.equal(finding?.basisRef, 'labor-contract-law:24')
  assert.equal(finding?.evidence.pageNumber, 2)
  assert.equal(text.slice(finding!.evidence.charStart!, finding!.evidence.charEnd!), finding?.evidence.excerpt)

  for (const malformed of [Number.NaN, Number.POSITIVE_INFINITY, -1, 24.5, 2 ** 53]) {
    const output = engine.evaluate({
      contractType: 'labor_contract',
      nonCompeteMonths: malformed,
      canonicalPages: [page(`竞业限制期限为${malformed}个月。`)],
    })
    assert.equal(output.some((item) => item.priority === 'priority_check'), false)
  }
})

test('duration evidence must state the duration itself rather than a start or payment context', () => {
  for (const text of [
    '试用期在合同生效3个月后开始。',
    '试用期工资按三个月标准发放。',
    '试用期十三个月。',
    '试用期不得超过三个月。',
  ]) {
    const finding = engine
      .evaluate({
        contractType: 'labor_contract',
        contractMonths: 12,
        probationMonths: 3,
        canonicalPages: [page(text)],
      })
      .find((item) => item.ruleId === 'labor.probation.term')
    assert.equal(finding?.priority, 'insufficient_info', text)
  }

  for (const text of [
    '竞业限制在合同解除25个月后开始。',
    '竞业限制补偿按25个月标准支付。',
    '竞业限制不得超过25个月。',
  ]) {
    const finding = engine
      .evaluate({
        contractType: 'labor_contract',
        nonCompeteMonths: 25,
        canonicalPages: [page(text)],
      })
      .find((item) => item.ruleId === 'labor.non_compete.term')
    assert.equal(finding?.priority, 'insufficient_info', text)
  }

  for (const sample of [
    { text: '试用期三个月。', contractMonths: 12, probationMonths: 3 },
    { text: '试用期为三个月。', contractMonths: 12, probationMonths: 3 },
  ]) {
    const finding = engine
      .evaluate({
        contractType: 'labor_contract',
        contractMonths: sample.contractMonths,
        probationMonths: sample.probationMonths,
        canonicalPages: [page(sample.text)],
      })
      .find((item) => item.ruleId === 'labor.probation.term')!
    assert.equal(finding.priority, 'priority_check')
    assert.equal(
      sample.text.slice(finding.evidence.charStart!, finding.evidence.charEnd!),
      finding.evidence.excerpt,
    )
  }
})

test('duration evidence rejects nearby negation and contrast context', () => {
  for (const text of [
    '双方并未约定试用期三个月。',
    '双方约定的并非试用期三个月，而是一个月。',
  ]) {
    const finding = engine
      .evaluate({
        contractType: 'labor_contract',
        contractMonths: 12,
        probationMonths: 3,
        canonicalPages: [page(text)],
      })
      .find((item) => item.ruleId === 'labor.probation.term')
    assert.equal(finding?.priority, 'insufficient_info', text)
  }
})

test('document and property rules distinguish affirmative text from negation', () => {
  const affirmative = engine.evaluate({
    contractType: 'labor_contract',
    retainsIdentityDocument: true,
    collectsProperty: true,
    canonicalPages: [page('甲方有权扣押乙方身份证，并向乙方收取押金。')],
  })
  assert.equal(
    affirmative.find((finding) => finding.ruleId === 'labor.documents.retention')?.priority,
    'priority_check',
  )
  assert.equal(
    affirmative.find((finding) => finding.ruleId === 'labor.property.collection')?.priority,
    'priority_check',
  )

  const negated = engine.evaluate({
    contractType: 'labor_contract',
    retainsIdentityDocument: true,
    collectsProperty: true,
    canonicalPages: [page('甲方不得扣押乙方身份证，也不得以任何名义向乙方收取押金。')],
  })
  assert.equal(
    negated.some((finding) => finding.ruleId === 'labor.documents.retention' && finding.priority === 'priority_check'),
    false,
  )
  assert.equal(
    negated.some((finding) => finding.ruleId === 'labor.property.collection' && finding.priority === 'priority_check'),
    false,
  )
  assert.equal(
    negated.find((finding) => finding.ruleId === 'labor.documents.retention')?.priority,
    'insufficient_info',
  )
  assert.equal(
    negated.find((finding) => finding.ruleId === 'labor.property.collection')?.priority,
    'insufficient_info',
  )
})

test('possession rules scan beyond negated clauses and narrowly bind negation to the action', () => {
  const output = engine.evaluate({
    contractType: 'labor_contract',
    retainsIdentityDocument: true,
    collectsProperty: true,
    canonicalPages: [
      page('甲方不得扣押乙方身份证。', 1),
      page('甲方有权扣押乙方身份证。乙方未按时提交材料且甲方有权收取押金。', 2),
    ],
  })
  const documentFinding = output.find((item) => item.ruleId === 'labor.documents.retention')
  const propertyFinding = output.find((item) => item.ruleId === 'labor.property.collection')
  assert.equal(documentFinding?.priority, 'priority_check')
  assert.equal(documentFinding?.evidence.pageNumber, 2)
  assert.equal(propertyFinding?.priority, 'priority_check')
  assert.match(propertyFinding?.evidence.excerpt ?? '', /收取押金/u)
})

test('possession evidence isolates later affirmative actions across contrast and ASCII punctuation', () => {
  for (const text of [
    '甲方不得扣押乙方身份证但特殊情形可以扣押乙方身份证',
    '甲方不得扣押乙方身份证,但特殊情形可以扣押乙方身份证',
  ]) {
    const finding = engine
      .evaluate({
        contractType: 'labor_contract',
        retainsIdentityDocument: true,
        canonicalPages: [page(text)],
      })
      .find((item) => item.ruleId === 'labor.documents.retention')!
    assert.equal(finding.priority, 'priority_check', text)
    assert.match(finding.evidence.excerpt, /^特殊情形可以扣押/u)
    assert.doesNotMatch(finding.evidence.excerpt, /不得/u)
    assert.equal(
      text.slice(finding.evidence.charStart!, finding.evidence.charEnd!),
      finding.evidence.excerpt,
    )
  }
})

test('possession priority binds employer action to a worker-owned document or property', () => {
  for (const text of [
    '乙方有权扣押甲方身份证',
    '甲方没有权力扣押乙方身份证',
  ]) {
    const finding = engine
      .evaluate({
        contractType: 'labor_contract',
        retainsIdentityDocument: true,
        canonicalPages: [page(text)],
      })
      .find((item) => item.ruleId === 'labor.documents.retention')
    assert.equal(finding?.priority, 'insufficient_info', text)
  }

  const malformed = engine.evaluate({
    contractType: 'labor_contract',
    retainsIdentityDocument: 'false' as never,
    canonicalPages: [page('甲方有权扣押乙方身份证')],
  })
  assert.equal(
    malformed.find((item) => item.ruleId === 'labor.documents.retention')?.priority,
    'insufficient_info',
  )
  assert.equal(malformed.some((item) => item.priority === 'priority_check'), false)
})

test('property collection binds the worker to the collection relation', () => {
  const unrelatedWorker = engine
    .evaluate({
      contractType: 'labor_contract',
      collectsProperty: true,
      canonicalPages: [page('甲方有权向客户收取押金并告知劳动者')],
    })
    .find((item) => item.ruleId === 'labor.property.collection')
  assert.equal(unrelatedWorker?.priority, 'insufficient_info')

  const workerCollection = engine
    .evaluate({
      contractType: 'labor_contract',
      collectsProperty: true,
      canonicalPages: [page('甲方有权向乙方收取押金')],
    })
    .find((item) => item.ruleId === 'labor.property.collection')
  assert.equal(workerCollection?.priority, 'priority_check')
})

test('possession negation recognizes no-permission wording', () => {
  const finding = engine
    .evaluate({
      contractType: 'labor_contract',
      retainsIdentityDocument: true,
      canonicalPages: [page('甲方没有权限扣押乙方身份证')],
    })
    .find((item) => item.ruleId === 'labor.documents.retention')
  assert.equal(finding?.priority, 'insufficient_info')
})

test('possession negation rejects non-affirmative entitlement wording', () => {
  for (const text of [
    '甲方并非有权扣押乙方身份证',
    '甲方不具有扣押乙方身份证的权利',
  ]) {
    const finding = engine
      .evaluate({
        contractType: 'labor_contract',
        retainsIdentityDocument: true,
        canonicalPages: [page(text)],
      })
      .find((item) => item.ruleId === 'labor.documents.retention')
    assert.equal(finding?.priority, 'insufficient_info', text)
  }
})

test('liquidated damages are priority checks only outside articles 22 and 23 scopes', () => {
  for (const allowed of ['training_service_period', 'non_compete'] as const) {
    const output = engine.evaluate({
      contractType: 'labor_contract',
      liquidatedDamagesReason: allowed,
      canonicalPages: [page(`双方就${allowed}约定违约金。`)],
    })
    assert.equal(output.some((finding) => finding.ruleId === 'labor.penalty.scope'), false)
  }

  const output = engine.evaluate({
    contractType: 'labor_contract',
    liquidatedDamagesReason: 'other',
    canonicalPages: [page('劳动者提前离职，应支付违约金5000元。')],
  })
  assert.equal(
    output.find((finding) => finding.ruleId === 'labor.penalty.scope')?.priority,
    'priority_check',
  )

  const conflicting = engine.evaluate({
    contractType: 'labor_contract',
    liquidatedDamagesReason: 'other',
    canonicalPages: [page('双方就专项培训服务期约定违约金。')],
  })
  assert.equal(conflicting.some((finding) => finding.priority === 'priority_check'), false)

  const confidentiality = engine.evaluate({
    contractType: 'labor_contract',
    liquidatedDamagesReason: 'confidentiality',
    canonicalPages: [page('劳动者违反保密义务，应支付违约金5000元。')],
  })
  assert.equal(
    confidentiality.find((finding) => finding.ruleId === 'labor.penalty.scope')?.priority,
    'priority_check',
  )

  const confidentialityWithoutEvidence = engine.evaluate({
    contractType: 'labor_contract',
    liquidatedDamagesReason: 'confidentiality',
    canonicalPages: [page('双方约定劳动者负有保密义务。')],
  })
  assert.equal(
    confidentialityWithoutEvidence.find((finding) => finding.ruleId === 'labor.penalty.scope')
      ?.priority,
    'insufficient_info',
  )
})

test('penalty evidence binds an affirmative payment obligation to the worker', () => {
  for (const text of [
    '甲方违约时应向乙方支付违约金5000元。',
    '劳动者无需支付违约金。',
    '劳动者不需要支付违约金5000元。',
    '劳动者不需支付违约金5000元。',
  ]) {
    const finding = engine
      .evaluate({
        contractType: 'labor_contract',
        liquidatedDamagesReason: 'other',
        canonicalPages: [page(text)],
      })
      .find((item) => item.ruleId === 'labor.penalty.scope')
    assert.equal(finding?.priority, 'insufficient_info', text)
  }

  const text = '劳动者提前离职，应支付违约金5000元。'
  const finding = engine
    .evaluate({
      contractType: 'labor_contract',
      liquidatedDamagesReason: 'other',
      canonicalPages: [page(text)],
    })
    .find((item) => item.ruleId === 'labor.penalty.scope')!
  assert.equal(finding.priority, 'priority_check')
  assert.equal(text.slice(finding.evidence.charStart!, finding.evidence.charEnd!), finding.evidence.excerpt)
})

test('penalty scan skips a scope-conflicting sentence and selects a later trustworthy sentence', () => {
  const text =
    '劳动者违反专项培训服务期，应支付违约金。劳动者提前离职，应支付违约金5000元。'
  const finding = engine
    .evaluate({
      contractType: 'labor_contract',
      liquidatedDamagesReason: 'other',
      canonicalPages: [page(text)],
    })
    .find((item) => item.ruleId === 'labor.penalty.scope')!
  assert.equal(finding.priority, 'priority_check')
  assert.match(finding.evidence.excerpt, /^劳动者提前离职/u)
  assert.equal(text.slice(finding.evidence.charStart!, finding.evidence.charEnd!), finding.evidence.excerpt)
})

test('penalty evidence uses the nearest explicit party before the obligation', () => {
  for (const sample of [
    { reason: 'other', text: '劳动者有权要求甲方应支付违约金5000元。' },
    { reason: 'confidentiality', text: '乙方确认甲方应支付违约金5000元。' },
  ] as const) {
    const finding = engine
      .evaluate({
        contractType: 'labor_contract',
        liquidatedDamagesReason: sample.reason,
        canonicalPages: [page(sample.text)],
      })
      .find((item) => item.ruleId === 'labor.penalty.scope')
    assert.equal(finding?.priority, 'insufficient_info', sample.text)
  }

  for (const sample of [
    { reason: 'other', text: '劳动者提前离职，应向甲方支付违约金5000元。' },
    { reason: 'confidentiality', text: '乙方违反保密义务，应支付违约金5000元。' },
  ] as const) {
    const finding = engine
      .evaluate({
        contractType: 'labor_contract',
        liquidatedDamagesReason: sample.reason,
        canonicalPages: [page(sample.text)],
      })
      .find((item) => item.ruleId === 'labor.penalty.scope')!
    assert.equal(finding.priority, 'priority_check', sample.text)
    assert.equal(
      sample.text.slice(finding.evidence.charStart!, finding.evidence.charEnd!),
      finding.evidence.excerpt,
    )
  }
})

test('penalty evidence binds the actual payer before the payment action', () => {
  const employerPays = engine
    .evaluate({
      contractType: 'labor_contract',
      liquidatedDamagesReason: 'other',
      canonicalPages: [page('劳动者确认应由甲方支付违约金5000元')],
    })
    .find((item) => item.ruleId === 'labor.penalty.scope')
  assert.equal(employerPays?.priority, 'insufficient_info')

  const workerPaysEmployer = engine
    .evaluate({
      contractType: 'labor_contract',
      liquidatedDamagesReason: 'other',
      canonicalPages: [page('劳动者应向甲方支付违约金5000元')],
    })
    .find((item) => item.ruleId === 'labor.penalty.scope')
  assert.equal(workerPaysEmployer?.priority, 'priority_check')
})

test('penalty negation covers non-mandatory wording', () => {
  for (const text of [
    '劳动者毋须支付违约金',
    '劳动者不是必须支付违约金',
    '劳动者并非必须支付违约金',
    '劳动者非必须支付违约金',
  ]) {
    const finding = engine
      .evaluate({
        contractType: 'labor_contract',
        liquidatedDamagesReason: 'other',
        canonicalPages: [page(text)],
      })
      .find((item) => item.ruleId === 'labor.penalty.scope')
    assert.equal(finding?.priority, 'insufficient_info', text)
  }
})

test('penalty contrast segments allow a later affirmative worker obligation', () => {
  const text = '劳动者无需支付第一项违约金，但劳动者提前离职应支付违约金5000元'
  const finding = engine
    .evaluate({
      contractType: 'labor_contract',
      liquidatedDamagesReason: 'other',
      canonicalPages: [page(text)],
    })
    .find((item) => item.ruleId === 'labor.penalty.scope')!
  assert.equal(finding.priority, 'priority_check')
  assert.match(finding.evidence.excerpt, /^劳动者提前离职/u)
  assert.equal(text.slice(finding.evidence.charStart!, finding.evidence.charEnd!), finding.evidence.excerpt)
})

test('penalty reason and evidence scope contradictions stay insufficient', () => {
  for (const sample of [
    {
      reason: 'confidentiality',
      text: '劳动者违反竞业限制义务，应支付违约金5000元。',
    },
    {
      reason: 'confidentiality',
      text: '劳动者违反培训服务期约定，应支付违约金5000元。',
    },
    { reason: 'other', text: '劳动者违反保密义务，应支付违约金5000元。' },
    { reason: 'other', text: '劳动者违反竞业限制义务，应支付违约金5000元。' },
    { reason: 'other', text: '劳动者违反专项培训服务期，应支付违约金5000元。' },
  ] as const) {
    const finding = engine
      .evaluate({
        contractType: 'labor_contract',
        liquidatedDamagesReason: sample.reason,
        canonicalPages: [page(sample.text)],
      })
      .find((item) => item.ruleId === 'labor.penalty.scope')
    assert.equal(finding?.priority, 'insufficient_info', sample.text)
    assert.doesNotMatch(finding?.explanation ?? '', /未落入.*(?:保密|竞业|培训|服务期)/u)
  }
})

test('regional wage and non-compete compensation stay insufficient without a signed dataset', () => {
  const output = engine.evaluate({
    contractType: 'labor_contract',
    probationSalary: 1800,
    locality: null,
    nonCompeteMonths: 12,
    nonCompeteCompensation: 500,
    canonicalPages: [page('试用期工资为1800元；竞业限制期限为12个月，补偿为500元。')],
  })
  for (const ruleId of ['labor.probation.local_wage', 'labor.non_compete.compensation']) {
    const finding = output.find((item) => item.ruleId === ruleId)
    assert.equal(finding?.priority, 'insufficient_info')
    assert.equal(finding?.localityDatasetVersion, null)
  }
})

test('priority evidence uses UTF-16 offsets and selects the first repeated excerpt', () => {
  const text = '😀试用期三个月。试用期三个月。'
  const finding = engine
    .evaluate({
      contractType: 'labor_contract',
      contractMonths: 12,
      probationMonths: 3,
      canonicalPages: [page(text)],
    })
    .find((item) => item.ruleId === 'labor.probation.term')!

  assert.equal(finding.evidence.charStart, 2)
  assert.equal(finding.evidence.excerpt, '试用期三个月')
  assert.equal(text.slice(finding.evidence.charStart!, finding.evidence.charEnd!), '试用期三个月')
})

test('all cited bases are allowlisted official immutable entries', () => {
  assert.equal(CONTRACT_RULE_PACK_VERSION, 'cn-labor-p0-v1')
  assert.deepEqual([...BASIS_ALLOWLIST.keys()], [
    'labor-contract-law:9',
    'labor-contract-law:19',
    'labor-contract-law:20',
    'labor-contract-law:22',
    'labor-contract-law:23',
    'labor-contract-law:24',
    'labor-contract-law:25',
  ])
  for (const basis of BASIS_ALLOWLIST.values()) {
    assert.equal(new URL(basis.url).hostname, 'www.mohrss.gov.cn')
    assert.equal(basis.effectiveFrom, '2013-07-01')
    assert.equal(Object.isFrozen(basis), true)
  }
  assert.equal(BASIS_ALLOWLIST.get('labor-contract-law:19')?.effectiveFrom, '2013-07-01')
  assert.deepEqual([...BASIS_ALLOWLIST.entries()], [...BASIS_ALLOWLIST])
  assert.throws(
    () => (BASIS_ALLOWLIST as Map<string, unknown>).set('fake-law:1', {}),
    /READONLY_RULE_BASIS/,
  )
  assert.throws(
    () => (BASIS_ALLOWLIST as Map<string, unknown>).delete('labor-contract-law:9'),
    /READONLY_RULE_BASIS/,
  )
  assert.throws(
    () => (BASIS_ALLOWLIST as Map<string, unknown>).clear(),
    /READONLY_RULE_BASIS/,
  )
  let callbackMap: ReadonlyMap<string, unknown> | undefined
  BASIS_ALLOWLIST.forEach((_value, _key, mapArgument) => {
    callbackMap = mapArgument
  })
  assert.equal(callbackMap, BASIS_ALLOWLIST)
  assert.throws(
    () => (callbackMap as Map<string, unknown>).set('fake-law:2', {}),
    /READONLY_RULE_BASIS/,
  )
  assert.throws(
    () => Map.prototype.set.call(BASIS_ALLOWLIST, 'fake-law:3', {}),
    TypeError,
  )
  assert.equal(BASIS_ALLOWLIST.size, 7)

  const output = engine.evaluate({
    contractType: 'labor_contract',
    contractMonths: 12,
    probationMonths: 3,
    canonicalPages: [page('试用期三个月。')],
  })
  assert.equal(output.every((finding) => !finding.basisRef || BASIS_ALLOWLIST.has(finding.basisRef)), true)
})

test('non-labor contracts never receive deterministic violation findings', () => {
  for (const contractType of ['internship_agreement', 'non_compete', 'offer'] as const) {
    const output = engine.evaluate({
      contractType,
      contractMonths: 1,
      probationMonths: 6,
      nonCompeteMonths: 36,
      retainsIdentityDocument: true,
      collectsProperty: true,
      liquidatedDamagesReason: 'other',
      canonicalPages: [page('试用期六个月，竞业限制36个月，扣押身份证并收取押金，离职支付违约金。')],
    })
    assert.equal(output.some((finding) => finding.priority === 'priority_check'), false)
  }
  assert.deepEqual(
    engine.evaluate({
      contractMonths: 1,
      probationMonths: 6,
      canonicalPages: [page('试用期六个月。')],
    }),
    [],
  )
})

test('explicit labor contracts treat omitted facts as unknown and explicit absence as absent', () => {
  const unknown = engine.evaluate({ contractType: 'labor_contract' })
  assert.ok(unknown.length > 0)
  assert.equal(unknown.every((finding) => finding.priority === 'insufficient_info'), true)
  assert.equal(unknown.every((finding) => finding.requiredFacts.length > 0), true)

  const knownAbsent = engine.evaluate({
    contractType: 'labor_contract',
    probationMonths: null,
    probationSalary: null,
    nonCompeteMonths: null,
    nonCompeteCompensation: null,
    retainsIdentityDocument: false,
    collectsProperty: false,
    liquidatedDamagesReason: null,
  })
  assert.equal(knownAbsent.some((finding) => finding.priority === 'priority_check'), false)
  assert.deepEqual(knownAbsent, [])
})

test('malformed or duplicate canonical pages fail closed without throwing', () => {
  const malformedPages: unknown[] = [
    {},
    [null],
    [page('试用期三个月。'), page('试用期三个月。')],
    [{ pageNumber: 0, text: '试用期三个月。' }],
  ]
  for (const canonicalPages of malformedPages) {
    let output: ReturnType<ContractReviewRuleEngine['evaluate']> = []
    assert.doesNotThrow(() => {
      output = engine.evaluate({
        contractType: 'labor_contract',
        contractMonths: 12,
        probationMonths: 3,
        canonicalPages: canonicalPages as ContractReviewRuleInput['canonicalPages'],
      })
    })
    assert.equal(output.some((finding) => finding.priority === 'priority_check'), false)
    assert.equal(
      output.find((finding) => finding.ruleId === 'labor.probation.term')?.priority,
      'insufficient_info',
    )
  }

  let nullInput: ReturnType<ContractReviewRuleEngine['evaluate']> = []
  assert.doesNotThrow(() => {
    nullInput = engine.evaluate(null as never)
  })
  assert.equal(nullInput.some((finding) => finding.priority === 'priority_check'), false)
})

test('malformed open-ended flag cannot produce a probation priority check', () => {
  const output = engine.evaluate({
    contractType: 'labor_contract',
    contractMonths: 12,
    isOpenEnded: 'false' as never,
    probationMonths: 3,
    canonicalPages: [page('试用期三个月')],
  })
  assert.equal(
    output.find((finding) => finding.ruleId === 'labor.probation.term')?.priority,
    'insufficient_info',
  )
  assert.equal(output.some((finding) => finding.priority === 'priority_check'), false)
})

test('duration priority requires an affirmative certain clause', () => {
  for (const text of ['双方未在本劳动合同及任何补充协议中约定试用期三个月。', '双方明确不约定试用期三个月。', '双方是否约定试用期三个月？', '试用期三个月的约定并不存在。', '试用期为3个月，此约定并不存在。', '试用期为3个月，是否生效视情况而定。', '试用期三个月的约定经双方多轮讨论并在补充文件及会议纪要中共同确认并不存在', '双方可能约定试用期三个月。', '双方拟约定试用期三个月。']) {
    const finding = engine.evaluate({ contractType: 'labor_contract', contractMonths: 12, probationMonths: 3, canonicalPages: [page(text)] }).find((item) => item.ruleId === 'labor.probation.term')
    assert.equal(finding?.priority, 'insufficient_info', text)
  }
  for (const text of ['双方明确不约定竞业限制期限25个月', '双方是否约定竞业限制期限25个月？']) {
    assert.equal(engine.evaluate({ contractType: 'labor_contract', nonCompeteMonths: 25, canonicalPages: [page(text)] }).find((item) => item.ruleId === 'labor.non_compete.term')?.priority, 'insufficient_info', text)
  }
  const positive = engine.evaluate({ contractType: 'labor_contract', isOpenEnded: true, probationMonths: 7, canonicalPages: [page('无固定期限劳动合同约定试用期七个月')] }).find((item) => item.ruleId === 'labor.probation.term')
  assert.equal(positive?.priority, 'priority_check')
  assert.equal(engine.evaluate({ contractType: 'labor_contract', contractMonths: 12, probationMonths: 2, canonicalPages: [page('试用期七个月')] }).find((item) => item.ruleId === 'labor.probation.term')?.priority, 'insufficient_info')
  assert.equal(engine.evaluate({ contractType: 'labor_contract', nonCompeteMonths: 12, canonicalPages: [page('竞业限制期限25个月')] }).find((item) => item.ruleId === 'labor.non_compete.term')?.priority, 'insufficient_info')
  assert.equal(engine.evaluate({ contractType: 'labor_contract', contractMonths: 12, probationMonths: 2, canonicalPages: [page('试用期2个月')] }).some((item) => item.ruleId === 'labor.probation.term'), false)
  assert.equal(engine.evaluate({ contractType: 'labor_contract', nonCompeteMonths: 12, canonicalPages: [page('竞业限制期限12个月')] }).some((item) => item.ruleId === 'labor.non_compete.term'), false)
})

test('penalty priority requires a certain worker payer', () => {
  for (const text of ['劳动者不一定需要支付违约金', '劳动者不会需要支付违约金', '劳动者可能需要支付违约金', '劳动者是否应支付违约金5000元？', '劳动者确认应由雇主支付违约金']) {
    const finding = engine.evaluate({ contractType: 'labor_contract', liquidatedDamagesReason: 'other', canonicalPages: [page(text)] }).find((item) => item.ruleId === 'labor.penalty.scope')
    assert.equal(finding?.priority, 'insufficient_info', text)
  }
  for (const text of ['劳动者不按期完成，应向甲方支付违约金', '劳动者无需支付违约金，劳动者提前离职应支付违约金5000元', '劳动者必须支付违约金', '劳动者将支付违约金']) {
    const positive = engine.evaluate({ contractType: 'labor_contract', liquidatedDamagesReason: 'other', canonicalPages: [page(text)] }).find((item) => item.ruleId === 'labor.penalty.scope')
    assert.equal(positive?.priority, 'priority_check', text)
  }
})

test('possession priority requires affirmative authority and an explicit worker relation', () => {
  for (const text of ['甲方不会扣押乙方身份证', '甲方不能扣押乙方身份证', '甲方不能予以扣押乙方身份证', '甲方并非可以扣押乙方身份证', '甲方不享有扣押乙方身份证的权利', '甲方是否有权扣押乙方身份证？', '甲方可能有权扣押乙方身份证']) {
    const finding = engine.evaluate({ contractType: 'labor_contract', retainsIdentityDocument: true, canonicalPages: [page(text)] }).find((item) => item.ruleId === 'labor.documents.retention')
    assert.equal(finding?.priority, 'insufficient_info', text)
  }
  const property = engine.evaluate({ contractType: 'labor_contract', collectsProperty: true, canonicalPages: [page('甲方有权收取其客户押金')] }).find((item) => item.ruleId === 'labor.property.collection')
  assert.equal(property?.priority, 'insufficient_info')
  for (const text of ['甲方有权向乙方扣押身份证', '甲方有权从乙方处扣押身份证']) {
    assert.equal(engine.evaluate({ contractType: 'labor_contract', retainsIdentityDocument: true, canonicalPages: [page(text)] }).find((item) => item.ruleId === 'labor.documents.retention')?.priority, 'priority_check', text)
  }
})

test('evaluation does not mutate input and returns deeply immutable output', () => {
  const input: ContractReviewRuleInput = {
    contractType: 'labor_contract',
    contractMonths: 12,
    probationMonths: 3,
    canonicalPages: [page('试用期三个月。')],
  }
  const snapshot = structuredClone(input)
  const output = engine.evaluate(input)
  assert.deepEqual(input, snapshot)
  assert.equal(Object.isFrozen(output), true)
  assert.equal(Object.isFrozen(output[0]), true)
  assert.equal(Object.isFrozen(output[0]!.evidence), true)
  assert.equal(Object.isFrozen(output[0]!.requiredFacts), true)
  assert.throws(() => (output as unknown as unknown[]).push({}), TypeError)
  assert.throws(() => {
    ;(output[0]!.evidence as { excerpt: string }).excerpt = 'changed'
  }, TypeError)
})
