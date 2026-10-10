import { expect, type Locator, type Page } from '@playwright/test'

export async function assertNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    body: document.body.scrollWidth - document.body.clientWidth,
    root: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }))
  expect(overflow, '页面不得产生横向溢出').toEqual({ body: 0, root: 0 })
}

/** fusion-w6 同款：任何元素的 left/right 不得越过视口（被横向滚动容器裁掉的除外）。 */
export async function assertNoElementCrossesViewport(page: Page): Promise<void> {
  const overflowingElements = await page.locator('body *').evaluateAll((elements) => {
    const viewportWidth = document.documentElement.clientWidth
    return elements.flatMap((element) => {
      const rect = element.getBoundingClientRect()
      if (rect.right <= viewportWidth + 0.5 && rect.left >= -0.5) return []

      let clippedByHorizontalScroller = false
      for (let ancestor = element.parentElement; ancestor && ancestor !== document.body; ancestor = ancestor.parentElement) {
        const overflowX = window.getComputedStyle(ancestor).overflowX
        if (!['auto', 'scroll'].includes(overflowX) || ancestor.scrollWidth <= ancestor.clientWidth + 0.5) continue
        const ancestorRect = ancestor.getBoundingClientRect()
        const ancestorInsideViewport = ancestorRect.left >= -0.5 && ancestorRect.right <= viewportWidth + 0.5
        if (ancestorInsideViewport && (rect.left < ancestorRect.left || rect.right > ancestorRect.right)) {
          clippedByHorizontalScroller = true
          break
        }
      }
      if (clippedByHorizontalScroller) return []

      const name = `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}${element.className ? `.${String(element.className).trim().replaceAll(' ', '.')}` : ''}`
      return [`${name} left=${rect.left.toFixed(1)} right=${rect.right.toFixed(1)}`]
    }).slice(0, 12)
  })
  expect(overflowingElements, '不得包含越过视口边界的元素').toEqual([])
}

/**
 * 舞台开启时读 `.kiosk-stage` 的 scale。关闭或不存在时返回 1。
 * 屏上像素要折回设计像素时用它做除数；手机流式布局不能再除一次。
 */
export async function readEnabledStageScale(page: Page): Promise<number> {
  const stage = page.locator('[data-kiosk-stage-fit="on"] .kiosk-stage')
  if ((await stage.count()) === 0) return 1
  return stage.first().evaluate((element) => {
    const transform = getComputedStyle(element).transform
    if (!transform || transform === 'none') return 1
    const match = /^matrix\(([^,]+)/.exec(transform)
    const value = match ? Number(match[1]) : 1
    return Number.isFinite(value) && value > 0 ? value : 1
  })
}

/** 量 bounding box，并用 elementFromPoint 确认 ≥48px 区域内真能命中该控件。 */
export async function assertTapTargetPointerHit(locator: Locator): Promise<void> {
  const box = await locator.boundingBox()
  expect(box, '可点目标必须有包围盒').not.toBeNull()
  if (!box) return
  expect(box.width, '可点区宽度 ≥48px').toBeGreaterThanOrEqual(48)
  expect(box.height, '可点区高度 ≥48px').toBeGreaterThanOrEqual(48)

  const page = locator.page()
  const handle = await locator.elementHandle()
  expect(handle, '可点目标必须能拿到 DOM 句柄').not.toBeNull()
  const insetX = Math.min(8, box.width / 2)
  const insetY = Math.min(8, box.height / 2)
  const samples = [
    { x: box.x + insetX, y: box.y + insetY },
    { x: box.x + box.width - insetX, y: box.y + box.height - insetY },
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
  ]
  for (const point of samples) {
    const hit = await page.evaluate(({ x, y, target }) => {
      const top = document.elementFromPoint(x, y)
      return Boolean(top && (target === top || target.contains(top) || top.contains(target)))
    }, { x: point.x, y: point.y, target: handle })
    expect(hit, `PointerEvent at ${point.x.toFixed(1)},${point.y.toFixed(1)} 必须落在该控件上`).toBe(true)
  }
}

/**
 * 青序顶栏状态胶囊的可读性，量真实排版：不被裁、最多两行、每行至少两个字；
 * 带「 · 」分隔的标签只许在分隔处折行，不把短语拆开（「扫描件已交接 · 待确 / 认」那种）。
 * 行按每个字的纵向中心归并：同一行里混排的字体上沿可能差一两像素，按 top 取整会把一行误拆成两行。
 */
export async function assertQxPillReadable(page: Page, where: string): Promise<void> {
  const pill = page.locator('.qx-pill')
  await expect(pill).toBeVisible()
  const { text, lines, clipped } = await pill.evaluate((el) => {
    const node = Array.from(el.childNodes).reverse().find((child) => child.nodeType === Node.TEXT_NODE && child.textContent?.trim())
    const content = node?.textContent ?? ''
    const rows: Array<{ mid: number; text: string }> = []
    for (let index = 0; node && index < content.length; index += 1) {
      if (!content[index].trim()) continue
      const range = document.createRange()
      range.setStart(node, index)
      range.setEnd(node, index + 1)
      const rect = range.getBoundingClientRect()
      const mid = rect.top + rect.height / 2
      const row = rows.find((item) => Math.abs(item.mid - mid) < rect.height / 2)
      if (row) row.text += content[index]
      else rows.push({ mid, text: content[index] })
    }
    return {
      text: content.trim(),
      lines: rows.sort((a, b) => a.mid - b.mid).map((row) => row.text),
      clipped: el.scrollWidth > el.clientWidth + 1 || el.getBoundingClientRect().right > window.innerWidth + 0.5,
    }
  })
  const detail = `${where} 顶栏胶囊「${text}」→ ${lines.join(' / ')}`
  expect(clipped, detail).toBe(false)
  expect(lines.length, detail).toBeGreaterThan(0)
  expect(lines.length, detail).toBeLessThanOrEqual(2)
  expect(Math.min(...lines.map((line) => line.length)), `${detail}：有一行只剩一个字`).toBeGreaterThanOrEqual(2)
  if (text.includes(' · ')) {
    const compact = (value: string) => value.replace(/\s/g, '')
    for (const phrase of text.split('·').map((part) => compact(part)).filter(Boolean)) {
      expect(lines.some((line) => compact(line).includes(phrase)), `${detail}：「${phrase}」被拆到两行`).toBe(true)
    }
  }
}

export async function assertKioskShellFillsViewport(page: Page): Promise<void> {
  const dimensions = await page.locator('.ui-kiosk-shell').evaluate((shell) => {
    const rect = shell.getBoundingClientRect()
    return {
      left: Math.round(rect.left),
      top: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    }
  })
  expect(dimensions, 'Kiosk 外层壳必须完整覆盖当前视口').toEqual({
    left: 0,
    top: 0,
    width: dimensions.viewportWidth,
    height: dimensions.viewportHeight,
    viewportWidth: dimensions.viewportWidth,
    viewportHeight: dimensions.viewportHeight,
  })
}

export async function assertDialogWithinViewport(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog')
  const bounds = await dialog.boundingBox()
  const viewport = page.viewportSize()
  expect(bounds, '筛选弹层必须可见').not.toBeNull()
  expect(viewport, 'Playwright 项目必须配置固定视口').not.toBeNull()
  if (!bounds || !viewport) return
  expect(bounds.x).toBeGreaterThanOrEqual(0)
  expect(bounds.y).toBeGreaterThanOrEqual(0)
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width)
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height)
}

