// 第 11 包（私有化版招聘）触屏壳的版式体检。
//
// 招聘页只在托管打开（客户私有化部署）时才挂载；ApiRouter 默认按「托管打开」应答，所以这里直接进页。
// 对每个页面和主要状态量同一组指标，防止回到「只换外框、正文原样」或者悄悄退回旧壳：
//   · 顶上有私有化版标识条，文字逐字照稿；
//   · 底导航三项（首页 / AI 顾问 / 我的）始终在，底栏里恰好一个问小青、问小青以「问小青」开头；
//   · 底栏所有按钮同在一行、都在屏内，主按钮高 88；
//   · 屏上没有小于 20px 的字，没有小于 64×64 的可点区；
//   · 现场无人值守：屏上不出现「联系 / 找（现场）工作人员」。
//
// 阳性对照写在断言里：先断言触屏壳恰好 1 个、标识条恰好 1 个，再断言「没有」类指标，
// 探针没量到东西时不会因为空数组而通过。
import type { Page } from '@playwright/test'
import { test, expect } from '../fixtures/kiosk-test'
import type { ApiRouter } from '../fixtures/api-router'
import { registerW6Api } from './fixtures/fusion-w6-api'
import { registerFairApi, FAIR_ID } from './fixtures/fair-workbench-api'

const RIBBON = '私有化部署版 · 仅供持有人力资源服务许可证的客户自行运营 · 我方云上不出现 · 不得用于对外宣传'
const FORBIDDEN_STAFF = /联系现场|联系工作人员|找现场|找工作人员|交给.{0,2}工作人员|去服务台|工作人员核查/
const boom = { status: 500, json: { success: false, error: { code: 'INTERNAL_ERROR', message: 'boom' } } }
const notFound = { status: 404, json: { success: false, error: { code: 'NOT_FOUND', message: 'not found' } } }

type Case = { name: string; url: string; setup?: (api: ApiRouter) => void }
const w6 = (extra?: (api: ApiRouter) => void) => (api: ApiRouter) => { registerW6Api(api); extra?.(api) }
const fair = (options: Parameters<typeof registerFairApi>[1] = {}) => (api: ApiRouter) => { registerW6Api(api); registerFairApi(api, options) }
const F = (path: string) => `/job-fairs/${FAIR_ID}${path}`

const CASES: Case[] = [
  { name: '社会招聘台', url: '/jobs-service' },
  { name: '社会招聘台·在线服务不可用', url: '/jobs-service', setup: w6((api) => api.respond('GET', '/api/v1/health', { status: 503, json: { success: false } })) },
  { name: '校园招聘台', url: '/fairs-service' },
  { name: '岗位列表', url: '/jobs' },
  { name: '岗位列表·读取失败', url: '/jobs', setup: w6((api) => api.respond('GET', '/api/v1/jobs', boom)) },
  { name: '岗位详情', url: '/jobs/job-001' },
  { name: '岗位详情·不存在', url: '/jobs/job-001', setup: w6((api) => api.respond('GET', '/api/v1/jobs/job-001', notFound)) },
  { name: '线下岗位详情', url: '/jobs/offline-job-001/offline' },
  { name: '线下机构列表', url: '/offline-agencies' },
  { name: '线下机构详情', url: '/offline-agencies/agency-001' },
  { name: '线下机构详情·不可用', url: '/offline-agencies/agency-001', setup: w6((api) => api.respond('GET', '/api/v1/kiosk/offline-agencies/agency-001', notFound)) },
  { name: '企业列表', url: '/companies' },
  { name: '企业详情', url: '/companies/company-001' },
  { name: '企业详情·没有在招岗位', url: '/companies/company-001', setup: w6((api) => api.respond('GET', '/api/v1/companies/company-001/jobs', { status: 200, json: { success: true, data: { items: [], nextCursor: null, total: 0 } } })) },
  { name: '企业详情·不可用', url: '/companies/company-001', setup: w6((api) => api.respond('GET', '/api/v1/companies/company-001', notFound)) },
  { name: '校园招聘', url: '/campus' },
  { name: '校园招聘·选中一场', url: '/campus?fair=fair-001' },
  { name: '校园招聘·没有场次', url: '/campus', setup: w6((api) => api.respond('GET', '/api/v1/job-fairs', { status: 200, json: { success: true, data: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } } })) },
  { name: '校园迎新', url: '/campus/welcome' },
  { name: '校园招聘数据', url: '/campus/freshman-insights' },
  { name: '招聘会列表', url: '/job-fairs', setup: fair() },
  { name: '招聘会列表·没有场次', url: '/job-fairs', setup: fair({ list: 'empty' }) },
  { name: '招聘会详情', url: F(''), setup: fair() },
  { name: '招聘会详情·没取到', url: F(''), setup: fair({ detail: 'error' }) },
  { name: '参展企业', url: F('/companies'), setup: fair() },
  { name: '参展企业详情', url: F('/companies/fair-company-001'), setup: fair() },
  { name: '展位分布', url: F('/map'), setup: fair() },
  { name: '活动物料', url: F('/materials'), setup: fair() },
  { name: '活动物料·读取失败', url: F('/materials'), setup: fair({ materials: 'error' }) },
  { name: '参会准备', url: F('/visit-plan'), setup: fair() },
  { name: '现场统计', url: F('/stats'), setup: fair({ stats: 'real' }) },
  { name: '到场指引', url: '/job-fairs/checkin', setup: fair({ fair: { status: 'ongoing' } }) },
  { name: '到场指引·没有入口', url: '/job-fairs/checkin', setup: fair({ list: 'empty' }) },
]

