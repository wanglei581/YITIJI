// 上线前清单 4.4：岗位 / 招聘会 / 政策 真人走查。
//
// 写法对齐 human-journey.spec.ts：api mock fixture、step() 自动截图、
// 每条旅程独立 context（Playwright test 默认如此）、可点区不小于 48px。
// 合规文案：先剔白名单再查黑名单，复用 sweep-copy-guards.mjs，不另写一套。
import type { Page } from '@playwright/test'
import { test, expect } from '../fixtures/kiosk-test'
import type { ApiRouter } from '../fixtures/api-router'
import { registerW6Api } from './fixtures/fusion-w6-api'
import {
  COMPLIANCE_ALLOWED_PHRASES,
  formatMissingSourceFourElements,
  missingSourceFourElements,
  scanForbiddenCopy,
} from '../../scripts/lib/sweep-copy-guards.mjs'

const SHOTS = process.env.JOURNEY_SHOTS_DIR ?? 'test-results/job-fair-policy-journey'

const JOB_APPLY_WHITELIST = ['去来源平台投递', '扫码投递'] as const
const FAIR_BOOKING_WHITELIST = ['去来源平台预约', '扫码预约'] as const
const REQUIRED_SOURCE_LABELS = ['来源机构', '同步时间', '外部ID'] as const

const JOB_SOURCE_NAME = '青岛市公共就业服务中心'
const JOB_EXTERNAL_ID = 'EXT-job-001'
const FAIR_NAME = '2026 青岛高校毕业生招聘会'
const FAIR_SOURCE_NAME = '青岛公共就业服务网'
const FAIR_SOURCE_URL = 'https://jobs.example.gov.cn/fairs/fair-001'
const POLICY_TITLE = '高校毕业生就业服务指引'
const POLICY_ENTRY_URL = 'https://hrss.example.gov.cn/policy/001'

type Step = { n: number }

/** 截一步，并把该屏所有可见控件（文本 + 高度 + 是否禁用）打出来当证据。 */
async function step(page: Page, s: Step, label: string): Promise<void> {
  s.n += 1
  const tag = `${String(s.n).padStart(2, '0')}-${label}`
  await page.screenshot({ path: `${SHOTS}/${tag}.png` })
  const ctrls = await page
    .locator('button:visible, a[href]:visible, [role="button"]:visible')
    .evaluateAll((els) =>
      els
        .map((e) => {
          const r = e.getBoundingClientRect()
          return {
            t: (e.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 20),
            h: Math.round(r.height),
            dis: (e as HTMLButtonElement).disabled === true,
          }
        })
        .filter((x) => x.h > 0),
    )
  const small = ctrls.filter((c) => c.h < 48)
  console.log(
    `\n  [${tag}] ${page.url().replace(/^https?:\/\/[^/]+/, '')}` +
      `\n    控件 ${ctrls.length} 个（禁用 ${ctrls.filter((c) => c.dis).length}）：` +
      ctrls.map((c) => `${c.t}(${c.h}${c.dis ? '·禁' : ''})`).join(' ') +
      (small.length ? `\n    ⚠ <48px：${small.map((c) => `${c.t}(${c.h})`).join(' ')}` : ''),
  )
  // 一体机硬约束：可点区不小于 48px（CLAUDE.md §9）
  expect(small, `${tag} 有低于 48px 的可点控件`).toEqual([])
}

async function visibleButtonTexts(page: Page, needle: RegExp): Promise<string[]> {
  return page.locator('button:visible').evaluateAll((els, source) => {
    const re = new RegExp(source)
    return els
      .map((e) => (e.textContent ?? '').replace(/\s+/g, ' ').trim())
      .filter((t) => re.test(t))
  }, needle.source)
}

function assertButtonsInWhitelist(
  texts: string[],
  whitelist: readonly string[],
  label: string,
): void {
  expect(texts, `${label}必须存在`).not.toEqual([])
  for (const t of texts) {
    const allowed = whitelist.some((phrase) => t.includes(phrase))
    expect(allowed, `${label}「${t}」不在合规白名单（${whitelist.join(' / ')}）`).toBe(true)
  }
}

