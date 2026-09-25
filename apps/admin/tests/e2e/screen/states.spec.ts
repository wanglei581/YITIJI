import { test, expect } from '@playwright/test'
import {
  govDegraded,
  govEmpty,
  govFull,
  govUnavailable,
  opsFull,
  opsNoDenominator,
} from './fixtures/snapshots'
import { open, serve, serveByProfile, serveHappy, serveJson, serveStatus, visibleDigits } from './helpers'

/**
 * 管理员大屏状态矩阵。页签地址换成 /screen/:tab 之后，失败说法仍在 TwinShell：
 * 已有数据时保留旧值并出横幅，不用 0 顶替；401 不自动跳登录。
 */

const GOV_TITLE = '职易达 · 就业服务终端运行态势'
const OPS_TITLE = '终端运营看板'

test.describe('admin data screen states', () => {
  test('gov：真实数据上屏，来源机构数与累计打印仍在，且快照只带 profile', async ({ page }) => {
    const log = await serveByProfile(page, { gov: govFull(), ops: opsFull() })
    await open(page, '/screen/gov')
    await expect(page.getByRole('heading', { name: GOV_TITLE })).toBeVisible()
    await expect(page.getByText('128,431')).toBeVisible()
    await expect(page.getByText('来自 23 家来源机构')).toBeVisible()
    await expect(page.getByText('9,706')).toBeVisible()
    // 分色仍是嵌套未接入，政务总览不再画分色副行；不能编出黑白/彩色页数
    await expect(page.getByText(/黑白|彩色页/)).toHaveCount(0)
    const snapshots = log.urls.filter((url) => url.includes('/snapshot'))
    expect(snapshots.length).toBeGreaterThan(0)
    expect(snapshots.every((url) => /\/admin\/screen\/snapshot\?profile=(gov|ops)$/.test(url))).toBe(true)
  })

  test('ops：告警与成本仍在；token / P95 不画成数字', async ({ page }) => {
    await serveHappy(page)
    await open(page, '/screen/ops')
    await expect(page.getByRole('heading', { name: OPS_TITLE })).toBeVisible()
    await expect(page.locator('.ops-card')).toHaveCount(12)
    await expect(page.getByText('97.5')).toBeVisible()
    await expect(page.getByText('¥38.74')).toBeVisible()
    await expect(page.getByText(/token 用量与 P95 延迟未接入/)).toBeVisible()
    const body = await page.locator('[data-ops-screen]').innerText()
    expect(body).not.toMatch(/输入 token|输出 token|P95 延迟\s*\n?\s*\d/)
  })

  test('非法 profile 改写到政务总览，且不把非法值发给服务端', async ({ page }) => {
    const log = await serveHappy(page)
    await open(page, '/screen?profile=%E9%9D%9E%E6%B3%95%E5%80%BC')
    await expect(page.getByRole('heading', { name: GOV_TITLE })).toBeVisible()
    await expect(page).toHaveURL(/\/screen\/gov/)
    await expect(page).not.toHaveURL(/profile=/)
    expect(log.urls.some((url) => url.includes('%E9%9D%9E') || url.includes('非法'))).toBe(false)
    expect(log.urls.filter((url) => url.includes('/snapshot')).every((url) => /profile=(gov|ops)$/.test(url))).toBe(true)
  })

  test('真实为零：显示 0 而不是「未接入」', async ({ page }) => {
    await serveJson(page, govEmpty())
    await open(page, '/screen/gov')
    const shelf = page.locator('.twin-panel').filter({ hasText: '信息服务' })
    await expect(shelf.locator('.twin-tile').filter({ hasText: '岗位信息' }).locator('b').first()).toHaveText(/^0/)
    await expect(shelf.locator('.twin-na')).toHaveCount(0)
    const trend = page.locator('.twin-panel').filter({ hasText: '打印量趋势' })
    await expect(trend.locator('.twin-big')).toHaveText('0')
    await expect(trend.locator('.twin-na')).toHaveCount(0)
  })

  test('无分母：写「无调用」，绝不显示 0%', async ({ page }) => {
    await serveByProfile(page, { gov: govFull(), ops: opsNoDenominator() })
    await open(page, '/screen/ops')
    await expect(page.getByText('近 24 小时无 AI 调用')).toBeVisible()
    await expect(page.getByText('近 24 小时无同步批次')).toBeVisible()
    const ai = page.locator('.ops-card').filter({ hasText: 'AI 成功率' })
    await expect(ai).not.toContainText('0%')
    await expect(page.getByText('当前没有正在发生的告警')).toBeVisible()
    await expect(page.getByText('近 30 日没有打开来源平台入口的记录')).toBeVisible()
  })

  test('局部失败：横幅点明失败项数，未失败的数字仍真实', async ({ page }) => {
    await serveByProfile(page, { gov: govDegraded(), ops: opsFull() })
    await open(page, '/screen/gov')
    await expect(page.getByText(/部分数据源本次查询失败（3 项）/)).toBeVisible()
    await expect(page.locator('.twin-na.is-failed')).toHaveCount(2)
    await expect(page.locator('.twin-panel').filter({ hasText: '累计打印' }).getByText('未接入')).toBeVisible()
    await expect(page.getByText('9,706')).toBeVisible()
    await expect(page.locator('.twin-na:not(.is-failed)')).toHaveCount(0)
  })

  test('status=unavailable 走的是 HTTP 200，指标槽不能出现任何数值', async ({ page }) => {
    await serveByProfile(page, { gov: govUnavailable(), ops: govUnavailable() })
    await open(page, '/screen/gov')
    await expect(page.getByText(/本次快照的全部数据源均查询失败/)).toBeVisible()
    const digits = await visibleDigits(page)
    expect(digits, `未接入时不该出现任何指标读数：${JSON.stringify(digits)}`).toEqual([])
  })

  test('401：不跳登录页，就地给「重新登录」', async ({ page }) => {
    await serveStatus(page, 401, { code: 'AUTH_TOKEN_INVALID', message: 'Token 无效或已过期' })
    await open(page, '/screen/gov')
    await expect(page.getByText('登录已过期')).toBeVisible()
    await expect(page.getByRole('button', { name: '重新登录' })).toBeVisible()
    await expect(page).toHaveURL(/\/screen\/gov/)
  })

  test('403：按角色文案提示，不误导成网络故障', async ({ page }) => {
    await serveStatus(page, 403, { code: 'AUTH_ROLE_FORBIDDEN', message: '当前角色无权访问 (需要: admin)' })
    await open(page, '/screen/gov')
    await expect(page.getByText('无权查看本大屏')).toBeVisible()
    await expect(page.getByText('当前账号没有查看管理员数据大屏的权限')).toBeVisible()
  })

  test('网络失败：没有任何成功数据时不显示数值，给重试', async ({ page }) => {
    await serve(page, () => 'abort')
    await open(page, '/screen/gov')
    await expect(page.getByText('与服务器断开')).toBeVisible()
    await expect(page.getByRole('button', { name: '重试' })).toBeVisible()
    expect(await visibleDigits(page)).toEqual([])
  })

  test('陈旧数据：刷新失败后保留上次成功值并标注', async ({ page }) => {
    let serveOk = true
    await serve(page, (url) => {
      if (!serveOk) return 'abort'
      if (url.pathname.endsWith('/snapshot')) {
        const profile = url.searchParams.get('profile') === 'ops' ? opsFull() : govFull()
        return { status: 200, body: { success: true, data: profile } }
      }
      return { status: 200, body: { success: true, data: govFull() } }
    })
    await open(page, '/screen/gov')
    await expect(page.getByText('128,431')).toBeVisible()
    serveOk = false
    await page.getByRole('button', { name: '刷新' }).click()
    // 断网走 offline：横幅说断开并声明没有用 0 代替，数字留在屏上
    await expect(page.getByText(/与服务器断开/)).toBeVisible()
    await expect(page.getByText(/没有用 0 代替/)).toBeVisible()
    await expect(page.getByText('128,431')).toBeVisible()
  })

  test('会话在取数成功之后过期：保留上次数值，同时说清是登录过期并给动作', async ({ page }) => {
    let authed = true
    await serve(page, (url) => {
      if (!authed) {
        return { status: 401, body: { success: false, error: { code: 'AUTH_TOKEN_INVALID', message: 'Token 无效或已过期' } } }
      }
      if (!url.pathname.endsWith('/snapshot')) return { status: 200, body: { success: true, data: govFull() } }
      const data = url.searchParams.get('profile') === 'ops' ? opsFull() : govFull()
      return { status: 200, body: { success: true, data } }
    })
    await open(page, '/screen/gov')
    await expect(page.getByText('128,431')).toBeVisible()
    authed = false
    await page.getByRole('button', { name: '刷新' }).click()
    await expect(page.getByText('128,431')).toBeVisible()
    await expect(page.getByText(/登录已过期/)).toBeVisible()
    await expect(page.getByRole('button', { name: '重新登录' })).toBeVisible()
    await expect(page).toHaveURL(/\/screen\/gov/)
  })

  test('权限在取数成功之后被撤：保留上次数值，同时说清是权限问题', async ({ page }) => {
    let allowed = true
    await serve(page, (url) => {
      if (!allowed) {
        return { status: 403, body: { success: false, error: { code: 'AUTH_ROLE_FORBIDDEN', message: '当前角色无权访问 (需要: admin)' } } }
      }
      if (!url.pathname.endsWith('/snapshot')) return { status: 200, body: { success: true, data: govFull() } }
      const data = url.searchParams.get('profile') === 'ops' ? opsFull() : govFull()
      return { status: 200, body: { success: true, data } }
    })
    await open(page, '/screen/gov')
    await expect(page.getByText('128,431')).toBeVisible()
    allowed = false
    await page.getByRole('button', { name: '刷新' }).click()
    await expect(page.getByText('128,431')).toBeVisible()
    await expect(page.getByText(/已无权查看本大屏/)).toBeVisible()
    await expect(page.getByText('当前账号没有查看管理员数据大屏的权限')).toBeVisible()
  })

  test('列表截断如实说明；访问口径上屏', async ({ page }) => {
    await serveHappy(page)
    await open(page, '/screen/ops')
    await expect(page.getByText('已列出 4 / 共 137 条')).toBeVisible()
    await expect(page.getByText(/未签发免登录只读展示令牌/)).toBeVisible()
  })

  test('手动刷新与页签切换；不写任何浏览器存储', async ({ page }) => {
    const log = await serveHappy(page)
    await open(page, '/screen/gov')
    const before = log.urls.length
    await page.getByRole('button', { name: '刷新' }).click()
    await expect.poll(() => log.urls.length).toBeGreaterThan(before)
    await page.getByRole('link', { name: '运营看板' }).click()
    await expect(page.getByRole('heading', { name: OPS_TITLE })).toBeVisible()
    await expect(page).toHaveURL(/\/screen\/ops/)
    const stored = await page.evaluate(() => ({
      local: Object.keys(localStorage).filter((key) => key !== 'admin_auth_v1'),
      session: Object.keys(sessionStorage),
    }))
    expect(stored).toEqual({ local: [], session: [] })
  })

  test('动效可关，关掉后布局不变，纵深变换仍在', async ({ page }) => {
    await serveHappy(page)
    await open(page, '/screen/gov')
    const panelsBefore = await page.locator('.twin-panel').count()
    await page.getByRole('button', { name: '关闭动效' }).click()
    await expect(page.locator("[data-ops-motion='off']")).toHaveCount(1)
    await expect(page.locator('.twin-panel')).toHaveCount(panelsBefore)
    const z = await page.locator('.tw3-bb').first().evaluate((el) => getComputedStyle(el).transform)
    expect(z).not.toBe('none')
  })

  test('标题层级：桌面档页眉是 h2，整页 h1 只有后台页头；展示档 h1 恰好一个', async ({ page }) => {
    await serveHappy(page)
    await open(page, '/screen/gov')
    await expect(page.locator('h1')).toHaveCount(1)
    await expect(page.locator('h1')).toHaveText('数据大屏')
    await expect(page.locator('.twin-hd h2')).toHaveText(GOV_TITLE)
    await expect(page.locator('.twin-toolbar')).toBeVisible()
    const deskStyle = await page.locator('.twin-hd h2').evaluate((el) => {
      const style = getComputedStyle(el)
      return { fontSize: style.fontSize, marginTop: style.marginTop, marginBottom: style.marginBottom }
    })
    expect(deskStyle).toEqual({ fontSize: '22px', marginTop: '0px', marginBottom: '0px' })

    await page.goto('/screen/gov?display=1')
    await expect(page.locator("[data-ops-screen='wall']")).toBeVisible()
    await expect(page.locator('h1')).toHaveCount(1)
    await expect(page.getByRole('heading', { level: 1, name: GOV_TITLE })).toBeVisible()
    await expect(page.locator('.twin-toolbar')).toHaveCount(0)
    await expect(page.getByRole('button', { name: '全屏' })).toBeVisible()
    await expect(page.getByRole('button', { name: '退出展示' })).toBeVisible()
    const wallFontSize = await page.locator('.twin-hd h1').evaluate((el) => getComputedStyle(el).fontSize)
    expect(wallFontSize).toBe('30px')
  })
})
