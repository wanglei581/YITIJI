// 走查（平台管理员 + 合作机构人员）步骤运行器。
// 连接到已开的无头 Chromium（CDP 127.0.0.1:9333），按「端」复用同一个页签，
// 执行一个步骤文件（默认导出 async ({ page, h }) => {...}），步骤里只做点击/输入。
// 用法：node scripts/walkthrough/setup/run.mjs <步骤文件> [端=admin|partner|partnerB]
// 只用于本地全功能走查；截图与操作日志写到 ~/.cache/walk0929/evidence/setup/。
import { createRequire } from 'node:module'
import { appendFileSync, readFileSync, existsSync, writeFileSync, chmodSync, mkdirSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '../../..')
const require = createRequire(join(repo, 'apps/kiosk/package.json'))
const { chromium } = require('@playwright/test')

const ROOT = join(homedir(), '.cache/walk0929')
const EVID = join(ROOT, 'evidence/setup')
const SECRET = join(ROOT, 'secret')
mkdirSync(EVID, { recursive: true })

const ORIGINS = { admin: 'http://127.0.0.1:4320', partner: 'http://127.0.0.1:4330', partnerB: 'http://127.0.0.1:4330' }
const ACTORS = { admin: '平台管理员', partner: '合作机构A人员', partnerB: '合作机构B人员' }
const DUAN = { admin: '管理员后台', partner: '合作机构后台', partnerB: '合作机构后台' }

const [stepFile, side = 'admin'] = process.argv.slice(2)
if (!stepFile) { console.error('用法：run.mjs <step> [admin|partner|partnerB]'); process.exit(64) }

function nowSh() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).replace(' ', 'T') + '+08:00'
}

const browser = await chromium.connectOverCDP('http://127.0.0.1:9333')
// 每个「端」一个独立上下文（机构 A、B 登录态互不干扰）；上下文用 storageState 文件跨运行保存。
const statePath = join(SECRET, `ui-state-${side}.json`)
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  locale: 'zh-CN',
  timezoneId: 'Asia/Shanghai',
  storageState: existsSync(statePath) ? statePath : undefined,
})
const page = await context.newPage()

const netLog = []
page.on('response', async (r) => {
  const u = r.url()
  if (!u.includes('/api/')) return
  const entry = { method: r.request().method(), url: u.replace(/^https?:\/\/[^/]+/, ''), status: r.status() }
  if (r.status() >= 400) {
    try { entry.body = (await r.text()).slice(0, 800) } catch { /* ignore */ }
  }
  netLog.push(entry)
})
const consoleErrors = []
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)) })
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + String(e).slice(0, 300)))

let shotSeq = 0
const seqFile = join(EVID, '.seq')
function nextSeq() {
  const n = existsSync(seqFile) ? Number(readFileSync(seqFile, 'utf8')) + 1 : 1
  writeFileSync(seqFile, String(n))
  return String(n).padStart(2, '0')
}

const h = {
  origin: ORIGINS[side],
  side,
  secretDir: SECRET,
  evidDir: EVID,
  readSecret(name) { return JSON.parse(readFileSync(join(SECRET, name), 'utf8')) },
  writeSecret(name, content) {
    const p = join(SECRET, name)
    writeFileSync(p, typeof content === 'string' ? content : JSON.stringify(content, null, 2), { mode: 0o600 })
    chmodSync(p, 0o600)
    return p
  },
  async shot(slug) {
    const p = join(EVID, `${nextSeq()}-${slug}.png`)
    shotSeq++
    // 后台布局是内部滚动容器，fullPage 截不到下半截：临时把视口拉高到最高滚动容器的高度再截。
    const vp = page.viewportSize() ?? { width: 1440, height: 900 }
    const need = await page.evaluate(() => {
      let max = document.documentElement.scrollHeight
      for (const el of document.querySelectorAll('main, [class*="overflow-y-auto"], [class*="overflow-auto"]')) {
        const extra = el.scrollHeight - el.clientHeight
        if (extra > 0) max = Math.max(max, window.innerHeight + extra)
      }
      return max
    }).catch(() => vp.height)
    const tall = Math.min(Math.max(need, vp.height), 7000)
    if (tall > vp.height) { await page.setViewportSize({ width: vp.width, height: tall }); await page.waitForTimeout(250) }
    await page.screenshot({ path: p, fullPage: true }).catch(async () => { await page.screenshot({ path: p }) })
    if (tall > vp.height) await page.setViewportSize(vp)
    return p
  },
  async text(sel = 'body') { return (await page.locator(sel).first().innerText().catch(() => '')).trim() },
  net() { return netLog.slice() },
  netErrors() { return netLog.filter((e) => e.status >= 400) },
  clearNet() { netLog.length = 0 },
  consoleErrors() { return consoleErrors.slice() },
  async log({ action, input = '', result, screenshot = '', extra }) {
    const line = { time: nowSh(), actor: ACTORS[side], 端: DUAN[side], url: page.url(), action, input, result, screenshot }
    if (extra) line.extra = extra
    appendFileSync(join(EVID, 'flow.jsonl'), JSON.stringify(line) + '\n')
    console.log('[LOG]', action, '→', result, screenshot ? `(${screenshot})` : '')
  },
  async goto(path) { await page.goto(ORIGINS[side] + path, { waitUntil: 'networkidle' }).catch(() => {}); await page.waitForTimeout(400) },
  async settle(ms = 600) { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(ms) },
}

let exitCode = 0
try {
  const mod = await import(pathToFileURL(resolve(stepFile)).href)
  await mod.default({ page, h, context })
} catch (e) {
  exitCode = 1
  console.error('STEP ERROR:', e?.message ?? e)
  try {
    const p = await h.shot('error-' + side)
    await h.log({ action: '步骤异常', result: '失败：' + String(e?.message ?? e).slice(0, 300), screenshot: p, extra: { netErrors: h.netErrors().slice(-5), visible: (await h.text()).slice(0, 600) } })
  } catch { /* ignore */ }
} finally {
  const errs = netLog.filter((e) => e.status >= 400)
  if (errs.length) console.log('NET>=400:', JSON.stringify(errs.slice(-8), null, 1))
  if (consoleErrors.length) console.log('CONSOLE ERR:', consoleErrors.slice(-5).join('\n'))
  await context.storageState({ path: statePath }).catch(() => {})
  try { chmodSync(statePath, 0o600) } catch { /* ignore */ }
  await context.close().catch(() => {})
  process.exit(exitCode)
}
