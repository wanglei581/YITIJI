import { test, expect, type Locator, type Page } from '@playwright/test'
import { PLACES } from './fixtures/snapshots'
import {
  MOCK_PARTNER_ORG_ID,
  expectLocation,
  open,
  panel,
  serve,
  serveHappy,
  partnerApi,
  tile,
  uncaughtPageErrors,
} from './helpers'
import { blockedSceneButtons, keyboardFocus } from './measure'

/**
 * 页签地址、两档（桌面 / 展示）、轻量模式、点位牌、告警行、「少于 5」、请求里没有机构标识。
 */

const OVERVIEW_TITLE = '本机构运营概览'
const USAGE_TITLE = '本机构信息使用态势'
const TERMINAL_TITLE = '终端数字孪生'

interface TabCase {
  key: 'overview' | 'usage' | 'terminal'
  label: string
  title: string
  /** 只有这个页签才有的内容，证明换的不只是标题。 */
  marker: (page: Page) => Locator
}

const TABS: TabCase[] = [
  { key: 'overview', label: '机构总览', title: OVERVIEW_TITLE, marker: (page) => panel(page, /^本机构终端$/) },
  { key: 'usage', label: '信息使用', title: USAGE_TITLE, marker: (page) => panel(page, /^使用概况$/) },
  { key: 'terminal', label: '终端孪生', title: TERMINAL_TITLE, marker: (page) => panel(page, /^设备概况$/) },
]

function tabLink(page: Page, label: string): Locator {
  return page.getByRole('navigation', { name: '大屏页签' }).getByRole('link', { name: label, exact: true })
}

test.afterEach(async ({ page }) => {
  expect(uncaughtPageErrors(page), '页面不得有未捕获异常').toEqual([])
})

