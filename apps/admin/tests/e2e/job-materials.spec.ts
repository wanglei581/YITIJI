import { expect, test } from '@playwright/test'
import { openAuthed, settleAdminPage } from './helpers/open'

test.describe('求职材料库（mock 口径）', () => {
  test('只读运营页渲染模板或空态', async ({ page }) => {
    const guards = await openAuthed(page, '/job-materials')
    await settleAdminPage(page, guards)
    await expect(page.getByRole('heading', { name: '求职材料库' })).toBeVisible()
    await expect(page.getByText('只读运营口径')).toBeVisible()
  })
})
