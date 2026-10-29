import { test, expect, type Page } from '@playwright/test'
import { open } from './helpers'

const quota = '授权台数已用完：本机构已绑定 3 台，授权上限 3 台。请先解绑或退役不再使用的终端（换机时先解绑旧机），或联系平台调整授权台数。'
const unavailable = '本机构的软件使用授权当前不可用，不能绑定终端，请联系平台续期或恢复。'
const orgs = [{ id: 'org-a', name: '广州服务中心', type: 'public_employment_service' }, { id: 'org-b', name: '广州就业中心', type: 'public_employment_service' }]
const terminal = { id: 't1', terminalCode: 'KSK-001', displayName: null, macAddress: null, locationLabel: null, enabled: true, online: true, registeredAt: '2026-01-01T00:00:00Z', lastHeartbeatAt: null, printerStatus: null, wiredNetworkStatus: 'unknown', printerNetworkStatus: 'unknown', agentVersion: null, ipAddress: null, diskFreeGb: null, orgId: null, orgName: null, orgType: null, lifecycleStatus: 'active', lifecycleVersion: 1 }
const item = (id: string, name: string, state: string, daysLeft: number | null) => ({ orgId: id, orgName: name, licenseMode: 'required', managed: true, state, usable: state !== 'suspended', daysLeft, coveredUntil: state === 'ok' ? '2027-01-01T16:00:00Z' : null, coveredUntilOn: state === 'ok' ? '2027-01-01' : null, current: null, upcoming: null, terminalQuota: 3, terminalsBound: 3, overQuota: false })
const attention = { inactive: [item('org-a', '广州服务中心', 'suspended', null)], grace: [item('org-b', '广州就业中心', 'grace', 3)], expiringSoon: [item('org-c', '广州人才中心', 'ok', 12)], counts: { inactive: 1, grace: 1, expiringSoon: 1 } }
const json = (data: unknown) => ({ contentType: 'application/json', body: JSON.stringify({ success: true, data }) })

async function terminals(page: Page) {
  await page.route('**/api/v1/admin/terminals/org-options', (route) => route.fulfill(json({ organizations: orgs })))
  await page.route('**/api/v1/admin/terminals', (route) => route.request().method() === 'POST'
    ? route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: { code: 'LICENSE_NOT_AVAILABLE_FOR_BINDING', message: unavailable } }) })
    : route.fulfill(json({ terminals: [terminal] })))
  await page.route('**/api/v1/admin/terminals/KSK-001/org', (route) => route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: { code: 'LICENSE_TERMINAL_QUOTA_EXCEEDED', message: quota } }) }))
}

test('改绑超台数就地说明，换选项后消失', async ({ page }) => {
  await terminals(page)
  await open(page, '/terminals')
  await page.getByRole('button', { name: '管理 KSK-001' }).click()
  const drawer = page.getByRole('dialog')
  await drawer.getByRole('button', { name: '绑定机构' }).click()
  const select = drawer.getByLabel('设置 KSK-001 所属机构')
  await select.selectOption('org-a')
  await drawer.getByRole('button', { name: '保存归属' }).click()
  await expect(drawer.getByText(quota, { exact: false })).toBeVisible()
  await expect(drawer.getByRole('link', { name: '查看该机构的授权' })).toHaveAttribute('href', '/partners?org=org-a')
  await expect(select).toBeVisible()
  await expect(drawer.locator('.border-error\\/20.bg-error-bg')).toHaveCount(0)
  await select.selectOption('org-b')
  await expect(drawer.getByText(quota, { exact: false })).toHaveCount(0)
})

test('预创建设备授权不可用时就地说明', async ({ page }) => {
  await terminals(page)
  await open(page, '/terminals')
  await page.getByRole('button', { name: '预创建设备' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByPlaceholder('例如 KSK-011').fill('KSK-011')
  await dialog.getByLabel('所属机构').selectOption('org-a')
  await dialog.getByRole('button', { name: '创建设备', exact: true }).click()
  await expect(dialog.getByText(unavailable, { exact: false })).toBeVisible()
  await expect(dialog.getByRole('link', { name: '查看该机构的授权' })).toHaveAttribute('href', '/partners?org=org-a')
})

test('工作台读取失败后可重试并显示三类', async ({ page }) => {
  let attempts = 0
  await page.route('**/api/v1/admin/licenses/attention', (route) => {
    attempts++
    return attempts === 1 ? route.fulfill({ status: 500, ...json(null) }) : route.fulfill(json(attention))
  })
  await page.route('**/api/v1/admin/terminals', (route) => route.fulfill(json({ terminals: [] })))
  await open(page, '/')
  const row = page.locator('div').filter({ has: page.getByText('软件使用授权情况这次没读到', { exact: true }) }).filter({ has: page.getByRole('button', { name: '重试' }) }).last()
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: '重试' }).click()
  await expect(page.getByText('1 家机构的软件使用授权已停用')).toBeVisible()
  await expect(page.getByText('1 家机构处于授权宽限期')).toBeVisible()
  await expect(page.getByText('1 家机构的授权 30 天内到期')).toBeVisible()
  expect(attempts).toBe(2)
})
