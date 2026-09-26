import { test, expect, type Page } from '@playwright/test'
import { SCREEN_HOSTING_OFF_NOTE, screenReasonCopy } from '@ai-job-print/ui'
import { SERVICE_LABELS_HOSTING_OFF, govHostingOff, opsHostingOff, usageHostingOff } from './fixtures/snapshots'
import { adminApi, open, panel, serve, serveHappy, tile, uncaughtPageErrors } from './helpers'
import { geometry, hostingOffAudit, numberAudit, sceneLabels, type GeometryReport } from './measure'

/**
 * 招聘内容托管关闭（托管 a）—— 我们云上的默认部署，政务客户与生产环境看到的就是这一版。
 *
 * 夹具照服务端写（见 fixtures/snapshots.ts 的 govHostingOff / opsHostingOff / usageHostingOff）。
 * 每个页签、展示档与桌面档都要满足：
 *   - 屏上没有「未开启」格子、标签或灰色场景节点；边界只在承载政策的那块里说一次；
 *   - 没有只剩说明、没有读数的块；岗位类字眼只出现在边界句里（运营看板盘点存量的那块除外）；
 *   - 几何照旧干净：舞台档块位装得下、不重叠、不裁字；桌面档 1440 与 1100 都不横向滚动；
 *   - 每屏一个数只出现一次（numberAudit）：政务总览与运营看板断言；服务调用与终端孪生的复述在托管开启时就有、
 *     与这一版无关，列在进度文档的遗留项里，这里不断言。
 */

/** 边界句走常量，不在用例里另抄一份：文案改了（如 R4 把「不在本平台托管」改成讲行为）用例自动跟上。 */
const BOUNDARY = SCREEN_HOSTING_OFF_NOTE

test.afterEach(async ({ page }) => {
  expect(uncaughtPageErrors(page), '页面不得有未捕获异常').toEqual([])
})

async function serveHostingOff(page: Page) {
  return serve(page, adminApi({ gov: govHostingOff, ops: opsHostingOff, usage: usageHostingOff }))
}

async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  await page.waitForTimeout(300)
}

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

interface HostingOffCase {
  key: 'gov' | 'usage' | 'ops' | 'terminal'
  path: string
  title: string
  panels: number
  cards: number
  /** 边界句出现次数：有政策内容的页签一次，终端孪生零次。 */
  boundary: number
  /** 运营看板里专门盘点岗位类存量的那块，岗位字眼是它的内容本身。 */
  exempt: string[]
  /**
   * 每屏一个数只出现一次。exemptPlaces：城区立柱上的「海珠区 8 台」是各区台数唯一的画法（面板里没有按区的台数），
   * 不参加比对；场景左上的说明与右上的图例照样比。null = 这里不断言（见文件头）。
   */
  numbers: null | { exemptPlaces: boolean }
}

const CASES: HostingOffCase[] = [
  { key: 'gov', path: '/screen/gov', title: '职易达 · 就业服务终端运行态势', panels: 7, cards: 0, boundary: 1, exempt: [], numbers: { exemptPlaces: true } },
  { key: 'usage', path: '/screen/usage', title: '职易达 · 系统使用与服务调用态势', panels: 7, cards: 0, boundary: 1, exempt: [], numbers: null },
  { key: 'ops', path: '/screen/ops', title: '终端运营看板', panels: 0, cards: 10, boundary: 1, exempt: ['岗位类存量'], numbers: { exemptPlaces: false } },
  { key: 'terminal', path: '/screen/terminal?id=t-gz-th-005', title: '终端数字孪生', panels: 4, cards: 0, boundary: 0, exempt: [], numbers: null },
]

