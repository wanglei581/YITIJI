import assert from 'node:assert/strict'
import test from 'node:test'
import { payStatusText, pickupText, taskStatusText } from './orderDisplay.ts'

test('任务状态覆盖待到机、待现场支付和已过期', () => {
  assert.equal(taskStatusText('pending_release').label, '待到机')
  assert.equal(taskStatusText('awaiting_payment').label, '待现场支付')
  assert.equal(taskStatusText('expired').label, '已过期')
  assert.equal(taskStatusText('pending').label, '待领取')
  assert.equal(taskStatusText('abandoned').label, '已废弃')
})

test('未知状态保留原值，空值不编造', () => {
  const unknown = taskStatusText('not_a_status')
  assert.equal(unknown.label, '未归类（not_a_status）')
  assert.equal(unknown.title, 'not_a_status')
  assert.equal(taskStatusText(null).label, '—')
  assert.equal(taskStatusText('').label, '—')
  const pay = payStatusText('partial_refunded')
  assert.equal(pay.label, '退款异常·待核对')
  assert.equal(payStatusText('future_pay').label, '未归类（future_pay）')
})

test('取件未知值不直接露原词', () => {
  assert.equal(pickupText({ pickupStatus: 'none', channel: null }), '—')
  assert.equal(pickupText({ pickupStatus: 'used', channel: 'miniapp_cloud' }), '已取件')
  assert.equal(pickupText({ pickupStatus: 'held', channel: null }), '未归类（held）')
})
