// D2 后台界面操作的共用件：自建无头浏览器、截图、流水、密钥文件。
// 不连接 9333，避免和别的走查抢同一个浏览器。
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { chromium } from '/Users/wanglei/AI求职打印服务终端/.claude/worktrees/youthful-jang-8df61d/node_modules/.pnpm/playwright@1.55.1/node_modules/playwright/index.mjs'

export const ROOT = join(homedir(), '.cache/walk0929')
export const EVID = join(ROOT, 'evidence/dataset-d2')
export const SECRET = join(ROOT, 'secret')
export const API_LOG = join(ROOT, 'logs/api.log')
export const ADMIN_ORIGIN = 'http://127.0.0.1:4320'
export const PARTNER_ORIGIN = 'http://127.0.0.1:4330'
export const API_BASE = 'http://127.0.0.1:4300/api/v1'
export const SIM_AGENT = '/Users/wanglei/AI求职打印服务终端/.claude/worktrees/youthful-jang-8df61d/scripts/walkthrough/sim-agent.mjs'

const ADMIN_STATE_SHARED = join(SECRET, 'ui-state-admin.json')
const ADMIN_STATE_D2 = join(SECRET, 'ui-state-d2-admin.json')

mkdirSync(EVID, { recursive: true })
mkdirSync(SECRET, { recursive: true })

export function shanghaiIso(date = new Date()) {
  return date.toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).replace(' ', 'T') + '+08:00'
}

export function maskPhone(phone) {
  const digits = String(phone ?? '').replace(/\D/g, '')
  if (digits.length < 7) return ''
  return `${digits.slice(0, 3)}****${digits.slice(-4)}`
}

export function makePassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  const bytes = randomBytes(24)
  let out = 'Kx7!'
  for (const byte of bytes) out += alphabet[byte % alphabet.length]
  return out.slice(0, 20)
}

