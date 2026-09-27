import { test, expect, type Locator, type Page } from '@playwright/test'
import { DISTRICTS, SERVICE_LABELS } from './fixtures/snapshots'
import { adminApi, expectLocation, open, panel, serve, serveHappy, tile, uncaughtPageErrors } from './helpers'
import { blockedSceneButtons, keyboardFocus } from './measure'

/**
 * 页签地址、两档（桌面 / 展示）、轻量模式、区名牌、告警行、「少于 5」、请求形状。
 * 这些是数字孪生改版后的产品口径：每个页签一个地址，展示档是同一地址加 display=1。
 */

const GOV_TITLE = '职易达 · 就业服务终端运行态势'
const USAGE_TITLE = '职易达 · 系统使用与服务调用态势'
const OPS_TITLE = '终端运营看板'
const TERMINAL_TITLE = '终端数字孪生'

interface TabCase {
  key: 'gov' | 'usage' | 'ops' | 'terminal'
  label: string
  title: string
  /** 只有这个页签才有的内容，证明换的不只是标题。 */
  marker: (page: Page) => Locator
}

const TABS: TabCase[] = [
  { key: 'gov', label: '政务总览', title: GOV_TITLE, marker: (page) => panel(page, /^终端与服务$/) },
  { key: 'usage', label: '服务调用', title: USAGE_TITLE, marker: (page) => panel(page, /^下单渠道$/) },
  { key: 'ops', label: '运营看板', title: OPS_TITLE, marker: (page) => page.locator('.ops-card').filter({ hasText: '在网终端' }) },
  { key: 'terminal', label: '终端孪生', title: TERMINAL_TITLE, marker: (page) => panel(page, /^设备概况$/) },
]

function tabLink(page: Page, label: string): Locator {
  return page.getByRole('navigation', { name: '大屏页签' }).getByRole('link', { name: label, exact: true })
}

test.afterEach(async ({ page }) => {
  expect(uncaughtPageErrors(page), '页面不得有未捕获异常').toEqual([])
})

