import { test, expect } from '@playwright/test'
import {
  govDegraded,
  govEmpty,
  govFull,
  govUnavailable,
  opsFull,
  opsNoDenominator,
} from './fixtures/snapshots'
import { open, serveByProfile, serveJson, serveStatus, visibleDigits } from './helpers'

/**
 * 管理员大屏状态矩阵。
 *
 * 每一条都对着一种真实会发生的服务端回法，而不是对着当前实现写断言。
 * 尤其是 status=unavailable：那是 **HTTP 200**，只判 res.ok 的实现会在这里
 * 渲染出一屏空壳或一屏 0。
 */

test.describe('admin data screen states', () => {
  test('gov：真实数据全量渲染，10 块都在且都有来源脚注', async ({ page }) => {
    const log = await serveJson(page, govFull())
    await open(page, '/screen?profile=gov')
    await expect(page.getByRole('heading', { name: '就业服务终端 · 运行概览' })).toBeVisible()
    await expect(page.locator('.ops-card')).toHaveCount(10)
    await expect(page.getByText('128,431')).toBeVisible()
    await expect(page.getByText('来自 23 家信息来源机构')).toBeVisible()
    // 分色恒不可用：副行必须是未接入说明，不能编出黑白/彩色的数
    await expect(page.getByText(/分色未接入/)).toBeVisible()
    // 请求只带 profile，没有任何其它参数
    expect(log.urls.every((url) => /\?profile=gov$/.test(url))).toBe(true)
  })

  test('ops：12 块含告警与成本；token / P95 不画成数字', async ({ page }) => {
    await serveByProfile(page, { gov: govFull(), ops: opsFull() })
    await open(page, '/screen?profile=ops')
    await expect(page.getByRole('heading', { name: '终端运营看板' })).toBeVisible()
    await expect(page.locator('.ops-card')).toHaveCount(12)
    await expect(page.getByText('97.5')).toBeVisible()
    await expect(page.getByText('¥38.74')).toBeVisible()
    await expect(page.getByText(/token 用量与 P95 延迟未接入/)).toBeVisible()
    const body = await page.locator('[data-ops-screen]').innerText()
    expect(body).not.toMatch(/输入 token|输出 token|P95 延迟\s*\n?\s*\d/)
  })

  test('非法 profile 前端纠正为 gov，且不把非法值发给服务端', async ({ page }) => {
    const log = await serveByProfile(page, { gov: govFull(), ops: opsFull() })
    await open(page, '/screen?profile=%E9%9D%9E%E6%B3%95%E5%80%BC')
    await expect(page.getByRole('heading', { name: '就业服务终端 · 运行概览' })).toBeVisible()
    await expect(page).toHaveURL(/profile=gov/)
    expect(log.urls.every((url) => /\?profile=(gov|ops)$/.test(url))).toBe(true)
  })

  test('真实为零：显示 0 而不是「未接入」', async ({ page }) => {
    await serveJson(page, govEmpty())
    await open(page, '/screen?profile=gov')
    const shelf = page.locator('.ops-card').filter({ hasText: '在架岗位信息' })
    await expect(shelf.locator('.ops-n')).toHaveText(/^0/)
    await expect(shelf.locator('.ops-na')).toHaveCount(0)
    await expect(page.getByText('近 14 日无打印记录，折线为真实的零线。')).toBeVisible()
  })

  test('无分母：写「无调用」，绝不显示 0%', async ({ page }) => {
    await serveByProfile(page, { gov: govFull(), ops: opsNoDenominator() })
    await open(page, '/screen?profile=ops')
    await expect(page.getByText('近 24 小时无 AI 调用')).toBeVisible()
    await expect(page.getByText('近 24 小时无同步批次')).toBeVisible()
    const ai = page.locator('.ops-card').filter({ hasText: 'AI 成功率' })
    await expect(ai).not.toContainText('0%')
    await expect(page.getByText('当前没有正在发生的告警')).toBeVisible()
    await expect(page.getByText('近 30 日没有打开来源平台入口的记录')).toBeVisible()
  })

  test('局部失败：失败块单独标注，其余数字仍真实', async ({ page }) => {
    await serveJson(page, govDegraded())
    await open(page, '/screen?profile=gov')
    await expect(page.getByText(/部分数据源本次查询失败（3 项）/)).toBeVisible()
    await expect(page.locator('.ops-card.is-failed')).toHaveCount(3)
    // 未失败的块保持真实值
    await expect(page.getByText('9,706')).toBeVisible()
    // 失败与结构性未接入必须长得不一样
    await expect(page.locator('.ops-card.is-na:not(.is-failed)')).toHaveCount(2)
  })

  test('status=unavailable 走的是 HTTP 200，屏上不能出现任何数值', async ({ page }) => {
    await serveJson(page, govUnavailable())
    await open(page, '/screen?profile=gov')
    await expect(page.getByText(/本次快照的全部数据源均查询失败/)).toBeVisible()
    const digits = await visibleDigits(page)
    expect(digits, `未接入时不该出现任何指标读数：${JSON.stringify(digits)}`).toEqual([])
  })

  test('401：不跳登录页，就地给「重新登录」', async ({ page }) => {
    await serveStatus(page, 401, { code: 'AUTH_TOKEN_INVALID', message: 'Token 无效或已过期' })
    await open(page, '/screen?profile=gov')
    await expect(page.getByText('登录已过期')).toBeVisible()
    await expect(page.getByRole('button', { name: '重新登录' })).toBeVisible()
    await expect(page).toHaveURL(/\/screen/)
  })

  test('403：按角色文案提示，不误导成网络故障', async ({ page }) => {
    await serveStatus(page, 403, { code: 'AUTH_ROLE_FORBIDDEN', message: '当前角色无权访问 (需要: admin)' })
    await open(page, '/screen?profile=gov')
    await expect(page.getByText('无权查看本大屏')).toBeVisible()
    await expect(page.getByText('当前账号没有查看管理员数据大屏的权限')).toBeVisible()
  })

  test('网络失败：没有任何成功数据时不显示数值，给重试', async ({ page }) => {
    await page.route('**/admin/screen/snapshot*', (route) => route.abort())
    await open(page, '/screen?profile=gov')
    await expect(page.getByText('与服务器断开')).toBeVisible()
    await expect(page.getByRole('button', { name: '重试' })).toBeVisible()
  })

  test('陈旧数据：刷新失败后保留上次成功值并标注', async ({ page }) => {
    let serveOk = true
    await page.route('**/admin/screen/snapshot*', async (route) => {
      if (serveOk) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: govFull() }),
        })
        return
      }
      await route.abort()
    })
    await open(page, '/screen?profile=gov')
    await expect(page.getByText('128,431')).toBeVisible()
    serveOk = false
    await page.getByRole('button', { name: '刷新' }).click()
    await expect(page.getByText(/最近一次刷新失败/)).toBeVisible()
    // 上次成功的数字仍在，没有被清成 0 或空
    await expect(page.getByText('128,431')).toBeVisible()
    await expect(page.locator('.ops-stamp.is-stale')).toBeVisible()
  })

  /**
   * 会话是在**已经有数据之后**过期的 —— 这才是挂在墙上的那台机器的常态。
   *
   * consoleScreen.ts 的文件头把这条口径写死了：401 之所以**不**自动跳登录页，
   * 是因为「大屏常年挂在无人看管的机器上，JWT 过期后硬跳会把墙上变成一张登录表单」，
   * 代价是**由页面显示「登录已过期 + 重新登录」**。那句承诺此前只在
   * `!data` 那一支兑现；一旦取成功过一次，data 就永远非空，之后任何 401 都只剩
   * 一句通用的「最近一次刷新失败」。数字停在几小时前，屏上却没有一个字说得清
   * 为什么、也没有一个可点的地方 —— 正是这条口径想避免的那种墙。
   *
   * 所以这里断言两件事同时成立：上次成功的数字**不许**被清成 0（不伪造），
   * 且必须说得出是登录过期并给出动作（不含糊）。
   */
  test('会话在取数成功之后过期：保留上次数值，同时说清是登录过期并给动作', async ({ page }) => {
    let authed = true
    await page.route('**/admin/screen/snapshot*', async (route) => {
      if (authed) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: govFull() }),
        })
        return
      }
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, error: { code: 'AUTH_TOKEN_INVALID', message: 'Token 无效或已过期' } }),
      })
    })
    await open(page, '/screen?profile=gov')
    await expect(page.getByText('128,431')).toBeVisible()

    authed = false
    await page.getByRole('button', { name: '刷新' }).click()

    // ① 不伪造：上次成功的数字仍在，没有被清成 0 或空
    await expect(page.getByText('128,431')).toBeVisible()
    await expect(page.locator('.ops-stamp.is-stale')).toBeVisible()
    // ② 不含糊：说得出是登录过期，而不是只说「刷新失败」
    await expect(page.getByText(/登录已过期/)).toBeVisible()
    // ③ 给得出动作，且点之前不跳转
    await expect(page.getByRole('button', { name: '重新登录' })).toBeVisible()
    await expect(page).toHaveURL(/\/screen/)
  })

  /** 403 同理：角色被撤之后数字同样会冻住，屏上必须说清是权限，不能混成网络故障。 */
  test('权限在取数成功之后被撤：保留上次数值，同时说清是权限问题', async ({ page }) => {
    let allowed = true
    await page.route('**/admin/screen/snapshot*', async (route) => {
      if (allowed) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: govFull() }),
        })
        return
      }
      await route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, error: { code: 'AUTH_ROLE_FORBIDDEN', message: '当前角色无权访问 (需要: admin)' } }),
      })
    })
    await open(page, '/screen?profile=gov')
    await expect(page.getByText('128,431')).toBeVisible()

    allowed = false
    await page.getByRole('button', { name: '刷新' }).click()

    await expect(page.getByText('128,431')).toBeVisible()
    await expect(page.getByText(/已无权查看本大屏/)).toBeVisible()
    await expect(page.getByText('当前账号没有查看管理员数据大屏的权限')).toBeVisible()
  })

  test('列表截断如实说明；freshness 与访问口径上屏', async ({ page }) => {
    await serveByProfile(page, { gov: govFull(), ops: opsFull() })
    await open(page, '/screen?profile=ops')
    // 定高卡只画得下 4 行，说明行必须按**实际画出来的行数**报，不能照抄服务端的 6
    await expect(page.getByText('已列出 4 / 共 137 条')).toBeVisible()
    await expect(page.getByText(/取数来源：实时 本次新取/)).toBeVisible()
    await expect(page.getByText(/未签发免登录只读展示令牌/)).toBeVisible()
  })

  test('手动刷新与版本切换；不写任何浏览器存储', async ({ page }) => {
    const log = await serveByProfile(page, { gov: govFull(), ops: opsFull() })
    await open(page, '/screen?profile=gov')
    const before = log.urls.length
    await page.getByRole('button', { name: '刷新' }).click()
    await expect.poll(() => log.urls.length).toBeGreaterThan(before)
    await page.getByRole('button', { name: '运营版' }).click()
    await expect(page.getByRole('heading', { name: '终端运营看板' })).toBeVisible()
    const stored = await page.evaluate(() =>
      Object.keys(localStorage).filter((key) => key !== 'admin_auth_v1'),
    )
    expect(stored).toEqual([])
  })

  test('动效可关，关掉后布局不变只是静止', async ({ page }) => {
    await serveJson(page, govFull())
    await open(page, '/screen?profile=gov')
    const cardsBefore = await page.locator('.ops-card').count()
    await page.getByRole('button', { name: '关闭动效' }).click()
    await expect(page.locator("[data-ops-motion='off']")).toHaveCount(1)
    await expect(page.locator('.ops-card')).toHaveCount(cardsBefore)
    // 纵深层次是静态的，降级后仍然保留
    const z = await page.locator('.ops-d.is-err').first().evaluate((el) => getComputedStyle(el).transform)
    expect(z).not.toBe('none')
  })

  test('标题层级：嵌入态全页唯一 h1，全屏演示态大屏标题升为 h1', async ({ page }) => {
    await serveJson(page, govFull())
    await open(page, '/screen?profile=gov')

    // 嵌入态：外层 PageHeader 占 h1，大屏页眉必须让位到 h2。
    // 一页两个 h1 读屏器分不出主次，partner 的 route-sweep 也会 strict mode violation。
    await expect(page.locator('h1')).toHaveCount(1)
    await expect(page.locator('h1')).toHaveText('数据大屏')
    await expect(page.locator('.ops-hd h2')).toHaveText('就业服务终端 · 运行概览')
    await expect(page.locator('.ops-hd h1')).toHaveCount(0)

    // 降级成 h2 不能掉回浏览器默认字号 / 默认外边距 —— 那会是一次真实的像素回归。
    // 字阶由 `.ops-hd :is(h1, h2)` 覆盖，这里按两档实测值钉住。
    const deskStyle = await page.locator('.ops-hd h2').evaluate((el) => {
      const style = getComputedStyle(el)
      return { fontSize: style.fontSize, marginTop: style.marginTop, marginBottom: style.marginBottom }
    })
    expect(deskStyle, '桌面档标题仍是 22px 且外边距被重置').toEqual({
      fontSize: '22px',
      marginTop: '0px',
      marginBottom: '0px',
    })

    // 全屏演示：覆盖层就是整份文档，标题回到 h1，且必须仍是可访问的标题而不是普通文字
    await page.getByRole('button', { name: '全屏演示' }).click()
    await expect(page.locator("[data-ops-screen='wall']")).toBeVisible()
    await expect(page.locator('h1')).toHaveCount(1)
    await expect(
      page.getByRole('heading', { level: 1, name: '就业服务终端 · 运行概览' }),
    ).toBeVisible()

    const wallFontSize = await page
      .locator('.ops-hd h1')
      .evaluate((el) => getComputedStyle(el).fontSize)
    expect(wallFontSize, '舞台档标题仍是 34px').toBe('34px')
  })

  test('全屏演示进入 1920×1080 舞台', async ({ page }) => {
    await serveJson(page, govFull())
    await open(page, '/screen?profile=gov')
    await page.getByRole('button', { name: '全屏演示' }).click()
    await expect(page.locator("[data-ops-screen='wall']")).toBeVisible()
    const stage = await page.locator('.ops-stage').boundingBox()
    expect(stage).not.toBeNull()
    await expect(page.getByRole('button', { name: '退出全屏演示' })).toBeVisible()
  })
})
