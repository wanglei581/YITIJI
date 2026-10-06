import { expect, test } from '@playwright/test'
import { openAuthed, settleAdminPage } from './helpers/open'

test.describe('用户管理（mock 口径：一条演示用户，完整手机号搜不到）', () => {
  test('演示用户最近活动为中文，未命中搜索为空', async ({ page }) => {
    const guards = await openAuthed(page, '/users')
    await settleAdminPage(page, guards)
    await expect(page.getByRole('heading', { name: '用户管理' })).toBeVisible()
    await expect(page.getByText('演示用户')).toBeVisible()
    // 注销筛选进地址栏、可重置（注销界面 #1223）
    await page.getByLabel('注销', { exact: true }).selectOption('requested')
    await expect(page).toHaveURL(/closure=requested/)
    await page.getByRole('button', { name: '重置', exact: true }).click()
    await expect(page.getByLabel('注销', { exact: true })).toHaveValue('')
    await expect(page.getByText('演示用户')).toBeVisible()

    await page.getByRole('button', { name: '查看用户 演示用户 的详情' }).click()
    const dialog = page.getByRole('dialog', { name: '用户详情' })
    await expect(dialog.getByText('上传简历（PDF）')).toBeVisible()
    await expect(dialog.getByText('上传完成')).toBeVisible()
    await expect(dialog.getByText('终端（尾号 b6588e）')).toBeVisible()
    await expect(dialog.getByText('简历优化确认稿')).toBeVisible()
    await expect(dialog.getByText('简历诊断提交')).toBeVisible()
    await expect(dialog.getByText('已完成').first()).toBeVisible()
    const text = await dialog.innerText()
    expect(text).not.toContain('t_09fd')
    expect(text).not.toContain('optimize_confirmed')
    expect(text).not.toContain('resume_upload')
    expect(text).not.toContain('application/pdf')
    expect(text).not.toMatch(/\bactive\b/)
    expect(text).not.toContain('completed')
    const terminal = dialog.getByText('终端（尾号 b6588e）')
    await expect(terminal).toHaveAttribute('title', 't_09fd272201b6588e')

    await page.getByRole('button', { name: '关闭用户详情' }).click()
    await page.getByPlaceholder('搜索昵称、关键词或完整手机号').fill('13800138000')
    await page.getByRole('button', { name: '查询' }).click()
    await expect(page.getByText('未找到符合条件的用户')).toBeVisible()
    await page.getByRole('button', { name: '重置', exact: true }).click()
    await page.getByRole('button', { name: '刷新' }).click()
    await expect(page.getByText('演示用户')).toBeVisible()
  })
})
