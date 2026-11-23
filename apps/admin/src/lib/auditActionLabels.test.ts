import assert from 'node:assert/strict'
import test from 'node:test'
import { getAuditTargetLabel } from './auditActionLabels'

test('getAuditTargetLabel maps invoice, feedback, payment and core operational targets to readable Chinese', () => {
  assert.equal(getAuditTargetLabel('invoice_request'), '开票申请')
  assert.equal(getAuditTargetLabel('FeedbackTicket'), '用户反馈')
  assert.equal(getAuditTargetLabel('payment_attempt'), '支付尝试')
  assert.equal(getAuditTargetLabel('mock_interview_session'), '模拟面试')
  assert.equal(getAuditTargetLabel('platform_setting'), '平台设置')
  assert.equal(getAuditTargetLabel('user_data_request'), '隐私权利申请')
  assert.equal(getAuditTargetLabel('license'), '软件授权')
  assert.equal(getAuditTargetLabel('organization_content_trust'), '机构内容可信')
  assert.equal(getAuditTargetLabel('unknown_custom_target'), '其他对象')
  assert.equal(getAuditTargetLabel(null), '')
})
