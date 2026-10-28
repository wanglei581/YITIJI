// W-49 / W-52：收藏的政策要打开那一条；找不到或这次没读到要有出路；
// 首页不再写「带走：材料清单」；发布日期没有填写时用确认发布时间。
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
  summary: '另一条公告，用来确认撤下后不会自动展开。', category: 'notice', publishedDate: '2026-08-18',
  externalUrl: 'https://hrss.example.gov.cn/notice-next',
}
const NOTICE_LATE: PolicyFixture = {
  ...SRC, id: 'notice-late', kind: 'notice', title: '窗口时间调整通知',
  summary: '这条不在第一页列表里。', category: 'notice', content: '办理时间以原文为准。',
  publishConfirmedAt: '2026-07-15T08:00:00.000Z',
}

const GUIDE_LIST = [OTHER, FAV, DATED]
const NOTICE_FEED = [NOTICE_LIST, NOTICE_NEXT]

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
}

function isPolicyRequest(url: URL): boolean {
  // Playwright 的 ** 只有夹在斜线之间才跨路径。policies** 匹配不到 /policies/:id。
  return url.pathname === '/api/v1/policies' || /^\/api\/v1\/policies\/[^/]+$/.test(url.pathname)
}

async function routePolicies(page: Page, state: PolicyRouteState): Promise<void> {
  const byId = new Map<string, PolicyFixture>([OTHER, FAV, DATED, SLOW, BROKEN, NOTICE_LIST, NOTICE_NEXT, NOTICE_LATE].map((item) => [item.id, item]))
  await page.route(isPolicyRequest, async (route) => {
    const url = new URL(route.request().url())
    const detail = url.pathname.match(/^\/api\/v1\/policies\/([^/]+)$/)
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
    const kind = url.searchParams.get('kind')
    const feed = kind === 'notice' ? NOTICE_FEED : kind === 'policy_guide' ? GUIDE_LIST : []
    const items = feed.filter((item) => !state.withdrawn?.has(item.id))
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: items, pagination: { page: 1, pageSize: 200, total: items.length, totalPages: 1 } }),
    })
  })
}

