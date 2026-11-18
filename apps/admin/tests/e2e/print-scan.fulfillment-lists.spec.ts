import { expect, test, type Page, type Route } from '@playwright/test'
import { openAuthed } from './helpers/open'
import { MOCK_ADMIN_AUTH } from './helpers/auth'

// 本文件由 playwright.users.config.ts 在 HTTP 构建下执行。列表请求全部由夹具拦截，不访问真实后端。

const TERMINALS = [
  { id: 'term-a', terminalCode: 'KSK-A', displayName: '甲机', online: true, agentStatus: 'online' },
  { id: 'term-b', terminalCode: 'KSK-B', displayName: '乙机', online: true, agentStatus: 'online' },
  { id: 'term-empty', terminalCode: 'KSK-EMPTY', displayName: '空机', online: false, agentStatus: 'offline' },
]

const COPY_ITEMS = [
  {
    id: 'copy-failed', recordNo: 'copy-failed', terminalId: 'term-a', terminalCode: 'KSK-A',
    startedAt: '2026-11-18T02:15:00.000Z', copies: 2, lineCount: null,
    status: 'failed', statusLabel: '失败', failureReason: '缺纸',
  },
  {
    id: 'copy-printing', recordNo: 'copy-printing', terminalId: 'term-b', terminalCode: 'KSK-B',
    startedAt: '2026-11-18T01:00:00.000Z', copies: 1, lineCount: null,
    status: 'printing', statusLabel: '打印中', failureReason: null,
  },
]

const PACK_ITEMS = [
  {
    id: 'pack-1', recordNo: 'MP-1001', terminalId: 'term-a', terminalCode: 'KSK-A',
    startedAt: '2026-11-18T02:15:00.000Z', copies: null, lineCount: 2,
    status: 'failed', statusLabel: '失败', failureReason: '缺纸',
  },
]

function pageOf(items: typeof COPY_ITEMS) {
  return { items, pagination: { page: 1, pageSize: 20, total: items.length, totalPages: items.length ? 1 : 0 } }
}

async function install(page: Page, options: { failCopyOnce?: boolean } = {}) {
  let copyFailed = false
  const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.pathname.endsWith('/auth/me')) {
      return json(route, { data: { userId: MOCK_ADMIN_AUTH.user.id, role: 'admin', orgId: null } })
    }
    if (url.pathname.endsWith('/admin/alerts')) return json(route, { data: [] })
    if (url.pathname.endsWith('/admin/terminals')) return json(route, { data: { terminals: TERMINALS } })
    if (url.pathname.includes('/admin/print-scan/tasks')) {
      return json(route, { data: { type: 'print', implemented: true, items: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } } })
    }
    if (url.pathname.endsWith('/admin/print-scan/copy-jobs')) {
      if (options.failCopyOnce && !copyFailed) {
        copyFailed = true
        return json(route, { error: { code: 'COPY_LIST_UNAVAILABLE', message: '复印任务暂时读不出来，请稍后再试' } }, 500)
      }
      const terminalId = url.searchParams.get('terminalId')
      const status = url.searchParams.get('status')
      let items = COPY_ITEMS
      if (terminalId === 'term-empty') items = []
      else if (terminalId) items = items.filter((item) => item.terminalId === terminalId)
      if (status) items = items.filter((item) => item.status === status)
      return json(route, { data: pageOf(items) })
    }
    if (url.pathname.endsWith('/admin/print-scan/material-pack-orders')) {
      return json(route, { data: pageOf(PACK_ITEMS) })
    }
    return json(route, { data: {} })
  })
}

test('复印列表能按终端和状态筛选', async ({ page }) => {
  await install(page)
  await openAuthed(page, '/print-scan')
  await page.getByRole('button', { name: '复印', exact: true }).click()
  await expect(page.getByRole('cell', { name: '缺纸' })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'KSK-A' })).toBeVisible()
  await expect(page.getByRole('cell', { name: '2026-11-18 10:15' })).toBeVisible()
  await expect(page.getByRole('cell', { name: '打印中' })).toBeVisible()
  await page.getByRole('button', { name: '失败', exact: true }).click()
  await expect(page.getByRole('cell', { name: '缺纸' })).toBeVisible()
  await expect(page.getByRole('cell', { name: '打印中' })).toHaveCount(0)
  await page.getByRole('button', { name: '全部', exact: true }).click()
  await page.getByRole('combobox', { name: '终端' }).selectOption('term-b')
  await expect(page.getByRole('cell', { name: '打印中' })).toBeVisible()
  await expect(page.getByRole('cell', { name: '缺纸' })).toHaveCount(0)
})

test('所选终端没有复印任务时显示空态', async ({ page }) => {
  await install(page)
  await openAuthed(page, '/print-scan')
  await page.getByRole('button', { name: '复印', exact: true }).click()
  await page.getByRole('combobox', { name: '终端' }).selectOption('term-empty')
  await expect(page.getByText('还没有复印任务')).toBeVisible()
  await expect(page.getByText('当前筛选下没有屏上复印记录。')).toBeVisible()
})

test('复印列表读失败时显示接口原话，重试后能看到任务', async ({ page }) => {
  await install(page, { failCopyOnce: true })
  await openAuthed(page, '/print-scan')
  await page.getByRole('button', { name: '复印', exact: true }).click()
  await expect(page.getByText('读取失败')).toBeVisible()
  await expect(page.getByText('复印任务暂时读不出来，请稍后再试')).toBeVisible()
  await page.getByRole('button', { name: '重试' }).click()
  await expect(page.getByText('缺纸')).toBeVisible()
  await expect(page.getByText('读取失败')).toHaveCount(0)
})

test('材料包列表写出各行份数不同', async ({ page }) => {
  await install(page)
  await openAuthed(page, '/print-scan')
  await page.getByRole('button', { name: '材料包', exact: true }).click()
  await expect(page.getByRole('cell', { name: '各行份数不同' })).toBeVisible()
  await expect(page.getByRole('cell', { name: '缺纸' })).toBeVisible()
  await expect(page.getByRole('cell', { name: '行数' })).toBeVisible()
})

test('证件照、格式转换和签名写明停放，不再是空任务表', async ({ page }) => {
  await install(page)
  await openAuthed(page, '/print-scan')
  await page.getByRole('button', { name: '证件照（停放）' }).click()
  await expect(page.getByText('证件照已停放')).toBeVisible()
  await expect(page.getByText('证件照不在本期。这里没有证件照任务可以查看。')).toBeVisible()
  await page.getByRole('button', { name: '格式转换（停放）' }).click()
  await expect(page.getByText('格式转换不在本期。没有格式转换任务表或订单表，不能列出真实任务。')).toBeVisible()
  await page.getByRole('button', { name: '签名（停放）' }).click()
  await expect(page.getByText('签名不在本期。签名功能已停放，这里不列出签名任务。')).toBeVisible()
  await expect(page.getByText('该任务类型尚未上线')).toHaveCount(0)
})
