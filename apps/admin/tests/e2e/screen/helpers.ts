import type { Page, Route } from '@playwright/test'
import { expect } from '@playwright/test'

export const MOCK_ADMIN_AUTH = {
  token: 'mock-token',
  user: { id: 'mock-admin-001', name: '系统管理员（预览）', role: 'admin' as const, orgId: null },
}

const SNAPSHOT_GLOB = '**/admin/screen/snapshot*'

export interface RouteLog {
  urls: string[]
}

export async function injectAuth(page: Page): Promise<void> {
  await page.addInitScript((auth) => {
    try {
      localStorage.setItem('admin_auth_v1', JSON.stringify(auth))
    } catch {
      /* ignore */
    }
  }, MOCK_ADMIN_AUTH)
  // 大屏用例跑的是 http 构建，布局的 boot 鉴权会**真的**打 /auth/me。
  // 不 stub 它就会一路 clearAuth → 跳 /login，所有状态用例都测不到自己要测的东西。
  await page.route('**/auth/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: { userId: MOCK_ADMIN_AUTH.user.id, role: 'admin', orgId: null },
      }),
    })
  })
  // 侧栏角标会拉告警；与大屏无关，给个空列表免得打真实后端。
  await page.route('**/admin/alerts*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: [] }),
    })
  })
}

/** 拦快照端点并记录实际请求 URL —— 参数越界与缓存穿透都能在这里抓到。 */
export async function serve(
  page: Page,
  handler: (url: URL, route: Route) => Promise<void> | void,
): Promise<RouteLog> {
  const log: RouteLog = { urls: [] }
  await page.route(SNAPSHOT_GLOB, async (route) => {
    const url = new URL(route.request().url())
    log.urls.push(url.pathname + url.search)
    await handler(url, route)
  })
  return log
}

export async function serveJson(page: Page, body: unknown): Promise<RouteLog> {
  return serve(page, async (_url, route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: body }),
    })
  })
}

export async function serveByProfile(
  page: Page,
  bodies: Record<string, unknown>,
): Promise<RouteLog> {
  return serve(page, async (url, route) => {
    const profile = url.searchParams.get('profile') ?? 'gov'
    const body = bodies[profile]
    if (!body) {
      await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ success: false, error: { code: 'VALIDATION_FAILED', message: '参数不合法' } }) })
      return
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: body }) })
  })
}

export async function serveStatus(
  page: Page,
  status: number,
  error: { code: string; message: string },
): Promise<RouteLog> {
  return serve(page, async (_url, route) => {
    await route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify({ success: false, error }),
    })
  })
}

export async function open(page: Page, path: string): Promise<void> {
  await injectAuth(page)
  await page.goto(path, { waitUntil: 'domcontentloaded' })
  await expect(page.getByText('正在验证身份…')).toHaveCount(0, { timeout: 15_000 })
}

/**
 * 屏上「指标数值槽」里出现的文本。
 *
 * 只看真正承载读数的槽位（KPI 主数、分项数、条形数值、机队分类数），
 * 不看横幅与脚注 —— 那些是口径文案，里面出现「不会用 0 顶替」这种字样
 * 是对的，把它算成读数会让断言变成噪音，也证明不了要证明的那件事。
 */
export async function visibleDigits(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const root = document.querySelector('[data-ops-screen]')
    if (!root) return ['<no-screen-root>']
    const slots = [...root.querySelectorAll('.ops-n, .ops-mv, .ops-bv, .ops-v, .ops-tm')] as HTMLElement[]
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
  cards: number
  footless: string[]
  nestedCards: number
  clipped: Array<{ card: string; by: number; dh: number; dw: number }>
  overlaps: string[]
  tinyText: string[]
  hues: string[]
}

/**
 * 移植自 docs/design/ops-screen-2026-09/probe.mjs 的四项检查，另加三项：
 * 卡中卡、色彩多样性、以及 desk/wall 各自的字号下限。
 */