async function loginThroughVisibleUi(page: Page, returnTo: string): Promise<void> {
  await page.goto(`/login?from=${encodeURIComponent(returnTo)}`)
  await page.getByRole('checkbox', { name: /我已阅读并同意/ }).click()
  await page.getByRole('button', { name: '手机号（11 位本人号码）', exact: true }).click()
  for (const digit of MEMBER_PHONE) await page.getByRole('button', { name: digit, exact: true }).click()
  await page.getByRole('button', { name: '收起键盘', exact: true }).click()
  await page.getByRole('button', { name: '获取验证码', exact: true }).click()
  await page.getByRole('button', { name: '短信验证码', exact: true }).click()
  for (const digit of MEMBER_CODE) await page.getByRole('button', { name: digit, exact: true }).click()
  await page.getByRole('button', { name: '收起键盘', exact: true }).click()
  await page.getByRole('button', { name: '确认登录', exact: true }).click()
  await page.waitForURL((url) => url.pathname === returnTo)
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

test('收藏的政策打开那一条，发布日期用确认发布时间 @kiosk', async ({ page }) => {
  test.setTimeout(60_000)
  const state: PolicyRouteState = { broken: false, holdSlow: null }
  await routePolicies(page, state)
  await loginThroughVisibleUi(page, '/me/favorites')
  await expect(page.getByText('对应政策页待建设')).toHaveCount(0)
  await expect(page.getByText('再打开这则说明，办理仍以官方入口为准。')).toBeVisible()
  await shot(page, 'W-49-favorites.png')
  await page.getByTestId('member-records-fav-fav-row').click()
  await page.waitForURL((url) => url.pathname === '/renshi' && url.searchParams.get('policy') === 'policy-fav')
  const opened = page.locator('[data-policy-id="policy-fav"]')
  const other = page.locator('[data-policy-id="policy-other"]')
  await expect(opened).toHaveClass(/is-open/)
  await expect(other).not.toHaveClass(/is-open/)
  await expect(opened).toContainText('高校毕业生求职创业补贴')
  await expect(opened.locator('.rq-facts')).toContainText('发布日期')
  await expect(opened.locator('.rq-facts')).toContainText('2026-09-29')
  await shot(page, 'W-49-policy-opened.png')
  await shot(page, 'W-52-published-date.png')
  await assertNoHorizontalOverflow(page)
})

test('点名的政策不在列表里时先说明正在打开，不拿第一条顶上 @kiosk', async ({ page }) => {
  let release!: () => void
  const holdSlow = new Promise<void>((done) => { release = done })
  const state: PolicyRouteState = { broken: false, holdSlow }
  await routePolicies(page, state)
  try {
    await page.goto('/renshi?policy=policy-slow')
    await expect(page.getByTestId('renshi-policy-focus')).toHaveAttribute('data-focus-phase', 'checking')
    await expect(page.getByText('正在打开这条政策', { exact: true })).toBeVisible()
    await expect(page.getByText('灵活就业社保补贴说明')).toHaveCount(0)
    release()
    const opened = page.locator('[data-policy-id="policy-slow"]')
    await expect(opened).toHaveClass(/is-open/)
    await expect(opened).toContainText('补打开的培训补贴说明')
    await expect(page.locator('[data-policy-id="policy-other"]')).not.toHaveClass(/is-open/)
  } finally {
    release()
  }
})

test('政策找不到时说明打不开，并能去看其他政策或回到收藏 @kiosk', async ({ page }) => {
  const state: PolicyRouteState = { broken: false, holdSlow: null }
  await routePolicies(page, state)
  await page.goto('/renshi?policy=gone')
  const focus = page.getByTestId('renshi-policy-focus')
  await expect(focus).toHaveAttribute('data-focus-phase', 'missing')
  await expect(page.getByText('这条政策现在打不开', { exact: true })).toBeVisible()
  await expect(page.getByText('收藏还在，但这条已经不在可查看的政策里')).toBeVisible()
  await expect(page.getByText('灵活就业社保补贴说明')).toHaveCount(0)
  await expect(page.getByText('接口')).toHaveCount(0)
  await shot(page, 'W-49-policy-missing.png')
  await page.getByRole('button', { name: /看看其他政策/ }).click()
  await expect(page).toHaveURL(/\/renshi/)
  await expect(page).not.toHaveURL(/[?&]policy=/)
  await expect(page.locator('[data-policy-id="policy-other"]')).toBeVisible()
  await page.goto('/renshi?policy=gone')
  await expect(page.getByText('这条政策现在打不开', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: /返回我的收藏/ }).click()
  await page.waitForURL((url) => url.pathname === '/me/favorites')
  await expect(page.getByText('登录后查看我的收藏')).toBeVisible()
})

test('这次没读到可以再试一次，成功后打开那一条 @kiosk', async ({ page }) => {
  const state: PolicyRouteState = { broken: true, holdSlow: null }
  await routePolicies(page, state)
  await page.goto('/renshi?policy=policy-broken')
  await expect(page.getByTestId('renshi-policy-focus')).toHaveAttribute('data-focus-phase', 'failed')
  await expect(page.getByText('这次没有打开这条政策', { exact: true })).toBeVisible()
  await expect(page.getByText('灵活就业社保补贴说明')).toHaveCount(0)
  state.broken = false
  await page.getByRole('button', { name: /再试一次/ }).click()
  const opened = page.locator('[data-policy-id="policy-broken"]')
  await expect(opened).toHaveClass(/is-open/)
  await expect(opened).toContainText('重试后打开的登记说明')
})

test('填写了发布日期时不用确认发布时间覆盖 @kiosk', async ({ page }) => {
  const state: PolicyRouteState = { broken: false, holdSlow: null }
  await routePolicies(page, state)
  await page.goto('/renshi?policy=policy-dated')
  const opened = page.locator('[data-policy-id="policy-dated"]')
  await expect(opened).toHaveClass(/is-open/)
  const facts = opened.locator('.rq-facts')
  await expect(facts).toContainText('2026-08-01')
  await expect(facts).not.toContainText('2026-09-29')
})

test('不在列表里的公告按条打开，发布时间用确认发布时间 @kiosk', async ({ page }) => {
  const state: PolicyRouteState = { broken: false, holdSlow: null }
  await routePolicies(page, state)
  await page.goto('/renshi?policy=notice-late')
  await expect(page.locator('[data-renshi-tab="notice"]')).toBeVisible()
  const opened = page.locator('[data-policy-id="notice-late"]')
  await expect(opened).toHaveClass(/is-open/)
  await expect(opened).toContainText('窗口时间调整通知')
  await expect(opened.locator('.rq-facts')).toContainText('发布时间')
  await expect(opened.locator('.rq-facts')).toContainText('2026-07-15')
  await expect(page.locator('[data-policy-id="notice-listed"]')).not.toHaveClass(/is-open/)
})

test('已展开的政策被撤下后，点来源码不再打开，并回到列表 @kiosk', async ({ page }) => {
  const state: PolicyRouteState = { broken: false, holdSlow: null, withdrawn: new Set() }
  await routePolicies(page, state)
  await page.goto('/renshi', { waitUntil: 'domcontentloaded' })
  const fav = page.locator('[data-policy-id="policy-fav"]')
  await expect(fav).toBeVisible()
  await fav.getByRole('button', { name: /高校毕业生求职创业补贴/ }).click()
  await expect(fav).toHaveClass(/is-open/)
  state.withdrawn?.add('policy-fav')
  await fav.getByRole('button', { name: /扫码打开来源链接/ }).click()
  const note = page.getByTestId('renshi-policy-action')
  await expect(note).toHaveAttribute('data-action-phase', 'withdrawn')
  await expect(note).toHaveText('这条政策已经撤下，不再提供来源入口')
  await expect(page.getByRole('heading', { name: '扫码打开来源链接' })).toHaveCount(0)
  await expect(page).toHaveURL(/\/renshi$/)
  await expect(page.locator('[data-policy-id="policy-fav"]')).toHaveCount(0)
  await expect(page.locator('[data-policy-id="policy-other"]')).not.toHaveClass(/is-open/)
  await expect(page.getByText('接口')).toHaveCount(0)
  await shot(page, 'W-90-policy-source-withdrawn.png')
})

test('已展开的公告被撤下后，上传自备材料留在这一页并说明 @kiosk', async ({ page }) => {
  const state: PolicyRouteState = { broken: false, holdSlow: null, withdrawn: new Set() }
  await routePolicies(page, state)
  await page.goto('/renshi?tab=notice', { waitUntil: 'domcontentloaded' })
  const listed = page.locator('[data-policy-id="notice-listed"]')
  await expect(listed).toHaveClass(/is-open/)
  const upload = page.getByTestId('renshi-ctabar').getByRole('button', { name: '上传自备材料打印' })
  await expect(upload).toHaveAttribute('data-upload-target', 'notice-listed')
  state.withdrawn?.add('notice-listed')
  await upload.click()
  await expect(page).toHaveURL(/\/renshi/)
  await expect(page).not.toHaveURL(/\/print\/upload/)
  await expect(page.getByText('这条政策已经撤下，不再提供来源入口', { exact: true })).toBeVisible()
  await expect(page.locator('[data-policy-id="notice-listed"]')).toHaveCount(0)
  await expect(page.locator('[data-policy-id="notice-next"]')).not.toHaveClass(/is-open/)
  await shot(page, 'W-90-notice-upload-withdrawn.png')
})

test('还在的公告可以进入上传自备材料 @kiosk', async ({ page }) => {
  const state: PolicyRouteState = { broken: false, holdSlow: null }
  await routePolicies(page, state)
  await page.goto('/renshi?tab=notice', { waitUntil: 'domcontentloaded' })
  const upload = page.getByTestId('renshi-ctabar').getByRole('button', { name: '上传自备材料打印' })
  await expect(upload).toHaveAttribute('data-upload-target', 'notice-listed')
  await upload.click()
  await page.waitForURL((url) => url.pathname === '/print/upload')
  await expect(page.getByText('怎么进来')).toBeVisible()
  await expect(page.getByText('选文件').first()).toBeVisible()
  await shot(page, 'W-90-upload-entry-open.png')
})

test('这次没确认政策还在时不说已经撤下，也不打开来源码 @kiosk', async ({ page }) => {
  const state: PolicyRouteState = { broken: false, holdSlow: null, failDetail: new Set(['policy-fav']) }
  await routePolicies(page, state)
  await page.goto('/renshi', { waitUntil: 'domcontentloaded' })
  const fav = page.locator('[data-policy-id="policy-fav"]')
  await fav.getByRole('button', { name: /高校毕业生求职创业补贴/ }).click()
  await expect(fav).toHaveClass(/is-open/)
  await fav.getByRole('button', { name: /扫码打开来源链接/ }).click()
  await expect(page.getByText('这次没有确认这条还在，先不打开来源入口。', { exact: true })).toBeVisible()
  await expect(page.getByText('这条政策已经撤下，不再提供来源入口')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '扫码打开来源链接' })).toHaveCount(0)
  await expect(fav).toHaveClass(/is-open/)
})


