// 招聘内容托管（next-tasks 3.13 / 3.14）在一体机上的两种状态。
//
// 产品决定（2026-09-26，托管选 a）：我们云上不存岗位、招聘会、企业资料，服务端默认关闭托管；
// GET /terminals/:id/config 下发 recruitmentHosting.enabled=false，并把 jobBoard.enabled 压成 false。
// 一体机必须读这个开关把入口藏起来，不能只让接口失败、留下报错页。客户私有化部署（b）打开托管，
// 一切照今天的样子工作——那一态由既有的首页 / W4 / W5 / 路由扫描用例覆盖，这里另拍对照截图。
//
// 所以本文件的期望都直接来自这条决定：
//   · 关闭时首页和「我的」里看不到任何招聘入口与招聘文案（按钮白名单里的招聘词一个都不该出现）；
//   · 关闭时直达招聘类地址，落到诚实说明页，不是报错页，也不去请求招聘类接口；
//   · 配置还没读到时按关闭处理，但只说「正在确认」，不提前下「未开放」的结论；
//   · 简历对照不再分档（服务端不再返回 fitLevel），关闭时只能手填岗位要求，不能引用系统内岗位（jobId）。
import type { Page } from '@playwright/test'
import type { ApiRouter } from '../fixtures/api-router'
import { expect, test } from '../fixtures/kiosk-test'
import { RECRUITMENT_HOSTING_OFF, RECRUITMENT_HOSTING_ON, terminalConfigWithHosting } from '../fixtures/recruitment-hosting'
import { assertNoHorizontalOverflow } from './assert-layout'

const CONFIG = '/api/v1/terminals/KSK-001/config'

/** 托管关闭时一体机上一个都不该出现的招聘词（CLAUDE.md §2 的按钮白名单 + 首页岗位计数 + 岗位 AI 推荐）。 */
const RECRUITMENT_COPY = ['找工作', '查看岗位', '去来源平台投递', '扫码投递', '查看招聘会', '扫码预约', 'AI岗位推荐', '个在招'] as const
/** 简历对照不分档之后，结果页不该出现的档位词。 */
const GRADE_COPY = ['准备程度', '较高', '中等', '偏低', '岗位决策参考', '匹配参考：', '三档'] as const

const MEMBER_TOKEN = 'rh-member-token'
const MEMBER_PHONE = '13800138000'
const MEMBER_CODE = '123456'

function registerShell(api: ApiRouter, hosting: typeof RECRUITMENT_HOSTING_ON | typeof RECRUITMENT_HOSTING_OFF): void {
  api.respond('GET', '/api/v1/terminals/KSK-001/screensaver', { status: 200, json: { enabled: false, idleTimeoutSec: 180, items: [] } })
  api.respond('GET', '/api/v1/terminals/KSK-001/printer-status', { status: 200, json: { printerStatus: 'ready', paperLevel: 'sufficient', isOnline: true } })
  api.respond('GET', CONFIG, { status: 200, json: terminalConfigWithHosting(hosting) })
}

/** 招聘类接口一律不该被请求：ApiRouter 对未登记请求本就 fail-closed，这里再把命中记下来给出可读的失败信息。 */
function trackRecruitmentRequests(page: Page): string[] {
  const hits: string[] = []
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname
    if (/^\/api\/v1\/(jobs|job-fairs|companies|kiosk\/offline|kiosk\/campus)(\/|$)/.test(path)) hits.push(path)
  })
  return hits
}

function collectRuntimeErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  return errors
}

async function expectNoRecruitmentCopy(page: Page, where: string): Promise<void> {
  const text = await page.locator('body').innerText()
  for (const word of RECRUITMENT_COPY) expect(text, `${where} 不得出现「${word}」`).not.toContain(word)
}

