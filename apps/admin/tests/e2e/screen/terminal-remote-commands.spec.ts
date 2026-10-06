import { test, expect, type Page } from '@playwright/test'
import { open, uncaughtPageErrors } from './helpers'

// 终端详情抽屉「远程操作」：http 构建 + 正则拦截，按服务端 TerminalCommandView 回话。
test.use({ viewport: { width: 1280, height: 800 } })

const TERMINAL_ID = 'cmtermfixture0001'
const NOW = new Date().toISOString()

function terminal(overrides: Record<string, unknown> = {}) {
  return {
    id: TERMINAL_ID, terminalCode: 'QD-LS-003', displayName: '崂山区就业服务中心一楼', macAddress: '00-1A-2B-3C-4D-5E',
    locationLabel: '一楼大厅东侧', enabled: true, lifecycleStatus: 'active', lifecycleVersion: 4, credentialGeneration: 2,
    hasActiveCredential: true, orgId: 'org-ls-001', orgName: '崂山区公共就业服务中心', orgType: 'public_employment',
    registeredAt: '2026-09-12T02:00:00.000Z', lastSeenAt: NOW, online: true, lastHeartbeatAt: NOW, agentStatus: 'online',
    localTaskDatabaseAvailable: true, printerStatus: 'idle', wiredNetworkStatus: 'connected', printerNetworkStatus: 'not_network_printer',
    agentVersion: '0.4.13', ipAddress: '10.20.3.17', diskFreeGb: 182.4, releaseObservation: null,
    ...overrides,
  }
}

function command(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cmd_fixture_1', type: 'restart_agent', status: 'pending', requestedBy: { id: 'u-admin-1', name: '周晓雯' },
    requestedAt: NOW, expiresAt: NOW, acceptedAt: null, finishedAt: null, completedVerified: null, resultCode: null, remainingJobs: null,
    ...overrides,
  }
}

interface Fixture {
  terminal?: Record<string, unknown>
  commands?: () => unknown[]
  issue?: (body: unknown) => { status: number; body: unknown }
}

async function setup(page: Page, fixture: Fixture = {}) {
  const posts: unknown[] = []
  await page.context().route(/\/api\/v1\//, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    if (url.pathname.endsWith(`/admin/terminals/${TERMINAL_ID}/commands`)) {
      if (request.method() === 'POST') {
        const body = request.postDataJSON()
        posts.push(body)
        const reply = fixture.issue?.(body) ?? { status: 200, body: { success: true, data: command({ type: (body as { type: string }).type }) } }
        return json(reply.status, reply.body)
      }
      return json(200, { success: true, data: (fixture.commands ?? (() => []))() })
    }
    if (url.pathname.endsWith('/admin/terminals')) return json(200, { success: true, data: { terminals: [terminal(fixture.terminal)] } })
    return json(200, { success: true, data: [] })
  })
  await open(page, '/devices?tab=terminals')
  await page.getByRole('button', { name: /^管理 / }).first().click()
  const drawer = page.getByRole('dialog', { name: /终端详情/ })
  await expect(drawer).toBeVisible()
  return { drawer, posts }
}

test.afterEach(async ({ page }) => {
  expect(uncaughtPageErrors(page)).toEqual([])
})

test('重启终端程序：确认框原话、请求体、下发后列表出现「待执行」', async ({ page }) => {
  let issued = false
  const { drawer, posts } = await setup(page, {
    commands: () => (issued ? [command()] : []),
    issue: (body) => { issued = true; return { status: 200, body: { success: true, data: command({ type: (body as { type: string }).type }) } } },
  })
  const area = drawer.getByTestId('terminal-remote-commands')
  await expect(area).toContainText('还没有下发过远程命令')
  await area.getByRole('button', { name: '重启终端程序' }).click()
  const confirm = page.getByRole('dialog', { name: '重启终端程序 QD-LS-003' })
  await expect(confirm).toContainText('终端程序会重启约 1 分钟；正在打印时不会执行。')
  await expect(confirm).toContainText('每台终端一小时最多 3 次远程命令。')
  await confirm.getByRole('button', { name: '确认重启终端程序' }).click()
  await expect(confirm).toHaveCount(0)
  expect(posts).toEqual([{ type: 'restart_agent' }])
  await expect(drawer).toContainText('「重启终端程序」已下发，等待终端执行')
  await expect(area).toContainText('待执行')
  await expect(area).toContainText('周晓雯 下发')
  await expect(area.getByRole('button', { name: '重启终端程序' })).toBeDisabled()
  await expect(area).toContainText('上一条命令还没结束')
  await expect(drawer).not.toContainText(/已重启|restart_agent|pending/)
})

test('清空打印队列：请求体正确；超过每小时 3 次时显示中文原因', async ({ page }) => {
  const { drawer, posts } = await setup(page, {
    issue: () => ({ status: 429, body: { success: false, error: { code: 'TERMINAL_COMMAND_RATE_LIMITED', message: 'Too Many Requests' } } }),
  })
  await drawer.getByRole('button', { name: '清空打印队列' }).click()
  const confirm = page.getByRole('dialog', { name: '清空打印队列 QD-LS-003' })
  await expect(confirm).toContainText('正在打印时不会执行。')
  await confirm.getByRole('button', { name: '确认清空打印队列' }).click()
  expect(posts).toEqual([{ type: 'clear_print_queue' }])
  await expect(drawer).toContainText('这台终端一小时内的远程命令已达 3 次，请稍后再试')
  await expect(drawer).not.toContainText(/Too Many Requests|TERMINAL_COMMAND_RATE_LIMITED/)
})

test('最近命令的各种结果按口径显示，不露原始码', async ({ page }) => {
  const { drawer } = await setup(page, {
    commands: () => [
      command({ id: 'c1', type: 'clear_print_queue', status: 'failed', remainingJobs: 2, finishedAt: NOW }),
      command({ id: 'c2', status: 'completed', completedVerified: false, finishedAt: NOW }),
      command({ id: 'c3', status: 'failed', resultCode: 'no_heartbeat_after_restart', finishedAt: NOW }),
      command({ id: 'c4', type: 'clear_print_queue', status: 'rejected_busy', finishedAt: NOW }),
      command({ id: 'c5', status: 'expired', finishedAt: NOW, requestedBy: { id: 'u-x', name: '' } }),
    ],
  })
  const area = drawer.getByTestId('terminal-remote-commands')
  for (const text of ['失败，还剩 2 个作业', '已完成（未核实是否重启）', '失败，重启后终端没有回来', '终端忙，稍后再试', '已过期', '管理员 下发']) {
    await expect(area).toContainText(text)
  }
  await expect(area).not.toContainText(/no_heartbeat|rejected_busy|clear_print_queue|failed|expired/)
  await expect(area.getByRole('button', { name: '重启终端程序' })).toBeEnabled()
})

test('终端不在运营中时两个按钮都置灰并说明原因；抽屉不横溢', async ({ page }) => {
  const { drawer, posts } = await setup(page, { terminal: { lifecycleStatus: 'maintenance' } })
  const area = drawer.getByTestId('terminal-remote-commands')
  await expect(area.getByRole('button', { name: '重启终端程序' })).toBeDisabled()
  await expect(area.getByRole('button', { name: '清空打印队列' })).toBeDisabled()
  await expect(area).toContainText('终端不在运营中，不能下发')
  expect(posts).toEqual([])
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
})