test.describe('partner screen navigation', () => {
  test('每个页签有独立地址：点页签，地址与内容一起变；筛选不跟着走', async ({ page }) => {
    await serveHappy(page)
    await open(page, '/screen/overview?place=%E4%B8%AD%E5%A4%A7%E5%8D%97%E6%A0%A1%E5%8C%BA&status=alert')
    for (const tab of [TABS[1], TABS[2], TABS[0]]) {
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
    await open(page, '/screen/overview?display=1&lite=1&place=%E4%B8%AD%E5%A4%A7%E5%8D%97%E6%A0%A1%E5%8C%BA')
    await tabLink(page, '信息使用').click()
    await expectLocation(page, '/screen/usage', { display: '1', lite: '1' })
    await expect(page.getByRole('heading', { level: 1, name: USAGE_TITLE })).toBeVisible()
  })

  test('旧地址 /screen 与非法页签改写到 /screen/overview，display 跟着走', async ({ page }) => {
    await serveHappy(page)
    const cases: Array<[string, Record<string, string>]> = [
      ['/screen', {}],
      ['/screen/gov', {}],
      ['/screen?display=1', { display: '1' }],
    ]
    for (const [from, query] of cases) {
      await open(page, from)
      await expectLocation(page, '/screen/overview', query)
      await expect(page.getByRole('heading', { name: OVERVIEW_TITLE, exact: true })).toBeVisible()
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
      await expect(page.locator('.twin-panel h2')).toHaveCount(0)
      await expect(page.locator('.twin-toolbar')).toBeVisible()
      for (const name of ['刷新', '关闭动效', '轻量模式', '新窗口展示']) {
        await expect(page.locator('.twin-toolbar').getByRole('button', { name, exact: true })).toBeVisible()
      }
      await expect(page.getByRole('button', { name: '全屏', exact: true })).toHaveCount(0)
      await expect(page.getByRole('button', { name: '退出展示', exact: true })).toHaveCount(0)
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
    await open(page, '/screen/overview?display=1&place=%E4%B8%AD%E5%A4%A7%E5%8D%97%E6%A0%A1%E5%8C%BA')
    await page.getByRole('button', { name: '退出展示', exact: true }).click()
    await expectLocation(page, '/screen/overview', { place: '中大南校区' })
    await expect(page.locator('h1')).toHaveText('数据大屏')
    await expect(page.locator('.twin-hd h2')).toHaveText(OVERVIEW_TITLE)
    await expect(page.locator('.twin-toolbar')).toBeVisible()

    await open(page, '/screen/usage?display=1&range=7d')
    await expect(page.getByRole('heading', { level: 1, name: USAGE_TITLE })).toBeVisible()
    await page.keyboard.press('Escape')
    await expectLocation(page, '/screen/usage', { range: '7d' })
    await expect(page.locator('.twin-toolbar')).toBeVisible()
  })

  test('新窗口展示：同一地址加 display=1 开出舞台，筛选条件原样带过去', async ({ page }) => {
    await serveHappy(page)
    await open(page, '/screen/overview?place=%E4%B8%AD%E5%A4%A7%E5%8D%97%E6%A0%A1%E5%8C%BA')
    const popupPromise = page.context().waitForEvent('page')
    await page.getByRole('button', { name: '新窗口展示', exact: true }).click()
    const popup = await popupPromise
    await popup.waitForLoadState('domcontentloaded')
    await expectLocation(popup, '/screen/overview', { place: '中大南校区', display: '1' })
    await expect(popup.locator("[data-ops-screen='wall']")).toBeVisible()
    await expect(popup.getByRole('heading', { level: 1, name: OVERVIEW_TITLE })).toBeVisible()
    await expect(panel(popup, /^中大南校区终端$/)).toBeVisible()
    await expectLocation(page, '/screen/overview', { place: '中大南校区' })
  })

  for (const display of [false, true]) {
    test(`轻量模式（${display ? '展示档' : '桌面档'}）：3D 点位换成平面机队格子墙`, async ({ page }) => {
      await serveHappy(page)
      await open(page, display ? '/screen/overview?lite=1&display=1' : '/screen/overview?lite=1')
      const wall = page.locator('.twin-lite-wall .ops-fleet')
      await expect(wall).toBeVisible()
      await expect(wall.locator('.ops-d')).toHaveCount(12)
      await expect(page.locator('.twin')).toHaveAttribute('data-lite', '1')
      await expect(page.locator('.tw3-box, .tw3-scene, .tw3-world, .tw3-district-btn')).toHaveCount(0)
      if (!display) {
        const toggle = page.getByRole('button', { name: '轻量模式', exact: true })
        await expect(toggle).toHaveAttribute('aria-pressed', 'true')
        await toggle.click()
        await expectLocation(page, '/screen/overview')
        await expect(page.locator('.tw3-scene')).toBeVisible()
        await expect(page.locator('.ops-fleet')).toHaveCount(0)
      }
    })
  }

  for (const display of [false, true]) {
    test(`点位牌是按钮（${display ? '展示档' : '桌面档'}）：每一块点一下地址写入 place，再点一下清掉`, async ({ page }) => {
      await serveHappy(page)
      const base: Record<string, string> = display ? { display: '1' } : {}
      await open(page, display ? '/screen/overview?display=1' : '/screen/overview')
      // 用 Playwright 的真点击（带「被别的元素挡住」检查）：中大南校区、海珠会展中心、社区就业站
      // 曾被告警牌 / 点位牌的透明盒子整块盖住，社区就业站聚焦后连「退出聚焦」都点不到
      for (const { place, count } of PLACES) {
        const button = page.getByRole('button', { name: `${place}，${count} 台终端，聚焦该区`, exact: true })
        await button.click({ timeout: 5_000 })
        await expectLocation(page, '/screen/overview', { ...base, place })
        const focused = page.getByRole('button', { name: `${place}，${count} 台终端，退出聚焦`, exact: true })
        await expect(focused).toHaveAttribute('aria-pressed', 'true')
        await expect(panel(page, new RegExp(`^${place}终端$`))).toBeVisible()
        await expect(page.locator('.twin-overlay.is-tl')).toContainText(place)
        await focused.click({ timeout: 5_000 })
        await expectLocation(page, '/screen/overview', base)
        await expect(button).toHaveAttribute('aria-pressed', 'false')
      }
      await expect(panel(page, /^本机构终端$/)).toBeVisible()
    })
  }

  test('每块点位牌在自己的中心点上都点得到（聚焦前与聚焦后）', async ({ page }, testInfo) => {
    const display = testInfo.project.name.includes('wall') ? '&display=1' : ''
    await serveHappy(page)
    await open(page, display ? '/screen/overview?display=1' : '/screen/overview')
    await expect(page.locator('button.tw3-district-btn')).toHaveCount(PLACES.length)
    const blocked = await blockedSceneButtons(page)
    for (const { place } of PLACES) {
      await open(page, `/screen/overview?place=${encodeURIComponent(place)}${display}`)
      await expect(page.locator('button.tw3-district-btn[aria-pressed="true"]')).toHaveCount(1)
      blocked.push(...(await blockedSceneButtons(page, 'button.tw3-district-btn[aria-pressed="true"]')))
    }
    expect(blocked).toEqual([])
  })

  for (const display of [false, true]) {
    test(`点立柱（${display ? '展示档' : '桌面档'}）：进入该终端的孪生`, async ({ page }) => {
      await serveHappy(page)
      await open(page, display ? '/screen/overview?display=1' : '/screen/overview')
      // 立柱自己也是一块广告牌（.tw3-bb）：广告牌盒子不接指针之后，立柱必须把指针接回来。用真点击验证点得到
      await page.getByRole('button', { name: 'HZ-ZD-03 · 打印机告警', exact: true }).click({ timeout: 5_000 })
      await expectLocation(page, '/screen/terminal', { ...(display ? { display: '1' } : {}), id: 't-hz-zd-03' })
      await expect(page.locator('.twin-hd-sub')).toContainText('HZ-ZD-03')
    })
  }

  for (const display of [false, true]) {
    test(`点告警行（${display ? '展示档' : '桌面档'}）：进入该终端的孪生，展示档仍带 display=1`, async ({ page }) => {
      await serveHappy(page)
      await open(page, display ? '/screen/overview?display=1' : '/screen/overview')
      const alerts = panel(page, /^本机构终端告警$/)
      // 夹具里 5 台有告警；展示档只列前 4 行。每一行都是真按钮（机构后台没有告警中心可链），不是死的 <div>
      const shown = display ? 4 : 5
      await expect(alerts.locator('.twin-alert')).toHaveCount(shown)
      await expect(alerts.getByRole('button', { name: /HZ-/ })).toHaveCount(shown)
      await expect(alerts.getByRole('link')).toHaveCount(0)
      const row = alerts.locator('.twin-alert', { hasText: 'HZ-SQ-01' })
      await row.click()
      await expectLocation(page, '/screen/terminal', { ...(display ? { display: '1' } : {}), id: 't-hz-sq-01' })
      await expect(page.locator('.twin-hd-sub')).toContainText('HZ-SQ-01')
    })
  }

  test('告警行用键盘也能进：Tab 聚焦有焦点环，回车打开孪生', async ({ page }, testInfo) => {
    const display = testInfo.project.name.includes('wall')
    await serveHappy(page)
    await open(page, display ? '/screen/overview?display=1' : '/screen/overview')
    const row = panel(page, /^本机构终端告警$/).locator('.twin-alert', { hasText: 'HZ-ZD-03' })
    const ring = await keyboardFocus(page, row)
    expect(ring, '键盘聚焦时要看得见焦点环').toEqual({ focusVisible: true, outlineStyle: 'solid', outlineWidth: 2 })
    await page.keyboard.press('Enter')
    await expectLocation(page, '/screen/terminal', { ...(display ? { display: '1' } : {}), id: 't-hz-zd-03' })
    await expect(page.locator('.twin-hd-sub')).toContainText('HZ-ZD-03')
  })

  test('少于 5：null 计数写「少于 5」，同一格不出现 0；合计里有未知写「至少」', async ({ page }) => {
    await serveHappy(page)
    // 今日档：企业资料的浏览、三类收藏都少于 5（默认的近 7 天里这些数已经够 5）
    await open(page, '/screen/usage?range=today')
    // 企业资料今日浏览 4 次 → 服务端给 null
    const company = tile(panel(page, /^按信息类型$/), '企业资料')
    await expect(company.locator('b')).toHaveText('少于 5次浏览')
    await expect(company.locator('b')).not.toContainText('0')
    // 收藏：少于 5 的类型不画成零长条，在脚注里点名
    const fav = panel(page, /^收藏$/)
    await expect(fav.locator('.twin-cap')).toHaveText('少于 5 次：招聘会、政策公告、企业资料')
    for (const value of await fav.locator('.twin-bar-row > b').allTextContents()) expect(value).not.toBe('0')
    // 合计：有一类是 null，就只能写「至少」已知部分之和，不把未知当 0 加进去
    const browse = panel(page, /^使用概况$/).locator('.twin-stat', { hasText: '浏览' }).locator('b')
    await expect(browse).toHaveText('至少68次')
    // 场景里 null 的类型同样写「少于 5」
    await expect(page.locator('.tw3-svc .c', { hasText: '企业资料' }).locator('span')).toHaveText('浏览 少于 5')

    await tabLink(page, '终端孪生').click()
    const today = panel(page, /^今日服务$/)
    await expect(tile(today, '打印任务').locator('b')).toHaveText('少于 5单')
    await expect(tile(today, '扫描').locator('b')).toHaveText('少于 5次')
    await expect(tile(today, '打印页数').locator('b')).toHaveText('22页')
  })

  test('信息使用默认看近 7 天：地址栏上的 range 优先；选「今日」写进地址，选回「近 7 天」把参数去掉', async ({ page }) => {
    const log = await serve(page, partnerApi())
    const chips = page.getByRole('group', { name: '统计时间' })
    const usageUrls = () => log.urls.filter((url) => url.includes('/usage'))

    await open(page, '/screen/usage')
    await expect(page.locator('.twin-hd-sub')).toContainText('近 7 天')
    await expect(chips.getByRole('button', { name: '近 7 天', exact: true })).toHaveAttribute('aria-pressed', 'true')
    expect(usageUrls()[0], '没写 range 时第一次就取近 7 天').toBe('/api/v1/partner/screen/usage?range=7d')
    await expectLocation(page, '/screen/usage', {})

    await chips.getByRole('button', { name: '今日', exact: true }).click()
    await expectLocation(page, '/screen/usage', { range: 'today' })
    await expect(page.locator('.twin-hd-sub')).toContainText('今日')
    await chips.getByRole('button', { name: '近 7 天', exact: true }).click()
    await expectLocation(page, '/screen/usage', {})
    await expect(page.locator('.twin-hd-sub')).toContainText('近 7 天')

    // 地址栏上的 range 优先：今日、近 30 天各取各的；展示档同样默认近 7 天
    for (const [query, label, range] of [['?range=today', '今日', 'today'], ['?range=30d', '近 30 天', '30d'], ['?display=1', '近 7 天', '7d']] as const) {
      const before = usageUrls().length
      await open(page, `/screen/usage${query}`)
      await expect(page.locator('.twin-hd-sub')).toContainText(label)
      expect(usageUrls()[before], `${query} 取的是 ${range}`).toBe(`/api/v1/partner/screen/usage?range=${range}`)
    }
  })

  test('请求里一个机构标识都没有：快照与终端不带 query，信息使用只带纠正后的 range', async ({ page }) => {
    const log = await serve(page, partnerApi())
    // 地址栏上故意带非法 range 与伪造的 orgId：前者按没写处理（默认近 7 天），后者一个字都不能进请求
    await open(page, `/screen/usage?range=bogus&orgId=org-evil&org_id=${MOCK_PARTNER_ORG_ID}`)
    await expect(page.getByRole('heading', { name: USAGE_TITLE, exact: true })).toBeVisible()
    const chips = page.getByRole('group', { name: '统计时间' })
    await expect(chips.getByRole('button', { name: '近 7 天', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await chips.getByRole('button', { name: '今日', exact: true }).click()
    await expect(page.locator('.twin-hd-sub')).toContainText('今日')
    await chips.getByRole('button', { name: '近 30 天', exact: true }).click()
    await expect(page.locator('.twin-hd-sub')).toContainText('近 30 天')
    await tabLink(page, '机构总览').click()
    await expect(panel(page, /^本机构终端$/)).toBeVisible()
    await tabLink(page, '终端孪生').click()
    await expect(panel(page, /^设备概况$/)).toBeVisible()
    await page.locator('.twin-toolbar select.twin-select').selectOption('t-hz-sq-01')
    await expect(page.locator('.twin-hd-sub')).toContainText('HZ-SQ-01')

    const urls = log.urls
    const usage = urls.filter((url) => url.includes('/usage'))
    const snapshots = urls.filter((url) => url.includes('/snapshot'))
    const twins = urls.filter((url) => url.includes('/terminals/'))
    expect(usage[0], '第一次请求就必须是纠正后的默认档 7d').toBe('/api/v1/partner/screen/usage?range=7d')
    expect(usage).toContain('/api/v1/partner/screen/usage?range=today')
    expect(usage).toContain('/api/v1/partner/screen/usage?range=30d')
    for (const url of usage) expect(url).toMatch(/^\/api\/v1\/partner\/screen\/usage\?range=(today|7d|30d)$/)
    expect(snapshots.length).toBeGreaterThan(0)
    for (const url of snapshots) expect(url).toBe('/api/v1/partner/screen/snapshot')
    expect(twins).toContain('/api/v1/partner/screen/terminals/t-hz-sq-01')
    for (const url of twins) expect(url).toMatch(/^\/api\/v1\/partner\/screen\/terminals\/[^/?]+$/)
    expect(usage.length + snapshots.length + twins.length, '只有这三个大屏接口').toBe(urls.length)
    for (const call of log.calls) {
      expect(call.url).not.toMatch(/org/i)
      expect(call.url).not.toContain(MOCK_PARTNER_ORG_ID)
      expect(call.method).toBe('GET')
      expect(call.postData).toBeNull()
      // referer 是浏览器按页面地址自动带的（本条故意在地址栏塞了 orgId），不是客户端拼的；其余请求头都不许有
      for (const [name, value] of Object.entries(call.headers)) {
        if (name === 'referer') continue
        expect(`${name}: ${value}`, '请求头里也不能带机构标识').not.toContain(MOCK_PARTNER_ORG_ID)
        expect(name).not.toMatch(/org/i)
      }
    }
  })

  test('终端孪生：没有 id 时挑正在打印的那台；别家终端（404）说清楚，不显示数值', async ({ page }) => {
    await serveHappy(page)
    await open(page, '/screen/terminal')
    await expect(page.locator('.twin-hd-sub')).toContainText('HZ-ZD-04')
    await open(page, '/screen/terminal?id=t-other-org-001')
    await expect(page.getByText('没有找到这台终端，请从本机构终端列表重新选择')).toBeVisible()
    await expect(panel(page, /^设备概况$/)).toHaveCount(0)
  })
})
