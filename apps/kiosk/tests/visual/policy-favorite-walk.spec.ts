// W-49 / W-52：收藏的政策要打开那一条；找不到或这次没读到要有出路；
// 首页不再写「带走：材料清单」；发布日期没有填写时用确认发布时间。
//
// 2026-11-05 政策最小闭环：查政策改成「六类首页 /policy-service → 类别列表 /renshi?audience= →
// 按编号读的详情 /renshi?policy=」，公告单独一页 /renshi?tab=notice。旧的一页多分区、政策在列表里
// 就地展开、列表定时摘掉已下架条目都已停放（源码保留、不注册）。下面按新三屏重写，判据不变：
// 收藏打开的是那一条；没读到不冒充已撤下；撤下后不留旧正文和原文码；发布日期优先用填写的那一天。
import { mkdirSync } from 'node:fs'
import type { Page } from '@playwright/test'
import type { ApiRouter } from '../fixtures/api-router'
import { expect, test } from '../fixtures/kiosk-test'
import { RECRUITMENT_HOSTING_OFF, terminalConfigWithHosting } from '../fixtures/recruitment-hosting'
import { assertNoHorizontalOverflow } from './assert-layout'

const MEMBER_TOKEN = 'policy-walk-member-token'
const MEMBER_PHONE = '13800138000'
const MEMBER_CODE = '123456'

interface PolicyFixture {
  id: string
  kind: string
  title: string
  summary: string
  audience?: string
  category?: string
  content?: string
  externalUrl?: string
  /** 原文链接是否落在发布机构登记的官方网站内；只有 true 详情才画原文二维码。 */
  externalUrlVerified?: boolean
  /** 办事三栏：谁可以申请 / 要准备的材料 / 去哪办，每行一项。 */
  whoCanApply?: string
  requiredMaterials?: string
  whereToApply?: string
  sourceName: string
  syncTime: string
  publishedDate?: string
  publishConfirmedAt?: string | null
}

const SRC = {
  sourceName: '示例人社局',
  syncTime: '2026-09-20T00:00:00.000Z',
  externalUrl: 'https://hrss.example.gov.cn/policy',
  content: '请以来源页面的原文为准。',
}

const OTHER: PolicyFixture = {
  ...SRC, id: 'policy-other', kind: 'policy_guide', title: '灵活就业社保补贴说明',
  summary: '另一条，用来确认没有打开错。', audience: 'flexible', publishedDate: '2026-07-01',
}
const FAV: PolicyFixture = {
  ...SRC, id: 'policy-fav', kind: 'policy_guide', title: '高校毕业生求职创业补贴',
  summary: '收藏的这一条。', audience: 'graduate', externalUrl: 'https://hrss.example.gov.cn/fav',
  externalUrlVerified: true,
  whoCanApply: '毕业年度内有就业创业意愿的高校毕业生',
  requiredMaterials: '本人身份证\n毕业证书或学籍在线验证报告',
  whereToApply: '所在高校就业指导中心统一申报',
  publishConfirmedAt: '2026-09-29T01:17:00.000Z',
}
const DATED: PolicyFixture = {
  ...SRC, id: 'policy-dated', kind: 'policy_guide', title: '已写明发布日期的补贴说明',
  summary: '发布日期以填写的那一天为准。', audience: 'general',
  publishedDate: '2026-08-01', publishConfirmedAt: '2026-09-29T01:17:00.000Z',
}
const SLOW: PolicyFixture = {
  ...SRC, id: 'policy-slow', kind: 'policy_guide', title: '补打开的培训补贴说明',
  summary: '列表第一页没有这条。', audience: 'general', publishedDate: '2026-06-01',
}
const BROKEN: PolicyFixture = {
  ...SRC, id: 'policy-broken', kind: 'policy_guide', title: '重试后打开的登记说明',
  summary: '第一次没有读到。', audience: 'general', publishedDate: '2026-05-01',
}
const NOTICE_LIST: PolicyFixture = {
  ...SRC, id: 'notice-listed', kind: 'notice', title: '就业服务窗口调整通知',
  summary: '列表里的公告。', category: 'notice', publishedDate: '2026-06-11',
  externalUrl: 'https://hrss.example.gov.cn/notice-window',
}
const NOTICE_NEXT: PolicyFixture = {
  ...SRC, id: 'notice-next', kind: 'notice', title: '职业技能培训开班通知',
  summary: '秋季职业技能培训班开始报名，开班时间以原文为准。', category: 'notice', publishedDate: '2026-08-18',
  externalUrl: 'https://hrss.example.gov.cn/notice-next',
}
const NOTICE_LATE: PolicyFixture = {
  ...SRC, id: 'notice-late', kind: 'notice', title: '窗口时间调整通知',
  summary: '这条不在第一页列表里。', category: 'notice', content: '办理时间以原文为准。',
  publishConfirmedAt: '2026-07-15T08:00:00.000Z',
}

const GUIDE_LIST = [OTHER, FAV, DATED]
const NOTICE_FEED = [NOTICE_LIST, NOTICE_NEXT]

/** 详情里原文二维码旁的那句：只有原文链接核对过属于发布机构登记的官方网站才出现。 */
const QR_NOTE = '扫码打开原文 · 链接发布时已核对属于发布机构登记的官方网站'

