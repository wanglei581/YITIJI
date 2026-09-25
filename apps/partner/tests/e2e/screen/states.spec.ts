import { test, expect } from '@playwright/test'
import { partnerDegraded, partnerHostingOff, partnerTruncated, partnerUsageHostingOff } from './fixtures/snapshots'
import {
  expectLocation,
  expectUrlStays,
  failure,
  open,
  panel,
  panelSources,
  partnerApi,
  serve,
  tile,
  uncaughtPageErrors,
  visibleDigits,
  type Responder,
} from './helpers'

/**
 * 机构大屏状态矩阵。机构端两件别处没有的事：
 *   1. 请求里一个机构标识都不能有（服务端空白名单 + forbidNonWhitelisted，orgId 更是跨机构风险面）；
 *   2. 机队分类是样本内计数，截断时必须写明样本口径，不能当成全量。
 * 失败说法与管理员共用 TwinShell：旧数据保留、横幅说清；401 不跳转；ORG_REQUIRED 与角色不符分开说。
 */

const TITLE = '本机构运营概览'
const SNAPSHOT = '/api/v1/partner/screen/snapshot'

test.afterEach(async ({ page }) => {
  expect(uncaughtPageErrors(page), '页面不得有未捕获异常').toEqual([])
})

/** 先正常取数，flip() 之后改走 next —— 模拟挂在机构办公室墙上的屏「取数成功之后」出事。 */
function flipAfterFirst(next: Responder): { responder: Responder; flip: () => void } {
  let healthy = true
  const happy = partnerApi()
  return {
    responder: (url) => (healthy ? happy(url) : next(url)),
    flip: () => {
      healthy = false
    },
  }
}

