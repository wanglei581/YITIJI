/**
 * 授权收尾拦截屏与暂停服务屏的版面走查（1080×1920）：用真实内容排满一屏，不靠把卡片拉高。
 *
 *   · 拦截屏自上而下：剩余时间状态卡、「现在可以做的」三行去处、「在手机上也能看」小程序卡（小程序已发布才出现）、
 *     服务电话卡、机器插画；底栏是标准的「返回」「回首页」；
 *   · 暂停屏自上而下：说明卡（含服务电话）、小程序卡（已发布才出现）、机器插画；整屏没有任何能点的入口；
 *   · 小程序已发布与否来自 GET /public/support-contact 的 miniappPublished，夹具里按用例切（boot 的 miniappPublished 选项）。
 *
 * 版面判据：fixtures/blank-run.ts 的老办法（整屏截图里最长的连续纯色空白）；另外量插画有没有被拉变形、文字有没有被裁、
 * 底栏有没有压住内容、内容是不是一屏放得下（不用滚）。每张都存 1080×1920 截图，设 LICENSE_SHOTS_DIR 时另存一份到那个目录。
 * 与 kiosk-license-gate.spec.ts 同一套正式构建 + 假服务端 + 页面时钟，用 playwright.privacy-clear.config.ts 跑。
 */
import { mkdirSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures/kiosk-test'
import { MACHINE_UNUSABLE_LINE } from '../fixtures/unattended-lines'
import { longestBlankRun } from './fixtures/blank-run'
import {
  boot, goInApp, markDocument, MINUTE, paused, PHONE_SENTENCE, reachPaused, settleAfterPause, startWindDown, windDownBlocked,
} from './fixtures/license-gate-kit'

test.describe.configure({ timeout: 120_000 })

/** 小程序已发布时，「在手机上也能看」卡里写的话（名字取小程序展示名「职易达」）。 */
const MINIAPP_LINE = '打开职易达小程序「我的」，记录都在。'
/** 拦截屏、暂停屏每块在 .of-page 里的名字，按画面从上到下。 */
type Block = 'time' | 'exits-heading' | 'exits' | 'miniapp' | 'contact' | 'machine'

interface Layout {
  viewportW: number
  viewportH: number
  blocks: Block[]
  tops: number[]
  contentBottom: number
  dockTop: number | null
  svg: {
    w: number
    h: number
    preserve: string | null
    cropPx: number
    cardH: number
    /** 画出来的机身（.pi-body）的宽高比，与它在原图里的比例（rect 的 width / height 属性）。 */
    bodyRatio: number
    bodyRatioInArt: number
    drawingW: number
    drawingH: number
    /** 机器画面上沿 / 下沿到插画卡上沿 / 下沿的距离（卡里没画东西的纯色带）。 */
    topBand: number
    bottomBand: number
  } | null
  clipped: string[]
  scrolls: string[]
  clickables: number
}

/** 在页面里量一遍：块的顺序与位置、插画比例与裁切、被裁的文字、需要滚动的容器、能点的东西个数。 */
async function measure(page: Page, selector: string): Promise<Layout> {
  return page.evaluate((rootSelector) => {
    const root = document.querySelector(rootSelector)!
    const pageEl = root.querySelector('.of-page')!
    const kids = [...pageEl.children]
    const label = (element: Element): Block | string => {
      if (element.classList.contains('of-machine')) return 'machine'
      if (element.tagName === 'H2') return 'exits-heading'
      if (element.classList.contains('of-actions')) return 'exits'
      if (element.classList.contains('k9s-cap')) {
        const text = element.textContent ?? ''
        if (text.includes('分钟后暂停使用')) return 'time'
        if (text.includes('在手机上也能看')) return 'miniapp'
        return 'contact'
      }
      return `other:${element.tagName}.${String(element.className)}`
    }
    const rects = kids.map((element) => element.getBoundingClientRect())
    const dock = root.querySelector('.qxt-dock')
    const machine = root.querySelector('.of-machine')
    const svg = machine?.querySelector('svg') as SVGSVGElement | null | undefined
    const artbox = machine?.querySelector('.qxp-artbox')
    let svgInfo: Layout['svg'] = null
    if (machine && svg && artbox) {
      const sr = svg.getBoundingClientRect()
      const br = artbox.getBoundingClientRect()
      const cardRect = machine.getBoundingClientRect()
      // svg 元素的盒子不等于画出来的机器：preserveAspectRatio 默认是 meet，盒子比机器宽或高时，机器按比例缩小居中。
      // 量变形要量画出来的形状（机身、盖板、底座），不能量 svg 盒子。
      const body = svg.querySelector('.pi-body')!.getBoundingClientRect()
      const lid = svg.querySelector('.pi-lid')!.getBoundingClientRect()
      const base = svg.querySelector('.pi-base')!.getBoundingClientRect()
      const bodyEl = svg.querySelector('.pi-body')!
      svgInfo = {
        w: Math.round(sr.width), h: Math.round(sr.height),
        preserve: svg.getAttribute('preserveAspectRatio'),
        cropPx: Math.round(Math.max(0, br.left - sr.left) + Math.max(0, sr.right - br.right)),
        cardH: Math.round(cardRect.height),
        bodyRatio: body.width / body.height,
        bodyRatioInArt: Number(bodyEl.getAttribute('width')) / Number(bodyEl.getAttribute('height')),
        drawingW: Math.round(Math.max(lid.right, body.right, base.right) - Math.min(lid.left, body.left, base.left)),
        drawingH: Math.round(base.bottom - lid.top),
        topBand: Math.round(lid.top - cardRect.top),
        bottomBand: Math.round(cardRect.bottom - base.bottom),
      }
    }
    // 文字被裁：每个文本节点的每个行框，不能落到视口外，也不能落到「裁切 / 滚动」祖先的盒子外。
    const clipped: string[] = []
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = (node.textContent ?? '').trim()
      const owner = node.parentElement
      if (!text || !owner || owner.closest('svg')) continue
      const range = document.createRange()
      range.selectNodeContents(node)
      for (const rect of range.getClientRects()) {
        if (rect.width === 0 || rect.height === 0) continue
        if (rect.left < -0.5 || rect.right > window.innerWidth + 0.5 || rect.top < -0.5 || rect.bottom > window.innerHeight + 0.5) clipped.push(`${text.slice(0, 14)}（出了视口）`)
        for (let ancestor: Element | null = owner; ancestor && ancestor !== root.parentElement; ancestor = ancestor.parentElement) {
          const style = getComputedStyle(ancestor)
          if (style.overflowX === 'visible' && style.overflowY === 'visible') continue
          const box = ancestor.getBoundingClientRect()
          if (rect.left < box.left - 0.5 || rect.right > box.right + 0.5 || rect.top < box.top - 0.5 || rect.bottom > box.bottom + 0.5) {
            clipped.push(`${text.slice(0, 14)}（被 ${ancestor.tagName.toLowerCase()}.${String(ancestor.className).split(' ')[0]} 裁）`)
          }
        }
      }
    }
    const scrolls = [...root.querySelectorAll('*')]
      .filter((element) => ['auto', 'scroll'].includes(getComputedStyle(element).overflowY) && element.scrollHeight > element.clientHeight + 1)
      .map((element) => `${element.tagName.toLowerCase()}.${String(element.className).split(' ')[0]}（${element.scrollHeight}>${element.clientHeight}）`)
    const clickable = [...root.querySelectorAll('button, a[href], [role="button"]')].filter((element) => {
      const box = element.getBoundingClientRect()
      return box.width > 0 && box.height > 0 && !element.closest('[inert]')
    })
    return {
      viewportW: window.innerWidth,
      viewportH: window.innerHeight,
      blocks: kids.map(label) as Block[],
      tops: rects.map((rect) => Math.round(rect.top)),
      contentBottom: Math.max(...rects.map((rect) => rect.bottom)),
      dockTop: dock ? dock.getBoundingClientRect().top : null,
      svg: svgInfo,
      clipped,
      scrolls,
      clickables: clickable.length,
    }
  }, selector)
}

