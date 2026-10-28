// 第 11 包（私有化版招聘）触屏壳的版式体检。
//
// 招聘页只在托管打开（客户私有化部署）时才挂载；ApiRouter 默认按「托管打开」应答，所以这里直接进页。
// 对每个页面和主要状态量同一组指标，防止回到「只换外框、正文原样」或者悄悄退回旧壳：
//   · 顶上有私有化版标识条，文字逐字照稿；
//   · 底导航三项（首页 / AI 顾问 / 我的）始终在，底栏里恰好一个问小青、文字逐屏照稿；
//   · 底栏所有按钮同在一行、都在屏内，主按钮高 88，问小青不被挤得只剩话筒；
//   · 屏上没有小于 20px 的字，没有小于 64×64 的可点区；
//   · 现场无人值守：屏上不出现「联系 / 找（现场）工作人员」。
//
// 阳性对照写在断言里：先断言触屏壳恰好 1 个、标识条恰好 1 个，再断言「没有」类指标，
// 探针没量到东西时不会因为空数组而通过。
import type { Page } from '@playwright/test'
import { test, expect } from '../fixtures/kiosk-test'
import type { ApiRouter } from '../fixtures/api-router'
import { registerW6Api } from './fixtures/fusion-w6-api'
import { registerFairApi, makeFair, FAIR_ID } from './fixtures/fair-workbench-api'

const RIBBON = '私有化部署版 · 仅供持有人力资源服务许可证的客户自行运营 · 我方云上不出现 · 不得用于对外宣传'
const FORBIDDEN_STAFF = /联系现场|联系工作人员|找现场|找工作人员|交给.{0,2}工作人员|去服务台|工作人员核查/
const boom = { status: 500, json: { success: false, error: { code: 'INTERNAL_ERROR', message: 'boom' } } }
const notFound = { status: 404, json: { success: false, error: { code: 'NOT_FOUND', message: 'not found' } } }

type Case = { name: string; url: string; ask: string; setup?: (api: ApiRouter) => void }
const w6 = (extra?: (api: ApiRouter) => void) => (api: ApiRouter) => { registerW6Api(api); extra?.(api) }
const fair = (options: Parameters<typeof registerFairApi>[1] = {}) => (api: ApiRouter) => { registerW6Api(api); registerFairApi(api, options) }
const F = (path: string) => `/job-fairs/${FAIR_ID}${path}`

const CASES: Case[] = [
  { name: '社会招聘台', url: '/jobs-service', ask: '问小青：社会招聘怎么选？' },
  { name: '社会招聘台·在线服务不可用', url: '/jobs-service', ask: '问小青：社会招聘怎么选？', setup: w6((api) => api.respond('GET', '/api/v1/health', { status: 503, json: { success: false } })) },
  { name: '校园招聘台', url: '/fairs-service', ask: '问小青：校园招聘怎么看？' },
  { name: '岗位列表', url: '/jobs', ask: '问小青：这些岗位怎么看？' },
  { name: '岗位列表·读取失败', url: '/jobs', ask: '问小青：这些岗位怎么看？', setup: w6((api) => api.respond('GET', '/api/v1/jobs', boom)) },
  { name: '岗位详情', url: '/jobs/job-001', ask: '问小青：这个岗位怎么看？' },
  { name: '岗位详情·不存在', url: '/jobs/job-001', ask: '问小青：这个岗位怎么看？', setup: w6((api) => api.respond('GET', '/api/v1/jobs/job-001', notFound)) },
  { name: '线下岗位详情', url: '/jobs/offline-job-001/offline', ask: '问小青：到店要带什么？' },
  { name: '线下机构列表', url: '/offline-agencies', ask: '问小青：到店要带什么？' },
  { name: '线下机构详情', url: '/offline-agencies/agency-001', ask: '问小青：这家机构怎么去？' },
  { name: '线下机构详情·不可用', url: '/offline-agencies/agency-001', ask: '问小青：这家机构怎么去？', setup: w6((api) => api.respond('GET', '/api/v1/kiosk/offline-agencies/agency-001', notFound)) },
  { name: '企业列表', url: '/companies', ask: '问小青：怎么挑企业？' },
  { name: '企业详情', url: '/companies/company-001', ask: '问小青：这家企业怎么看？' },
  { name: '企业详情·没有在招岗位', url: '/companies/company-001', ask: '问小青：这家企业怎么看？', setup: w6((api) => api.respond('GET', '/api/v1/companies/company-001/jobs', { status: 200, json: { success: true, data: { items: [], nextCursor: null, total: 0 } } })) },
  { name: '企业详情·不可用', url: '/companies/company-001', ask: '问小青：这家企业怎么看？', setup: w6((api) => api.respond('GET', '/api/v1/companies/company-001', notFound)) },
  { name: '校园招聘', url: '/campus', ask: '问小青：怎么挑一场' },
  { name: '校园招聘·选中一场', url: '/campus?fair=fair-001', ask: '问小青：这场怎么看' },
  { name: '校园招聘·没有场次', url: '/campus', ask: '问小青：怎么挑一场', setup: w6((api) => api.respond('GET', '/api/v1/job-fairs', { status: 200, json: { success: true, data: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } } })) },
  { name: '校园迎新', url: '/campus/welcome', ask: '问小青：校园招聘怎么看？' },
  { name: '校园招聘数据', url: '/campus/freshman-insights', ask: '问小青：数字怎么读' },
  { name: '招聘会列表', url: '/job-fairs', ask: '问小青', setup: fair() },
  { name: '招聘会列表·没有场次', url: '/job-fairs', ask: '问小青', setup: fair({ list: 'empty' }) },
  { name: '招聘会详情', url: F(''), ask: '问小青', setup: fair() },
  { name: '招聘会详情·没取到', url: F(''), ask: '问小青：这场怎么走', setup: fair({ detail: 'error' }) },
  { name: '参展企业', url: F('/companies'), ask: '问小青：这家企业', setup: fair() },
  { name: '参展企业详情', url: F('/companies/fair-company-001'), ask: '问小青：这家企业', setup: fair() },
  { name: '展位分布', url: F('/map'), ask: '问小青：展位怎么看', setup: fair() },
  { name: '活动物料', url: F('/materials'), ask: '问小青：打印哪一份', setup: fair() },
  { name: '活动物料·读取失败', url: F('/materials'), ask: '问小青：打印哪一份', setup: fair({ materials: 'error' }) },
  { name: '参会准备', url: F('/visit-plan'), ask: '问小青：准备单怎么用', setup: fair() },
  { name: '现场统计', url: F('/stats'), ask: '问小青：这些数怎么来', setup: fair({ stats: 'real' }) },
  { name: '到场指引', url: '/job-fairs/checkin', ask: '问小青：怎么签到', setup: fair({ fair: { status: 'ongoing' } }) },
  { name: '到场指引·没有入口', url: '/job-fairs/checkin', ask: '问小青：怎么签到', setup: fair({ list: 'empty' }) },
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
      askWidth: Math.round(((root.querySelector('.qxt-dock .qxt-askq') as HTMLElement | null)?.getBoundingClientRect().width ?? 0) / scale),
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
    // 每屏底栏的问小青照稿原文（稿 fix-jobs.js / fix-fairs.js 各屏 dock），不是统一写一句。
    expect(m.askLabels[0]).toBe(c.ask)
    // 问小青放不下时照稿用省略号收尾，但不能被挤成只剩一个话筒：至少留出能读到「问小青：」和几个字的宽度。
    expect(m.askWidth, '问小青被底栏其他按钮挤得太窄').toBeGreaterThanOrEqual(300)
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

