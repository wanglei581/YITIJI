import type { Page, Route } from '@playwright/test'
import { expect } from '@playwright/test'
import { partnerFull, partnerTwin, partnerUsage } from './fixtures/snapshots'

export const MOCK_PARTNER_AUTH = {
  token: 'mock-token',
  user: { id: 'mock-partner-001', name: '测试机构账号（预览）', role: 'partner' as const, orgId: 'org-mock-001' },
}

const SCREEN_GLOB = '**/partner/screen/**'

export interface RouteLog {
  urls: string[]
}

type Reply = { status: number; body: unknown } | 'abort'

export async function injectAuth(page: Page): Promise<void> {
  await page.addInitScript((auth) => {
    try {
      localStorage.setItem('partner_auth_v1', JSON.stringify(auth))
    } catch {
      /* ignore */
    }
  }, MOCK_PARTNER_AUTH)
  await page.route('**/auth/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: { userId: MOCK_PARTNER_AUTH.user.id, role: 'partner', orgId: 'org-mock-001' },
      }),
    })
  })
  await page.route('**/partner/data-sources/capabilities', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        canManageSmartCampus: true,
        canManageJobs: true,
        canManageFairs: true,
        canManagePolicies: true,
      }),
    })
  })
}

/** 机构响应是裸对象，不套信封。 */
export async function serve(
  page: Page,
  handler: (url: URL, route: Route) => Promise<Reply | void> | Reply | void,
): Promise<RouteLog> {
  const log: RouteLog = { urls: [] }
  await page.route(SCREEN_GLOB, async (route) => {
    const url = new URL(route.request().url())
    log.urls.push(url.pathname + url.search)
    const reply = await handler(url, route)
    if (reply === undefined) return
    if (reply === 'abort') {
      await route.abort()
      return
    }
    await route.fulfill({
      status: reply.status,
      contentType: 'application/json',
      body: JSON.stringify(reply.body),
    })
  })
  return log
}

export async function serveJson(page: Page, body: unknown): Promise<RouteLog> {
  return serve(page, (url) => {
    if (url.pathname.endsWith('/usage')) return { status: 200, body: partnerUsage(url.searchParams.get('range') ?? 'today') }
    const twin = url.pathname.match(/\/terminals\/([^/]+)$/)
    if (twin) return { status: 200, body: partnerTwin(decodeURIComponent(twin[1])) }
    if (url.pathname.endsWith('/snapshot')) return { status: 200, body }
    return { status: 404, body: { success: false, error: { code: 'NOT_FOUND', message: '没有这个大屏接口' } } }
  })
}

export async function serveHappy(page: Page): Promise<RouteLog> {
  return serveJson(page, partnerFull())
}

export async function serveStatus(
  page: Page,
  status: number,
  error: { code: string; message: string },
): Promise<RouteLog> {
  return serve(page, () => ({ status, body: { success: false, error } }))
}

export async function open(page: Page, path: string): Promise<void> {
  await injectAuth(page)
  await page.goto(path, { waitUntil: 'domcontentloaded' })
  await expect(page.getByText('正在验证身份…')).toHaveCount(0, { timeout: 15_000 })
}

export async function visibleDigits(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const root = document.querySelector('[data-ops-screen]')
    if (!root) return ['<no-screen-root>']
    const slots = [
      ...root.querySelectorAll('.twin-big, .twin-kv b, .twin-tile b, .twin-bar-row b, .twin-flow-node b, .ops-n, .ops-mv, .ops-bv, .ops-v'),
    ] as HTMLElement[]
    return slots
      .filter((el) => el.offsetParent !== null && /\d/.test((el.textContent ?? '').trim()))
      .map((el) => (el.textContent ?? '').trim().slice(0, 40))
  })
}

export interface GeometryReport {
  scrollW: number
  scrollH: number
  clientW: number
  clientH: number
  panels: string[]
  outsideViewport: string[]
  panelOverlaps: string[]
  childOverflow: string[]
  footless: string[]
  nested: number
  tinyText: string[]
  labelOverlaps: string[]
}

