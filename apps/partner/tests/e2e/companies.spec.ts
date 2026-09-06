import { test, expect } from '@playwright/test'
import { collectPageFaults, gotoPartner, injectPartnerAuth, waitForMockList, assertPageHonest } from './helpers'

test.describe('企业资料管理（mock 口径）', () => {
  test.beforeEach(async ({ page }) => {
    await injectPartnerAuth(page)
  })

  test('必填拦截、校验错误中文可见、提交成功', async ({ page }) => {
    const { errors } = collectPageFaults(page)
    await gotoPartner(page, '/companies', '企业资料管理')
    await waitForMockList(page)

    await page.getByRole('button', { name: '新增企业' }).click()
    const drawer = page.getByRole('dialog', { name: /新增企业/ })
    await expect(drawer.getByRole('button', { name: '提交审核' })).toBeDisabled()

    await drawer.getByPlaceholder('来源系统中的企业唯一编号').fill('E2E-CO-1')
    await drawer.locator('input').nth(1).fill('A')
    await expect(drawer.getByRole('button', { name: '提交审核' })).toBeEnabled()
    await drawer.getByRole('button', { name: '提交审核' }).click()
    await expect(drawer.getByText('企业名称长度须为 2-80 个字符')).toBeVisible()

    await drawer.locator('input').nth(1).fill('E2E 演示企业')
    await drawer.getByPlaceholder(/http/).first().fill('not-a-url')
    await drawer.getByRole('button', { name: '提交审核' }).click()
    await expect(drawer.getByText(/必须是 http\/https 开头/)).toBeVisible()

    await drawer.getByPlaceholder(/http/).first().fill('')
    await drawer.getByRole('button', { name: '提交审核' }).click()
    await expect(page.getByText(/企业资料已录入,进入待审核/)).toBeVisible()
    await expect(page.getByText('E2E 演示企业')).toBeVisible()
    await assertPageHonest(page, errors)
  })

  test('下架二次确认：取消不变，确认后终端不再展示', async ({ page }) => {
    await gotoPartner(page, '/companies', '企业资料管理')
    await waitForMockList(page)
    const row = page.getByRole('row', { name: /演示科技有限公司/ })
    await expect(row.getByText('已发布')).toBeVisible()
    await row.getByRole('button', { name: '下架' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: '取消' }).click()
    await expect(row.getByText('已发布')).toBeVisible()

    await row.getByRole('button', { name: '下架' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: '确认下架' }).click()
    await expect(page.getByText('企业资料已下架')).toBeVisible()
    await expect(row.getByText('已下架')).toBeVisible()
  })

  test('被驳回企业展示中文原因；筛选可点', async ({ page }) => {
    await gotoPartner(page, '/companies', '企业资料管理')
    await waitForMockList(page)
    await page.getByRole('button', { name: /^已拒绝/ }).click()
    await expect(page.getByText('被驳回企业')).toBeVisible()
    await expect(page.getByText(/企业简介缺少主营业务说明/)).toBeVisible()
  })
})
