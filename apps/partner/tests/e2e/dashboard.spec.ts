import { test, expect } from '@playwright/test'
import { collectPageFaults, gotoPartner, injectPartnerAuth, waitForMockList, assertPageHonest } from './helpers'

test.describe('工作台（mock 口径）', () => {
  test.beforeEach(async ({ page }) => {
    await injectPartnerAuth(page)
  })

  test('概览卡片、待审核入口、同步记录可点', async ({ page }) => {
    const { errors } = collectPageFaults(page)
    await gotoPartner(page, '/', '工作台')
    await waitForMockList(page)

    await expect(page.getByText('已上传岗位')).toBeVisible()
    await expect(page.getByText('市人才网 API（演示）')).toBeVisible()

    await page.getByRole('button', { name: '去查看' }).click()
    await page.waitForURL(/\/jobs/)
    await expect(page.getByRole('heading', { level: 1, name: '岗位信息管理' })).toBeVisible()

    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await waitForMockList(page)
    await page.getByRole('button', { name: '查看全部' }).click()
    await page.waitForURL(/\/sync-logs/)
    await expect(page.getByRole('heading', { level: 1, name: '同步日志' })).toBeVisible()

    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await waitForMockList(page)
    await page.getByRole('region', { name: '数据概览' }).getByText('数据源', { exact: true }).click()
    await page.waitForURL(/\/sources/)
    await expect(page.getByRole('heading', { level: 1, name: '数据源管理' })).toBeVisible()
    await assertPageHonest(page, errors)
  })

  test('退出登录回到登录页', async ({ page }) => {
    await gotoPartner(page, '/', '工作台')
    await page.getByRole('button', { name: '退出登录' }).click()
    await page.waitForURL(/\/login/)
    await expect(page.getByRole('heading', { name: '合作机构登录' })).toBeVisible({ timeout: 15_000 })
  })
})
