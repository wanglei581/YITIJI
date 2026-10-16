import { expect, test, type Page, type Route } from '@playwright/test'
import { openAuthed } from './helpers/open'
import { MOCK_ADMIN_AUTH } from './helpers/auth'

// 本文件由 playwright.users.config.ts 在 HTTP 构建下执行。终端与能力请求全部由夹具拦截，不访问真实后端。

interface CapabilityRow {
  capabilityKey: string
  status: string
  note: string | null
  configured: boolean
  updatedAt: string | null
}

interface CapabilityCall {
  method: string
  pathname: string
}

const TERMINALS = [
  {
    id: 'term-new01', terminalCode: 'new01', displayName: '新一号', online: true, agentStatus: 'online',
    agentVersion: '0.4.20', printerStatus: 'ready', localTaskDatabaseAvailable: true,
  },
  {
    id: 'term-ksk', terminalCode: 'KSK-001', displayName: '大厅终端', online: false, agentStatus: 'offline',
    agentVersion: '0.4.11', printerStatus: 'offline', localTaskDatabaseAvailable: true,
  },
]

function capabilityRows(note: string): CapabilityRow[] {
  return [
    { capabilityKey: 'document_print', status: 'available', note, configured: true, updatedAt: '2026-10-01T00:00:00.000Z' },
    { capabilityKey: 'material_pack', status: 'not_verified', note: null, configured: false, updatedAt: null },
  ]
}

function capabilityCalls(calls: CapabilityCall[]): CapabilityCall[] {
  return calls.filter((call) => /\/admin\/terminals\/[^/]+\/capabilities(?:\/|$)/.test(call.pathname))
}

async function setup(page: Page, options: {
  holdGet?: (terminalId: string) => Promise<void> | undefined
  holdPut?: Promise<void>
  putResult?: (terminalId: string, key: string) => { terminalCode: string; capability: CapabilityRow }
} = {}) {
  const calls: CapabilityCall[] = []
  const json = (route: Route, body: unknown) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const method = request.method()
    if (url.pathname.endsWith('/auth/me')) {
      return json(route, { data: { userId: MOCK_ADMIN_AUTH.user.id, role: 'admin', orgId: null } })
    }
    if (url.pathname.endsWith('/admin/alerts')) return json(route, { data: [] })
    if (url.pathname.includes('/admin/print-scan/tasks')) {
      return json(route, { data: { type: 'print', implemented: true, items: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } } })
    }
    if (method === 'GET' && url.pathname.endsWith('/admin/terminals')) return json(route, { data: { terminals: TERMINALS } })
    const listed = url.pathname.match(/\/admin\/terminals\/([^/]+)\/capabilities$/)
    if (method === 'GET' && listed) {
      const terminalId = listed[1] ?? ''
      calls.push({ method, pathname: url.pathname })
      const hold = options.holdGet?.(terminalId)
      if (hold) await hold
      const note = terminalId === 'term-new01' ? 'A-TABLE' : 'B-TABLE'
      const terminalCode = terminalId === 'term-new01' ? 'new01' : 'KSK-001'
      return json(route, { data: { terminalCode, capabilities: capabilityRows(note) } })
    }
    const saved = url.pathname.match(/\/admin\/terminals\/([^/]+)\/capabilities\/([^/]+)$/)
    if (method === 'PUT' && saved) {
      const terminalId = saved[1] ?? ''
      const key = saved[2] ?? ''
      calls.push({ method, pathname: url.pathname })
      if (options.holdPut) await options.holdPut
      const result = options.putResult?.(terminalId, key) ?? {
        terminalCode: terminalId === 'term-ksk' ? 'PUT-CODE-KSK' : 'PUT-CODE-NEW',
        capability: { capabilityKey: key, status: 'available', note: null, configured: true, updatedAt: '2026-10-16T00:30:00.000Z' },
      }
      return json(route, { data: result })
    }
    return json(route, { data: {} })
  })
  await openAuthed(page, '/print-scan')
  await page.getByRole('button', { name: '设备能力' }).click()
  await expect(page.getByRole('combobox', { name: '终端' }).locator('option', { hasText: 'new01' })).toBeAttached()
  return calls
}

function terminalSelect(page: Page) {
  return page.getByRole('combobox', { name: '终端' })
}

test('初始未选终端时没有能力表，也不发能力请求', async ({ page }) => {
  const calls = await setup(page)
  await expect(terminalSelect(page)).toHaveValue('')
  await expect(page.getByRole('columnheader', { name: '能力' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '登记' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '保存' })).toHaveCount(0)
  await page.waitForTimeout(400)
  expect(capabilityCalls(calls)).toEqual([])
})

test('列表第一台是 new01 时也不会默认选中', async ({ page }) => {
  const calls = await setup(page)
  const select = terminalSelect(page)
  await expect(select.locator('option').nth(0)).toHaveText('请先选择终端')
  await expect(select.locator('option').nth(1)).toHaveText('新一号（new01）')
  await expect(select.locator('option').nth(2)).toHaveText('大厅终端（KSK-001）')
  await expect(select).toHaveValue('')
  await expect(page.getByRole('columnheader', { name: '能力' })).toHaveCount(0)
  await page.waitForTimeout(400)
  expect(capabilityCalls(calls)).toEqual([])
})

