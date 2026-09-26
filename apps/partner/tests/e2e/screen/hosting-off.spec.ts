import { test, expect, type Locator, type Page } from '@playwright/test'
import { SCREEN_HOSTING_OFF_NOTE } from '@ai-job-print/ui'
import {
  TOP_POLICY_TITLES,
  TREND_GAP_DAYS,
  partnerHostingOff,
  partnerHostingOffTruncated,
  partnerUsageHostingOff,
  partnerUsageTrendGaps,
  shanghaiDate,
} from './fixtures/snapshots'
import { expectLocation, open, panel, partnerApi, serve, serveHappy, uncaughtPageErrors } from './helpers'
import { geometry, hostingOffAudit, keyboardFocus, numberAudit, sceneLabels, type GeometryReport } from './measure'

/**
 * 招聘内容托管关闭（托管 a）—— 我们云上的默认部署，机构看到的就是这一版。
 *
 * 夹具照服务端写（fixtures/snapshots.ts 的 partnerHostingOff / partnerUsageHostingOff）。
 * 每个页签、展示档与桌面档都要满足：没有「未开启」、没有只剩说明的块、边界只在政策那块里说一次、
 * 岗位类字眼只出现在边界句与政策块里那一句存量说明里、版面几何干净，
 * 以及「每屏一个数只出现一次」：面板、场景牌子与浮层之间，≥ 5 的整数不许复述（numberAudit）。
 * 另外单独钉住：机构总览的块位（终端状态墙与告警各两个块位高、本机构政策合成一块、告警没排满时说其余正常）、
 * 状态墙点一格进孪生、告警行先写事件后写点位（两种部署都是）、信息使用的版式（左栏概况与口径、
 * 底部宽的每日趋势、右栏热门政策 Top 5）、今日档只剩一行状态、趋势里的空缺怎么画。
 */

/** 边界句走常量，不在用例里另抄一份：文案改了（如 R4 把「不在本平台托管」改成讲行为）用例自动跟上。 */
const BOUNDARY = SCREEN_HOSTING_OFF_NOTE
const STOCK_LINE = '另有岗位类存量 11 条（托管关闭后不再审核）'
const GAP_NOTE = '斜纹 = 少于 5，不显示具体数'

test.afterEach(async ({ page }) => {
  expect(uncaughtPageErrors(page), '页面不得有未捕获异常').toEqual([])
})

