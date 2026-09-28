// 青序并排截图 · 45 本机构官方渠道、48 政策服务的运行态登记（第三波 45/48 打样，2026-09-29）。
//
// 只拦 /api/v1、点可见控件，不改页面。
//
// 45：稿的四个态（ready / navigator / qr / invalid-platform）画的是同一屏——一张示例码。
//     运行页没有「AI 找岗方向」页内表单、没有扫码弹层、也不读 ?platform=，这三态不配（写明原因）；
//     运行页自己的态（一张 / 两张 / 三张渠道、托管 b 另列「其他来源平台」、没有渠道、读取失败、读取中）
//     另外登记成 runtime:* 对，左边一律配稿的 ready 并排看。
// 48：五个分区按 ?tab= 进。政策与公告同走 GET /policies，按 kind 分开答（ApiRouter 只认路径，这里用
//     page.route 按查询串分）；条件核对先用空作答探一次，再按作答比对：POST 第 1 次是探针、第 2 次是提交。
import type { Page, Route } from '@playwright/test'
import type { ApiRouter } from '../../fixtures/api-router'
import { RECRUITMENT_HOSTING_OFF, RECRUITMENT_HOSTING_ON, terminalConfigWithHosting } from '../../fixtures/recruitment-hosting'
import type { QingxuPairTarget, RuntimePlan } from './qingxu-pair-targets'

export interface PolicyPagesPlan {
  plan: RuntimePlan
  reason: string | null
  marker: string | null
  runtimePath: string | null
}

const PLAN: RuntimePlan = { kind: 'policy-pages' }
const hit = (marker: string, runtimePath: string): PolicyPagesPlan => ({ plan: PLAN, reason: null, marker, runtimePath })
const none = (reason: string): PolicyPagesPlan => ({ plan: { kind: 'none' }, reason, marker: null, runtimePath: null })

// ── 45 本机构官方渠道 ─────────────────────────────────────────────────────

const OC = '[data-kiosk-screen="official-channels"]'
const CHANNELS = '/api/v1/terminals/KSK-001/official-channels'
const ORG = '示例市公共就业服务中心'
const ORG_CHANNELS = [
  { name: '市公共就业服务中心官网', url: 'https://jobs.example.gov.cn/', displayOrder: 1, organizationName: ORG },
  { name: '就业服务中心微信公众号', url: 'https://mp.example.gov.cn/jobs-official', displayOrder: 2, organizationName: ORG },
  { name: '就业服务中心小程序', url: 'https://mini.example.gov.cn/jobs', displayOrder: 3, organizationName: ORG },
]
const LEGACY = [
  { name: '示例招聘平台', url: 'https://jobs.example.com/', displayOrder: 1, organizationName: '示例招聘平台运营公司' },
  { name: '示例人才网', url: 'https://talent.example.org/', displayOrder: 2, organizationName: '示例人才网运营公司' },
]

/** 运行页独有的态：配到稿 45 的 ready 上。 */
const CHANNEL_VARIANTS = ['items-2', 'items-3', 'hosting-b', 'empty', 'error', 'loading'] as const

function channelsPlan(screen: string, state: string): PolicyPagesPlan {
  if (screen === 'main') {
    if (state === 'ready') return hit(`${OC}[data-state="items"]`, '/official-channels')
    if (state === 'navigator') return none('运行页没有「AI 找岗方向」页内表单：「AI 求职方向探索」直接进小青（/assistant?intent=career_explore）')
    if (state === 'qr') return none('运行页每张渠道卡常显自己的二维码，没有单独的扫码弹层')
    return none('运行页不读 ?platform=；旧地址 /jobs/online-platforms 直接落到本页')
  }
  if (state === 'hosting-b') return hit('[data-testid="official-channels-legacy"]', '/official-channels')
  if (state.startsWith('items-')) return hit(`${OC}[data-state="items"]`, '/official-channels')
  return hit(`${OC}[data-state="${state}"]`, '/official-channels')
}

