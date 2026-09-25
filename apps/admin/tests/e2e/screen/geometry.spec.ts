import { test, expect, type Locator, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DISTRICTS } from './fixtures/snapshots'
import { open, panel, serveHappy, uncaughtPageErrors } from './helpers'
import { geometry, sceneLabels, type GeometryReport } from './measure'

/**
 * 几何与可读性。
 *
 * 舞台档（1920×1080 项目里用 display=1 打开）：舞台 1:1、面板与块位全部落在视口里、同类不重叠、
 * 不嵌套、面板里的文字不出面板、不被裁、字号 ≥13px、不滚动。
 * 桌面档（1440×900 项目，再缩到 1100 宽）：不横向滚动、同样的文字与重叠检查、字号 ≥12px。
 * 城区牌子单独量：聚焦前、逐区聚焦后，看得见的牌子两两不重叠。
 *
 * 截图同时落盘，作为「1920×1080 适合领导展示，同时常规后台宽度可操作」的证据。
 */

const SHOT_DIR = join(process.cwd(), '..', '..', 'test-results', 'console-screen-shots')
mkdirSync(SHOT_DIR, { recursive: true })

interface GeometryCase {
  key: 'gov' | 'usage' | 'ops' | 'terminal'
  title: string
  panels: number
  cards: number
  /** 这一页画的是多状态的数据（图例 / 条形 / 严重度），色相少于 4 种就是单色屏。 */
  hues: boolean
  marker: (page: Page) => Locator
}

const CASES: GeometryCase[] = [
  { key: 'gov', title: '职易达 · 就业服务终端运行态势', panels: 7, cards: 0, hues: true, marker: (page) => panel(page, /^终端与服务$/) },
  { key: 'usage', title: '职易达 · 系统使用与服务调用态势', panels: 7, cards: 0, hues: false, marker: (page) => panel(page, /^下单渠道$/) },
  { key: 'ops', title: '终端运营看板', panels: 0, cards: 12, hues: true, marker: (page) => page.locator('.ops-card').first() },
  { key: 'terminal', title: '终端数字孪生', panels: 4, cards: 0, hues: false, marker: (page) => panel(page, /^设备概况$/) },
]

test.afterEach(async ({ page }) => {
  expect(uncaughtPageErrors(page), '页面不得有未捕获异常').toEqual([])
})

/**
 * 已上报的产品缺陷：展示档定高块位装不下面板内容（见「展示档每块面板都放得进自己的块位」那条 test.fail）。
 * 其中只有服务调用的「AI 服务」会长到压住下一块「岗位信息使用」：四格紧凑磁贴的数值（「2.18 秒」）
 * 在拉丁字母与数字按 Arial / Liberation 宽度排时折成两行，面板比 300px 块位高出 36px。
 * 只把这一对重叠从服务调用舞台档的通用检查里拿出来；修好后那条 test.fail 会意外通过而转红，届时连同这里一起删掉。
 */
const KNOWN_WALL_OVERLAP = 'AI 服务 × 岗位信息使用'

/** 两档共用的版面断言：不嵌套、不重叠、文字不出面板、不被裁、不被压扁、字号不低于下限、每块有口径。 */
function expectCleanLayout(report: GeometryReport, floor: number, where: string) {
  expect(report.nested, `${where}：面板 / 卡片不得嵌套`).toEqual([])
  expect(report.overlaps, `${where}：同类面板 / 卡片 / 块位不得重叠`).toEqual([])
  expect(report.textEscapes, `${where}：面板里的文字不得跑出面板`).toEqual([])
  expect(report.textCut, `${where}：文字不得被裁切（有省略号的刻意截断除外）`).toEqual([])
  expect(report.squeezed, `${where}：文字不得被压扁在自己的盒子里`).toEqual([])
  expect(report.cardChildOverlaps, `${where}：卡片内子块不得重叠`).toEqual([])
  expect(report.sourceless, `${where}：每块都必须带来源口径`).toEqual([])
  expect(report.tinyText, `${where}：可见文字不得小于 ${floor}px`).toEqual([])
  expect(report.scroll.w, `${where}：不得横向滚动`).toBeLessThanOrEqual(report.scroll.clientW)
}

async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  await page.waitForTimeout(300)
}