/**
 * 岗位夹具 —— 形状以 packages/shared/src/types/job.ts 为准：
 *   列表 = PaginatedResponse<ExternalJobDTO> = { data: T[], pagination }，**不带 success 信封**
 *   ExternalJobSource 必填：sourceOrgId / externalId / sourceName / sourceUrl / syncTime
 *                          / reviewStatus / publishStatus
 *   ExternalJobDTO 必填：salaryDisplay / dataSourceNote
 * 2026-09-08 实测：包成 { success, data: { items } } 会让列表页整页落到兜底错误页。
 */
function seedJobs(api: ApiRouter): void {
  const job = (id: string, title: string, company: string) => ({
    id,
    title,
    company,
    city: '青岛市',
    tags: ['五险一金', '双休'],
    description: '岗位职责与任职要求（模拟数据）。',
    requirements: '本科及以上学历。',
    sourceOrgId: 'org-qd-employment',
    externalId: `EXT-${id}`,
    sourceName: JOB_SOURCE_NAME,
    sourceUrl: `https://example.gov.cn/jobs/${id}`,
    syncTime: '2026-09-06T02:00:00.000Z',
    reviewStatus: 'approved' as const,
    publishStatus: 'published' as const,
    salaryDisplay: '8,000–12,000 元/月',
    dataSourceNote: '本岗位信息来自青岛市公共就业服务中心，本终端仅展示与跳转，不代收简历。',
    category: 'fulltime' as const,
    workType: 'full_time' as const,
    educationRequirement: '本科',
    experienceRequirement: '1-3 年',
    salaryMin: 8000,
    salaryMax: 12000,
    salaryUnit: 'monthly' as const,
  })
  const data = [
    job('job-001', '前端工程师', '青岛某某科技有限公司'),
    job('job-002', '人力资源专员', '某某人力资源服务有限公司'),
    job('job-003', '数控机床操作工', '某某智能制造股份有限公司'),
  ]
  const paged = { data, pagination: { page: 1, pageSize: 20, total: data.length, totalPages: 1 } }
  api.respond('GET', '/api/v1/jobs', { status: 200, json: paged })
  for (const it of data) {
    api.respond('GET', `/api/v1/jobs/${it.id}`, { status: 200, json: { success: true, data: it } })
  }
}

function seedFairs(api: ApiRouter): void {
  const fair = {
    id: 'fair-001',
    name: FAIR_NAME,
    organizer: '青岛市公共就业服务中心',
    startTime: '2026-10-12T01:00:00.000Z',
    endTime: '2026-10-12T08:00:00.000Z',
    venue: '青岛国际会展中心',
    latitude: 36.0671,
    longitude: 120.3826,
    status: 'upcoming',
    theme: 'campus',
    city: '青岛市',
    address: '崂山区苗岭路9号',
    boothCount: 1,
    jobCount: 2,
    sourceOrgId: 'source-001',
    externalId: 'ext-fair-001',
    sourceName: FAIR_SOURCE_NAME,
    sourceUrl: FAIR_SOURCE_URL,
    checkinUrl: 'https://jobs.example.gov.cn/fairs/fair-001/checkin',
    syncTime: '2026-09-06T02:00:00.000Z',
    reviewStatus: 'approved',
    publishStatus: 'published',
    hasManagedData: true,
    managedCompanyCount: 1,
    managedMaterialCount: 0,
    dataSourceNote: '活动信息来自主办方，以来源平台和现场公告为准。',
  }
  api.respond('GET', '/api/v1/job-fairs', {
    status: 200,
    json: { data: [fair], pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 } },
  })
  api.respond('GET', '/api/v1/job-fairs/fair-001', { status: 200, json: { success: true, data: fair } })
}

function seedPolicies(api: ApiRouter): void {
  const policy = {
    id: 'policy-001',
    kind: 'policy_guide',
    title: POLICY_TITLE,
    summary: '请通过官方入口查看办理条件。',
    audience: 'graduate',
    sourceName: '青岛市人力资源和社会保障局',
    syncTime: '2026-09-06T02:00:00.000Z',
    externalUrl: POLICY_ENTRY_URL,
  }
  api.respond('GET', '/api/v1/policies', {
    status: 200,
    json: { success: true, data: [policy], pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 } },
  })
}

