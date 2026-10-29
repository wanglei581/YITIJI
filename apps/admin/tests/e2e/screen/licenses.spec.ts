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

const licenseRow = { id: 'license-a', orgId: 'org-a', version: 7, licenseeName: '青岛蓝谷数字科技有限公司', creditCode: '91370212MA3T8K2P4T', contractNo: 'HT-001', startsAt: '2026-01-01T16:00:00.000Z', endsAt: '2028-01-01T16:00:00.000Z', startsOn: '2026-01-02', endsOn: '2028-01-01', periodText: '2026-01-02 至 2028-01-01（北京时间，含当天）', graceDays: 7, graceEndsAt: '2028-01-08T16:00:00.000Z', graceEndsOn: '2028-01-08', terminalQuota: 3, status: 'active', phase: 'active', note: null, statusReason: null, statusTicketNo: null, statusChangedAt: null, statusChangedBy: null, createdBy: 'admin', updatedBy: null, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }
const licenseOrg = { orgId: 'org-a', orgName: '广州服务中心', licenseMode: 'required', managed: true, state: 'ok', usable: true, daysLeft: 20, coveredUntil: '2028-01-01T16:00:00Z', coveredUntilOn: '2028-01-01', current: licenseRow, upcoming: null, terminalQuota: 3, terminalsBound: 2, overQuota: false, items: [licenseRow] }
const orgDetail = { id: 'org-a', name: '广州服务中心', type: 'public_employment_service', contact: null, contactPhone: null, sceneTemplate: null, enabledModules: [], enabled: true, contentTrustStatus: null, archived: false, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', counts: { accounts: 0, sources: 0, jobs: 0, fairs: 0 }, accounts: [] }
async function licensePage(page: Page, detail = licenseOrg) {
  await page.route('**/api/v1/admin/orgs', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify([orgDetail]) }))
  await page.route('**/api/v1/admin/orgs/org-a', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(orgDetail) }))
  await page.route('**/api/v1/admin/orgs/org-a/licenses', route => route.fulfill(json(detail)))
  await open(page, '/partners?org=org-a')
  const area = page.getByRole('region', { name: '软件使用授权' })
  await expect(area.getByText('授权历史')).toBeVisible()
  return area
}

test('授权方式停用确认使用同一理由重发', async ({ page }) => {
  const bodies: unknown[] = []
  await page.route('**/api/v1/admin/orgs/org-a/license-mode', route => {
    bodies.push(route.request().postDataJSON())
    return bodies.length === 1 ? route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: { code: 'LICENSE_MODE_WOULD_LOCK_TERMINALS', message: '将停用 2 台一体机' } }) }) : route.fulfill(json({ ...licenseOrg, licenseMode: 'required', managed: true }))
  })
  const area = await licensePage(page, { ...licenseOrg, licenseMode: 'none', managed: false })
  await area.getByRole('button', { name: '切换授权方式' }).click()
  const dialog = area.getByRole('dialog', { name: '切换授权方式' })
  await expect(dialog.getByText('将切换为：需要授权')).toBeVisible()
  await dialog.getByLabel('理由').fill('合同到期')
  await dialog.getByRole('button', { name: '提交' }).click()
  await expect(dialog.getByText('将停用 2 台一体机')).toBeVisible()
  await dialog.getByRole('button', { name: '仍要立即停用' }).click()
  await expect.poll(() => bodies.length).toBe(2)
  expect(bodies[1]).toEqual({ licenseMode: 'required', reason: '合同到期', confirmLockout: true })
})

test('暂停版本冲突后重新读取授权', async ({ page }) => {
  let reads = 0
  await page.route('**/api/v1/admin/licenses/license-a/suspend', route => route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: { code: 'LICENSE_VERSION_CONFLICT', message: '版本冲突' } }) }))
  const area = await licensePage(page)
  await page.route('**/api/v1/admin/orgs/org-a/licenses', route => { reads++; return route.fulfill(json(licenseOrg)) })
  await area.getByRole('button', { name: '暂停', exact: true }).click()
  const dialog = area.getByRole('dialog', { name: '暂停授权' })
  await dialog.getByLabel('理由').fill('合同核查')
  await dialog.getByLabel('审批工单号').fill('SP-123')
  await dialog.getByRole('button', { name: '提交' }).click()
  await dialog.getByRole('button', { name: '确认暂停' }).click()
  await expect(area.getByText('这条授权刚被其他人改过，已刷新为最新内容，请核对后重新操作')).toBeVisible()
  expect(reads).toBe(1)
})

test('更正提交版本理由和原样日期', async ({ page }) => {
  let body: Record<string, unknown> | undefined
  await page.route('**/api/v1/admin/licenses/license-a', route => { body = route.request().postDataJSON() as Record<string, unknown>; return route.fulfill(json({ licenseId: 'license-a', org: licenseOrg })) })
  const area = await licensePage(page)
  await area.getByRole('button', { name: '更正信息' }).click()
  const form = area.getByRole('form', { name: '更正信息' })
  await form.getByLabel('生效日').fill('2026-02-03')
  await form.getByLabel('最后有效日（含当天）').fill('2028-02-04')
  await form.getByLabel('更正理由').fill('更正日期')
  await form.getByRole('button', { name: '提交' }).click()
  await expect.poll(() => body).toBeDefined()
  expect(body).toMatchObject({ version: 7, reason: '更正日期', startsOn: '2026-02-03', endsOn: '2028-02-04' })
  expect(body).not.toHaveProperty('startsAt')
  expect(body).not.toHaveProperty('endsAt')
})


test('暂停服务端拒绝后保留填写内容，可以修改并成功提交', async ({ page }) => {
  let attempts = 0
  await page.route('**/api/v1/admin/licenses/license-a/suspend', route => {
    attempts++
    if (attempts === 1) return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: { code: 'LICENSE_TICKET_INVALID', message: '审批工单号格式不对' } }) })
    const suspended = { ...licenseRow, status: 'suspended', phase: 'suspended', statusReason: '合同核查', statusTicketNo: 'SP-456' }
    return route.fulfill(json({ licenseId: 'license-a', org: { ...licenseOrg, state: 'suspended', usable: false, current: suspended, items: [suspended] } }))
  })
  const area = await licensePage(page)
  await area.getByRole('button', { name: '暂停', exact: true }).click()
  const dialog = area.getByRole('dialog', { name: '暂停授权' })
  await dialog.getByLabel('理由').fill('合同核查')
  await dialog.getByLabel('审批工单号').fill('SP-123')
  await dialog.getByRole('button', { name: '提交' }).click()
  await expect(dialog.getByText('理由：合同核查')).toBeVisible()
  await expect(dialog.getByText('审批工单号：SP-123')).toBeVisible()
  await dialog.getByRole('button', { name: '返回修改' }).click()
  await expect(dialog.getByLabel('理由')).toHaveValue('合同核查')
  await expect(dialog.getByLabel('审批工单号')).toHaveValue('SP-123')
  await dialog.getByRole('button', { name: '提交' }).click()
  await dialog.getByRole('button', { name: '确认暂停' }).click()
  await expect(dialog.getByRole('alert')).toHaveText('审批工单号格式不对')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel('理由')).toHaveValue('合同核查')
  await expect(dialog.getByLabel('审批工单号')).toHaveValue('SP-123')
  await dialog.getByLabel('审批工单号').fill('SP-456')
  await dialog.getByRole('button', { name: '提交' }).click()
  await dialog.getByRole('button', { name: '确认暂停' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(area).toContainText('当前状态：已暂停')
  expect(attempts).toBe(2)
})