function shot(page: Page, name: string) {
  const dir = process.env.WALK_FIX_DIR
  if (!dir) return Promise.resolve()
  mkdirSync(dir, { recursive: true })
  return page.screenshot({ path: `${dir}/${name}` })
}

function registerShell(api: ApiRouter): void {
  api.respond('GET', '/api/v1/terminals/KSK-001/screensaver', { status: 200, json: { enabled: false, idleTimeoutSec: 180, items: [] } })
  api.respond('GET', '/api/v1/terminals/KSK-001/printer-status', { status: 200, json: { printerStatus: 'ready', paperLevel: 'sufficient', isOnline: true } })
  api.respond('GET', '/api/v1/terminals/KSK-001/config', { status: 200, json: terminalConfigWithHosting(RECRUITMENT_HOSTING_OFF, 'policy-walk') })
  api.respond('GET', '/api/v1/kiosk/legal/terms_of_service', { status: 200, json: { success: true, data: { version: '2026.09.01' } } })
  api.respond('GET', '/api/v1/kiosk/legal/privacy_policy', { status: 200, json: { success: true, data: { version: '2026.09.01' } } })
  api.respond('POST', '/api/v1/member/auth/sms-code', { status: 200, json: { success: true, data: { sent: true, cooldownSeconds: 60, expiresInSeconds: 300 } } })
  api.respond('POST', '/api/v1/member/auth/login', {
    status: 200,
    json: { success: true, data: { token: MEMBER_TOKEN, user: { id: 'member-policy', phoneMasked: '138****8000', nickname: '政策走查' } } },
  })
  api.respond('GET', '/api/v1/me/favorites', {
    status: 200,
    json: {
      success: true,
      data: {
        items: [{ id: 'fav-row', targetType: 'policy', targetId: 'policy-fav', title: '高校毕业生求职创业补贴', createdAt: '2026-09-28T08:00:00.000Z' }],
        nextCursor: null,
        total: 1,
      },
    },
  })
  api.respond('POST', '/api/v1/activity/browse', { status: 200, json: { success: true, data: { id: 'browse-1' } } })
  // 登录后打开一条原文链接核对过的政策，详情画出原文二维码时记一次「打开官方入口」。
  api.respond('POST', '/api/v1/activity/external-jump', { status: 200, json: { success: true, data: { recorded: true } } })
  api.respond('POST', '/api/v1/terminals/session-token', { status: 200, json: { sessionToken: 'policy-walk-terminal-session' } })
  // 正式构建没有测试用会话票。同一标签页里第二次整页打开时，已有票会走续期；
  // 续期没夹具会被中断，页面停在校验中，政策说明出不来。
  api.respond('POST', '/api/v1/terminals/session-token/refresh', { status: 200, json: { sessionToken: 'policy-walk-terminal-session' } })
  api.respond('POST', '/api/v1/kiosk/session/start', { status: 200, json: { success: true } })
  api.respond('POST', '/api/v1/kiosk/session/heartbeat', { status: 200, json: { success: true } })
  api.respond('POST', '/api/v1/kiosk/session/end', { status: 200, json: { success: true } })
}

async function stubBootTicket(page: Page): Promise<void> {
  await page.route('http://127.0.0.1:9527/local/terminal-boot-ticket', async (route) => {
    const headers = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    }
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers,
      body: JSON.stringify({ data: { bootTicket: 'a'.repeat(40) } }),
    })
  })
}

interface PolicyRouteState {
  broken: boolean
  holdSlow: Promise<void> | null
  withdrawn?: Set<string>
  failDetail?: Set<string>
  /** 按条读取这些 id 时把应答压住，直到对应的 Promise 放行。 */
  holdDetail?: Map<string, Promise<void>>
  /** 按条读取的请求按序记在这里。 */
  detailLog?: string[]
  /** 生成一页办事清单的请求按序记在这里。 */
  checklistLog?: string[]
}

const POLICY_LIST_PATH = '/api/v1/policies'
const POLICY_DETAIL_PATH = /^\/api\/v1\/policies\/([^/]+)$/
const POLICY_CHECKLIST_PATH = /^\/api\/v1\/policies\/([^/]+)\/checklist$/

function isPolicyRequest(url: URL): boolean {
  // Playwright 的 glob 连查询串一起比对，** 也只有夹在斜线之间才跨路径：policies** 既匹配不到
  // /policies/:id，也匹配不到政策首页按类别读条数的 ?kind=…&audience=…&pageSize=1。按路径判断。
  return url.pathname === POLICY_LIST_PATH || POLICY_DETAIL_PATH.test(url.pathname) || POLICY_CHECKLIST_PATH.test(url.pathname)
}