async function openChannels(page: Page, api: ApiRouter, target: QingxuPairTarget): Promise<void> {
  const state = target.screen === 'main' ? 'items-1' : target.state
  const hosting = state === 'hosting-b' ? RECRUITMENT_HOSTING_ON : RECRUITMENT_HOSTING_OFF
  api.respond('GET', '/api/v1/terminals/KSK-001/config', { status: 200, json: terminalConfigWithHosting(hosting, 'qingxu-pairs-45') })
  if (state === 'loading') {
    api.respondWith('GET', CHANNELS, () => new Promise(() => undefined))
  } else if (state === 'error') {
    api.respond('GET', CHANNELS, { status: 503, json: { success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'upstream timeout' } } })
  } else {
    const count = state === 'items-2' ? 2 : state === 'items-3' ? 3 : state === 'empty' ? 0 : 1
    api.respond('GET', CHANNELS, {
      status: 200,
      json: { items: ORG_CHANNELS.slice(0, count), legacyPlatforms: state === 'hosting-b' ? LEGACY : [] },
    })
  }
  await page.goto('/official-channels', { waitUntil: 'domcontentloaded' })
}

// ── 48 政策服务 ─────────────────────────────────────────────────────────

const RQ = '.w4-policy-page'
const POLICY_URL = 'https://hrss.example.gov.cn/policy/2026-0918'
const NOTICE_URL = 'https://hrss.example.gov.cn/notice/2026-0922'

function policyItem(extra: Record<string, unknown> = {}) {
  return {
    id: 'pair-policy-001',
    kind: 'policy_guide',
    title: '高校毕业生一次性求职创业补贴申领指引',
    summary: '毕业学年内、符合困难条件之一的高校毕业生，按学校通知申领。',
    content: '一、补贴对象：毕业学年内有就业创业意愿，且符合困难家庭、残疾、获得助学贷款等条件之一的高校毕业生。\n'
      + '二、申领方式：由学校统一组织申报，经人社部门审核后发放。\n三、补贴标准与申报时间以当年通知为准。',
    audience: 'graduate',
    sourceName: '示例市人力资源和社会保障局',
    syncTime: '2026-09-20T08:00:00.000Z',
    externalId: 'HRSS-2026-0918',
    publishedDate: '2026-09-18',
    externalUrl: POLICY_URL,
    ...extra,
  }
}

function noticeItem(extra: Record<string, unknown> = {}) {
  return {
    id: 'pair-notice-001',
    kind: 'notice',
    category: 'notice',
    title: '关于调整失业保险金线上申领流程的通知',
    summary: '10 月 1 日起，失业保险金申领改为线上预审、窗口复核。',
    content: '自 2026 年 10 月 1 日起，失业保险金申领改为先在线上预审、再到经办窗口复核。\n'
      + '申领人需携带本人身份证件与解除或终止劳动合同证明，具体材料以经办窗口告知为准。',
    sourceName: '示例市公共就业服务中心',
    syncTime: '2026-09-22T08:00:00.000Z',
    externalId: 'NOTICE-2026-0922',
    publishedDate: '2026-09-22',
    externalUrl: NOTICE_URL,
    ...extra,
  }
}

function page200(data: unknown[]) {
  return { success: true, data, pagination: { page: 1, pageSize: 200, total: data.length, totalPages: 1 } }
}

type PolicyReply = 'hang' | 'error' | { guides: unknown[]; notices: unknown[] }

/** GET /policies 按 kind 分开答：政策库条目只回 policy_guide，公告只回 notice。 */
async function routePolicies(page: Page, reply: PolicyReply): Promise<void> {
  await page.route((url) => url.pathname === '/api/v1/policies', async (route: Route) => {
    if (reply === 'hang') return
    if (reply === 'error') {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'SERVICE_UNAVAILABLE', message: 'policy service down' } }) })
      return
    }
    const kind = new URL(route.request().url()).searchParams.get('kind')
    const data = kind === 'notice' ? reply.notices : reply.guides
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(page200(data)) })
  })
}

