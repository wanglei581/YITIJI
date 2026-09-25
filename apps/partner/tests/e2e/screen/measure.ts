import type { Locator, Page } from '@playwright/test'
import { expect } from '@playwright/test'

/**
 * 大屏的「量」：几何、文字、字号、场景牌子。只读页面，不碰网络。
 *
 * 管理员端与机构端各存一份，两份逐字一致（apps/admin|partner/tests/e2e/screen/measure.ts），
 * 不跨应用 import：两套用例各自构建、各自跑，互不牵连。改一边要同步另一边。
 */

/**
 * 场景里的按钮（区名牌 / 点位牌）在自己中心点上是否真的点得到：返回点不到的那些，以及挡住它的元素。
 * 3D 牌子是透明的广告牌盒子（260×抬高），盒子本身若接收指针事件，就会把别的牌子整块盖住 ——
 * 肉眼看得见、点下去却没反应。
 */
export async function blockedSceneButtons(page: Page, selector = 'button.tw3-district-btn'): Promise<string[]> {
  return page.evaluate((sel) => {
    const out: string[] = []
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect()
      const x = (r.left + r.right) / 2
      const y = (r.top + r.bottom) / 2
      const hit = document.elementFromPoint(x, y)
      if (hit && (hit === el || el.contains(hit))) continue
      const blocker = hit ? `${hit.tagName.toLowerCase()}.${String(hit.className).trim().replace(/\s+/g, '.')}「${(hit.textContent ?? '').trim().slice(0, 16)}」` : '（视口外）'
      out.push(`${el.getAttribute('aria-label')} ← 被 ${blocker} 挡住`)
    }
    return out
  }, selector)
}

/**
 * 用键盘把焦点放到目标上：先按一次 Tab 进入键盘操作模式，再把焦点移过去。
 * :focus-visible（焦点环）只在键盘操作下成立，鼠标点出来的焦点不算，所以这里不用 click。
 * 返回此刻是否显示焦点环、以及描边的样式与宽度。
 */
export async function keyboardFocus(page: Page, target: Locator): Promise<{ focusVisible: boolean; outlineStyle: string; outlineWidth: number }> {
  await expect(target).toBeVisible()
  await page.keyboard.press('Tab')
  await target.focus()
  return target.evaluate((el) => {
    const style = getComputedStyle(el)
    return { focusVisible: el.matches(':focus-visible'), outlineStyle: style.outlineStyle, outlineWidth: Number.parseFloat(style.outlineWidth) }
  })
}

export interface LabelReport {
  /** 实际看得见（有效不透明度 ≥ 0.5、没被场景框裁光）的牌子文字。 */
  labels: string[]
  overlaps: string[]
  /** 露出来了、但有一截被场景框或视口裁掉的牌子。 */
  clipped: string[]
}

/**
 * 场景牌子（.tw3-lbl .c）两两不重叠。
 *
 * 「看得见」按有效不透明度算（沿祖先链相乘）：聚焦某区后别区的牌子退成 8% 的背景，
 * 版式本就不为它们避让，把它们算进来是量错了对象。牌子矩形先按场景框（overflow:hidden）
 * 与视口裁剪，只比真正露出来的部分。
 */
export async function sceneLabels(page: Page): Promise<LabelReport> {
  return page.evaluate(() => {
    const opacityOf = (el: Element) => {
      let opacity = 1
      for (let node: Element | null = el; node; node = node.parentElement) {
        const style = getComputedStyle(node)
        if (style.display === 'none' || style.visibility === 'hidden') return 0
        opacity *= Number(style.opacity)
      }
      return opacity
    }
    const shown: Array<{ text: string; l: number; t: number; r: number; b: number }> = []
    const clipped: string[] = []
    for (const el of document.querySelectorAll('.tw3-lbl .c')) {
      if (opacityOf(el) < 0.5) continue
      const rect = el.getBoundingClientRect()
      const box = el.closest('.tw3-box')
      const clip = box ? box.getBoundingClientRect() : new DOMRect(0, 0, window.innerWidth, window.innerHeight)
      const l = Math.max(rect.left, clip.left, 0)
      const t = Math.max(rect.top, clip.top, 0)
      const r = Math.min(rect.right, clip.right, window.innerWidth)
      const b = Math.min(rect.bottom, clip.bottom, window.innerHeight)
      if (r - l < 1 || b - t < 1) continue
      const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ')
      if (l - rect.left > 1 || rect.right - r > 1 || t - rect.top > 1 || rect.bottom - b > 1) clipped.push(text)
      shown.push({ text, l, t, r, b })
    }
    const overlaps: string[] = []
    for (let i = 0; i < shown.length; i += 1) {
      for (let j = i + 1; j < shown.length; j += 1) {
        const a = shown[i]
        const c = shown[j]
        const w = Math.min(a.r, c.r) - Math.max(a.l, c.l)
        const h = Math.min(a.b, c.b) - Math.max(a.t, c.t)
        if (w > 1 && h > 1) overlaps.push(`「${a.text}」×「${c.text}」(${w.toFixed(0)}×${h.toFixed(0)})`)
      }
    }
    return { labels: shown.map((item) => item.text), overlaps, clipped }
  })
}