async function routePolicies(page: Page, state: PolicyRouteState): Promise<void> {
  const byId = new Map<string, PolicyFixture>([OTHER, FAV, DATED, SLOW, BROKEN, NOTICE_LIST, NOTICE_NEXT, NOTICE_LATE].map((item) => [item.id, item]))
  await page.route(isPolicyRequest, async (route) => {
    const url = new URL(route.request().url())
    const checklist = url.pathname.match(POLICY_CHECKLIST_PATH)
    if (checklist) {
      // 一页办事清单：生成前服务端再查一次是否已撤下，撤下答 404。本文件不走「生成成功、交给打印确认页」
      // 那一段（那一段要报价与文件夹具），仍在架的一律答「这次没生成」。
      const id = decodeURIComponent(checklist[1] ?? '')
      state.checklistLog?.push(id)
      const gone = !byId.has(id) || Boolean(state.withdrawn?.has(id))
      await route.fulfill({
        status: gone ? 404 : 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: gone ? 'POLICY_NOT_FOUND' : 'CHECKLIST_RENDER_FAILED' } }),
      })
      return
    }
    const detail = url.pathname.match(POLICY_DETAIL_PATH)
    if (detail) {
      const id = decodeURIComponent(detail[1] ?? '')
      state.detailLog?.push(id)
      const hold = state.holdDetail?.get(id)
      if (hold) await hold
      if (id === 'policy-slow' && state.holdSlow) await state.holdSlow
      if ((id === 'policy-broken' && state.broken) || state.failDetail?.has(id)) {
        await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UPSTREAM' } }) })
        return
      }
      const found = byId.get(id)
      if (!found || state.withdrawn?.has(id)) {
        await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: { code: 'POLICY_NOT_FOUND' } }) })
        return
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: found }) })
      return
    }
    // 列表：政策首页按类别各读一次条数（pageSize=1），再读最近一条和公告条数；类别列表与公告页一页 4 条。
    const kind = url.searchParams.get('kind')
    const audience = url.searchParams.get('audience')
    const pageNo = Math.max(1, Number(url.searchParams.get('page')) || 1)
    const pageSize = Math.max(1, Number(url.searchParams.get('pageSize')) || 200)
    const feed = kind === 'notice' ? NOTICE_FEED : kind === 'policy_guide' ? GUIDE_LIST : []
    const items = feed.filter((item) => !state.withdrawn?.has(item.id) && (!audience || item.audience === audience))
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: items.slice((pageNo - 1) * pageSize, pageNo * pageSize),
        pagination: { page: pageNo, pageSize, total: items.length, totalPages: Math.max(1, Math.ceil(items.length / pageSize)) },
      }),
    })
  })
}

/** 登录页上按真实按钮输手机号与验证码；调用前页面已经在 /login。 */
async function fillLoginThroughVisibleUi(page: Page): Promise<void> {
  await page.getByRole('checkbox', { name: /我已阅读并同意/ }).click()
  await page.getByRole('button', { name: '手机号（11 位本人号码）', exact: true }).click()
  for (const digit of MEMBER_PHONE) await page.getByRole('button', { name: digit, exact: true }).click()
  await page.getByRole('button', { name: '收起键盘', exact: true }).click()
  await page.getByRole('button', { name: '获取验证码', exact: true }).click()
  await page.getByRole('button', { name: '短信验证码', exact: true }).click()
  for (const digit of MEMBER_CODE) await page.getByRole('button', { name: digit, exact: true }).click()
  await page.getByRole('button', { name: '收起键盘', exact: true }).click()
  await page.getByRole('button', { name: '确认登录', exact: true }).click()
}

async function loginThroughVisibleUi(page: Page, returnTo: string): Promise<void> {
  await page.goto(`/login?from=${encodeURIComponent(returnTo)}`)
  await fillLoginThroughVisibleUi(page)
  await page.waitForURL((url) => url.pathname === returnTo)
}

/** 详情与列表、公告共用的触屏屏（政策首页是 policy-touch-hub）；data-qxt-state 是这一屏此刻的状态。 */
function policyScreen(page: Page) {
  return page.getByTestId('renshi-page')
}

/** 详情意图带上的「<发布机构>发布 · <发布日期>」。 */
function policyEyebrow(page: Page) {
  return policyScreen(page).locator('.qxt-band .qxt-eyebrow')
}

function policyHeading(page: Page, name: string) {
  return page.getByRole('heading', { level: 1, name, exact: true })
}

test.beforeEach(async ({ page, api }) => {
  registerShell(api)
  await stubBootTicket(page)
})

test('查政策磁贴写查看政策说明，不再写带走材料清单 @kiosk', async ({ page }) => {
  const state: PolicyRouteState = { broken: false, holdSlow: null, withdrawn: new Set(), failDetail: new Set() }
  await routePolicies(page, state)
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  const tile = page.locator('[data-action="policy-hub"]')
  await expect(tile).toBeVisible()
  await expect(tile).toContainText('查政策')
  await expect(tile).toContainText('查看政策说明')
  await expect(tile).not.toContainText('带走：材料清单')
  await expect(tile).toContainText('要带哪些材料，以官方发布为准')
  const dir = process.env.WALK_FIX_DIR
  if (dir) {
    mkdirSync(dir, { recursive: true })
    await tile.screenshot({ path: `${dir}/W-49-home-policy-tile.png` })
  }
  await assertNoHorizontalOverflow(page)
})