/** 把 1080×1920 截图存到用例输出目录；设了 LICENSE_SHOTS_DIR 就另存一份到那里。 */
async function saveShot(page: Page, name: string, outputPath: (file: string) => string): Promise<{ png: Buffer; path: string }> {
  const path = outputPath(`${name}.png`)
  const png = await page.screenshot({ path })
  const dir = process.env.LICENSE_SHOTS_DIR
  if (dir) {
    mkdirSync(dir, { recursive: true })
    await page.screenshot({ path: `${dir}/${name}.png` })
  }
  return { png, path: dir ? `${dir}/${name}.png` : path }
}

const CASES = [
  { screen: 'blocked' as const, published: true },
  { screen: 'blocked' as const, published: false },
  { screen: 'paused' as const, published: true },
  { screen: 'paused' as const, published: false },
]

for (const { screen, published } of CASES) {
  const label = screen === 'blocked' ? '收尾拦截屏' : '暂停服务屏'
  const publishedLabel = published ? '小程序已发布' : '小程序未发布'
  test(`${label}（${publishedLabel}）：1080×1920 排满一屏，插画不变形、文字不被裁、底栏不压内容 @license-gate`, async ({ page, api }, testInfo) => {
    const world = await boot(page, api, { miniappPublished: published })
    let root
    let selector: string
    if (screen === 'blocked') {
      selector = '[data-kiosk-screen="license-wind-down-blocked"]'
      await startWindDown(world)
      await goInApp(page, '/resume/source')
      root = windDownBlocked(page)
    } else {
      selector = '[data-kiosk-screen="license-paused"]'
      world.lapse(10 * MINUTE)
      await world.advance(3.5 * MINUTE)
      await world.advance(5 * MINUTE)
      await markDocument(page)
      await reachPaused(world, page)
      // 进暂停时的清场会整页重载：量的是重载之后、机器资料读回来之后的样子。
      await settleAfterPause(page, { requireReload: true })
      root = paused(page)
    }
    await expect(root).toBeVisible()
    // 服务电话与小程序标志一起从机器资料里读回来：号码出现了，小程序那块才有定论。
    await expect(root).toContainText(PHONE_SENTENCE)
    const miniapp = root.locator('.k9s-cap').filter({ hasText: '在手机上也能看' })
    await expect(miniapp, `${publishedLabel}时「在手机上也能看」卡${published ? '要有' : '不能有'}`).toHaveCount(published ? 1 : 0)
    if (published) await expect(miniapp).toContainText(MINIAPP_LINE)
    // 说明与号码只说一遍（标准句 3：原因 + 服务电话）。
    expect(((await root.innerText()).match(/这台机器暂时不能用/g) ?? []).length).toBe(1)
    await expect(root.getByRole('status').filter({ hasText: MACHINE_UNUSABLE_LINE }), '说明卡是状态卡，整句写在上面').toHaveCount(1)

    const layout = await measure(page, selector)
    const shot = await saveShot(page, `r8-${screen}-${published ? 'miniapp' : 'no-miniapp'}-1080x1920`, (file) => testInfo.outputPath(file))
    const blank = longestBlankRun(shot.png)
    const expectedBlocks: Block[] = screen === 'blocked'
      ? ['time', 'exits-heading', 'exits', ...(published ? ['miniapp' as const] : []), 'contact', 'machine']
      : ['contact', ...(published ? ['miniapp' as const] : []), 'machine']
    const summary = `${label}（${publishedLabel}）1080×1920：最长连续纯色空白 ${blank.px}px（起点 y=${blank.atY}）；`
      + `块 ${layout.blocks.join('>')}（上沿 ${layout.tops.join('/')}）；内容底边 y=${Math.round(layout.contentBottom)}，底栏顶边 ${layout.dockTop === null ? '无' : `y=${Math.round(layout.dockTop)}`}；`
      + `插画 ${layout.svg ? `机器画面 ${layout.svg.drawingW}×${layout.svg.drawingH}px（机身宽高比 ${layout.svg.bodyRatio.toFixed(3)}，原图 ${layout.svg.bodyRatioInArt.toFixed(3)}），svg 盒子 ${layout.svg.w}×${layout.svg.h}px、左右裁掉 ${layout.svg.cropPx}px，所在卡高 ${layout.svg.cardH}px，画面上下各留 ${layout.svg.topBand}/${layout.svg.bottomBand}px` : '无'}；`
      + `被裁文字 ${layout.clipped.length} 处，要滚动的容器 ${layout.scrolls.length} 个，能点的 ${layout.clickables} 个；截图 ${shot.path}`
    console.log(`\n  [版面] ${summary}`)
    testInfo.annotations.push({ type: '版面', description: summary })

    expect(layout.viewportW, '按 1080×1920 量').toBe(1080)
    expect(layout.viewportH, '按 1080×1920 量').toBe(1920)
    expect(layout.blocks, '各块的先后顺序').toEqual(expectedBlocks)
    expect([...layout.tops].sort((left, right) => left - right), '块要按顺序从上往下摆').toEqual(layout.tops)
    // 插画：画出来的机器按原图比例（不拉变形）、没被左右裁掉，卡够高，卡里上下没画东西的纯色带不超过三分之一屏。
    expect(layout.svg, '要有机器插画').not.toBeNull()
    expect(layout.svg!.preserve, '插画不能用 preserveAspectRatio=none').not.toBe('none')
    expect(Math.abs(layout.svg!.bodyRatio / layout.svg!.bodyRatioInArt - 1), '画出来的机身宽高比与原图的偏差').toBeLessThanOrEqual(0.02)
    expect(layout.svg!.cropPx, '插画左右被裁掉的宽度').toBeLessThanOrEqual(2)
    expect(layout.svg!.cardH, '插画卡的高度').toBeGreaterThanOrEqual(160)
    expect(layout.svg!.topBand, '机器画面上方的纯色带').toBeLessThanOrEqual(layout.viewportH / 3)
    expect(layout.svg!.bottomBand, '机器画面下方的纯色带').toBeLessThanOrEqual(layout.viewportH / 3)
    // 文字、滚动、底栏。
    expect(layout.clipped, '文字不被裁').toEqual([])
    expect(layout.scrolls, '内容一屏放得下，不用滚').toEqual([])
    expect(layout.contentBottom, '内容底边不压到底栏').toBeLessThanOrEqual((layout.dockTop ?? layout.viewportH) + 0.5)
    // 老办法量空白：不超过三分之一屏。
    expect(blank.px, `整屏最长连续纯色空白 ${blank.px}px（起点 y=${blank.atY}）`).toBeLessThanOrEqual(layout.viewportH / 3)
    if (screen === 'paused') {
      // 暂停屏整屏没有任何能点的入口。
      expect(layout.clickables, '暂停屏上不能有能点的东西').toBe(0)
      await expect(page.locator('button:visible, a[href]:visible')).toHaveCount(0)
    } else {
      // 拦截屏：去处三行 + 底栏两个按钮，没有别的能点的东西。
      expect(layout.clickables, '拦截屏上能点的：三行去处 + 底栏两个按钮').toBe(5)
      await expect(root.getByRole('status')).toHaveCount(2)
      await expect(root.getByRole('status').first()).toContainText('分钟后暂停使用')
      await expect(root.getByRole('status').nth(1)).toContainText(PHONE_SENTENCE)
    }
  })
}
