import { expect, type Page, type Route } from '@playwright/test'
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

function policyList() {
  const entries = [
    ['高校毕业生一次性求职创业补贴申领指引', '毕业学年内符合困难条件的高校毕业生，可按学校通知核对申领材料。', 'graduate', '市公共就业与人才服务中心', '2026-09-18', '2026-09-20T08:00:00.000Z'],
    ['灵活就业人员社会保险补贴办理说明', '符合条件的灵活就业人员，可查阅社保补贴范围与申报期限。', 'flexible', '东城区就业服务中心', '2026-09-09', '2026-09-13T02:20:00.000Z'],
    ['返乡人员创业扶持政策申办指南', '返乡创业人员可核对扶持对象、经营要求和当地受理渠道。', 'migrant', '西城区人力资源服务中心', '2026-08-26', '2026-08-29T06:30:00.000Z'],
    ['创业担保贷款申请材料与受理渠道', '创业人员可查看贷款申请条件、担保要求与经办机构说明。', 'startup', '南城区创业服务中心', '2026-08-12', '2026-08-16T03:15:00.000Z'],
    ['就业困难人员认定与就业援助说明', '就业困难人员可查阅认定范围、所需材料及就业援助渠道。', 'hardship', '北城区公共就业服务中心', '2026-07-30', '2026-08-02T07:40:00.000Z'],
    ['高校毕业生基层就业补贴办理指引', '到基层就业的高校毕业生可按当地发布要求核对办理条件。', 'graduate', '高新区人才服务中心', '2026-07-16', '2026-07-21T01:50:00.000Z'],
    ['职业技能培训补贴申领说明', '参加职业技能培训的人员可查看补贴对象和培训机构要求。', 'general', '市职业技能指导中心', '2026-06-24', '2026-06-28T05:10:00.000Z'],
    ['失业人员就业服务与培训支持指南', '登记失业人员可核对就业服务、培训支持与受理渠道。', 'hardship', '经开区就业促进中心', '2026-06-08', '2026-06-12T09:25:00.000Z'],
  ]
  return entries.map(([title, summary, audience, sourceName, publishedDate, syncTime], index) => ({
    ...policyItem(), id: `pair-policy-${String(index + 1).padStart(3, '0')}`,
    title, summary, audience, sourceName, publishedDate, syncTime,
    content: summary, externalId: `HRSS-${publishedDate}`, externalUrl: `${POLICY_URL}/${index + 1}`,
  }))
}

