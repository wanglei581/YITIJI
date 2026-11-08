import { test, expect } from '@playwright/test'
import { collectPageFaults, gotoPartner, injectPartnerAuth, waitForMockList, assertPageHonest } from './helpers'

test.describe('政策公告（mock 口径）', () => {
  test.beforeEach(async ({ page }) => {
    await injectPartnerAuth(page)
  })

  test('本机构类型禁用新增；下架/删除有确认；条件核对入口已停放', async ({ page }) => {
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
    await expect(page.getByRole('button', { name: '申领条件' })).toHaveCount(0)
    await expect(guideRow.getByText('原文链接：未填写')).toBeVisible()

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

    await expect(page.getByRole('button', { name: '申领条件' })).toHaveCount(0)
  })

  test('扶持条目三栏、标题计数、HTTPS 和公告可选字段', async ({ page }) => {
    await gotoPartner(page, '/policy', '政策公告')
    await waitForMockList(page)
    await page.getByRole('row', { name: /高校毕业生就业补贴/ }).getByRole('button', { name: '编辑' }).click()
    const form = page.getByRole('dialog', { name: '编辑政策内容' })
    const submit = form.getByRole('button', { name: '保存并重新提审' })
    await expect(submit).toBeDisabled()
    await expect(form.getByRole('status')).toContainText('请填齐')
    await expect(form.getByRole('textbox', { name: /^标题/ })).toHaveAttribute('maxlength', '200')
    for (const name of ['谁可以申请', '要准备的材料', '去哪办']) {
      const field = form.getByRole('textbox', { name: new RegExp(`^${name}`) })
      await expect(field).toHaveAttribute('maxlength', '2000')
      await field.fill('按原文填写')
    }
    const source = form.getByRole('textbox', { name: /^原文链接/ })
    await source.fill('http://career.demo-university.edu.cn/policy')
    await expect(submit).toBeDisabled()
    await expect(form.getByRole('status')).toContainText('请填写以 https:// 开头的有效原文链接')
    await source.fill('https://career.demo-university.edu.cn/policy')
    await expect(form.getByText(/须是本机构登记的官方网站上的地址/)).toBeVisible()
    await expect(submit).toBeEnabled()
    await form.getByRole('combobox', { name: /内容类型/ }).selectOption('notice')
    await expect(form.getByRole('textbox', { name: /^谁可以申请/ })).toHaveCount(0)
    await source.fill('')
    await expect(submit).toBeEnabled()
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
