import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assertSourceFourElements,
  formatMissingSourceFourElements,
  missingSourceFourElements,
  scanForbiddenCopy,
} from '../lib/sweep-copy-guards.mjs'

test('合规文案「去来源平台投递」判为通过', () => {
  assert.deepEqual(scanForbiddenCopy('去来源平台投递'), [])
})

test('真违规文案「一键投递」判为不通过', () => {
  assert.deepEqual(scanForbiddenCopy('一键投递'), ['一键投递'])
})

test('合规文案「打开来源平台投递页」不因含「平台投递」子串误报', () => {
  assert.deepEqual(scanForbiddenCopy('手机扫码打开来源平台投递页，投递结果以来源平台为准'), [])
})

test('同一段文本里白名单短语出现多次仍通过', () => {
  const text = '去来源平台投递 去来源平台投递 扫码投递 扫码投递'
  assert.deepEqual(scanForbiddenCopy(text), [])
})

test('白名单与真违规同时出现时只报违规项', () => {
  assert.deepEqual(scanForbiddenCopy('去来源平台投递 一键投递'), ['一键投递'])
})

test('四要素缺一项时报出缺哪一项', () => {
  const missing = missingSourceFourElements('来源机构 同步时间 外部ID')
  assert.deepEqual(missing, ['外部投递链接'])
  assert.match(formatMissingSourceFourElements(missing), /外部投递链接/)
  assert.doesNotMatch(formatMissingSourceFourElements(missing), /来源机构/)
  assert.throws(
    () => assertSourceFourElements('来源机构 同步时间 外部ID'),
    /缺少必须展示的：外部投递链接/,
  )
})

test('四要素齐全时缺失列表为空', () => {
  assert.deepEqual(
    missingSourceFourElements('来源机构 同步时间 外部ID 外部投递链接'),
    [],
  )
  assert.equal(
    formatMissingSourceFourElements(
      missingSourceFourElements('来源机构 同步时间 外部ID 来源链接'),
    ),
    '',
  )
})