export async function geometry(page: Page, minFont: number): Promise<GeometryReport> {
  return page.evaluate((floor) => {
    const root = document.querySelector('[data-ops-screen]') as HTMLElement | null
    const cards = [...document.querySelectorAll('.ops-card')] as HTMLElement[]
    const clipped: Array<{ card: string; by: number }> = []
    const overlaps: string[] = []
    for (const card of cards) {
      const title = card.querySelector('h2')?.textContent?.trim().slice(0, 14) ?? '(无标题)'
      // 只查 .ops-card / .ops-body 会漏掉平面块内部的裁剪（分项格、告警行、
      // 未接入块都是自己 overflow:hidden 的），实测漏过一次，是看截图才发现的。
      const boxes = [
        card,
        ...card.querySelectorAll(
          '.ops-body, .ops-list, .ops-bars, .ops-fleet, .ops-dots, .ops-mini, .ops-gap-list,'
            + ' .ops-m, .ops-li, .ops-na, .ops-gap-row, .ops-bar-r, .ops-kpi',
        ),
      ] as HTMLElement[]
      for (const el of boxes) {
        const dh = el.scrollHeight - el.clientHeight
        const dw = el.scrollWidth - el.clientWidth
        const by = Math.max(dh, dw)
        // 报清是横向还是纵向：上一版只报一个数字，害我按纵向找了两轮余量，方向是错的。
        if (by > 1) clipped.push({ card: `${title}/${el.className || el.tagName}`, by, dh, dw })
      }
      // scrollHeight 有个盲点：flex 容器 justify-content:center 时内容向**上下两侧**
      // 溢出，而 scrollHeight 只量 padding box 下方那一半，于是「标签被拦腰切掉」
      // 这种最刺眼的问题门禁全绿。实测在信息归集分项格上漏过一次，是看截图发现的。
      // 补上原型 probe.mjs 的那一条：任何后代元素的矩形超出卡片矩形即判裁切。
      // 容器溢出查不出「文字被压在自己盒子里」：flex item 被 shrink 到低于行高时，
      // 容器 scrollHeight 仍等于 clientHeight。实测在信息归集分项格上漏过一次
      // （标签盒高 9px，行高 21px，截图上就是被拦腰切掉半行），是看截图发现的。
      // 所以这里直接量叶子自己：内容比自己的盒子高就是被压扁了。
      for (const el of [...card.querySelectorAll('*')] as HTMLElement[]) {
        if (el.children.length > 0) continue
        const text = (el.textContent ?? '').trim()
        if (!text) continue
        const squeeze = el.scrollHeight - el.clientHeight
        if (squeeze > 1) {
          clipped.push({
            card: `${title}/文字被压扁 ${el.className || el.tagName}「${text.slice(0, 10)}」`,
            by: squeeze,
            dh: squeeze,
            dw: 0,
          })
        }
      }
      const kids = [...card.children].map((k) => ({ k, r: k.getBoundingClientRect() }))
      for (let i = 0; i < kids.length; i++) {
        for (let j = i + 1; j < kids.length; j++) {
          const a = kids[i].r
          const b = kids[j].r
          const vertical = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
          const horizontal = Math.min(a.right, b.right) - Math.max(a.left, b.left)
          if (vertical > 1 && horizontal > 1) overlaps.push(`${title}:${i}/${j}`)
        }
      }
    }
    const tiny = new Set<string>()
    if (root) {
      for (const el of [...root.querySelectorAll('*')] as HTMLElement[]) {
        if (el.children.length > 0) continue
        const text = (el.textContent ?? '').trim()
        if (!text) continue
        const style = getComputedStyle(el)
        if (style.visibility === 'hidden' || style.display === 'none') continue
        const size = Number.parseFloat(style.fontSize)
        if (size < floor) tiny.add(`${style.fontSize} | ${text.slice(0, 22)}`)
      }
    }
    const hues = new Set<string>()
    for (const el of [...document.querySelectorAll('.ops-bar-f, .ops-d, .ops-dot, .ops-n, .ops-sev')] as HTMLElement[]) {
      const style = getComputedStyle(el)
      const color = style.backgroundColor && style.backgroundColor !== 'rgba(0, 0, 0, 0)'
        ? style.backgroundColor
        : style.color
      if (color) hues.add(color)
    }
    return {
      scrollW: document.documentElement.scrollWidth,
      scrollH: document.documentElement.scrollHeight,
      clientW: document.documentElement.clientWidth,
      clientH: document.documentElement.clientHeight,
      cards: cards.length,
      footless: cards
        .filter((card) => !card.querySelector('.ops-foot')?.textContent?.trim())
        .map((card) => card.querySelector('h2')?.textContent?.trim() ?? '(无标题)'),
      nestedCards: document.querySelectorAll('.ops-card .ops-card').length,
      clipped,
      overlaps,
      tinyText: [...tiny],
      hues: [...hues],
    }
  }, minFont)
}
