#!/usr/bin/env node
/** Real browser -> Vite/http adapters -> authenticated Nest -> isolated SQLite.
 * Fixture JWTs bypass SMS login only. No route interception, API stubs or hardware calls.
 * Usage: node apps/admin/scripts/verify-first-order-live.mjs --isolated [output-dir]
 *    or: node apps/admin/scripts/verify-first-order-live.mjs /private/fixture.json [output-dir]
 * FIRST_ORDER_BROWSER_OUTPUT selects the artifacts directory in CI.
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFile, writeFile, mkdir, mkdtemp, rm, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const isolated = process.argv[2] === '--isolated'
const descriptor = isolated ? null : process.argv[2]
if (!isolated && !descriptor) throw new Error('Use --isolated or provide a private fixture descriptor')
let fixture
let launchDirectory
let ownedApiDirectory
const outputArgument = process.argv[3] || process.env.FIRST_ORDER_BROWSER_OUTPUT
const output = outputArgument ? resolve(outputArgument) : await mkdtemp(join(tmpdir(), 'first-order-browser-'))
await mkdir(output, { recursive: true })
const requireKiosk = createRequire(join(root, 'apps/kiosk/package.json'))
const { chromium, expect } = requireKiosk('@playwright/test')
const children = []
let browser
let interrupted = false
let cleanupPromise
const results = { startedAt: new Date().toISOString(), mode: isolated ? 'isolated' : 'external_descriptor', cleanup: [], checks: [], screenshots: [], externalRequests: [], pageErrors: [], limitations: ['Isolated synthetic SQLite task/result records; no Pantum/Windows device acceptance.', 'Real fixture-issued JWT + AuthGuard checks; SMS login is not exercised.', 'Fixture loads FirstOrderModule + OrgsModule, not the complete production application.'] }
const mark = (name) => { results.checks.push(name); console.log(`PASS ${name}`) }

function alive(child) {
  return child.exitCode === null && child.signalCode === null && Number.isInteger(child.pid) && child.pid > 0
}

function waitForExit(child, timeoutMs) {
  if (!alive(child)) return Promise.resolve(true)
  return new Promise((resolveExit) => {
    const finish = (exited) => {
      clearTimeout(timer); child.removeListener('exit', exitedListener); child.removeListener('close', exitedListener)
      resolveExit(exited)
    }
    const exitedListener = () => finish(true)
    const timer = setTimeout(() => finish(false), timeoutMs)
    child.once('exit', exitedListener); child.once('close', exitedListener)
    if (!alive(child)) finish(true)
  })
}

function stopOwnedProcesses() {
  cleanupPromise ??= cleanupOwnedProcesses()
  return cleanupPromise
}

async function cleanupOwnedProcesses() {
  for (const child of [...children].reverse()) {
    const item = { kind: child.firstOrderKind, pid: child.pid ?? null, forced: false, exited: !alive(child) }
    if (alive(child)) {
      const exiting = waitForExit(child, child.firstOrderKind === 'api' ? 12000 : 4000)
      try {
        if (child.firstOrderKind === 'api') child.kill('SIGTERM')
        else process.kill(-child.pid, 'SIGTERM')
      } catch { /* own child already exited */ }
      item.exited = await exiting
      if (!item.exited && alive(child)) {
        item.forced = true
        const killed = waitForExit(child, 3000)
        try { process.kill(-child.pid, 'SIGKILL') } catch { /* own group already gone */ }
        item.exited = await killed
      }
    }
    results.cleanup.push(item)
    if (!item.exited) { results.status = 'FAIL'; results.error = 'An owned verification child did not exit'; process.exitCode = 1 }
  }
  if (launchDirectory) await rm(launchDirectory, { recursive: true, force: true })
  if (isolated && ownedApiDirectory && results.cleanup.every((item) => item.exited)) {
    assert.equal(dirname(ownedApiDirectory), resolve(tmpdir()))
    assert.match(ownedApiDirectory.slice(dirname(ownedApiDirectory).length + 1), /^first-order-http-/)
    await rm(ownedApiDirectory, { recursive: true, force: true })
  }
}

async function readDescriptor(path, ownedPid) {
  const metadata = await stat(path)
  assert.equal(metadata.mode & 0o077, 0, 'Fixture descriptor must not be group/world readable')
  const value = JSON.parse(await readFile(path, 'utf8'))
  assert.match(value.base, /^http:\/\/127\.0\.0\.1:\d+\/api\/v1$/)
  assert.match(value.orgs.own, /^fo-own-/)
  assert.match(value.terminals.spare, /^fo-spare-/)
  if (ownedPid) assert.equal(value.pid, ownedPid, 'Descriptor belongs to another API process')
  return value
}

