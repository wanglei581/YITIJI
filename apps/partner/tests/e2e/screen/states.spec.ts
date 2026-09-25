import { test, expect } from '@playwright/test'
import { partnerDegraded, partnerFull, partnerTruncated } from './fixtures/snapshots'
import { open, serve, serveJson, serveStatus, visibleDigits } from './helpers'

/**
 * 机构大屏状态矩阵。
 * 请求不能带 query（usage 除外，且只能是纠正后的 range），也不能带任何机构标识。
 * 失败说法与管理员共用 TwinShell：旧数据保留，401 不跳转。
 */

const TITLE = '本机构运营概览'

test.describe('partner data screen states', () => {
  test('真实数据上屏，且快照请求不带任何 query', async ({ page }) => {
    const log = await serveJson(page, partnerFull())
    await open(page, '/screen/overview')
    await expect(page.getByRole('heading', { name: TITLE })).toBeVisible()
    const shelf = page.locator('.twin-panel').filter({ hasText: '本机构在架信息' })
    await expect(shelf.locator('.twin-tile').filter({ hasText: '岗位信息' }).locator('b').first()).toContainText('328')
    const gaps = page.locator('.twin-panel').filter({ hasText: '建设中的指标' })
    await expect(gaps).toContainText('14 项')
    await expect(gaps.locator('.twin-pend')).toHaveCount(14)
    const snapshots = log.urls.filter((url) => url.includes('/snapshot'))
    expect(snapshots.length).toBeGreaterThan(0)
    expect(snapshots.every((url) => url === '/api/v1/partner/screen/snapshot')).toBe(true)
    expect(log.urls.some((url) => /orgId/i.test(url))).toBe(false)
  })

  test('不渲染来源机构计数', async ({ page }) => {
    await serveJson(page, partnerFull())
    await open(page, '/screen/overview')
    const shelf = page.locator('.twin-panel').filter({ hasText: '本机构在架信息' })
    await expect(shelf).not.toContainText(/来自 \d+ 家/)
    await page.getByRole('button', { name: '本机构在架信息的口径说明' }).click()
    await expect(page.getByText(/来源机构为本机构/)).toBeVisible()
  })

  test('机队截断：写明前 200 台样本、共 640 台，环上的分母是样本', async ({ page }) => {
    await serveJson(page, partnerTruncated())
    await open(page, '/screen/overview')
    const online = page.getByRole('region', { name: '本机构终端', exact: true })
    await expect(online).toContainText('显示前 200 台，共 640 台')
    await expect(online).toContainText('共 200 台')
    await page.getByRole('button', { name: '本机构终端的口径说明' }).click()
    await expect(page.getByText('以下分类基于前 200 台样本，本机构共 640 台')).toBeVisible()
  })

  test('局部失败：同步成功率单独标注取数失败，在架条数仍真实', async ({ page }) => {
    await serveJson(page, partnerDegraded())
    await open(page, '/screen/overview')
    await expect(page.getByText(/部分数据源本次查询失败（1 项）/)).toBeVisible()
    await expect(page.locator('.twin-na.is-failed')).toHaveCount(1)
    const shelf = page.locator('.twin-panel').filter({ hasText: '本机构在架信息' })
    await expect(shelf.locator('.twin-tile').filter({ hasText: '岗位信息' }).locator('b').first()).toContainText('328')
  })

  test('403 ORG_REQUIRED 与角色不符分开提示', async ({ page }) => {
    await serveStatus(page, 403, { code: 'ORG_REQUIRED', message: '当前账号未绑定机构' })
    await open(page, '/screen/overview')
    await expect(page.getByText('当前账号未绑定机构').first()).toBeVisible()
    await expect(page.getByText(/请联系平台侧为该账号绑定机构/)).toBeVisible()
    await expect(page.getByText('无权查看本大屏')).toHaveCount(0)
  })

  test('401 不跳登录页，给出重新登录', async ({ page }) => {
    await serveStatus(page, 401, { code: 'AUTH_TOKEN_INVALID', message: 'Token 无效或已过期' })
    await open(page, '/screen/overview')
    await expect(page.getByText('登录已过期')).toBeVisible()
    await expect(page.getByRole('button', { name: '重新登录' })).toBeVisible()
    await expect(page).toHaveURL(/\/screen\/overview/)
  })

  test('网络失败没有历史数据时不显示任何数值', async ({ page }) => {
    await serve(page, () => 'abort')
    await open(page, '/screen/overview')
    await expect(page.getByText('与服务器断开')).toBeVisible()
    expect(await visibleDigits(page)).toEqual([])
  })

  test('会话在取数成功之后过期：保留上次数值，同时说清是登录过期并给动作', async ({ page }) => {
    let authed = true
    await serve(page, (url) => {
      if (!authed) {
        return { status: 401, body: { success: false, error: { code: 'AUTH_TOKEN_INVALID', message: 'Token 无效或已过期' } } }
      }
      if (url.pathname.endsWith('/snapshot')) return { status: 200, body: partnerFull() }
      return { status: 404, body: { success: false, error: { code: 'NOT_FOUND', message: '没有这个大屏接口' } } }
    })
    await open(page, '/screen/overview')
    const shelf = page.locator('.twin-panel').filter({ hasText: '本机构在架信息' })
    await expect(shelf).toContainText('328')
    authed = false
    await page.getByRole('button', { name: '刷新' }).click()
    await expect(shelf).toContainText('328')
    await expect(page.getByText(/登录已过期/)).toBeVisible()
    await expect(page.getByRole('button', { name: '重新登录' })).toBeVisible()
    await expect(page).toHaveURL(/\/screen\/overview/)
  })

  test('权限在取数成功之后被撤：保留上次数值，同时说清是权限问题', async ({ page }) => {
    let allowed = true
    await serve(page, (url) => {
      if (!allowed) {
        return { status: 403, body: { success: false, error: { code: 'AUTH_ROLE_FORBIDDEN', message: '当前角色无权访问' } } }
      }
      if (url.pathname.endsWith('/snapshot')) return { status: 200, body: partnerFull() }
      return { status: 404, body: { success: false, error: { code: 'NOT_FOUND', message: '没有这个大屏接口' } } }
    })
    await open(page, '/screen/overview')
    const shelf = page.locator('.twin-panel').filter({ hasText: '本机构在架信息' })
    await expect(shelf).toContainText('328')
    allowed = false
    await page.getByRole('button', { name: '刷新' }).click()
    await expect(shelf).toContainText('328')
    await expect(page.getByText('无权查看本大屏').first()).toBeVisible()
    await expect(page.getByText(/当前账号没有查看机构数据大屏的权限/)).toBeVisible()
  })

  test('机构归属在取数成功之后被解绑：保留上次数值，且与角色不符分开提示', async ({ page }) => {
    let bound = true
    await serve(page, (url) => {
      if (!bound) {
        return { status: 403, body: { success: false, error: { code: 'ORG_REQUIRED', message: '当前账号未绑定机构' } } }
      }
      if (url.pathname.endsWith('/snapshot')) return { status: 200, body: partnerFull() }
      return { status: 404, body: { success: false, error: { code: 'NOT_FOUND', message: '没有这个大屏接口' } } }
    })
    await open(page, '/screen/overview')
    const shelf = page.locator('.twin-panel').filter({ hasText: '本机构在架信息' })
    await expect(shelf).toContainText('328')
    bound = false
    await page.getByRole('button', { name: '刷新' }).click()
    await expect(shelf).toContainText('328')
    await expect(page.getByText(/当前账号未绑定机构/)).toBeVisible()
    await expect(page.getByText(/请联系平台侧为该账号绑定机构/)).toBeVisible()
    await expect(page.getByText(/已无权查看本大屏/)).toHaveCount(0)
  })

  test('标题层级：桌面档页眉是 h2，整页 h1 只有后台页头；展示档 h1 恰好一个', async ({ page }) => {
    await serveJson(page, partnerFull())
    await open(page, '/screen/overview')
    await expect(page.locator('h1')).toHaveCount(1)
    await expect(page.locator('h1')).toHaveText('数据大屏')
    await expect(page.locator('.twin-hd h2')).toHaveText(TITLE)
    await expect(page.locator('.twin-toolbar')).toBeVisible()
    const deskStyle = await page.locator('.twin-hd h2').evaluate((el) => {
      const style = getComputedStyle(el)
      return { fontSize: style.fontSize, marginTop: style.marginTop, marginBottom: style.marginBottom }
    })
    expect(deskStyle).toEqual({ fontSize: '22px', marginTop: '0px', marginBottom: '0px' })

    await page.goto('/screen/overview?display=1')
    await expect(page.locator("[data-ops-screen='wall']")).toBeVisible()
    await expect(page.locator('h1')).toHaveCount(1)
    await expect(page.getByRole('heading', { level: 1, name: TITLE })).toBeVisible()
    await expect(page.locator('.twin-toolbar')).toHaveCount(0)
    await expect(page.getByRole('button', { name: '全屏' })).toBeVisible()
    await expect(page.getByRole('button', { name: '退出展示' })).toBeVisible()
    const wallFontSize = await page.locator('.twin-hd h1').evaluate((el) => getComputedStyle(el).fontSize)
    expect(wallFontSize).toBe('30px')
  })
})
