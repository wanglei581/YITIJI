import { expect, test, type Page } from '@playwright/test'
import type { PartnerLicenseView } from '@ai-job-print/shared'
import { open } from './helpers'

const profile = { id: 'org-1', name: '广州服务中心', type: 'public_employment_service', contact: '李老师', contactPhone: null, sceneTemplate: null, enabledModules: [], enabled: true, createdAt: '2026-01-01T00:00:00Z', sourceCount: 0, accountCount: 1 }
const current = { licenseeName: '广州启航就业服务有限公司', startsAt: '2026-01-01T16:00:00Z', endsAt: '2027-01-01T16:00:00Z', startsOn: '2026-01-02', endsOn: '2027-01-01', periodText: '2026-01-02 至 2027-01-01（北京时间，含当天）', graceEndsOn: '2027-01-08', graceDays: 7, graceEndsAt: '2027-01-08T16:00:00Z', terminalQuota: 3, status: 'active' as const }
const base: PartnerLicenseView = { licenseMode: 'required', managed: true, state: 'ok', usable: true, daysLeft: 90, current, upcoming: null, terminalsBound: 2 }
const inactiveMessage = '本机构的软件使用授权当前不可用，暂时不能发布或修改内容；查看与导出不受影响。请联系平台续期或恢复。'
const reply = (body: unknown) => ({ contentType: 'application/json', body: JSON.stringify(body) })

async function common(page: Page) {
  await page.route('**/api/v1/partner/profile', (route) => route.fulfill(reply(profile)))
  await page.route('**/api/v1/partner/first-order/overview', (route) => route.fulfill(reply({ truncated: false, projects: [], terminals: [], incidents: [], reports: [] })))
  await page.route('**/api/v1/partner/dashboard', (route) => route.fulfill(reply({ jobs: { total: 0, published: 0, pending: 0 }, fairs: { total: 0, published: 0, pending: 0 }, policies: { total: 0, published: 0, pending: 0 }, pendingTotal: 0, sources: { total: 0, enabled: 0 }, recentSyncs: [] })))
}
async function license(page: Page, value: PartnerLicenseView) {
  await page.route('**/api/v1/partner/license', (route) => route.fulfill(reply({ success: true, data: value })))
}

for (const scenario of [
  { name: '不管控', data: { ...base, licenseMode: 'none', managed: false, current: null, daysLeft: null } as PartnerLicenseView, card: false, notice: '' },
  { name: '正常远期', data: base, card: true, notice: '' },
  { name: '十二天内到期', data: { ...base, daysLeft: 12 }, card: true, notice: '软件使用授权还剩 12 天到期' },
  { name: '已录续期', data: { ...base, daysLeft: 12, upcoming: { startsAt: '2027-01-01T16:00:00Z', endsAt: '2028-01-01T16:00:00Z', startsOn: '2027-01-02', endsOn: '2028-01-01', periodText: '2027-01-02 至 2028-01-01（北京时间，含当天）', graceEndsOn: null, terminalQuota: 3 } }, card: true, notice: '已录入续期，2027-01-02 起接续' },
  { name: '宽限期', data: { ...base, state: 'grace', daysLeft: 3 } as PartnerLicenseView, card: true, notice: '软件使用授权处于宽限期，还剩 3 天' },
  { name: '已停用', data: { ...base, state: 'suspended', usable: false, daysLeft: null, current: { ...current, status: 'suspended' } } as PartnerLicenseView, card: true, notice: '软件使用授权已停用' },
]) {
  test(`${scenario.name}：资料卡与工作台提醒`, async ({ page }) => {
    await common(page)
    await license(page, scenario.data)
    await open(page, '/profile')
    const heading = page.getByRole('heading', { name: '软件使用授权', exact: true })
    if (scenario.card) {
      await expect(heading).toBeVisible()
      await expect(page.getByText('被授权企业名称：广州启航就业服务有限公司')).toBeVisible()
      await expect(page.getByText('有效期：2026-01-02 至 2027-01-01（北京时间，含当天）')).toBeVisible()
      await expect(page.getByText('终端台数：已绑定 2 台 / 上限 3 台')).toBeVisible()
    } else await expect(heading).toHaveCount(0)
    if (scenario.name === '已停用') await expect(page.getByText('本机构的软件使用授权当前不可用：名下一体机暂停服务；本后台可以查看和导出，暂时不能发布或修改内容。请联系平台续期或恢复。')).toBeVisible()
    if (scenario.name === '宽限期') await expect(page.getByText('状态：宽限期还剩 3 天')).toBeVisible()
    await open(page, '/')
    if (scenario.notice) await expect(page.getByText(scenario.notice, { exact: false })).toBeVisible()
    else await expect(page.getByText(/软件使用授权还剩|软件使用授权处于宽限期|软件使用授权已停用|已录入续期/)).toHaveCount(0)
  })
}

test('资料卡和工作台读取失败各自可重试，按钮至少 44×44', async ({ page }) => {
  await common(page)
  let attempts = 0
  await page.route('**/api/v1/partner/license', (route) => {
    attempts++
    return attempts === 1 || attempts === 3 ? route.fulfill({ status: 500, ...reply({ error: { code: 'FAILED', message: '读取失败' } }) }) : route.fulfill(reply({ success: true, data: { ...base, daysLeft: 12 } }))
  })
  for (const [path, message] of [['/profile', '授权情况暂时没读到'], ['/', '授权情况这次没读到']] as const) {
    await open(page, path)
    const block = page.locator('div, section').filter({ has: page.getByText(message, { exact: true }) }).filter({ has: page.getByRole('button', { name: '重试', exact: true }) }).last()
    await expect(block).toBeVisible()
    const button = block.getByRole('button', { name: '重试', exact: true })
    const size = await button.boundingBox()
    expect(size).not.toBeNull()
    expect(size!.width).toBeGreaterThanOrEqual(44)
    expect(size!.height).toBeGreaterThanOrEqual(44)
    await button.click()
    await expect(page.getByText(message, { exact: true })).toHaveCount(0)
    if (path === '/profile') await expect(page.getByRole('heading', { name: '软件使用授权', exact: true })).toBeVisible()
    else await expect(page.getByText('软件使用授权还剩 12 天到期', { exact: false })).toBeVisible()
  }
})

test('提交政策遇到授权停用显示原文且不跳登录', async ({ page }) => {
  await common(page)
  await page.route('**/api/v1/partner/policies**', (route) => route.request().method() === 'POST'
    ? route.fulfill({ status: 403, ...reply({ error: { code: 'ORG_LICENSE_INACTIVE', message: inactiveMessage } }) })
    : route.fulfill(reply({ data: [], pagination: { total: 0, page: 1, pageSize: 20, totalPages: 0 } })))
  await open(page, '/policy')
  await page.getByRole('button', { name: '新增政策内容' }).click()
  await page.getByLabel('标题').fill('就业服务公告')
  await page.getByRole('button', { name: '提交审核' }).click()
  await expect(page.getByText(inactiveMessage, { exact: true })).toBeVisible()
  await expect(page).toHaveURL(/\/policy$/)
})
