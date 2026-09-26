// 招聘会共享工作台（稿 28-jobfair-enhanced）八条路由的**运行时**行为与形态。
//
// 静态那一半由 verify:fair-workbench-qx 守（四张稿面表逐条对账 + 页面只许用稿里
// 存在的 screen:state）。但静态断言证明不了两件事，只有真跑才知道：
//
//   ① 这八页在浏览器里**真的**挂的是青序流光壳，而不是旧 W4 框套了个新名字。
//      「换壳」和「迁移」在源码里长得很像，在 DOM 里不像。
//   ② 顶栏那句胶囊**在每一种真实数据形态下**说的是不是稿里那句话。
//      loading / empty / error / 已结束 / 已下架是五种不同的话，写错一句，
//      公共终端就会在一个没人复核的场景下对用户说假话。
//
// 夹具 fail-closed：未登记的请求一律 abort 并在收尾时抛错，所以「这一页发了哪些
// 接口」本身也被钉着。
//
// 截图：1080×1920，写进 testInfo().outputPath()，验收证据另行归档到
// tests/visual/evidence/qx-fair-workbench/。
import { expect, test } from '../fixtures/kiosk-test'
import {
  FAIR_ID,
  FAIR_MATERIAL,
  VISIT_PLAN_TASK_ID,
  registerFairApi,
  registerPrintConfirm,
} from './fixtures/fair-workbench-api'
import {
  FAIR_BACK,
  FAIR_HEAD,
  FAIR_PILL,
  fairPillOf,
  type FairScreen,
} from '../../src/pages/job-fairs/fairWorkbenchSpecs'

const TRUTH_LEAD = '本机不代收简历、不代预约，也不做签到。'

/** 八屏共用的形态断言：青序壳在、旧 W4 框不在、truth 条在、胶囊与稿一致。 */
async function expectQxWorkbench(
  page: import('@playwright/test').Page,
  screen: FairScreen,
  state: string,
): Promise<void> {
  await expect(page.locator('[data-qx-frame="true"]')).toHaveCount(1)
  // 「真迁移」的硬判据：旧 W4 框一个都不许留在 DOM 里。
  await expect(page.locator('.w4-page-frame')).toHaveCount(0)
  await expect(page.locator(`[data-testid="fair-${screen}-state-${state}"]`)).toHaveCount(1)

  const pill = fairPillOf(screen, state)
  const pillEl = page.locator('.qx-pill')
  await expect(pillEl).toHaveText(pill.label)
  await expect(pillEl).toHaveAttribute('data-tone', pill.tone)

  // 合规底线声明八屏共用，写在壳里，业务页删不掉。
  await expect(page.getByText(TRUTH_LEAD)).toBeVisible()

  // 返回键：一体机上唯一的「上一步」（公共终端没有浏览器后退键）。
  // 无障碍名逐字取稿 BACK 表 —— 稿改了壳没跟，这里会红。
  //
  // 精确锁 topbar，不按可及名全局找：稿在若干状态下**刻意**让底栏也放一个同名大键
  // （例如 list:loading 的「返回招聘会服务」、detail:loading 的「返回场次列表」）——
  // 图标返回键小、底栏键大，两者对一体机都是必要的。按名全局 count(1) 会把稿的
  // 这个设计判成缺陷，所以判据落到「顶栏那一个存在且叫对名字」。
  const [, backLabel] = FAIR_BACK[screen]
  const topbarBack = page.locator('.qx-topbar .qx-topbar-back')
  await expect(topbarBack).toHaveCount(1)
  await expect(topbarBack).toHaveAttribute('aria-label', backLabel)

  // 固定底栏：主操作必须和合规声明同在那条不随正文滚动的带里，且顺序是操作在上。
  const bottom = page.locator('.qx-ctabar .qxfw-bottom')
  await expect(bottom).toHaveCount(1)
}

/** 固定底栏里那一排主操作键（不含合规 truth 条里的「遇到问题」）。 */
function ctaButtons(page: import('@playwright/test').Page) {
  return page.locator('.qx-ctabar .qxfw-ctabar button')
}

/**
 * 一体机硬约束的逐屏体检：
 *   ① 主操作真的在固定底栏里，且整体落在 1920 视口内（不被导航压住）；
 *   ② 每个可点区域 ≥48px（CLAUDE.md §9），主操作键 ≥56px；
 *   ③ 没有嵌套可交互元素（<button> 里套 button / role=button / a）；
 *   ④ 正文没有横向溢出，底栏与导航之间没有重叠。
 */
