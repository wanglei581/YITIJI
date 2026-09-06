import { expect, test } from '@playwright/test'
import { expectChineseFeedback } from './helpers/guards'
import { openAuthed, settleAdminPage } from './helpers/open'

test.describe('账号设置（mock 口径）', () => {
  test('改密校验错误可见；mock 提交给出中文原因', async ({ page }) => {
    const guards = await openAuthed(page, '/account-settings')
    await settleAdminPage(page, guards)
    await expect(page.getByRole('heading', { name: '账号设置' })).toBeVisible()
    await expect(page.getByText('最近登录记录')).toBeVisible()

    await page.locator('#account-current-password').fill('OldPassword1!')
    await page.locator('#account-new-password').fill('aaaaaaaaaaaa')
    await page.locator('#account-confirm-password').fill('aaaaaaaaaaaa')
    await page.getByRole('button', { name: '确认修改' }).click()
    await expectChineseFeedback(page.getByRole('alert'))

    await page.locator('#account-new-password').fill('NewPassword1!')
    await page.locator('#account-confirm-password').fill('OtherPassword1!')
    await page.getByRole('button', { name: '确认修改' }).click()
    await expect(page.getByText('两次输入的新密码不一致')).toBeVisible()

    await page.locator('#account-confirm-password').fill('NewPassword1!')
    await page.getByRole('button', { name: '确认修改' }).click()
    await expect(page.getByText('当前为 mock 模式，该操作需要连接真实后端')).toBeVisible()
  })
})