// 条件核对的问项与两句固定文案取自服务端 policy-eligibility.types.ts，一字不改。
const Q = (key: string, label: string, sensitive: boolean, options: Array<[string, string]>) => ({
  key, label, sensitive, options: options.map(([value, text]) => ({ value, label: text })),
})
const QUESTIONS = {
  questionSetVersion: 'policy-eligibility-questions-v1',
  questions: [
    Q('employment_status', '现在状态', false, [['seeking_after_leaving', '离职找工作中'], ['employed_switching', '在职想换工作'], ['fresh_graduate', '应届毕业生'], ['starting_business', '想创业 / 已创业'], ['unsure', '不确定']]),
    Q('household_social', '户籍社保', true, [['local_household', '本市户籍'], ['nonlocal_with_local_insurance', '外地 · 本市缴社保'], ['nonlocal_without_insurance', '外地 · 未缴社保'], ['unsure', '不确定']]),
    Q('unemployed_duration', '离职多久', false, [['within_1_month', '1 个月内'], ['months_1_to_6', '1–6 个月'], ['over_6_months', '6 个月以上'], ['never_employed', '没工作过'], ['unsure', '不确定']]),
    Q('age_range', '年龄段', true, [['age_16_24', '16–24 岁'], ['age_25_35', '25–35 岁'], ['age_36_45', '36–45 岁'], ['age_46_plus', '46 岁以上'], ['unsure', '不确定']]),
    Q('graduation_year', '毕业年份', false, [['current_year', '本年度应届'], ['within_2_years', '毕业 2 年内'], ['over_2_years', '毕业超过 2 年'], ['not_applicable', '不适用'], ['unsure', '不确定']]),
    Q('unemployment_registration', '失业登记', true, [['registered', '已办'], ['not_registered', '没办'], ['unsure', '不确定']]),
    Q('social_insurance_months', '连续缴费', true, [['none', '未缴'], ['under_3_months', '不满 3 个月'], ['at_least_3_months', '满 3 个月以上'], ['unsure', '不确定']]),
    Q('separation_reason', '离职原因', true, [['layoff_or_contract_end', '裁员 / 合同到期'], ['voluntary_resignation', '本人主动辞职'], ['other', '其他'], ['unsure', '不确定']]),
    Q('prior_subsidy', '领过同类补贴', false, [['never_received', '没领过'], ['received', '领过'], ['unsure', '不确定']]),
  ],
  privacyNotice: '你填写的答案只用于本次条件比对，不保存、不上传给任何政府或第三方系统，'
    + '结果只在这次办理里展示；任何一项都可以不填，不填的条件会标为「无法判定」。',
  disclaimer: '本结果是把你填写的信息与已录入的政策条件做机械比对，不是资格认定。'
    + '本机不做资格认定、不代办、不收费；能不能办以经办窗口审核为准。',
}

const REASON = {
  matched: '你填写的内容与该条已录入条件一致。',
  conflict: '你填写的内容与该条已录入条件不一致。',
  missing: '这一项你没有填写，本条无法判定，需人工核对。',
  manual: '本条按政策原文只能由经办窗口人工核对，本机不做机械比对。',
}

function source(sourceName: string, externalId: string | null) {
  return {
    sourceOrgId: 'org-pair', sourceName, externalId, sourceUrl: POLICY_URL,
    syncTime: '2026-09-20T08:00:00.000Z', reviewStatus: 'approved', publishStatus: 'published',
  }
}
function basis(questionKey: string, questionLabel: string, answerValue: string | null, answerLabel: string | null, clauseResult: string) {
  return { questionKey, questionLabel, answerValue, answerLabel, clauseResult }
}
function cond(ruleId: string, orderIndex: number, label: string, result: string, reasonCode: string, reason: string, sourceText: string, rows: unknown[]) {
  return { ruleId, orderIndex, label, result, reasonCode, reason, sourceText, basis: rows }
}
function checkItem(policyId: string, title: string, src: unknown, overall: string, overallLabel: string, conditions: unknown[], summary: unknown, recorded = true) {
  return {
    policyId, title, kind: 'policy_guide', audience: null, category: null, source: src, evidenceLevel: 'E2',
    conditionsRecorded: recorded, conditions, summary, overall, overallLabel, manualReviewRequired: true,
  }
}
function checkResult(answeredCount: number, items: unknown[]) {
  return {
    questionSetVersion: 'policy-eligibility-questions-v1', checkedAt: '2026-09-29T08:00:00.000Z', answeredCount,
    ignoredQuestionKeys: [], disclaimer: QUESTIONS.disclaimer, method: 'deterministic_comparison', items,
  }
}