// ── 选中态看得见（A8）：选中的芯片深底浅字，对比度不低于 4.5，芯片不折字 ─────────────────────
async function chipReport(page: Page, selector: string) {
  return page.evaluate((sel) => {
    const parse = (css: string) => (css.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number)
    const lum = ([r, g, b]: number[]) => {
      const f = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
    }
    return [...document.querySelectorAll(sel)].filter((el) => el.getBoundingClientRect().width > 0).map((el) => {
      const cs = getComputedStyle(el)
      const bg = lum(parse(cs.backgroundColor)); const fg = lum(parse(cs.color))
      const ratio = (Math.max(bg, fg) + 0.05) / (Math.min(bg, fg) + 0.05)
      const pressed = el.getAttribute('aria-pressed')
      const selected = el.classList.contains('on') || pressed === 'true'
      return { text: (el.textContent || '').trim(), selected, pressed, ratio, darkBg: bg < fg, noWrap: cs.whiteSpace === 'nowrap', height: el.getBoundingClientRect().height }
    })
  }, selector)
}

test('岗位列表：选中的芯片深底浅字、带 aria-pressed，芯片行不折字 @w4', async ({ page, api }) => {
  registerW6Api(api)
  await page.goto('/jobs')
  await expect(page.locator('.jf-f-chip.on').first()).toBeVisible()
  await page.waitForLoadState('networkidle')
  const chips = await chipReport(page, '.jf-f-chip')
  expect(chips.length, '探针没量到芯片').toBeGreaterThan(6)
  const selected = chips.filter((chip) => chip.selected)
  expect(selected.length, '至少有选中的类型、来源、排序三枚').toBeGreaterThanOrEqual(3)
  for (const chip of selected) {
    expect(chip.pressed, `${chip.text} 选中态要写 aria-pressed=true`).toBe('true')
    expect(chip.darkBg, `${chip.text} 选中态要深底浅字`).toBe(true)
    expect(chip.ratio, `${chip.text} 选中态对比度`).toBeGreaterThanOrEqual(4.5)
  }
  for (const chip of chips) {
    expect(chip.noWrap, `${chip.text} 不折字`).toBe(true)
    expect(chip.height, `${chip.text} 芯片高度不该翻成两行`).toBeLessThanOrEqual(96)
  }
})