export interface GeometryReport {
  scroll: { w: number; h: number; clientW: number; clientH: number }
  /** 展示档舞台的缩放；桌面档为 null。 */
  stageScale: number | null
  root: { x: number; y: number; w: number; h: number } | null
  panels: string[]
  cards: number
  outsideViewport: string[]
  /** 舞台档：块位里的内容超出块位自己的矩形（定高块位被撑高 / 撑宽）。桌面档块位随内容长高，恒为空。 */
  slotOverflow: string[]
  overlaps: string[]
  nested: string[]
  textEscapes: string[]
  textCut: string[]
  squeezed: string[]
  cardChildOverlaps: string[]
  sourceless: string[]
  tinyText: string[]
  hues: string[]
}

/**
 * 几何与可读性，一次量完：
 *   - 面板 / 卡片 / 块位落在视口里（展示档）、同类两两不重叠、不嵌套；
 *   - 面板里每一段文字（按文本节点量，含 SVG 文字）露出来的部分都在面板矩形内；
 *   - 文字被 overflow 祖先裁掉、又没有省略号的，算「被裁切」（有省略号是刻意截断）；
 *   - 文字在自己的盒子里被压扁（内容高于盒子）；
 *   - 可见文字字号不低于下限（按文本节点的父元素量，混排的数字与单位都算）；
 *   - 卡片（运营看板）脚注非空、卡内子块不重叠；孪生面板必须有口径按钮；
 *   - 色彩种类（图例点 / 严重度 / 条形 / 点阵）。
 * 3D 场景里的牌子不在这里量，由 sceneLabels 单独量。
 */