function registerMemberLogin(api: ApiRouter): void {
  api.respond('GET', '/api/v1/kiosk/legal/terms_of_service', { status: 200, json: { success: true, data: null } })
  api.respond('GET', '/api/v1/kiosk/legal/privacy_policy', { status: 200, json: { success: true, data: null } })
  api.respond('POST', '/api/v1/member/auth/sms-code', { status: 200, json: { success: true, data: { sent: true, cooldownSeconds: 60, expiresInSeconds: 300 } } })
  api.respond('POST', '/api/v1/member/auth/login', {
    status: 200,
    json: { success: true, data: { token: MEMBER_TOKEN, user: { id: 'member-rh', phoneMasked: '138****8000', nickname: '托管关闭验收' } } },
  })
}

async function loginThroughVisibleUi(page: Page, returnTo: string): Promise<void> {
  await page.goto(`/login?from=${encodeURIComponent(returnTo)}`)
  await page.getByRole('checkbox', { name: /我已阅读并同意/ }).click()
  for (const digit of MEMBER_PHONE) await page.getByRole('button', { name: digit, exact: true }).click()
  await page.getByRole('button', { name: '获取验证码', exact: true }).click()
  await page.getByRole('button', { name: '短信验证码', exact: true }).click()
  for (const digit of MEMBER_CODE) await page.getByRole('button', { name: digit, exact: true }).click()
  await page.getByRole('button', { name: '验证并登录', exact: true }).click()
  await page.waitForURL((url) => url.pathname === returnTo)
}

/** 首页服务区的几何：每一行都铺满两列宽度，行与行之间只有网格间距，最后一行贴住网格底边。 */
async function homeTileGeometry(page: Page) {
  return page.locator('.qx-home-tiles').evaluate((grid) => {
    const box = grid.getBoundingClientRect()
    const tiles = [...grid.children].map((el) => {
      const rect = el.getBoundingClientRect()
      return { action: el.getAttribute('data-action'), top: Math.round(rect.top), bottom: Math.round(rect.bottom), left: Math.round(rect.left), right: Math.round(rect.right), height: Math.round(rect.height) }
    })
    const rows = new Map<number, typeof tiles>()
    for (const tile of tiles) rows.set(tile.top, [...(rows.get(tile.top) ?? []), tile])
    return {
      grid: { top: Math.round(box.top), bottom: Math.round(box.bottom), left: Math.round(box.left), right: Math.round(box.right) },
      rows: [...rows.values()].map((row) => ({
        actions: row.map((tile) => tile.action),
        left: Math.min(...row.map((tile) => tile.left)),
        right: Math.max(...row.map((tile) => tile.right)),
        top: row[0]!.top,
        bottom: Math.max(...row.map((tile) => tile.bottom)),
        minHeight: Math.min(...row.map((tile) => tile.height)),
      })),
    }
  })
}

// ── 关闭：首页 ─────────────────────────────────────────────────────────────

