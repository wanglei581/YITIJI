import { readFileSync } from 'node:fs'
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
  activation?: (body: unknown) => { status: number; body: unknown }
  identityAccept?: (body: unknown) => { status: number; body: unknown }
}

const ACTIVATION = {
  schemaVersion: 1,
  terminalCode: 'QD-LS-003',
  bindCode: 'MOCK-ACTIVATION-CODE-01',
  expiresAt: '2026-11-22T09:30:00.000Z',
  apiBaseUrl: 'https://zyidai.cn/api/v1',
  printerNamePattern: null,
  kid: 'mock-not-a-signing-key',
  signature: 'bW9jay1zaWduYXR1cmUtbm90LWEtcmVhbC1rZXk=',
}

async function setup(page: Page, fixture: Fixture = {}) {
  const posts: unknown[] = []
  const calls: { path: string; body: unknown }[] = []
  await page.context().route(/\/api\/v1\//, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    if (url.pathname.endsWith(`/admin/terminals/${TERMINAL_ID}/activation-file`) && request.method() === 'POST') {
      const body = request.postDataJSON()
      calls.push({ path: url.pathname, body })
      const reply = fixture.activation?.(body) ?? { status: 500, body: { success: false, error: { code: 'ACTIVATION_SIGNING_UNAVAILABLE', message: 'unexpected' } } }
      return route.fulfill({
        status: reply.status,
        contentType: 'application/json',
        headers: { 'cache-control': 'no-store' },
        body: JSON.stringify(reply.body),
      })
    }
    if (url.pathname.endsWith(`/admin/terminals/${TERMINAL_ID}/identity/accept`) && request.method() === 'POST') {
      const body = request.postDataJSON() ?? {}
      calls.push({ path: url.pathname, body })
      const reply = fixture.identityAccept?.(body) ?? { status: 200, body: { success: true, data: { accepted: true } } }
      return json(reply.status, reply.body)
    }
    if (url.pathname.endsWith(`/admin/terminals/${TERMINAL_ID}/identity/confirm-replacement`) && request.method() === 'POST') {
      const body = request.postDataJSON() ?? {}
      calls.push({ path: url.pathname, body })
      return json(200, { success: true, data: { accepted: true } })
    }
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
  return { drawer, posts, calls }
}

async function storedSecrets(page: Page, secrets: string[]): Promise<string[]> {
  return page.evaluate(async (needles) => {
    const hits: string[] = []
    const scan = (kind: string, storage: Storage) => {
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index) ?? ''
        const value = storage.getItem(key) ?? ''
        for (const needle of needles) {
          if (key.includes(needle) || value.includes(needle)) hits.push(`${kind}:${key}`)
        }
      }
    }
    scan('local', localStorage)
    scan('session', sessionStorage)
    if (indexedDB.databases) {
      const databases = await indexedDB.databases()
      for (const info of databases) {
        if (!info.name) continue
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open(info.name as string)
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => reject(request.error)
        })
        for (const name of db.objectStoreNames) {
          const rows = await new Promise<unknown[]>((resolve, reject) => {
            const tx = db.transaction(name, 'readonly')
            const request = tx.objectStore(name).getAll()
            request.onsuccess = () => resolve(request.result as unknown[])
            request.onerror = () => reject(request.error)
          })
          const blob = JSON.stringify(rows)
          for (const needle of needles) {
            if (blob.includes(needle)) hits.push(`idb:${info.name}/${name}`)
          }
        }
        db.close()
      }
    }
    return hits
  }, secrets)
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

test('生成激活文件：确认框、下载内容与返回 data 逐键相等，页面和三种存储都不留码', async ({ page }) => {
  const { drawer, calls } = await setup(page, {
    terminal: { lifecycleStatus: 'maintenance' },
    activation: () => ({ status: 200, body: { success: true, data: ACTIVATION } }),
  })
  await drawer.getByRole('button', { name: '生成激活文件' }).click()
  const confirm = page.getByRole('dialog', { name: '生成激活文件 QD-LS-003' })
  await expect(confirm).toContainText('重新生成会作废这台终端之前的激活文件。激活文件等同一次性密码，不要发进聊天，只用 U 盘拷到这台机器。')
  await expect(confirm).toContainText('实际到期时间以生成结果为准')
  await expect(confirm.getByRole('radio', { name: '24 小时' })).toBeChecked()
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    confirm.getByRole('button', { name: '确认生成' }).click(),
  ])
  expect(calls).toEqual([{ path: `/api/v1/admin/terminals/${TERMINAL_ID}/activation-file`, body: { ttlMinutes: 1440 } }])
  expect(download.suggestedFilename()).toBe('AIJobPrint-activation-QD-LS-003.json')
  const filePath = await download.path()
  expect(filePath).toBeTruthy()
  expect(JSON.parse(readFileSync(filePath as string, 'utf8'))).toEqual(ACTIVATION)
  await expect(drawer).toContainText('已生成，到期时间 2026-11-22 17:30')
  const html = await page.content()
  expect(html).not.toContain(ACTIVATION.bindCode)
  expect(html).not.toContain(ACTIVATION.signature)
  expect(await storedSecrets(page, [ACTIVATION.bindCode, ACTIVATION.signature])).toEqual([])
})

