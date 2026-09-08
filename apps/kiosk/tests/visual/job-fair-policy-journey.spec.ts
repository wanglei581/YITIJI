// 岗位详情来源三项走查：写法对齐 human-journey.spec.ts 旅程 C。
//
// 从首页出发、只靠点击推进（直达会跳过目录层）。每条旅程独立 context，
// 避免一体机清场/待机控制器吞掉后续导航。
import type { Page } from '@playwright/test'
import { test, expect } from '../fixtures/kiosk-test'
import type { ApiRouter } from '../fixtures/api-router'
import { registerW6Api } from './fixtures/fusion-w6-api'

const SHOTS = process.env.JOURNEY_SHOTS_DIR ?? 'test-results/job-fair-policy-journey'

/** 岗位详情必须同时露出的三项（CLAUDE.md §10）。页面文案是「外部ID」，无空格。 */
const REQUIRED_SOURCE_LABELS = ['来源机构', '同步时间', '外部ID'] as const

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
}

/**
 * 岗位夹具 —— 形状以 packages/shared/src/types/job.ts 为准，不按项目惯例猜：
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
    sourceName: '青岛市公共就业服务中心',
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
    job('job-001', '前端开发工程师', '青岛某某科技有限公司'),
    job('job-002', '人力资源专员', '某某人力资源服务有限公司'),
    job('job-003', '数控机床操作工', '某某智能制造股份有限公司'),
  ]
  const paged = { data, pagination: { page: 1, pageSize: 20, total: data.length, totalPages: 1 } }
  api.respond('GET', '/api/v1/jobs', { status: 200, json: paged })
  for (const it of data) {
    api.respond('GET', `/api/v1/jobs/${it.id}`, { status: 200, json: { success: true, data: it } })
  }
}

test.describe('岗位 / 招聘会 / 政策走查（模拟数据）', () => {
  test('岗位详情页必须同时展示来源机构、同步时间、外部 ID @kiosk', async ({ page, api }) => {
    registerW6Api(api)
    seedJobs(api)
    const s: Step = { n: 0 }
    await page.goto('/')
    await page.waitForTimeout(2500)
    await step(page, s, 'home')

    const entry = page.getByRole('button', { name: /岗位信息/ }).first()
    await expect(entry).toBeVisible({ timeout: 10000 })
    await entry.click()
    await page.waitForTimeout(2500)
    await step(page, s, 'jobs-list')

    // 「岗位信息」进的是服务目录页 /jobs-service（分类卡），列表还要再点一层。
    // 这一层是走查发现的：直达 /jobs 会跳过目录，真人不会那样走。
    const fullTime = page.getByRole('button', { name: /全职岗位/ }).first()
    await expect(fullTime).toBeVisible({ timeout: 10000 })
    await fullTime.click()
    await page.waitForTimeout(3000)
    await step(page, s, 'jobs-fulltime')

    const first = page.getByText('前端开发工程师').first()
    await expect(first, '全职列表必须出现夹具岗位「前端开发工程师」').toBeVisible({ timeout: 10000 })
    await first.click()
    await page.waitForURL((u) => /\/jobs\/job-001$/.test(u.pathname), { timeout: 10000 })
    await page.waitForTimeout(2500)
    await step(page, s, 'job-detail')

    const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
    const missing = REQUIRED_SOURCE_LABELS.filter((label) => !body.includes(label))
    expect(missing, `岗位详情缺少必须同时展示的：${missing.join('、')}`).toEqual([])
    console.log(`\n  岗位详情含来源机构：${body.includes('来源机构')}`)
    console.log(`  岗位详情含同步时间：${body.includes('同步时间')}`)
    console.log(`  岗位详情含外部ID：${body.includes('外部ID')}`)
    console.log(`\n  终点：${new URL(page.url()).pathname}`)
  })
})
