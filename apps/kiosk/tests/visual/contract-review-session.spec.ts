import { expect, test, type Page } from '@playwright/test'

async function startReview(page: Page): Promise<void> {
  await page.goto('/contract-review')
  await page.locator('input[type="file"]').setInputFiles({
    name: 'contract.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\n%%EOF'),
  })
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: '开始风险分析' }).click()
  await expect(page).toHaveURL(/\/contract-review\/processing$/)
}

test('合同凭证不进 history，刷新后无法恢复 @contract', async ({ page }) => {
  await startReview(page)

  await expect(page.getByText(/刷新、关闭页面或切换用户会结束本次查看/)).toBeVisible()
  const serializedHistory = await page.evaluate(() => JSON.stringify(window.history.state))
  expect(serializedHistory).not.toContain('mock-contract-review-access-token')
  expect(serializedHistory).not.toContain('mock-task-001')

  await page.reload()
  await expect(page).toHaveURL(/\/contract-review$/)
  await expect(page.getByRole('button', { name: '开始风险分析' })).toBeVisible()
})

test('完成结果只存易失内存，结束后直接访问不能恢复 @contract', async ({ page }) => {
  test.setTimeout(45_000)
  await startReview(page)

  await expect(page.getByText('确认文件提取结果')).toBeVisible({ timeout: 12_000 })
  await page.getByRole('button', { name: '确认，开始分析' }).click()
  await expect(page).toHaveURL(/\/contract-review\/result$/, { timeout: 18_000 })
  await expect(page.getByText('审查结果', { exact: true })).toBeVisible()
  await expect(page.getByText(/当前合同和结果无法从此终端恢复/)).toBeVisible()

  const serializedHistory = await page.evaluate(() => JSON.stringify(window.history.state))
  expect(serializedHistory).not.toContain('mock-contract-review-access-token')
  expect(serializedHistory).not.toContain('试用期为六个月')

  await page.getByRole('button', { name: '结束并删除' }).click()
  await expect(page).toHaveURL(/\/resume-service$/)
  await page.goto('/contract-review/result')
  await expect(page.getByText('未找到审查结果')).toBeVisible()
  await expect(page.getByText('试用期时长可能超过法定上限')).toHaveCount(0)
})

test('风险提示报告可保存到我的文档且不进入打印链路 @contract', async ({ page }) => {
  test.setTimeout(45_000)
  await startReview(page)
  await expect(page.getByText('确认文件提取结果')).toBeVisible({ timeout: 12_000 })
  await page.getByRole('button', { name: '确认，开始分析' }).click()
  await expect(page).toHaveURL(/\/contract-review\/result$/, { timeout: 18_000 })

  await expect(page.getByRole('button', { name: '保存到我的文档' })).toBeVisible()
  await expect(page.getByRole('button', { name: '打印风险提示报告' })).toHaveCount(0)
  await expect(page.getByText(/需要先登录本人会员账号|保存后仅本人/)).toBeVisible()
})
