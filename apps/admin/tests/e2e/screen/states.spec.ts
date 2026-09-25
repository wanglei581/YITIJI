import { test, expect } from '@playwright/test'
import {
  govDegraded,
  govEmpty,
  govHostingOff,
  govUnavailable,
  opsDegraded,
  opsHostingOff,
  opsNoDenominator,
  govStructuralGap,
  opsUnavailable,
  terminalTwinPrinterFailed,
  usageChannelsFailed,
  usageHostingOff,
  usageVisitsFailed,
} from './fixtures/snapshots'
import {
  adminApi,
  expectLocation,
  expectUrlStays,
  failure,
  open,
  panel,
  panelSources,
  serve,
  tile,
  uncaughtPageErrors,
  visibleDigits,
  type Responder,
} from './helpers'

/**
 * 管理员大屏状态矩阵。
 *
 * 每一条对着一种真实会发生的服务端回法，而不是对着当前实现写断言。尤其是
 * status=unavailable：那是 **HTTP 200**，只判 res.ok 的实现会在这里渲染出一屏空壳或一屏 0。
 * 失败的说法统一在 TwinShell：已有数据时保留旧值并出横幅，不用 0 顶替；401 不自动跳登录。
 */

const GOV_TITLE = '职易达 · 就业服务终端运行态势'
const OPS_TITLE = '终端运营看板'
const SNAPSHOT_URL = /^\/api\/v1\/admin\/screen\/snapshot\?profile=(gov|ops)$/

test.afterEach(async ({ page }) => {
  expect(uncaughtPageErrors(page), '页面不得有未捕获异常').toEqual([])
})

/** 先正常取数，flip() 之后改走 next —— 模拟挂在墙上的屏「取数成功之后」出事。 */
function flipAfterFirst(next: Responder): { responder: Responder; flip: () => void } {
  let healthy = true
  const happy = adminApi()
  return {
    responder: (url) => (healthy ? happy(url) : next(url)),
    flip: () => {
      healthy = false
    },
  }
}