test('浏览记录和打开来源各点一条政策，落到那一条；已下架落到已经撤下 @kiosk', async ({ page, api }) => {
  test.setTimeout(60_000)
  const state: PolicyRouteState = { broken: false, holdSlow: null, detailLog: [], withdrawn: new Set(['policy-gone']) }
  await routePolicies(page, state)
  api.respond('GET', '/api/v1/me/browse-logs', {
    status: 200,
    json: {
      success: true,
      data: {
        items: [
          { id: 'b-policy', targetType: 'policy', targetId: 'policy-fav', targetTitle: '高校毕业生求职创业补贴', sourceName: '示例人社局', sourceUrl: null, externalId: null, createdAt: '2026-09-28T08:00:00.000Z' },
          { id: 'b-gone', targetType: 'policy', targetId: 'policy-gone', targetTitle: '已经撤下的补贴说明', sourceName: '示例人社局', sourceUrl: null, externalId: null, createdAt: '2026-09-27T08:00:00.000Z' },
        ],
        nextCursor: null,
        total: 2,
      },
    },
  })
  api.respond('GET', '/api/v1/me/external-jump-logs', {
    status: 200,
    json: {
      success: true,
      data: {
        items: [
          { id: 'j-policy', targetType: 'policy', targetId: 'policy-dated', targetTitle: '已写明发布日期的补贴说明', action: 'external_open', sourceName: '示例人社局', sourceUrl: 'https://hrss.example.gov.cn/dated', externalId: null, createdAt: '2026-09-28T09:00:00.000Z' },
        ],
        nextCursor: null,
        total: 1,
      },
    },
  })
  await loginThroughVisibleUi(page, '/me/activity')
  await page.getByTestId('member-records-activity-b-policy').click()
  await page.waitForURL((url) => url.pathname === '/renshi' && url.searchParams.get('policy') === 'policy-fav')
  await expect(policyScreen(page)).toHaveAttribute('data-qxt-state', 'ready')
  await expect(policyHeading(page, '高校毕业生求职创业补贴')).toBeVisible()
  expect(state.detailLog).toContain('policy-fav')

  await page.goto('/me/activity?tab=jump')
  await page.getByTestId('member-records-activity-j-policy').click()
  await page.waitForURL((url) => url.pathname === '/renshi' && url.searchParams.get('policy') === 'policy-dated')
  await expect(policyScreen(page)).toHaveAttribute('data-qxt-state', 'ready')
  await expect(policyHeading(page, '已写明发布日期的补贴说明')).toBeVisible()
  expect(state.detailLog).toContain('policy-dated')

  await page.goto('/me/activity')
  await page.getByTestId('member-records-activity-b-gone').click()
  await page.waitForURL((url) => url.pathname === '/renshi' && url.searchParams.get('policy') === 'policy-gone')
  await expect(policyScreen(page)).toHaveAttribute('data-qxt-state', 'missing')
  await expect(policyHeading(page, '这条政策已经撤下或不在可查看范围')).toBeVisible()
})

test('收藏的政策打开那一条，发布日期用确认发布时间 @kiosk', async ({ page }) => {
  test.setTimeout(60_000)
  const state: PolicyRouteState = { broken: false, holdSlow: null, detailLog: [] }
  await routePolicies(page, state)
  await loginThroughVisibleUi(page, '/me/favorites')
  await expect(page.getByText('对应政策页待建设')).toHaveCount(0)
  // 证据锚点随稿换字，判据不变：我的收藏改按触屏稿后，列表下面写「点一条打开政策」，不再写旧的「再打开这则说明…」；
  // 要证明的仍是「收藏的政策是点开那一条，不是平台代办」。
  await expect(page.getByText('点一条打开政策', { exact: false })).toBeVisible()
  await shot(page, 'W-49-favorites.png')
  await page.getByTestId('member-records-fav-fav-row').click()
  await page.waitForURL((url) => url.pathname === '/renshi' && url.searchParams.get('policy') === 'policy-fav')
  // 详情按编号现读收藏的那一条，不拿别的政策顶上。
  await expect(policyScreen(page)).toHaveAttribute('data-qxt-state', 'ready')
  await expect(policyHeading(page, '高校毕业生求职创业补贴')).toBeVisible()
  expect(state.detailLog).toContain('policy-fav')
  await expect(page.getByText('灵活就业社保补贴说明')).toHaveCount(0)
  await expect(page.getByText('毕业年度内有就业创业意愿的高校毕业生', { exact: true })).toBeVisible()
  // 没填发布日期：用确认发布时间的日期部分；发布机构写在同一行。
  await expect(policyEyebrow(page)).toHaveText('示例人社局发布 · 2026-09-29')
  // 登录后的收藏状态读本人账号：收藏里有这一条。
  await expect(page.getByRole('button', { name: /已收藏 · 点此取消/ })).toBeVisible()
  await shot(page, 'W-49-policy-opened.png')
  await shot(page, 'W-52-published-date.png')
  await assertNoHorizontalOverflow(page)
})