async function expectKioskLayout(page: import('@playwright/test').Page): Promise<void> {
  const report = await page.evaluate(() => {
    const stage = document.querySelector('.qx-stage') as HTMLElement | null
    const ctabar = document.querySelector('.qx-ctabar') as HTMLElement | null
    const navbar = document.querySelector('.qx-navbar') as HTMLElement | null
    const body = document.querySelector('.qx-body') as HTMLElement | null
    // 舞台是 1080×1920 等比缩放上去的：屏幕上量到的 px = CSS px × scale，
    // 所有尺寸断言都要除回去，否则窗口一变就误判（见 kiosk-stage-fit 笔记）。
    const scale = stage ? stage.getBoundingClientRect().width / 1080 : 1
    const small: string[] = []
    for (const el of Array.from(document.querySelectorAll('button, [role="button"], a[href]'))) {
      const r = (el as HTMLElement).getBoundingClientRect()
      if (r.width === 0 && r.height === 0) continue
      const h = r.height / scale
      const w = r.width / scale
      if (h < 48 || w < 48) small.push(`${el.className || el.tagName}:${Math.round(w)}x${Math.round(h)}`)
    }
    const nested: string[] = []
    for (const el of Array.from(document.querySelectorAll('button'))) {
      if (el.querySelector('button, [role="button"], a[href], input, select, textarea')) {
        nested.push(el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 20) ?? '?')
      }
    }
    const ctaRect = ctabar?.getBoundingClientRect() ?? null
    const navRect = navbar?.getBoundingClientRect() ?? null

    // 死白测量：滚动区没有溢出时，剩下的余量必须被**均分到上下**（稿对状态屏
    // 用的就是 .scroll.center），而不是整块堆在底部。只测「底部空多少」会把
    // 居中也判成缺陷，所以测的是上下两段空白的**差**。
    const scroll = document.querySelector('.qxfw') as HTMLElement | null
    let slackImbalance: number | null = null
    let bottomSlack: number | null = null
    let centered = false
    if (scroll && scroll.children.length > 0) {
      centered = scroll.getAttribute('data-fair-center') === 'true'
      const overflow = scroll.scrollHeight - scroll.clientHeight
      if (overflow <= 1) {
        const box = scroll.getBoundingClientRect()
        const first = scroll.children[0].getBoundingClientRect()
        const last = scroll.children[scroll.children.length - 1].getBoundingClientRect()
        const top = (first.top - box.top) / scale
        bottomSlack = (box.bottom - last.bottom) / scale
        slackImbalance = Math.abs(top - bottomSlack)
      }
    }
    return {
      scale,
      small,
      nested,
      // 阳性对照：这三个读数为 0 有两种可能——真的合格，或者根本没量到东西。
      // 没有它们，选择器写错时整个体检会静默全绿。
      probedInteractive: document.querySelectorAll('button, [role="button"], a[href]').length,
      probedButtons: document.querySelectorAll('button').length,
      ctaBottom: ctaRect ? ctaRect.bottom : null,
      navTop: navRect ? navRect.top : null,
      bodyOverflowX: body ? body.scrollWidth - body.clientWidth : 0,
      slackImbalance,
      bottomSlack,
      centered,
    }
  })
  // 阳性对照先行：量到的控件太少就说明探针本身失效，此时后面的 0 没有意义。
  expect(report.probedInteractive, '探针没量到可交互元素（选择器失效？）').toBeGreaterThan(4)
  expect(report.probedButtons, '探针没量到 button').toBeGreaterThan(3)
  expect(report.scale, '舞台缩放读数异常').toBeGreaterThan(0)
  expect(report.nested, `嵌套可交互元素: ${report.nested.join(', ')}`).toHaveLength(0)
  expect(report.small, `触控目标小于 48px: ${report.small.join(', ')}`).toHaveLength(0)
  expect(report.bodyOverflowX, '正文横向溢出').toBeLessThanOrEqual(1)
  // 死白判据分两种，按这一屏是否按稿居中：
  //   · 居中屏：余量必须均分到上下（32px 容差 = .dw-page 自带 8/12px 内边距再留一倍）；
  //   · 顶部对齐屏：必须有吸收块，底部余量不得成片。420px 这个上限来自实测——
  //     有吸收块的列表屏是 12px，而 2026-09-21 修掉的两个参会清单信息态是 636/701px。
  //     没卡得更紧，是因为 checkin:guide / map:index 这类屏的余量随**数据条数**变化，
  //     夹具只放一条记录（实测 410 / 312），真实终端上会被内容填满；卡到 200 会变成
  //     在门禁里钉夹具规模，而不是钉产品缺陷。
  if (report.slackImbalance != null && report.centered) {
    expect(report.slackImbalance, '居中屏的余量没有均分到上下').toBeLessThanOrEqual(32)
  }
  if (report.bottomSlack != null && !report.centered) {
    expect(report.bottomSlack, '顶部对齐屏底部成片死白（缺余量吸收块）').toBeLessThanOrEqual(420)
  }
  expect(report.ctaBottom, '固定底栏不存在').not.toBeNull()
  expect(report.navTop, '底部导航不存在').not.toBeNull()
  // 底栏与导航相接（±1px 抗舍入），既不重叠也不留缝。
  expect(Math.abs(report.ctaBottom! - report.navTop!)).toBeLessThanOrEqual(1)
}

async function shot(
  page: import('@playwright/test').Page,
  name: string,
): Promise<void> {
  await page.screenshot({ path: test.info().outputPath(`${name}.png`), fullPage: false })
}

// ───────────────────────────── 场次列表 /job-fairs ─────────────────────────────

