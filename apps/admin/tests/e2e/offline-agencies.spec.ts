import { expect, test } from '@playwright/test'
import { expectChineseFeedback } from './helpers/guards'
import { openAuthed, settleAdminPage } from './helpers/open'

test.describe('线下机构（mock 口径）', () => {
  test('新建空表单被中文校验拦住', async ({ page }) => {
    const guards = await openAuthed(page, '/offline-agencies')
    await settleAdminPage(page, guards)
    await expect(page.getByRole('heading', { name: '线下机构管理' })).toBeVisible()
    await page.getByRole('button', { name: /新建|新增/ }).click()
    await expect(page.getByText('新建线下招聘机构')).toBeVisible()
    await page.getByRole('button', { name: '创建' }).click()
    await expectChineseFeedback(page.getByText('机构名称长度需为 2–80 个字符'))
    await page.getByRole('button', { name: '取消' }).click()
  })
})