// ── 无人值守：政策紧急下架后，已打开的页面要在一个刷新间隔内自己撤掉，不留旧正文 ──
// 间隔是 RenshiPage 的 POLICY_REFRESH_MS（30 秒）；这里用假时钟快进 31 秒。

test('政策下架自动刷新：本人点开的那一条被下架，整页换成已下架，不留旧正文，出路是回列表 @kiosk', async ({ page }) => {
  const state: PolicyRouteState = { broken: false, holdSlow: null, withdrawn: new Set() }
  await page.clock.install()
  await routePolicies(page, state)
  await page.goto('/renshi', { waitUntil: 'domcontentloaded' })
  const fav = page.locator('[data-policy-id="policy-fav"]')
  await expect(fav).toBeVisible()
  await fav.getByRole('button', { name: /高校毕业生求职创业补贴/ }).click()
  await expect(fav).toHaveClass(/is-open/)
  state.withdrawn?.add('policy-fav')
  await page.clock.fastForward(31_000)

  const withdrawn = page.getByTestId('renshi-policy-withdrawn')
  await expect(withdrawn).toBeVisible()
  await expect(withdrawn).toContainText('这条政策已下架')
  await expect(page.getByText('这条政策已不在可查看范围内。')).toBeVisible()
  // 顶栏也同步说，不再说「政策库与办事指引」。
  await expect(page.locator('.qxt-status')).toHaveText('这条已下架')
  // 不留旧正文：卡片、标题、摘要、来源入口都没了；整页没有任何政策卡。
  await expect(fav).toHaveCount(0)
  await expect(page.getByText('高校毕业生求职创业补贴', { exact: true })).toHaveCount(0)
  await expect(page.getByText('收藏的这一条。', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /扫码打开来源链接/ })).toHaveCount(0)
  await expect(page.locator('[data-policy-id]')).toHaveCount(0)
  // 出路：底栏与页内各有一个回列表；打印自备材料的出口仍在。
  await expect(page.locator('.qxt-dock').getByRole('button', { name: '返回政策列表' })).toBeVisible()
  await expect(page.getByRole('button', { name: /打印你自己带来的文件/ })).toBeVisible()
  await page.locator('.qxt-dock').getByRole('button', { name: '返回政策列表' }).click()
  await expect(withdrawn).toHaveCount(0)
  await expect(page.locator('[data-policy-id="policy-other"]')).toBeVisible()
  await expect(page.locator('[data-policy-id="policy-fav"]')).toHaveCount(0)
  await expect(page.locator('.qxt-status')).not.toHaveText('这条已下架')
  // 回到列表后，默认自动展开的那一条不算「本人点开」：它再被下架只摘掉，不整页换成已下架（见下一条）。
})