test('hosting off: home shows no recruitment entry and the grid reflows without holes @w1-kiosk', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  const recruitmentHits = trackRecruitmentRequests(page)
  registerShell(api, RECRUITMENT_HOSTING_OFF)

  await page.goto('/', { waitUntil: 'domcontentloaded' })
  const home = page.getByTestId('qx-home')
  await expect(home).toHaveAttribute('data-recruitment', 'closed')
  await expect(home.locator('[data-action="print-hub"]')).toBeVisible()
  for (const action of ['jobs-hub', 'fairs-hub', 'jobs-retry', 'fairs-retry']) {
    await expect(home.locator(`[data-action="${action}"]`), `托管关闭时首页不摆 ${action}`).toHaveCount(0)
  }
  await expect(home.getByRole('button', { name: '找工作', exact: true })).toHaveCount(0)
  await expect(home.getByRole('button', { name: '改简历', exact: true })).toBeVisible()
  await expect(home.getByRole('button', { name: '查政策', exact: true })).toBeVisible()
  // 底栏合规句随之改说真话：这台终端不提供岗位与招聘会，也不代收简历。
  await expect(home.getByText('本终端未开放岗位与招聘会信息，也不代收简历。', { exact: false })).toBeVisible()
  await expectNoRecruitmentCopy(page, '首页')

  // 六张磁贴：打印主卡 / AI 简历 + 模拟面试 / 就业政策 / 百宝箱 + 智慧校园。每行铺满、不留空格、不在底部留一截空白。
  const geometry = await homeTileGeometry(page)
  expect(geometry.rows.map((row) => row.actions)).toEqual([
    ['print-hub'],
    ['resume-hub', 'interview-hub'],
    ['policy-hub'],
    ['toolbox', 'smart-campus'],
  ])
  for (const row of geometry.rows) {
    expect(row.left, `${row.actions.join('+')} 贴住左边`).toBeLessThanOrEqual(geometry.grid.left + 1)
    expect(row.right, `${row.actions.join('+')} 贴住右边`).toBeGreaterThanOrEqual(geometry.grid.right - 1)
    expect(row.minHeight, `${row.actions.join('+')} 触控高度`).toBeGreaterThanOrEqual(104)
  }
  for (let index = 1; index < geometry.rows.length; index += 1) {
    expect(geometry.rows[index]!.top - geometry.rows[index - 1]!.bottom, '行间只有网格间距').toBeLessThanOrEqual(16)
  }
  // 底边只留一个行距（与托管打开时的底边留白相当），不是少掉一行后剩下的一大截空白。
  expect(geometry.grid.bottom - geometry.rows.at(-1)!.bottom, '服务区底部不留空白').toBeLessThanOrEqual(16)
  const board = await page.locator('.qx-home-board').boundingBox()
  expect(geometry.grid.bottom, '磁贴区铺到服务区底边').toBeGreaterThanOrEqual(Math.round(board!.y + board!.height) - 2)

  await assertNoHorizontalOverflow(page)
  await page.screenshot({ path: test.info().outputPath('home-hosting-off-1080x1920.png') })
  expect(recruitmentHits, '托管关闭时首页不请求岗位 / 招聘会接口').toEqual([])
  expect(errors).toEqual([])
})

test('hosting off: the phone home keeps the quick row whole @w1-mobile', async ({ page, api }) => {
  registerShell(api, RECRUITMENT_HOSTING_OFF)
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  const home = page.getByTestId('qx-home')
  await expect(home).toHaveAttribute('data-recruitment', 'closed')
  const quick = await home.locator('.qx-home-quick').evaluate((row) => {
    const rowBox = row.getBoundingClientRect()
    const buttons = [...row.querySelectorAll('button')].map((button) => {
      const box = button.getBoundingClientRect()
      return { text: button.textContent?.trim() ?? '', width: box.width, height: box.height }
    })
    return { width: rowBox.width, buttons }
  })
  expect(quick.buttons.map((button) => button.text)).toEqual(['改简历', '查政策', '登录后查看本人记录'])
  // 2×2 快捷区少了「找工作」：身份入口独占第二行，不在右下角留一个空格。
  expect(quick.buttons[2]!.width).toBeGreaterThanOrEqual(quick.width - 1)
  for (const button of quick.buttons) expect(button.height).toBeGreaterThanOrEqual(48)
  await expectNoRecruitmentCopy(page, '手机首页')
  await assertNoHorizontalOverflow(page)
  await page.screenshot({ path: test.info().outputPath('home-hosting-off-390x844.png'), fullPage: true })
})

// ── 打开：首页对照（客户私有化部署 b，今天的行为） ───────────────────────────────