test('未登录点收藏先去登录，登录后回到这一条，收藏状态读本人账号 @kiosk', async ({ page }) => {
  test.setTimeout(60_000)
  const state: PolicyRouteState = { broken: false, holdSlow: null }
  await routePolicies(page, state)
  await page.goto('/renshi?policy=policy-fav')
  await expect(policyHeading(page, '高校毕业生求职创业补贴')).toBeVisible()
  // 收藏只存进本人账号：没登录不记本机收藏，点了去登录。
  const favorite = page.getByRole('button', { name: /收藏到「我的」/ })
  await expect(favorite).toContainText('先登录，存进本人账号')
  await favorite.click()
  await page.waitForURL((url) => url.pathname === '/login' && url.searchParams.get('from') === '/renshi?policy=policy-fav')
  await fillLoginThroughVisibleUi(page)
  await page.waitForURL((url) => url.pathname === '/renshi' && url.searchParams.get('policy') === 'policy-fav')
  await expect(policyHeading(page, '高校毕业生求职创业补贴')).toBeVisible()
  await expect(page.getByRole('button', { name: /已收藏 · 点此取消/ })).toBeVisible()
})

test('点名的政策按编号读，读回来之前只说正在读取，不拿别的政策顶上 @kiosk', async ({ page }) => {
  let release!: () => void
  const holdSlow = new Promise<void>((done) => { release = done })
  const state: PolicyRouteState = { broken: false, holdSlow }
  await routePolicies(page, state)
  try {
    await page.goto('/renshi?policy=policy-slow')
    await expect(policyScreen(page)).toHaveAttribute('data-qxt-state', 'loading')
    await expect(policyHeading(page, '正在读取这条政策')).toBeVisible()
    await expect(page.getByText('灵活就业社保补贴说明')).toHaveCount(0)
    await expect(page.getByTestId('policy-checklist-print')).toHaveCount(0)
    release()
    await expect(policyScreen(page)).toHaveAttribute('data-qxt-state', 'ready')
    await expect(policyHeading(page, '补打开的培训补贴说明')).toBeVisible()
    await expect(page.getByText('灵活就业社保补贴说明')).toHaveCount(0)
  } finally {
    release()
  }
})

test('政策找不到时说明打不开，并能回政策首页看其他政策 @kiosk', async ({ page }) => {
  const state: PolicyRouteState = { broken: false, holdSlow: null }
  await routePolicies(page, state)
  await page.goto('/renshi?policy=gone')
  await expect(policyScreen(page)).toHaveAttribute('data-qxt-state', 'missing')
  await expect(policyHeading(page, '这条政策已经撤下或不在可查看范围')).toBeVisible()
  await expect(page.getByText('这条现在不能查看', { exact: true })).toBeVisible()
  await expect(page.getByText('灵活就业社保补贴说明')).toHaveCount(0)
  await expect(page.getByText('接口')).toHaveCount(0)
  await expect(page.getByTestId('policy-checklist-print')).toHaveCount(0)
  await shot(page, 'W-49-policy-missing.png')
  await page.locator('.policy-min-body').getByRole('button', { name: '返回政策首页', exact: true }).click()
  await page.waitForURL((url) => url.pathname === '/policy-service')
  await expect(page.getByTestId('policy-category-flexible')).toContainText('灵活就业社保补贴说明')
})

test('这次没读到可以再试一次，成功后打开那一条；没读到不说已撤下 @kiosk', async ({ page }) => {
  const state: PolicyRouteState = { broken: true, holdSlow: null }
  await routePolicies(page, state)
  await page.goto('/renshi?policy=policy-broken')
  await expect(policyScreen(page)).toHaveAttribute('data-qxt-state', 'failed')
  await expect(policyHeading(page, '这次没读到')).toBeVisible()
  await expect(page.getByText(/撤下|下架/)).toHaveCount(0)
  await expect(page.getByText('灵活就业社保补贴说明')).toHaveCount(0)
  state.broken = false
  await page.getByRole('button', { name: '重新读取', exact: true }).click()
  await expect(policyScreen(page)).toHaveAttribute('data-qxt-state', 'ready')
  await expect(policyHeading(page, '重试后打开的登记说明')).toBeVisible()
})

test('填写了发布日期时不用确认发布时间覆盖 @kiosk', async ({ page }) => {
  const state: PolicyRouteState = { broken: false, holdSlow: null }
  await routePolicies(page, state)
  await page.goto('/renshi?policy=policy-dated')
  await expect(policyEyebrow(page)).toHaveText('示例人社局发布 · 2026-08-01')
  await expect(policyEyebrow(page)).not.toContainText('2026-09-29')
  // 类别列表上的「更新于」用同一个口径。
  await page.goto('/renshi?audience=general')
  const card = page.getByTestId('renshi-policy-list').locator('[data-policy-id="policy-dated"]')
  await expect(card).toContainText('更新于 2026-08-01')
  await expect(card).not.toContainText('2026-09-29')
})

test('旧收藏里的公告编号按政策详情打开时回公告列表，不套三块、不出办事清单 @kiosk', async ({ page }) => {
  // 公告没有三栏，也没有办事清单（2026-11-05 实走发现：原来会落到政策详情版式，三块全写「没有提供」还给打印清单）。
  const state: PolicyRouteState = { broken: false, holdSlow: null, detailLog: [] }
  await routePolicies(page, state)
  await page.goto('/renshi?policy=notice-late')
  await expect(page).toHaveURL(/\/renshi\?tab=notice$/)
  expect(state.detailLog).toEqual(['notice-late'])
  await expect(page.getByTestId('policy-checklist-print')).toHaveCount(0)
  await expect(page.getByText('谁可以申请')).toHaveCount(0)
})

