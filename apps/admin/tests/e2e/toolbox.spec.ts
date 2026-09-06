import { expect, test } from '@playwright/test'
import { expectDialogAndDismiss } from './helpers/guards'
import { openAuthed, settleAdminPage } from './helpers/open'

test.describe('百宝箱（mock 口径）', () => {
  test('三个分区可切换；熔断有二次确认', async ({ page }) => {
    const guards = await openAuthed(page, '/toolbox')
    await settleAdminPage(page, guards)
    await expect(page.getByRole('heading', { name: '百宝箱 / 微应用治理' })).toBeVisible()

    await page.getByRole('button', { name: '域名白名单' }).click()
    await page.getByRole('button', { name: '终端投放配置' }).click()
    await page.getByRole('button', { name: '微应用审核发布' }).click()

    const fuse = page.getByRole('button', { name: /熔断/ }).first()
    if (await fuse.isVisible()) {
      await expectDialogAndDismiss(page, () => fuse.click(), /确认熔断微应用/)
    }
  })
})