test('列表 ready：服务端总数与本屏渲染数分开说，筛选口径写明 @kiosk', async ({ page, api }) => {
  registerFairApi(api)
  await page.goto('/job-fairs')
  await expect(page.getByTestId('fair-list')).toBeVisible()
  await expectQxWorkbench(page, 'list', 'ready')
  // 两个数不许合并成一个——服务端查到的和这一屏显示的不是一回事。
  await expect(page.getByText(/服务端结果 \d+ 场/)).toBeVisible()
  await expect(page.getByText(/当前展示 \d+ 场/)).toBeVisible()
  await expect(page.getByText('关键字与状态交给服务端查询；地区、日期和收藏只在本次已加载的场次集合内筛选，不代表全库结果。')).toBeVisible()
  await expect(page.getByRole('button', { name: '扫码预约' })).toHaveCount(1)
  await expect(page.getByText(/一键投递|立即投递|平台投递|报名成功/)).toHaveCount(0)
  await expectKioskLayout(page)
  await shot(page, 'qx-fair-list-ready')
})

test('列表 loading：不显示条数、不画阶段进度 @kiosk', async ({ page, api }) => {
  registerFairApi(api, { list: 'pending' })
  await page.goto('/job-fairs')
  await expectQxWorkbench(page, 'list', 'loading')
  await expect(page.getByText('未返回前不显示条数')).toBeVisible()
  await expect(page.getByText(/服务端结果/)).toHaveCount(0)
  await shot(page, 'qx-fair-list-loading')
})

test('列表 empty：不拿往期活动充数 @kiosk', async ({ page, api }) => {
  registerFairApi(api, { list: 'empty' })
  await page.goto('/job-fairs')
  await expectQxWorkbench(page, 'list', 'empty')
  await expect(page.getByTestId('fair-list-empty')).toContainText('不会拿往期活动充数')
  await shot(page, 'qx-fair-list-empty')
})

test('列表 error：不回填缓存场次 @kiosk', async ({ page, api }) => {
  registerFairApi(api, { list: 'error' })
  await page.goto('/job-fairs')
  await expectQxWorkbench(page, 'list', 'error')
  await expect(page.getByTestId('fair-list-error')).toContainText('不显示上一次的缓存场次')
  await shot(page, 'qx-fair-list-error')
})

test('关键事务：列表「扫码预约」只给来源二维码，不代预约 @kiosk', async ({ page, api }) => {
  registerFairApi(api)
  await page.goto('/job-fairs')
  await page.getByRole('button', { name: '扫码预约' }).click()
  const overlay = page.getByRole('dialog', { name: '扫码前往来源平台预约' })
  await expect(overlay).toBeVisible()
  await expect(overlay).toContainText('本系统不参与活动报名流程、不接收简历')
  await expect(page.getByTestId('fair-qr-slot')).toBeVisible()
  await shot(page, 'qx-fair-list-booking-qr')
})

// ───────────────────────────── 到场指引 /job-fairs/checkin ──────────────────────

test('到场指引 guide：只列有 checkinUrl 的场次，不查个人记录 @kiosk', async ({ page, api }) => {
  registerFairApi(api, { fair: { status: 'ongoing' } })
  await page.goto('/job-fairs/checkin')
  await expectQxWorkbench(page, 'checkin', 'guide')
  await expect(page.getByText('本机不做签到，也拿不到签到结果。')).toBeVisible()
  await expect(page.getByText(/签到成功|确认签到|入场成功/)).toHaveCount(0)
  await expectKioskLayout(page)
  await shot(page, 'qx-fair-checkin-guide')
})

test('到场指引 empty：没有可用入口 ≠ 你没预约 @kiosk', async ({ page, api }) => {
  registerFairApi(api, { fair: { checkinUrl: null } })
  await page.goto('/job-fairs/checkin')
  await expectQxWorkbench(page, 'checkin', 'empty')
  await expect(page.getByTestId('fair-checkin-empty')).toContainText('这不代表你未预约')
  await shot(page, 'qx-fair-checkin-empty')
})

test('到场指引 error：不显示缓存二维码 @kiosk', async ({ page, api }) => {
  registerFairApi(api, { list: 'error' })
  await page.goto('/job-fairs/checkin')
  await expectQxWorkbench(page, 'checkin', 'error')
  await expect(page.getByTestId('fair-checkin-error')).toContainText('本机不显示缓存二维码')
  await shot(page, 'qx-fair-checkin-error')
})

test('关键事务：到场指引「扫码签到」进入来源入场码 @kiosk', async ({ page, api }) => {
  registerFairApi(api, { fair: { status: 'ongoing' } })
  await page.goto('/job-fairs/checkin')
  await page.getByRole('button', { name: '扫码签到' }).click()
  await expectQxWorkbench(page, 'checkin', 'qr')
  const overlay = page.getByRole('dialog', { name: '扫码前往来源平台签到' })
  await expect(overlay).toContainText('本系统不记录签到结果')
  await shot(page, 'qx-fair-checkin-qr')
})

// ───────────────────────────── 详情 /job-fairs/:id ──────────────────────────────

test('详情 detail：来源三要素齐全，subnav 五条各自说明有没有数据 @kiosk', async ({ page, api }) => {
  registerFairApi(api)
  await page.goto(`/job-fairs/${FAIR_ID}`)
  await expectQxWorkbench(page, 'detail', 'detail')
  // 来源机构在副标题与「信息来源」kv 里各出现一次（稿就是这样画的），
  // 所以锁到 kv 区域，不做全局唯一断言。
  const sourceBlock = page.locator('.dw-kv').first()
  await expect(sourceBlock).toContainText('青岛公共就业服务网')
  await expect(sourceBlock).toContainText('ext-fair-001')
  for (const testId of ['companies', 'map', 'materials', 'visit-plan', 'stats']) {
    await expect(page.getByTestId(`fair-detail-${testId}`)).toBeVisible()
  }
  // 夹具 isMockData=true ⟹ 统计这一行必须说「还没有回传」，不能说有。
  await expect(page.getByTestId('fair-detail-stats')).toContainText('主办方还没有回传统计')
  await shot(page, 'qx-fair-detail-default')
})