test('hosting on: home keeps the job and fair entries exactly as today @w1-kiosk', async ({ page, api }) => {
  registerShell(api, RECRUITMENT_HOSTING_ON)
  api.respond('GET', '/api/v1/jobs', { status: 200, json: { data: [], pagination: { page: 1, pageSize: 1, total: 12, totalPages: 12 } } })
  api.respond('GET', '/api/v1/job-fairs', { status: 200, json: { data: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } } })

  await page.goto('/', { waitUntil: 'domcontentloaded' })
  const home = page.getByTestId('qx-home')
  await expect(home).toHaveAttribute('data-recruitment', 'open')
  await expect(home.locator('[data-action="jobs-hub"]')).toContainText('12 个在招')
  await expect(home.locator('[data-action="fairs-hub"]')).toContainText('暂无进行中或即将开始的场次')
  await expect(home.getByRole('button', { name: '找工作', exact: true })).toBeVisible()
  await expect(home.getByText('本终端仅展示与跳转，不代收简历', { exact: false })).toBeVisible()
  const geometry = await homeTileGeometry(page)
  expect(geometry.rows.map((row) => row.actions)).toEqual([
    ['print-hub'],
    ['resume-hub', 'interview-hub'],
    ['jobs-hub', 'fairs-hub'],
    ['policy-hub'],
    ['toolbox', 'smart-campus'],
  ])
  await page.screenshot({ path: test.info().outputPath('home-hosting-on-1080x1920.png') })
})

// ── 关闭：直达招聘类地址 ───────────────────────────────────────────────────

const GATED_URLS: readonly { url: string; topic: string }[] = [
  { url: '/jobs', topic: '岗位信息' },
  { url: '/jobs/job-001', topic: '岗位信息' },
  { url: '/jobs/job-001/offline', topic: '岗位信息' },
  { url: '/jobs/online-platforms', topic: '岗位信息' },
  { url: '/jobs-service', topic: '岗位信息' },
  { url: '/fairs-service', topic: '招聘会信息' },
  { url: '/job-fairs', topic: '招聘会信息' },
  { url: '/job-fairs/checkin', topic: '招聘会信息' },
  { url: '/job-fairs/fair-001', topic: '招聘会信息' },
  { url: '/job-fairs/fair-001/companies', topic: '招聘会信息' },
  { url: '/job-fairs/fair-001/companies/fair-company-001', topic: '招聘会信息' },
  { url: '/job-fairs/fair-001/map', topic: '招聘会信息' },
  { url: '/job-fairs/fair-001/materials', topic: '招聘会信息' },
  { url: '/job-fairs/fair-001/visit-plan', topic: '招聘会信息' },
  { url: '/job-fairs/fair-001/stats', topic: '招聘会信息' },
  { url: '/companies', topic: '企业信息' },
  { url: '/companies/company-001', topic: '企业信息' },
  { url: '/offline-agencies', topic: '线下招聘机构信息' },
  { url: '/offline-agencies/agency-001', topic: '线下招聘机构信息' },
  { url: '/campus', topic: '校园招聘信息' },
]

test('hosting off: every direct recruitment URL lands on the honest state, never an error page @w1-kiosk', async ({ page, api }) => {
  test.setTimeout(180_000)
  const errors = collectRuntimeErrors(page)
  const recruitmentHits = trackRecruitmentRequests(page)
  registerShell(api, RECRUITMENT_HOSTING_OFF)

  for (const { url, topic } of GATED_URLS) {
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    const honest = page.locator('[data-kiosk-screen="recruitment-hosting"]')
    await expect(honest, `${url} 落到诚实说明页`).toHaveAttribute('data-state', 'off')
    await expect(page.locator('[data-kiosk-screen="route-error"]'), `${url} 不是报错页`).toHaveCount(0)
    await expect(page.locator('.qx-pagehead h1'), `${url} 说清楚哪一类没开放`).toHaveText(`本终端未开放${topic}`)
    await expect(page.getByRole('button', { name: '返回首页' }).last()).toBeVisible()
    await expectNoRecruitmentCopy(page, url)
  }

  // 旧壳里的两条校招子页不在里面再叠一层页头：直接送回 /campus 那张整屏说明。
  for (const url of ['/campus/welcome', '/campus/freshman-insights']) {
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    await page.waitForURL((current) => current.pathname === '/campus')
    await expect(page.locator('[data-kiosk-screen="recruitment-hosting"]')).toHaveAttribute('data-state', 'off')
  }

  // 说明页里的去处都是本机照常开放的服务，没有一条指向招聘类路由。
  const routes = await page.locator('[data-kiosk-screen="recruitment-hosting"] [data-route]').evaluateAll((rows) => rows.map((row) => row.getAttribute('data-route')))
  expect(routes).toEqual(['/resume-service', '/resume/job-fit', '/interview-service', '/print-scan', '/policy-service'])
  await page.screenshot({ path: test.info().outputPath('direct-url-hosting-off-1080x1920.png') })
  await page.getByRole('button', { name: '返回首页' }).last().click()
  await expect(page.getByTestId('qx-home')).toHaveAttribute('data-recruitment', 'closed')

  expect(recruitmentHits, '托管关闭时直达地址也不请求招聘类接口').toEqual([])
  expect(errors).toEqual([])
})