async function startIsolatedApi() {
  if (interrupted) throw new Error('Verification interrupted')
  launchDirectory = await mkdtemp(join(tmpdir(), 'first-order-browser-launch-'))
  const env = { ...process.env, NODE_ENV: 'test', DOTENV_CONFIG_PATH: join(launchDirectory, 'no-dotenv') }
  for (const key of ['DATABASE_URL', 'POSTGRES_URL', 'REDIS_URL', 'JWT_SECRET', 'SECRET_ENCRYPTION_KEY']) delete env[key]
  const child = spawn(process.execPath, ['-r', '@swc-node/register', 'scripts/support/first-order-fixture.ts'], {
    cwd: join(root, 'services/api'), env, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
  })
  child.firstOrderKind = 'api'; children.push(child)
  let path, spawnFailure, readyBuffer = ''
  child.on('error', (error) => { spawnFailure = error.message })
  child.stdout.on('data', (chunk) => {
    readyBuffer = `${readyBuffer}${chunk}`.slice(-32000)
    const ready = readyBuffer.match(/private descriptor: ([^\r\n]+\/browser-fixture\.json)(?:\r?\n|$)/)
    if (ready) path = ready[1].trim()
  })
  // Drain stderr without printing fixture process output or any credentials.
  child.stderr.on('data', () => undefined)
  const deadline = Date.now() + 90000
  while (Date.now() < deadline) {
    if (spawnFailure || child.exitCode !== null || child.signalCode !== null) throw new Error('Isolated API startup failed; verify redis-server and generated SQLite Prisma client')
    if (path) {
      ownedApiDirectory = resolve(dirname(path))
      const value = await readDescriptor(path, child.pid)
      results.apiPid = child.pid
      return value
    }
    await delay(200)
  }
  throw new Error('Isolated API readiness exceeded 90 seconds')
}

async function startVite(role, port) {
  if (interrupted) throw new Error('Verification interrupted')
  const appRoot = join(root, 'apps', role)
  const appRequire = createRequire(join(appRoot, 'package.json'))
  const vite = join(dirname(appRequire.resolve('vite/package.json')), 'bin/vite.js')
  const child = spawn(process.execPath, [vite, '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: appRoot, env: { ...process.env, VITE_API_MODE: 'http', VITE_API_BASE_URL: fixture.base }, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
  })
  child.firstOrderKind = role; children.push(child)
  let spawnFailure
  child.on('error', (error) => { spawnFailure = error.message })
  let logs = ''
  child.stdout.on('data', (chunk) => { logs = `${logs}${chunk}`.slice(-3000) })
  child.stderr.on('data', (chunk) => { logs = `${logs}${chunk}`.slice(-3000) })
  const origin = `http://127.0.0.1:${port}`
  for (let attempt = 0; attempt < 120; attempt++) {
    if (spawnFailure || child.exitCode !== null || child.signalCode !== null) throw new Error(`${role} Vite startup failed: ${logs}`)
    try { const response = await fetch(origin, { signal: AbortSignal.timeout(1000) }); if (response.ok) return origin } catch { /* not listening yet */ }
    await delay(250)
  }
  throw new Error(`${role} Vite did not become ready: ${logs}`)
}

async function api(role, path) {
  const response = await fetch(`${fixture.base}${path}`, { signal: AbortSignal.timeout(20000), headers: { Authorization: `Bearer ${fixture.tokens[role]}` } })
  assert.equal(response.ok, true, `Fixture ${role} ${path} returned ${response.status}`)
  return response.json()
}

async function context(role) {
  const user = { id: fixture.users[role], name: role === 'admin' ? '首单管理员（验证）' : '首单机构（验证）', role, orgId: role === 'partner' ? fixture.orgs.own : null }
  const value = { token: fixture.tokens[role], user }
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true })
  await ctx.addInitScript(({ key, stored }) => { localStorage.setItem(key, JSON.stringify(stored)) }, { key: `${role}_auth_v1`, stored: value })
  const page = await ctx.newPage()
  page.setDefaultTimeout(30000)
  page.on('pageerror', (error) => results.pageErrors.push(`${role}: ${error.message}`))
  page.on('response', (response) => {
    if (response.url().startsWith(fixture.base) && response.status() >= 400) {
      results.externalRequests.push({ role, path: new URL(response.url()).pathname, status: response.status() })
    }
  })
  return page
}

