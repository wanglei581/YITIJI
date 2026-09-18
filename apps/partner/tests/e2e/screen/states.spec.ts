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