test('hosting unknown: a direct URL says it is checking and does not claim anything yet @w1-kiosk', async ({ page, api }) => {
  registerShell(api, RECRUITMENT_HOSTING_OFF)
  let release!: () => void
  const held = new Promise<void>((resolve) => { release = resolve })
  api.respondWith('GET', CONFIG, async () => {
    await held
    return { status: 200, json: terminalConfigWithHosting(RECRUITMENT_HOSTING_OFF) }
  })

  await page.goto('/job-fairs', { waitUntil: 'domcontentloaded' })
  const honest = page.locator('[data-kiosk-screen="recruitment-hosting"]')
  await expect(honest).toHaveAttribute('data-state', 'checking')
  await expect(page.getByText('本终端未开放', { exact: false })).toHaveCount(0)
  await expect(page.locator('.qx-pagehead h1')).toHaveText('正在确认本机开通的服务')
  release()
  await expect(honest).toHaveAttribute('data-state', 'off')
  await expect(page.locator('.qx-pagehead h1')).toHaveText('本终端未开放招聘会信息')
})

// ── 关闭：「我的」收藏与足迹 ──────────────────────────────────────────────

const POLICY_FAVORITE = { id: 'fav-policy', targetType: 'policy', targetId: 'policy-001', title: '高校毕业生就业服务指引', createdAt: '2026-09-20T08:00:00.000Z' }
// 服务端托管关闭时不会再返回岗位收藏；这一条模拟旧数据漏过来，证明页面自己也不摆。
const STALE_JOB_FAVORITE = { id: 'fav-job', targetType: 'job', targetId: 'job-001', title: '漏过来的岗位收藏', createdAt: '2026-09-19T08:00:00.000Z' }

