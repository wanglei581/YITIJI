import { test, expect, type Page } from '@playwright/test'
import { partnerHostingOff, partnerUsageHostingOff } from './fixtures/snapshots'
import { expectLocation, open, panel, partnerApi, serve, serveHappy, uncaughtPageErrors } from './helpers'
import { geometry, hostingOffAudit, keyboardFocus, sceneLabels, type GeometryReport } from './measure'

/**
 * 招聘内容托管关闭（托管 a）—— 我们云上的默认部署，机构看到的就是这一版。
 *
 * 夹具照服务端写（fixtures/snapshots.ts 的 partnerHostingOff / partnerUsageHostingOff）。
 * 每个页签、展示档与桌面档都要满足：没有「未开启」、没有只剩说明的块、边界只在政策那块里说一次、
 * 岗位类字眼只出现在边界句与待审核里那一句存量说明里、版面几何干净。
 * 另外单独钉住：机构总览的块位重排（场景长满中栏、告警两格高、建设中的指标桌面档收成一行）、
 * 终端状态墙点一格进孪生、告警行先写事件后写点位（两种部署都是）、信息使用只画政策一类。
 */

const BOUNDARY = '政策由运营机构自行审核发布；岗位、招聘会、企业资料不在本平台托管'
const STOCK_LINE = '另有岗位类存量 7 条（托管关闭后不再审核）'

test.afterEach(async ({ page }) => {
  expect(uncaughtPageErrors(page), '页面不得有未捕获异常').toEqual([])
})

async function serveHostingOff(page: Page) {
  return serve(page, partnerApi({ snapshot: partnerHostingOff, usage: partnerUsageHostingOff }))
}

async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  await page.waitForTimeout(300)
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

interface HostingOffCase {
  name: string
  path: string
  title: string
  panels: number
  boundary: number
  exempt: string[]
}

const CASES: HostingOffCase[] = [
  { name: 'overview', path: '/screen/overview', title: '本机构运营概览', panels: 5, boundary: 1, exempt: [STOCK_LINE] },
  { name: 'usage', path: '/screen/usage', title: '本机构信息使用态势', panels: 5, boundary: 1, exempt: [] },
  { name: 'usage-7d', path: '/screen/usage?range=7d', title: '本机构信息使用态势', panels: 5, boundary: 1, exempt: [] },
  { name: 'terminal', path: '/screen/terminal?id=t-hz-zd-04', title: '终端数字孪生', panels: 4, boundary: 0, exempt: [] },
]

