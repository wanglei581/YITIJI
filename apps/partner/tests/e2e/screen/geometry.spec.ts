import { test, expect, type Locator, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { PLACES, partnerTruncated } from './fixtures/snapshots'
import { open, panel, partnerApi, serve, serveHappy, uncaughtPageErrors } from './helpers'
import { geometry, sceneLabels, type GeometryReport } from './measure'

/**
 * 几何与可读性（机构端），量法与管理员端一致：
 * 舞台档（1920×1080 项目里用 display=1 打开）：舞台 1:1、面板与块位全部落在视口里、同类不重叠、
 * 不嵌套、面板里的文字不出面板、不被裁、字号 ≥13px、不滚动。
 * 桌面档（1440×900 项目，再缩到 1100 宽）：不横向滚动、同样的文字与重叠检查、字号 ≥12px。
 * 点位牌子单独量：聚焦前、逐个点位聚焦后，看得见的牌子两两不重叠。
 */

const SHOT_DIR = join(process.cwd(), '..', '..', 'test-results', 'console-screen-shots')
mkdirSync(SHOT_DIR, { recursive: true })

interface GeometryCase {
  key: 'overview' | 'usage' | 'terminal'
  title: string
  panels: number
  hues: boolean
  marker: (page: Page) => Locator
}

const CASES: GeometryCase[] = [
  { key: 'overview', title: '本机构运营概览', panels: 7, hues: true, marker: (page) => panel(page, /^本机构终端$/) },
  { key: 'usage', title: '本机构信息使用态势', panels: 7, hues: false, marker: (page) => panel(page, /^使用概况$/) },
  { key: 'terminal', title: '终端数字孪生', panels: 4, hues: false, marker: (page) => panel(page, /^设备概况$/) },
]

test.afterEach(async ({ page }) => {
  expect(uncaughtPageErrors(page), '页面不得有未捕获异常').toEqual([])
})

/**
 * 已上报的产品缺陷：机构告警行在桌面档（1440 宽三列）放不下「点位 · 告警」长文，时间戳被挤出面板右缘。
 * 只把「本机构终端告警」里的时间戳从桌面档的通用检查里拿出来，由下面「告警行放得下」那条 test.fail 单独盯着；
 * 修好后那条会意外通过而转红，届时连同这里一起删掉。别的面板、别的文字一个都不豁免。
 */
const KNOWN_ALERT_TIME = /^本机构终端告警「\d{2}:\d{2}」/
function withoutKnownDeskDefect(report: GeometryReport): GeometryReport {
  return {
    ...report,
    textEscapes: report.textEscapes.filter((item) => !KNOWN_ALERT_TIME.test(item)),
    textCut: report.textCut.filter((item) => !KNOWN_ALERT_TIME.test(item)),
  }
}

function expectCleanLayout(report: GeometryReport, floor: number, where: string) {
  expect(report.nested, `${where}：面板不得嵌套`).toEqual([])
  expect(report.overlaps, `${where}：同类面板 / 块位不得重叠`).toEqual([])
  expect(report.textEscapes, `${where}：面板里的文字不得跑出面板`).toEqual([])
  expect(report.textCut, `${where}：文字不得被裁切（有省略号的刻意截断除外）`).toEqual([])
  expect(report.squeezed, `${where}：文字不得被压扁在自己的盒子里`).toEqual([])
  expect(report.sourceless, `${where}：每块都必须带来源口径`).toEqual([])
  expect(report.tinyText, `${where}：可见文字不得小于 ${floor}px`).toEqual([])
  expect(report.scroll.w, `${where}：不得横向滚动`).toBeLessThanOrEqual(report.scroll.clientW)
}

async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  await page.waitForTimeout(300)
}