export function writePrivate(name, content) {
  const path = name.startsWith('/') ? name : join(SECRET, name)
  writeFileSync(path, typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`, { mode: 0o600 })
  chmodSync(path, 0o600)
  return path
}

export function readJsonSecret(name) {
  return JSON.parse(readFileSync(join(SECRET, name), 'utf8'))
}

const seqFile = join(EVID, '.seq')
function nextSeq() {
  const n = existsSync(seqFile) ? Number(readFileSync(seqFile, 'utf8')) + 1 : 1
  writeFileSync(seqFile, String(n))
  return String(n).padStart(3, '0')
}

export function latestSmsCode(phoneTail, afterLen) {
  if (!existsSync(API_LOG)) return null
  const txt = readFileSync(API_LOG, 'utf8').slice(afterLen)
  const re = new RegExp(`\\[DEV 短信\\][^\\n]*${phoneTail}[^\\n]*验证码[:：]\\s*(\\d{6})`, 'g')
  let match = null
  let code = null
  while ((match = re.exec(txt))) code = match[1]
  return code
}

export function apiLogLength() {
  return existsSync(API_LOG) ? readFileSync(API_LOG, 'utf8').length : 0
}

export function logOffline({ actor = '平台管理员', side = '脚本', url = '', action, input = '', result = '', screenshot = '' }) {
  const line = {
    time: shanghaiIso(),
    人物: actor,
    手机号: '',
    端: side,
    页面URL: url,
    操作: action,
    输入: String(input).slice(0, 500),
    结果: String(result).slice(0, 800),
    页数: '',
    份数: '',
    金额: '',
    订单号: '',
    截图: screenshot,
  }
  appendFileSync(join(EVID, 'flow.jsonl'), `${JSON.stringify(line)}\n`)
  console.log(`[${side}] ${action} → ${String(result).slice(0, 180)}`)
}

function createHelpers(page, { actor, phone, side, origin }) {
  const netLog = []
  page.on('response', async (response) => {
    const url = response.url()
    if (!url.includes('/api/')) return
    const entry = { method: response.request().method(), url: url.replace(/^https?:\/\/[^/]+/, ''), status: response.status() }
    if (response.status() >= 400) {
      try { entry.body = (await response.text()).slice(0, 500) } catch { /* ignore */ }
    }
    netLog.push(entry)
  })

  return {
    page,
    origin,
    side,
    actor,
    phone,
    net() { return netLog.slice() },
    netErrors() { return netLog.filter((entry) => entry.status >= 400) },
    clearNet() { netLog.length = 0 },
    async pause(ms = 600) { await page.waitForTimeout(ms) },
    async text(sel = 'body') { return (await page.locator(sel).first().innerText().catch(() => '')).trim() },
    async shot(slug) {
      const path = join(EVID, `${nextSeq()}-${slug}.png`)
      const viewport = page.viewportSize() ?? { width: 1440, height: 900 }
      const need = await page.evaluate(() => {
        let max = document.documentElement.scrollHeight
        for (const el of document.querySelectorAll('main, [class*="overflow-y-auto"], [class*="overflow-auto"], [role=dialog]')) {
          const extra = el.scrollHeight - el.clientHeight
          if (extra > 0) max = Math.max(max, window.innerHeight + extra)
        }
        return max
      }).catch(() => viewport.height)
      const tall = Math.min(Math.max(need, viewport.height), 8000)
      if (tall > viewport.height + 40) {
        await page.setViewportSize({ width: viewport.width, height: tall })
        await page.waitForTimeout(200)
      }
      await page.screenshot({ path, fullPage: true }).catch(async () => { await page.screenshot({ path }) })
      if (tall > viewport.height + 40) await page.setViewportSize(viewport)
      return path
    },
    async log({ action, input = '', result, screenshot = '', extra }) {
      const line = {
        time: shanghaiIso(),
        人物: actor,
        手机号: maskPhone(phone),
        端: side,
        页面URL: page.url(),
        操作: action,
        输入: String(input).slice(0, 500),
        结果: String(result).slice(0, 800),
        页数: '',
        份数: '',
        金额: '',
        订单号: extra?.ref ?? '',
        截图: screenshot,
      }
      appendFileSync(join(EVID, 'flow.jsonl'), `${JSON.stringify(line)}\n`)
      console.log(`[${side}] ${action} → ${String(result).slice(0, 180)}`)
    },
    async goto(path) {
      await page.goto(origin + path, { waitUntil: 'domcontentloaded', timeout: 30000 })
      await page.waitForTimeout(500)
    },
    async clickNav(name, fallbackPath) {
      const link = page.getByRole('link', { name, exact: true }).first()
      if (await link.count()) {
        await link.click()
        await page.waitForTimeout(700)
        return
      }
      if (fallbackPath) await this.goto(fallbackPath)
    },
  }
}

async function agreeIfNeeded(page) {
  const agree = page.locator('button.c-agree')
  if (await agree.count() && (await agree.first().getAttribute('aria-checked')) !== 'true') {
    await agree.first().locator('.box').click()
  }
}

async function finishPhoneVerify(page, h, phoneHint) {
  const dialog = page.locator('[role=dialog][aria-label="手机号本人验证"]')
  if (!(await dialog.isVisible().catch(() => false))) return '无需验证'
  const visible = (await dialog.innerText()).replace(/\s+/g, ' ')
  const tail = phoneHint?.slice(-4) || visible.match(/1\d{2}\*+(\d{4})/)?.[1]
  const logLen = apiLogLength()
  const send = dialog.getByRole('button', { name: '获取验证码' })
  if (await send.count()) await send.click()
  let code = null
  for (let i = 0; i < 20 && !code && tail; i += 1) {
    await page.waitForTimeout(500)
    code = latestSmsCode(tail, logLen)
  }
  if (!code) {
    await dialog.getByRole('button', { name: '稍后验证' }).click().catch(() => {})
    await page.waitForTimeout(800)
    return `未读到验证码，已点稍后验证；弹窗=${visible.slice(0, 120)}`
  }
  const input = dialog.locator('input').first()
  await input.fill(code)
  await dialog.getByRole('button', { name: '确认验证' }).click()
  await page.waitForTimeout(1500)
  const still = await dialog.isVisible().catch(() => false)
  if (still) {
    await input.evaluate((el) => { el.value = '' }).catch(() => {})
    await dialog.getByRole('button', { name: '稍后验证' }).click().catch(() => {})
    return '验证未通过，已点稍后验证进入后台'
  }
  return '手机号本人验证完成'
}

async function newContext(browser, storagePath) {
  return browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    storageState: storagePath && existsSync(storagePath) ? storagePath : undefined,
  })
}

async function saveState(context, path) {
  await context.storageState({ path }).catch(() => {})
  try { chmodSync(path, 0o600) } catch { /* ignore */ }
}

export async function openAdmin() {
  const browser = await chromium.launch({ headless: true })
  const initial = existsSync(ADMIN_STATE_D2) ? ADMIN_STATE_D2 : (existsSync(ADMIN_STATE_SHARED) ? ADMIN_STATE_SHARED : undefined)
  const context = await newContext(browser, initial)
  const page = await context.newPage()
  page.setDefaultTimeout(20000)
  const h = createHelpers(page, { actor: '平台管理员', phone: '', side: '管理员后台', origin: ADMIN_ORIGIN })
  await h.goto('/')
  await Promise.race([
    page.locator('#admin-login-id').waitFor({ timeout: 12000 }),
    page.getByRole('heading', { name: '工作台' }).waitFor({ timeout: 12000 }),
  ]).catch(() => {})
  if (page.url().includes('/login') || (await page.locator('#admin-login-id').count())) {
    const { username, password } = readJsonSecret('admin.json')
    await page.locator('#admin-login-id').fill(username)
    await page.locator('#admin-password').fill(password)
    await agreeIfNeeded(page)
    await page.locator('form.c-pane button[type=submit], form button[type=submit]').first().click()
    await h.pause(1200)
    const verify = await finishPhoneVerify(page, h, '')
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15000 }).catch(() => {})
    await h.pause(800)
    const shot = await h.shot('admin-login')
    const ok = !page.url().includes('/login')
    await h.log({ action: '管理员登录', input: `账号 ${username}（密码略）`, result: ok ? `成功 ${verify}` : `失败：${(await h.text()).slice(0, 180)}`, screenshot: shot })
    if (!ok) throw new Error('管理员登录失败')
  } else {
    await h.log({ action: '管理员沿用登录态', result: `进入 ${new URL(page.url()).pathname}` })
  }
  return {
    browser,
    context,
    page,
    h,
    async close() {
      await saveState(context, ADMIN_STATE_D2)
      await context.close().catch(() => {})
      await browser.close().catch(() => {})
    },
  }
}

export async function openPartner(account) {
  const browser = await chromium.launch({ headless: true })
  const statePath = join(SECRET, `ui-state-d2-${account.key}.json`)
  const context = await newContext(browser, statePath)
  const page = await context.newPage()
  page.setDefaultTimeout(20000)
  const h = createHelpers(page, {
    actor: account.accountName,
    phone: account.phone,
    side: '机构后台',
    origin: PARTNER_ORIGIN,
  })
  await h.goto('/')
  await Promise.race([
    page.locator('#partner-login-id').waitFor({ timeout: 12000 }),
    page.getByRole('heading', { name: '工作台' }).waitFor({ timeout: 12000 }),
  ]).catch(() => {})
  if (page.url().includes('/login') || (await page.locator('#partner-login-id').count())) {
    await h.goto('/login')
    await page.locator('#partner-login-id').fill(account.username)
    await page.locator('#partner-password').fill(account.initialPassword)
    await agreeIfNeeded(page)
    await page.locator('form button[type=submit]').first().click()
    await h.pause(1200)
    const verify = await finishPhoneVerify(page, h, account.phone)
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15000 }).catch(() => {})
    await h.pause(800)
    const shot = await h.shot(`partner-login-${account.key}`)
    const ok = !page.url().includes('/login')
    await h.log({
      action: '机构后台登录',
      input: `${account.orgName} 账号 ${account.username}（密码略）`,
      result: ok ? `成功，${verify}` : `失败：${(await h.text()).replace(/\s+/g, ' ').slice(0, 220)}；网络=${JSON.stringify(h.netErrors().slice(-3))}`,
      screenshot: shot,
    })
    if (!ok) throw new Error(`机构登录失败 ${account.key}`)
  }
  return {
    browser,
    context,
    page,
    h,
    async close() {
      await saveState(context, statePath)
      await context.close().catch(() => {})
      await browser.close().catch(() => {})
    },
  }
}
