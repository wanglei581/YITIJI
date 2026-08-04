import assert from 'node:assert/strict'
import { test } from 'node:test'
import { canonicalizePage, locateExcerpt } from '../canonical-text'
import {
  MIN_RELIABLE_TEXT_LAYER_CHARS,
  assertBornDigitalPdfPageLimit,
  hasReliableTextLayer,
} from '../contract-review-extraction.service'

test('canonicalizePage applies NFC and LF normalization without collapsing whitespace', () => {
  const source = `Cafe\u0301\r\n甲方\r  两个空格\t保留  `
  assert.equal(canonicalizePage(source), 'Café\n甲方\n  两个空格\t保留  ')
})

test('locateExcerpt returns page-local UTF-16 code unit offsets including emoji', () => {
  const page = canonicalizePage('甲方\r\n试用期😀六个月')
  const range = locateExcerpt(page, '试用期😀六个月')
  assert.deepEqual(range, { charStart: 3, charEnd: 11 })
  assert.equal(page.slice(range.charStart, range.charEnd), '试用期😀六个月')
})

test('locateExcerpt fails closed for empty and missing excerpts', () => {
  assert.throws(() => locateExcerpt('合同正文', ''), /CONTRACT_EVIDENCE_NOT_FOUND/)
  assert.throws(() => locateExcerpt('合同正文', '工资'), /CONTRACT_EVIDENCE_NOT_FOUND/)
})

test('canonical text helpers fail closed for unknown inputs', () => {
  assert.throws(() => canonicalizePage(null), /CONTRACT_CANONICAL_TEXT_INVALID/)
  assert.throws(() => locateExcerpt('正文', undefined), /CONTRACT_CANONICAL_TEXT_INVALID/)
})

test('PDF page count accepts 50 and rejects invalid counts and 51', () => {
  assert.doesNotThrow(() => assertBornDigitalPdfPageLimit(50))
  for (const invalid of [0, -1, Number.NaN, 1.5]) {
    assert.throws(() => assertBornDigitalPdfPageLimit(invalid), /CONTRACT_PDF_INVALID/)
  }
  assert.throws(() => assertBornDigitalPdfPageLimit(51), /CONTRACT_PAGE_LIMIT_EXCEEDED/)
  assert.throws(() => assertBornDigitalPdfPageLimit('1'), /CONTRACT_PDF_INVALID/)
})

test('reliable text-layer threshold is explicit and ignores whitespace', () => {
  assert.equal(MIN_RELIABLE_TEXT_LAYER_CHARS, 30)
  assert.equal(hasReliableTextLayer('甲'.repeat(30)), true)
  assert.equal(hasReliableTextLayer(` ${'甲'.repeat(29)}\n\t`), false)
  assert.equal(hasReliableTextLayer({}), false)
})