export async function geometry(page: Page, floor: number): Promise<GeometryReport> {
  return page.evaluate((minFont) => {
    const root = document.querySelector('[data-ops-screen]') as HTMLElement | null
    const vw = window.innerWidth
    const vh = window.innerHeight
    const rendered = (el: Element) => {
      for (let node: Element | null = el; node; node = node.parentElement) {
        const style = getComputedStyle(node)
        if (style.display === 'none') return false
      }
      return getComputedStyle(el).visibility !== 'hidden' && el.getClientRects().length > 0
    }
    const name = (el: Element) => {
      const heading = el.querySelector('h1, h2, h3')?.textContent?.trim()
      return (heading || el.getAttribute('data-slot') || (el as HTMLElement).className || el.tagName).slice(0, 18)
    }
    const overlapOf = (a: DOMRect, b: DOMRect) => {
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left)
      const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
      return w > 1 && h > 1
    }

    const panels = [...document.querySelectorAll('.twin-panel')].filter(rendered) as HTMLElement[]
    const cards = [...document.querySelectorAll('.ops-card')].filter(rendered) as HTMLElement[]
    const slots = [...document.querySelectorAll('.twin-slot')].filter(rendered) as HTMLElement[]

    const slotOverflow: string[] = []
    if (root?.getAttribute('data-ops-screen') === 'wall') {
      for (const slot of slots) {
        const s = slot.getBoundingClientRect()
        let bottom = s.bottom
        let right = s.right
        for (const child of slot.children) {
          const r = child.getBoundingClientRect()
          bottom = Math.max(bottom, r.bottom)
          right = Math.max(right, r.right)
        }
        const dy = Math.round(bottom - s.bottom)
        const dx = Math.round(right - s.right)
        if (dy > 1) slotOverflow.push(`${name(slot)} 下沿超出块位 ${dy}px`)
        if (dx > 1) slotOverflow.push(`${name(slot)} 右沿超出块位 ${dx}px`)
      }
    }

    const outsideViewport: string[] = []
    for (const el of [...panels, ...cards, ...slots]) {
      const r = el.getBoundingClientRect()
      if (r.left < -1 || r.top < -1 || r.right > vw + 1 || r.bottom > vh + 1) {
        outsideViewport.push(`${name(el)} [${r.left.toFixed(0)},${r.top.toFixed(0)} → ${r.right.toFixed(0)},${r.bottom.toFixed(0)}]`)
      }
    }

    const overlaps: string[] = []
    for (const group of [panels, cards, slots]) {
      for (let i = 0; i < group.length; i += 1) {
        for (let j = i + 1; j < group.length; j += 1) {
          if (overlapOf(group[i].getBoundingClientRect(), group[j].getBoundingClientRect())) {
            overlaps.push(`${name(group[i])} × ${name(group[j])}`)
          }
        }
      }
    }

    const nested = [
      ...document.querySelectorAll('.twin-panel .twin-panel, .ops-card .ops-card, .twin-panel .ops-card, .ops-card .twin-panel'),
    ].map((el) => name(el))

    const clipsOverflow = (el: Element) => {
      const style = getComputedStyle(el)
      return style.overflowX !== 'visible' || style.overflowY !== 'visible'
    }
    const textNodesOf = (scope: Element) => {
      const out: Text[] = []
      const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node as Text
        if (!(text.textContent ?? '').trim()) continue
        const parent = text.parentElement
        if (!parent || !rendered(parent)) continue
        out.push(text)
      }
      return out
    }
    const lineHeightOf = (el: Element) => {
      const style = getComputedStyle(el)
      const lh = Number.parseFloat(style.lineHeight)
      return Number.isFinite(lh) ? lh : Number.parseFloat(style.fontSize) * 1.2
    }
    /**
     * 文字真正占的那条带：横向是文字自己的矩形；纵向取「行高」与「字形框」里较小的一个、上下居中。
     * 直接用 Range 的矩形会把字体的上下留白（大号数字配 line-height:1 时每边多出好几像素）
     * 当成文字，量出一堆看不见的「裁切」；按行高量，才是版式真正给这行字的位置。
     */
    const bandsOf = (text: Text) => {
      const range = document.createRange()
      range.selectNodeContents(text)
      const lh = lineHeightOf(text.parentElement as Element)
      return [...range.getClientRects()]
        .filter((r) => r.width > 0.5 && r.height > 0.5)
        .map((r) => {
          const h = Math.min(r.height, lh)
          const mid = (r.top + r.bottom) / 2
          return { l: r.left, r: r.right, t: mid - h / 2, b: mid + h / 2 }
        })
    }
    const snippet = (text: Text) => (text.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 14)

    // 文字露出部分必须在所属面板 / 卡片里
    const textEscapes: string[] = []
    for (const box of [...panels, ...cards]) {
      const pr = box.getBoundingClientRect()
      for (const text of textNodesOf(box)) {
        for (const band of bandsOf(text)) {
          let { l, t, r, b } = band
          for (let a = text.parentElement; a && a !== box; a = a.parentElement) {
            if (!clipsOverflow(a)) continue
            const c = a.getBoundingClientRect()
            l = Math.max(l, c.left)
            t = Math.max(t, c.top)
            r = Math.min(r, c.right)
            b = Math.min(b, c.bottom)
          }
          if (r - l < 0.5 || b - t < 0.5) continue
          if (l < pr.left - 1 || t < pr.top - 1 || r > pr.right + 1 || b > pr.bottom + 1) {
            textEscapes.push(`${name(box)}「${snippet(text)}」`)
          }
        }
      }
    }

    // 被裁切：文字带超出裁它的祖先。省略号（text-overflow:ellipsis）只豁免横向的刻意截断，纵向照样算。
    // 场景（.tw3-box）里的牌子由 sceneLabels 管。
    const textCut: string[] = []
    if (root) {
      for (const text of textNodesOf(root)) {
        if (text.parentElement?.closest('.tw3-box')) continue
        for (const band of bandsOf(text)) {
          for (let a: Element | null = text.parentElement; a; a = a === root ? null : a.parentElement) {
            if (!clipsOverflow(a)) continue
            const c = a.getBoundingClientRect()
            const ellipsis = getComputedStyle(a).textOverflow === 'ellipsis'
            const across = ellipsis ? 0 : Math.max(c.left - band.l, band.r - c.right)
            const down = Math.max(c.top - band.t, band.b - c.bottom)
            const cut = Math.max(across, down)
            if (cut > 1) {
              const owner = text.parentElement?.closest('.twin-panel, .ops-card')
              textCut.push(`${owner ? name(owner) : '面板外'}「${snippet(text)}」被 ${(a as HTMLElement).className || a.tagName} 裁掉 ${cut.toFixed(0)}px`)
              break
            }
          }
        }
      }
    }

    // 压扁：直接装着文字的块级元素，盒子矮于一行（flex 收缩到低于行高时，容器的 scrollHeight 量不出来；
    // 实测出过「标签盒高 9px、行高 21px」被拦腰切掉半行）。只看文字，不看 ::before 扩出去的点击热区。
    const squeezed: string[] = []
    if (root) {
      const seen = new Set<Element>()
      for (const text of textNodesOf(root)) {
        const el = text.parentElement as HTMLElement
        if (seen.has(el) || el.closest('.tw3-box')) continue
        seen.add(el)
        const display = getComputedStyle(el).display
        if (display === 'inline' || display === 'contents' || el.clientHeight === 0) continue
        const lh = lineHeightOf(el)
        if (el.clientHeight + 1 < lh) squeezed.push(`${el.className || el.tagName}「${snippet(text)}」盒高 ${el.clientHeight}px < 行高 ${lh.toFixed(0)}px`)
      }
    }

    // 运营看板卡片：卡内子块两两不重叠（移植自卡片栅格版几何门禁）
    const cardChildOverlaps: string[] = []
    for (const card of cards) {
      const kids = [...card.children].map((k) => k.getBoundingClientRect())
      for (let i = 0; i < kids.length; i += 1) {
        for (let j = i + 1; j < kids.length; j += 1) {
          if (overlapOf(kids[i], kids[j])) cardChildOverlaps.push(`${name(card)}:${i}/${j}`)
        }
      }
    }

    const sourceless = [
      ...panels.filter((p) => !p.querySelector(':scope > .twin-ph button.twin-info')).map((p) => name(p)),
      ...cards.filter((c) => !c.querySelector('.ops-foot')?.textContent?.trim()).map((c) => name(c)),
    ]

    const tiny = new Set<string>()
    if (root) {
      for (const text of textNodesOf(root)) {
        const size = Number.parseFloat(getComputedStyle(text.parentElement as Element).fontSize)
        if (size < minFont) tiny.add(`${size}px「${(text.textContent ?? '').trim().slice(0, 16)}」`)
      }
    }

    const hues = new Set<string>()
    for (const el of document.querySelectorAll('.twin-dot, .twin-sev, .twin-hbar > i, .ops-bar-f, .ops-d, .ops-dot, .ops-n, .ops-sev')) {
      if (!rendered(el)) continue
      const style = getComputedStyle(el)
      const color = style.backgroundColor && style.backgroundColor !== 'rgba(0, 0, 0, 0)' ? style.backgroundColor : style.color
      if (color && color !== 'rgba(0, 0, 0, 0)') hues.add(color)
    }

    const stage = document.querySelector('.ops-stage') as HTMLElement | null
    const scaleMatch = stage ? /scale\(([\d.]+)\)/.exec(stage.style.transform) : null
    const twin = document.querySelector('.twin') as HTMLElement | null
    const tr = twin?.getBoundingClientRect()
    return {
      scroll: {
        w: document.documentElement.scrollWidth,
        h: document.documentElement.scrollHeight,
        clientW: document.documentElement.clientWidth,
        clientH: document.documentElement.clientHeight,
      },
      stageScale: scaleMatch ? Number(scaleMatch[1]) : null,
      root: tr ? { x: tr.left, y: tr.top, w: tr.width, h: tr.height } : null,
      panels: panels.map((p) => name(p)),
      cards: cards.length,
      outsideViewport,
      slotOverflow,
      overlaps,
      nested,
      textEscapes,
      textCut,
      squeezed,
      cardChildOverlaps,
      sourceless,
      tinyText: [...tiny],
      hues: [...hues],
    }
  }, floor)
}