test('详情 loading：字段返回前一个字都不显示 @kiosk', async ({ page, api }) => {
  registerFairApi(api, { detail: 'pending' })
  await page.goto(`/job-fairs/${FAIR_ID}`)
  await expectQxWorkbench(page, 'detail', 'loading')
  await expect(page.getByText('字段返回前不展示任何内容')).toBeVisible()
  await shot(page, 'qx-fair-detail-loading')
})

test('详情 ended：不再给预约入口，AI 出口换成回顾语义 @kiosk', async ({ page, api }) => {
  registerFairApi(api, { fair: { status: 'ended' } })
  await page.goto(`/job-fairs/${FAIR_ID}`)
  await expectQxWorkbench(page, 'detail', 'ended')
  await expect(page.getByTestId('fair-detail-ended')).toContainText('不再提供预约入口')
  await expect(page.getByRole('button', { name: '扫码预约' })).toHaveCount(0)
  // AI 出口**有且只有一个**，就是 subnav 那一行。底栏此前放了一个同名键，
  // 同屏两个可及名相同、落点相同的控件——读屏无法区分，触屏上挤成一条。
  await expect(page.getByText('AI参会回顾')).toHaveCount(1)
  await expect(page.getByTestId('fair-detail-visit-plan')).toContainText('AI参会回顾')
  await expectKioskLayout(page)
  await shot(page, 'qx-fair-detail-ended')
})

test('详情 unpublished：下架内容不留副本 @kiosk', async ({ page, api }) => {
  registerFairApi(api, { fair: { publishStatus: 'unpublished' } })
  await page.goto(`/job-fairs/${FAIR_ID}`)
  await expectQxWorkbench(page, 'detail', 'unpublished')
  await expect(page.getByTestId('fair-detail-unpublished')).toContainText('不保留下架内容的副本')
  await shot(page, 'qx-fair-detail-unpublished')
})

test('详情 error：不拿列表片段拼一个详情页 @kiosk', async ({ page, api }) => {
  registerFairApi(api, { detail: 'error' })
  await page.goto(`/job-fairs/${FAIR_ID}`)
  await expectQxWorkbench(page, 'detail', 'error')
  await expect(page.getByTestId('fair-detail-error')).toContainText('不拿列表里的片段拼一个详情页')
  await shot(page, 'qx-fair-detail-error')
})

test('关键事务：详情 subnav 五条各自落到自己的路由 @kiosk', async ({ page, api }) => {
  registerFairApi(api)
  const targets: Array<[string, RegExp]> = [
    ['fair-detail-companies', /\/job-fairs\/fair-001\/companies$/],
    ['fair-detail-map', /\/job-fairs\/fair-001\/map$/],
    ['fair-detail-materials', /\/job-fairs\/fair-001\/materials$/],
    ['fair-detail-visit-plan', /\/job-fairs\/fair-001\/visit-plan$/],
    ['fair-detail-stats', /\/job-fairs\/fair-001\/stats$/],
  ]
  for (const [testId, expected] of targets) {
    await page.goto(`/job-fairs/${FAIR_ID}`)
    await page.getByTestId(testId).click()
    await expect(page).toHaveURL(expected)
    await expect(page.locator('[data-qx-frame="true"]')).toHaveCount(1)
  }
})

// ───────────────────────────── 参展企业 /:id/companies ──────────────────────────

test('参展企业 list：名单边界与来源三要素同屏 @kiosk', async ({ page, api }) => {
  registerFairApi(api)
  await page.goto(`/job-fairs/${FAIR_ID}/companies`)
  await expectQxWorkbench(page, 'companies', 'list')
  await expect(page.getByTestId('fair-companies-list')).toContainText('青岛示例制造有限公司')
  await expect(page.getByText('名单以主办方回传为准；本机不代收简历，也不在平台内投递。').first()).toBeVisible()
  await expectKioskLayout(page)
  await shot(page, 'qx-fair-companies-list')
})

test('参展企业 loading / empty / error 各自诚实 @kiosk', async ({ page, api }) => {
  registerFairApi(api, { companies: 'pending' })
  await page.goto(`/job-fairs/${FAIR_ID}/companies`)
  await expectQxWorkbench(page, 'companies', 'loading')
  await expect(page.getByText('未返回前不显示家数')).toBeVisible()
  await shot(page, 'qx-fair-companies-loading')
})

test('参展企业 empty：不用往期名单填上去 @kiosk', async ({ page, api }) => {
  registerFairApi(api, { companies: 'empty' })
  await page.goto(`/job-fairs/${FAIR_ID}/companies`)
  await expectQxWorkbench(page, 'companies', 'empty')
  await expect(page.getByTestId('fair-companies-empty')).toContainText('不会用往期名单或猜测的单位填上去')
  await shot(page, 'qx-fair-companies-empty')
})

