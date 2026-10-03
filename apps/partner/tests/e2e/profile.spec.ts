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
  test('合规限制以中文显示，原代码只在悬停中', async ({ page }) => {
    const { errors } = collectPageFaults(page)
    await gotoPartner(page, '/profile', '机构资料')
    await waitForMockList(page)
    const limits = [
      ['in_platform_apply', '禁止在平台内投递'], ['candidate_management', '禁止管理候选人'],
      ['resume_delivery_to_enterprise', '禁止向企业推送简历'],
      ['interview_invitation', '禁止向求职者发出企业面试邀约'], ['offer_management', '禁止管理企业录用通知'],
    ]
    for (const [code, label] of limits) {
      await expect(page.getByText(label, { exact: true })).toHaveAttribute('title', code)
      await expect(page.getByText(code, { exact: true })).toHaveCount(0)
    }
    await assertPageHonest(page, errors)
  })

})
