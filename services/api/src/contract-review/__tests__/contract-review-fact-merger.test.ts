import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ContractReviewFactMerger } from '../contract-review-fact-merger'

const merger = new ContractReviewFactMerger()

function page(text: string, pageNumber = 1) {
  return { pageNumber, text }
}

test('extracts the bounded P0 labor facts from masked canonical pages', () => {
  const pages = [
    page('本劳动合同为固定期限合同，合同期限为三年。双方约定试用期六个月。'),
    page('[用人单位_1]与[劳动者_1]约定竞业限制期限为18个月。', 2),
    page('甲方有权扣押乙方身份证。甲方向乙方收取保证金。', 3),
    page('乙方违反保密义务，应当向甲方支付违约金。', 4),
  ] as const

  const result = merger.merge(pages)

  assert.deepEqual(result, {
    facts: {
      contractMonths: 36,
      isOpenEnded: false,
      probationMonths: 6,
      nonCompeteMonths: 18,
      retainsIdentityDocument: true,
      collectsProperty: true,
      liquidatedDamagesReason: 'confidentiality',
    },
    hasFieldConflict: false,
  })
  assert.equal(Object.isFrozen(result), true)
  assert.equal(Object.isFrozen(result.facts), true)
})

test('supports explicit open-ended and absence clauses without guessing from silence', () => {
  assert.deepEqual(
    merger.merge([
      page('双方订立无固定期限劳动合同。双方不约定试用期。'),
      page('双方未约定竞业限制，也不约定违约金。', 2),
      page('甲方不得扣押乙方身份证，不得向乙方收取押金或其他财物。', 3),
    ]),
    {
      facts: {
        isOpenEnded: true,
        probationMonths: null,
        nonCompeteMonths: null,
        retainsIdentityDocument: false,
        collectsProperty: false,
        liquidatedDamagesReason: null,
      },
      hasFieldConflict: false,
    },
  )

  assert.deepEqual(merger.merge([page('双方应当依法履行本合同。')]), {
    facts: {},
    hasFieldConflict: false,
  })
})

test('accepts only explicit bounded Arabic and Chinese month/year forms', () => {
  assert.deepEqual(
    merger.merge([page('合同期限为十二个月，试用期为二个月，竞业限制期限为二年。')]),
    {
      facts: {
        contractMonths: 12,
        probationMonths: 2,
        nonCompeteMonths: 24,
      },
      hasFieldConflict: false,
    },
  )

  const ambiguous = merger.merge([
    page('合同自2026年8月1日至2028年7月31日。试用期约二至三个月。'),
    page('员工有三年工作经验，公司提供十二个月福利计划。', 2),
    page('竞业限制期限为100年。合同期限为0个月。', 3),
  ])
  assert.deepEqual(ambiguous, { facts: {}, hasFieldConflict: false })
})

test('marks conflicting values and removes every conflicted field', () => {
  const result = merger.merge([
    page('本合同为固定期限劳动合同，合同期限为一年，试用期一个月。'),
    page('本合同为无固定期限劳动合同，合同期限为二年，试用期二个月。', 2),
    page('竞业限制期限为12个月。竞业限制期限为二年。', 3),
    page('甲方不得扣押乙方身份证；甲方有权扣押乙方身份证。', 4),
    page('甲方不得向乙方收取押金；甲方向乙方收取保证金。', 5),
    page('乙方违反培训服务期应支付违约金；乙方违反保密义务应支付违约金。', 6),
  ])

  assert.deepEqual(result, { facts: {}, hasFieldConflict: true })
})

test('does not mutate input pages and rejects malformed canonical pages', () => {
  const pages = [page('合同期限为一年。')]
  const snapshot = structuredClone(pages)
  merger.merge(pages)
  assert.deepEqual(pages, snapshot)

  for (const malformed of [
    [],
    [page('合同期限为一年。', 0)],
    [page('合同期限为一年。'), page('试用期一个月。')],
    [{ pageNumber: 1, text: 42 }],
  ]) {
    assert.throws(
      () => merger.merge(malformed as never),
      (error) => error instanceof Error && error.message === 'CONTRACT_REVIEW_FACT_INPUT_INVALID',
    )
  }
})
