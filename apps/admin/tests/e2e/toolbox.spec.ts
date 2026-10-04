import { expect, test } from '@playwright/test'
import { expectDialogAndDismiss } from './helpers/guards'
import { openAuthed, settleAdminPage } from './helpers/open'

test.describe('百宝箱（mock 口径）', () => {
  test('三个分区可切换；熔断有二次确认', async ({ page }) => {
    const guards = await openAuthed(page, '/toolbox')
    await settleAdminPage(page, guards)
    await expect(page.getByRole('heading', { name: '百宝箱 / 微应用治理' })).toBeVisible()

    await page.getByRole('button', { name: '域名白名单' }).click()
    await expect(page.getByRole('heading', { name: '域名审核记录' })).toBeVisible()
    await expect(page.getByText('外部网页或二维码目标地址必须同时通过本页审核和服务器配置检查，才能发布。')).toBeVisible()
    await expect(page.locator('main')).not.toContainText(/DB 审核表|DB 与 env|TOOLBOX_ALLOW_EXTERNAL_URL/)
    await expect(page.getByPlaceholder('trusted.example.com')).toBeVisible()
    await page.getByRole('button', { name: '终端投放配置' }).click()
    await page.getByRole('button', { name: '微应用审核发布' }).click()

    await expect(page.getByText(/发布失败时会说明具体原因/)).toBeVisible()
    const fuse = page.getByRole('button', { name: /熔断/ }).first()
    if (await fuse.isVisible()) {
      await expectDialogAndDismiss(page, () => fuse.click(), /确认熔断微应用/)
    }
  })
})
