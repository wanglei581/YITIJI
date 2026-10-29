import { expect, test } from '@playwright/test'
import { openAuthed, settleAdminPage } from './helpers/open'

test('工作台显示演示授权行，「去处理」打开对应机构', async ({ page }) => {
  const guards = await openAuthed(page, '/')
  await settleAdminPage(page, guards)
  const today = page.locator('section').filter({ has: page.getByRole('heading', { name: '今天要处理', exact: true }) })
  for (const [title, name, id, detail] of [
    ['1 家机构处于授权宽限期', '市人才交流中心(演示)', 'org-mock-1', '宽限期还剩 3 天'],
    ['1 家机构的授权 30 天内到期', '某大学就业指导中心(演示)', 'org-mock-2', '还剩 12 天'],
  ]) {
    const row = today.locator('div').filter({ has: page.getByText(title, { exact: true }) }).filter({ hasText: name }).last()
    await expect(row).toContainText(detail)
    await expect(row.getByRole('link', { name: '去处理' })).toHaveAttribute('href', `/partners?org=${id}`)
  }
  await expect(today).toContainText('宽限期内照常服务，结束后自动停用')
  await expect(today).not.toContainText('授权已停用')
  // 链接真能打开那家机构的详情（演示 id 与合作机构管理页一致）
  const grace = today.locator('div').filter({ has: page.getByText('1 家机构处于授权宽限期', { exact: true }) }).last()
  await grace.getByRole('link', { name: '去处理' }).click()
  await expect(page.getByRole('dialog')).toContainText('机构详情 — 市人才交流中心(演示)')
})