async function responseAfter(page, method, suffix, action) {
  const pending = page.waitForResponse((response) => response.url().startsWith(fixture.base) && new URL(response.url()).pathname.endsWith(suffix) && response.request().method() === method)
  await action()
  const response = await pending
  assert.equal(response.ok(), true, `${method} ${suffix} returned ${response.status()}`)
  return response.json()
}

const adminPanel = (page) => page.locator('section[aria-label="首单交付与服务"]')
const partnerPanel = (page) => page.getByTestId('first-order-panel')
async function openAdmin(page, origin, orgName) {
  await page.goto(`${origin}/partners`)
  await page.getByRole('row').filter({ hasText: orgName }).getByRole('button', { name: '详情/账号', exact: true }).click()
  await expect(adminPanel(page).getByRole('button', { name: '刷新项目服务', exact: true })).toBeEnabled()
}
async function chooseProject(panel, id, tab) {
  await panel.getByLabel('服务项目', { exact: true }).selectOption(id)
  await panel.getByRole('tab', { name: tab, exact: true }).click()
}
async function refresh(panel) {
  await panel.getByRole('button', { name: '刷新项目服务', exact: true }).click()
  await expect(panel.getByRole('button', { name: '刷新项目服务', exact: true })).toBeEnabled()
}
async function shot(page, name, panel, narrow = false) {
  if (narrow) {
    await page.setViewportSize({ width: 390, height: 844 })
    const collapse = page.getByRole('button', { name: '收起侧边栏', exact: true })
    if (await collapse.isVisible()) await collapse.click()
    await delay(300)
  }
  await panel.scrollIntoViewIfNeeded()
  const geometry = await panel.evaluate((element) => {
    const box = element.getBoundingClientRect()
    const controls = [...element.querySelectorAll('input,select,textarea,button')].filter((node) => node.getClientRects().length).map((node) => {
      const rect = node.getBoundingClientRect()
      return { tag: node.tagName, label: node.getAttribute('aria-label') || node.textContent?.slice(0, 30), left: rect.left, right: rect.right }
    })
    return { width: innerWidth, documentWidth: document.documentElement.scrollWidth, left: box.left, right: box.right, controls }
  })
  assert(geometry.left >= -1 && geometry.right <= geometry.width + 1, `${name} panel outside viewport: ${JSON.stringify(geometry)}`)
  assert(geometry.documentWidth <= geometry.width + 1, `${name} horizontal document overflow`)
  for (const control of geometry.controls) assert(control.left >= -1 && control.right <= geometry.width + 1, `${name} clipped control: ${JSON.stringify(control)}`)
  const path = join(output, `${name}.png`)
  await page.screenshot({ path, fullPage: false })
  results.screenshots.push({ path, geometry })
}

for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) process.once(signal, () => {
  interrupted = true
  void (async () => {
    try { await browser?.close() } finally { await stopOwnedProcesses(); process.exit(code) }
  })().catch(() => process.exit(code))
})

