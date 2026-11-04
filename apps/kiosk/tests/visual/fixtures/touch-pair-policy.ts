import type { Page, Route } from '@playwright/test'
import { registerTouchShell, see } from './touch-pair-shell'
import type { TouchPair } from './touch-pair-types'

const POLICY_URL = 'https://hrss.example.gov.cn/policy/2026-0918'
const TITLE = '高校毕业生一次性求职创业补贴申领指引'

function policyItem() {
  return {
    id: 'pair-policy-001',
    kind: 'policy_guide',
    title: TITLE,
    summary: '毕业学年内、符合困难条件之一的高校毕业生，按学校通知申领。',
    content: '一、补贴对象：毕业学年内有就业创业意愿，且符合困难家庭、残疾、获得助学贷款等条件之一的高校毕业生。\n'
      + '二、申领方式：由学校统一组织申报，经人社部门审核后发放。',
    audience: 'graduate',
    sourceName: '示例市人力资源和社会保障局',
    syncTime: '2026-09-20T08:00:00.000Z',
    externalId: 'HRSS-2026-0918',
    publishedDate: '2026-09-18',
    externalUrl: POLICY_URL,
  }
}

const Q = (key: string, label: string, sensitive: boolean, options: Array<[string, string]>) => ({
  key, label, sensitive, options: options.map(([value, text]) => ({ value, label: text })),
})

const QUESTIONS = {
  questionSetVersion: 'policy-eligibility-questions-v1',
  questions: [
    Q('employment_status', '现在状态', false, [['seeking_after_leaving', '离职找工作中'], ['fresh_graduate', '应届毕业生'], ['unsure', '不确定']]),
    Q('household_social', '户籍社保', true, [['local_household', '本市户籍'], ['unsure', '不确定']]),
    Q('unemployed_duration', '离职多久', false, [['within_1_month', '1 个月内'], ['unsure', '不确定']]),
    Q('age_range', '年龄段', true, [['age_16_24', '16–24 岁'], ['unsure', '不确定']]),
    Q('graduation_year', '毕业年份', false, [['current_year', '本年度应届'], ['unsure', '不确定']]),
    Q('unemployment_registration', '失业登记', true, [['registered', '已办'], ['not_registered', '没办'], ['unsure', '不确定']]),
    Q('social_insurance_months', '连续缴费', true, [['none', '未缴'], ['unsure', '不确定']]),
    Q('separation_reason', '离职原因', true, [['voluntary_resignation', '本人主动辞职'], ['unsure', '不确定']]),
    Q('prior_subsidy', '领过同类补贴', false, [['never_received', '没领过'], ['unsure', '不确定']]),
  ],
  privacyNotice: '你填写的答案只用于本次条件比对，不保存、不上传给任何政府或第三方系统。',
  disclaimer: '本结果是把你填写的信息与已录入的政策条件做机械比对，不是资格认定。',
}

function probeResult() {
  return {
    questionSetVersion: QUESTIONS.questionSetVersion,
    checkedAt: '2026-09-29T08:00:00.000Z',
    answeredCount: 0,
    ignoredQuestionKeys: [],
    disclaimer: QUESTIONS.disclaimer,
    method: 'deterministic_comparison',
    items: [{
      policyId: 'pair-policy-001',
      title: '高校毕业生一次性求职创业补贴',
      kind: 'policy_guide',
      audience: null,
      category: null,
      source: {
        sourceOrgId: 'org-pair',
        sourceName: '示例市人力资源和社会保障局',
        externalId: 'HRSS-2026-0918',
        sourceUrl: POLICY_URL,
        syncTime: '2026-09-20T08:00:00.000Z',
        reviewStatus: 'approved',
        publishStatus: 'published',
      },
      evidenceLevel: 'E2',
      conditionsRecorded: true,
      conditions: [{
        ruleId: 'r1', orderIndex: 1, label: '毕业时间', result: 'unknown',
        reasonCode: 'ANSWER_MISSING', reason: '这一项你没有填写，本条无法判定，需人工核对。',
        sourceText: '毕业学年内的高校毕业生', basis: [],
      }],
      summary: { matched: 0, conflict: 0, unknown: 1, total: 1 },
      overall: 'some_conditions_unknown',
      overallLabel: '按你填写的信息，有 0 条与已录入条件相符，1 条无法判定，需人工核对。',
      manualReviewRequired: true,
    }],
  }
}