test.describe('partner data screen states', () => {
  test('真实数据：七块面板都说得出口径，未接入的 14 项按原因归并，快照请求不带任何 query', async ({ page }) => {
    const log = await serve(page, partnerApi())
    await open(page, '/screen/overview')
    await expect(page.getByRole('heading', { name: TITLE, exact: true })).toBeVisible()
    await expect(page.locator('.twin-panel')).toHaveCount(7)
    const shelf = panel(page, /^本机构在架信息$/)
    await expect(tile(shelf, '岗位信息').locator('b')).toHaveText('328条')
    // 归并面板如实标注项数，不造成「已全部接入」的错觉；14 项、6 种原因，每项都点得出原因
    const gaps = panel(page, /^建设中的指标$/)
    await expect(gaps.locator('.twin-ph-sub')).toHaveText(/^14 项/)
    const chips = gaps.locator('.twin-pend')
    await expect(chips).toHaveCount(14)
    const reasons = new Set(await chips.evaluateAll((els) => els.map((el) => el.getAttribute('title') ?? '')))
    expect(reasons.size, '14 项按 6 种原因归并，原因一条不少').toBe(6)
    for (const reason of reasons) expect(reason).toMatch(/[一-鿿]{6,}/)

    expect(await visibleDigits(page)).toContain('328条')
    const sources = await panelSources(page)
    expect(sources).toHaveLength(7)
    for (const { title, source } of sources) expect(source, `「${title}」的口径说明不能为空`).toMatch(/[一-鿿]{4,}/)

    expect(log.urls.length).toBeGreaterThan(0)
    expect(log.urls, '机构快照请求必须是无参数的裸路径').toEqual(log.urls.map(() => SNAPSHOT))
  })

  test('不渲染来源机构数（对机构自己恒为 0 或 1，没有信息量且易被误读）', async ({ page }) => {
    await serve(page, partnerApi())
    await open(page, '/screen/overview')
    const shelf = panel(page, /^本机构在架信息$/)
    await expect(shelf.locator('.twin-tile')).toHaveCount(4)
    // 口径说明里写「来源机构为本机构」是对的；不能出现的是「来自 N 家」这种计数
    await expect(page.locator('[data-ops-screen]')).not.toContainText(/来自 \d+ 家/)
    await expect(shelf.locator('.twin-cap')).toHaveText('已审核通过、已发布且在有效期内')
    await shelf.getByRole('button', { name: '本机构在架信息的口径说明' }).click()
    await expect(shelf.locator('.twin-pop')).toContainText('来源机构为本机构')
  })

  test('机队截断：写明「前 200 台样本 / 共 640 台」，环的分母是样本台数', async ({ page }) => {
    await serve(page, partnerApi({ snapshot: partnerTruncated }))
    await open(page, '/screen/overview')
    const online = panel(page, /^本机构终端$/)
    // 分母是样本台数而不是 640
    await expect(online.locator('.twin-ring-cap')).toHaveText('正常 · 共 200 台')
    await expect(online.locator('.twin-cap')).toHaveText('只统计登记在本机构名下的终端（显示前 200 台，共 640 台）')
    await expect(page.locator('.twin-overlay.is-tl')).toContainText('（显示前 200 台）')
    await online.getByRole('button', { name: '本机构终端的口径说明' }).click()
    await expect(online.locator('.twin-pop')).toContainText('以下分类基于前 200 台样本，本机构共 640 台')
  })

  test('局部失败：同步成功率单独标注取数失败，在架条数仍真实', async ({ page }) => {
    await serve(page, partnerApi({ snapshot: partnerDegraded }))
    await open(page, '/screen/overview')
    await expect(page.getByText(/部分数据源本次查询失败（1 项）/)).toBeVisible()
    await expect(page.locator('.twin-na.is-failed')).toHaveCount(1)
    await expect(panel(page, /^数据同步$/).locator('.twin-na.is-failed')).toContainText('取数失败')
    await expect(tile(panel(page, /^本机构在架信息$/), '岗位信息').locator('b')).toHaveText('328条')
  })

  test('403 ORG_REQUIRED 与角色不符分开提示', async ({ page }) => {
    await serve(page, () => failure(403, 'ORG_REQUIRED', '当前账号未绑定机构'))
    await open(page, '/screen/overview')
    const state = page.locator('.twin-state')
    await expect(state.locator('b')).toHaveText('当前账号未绑定机构')
    await expect(state).toContainText('请联系平台侧为该账号绑定机构')
    await expect(page.getByText(/无权查看/)).toHaveCount(0)
    expect(await visibleDigits(page)).toEqual([])
  })

  test('403 角色不符：说「无权查看本大屏」，不混成机构归属或网络故障', async ({ page }) => {
    await serve(page, () => failure(403, 'AUTH_ROLE_FORBIDDEN', '当前角色无权访问'))
    await open(page, '/screen/overview')
    const state = page.locator('.twin-state')
    await expect(state.locator('b')).toHaveText('无权查看本大屏')
    await expect(state).toContainText('当前账号没有查看机构数据大屏的权限')
    await expect(page.getByText('当前账号未绑定机构')).toHaveCount(0)
    await expect(page.getByText('与服务器断开')).toHaveCount(0)
  })

  test('401 不跳登录页：就地给「重新登录」，地址不动', async ({ page }) => {
    await serve(page, () => failure(401, 'AUTH_TOKEN_INVALID', 'Token 无效或已过期'))
    await open(page, '/screen/overview')
    await expect(page.getByText('登录已过期')).toBeVisible()
    await expect(page.getByRole('button', { name: '重新登录' })).toBeVisible()
    await expectUrlStays(page)
    await expectLocation(page, '/screen/overview')
  })

  test('401 在展示档：同样就地给「重新登录」，地址仍带 display=1', async ({ page }) => {
    await serve(page, () => failure(401, 'AUTH_TOKEN_INVALID', 'Token 无效或已过期'))
    await open(page, '/screen/overview?display=1')
    await expect(page.getByText('登录已过期')).toBeVisible()
    await expect(page.getByRole('button', { name: '重新登录' })).toBeVisible()
    await expectUrlStays(page)
    await expectLocation(page, '/screen/overview', { display: '1' })
  })

  test('网络失败没有历史数据时不显示任何数值', async ({ page }) => {
    await serve(page, () => 'abort')
    await open(page, '/screen/overview')
    await expect(page.getByText('与服务器断开')).toBeVisible()
    await expect(page.getByRole('button', { name: '重试' })).toBeVisible()
    expect(await visibleDigits(page)).toEqual([])
  })

  test('服务端 500：说「获取失败」，英文技术串不上屏，不显示数值', async ({ page }) => {
    await serve(page, () => failure(500, 'INTERNAL_ERROR', 'Internal server error'))
    await open(page, '/screen/overview')
    await expect(page.getByText('大屏数据获取失败', { exact: true })).toBeVisible()
    await expect(page.locator('[data-ops-screen]')).not.toContainText('Internal server error')
    expect(await visibleDigits(page)).toEqual([])
  })

  test('陈旧数据：刷新失败（500）后保留上次成功值，横幅写明是哪一刻的数', async ({ page }) => {
    const { responder, flip } = flipAfterFirst(() => failure(500, 'INTERNAL_ERROR', 'Internal server error'))
    await serve(page, responder)
    await open(page, '/screen/overview')
    const jobs = tile(panel(page, /^本机构在架信息$/), '岗位信息').locator('b')
    await expect(jobs).toHaveText('328条')
    const stamp = (await page.locator('.twin-hd-sub').innerText()).match(/数据时间 (\S+ \S+)/)?.[1]
    expect(stamp, '页眉应写出数据时间').toBeTruthy()
    flip()
    await page.getByRole('button', { name: '刷新', exact: true }).click()
    const banner = page.locator('.twin-banner', { hasText: '最近一次刷新失败' })
    await expect(banner).toBeVisible()
    await expect(banner).toContainText(`屏上是 ${stamp} 取到的数据`)
    await expect(jobs).toHaveText('328条')
  })

  /**
   * 会话是在**已经有数据之后**过期的 —— 挂在机构办公室墙上的那台屏的常态。401 不自动跳登录
   * （无人看管的墙上硬跳会变成一张登录表单），代价是页面必须自己说清原因并给动作。
   * 两件事同时成立：上次成功的数字不许被清成 0，且说得出是登录过期并给出动作。
   */
  test('会话在取数成功之后过期：保留上次数值，同时说清是登录过期并给动作', async ({ page }) => {
    const { responder, flip } = flipAfterFirst(() => failure(401, 'AUTH_TOKEN_INVALID', 'Token 无效或已过期'))
    await serve(page, responder)
    await open(page, '/screen/overview')
    const jobs = tile(panel(page, /^本机构在架信息$/), '岗位信息').locator('b')
    await expect(jobs).toHaveText('328条')
    flip()
    await page.getByRole('button', { name: '刷新', exact: true }).click()
    const banner = page.locator('.twin-banner', { hasText: '登录已过期' })
    await expect(banner).toBeVisible()
    await expect(banner).toContainText('屏上数字停在上一次成功取数的时刻')
    await expect(jobs).toHaveText('328条')
    await expect(banner.getByRole('button', { name: '重新登录' })).toBeVisible()
    await expectUrlStays(page)
    await expectLocation(page, '/screen/overview')
  })

  test('权限在取数成功之后被撤：保留上次数值，同时说清是权限问题', async ({ page }) => {
    const { responder, flip } = flipAfterFirst(() => failure(403, 'AUTH_ROLE_FORBIDDEN', '当前角色无权访问'))
    await serve(page, responder)
    await open(page, '/screen/overview')
    const jobs = tile(panel(page, /^本机构在架信息$/), '岗位信息').locator('b')
    await expect(jobs).toHaveText('328条')
    flip()
    await page.getByRole('button', { name: '刷新', exact: true }).click()
    const banner = page.locator('.twin-banner', { hasText: '无权查看本大屏' })
    await expect(banner).toBeVisible()
    await expect(banner).toContainText('屏上数字停在权限或机构归属变更前的最后一次成功取数')
    await expect(banner).toContainText('当前账号没有查看机构数据大屏的权限')
    await expect(jobs).toHaveText('328条')
  })

  /**
   * ORG_REQUIRED 在有数据之后发生（机构归属被解绑）：与「角色不符」必须分开说。
   * 机构管理员看到「无权限」会去找平台开权限，而真实动作是让平台重新绑定机构。
   */
  test('机构归属在取数成功之后被解绑：保留上次数值，且与角色不符分开提示', async ({ page }) => {
    const { responder, flip } = flipAfterFirst(() => failure(403, 'ORG_REQUIRED', '当前账号未绑定机构'))
    await serve(page, responder)
    await open(page, '/screen/overview')
    const jobs = tile(panel(page, /^本机构在架信息$/), '岗位信息').locator('b')
    await expect(jobs).toHaveText('328条')
    flip()
    await page.getByRole('button', { name: '刷新', exact: true }).click()
    const banner = page.locator('.twin-banner', { hasText: '当前账号未绑定机构' })
    await expect(banner).toBeVisible()
    await expect(banner).toContainText('请联系平台侧为该账号绑定机构')
    await expect(banner).not.toContainText('无权查看')
    await expect(jobs).toHaveText('328条')
  })

  test('招聘内容托管关闭：岗位、招聘会、企业写「未开启」，不是 0 也不是「少于 5」，政策照常出数', async ({ page }) => {
    await serve(page, partnerApi({ snapshot: partnerHostingOff, usage: partnerUsageHostingOff }))
    await open(page, '/screen/overview')
    const shelf = panel(page, /^本机构在架信息$/)
    for (const label of ['岗位信息', '招聘会', '企业资料']) {
      const cell = tile(shelf, label)
      await expect(cell.locator('.twin-pend')).toHaveText('未开启')
      await expect(cell.locator('.twin-pend')).toHaveAttribute('title', /^招聘内容托管未开启：/)
      await expect(cell.locator('b')).toHaveCount(0)
      await expect(cell).not.toContainText(/\d|少于/)
    }
    await expect(tile(shelf, '政策公告').locator('b')).toHaveText('9条')
    await expect(panel(page, /^招聘会$/).locator('.twin-na')).toContainText('招聘内容托管未开启')
    // 待审里还有岗位与企业的存量：说明那是存量，不是还在审
    await expect(panel(page, /^待审核$/)).toContainText('岗位、招聘会、企业资料在本平台云端已停止审核发布，这里是存量')

    await page.getByRole('navigation', { name: '大屏页签' }).getByRole('link', { name: '信息使用', exact: true }).click()
    await expectLocation(page, '/screen/usage')
    // 场景里三类照样占位，写「未开启」、不连线；政策照常出数
    for (const label of ['岗位信息', '招聘会', '企业资料']) {
      const pill = page.locator('.tw3-svc .c', { has: page.locator('b', { hasText: new RegExp(`^${label}$`) }) })
      await expect(pill).toHaveCount(1)
      await expect(pill.locator('span')).toHaveText('未开启')
    }
    await expect(page.locator('.tw3-svc .c', { hasText: '政策公告' }).locator('span')).toHaveText('浏览 21')
    const byType = panel(page, /^按信息类型$/)
    for (const label of ['岗位信息', '招聘会', '企业资料']) {
      await expect(tile(byType, label).locator('.twin-pend')).toHaveText('未开启')
      await expect(tile(byType, label)).not.toContainText(/\d|少于/)
    }
    await expect(tile(byType, '政策公告').locator('b')).toHaveText('21次浏览')
  })
})