try {
  fixture = isolated ? await startIsolatedApi() : await readDescriptor(descriptor)
  const [adminOrigin, partnerOrigin] = await Promise.all([startVite('admin', Number(process.env.FIRST_ORDER_ADMIN_PORT || 4194)), startVite('partner', Number(process.env.FIRST_ORDER_PARTNER_PORT || 4195))])
  browser = await chromium.launch({ headless: true })
  const admin = await context('admin'), partner = await context('partner')
  const org = await api('admin', `/admin/orgs/${encodeURIComponent(fixture.orgs.own)}`)
  const orgName = org.name ?? org.data?.name
  assert.equal(typeof orgName, 'string')
  await openAdmin(admin, adminOrigin, orgName)
  let a = adminPanel(admin)
  await a.getByRole('button', { name: '新建服务项目', exact: true }).click()
  const nonce = Date.now().toString(36)
  const newProjectName = `首单浏览器验证-${nonce}`
  const date = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)
  const endDate = new Date(Date.now() + 365 * 86400000 + 8 * 3600000).toISOString().slice(0, 10)
  await a.getByLabel('项目名称', { exact: true }).fill(newProjectName)
  await a.getByLabel('合同或采购编号', { exact: true }).fill(`BROWSER-${nonce}`)
  await a.getByLabel('服务开始日', { exact: true }).fill(date)
  await a.getByLabel('服务截止日', { exact: true }).fill(endDate)
  await a.getByLabel('免费服务与维保范围', { exact: true }).fill('免费打印、年度技术维保；仅隔离浏览器验证资料。')
  await a.getByLabel('服务联系渠道', { exact: true }).fill('首单验证服务窗口')
  const created = await responseAfter(admin, 'POST', '/admin/first-order/projects', () => a.getByRole('button', { name: '创建服务项目', exact: true }).click())
  await expect(a.getByLabel('服务项目', { exact: true })).toHaveValue(created.id)
  await a.getByLabel('待登记终端', { exact: true }).selectOption(fixture.terminals.spare)
  await a.getByLabel('安装位置', { exact: true }).fill('浏览器验证大厅')
  const deployed = await responseAfter(admin, 'POST', `/projects/${created.id}/deployments`, () => a.getByRole('button', { name: '登记项目设备', exact: true }).click())
  await openAdmin(admin, adminOrigin, orgName); a = adminPanel(admin)
  await chooseProject(a, created.id, '项目台账')
  await expect(a.getByTestId(`first-order-deployment-${deployed.id}`)).toContainText('浏览器验证大厅')
  await a.getByRole('button', { name: '编辑项目资料', exact: true }).click()
  await expect(a.getByLabel('服务开始日', { exact: true })).toBeDisabled()
  await expect(a.getByLabel('服务截止日', { exact: true })).toBeDisabled()
  await a.getByRole('button', { name: '收起项目编辑', exact: true }).click()
  mark('Admin creates project and deployment, refresh persists; registered dates are locked')
  await shot(admin, 'admin-project-desktop', a)

  await partner.goto(`${partnerOrigin}/terminals`)
  let p = partnerPanel(partner)
  await expect(p.getByRole('button', { name: '刷新项目服务', exact: true })).toBeEnabled()
  await chooseProject(p, created.id, '报障与恢复')
  await p.getByLabel('报障设备', { exact: true }).selectOption(deployed.id)
  await p.getByLabel('设备问题', { exact: true }).selectOption('paper')
  await p.getByLabel('故障情况', { exact: true }).fill('浏览器隔离验证：设备提示缺纸，请检查纸盒。')
  const incident = await responseAfter(partner, 'POST', '/partner/first-order/incidents', () => p.getByRole('button', { name: '提交设备报障', exact: true }).click())
  await partner.reload(); p = partnerPanel(partner)
  await expect(p.getByRole('button', { name: '刷新项目服务', exact: true })).toBeEnabled()
  await chooseProject(p, created.id, '报障与恢复')
  await expect(p.getByTestId(`first-order-incident-${incident.id}`)).toContainText('浏览器隔离验证')
  mark('Partner creates equipment incident through real API; refresh retains it')

  await refresh(a); await chooseProject(a, created.id, '报障处理')
  let incidentCard = a.getByTestId(`first-order-incident-${incident.id}`)
  await incidentCard.getByLabel('处理负责人', { exact: true }).fill('验证维修负责人')
  await incidentCard.getByLabel('处理说明', { exact: true }).fill('浏览器隔离验证：已受理并检查纸盒。')
  await responseAfter(admin, 'PATCH', `/incidents/${incident.id}`, () => incidentCard.getByRole('button', { name: '开始处理', exact: true }).click())
  await expect(incidentCard.getByRole('status', { name: '处理中', exact: true })).toBeVisible()
  await incidentCard.getByLabel('处理说明', { exact: true }).fill('浏览器隔离验证：已记录补纸处置，等待机构核对；不构成真机出纸证据。')
  await responseAfter(admin, 'PATCH', `/incidents/${incident.id}`, () => incidentCard.getByRole('button', { name: '记录技术恢复', exact: true }).click())
  await refresh(p)
  incidentCard = p.getByTestId(`first-order-incident-${incident.id}`)
  await expect(incidentCard.getByRole('status', { name: '技术恢复，待您核对', exact: true })).toBeVisible()
  await incidentCard.getByLabel('现场核对说明', { exact: true }).fill('浏览器隔离验证：核对处置记录。')
  await responseAfter(partner, 'PATCH', `/incidents/${incident.id}`, () => incidentCard.getByRole('button', { name: '确认恢复', exact: true }).click())
  await expect(incidentCard.getByRole('status', { name: '已确认恢复', exact: true })).toBeVisible()
  await incidentCard.getByLabel('现场核对说明', { exact: true }).fill('浏览器隔离验证：仍有缺纸提示，需要复查。')
  await responseAfter(partner, 'PATCH', `/incidents/${incident.id}`, () => incidentCard.getByRole('button', { name: '故障仍在，重新报障', exact: true }).click())
  await refresh(a)
  await expect(a.getByTestId(`first-order-incident-${incident.id}`).getByRole('status', { name: '待受理', exact: true })).toBeVisible()
  mark('Admin starts/resolves; Partner confirms/reopens; Admin sees persisted reopened state')
  await shot(partner, 'partner-incident-desktop', p)

  await chooseProject(a, fixture.projectId, '月报资料')
  await a.getByLabel('统计月份', { exact: true }).fill(fixture.month)
  const previewA = await responseAfter(admin, 'GET', `/projects/${fixture.projectId}/report-preview`, () => a.getByRole('button', { name: '预览自然月报', exact: true }).click())
  await chooseProject(p, fixture.projectId, '月报资料')
  await p.getByLabel('统计月份', { exact: true }).fill(fixture.month)
  const previewP = await responseAfter(partner, 'GET', `/projects/${fixture.projectId}/report-preview`, () => p.getByRole('button', { name: '预览自然月报', exact: true }).click())
  assert.deepEqual(previewA.metrics, previewP.metrics)
  assert.deepEqual(previewA.window, previewP.window)
  const saved = await responseAfter(admin, 'POST', `/projects/${fixture.projectId}/reports`, () => a.getByRole('button', { name: '生成留存月报', exact: true }).click())
  await expect(a.getByTestId('first-order-report-view')).toContainText('已留存月报')
  await refresh(p)
  await p.getByRole('button', { name: `查看 ${fixture.month} 月报`, exact: true }).click()
  await expect(p.getByTestId('first-order-report-view')).toContainText('已留存月报')
  const adminDownload = admin.waitForEvent('download')
  await a.getByRole('button', { name: `下载 ${fixture.month} CSV`, exact: true }).click()
  const adminCsv = join(output, 'admin-report.csv'); await (await adminDownload).saveAs(adminCsv)
  const partnerDownload = partner.waitForEvent('download')
  await p.getByRole('button', { name: `下载 ${fixture.month} CSV`, exact: true }).click()
  const partnerCsv = join(output, 'partner-report.csv'); await (await partnerDownload).saveAs(partnerCsv)
  const csvA = await readFile(adminCsv, 'utf8'), csvP = await readFile(partnerCsv, 'utf8')
  assert.equal(csvA, csvP)
  assert(!csvA.includes('PRIVATE_RESUME_BODY'))
  assert(!csvA.includes(fixture.tokens.admin) && !csvA.includes(fixture.tokens.partner))
  await responseAfter(partner, 'POST', `/reports/${saved.id}/acknowledge`, () => p.getByRole('button', { name: '记录已核对月报', exact: true }).click())
  await expect(p.getByTestId('first-order-report-view')).toContainText('机构核对于')
  const acknowledged = await api('admin', `/admin/first-order/reports/${saved.id}`)
  assert(acknowledged.acknowledgedAt)
  mark('Both previews agree; immutable monthly report, identical real CSV downloads, Partner acknowledgement persist')
  await shot(admin, 'admin-report-desktop', a)
  await shot(partner, 'partner-report-desktop', p)
  await shot(admin, 'admin-report-narrow', a, true)
  await shot(partner, 'partner-report-narrow', p, true)
  mark('Desktop and 390px views keep first-order panel and controls within viewport')
  assert.equal(results.pageErrors.length, 0, 'Browser runtime errors occurred')
  assert(!results.externalRequests.some((item) => item.path.includes('/first-order/')), 'First-order requests failed')
  results.status = 'PASS'
} catch (error) {
  results.status = 'FAIL'; results.error = error instanceof Error ? error.message : 'Browser verification failed'
  if (browser) {
    for (const [index, ctx] of browser.contexts().entries()) for (const page of ctx.pages()) {
      const path = join(output, `failure-${index}.png`)
      await page.screenshot({ path }).catch(() => undefined)
      results.screenshots.push({ path, failure: true })
    }
  }
  console.error(results.error)
  process.exitCode = 1
} finally {
  await browser?.close()
  await stopOwnedProcesses()
  results.finishedAt = new Date().toISOString()
  await writeFile(join(output, 'result.json'), JSON.stringify(results, null, 2), { mode: 0o600 })
  console.log(`Browser result: ${results.status}; artifacts: ${output}`)
}
