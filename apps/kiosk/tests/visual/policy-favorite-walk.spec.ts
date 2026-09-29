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
}
const NOTICE_LATE: PolicyFixture = {
  ...SRC, id: 'notice-late', kind: 'notice', title: '窗口时间调整通知',
  summary: '这条不在第一页列表里。', category: 'notice', content: '办理时间以原文为准。',
  publishConfirmedAt: '2026-07-15T08:00:00.000Z',
}

const GUIDE_LIST = [OTHER, FAV, DATED]
const NOTICE_FEED = [NOTICE_LIST]

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
}

function isPolicyRequest(url: URL): boolean {
  // Playwright 的 ** 只有夹在斜线之间才跨路径。policies** 匹配不到 /policies/:id。
  return url.pathname === '/api/v1/policies' || /^\/api\/v1\/policies\/[^/]+$/.test(url.pathname)
}

async function routePolicies(page: Page, state: PolicyRouteState): Promise<void> {
  const byId = new Map<string, PolicyFixture>([OTHER, FAV, DATED, SLOW, BROKEN, NOTICE_LIST, NOTICE_LATE].map((item) => [item.id, item]))
  await page.route(isPolicyRequest, async (route) => {
    const url = new URL(route.request().url())
    const detail = url.pathname.match(/^\/api\/v1\/policies\/([^/]+)$/)
    if (detail) {
      const id = decodeURIComponent(detail[1] ?? '')
      if (id === 'policy-slow' && state.holdSlow) await state.holdSlow
      if (id === 'policy-broken' && state.broken) {
        await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UPSTREAM' } }) })
        return
      }
      const found = byId.get(id)
      if (!found) {
        await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: { code: 'POLICY_NOT_FOUND' } }) })
        return
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: found }) })
      return
    }
    const kind = url.searchParams.get('kind')
    const items = kind === 'notice' ? NOTICE_FEED : kind === 'policy_guide' ? GUIDE_LIST : []
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
  const state: PolicyRouteState = { broken: false, holdSlow: null }
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
