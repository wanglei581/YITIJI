import { test, expect } from '@playwright/test'
import type { AuditLogRecord } from '@ai-job-print/shared'
import { open, serve, envelope, uncaughtPageErrors } from './helpers'

// 复用现有 http 构建与鉴权旁路；测试夹具不改产品 mock 或业务数据。
test.use({ viewport: { width: 1440, height: 900 }, locale: 'en-US' })
const actorId = 'cmumb2kp40000m7yb1l6p0ssy'
const record: AuditLogRecord = {
  id: 'audit_fixture_123456', actorId, actorRole: 'admin', action: 'admin.user.detail.view',
  targetType: 'EndUser', targetId: 'cmu_target_654321', ipAddress: '::ffff:127.0.0.1',
  requestId: 'request-id-with-a-long-value', userAgent: 'browser-fixture-with-a-long-value',
  createdAt: '2026-09-30T04:00:00Z',
  payloadJson: JSON.stringify({ reason: '核对账号', nested: [{ password: 'plain-secret', phone: '13912345678', email: 'test@example.com', token: 'plain-token' }], unknown_key: '保留未知值' }),
}

async function setup(page: import('@playwright/test').Page, items = [record]) {
  await serve(page, () => envelope({}))
  await page.context().route('**/admin/audit-logs*', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ success: true, data: { items, total: items.length, limit: 20, offset: 0 } }),
  }))
  await open(page, '/audit')
  await expect(page.locator('tbody tr')).toHaveCount(items.length)
}

test.afterEach(async ({ page }) => {
  expect(uncaughtPageErrors(page)).toEqual([])
})

test('六列中文列表、尾号与悬停原值；长字段与递归脱敏在详情', async ({ page }) => {
  await setup(page)
  const table = page.locator('table')
  await expect(table.locator('th')).toHaveText(['时间', '操作人', '角色', '动作', '目标对象', '终端 IP'])
  await expect(table).toContainText('管理员 · 尾号 6p0ssy')
  await expect(table).toContainText('用户 · 尾号 654321')
  await expect(table).toContainText('查看用户详情')
  await expect(table).toContainText('127.0.0.1')
  await expect(table).not.toContainText(/admin\.user\.detail\.view|::ffff:|cmumb2kp40000m7yb1l6p0ssy|request-id-with-a-long-value/)
  await expect(table.getByRole('button', { name: '查看审计详情：管理员 · 尾号 6p0ssy' })).toHaveAttribute('title', actorId)
  await expect(table.getByRole('button', { name: '查看审计详情：127.0.0.1' })).toHaveAttribute('title', '::ffff:127.0.0.1')
  await table.getByRole('button', { name: '查看审计详情：查看用户详情' }).click()
  const drawer = page.getByRole('dialog', { name: '审计日志详情' })
  await expect(drawer).toContainText('request-id-with-a-long-value')
  await expect(drawer).toContainText('browser-fixture-with-a-long-value')
  await expect(drawer).toContainText('原因')
  await expect(drawer).toContainText('核对账号')
  await expect(drawer).toContainText('unknown_key')
  await expect(drawer).toContainText('保留未知值')
  await expect(drawer.getByText('已隐藏', { exact: true })).toHaveCount(4)
  await expect(drawer).not.toContainText(/plain-secret|13912345678|test@example\.com|plain-token/)
  await page.keyboard.press('Escape')
  await expect(drawer).toHaveCount(0)
  const width = await table.evaluate((el) => ({ scroll: el.parentElement!.scrollWidth, client: el.parentElement!.clientWidth }))
  expect(width.scroll).toBeLessThanOrEqual(width.client)
  await expect(page.locator('[lang="zh-CN"]').first()).toBeVisible()
  await expect(page.getByText('起始时间（年/月/日 时:分）')).toBeVisible()
})

test('坏 JSON 提示与折叠原文；敏感坏原文隐藏', async ({ page }) => {
  await setup(page, [{ ...record, payloadJson: '{"password":"bad-secret"' }])
  await page.locator('tbody tr').getByRole('button', { name: '查看审计详情：查看用户详情' }).click()
  const drawer = page.getByRole('dialog', { name: '审计日志详情' })
  await expect(drawer).toContainText('详情无法解析')
  await drawer.locator('summary').click()
  await expect(drawer.locator('pre')).toHaveText('已隐藏')
  await expect(drawer).not.toContainText('bad-secret')
})