test('企业列表：选中的芯片同样深底浅字、带 aria-pressed @w4', async ({ page, api }) => {
  registerW6Api(api)
  await page.goto('/companies')
  await expect(page.locator('.dw-chip.on').first()).toBeVisible()
  await page.waitForLoadState('networkidle')
  const chips = await chipReport(page, '.dw-chip')
  const selected = chips.filter((chip) => chip.selected)
  expect(selected.length, '类型、行业、招聘、来源各有一枚选中的「全部」').toBeGreaterThanOrEqual(4)
  for (const chip of selected) {
    expect(chip.pressed, `${chip.text} 选中态要写 aria-pressed=true`).toBe('true')
    expect(chip.darkBg).toBe(true)
    expect(chip.ratio).toBeGreaterThanOrEqual(4.5)
  }
})

// ── 校园招聘场次列表（A9、A13）──────────────────────────────────────────────────────────────
const CAMPUS_BOUNDARY = '预约与办理都在来源平台完成。本机不代预约，也不做签到。'

test('校园招聘：每张场次卡写状态、起止时间、城市场馆、地址、主办、来源与同步时间、企业岗位数，列表下面有边界句 @w4', async ({ page, api }) => {
  registerW6Api(api)
  await page.goto('/campus')
  const cards = page.locator('.rt-fair')
  await expect(cards).toHaveCount(1)
  const card = cards.first()
  await expect(card.locator('.rt-tag')).toHaveText('未开始')
  const text = await card.innerText()
  expect(text).toMatch(/2026-08-01 09:00\s*[–-]\s*16:00/)
  expect(text).toContain('青岛市 · 青岛国际会展中心')
  expect(text).toContain('崂山区苗岭路9号')
  expect(text).toContain('主办 青岛市公共就业服务中心')
  expect(text).toMatch(/来源 青岛公共就业服务网 · 同步 /)
  expect(text).toContain('企业 1 · 岗位 2')
  await expect(page.getByText(CAMPUS_BOUNDARY)).toBeVisible()
})

test('校园招聘：来源没给的字段不写、不编，卡上不出现 undefined / null / 占位词 @w4', async ({ page, api }) => {
  registerW6Api(api)
  api.respond('GET', '/api/v1/job-fairs', {
    status: 200,
    json: {
      success: true,
      data: [makeFair({ id: 'fair-bare', name: '某高校春季双选会', theme: 'campus', address: null, organizer: '', syncTime: null, boothCount: null, jobCount: null, managedCompanyCount: null, hasManagedData: false, expectedAttendance: null })],
      pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    },
  })
  await page.goto('/campus')
  const cards = page.locator('.rt-fair')
  await expect(cards).toHaveCount(1)
  const text = await cards.first().innerText()
  expect(text).toContain('某高校春季双选会')
  expect(text).toContain('未开始')
  expect(text).not.toMatch(/undefined|null|NaN|地址未提供|主办 \S*未提供|企业 \d|岗位 \d|预计/)
})

test('校园招聘：带着名单里没有的 ?fair= 进来，提示放在列表上方，已经取到的场次列表照常显示 @w4', async ({ page, api }) => {
  registerW6Api(api)
  await page.goto('/campus?fair=not-there')
  const notice = page.getByText('这场不在当前校园招聘会名单里')
  await expect(notice).toBeVisible()
  const card = page.locator('.rt-fair')
  await expect(card, '场次列表没有被一并藏掉').toHaveCount(1)
  const noticeBox = await notice.boundingBox()
  const cardBox = await card.first().boundingBox()
  expect(noticeBox && cardBox && noticeBox.y < cardBox.y, '提示在列表上方').toBe(true)
})

// ── 门的读屏名（A12）：可用的门不盖住说明，不可用的门读「标题，原因。说明」 ───────────────────
async function doorLabels(page: Page) {
  return page.evaluate(() => [...document.querySelectorAll('[data-door-title]')].map((door) => {
    const button = door.querySelector('button')
    return { title: door.getAttribute('data-door-title') ?? '', label: button?.getAttribute('aria-label') ?? null, disabled: button?.getAttribute('aria-disabled') === 'true', text: (button?.textContent || '').replace(/\s+/g, '') }
  }))
}

test('社会招聘台：可用的门不带 aria-label（读屏读标题与说明），不可用的门读「标题，原因。说明」 @w4', async ({ page, api }) => {
  registerW6Api(api)
  await page.goto('/jobs-service')
  await expect(page.getByTestId('social-hub')).toBeVisible()
  const ready = await doorLabels(page)
  expect(ready.length, '探针没量到门').toBeGreaterThan(8)
  expect(ready.filter((door) => door.label !== null), '可用的门不该传 aria-label').toEqual([])
  expect(ready.every((door) => !door.disabled)).toBe(true)

  api.respond('GET', '/api/v1/health', { status: 503, json: { success: false } })
  await page.goto('/jobs-service')
  await expect(page.locator('[data-qx-page="recruit"]')).toHaveAttribute('data-qxt-state', 'unavailable')
  const blocked = await doorLabels(page)
  expect(blocked.length).toBe(ready.length)
  for (const door of blocked) {
    expect(door.disabled, `${door.title} 不可点`).toBe(true)
    expect(door.label, `${door.title} 读「标题，原因。说明」`).toMatch(new RegExp(`^${door.title}，(在线服务当前不可用|AI能力当前不可用)。.+`))
  }
})
