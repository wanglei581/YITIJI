import { test, expect } from '@playwright/test'
import { partnerDegraded, partnerFull, partnerTruncated } from './fixtures/snapshots'
import { open, serveJson, serveStatus, visibleDigits } from './helpers'

/**
 * 机构大屏状态矩阵。重点在两件别处没有的事：
 *   1. 请求绝不能带任何 query（服务端空白名单 + forbidNonWhitelisted，带了就是 400，
 *      而 orgId 更是跨机构风险面）；
 *   2. 机队分类是**样本内**计数，截断时必须写明样本口径，不能当成全量。
 */

test.describe('partner data screen states', () => {
  test('真实数据：7 块可用 + 一块未接入归并，且请求不带任何 query', async ({ page }) => {
    const log = await serveJson(page, partnerFull())
    await open(page, '/screen')
    await expect(page.getByRole('heading', { name: '本机构运营概览' })).toBeVisible()
    await expect(page.locator('.ops-card')).toHaveCount(8)
    await expect(page.locator('.ops-card').filter({ hasText: '本机构在架岗位' }).locator('.ops-n')).toHaveText('328条')
    // 归并面板覆盖 14 项，且如实标注项数，不造成「已全部接入」的错觉
    await expect(page.getByText('本机构暂不可用的指标')).toBeVisible()
    await expect(page.locator('.ops-card').filter({ hasText: '本机构暂不可用的指标' }).locator('.ops-tag')).toHaveText('14 项')
    await expect(page.locator('.ops-gap-row')).toHaveCount(6)
    expect(log.urls, '机构请求必须是无参数的裸路径').toEqual(
      log.urls.map(() => '/api/v1/partner/screen/snapshot'),
    )
    expect(log.urls.length).toBeGreaterThan(0)
  })

  test('不渲染来源机构数（对机构自己恒为 0 或 1，没有信息量且易被误读）', async ({ page }) => {
    await serveJson(page, partnerFull())
    await open(page, '/screen')
    const shelf = page.locator('.ops-card').filter({ hasText: '本机构在架岗位' })
    // 脚注里出现「来源机构为本机构」是对的（那是口径说明）；
    // 不能出现的是「来自 N 家信息来源机构」这种**计数**，它对机构自己恒为 0 或 1。
    await expect(shelf).not.toContainText(/来自 \d+ 家/)
    await expect(shelf.locator('.ops-lb')).toHaveText('终端与小程序上可见的条数')
  })

  test('机队截断：写明「基于前 200 台样本 / 共 640 台」，不把样本当全量', async ({ page }) => {
    await serveJson(page, partnerTruncated())
    await open(page, '/screen')
    await expect(page.getByText(/以下分类基于前 200 台样本，本机构共 640 台/).first()).toBeVisible()
    const online = page.locator('.ops-card').filter({ hasText: '本机构在网终端' })
    // 分母是样本台数而不是 640
    await expect(online.locator('.ops-u')).toHaveText('/ 200 台')
    await expect(online).toContainText('分母为样本台数')
  })

  test('局部失败：同步成功率单独标注取数失败，其余仍真实', async ({ page }) => {
    await serveJson(page, partnerDegraded())
    await open(page, '/screen')
    await expect(page.getByText(/部分数据源本次查询失败（1 项）/)).toBeVisible()
    await expect(page.locator('.ops-card.is-failed')).toHaveCount(1)
    await expect(page.locator('.ops-card').filter({ hasText: '本机构在架岗位' }).locator('.ops-n')).toHaveText('328条')
  })

  test('403 ORG_REQUIRED 与角色不符分开提示', async ({ page }) => {
    await serveStatus(page, 403, { code: 'ORG_REQUIRED', message: '当前账号未绑定机构' })
    await open(page, '/screen')
    await expect(page.locator('.ops-ps-t')).toHaveText('当前账号未绑定机构')
    await expect(page.getByText(/请联系平台侧为该账号绑定机构/)).toBeVisible()
  })

  test('401 不跳登录页', async ({ page }) => {
    await serveStatus(page, 401, { code: 'AUTH_TOKEN_INVALID', message: 'Token 无效或已过期' })
    await open(page, '/screen')
    await expect(page.getByText('登录已过期')).toBeVisible()
    await expect(page).toHaveURL(/\/screen/)
  })

  test('网络失败没有历史数据时不显示任何数值', async ({ page }) => {
    await page.route('**/partner/screen/snapshot*', (route) => route.abort())
    await open(page, '/screen')
    await expect(page.getByText('与服务器断开')).toBeVisible()
    const digits = await visibleDigits(page)
    expect(digits).toEqual([])
  })

  /**
   * 会话是在**已经有数据之后**过期的 —— 挂在机构办公室墙上的那台屏的常态。
   *
   * consoleScreen.ts 第 4 条口径写死了 401 不自动跳登录（大屏可能无人看管，硬跳
   * 会把墙上变成一张登录表单）。代价是页面必须自己说清原因并给动作。那句承诺
   * 此前只在 `!data` 一支兑现；取成功过一次后 data 永不为空（failPolicy: 'keep-last'），
   * 之后任何 401 都只剩一句通用的「最近一次刷新失败」。
   *
   * 两件事必须同时成立：上次成功的数字不许被清成 0（不伪造），
   * 且必须说得出是登录过期并给出动作（不含糊）。
   */
  test('会话在取数成功之后过期：保留上次数值，同时说清是登录过期并给动作', async ({ page }) => {
    let authed = true
    await page.route('**/partner/screen/snapshot*', async (route) => {
      if (authed) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(partnerFull()),
        })
        return
      }
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, error: { code: 'AUTH_TOKEN_INVALID', message: 'Token 无效或已过期' } }),
      })
    })
    await open(page, '/screen')
    const shelf = page.locator('.ops-card').filter({ hasText: '本机构在架岗位' })
    await expect(shelf.locator('.ops-n')).toHaveText('328条')

    authed = false
    await page.getByRole('button', { name: '刷新' }).click()

    // ① 不伪造：上次成功的数字仍在，没有被清成 0 或空
    await expect(shelf.locator('.ops-n')).toHaveText('328条')
    await expect(page.locator('.ops-stamp.is-stale')).toBeVisible()
    // ② 不含糊：说得出是登录过期，而不是只说「刷新失败」
    await expect(page.getByText(/登录已过期/)).toBeVisible()
    // ③ 给得出动作，且点之前不跳转
    await expect(page.getByRole('button', { name: '重新登录' })).toBeVisible()
    await expect(page).toHaveURL(/\/screen/)
  })

  /** 角色被撤之后数字同样会冻住，屏上必须说清是权限，不能混成网络故障。 */
  test('权限在取数成功之后被撤：保留上次数值，同时说清是权限问题', async ({ page }) => {
    let allowed = true
    await page.route('**/partner/screen/snapshot*', async (route) => {
      if (allowed) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(partnerFull()) })
        return
      }
      await route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, error: { code: 'AUTH_ROLE_FORBIDDEN', message: '当前角色无权访问' } }),
      })
    })
    await open(page, '/screen')
    const shelf = page.locator('.ops-card').filter({ hasText: '本机构在架岗位' })
    await expect(shelf.locator('.ops-n')).toHaveText('328条')

    allowed = false
    await page.getByRole('button', { name: '刷新' }).click()

    await expect(shelf.locator('.ops-n')).toHaveText('328条')
    await expect(page.getByText(/已无权查看本大屏/)).toBeVisible()
    await expect(page.getByText(/当前账号没有查看机构数据大屏的权限/)).toBeVisible()
  })

  /**
   * ORG_REQUIRED 在有数据之后发生（机构归属被解绑）：与「角色不符」必须分开说。
   * 机构管理员看到「无权限」会去找平台开权限，而真实动作是让平台重新绑定机构。
   */
  test('机构归属在取数成功之后被解绑：保留上次数值，且与角色不符分开提示', async ({ page }) => {
    let bound = true
    await page.route('**/partner/screen/snapshot*', async (route) => {
      if (bound) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(partnerFull()) })
        return
      }
      await route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, error: { code: 'ORG_REQUIRED', message: '当前账号未绑定机构' } }),
      })
    })
    await open(page, '/screen')
    const shelf = page.locator('.ops-card').filter({ hasText: '本机构在架岗位' })
    await expect(shelf.locator('.ops-n')).toHaveText('328条')

    bound = false
    await page.getByRole('button', { name: '刷新' }).click()

    // 旧数据保留，不清空、不伪造 0
    await expect(shelf.locator('.ops-n')).toHaveText('328条')
    await expect(page.locator('.ops-stamp.is-stale')).toBeVisible()
    // 诚实文案：说的是机构归属，不是权限没开
    await expect(page.getByText(/当前账号未绑定机构/)).toBeVisible()
    await expect(page.getByText(/请联系平台侧为该账号绑定机构/)).toBeVisible()
    // 且不得把它混成「无权查看」
    await expect(page.getByText(/已无权查看本大屏/)).toHaveCount(0)
  })

  test('标题层级：嵌入态全页唯一 h1，全屏演示态大屏标题升为 h1', async ({ page }) => {
    await serveJson(page, partnerFull())
    await open(page, '/screen')

    // 嵌入态：外层 PageHeader 占 h1，大屏页眉让位到 h2。
    // 这正是 route-sweep「已登录访问 /screen」此前 strict mode violation 的根因。
    await expect(page.locator('h1')).toHaveCount(1)
    await expect(page.locator('h1')).toHaveText('数据大屏')
    await expect(page.locator('.ops-hd h2')).toHaveText('本机构运营概览')
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

    // 全屏演示：标题回到 h1，且仍是可访问标题
    await page.getByRole('button', { name: '全屏演示' }).click()
    await expect(page.locator("[data-ops-screen='wall']")).toBeVisible()
    await expect(page.locator('h1')).toHaveCount(1)
    await expect(
      page.getByRole('heading', { level: 1, name: '本机构运营概览' }),
    ).toBeVisible()

    const wallFontSize = await page
      .locator('.ops-hd h1')
      .evaluate((el) => getComputedStyle(el).fontSize)
    expect(wallFontSize, '舞台档标题仍是 34px').toBe('34px')
  })

})