test('hosting off: favorites and footprints show no job or fair section @w1-kiosk', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  const recruitmentHits = trackRecruitmentRequests(page)
  registerShell(api, RECRUITMENT_HOSTING_OFF)
  registerMemberLogin(api)
  api.respond('GET', '/api/v1/me/favorites', { status: 200, json: { success: true, data: { items: [POLICY_FAVORITE, STALE_JOB_FAVORITE], nextCursor: null, total: 2 } } })
  api.respond('GET', '/api/v1/me/browse-logs', {
    status: 200,
    json: {
      success: true,
      data: {
        items: [
          { id: 'b-policy', targetType: 'policy', targetId: 'policy-001', targetTitle: '政策浏览记录', sourceName: '市人社局', sourceUrl: null, externalId: null, createdAt: '2026-09-20T08:00:00.000Z' },
          { id: 'b-company', targetType: 'company_profile', targetId: 'company-001', targetTitle: '漏过来的企业浏览', sourceName: '来源机构', sourceUrl: null, externalId: null, createdAt: '2026-09-19T08:00:00.000Z' },
        ],
        nextCursor: null,
        total: 2,
      },
    },
  })
  api.respond('GET', '/api/v1/me/external-jump-logs', { status: 200, json: { success: true, data: { items: [], nextCursor: null, total: 0 } } })
  api.respond('GET', '/api/v1/me/job-applications', { status: 200, json: { success: true, data: { items: [], nextCursor: null, total: 0 } } })

  await loginThroughVisibleUi(page, '/me/favorites')
  const list = page.getByTestId('member-records-list')
  await expect(list.getByText('高校毕业生就业服务指引')).toBeVisible()
  await expect(list.getByText('漏过来的岗位收藏')).toHaveCount(0)
  await expect(page.locator('[data-testid^="member-records-fav-tab-"]'), '只剩政策一类时不摆分类条').toHaveCount(0)
  await expect(page.getByText('岗位收藏', { exact: true })).toHaveCount(0)
  await expect(page.getByText('招聘会收藏', { exact: true })).toHaveCount(0)
  await expect(page.getByTestId('member-records-view-favorites')).toContainText('政策')
  await expect(page.getByTestId('member-records-view-favorites')).not.toContainText('岗位')
  await expect(page.getByTestId('member-records-primary')).toHaveText('查看政策')
  await expectNoRecruitmentCopy(page, '我的收藏')
  await page.screenshot({ path: test.info().outputPath('profile-favorites-hosting-off-1080x1920.png') })

  await page.getByTestId('member-records-view-activity').click()
  await page.waitForURL((url) => url.pathname === '/me/activity')
  const activity = page.getByTestId('member-records-list')
  await expect(activity.getByText('政策浏览记录')).toBeVisible()
  await expect(activity.getByText('漏过来的企业浏览')).toHaveCount(0)
  await page.getByTestId('member-records-activity-tab-jump').click()
  await expect(page.getByTestId('member-records-start-policy')).toBeVisible()
  await expect(page.locator('[data-testid="member-records-start-jobs"], [data-testid="member-records-start-fairs"]')).toHaveCount(0)
  await page.getByTestId('member-records-activity-tab-applications').click()
  await expect(page.getByTestId('member-records-application-list')).toBeVisible()
  await expect(page.getByTestId('member-records-start-jobs')).toHaveCount(0)
  await expectNoRecruitmentCopy(page, '我的足迹')
  await page.screenshot({ path: test.info().outputPath('profile-activity-hosting-off-1080x1920.png') })

  expect(recruitmentHits).toEqual([])
  expect(errors).toEqual([])
})

