import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { assertNoTechLeak } from './helpers/guards'
import { openAuthed, settleAdminPage } from './helpers/open'

test('批量预建、下载绑定码，并按批次号筛选', async ({ page }) => {
  const guards = await openAuthed(page, '/devices')
  await settleAdminPage(page, guards)
  await page.getByRole('button', { name: '终端', exact: true }).click()
  await expect(page.getByRole('checkbox', { name: '选择 KSK-001' })).toBeVisible()

  await page.getByRole('button', { name: '批量预建', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '批量预建' })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('编号前缀').fill('E2E-')
  await dialog.getByLabel('起始编号').fill('1')
  await dialog.getByLabel('结束编号').fill('3')
  await dialog.getByRole('button', { name: '开始预建', exact: true }).click()

  const batchFilter = page.getByLabel('按批次号筛选')
  await expect(batchFilter).not.toHaveValue('')
  const batchId = await batchFilter.inputValue()
  await expect(page.getByRole('checkbox', { name: '选择 E2E-1' })).toBeVisible()
  await expect(page.getByRole('checkbox', { name: '选择 E2E-2' })).toBeVisible()
  await expect(page.getByRole('checkbox', { name: '选择 E2E-3' })).toBeVisible()
  await expect(page.getByText('未生成码').first()).toBeVisible()
  await expect(page.getByText('未上报').first()).toBeVisible()

  await batchFilter.fill('')
  await expect(page.getByRole('checkbox', { name: '选择 KSK-001' })).toBeVisible()
  await batchFilter.fill(batchId)
  await expect(page.getByRole('checkbox', { name: '选择 KSK-001' })).toHaveCount(0)
  await expect(page.getByRole('checkbox', { name: '选择 E2E-1' })).toBeVisible()

  await page.getByRole('button', { name: '批量生成绑定码', exact: true }).click()
  const codes = page.getByRole('dialog', { name: '绑定码只显示这一次' })
  await expect(codes).toBeVisible()
  const bindCode = (await codes.getByTestId('issued-bind-code').first().innerText()).trim()
  expect(bindCode.length).toBeGreaterThan(8)
  const downloadPromise = page.waitForEvent('download')
  await codes.getByRole('button', { name: '下载绑定码表格', exact: true }).click()
  const download = await downloadPromise
  const csvPath = await download.path()
  expect(csvPath).toBeTruthy()
  const csv = readFileSync(csvPath!, 'utf8')
  expect(csv).toContain('终端号,名称,点位,绑定码,到期时间')
  expect(csv).toContain('E2E-1')
  expect(csv).toContain(bindCode)
  const stored = await page.evaluate(() => JSON.stringify(window.localStorage))
  expect(stored.includes(bindCode)).toBe(false)
  await assertNoTechLeak(page)
})