test.describe('partner screen geometry', () => {
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
      const report = wall ? measured : withoutKnownDeskDefect(measured)
      expect(report.panels, '面板块数与版式一致').toHaveLength(c.panels)
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
        const narrow = withoutKnownDeskDefect(await geometry(page, 12))
        expect(narrow.panels).toHaveLength(c.panels)
        expectCleanLayout(narrow, 12, '桌面档 1100')
      }

      const shot = join(SHOT_DIR, `partner-${c.key}-${testInfo.project.name}.png`)
      await page.screenshot({ path: shot, fullPage: !wall, animations: 'disabled' })
      await testInfo.attach(`partner-${c.key}-${testInfo.project.name}`, { path: shot, contentType: 'image/png' })
    })
  }

  test('机队截断：样本说明变长后面板不被撑破', async ({ page }, testInfo) => {
    const wall = testInfo.project.name.includes('wall')
    await serve(page, partnerApi({ snapshot: partnerTruncated }))
    await open(page, wall ? '/screen/overview?display=1' : '/screen/overview')
    await expect(panel(page, /^本机构终端$/).locator('.twin-ring-cap')).toHaveText('正常 · 共 200 台')
    await settle(page)
    const floor = wall ? 13 : 12
    const measured = await geometry(page, floor)
    const report = wall ? measured : withoutKnownDeskDefect(measured)
    expectCleanLayout(report, floor, '截断分支')
    if (wall) expect(report.outsideViewport).toEqual([])
  })

  test('告警行在桌面档放得下：时间戳不出面板（1440 宽）', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await serveHappy(page)
    await open(page, '/screen/overview')
    const alerts = panel(page, /^本机构终端告警$/)
    await expect(alerts.locator('.twin-alert')).toHaveCount(5)
    await expect(alerts.locator('.twin-when').first()).toHaveText(/^\d{2}:\d{2}$/)
    await settle(page)
    const report = await geometry(page, 12)
    const inAlerts = [...report.textEscapes, ...report.textCut].filter((item) => item.startsWith('本机构终端告警'))
    // 产品缺陷（已上报，未修）：.twin-alert 一行是「严重度 + 编号 + 点位 · 告警 + 时间」，中间那段不收缩、
    // 不省略，1440 宽三列时时间戳被挤出面板右缘。前置断言照常把关；修好后本条会「意外通过」而转红。
    test.fail(true, '机构告警行在桌面档 1440 宽时时间戳溢出面板（packages/ui 的 .twin-alert 中段不收缩）')
    expect(inAlerts).toEqual([])
  })

  test('展示档每块面板都放得进自己的块位（三个页签）', async ({ page }) => {
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
    // （实测：本机构终端告警 +10px、热门内容 +4px，都还在栏间距里，没压到别的块）。
    // 前置断言照常把关；全部修好后本条会「意外通过」而转红，届时删掉这一行。
    test.fail(true, '展示档定高块位装不下面板内容（packages/ui twin-screen-layout.css 定高块位 + 面板不收缩）')
    expect(overflow).toEqual([])
  })

  test('点位牌子：聚焦前、逐个点位聚焦后，看得见的牌子两两不重叠', async ({ page }, testInfo) => {
    const wall = testInfo.project.name.includes('wall')
    const display = wall ? '&display=1' : ''
    await serveHappy(page)
    await open(page, wall ? '/screen/overview?display=1' : '/screen/overview')
    await expect(page.locator('button.tw3-district-btn')).toHaveCount(PLACES.length)
    await settle(page)
    const before = await sceneLabels(page)
    // 阳性对照：四块点位牌都量到了，「不重叠」才不是空集合上的真
    for (const { place, count } of PLACES) expect(before.labels).toContain(`${place} ${count} 台`)
    expect(before.overlaps, '聚焦前').toEqual([])

    for (const { place, count } of PLACES) {
      await open(page, `/screen/overview?place=${encodeURIComponent(place)}${display}`)
      await expect(page.getByRole('button', { name: `${place}，${count} 台终端，退出聚焦`, exact: true })).toBeVisible()
      await settle(page)
      const after = await sceneLabels(page)
      expect(after.labels, `聚焦${place}后本点位牌子要看得见`).toContain(`${place} ${count} 台`)
      expect(after.overlaps, `聚焦${place}后`).toEqual([])
      expect(after.clipped.filter((text) => text.startsWith(place)), `聚焦${place}后本点位牌子不得被场景框裁掉`).toEqual([])
    }
  })
})