async function routePolicies(page: Page, guides: unknown[]): Promise<void> {
  await page.route((url) => (url.pathname === '/api/v1/policies' || /^\/api\/v1\/policies\/[^/]+$/.test(url.pathname))
    && !/\/eligibility-(questions|check)$/.test(url.pathname), async (route: Route) => {
    const requestUrl = new URL(route.request().url())
    const detail = requestUrl.pathname.match(/^\/api\/v1\/policies\/([^/]+)$/)
    if (detail && detail[1] !== 'eligibility-questions' && detail[1] !== 'eligibility-check') {
      const found = guides.find((row) => (row as { id?: string }).id === decodeURIComponent(detail[1] ?? ''))
      await route.fulfill({
        status: found ? 200 : 404,
        contentType: 'application/json',
        body: JSON.stringify(found ? { data: found } : { error: { code: 'POLICY_NOT_FOUND' } }),
      })
      return
    }
    const kind = requestUrl.searchParams.get('kind')
    const rows = kind === 'notice' ? [] : guides
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: rows, pagination: { page: 1, pageSize: 200, total: rows.length, totalPages: 1 } }),
    })
  })
}

export function policyPairs(): TouchPair[] {
  return [
    {
      item: '政策', screen: 'policy', state: 'default', route: '/policy-service',
      seeds: ['registerTouchShell'],
      missingReason: null,
      prepare: async (page, api) => {
        registerTouchShell(api)
        await page.goto('/policy-service')
        await see(page, 'h1')
      },
    },
    {
      item: '政策', screen: 'policy-list', state: 'default', route: '/renshi?tab=policy',
      seeds: ['GET /policies policy_guide'],
      missingReason: null,
      prepare: async (page, api) => {
        registerTouchShell(api)
        await routePolicies(page, [policyItem()])
        await page.goto('/renshi?tab=policy')
        await see(page, `text=${TITLE}`)
      },
    },
    {
      item: '政策', screen: 'policy-list', state: 'empty', route: '/renshi?tab=policy',
      seeds: ['GET /policies guides []'],
      missingReason: null,
      prepare: async (page, api) => {
        registerTouchShell(api)
        await routePolicies(page, [])
        await page.goto('/renshi?tab=policy')
        await see(page, '[data-policy-section="library"] .rq-state[data-kind="empty"]')
      },
    },
    {
      item: '政策', screen: 'policy-detail', state: 'open', route: '/renshi?tab=policy',
      seeds: ['GET /policies', 'click title'],
      missingReason: null,
      prepare: async (page, api) => {
        registerTouchShell(api)
        await routePolicies(page, [policyItem()])
        await page.goto('/renshi?tab=policy')
        await page.getByText(TITLE, { exact: true }).click()
        await see(page, 'text=申领方式')
      },
    },
    {
      item: '政策', screen: 'policy-check', state: 'questions', route: '/renshi?tab=eligibility',
      seeds: ['GET eligibility-questions', 'POST eligibility-check probe'],
      missingReason: null,
      prepare: async (page, api) => {
        registerTouchShell(api)
        api.respond('GET', '/api/v1/policies/eligibility-questions', { status: 200, json: QUESTIONS })
        api.respond('POST', '/api/v1/policies/eligibility-check', { status: 200, json: probeResult() })
        await page.goto('/renshi?tab=eligibility')
        await see(page, '.k8-elig-questions')
      },
    },
  ]
}
