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

test('风险提示报告复用打印确认页且放弃后离开敏感链路 @contract', async ({ page }) => {
  test.setTimeout(45_000)
  await startReview(page)
  await expect(page.getByText('确认文件提取结果')).toBeVisible({ timeout: 12_000 })
  await page.getByRole('button', { name: '确认，开始分析' }).click()
  await expect(page).toHaveURL(/\/contract-review\/result$/, { timeout: 18_000 })

  await page.getByRole('button', { name: '打印风险提示报告' }).click()
  await expect(page.getByText('确认打印风险提示报告')).toBeVisible()
  await expect(page.getByText(/不打印合同原件/)).toBeVisible()
  await page.getByRole('button', { name: '生成报告并查看报价' }).click()

  await expect(page).toHaveURL(/\/print\/confirm$/)
  await expect(page.getByText('AI签约风险提示报告.pdf').first()).toBeVisible()
  await expect(page.getByRole('button', { name: '按以上设置打印风险提示报告' })).toBeVisible()
  await expect(page.getByText(/本次仅打印 AI 风险提示报告/)).toBeVisible()
  await expect(page.getByText(/附加自我探索/)).toHaveCount(0)

  const serializedHistory = await page.evaluate(() => JSON.stringify(window.history.state))
  expect(serializedHistory).not.toContain('mock-contract-review-access-token')
  expect(serializedHistory).not.toContain('mock-task-001')
  await page.getByRole('button', { name: '放弃打印' }).last().click()
  await expect(page).toHaveURL(/\/resume-service$/)
})
