import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  INVOICE_BLOCK_MESSAGES,
  assessInvoiceEligibility,
  type PrintInvoiceFacts,
  type ServiceInvoiceFacts,
} from './invoice-eligibility'

const MEMBER = 'member-1'

function printFacts(overrides: Partial<Omit<PrintInvoiceFacts, 'kind'>> = {}): PrintInvoiceFacts {
  return {
    kind: 'print',
    id: 'order-1',
    endUserId: MEMBER,
    payStatus: 'paid',
    amountCents: 300,
    discountCents: 100,
    refundedAmountCents: 0,
    refundStatuses: [],
    openInvoiceStatus: null,
    ...overrides,
  }
}

function serviceFacts(overrides: Partial<Omit<ServiceInvoiceFacts, 'kind'>> = {}): ServiceInvoiceFacts {
  return {
    kind: 'service',
    id: 'svc-1',
    endUserId: MEMBER,
    status: 'paid',
    amountCents: 200,
    paymentFailed: false,
    openInvoiceStatus: null,
    ...overrides,
  }
}

function expectBlock(facts: PrintInvoiceFacts | ServiceInvoiceFacts, code: keyof typeof INVOICE_BLOCK_MESSAGES): void {
  const decision = assessInvoiceEligibility(facts, MEMBER)
  assert.equal(decision.ok, false)
  assert.equal(decision.code, code)
  assert.equal(decision.message, INVOICE_BLOCK_MESSAGES[code])
  assert.equal('taxId' in decision, false)
  assert.equal('email' in decision, false)
}

test('打印单：本人已付、实付大于 0、没有退款和未退回申请，可以开', () => {
  const decision = assessInvoiceEligibility(printFacts(), MEMBER)
  assert.equal(decision.ok, true)
  assert.equal(decision.code, null)
  assert.equal(decision.message, '')
  assert.equal(decision.amountCents, 200)
})

test('服务单：已消费的本人订单可以开，金额快照是建单时的实付', () => {
  const decision = assessInvoiceEligibility(serviceFacts({ status: 'consumed' }), MEMBER)
  assert.equal(decision.ok, true)
  assert.equal(decision.code, null)
  assert.equal(decision.amountCents, 200)
})

test('打印单：不是本人的订单开不了', () => {
  expectBlock(printFacts({ endUserId: 'member-2' }), 'not_owner')
  expectBlock(printFacts({ endUserId: null }), 'not_owner')
})

test('服务单：不是本人的订单开不了', () => {
  expectBlock(serviceFacts({ endUserId: null }), 'not_owner')
})

// 期望值改动（返工包 P2c1b 第 10 条）：原先按终端「现在」所属机构判「这台机器免费」（public_site），
// 终端改绑到公共就业点位后，在商业点位已经付了钱的单也被挡住。能不能开只看订单自己的事实：
// 公共就业点位永不收费，那里的单实付是 0，由「没有实付」挡住；终端现在绑到哪儿不进判断。
test('打印单：终端现在绑到公共就业点位，不影响已付的单；公共点位的单实付是 0，开不了', () => {
  const decision = assessInvoiceEligibility({ ...printFacts(), orgType: 'public_employment_service' } as never, MEMBER)
  assert.equal(decision.ok, true)
  assert.equal(decision.amountCents, 200)
  expectBlock(printFacts({ payStatus: 'paid', amountCents: 0, discountCents: 0 }), 'zero_amount')
})

test('服务单：终端现在绑到公共就业点位，不影响已付的单；公共点位的单实付是 0，开不了', () => {
  const decision = assessInvoiceEligibility({ ...serviceFacts(), orgType: 'employment_service_station' } as never, MEMBER)
  assert.equal(decision.ok, true)
  assert.equal(decision.amountCents, 200)
  expectBlock(serviceFacts({ amountCents: 0 }), 'zero_amount')
})

test('打印单：没付成的单开不了', () => {
  expectBlock(printFacts({ payStatus: 'unpaid' }), 'not_paid')
  expectBlock(printFacts({ payStatus: 'paying' }), 'not_paid')
  expectBlock(printFacts({ payStatus: 'failed' }), 'not_paid')
  expectBlock(printFacts({ payStatus: 'closed' }), 'not_paid')
})

test('服务单：没付成的单开不了', () => {
  expectBlock(serviceFacts({ status: 'pending' }), 'not_paid')
  expectBlock(serviceFacts({ status: 'paid', paymentFailed: true }), 'not_paid')
  expectBlock(serviceFacts({ status: 'closed' }), 'not_paid')
})

test('打印单：退款还没完成的单开不了', () => {
  expectBlock(printFacts({ payStatus: 'refunding' }), 'refund_in_progress')
  expectBlock(printFacts({ refundStatuses: ['pending'] }), 'refund_in_progress')
})

test('服务单：退款还没完成的单开不了', () => {
  expectBlock(serviceFacts({ status: 'refunding' }), 'refund_in_progress')
  expectBlock(serviceFacts({ status: 'refund_failed' }), 'refund_in_progress')
})

test('打印单：部分退款的单开不了', () => {
  expectBlock(printFacts({ payStatus: 'partial_refunded', refundedAmountCents: 50 }), 'partial_refund')
  expectBlock(printFacts({ refundedAmountCents: 50, refundStatuses: ['success'] }), 'partial_refund')
})

test('打印单：已退款的单开不了', () => {
  expectBlock(printFacts({ payStatus: 'refunded', refundedAmountCents: 200 }), 'refunded')
  expectBlock(printFacts({ refundedAmountCents: 200, refundStatuses: ['success'] }), 'refunded')
})

test('服务单：已退款的单开不了', () => {
  expectBlock(serviceFacts({ status: 'refunded' }), 'refunded')
})

test('打印单：实付为 0 的单开不了', () => {
  expectBlock(printFacts({ amountCents: 0, discountCents: 0 }), 'zero_amount')
  expectBlock(printFacts({ amountCents: 200, discountCents: 200 }), 'zero_amount')
})

test('服务单：实付为 0 的单开不了', () => {
  expectBlock(serviceFacts({ amountCents: 0 }), 'zero_amount')
})

test('打印单：已提交或已开的申请还在，不能再开', () => {
  expectBlock(printFacts({ openInvoiceStatus: 'submitted' }), 'already_requested')
  expectBlock(printFacts({ openInvoiceStatus: 'issued' }), 'already_requested')
})

test('服务单：已提交或已开的申请还在，不能再开', () => {
  expectBlock(serviceFacts({ openInvoiceStatus: 'submitted' }), 'already_requested')
  expectBlock(serviceFacts({ openInvoiceStatus: 'issued' }), 'already_requested')
})

test('退回之后可以再开，失败的退款记录不挡住已付订单', () => {
  const again = assessInvoiceEligibility(printFacts({ openInvoiceStatus: null, refundStatuses: ['failed'] }), MEMBER)
  assert.equal(again.ok, true)
  assert.equal(again.amountCents, 200)
  const serviceAgain = assessInvoiceEligibility(serviceFacts({ status: 'consumed' }), MEMBER)
  assert.equal(serviceAgain.ok, true)
})