test('参展企业 error：取不到就先不显示 @kiosk', async ({ page, api }) => {
  registerFairApi(api, { companies: 'error' })
  await page.goto(`/job-fairs/${FAIR_ID}/companies`)
  await expectQxWorkbench(page, 'companies', 'error')
  await expect(page.getByTestId('fair-companies-error')).toContainText('取不到就先不显示')
  await shot(page, 'qx-fair-companies-error')
})

// ───────────────────────────── 展位分布 /:id/map ────────────────────────────────

test('展位分布 index：会场布局取自 venue-guide，设施名来自服务端 @kiosk', async ({ page, api }) => {
  registerFairApi(api, { venueGuide: 'ok' })
  await page.goto(`/job-fairs/${FAIR_ID}/map`)
  await expectQxWorkbench(page, 'map', 'index')
  await expect(page.getByText('青岛国际会展中心 · 会场布局')).toBeVisible()
  await expect(page.getByText('东门')).toBeVisible()
  await expect(page.getByTestId('fair-map-booths')).toBeVisible()
  await expect(page.getByText('本机不画推荐路线').first()).toBeVisible()
  // 主办方没标行业 / 没录岗位时不得替它编话（稿的真话边界 ③ 的同类问题）。
  await expect(page.getByText('综合展区')).toHaveCount(0)
  await expect(page.getByText('岗位待录入')).toHaveCount(0)
  // 展区没有 boothCount（适配层只能给 0 占位）⟹ 一个「已签到」都不许出现。
  await expect(page.getByText(/已签到/)).toHaveCount(0)
  await shot(page, 'qx-fair-map-index')
})

test('展位分布 empty：不放灰色占位块、不自画示意图 @kiosk', async ({ page, api }) => {
  registerFairApi(api, { map: 'empty' })
  await page.goto(`/job-fairs/${FAIR_ID}/map`)
  await expectQxWorkbench(page, 'map', 'empty')
  await expect(page.getByTestId('fair-map-empty')).toContainText('不放灰色占位块，也不自己画一张示意图')
  await shot(page, 'qx-fair-map-empty')
})

test('展位分布 error：取不到时宁可先不显示 @kiosk', async ({ page, api }) => {
  registerFairApi(api, { map: 'error' })
  await page.goto(`/job-fairs/${FAIR_ID}/map`)
  await expectQxWorkbench(page, 'map', 'error')
  await expect(page.getByTestId('fair-map-error')).toContainText('取不到时宁可先不显示')
  await shot(page, 'qx-fair-map-error')
})

// ───────────────────────────── 活动物料 /:id/materials ──────────────────────────

test('活动物料 list：不说免费、不展示无写入方的打印次数 @kiosk', async ({ page, api }) => {
  registerFairApi(api)
  await page.goto(`/job-fairs/${FAIR_ID}/materials`)
  await expectQxWorkbench(page, 'materials', 'list')
  await expect(page.getByTestId('fair-materials-list')).toContainText(FAIR_MATERIAL.name)
  await expect(page.getByText(/免费打印|可免费打印/)).toHaveCount(0)
  await expect(page.getByText(/已打印\s*0\s*次/)).toHaveCount(0)
  await expectKioskLayout(page)
  await shot(page, 'qx-fair-materials-list')
})

test('活动物料 empty：这场还没有可下载的物料 @kiosk', async ({ page, api }) => {
  registerFairApi(api, { materials: 'empty' })
  await page.goto(`/job-fairs/${FAIR_ID}/materials`)
  await expectQxWorkbench(page, 'materials', 'empty')
  await shot(page, 'qx-fair-materials-empty')
})

test('活动物料 500：说「没取到」，不许说成链接已过期 @kiosk', async ({ page, api }) => {
  registerFairApi(api, { materials: 'error' })
  await page.goto(`/job-fairs/${FAIR_ID}/materials`)
  // 稿只画了 expired，于是第一版把任何取数失败都显示成「限时签名链接超时失效，
  // 重新获取一次即可，内容不变」—— 服务端 500 时这三句每一句都不成立。
  await expectQxWorkbench(page, 'materials', 'error')
  await expect(page.getByTestId('fair-materials-error')).toContainText('不是链接过期')
  await expect(page.getByText(/物料链接已过期|链接已过期/)).toHaveCount(0)
  // 重试是本页自己重发请求，不是整页 reload（一体机整页重载会把路由清掉）。
  await expect(page.getByRole('button', { name: '重新加载' })).toHaveCount(1)
  await expectKioskLayout(page)
  await shot(page, 'qx-fair-materials-error')
})

test('活动物料 500 重试：重新加载真的重发请求并恢复列表 @kiosk', async ({ page, api }) => {
  registerFairApi(api)
  let calls = 0
  api.respondWith('GET', `/api/v1/job-fairs/${FAIR_ID}/materials`, (n) => {
    calls = n
    if (n === 1) return { status: 500, json: { error: { code: 'INTERNAL', message: 'fixture failure' } } }
    return {
      status: 200,
      json: { success: true, data: [FAIR_MATERIAL], pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 } },
    }
  })
  await page.goto(`/job-fairs/${FAIR_ID}/materials`)
  await expectQxWorkbench(page, 'materials', 'error')
  await page.getByRole('button', { name: '重新加载' }).click()
  await expectQxWorkbench(page, 'materials', 'list')
  await expect(page.getByTestId('fair-materials-list')).toContainText(FAIR_MATERIAL.name)
  expect(calls).toBeGreaterThanOrEqual(2)
})

