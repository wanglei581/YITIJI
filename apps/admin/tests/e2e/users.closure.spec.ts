import { expect, test, type Page } from '@playwright/test'
import { openAuthed } from './helpers/open'
import { MOCK_ADMIN_AUTH } from './helpers/auth'

// 本文件由 playwright.users.config.ts 在 HTTP 构建下执行，所有请求由夹具拦截。
const originalUser = {
  id: 'closure-user', nickname: '注销验证会员', maskedPhone: '138****1234', enabled: true,
  status: 'active', lastLoginAt: null, createdAt: '2026-10-04T00:00:00Z',
  closureRequest: { requestedAt: '2026-10-04T01:00:00Z', source: 'member_request' },
}
async function setup(page: Page, options: { code?: string; pending?: boolean; closed?: boolean; changed?: boolean } = {}) {
  let user = { ...originalUser, ...(options.pending === false ? { closureRequest: null } : {}),
    ...(options.closed ? { status: 'anonymized', enabled: false } : {}) }
  const calls: { url: URL; method: string; body: Record<string, string> | null }[] = []
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request(), url = new URL(request.url())
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    if (url.pathname.includes('/admin/users')) {
      calls.push({ url, method: request.method(), body: request.postDataJSON() })
      if (url.pathname.endsWith('/closure')) {
        if (options.code) return json({ error: { code: options.code, message: '正确尾号 9876，13800139876', expectedPhoneLast4: '9876', orders: [{ orderNo: 'ORD-CLOSURE-1', status: 'refunding' }, { orderNo: 'ORD-CLOSURE-2', status: 'pickup_pending' }] } }, options.code === 'CLOSURE_EXECUTION_FAILED' ? 503 : 409)
        user = { ...user, status: 'anonymized', enabled: false, maskedPhone: '***' }
        return json({ endUserId: user.id, status: 'anonymized', changed: options.changed !== false })
      }
      if (url.pathname.endsWith('/closure-user')) return json({ user: { ...user, updatedAt: '2026-10-04T02:00:00Z' }, stats: { fileCount: 0, printTaskCount: 0, aiResultCount: 0, browseCount: 0, externalJumpCount: 0 }, recentActivities: [], retentionNotice: '展示当前留存记录' })
      return json({ items: [user], total: 60, page: Number(url.searchParams.get('page') ?? 1), pageSize: 20 })
    }
    if (url.pathname.endsWith('/auth/me')) return json({ success: true, data: { userId: MOCK_ADMIN_AUTH.user.id, role: 'admin', orgId: null } })
    if (url.pathname.endsWith('/admin/alerts')) return json({ success: true, data: [] })
    if (url.pathname.endsWith('/admin/permissions/overrides')) return json({ admin: {}, partner: {} })
    if (url.pathname.endsWith('/public/capabilities')) return json({ recruitmentContentHosting: false })
    return json({ items: [], total: 0 })
  })
  await openAuthed(page, '/users')
  await expect(page.getByRole('button', { name: /查看用户 .* 的详情/ })).toBeVisible()
  return calls
}
async function openClosure(page: Page) {
  await page.getByRole('button', { name: /查看用户 .* 的详情/ }).click()
  await page.getByRole('button', { name: '注销账号', exact: true }).click()
  return page.getByRole('dialog', { name: '注销账号', exact: true })
}
async function fillOffline(page: Page) {
  const dialog = await openClosure(page)
  await dialog.getByLabel('凭线下申请办理').check()
  await dialog.getByLabel('事由').fill('本人到场核对身份申请注销')
  await dialog.getByLabel('手机尾号四位').fill('1234')
  await dialog.getByLabel('线下凭据编号').fill('OFF-20261004-01')
  return dialog
}
async function confirm(page: Page) {
  const dialog = page.getByRole('dialog', { name: '注销账号', exact: true })
  await dialog.getByRole('button', { name: '下一步' }).click()
  await expect(dialog.getByRole('heading', { name: '注销后会发生什么' })).toBeVisible()
  await expect(dialog.getByRole('button', { name: '确认注销' })).toBeDisabled()
  await dialog.getByLabel('我已核对会员身份，知道注销后不能恢复').check()
  await dialog.getByRole('button', { name: '确认注销' }).click()
  return dialog
}

test('注销筛选三个取值发送参数、写 URL、回首页；1280 无横滚', async ({ page }) => {
  const calls = await setup(page)
  const pendingBadge = page.getByText('申请注销', { exact: true })
  await expect(pendingBadge).toBeVisible()
  await expect(pendingBadge.locator('..')).toHaveAttribute('title', /申请时间：.*来源：本人申请/)
  for (const closure of ['requested', 'offline_executed', 'executed']) {
    await page.getByRole('button', { name: '下一页' }).click()
    await expect(page).toHaveURL(/page=2/)
    await page.getByLabel('注销', { exact: true }).selectOption(closure)
    await expect.poll(() => calls.at(-1)?.url.searchParams.get('closure')).toBe(closure)
    await expect(page).toHaveURL(new RegExp(`closure=${closure}`))
    await expect(page).toHaveURL(/page=1/)
  }
  await page.reload()
  await expect(page.getByLabel('注销', { exact: true })).toHaveValue('executed')
  const overflow = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('body, main, table')].some((node) => node.scrollWidth > node.clientWidth + 1 || (node.tagName === 'TABLE' && node.parentElement !== null && node.getBoundingClientRect().width > node.parentElement.clientWidth + 1)))
  expect(overflow).toBe(false)
})