async function serveHostingOff(page: Page, usage = partnerUsageHostingOff) {
  return serve(page, partnerApi({ snapshot: partnerHostingOff, usage }))
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

const slotHeight = (page: Page, slot: string) =>
  page.locator(`.twin-slot[data-slot="${slot}"]`).evaluate((el) => Math.round(el.getBoundingClientRect().height))

interface HostingOffCase {
  name: string
  path: string
  title: string
  panels: number
  boundary: number
  exempt: string[]
  /** 只写口径、刻意没有读数的块：「统计口径」一直如此；今日档的「每日趋势」只剩一行状态（不把概况的数放大重写）。 */
  methodology: string[]
  /**
   * 每屏一个数只出现一次。exemptPlaces：机构总览场景里点位牌上的「N 台」是各点位台数唯一的画法（面板里没有按点位的台数），
   * 不参加比对；场景的浮层与其余牌子照样比。null = 这里不断言（终端孪生的复述与托管无关，见进度文档遗留项）。
   */
  numbers: null | { exemptPlaces: boolean }
}

const CASES: HostingOffCase[] = [
  { name: 'overview', path: '/screen/overview', title: '本机构运营概览', panels: 4, boundary: 1, exempt: [STOCK_LINE], methodology: [], numbers: { exemptPlaces: true } },
  { name: 'usage-default-7d', path: '/screen/usage', title: '本机构信息使用态势', panels: 4, boundary: 1, exempt: [], methodology: ['统计口径'], numbers: { exemptPlaces: false } },
  { name: 'usage-today', path: '/screen/usage?range=today', title: '本机构信息使用态势', panels: 4, boundary: 1, exempt: [], methodology: ['统计口径', '每日趋势'], numbers: { exemptPlaces: false } },
  { name: 'usage-30d', path: '/screen/usage?range=30d', title: '本机构信息使用态势', panels: 4, boundary: 1, exempt: [], methodology: ['统计口径'], numbers: { exemptPlaces: false } },
  { name: 'terminal', path: '/screen/terminal?id=t-hz-zd-04', title: '终端数字孪生', panels: 4, boundary: 0, exempt: [], methodology: [], numbers: null },
]

test.describe('partner screen · 托管关闭', () => {
  for (const c of CASES) {
    test(`${c.name}：没有「未开启」、没有只剩说明的块、边界只说一次、一个数只出现一次，版面干净`, async ({ page }, testInfo) => {
      const wall = testInfo.project.name.includes('wall')
      await serveHostingOff(page)
      await open(page, wall ? `${c.path}${c.path.includes('?') ? '&' : '?'}display=1` : c.path)
      await expect(page.getByRole('heading', { name: c.title, exact: true })).toBeVisible()
      await expect(page.locator('.twin')).toHaveAttribute('data-hosting', 'off')
      await expect(page.locator('.twin-panel')).toHaveCount(c.panels)
      await settle(page)

      const audit = await hostingOffAudit(page, BOUNDARY, c.exempt, c.methodology)
      expect(audit.offText, '不得出现「未开启」格子或标签').toEqual([])
      expect(audit.noticeOnly, '不得有只剩说明、没有读数的块').toEqual([])
      expect(audit.recruitmentWords, '岗位类字眼只许出现在边界句与存量说明里').toEqual([])
      expect(audit.boundary, '边界句每屏只说一次（终端孪生没有政策内容，不说）').toBe(c.boundary)
      expect(audit.storageClaims, '托管说法讲「不发布」，不讲「不保存 / 不在本平台托管」（3.15 存量清理前）').toEqual([])
      if (c.numbers) {
        const numbers = await numberAudit(page, c.numbers.exemptPlaces)
        expect(numbers.repeats, `一个数每屏只出现一次（各块读到的数：${JSON.stringify(numbers.blocks)}）`).toEqual([])
      }

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

  test('机构总览（展示档）：场景长满中栏；状态墙与告警各两个块位高；本机构政策一块写全在架、待审核、存量与边界', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 })
    await serveHostingOff(page)
    await open(page, '/screen/overview?display=1')
    await expect(page.locator('.twin-slot[data-slot="bottom"]')).toHaveCount(0)
    await expect(page.locator('.twin-gapline')).toHaveCount(0)
    expect(await slotHeight(page, 'scene'), '场景长满中栏（原来的底栏让给场景）').toBe(956)
    expect(await slotHeight(page, 'l2'), '终端状态墙占左栏两个块位').toBe(628)
    expect(await slotHeight(page, 'r2'), '告警占右栏两个块位').toBe(628)
    await expect(page.locator('.twin-slot[data-slot="l3"], .twin-slot[data-slot="r3"]')).toHaveCount(0)
    await expect(page.locator('.twin-slot[data-slot="l2"] .twin-ph-t')).toHaveText('终端状态墙')
    await expect(page.locator('.twin-slot[data-slot="r1"] .twin-ph-t')).toHaveText('本机构政策')
    await expect(page.locator('.twin-slot[data-slot="r2"] .twin-ph-t')).toHaveText('本机构终端告警')
    const policy = panel(page, /^本机构政策$/)
    await expect(policy.locator('.twin-hero .twin-big')).toHaveText('9')
    await expect(policy.locator('.twin-stat', { hasText: '待本机构审核' }).locator('b')).toHaveText('3条')
    await expect(policy.locator('.twin-cap')).toHaveText([STOCK_LINE, BOUNDARY])
    // 待审核只在政策这一块里写：没有单独的「待审核」块，也没有别的块写「待审核」
    await expect(panel(page, /^待审核$/)).toHaveCount(0)
    await expect(page.locator('.twin-panel', { hasText: '待本机构审核' })).toHaveCount(1)
    for (const gone of ['数据同步', '招聘会', '本机构在架信息', '建设中的指标']) await expect(panel(page, new RegExp(`^${gone}$`))).toHaveCount(0)
  })

  test('机构总览：状态墙与场景不再复述台数（台数只在「本机构终端」里写），图例只当颜色说明', async ({ page }, testInfo) => {
    const display = testInfo.project.name.includes('wall')
    await serveHostingOff(page)
    await open(page, display ? '/screen/overview?display=1' : '/screen/overview')
    await expect(panel(page, /^本机构终端$/).locator('.twin-ring-cap')).toHaveText('正常 · 共 12 台')
    await expect(panel(page, /^终端状态墙$/).locator('.twin-ph-sub')).toHaveText('点一格进入该终端的孪生')
    await expect(page.locator('.twin-overlay.is-tl')).toHaveText('本机构 4 个服务点位 · 分布示意')
    await expect(page.locator('.twin-overlay.is-tr .twin-lg')).toHaveText(['在线', '打印中', '告警', '离线', '未上报'])
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
    test(`终端状态墙（${display ? '展示档' : '桌面档'}）：一格一台写编号、状态与点位，要紧的在前；点一格进该终端的孪生`, async ({ page }) => {
      await serveHostingOff(page)
      await open(page, display ? '/screen/overview?display=1' : '/screen/overview')
      const wall = panel(page, /^终端状态墙$/)
      const cells = wall.locator('button.twin-fleet-cell')
      await expect(cells).toHaveCount(12)
      // 离线 → 告警 → 未上报 → 打印中 → 在线，同状态按编号
      await expect(cells.locator('b')).toHaveText([
        'HZ-HL-02', 'HZ-SQ-01', 'HZ-HZ-01', 'HZ-ZD-03', 'HZ-SQ-02', 'HZ-ZD-04', 'HZ-HL-01', 'HZ-HL-03', 'HZ-HZ-02', 'HZ-HZ-03', 'HZ-ZD-01', 'HZ-ZD-02',
      ])
      await expect(cells.first().locator('.twin-fleet-place')).toHaveText('人才服务大厅')
      await expect(wall.locator('.twin-fleet-more')).toHaveCount(0)
      await cells.filter({ hasText: 'HZ-ZD-03' }).click()
      await expectLocation(page, '/screen/terminal', { ...(display ? { display: '1' } : {}), id: 't-hz-zd-03' })
      await expect(page.locator('.twin-hd-sub')).toContainText('HZ-ZD-03')
    })
  }

  test('终端状态墙：聚焦到一个点位时每格不再写点位名', async ({ page }) => {
    await serveHostingOff(page)
    await open(page, `/screen/overview?place=${encodeURIComponent('社区就业站')}`)
    const wall = panel(page, /^社区就业站终端状态墙$/)
    await expect(wall.locator('button.twin-fleet-cell')).toHaveCount(2)
    await expect(wall.locator('.twin-fleet-place')).toHaveCount(0)
  })

  test('大机构（640 台、样本 200 台）：状态墙两个块位放得下，最后一格如实写「另 N 台」；告警没排满时说其余正常', async ({ page }, testInfo) => {
    const display = testInfo.project.name.includes('wall')
    await serve(page, partnerApi({ snapshot: partnerHostingOffTruncated, usage: partnerUsageHostingOff }))
    await open(page, display ? '/screen/overview?display=1' : '/screen/overview')
    const wall = panel(page, /^终端状态墙$/)
    await expect(wall.locator('button.twin-fleet-cell')).toHaveCount(20)
    await expect(wall.locator('.twin-fleet-more')).toHaveText('另 180 台在终端孪生里看')
    await expect(panel(page, /^本机构终端告警$/).locator('.twin-allclear')).toHaveText('其余终端运行正常')
    await expect(page.locator('.twin-overlay.is-tl')).toHaveText('本机构 4 个服务点位 · 分布示意（只画了机队样本）')
    await settle(page)
    const report = await geometry(page, display ? 13 : 12)
    expectCleanLayout(report, display ? 13 : 12, display ? '大机构 · 舞台档' : '大机构 · 桌面档')
    if (display) expect(report.slotOverflow, '大机构的状态墙也放得进两个块位').toEqual([])
    const numbers = await numberAudit(page, true)
    expect(numbers.repeats, `大机构同样一个数只出现一次（${JSON.stringify(numbers.blocks)}）`).toEqual([])
  })

  test('告警没排满：下面一行说其余终端正常，不写台数（台数在「本机构终端」里）；排满或没有告警时不说', async ({ page }, testInfo) => {
    const display = testInfo.project.name.includes('wall')
    await serveHostingOff(page)
    await open(page, display ? '/screen/overview?display=1' : '/screen/overview')
    const alerts = panel(page, /^本机构终端告警$/)
    await expect(alerts.locator('.twin-alert')).toHaveCount(5)
    await expect(alerts.locator('.twin-allclear')).toHaveText('其余终端运行正常')
    // 聚焦到只有告警终端的点位：没有「其余」可说
    await open(page, `/screen/overview?place=${encodeURIComponent('社区就业站')}${display ? '&display=1' : ''}`)
    const focused = panel(page, /^社区就业站告警$/)
    await expect(focused.locator('.twin-alert')).toHaveCount(2)
    await expect(focused.locator('.twin-allclear')).toHaveCount(0)
  })

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

  test('信息使用：左栏概况与口径，中栏场景不写数、底部宽的每日趋势，右栏整栏热门政策 Top 5', async ({ page }, testInfo) => {
    const display = testInfo.project.name.includes('wall')
    await serveHostingOff(page)
    await open(page, display ? '/screen/usage?display=1' : '/screen/usage')
    const slotTitle = (slot: string) => page.locator(`.twin-slot[data-slot="${slot}"] .twin-ph-t`)
    await expect(slotTitle('l1')).toHaveText('使用概况')
    await expect(slotTitle('l2')).toHaveText('统计口径')
    await expect(slotTitle('bottom')).toHaveText('每日趋势')
    await expect(slotTitle('r1')).toHaveText('热门政策')
    await expect(page.locator('.twin-slot[data-slot="l3"], .twin-slot[data-slot="r2"], .twin-slot[data-slot="r3"]')).toHaveCount(0)
    for (const gone of ['收藏', '打开来源平台入口', '按信息类型', '热门内容']) await expect(panel(page, new RegExp(`^${gone}$`))).toHaveCount(0)

    // 三个合计只在使用概况里写；场景只画政策一类，牌子上不写数
    const overview = panel(page, /^使用概况$/)
    await expect(overview.locator('.twin-stat b')).toHaveText(['126次', '18次', '48次'])
    await expect(page.locator('.tw3-svc .c b')).toHaveText(['政策公告'])
    await expect(page.locator('.tw3-svc .c span')).toHaveText(['浏览'])
    await expect(page.locator('.tw3-big .c span')).toHaveCount(0)
    await expect(page.locator('.tw3-big .c b')).toHaveText(['收藏', '打开来源平台入口'])
    await expect(page.locator('.twin-overlay.is-tl')).toContainText('本机构信息 → 政策公告 → 收藏 / 打开来源入口')

    // 统计口径：访问人次是一条说明，不再挂「未接入」小牌子
    const notes = panel(page, /^统计口径$/)
    await expect(notes.locator('.twin-notes li').last()).toHaveText('访问人次暂未统计（一体机会话尚未记录）')
    await expect(notes.locator('.twin-pend, .twin-kv')).toHaveCount(0)

    // 热门政策：竖排 Top 5，标题写全（第四条折成两行，不截断）
    const top = panel(page, /^热门政策$/)
    await expect(top.locator('.twin-rank.is-tall li .twin-rank-t')).toHaveText([...TOP_POLICY_TITLES])
    await expect(top.locator('.twin-rank li > b')).toHaveText(['38', '27', '21', '14', '9'])
    const titleLines = await top.locator('.twin-rank-t').evaluateAll((els) =>
      els.map((el) => Math.round(el.getBoundingClientRect().height / Number.parseFloat(getComputedStyle(el).lineHeight))),
    )
    for (const lines of titleLines) expect(lines, '标题最多两行').toBeLessThanOrEqual(2)
    if (display) expect(titleLines[3], '第四条长标题在展示档折成两行，写全').toBe(2)
    const clipped = await top.locator('.twin-rank-t').evaluateAll((els) => els.filter((el) => el.scrollHeight > el.clientHeight + 1).length)
    expect(clipped, '没有标题被两行截断').toBe(0)
    await expect(top.locator('.twin-cap')).toHaveText(BOUNDARY)

    // 每日趋势：宽图，图例里写一次小注
    const trend = panel(page, /^每日趋势$/)
    await expect(trend.locator('svg.twin-trend-gaps')).toHaveCount(1)
    await expect(trend.getByText(GAP_NOTE)).toHaveCount(1)
    if (display) {
      expect(await slotHeight(page, 'l1')).toBe(600)
      expect(await slotHeight(page, 'l2')).toBe(328)
      expect(await slotHeight(page, 'scene')).toBe(680)
      expect(await slotHeight(page, 'bottom')).toBe(264)
      expect(await slotHeight(page, 'r1')).toBe(944)
    }
  })

  test('信息使用 · 今日：每日趋势只剩一行状态，不把概况的数放大重写；展示档不提去哪里选', async ({ page }, testInfo) => {
    const display = testInfo.project.name.includes('wall')
    await serveHostingOff(page)
    await open(page, display ? '/screen/usage?display=1&range=today' : '/screen/usage?range=today')
    await expect(page.locator('.twin-grid')).toHaveAttribute('data-variant', 'org-usage-today')
    const trend = panel(page, /^每日趋势$/)
    await expect(trend.locator('svg, .twin-tile, .twin-stat')).toHaveCount(0)
    await expect(trend.locator('.twin-cap')).toHaveText(display ? '今日只有一天，画不出趋势' : '今日只有一天，画不出趋势 · 选近 7 天看趋势')
    await expect(page.getByText(/选「近 7 天」或「近 30 天」/)).toHaveCount(0)
    await expect(panel(page, /^使用概况$/).locator('.twin-stat b')).toHaveText(['21次', '少于 5次', '8次'])
    // 今日达到 5 次的只有 3 条：说一句为什么短
    await expect(panel(page, /^热门政策$/).locator('.twin-cap').first()).toHaveText('浏览少于 5 次的政策不列出')
    if (display) {
      expect(await slotHeight(page, 'bottom'), '底栏收成一行高').toBe(88)
      expect(await slotHeight(page, 'scene'), '场景长进腾出的高度').toBe(856)
    }
  })

  test('每日趋势有空缺（两头与中间）：斜纹带标「<5」，孤立点写数，点都落在自己的日格正中，图边没有孤点', async ({ page }, testInfo) => {
    const display = testInfo.project.name.includes('wall')
    await serveHostingOff(page, partnerUsageTrendGaps)
    await open(page, display ? '/screen/usage?display=1' : '/screen/usage')
    const svg = panel(page, /^每日趋势$/).locator('svg.twin-trend-gaps')
    await expect(svg).toHaveCount(1)
    await settle(page)
    const n = TREND_GAP_DAYS.length
    const date = (i: number) => shanghaiDate(n - 1 - i)

    // 斜纹带：d0、d2、d6 两条都少于 5（灰绿），d5 只有第二条少于 5（金色）；每段一个「<5」
    const gaps = svg.locator('.twin-trend-gap')
    await expect(gaps).toHaveCount(4)
    expect(await gaps.evaluateAll((els) => els.map((el) => `${el.getAttribute('data-from')}:${el.getAttribute('data-kind')}`))).toEqual([
      `${date(0)}:main`,
      `${date(2)}:main`,
      `${date(5)}:second`,
      `${date(6)}:main`,
    ])
    await expect(svg.locator('.twin-trend-gap-label')).toHaveText(['<5', '<5', '<5', '<5'])

    // 孤立点：d1 两条都是前后皆空的真值，画空心圆并写数
    await expect(svg.locator(`.twin-trend-dot[data-series="main"][data-date="${date(1)}"] .twin-trend-val`)).toHaveText('12')
    await expect(svg.locator(`.twin-trend-dot[data-series="second"][data-date="${date(1)}"] .twin-trend-val`)).toHaveText('5')
    // 连成线的只有 d3–d5 这一段（第二条 d3–d4）；没有单点线段，没有旧画法的虚线空心点
    await expect(svg.locator('.twin-trend-line')).toHaveCount(2)
    await expect(svg.locator('circle[stroke-dasharray]')).toHaveCount(0)
    // 小注只写一次，写在图例里（不在图里）
    await expect(svg.locator('.twin-trend-note')).toHaveCount(0)
    await expect(panel(page, /^每日趋势$/).getByText(GAP_NOTE)).toHaveCount(1)

    await expectTrendGeometry(svg, n)
  })

  test('每日趋势（默认近 7 天）：第一天就是孤立点也不贴图边，日期写在它正下方', async ({ page }, testInfo) => {
    const display = testInfo.project.name.includes('wall')
    await serveHostingOff(page)
    await open(page, display ? '/screen/usage?display=1' : '/screen/usage')
    const svg = panel(page, /^每日趋势$/).locator('svg.twin-trend-gaps')
    await expect(svg).toHaveCount(1)
    await settle(page)
    // 夹具的第一天（近 7 天里最早那天）两条都是前后皆空的孤立点：screen-review-a 里它贴在图的左边线上
    await expect(svg.locator(`.twin-trend-dot[data-series="main"][data-date="${shanghaiDate(6)}"] .twin-trend-val`)).toHaveText('15')
    await expectTrendGeometry(svg, 7)
  })
})

/** 有空缺的趋势图的几何：圆点都在日格正中、最左的点离图边至少半格、「<5」不压点也不压线、日期一天一个写在点的正下方。 */
async function expectTrendGeometry(svg: Locator, days: number) {
  const geo = await svg.evaluate((el) => {
    const ticks = [...el.querySelectorAll('.twin-trend-tick')].map((t) => Number(t.getAttribute('x1')))
    const circles = [...el.querySelectorAll('circle')].map((c) => Number(c.getAttribute('cx')))
    const box = (node: Element) => (node as SVGGraphicsElement).getBBox()
    const labels = [...el.querySelectorAll('.twin-trend-gap-label')].map(box)
    const marks = [...el.querySelectorAll('.twin-trend-dot circle, .twin-trend-val')].map(box)
    const hit = (a: DOMRect, b: DOMRect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
    // 折线按 d 里的顶点逐段取样：任何一个样点落进「<5」的字框就算压线
    const polylines = [...el.querySelectorAll('.twin-trend-line')].map((p) =>
      [...(p.getAttribute('d') ?? '').matchAll(/[ML]([\d.]+) ([\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])] as const),
    )
    const inside = (r: DOMRect, x: number, y: number) => x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height
    const crosses = (r: DOMRect) =>
      polylines.some((pts) =>
        pts.slice(1).some(([x1, y1], i) => {
          const [x0, y0] = pts[i]
          for (let t = 0; t <= 1; t += 0.02) if (inside(r, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)) return true
          return false
        }),
      )
    const dates = [...el.querySelectorAll('text.twin-axis')].filter((t) => /^\d{2}-\d{2}$/.test(t.textContent ?? ''))
    return {
      ticks,
      circles,
      slot: ticks.length > 1 ? ticks[1] - ticks[0] : 0,
      plotLeft: Math.min(...[...el.querySelectorAll('line')].map((l) => Number(l.getAttribute('x1')))),
      labelHitsMark: labels.some((l) => marks.some((m) => hit(l, m))),
      labelHitsLine: labels.some(crosses),
      datesCentred: dates.every((t) => t.getAttribute('text-anchor') === 'middle' && ticks.some((x) => Math.abs(x - Number(t.getAttribute('x'))) < 0.5)),
      dateCount: dates.length,
    }
  })
  expect(geo.ticks).toHaveLength(days)
  for (const cx of geo.circles) expect(geo.ticks.some((x) => Math.abs(x - cx) < 0.5), `圆点 x=${cx} 落在某一天的日格正中`).toBe(true)
  expect(Math.min(...geo.circles) - geo.plotLeft, '最左的圆点离图边至少半个日格（不贴边）').toBeGreaterThanOrEqual(geo.slot / 2 - 1)
  expect(geo.labelHitsMark, '「<5」不压在圆点或数字上').toBe(false)
  expect(geo.labelHitsLine, '「<5」不压在折线上（只有第二条少于 5、上方有真值的日子写进带子里）').toBe(false)
  expect(geo.dateCount, '一周七天的日期都写出来').toBe(days)
  expect(geo.datesCentred, '日期写在自己那一天的正下方').toBe(true)
}