test('签名密钥没配时显示中文原因', async ({ page }) => {
  const { drawer } = await setup(page, {
    terminal: { lifecycleStatus: 'planned' },
    activation: () => ({ status: 503, body: { success: false, error: { code: 'ACTIVATION_SIGNING_UNAVAILABLE', message: 'Service Unavailable' } } }),
  })
  await drawer.getByRole('button', { name: '生成激活文件' }).click()
  const confirm = page.getByRole('dialog', { name: '生成激活文件 QD-LS-003' })
  await confirm.getByRole('button', { name: '确认生成' }).click()
  await expect(confirm).toContainText('服务器还没配置激活文件签名密钥，暂时不能生成')
  await expect(confirm).not.toContainText('服务暂时不可用')
  await expect(drawer).not.toContainText('Service Unavailable')
})

test('疑似克隆出现身份处置，放行打到 accept；409 显示中文', async ({ page }) => {
  const { drawer, calls } = await setup(page, {
    terminal: { identityStatus: 'suspected_clone', lifecycleStatus: 'active' },
    identityAccept: () => ({ status: 409, body: { success: false, error: { code: 'TERMINAL_IDENTITY_NOTHING_PENDING', message: 'Conflict' } } }),
  })
  const section = drawer.getByTestId('terminal-identity-disposition')
  await expect(section).toContainText('这个终端身份同时出现在另一台机器上，已暂停领打印任务。')
  await section.scrollIntoViewIfNeeded()
  await section.getByRole('button', { name: '放行', exact: true }).click()
  const confirm = page.getByRole('dialog', { name: '放行 QD-LS-003' })
  await expect(confirm).toContainText('放行会用最近一次上报的硬件信息覆盖存档，并恢复领打印任务。')
  await confirm.getByRole('button', { name: '确认放行' }).click()
  expect(calls).toEqual([{ path: `/api/v1/admin/terminals/${TERMINAL_ID}/identity/accept`, body: {} }])
  await expect(confirm).toContainText('这台终端当前没有待处置的身份冲突')
  await expect(drawer).not.toContainText('Conflict')
})

test('自检未通过项：已知原因码中文，未知码未归类', async ({ page }) => {
  const { drawer } = await setup(page, {
    terminal: {
      lastProvisionReport: {
        ok: false,
        failedKeys: ['printer_ready', 'hardware_identity'],
        failedChecks: [
          { key: 'printer_ready', code: 'PRINTER_MULTIPLE_MATCH' },
          { key: 'hardware_identity', code: 'PRINTER_FOO' },
        ],
        reportedAt: '2026-11-21T02:15:30.000Z',
        agentVersion: '1.4.0',
      },
    },
  })
  await expect(page.getByText('2 项未通过')).toHaveCount(2)
  const report = drawer.getByTestId('terminal-provision-report')
  await expect(report).toContainText('打印机：匹配到多台打印机，需要人选')
  await expect(report).toContainText('未归类（PRINTER_FOO）')
  await expect(report).toContainText('回报时间：2026-11-21 10:15')
  await expect(report).toContainText('终端程序版本：1.4.0')
})

test('1280、1440、1920 页面本身不横溢', async ({ page }) => {
  await setup(page, {
    terminal: {
      identityStatus: 'suspected_replacement',
      credentialExpiresAt: '2026-11-20T02:00:00.000Z',
      lastProvisionReport: {
        ok: false,
        failedKeys: ['printer_ready'],
        failedChecks: [{ key: 'printer_ready', code: 'PRINTER_NOT_READY' }],
        reportedAt: '2026-11-21T02:15:30.000Z',
        agentVersion: '1.4.0',
      },
    },
  })
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: /终端详情/ })).toHaveCount(0)
  for (const width of [1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 })
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow, `width ${width}`).toBeLessThanOrEqual(0)
  }
  await page.setViewportSize({ width: 1440, height: 900 })
})