test('政策被撤下后点打印办事清单：不生成、不进打印，整页换成已下架，不留旧正文和原文码 @kiosk', async ({ page }) => {
  const state: PolicyRouteState = { broken: false, holdSlow: null, withdrawn: new Set(), checklistLog: [] }
  await routePolicies(page, state)
  await page.goto('/renshi?policy=policy-fav', { waitUntil: 'domcontentloaded' })
  await expect(policyScreen(page)).toHaveAttribute('data-qxt-state', 'ready')
  await expect(page.getByText(QR_NOTE)).toBeVisible()
  const print = page.getByTestId('policy-checklist-print')
  await expect(print).toContainText('打印办事清单（1 页）')
  await expect(print).toBeEnabled()
  state.withdrawn?.add('policy-fav')
  await print.click()
  await expect(policyScreen(page)).toHaveAttribute('data-qxt-state', 'withdrawn')
  await expect(page.getByText('这条政策已下架', { exact: true })).toBeVisible()
  expect(state.checklistLog).toEqual(['policy-fav'])
  await expect(page).toHaveURL(/\/renshi\?policy=policy-fav$/)
  await expect(page.getByText('高校毕业生求职创业补贴', { exact: true })).toHaveCount(0)
  await expect(page.getByText('毕业年度内有就业创业意愿的高校毕业生')).toHaveCount(0)
  await expect(page.getByText(QR_NOTE)).toHaveCount(0)
  await expect(page.getByTestId('policy-checklist-print')).toHaveCount(0)
  await expect(page.getByText('接口')).toHaveCount(0)
  await shot(page, 'W-90-policy-source-withdrawn.png')
})

test('这次没生成清单时不说已经撤下，也不进打印，原文码照常 @kiosk', async ({ page }) => {
  // 夹具对仍在架的政策一律答「这次没生成」（500），不是 404。
  const state: PolicyRouteState = { broken: false, holdSlow: null, checklistLog: [] }
  await routePolicies(page, state)
  await page.goto('/renshi?policy=policy-fav', { waitUntil: 'domcontentloaded' })
  await expect(policyScreen(page)).toHaveAttribute('data-qxt-state', 'ready')
  const print = page.getByTestId('policy-checklist-print')
  await expect(print).toBeEnabled()
  await print.click()
  const failed = page.getByRole('alert').filter({ hasText: '这次没生成清单' })
  await expect(failed).toContainText('这次没生成清单，可以再试一次；扫码看原文照常')
  await expect(failed.getByRole('button', { name: '重新生成清单', exact: true })).toBeEnabled()
  expect(state.checklistLog).toEqual(['policy-fav'])
  await expect(policyScreen(page)).toHaveAttribute('data-qxt-state', 'ready')
  await expect(page.getByText(/撤下|下架/)).toHaveCount(0)
  await expect(policyHeading(page, '高校毕业生求职创业补贴')).toBeVisible()
  await expect(page.getByText(QR_NOTE)).toBeVisible()
  await expect(page).toHaveURL(/\/renshi\?policy=policy-fav$/)
})

test('展开着的公告被撤下后，上传自备材料留在这一页并说明已下架 @kiosk', async ({ page }) => {
  const state: PolicyRouteState = { broken: false, holdSlow: null, withdrawn: new Set() }
  await routePolicies(page, state)
  await page.goto('/renshi?tab=notice', { waitUntil: 'domcontentloaded' })
  const listed = page.locator('[data-policy-id="notice-listed"]')
  await expect(listed).toHaveClass(/is-open/)
  const upload = listed.getByRole('button', { name: /^上传自备材料打印/ })
  await expect(upload).toBeVisible()
  state.withdrawn?.add('notice-listed')
  await upload.click()
  await expect(page.getByText('这条政策已下架', { exact: true })).toBeVisible()
  await expect(page).toHaveURL(/\/renshi\?tab=notice$/)
  await expect(page).not.toHaveURL(/\/print\/upload/)
  await expect(page.locator('[data-policy-id="notice-listed"]')).toHaveCount(0)
  const next = page.locator('[data-policy-id="notice-next"]')
  await expect(next).toBeVisible()
  await expect(next).not.toHaveClass(/is-open/)
  await shot(page, 'W-90-notice-upload-withdrawn.png')
})

test('这次没确认公告还在时不说已下架，也不进上传 @kiosk', async ({ page }) => {
  const state: PolicyRouteState = { broken: false, holdSlow: null, failDetail: new Set(['notice-listed']) }
  await routePolicies(page, state)
  await page.goto('/renshi?tab=notice', { waitUntil: 'domcontentloaded' })
  const listed = page.locator('[data-policy-id="notice-listed"]')
  await expect(listed).toHaveClass(/is-open/)
  await listed.getByRole('button', { name: /^上传自备材料打印/ }).click()
  await expect(page.getByText('这次没读到，请重新读取后再试', { exact: true })).toBeVisible()
  await expect(page.getByText(/撤下|下架/)).toHaveCount(0)
  await expect(page).toHaveURL(/\/renshi\?tab=notice$/)
  await expect(listed).toHaveClass(/is-open/)
})