test.describe('admin screen navigation', () => {
  test('每个页签有独立地址：点页签，地址与内容一起变；筛选不跟着走', async ({ page }) => {
    await serveHappy(page)
    await open(page, '/screen/gov?area=%E6%B5%B7%E7%8F%A0%E5%8C%BA&status=alert')
    for (const tab of [TABS[1], TABS[2], TABS[3], TABS[0]]) {
      const link = tabLink(page, tab.label)
      await expect(link).toHaveAttribute('href', `/screen/${tab.key}`)
      await link.click()
      await expectLocation(page, `/screen/${tab.key}`)
      await expect(page.getByRole('heading', { name: tab.title, exact: true })).toBeVisible()
      await expect(tab.marker(page)).toBeVisible()
      await expect(link).toHaveAttribute('aria-current', 'page')
      for (const other of TABS.filter((t) => t.key !== tab.key)) {
        await expect(tabLink(page, other.label)).not.toHaveAttribute('aria-current', 'page')
      }
    }
  })

  test('展示档里换页签：display=1 与 lite=1 跟着走，筛选不跟', async ({ page }) => {
    await serveHappy(page)
    await open(page, '/screen/gov?display=1&lite=1&area=%E6%B5%B7%E7%8F%A0%E5%8C%BA')
    await tabLink(page, '运营看板').click()
    await expectLocation(page, '/screen/ops', { display: '1', lite: '1' })
    await expect(page.getByRole('heading', { level: 1, name: OPS_TITLE })).toBeVisible()
    await tabLink(page, '服务调用').click()
    await expectLocation(page, '/screen/usage', { display: '1', lite: '1' })
    await expect(page.getByRole('heading', { level: 1, name: USAGE_TITLE })).toBeVisible()
  })

  test('旧地址就地改写成规范地址', async ({ page }) => {
    await serveHappy(page)
    const cases: Array<[string, string, Record<string, string>, string]> = [
      ['/screen', '/screen/gov', {}, GOV_TITLE],
      ['/screen?profile=gov', '/screen/gov', {}, GOV_TITLE],
      ['/screen?profile=ops', '/screen/ops', {}, OPS_TITLE],
      ['/screen?profile=ops&display=1', '/screen/ops', { display: '1' }, OPS_TITLE],
      ['/screen/overview', '/screen/gov', {}, GOV_TITLE],
    ]
    for (const [from, pathname, query, title] of cases) {
      await open(page, from)
      await expectLocation(page, pathname, query)
      await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
    }
  })

  for (const tab of TABS) {
    test(`${tab.label}：桌面档页眉是 h2，全页唯一 h1 是后台页头，有筛选栏`, async ({ page }) => {
      await serveHappy(page)
      await open(page, `/screen/${tab.key}`)
      await expect(tab.marker(page)).toBeVisible()
      await expect(page.locator("[data-ops-screen='desk']")).toBeVisible()
      await expect(page.locator('h1')).toHaveCount(1)
      await expect(page.locator('h1')).toHaveText('数据大屏')
      await expect(page.locator('.twin-hd h2')).toHaveText(tab.title)
      await expect(page.locator('.twin-hd h1')).toHaveCount(0)
      // 面板标题比页眉低一级（h3），不跳级
      await expect(page.locator('.twin-panel h2')).toHaveCount(0)
      await expect(page.locator('.twin-toolbar')).toBeVisible()
      for (const name of ['刷新', '关闭动效', '轻量模式', '新窗口展示']) {
        await expect(page.locator('.twin-toolbar').getByRole('button', { name, exact: true })).toBeVisible()
      }
      await expect(page.getByRole('button', { name: '全屏', exact: true })).toHaveCount(0)
      await expect(page.getByRole('button', { name: '退出展示', exact: true })).toHaveCount(0)
      // 降级成 h2 不能掉回浏览器默认字号 / 外边距 —— 那是一次真实的像素回归
      const deskStyle = await page.locator('.twin-hd h2').evaluate((el) => {
        const style = getComputedStyle(el)
        return { fontSize: style.fontSize, marginTop: style.marginTop, marginBottom: style.marginBottom }
      })
      expect(deskStyle, '桌面档标题 22px 且外边距被重置').toEqual({ fontSize: '22px', marginTop: '0px', marginBottom: '0px' })
    })

    test(`${tab.label}：展示档没有筛选栏，恰好一个 h1，有「全屏」「退出展示」`, async ({ page }) => {
      await serveHappy(page)
      await open(page, `/screen/${tab.key}?display=1`)
      await expect(tab.marker(page)).toBeVisible()
      await expect(page.locator("[data-ops-screen='wall']")).toBeVisible()
      await expect(page.locator('h1')).toHaveCount(1)
      await expect(page.getByRole('heading', { level: 1, name: tab.title, exact: true })).toBeVisible()
      await expect(page.locator('.twin-hd h2')).toHaveCount(0)
      await expect(page.locator('.twin-panel h3')).toHaveCount(0)
      await expect(page.locator('.twin-toolbar')).toHaveCount(0)
      for (const name of ['刷新', '关闭动效', '轻量模式', '新窗口展示']) {
        await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0)
      }
      const actions = page.locator('.twin-hd .twin-actions')
      await expect(actions.getByRole('button', { name: '全屏', exact: true })).toBeVisible()
      await expect(actions.getByRole('button', { name: '退出展示', exact: true })).toBeVisible()
      const wallFontSize = await page.locator('.twin-hd h1').evaluate((el) => getComputedStyle(el).fontSize)
      expect(wallFontSize, '舞台档标题 30px').toBe('30px')
      // 1920×1080 舞台按视口等比缩放；1920×1080 视口下正好 1:1
      const view = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }))
      const scale = Math.min(view.w / 1920, view.h / 1080)
      const stage = await page.locator('.ops-stage').boundingBox()
      expect(stage).not.toBeNull()
      expect(stage!.width).toBeCloseTo(1920 * scale, 0)
      expect(stage!.height).toBeCloseTo(1080 * scale, 0)
    })
  }

  test('退出展示：回到桌面档，地址去掉 display、其余参数保留；Esc 同样退出', async ({ page }) => {
    await serveHappy(page)
    await open(page, '/screen/gov?display=1&area=%E6%B5%B7%E7%8F%A0%E5%8C%BA')
    await page.getByRole('button', { name: '退出展示', exact: true }).click()
    await expectLocation(page, '/screen/gov', { area: '海珠区' })
    await expect(page.locator('h1')).toHaveText('数据大屏')
    await expect(page.locator('.twin-hd h2')).toHaveText(GOV_TITLE)
    await expect(page.locator('.twin-toolbar')).toBeVisible()

    await open(page, '/screen/usage?display=1&range=7d')
    await expect(page.getByRole('heading', { level: 1, name: USAGE_TITLE })).toBeVisible()
    await page.keyboard.press('Escape')
    await expectLocation(page, '/screen/usage', { range: '7d' })
    await expect(page.locator('.twin-toolbar')).toBeVisible()
  })

  test('新窗口展示：同一地址加 display=1 开出舞台，筛选条件原样带过去', async ({ page }) => {
    await serveHappy(page)
    await open(page, '/screen/gov?area=%E6%B5%B7%E7%8F%A0%E5%8C%BA&status=alert')
    const popupPromise = page.context().waitForEvent('page')
    await page.getByRole('button', { name: '新窗口展示', exact: true }).click()
    const popup = await popupPromise
    await popup.waitForLoadState('domcontentloaded')
    await expectLocation(popup, '/screen/gov', { area: '海珠区', status: 'alert', display: '1' })
    await expect(popup.locator("[data-ops-screen='wall']")).toBeVisible()
    await expect(popup.getByRole('heading', { level: 1, name: GOV_TITLE })).toBeVisible()
    await expect(panel(popup, /^海珠区终端$/)).toBeVisible()
    await expect(popup.getByRole('button', { name: '退出展示', exact: true })).toBeVisible()
    // 原窗口不动
    await expectLocation(page, '/screen/gov', { area: '海珠区', status: 'alert' })
  })

  for (const display of [false, true]) {
    test(`轻量模式（${display ? '展示档' : '桌面档'}）：3D 城区换成平面机队格子墙`, async ({ page }) => {
      await serveHappy(page)
      await open(page, display ? '/screen/gov?lite=1&display=1' : '/screen/gov?lite=1')
      const wall = page.locator('.ops-fleet')
      await expect(wall).toBeVisible()
      await expect(wall.locator('.ops-d')).toHaveCount(42)
      await expect(page.locator('.twin')).toHaveAttribute('data-lite', '1')
      await expect(page.locator('.tw3-box, .tw3-scene, .tw3-world, .tw3-district-btn')).toHaveCount(0)
      if (!display) {
        const toggle = page.getByRole('button', { name: '轻量模式', exact: true })
        await expect(toggle).toHaveAttribute('aria-pressed', 'true')
        await toggle.click()
        await expectLocation(page, '/screen/gov')
        await expect(page.locator('.tw3-scene')).toBeVisible()
        await expect(page.locator('.ops-fleet')).toHaveCount(0)
      }
    })
  }

  test('轻量模式下服务调用不画 3D 网络，改画条形图，条目与 3D 网络同一套中文服务名', async ({ page }) => {
    await serveHappy(page)
    // 先看完整视图：3D 网络里每项服务的中文名
    await open(page, '/screen/usage')
    const pills = page.locator('.tw3-svc .c b')
    await expect(pills).toHaveCount(SERVICE_LABELS.length)
    const networkLabels = await pills.allTextContents()
    expect([...networkLabels].sort()).toEqual([...SERVICE_LABELS].sort())

    await open(page, '/screen/usage?lite=1')
    const services = panel(page, /^各项服务使用次数$/)
    const rows = services.locator('.twin-bar-row')
    await expect(rows).toHaveCount(SERVICE_LABELS.length)
    await expect(page.locator('.tw3-box, .tw3-scene, .tw3-world')).toHaveCount(0)
    // 条目名逐项等于完整视图里的服务名（夹具顺序），没有一个英文键
    await expect(rows.locator('> span:first-child')).toHaveText(SERVICE_LABELS)
    for (const label of await rows.locator('> span:first-child').allTextContents()) {
      expect(label, '条目名必须是中文服务名，不能是英文键').not.toMatch(/[A-Za-z]{3,}/)
    }
    // null 的那一项（岗位 AI）照样写「少于 5」
    await expect(rows.filter({ hasText: '岗位 AI' }).locator('b')).toHaveText('少于 5')
  })

  for (const display of [false, true]) {
    test(`区名牌是按钮（${display ? '展示档' : '桌面档'}）：每一块都点得进去、再点一下退出`, async ({ page }) => {
      await serveHappy(page)
      const base: Record<string, string> = display ? { display: '1' } : {}
      await open(page, display ? '/screen/gov?display=1' : '/screen/gov')
      // 用 Playwright 的真点击（带「被别的元素挡住」检查）：海珠区、荔湾区曾被告警牌的透明盒子整块盖住
      for (const { area, count } of DISTRICTS) {
        const button = page.getByRole('button', { name: `${area}，${count} 台终端，聚焦该区`, exact: true })
        await button.click({ timeout: 5_000 })
        await expectLocation(page, '/screen/gov', { ...base, area })
        const focused = page.getByRole('button', { name: `${area}，${count} 台终端，退出聚焦`, exact: true })
        await expect(focused).toHaveAttribute('aria-pressed', 'true')
        await expect(panel(page, new RegExp(`^${area}终端$`))).toBeVisible()
        await expect(page.locator('.twin-overlay.is-tl')).toContainText(area)
        await focused.click({ timeout: 5_000 })
        await expectLocation(page, '/screen/gov', base)
        await expect(button).toHaveAttribute('aria-pressed', 'false')
      }
      await expect(panel(page, /^终端与服务$/)).toBeVisible()
    })
  }

  test('每块区名牌在自己的中心点上都点得到（聚焦前与逐区聚焦后）', async ({ page }, testInfo) => {
    const display = testInfo.project.name.includes('wall')
    await serveHappy(page)
    await open(page, display ? '/screen/gov?display=1' : '/screen/gov')
    await expect(page.locator('button.tw3-district-btn')).toHaveCount(DISTRICTS.length)
    const blocked = await blockedSceneButtons(page)
    for (const { area, count } of DISTRICTS) {
      await open(page, `/screen/gov?area=${encodeURIComponent(area)}${display ? '&display=1' : ''}`)
      await expect(page.getByRole('button', { name: `${area}，${count} 台终端，退出聚焦`, exact: true })).toBeVisible()
      blocked.push(...(await blockedSceneButtons(page, 'button.tw3-district-btn[aria-pressed="true"]')))
    }
    expect(blocked).toEqual([])
  })

  for (const display of [false, true]) {
    test(`点立柱（${display ? '展示档' : '桌面档'}）：进入该终端的孪生`, async ({ page }) => {
      await serveHappy(page)
      await open(page, display ? '/screen/gov?display=1' : '/screen/gov')
      // 立柱自己也是一块广告牌（.tw3-bb）：广告牌盒子不接指针之后，立柱必须把指针接回来。用真点击验证点得到
      await page.getByRole('button', { name: 'GZ-TH-005 · 打印 / 扫描中', exact: true }).click({ timeout: 5_000 })
      await expectLocation(page, '/screen/terminal', { ...(display ? { display: '1' } : {}), id: 't-gz-th-005' })
      await expect(page.locator('.twin-hd-sub')).toContainText('GZ-TH-005')
    })
  }

  test('桌面档点告警行：进入对应终端的孪生，不跳出大屏', async ({ page }) => {
    await serveHappy(page)
    await open(page, '/screen/gov')
    const rows = panel(page, /^实时告警$/).locator('.twin-alert')
    await expect(rows).toHaveCount(4)
    // 桌面档每一行都是链接（中键新开告警中心），普通点击进孪生
    for (const row of await rows.all()) await expect(row).toHaveAttribute('href', '/alerts')
    const row = rows.filter({ hasText: 'GZ-HZ-007' })
    await row.click()
    await expectLocation(page, '/screen/terminal', { id: 't-gz-hz-007' })
    await expect(page.getByRole('heading', { name: TERMINAL_TITLE, exact: true })).toBeVisible()
    await expect(page.locator('.twin-hd-sub')).toContainText('GZ-HZ-007')
  })

  test('展示档点告警行：进入终端孪生，地址仍带 display=1', async ({ page }) => {
    await serveHappy(page)
    await open(page, '/screen/gov?display=1')
    const rows = panel(page, /^实时告警$/).locator('.twin-alert')
    await expect(rows).toHaveCount(4)
    // 展示档没有链接出口，但每一行都是真按钮：可点、可 Tab 聚焦
    await expect(panel(page, /^实时告警$/).getByRole('button', { name: /GZ-/ })).toHaveCount(4)
    await expect(panel(page, /^实时告警$/).getByRole('link')).toHaveCount(0)
    const row = rows.filter({ hasText: 'GZ-HZ-007' })
    await row.click()
    await expectLocation(page, '/screen/terminal', { display: '1', id: 't-gz-hz-007' })
    await expect(page.getByRole('heading', { level: 1, name: TERMINAL_TITLE })).toBeVisible()
    await expect(page.locator('.twin-hd-sub')).toContainText('GZ-HZ-007')
  })

  test('展示档告警行用键盘也能进：Tab 聚焦有焦点环，回车打开孪生', async ({ page }) => {
    await serveHappy(page)
    await open(page, '/screen/gov?display=1')
    const row = panel(page, /^实时告警$/).locator('.twin-alert', { hasText: 'GZ-TH-002' })
    const ring = await keyboardFocus(page, row)
    expect(ring, '键盘聚焦时要看得见焦点环').toEqual({ focusVisible: true, outlineStyle: 'solid', outlineWidth: 2 })
    await page.keyboard.press('Enter')
    await expectLocation(page, '/screen/terminal', { display: '1', id: 't-gz-th-002' })
    await expect(page.locator('.twin-hd-sub')).toContainText('GZ-TH-002')
  })

  test('少于 5：null 计数写「少于 5」，同一格不出现 0', async ({ page }) => {
    await serveHappy(page)
    await open(page, '/screen/usage')
    const contract = panel(page, /^AI 服务$/).locator('.twin-bar-row', { hasText: '合同审查' })
    await expect(contract.locator('b')).toHaveText('少于 5')
    await expect(contract.locator('b')).not.toContainText('0')
    // 场景里 null 的服务同样写「少于 5」，不补数
    await expect(page.locator('.tw3-svc .c', { hasText: '岗位 AI' })).toContainText('少于 5')
    await expect(page.locator('.tw3-svc .c', { hasText: '岗位 AI' })).not.toContainText('0')

    await tabLink(page, '终端孪生').click()
    const today = panel(page, /^今日服务$/)
    await expect(tile(today, '扫描').locator('b')).toHaveText('少于 5次')
    await expect(today).toContainText('今日打印失败 少于 5 次')
    // 阳性对照：真实的数照常出
    await expect(tile(today, '打印页数').locator('b')).toHaveText('36页')
  })

  test('服务调用：地址里的非法 range 先纠正为 today 再发，切换时间只发白名单值', async ({ page }) => {
    const log = await serve(page, adminApi())
    await open(page, '/screen/usage?range=bogus')
    await expect(page.getByRole('heading', { name: USAGE_TITLE, exact: true })).toBeVisible()
    const chips = page.getByRole('group', { name: '统计时间' })
    await expect(chips.getByRole('button', { name: '今日', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await chips.getByRole('button', { name: '近 7 天', exact: true }).click()
    await expectLocation(page, '/screen/usage', { range: '7d' })
    await expect(page.locator('.twin-hd-sub')).toContainText('近 7 天')
    await chips.getByRole('button', { name: '近 30 天', exact: true }).click()
    await expectLocation(page, '/screen/usage', { range: '30d' })
    await expect(page.locator('.twin-hd-sub')).toContainText('近 30 天')
    const usage = log.urls.filter((url) => url.includes('/usage'))
    expect(usage[0], '第一次请求就必须是纠正后的 today').toBe('/api/v1/admin/screen/usage?range=today')
    expect(usage).toContain('/api/v1/admin/screen/usage?range=7d')
    expect(usage).toContain('/api/v1/admin/screen/usage?range=30d')
    for (const url of usage) expect(url).toMatch(/^\/api\/v1\/admin\/screen\/usage\?range=(today|7d|30d)$/)
  })

  test('终端孪生：请求只带路径段 id、不拼 query；下拉换终端写进地址', async ({ page }) => {
    const log = await serve(page, adminApi())
    await open(page, '/screen/terminal')
    // 没有 id 时先挑正在打印的那台
    await expect(page.locator('.twin-hd-sub')).toContainText('GZ-BY-001')
    await page.locator('.twin-toolbar select.twin-select').selectOption('t-gz-hz-007')
    await expectLocation(page, '/screen/terminal', { id: 't-gz-hz-007' })
    await expect(page.locator('.twin-hd-sub')).toContainText('GZ-HZ-007')
    const twins = log.urls.filter((url) => url.includes('/terminals/'))
    expect(twins).toContain('/api/v1/admin/screen/terminals/t-gz-by-001')
    expect(twins).toContain('/api/v1/admin/screen/terminals/t-gz-hz-007')
    for (const url of twins) expect(url).toMatch(/^\/api\/v1\/admin\/screen\/terminals\/[^/?]+$/)
  })

  test('手动刷新会重新取数、请求形状不变；页签切换不写任何浏览器存储', async ({ page }) => {
    const log = await serve(page, adminApi())
    await open(page, '/screen/gov')
    await expect(page.getByText('128,431')).toBeVisible()
    const before = log.urls.length
    await page.getByRole('button', { name: '刷新', exact: true }).click()
    await expect.poll(() => log.urls.length).toBeGreaterThan(before)
    for (const url of log.urls) expect(url, '刷新不能加缓存穿透参数').toMatch(/^\/api\/v1\/admin\/screen\/snapshot\?profile=(gov|ops)$/)
    for (const tab of [TABS[1], TABS[2], TABS[3]]) {
      await tabLink(page, tab.label).click()
      await expect(tab.marker(page)).toBeVisible()
    }
    const stored = await page.evaluate(() => ({
      local: Object.keys(localStorage).filter((key) => key !== 'admin_auth_v1'),
      session: Object.keys(sessionStorage),
    }))
    expect(stored).toEqual({ local: [], session: [] })
  })

  test('动效可关：关掉后动画停下，布局与纵深不变', async ({ page }) => {
    // 配置默认模拟「减少动效」，那样动效一开始就是关的，测不出按钮的作用；这里先放开
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await serveHappy(page)
    await open(page, '/screen/gov')
    const screen = page.locator('[data-ops-screen]')
    await expect(screen).toHaveAttribute('data-ops-motion', 'on')
    const ring = page.locator('.tw3-ring').first()
    expect(await ring.evaluate((el) => getComputedStyle(el).animationName)).toBe('tw3-pulse')
    const rects = () => page.locator('.twin-panel').evaluateAll((els) => els.map((el) => {
      const r = el.getBoundingClientRect()
      return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]
    }))
    const before = await rects()
    await page.getByRole('button', { name: '关闭动效', exact: true }).click()
    await expect(screen).toHaveAttribute('data-ops-motion', 'off')
    await expect(page.getByRole('button', { name: '开启动效', exact: true })).toHaveAttribute('aria-pressed', 'true')
    expect(await ring.evaluate((el) => getComputedStyle(el).animationName)).toBe('none')
    expect(await rects()).toEqual(before)
    // 纵深层次是静态的，降级后仍然保留
    expect(await page.locator('.tw3-world').evaluate((el) => getComputedStyle(el).transform)).not.toBe('none')
    expect(await page.locator('.tw3-bb').first().evaluate((el) => getComputedStyle(el).transform)).not.toBe('none')
  })
})