/** 与 audit-qingxu-v2-drafts.mjs 的 BLANK_PROBE 逐行同口径：截图像素，y 60–1900。 */
export async function readPixelBlankBands(page: Page) {
  await page.evaluate(() => document.fonts.ready)
  const shot = await page.screenshot({ scale: 'css' })
  return page.evaluate(async ({ b64, top, bottom }) => {
    const img = new Image()
    img.src = `data:image/png;base64,${b64}`
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = img.width
    canvas.height = img.height
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(img, 0, 0)
    const { data, width, height } = ctx.getImageData(0, 0, img.width, img.height)
    const half = width >> 1
    const left = new Uint8Array(height)
    const right = new Uint8Array(height)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4
        const lo = Math.min(data[i]!, data[i + 1]!, data[i + 2]!)
        const hi = Math.max(data[i]!, data[i + 1]!, data[i + 2]!)
        if (lo < 165 || (hi - lo > 45 && lo < 220)) {
          if (x < half) left[y] = 1
          else right[y] = 1
          if (left[y] && right[y]) break
        }
      }
    }
    const longest = (ink: (y: number) => number) => {
      let best: [number, number, number] = [0, 0, 0]
      let start = -1
      for (let y = top; y <= Math.min(bottom, height); y++) {
        const blank = y < Math.min(bottom, height) && !ink(y)
        if (blank && start < 0) start = y
        if (!blank && start >= 0) {
          if (y - start > best[0]) best = [y - start, start, y]
          start = -1
        }
      }
      return best
    }
    return {
      full: longest((y) => left[y]! || right[y]!),
      left: longest((y) => left[y]!),
      right: longest((y) => right[y]!),
    }
  }, { b64: shot.toString('base64'), top: 60, bottom: 1900 })
}

export async function assertNoLargeBlankBands(page: Page, label: string): Promise<void> {
  const bands = await readPixelBlankBands(page)
  expect(bands.full[0], `${label}：整行最长空白 < 160px`).toBeLessThan(160)
  expect(bands.left[0], `${label}：左半最长空白 < 240px`).toBeLessThan(240)
  expect(bands.right[0], `${label}：右半最长空白 < 240px`).toBeLessThan(240)
}