test.describe('上线前清单 4.4：岗位 / 招聘会 / 政策', () => {
  test('旅程：首页 → 岗位信息 → 全职岗位 → 岗位详情 @kiosk', async ({ page, api }) => {
    registerW6Api(api)
    seedJobs(api)
    const s: Step = { n: 0 }

    await page.goto('/')
    const jobsEntry = page.getByRole('button', { name: /岗位信息/ }).first()
    await expect(jobsEntry).toBeVisible({ timeout: 15000 })
    await step(page, s, 'home')

    await jobsEntry.click()
    await page.waitForURL((u) => u.pathname === '/jobs-service', { timeout: 10000 })
    const fullTime = page.getByRole('button', { name: /全职岗位/ }).first()
    await expect(fullTime).toBeEnabled({ timeout: 15000 })
    await step(page, s, 'jobs-hub')

    await fullTime.click()
    await page.waitForURL((u) => u.pathname === '/jobs', { timeout: 10000 })
    const first = page.getByText('前端工程师').first()
    await expect(first, '全职列表必须出现夹具岗位「前端工程师」').toBeVisible({ timeout: 15000 })
    await step(page, s, 'jobs-list')

    // 进详情必须点「查看岗位」：青序流光迁移（#941）后列表卡片 <article className="jf-row">
    // 已经没有 onClick，点标题什么都不会发生。本行此前点的是标题 —— 用例从未在 CI 跑过，
    // 所以这处失效一直没人看见（见同批 PR 补的 verify:kiosk-browser-spec-coverage）。
    await page.getByRole('button', { name: '查看岗位' }).first().click()
    await page.waitForURL((u) => /\/jobs\/job-001$/.test(u.pathname), { timeout: 10000 })
    await expect(page.getByRole('heading', { name: '前端工程师' })).toBeVisible({ timeout: 10000 })
    await step(page, s, 'job-detail')

    const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
    // 1. 来源机构 / 同步时间 / 外部 ID 三个标签都必须在页上；夹具值也必须在，
    //    防止只渲染了空标签或「来源平台未提供」。
    const missingLabels = REQUIRED_SOURCE_LABELS.filter((label) => !body.includes(label))
    expect(missingLabels, `岗位详情缺少必须同时展示的：${missingLabels.join('、')}`).toEqual([])
    for (const must of [JOB_SOURCE_NAME, JOB_EXTERNAL_ID, '2026年9月6日']) {
      expect(body, `岗位详情缺少必须展示的「${must}」`).toContain(must)
    }
    const missing = missingSourceFourElements(body)
    expect(missing, formatMissingSourceFourElements(missing) || '来源四要素').toEqual([])

    // 2. 投递按钮必须是白名单文案；先剔白名单再查黑名单，避免「打开来源平台投递页」误报。
    const applyTexts = await visibleButtonTexts(page, /投递/)
    assertButtonsInWhitelist(applyTexts, JOB_APPLY_WHITELIST, '岗位详情投递按钮')
    for (const phrase of JOB_APPLY_WHITELIST) {
      expect(applyTexts.some((t) => t.includes(phrase)), `岗位详情缺少投递按钮「${phrase}」`).toBe(true)
    }
    for (const t of applyTexts) {
      expect(
        COMPLIANCE_ALLOWED_PHRASES.some((phrase) => t.includes(phrase)),
        `岗位详情投递按钮「${t}」不在 COMPLIANCE_ALLOWED_PHRASES`,
      ).toBe(true)
    }
    const forbidden = scanForbiddenCopy(body)
    expect(forbidden, `岗位详情出现违规文案「${forbidden.join('、')}」`).toEqual([])

    console.log(`\n  岗位详情含来源机构：${body.includes('来源机构')}`)
    console.log(`  岗位详情含同步时间：${body.includes('同步时间')}`)
    console.log(`  岗位详情含外部ID：${body.includes('外部ID')}`)
    console.log(`  岗位详情投递按钮：${applyTexts.join(' / ')}`)
    console.log(`\n  旅程终点：${new URL(page.url()).pathname}`)
  })

  test('旅程：首页 → 招聘会 → 社会招聘会 → 招聘会详情 @kiosk', async ({ page, api }) => {
    registerW6Api(api)
    seedFairs(api)
    const s: Step = { n: 0 }

    await page.goto('/')
    // 无障碍名是「招聘会」+「场次、企业与现场导览」，中间可能有空格。
    // V6 首页是 `[data-domain-id="fairs"] button.v6-home-domain__main`；青序流光首页
    // 换成带 `data-action="fairs-hub"` 的磁贴（QxHomeView.tsx:226）。钉钩子不钉 class。
    const fairsEntry = page.locator('[data-action="fairs-hub"]')
    await expect(fairsEntry).toBeVisible({ timeout: 15000 })
    await step(page, s, 'home')

    await fairsEntry.click()
    await page.waitForURL((u) => u.pathname === '/fairs-service', { timeout: 10000 })
    const social = page.getByRole('button', { name: /社会招聘会/ }).first()
    await expect(social).toBeEnabled({ timeout: 15000 })
    await step(page, s, 'fairs-hub')

    await social.click()
    await page.waitForURL((u) => u.pathname === '/job-fairs', { timeout: 10000 })
    const fairRow = page.getByRole('button', { name: `查看 ${FAIR_NAME} 详情` })
    await expect(fairRow, `列表必须出现夹具招聘会「${FAIR_NAME}」`).toBeVisible({ timeout: 15000 })
    await step(page, s, 'fairs-list')

    await fairRow.click()
    await page.waitForURL((u) => u.pathname === '/job-fairs/fair-001', { timeout: 10000 })
    await expect(page.getByText(FAIR_NAME).first()).toBeVisible({ timeout: 10000 })
    await step(page, s, 'fair-detail')

    const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
    // 3. 招聘会详情必须展示来源机构，以及外部预约入口（扫码预约 / 去来源平台预约）。
    expect(body, '招聘会详情缺少「来源机构」').toContain('来源机构')
    expect(body, `招聘会详情缺少来源机构名「${FAIR_SOURCE_NAME}」`).toContain(FAIR_SOURCE_NAME)
    const bookingTexts = await visibleButtonTexts(page, /预约/)
    assertButtonsInWhitelist(bookingTexts, FAIR_BOOKING_WHITELIST, '招聘会详情预约按钮')
    const booking = page.getByRole('button', { name: /扫码预约|去来源平台预约/ }).first()
    await expect(booking, '招聘会详情缺少外部预约入口').toBeVisible()
    await expect(booking).toBeEnabled()

    await booking.click()
    await expect(page.getByText('扫码前往来源平台预约')).toBeVisible({ timeout: 5000 })
    const overlayBody = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
    expect(overlayBody, '预约弹层必须带上来源机构名').toContain(FAIR_SOURCE_NAME)
    expect(overlayBody, '预约弹层必须带上外部编号').toContain('ext-fair-001')
    const overlayForbidden = scanForbiddenCopy(overlayBody)
    expect(overlayForbidden, `招聘会预约弹层出现违规文案「${overlayForbidden.join('、')}」`).toEqual([])

    console.log(`\n  招聘会含来源机构：${body.includes('来源机构')}`)
    console.log(`  招聘会预约按钮：${bookingTexts.join(' / ')}`)
    console.log(`\n  旅程终点：${new URL(page.url()).pathname}`)
  })

  test('旅程：首页 → 政策服务 → 就业政策 → 官方入口 @kiosk', async ({ page, api }) => {
    registerW6Api(api)
    seedPolicies(api)
    const s: Step = { n: 0 }

    await page.goto('/')
    // 青序流光首页这颗磁贴叫「就业政策」（V6 叫「政策服务」），带 data-action="policy-hub"。
    const policyEntry = page.locator('[data-action="policy-hub"]')
    await expect(policyEntry).toBeVisible({ timeout: 15000 })
    await step(page, s, 'home')

    await policyEntry.click()
    await page.waitForURL((u) => u.pathname === '/policy-service', { timeout: 10000 })
    const employment = page.getByRole('button', { name: /就业政策/ }).first()
    await expect(employment).toBeEnabled({ timeout: 15000 })
    await step(page, s, 'policy-hub')

    await employment.click()
    await page.waitForURL((u) => u.pathname === '/renshi', { timeout: 10000 })
    await expect(page.getByText(POLICY_TITLE).first()).toBeVisible({ timeout: 15000 })
    await step(page, s, 'policy-page')

    // 4. 官方入口按钮存在且可点（页上的「扫码打开来源链接」即官方入口）。
    const official = page.getByRole('button', { name: '扫码打开来源链接' })
    await expect(official, '政策页缺少官方入口按钮').toBeVisible()
    await expect(official).toBeEnabled()

    await official.click()
    await expect(page.getByText(POLICY_ENTRY_URL)).toBeVisible({ timeout: 5000 })
    await step(page, s, 'policy-official-entry')

    console.log(`\n  政策官方入口已打开：${POLICY_ENTRY_URL}`)
    console.log(`  旅程终点：${new URL(page.url()).pathname}`)
  })
})