test('政策下架自动刷新：默认自动展开的第一条被下架，只从列表摘掉，不整页换成已下架 @kiosk', async ({ page }) => {
  const state: PolicyRouteState = { broken: false, holdSlow: null, withdrawn: new Set() }
  await page.clock.install()
  await routePolicies(page, state)
  await page.goto('/renshi', { waitUntil: 'domcontentloaded' })
  const first = page.locator('[data-policy-id="policy-other"]')
  await expect(first).toHaveClass(/is-open/)
  state.withdrawn?.add('policy-other')
  await page.clock.fastForward(31_000)
  await expect(first).toHaveCount(0)
  await expect(page.getByTestId('renshi-policy-withdrawn')).toHaveCount(0)
  await expect(page.getByText('灵活就业社保补贴说明', { exact: true })).toHaveCount(0)
  await expect(page.locator('[data-policy-id="policy-fav"]')).toBeVisible()
})

test('政策下架自动刷新：别处被下架的条目，列表在刷新间隔内自己撤掉，展开着的那一条不受影响 @kiosk', async ({ page }) => {
  const state: PolicyRouteState = { broken: false, holdSlow: null, withdrawn: new Set() }
  await page.clock.install()
  await routePolicies(page, state)
  await page.goto('/renshi', { waitUntil: 'domcontentloaded' })
  const fav = page.locator('[data-policy-id="policy-fav"]')
  await fav.getByRole('button', { name: /高校毕业生求职创业补贴/ }).click()
  await expect(fav).toHaveClass(/is-open/)
  state.withdrawn?.add('policy-dated')
  await page.clock.fastForward(31_000)
  await expect(page.locator('[data-policy-id="policy-dated"]')).toHaveCount(0)
  await expect(page.getByTestId('renshi-policy-withdrawn')).toHaveCount(0)
  await expect(fav).toHaveClass(/is-open/)
})

