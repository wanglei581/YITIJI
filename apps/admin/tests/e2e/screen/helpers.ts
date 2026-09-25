import type { BrowserContext, Locator, Page } from '@playwright/test'
import { expect } from '@playwright/test'
import { govFull, isUsageRange, opsFull, terminalTwin, usageSnapshot } from './fixtures/snapshots'

/**
 * 管理员数据大屏 E2E 的公共件。
 *
 * 网络层全部挂在 **context** 上而不是 page 上：「新窗口展示」用 window.open 开出的
 * 展示窗口是同一 context 里的新 page，page.route 管不到它，挂 context 才能让两扇窗
 * 看到同一份夹具、同一本请求账。
 */

export const MOCK_ADMIN_AUTH = {
  token: 'mock-token',
  user: { id: 'mock-admin-001', name: '系统管理员（预览）', role: 'admin' as const, orgId: null },
}

const SCREEN_API = '**/api/v1/admin/screen/**'

export type Reply = { status: number; body: unknown } | 'abort'
export type Responder = (url: URL) => Reply | Promise<Reply>

export interface ScreenCall {
  /** pathname + search，例 /api/v1/admin/screen/snapshot?profile=gov */
  url: string
  method: string
  headers: Record<string, string>
}

export interface CallLog {
  calls: ScreenCall[]
  readonly urls: string[]
}

const prepared = new WeakSet<BrowserContext>()
const pageErrors = new WeakMap<BrowserContext, string[]>()

/** 鉴权与侧栏用到的旁路接口；页面未捕获异常按 context 收集，每条用例结束时断言为空。 */
async function prepareContext(context: BrowserContext): Promise<void> {
  if (prepared.has(context)) return
  prepared.add(context)
  const errors: string[] = []
  pageErrors.set(context, errors)
  const watch = (p: Page) => p.on('pageerror', (error) => errors.push(`${p.url()} → ${error.message}`))
  context.pages().forEach(watch)
  context.on('page', watch)
  await context.addInitScript((auth) => {
    try {
      localStorage.setItem('admin_auth_v1', JSON.stringify(auth))
    } catch {
      /* ignore */
    }
  }, MOCK_ADMIN_AUTH)
  // http 构建里布局的 boot 鉴权会真的打 /auth/me；不 stub 就一路 clearAuth → 跳 /login。
  await context.route('**/auth/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { userId: MOCK_ADMIN_AUTH.user.id, role: 'admin', orgId: null } }),
    }),
  )
  // 侧栏角标会拉告警；与大屏无关，给空列表。
  await context.route('**/admin/alerts*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) }),
  )
}

export function uncaughtPageErrors(page: Page): string[] {
  return pageErrors.get(page.context()) ?? []
}

export function envelope(data: unknown): Reply {
  return { status: 200, body: { success: true, data } }
}

export function failure(status: number, code: string, message: string): Reply {
  return { status, body: { success: false, error: { code, message } } }
}

/** 拦下全部大屏请求，记下 URL 与请求头，再交给 responder 回话。 */
export async function serve(page: Page, responder: Responder): Promise<CallLog> {
  const context = page.context()
  await prepareContext(context)
  const calls: ScreenCall[] = []
  await context.route(SCREEN_API, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    calls.push({ url: url.pathname + url.search, method: request.method(), headers: request.headers() })
    const reply = await responder(url)
    if (reply === 'abort') {
      await route.abort()
      return
    }
    await route.fulfill({ status: reply.status, contentType: 'application/json', body: JSON.stringify(reply.body) })
  })
  return {
    calls,
    get urls() {
      return calls.map((call) => call.url)
    },
  }
}

export interface AdminData {
  gov?: () => unknown
  ops?: () => unknown
  usage?: (range: string) => unknown
  twin?: (id: string) => unknown
}

/**
 * 按真实服务端的口径回话：DTO 是白名单 + forbidNonWhitelisted，多带任何一个参数
 * （含 ?t= 这种缓存穿透）都是 400；profile 只认 gov|ops，range 只认 today|7d|30d；
 * 终端孪生不带 query，终端不存在给 404。桩比服务端松，就测不出前端多发了参数。
 */
