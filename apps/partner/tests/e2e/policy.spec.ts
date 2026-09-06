import { test, expect } from '@playwright/test'
import { collectPageFaults, gotoPartner, injectPartnerAuth, waitForMockList, assertPageHonest } from './helpers'

test.describe('政策公告（mock 口径）', () => {
  test.beforeEach(async ({ page }) => {
    await injectPartnerAuth(page)
  })

  test('本机构类型禁用新增；下架/删除有确认；申领条件 mock 给中文原因', async ({ page }) => {
    const { errors } = collectPageFaults(page)
    await gotoPartner(page, '/policy', '政策公告')
    await waitForMockList(page)

    await expect(page.getByRole('button', { name: '新增政策内容' })).toBeDisabled()
    await expect(page.getByText(/仅公共就业服务机构与高校就业中心可发布/)).toBeVisible()

    const noticeRow = page.getByRole('row', { name: /关于就业服务月活动的通知/ })
    await noticeRow.getByRole('button', { name: '下架' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: '取消' }).click()
    await expect(noticeRow.getByText('已发布')).toBeVisible()

    await noticeRow.getByRole('button', { name: '下架' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: '确认下架' }).click()
    await expect(page.getByText('政策内容已下架')).toBeVisible()

    const guideRow = page.getByRole('row', { name: /高校毕业生就业补贴/ })
    await guideRow.getByRole('button', { name: '申领条件' }).click()
    const rules = page.getByRole('dialog', { name: /申领条件/ })
    await expect(rules).toContainText('演示模式')
    await rules.locator('button', { hasText: '关闭' }).click()

    await guideRow.getByRole('button', { name: '删除' }).click()
    const del = page.getByRole('alertdialog')
    await expect(del).toContainText('确认删除')
    await del.getByRole('button', { name: '取消' }).click()
    await expect(page.getByText('高校毕业生就业补贴说明（演示）')).toBeVisible()

    await guideRow.getByRole('button', { name: '删除' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: '确认删除' }).click()
    await expect(page.getByText('政策内容已删除')).toBeVisible()
    await expect(page.getByText('高校毕业生就业补贴说明（演示）')).toHaveCount(0)
    await assertPageHonest(page, errors)
  })
})