export async function geometry(page: Page, minFont: number, inViewport = false): Promise<GeometryReport> {
  return page.evaluate(({ floor, inViewport: mustFit }) => {
    const overlaps = (a: DOMRect, b: DOMRect) => {
      const vertical = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
      const horizontal = Math.min(a.right, b.right) - Math.max(a.left, b.left)
      return vertical > 1 && horizontal > 1
    }
    const laidOut = (el: HTMLElement) => {
      const style = getComputedStyle(el)
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false
      const rect = el.getBoundingClientRect()
      return rect.width >= 2 && rect.height >= 2
    }
    const inView = (rect: DOMRect) =>
      rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth
    const panels = ([...document.querySelectorAll('.twin-panel, .ops-card')] as HTMLElement[]).filter(laidOut)
    const outsideViewport: string[] = []
    const panelOverlaps: string[] = []
    const childOverflow: string[] = []
    const named = panels.map((panel) => {
      const title = panel.querySelector('h1, h2, h3')?.textContent?.trim().slice(0, 18) ?? '(无标题)'
      const rect = panel.getBoundingClientRect()
      if (mustFit && (rect.left < -1 || rect.top < -1 || rect.right > window.innerWidth + 1 || rect.bottom > window.innerHeight + 1)) {
        outsideViewport.push(title)
      }
      for (const child of [...panel.children] as HTMLElement[]) {
        const childRect = child.getBoundingClientRect()
        if (childRect.width < 1 || childRect.height < 1) continue
        const sticks =
          childRect.left < rect.left - 1
          || childRect.top < rect.top - 1
          || childRect.right > rect.right + 1
          || childRect.bottom > rect.bottom + 1
        if (sticks) childOverflow.push(`${title}/${child.className || child.tagName}「${(child.textContent ?? '').trim().slice(0, 16)}」`)
      }
      return { title, rect }
    })
    for (let i = 0; i < named.length; i++) {
      for (let j = i + 1; j < named.length; j++) {
        if (overlaps(named[i].rect, named[j].rect)) panelOverlaps.push(`${named[i].title} × ${named[j].title}`)
      }
    }
    const root = document.querySelector('[data-ops-screen]') as HTMLElement | null
    const tiny = new Set<string>()
    if (root) {
      for (const el of [...root.querySelectorAll('*')] as HTMLElement[]) {
        if (el.children.length > 0) continue
        const text = (el.textContent ?? '').trim()
        if (!text || !laidOut(el)) continue
        const size = Number.parseFloat(getComputedStyle(el).fontSize)
        if (size < floor) tiny.add(`${size}px | ${text.slice(0, 22)}`)
      }
    }
    const labels = ([...document.querySelectorAll('.tw3-lbl .c')] as HTMLElement[]).filter((el) => laidOut(el) && inView(el.getBoundingClientRect()))
    const labelOverlaps: string[] = []
    for (let i = 0; i < labels.length; i++) {
      for (let j = i + 1; j < labels.length; j++) {
        if (overlaps(labels[i].getBoundingClientRect(), labels[j].getBoundingClientRect())) {
          labelOverlaps.push(`${(labels[i].textContent ?? '').trim().slice(0, 12)} × ${(labels[j].textContent ?? '').trim().slice(0, 12)}`)
        }
      }
    }
    return {
      scrollW: document.documentElement.scrollWidth,
      scrollH: document.documentElement.scrollHeight,
      clientW: document.documentElement.clientWidth,
      clientH: document.documentElement.clientHeight,
      panels: named.map((item) => item.title),
      outsideViewport,
      panelOverlaps,
      childOverflow,
      footless: panels
        .filter((panel) => !panel.querySelector('button.twin-info'))
        .map((panel) => panel.querySelector('h1, h2, h3')?.textContent?.trim() ?? '(无标题)'),
      nested: document.querySelectorAll('.twin-panel .twin-panel').length,
      tinyText: [...tiny],
      labelOverlaps,
    }
  }, { floor: minFont, inViewport })
}

/** 点一块点位牌。返回点位名。strict 时只点指定点位，用来退出聚焦。 */
export async function clickPlace(page: Page, preferred?: string, strict = false): Promise<string> {
  const buttons = page.locator('button.tw3-district-btn')
  await expect(buttons.first(), '机构场景应当有可点击的点位牌').toBeVisible()
  const picked = await buttons.evaluateAll((els, args) => {
    const ranked = els
      .map((el, i) => ({ el, i, label: el.getAttribute('aria-label') ?? '' }))
      .filter((item) => !args.strict || item.label.startsWith(args.pref))
    ranked.sort((a, b) => Number(!a.label.startsWith(args.pref)) - Number(!b.label.startsWith(args.pref)))
    for (const item of ranked) {
      const rect = item.el.getBoundingClientRect()
      if (rect.width < 8 || rect.height < 8) continue
      if (rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) continue
      for (let y = 1; y < rect.height; y += 3) {
        for (let x = 1; x < rect.width; x += 4) {
          const hit = document.elementFromPoint(rect.left + x, rect.top + y)
          if (hit && (hit === item.el || item.el.contains(hit))) {
            return { i: item.i, x, y, name: item.label.split('，')[0], blocker: '' }
          }
        }
      }
    }
    const sample = ranked[0]?.el
    const rect = sample?.getBoundingClientRect()
    const hit = rect ? document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) : null
    return { i: -1, x: 0, y: 0, name: '', blocker: `${hit?.className || hit?.tagName || 'none'}` }
  }, { pref: preferred ?? '', strict })
  expect(picked.i, `点位牌被挡住，点不到（中心命中 ${picked.blocker}）`).toBeGreaterThanOrEqual(0)
  await buttons.nth(picked.i).click({ position: { x: picked.x, y: picked.y } })
  return picked.name
}