test.describe('admin screen geometry', () => {
  for (const c of CASES) {
    test(`${c.key}：几何、文字、字号与色彩`, async ({ page }, testInfo) => {
      const wall = testInfo.project.name.includes('wall')
      await serveHappy(page)
      await open(page, wall ? `/screen/${c.key}?display=1` : `/screen/${c.key}`)
      await expect(page.getByRole('heading', { name: c.title, exact: true })).toBeVisible()
      await expect(c.marker(page)).toBeVisible()
      await settle(page)

      const floor = wall ? 13 : 12
      const measured = await geometry(page, floor)
      const report = wall && c.key === 'usage' ? { ...measured, overlaps: measured.overlaps.filter((item) => item !== KNOWN_WALL_OVERLAP) } : measured
      expect(report.panels, '面板块数与版式一致').toHaveLength(c.panels)
      expect(report.cards, '运营看板卡片块数与契约指标数一致').toBe(c.cards)
      expectCleanLayout(report, floor, wall ? '舞台档 1920×1080' : '桌面档 1440')
      if (c.hues) expect(report.hues.length, `色彩需至少 4 种，实际 ${JSON.stringify(report.hues)}`).toBeGreaterThanOrEqual(4)
      if (c.key === 'usage') {
        // 服务调用 / 信息流向场景里立着的节点牌：看得见的两两不重叠（阳性对照：确实量到了牌子）
        const labels = await sceneLabels(page)
        expect(labels.labels.length).toBeGreaterThanOrEqual(5)
        expect(labels.overlaps, '场景节点牌不得互相压住').toEqual([])
      }

      if (wall) {
        expect(report.stageScale, '1920×1080 视口下舞台 1:1').toBe(1)
        expect(report.root).toEqual({ x: 0, y: 0, w: 1920, h: 1080 })
        expect(report.outsideViewport, '展示档面板与块位必须完全落在视口内').toEqual([])
        expect(report.scroll.h, '舞台档不得纵向滚动').toBeLessThanOrEqual(report.scroll.clientH)
      } else {
        expect(report.stageScale).toBeNull()
        await page.setViewportSize({ width: 1100, height: 900 })
        await settle(page)
        const narrow = await geometry(page, 12)
        expect(narrow.panels).toHaveLength(c.panels)
        expectCleanLayout(narrow, 12, '桌面档 1100')
      }

      const shot = join(SHOT_DIR, `admin-${c.key}-${testInfo.project.name}.png`)
      await page.screenshot({ path: shot, fullPage: !wall, animations: 'disabled' })
      await testInfo.attach(`admin-${c.key}-${testInfo.project.name}`, { path: shot, contentType: 'image/png' })
    })
  }

  test('展示档每块面板都放得进自己的块位（四个页签）', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 })
    await serveHappy(page)
    const overflow: string[] = []
    for (const c of CASES) {
      await open(page, `/screen/${c.key}?display=1`)
      await expect(c.marker(page)).toBeVisible()
      await settle(page)
      const report = await geometry(page, 13)
      expect(report.stageScale, '舞台 1:1 才量得准块位').toBe(1)
      overflow.push(...report.slotOverflow.map((item) => `${c.key}：${item}`))
    }
    // 产品缺陷（已上报，未修）：1920×1080 舞台的块位是定高的，面板内容比块位高时面板直接长出块位
    // （实测：打印量趋势 +7px、实时调用脉冲 +13px、AI 服务 +36px；多数被 16px 的栏间距吃掉，AI 服务压到了下一块）。
    // 前置断言照常把关；全部修好后本条会「意外通过」而转红，届时删掉这一行与上面的 KNOWN_WALL_OVERLAP。
    test.fail(true, '展示档定高块位装不下面板内容（packages/ui twin-screen-layout.css 定高块位 + 面板不收缩）')
    expect(overflow).toEqual([])
  })

  test('城区牌子：聚焦前、逐区聚焦后，看得见的牌子两两不重叠', async ({ page }, testInfo) => {
    const wall = testInfo.project.name.includes('wall')
    const display = wall ? '&display=1' : ''
    await serveHappy(page)
    await open(page, wall ? '/screen/gov?display=1' : '/screen/gov')
    await expect(page.locator('button.tw3-district-btn')).toHaveCount(DISTRICTS.length)
    await settle(page)
    const before = await sceneLabels(page)
    // 阳性对照：七块区名牌都量到了，「不重叠」才不是空集合上的真
    for (const { area, count } of DISTRICTS) expect(before.labels).toContain(`${area} ${count} 台`)
    expect(before.overlaps, '聚焦前').toEqual([])

    for (const { area, count } of DISTRICTS) {
      await open(page, `/screen/gov?area=${encodeURIComponent(area)}${display}`)
      await expect(page.getByRole('button', { name: `${area}，${count} 台终端，退出聚焦`, exact: true })).toBeVisible()
      await settle(page)
      const after = await sceneLabels(page)
      expect(after.labels, `聚焦${area}后本区牌子要看得见`).toContain(`${area} ${count} 台`)
      expect(after.overlaps, `聚焦${area}后`).toEqual([])
      expect(after.clipped.filter((text) => text.startsWith(area)), `聚焦${area}后本区牌子不得被场景框裁掉`).toEqual([])
    }
  })
})