test('关键事务：物料打印失败时如实说这次没成，不跳打印确认 @kiosk', async ({ page, api }) => {
  registerFairApi(api)
  api.respond('POST', `/api/v1/job-fairs/${FAIR_ID}/materials/${FAIR_MATERIAL.id}/print-url`, {
    status: 500,
    json: { error: { code: 'INTERNAL', message: '打印文件生成失败' } },
  })
  await page.goto(`/job-fairs/${FAIR_ID}/materials`)
  await page.getByRole('button', { name: /去打印/ }).first().click()
  await expectQxWorkbench(page, 'materials', 'print-failed')
  await expect(page).toHaveURL(/\/job-fairs\/fair-001\/materials$/)
  await shot(page, 'qx-fair-materials-print-failed')
})

test('关键事务：物料打印成功时只消费服务端签发的 printFileUrl @kiosk', async ({ page, api }) => {
  registerFairApi(api)
  api.respond('POST', `/api/v1/job-fairs/${FAIR_ID}/materials/${FAIR_MATERIAL.id}/print-url`, {
    status: 200,
    json: {
      fileId: 'file-fair-material-001',
      filename: '参展企业名单（完整版）.pdf',
      sizeBytes: 839_680,
      mimeType: 'application/pdf',
      pageCount: 4,
      printFileUrl: '/api/v1/files/file-fair-material-001/content?sig=fixture',
    },
  })
  api.respond('POST', '/api/v1/orders/quote', {
    status: 200,
    json: { success: true, data: { totalCents: 400, currency: 'CNY', lines: [], pages: 4, sheets: 4 } },
  })
  // /print/confirm 落地时读本机能力（彩色 / 双面按登记决定可用性）。
  // 夹具 fail-closed：不登记就是 Unhandled API request，而症状看起来像打印链路坏了。
  registerPrintConfirm(api)
  await page.goto(`/job-fairs/${FAIR_ID}/materials`)
  await page.getByRole('button', { name: /去打印/ }).first().click()
  await expect(page).toHaveURL(/\/print\/confirm$/)
  expect(api.requestCount('POST', `/api/v1/job-fairs/${FAIR_ID}/materials/${FAIR_MATERIAL.id}/print-url`)).toBe(1)
  await shot(page, 'qx-fair-materials-print-confirm')
})

// ───────────────────────────── 参会清单 /:id/visit-plan ─────────────────────────

test('参会清单 missing-context：没有简历也照样能逛 @kiosk', async ({ page, api }) => {
  registerFairApi(api)
  await page.goto(`/job-fairs/${FAIR_ID}/visit-plan`)
  await expectQxWorkbench(page, 'visit-plan', 'missing-context')
  await expect(page.getByText('没有简历也照样能逛：参展名单、展位索引和物料打印都不需要 AI。')).toBeVisible()
  await expectKioskLayout(page)
  await shot(page, 'qx-fair-visit-plan-missing-context')
})

/** 把匿名简历会话塞进 sessionStorage —— 页面正是从这里拿 taskId 的。 */
async function seedResumeSession(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript((taskId) => {
    window.sessionStorage.setItem(
      'ai-job-print:current-ai-resume',
      JSON.stringify({ taskId, accessToken: 'fixture-access-token' }),
    )
  }, VISIT_PLAN_TASK_ID)
}

test('参会清单 idle：有简历但这场没生成过时，生成入口必须够得着 @kiosk', async ({ page, api }) => {
  registerFairApi(api, { visitPlanLatest: 'not-found' })
  await seedResumeSession(page)
  await page.goto(`/job-fairs/${FAIR_ID}/visit-plan`)
  // 这是本轮最关键的一条：GET latest 回 404（这条链路最常见的应答）时，
  // 旧实现 `.catch(() => undefined)` 把它折成 missing-context，
  // 页面于是说「还没有选简历」，底栏主键变成「选择本人简历」——
  // 带着简历走到这一页的人，**永远点不到生成**。
  await expectQxWorkbench(page, 'visit-plan', 'idle')
  await expect(page.getByTestId('fair-visit-plan-idle')).toContainText('这场招聘会还没有生成过')
  const generate = page.getByTestId('fair-visit-plan-generate')
  await expect(generate).toBeVisible()
  await expect(generate).toBeEnabled()
  await expect(page.getByText('还没有选')).toHaveCount(0)
  await expectKioskLayout(page)
  await shot(page, 'qx-fair-visit-plan-idle')
})

test('参会清单 idle：点生成真的发 POST，不是个摆设 @kiosk', async ({ page, api }) => {
  registerFairApi(api, { visitPlanLatest: 'not-found' })
  const generateUrl = `/api/v1/job-fairs/${FAIR_ID}/visit-plan/${VISIT_PLAN_TASK_ID}`
  api.respond('POST', generateUrl, {
    status: 200,
    json: { status: 'failed', failReason: '夹具：本次不产出内容' },
  })
  await seedResumeSession(page)
  await page.goto(`/job-fairs/${FAIR_ID}/visit-plan`)
  await page.getByTestId('fair-visit-plan-generate').click()
  await expectQxWorkbench(page, 'visit-plan', 'failed')
  expect(api.requestCount('POST', generateUrl)).toBe(1)
})