test('无本人申请禁选，线下凭据必填，尾号只收四位数字', async ({ page }) => {
  const calls = await setup(page, { pending: false })
  const dialog = await openClosure(page)
  await expect(dialog.getByLabel('按本人申请执行')).toBeDisabled()
  await expect(dialog.getByText('该会员没有待处理的注销申请')).toBeVisible()
  await dialog.getByLabel('事由').fill('到场办理')
  await dialog.getByLabel('手机尾号四位').fill('1a23')
  await expect(dialog.getByLabel('手机尾号四位')).toHaveValue('123')
  await dialog.getByRole('button', { name: '下一步' }).click()
  await expect(dialog.getByText('请填写四位数字手机尾号。')).toBeVisible()
  await expect(dialog.getByText('请填写 1–64 字线下凭据编号。')).toBeVisible()
  expect(calls.filter((call) => call.method === 'POST')).toHaveLength(0)
  await dialog.getByLabel('手机尾号四位').fill('12345')
  await expect(dialog.getByLabel('手机尾号四位')).toHaveValue('1234')
  await dialog.getByLabel('线下凭据编号').fill('OFF-1')
  await dialog.getByRole('button', { name: '下一步' }).click()
  await expect(dialog.getByRole('button', { name: '确认注销' })).toBeDisabled()
})

test('尾号不符只显示登记中文，不回显正确尾号或完整手机号', async ({ page }) => {
  await setup(page, { code: 'CLOSURE_PHONE_MISMATCH' })
  await fillOffline(page); const dialog = await confirm(page)
  await expect(dialog.getByRole('alert')).toContainText('手机尾号与该账号不一致，请向会员本人核对后重填。')
  await expect(dialog).not.toContainText('9876')
  await expect(dialog).not.toContainText('13800139876')
})

test('未完成订单提示列出订单号与本后台中文状态', async ({ page }) => {
  await setup(page, { code: 'CLOSURE_BLOCKED_BY_OPEN_ORDERS' })
  await fillOffline(page); const dialog = await confirm(page)
  await expect(dialog.getByRole('alert')).toContainText('请先处理完下列订单：')
  await expect(dialog.getByRole('alert')).toContainText('ORD-CLOSURE-1 · 退款中')
  await expect(dialog.getByRole('alert')).toContainText('ORD-CLOSURE-2 · 待取件')
})

for (const changed of [true, false]) test(`成功 changed=${changed} 刷新列表与详情，注销状态无操作`, async ({ page }) => {
  const calls = await setup(page, { changed })
  await fillOffline(page)
  const before = calls.length
  await confirm(page)
  await expect(page.getByRole('dialog', { name: '注销账号', exact: true })).toHaveCount(0)
  await expect(page.getByRole('status').filter({ hasText: changed ? /^已注销$/ : '该账号此前已注销' })).toBeVisible()
  await expect.poll(() => calls.slice(before).filter((call) => call.method === 'GET').length).toBe(2)
  const detail = page.getByRole('dialog', { name: '用户详情' })
  await expect(detail.getByText('已注销', { exact: true })).toBeVisible()
  await expect(detail.getByText('***', { exact: true })).toBeVisible()
  await expect(detail.getByRole('button', { name: '注销账号', exact: true })).toHaveCount(0)
  await detail.getByRole('button', { name: '关闭用户详情' }).click()
  const row = page.getByRole('row').filter({ hasText: '注销验证会员' })
  await expect(row.getByRole('button', { name: /停用|恢复|注销/ })).toHaveCount(0)
})

test('503 保留来源、事由、尾号、凭据，重试请求逐字段相同；无浏览器存储', async ({ page }) => {
  const calls = await setup(page, { code: 'CLOSURE_EXECUTION_FAILED' })
  await fillOffline(page); const dialog = await confirm(page)
  await expect(dialog.getByRole('alert')).toContainText('注销没有完成，账号停在注销中。')
  await expect(dialog.getByLabel('凭线下申请办理')).toBeChecked()
  await expect(dialog.getByLabel('事由')).toHaveValue('本人到场核对身份申请注销')
  await expect(dialog.getByLabel('手机尾号四位')).toHaveValue('1234')
  await expect(dialog.getByLabel('线下凭据编号')).toHaveValue('OFF-20261004-01')
  await confirm(page)
  await expect.poll(() => calls.filter((call) => call.method === 'POST').length).toBe(2)
  const posts = calls.filter((call) => call.method === 'POST')
  expect(posts[0].body).toEqual(posts[1].body)
  const stored = await page.evaluate(() => JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]))
  expect(stored).not.toContain('本人到场核对身份申请注销')
  expect(stored).not.toContain('OFF-20261004-01')
})

test('初始已注销账号仅可查看，服务端掩码异常也展示 ***', async ({ page }) => {
  await setup(page, { closed: true })
  const row = page.getByRole('row').filter({ hasText: '注销验证会员' })
  await expect(row.getByText('***', { exact: true })).toBeVisible()
  await expect(row.getByRole('button', { name: /停用|恢复/ })).toHaveCount(0)
  await row.getByRole('button', { name: /查看用户/ }).click()
  await expect(page.getByRole('button', { name: '注销账号', exact: true })).toHaveCount(0)
})