test.describe('admin data screen states', () => {
  test('gov：真实数据上屏，七块面板都说得出口径，快照请求只带 profile', async ({ page }) => {
    const log = await serve(page, adminApi())
    await open(page, '/screen/gov')
    await expect(page.getByRole('heading', { name: GOV_TITLE })).toBeVisible()
    await expect(page.locator('.twin-panel')).toHaveCount(7)
    await expect(page.getByText('128,431')).toBeVisible()
    await expect(page.getByText('9,706')).toBeVisible()
    await expect(page.getByText('来自 23 家来源机构')).toBeVisible()
    // 分色恒不可用：屏上不能编出黑白 / 彩色各多少页
    await expect(page.locator('[data-ops-screen]')).not.toContainText(/黑白|彩色/)

    // 阳性对照：数值槽确实量得到读数，后面「一个数都没有」的断言才有意义
    const digits = await visibleDigits(page)
    expect(digits).toContain('128,431页')

    const sources = await panelSources(page)
    expect(sources.map((s) => s.title)).toHaveLength(7)
    for (const { title, source } of sources) expect(source, `「${title}」的口径说明不能为空`).toMatch(/[一-鿿]{4,}/)

    const snapshots = log.urls.filter((url) => url.includes('/snapshot'))
    expect(snapshots.length).toBeGreaterThan(0)
    for (const url of snapshots) expect(url, '快照请求只能带 profile=gov|ops').toMatch(SNAPSHOT_URL)
    expect(snapshots).toContain('/api/v1/admin/screen/snapshot?profile=gov')
    expect(log.urls.filter((url) => !url.includes('/snapshot')), '政务总览不该请求别的大屏接口').toEqual([])
  })

  test('ops：12 块含告警与成本；token / P95 不画成数字', async ({ page }) => {
    await serve(page, adminApi())
    await open(page, '/screen/ops')
    await expect(page.getByRole('heading', { name: OPS_TITLE })).toBeVisible()
    await expect(page.locator('.ops-card')).toHaveCount(12)
    await expect(page.getByText('97.5')).toBeVisible()
    await expect(page.getByText('¥38.74')).toBeVisible()
    await expect(page.getByText(/token 用量与 P95 延迟未接入/)).toBeVisible()
    const body = await page.locator('[data-ops-screen]').innerText()
    expect(body).not.toMatch(/输入 token|输出 token|P95 延迟\s*\n?\s*\d/)
  })

  test('非法 profile / 非法页签改写到政务总览，且不把非法值发给服务端', async ({ page }) => {
    const log = await serve(page, adminApi())
    await open(page, '/screen?profile=%E9%9D%9E%E6%B3%95%E5%80%BC')
    await expect(page.getByRole('heading', { name: GOV_TITLE })).toBeVisible()
    await expectLocation(page, '/screen/gov')
    await open(page, '/screen/%E9%9D%9E%E6%B3%95')
    await expect(page.getByRole('heading', { name: GOV_TITLE })).toBeVisible()
    await expectLocation(page, '/screen/gov')
    expect(log.urls.length).toBeGreaterThan(0)
    for (const url of log.urls) {
      expect(url).not.toContain('%E9%9D%9E')
      expect(url).toMatch(SNAPSHOT_URL)
    }
  })

  test('真实为零：显示 0 而不是「未接入」', async ({ page }) => {
    await serve(page, adminApi({ gov: govEmpty }))
    await open(page, '/screen/gov')
    const shelf = panel(page, '信息服务')
    await expect(tile(shelf, '岗位信息').locator('b')).toHaveText('0条')
    await expect(shelf.locator('.twin-na, .twin-pend')).toHaveCount(0)
    const summary = panel(page, '终端与服务')
    await expect(summary.locator('.twin-kv', { hasText: '累计打印' }).locator('b')).toHaveText('0页')
    await expect(summary.locator('.twin-kv', { hasText: 'AI 服务调用' }).locator('b')).toHaveText('0次')
    await expect(summary.locator('.twin-pend')).toHaveCount(0)
    // 近 14 日全是零：画真实的零线（今日 0），不是「未接入」
    const trend = panel(page, '打印量趋势')
    await expect(trend.locator('.twin-big')).toHaveText('0')
    await expect(trend.locator('.twin-na')).toHaveCount(0)
    await expect(trend.locator('svg path').first()).toBeAttached()
  })

  test('无分母：写「无调用」，绝不显示 0%', async ({ page }) => {
    await serve(page, adminApi({ ops: opsNoDenominator }))
    await open(page, '/screen/ops')
    await expect(page.getByText('近 24 小时无 AI 调用')).toBeVisible()
    await expect(page.getByText('近 24 小时无同步批次')).toBeVisible()
    const ai = page.locator('.ops-card').filter({ hasText: 'AI 成功率' })
    await expect(ai).not.toContainText('0%')
    await expect(page.getByText('当前没有正在发生的告警')).toBeVisible()
    await expect(page.getByText('近 30 日没有打开来源平台入口的记录')).toBeVisible()
  })

  test('局部失败（政务版）：失败块单独标注，其余数字仍真实', async ({ page }) => {
    await serve(page, adminApi({ gov: govDegraded }))
    await open(page, '/screen/gov')
    await expect(page.getByText(/部分数据源本次查询失败（3 项）/)).toBeVisible()
    // 趋势与 AI 分项是整块失败，实线「取数失败」；累计打印在总览块里只剩一个标记、不出数，AI 累计照常出数
    await expect(page.locator('.twin-na.is-failed')).toHaveCount(2)
    await expect(panel(page, '打印量趋势').locator('.twin-na.is-failed')).toContainText('取数失败')
    await expect(panel(page, 'AI 服务分项').locator('.twin-na.is-failed')).toContainText('取数失败')
    // 累计打印在总览块里只剩一个标记、不出数：这是本次取数失败，必须读作失败（朱色实线「暂时取不到」），不是「未接入」
    const printed = panel(page, '终端与服务').locator('.twin-kv', { hasText: '累计打印' })
    await expect(printed.locator('b')).toHaveCount(0)
    await expect(printed.locator('.twin-pend')).toHaveText('暂时取不到')
    await expect(printed.locator('.twin-pend')).toHaveClass(/\bis-failed\b/)
    await expect(printed.locator('.twin-pend')).toHaveAttribute('title', /^取数失败：/)
    await expect(printed).not.toContainText('未接入')
    await expect(page.getByText('9,706')).toBeVisible()
    await expect(page.getByText('128,431')).toHaveCount(0)
  })

  test('数字格上「暂时取不到」与「未接入」一眼可分：取数失败朱色实线，数据层缺口陶色虚线', async ({ page }) => {
    // 结构性缺口：累计打印写「未接入」，不带失败样式
    await serve(page, adminApi({ gov: govStructuralGap }))
    await open(page, '/screen/gov')
    const printed = panel(page, '终端与服务').locator('.twin-kv', { hasText: '累计打印' })
    await expect(printed.locator('.twin-pend')).toHaveText('未接入')
    await expect(printed.locator('.twin-pend')).not.toHaveClass(/\bis-failed\b/)
    await expect(printed.locator('.twin-pend')).toHaveCSS('border-top-style', 'dashed')
    await expect(page.getByText('9,706')).toBeVisible()
  })

  test('服务调用：下单渠道取数失败时，场景牌子写「暂时取不到」而不是「未接入」', async ({ page }) => {
    await serve(page, adminApi({ usage: usageChannelsFailed }))
    await open(page, '/screen/usage')
    await expect(panel(page, /^下单渠道$/).locator('.twin-na.is-failed')).toContainText('取数失败')
    for (const channel of ['一体机', '小程序']) {
      const pill = page.locator('.tw3-big .c', { has: page.locator('b', { hasText: new RegExp(`^${channel}$`) }) })
      await expect(pill.locator('span')).toHaveText('暂时取不到')
      await expect(pill).not.toContainText('未接入')
    }
  })

  test('服务调用：访问人次磁贴按原因区分「未接入」与「暂时取不到」', async ({ page }) => {
    await serve(page, adminApi())
    await open(page, '/screen/usage')
    const visits = tile(panel(page, /^下单渠道$/), '访问人次').locator('.twin-pend')
    await expect(visits).toHaveText('未接入')
    await expect(visits).not.toHaveClass(/\bis-failed\b/)

    await serve(page, adminApi({ usage: usageVisitsFailed }))
    await page.reload()
    await expect(visits).toHaveText('暂时取不到')
    await expect(visits).toHaveClass(/\bis-failed\b/)
    await expect(visits).toHaveCSS('border-top-style', 'solid')
  })

  test('终端孪生：打印机状态取数失败写「暂时取不到」，纸盒碳粉的数据层缺口仍是「待接入」', async ({ page }) => {
    await serve(page, adminApi({ twin: terminalTwinPrinterFailed }))
    await open(page, '/screen/terminal?id=t-gz-th-005')
    const printer = page.locator('.tw3-callout', { has: page.locator('.k', { hasText: /^打印机$/ }) })
    await expect(printer.locator('.twin-pend')).toHaveText('暂时取不到')
    await expect(printer.locator('.twin-pend')).toHaveClass(/\bis-failed\b/)
    await expect(printer).toHaveClass(/\bis-err\b/)
    const supplies = page.locator('.tw3-callout', { has: page.locator('.k', { hasText: /^纸盒与碳粉$/ }) })
    await expect(supplies.locator('.twin-pend')).toHaveText('待接入 · 需 Agent 上报')
    await expect(supplies.locator('.twin-pend')).not.toHaveClass(/\bis-failed\b/)
  })

  test('局部失败（运营版）：取数失败与结构性未接入长得不一样', async ({ page }) => {
    await serve(page, adminApi({ ops: opsDegraded }))
    await open(page, '/screen/ops')
    await expect(page.getByText(/部分数据源本次查询失败（3 项）/)).toBeVisible()
    await expect(page.locator('.ops-card.is-failed')).toHaveCount(3)
    // 审核时效是数据层缺口，不是本次故障：虚线未接入，不能混成失败
    await expect(page.locator('.ops-card.is-na:not(.is-failed)')).toHaveCount(1)
    await expect(page.locator('.ops-card.is-na:not(.is-failed)')).toContainText('审核时效')
    await expect(page.getByText('¥38.74')).toBeVisible()
  })

  test('status=unavailable 走的是 HTTP 200，数值槽里不能出现任何数字', async ({ page }) => {
    await serve(page, adminApi({ gov: govUnavailable, ops: opsUnavailable }))
    await open(page, '/screen/gov')
    await expect(page.getByText(/本次快照的全部数据源均查询失败/)).toBeVisible()
    await expect(page.locator('.twin-na.is-failed').first()).toBeVisible()
    const digits = await visibleDigits(page)
    expect(digits, `全部失败时不该出现任何指标读数：${JSON.stringify(digits)}`).toEqual([])
  })

  test('401：不跳登录页，就地给「重新登录」，地址不动', async ({ page }) => {
    await serve(page, () => failure(401, 'AUTH_TOKEN_INVALID', 'Token 无效或已过期'))
    await open(page, '/screen/gov')
    await expect(page.getByText('登录已过期')).toBeVisible()
    await expect(page.getByRole('button', { name: '重新登录' })).toBeVisible()
    await expectUrlStays(page)
    await expectLocation(page, '/screen/gov')
    expect(await visibleDigits(page)).toEqual([])
  })

  test('401 在展示档：同样就地给「重新登录」，地址仍带 display=1', async ({ page }) => {
    await serve(page, () => failure(401, 'AUTH_TOKEN_INVALID', 'Token 无效或已过期'))
    await open(page, '/screen/gov?display=1')
    await expect(page.getByText('登录已过期')).toBeVisible()
    await expect(page.getByRole('button', { name: '重新登录' })).toBeVisible()
    await expectUrlStays(page)
    await expectLocation(page, '/screen/gov', { display: '1' })
  })

  test('403：按角色文案提示，不误导成网络故障', async ({ page }) => {
    await serve(page, () => failure(403, 'AUTH_ROLE_FORBIDDEN', '当前角色无权访问 (需要: admin)'))
    await open(page, '/screen/gov')
    await expect(page.getByText('无权查看本大屏')).toBeVisible()
    await expect(page.getByText('当前账号没有查看管理员数据大屏的权限')).toBeVisible()
    await expect(page.getByText('与服务器断开')).toHaveCount(0)
  })

  test('网络失败：没有任何成功数据时不显示数值，给重试', async ({ page }) => {
    await serve(page, () => 'abort')
    await open(page, '/screen/gov')
    await expect(page.getByText('与服务器断开')).toBeVisible()
    await expect(page.getByRole('button', { name: '重试' })).toBeVisible()
    expect(await visibleDigits(page)).toEqual([])
  })

  test('服务端 500：说「获取失败」，英文技术串不上屏，不显示数值', async ({ page }) => {
    await serve(page, () => failure(500, 'INTERNAL_ERROR', 'Internal server error'))
    await open(page, '/screen/gov')
    await expect(page.getByText('大屏数据获取失败', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '重试' })).toBeVisible()
    await expect(page.locator('[data-ops-screen]')).not.toContainText('Internal server error')
    expect(await visibleDigits(page)).toEqual([])
  })

  test('陈旧数据：刷新失败（500）后保留上次成功值，横幅写明是哪一刻的数', async ({ page }) => {
    const { responder, flip } = flipAfterFirst(() => failure(500, 'INTERNAL_ERROR', 'Internal server error'))
    await serve(page, responder)
    await open(page, '/screen/gov')
    await expect(page.getByText('128,431')).toBeVisible()
    const stamp = (await page.locator('.twin-hd-sub').innerText()).match(/数据时间 (\S+ \S+)/)?.[1]
    expect(stamp, '页眉应写出数据时间').toBeTruthy()
    flip()
    await page.getByRole('button', { name: '刷新' }).click()
    const banner = page.locator('.twin-banner', { hasText: '最近一次刷新失败' })
    await expect(banner).toBeVisible()
    // 旧数不清成 0 或空，横幅说清屏上是哪一刻取到的
    await expect(banner).toContainText(`屏上是 ${stamp} 取到的数据`)
    await expect(page.getByText('128,431')).toBeVisible()
  })

  test('陈旧数据：刷新时断网，保留上次成功值并声明没有用 0 代替', async ({ page }) => {
    const { responder, flip } = flipAfterFirst(() => 'abort')
    await serve(page, responder)
    await open(page, '/screen/gov')
    await expect(page.getByText('128,431')).toBeVisible()
    flip()
    await page.getByRole('button', { name: '刷新' }).click()
    const banner = page.locator('.twin-banner', { hasText: '与服务器断开' })
    await expect(banner).toBeVisible()
    await expect(banner).toContainText('没有用 0 代替')
    await expect(page.getByText('128,431')).toBeVisible()
  })

  /**
   * 会话是在**已经有数据之后**过期的 —— 挂在墙上的那台机器的常态。
   * consoleScreen.ts 写死了 401 不自动跳登录（无人看管的墙上硬跳会变成一张登录表单），
   * 代价是页面必须说清原因并给动作。两件事同时成立：上次成功的数字不许被清成 0，
   * 且必须说得出是登录过期并给出动作。
   */
  test('会话在取数成功之后过期：保留上次数值，同时说清是登录过期并给动作', async ({ page }) => {
    const { responder, flip } = flipAfterFirst(() => failure(401, 'AUTH_TOKEN_INVALID', 'Token 无效或已过期'))
    await serve(page, responder)
    await open(page, '/screen/gov')
    await expect(page.getByText('128,431')).toBeVisible()
    flip()
    await page.getByRole('button', { name: '刷新' }).click()
    const banner = page.locator('.twin-banner', { hasText: '登录已过期' })
    await expect(banner).toBeVisible()
    await expect(banner).toContainText('屏上数字停在上一次成功取数的时刻')
    await expect(page.getByText('128,431')).toBeVisible()
    await expect(banner.getByRole('button', { name: '重新登录' })).toBeVisible()
    await expectUrlStays(page)
    await expectLocation(page, '/screen/gov')
  })

  test('权限在取数成功之后被撤：保留上次数值，同时说清是权限问题', async ({ page }) => {
    const { responder, flip } = flipAfterFirst(() => failure(403, 'AUTH_ROLE_FORBIDDEN', '当前角色无权访问 (需要: admin)'))
    await serve(page, responder)
    await open(page, '/screen/gov')
    await expect(page.getByText('128,431')).toBeVisible()
    flip()
    await page.getByRole('button', { name: '刷新' }).click()
    const banner = page.locator('.twin-banner', { hasText: '已无权查看本大屏' })
    await expect(banner).toBeVisible()
    await expect(banner).toContainText('当前账号没有查看管理员数据大屏的权限')
    await expect(page.getByText('128,431')).toBeVisible()
  })

  test('列表截断如实说明；访问口径上屏', async ({ page }) => {
    await serve(page, adminApi())
    await open(page, '/screen/ops')
    // 定高卡只画得下 4 行，说明行必须按实际画出来的行数报，不能照抄服务端的 6
    await expect(page.getByText('已列出 4 / 共 137 条')).toBeVisible()
    await expect(page.getByText('访问口径：仅已登录后台会话可见，本期未签发免登录只读展示令牌')).toBeVisible()
  })

  test('招聘内容托管关闭：岗位、招聘会、企业写「未开启」，不是 0 也不是「少于 5」，政策照常出数', async ({ page }) => {
    await serve(page, adminApi({ gov: govHostingOff, ops: opsHostingOff, usage: usageHostingOff }))
    await open(page, '/screen/gov')
    const shelf = panel(page, '信息服务')
    for (const label of ['岗位信息', '招聘会', '企业展示']) {
      const cell = tile(shelf, label)
      await expect(cell.locator('.twin-pend')).toHaveText('未开启')
      await expect(cell.locator('.twin-pend')).toHaveAttribute('title', /^招聘内容托管未开启：/)
      await expect(cell.locator('b')).toHaveCount(0)
      await expect(cell).not.toContainText(/\d|少于/)
    }
    await expect(tile(shelf, '政策公告').locator('b')).toHaveText('216条')
    await expect(shelf).not.toContainText(/来自 \d+ 家/)
    // 来源平台访问取自运营快照，托管关闭时整块说明未开启
    await expect(panel(page, '来源平台访问').locator('.twin-na')).toContainText('招聘内容托管未开启')

    await page.getByRole('link', { name: '服务调用' }).click()
    await expectLocation(page, '/screen/usage')
    const browse = panel(page, '信息内容浏览')
    for (const label of ['招聘会', '企业展示']) {
      await expect(tile(browse, label).locator('.twin-pend')).toHaveText('未开启')
      await expect(tile(browse, label)).not.toContainText(/\d|少于/)
    }
    await expect(tile(browse, '政策服务').locator('b')).toHaveText('412')

    await page.getByRole('link', { name: '运营看板' }).click()
    await expectLocation(page, '/screen/ops')
    for (const title of ['打开来源平台入口', '招聘会结构']) {
      await expect(page.locator('.ops-card').filter({ hasText: title }).locator('.ops-na')).toContainText('招聘内容托管未开启')
    }
  })
})
