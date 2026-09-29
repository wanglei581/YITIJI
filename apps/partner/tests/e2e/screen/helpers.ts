import type { BrowserContext, Locator, Page } from '@playwright/test'
import { expect } from '@playwright/test'
import { isUsageRange, partnerFull, partnerTwin, partnerUsage } from './fixtures/snapshots'

/**
 * 合作机构数据大屏 E2E 的公共件。
 *
 * 网络层全部挂在 **context** 上而不是 page 上：「新窗口展示」开出的展示窗口是同一 context
 * 里的新 page，挂 context 才能让两扇窗看到同一份夹具、同一本请求账。
 * 几何与文字的量法与管理员端（apps/admin/tests/e2e/screen/helpers.ts）逐字一致，两端各存一份，
 * 不跨应用 import。
 */

export const MOCK_PARTNER_ORG_ID = 'org-mock-001'

export const MOCK_PARTNER_AUTH = {
  token: 'mock-token',
  user: { id: 'mock-partner-001', name: '测试机构账号（预览）', role: 'partner' as const, orgId: MOCK_PARTNER_ORG_ID },
}

const SCREEN_API = '**/api/v1/partner/screen/**'

export type Reply = { status: number; body: unknown } | 'abort'
export type Responder = (url: URL) => Reply | Promise<Reply>

export interface ScreenCall {
  /** pathname + search，例 /api/v1/partner/screen/snapshot */
  url: string
  method: string
  headers: Record<string, string>
  postData: string | null
}

export interface CallLog {
  calls: ScreenCall[]
  readonly urls: string[]
}

const prepared = new WeakSet<BrowserContext>()
const pageErrors = new WeakMap<BrowserContext, string[]>()

/**
 * 跨平台字体归一（只在测试里）。
 *
 * 大屏数字用 Bahnschrift（Windows）/ DIN Alternate（macOS），正文与标题的中文字体是雅黑 / 苹方 / 宋体；
 * CI 的 Linux runner 一个都没有，拉丁字母与数字会回退到 DejaVu 一类的宽字体，定高块位里的
 * 一行数字就可能折行、把面板撑出块位 —— 那量的是 CI 的字体，不是产品。
 * 这里给样式表里排在最前的几个字体名挂上「本机与 CI 都有、彼此度量兼容」的替身
 * （Arial ≡ Liberation Sans，Times New Roman ≡ Liberation Serif），且只接管拉丁字母、数字与标点；
 * 汉字照旧落到各平台自己的中文字体（中文一字一格，宽度不随字体变）。
 * 于是本机与 CI 量到的是同一套宽度，几何断言在两边说的是同一件事。与管理员端同一份。
 */
const LATIN = 'U+0000-02FF, U+2000-206F, U+20A0-20CF, U+2100-214F, U+2190-21FF'
const SANS_REGULAR = "local('Arial'), local('ArialMT'), local('Liberation Sans'), local('LiberationSans')"
const SANS_BOLD = "local('Arial Bold'), local('Arial-BoldMT'), local('Liberation Sans Bold'), local('LiberationSans-Bold')"
const SERIF_REGULAR = "local('Times New Roman'), local('TimesNewRomanPSMT'), local('Liberation Serif'), local('LiberationSerif')"
const SERIF_BOLD = "local('Times New Roman Bold'), local('TimesNewRomanPS-BoldMT'), local('Liberation Serif Bold'), local('LiberationSerif-Bold')"
export const FONT_NORMALIZE_CSS = [
  ['Bahnschrift', SANS_REGULAR, SANS_BOLD, ''],
  ['Noto Sans SC', SANS_REGULAR, SANS_BOLD, `unicode-range: ${LATIN};`],
  ['Noto Serif SC', SERIF_REGULAR, SERIF_BOLD, `unicode-range: ${LATIN};`],
]
  .map(([family, regular, bold, range]) =>
    `@font-face { font-family: '${family}'; font-weight: 100 500; src: ${regular}; ${range} }\n`
    + `@font-face { font-family: '${family}'; font-weight: 600 900; src: ${bold}; ${range} }`)
  .join('\n')

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
      localStorage.setItem('partner_auth_v1', JSON.stringify(auth))
    } catch {
      /* ignore */
    }
  }, MOCK_PARTNER_AUTH)
  await context.addInitScript((css) => {
    const inject = () => {
      if (document.getElementById('e2e-font-normalize')) return
      const style = document.createElement('style')
      style.id = 'e2e-font-normalize'
      style.textContent = css
      ;(document.head ?? document.documentElement).appendChild(style)
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inject)
    else inject()
  }, FONT_NORMALIZE_CSS)
  // http 构建里布局的 boot 鉴权会真的打 /auth/me；不 stub 就一路 clearAuth → 跳 /login。
  await context.route('**/auth/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { userId: MOCK_PARTNER_AUTH.user.id, role: 'partner', orgId: MOCK_PARTNER_ORG_ID } }),
    }),
  )
  // 侧栏按机构能力投影导航，能力接口同样是真发的。
  await context.route('**/partner/data-sources/capabilities', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ canManageSmartCampus: true, canManageJobs: true, canManageFairs: true, canManagePolicies: true }),
    }),
  )
}

export function uncaughtPageErrors(page: Page): string[] {
  return pageErrors.get(page.context()) ?? []
}

/** 机构端控制器返回裸对象，不套 { success, data } 信封。 */
export function bare(body: unknown): Reply {
  return { status: 200, body }
}

export function failure(status: number, code: string, message: string): Reply {
  return { status, body: { success: false, error: { code, message } } }
}

/** 拦下全部机构大屏请求，记下 URL、请求头与请求体，再交给 responder 回话。 */
export async function serve(page: Page, responder: Responder): Promise<CallLog> {
  const context = page.context()
  await prepareContext(context)
  const calls: ScreenCall[] = []
  await context.route(SCREEN_API, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    calls.push({ url: url.pathname + url.search, method: request.method(), headers: request.headers(), postData: request.postData() })
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

export interface PartnerData {
  snapshot?: () => unknown
  usage?: (range: string) => unknown
  twin?: (id: string) => unknown
}

/**
 * 按真实服务端的口径回话：快照 DTO 是空白名单 + forbidNonWhitelisted，带任何 query
 * （?orgId= 更是跨机构风险面）都是 400；信息使用只认 range=today|7d|30d；
 * 终端孪生不带 query，别家终端与不存在同样 404。桩比服务端松，就测不出前端多发了参数。
 */
export function partnerApi(data: PartnerData = {}): Responder {
  const reject = () => failure(400, 'VALIDATION_FAILED', 'property should not exist')
  return (url) => {
    const at = url.pathname.indexOf('/partner/screen')
    const path = url.pathname.slice(at + '/partner/screen'.length)
    const keys = [...url.searchParams.keys()]
    if (path === '/snapshot') {
      if (keys.length !== 0) return reject()
      return bare((data.snapshot ?? partnerFull)())
    }
    if (path === '/usage') {
      const range = url.searchParams.get('range')
      if (keys.length !== 1 || !isUsageRange(range)) return reject()
      return bare((data.usage ?? partnerUsage)(range))
    }
    const twin = /^\/terminals\/([^/]+)$/.exec(path)
    if (twin) {
      if (keys.length !== 0) return reject()
      const body = (data.twin ?? partnerTwin)(decodeURIComponent(twin[1]))
      return body ? bare(body) : failure(404, 'NOT_FOUND', '终端不存在')
    }
    return failure(404, 'NOT_FOUND', '没有这个大屏接口')
  }
}

export async function serveHappy(page: Page): Promise<CallLog> {
  return serve(page, partnerApi())
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
