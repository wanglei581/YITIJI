import { expect, test } from '@playwright/test'
import { openAuthed, settleAdminPage } from './helpers/open'

test.describe('告警中心（mock 口径）', () => {
  test('分栏与类型筛选可点，关闭走页内二次确认', async ({ page }) => {
    const guards = await openAuthed(page, '/alerts')
    await settleAdminPage(page, guards)
    await expect(page.getByRole('heading', { name: '告警中心' })).toBeVisible()

    await page.getByRole('button', { name: /待处理/ }).first().click()
    await page.getByRole('button', { name: /已确认/ }).first().click()
    await page.getByRole('button', { name: /已静默/ }).first().click()
    await page.getByRole('button', { name: /待处理/ }).first().click()
    await expect(page.getByRole('table')).toBeVisible()
    const close = page.getByRole('button', { name: '关闭', exact: true }).first()
    await expect(close).toBeVisible()
    {
      await close.click()
      await expect(page.getByText('关闭后不再出现在待处理')).toBeVisible()
      await page.getByRole('button', { name: '取消' }).click()
      await expect(page.getByText('关闭后不再出现在待处理')).toHaveCount(0)
    }

    await page.getByRole('button', { name: '刷新' }).click()
    await expect(page.getByRole('heading', { name: '告警中心' })).toBeVisible()
  })

  test('终端身份冲突与终端凭证到期可显示、可筛选', async ({ page }) => {
    const guards = await openAuthed(page, '/alerts')
    await settleAdminPage(page, guards)
    await expect(page.getByText('终端 KSK-002 疑似被克隆，已暂停领打印任务')).toBeVisible()
    await expect(page.getByText('终端 KSK-007 的终端凭证将于 2026-12-05 到期')).toBeVisible()
    await expect(page.getByText('终端身份冲突').first()).toBeVisible()
    await expect(page.getByText('终端凭证到期').first()).toBeVisible()

    await page.getByRole('button', { name: /终端身份冲突/ }).click()
    await expect(page.getByText('终端 KSK-002 疑似被克隆，已暂停领打印任务')).toBeVisible()
    await expect(page.getByText('终端 KSK-007 的终端凭证将于 2026-12-05 到期')).toHaveCount(0)

    await page.getByRole('button', { name: /终端凭证到期/ }).click()
    await expect(page.getByText('终端 KSK-007 的终端凭证将于 2026-12-05 到期')).toBeVisible()
    await expect(page.getByText('终端 KSK-002 疑似被克隆，已暂停领打印任务')).toHaveCount(0)
  })
})