test.describe('admin screen · 托管关闭', () => {
  for (const c of CASES) {
    test(`${c.key}：没有「未开启」、没有只剩说明的块、边界只说一次，版面干净`, async ({ page }, testInfo) => {
      const wall = testInfo.project.name.includes('wall')
      await serveHostingOff(page)
      await open(page, wall ? `${c.path}${c.path.includes('?') ? '&' : '?'}display=1` : c.path)
      await expect(page.getByRole('heading', { name: c.title, exact: true })).toBeVisible()
      await expect(page.locator('.twin')).toHaveAttribute('data-hosting', 'off')
      if (c.cards) await expect(page.locator('.ops-card')).toHaveCount(c.cards)
      else await expect(page.locator('.twin-panel')).toHaveCount(c.panels)
      await settle(page)

      const audit = await hostingOffAudit(page, BOUNDARY, c.exempt)
      expect(audit.offText, '不得出现「未开启」格子或标签').toEqual([])
      expect(audit.noticeOnly, '不得有只剩说明、没有读数的块').toEqual([])
      expect(audit.recruitmentWords, '岗位类字眼只许出现在边界句里').toEqual([])
      expect(audit.boundary, '边界句每屏只说一次（终端孪生没有政策内容，不说）').toBe(c.boundary)
      expect(audit.storageClaims, '托管说法讲「不发布」，不讲「不保存 / 不在本平台托管」（3.15 存量清理前）').toEqual([])
      if (c.numbers) {
        const numbers = await numberAudit(page, c.numbers.exemptPlaces)
        expect(numbers.repeats, `一个数每屏只出现一次（各块读到的数：${JSON.stringify(numbers.blocks)}）`).toEqual([])
      }

      const floor = wall ? 13 : 12
      const report = await geometry(page, floor)
      expect(report.panels).toHaveLength(c.panels)
      expect(report.cards).toBe(c.cards)
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
      if (c.key === 'usage') {
        const labels = await sceneLabels(page)
        expect(labels.labels.length).toBeGreaterThanOrEqual(5)
        expect(labels.overlaps, '场景节点牌不得互相压住').toEqual([])
      }
    })
  }

  test('政务总览：右上是政策服务，右中是服务质量（运营计数照实写，比例不再跟一个别处写过的次数），边界句在政策服务里', async ({ page }) => {
    await serveHostingOff(page)
    await open(page, '/screen/gov')
    await expect(panel(page, /^信息服务 · 在架$/)).toHaveCount(0)
    await expect(panel(page, /^来源平台访问$/)).toHaveCount(0)
    const policy = panel(page, /^政策服务$/)
    await expect(policy.locator('.twin-hero .twin-big')).toHaveText('216')
    await expect(policy.locator('.twin-stat', { hasText: '待机构审核' }).locator('b')).toHaveText('8条')
    await expect(policy.locator('.twin-cap')).toHaveText(BOUNDARY)
    const quality = panel(page, /^服务质量$/)
    await expect(tile(quality, 'AI 成功率').locator('b')).toHaveText('97.5%')
    await expect(tile(quality, '打印完成率').locator('b')).toHaveText('99.3%')
    // 两个比例不跟次数：AI 调用总数在「AI 服务分项」里写过，完成数与失败数在底栏任务流里写过
    await expect(quality.locator('.twin-tile small')).toHaveCount(0)
    // 今日失败与进行中是运营计数：照实写（运营快照给 3，同屏任务流里也是 3），不套「少于 5」
    await expect(tile(quality, '今日打印失败').locator('b')).toHaveText('3次')
    await expect(tile(quality, '进行中打印').locator('b')).toHaveText('6个')
    await expect(panel(page, /^近 24 小时任务流$/).locator('.twin-flow-node', { hasText: '失败待核查' }).locator('b')).toHaveText('3')
    await expect(quality.getByText('少于 5')).toHaveCount(0)
    // 场景左上不再写台数、右上图例只当颜色说明：台数都在左上「终端与服务」里
    await expect(page.locator('.twin-overlay.is-tl')).toHaveText('终端分布 · 按所在区示意')
    await expect(page.locator('.twin-overlay.is-tr .twin-lg')).toHaveText(['在线', '打印中', '告警', '离线', '未上报'])
    // 打印趋势没有空缺：仍是原来的画法（与托管开启逐像素一致），不画斜纹带
    const printTrend = panel(page, /^打印量趋势$/)
    await expect(printTrend.locator('svg[role="img"]')).toHaveCount(1)
    await expect(printTrend.locator('svg.twin-trend-gaps, .twin-trend-gap')).toHaveCount(0)
  })

  test('托管说法讲行为不讲存储：边界句与「托管未开启」原因说明都不说「不保存 / 不存 / 不在本平台托管」', () => {
    // CLAUDE.md §1：3.15 存量清理完成前，不得对外说我们云上已不存这些数据（运营看板上就有两千多条岗位存量）
    for (const text of [SCREEN_HOSTING_OFF_NOTE, screenReasonCopy('recruitment_hosting_disabled').detail]) {
      expect(text).not.toMatch(/不保存|不存|不在本平台托管/)
      expect(text).toMatch(/不发布/)
    }
  })

  test('服务调用：场景只有服务端下发的节点，「岗位 AI」改叫「简历对照」；右栏是 AI 服务 / AI 质量 / 政策服务使用', async ({ page }) => {
    await serveHostingOff(page)
    await open(page, '/screen/usage')
    const pills = page.locator('.tw3-svc .c b')
    await expect(pills).toHaveCount(SERVICE_LABELS_HOSTING_OFF.length)
    expect([...(await pills.allTextContents())].sort()).toEqual([...SERVICE_LABELS_HOSTING_OFF].sort())
    await expect(page.locator('.tw3-svc .c', { hasText: '简历对照' }).locator('span')).toHaveText('23')
    for (const gone of ['岗位信息使用', '信息内容浏览']) await expect(panel(page, new RegExp(`^${gone}$`))).toHaveCount(0)
    const quality = panel(page, /^AI 质量$/)
    await expect(tile(quality, '成功率').locator('b')).toHaveText('97.4%')
    await expect(tile(quality, '平均耗时').locator('b')).toHaveText('2.18秒')
    await expect(tile(quality, '降级兜底').locator('b')).toHaveText('9次')
    await expect(tile(quality, '调用失败').locator('b')).toHaveText('28次')
    const ai = panel(page, /^AI 服务$/)
    // AI 服务不再夹四格质量磁贴；腾出的地方给模型构成
    await expect(ai.locator('.twin-tile', { hasText: '成功率' })).toHaveCount(0)
    await expect(tile(ai, 'DeepSeek').locator('b')).toHaveText('1,032')
    const policy = panel(page, /^政策服务使用$/)
    await expect(policy.locator('.twin-hero .twin-big')).toHaveText('412')
    await expect(policy.locator('.twin-cap')).toHaveText(BOUNDARY)
  })

  test('服务调用轻量模式：条形图与场景同一份节点，没有岗位类条目', async ({ page }) => {
    await serveHostingOff(page)
    await open(page, '/screen/usage?lite=1')
    const rows = panel(page, /^各项服务使用次数$/).locator('.twin-bar-row > span:first-child')
    await expect(rows).toHaveText(SERVICE_LABELS_HOSTING_OFF)
  })

  test('运营看板：机构待审政策与打印完成率上顶栏（完成率只跟分母）；岗位类存量盘点清楚；托管开启时不多取政务快照', async ({ page }) => {
    const log = await serveHostingOff(page)
    await open(page, '/screen/ops')
    const titles = page.locator('.ops-card h2 .ops-h2-text')
    await expect(titles).toHaveText(['在网终端', '进行中打印', '今日打印失败', '机构待审政策', 'AI 成功率', '打印完成率', '实时告警', '任务流', '岗位类存量', 'AI 成本与用量'])
    const card = (title: string) => page.locator('.ops-card').filter({ has: page.locator('h2 .ops-h2-text', { hasText: new RegExp(`^${title}$`) }) })
    await expect(card('机构待审政策').locator('.ops-n')).toHaveText('8条')
    await expect(card('打印完成率').locator('.ops-n')).toHaveText('99.3%')
    // 完成数 418 已在任务流里写过，这里只跟分母
    await expect(card('打印完成率').locator('.ops-lb')).toHaveText('近 24 小时 · 421 个已结束任务')
    await expect(card('岗位类存量').locator('.ops-mv')).toHaveText(['2,184', '37', '148', '81'])
    expect(log.urls, '岗位类存量取自政务快照：托管关闭时多取这一份').toContain('/api/v1/admin/screen/snapshot?profile=gov')

    const onLog = await serveHappy(page)
    await open(page, '/screen/ops')
    await expect(page.locator('.ops-card h2 .ops-h2-text', { hasText: '同步成功率' })).toHaveCount(1)
    await expect(page.locator('.twin')).not.toHaveAttribute('data-hosting', 'off')
    expect(onLog.urls, '托管开启时运营看板只取运营快照').not.toContain('/api/v1/admin/screen/snapshot?profile=gov')
  })
})
