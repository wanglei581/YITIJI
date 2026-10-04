import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  AI_QUOTA_GRANT_NOTE,
  AI_QUOTA_SERVICES,
  BENEFIT_TYPES,
  aiQuotaFieldErrors,
  benefitKindLine,
  buildGrantInput,
  defaultBenefitTitle,
  grantErrorMessage,
  parseAiQuotaCount,
  quantityLine,
  type GrantDraft,
} from './grantFormModel.ts'

const COMMERCIAL = /购买|充值|付费|价格/
const ENGLISH_KEY = /ai_quota|ai_resume|ai_assistant|ai_interview/

function draft(overrides: Partial<GrantDraft> = {}): GrantDraft {
  return {
    endUserId: 'user-1',
    benefitType: 'coupon',
    sourceType: 'platform',
    title: '打印服务优惠券',
    description: '',
    quantityTotal: '2',
    validUntil: null,
    serviceKey: 'ai_resume',
    aiCount: '5',
    ...overrides,
  }
}

function httpError(code: string, message: string): Error {
  return Object.assign(new Error(message), { name: 'ApiHttpError', code, status: 400 })
}

test('AI 额度必须选择服务并填写 1–9999 的整数次数', () => {
  assert.deepEqual(aiQuotaFieldErrors('', '', { showService: true, showEmptyCount: true }), {
    service: '请选择这项额度用于哪项 AI 服务。',
    count: '请填写次数。',
  })
  assert.equal(aiQuotaFieldErrors('ai_resume', '', { showService: true, showEmptyCount: true }).service, null)
  for (const raw of ['0', '10000', '1.5', '1.0', '-1', '1e2', 'abc']) {
    assert.equal(parseAiQuotaCount(raw).ok, false, raw)
    assert.equal(aiQuotaFieldErrors('ai_assistant', raw, { showService: false, showEmptyCount: false }).count, '次数须为 1–9999 的整数。')
  }
  assert.deepEqual(parseAiQuotaCount('12'), { ok: true, value: 12 })
  assert.equal(aiQuotaFieldErrors('ai_interview', '12', { showService: true, showEmptyCount: true }).count, null)
})

test('其它权益不提交服务字段，AI 额度提交所选服务与次数', () => {
  const coupon = buildGrantInput(draft())
  assert.ok(coupon)
  assert.equal('serviceKey' in coupon, false)
  assert.equal(JSON.stringify(coupon).includes('serviceKey'), false)
  assert.equal(coupon.quantityTotal, 2)
  assert.equal(coupon.benefitType, 'coupon')

  const hint = buildGrantInput(draft({ benefitType: 'subsidy_eligibility_hint', quantityTotal: '9' }))
  assert.ok(hint)
  assert.equal('serviceKey' in hint, false)
  assert.equal(hint.quantityTotal, null)

  assert.equal(buildGrantInput(draft({ benefitType: 'ai_quota', serviceKey: '', aiCount: '3' })), null)
  assert.equal(buildGrantInput(draft({ benefitType: 'ai_quota', serviceKey: 'ai_resume', aiCount: '10000' })), null)

  const quota = buildGrantInput(draft({
    benefitType: 'ai_quota',
    serviceKey: 'ai_interview',
    aiCount: '8',
    title: '',
  }))
  assert.ok(quota)
  assert.equal(quota.serviceKey, 'ai_interview')
  assert.equal(quota.quantityTotal, 8)
  assert.equal(quota.title, 'AI 使用次数')
  assert.equal(defaultBenefitTitle('ai_quota').includes('面试'), false)
})

test('列表只显示中文服务名、总次数和剩余次数', () => {
  assert.equal(benefitKindLine({ benefitType: 'coupon', serviceKey: 'ai_resume' }), null)
  assert.equal(quantityLine({ benefitType: 'free_quota', quantityTotal: 4, quantityRemaining: 1 }), '额度 1 / 4')
  assert.equal(quantityLine({ benefitType: 'coupon', quantityTotal: null, quantityRemaining: null }), '额度 — / —')

  for (const service of AI_QUOTA_SERVICES) {
    const kind = benefitKindLine({ benefitType: 'ai_quota', serviceKey: service.value })
    assert.equal(kind, `AI 额度 · ${service.label}`)
    assert.match(kind, /[\u4e00-\u9fff]/)
    assert.doesNotMatch(kind, ENGLISH_KEY)
  }
  const unknown = benefitKindLine({ benefitType: 'ai_quota', serviceKey: 'print' })
  assert.equal(unknown, 'AI 额度 · 未登记的服务')
  assert.doesNotMatch(unknown ?? '', ENGLISH_KEY)
  assert.equal(quantityLine({ benefitType: 'ai_quota', quantityTotal: 8, quantityRemaining: 0 }), '总次数 8 · 剩余次数 0')
  assert.equal(quantityLine({ benefitType: 'ai_quota', quantityTotal: null, quantityRemaining: null }), '总次数 — · 剩余次数 —')
})

test('校验失败给中文提示，不露出英文键名或原始错误对象', () => {
  const missing = grantErrorMessage(httpError('BENEFIT_SERVICE_KEY_REQUIRED', 'serviceKey must be one of ai_resume'))
  assert.match(missing, /请选择这项额度用于哪项 AI 服务/)
  assert.doesNotMatch(missing, ENGLISH_KEY)
  assert.equal(grantErrorMessage(httpError('VALIDATION_FAILED', 'serviceKey: ai_interview')), '提交内容未通过校验，请检查后重试。')
  assert.equal(grantErrorMessage(httpError('MOCK_DISABLED', 'mock 模式不支持发放权益')), 'mock 模式不支持发放权益')
  assert.equal(grantErrorMessage(httpError('BENEFIT_END_USER_DISABLED', '该用户已停用，不能发放权益')), '该用户已停用，不能发放权益。')
  assert.equal(grantErrorMessage({ message: { code: 'ai_quota' } }), '发放失败，请重试。')
  assert.equal(grantErrorMessage('ai_resume'), '发放失败，请重试。')
})

test('页面文案没有购买引导，列表不直接渲染英文键', () => {
  const page = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8')
  const model = readFileSync(new URL('./grantFormModel.ts', import.meta.url), 'utf8')
  for (const source of [page, model, AI_QUOTA_GRANT_NOTE, ...BENEFIT_TYPES.map((item) => `${item.label}${item.desc}`)]) {
    assert.doesNotMatch(source, COMMERCIAL)
  }
  assert.match(page, /buildGrantInput\(/)
  assert.match(page, /benefitKindLine\(item\)/)
  assert.match(page, /AI_QUOTA_GRANT_NOTE/)
  assert.doesNotMatch(page, /\{item\.serviceKey/)
  assert.equal(AI_QUOTA_GRANT_NOTE, '赠送给该会员的额外 AI 使用次数，先用每天的免费次数，用完再扣这里。')
})
