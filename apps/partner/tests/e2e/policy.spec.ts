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
    await expect(page.getByText('政策内容属官方性质，仅公共就业服务机构、高校就业中心、零工之家、就业服务站可发布。本机构不能新增，只能处理已有内容（查看、审核发布、下架）。')).toBeVisible()

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
    await expect(rules.getByRole('status')).toContainText('演示模式不执行')
    await expect(rules.getByRole('button', { name: '重试' })).toBeEnabled()
    await expect(rules.getByRole('button', { name: '保存条件并重新提审' })).toBeDisabled()
    await expect(rules.getByRole('button', { name: '试算这条政策' })).toBeDisabled()
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

  test('托管未打开时招募类不能提审或发布，下架和删除仍可用', async ({ page }) => {
    const reason = '本平台未开放招聘类内容，招募类公告不能再提审或发布，可以下架或删除'
    await page.evaluate(() => window.localStorage.setItem('mock:recruitment-hosting', 'off'))
    await gotoPartner(page, '/policy', '政策公告')
    await waitForMockList(page)

    const pending = page.getByRole('row', { name: /校园宣讲志愿者招募/ })
    await expect(pending.getByRole('button', { name: '审核通过' })).toBeDisabled()
    await expect(page.getByText(reason).first()).toBeVisible()

    const approved = page.getByRole('row', { name: /就业指导讲师招募/ })
    await expect(approved.getByRole('button', { name: '发布', exact: true })).toBeDisabled()

    const published = page.getByRole('row', { name: /档案服务点招募/ })
    await expect(published.getByRole('button', { name: '下架' })).toBeEnabled()
    await expect(published.getByRole('button', { name: '删除' })).toBeEnabled()

    await pending.getByRole('button', { name: '编辑' }).click()
    const locked = page.getByRole('dialog', { name: '编辑政策内容' })
    await expect(locked.getByRole('status')).toContainText(reason)
    await expect(locked.getByText('招募', { exact: true })).toBeVisible()
    await expect(locked.getByRole('combobox', { name: /公告标签/ })).toHaveCount(0)
    await expect(locked.getByRole('button', { name: '保存并重新提审' })).toBeDisabled()
    await locked.getByRole('button', { name: '取消' }).click()

    await page.getByRole('row', { name: /关于就业服务月活动的通知/ }).getByRole('button', { name: '编辑' }).click()
    const notice = page.getByRole('dialog', { name: '编辑政策内容' })
    await expect(notice.getByRole('combobox', { name: /公告标签/ }).locator('option', { hasText: '招募' })).toHaveCount(0)
    await notice.getByRole('button', { name: '取消' }).click()

    await page.getByRole('row', { name: /见习单位招募说明/ }).getByRole('button', { name: '申领条件' }).click()
    const rules = page.getByRole('dialog', { name: /申领条件/ })
    await expect(rules.getByRole('status')).toContainText(reason)
    await expect(rules.getByRole('button', { name: '保存条件并重新提审' })).toBeDisabled()
    await expect(rules.getByRole('button', { name: '试算这条政策' })).toBeDisabled()
    await expect(rules.getByText('演示模式不执行')).toHaveCount(0)
  })

  test('能力没读到时新增表单同样不提供招募', async ({ page }) => {
    await page.evaluate(() => window.localStorage.setItem('mock:recruitment-hosting', 'unavailable'))
    await gotoPartner(page, '/policy', '政策公告')
    await waitForMockList(page)
    await page.getByRole('row', { name: /关于就业服务月活动的通知/ }).getByRole('button', { name: '编辑' }).click()
    const notice = page.getByRole('dialog', { name: '编辑政策内容' })
    await expect(notice.getByRole('combobox', { name: /公告标签/ }).locator('option', { hasText: '招募' })).toHaveCount(0)
    await expect(page.getByRole('row', { name: /校园宣讲志愿者招募/ }).getByRole('button', { name: '审核通过' })).toBeDisabled()
  })

  test('托管打开时招募类审核与发布不被这条限制挡住', async ({ page }) => {
    await page.evaluate(() => window.localStorage.setItem('mock:recruitment-hosting', 'on'))
    await gotoPartner(page, '/policy', '政策公告')
    await waitForMockList(page)
    await expect(page.getByText('本平台未开放招聘类内容')).toHaveCount(0)
    await expect(page.getByRole('row', { name: /校园宣讲志愿者招募/ }).getByRole('button', { name: '审核通过' })).toBeEnabled()
    await expect(page.getByRole('row', { name: /就业指导讲师招募/ }).getByRole('button', { name: '发布', exact: true })).toBeEnabled()
  })
})