test('还在的公告可以进入上传自备材料 @kiosk', async ({ page }) => {
  const state: PolicyRouteState = { broken: false, holdSlow: null }
  await routePolicies(page, state)
  await page.goto('/renshi?tab=notice', { waitUntil: 'domcontentloaded' })
  const listed = page.locator('[data-policy-id="notice-listed"]')
  await expect(listed).toHaveClass(/is-open/)
  await listed.getByRole('button', { name: /^上传自备材料打印/ }).click()
  await page.waitForURL((url) => url.pathname === '/print/upload')
  // 2026-10-28 稿 print-src：来源选择页的标题是「文件在哪里？」（原「文件怎么进来」）。
  await expect(page.getByText('文件在哪里？')).toBeVisible()
  await expect(page.getByText('选文件').first()).toBeVisible()
  await shot(page, 'W-90-upload-entry-open.png')
})

// 旧版 /renshi 是一页多分区，政策在列表里就地展开，列表还定时把已下架条目摘掉；这些都已停放，
// 「列表里展开」「列表定时摘除」几条用例随之删掉。旧链接还会被书签和旧页面带进来：回政策首页，不出报错页。
test('旧政策链接 /renshi 与旧政策分区回政策首页 @kiosk', async ({ page }) => {
  const state: PolicyRouteState = { broken: false, holdSlow: null }
  await routePolicies(page, state)
  for (const old of ['/renshi', '/renshi?tab=policy']) {
    await page.goto(old)
    await page.waitForURL((url) => url.pathname === '/policy-service' && url.search === '')
    await expect(page.getByTestId('policy-touch-hub')).toHaveAttribute('data-qxt-state', 'ready')
  }
})


// ── 无人值守：政策紧急下架后，已打开的详情要在一个刷新间隔内自己撤掉，不留旧正文 ──
// 间隔是 PolicyDetail 的 POLICY_REFRESH_MS（30 秒）；这里用假时钟快进 31 秒。
// 列表按类别分页、每次进来现读，不再定时摘除（旧版那两条列表用例已删）。

test('政策下架自动刷新：正在看的这一条被下架，整页换成已下架，不留旧正文，出路是回政策首页 @kiosk', async ({ page }) => {
  const state: PolicyRouteState = { broken: false, holdSlow: null, withdrawn: new Set() }
  await page.clock.install()
  await routePolicies(page, state)
  await page.goto('/renshi?policy=policy-fav', { waitUntil: 'domcontentloaded' })
  await expect(policyScreen(page)).toHaveAttribute('data-qxt-state', 'ready')
  await expect(page.getByRole('heading', { name: '谁可以申请', exact: true })).toBeVisible()
  await expect(page.getByText('毕业年度内有就业创业意愿的高校毕业生', { exact: true })).toBeVisible()
  await expect(page.getByText(QR_NOTE)).toBeVisible()
  state.withdrawn?.add('policy-fav')
  await page.clock.fastForward(31_000)

  await expect(policyScreen(page)).toHaveAttribute('data-qxt-state', 'withdrawn')
  await expect(policyHeading(page, '这条政策已经撤下')).toBeVisible()
  await expect(page.getByText('这条政策已下架', { exact: true })).toBeVisible()
  await expect(page.getByText('不再显示旧正文、原文二维码和清单。可以返回政策首页查看当前发布内容。')).toBeVisible()
  // 不留旧正文：标题、办事三栏、原文码、打印清单、问小青与收藏都没了。
  await expect(page.getByText('高校毕业生求职创业补贴', { exact: true })).toHaveCount(0)
  await expect(page.getByText('毕业年度内有就业创业意愿的高校毕业生')).toHaveCount(0)
  // 办事三栏的标题没了（下面「可以打印一页办事清单」小样里那句「谁可以申请、要准备的材料…」是示意，不是这条政策）。
  await expect(page.getByRole('heading', { name: '谁可以申请', exact: true })).toHaveCount(0)
  await expect(page.getByText(QR_NOTE)).toHaveCount(0)
  await expect(page.getByTestId('policy-checklist-print')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /问小青这条|收藏到「我的」/ })).toHaveCount(0)
  // 出路：底栏与页内各有一个回政策首页；回去后被下架的那条不再算进类别。
  await expect(page.locator('.policy-min-body').getByRole('button', { name: '返回政策首页', exact: true })).toBeVisible()
  await page.locator('.qxt-dock').getByRole('button', { name: '返回政策首页' }).click()
  await page.waitForURL((url) => url.pathname === '/policy-service')
  await expect(page.getByTestId('policy-category-graduate')).toContainText('还没有机构发布')
  await expect(page.getByTestId('policy-category-flexible')).toContainText('灵活就业社保补贴说明')
})

