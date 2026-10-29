import assert from 'node:assert/strict'
import test from 'node:test'
import { reasonLength, validCreditCode, validDates, validGraceDays, validQuota, validReason, validTicket } from './licenseValidation.ts'

test('理由按去空白后的码点计数并检查范围', () => {
  assert.equal(reasonLength('  人😀  '), 2)
  assert.equal(validReason('  人 '), false)
  assert.equal(validReason(' 人😀 '), true)
  assert.equal(validReason('字'.repeat(201)), false)
})
test('工单号检查字符与长度', () => {
  assert.equal(validTicket('ABC-12_/'), true)
  assert.equal(validTicket('A B'), false)
  assert.equal(validTicket(''), false)
  assert.equal(validTicket('a'.repeat(65)), false)
})
test('信用代码检查长度与字符集', () => {
  assert.equal(validCreditCode('91370212MA3T8K2P4T'), true)
  assert.equal(validCreditCode('91370212MA3T8K2P4I'), false)
  assert.equal(validCreditCode('123'), false)
})
test('日期顺序与台数、宽限天数范围', () => {
  assert.equal(validDates('2026-11-01', '2026-10-31'), false)
  assert.equal(validDates('2026-11-01', '2026-11-01'), true)
  assert.equal(validQuota(0), false)
  assert.equal(validQuota(10000), true)
  assert.equal(validQuota(10001), false)
  assert.equal(validGraceDays(0), true)
  assert.equal(validGraceDays(31), false)
})
