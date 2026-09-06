import { test, expect } from '@playwright/test'
import { collectPageFaults, gotoPartner, injectPartnerAuth, waitForMockList, assertPageHonest } from './helpers'

test.describe('招聘会信息管理（mock 口径）', () => {
  test.beforeEach(async ({ page }) => {
    await injectPartnerAuth(page)
  })

  test('mock 机构类型禁用新增，筛选与编辑可用', async ({ page }) => {
    const { errors } = collectPageFaults(page)
    await gotoPartner(page, '/fairs', '招聘会信息管理')
    await waitForMockList(page)

    const create = page.getByRole('button', { name: '新增招聘会' })
    await expect(create).toBeDisabled()
    await expect(page.getByText(/本机构类型不支持录入招聘会/)).toBeVisible()

    await page.getByRole('button', { name: /^进行中/ }).click()
    await expect(page.getByText('制造业专场招聘会')).toBeVisible()
    await expect(page.getByText('高校双选会（春）')).toHaveCount(0)
    await page.getByRole('button', { name: /^全部/ }).click()

    const row = page.getByRole('row', { name: /互联网行业专场招聘/ })
    await row.getByRole('button', { name: '编辑' }).click()
    const drawer = page.getByRole('dialog', { name: '编辑招聘会' })
    await drawer.getByRole('textbox', { name: /招聘会名称/ }).fill('不应保存的招聘会')
    await drawer.getByRole('button', { name: '取消' }).click()
    await expect(page.getByText('互联网行业专场招聘')).toBeVisible()

    await row.getByRole('button', { name: '编辑' }).click()
    await page.getByRole('dialog', { name: '编辑招聘会' }).getByRole('textbox', { name: /招聘会名称/ }).fill('互联网行业专场招聘（修订）')
    await page.getByRole('dialog', { name: '编辑招聘会' }).getByRole('button', { name: '保存并重新提审' }).click()
    await expect(page.getByText(/修改已保存/)).toBeVisible()
    await assertPageHonest(page, errors)
  })

  test('下架二次确认：取消后仍已发布', async ({ page }) => {
    await gotoPartner(page, '/fairs', '招聘会信息管理')
    await waitForMockList(page)
    const row = page.getByRole('row', { name: /高校双选会（春）/ })
    await row.getByRole('button', { name: '下架' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: '取消' }).click()
    await expect(row.getByText('已发布')).toBeVisible()

    await row.getByRole('button', { name: '下架' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: '确认下架' }).click()
    await expect(page.getByText('招聘会已下架')).toBeVisible()
    await expect(row.getByText('已下架')).toBeVisible()
  })
})