test.describe('partner screen · 托管关闭', () => {
  for (const c of CASES) {
    test(`${c.name}：没有「未开启」、没有只剩说明的块、边界只说一次，版面干净`, async ({ page }, testInfo) => {
      const wall = testInfo.project.name.includes('wall')
      await serveHostingOff(page)
      await open(page, wall ? `${c.path}${c.path.includes('?') ? '&' : '?'}display=1` : c.path)
      await expect(page.getByRole('heading', { name: c.title, exact: true })).toBeVisible()
      await expect(page.locator('.twin')).toHaveAttribute('data-hosting', 'off')
      await expect(page.locator('.twin-panel')).toHaveCount(c.panels)
      await settle(page)

      const audit = await hostingOffAudit(page, BOUNDARY, c.exempt)
      expect(audit.offText, '不得出现「未开启」格子或标签').toEqual([])
      expect(audit.noticeOnly, '不得有只剩说明、没有读数的块').toEqual([])
      expect(audit.recruitmentWords, '岗位类字眼只许出现在边界句与存量说明里').toEqual([])
      expect(audit.boundary, '边界句每屏只说一次（终端孪生没有政策内容，不说）').toBe(c.boundary)

      const floor = wall ? 13 : 12
      const report = await geometry(page, floor)
      expect(report.panels).toHaveLength(c.panels)
      expectCleanLayout(report, floor, wall ? '舞台档 1920×1080' : '桌面档 1440')
      if (wall) {
        expect(report.stageScale).toBe(1)
        expect(report.outsideViewport, '展示档面板与块位必须完全落在视口内').toEqual([])
        expect(report.slotOverflow, '展示档每块面板都放得进自己的块位').toEqual([])
        expect(report.scroll.h, '舞台档不得纵向滚动').toBeLessThanOrEqual(report.scroll.clientH)
      } else {
        await page.setViewportSize({ width: 1100, height: 900 })
        await settle(page)
        const narrow = await geometry(page, 12)
        expect(narrow.panels).toHaveLength(c.panels)
        expectCleanLayout(narrow, 12, '桌面档 1100')
      }
      if (c.name !== 'terminal') {
        const labels = await sceneLabels(page)
        expect(labels.overlaps, '场景牌子不得互相压住').toEqual([])
      }
    })
  }

  test('机构总览（展示档）：没有建设中的指标，场景长满中栏；告警两格高；左栏是终端墙与本机构政策', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 })
    await serveHostingOff(page)
    await open(page, '/screen/overview?display=1')
    await expect(page.locator('.twin-slot[data-slot="bottom"]')).toHaveCount(0)
    await expect(page.locator('.twin-gapline')).toHaveCount(0)
    const height = (slot: string) => page.locator(`.twin-slot[data-slot="${slot}"]`).evaluate((el) => Math.round(el.getBoundingClientRect().height))
    expect(await height('scene'), '场景长满中栏（原来的底栏让给场景）').toBe(956)
    expect(await height('r2'), '告警长进腾出的右上块位').toBe(628)
    await expect(page.locator('.twin-slot[data-slot="r3"]')).toHaveCount(0)
    await expect(page.locator('.twin-slot[data-slot="r2"] .twin-ph-t')).toHaveText('本机构终端告警')
    await expect(page.locator('.twin-slot[data-slot="l2"] .twin-ph-t')).toHaveText('终端状态墙')
    const policy = panel(page, /^本机构政策$/)
    await expect(policy.locator('.twin-hero .twin-big')).toHaveText('9')
    await expect(policy.locator('.twin-stat b')).toHaveText('3条')
    await expect(policy.locator('.twin-cap')).toHaveText(BOUNDARY)
    const pending = panel(page, /^待审核$/)
    await expect(pending.locator('.twin-big')).toHaveText('3')
    await expect(pending.locator('.twin-cap').last()).toHaveText(STOCK_LINE)
    for (const gone of ['数据同步', '招聘会', '本机构在架信息', '建设中的指标']) await expect(panel(page, new RegExp(`^${gone}$`))).toHaveCount(0)
  })

  test('机构总览（桌面档）：建设中的指标收成一行，点开才列出，托管关闭带来的那项不重复列', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await serveHostingOff(page)
    await open(page, '/screen/overview')
    const line = page.locator('.twin-gapline')
    await expect(line).toHaveCount(1)
    await expect(line.locator('summary')).toHaveText('另有 13 项指标待补齐机构归属等数据后显示')
    await expect(line.locator('.twin-pend').first()).toBeHidden()
    await line.locator('summary').click()
    const chips = line.locator('.twin-pend')
    await expect(chips).toHaveCount(13)
    await expect(chips.filter({ hasText: '打开来源平台入口' })).toHaveCount(0)
    await expect(panel(page, /^建设中的指标$/)).toHaveCount(0)
  })

  for (const display of [false, true]) {
    test(`终端状态墙（${display ? '展示档' : '桌面档'}）：一格一台，要紧的在前；点一格进该终端的孪生`, async ({ page }) => {
      await serveHostingOff(page)
      await open(page, display ? '/screen/overview?display=1' : '/screen/overview')
      const wall = panel(page, /^终端状态墙$/)
      const cells = wall.locator('button.twin-fleet-cell')
      await expect(cells).toHaveCount(12)
      // 离线 → 告警 → 未上报 → 打印中 → 在线，同状态按编号
      await expect(cells.locator('b')).toHaveText([
        'HZ-HL-02', 'HZ-SQ-01', 'HZ-HZ-01', 'HZ-ZD-03', 'HZ-SQ-02', 'HZ-ZD-04', 'HZ-HL-01', 'HZ-HL-03', 'HZ-HZ-02', 'HZ-HZ-03', 'HZ-ZD-01', 'HZ-ZD-02',
      ])
      await cells.filter({ hasText: 'HZ-ZD-03' }).click()
      await expectLocation(page, '/screen/terminal', { ...(display ? { display: '1' } : {}), id: 't-hz-zd-03' })
      await expect(page.locator('.twin-hd-sub')).toContainText('HZ-ZD-03')
    })
  }

  test('终端状态墙用键盘也能进：Tab 聚焦有焦点环，回车打开孪生', async ({ page }, testInfo) => {
    const display = testInfo.project.name.includes('wall')
    await serveHostingOff(page)
    await open(page, display ? '/screen/overview?display=1' : '/screen/overview')
    const cell = panel(page, /^终端状态墙$/).locator('button.twin-fleet-cell', { hasText: 'HZ-SQ-01' })
    const ring = await keyboardFocus(page, cell)
    expect(ring, '键盘聚焦时要看得见焦点环').toEqual({ focusVisible: true, outlineStyle: 'solid', outlineWidth: 2 })
    await page.keyboard.press('Enter')
    await expectLocation(page, '/screen/terminal', { ...(display ? { display: '1' } : {}), id: 't-hz-sq-01' })
  })

  for (const hosting of ['off', 'on'] as const) {
    test(`告警行先写事件、后写点位（托管${hosting === 'off' ? '关闭' : '开启'}）：放不下时省略号吃掉点位，不吃时长`, async ({ page }, testInfo) => {
      const display = testInfo.project.name.includes('wall')
      if (hosting === 'off') await serveHostingOff(page)
      else await serveHappy(page)
      await open(page, display ? '/screen/overview?display=1' : '/screen/overview')
      const rows = panel(page, /^本机构终端告警$/).locator('.twin-alert')
      const text = (code: string) => rows.filter({ hasText: code }).locator('.twin-alert-text')
      await expect(text('HZ-HL-02')).toHaveText('离线 21 分钟 · 人才服务大厅')
      await expect(text('HZ-SQ-01')).toHaveText('离线 46 分钟 · 社区就业站')
      await expect(text('HZ-ZD-03')).toHaveText('打印机缺纸 · 中大南校区')
      await expect(text('HZ-HL-02')).toHaveAttribute('title', '离线 21 分钟 · 人才服务大厅')
      // 被截断时留下的是事件：「离线 21 分钟」整段都在可见范围里
      const visible = await text('HZ-HL-02').evaluate((el) => {
        const range = document.createRange()
        range.selectNodeContents(el)
        const box = el.getBoundingClientRect()
        const words = (el.textContent ?? '').indexOf(' · ')
        range.setEnd(el.firstChild as Text, words)
        return range.getBoundingClientRect().right <= box.right + 0.5
      })
      expect(visible, '事件那一段不被省略号吃掉').toBe(true)
    })
  }

  test('信息使用：场景只画政策一类，底栏是热门政策，右栏是收藏与统计口径，左边每日趋势长高', async ({ page }, testInfo) => {
    const display = testInfo.project.name.includes('wall')
    await serveHostingOff(page)
    await open(page, display ? '/screen/usage?display=1' : '/screen/usage')
    await expect(page.locator('.tw3-svc .c b')).toHaveText(['政策公告'])
    await expect(page.locator('.twin-overlay.is-tl')).toContainText('本机构信息 → 政策公告 → 收藏 / 打开来源入口')
    const top = panel(page, /^热门政策$/)
    await expect(top.locator('.twin-rank li .twin-rank-t')).toHaveText(['2026 年高校毕业生就业见习补贴申领指南', '海珠区灵活就业人员社保补贴申领办法', '创业担保贷款贴息政策问答'])
    await expect(top.locator('.twin-cap')).toHaveText(BOUNDARY)
    await expect(page.locator('.twin-slot[data-slot="bottom"] .twin-ph-t')).toHaveText('热门政策')
    await expect(page.locator('.twin-slot[data-slot="r1"] .twin-ph-t')).toHaveText('收藏')
    await expect(page.locator('.twin-slot[data-slot="r2"] .twin-ph-t')).toHaveText('统计口径')
    await expect(page.locator('.twin-slot[data-slot="r3"], .twin-slot[data-slot="l3"]')).toHaveCount(0)
    for (const gone of ['打开来源平台入口', '按信息类型', '热门内容']) await expect(panel(page, new RegExp(`^${gone}$`))).toHaveCount(0)
    // 只剩一类时收藏写「少于 5」，不写「每类少于 5」
    await expect(panel(page, /^收藏$/).locator('.twin-hero .twin-big')).toHaveText('少于 5')
    await expect(page.locator('.tw3-big .c', { hasText: '收藏' }).locator('span')).toHaveText('少于 5')
    if (display) {
      const l2 = await page.locator('.twin-slot[data-slot="l2"]').evaluate((el) => Math.round(el.getBoundingClientRect().height))
      expect(l2, '每日趋势长进左下').toBe(628)
      await expect(panel(page, /^每日趋势$/).locator('.twin-stat-list.is-tall .twin-stat b')).toHaveText(['21次', '8次'])
    }
  })
})
