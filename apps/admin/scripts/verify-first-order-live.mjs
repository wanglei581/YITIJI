#!/usr/bin/env node
/** Real browser -> Vite/http adapters -> authenticated Nest -> isolated SQLite.
 * Focused mode uses fixture JWTs; --isolated-full performs real password login.
 * Neither mode verifies SMS/2FA, live AI or hardware. No route interception/API stubs.
 * Usage: node apps/admin/scripts/verify-first-order-live.mjs --isolated [output-dir]
 *    or: node apps/admin/scripts/verify-first-order-live.mjs --isolated-full [output-dir]
 *    or: node apps/admin/scripts/verify-first-order-live.mjs /private/fixture.json [output-dir]
 * FIRST_ORDER_BROWSER_OUTPUT selects the artifacts directory in CI.
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomBytes, randomInt } from 'node:crypto'
import { stripVTControlCharacters } from 'node:util'
import { readFile, writeFile, mkdir, mkdtemp, rm, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const fullApp = process.argv[2] === '--isolated-full'
const isolated = fullApp || process.argv[2] === '--isolated'
const descriptor = isolated ? null : process.argv[2]
if (!isolated && !descriptor) throw new Error('Use --isolated or provide a private fixture descriptor')
let fixture
let launchDirectory
let ownedApiDirectory
let expectedProjectConflictPath
const outputArgument = process.argv[3] || process.env.FIRST_ORDER_BROWSER_OUTPUT
const output = outputArgument ? resolve(outputArgument) : await mkdtemp(join(tmpdir(), 'first-order-browser-'))
await mkdir(output, { recursive: true })
const requireKiosk = createRequire(join(root, 'apps/kiosk/package.json'))
const { chromium, expect } = requireKiosk('@playwright/test')
const children = []
let browser
let interrupted = false
let cleanupPromise
const results = { startedAt: new Date().toISOString(), mode: fullApp ? 'isolated_full_app' : isolated ? 'isolated' : 'external_descriptor', cleanup: [], checks: [], screenshots: [], externalRequests: [], pageErrors: [], limitations: ['Isolated synthetic SQLite task/result records; no Pantum/Windows device acceptance.', fullApp ? 'Real Admin login creates an unverified Partner account through UI; first login and business use that account. SMS/2FA and production runtime gates are not exercised.' : 'Real fixture-issued JWT + AuthGuard checks; SMS login is not exercised.', fullApp ? 'Complete AppModule with owned Redis queues and local storage; no live AI/provider or production deployment acceptance.' : 'Fixture loads FirstOrderModule + OrgsModule, not the complete production application.'] }
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
    item.exited = !alive(child)
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
  assert.notEqual(new URL(value.base).port, '0', 'API helper must return the actual listening port')
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
  const child = spawn(process.execPath, ['-r', '@swc-node/register', 'scripts/support/first-order-fixture.ts', ...(fullApp ? ['--full-app'] : [])], {
    cwd: join(root, 'services/api'), env, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
  })
  child.firstOrderKind = 'api'; children.push(child)
  let path, spawnFailure, readyBuffer = '', errorBuffer = ''
  child.on('error', (error) => { spawnFailure = error.message })
  child.stdout.on('data', (chunk) => {
    readyBuffer = `${readyBuffer}${chunk}`.slice(-32000)
    const ready = readyBuffer.match(/private descriptor: ([^\r\n]+\/browser-fixture\.json)(?:\r?\n|$)/)
    if (ready) path = ready[1].trim()
  })
  // Keep bounded diagnostics private; do not print fixture credentials or process logs.
  child.stderr.on('data', (chunk) => { errorBuffer = `${errorBuffer}${chunk}`.slice(-32000) })
  const deadline = Date.now() + 90000
  while (Date.now() < deadline) {
    if (spawnFailure || child.exitCode !== null || child.signalCode !== null) {
      await writeFile(join(output, 'api-startup.log'), `${readyBuffer}\n${errorBuffer}`, { mode: 0o600 })
      throw new Error('Isolated API startup failed; private diagnostics: api-startup.log')
    }
    if (path) {
      ownedApiDirectory = resolve(dirname(path))
      const value = await readDescriptor(path, child.pid)
      if (fullApp) assert.equal(value.application, 'AppModule')
      results.apiPid = child.pid
      return value
    }
    await delay(200)
  }
  await writeFile(join(output, 'api-startup.log'), `${readyBuffer}\n${errorBuffer}`, { mode: 0o600 })
  throw new Error('Isolated API readiness exceeded 90 seconds; private diagnostics: api-startup.log')
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
    // Wait for this owned Vite child, never accept an unrelated process already on the port.
    if (!stripVTControlCharacters(logs).includes(origin)) { await delay(250); continue }
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

async function context(role, origin) {
  const user = { id: fixture.users[role], name: role === 'admin' ? '首单管理员（验证）' : '首单机构（验证）', role, orgId: role === 'partner' ? fixture.orgs.own : null }
  const value = { token: fixture.tokens[role], user }
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true })
  if (!fullApp) await ctx.addInitScript(({ key, stored }) => { localStorage.setItem(key, JSON.stringify(stored)) }, { key: `${role}_auth_v1`, stored: value })
  const page = await ctx.newPage()
  if (fullApp) await page.exposeBinding('firstOrderDisconnectAfterWrite', () => ctx.setOffline(true))
  page.setDefaultTimeout(30000)
  page.on('pageerror', (error) => results.pageErrors.push(`${role}: ${error.message}`))
  page.on('response', (response) => {
    if (response.url().startsWith(fixture.base) && response.status() >= 400) {
      results.externalRequests.push({ role, path: new URL(response.url()).pathname, status: response.status() })
    }
  })
  if (fullApp) {
    let phoneVerifyRequests = 0
    if (role === 'partner') page.on('request', (request) => {
      if (request.url().startsWith(fixture.base) && /\/auth\/phone\/(code|verify)$/.test(new URL(request.url()).pathname)) phoneVerifyRequests++
    })
    await page.goto(`${origin}/login`)
    await page.getByPlaceholder(role === 'admin' ? '请输入管理员账号或手机号' : '请输入机构账号、已验证手机号或已验证邮箱', { exact: true }).fill(fixture.credentials[role].loginId)
    await page.getByPlaceholder('请输入密码', { exact: true }).fill(fixture.credentials[role].password)
    const agreement = page.getByRole('checkbox', { name: /我已阅读并同意/ })
    await agreement.locator('.box').click()
    await expect(agreement).toHaveAttribute('aria-checked', 'true')
    const response = await responseAfter(page, 'POST', '/auth/login', () => page.locator('form button[type="submit"]').click())
    assert.equal(response.data.user.id, fixture.users[role])
    if (role === 'partner' && !response.data.user.phoneVerifiedAt) {
      assert.equal(response.data.user.phoneVerificationAvailable, false)
      const initialAccount = page.getByRole('dialog', { name: '账号已登录', exact: true })
      await expect(initialAccount).toContainText('新账号初始密码由管理员交付')
      await expect(initialAccount.getByRole('button', { name: '获取验证码', exact: true })).toHaveCount(0)
      await page.screenshot({ path: join(output, 'partner-first-login-guidance.png'), fullPage: false, animations: 'disabled' })
      await initialAccount.getByRole('button', { name: '进入工作台', exact: true }).click()
      assert.equal(phoneVerifyRequests, 0, 'Initial credentials must not invoke unavailable phone verification')
      mark('Newly created unverified account receives honest guidance and enters workbench without phone verification')
    }
    await page.waitForURL((url) => url.pathname !== '/login')
    const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), `${role}_auth_v1`)
    assert.equal(stored.token, response.data.token)
    fixture.tokens[role] = stored.token
    const me = await api(role, '/auth/me')
    assert.equal(me.data.userId, fixture.users[role])
    assert.equal(me.data.role, role)
    assert.equal(me.data.orgId, role === 'partner' ? fixture.orgs.own : null)
    mark(`${role} password login uses real UI/API and current-account identity agrees`)
  }
  return page
}

async function responseAfter(page, method, suffix, action) {
  const [response] = await Promise.all([
    page.waitForResponse((response) => response.url().startsWith(fixture.base) && new URL(response.url()).pathname.endsWith(suffix) && response.request().method() === method),
    action(),
  ])
  assert.equal(response.ok(), true, `${method} ${suffix} returned ${response.status()}`)
  return response.json()
}

/** Receive the real committed HTTP response, then disconnect before the UI refresh.
 * No fake response is returned; reconnect and reread the database through the real API.
 */
