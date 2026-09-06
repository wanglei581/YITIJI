import { expect, test } from '@playwright/test'
import { expectDialogAndDismiss } from './helpers/guards'
import { openAuthed, settleAdminPage } from './helpers/open'

test.describe('宣传屏（mock 口径）', () => {
  test('三个 Tab 可切换；删除素材有二次确认', async ({ page }) => {
    const guards = await openAuthed(page, '/screensaver')
    await settleAdminPage(page, guards)
    await expect(page.getByRole('heading', { name: '宣传屏' })).toBeVisible()

    for (const tab of ['素材库', '播放方案', '终端配置']) {
      await page.getByRole('button', { name: tab }).click()
    }

    await page.getByRole('button', { name: '素材库' }).click()
    const remove = page.getByRole('button', { name: /删除/ }).first()
    if (await remove.isVisible()) {
      await expectDialogAndDismiss(page, () => remove.click(), /确认删除素材/)
    }
  })
})