/** 在页面里量一遍。可点区按舞台缩放换算回 CSS px（舞台等比缩放时屏上量到的 px = CSS px × scale）。 */
async function measure(page: Page) {
  return page.evaluate(() => {
    const root = document.querySelector('[data-qxt-screen]') as HTMLElement
    const stage = document.querySelector('.kiosk-stage') as HTMLElement | null
    const scale = stage ? stage.getBoundingClientRect().width / 1080 : 1
    const vis = (el: Element) => {
      const r = el.getBoundingClientRect(); const cs = getComputedStyle(el)
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0'
    }
    const small: string[] = []
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    let texts = 0
    while (walker.nextNode()) {
      const node = walker.currentNode as Text
      const text = (node.textContent || '').trim()
      const el = node.parentElement
      if (!text || !el || !vis(el) || el.closest('[aria-hidden="true"], script, style, .sr-only, [inert]')) continue
      texts += 1
      const px = parseFloat(getComputedStyle(el).fontSize)
      if (px < 20) small.push(`${text.slice(0, 20)}(${px}px)`)
    }
    const targets = [...root.querySelectorAll('button, a[href], [role="button"], select, textarea, input:not([type="hidden"]):not([type="file"]):not(.sr-only)')]
      .filter((el) => vis(el) && !el.closest('[aria-hidden="true"], [inert], .sr-only'))
    const tiny = targets
      .map((el) => { const r = el.getBoundingClientRect(); return { w: r.width / scale, h: r.height / scale, t: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 16) } })
      .filter((x) => x.w < 63.5 || x.h < 63.5)
      .map((x) => `${x.t}[${Math.round(x.w)}x${Math.round(x.h)}]`)
    const dock = root.querySelector('.qxt-dock') as HTMLElement | null
    const kids = dock ? [...dock.children].filter(vis) : []
    const tops = new Set(kids.map((k) => Math.round(k.getBoundingClientRect().top / scale / 4)))
    const viewportWidth = document.documentElement.clientWidth
    const dockInside = kids.every((k) => { const r = k.getBoundingClientRect(); return r.left >= -0.5 && r.right <= viewportWidth + 0.5 })
    const primary = dock?.querySelector('.qxt-btn-pri') as HTMLElement | null
    return {
      texts,
      targets: targets.length,
      small,
      tiny,
      dockKids: kids.length,
      dockRows: tops.size,
      dockInside,
      primaryHeight: primary ? Math.round(primary.getBoundingClientRect().height / scale) : null,
      navLabels: [...root.querySelectorAll('.qxt-nav button')].map((b) => (b.textContent || '').trim()),
      askLabels: [...root.querySelectorAll('.qxt-dock .qxt-askq')].map((b) => (b.textContent || '').trim()),
      screenText: root.innerText,
    }
  })
}

for (const c of CASES) {
  test(`${c.name}：触屏壳体检（标识条、底导航、问小青、单行底栏、字号与可点区、无人值守） @w4`, async ({ page, api }) => {
    ;(c.setup ?? w6())(api)
    await page.goto(c.url)
    await expect(page.locator('[data-qxt-screen]')).toHaveCount(1)
    await expect(page.getByTestId('recruit-private-ribbon')).toHaveText(RIBBON)
    await expect(page.locator('.qxt-nav button')).toHaveCount(3)
    await expect(page.locator('.qxt-dock .qxt-askq')).toHaveCount(1)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(300)

    const m = await measure(page)
    expect(m.texts, '探针没量到文字').toBeGreaterThan(10)
    expect(m.targets, '探针没量到可点控件').toBeGreaterThan(3)
    expect(m.navLabels.map((label) => label.replace(/\s+/g, ' '))).toEqual(['首页', 'AI 顾问', '我的'])
    expect(m.askLabels, '底栏里恰好一个问小青').toHaveLength(1)
    expect(m.askLabels[0].startsWith('问小青')).toBe(true)
    expect(m.dockKids).toBeGreaterThanOrEqual(2)
    expect(m.dockRows, `底栏按钮不在同一行（${m.dockKids} 个）`).toBe(1)
    expect(m.dockInside, '底栏按钮越出了屏幕宽度').toBe(true)
    if (m.primaryHeight !== null) expect(m.primaryHeight).toBe(88)
    expect(m.small, `不足 20px 的字: ${m.small.join('; ')}`).toEqual([])
    expect(m.tiny, `小于 64×64 的可点区: ${m.tiny.join('; ')}`).toEqual([])
    expect(m.screenText).not.toMatch(FORBIDDEN_STAFF)
  })
}

// 5xx：通用错误文案里带「联系现场工作人员」，现场无人值守，招聘页的失败态必须换成当前操作的那句，求助只给服务电话。
test('岗位列表 5xx：失败态不写联系工作人员，求助句是服务电话 @w4', async ({ page, api }) => {
  registerW6Api(api)
  api.respond('GET', '/api/v1/jobs', boom)
  await page.goto('/jobs')
  await expect(page.getByTestId('jobs-state-error')).toBeVisible()
  // 阳性对照：页面确实把失败原因说了，并给出服务电话（夹具里的公示号码）。
  await expect(page.getByText('岗位信息暂时无法加载，请稍后重试')).toBeVisible()
  await expect(page.getByText(/拨打服务电话 18369161921/)).toBeVisible()
  const text = await page.locator('[data-qxt-screen]').innerText()
  expect(text).not.toMatch(FORBIDDEN_STAFF)
})

test('活动物料 5xx：失败态不写联系工作人员 @w4', async ({ page, api }) => {
  fair({ materials: 'error' })(api)
  await page.goto(F('/materials'))
  await expect(page.getByTestId('fair-materials-state-error')).toBeVisible()
  const text = await page.locator('[data-qxt-screen]').innerText()
  expect(text).toContain('活动物料列表这次没取到')
  expect(text).not.toMatch(FORBIDDEN_STAFF)
})