export interface HostingOffAudit {
  /** 可见文字里带「未开启」的（边界句里没有这三个字）。 */
  offText: string[]
  /** 边界句在屏上出现的次数：每屏只许一次；没有政策内容的屏（终端孪生）为零。 */
  boundary: number
  /** 只有说明、没有读数的面板 / 卡片：未接入块、空态块，或正文里一个数字、一个「少于 5」都没有。 */
  noticeOnly: string[]
  /** 岗位类字眼出现在边界句与豁免句之外的可见文字里（面板标题、磁贴、图例、场景牌子……）。 */
  recruitmentWords: string[]
}

/**
 * 招聘内容托管关闭（托管 a）时的一屏体检。
 * boundary 是边界句全文；exempt 里的片段所在的文字不算岗位类字眼（例如机构待审里那一句存量说明、
 * 运营看板里专门盘点存量的那块卡片标题）。methodology 是「本页数字怎么来的」一类口径面板的标题，
 * 它们本来就只写说明，不参加「只剩说明」这一条。
 */
export async function hostingOffAudit(
  page: Page,
  boundary: string,
  exempt: readonly string[] = [],
  methodology: readonly string[] = [],
): Promise<HostingOffAudit> {
  return page.evaluate(
    ({ sentence, skip, notes }) => {
      const root = document.querySelector('.twin') as HTMLElement | null
      if (!root) return { offText: ['<no-twin-root>'], boundary: 0, noticeOnly: [], recruitmentWords: [] }
      const rendered = (el: Element) => {
        for (let node: Element | null = el; node; node = node.parentElement) {
          if (getComputedStyle(node).display === 'none') return false
        }
        return getComputedStyle(el).visibility !== 'hidden' && el.getClientRects().length > 0
      }
      const texts: Array<{ text: string; el: Element }> = []
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = (node.textContent ?? '').trim()
        const el = node.parentElement
        if (!text || !el || !rendered(el)) continue
        texts.push({ text, el })
      }
      const offText = texts.filter((t) => t.text.includes('未开启')).map((t) => t.text.slice(0, 40))
      const boundaryCount = root.innerText.split(sentence).length - 1

      const WORDS = ['岗位', '招聘会', '企业资料', '企业展示', '参展企业', '同步']
      const ownerTitle = (el: Element) =>
        el.closest('.twin-panel, .ops-card')?.querySelector('.twin-ph-t, h2')?.textContent?.trim() ?? ''
      // 一句话常被拆成几个文字节点（数字另起一个），按所在元素的整句判断边界句与豁免句
      const whole = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ')
      const recruitmentWords = texts
        .filter((t) => !whole(t.el).includes(sentence) && !skip.some((s) => whole(t.el).includes(s) || ownerTitle(t.el).includes(s)))
        .filter((t) => WORDS.some((w) => t.text.includes(w)))
        .map((t) => `${ownerTitle(t.el) || '面板外'}「${t.text.slice(0, 30)}」`)

      const noticeOnly: string[] = []
      for (const box of [...root.querySelectorAll('.twin-panel, .ops-card')].filter(rendered)) {
        const title = box.querySelector('.twin-ph-t, h2')?.textContent?.trim() ?? box.className
        if (notes.includes(title)) continue
        if (box.querySelector('.twin-na, .ops-na')) {
          noticeOnly.push(`${title}（未接入 / 未开启说明块）`)
          continue
        }
        const body = [...box.children]
          .filter((child) => !child.matches('.twin-ph, h2, .ops-foot, .twin-pop'))
          .map((child) => (child instanceof HTMLElement ? child.innerText : child.textContent) ?? '')
          .join(' ')
        // 「近 24 小时」「近 7 天」这类窗口说明里的数字不是读数（「近 24 小时没有同步批次」照样算只剩说明）
        const reading = body.replace(/近\s*\d+\s*(小时|天|日)/g, '')
        if (!/\d/.test(reading) && !reading.includes('少于 5')) noticeOnly.push(`${title}（正文没有读数）`)
      }
      return { offText, boundary: boundaryCount, noticeOnly, recruitmentWords }
    },
    { sentence: boundary, skip: [...exempt], notes: [...methodology] },
  )
}
