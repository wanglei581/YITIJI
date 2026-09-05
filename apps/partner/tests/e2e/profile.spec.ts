import { test, expect } from '@playwright/test'
import { collectPageFaults, gotoPartner, injectPartnerAuth, waitForMockList, assertPageHonest } from './helpers'

test.describe('机构资料（mock 口径）', () => {
  test.beforeEach(async ({ page }) => {
    await injectPartnerAuth(page)
  })

  test('编辑联系方式：取消不保存；保存有反馈', async ({ page }) => {
    const { errors } = collectPageFaults(page)
    await gotoPartner(page, '/profile', '机构资料')
    await waitForMockList(page)
    await expect(page.getByText('演示机构（mock 模式）')).toBeVisible()

    await page.getByRole('button', { name: '编辑联系方式' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: '编辑联系方式' })).toBeVisible()
    await dialog.getByRole('textbox').first().fill('临时联系人')
    await dialog.getByRole('button', { name: '取消' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.getByText('演示联系人')).toBeVisible()
    await expect(page.getByText('临时联系人')).toHaveCount(0)

    await page.getByRole('button', { name: '编辑联系方式' }).click()
    await page.getByRole('dialog').getByRole('textbox').first().fill('张三')
    await page.getByRole('dialog').getByRole('button', { name: '保存' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByText('张三')).toBeVisible()
    await assertPageHonest(page, errors)
  })
})