test('政策下架自动刷新：核对时这次没读到，不说已下架，正文照常 @kiosk', async ({ page }) => {
  const state: PolicyRouteState = { broken: false, holdSlow: null, withdrawn: new Set(), failDetail: new Set(), detailLog: [] }
  await page.clock.install()
  await routePolicies(page, state)
  await page.goto('/renshi?policy=policy-fav', { waitUntil: 'domcontentloaded' })
  await expect(policyScreen(page)).toHaveAttribute('data-qxt-state', 'ready')
  const reads = state.detailLog?.length ?? 0
  // 这一条按条读取失败（不是 404）：只说明这次没确认，不能当成已下架。连着两轮都失败——
  // 第二轮能发出来，说明第一轮已经处理完，下面的断言不会赶在第一轮的结果上屏之前。
  state.failDetail?.add('policy-fav')
  for (const round of [1, 2]) {
    const failedCheck = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/v1/policies/policy-fav' && response.status() === 500)
    await page.clock.fastForward(31_000)
    await failedCheck
    expect(state.detailLog?.length).toBe(reads + round)
    await expect(policyScreen(page)).toHaveAttribute('data-qxt-state', 'ready')
  }
  await expect(page.getByText(/撤下|下架/)).toHaveCount(0)
  await expect(policyHeading(page, '高校毕业生求职创业补贴')).toBeVisible()
  await expect(page.getByText(QR_NOTE)).toBeVisible()
  // 阳性对照：读取恢复、这条真被下架时，下一轮照样换成已下架——上面没说已下架，不是因为不再核对。
  state.failDetail?.delete('policy-fav')
  state.withdrawn?.add('policy-fav')
  await page.clock.fastForward(31_000)
  await expect(policyScreen(page)).toHaveAttribute('data-qxt-state', 'withdrawn')
  expect(state.detailLog?.length).toBe(reads + 3)
})

test('政策下架自动刷新：核对期间本人换到别的政策，迟到的下架结果不把新看的这条换成已下架 @kiosk', async ({ page }) => {
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const state: PolicyRouteState = { broken: false, holdSlow: null, withdrawn: new Set(), detailLog: [] }
  await page.clock.install()
  await routePolicies(page, state)
  try {
    await page.goto('/renshi?policy=policy-fav', { waitUntil: 'domcontentloaded' })
    await expect(policyScreen(page)).toHaveAttribute('data-qxt-state', 'ready')
    const reads = state.detailLog?.length ?? 0
    // 首次读取之后，这一条的按条核对被压住；压住期间它被下架。
    state.holdDetail = new Map([['policy-fav', gate]])
    state.withdrawn?.add('policy-fav')
    await page.clock.fastForward(31_000)
    await expect.poll(() => state.detailLog?.length).toBe(reads + 1)
    // 刷新已对 policy-fav 发出按条读取，应答被压住；本人回政策首页，再点开另一条。
    await page.locator('.qxt-dock').getByRole('button', { name: '返回政策首页' }).click()
    await page.waitForURL((url) => url.pathname === '/policy-service')
    // 旧的那条已从政策首页摘掉。
    await expect(page.getByTestId('policy-category-graduate')).toContainText('还没有机构发布')
    await page.getByTestId('policy-category-general').click()
    await page.waitForURL((url) => url.pathname === '/renshi' && url.searchParams.get('audience') === 'general')
    await page.getByTestId('renshi-policy-list').locator('[data-policy-id="policy-dated"]').click()
    await page.waitForURL((url) => url.pathname === '/renshi' && url.searchParams.get('policy') === 'policy-dated')
    await expect(policyHeading(page, '已写明发布日期的补贴说明')).toBeVisible()
    const stale = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/v1/policies/policy-fav' && response.status() === 404)
    release()
    await stale
    // 新看的这条自己的下一轮核对发出来了，说明迟到的那个 404 早已处理完，下面的断言不会抢在它前面。
    const datedReads = () => state.detailLog?.filter((id) => id === 'policy-dated').length ?? 0
    const before = datedReads()
    await page.clock.fastForward(31_000)
    await expect.poll(datedReads).toBe(before + 1)
    await expect(policyScreen(page)).toHaveAttribute('data-qxt-state', 'ready')
    await expect(policyHeading(page, '已写明发布日期的补贴说明')).toBeVisible()
    await expect(page.getByText(/撤下|下架/)).toHaveCount(0)
  } finally {
    release()
  }
})

test('政策下架自动刷新：一次按条核对挂住，8 秒后放弃，下一轮照常刷新 @kiosk', async ({ page }) => {
  const never = new Promise<void>(() => {})
  const state: PolicyRouteState = { broken: false, holdSlow: null, withdrawn: new Set(), detailLog: [] }
  await page.clock.install()
  await routePolicies(page, state)
  await page.goto('/renshi?policy=policy-fav', { waitUntil: 'domcontentloaded' })
  await expect(policyScreen(page)).toHaveAttribute('data-qxt-state', 'ready')
  const reads = state.detailLog?.length ?? 0
  // 首次读取之后，这一条的按条核对一律挂住不回。
  state.holdDetail = new Map([['policy-fav', never]])
  await page.clock.fastForward(31_000)
  await expect.poll(() => state.detailLog?.length).toBe(reads + 1)
  // 挂住的那一次在 8 秒上限后被放弃（不等于下架）；再过一个间隔，下一轮照常发出。
  await page.clock.fastForward(8_100)
  await page.clock.fastForward(31_000)
  await expect.poll(() => state.detailLog?.length).toBe(reads + 2)
  await expect(policyScreen(page)).toHaveAttribute('data-qxt-state', 'ready')
  await expect(page.getByText(/撤下|下架/)).toHaveCount(0)
  await expect(policyHeading(page, '高校毕业生求职创业补贴')).toBeVisible()
})