async function disconnectAfterWrite(page, suffix, method = 'POST') {
  if (!fullApp) return
  await page.evaluate(({ base, suffix, method }) => {
    const original = window.fetch.bind(window)
    window.fetch = async (input, init) => {
      const response = await original(input, init)
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.startsWith(base) && new URL(url).pathname.endsWith(suffix) && init?.method === method && response.ok) {
        window.fetch = original
        await response.clone().arrayBuffer()
        await window.firstOrderDisconnectAfterWrite()
      }
      return response
    }
  }, { base: fixture.base, suffix, method })
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
async function reconnectAfterWrite(page, panel, verifySaved) {
  await expect(panel.getByRole('alert')).toContainText('现有内容尚未刷新')
  await verifySaved()
  await page.context().setOffline(false)
  await refresh(panel)
  await expect(panel.getByRole('alert')).toHaveCount(0)
  await expect(panel.getByRole('status').filter({ hasText: '列表暂未刷新' })).toHaveCount(0)
  await verifySaved()
}
async function shot(page, name, panel, narrow = false) {
  if (narrow) {
    await page.setViewportSize({ width: 390, height: 844 })
    await delay(300)
    const collapse = page.getByRole('button', { name: '收起侧边栏', exact: true })
    if (await collapse.isVisible() && await collapse.evaluate((element) => {
      const box = element.getBoundingClientRect()
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
      return hit !== null && element.contains(hit)
    })) await collapse.click()
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
  const admin = await context('admin', adminOrigin)
  if (fullApp) {
    const health = await fetch(`${fixture.base}/health/ready`, { signal: AbortSignal.timeout(10000) })
    assert.equal(health.status, 200)
    mark('Complete AppModule readiness succeeds with owned database and Redis')
  }
  const org = await api('admin', `/admin/orgs/${encodeURIComponent(fixture.orgs.own)}`)
  const orgName = org.name ?? org.data?.name
  assert.equal(typeof orgName, 'string')
  await openAdmin(admin, adminOrigin, orgName)
  if (fullApp) {
    const phoneUsername = `139${randomInt(10000000, 100000000)}`
    const initialPassword = `Fo!${randomBytes(20).toString('base64url')}9a`
    await admin.getByRole('button', { name: '新增账号', exact: true }).click()
    await admin.getByLabel('登录用户名', { exact: false }).fill(phoneUsername)
    await admin.getByLabel('账号姓名', { exact: false }).fill('首单新开户机构（验证）')
    await admin.getByLabel('登录手机号', { exact: false }).fill(phoneUsername)
    await admin.getByLabel('初始密码', { exact: false }).fill(initialPassword)
    const accountResponse = await responseAfter(admin, 'POST', `/admin/orgs/${fixture.orgs.own}/accounts`, () => admin.getByRole('button', { name: '创建账号', exact: true }).click())
    const account = accountResponse.data ?? accountResponse
    assert.equal(account.username, phoneUsername)
    assert.equal(account.enabled, true)
    assert.equal(account.phoneVerifiedAt, null)
    assert.equal(account.phoneRegisteredByAdminAt, null)
    await expect(admin.getByText(phoneUsername, { exact: true })).toBeVisible()
    await expect(admin.getByRole('status').filter({ hasText: '已创建，可使用该用户名' })).toBeVisible()
    fixture.users.partner = account.id
    fixture.credentials.partner = { loginId: phoneUsername, password: initialPassword }
    mark('Admin creates a new unverified partner account through the real UI; all following business uses that account')
  }
  const partner = await context('partner', partnerOrigin)
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
  let projectWrites = 0
  admin.on('request', (request) => { if (request.method() === 'POST' && request.url() === `${fixture.base}/admin/first-order/projects`) projectWrites++ })
  await disconnectAfterWrite(admin, '/admin/first-order/projects')
  const created = await responseAfter(admin, 'POST', '/admin/first-order/projects', () => fullApp
    ? a.getByRole('form', { name: '新建服务项目', exact: true }).evaluate((form) => { form.requestSubmit(); form.requestSubmit() })
    : a.getByRole('button', { name: '创建服务项目', exact: true }).click())
  await expect(a.getByLabel('服务项目', { exact: true })).toHaveValue(created.id)
  if (fullApp) {
    assert.equal(projectWrites, 1, 'Rapid duplicate submit must issue only one create request')
    await reconnectAfterWrite(admin, a, async () => {
      await expect(a.getByLabel('服务项目', { exact: true })).toHaveValue(created.id)
      await expect(a.getByRole('status')).toContainText('资料已保存')
    })
    mark('Committed project remains selected after failed refresh; duplicate submit is locked; reconnect persists')
  }
  await a.getByLabel('待登记终端', { exact: true }).selectOption(fixture.terminals.spare)
  await a.getByLabel('安装位置', { exact: true }).fill('浏览器验证大厅')
  await disconnectAfterWrite(admin, `/projects/${created.id}/deployments`)
  const deployed = await responseAfter(admin, 'POST', `/projects/${created.id}/deployments`, () => a.getByRole('button', { name: '登记项目设备', exact: true }).click())
  if (fullApp) {
    await reconnectAfterWrite(admin, a, async () => {
      await expect(a.getByTestId(`first-order-deployment-${deployed.id}`)).toContainText('浏览器验证大厅')
      await expect(a.getByLabel('待登记终端', { exact: true }).locator(`option[value="${fixture.terminals.spare}"]`)).toHaveCount(0)
      await expect(a.getByRole('status').filter({ hasText: '项目设备已登记' })).toBeVisible()
    })
    mark('Committed deployment remains visible after failed refresh and is unavailable for duplicate registration')
  }
  await openAdmin(admin, adminOrigin, orgName); a = adminPanel(admin)
  await chooseProject(a, created.id, '项目台账')
  await expect(a.getByTestId(`first-order-deployment-${deployed.id}`)).toContainText('浏览器验证大厅')
  await a.getByRole('button', { name: '编辑项目资料', exact: true }).click()
  await expect(a.getByLabel('服务开始日', { exact: true })).toBeDisabled()
  await expect(a.getByLabel('服务截止日', { exact: true })).toBeDisabled()
  await a.getByRole('button', { name: '收起项目编辑', exact: true }).click()
  mark('Admin creates project and deployment, refresh persists; registered dates are locked')
  await shot(admin, 'admin-project-desktop', a)

  if (fullApp) {
    await a.getByRole('button', { name: '编辑项目资料', exact: true }).click()
    await a.getByLabel('项目名称', { exact: true }).fill('不可覆盖另一客户端的最新资料')
    const current = (await api('admin', `/admin/first-order/overview?orgId=${fixture.orgs.own}`)).projects.find((item) => item.id === created.id)
    const payload = Object.fromEntries(['name', 'reference', 'serviceScope', 'supportContact', 'serviceStartAt', 'serviceEndAt', 'version'].map((key) => [key, current[key]]))
    const remoteName = `${newProjectName}-另一客户端更新`
    const remote = await fetch(`${fixture.base}/admin/first-order/projects/${created.id}`, { method: 'PATCH', headers: { Authorization: `Bearer ${fixture.tokens.admin}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, name: remoteName }), signal: AbortSignal.timeout(10000) })
    assert.equal(remote.status, 200)
    expectedProjectConflictPath = `/api/v1/admin/first-order/projects/${created.id}`
    async function expectConflict() {
      const conflict = admin.waitForResponse((response) => new URL(response.url()).pathname === expectedProjectConflictPath && response.request().method() === 'PATCH')
      await a.getByRole('button', { name: '保存项目资料', exact: true }).click()
      assert.equal((await conflict).status(), 409)
      await expect(a.getByRole('alert')).toContainText('记录已发生变化')
    }
    await expectConflict()
    await expect(a.getByText('若提示记录已发生变化，请先刷新项目服务，再收起编辑后重新打开，核对最新资料再保存。', { exact: true })).toBeVisible()
    await refresh(a)
    await expect(a.getByLabel('项目名称', { exact: true })).toHaveValue('不可覆盖另一客户端的最新资料')
    await expectConflict()
    assert.equal((await api('admin', `/admin/first-order/overview?orgId=${fixture.orgs.own}`)).projects.find((item) => item.id === created.id).name, remoteName)
    mark('Editing retains its original version after refresh; real concurrent update rejects stale form with 409')
    await a.getByRole('button', { name: '收起项目编辑', exact: true }).click()
    await a.getByRole('button', { name: '编辑项目资料', exact: true }).click()
    await expect(a.getByLabel('项目名称', { exact: true })).toHaveValue(remoteName)
    const savedName = `${newProjectName}-保存时切换项目`
    await a.getByLabel('项目名称', { exact: true }).fill(savedName)
    await admin.evaluate(({ base, id }) => {
      const original = window.fetch.bind(window)
      window.fetch = async (input, init) => {
        const response = await original(input, init)
        if (String(input) === `${base}/admin/first-order/projects/${id}` && init?.method === 'PATCH' && response.ok) {
          window.fetch = original; await response.clone().arrayBuffer()
          await new Promise((release) => { window.firstOrderReleaseSave = release })
        }
        return response
      }
    }, { base: fixture.base, id: created.id })
    await responseAfter(admin, 'PATCH', `/projects/${created.id}`, () => a.getByRole('button', { name: '保存项目资料', exact: true }).click())
    await admin.waitForFunction(() => typeof window.firstOrderReleaseSave === 'function')
    const another = (await api('admin', `/admin/first-order/overview?orgId=${fixture.orgs.own}`)).projects.find((item) => item.id !== created.id)
    assert(another)
    await a.getByLabel('服务项目', { exact: true }).selectOption(another.id)
    const reloaded = admin.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/admin/first-order/overview' && response.request().method() === 'GET')
    await admin.evaluate(() => window.firstOrderReleaseSave())
    assert.equal((await reloaded).status(), 200)
    await expect(a.getByLabel('服务项目', { exact: true })).toHaveValue(another.id)
    await expect(a.getByLabel('服务项目', { exact: true }).locator(`option[value="${created.id}"]`)).toHaveText(savedName)
    mark('Late committed save refreshes the project list without switching back to the unmounted form')

    const cancelledName = `${newProjectName}-提交后取消新建`
    await a.getByRole('button', { name: '新建服务项目', exact: true }).click()
    await expect(a.getByText('离开表单不会撤回已提交的创建请求；创建成功后会在上方提示，未出现请刷新核对。', { exact: true })).toBeVisible()
    await a.getByLabel('项目名称', { exact: true }).fill(cancelledName)
    await a.getByLabel('合同或采购编号', { exact: true }).fill(`CANCEL-${nonce}`)
    await a.getByLabel('服务开始日', { exact: true }).fill(date)
    await a.getByLabel('服务截止日', { exact: true }).fill(endDate)
    await a.getByLabel('免费服务与维保范围', { exact: true }).fill('仅隔离浏览器验证：提交后离开表单的真实持久化。')
    await a.getByLabel('服务联系渠道', { exact: true }).fill('首单验证服务窗口')
    await admin.evaluate(({ base }) => {
      const original = window.fetch.bind(window)
      window.fetch = async (input, init) => {
        const response = await original(input, init)
        if (String(input) === `${base}/admin/first-order/projects` && init?.method === 'POST' && response.ok) {
          window.fetch = original; await response.clone().arrayBuffer()
          await new Promise((release) => { window.firstOrderReleaseCreate = release })
        }
        return response
      }
    }, { base: fixture.base })
    const cancelledCreate = await responseAfter(admin, 'POST', '/admin/first-order/projects', () => a.getByRole('button', { name: '创建服务项目', exact: true }).click())
    await admin.waitForFunction(() => typeof window.firstOrderReleaseCreate === 'function')
    await a.getByRole('button', { name: '取消新建', exact: true }).click()
    await expect(a.getByRole('button', { name: '取消新建', exact: true })).toBeHidden()
    await expect(a.getByLabel('服务项目', { exact: true })).toHaveValue(another.id)
    await expect(a.getByRole('status').filter({ hasText: `项目「${cancelledName}」资料已保存。` })).toHaveCount(0)
    const createReloaded = admin.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/admin/first-order/overview' && response.request().method() === 'GET')
    await admin.evaluate(() => window.firstOrderReleaseCreate())
    assert.equal((await createReloaded).status(), 200)
    await expect(a.getByRole('status').filter({ hasText: `项目「${cancelledName}」资料已保存。` })).toBeVisible()
    await expect(a.getByLabel('服务项目', { exact: true }).locator(`option[value="${cancelledCreate.id}"]`)).toHaveText(cancelledName)
    await expect(a.getByLabel('服务项目', { exact: true })).toHaveValue(another.id)
    assert.equal((await api('admin', `/admin/first-order/overview?orgId=${fixture.orgs.own}`)).projects.find((item) => item.id === cancelledCreate.id)?.name, cancelledName)
    mark('Cancelling a submitted create keeps the selected project and shows the committed project in notice, list, and database')
  }

  await partner.goto(`${partnerOrigin}/terminals`)
  await partner.getByRole('tab', { name: '项目与服务', exact: true }).click()
  await expect(partner).toHaveURL(/[?&]tab=delivery(?:&|$)/)
  let p = partnerPanel(partner)
  await expect(p.getByRole('button', { name: '刷新项目服务', exact: true })).toBeEnabled()
  await chooseProject(p, created.id, '报障与恢复')
  await expect(partner).toHaveURL(/[?&]section=incidents(?:&|$)/)
  await expect(partner).toHaveURL(/[?&]tab=delivery(?:&|$)/)
  await p.getByRole('tab', { name: '月报资料', exact: true }).click()
  await expect(partner).toHaveURL(/[?&]section=reports(?:&|$)/)
  await expect(partner).toHaveURL(/[?&]tab=delivery(?:&|$)/)
  await p.getByRole('tab', { name: '项目资料', exact: true }).click()
  await expect(partner).toHaveURL(/[?&]section=project(?:&|$)/)
  await expect(partner).toHaveURL(/[?&]tab=delivery(?:&|$)/)
  await p.getByRole('tab', { name: '报障与恢复', exact: true }).click()
  await expect(p.getByRole('tab', { name: '报障与恢复', exact: true })).toHaveAttribute('aria-selected', 'true')
  mark('Partner project service tabs write section and keep the delivery tab')
  await partner.goto(`${partnerOrigin}/terminals?tab=delivery&section=reports&period=month`)
  p = partnerPanel(partner)
  await expect(p.getByRole('button', { name: '刷新项目服务', exact: true })).toBeEnabled()
  await p.getByLabel('服务项目', { exact: true }).selectOption(created.id)
  await expect(p.getByRole('tab', { name: '月报资料', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(partner).toHaveURL(/[?&]section=reports(?:&|$)/)
  await expect(partner).toHaveURL(/[?&]tab=delivery(?:&|$)/)
  await expect(partner).toHaveURL(/[?&]period=month(?:&|$)/)
  mark('Direct section=reports opens the monthly report tab and keeps other parameters')
  await p.getByRole('tab', { name: '报障与恢复', exact: true }).click()
  await p.getByLabel('报障设备', { exact: true }).selectOption(deployed.id)
  await p.getByLabel('设备问题', { exact: true }).selectOption('paper')
  await p.getByLabel('故障情况', { exact: true }).fill('浏览器隔离验证：设备提示缺纸，请检查纸盒。')
  await disconnectAfterWrite(partner, '/partner/first-order/incidents')
  const incident = await responseAfter(partner, 'POST', '/partner/first-order/incidents', () => p.getByRole('button', { name: '提交设备报障', exact: true }).click())
  if (fullApp) {
    await reconnectAfterWrite(partner, p, async () => { await expect(p.getByTestId(`first-order-incident-${incident.id}`)).toContainText('浏览器隔离验证'); await expect(p.getByRole('status').filter({ hasText: '报障已提交' })).toBeVisible() })
    mark('Committed incident is visible after failed refresh; reconnect retains the same incident')
  }
  await partner.reload(); p = partnerPanel(partner)
  await expect(p.getByRole('button', { name: '刷新项目服务', exact: true })).toBeEnabled()
  await chooseProject(p, created.id, '报障与恢复')
  await expect(p.getByTestId(`first-order-incident-${incident.id}`)).toContainText('浏览器隔离验证')
  mark('Partner creates equipment incident through real API; refresh retains it')
  // 刚报的故障还没受理时，机构工作台也要看得见，不能写成「今天没有要核对的事」
  await partner.goto(`${partnerOrigin}/`)
  await expect(partner.getByRole('region', { name: '今天要处理' })).toContainText('已提交，等平台受理')
  await expect(partner.getByRole('region', { name: '今天要处理' })).not.toContainText('今天没有要核对的事')
  mark('Partner workbench shows the just-reported incident as waiting for platform acceptance')
  await partner.goto(`${partnerOrigin}/terminals?tab=delivery&section=incidents`); p = partnerPanel(partner)
  await chooseProject(p, created.id, '报障与恢复')

  await refresh(a); await chooseProject(a, created.id, '报障处理')
  let incidentCard = a.getByTestId(`first-order-incident-${incident.id}`)
  await incidentCard.getByLabel('处理负责人', { exact: true }).fill('验证维修负责人')
  await incidentCard.getByLabel('处理说明', { exact: true }).fill('浏览器隔离验证：已受理并检查纸盒。')
  await disconnectAfterWrite(admin, `/incidents/${incident.id}`, 'PATCH')
  await responseAfter(admin, 'PATCH', `/incidents/${incident.id}`, () => incidentCard.getByRole('button', { name: '开始处理', exact: true }).click())
  if (fullApp) {
    await reconnectAfterWrite(admin, a, () => expect(incidentCard.getByRole('status', { name: '处理中', exact: true })).toBeVisible())
    mark('Committed Admin incident state and version survive failed refresh')
  }
  await expect(incidentCard.getByRole('status', { name: '处理中', exact: true })).toBeVisible()
  await incidentCard.getByLabel('处理说明', { exact: true }).fill('浏览器隔离验证：已记录补纸处置，等待机构核对；不构成真机出纸证据。')
  await responseAfter(admin, 'PATCH', `/incidents/${incident.id}`, () => incidentCard.getByRole('button', { name: '记录技术恢复', exact: true }).click())
  await refresh(p)
  incidentCard = p.getByTestId(`first-order-incident-${incident.id}`)
  await expect(incidentCard.getByRole('status', { name: '技术恢复，待您核对', exact: true })).toBeVisible()
  await incidentCard.getByLabel('现场核对说明', { exact: true }).fill('浏览器隔离验证：核对处置记录。')
  await disconnectAfterWrite(partner, `/incidents/${incident.id}`, 'PATCH')
  await responseAfter(partner, 'PATCH', `/incidents/${incident.id}`, () => incidentCard.getByRole('button', { name: '确认恢复', exact: true }).click())
  if (fullApp) {
    await reconnectAfterWrite(partner, p, () => expect(incidentCard.getByRole('status', { name: '已确认恢复', exact: true })).toBeVisible())
    mark('Committed Partner recovery confirmation survives failed refresh')
  }
  await expect(incidentCard.getByRole('status', { name: '已确认恢复', exact: true })).toBeVisible()
  if (fullApp) {
    await refresh(a)
    await expect(a.getByTestId(`first-order-incident-${incident.id}`).getByRole('status', { name: '机构已确认恢复', exact: true })).toBeVisible()
    await incidentCard.scrollIntoViewIfNeeded()
    await partner.screenshot({ path: join(output, 'partner-confirmed-recovery.png'), fullPage: false, animations: 'disabled' })
    await a.getByTestId(`first-order-incident-${incident.id}`).scrollIntoViewIfNeeded()
    await admin.screenshot({ path: join(output, 'admin-confirmed-recovery.png'), fullPage: false, animations: 'disabled' })
    mark('Newly onboarded partner confirms recovery; refreshed Admin sees the same confirmed incident')
  }
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
  await disconnectAfterWrite(admin, `/projects/${fixture.projectId}/reports`)
  const saved = await responseAfter(admin, 'POST', `/projects/${fixture.projectId}/reports`, () => a.getByRole('button', { name: '生成留存月报', exact: true }).click())
  if (fullApp) {
    await reconnectAfterWrite(admin, a, () => expect(a.getByRole('status').filter({ hasText: '月报已留存' })).toBeVisible())
    await disconnectAfterWrite(partner, `/projects/${fixture.projectId}/reports`)
    const same = await responseAfter(partner, 'POST', `/projects/${fixture.projectId}/reports`, () => p.getByRole('button', { name: '生成留存月报', exact: true }).click())
    assert.equal(same.id, saved.id)
    await reconnectAfterWrite(partner, p, () => expect(p.getByRole('status').filter({ hasText: '月报已留存' })).toBeVisible())
    mark('Both consoles retain the same committed report after failed list refresh')
  }
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
  await disconnectAfterWrite(partner, `/reports/${saved.id}/acknowledge`)
  await responseAfter(partner, 'POST', `/reports/${saved.id}/acknowledge`, () => p.getByRole('button', { name: '记录已核对月报', exact: true }).click())
  if (fullApp) {
    await reconnectAfterWrite(partner, p, () => expect(p.getByRole('status').filter({ hasText: '月报核对已记录' })).toBeVisible())
    mark('Committed report acknowledgement remains visible after failed refresh')
  }
  await expect(p.getByTestId('first-order-report-view')).toContainText('机构核对于')
  const acknowledged = await api('admin', `/admin/first-order/reports/${saved.id}`)
  assert(acknowledged.acknowledgedAt)
  mark('Both previews agree; immutable monthly report, identical real CSV downloads, Partner acknowledgement persist')
  await shot(admin, 'admin-report-desktop', a)
  await shot(partner, 'partner-report-desktop', p)
  await shot(admin, 'admin-report-narrow', a, true)
  await shot(partner, 'partner-report-narrow', p, true)
  mark('Desktop and 390px views keep first-order panel and controls within viewport')
  await admin.setViewportSize({ width: 1440, height: 1000 })
  const directory = await api('admin', '/admin/first-order/incidents')
  assert.ok(directory.total > 0, 'fixture leaves at least one unclosed incident')
  const incidentCounts = { open: 0, processing: 0, resolved: 0 }
  if (directory.truncated) {
    for (const status of ['open', 'processing', 'resolved']) {
      incidentCounts[status] = (await api('admin', `/admin/first-order/incidents?status=${status}&limit=1`)).total
    }
  } else {
    for (const item of directory.items) {
      if (item.status === 'open' || item.status === 'processing' || item.status === 'resolved') incidentCounts[item.status] += 1
    }
  }
  const countText = (value) => String(Math.trunc(Math.abs(value))).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  await admin.goto(`${adminOrigin}/`)
  const today = admin.locator('section').filter({ has: admin.getByRole('heading', { name: '今天要处理', exact: true }) })
  await expect(today).toContainText(`未结报障 ${countText(directory.total)}（待受理 ${countText(incidentCounts.open)} · 处理中 ${countText(incidentCounts.processing)} · 技术恢复待机构核对 ${countText(incidentCounts.resolved)}）`)
  mark('Dashboard unclosed incident count matches the cross-org directory')
  await admin.goto(`${adminOrigin}/partners?org=${encodeURIComponent(fixture.orgs.own)}&section=incidents`)
  const deepPanel = adminPanel(admin)
  await expect(deepPanel.getByRole('tab', { name: '报障处理', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(deepPanel.getByRole('button', { name: '刷新项目服务', exact: true })).toBeEnabled()
  mark('Address opens the org drawer on incident handling')
  assert.equal(results.pageErrors.length, 0, 'Browser runtime errors occurred')
  const expectedConflicts = results.externalRequests.filter((item) => item.role === 'admin' && item.path === expectedProjectConflictPath && item.status === 409)
  assert.equal(expectedConflicts.length, fullApp ? 2 : 0, 'Exactly two intentional stale-form conflicts are expected')
  results.expectedRequestFailures = expectedConflicts
  const unexpectedRequests = results.externalRequests.filter((item) => !expectedConflicts.includes(item))
  assert(!unexpectedRequests.some((item) => item.path.includes('/first-order/')), 'Unexpected first-order requests failed')
  if (fullApp) {
    assert.deepEqual(unexpectedRequests, [], 'Unexpected complete application browser requests failed')
    for (const role of ['admin', 'partner']) {
      const headers = { Authorization: `Bearer ${fixture.tokens[role]}` }
      const logout = await fetch(`${fixture.base}/auth/logout`, { method: 'POST', headers, signal: AbortSignal.timeout(10000) })
      assert.equal(logout.status, 200)
      const replay = await fetch(`${fixture.base}/${role}/first-order/overview${role === 'admin' ? `?orgId=${fixture.orgs.own}` : ''}`, { headers, signal: AbortSignal.timeout(10000) })
      assert.equal(replay.status, 401)
    }
    mark('Both real login sessions are revoked on logout; old tokens cannot read first-order data')
  }
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