/** 探针（空作答）：录了条件的政策，逐条都是「无法判定」。 */
function probeResult() {
  return checkResult(0, [
    checkItem('pair-policy-001', '高校毕业生一次性求职创业补贴', source('示例市人力资源和社会保障局', 'HRSS-2026-0918'), 'some_conditions_unknown',
      '按你填写的信息，有 0 条与已录入条件相符，2 条无法判定，需人工核对。', [
        cond('r1', 1, '毕业时间', 'unknown', 'ANSWER_MISSING', REASON.missing, '毕业学年内的高校毕业生', [basis('graduation_year', '毕业年份', null, null, 'unknown')]),
        cond('r2', 2, '困难条件', 'unknown', 'MANUAL_REVIEW_ONLY', REASON.manual, '符合困难家庭、残疾、获得助学贷款等条件之一', []),
      ], { matched: 0, conflict: 0, unknown: 2, total: 2 }),
  ])
}

/** 提交（应届毕业生 · 本年度应届）：一条部分相符待人工核对，一条有一项不一致。 */
function submitResult() {
  return checkResult(2, [
    checkItem('pair-policy-001', '高校毕业生一次性求职创业补贴', source('示例市人力资源和社会保障局', 'HRSS-2026-0918'), 'some_conditions_unknown',
      '按你填写的信息，有 1 条与已录入条件相符，1 条无法判定，需人工核对。', [
        cond('r1', 1, '毕业时间', 'matched', 'ANSWER_MATCHES_RECORDED_CONDITION', REASON.matched, '毕业学年内的高校毕业生', [basis('graduation_year', '毕业年份', 'current_year', '本年度应届', 'matched')]),
        cond('r2', 2, '困难条件', 'unknown', 'MANUAL_REVIEW_ONLY', REASON.manual, '符合困难家庭、残疾、获得助学贷款等条件之一', []),
      ], { matched: 1, conflict: 0, unknown: 1, total: 2 }),
    checkItem('pair-policy-002', '失业人员灵活就业社保补贴', source('示例市公共就业服务中心', null), 'some_conditions_conflict',
      '按你填写的信息，有 1 条与已录入条件不一致；另有 0 条相符、1 条无法判定。', [
        cond('r3', 1, '就业状态', 'conflict', 'ANSWER_CONFLICTS_WITH_RECORDED_CONDITION', REASON.conflict, '已办理失业登记、以灵活就业方式就业的人员', [basis('employment_status', '现在状态', 'fresh_graduate', '应届毕业生', 'conflict')]),
        cond('r4', 2, '户籍社保', 'unknown', 'ANSWER_MISSING', REASON.missing, '在本市以灵活就业人员身份参加社会保险', [basis('household_social', '户籍社保', null, null, 'unknown')]),
      ], { matched: 0, conflict: 1, unknown: 1, total: 2 }),
  ])
}

function noRulesResult() {
  return checkResult(0, [
    checkItem('pair-policy-001', '高校毕业生一次性求职创业补贴', source('示例市人力资源和社会保障局', 'HRSS-2026-0918'), 'no_recorded_conditions',
      '该政策尚未录入可机械比对的条件，本次未做条件核对，需人工核对。', [], { matched: 0, conflict: 0, unknown: 0, total: 0 }, false),
  ])
}

const ELIG_WAIT: Record<string, string> = {
  'eligibility-probing': '.k8-elig .rq-state[data-kind="info"]',
  'eligibility-no-policies': '.k8-elig-notice',
  'eligibility-no-rules': '.k8-elig-notice',
  'eligibility-error': '.k8-elig-notice',
  'eligibility-ask-empty': '.k8-elig-questions',
  'eligibility-ask-partial': '.k8-elig-opt[aria-pressed="true"]',
  'eligibility-submitting': '.k8-elig-opt[aria-pressed="true"]',
  'eligibility-result': '.k8-elig-headline',
}