test('hosting off: the signed-out member pages offer policy instead of jobs @w1-kiosk', async ({ page, api }) => {
  registerShell(api, RECRUITMENT_HOSTING_OFF)
  await page.goto('/me/favorites', { waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('member-records-guest-policy')).toBeVisible()
  await expect(page.getByTestId('member-records-guest-jobs')).toHaveCount(0)
  await expect(page.getByText('岗位与招聘会只做来源信息入口')).toHaveCount(0)
  await expectNoRecruitmentCopy(page, '未登录的我的收藏')
})

// ── 简历对照 ──────────────────────────────────────────────────────────────

const JOB_FIT_TASK = 't-rh'

test('job fit shows no grade even when an old server still sends fitLevel @w1-kiosk', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api, RECRUITMENT_HOSTING_OFF)
  api.respond('GET', `/api/v1/resume/job-fit/${JOB_FIT_TASK}`, {
    status: 200,
    json: {
      taskId: JOB_FIT_TASK,
      status: 'completed',
      // 旧服务端留下的档位字段：3.14 起服务端不再返回，页面也一律不显示。
      fitLevel: 'reference_high',
      summary: '简历里写到了活动组织与表格整理，还没有写到数据分析工具。',
      job: { title: '行政专员' },
      matchPoints: [{ requirement: '活动组织', point: '组织过校园招聘宣讲', evidence: '负责 3 场宣讲会现场协调' }],
      gapPoints: [{ requirement: '数据工具', gap: '没有写到 Excel 数据整理', suggestion: '补一条用表格汇总报名数据的经历' }],
      targetedSuggestions: ['把「协助行政」改写成具体做过的三件事'],
    },
  })

  await page.goto(`/resume/job-fit?taskId=${JOB_FIT_TASK}`, { waitUntil: 'domcontentloaded' })
  const screen = page.locator('[data-kiosk-screen="resume-job-fit"]')
  await expect(screen).toHaveAttribute('data-state', 'result')
  const summary = page.locator('.jfq-summary')
  await expect(summary.locator('.jfq-summary-eyebrow')).toContainText('简历对照 ·')
  await expect(summary.locator('[data-aigc-mark="true"]')).toBeVisible()
  await expect(page.locator('[data-aigc-mark="true"]'), 'AIGC 标识每页恰好一次').toHaveCount(1)
  const text = await page.locator('body').innerText()
  for (const word of GRADE_COPY) expect(text, `结果页不得出现档位词「${word}」`).not.toContain(word)
  // 不分档之后结果就是稿 46 的两栏：已写到的（带原文依据）与还没体现的；怎么补留在行动清单页。
  await expect(page.getByRole('region', { name: '简历里已经写到的要求' })).toContainText('负责 3 场宣讲会现场协调')
  await expect(page.getByRole('region', { name: '简历里还没体现的要求' })).toContainText('没有写到 Excel 数据整理')
  await expect(page.getByText('补一条用表格汇总报名数据的经历')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /查看岗位/ })).toHaveCount(0)
  await expect(page.getByText('查看行动清单')).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('job-fit-result-1080x1920.png') })
  expect(errors).toEqual([])
})

test('hosting off: job fit keeps only the manual path and never sends a jobId @w1-kiosk', async ({ page, api }) => {
  const recruitmentHits = trackRecruitmentRequests(page)
  registerShell(api, RECRUITMENT_HOSTING_OFF)
  api.respond('GET', `/api/v1/resume/job-fit/${JOB_FIT_TASK}`, { status: 404, json: { error: { code: 'JOB_FIT_NOT_FOUND', message: '尚未对照' } } })
  let analyzeBody: Record<string, unknown> | null = null
  api.respondWith('POST', '/api/v1/resume/job-fit', async () => ({
    status: 200,
    json: {
      taskId: JOB_FIT_TASK,
      status: 'completed',
      summary: '按你填的要求对照完成。',
      job: { title: '行政专员' },
      matchPoints: [],
      gapPoints: [],
      targetedSuggestions: [],
    },
  }))
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/resume/job-fit') {
      analyzeBody = request.postDataJSON() as Record<string, unknown>
    }
  })

  await page.goto(`/resume/job-fit?taskId=${JOB_FIT_TASK}`, { waitUntil: 'domcontentloaded' })
  const screen = page.locator('[data-kiosk-screen="resume-job-fit"]')
  await expect(screen).toHaveAttribute('data-state', 'pick')
  await expect(page.getByText('填一份岗位要求', { exact: true })).toBeVisible()
  await expect(page.getByText('从已发布岗位中选择')).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: '搜索岗位名称或公司' })).toHaveCount(0)
  await expect(page.getByText('看来源岗位要求')).toHaveCount(0)

  await page.getByRole('textbox', { name: '目标岗位名称' }).fill('行政专员')
  await page.getByRole('textbox', { name: '岗位 JD 或任职要求' }).fill('熟练使用 Excel，能组织会务')
  await page.getByRole('button', { name: '继续并确认授权' }).click()
  await expect(screen).toHaveAttribute('data-state', 'result')
  expect(analyzeBody).toEqual({ taskId: JOB_FIT_TASK, manualJob: { title: '行政专员', requirements: '熟练使用 Excel，能组织会务' } })
  expect(recruitmentHits, '托管关闭时简历对照不请求岗位列表').toEqual([])
})