test('参会清单 load-failed：5xx 不许伪装成「还没生成」 @kiosk', async ({ page, api }) => {
  registerFairApi(api, { visitPlanLatest: 'error' })
  await seedResumeSession(page)
  await page.goto(`/job-fairs/${FAIR_ID}/visit-plan`)
  await expectQxWorkbench(page, 'visit-plan', 'load-failed')
  await expect(page.getByTestId('fair-visit-plan-load-failed')).toContainText('不是你没生成过')
  // 重试与「直接生成新的」都要在，且重试必须真的重发 GET。
  await expect(page.getByTestId('fair-visit-plan-reload')).toBeVisible()
  await expect(page.getByTestId('fair-visit-plan-generate')).toBeVisible()
  const latestUrl = `/api/v1/job-fairs/${FAIR_ID}/visit-plan/${VISIT_PLAN_TASK_ID}`
  const before = api.requestCount('GET', latestUrl)
  await page.getByTestId('fair-visit-plan-reload').click()
  await expect
    .poll(() => api.requestCount('GET', latestUrl))
    .toBeGreaterThan(before)
  await expectKioskLayout(page)
  await shot(page, 'qx-fair-visit-plan-load-failed')
})

// ───────────────────────── 来源不可信时 fail-closed ─────────────────────────

/**
 * 阻断原因必须把这一条说成「招聘会 / 场次」，不能说成「岗位 / 职位」。
 *
 * 八条路由迁进来时这三页复用了 jobs 的 sourceTrustReason，于是一体机会对着一场
 * 双选会说「无法核对这条岗位的来源……自行查询该职位」。招聘会是活动不是职位，
 * 那是一句会上公共终端的假话。静态那一半由 verify:jobfair-ui 的 K 段守（措辞表、
 * 默认值、三页调用点）；这里守的是**真渲染出来的那句话**——常量换了但页面没跟、
 * 或者哪天又有人把 SOURCE_APPLY_UNAVAILABLE_REASON 传回来，静态断言可能绕过去，
 * 用户眼睛看到的这行字不会。
 *
 * 断言只锚在阻断说明那一个元素上，不做整页扫描：场次卡的 meta 里本来就有
 * 「3 个岗位」这种**正确**的岗位字样，整页查「岗位」会把对的判成错的。
 */
async function expectFairWordedBlockReason(
  page: import('@playwright/test').Page,
  selector: string,
): Promise<void> {
  const reason = page.locator(selector).first()
  await expect(reason).toBeVisible()
  const text = (await reason.textContent()) ?? ''
  expect(text).toMatch(/招聘会|场次/)
  expect(text).not.toMatch(/岗位|职位/)
}


test('来源要素缺项：列表「扫码预约」不出码、不记录、常显原因 @kiosk', async ({ page, api }) => {
  // 缺同步时间 + 外部编号：四要素不全，本机没有能力核对这个链接是不是这场的。
  registerFairApi(api, { fair: { syncTime: null, externalId: '' } })
  await page.goto('/job-fairs')
  const book = page.getByRole('button', { name: '扫码预约' })
  await expect(book).toHaveAttribute('aria-disabled', 'true')
  await expect(page.getByText(/来源要素缺/).first()).toBeVisible()
  // 多要素缺失走措辞表那一支：这里必须是「这场招聘会 / 该场次」。
  await expectFairWordedBlockReason(page, '.qxfw-blocked')
  // 卡片上那两格不能是空白标签：阻断说明点名的就是它们，两边要对得上号。
  await expect(page.getByTestId('fair-list')).toContainText('同步 来源平台未提供')
  await expect(page.getByTestId('fair-list')).toContainText('外部编号 来源平台未提供')
  await book.click({ force: true })
  // 点了也不出码，更不写 ExternalJumpLog（夹具没登记该端点，发了就是 Unhandled API）。
  await expect(page.getByRole('dialog', { name: '扫码前往来源平台预约' })).toHaveCount(0)
  await expect(page.getByTestId('fair-qr-slot')).toHaveCount(0)
  await expectKioskLayout(page)
  await shot(page, 'qx-fair-list-source-blocked')
})

test('来源要素缺项：详情「扫码预约」同样 fail-closed @kiosk', async ({ page, api }) => {
  registerFairApi(api, { fair: { sourceUrl: '' } })
  await page.goto(`/job-fairs/${FAIR_ID}`)
  await expectQxWorkbench(page, 'detail', 'detail')
  const book = page.getByRole('button', { name: '扫码预约' })
  await expect(book).toHaveAttribute('aria-disabled', 'true')
  // 只缺 sourceUrl → 走的是调用方传进去的链接常量那一支（不是措辞表），
  // 所以这一条覆盖的是 FAIR_BOOKING_LINK_UNAVAILABLE_REASON 而非 'job_fair' 参数。
  await expectFairWordedBlockReason(page, 'p.why')
  await book.click({ force: true })
  await expect(page.getByRole('dialog', { name: '扫码前往来源平台预约' })).toHaveCount(0)
  await shot(page, 'qx-fair-detail-source-blocked')
})