const POLICY_WAIT: Record<string, string> = {
  loading: `${RQ} .rq-state[data-kind="info"]`,
  'policy-ready': '[data-policy-section="library"] .k8-policy-list-item.is-open',
  'policy-library-empty': '[data-policy-section="library"] .rq-state[data-kind="empty"]',
  'filtered-empty': '[data-policy-section="library"] .rq-state[data-kind="filter"]',
  'request-error': `${RQ} .rq-state[data-kind="error"]`,
  'source-qr': '.rq-qr-layer [role="dialog"]',
  'source-missing': '[data-policy-section="library"] .rq-exit[aria-disabled="true"]',
  'source-invalid': '[data-policy-section="library"] .rq-exit[aria-disabled="true"]',
  'context-missing': '[data-policy-section="builtin"] .k8-policy-list-item.is-open',
}

const NOTICE_WAIT: Record<string, string> = {
  'notice-ready': '[data-testid="renshi-notice-list"] .k8-policy-list-item.is-open',
  'notice-empty': '[data-testid="renshi-notice-empty"]',
  'source-qr': '.rq-qr-layer [role="dialog"]',
  'source-missing': '[data-testid="renshi-notice-list"] .rq-exit[aria-disabled="true"]',
  'source-invalid': '[data-testid="renshi-notice-list"] .rq-exit[aria-disabled="true"]',
}

function renshiPlan(screen: string, state: string): PolicyPagesPlan {
  const path = `/renshi?tab=${screen}`
  if (screen === 'policy') {
    if (state === 'ai-unavailable') return none('政策页不读 AI 可用性：小青入口只是跳转，连不上时由小青页自己说明；这一屏与 policy-ready 相同')
    if (state === 'manual-view-source') return none('运行页没有单独的「人工核对」屏：原文与来源在展开条里常显，与 policy-ready 相同')
    const marker = POLICY_WAIT[state]
    return marker ? hit(marker, path) : none('没有现成注册器覆盖这一态')
  }
  if (screen === 'eligibility') {
    if (state === 'eligibility-backend-required') return none('「本机现在做不了条件核对」只在未连接后端（API_MODE≠http）的构建里出现，并排截图用的是 http 构建')
    const marker = ELIG_WAIT[state]
    return marker ? hit(marker, path) : none('没有现成注册器覆盖这一态')
  }
  if (screen === 'social') return hit(state === 'source-qr' ? '.rq-qr-layer [role="dialog"]' : '.rq-social', path)
  if (screen === 'register') return hit('.rq-register', path)
  if (screen === 'notice') {
    const marker = NOTICE_WAIT[state]
    return marker ? hit(marker, path) : none('没有现成注册器覆盖这一态')
  }
  return none('稿里的分区不在运行页的五个分区里')
}

async function see(page: Page, selector: string): Promise<void> {
  await page.locator(selector).first().waitFor({ state: 'visible', timeout: 12_000 })
}

function policyReply(tab: string, state: string): PolicyReply {
  if (tab === 'policy' && state === 'loading') return 'hang'
  if (tab === 'policy' && state === 'request-error') return 'error'
  if (tab === 'policy' && state === 'policy-library-empty') return { guides: [], notices: [noticeItem()] }
  if (tab === 'policy' && state === 'source-missing') return { guides: [policyItem({ externalUrl: undefined })], notices: [] }
  if (tab === 'policy' && state === 'source-invalid') return { guides: [policyItem({ externalUrl: 'hrss-link-pending' })], notices: [] }
  if (tab === 'notice' && state === 'notice-empty') return { guides: [policyItem()], notices: [] }
  if (tab === 'notice' && state === 'source-missing') return { guides: [], notices: [noticeItem({ externalUrl: undefined })] }
  if (tab === 'notice' && state === 'source-invalid') return { guides: [], notices: [noticeItem({ externalUrl: 'notice-link-pending' })] }
  return { guides: [policyItem()], notices: [noticeItem()] }
}