test('快速切换后，晚回的能力列表不覆盖当前终端', async ({ page }) => {
  let releaseA = () => {}
  const holdA = new Promise<void>((resolve) => { releaseA = resolve })
  const calls = await setup(page, { holdGet: (terminalId) => (terminalId === 'term-new01' ? holdA : undefined) })
  await terminalSelect(page).selectOption('term-new01')
  await expect.poll(() => calls.filter((call) => call.method === 'GET' && call.pathname.includes('/term-new01/capabilities')).length).toBe(1)
  await terminalSelect(page).selectOption('term-ksk')
  await expect(page.locator('input[value="B-TABLE"]')).toBeVisible()
  await expect(page.getByText('大厅终端 · KSK-001 · Agent 0.4.11 · 离线')).toBeVisible()
  const late = page.waitForResponse((response) => response.request().method() === 'GET' && response.url().includes('/term-new01/capabilities'))
  releaseA()
  await late
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 150)))
  await expect(page.locator('input[value="B-TABLE"]')).toBeVisible()
  await expect(page.locator('input[value="A-TABLE"]')).toHaveCount(0)
  await expect(terminalSelect(page)).toHaveValue('term-ksk')
})

test('登记确认前切换终端后，确认不会对任何一台发保存', async ({ page }) => {
  const calls = await setup(page)
  await terminalSelect(page).selectOption('term-new01')
  const material = page.locator('tr').filter({ hasText: '材料包' })
  await expect(material).toBeVisible()
  await material.locator('select').selectOption('available')
  await material.getByRole('button', { name: '登记' }).click()
  await expect(page.getByText('将把『新一号（new01）』的『材料包』登记为『可用（对用户开放）』')).toBeVisible()
  expect(calls.filter((call) => call.method === 'PUT')).toEqual([])
  await terminalSelect(page).selectOption('term-ksk')
  await expect(page.getByText(/将把『/)).toHaveCount(0)
  const confirm = page.getByRole('button', { name: '确认', exact: true })
  if (await confirm.count()) await confirm.click()
  await page.waitForTimeout(400)
  expect(calls.filter((call) => call.method === 'PUT')).toEqual([])
})

test('确认后的保存打到页面上的那台终端，成功行使用回包编号', async ({ page }) => {
  const calls = await setup(page)
  await terminalSelect(page).selectOption('term-ksk')
  await expect(page.getByText('大厅终端 · KSK-001 · Agent 0.4.11 · 离线')).toBeVisible()
  const material = page.locator('tr').filter({ hasText: '材料包' })
  await material.locator('select').selectOption('available')
  await material.getByRole('button', { name: '登记' }).click()
  await expect(page.getByText('将把『大厅终端（KSK-001）』的『材料包』登记为『可用（对用户开放）』')).toBeVisible()
  expect(calls.filter((call) => call.method === 'PUT')).toEqual([])
  await page.getByRole('button', { name: '确认', exact: true }).click()
  await expect.poll(() => calls.filter((call) => call.method === 'PUT').length).toBe(1)
  const shown = await terminalSelect(page).inputValue()
  expect(calls.find((call) => call.method === 'PUT')?.pathname).toBe(`/api/v1/admin/terminals/${shown}/capabilities/material_pack`)
  await expect(page.getByText('已登记到 PUT-CODE-KSK · 2026-10-16 08:30')).toBeVisible()
  await expect(page.getByText('已登记到 KSK-001')).toHaveCount(0)
  await expect(material.getByText('已开通')).toBeVisible()
})

test('确认后切走，晚回的保存结果不写进新终端的表和提示', async ({ page }) => {
  let releasePut = () => {}
  const holdPut = new Promise<void>((resolve) => { releasePut = resolve })
  const calls = await setup(page, {
    holdPut,
    putResult: (_terminalId, key) => ({
      terminalCode: 'STALE-A-CODE',
      capability: { capabilityKey: key, status: 'available', note: 'STALE-A-NOTE', configured: true, updatedAt: '2026-10-16T02:00:00.000Z' },
    }),
  })
  await terminalSelect(page).selectOption('term-new01')
  const material = page.locator('tr').filter({ hasText: '材料包' })
  await material.locator('select').selectOption('available')
  await material.getByRole('button', { name: '登记' }).click()
  await page.getByRole('button', { name: '确认', exact: true }).click()
  await expect.poll(() => calls.filter((call) => call.method === 'PUT').map((call) => call.pathname)).toEqual([
    '/api/v1/admin/terminals/term-new01/capabilities/material_pack',
  ])
  await terminalSelect(page).selectOption('term-ksk')
  await expect(page.locator('input[value="B-TABLE"]')).toBeVisible()
  await expect(page.getByText('大厅终端 · KSK-001 · Agent 0.4.11 · 离线')).toBeVisible()
  const late = page.waitForResponse((response) => response.request().method() === 'PUT' && response.url().includes('/term-new01/capabilities/'))
  releasePut()
  await late
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 150)))
  await expect(page.locator('input[value="B-TABLE"]')).toBeVisible()
  await expect(page.locator('input[value="STALE-A-NOTE"]')).toHaveCount(0)
  await expect(page.getByText('STALE-A-CODE')).toHaveCount(0)
  await expect(page.getByText(/已登记到/)).toHaveCount(0)
  await expect(terminalSelect(page)).toHaveValue('term-ksk')
  expect(calls.filter((call) => call.method === 'PUT')).toHaveLength(1)
})