// 问项、选项与两句全文逐字取自服务端 policy-eligibility.types.ts。
const QUESTIONS = {
  "questionSetVersion": "policy-eligibility-questions-v1",
  "questions": [
    {
      "key": "employment_status",
      "label": "现在状态",
      "sensitive": false,
      "options": [
        {
          "value": "seeking_after_leaving",
          "label": "离职找工作中"
        },
        {
          "value": "employed_switching",
          "label": "在职想换工作"
        },
        {
          "value": "fresh_graduate",
          "label": "应届毕业生"
        },
        {
          "value": "starting_business",
          "label": "想创业 / 已创业"
        },
        {
          "value": "unsure",
          "label": "不确定"
        }
      ]
    },
    {
      "key": "household_social",
      "label": "户籍社保",
      "sensitive": true,
      "options": [
        {
          "value": "local_household",
          "label": "本市户籍"
        },
        {
          "value": "nonlocal_with_local_insurance",
          "label": "外地 · 本市缴社保"
        },
        {
          "value": "nonlocal_without_insurance",
          "label": "外地 · 未缴社保"
        },
        {
          "value": "unsure",
          "label": "不确定"
        }
      ]
    },
    {
      "key": "unemployed_duration",
      "label": "离职多久",
      "sensitive": false,
      "options": [
        {
          "value": "within_1_month",
          "label": "1 个月内"
        },
        {
          "value": "months_1_to_6",
          "label": "1–6 个月"
        },
        {
          "value": "over_6_months",
          "label": "6 个月以上"
        },
        {
          "value": "never_employed",
          "label": "没工作过"
        },
        {
          "value": "unsure",
          "label": "不确定"
        }
      ]
    },
    {
      "key": "age_range",
      "label": "年龄段",
      "sensitive": true,
      "options": [
        {
          "value": "age_16_24",
          "label": "16–24 岁"
        },
        {
          "value": "age_25_35",
          "label": "25–35 岁"
        },
        {
          "value": "age_36_45",
          "label": "36–45 岁"
        },
        {
          "value": "age_46_plus",
          "label": "46 岁以上"
        },
        {
          "value": "unsure",
          "label": "不确定"
        }
      ]
    },
    {
      "key": "graduation_year",
      "label": "毕业年份",
      "sensitive": false,
      "options": [
        {
          "value": "current_year",
          "label": "本年度应届"
        },
        {
          "value": "within_2_years",
          "label": "毕业 2 年内"
        },
        {
          "value": "over_2_years",
          "label": "毕业超过 2 年"
        },
        {
          "value": "not_applicable",
          "label": "不适用"
        },
        {
          "value": "unsure",
          "label": "不确定"
        }
      ]
    },
    {
      "key": "unemployment_registration",
      "label": "失业登记",
      "sensitive": true,
      "options": [
        {
          "value": "registered",
          "label": "已办"
        },
        {
          "value": "not_registered",
          "label": "没办"
        },
        {
          "value": "unsure",
          "label": "不确定"
        }
      ]
    },
    {
      "key": "social_insurance_months",
      "label": "连续缴费",
      "sensitive": true,
      "options": [
        {
          "value": "none",
          "label": "未缴"
        },
        {
          "value": "under_3_months",
          "label": "不满 3 个月"
        },
        {
          "value": "at_least_3_months",
          "label": "满 3 个月以上"
        },
        {
          "value": "unsure",
          "label": "不确定"
        }
      ]
    },
    {
      "key": "separation_reason",
      "label": "离职原因",
      "sensitive": true,
      "options": [
        {
          "value": "layoff_or_contract_end",
          "label": "裁员 / 合同到期"
        },
        {
          "value": "voluntary_resignation",
          "label": "本人主动辞职"
        },
        {
          "value": "other",
          "label": "其他"
        },
        {
          "value": "unsure",
          "label": "不确定"
        }
      ]
    },
    {
      "key": "prior_subsidy",
      "label": "领过同类补贴",
      "sensitive": false,
      "options": [
        {
          "value": "never_received",
          "label": "没领过"
        },
        {
          "value": "received",
          "label": "领过"
        },
        {
          "value": "unsure",
          "label": "不确定"
        }
      ]
    }
  ],
  "privacyNotice": "你填写的答案只用于本次条件比对，不保存、不上传给任何政府或第三方系统，结果只在这次办理里展示；任何一项都可以不填，不填的条件会标为「无法判定」。",
  "disclaimer": "本结果是把你填写的信息与已录入的政策条件做机械比对，不是资格认定。本机不做资格认定、不代办、不收费；能不能办以经办窗口审核为准。"
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
        await routePolicies(page, policyList())
        await page.goto('/renshi?tab=policy')
        await see(page, `text=${TITLE}`)
      },
    },
    {
      item: '政策', screen: 'policy-list', state: 'empty', route: '/renshi?tab=policy',
      seeds: ['GET /policies guides []'],
      missingReason: null,
      // 稿上政策库空态由 fyRead='empty' 切换（fix-policy.js「read-empty」演示事件）。
      proto: { patch: { fyRead: 'empty' } },
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
        // 列表默认收起；点标题进入这一条独占的详情态。
        const main = page.locator('[data-policy-section="library"] .rq-item-main').filter({ hasText: TITLE })
        await see(page, `text=${TITLE}`)
        await main.click()
        await expect(page.getByRole('heading', { level: 1, name: TITLE, exact: true })).toBeVisible()
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