function registerEligibility(api: ApiRouter, state: string): void {
  const questions = '/api/v1/policies/eligibility-questions'
  const check = '/api/v1/policies/eligibility-check'
  const down = { status: 503, json: { error: { code: 'SERVICE_UNAVAILABLE', message: 'policy service down' } } }
  if (state === 'eligibility-probing') {
    api.respondWith('GET', questions, () => new Promise(() => undefined))
    api.respondWith('POST', check, () => new Promise(() => undefined))
    return
  }
  if (state === 'eligibility-error') {
    api.respond('GET', questions, down)
    api.respond('POST', check, down)
    return
  }
  api.respond('GET', questions, { status: 200, json: QUESTIONS })
  if (state === 'eligibility-no-policies') {
    api.respond('POST', check, { status: 200, json: checkResult(0, []) })
    return
  }
  if (state === 'eligibility-no-rules') {
    api.respond('POST', check, { status: 200, json: noRulesResult() })
    return
  }
  api.respondWith('POST', check, (n) => {
    if (n === 1) return { status: 200, json: probeResult() }
    if (state === 'eligibility-submitting') return new Promise(() => undefined)
    return { status: 200, json: submitResult() }
  })
}

async function openRenshi(page: Page, api: ApiRouter, target: QingxuPairTarget): Promise<void> {
  const { screen: tab, state } = target
  page.setDefaultTimeout(12_000)
  await routePolicies(page, policyReply(tab, state))
  if (tab === 'eligibility') registerEligibility(api, state)

  await page.goto(`/renshi?tab=${tab}`, { waitUntil: 'domcontentloaded' })
  await see(page, RQ)

  if (tab === 'policy') {
    if (state === 'filtered-empty') {
      await see(page, '[data-policy-section="library"] .k8-policy-list-item')
      await page.getByRole('button', { name: '创业人员', exact: true }).click()
    } else if (state === 'source-qr') {
      await see(page, '[data-policy-section="library"] .k8-policy-list-item.is-open')
      await page.locator('[data-policy-section="library"]').getByRole('button', { name: /扫码打开来源链接/ }).click()
    } else if (state === 'context-missing') {
      await see(page, '[data-policy-section="builtin"] .k8-policy-list-item')
      await page.locator('[data-policy-section="builtin"]').getByRole('button', { name: /职业技能培训/ }).click()
    }
    return
  }
  if (tab === 'eligibility') {
    if (state === 'eligibility-ask-partial' || state === 'eligibility-submitting' || state === 'eligibility-result') {
      await see(page, '.k8-elig-questions')
      await page.getByRole('button', { name: '应届毕业生', exact: true }).click()
      await page.getByRole('button', { name: '本年度应届', exact: true }).click()
      if (state !== 'eligibility-ask-partial') {
        await page.locator('.rq-cta-host .k8-elig-submit').click()
        await see(page, state === 'eligibility-result' ? '.k8-elig-headline' : 'text=正在比对…')
      }
    }
    return
  }
  if (tab === 'social' && state === 'source-qr') {
    await see(page, '.rq-social')
    await page.getByRole('button', { name: /扫码查询/ }).first().click()
    return
  }
  if (tab === 'notice' && state === 'source-qr') {
    await see(page, '[data-testid="renshi-notice-list"] .k8-policy-list-item.is-open')
    await page.locator('[data-testid="renshi-notice-list"]').getByRole('button', { name: /扫码打开来源链接/ }).click()
  }
}

// ── 对外 ─────────────────────────────────────────────────────────────

export function policyPagesPlan(file: string, screen: string, state: string): PolicyPagesPlan | null {
  if (file.startsWith('45-')) return channelsPlan(screen, state)
  if (file.startsWith('48-')) return renshiPlan(screen, state)
  return null
}

/** 稿里画不出、运行页真有的态：登记成额外的对，左边配最接近的稿态。 */
export function policyPagesExtraPairs(file: string): Array<{ screen: string; state: string; route: string; protoQuery: string }> {
  if (!file.startsWith('45-')) return []
  return CHANNEL_VARIANTS.map((state) => ({
    screen: 'runtime',
    state,
    route: '/official-channels',
    protoQuery: '?state=ready&capture=1&flat=1',
  }))
}

export async function preparePolicyPages(page: Page, api: ApiRouter, target: QingxuPairTarget): Promise<void> {
  if (target.nn === '45') return openChannels(page, api, target)
  if (target.nn === '48') return openRenshi(page, api, target)
}
