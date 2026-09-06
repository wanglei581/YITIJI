import { test, expect } from '@playwright/test'
import { collectPageFaults, gotoPartner, injectPartnerAuth, waitForMockList, assertPageHonest } from './helpers'

test.describe('岗位信息管理（mock 口径）', () => {
  test.beforeEach(async ({ page }) => {
    await injectPartnerAuth(page)
  })

  test('筛选、新增校验拦截、提交有中文成功反馈', async ({ page }) => {
    const { errors } = collectPageFaults(page)
    await gotoPartner(page, '/jobs', '岗位信息管理')
    await waitForMockList(page)
    await expect(page.getByText('软件开发实习生')).toBeVisible()

    await page.getByRole('button', { name: /^实习/ }).click()
    await expect(page.getByText('软件开发实习生')).toBeVisible()
    await expect(page.getByText('前端开发工程师')).toHaveCount(0)

    await page.getByRole('button', { name: /^全部/ }).first().click()
    await page.getByRole('button', { name: /^已拒绝/ }).click()
    await expect(page.getByText('市场推广兼职')).toBeVisible()
    await expect(page.getByText('来源链接无法打开')).toBeVisible()

    await page.getByRole('button', { name: /^全部/ }).nth(1).click()
    await page.getByRole('button', { name: '新增岗位' }).click()
    const drawer = page.getByRole('dialog', { name: /新增岗位/ })
    await expect(drawer).toBeVisible()
    await expect(drawer.getByRole('button', { name: '提交审核' })).toBeDisabled()

    await drawer.getByRole('textbox').first().fill('E2E 手工岗位')
    await drawer.locator('input').nth(1).fill('E2E 公司')
    await drawer.locator('input').nth(2).fill('青岛')
    await drawer.getByPlaceholder(/https:\/\//).fill('https://example.com/job/e2e')
    await drawer.getByRole('button', { name: '提交审核' }).click()
    await expect(page.getByText(/岗位已录入,进入待审核/)).toBeVisible()
    await expect(page.getByText('E2E 手工岗位')).toBeVisible()
    await assertPageHonest(page, errors)
  })

  test('下架有二次确认，取消后仍为已发布', async ({ page }) => {
    await gotoPartner(page, '/jobs', '岗位信息管理')
    await waitForMockList(page)
    const row = page.getByRole('row', { name: /软件开发实习生/ })
    await expect(row.getByText('已发布')).toBeVisible()
    await row.getByRole('button', { name: '下架' }).click()
    const confirm = page.getByRole('alertdialog')
    await expect(confirm).toContainText('确认下架')
    await confirm.getByRole('button', { name: '取消' }).click()
    await expect(confirm).toHaveCount(0)
    await expect(row.getByText('已发布')).toBeVisible()

    await row.getByRole('button', { name: '下架' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: '确认下架' }).click()
    await expect(page.getByText('岗位已下架')).toBeVisible()
    await expect(row.getByText('已下架')).toBeVisible()
  })

  test('编辑保存后进入待审核，取消不改标题', async ({ page }) => {
    await gotoPartner(page, '/jobs', '岗位信息管理')
    await waitForMockList(page)
    const row = page.getByRole('row', { name: /产品运营校招生/ })
    await row.getByRole('button', { name: '编辑' }).click()
    const drawer = page.getByRole('dialog', { name: '编辑岗位' })
    await drawer.getByRole('textbox').first().fill('不应保存的标题')
    await drawer.getByRole('button', { name: '取消' }).click()
    await expect(page.getByText('产品运营校招生')).toBeVisible()
    await expect(page.getByText('不应保存的标题')).toHaveCount(0)

    await row.getByRole('button', { name: '编辑' }).click()
    await page.getByRole('dialog', { name: '编辑岗位' }).getByRole('textbox').first().fill('产品运营校招生（已修订）')
    await page.getByRole('dialog').getByRole('button', { name: '保存并重新提审' }).click()
    await expect(page.getByText(/修改已保存/)).toBeVisible()
    await expect(page.getByText('产品运营校招生（已修订）')).toBeVisible()
  })
})