export function adminApi(data: AdminData = {}): Responder {
  const reject = () => failure(400, 'VALIDATION_FAILED', 'property should not exist')
  return (url) => {
    const at = url.pathname.indexOf('/admin/screen')
    const path = url.pathname.slice(at + '/admin/screen'.length)
    const keys = [...url.searchParams.keys()]
    if (path === '/snapshot') {
      const profile = url.searchParams.get('profile')
      if (keys.length !== 1 || (profile !== 'gov' && profile !== 'ops')) return reject()
      return envelope(profile === 'gov' ? (data.gov ?? govFull)() : (data.ops ?? opsFull)())
    }
    if (path === '/usage') {
      const range = url.searchParams.get('range')
      if (keys.length !== 1 || !isUsageRange(range)) return reject()
      return envelope((data.usage ?? usageSnapshot)(range))
    }
    const twin = /^\/terminals\/([^/]+)$/.exec(path)
    if (twin) {
      if (keys.length !== 0) return reject()
      const body = (data.twin ?? terminalTwin)(decodeURIComponent(twin[1]))
      return body ? envelope(body) : failure(404, 'NOT_FOUND', '终端不存在')
    }
    return failure(404, 'NOT_FOUND', '没有这个大屏接口')
  }
}

export async function serveHappy(page: Page): Promise<CallLog> {
  return serve(page, adminApi())
}

export async function open(page: Page, path: string): Promise<void> {
  await prepareContext(page.context())
  await page.goto(path, { waitUntil: 'domcontentloaded' })
  await expect(page.getByText('正在验证身份…')).toHaveCount(0, { timeout: 15_000 })
}

/** 地址断言：路径与查询参数都要逐项相等，多一个少一个都算错。 */
export async function expectLocation(page: Page, pathname: string, query: Record<string, string> = {}, timeout?: number): Promise<void> {
  await expect
    .poll(() => {
      const url = new URL(page.url())
      return { pathname: url.pathname, query: Object.fromEntries(url.searchParams) }
    }, { timeout })
    .toEqual({ pathname, query })
}

/** 等一段时间再看地址没动：用来证明 401 之类的状态不会自己跳走。 */
export async function expectUrlStays(page: Page, ms = 1200): Promise<void> {
  const before = page.url()
  await page.waitForTimeout(ms)
  expect(page.url(), '地址不该自己变').toBe(before)
}

export function panel(page: Page, title: string | RegExp): Locator {
  return page.locator('.twin-panel').filter({ has: page.locator('.twin-ph-t', { hasText: title }) })
}

export function tile(scope: Locator, label: string): Locator {
  return scope.locator('.twin-tile').filter({ has: scope.page().locator(':scope > span', { hasText: label }) })
}

/**
 * 屏上「指标数值槽」里带数字的文本。
 *
 * 只看承载读数的槽位（主数、分项、条形数值、流程节点、图例计数、场景牌子、告警行），
 * 不看横幅、脚注、面板副标题 —— 那些是口径文案，「近 24 小时」「少于 5」里的数字是对的，
 * 把它们算成读数会让断言变成噪音，也证明不了要证明的那件事。
 */
export async function visibleDigits(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const root = document.querySelector('[data-ops-screen]')
    if (!root) return ['<no-screen-root>']
    const slots = [
      ...root.querySelectorAll(
        '.twin-big, .twin-kv b, .twin-tile b, .twin-bar-row > b, .twin-flow-node b, .twin-stat b, .twin-step b, '
          + '.twin-rank li > b, .twin-lg, .twin-overlay, .tw3-lbl .c, .twin-alert, .twin-rows dd, '
          + '.ops-n, .ops-mv, .ops-bv, .ops-v, .ops-tm',
      ),
    ] as HTMLElement[]
    return slots
      .filter((el) => el.getClientRects().length > 0 && /\d/.test((el.textContent ?? '').trim()))
      .map((el) => (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40))
  })
}

/** 打开每块面板的「i」读口径说明，读完关上。每块都必须说得出数从哪来。 */
export async function panelSources(page: Page): Promise<Array<{ title: string; source: string }>> {
  const buttons = page.locator('.twin-panel button.twin-info')
  const count = await buttons.count()
  const out: Array<{ title: string; source: string }> = []
  for (let i = 0; i < count; i += 1) {
    const button = buttons.nth(i)
    const title = ((await button.getAttribute('aria-label')) ?? '').replace(/的口径说明$/, '')
    const popId = await button.getAttribute('aria-controls')
    await button.click()
    const pop = page.locator(`[id="${popId}"]`)
    await expect(pop).toBeVisible()
    out.push({ title, source: (await pop.innerText()).trim() })
    await button.click()
    await expect(pop).toHaveCount(0)
  }
  return out
}
