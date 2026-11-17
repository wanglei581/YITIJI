import assert from 'node:assert/strict'
import { test } from 'node:test'
import { filePurposeWhere } from '../file-list-purpose'

test('不带用途时仍排除合同风险提示报告', () => {
  assert.deepEqual(filePurposeWhere(undefined), { purpose: { not: 'contract_review_report' } })
  assert.deepEqual(filePurposeWhere('  '), { purpose: { not: 'contract_review_report' } })
})

test('单个用途保持等值，合同风险提示报告仍不可见', () => {
  assert.deepEqual(filePurposeWhere('fair_material'), { purpose: 'fair_material' })
  assert.deepEqual(filePurposeWhere('contract_review_report'), { purpose: '__hidden__' })
})

test('招聘会资料的两个用途一起查，混进的合同报告会被拿掉', () => {
  assert.deepEqual(filePurposeWhere('fair_material,job_fair_material'), {
    purpose: { in: ['fair_material', 'job_fair_material'] },
  })
  assert.deepEqual(filePurposeWhere(' fair_material , contract_review_report , job_fair_material '), {
    purpose: { in: ['fair_material', 'job_fair_material'] },
  })
})
