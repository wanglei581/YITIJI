import type { Page } from '@playwright/test'

export type HeadingShot = { tag: string; text: string }
export type CtaShot = { text: string; variant: string; disabled: boolean }

export type DomShot = {
  landedPathname: string
  landedSearch: string
  headings: HeadingShot[]
  title: string
  mainActions: string[]
  topbarBack: string[]
  ctaSecondary: string[]
  ctaAll: CtaShot[]
  disabledButtons: string[]
  qxFrame: boolean
  v6Shell: boolean
  pageFrame: boolean
  w4Frame: boolean
}

/**
 * 在页面里跑。必须自包含，Playwright 会把它序列化进浏览器。
 *
 * 可见性故意不用 Playwright 的 isVisible：一次 evaluate 把 DOM 快照拿走，
 * 避免 108 条路由各自来回 RPC。sr-only 文案不进清单（清场提示曾被 innerText 捞出来）。
 */
function collectFromDom(): DomShot {
  const displayed = (el: Element): boolean => {
    const node = el as HTMLElement
    if (node.hidden) return false
    if (node.getAttribute('aria-hidden') === 'true') return false
    if (node.closest('[hidden], [aria-hidden="true"]')) return false
    const style = getComputedStyle(node)
    if (style.display === 'none' || style.visibility === 'hidden') return false
    if (Number(style.opacity) === 0) return false
    const className = typeof node.className === 'string' ? node.className : ''
    if (/(?:^|\s)sr-only(?:\s|$)/.test(className)) return false
    const rect = node.getBoundingClientRect()
    return rect.width >= 1 && rect.height >= 1
  }

  const visibleName = (el: Element): string => {
    const node = el as HTMLElement
    const labelledBy = node.getAttribute('aria-labelledby')
    if (labelledBy) {
      const fromIds = labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent?.replace(/\s+/g, ' ').trim() ?? '')
        .filter(Boolean)
        .join(' ')
      if (fromIds) return fromIds
    }
    const aria = node.getAttribute('aria-label')?.replace(/\s+/g, ' ').trim()
    if (aria) return aria
    const clone = node.cloneNode(true) as HTMLElement
    clone.querySelectorAll('.sr-only, [hidden], [aria-hidden="true"]').forEach((child) => child.remove())
    const text = clone.textContent?.replace(/\s+/g, ' ').trim() ?? ''
    if (text) return text
    const title = node.getAttribute('title')?.replace(/\s+/g, ' ').trim()
    if (title) return title
    if (node instanceof HTMLInputElement && node.value.trim()) return node.value.trim()
    return ''
  }

  const inChrome = (el: Element): boolean => Boolean(
    el.closest(
      [
        '.qx-topbar',
        '.qx-navbar',
        '.qx-nav-item',
        '.qx-topbar-back',
        '[aria-label="主导航"]',
        '.ui-kiosk-tabbar',
        '.ui-kiosk-bottom-nav',
        '.ui-kiosk-topbar',
      ].join(', '),
    ),
  )

  const headings = [...document.querySelectorAll('h1, h2')]
    .filter(displayed)
    .map((el) => ({
      tag: el.tagName.toLowerCase(),
      text: visibleName(el),
    }))
    .filter((item) => item.text.length > 0)

  const title = headings.find((item) => item.tag === 'h1')?.text
    ?? headings[0]?.text
    ?? ''

  const clickable = [...document.querySelectorAll('button, a[href], [role="button"], input[type="button"], input[type="submit"]')]
  const mainActions = clickable
    .filter((el) => displayed(el) && !inChrome(el))
    .filter((el) => {
      const node = el as HTMLButtonElement
      if (node.disabled) return false
      if (node.getAttribute('aria-disabled') === 'true') return false
      return true
    })
    .map(visibleName)
    .filter(Boolean)

  const topbarBack = [...document.querySelectorAll('.qx-topbar-back')]
    .filter(displayed)
    .map(visibleName)
    .filter(Boolean)

  const ctaNodes = [...document.querySelectorAll('.qx-ctabar button, .qx-ctabar a[href], .qx-ctabar [role="button"]')]
    .filter(displayed)
  const ctaAll = ctaNodes.map((el) => {
    const node = el as HTMLButtonElement
    return {
      text: visibleName(el),
      variant: node.getAttribute('data-variant') ?? '',
      disabled: Boolean(node.disabled) || node.getAttribute('aria-disabled') === 'true',
    }
  })
  const ctaSecondary = ctaAll
    .filter((item) => item.variant !== 'primary' && item.text)
    .map((item) => item.text)

  const disabledButtons = [...document.querySelectorAll('button[disabled]')]
    .filter(displayed)
    .map(visibleName)
    .filter(Boolean)

  return {
    landedPathname: window.location.pathname,
    landedSearch: window.location.search,
    headings,
    title,
    mainActions,
    topbarBack,
    ctaSecondary,
    ctaAll,
    disabledButtons,
    qxFrame: Boolean(document.querySelector('[data-qx-frame="true"]')),
    v6Shell: Boolean(document.querySelector('.v6-runtime-shell')),
    pageFrame: Boolean(document.querySelector('[data-kiosk-component="page-frame"]')),
    w4Frame: Boolean(document.querySelector('.w4-page-frame')),
  }
}

export async function collectPage(page: Page): Promise<DomShot> {
  return page.evaluate(collectFromDom)
}

export async function settleClientRedirects(page: Page): Promise<void> {
  let previous = page.url()
  for (let i = 0; i < 12; i += 1) {
    await page.waitForTimeout(160)
    const next = page.url()
    if (next === previous) break
    previous = next
  }
  await page.locator('body').waitFor({ state: 'attached', timeout: 5_000 }).catch(() => undefined)
  await page
    .locator('h1, h2, [data-qx-frame="true"], .v6-runtime-shell, [data-kiosk-component="page-frame"], [data-kiosk-screen], [data-w2-page]')
    .first()
    .waitFor({ state: 'attached', timeout: 8_000 })
    .catch(() => undefined)
}
