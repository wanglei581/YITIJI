import { test, expect } from '@playwright/test'
import { collectPageFaults, gotoPartner, injectPartnerAuth, waitForMockList, assertPageHonest } from './helpers'

test.describe('数据源管理（mock 口径）', () => {
  test.beforeEach(async ({ page }) => {
    await injectPartnerAuth(page)
  })

  test('新增：空名称中文校验；Excel 源创建成功', async ({ page }) => {
    const { errors } = collectPageFaults(page)
    await gotoPartner(page, '/sources', '数据源管理')
    await waitForMockList(page)

    await page.getByRole('button', { name: '新增数据来源' }).click()
    await expect(page.getByRole('heading', { name: '新增数据来源' })).toBeVisible()
    await page.getByRole('button', { name: 'Excel / CSV 导入' }).click()
    await page.getByRole('button', { name: '创建 Excel 数据源' }).click()
    await expect(page.getByText('请填写数据源名称')).toBeVisible()

    await page.getByPlaceholder(/某企业 ATS/).fill('E2E Excel 源')
    await page.getByRole('button', { name: '创建 Excel 数据源' }).click()
    await expect(page.getByText('E2E Excel 源')).toBeVisible()

    await page.getByRole('button', { name: '取消' }).click()
    await expect(page.getByRole('heading', { name: '新增数据来源' })).toHaveCount(0)
    await assertPageHonest(page, errors)
  })

  test('停用二次确认：取消后仍已连接', async ({ page }) => {
    await gotoPartner(page, '/sources', '数据源管理')
    await waitForMockList(page)
    const row = page.getByRole('row', { name: /高校就业信息 Excel/ })
    await expect(row.getByText('已连接')).toBeVisible()
    await row.getByRole('button', { name: '停用' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: '取消' }).click()
    await expect(row.getByText('已连接')).toBeVisible()

    await row.getByRole('button', { name: '停用' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: '确认停用' }).click()
    await expect(row.getByText('已停用')).toBeVisible()
  })

  test('归档二次确认：取消不变；确认后出现已归档', async ({ page }) => {
    await gotoPartner(page, '/sources', '数据源管理')
    await waitForMockList(page)
    const row = page.getByRole('row', { name: /校园兼职平台导入/ })
    await row.getByRole('button', { name: '归档' }).click()
    const confirm = page.getByRole('dialog', { name: /归档数据源/ })
    await expect(confirm).toContainText('已发布的岗位/招聘会不会被自动下架')
    await confirm.getByRole('button', { name: '取消' }).click()
    await expect(row.getByText('已归档')).toHaveCount(0)

    await row.getByRole('button', { name: '归档' }).click()
    await page.getByRole('dialog', { name: /归档数据源/ }).getByRole('button', { name: '确认归档' }).click()
    await expect(row.getByText('已归档')).toBeVisible()
  })

  test('Webhook 查看接入与轮换密钥：取消不轮换，确认后一次性密钥可见', async ({ page }) => {
    await gotoPartner(page, '/sources', '数据源管理')
    await waitForMockList(page)
    const row = page.getByRole('row', { name: /市人社局 Webhook/ })
    await row.getByRole('button', { name: '查看接入' }).click()
    const guide = page.getByRole('dialog', { name: /Webhook 接入说明/ })
    await expect(guide).toContainText('x-webhook-signature')
    await page.keyboard.press('Escape')

    await row.getByRole('button', { name: '轮换密钥' }).click()
    const rotate = page.getByRole('dialog', { name: /轮换凭证/ })
    await expect(rotate).toContainText('旧凭证立即失效')
    await rotate.getByRole('button', { name: '取消' }).click()
    await expect(rotate).toHaveCount(0)

    await row.getByRole('button', { name: '轮换密钥' }).click()
    await page.getByRole('dialog', { name: /轮换凭证/ }).getByRole('button', { name: '确认轮换' }).click()
    await expect(page.getByText('新签名密钥（仅显示这一次）')).toBeVisible()
    await expect(page.getByRole('button', { name: '完成' })).toBeDisabled()
    await page.getByText(/我已保存/).click()
    await page.getByRole('button', { name: '完成' }).click()
  })

  test('Excel 字段映射四步：校验文件类型、预览、确认导入有成功反馈', async ({ page }) => {
    await gotoPartner(page, '/sources', '数据源管理')
    await waitForMockList(page)
    await page.getByRole('row', { name: /高校就业信息 Excel/ }).getByRole('button', { name: '字段映射' }).click()
    const modal = page.getByText('Excel / CSV 导入').locator('xpath=ancestor::div[contains(@class,"rounded-2xl")]')
    await expect(page.getByRole('heading', { name: 'Excel / CSV 导入' })).toBeVisible()

    await expect(page.getByRole('button', { name: '下一步' })).toBeDisabled()
    await page.locator('input[type="file"]').setInputFiles({
      name: 'jobs.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('nope'),
    })
    await expect(page.getByText('仅支持 .xlsx 或 .csv 文件')).toBeVisible()

    await page.locator('input[type="file"]').setInputFiles({
      name: 'jobs.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('外部ID,职位名称\nEX-001,前端'),
    })
    await page.getByRole('button', { name: '下一步' }).click()
    await expect(page.getByRole('button', { name: '生成预览' })).toBeVisible()
    await page.getByRole('button', { name: '生成预览' }).click()
    await expect(page.getByText(/将导入 7 行/)).toBeVisible()
    await page.getByRole('button', { name: /确认导入/ }).click()
    await expect(page.getByText('导入成功')).toBeVisible()
    await page.getByRole('button', { name: '关闭' }).click()
    await expect(page.getByText(/文件导入完成，共 7 条/)).toBeVisible()
    void modal
  })
})