test('政策下架自动刷新：读取失败时不说已下架，列表保持原样 @kiosk', async ({ page }) => {
  const state: PolicyRouteState = { broken: false, holdSlow: null, withdrawn: new Set(), failDetail: new Set() }
  await page.clock.install()
  await routePolicies(page, state)
  await page.goto('/renshi', { waitUntil: 'domcontentloaded' })
  const fav = page.locator('[data-policy-id="policy-fav"]')
  await fav.getByRole('button', { name: /高校毕业生求职创业补贴/ }).click()
  await expect(fav).toHaveClass(/is-open/)
  // 这一条按条读取失败（不是 404）：只说明这次没确认，不能当成已下架。
  state.failDetail?.add('policy-fav')
  await page.clock.fastForward(31_000)
  await expect(page.getByTestId('renshi-policy-withdrawn')).toHaveCount(0)
  await expect(fav).toHaveClass(/is-open/)
})

test('政策下架自动刷新：核对期间本人换到别的条目，不把新看的这条换成已下架，旧的那条只从列表摘掉 @kiosk', async ({ page }) => {
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const state: PolicyRouteState = { broken: false, holdSlow: null, withdrawn: new Set(), holdDetail: new Map([['policy-fav', gate]]) }
  await page.clock.install()
  await routePolicies(page, state)
  await page.goto('/renshi', { waitUntil: 'domcontentloaded' })
  const fav = page.locator('[data-policy-id="policy-fav"]')
  await fav.getByRole('button', { name: /高校毕业生求职创业补贴/ }).click()
  await expect(fav).toHaveClass(/is-open/)
  state.withdrawn?.add('policy-fav')
  await page.clock.fastForward(31_000)
  // 刷新已对 policy-fav 发出按条读取，应答被压住；本人这时换去看另一条。
  const dated = page.locator('[data-policy-id="policy-dated"]')
  await dated.getByRole('button', { name: /已写明发布日期的补贴说明/ }).click()
  await expect(dated).toHaveClass(/is-open/)
  release()
  await expect(page.locator('[data-policy-id="policy-fav"]')).toHaveCount(0)
  await expect(page.getByTestId('renshi-policy-withdrawn')).toHaveCount(0)
  await expect(dated).toHaveClass(/is-open/)
})

test('政策下架自动刷新：一次按条核对挂住，8 秒后放弃，下一轮照常刷新 @kiosk', async ({ page }) => {
  const never = new Promise<void>(() => {})
  const state: PolicyRouteState = { broken: false, holdSlow: null, withdrawn: new Set(), holdDetail: new Map([['policy-fav', never]]), detailLog: [] }
  await page.clock.install()
  await routePolicies(page, state)
  await page.goto('/renshi', { waitUntil: 'domcontentloaded' })
  const fav = page.locator('[data-policy-id="policy-fav"]')
  await fav.getByRole('button', { name: /高校毕业生求职创业补贴/ }).click()
  await expect(fav).toHaveClass(/is-open/)
  await page.clock.fastForward(31_000)
  await expect.poll(() => state.detailLog?.length).toBe(1)
  // 挂住的那一次在 8 秒上限后被放弃（不等于下架）；再过一个间隔，下一轮照常发出。
  await page.clock.fastForward(8_100)
  await page.clock.fastForward(31_000)
  await expect.poll(() => state.detailLog?.length).toBe(2)
  await expect(page.getByTestId('renshi-policy-withdrawn')).toHaveCount(0)
  await expect(fav).toHaveClass(/is-open/)
})