test('来源要素缺项：到场指引「扫码签到」不出码 @kiosk', async ({ page, api }) => {
  registerFairApi(api, { fair: { status: 'ongoing', syncTime: null } })
  await page.goto('/job-fairs/checkin')
  const checkin = page.getByRole('button', { name: '扫码签到' })
  await expect(checkin).toHaveAttribute('aria-disabled', 'true')
  await expectFairWordedBlockReason(page, '.qxfw-blocked')
  await checkin.click({ force: true })
  await expect(page.getByRole('dialog', { name: '扫码前往来源平台签到' })).toHaveCount(0)
  await shot(page, 'qx-fair-checkin-source-blocked')
})

// ───────────────────────── 展位分布：出纸出口不许在降级态消失 ──────────────────

test('展位分布 empty / error 都保留「查看可打印导览资料」 @kiosk', async ({ page, api }) => {
  registerFairApi(api, { map: 'empty' })
  await page.goto(`/job-fairs/${FAIR_ID}/map`)
  await expectQxWorkbench(page, 'map', 'empty')
  await expect(page.getByRole('button', { name: /查看可打印导览资料/ })).toBeVisible()
  await expectKioskLayout(page)
  await shot(page, 'qx-fair-map-empty-cta')
})

test('展位分布：会场布局 500 时不说「主办方没有提供」 @kiosk', async ({ page, api }) => {
  registerFairApi(api, { map: 'empty', venueGuide: 'error' })
  await page.goto(`/job-fairs/${FAIR_ID}/map`)
  // /map 返回空集合、venue-guide 500：这一屏至少有一个数据源是「没取到」，
  // 不能落空态替主办方认领「没有提供展位图」。
  await expectQxWorkbench(page, 'map', 'error')
  await expect(page.getByTestId('fair-map-error')).toContainText('不代表主办方没有提供展位图')
  await expect(page.getByRole('button', { name: /查看可打印导览资料/ })).toBeVisible()
  await shot(page, 'qx-fair-map-guide-failed')
})

// ───────────────────────── 详情 subnav：failed ≠ 主办方没提供 ─────────────────

test('详情 subnav：子请求 500 时不说「主办方还没提供」 @kiosk', async ({ page, api }) => {
  registerFairApi(api, { companies: 'error', materials: 'error', stats: 'error' })
  await page.goto(`/job-fairs/${FAIR_ID}`)
  await expectQxWorkbench(page, 'detail', 'detail')
  for (const testId of ['fair-detail-companies', 'fair-detail-materials', 'fair-detail-stats']) {
    await expect(page.getByTestId(testId)).toContainText('这次没取到')
  }
  await expect(page.getByText('主办方还没有提供名单')).toHaveCount(0)
  await expect(page.getByText('主办方还没有回传统计')).toHaveCount(0)
  await shot(page, 'qx-fair-detail-subnav-failed')
})

// ───────────────────────────── 现场统计 /:id/stats ──────────────────────────────

test('现场统计 ready：可空指标各有 null 分支，不把「没有」写成 0 @kiosk', async ({ page, api }) => {
  registerFairApi(api, { stats: 'real' })
  await page.goto(`/job-fairs/${FAIR_ID}/stats`)
  await expectQxWorkbench(page, 'stats', 'ready')
  // 夹具：browseCount/checkinCount 有值，scanCount/printCount 是 null。
  // null 是「未接入」，不是 0 —— 两者对用户完全不同，所以那两块必须整块不出现。
  await expect(page.getByText('信息浏览')).toBeVisible()
  await expect(page.getByText('现场签到')).toBeVisible()
  await expect(page.getByText('二维码展示')).toHaveCount(0)
  await expect(page.getByText('资料打印')).toHaveCount(0)
  await expectKioskLayout(page)
  await shot(page, 'qx-fair-stats-ready')
})

test('现场统计 empty(mock)：商用模式不展示模拟统计 @kiosk', async ({ page, api }) => {
  registerFairApi(api, { stats: 'mock' })
  await page.goto(`/job-fairs/${FAIR_ID}/stats`)
  await expectQxWorkbench(page, 'stats', 'empty')
  await expect(page.getByTestId('fair-stats-empty')).toContainText('真实数据正在接入')
  await shot(page, 'qx-fair-stats-empty')
})

test('现场统计 error：不显示上一次的数字 @kiosk', async ({ page, api }) => {
  registerFairApi(api, { stats: 'error' })
  await page.goto(`/job-fairs/${FAIR_ID}/stats`)
  await expectQxWorkbench(page, 'stats', 'error')
  await expect(page.getByTestId('fair-stats-error')).toContainText('不显示上一次的数字')
  await shot(page, 'qx-fair-stats-error')
})

// ───────────────────────────── 稿面表的运行时对照 ───────────────────────────────

test('稿面 HEAD / PILL 表真的被壳消费，不是摆设 @kiosk', async ({ page, api }) => {
  registerFairApi(api)
  await page.goto('/job-fairs')
  // h1 与副标题直接取稿 HEAD；改了稿不改壳，这里会红。
  await expect(page.locator('.qx-pagehead h1')).toHaveText(FAIR_HEAD.list[0])
  await expect(page.locator('.qx-pagehead p')).toHaveText(FAIR_HEAD.list[1])
  await expect(page.locator('.qx-pill')).toHaveText(FAIR_PILL['list:ready'].label)
})
