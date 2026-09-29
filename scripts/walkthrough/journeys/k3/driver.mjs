// K3 走查驱动：常驻一个无头 Chromium，按「端」各开一个上下文（一体机 1080×1920、手机 390×844、
// 管理员、机构 A、机构 B），在 127.0.0.1:4393 收「跑这个步骤文件」的请求。
// 步骤文件默认导出 async ({ P, h, ctx }) => 结果；P.kiosk / P.phone / P.admin / P.partnerA / P.partnerB 是页签。
// 只用于本地全功能走查；截图与流水写 ~/.cache/walk0929/evidence/k3/。
import { createRequire } from 'node:module'
import http from 'node:http'
import { appendFileSync, readFileSync, existsSync, writeFileSync, mkdirSync, statSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '../../../..')
const require = createRequire(join(repo, 'apps/kiosk/package.json'))
const { chromium } = require('@playwright/test')

const ROOT = join(homedir(), '.cache/walk0929')
const EVID = join(ROOT, 'evidence/k3')
const SECRET = join(ROOT, 'secret')
const API_LOG = join(ROOT, 'logs/api.log')
mkdirSync(EVID, { recursive: true })

const nowSh = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).replace(' ', 'T') + '+08:00'

const browser = await chromium.launch({ headless: true })
const base = { locale: 'zh-CN', timezoneId: 'Asia/Shanghai' }
const specs = {
  kiosk: { ...base, viewport: { width: 1080, height: 1920 } },
  phone: { ...base, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  admin: { ...base, viewport: { width: 1440, height: 900 }, storageState: join(SECRET, 'ui-state-admin.json') },
  partnerA: { ...base, viewport: { width: 1440, height: 900 }, storageState: join(SECRET, 'ui-state-partner.json') },
  partnerB: { ...base, viewport: { width: 1440, height: 900 }, storageState: join(SECRET, 'ui-state-partnerB.json') },
}
const ctx = {}
const P = {}
const net = {}
const cons = {}
async function openSide(side) {
  if (ctx[side]) await ctx[side].close().catch(() => {})
  const s = { ...specs[side] }
  if (s.storageState && !existsSync(s.storageState)) delete s.storageState
  ctx[side] = await browser.newContext(s)
  const page = await ctx[side].newPage()
  net[side] = []; cons[side] = []
  page.on('response', async (r) => {
    const u = r.url()
    if (!u.includes('/api/')) return
    const e = { t: nowSh(), method: r.request().method(), url: u.replace(/^https?:\/\/[^/]+/, ''), status: r.status() }
    if (r.status() >= 400) { try { e.body = (await r.text()).slice(0, 600) } catch {} }
    net[side].push(e)
    if (net[side].length > 2000) net[side].splice(0, 1000)
  })
  page.on('console', (m) => { if (m.type() === 'error') cons[side].push(m.text().slice(0, 300)) })
  page.on('pageerror', (e) => cons[side].push('pageerror: ' + String(e).slice(0, 300)))
  page.on('dialog', (d) => { cons[side].push('dialog: ' + d.message()); d.accept().catch(() => {}) })
  P[side] = page
  return page
}
for (const s of Object.keys(specs)) await openSide(s)

const seqFile = join(EVID, '.seq')
function nextSeq() {
  const n = existsSync(seqFile) ? Number(readFileSync(seqFile, 'utf8')) + 1 : 1
  writeFileSync(seqFile, String(n))
  return String(n).padStart(3, '0')
}
const h = {
  EVID, SECRET, API_LOG, nowSh, openSide, net, cons,
  readSecret(name) { return JSON.parse(readFileSync(join(SECRET, name), 'utf8')) },
  async shot(page, slug, opts = {}) {
    const p = join(EVID, `${nextSeq()}-${slug}.png`)
    await page.screenshot({ path: p, fullPage: opts.fullPage ?? false }).catch(async () => { await page.screenshot({ path: p }).catch(() => {}) })
    return p
  },
  async tallShot(page, slug) {
    const p = join(EVID, `${nextSeq()}-${slug}.png`)
    const vp = page.viewportSize()
    const need = await page.evaluate(() => {
      let max = document.documentElement.scrollHeight
      for (const el of document.querySelectorAll('main, [class*="overflow-y-auto"], [class*="overflow-auto"]')) {
        const extra = el.scrollHeight - el.clientHeight
        if (extra > 0) max = Math.max(max, window.innerHeight + extra)
      }
      return max
    }).catch(() => vp.height)
    const tall = Math.min(Math.max(need, vp.height), 7000)
    if (tall > vp.height) { await page.setViewportSize({ width: vp.width, height: tall }); await page.waitForTimeout(300) }
    await page.screenshot({ path: p, fullPage: true }).catch(() => {})
    if (tall > vp.height) await page.setViewportSize(vp)
    return p
  },
  log(entry) {
    const line = { time: nowSh(), ...entry }
    appendFileSync(join(EVID, 'ledger.jsonl'), JSON.stringify(line) + '\n')
    return line
  },
  async text(page, sel = 'body') { return (await page.locator(sel).first().innerText({ timeout: 3000 }).catch(() => '')).trim() },
  apiLogLen() { return statSync(API_LOG).size },
  smsCode(tail4, afterLen = 0) {
    const buf = readFileSync(API_LOG)
    const txt = buf.subarray(afterLen).toString('utf8')
    const re = new RegExp(`\\[DEV 短信\\][^\\n]*${tail4}[^\\n]*验证码[:：]\\s*(\\d{4,6})`, 'g')
    let m, code = null
    while ((m = re.exec(txt))) code = m[1]
    return code
  },
  async waitSms(tail4, afterLen, ms = 12000) {
    const t0 = Date.now()
    while (Date.now() - t0 < ms) { const c = h.smsCode(tail4, afterLen); if (c) return c; await new Promise((r) => setTimeout(r, 400)) }
    return null
  },
  netSince(side, n) { return net[side].slice(n) },
  netErr(side, n = 0) { return net[side].slice(n).filter((e) => e.status >= 400) },
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  state: {},
}

const server = http.createServer(async (req, res) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', async () => {
    const out = { ok: true }
    const logs = []
    const origLog = console.log
    console.log = (...a) => { logs.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); origLog(...a) }
    try {
      const { file } = JSON.parse(body || '{}')
      const mod = await import(pathToFileURL(resolve(file)).href + '?t=' + Date.now())
      out.result = await mod.default({ P, h, ctx })
    } catch (e) {
      out.ok = false
      out.error = String(e?.stack ?? e).slice(0, 2000)
    } finally {
      console.log = origLog
    }
    out.logs = logs
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(out, null, 1))
  })
})
server.listen(4393, '127.0.0.1', () => console.log('k3 driver on 4393 pid', process.pid))
writeFileSync(join(EVID, '.driver.pid'), String(process.pid))
