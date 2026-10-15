/**
 * 数据集 v2 D4：时钟偏移回放（方案 A）+ 今天的补充。
 *
 * 只走正常接口，不写库。停进程只按 PID。
 * 不打印终端令牌、会话令牌、绑定码、短信验证码、到机码、JWT、签名 URL。
 *
 *   node scripts/walkthrough/dataset/d4-replay.mjs plan
 *   node scripts/walkthrough/dataset/d4-replay.mjs sample
 *   node scripts/walkthrough/dataset/d4-replay.mjs rest
 *   node scripts/walkthrough/dataset/d4-replay.mjs today
 *   node scripts/walkthrough/dataset/d4-replay.mjs shots
 */
import { createHash, randomUUID } from 'node:crypto'
import { spawn, execFileSync } from 'node:child_process'
import {
  appendFileSync, chmodSync, closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync,
  rmSync, writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '../../..')
const CACHE = join(homedir(), '.cache/walk0929')
const EVIDENCE = join(CACHE, 'evidence/dataset-d4')
const LEDGER = join(HERE, 'replay-ledger.jsonl')
const SECRET = join(CACHE, 'secret')
const PICKUPS = join(SECRET, 'd4-pickup-codes.jsonl')
const MANIFEST = join(CACHE, 'dataset/files/manifest.json')
const API_DIR = '/Users/wanglei/AI求职打印服务终端/.claude/worktrees/youthful-jang-8df61d/services/api'
const CLOCK = join(HERE, 'clock-shift.cjs')
const TMP_AGENT = join(CACHE, 'sim-agent-d4-tmp')
const TMP_BRIDGE = 4361
const API_4301 = 'http://127.0.0.1:4301/api/v1'
const API_4300 = 'http://127.0.0.1:4300/api/v1'
const LOG_4301 = join(CACHE, 'logs/api-4301.log')
const REPLAY_LOG = join(EVIDENCE, 'replay.log')

const SITES = [
  { code: 'WALK-002', siteId: 'gig-home', bridge: 4352, dir: join(CACHE, 'sim-agent-002'), shares: { early: 0.6, morning: 0.25, afternoon: 0.15 }, base: [12, 7] },
  { code: 'WALK-003', siteId: 'campus', bridge: 4353, dir: join(CACHE, 'sim-agent-003'), shares: { early: 0.05, morning: 0.45, afternoon: 0.5 }, base: [9, 5] },
  { code: 'WALK-004', siteId: 'community', bridge: 4354, dir: join(CACHE, 'sim-agent-004'), shares: { early: 0.05, morning: 0.2, afternoon: 0.75 }, base: [8, 5] },
  { code: 'WALK-001', siteId: 'service-hall', bridge: 4350, dir: join(CACHE, 'sim-agent'), shares: { early: 0.05, morning: 0.7, afternoon: 0.25 }, base: [14, 6] },
]
const WAVE_AT = { early: '07:20:00', morning: '09:40:00', afternoon: '14:40:00', evening: '23:20:00' }
const PRINT_PARAMS = {
  copies: 1, colorMode: 'black_white', duplex: 'simplex', paperSize: 'A4',
  orientation: 'portrait', quality: 'standard', scale: 'fit', pagesPerSheet: 1,
}
const DECL = {
  'x-age-14-plus': 'declared',
  'x-age-14-plus-version': 'kiosk-2026-09',
  'x-voice-recording': 'granted',
  'x-voice-recording-version': 'kiosk-2026-09',
}

const personasDoc = JSON.parse(readFileSync(join(HERE, 'personas.json'), 'utf8'))
const personas = personasDoc.personas
const bySite = new Map(SITES.map((s) => [s.code, personas.filter((p) => p.siteId === s.siteId)]))

let apiBase = API_4301
let paused = null
let apiPid = null
let apiPidOwned = false
let tempPid = null
let aiClosed = null
let printerDir = TMP_AGENT
let frozenPid = null
const paceMarks = new Map()
const memberTokens = new Map()

function log(line) {
  const text = `${new Date().toISOString()} ${line}`
  process.stdout.write(`${text}\n`)
  try { appendFileSync(REPLAY_LOG, `${text}\n`) } catch { /* evidence dir created later */ }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }

function maskPhone(phone) { return `${String(phone).slice(0, 3)}****${String(phone).slice(-4)}` }

/**
 * 短信日志按「这个号码已经出现过几次」取新码，不拿文件偏移去 slice。
 * 上一轮用 Buffer.length（字节）当字符串下标，中文日志会把下标推到文件末尾之后，验证码明明写进去了也读不到。
 * 日志原文是「验证码: 123456(仅开发…」，码和括号之间没有空格，正则只吃 6 位数字。
 */
function smsMatches(phone) {
  if (!existsSync(LOG_4301)) return []
  const masked = maskPhone(phone).replace(/\*/g, '\\*')
  const re = new RegExp(`${masked} 验证码: (\\d{6})`, 'g')
  return [...readFileSync(LOG_4301, 'utf8').matchAll(re)].map((m) => m[1])
}

function localDate() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

function redact(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '')
  return text
    .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[jwt]')
    .replace(/("(?:token|bootTicket|bindCode|signedUrl|authorization|terminalToken|sessionToken|accessToken|paymentSessionToken|code|password|pickupCode|sig)"\s*:\s*")[^"]*/gi, '$1[redacted]')
    .replace(/验证码:\s*\d{4,8}/g, '验证码:[redacted]')
    .replace(/1[3-9]\d{9}/g, (m) => maskPhone(m))
}

function dataOf(payload) {
  if (payload && typeof payload === 'object' && payload.success === true && 'data' in payload) return payload.data
  return payload
}

function pick(payload, key) {
  if (payload && payload[key] != null) return payload[key]
  const data = payload?.data
  if (data && data[key] != null) return data[key]
  return undefined
}

function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hashSeed(text) {
  let h = 2166136261
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  return h >>> 0
}

function weekend(date) {
  const day = new Date(`${date}T12:00:00+08:00`).getUTCDay()
  return day === 0 || day === 6
}

function datesBetween(from, to) {
  const out = []
  const cur = new Date(`${from}T12:00:00+08:00`)
  const end = new Date(`${to}T12:00:00+08:00`)
  while (cur.getTime() <= end.getTime()) {
    const y = cur.getUTCFullYear()
    const m = String(cur.getUTCMonth() + 1).padStart(2, '0')
    const d = String(cur.getUTCDate()).padStart(2, '0')
    out.push(`${y}-${m}-${d}`)
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
  return out
}

function minimalPdf(text) {
  const safe = String(text).replace(/[()\\]/g, ' ')
  const stream = `BT /F1 18 Tf 72 720 Td (${safe}) Tj ET\n`
  const objects = [
    '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n',
    '2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n',
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n',
    `4 0 obj<</Length ${Buffer.byteLength(stream)}>>stream\n${stream}endstream\nendobj\n`,
    '5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n',
  ]
  let body = '%PDF-1.4\n'
  const offsets = [0]
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(body))
    body += obj
  }
  const xrefAt = Buffer.byteLength(body)
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (let i = 1; i < offsets.length; i += 1) xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
  return Buffer.from(`${body + xref}trailer<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xrefAt}\n%%EOF\n`)
}

let catalog = []
function loadCatalog() {
  if (catalog.length) return catalog
  try {
    const doc = JSON.parse(readFileSync(MANIFEST, 'utf8'))
    catalog = doc.files ?? []
  } catch {
    catalog = []
  }
  return catalog
}

function bytesFor(persona, rng) {
  const printable = new Set(['pdf', 'png', 'jpg', 'jpeg'])
  const own = loadCatalog().filter((f) => f.ownerId === persona.id && printable.has(f.format) && !/身份证/.test(f.path))
  const resumes = own.filter((f) => /简历|扫描|证书|合同|照片/.test(f.path))
  const pool = resumes.length ? resumes : own
  const file = pool.length ? pool[Math.floor(rng() * pool.length)] : null
  if (!file) {
    return { bytes: minimalPdf('walk-in'), name: `${persona.name}-现场登记.pdf`, mime: 'application/pdf', format: 'pdf' }
  }
  const abs = join(dirname(MANIFEST), file.path)
  const mime = file.format === 'png' ? 'image/png' : file.format === 'pdf' ? 'application/pdf' : 'image/jpeg'
  return { bytes: readFileSync(abs), name: file.path.split('/').pop(), mime, format: file.format }
}

function ledger(row) {
  mkdirSync(dirname(LEDGER), { recursive: true })
  const safe = { ...row }
  delete safe.phone
  delete safe.pickupCode
  delete safe.token
  appendFileSync(LEDGER, `${JSON.stringify(safe)}\n`)
}

function lastLedger(key) {
  if (!existsSync(LEDGER)) return null
  let last = null
  for (const line of readFileSync(LEDGER, 'utf8').split('\n')) {
    if (!line.trim()) continue
    let row
    try { row = JSON.parse(line) } catch { continue }
    if (row.key === key) last = row
  }
  return last
}

function seenKeys() {
  if (!existsSync(LEDGER)) return new Set()
  const done = new Set()
  for (const line of readFileSync(LEDGER, 'utf8').split('\n')) {
    if (!line.trim()) continue
    let row
    try { row = JSON.parse(line) } catch { continue }
    if (!row.key) continue
    // 手机下单 / 代取 / 过期单若没建成（短信读码失败），同一条计划再跑一次。
    if (row.outcome === 'error' && String(row.action || '').startsWith('cloud-')) continue
    done.add(row.key)
  }
  return done
}

function savePickup(row) {
  mkdirSync(SECRET, { recursive: true })
  appendFileSync(PICKUPS, `${JSON.stringify(row)}\n`, { mode: 0o600 })
  chmodSync(PICKUPS, 0o600)
}

function buildSchedule(from, to) {
  const rng = mulberry32(hashSeed('d4-v2-schedule'))
  const events = []
  const aiUsed = new Set()
  for (const date of datesBetween(from, to)) {
    const we = weekend(date)
    for (const site of SITES) {
      const base = we ? site.base[1] : site.base[0]
      const jitter = Math.floor(rng() * 5) - 2
      const total = Math.max(5, Math.min(40, base + jitter))
      const keys = ['early', 'morning', 'afternoon']
      const raw = keys.map((k) => total * site.shares[k])
      const counts = raw.map((n) => Math.floor(n))
      let left = total - counts.reduce((a, b) => a + b, 0)
      const order = raw.map((n, i) => [n - counts[i], i]).sort((a, b) => b[0] - a[0])
      for (let i = 0; i < left; i += 1) counts[order[i % order.length][1]] += 1
      const people = bySite.get(site.code) ?? []
      keys.forEach((wave, wi) => {
        for (let seq = 0; seq < counts[wi]; seq += 1) {
          const persona = people[Math.floor(rng() * people.length)] ?? people[0]
          const roll = rng()
          let planned = 'success'
          if (roll < 0.08) planned = 'fail'
          else if (roll < 0.18) planned = 'abandon'
          else if (roll < 0.23) planned = 'expire'
          if (planned === 'success' && persona?.habits?.leaveMidwayProbability >= 0.4 && rng() < 0.25) planned = 'abandon'
          if (planned === 'expire' && !persona?.isMember) planned = 'success'
          const failMode = ['paper_empty', 'jam', 'unconfirmed'][Math.floor(rng() * 3)]
          const abandonAt = rng() < 0.5 ? 'upload' : 'quote'
          let ai = null
          const features = (persona?.features ?? []).join(' ')
          const aiPerson = /AI|模拟面试/.test(features)
          const aiKey = `${date}|${persona?.id}`
          if (planned === 'success' && aiPerson && !aiUsed.has(aiKey) && rng() < 0.3) {
            aiUsed.add(aiKey)
            const options = []
            if (features.includes('诊断')) options.push('diagnose')
            if (features.includes('优化')) options.push('optimize')
            if (features.includes('模拟面试')) options.push('interview')
            options.push('chat')
            ai = { kind: options[Math.floor(rng() * options.length)], fault: rng() < 0.03 ? 'timeout' : null }
          }
          events.push({
            key: `${date}|${wave}|${site.code}|${seq}`,
            date, wave, site: site.code, personaId: persona.id, name: persona.name,
            action: planned === 'expire' ? 'cloud-expire' : 'visit',
            planned, printer: planned === 'fail' ? failMode : 'ready',
            abandonAt, ai, copies: persona.id === 'p601' ? 3 : (site.code === 'WALK-003' && rng() < 0.25 ? 2 : 1),
            feedback: planned === 'success' && rng() < 0.15,
            favorite: persona.isMember && features.includes('政策') && rng() < 0.2,
          })
        }
      })
    }
  }
  if (from <= '2026-09-28' && to >= '2026-09-28') {
    events.push({
      key: '2026-09-28|evening|WALK-001|nextday',
      date: '2026-09-28', wave: 'evening', site: 'WALK-001', personaId: 'p602', name: '欧阳春梅',
      action: 'cloud-nextday', planned: 'expire', printer: 'ready', copies: 1,
    })
    events.push({
      key: '2026-09-28|evening|WALK-004|family',
      date: '2026-09-28', wave: 'evening', site: 'WALK-004', personaId: 'family-zhoubo', name: '周博',
      action: 'cloud-family', planned: 'expire', printer: 'ready', copies: 1,
      claimerId: 'p624',
    })
  }
  return events
}

function summarize(events) {
  const by = new Map()
  for (const ev of events) {
    const k = `${ev.date}|${ev.site}`
    if (!by.has(k)) by.set(k, { date: ev.date, site: ev.site, n: 0, success: 0, fail: 0, abandon: 0, expire: 0 })
    const row = by.get(k)
    row.n += 1
    const bucket = ev.action === 'visit' ? ev.planned : 'expire'
    row[bucket] += 1
  }
  return [...by.values()]
}

class HttpError extends Error {
  constructor(status, body, path) {
    super(`${status} ${path} ${redact(body).slice(0, 400)}`)
    this.status = status
    this.body = body
  }
}

async function pace(bucket, limit) {
  const now = Date.now()
  const marks = (paceMarks.get(bucket) ?? []).filter((t) => now - t < 60_000)
  if (marks.length >= limit) {
    const wait = 60_000 - (now - marks[0]) + 250
    log(`pace ${bucket} wait ${wait}ms`)
    await sleep(wait)
    return pace(bucket, limit)
  }
  marks.push(Date.now())
  paceMarks.set(bucket, marks)
}

async function api(path, { method = 'GET', headers = {}, body, form, paceKey, paceLimit } = {}) {
  if (paceKey) await pace(paceKey, paceLimit)
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const init = { method, headers: { ...headers } }
    if (form) init.body = form
    else if (body !== undefined) {
      init.headers['content-type'] = 'application/json'
      init.body = JSON.stringify(body)
    }
    const res = await fetch(`${apiBase}${path}`, init)
    const text = await res.text()
    if (res.status === 429) {
      const retry = Number(res.headers.get('retry-after'))
      const wait = Number.isFinite(retry) && retry > 0 && retry < 180 ? retry * 1000 : 61_000
      log(`429 ${method} ${path} wait ${wait}ms`)
      await sleep(wait)
      continue
    }
    let json = null
    try { json = text ? JSON.parse(text) : null } catch { json = { raw: text.slice(0, 200) } }
    if (!res.ok) throw new HttpError(res.status, json ?? text, `${method} ${path}`)
    return json
  }
  throw new Error(`429 persisted ${method} ${path}`)
}

function listeners(port) {
  try {
    return execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' })
      .trim().split('\n').filter(Boolean)
  } catch {
    return []
  }
}

function commandOf(pid) {
  return execFileSync('ps', ['-ww', '-p', String(pid), '-o', 'command='], { encoding: 'utf8' }).trim()
}

function cwdOf(pid) {
  const out = execFileSync('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], { encoding: 'utf8' })
  const line = out.split('\n').find((l) => l.startsWith('n'))
  return line ? line.slice(1) : null
}

function simDirOf(pid, fallback) {
  const out = execFileSync('ps', ['eww', '-p', String(pid), '-o', 'command='], { encoding: 'utf8' })
  const match = out.match(/SIM_AGENT_DIR=(\S+)/)
  return match ? match[1] : fallback
}

async function waitDead(pid, ms = 6000) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    try { process.kill(Number(pid), 0) } catch { return }
    await sleep(200)
  }
  try { process.kill(Number(pid), 'SIGKILL') } catch { /* already gone */ }
  await sleep(200)
}

function spawnDetached(argv, { cwd, env, logPath }) {
  mkdirSync(dirname(logPath), { recursive: true })
  const fd = openSync(logPath, 'a')
  const child = spawn(argv[0], argv.slice(1), {
    cwd, env, detached: true, stdio: ['ignore', fd, fd],
  })
  child.on('error', (err) => {
    try { appendFileSync(logPath, `spawn error: ${err.message}\n`) } catch { /* 日志没打开 */ }
  })
  child.unref()
  try { closeSync(fd) } catch { /* parent does not keep the log open */ }
  return child.pid
}

function pidAlive(pid) {
  try { process.kill(Number(pid), 0); return true } catch { return false }
}

function secretPath(code) { return join(SECRET, `d4-agent-cmd-${code}.json`) }

function bridgeOf(code) {
  return SITES.find((s) => s.code === code)?.bridge
}

function assertLiveAgent(site, label) {
  const pids = listeners(site.bridge)
  if (pids.length !== 1) throw new Error(`${label} ${site.code} 网桥 ${site.bridge} 监听数=${pids.length}`)
  const cmd = commandOf(pids[0])
  if (!cmd.includes('sim-agent.mjs') || !cmd.includes(`--bridge-port ${site.bridge}`) || !cmd.includes('--api http://127.0.0.1:4300/')) {
    throw new Error(`${label} ${site.code} 在听的不是连 4300 的模拟终端`)
  }
  log(`${label} ${site.code} 网桥 ${site.bridge} 在听 pid ${pids[0]}`)
  return pids[0]
}

function thawFrozen() {
  if (!frozenPid) return
  try { process.kill(frozenPid, 'SIGCONT') } catch { /* 进程已不在 */ }
  log(`断网结束 SIGCONT pid ${frozenPid}`)
  frozenPid = null
}

function releaseStaleAgentLock(simDir, bridgePort) {
  const runPath = join(simDir, 'run.json')
  if (!existsSync(runPath)) return
  let run
  try { run = JSON.parse(readFileSync(runPath, 'utf8')) } catch { return }
  const pid = Number(run?.pid)
  if (!Number.isInteger(pid) || pid <= 0) return
  if (listeners(bridgePort).includes(String(pid))) return
  let cmd = ''
  if (pidAlive(pid)) {
    try { cmd = commandOf(pid) } catch { cmd = '' }
    if (cmd.includes('sim-agent.mjs') && cmd.includes(`--bridge-port ${bridgePort}`)) return
  }
  writeFileSync(runPath, `${JSON.stringify({ ...run, pid: null })}\n`, { mode: 0o600 })
  log(`cleared stale run lock bridge ${bridgePort}`)
}

async function pauseLive(site) {
  const pid = assertLiveAgent(site, '回放前')
  const cmd = commandOf(pid)
  const saved = {
    code: site.code,
    pid: Number(pid),
    argv: cmd.split(' ').filter(Boolean),
    cwd: cwdOf(pid),
    simDir: simDirOf(pid, site.dir),
  }
  if (saved.argv.length < 4 || !saved.cwd) throw new Error(`${site.code} 无法可靠恢复，已中止且未发信号`)
  mkdirSync(SECRET, { recursive: true })
  const path = secretPath(site.code)
  writeFileSync(path, `${JSON.stringify(saved)}\n`, { mode: 0o600 })
  chmodSync(path, 0o600)
  if (site.code === 'WALK-001') {
    mkdirSync(EVIDENCE, { recursive: true })
    appendFileSync(join(EVIDENCE, 'NOTICE.txt'), `WALK-001 回放中，暂停实时 Agent 起止时间\n开始：${new Date().toISOString()}\n`)
  }
  process.kill(Number(pid), 'SIGTERM')
  await waitDead(pid)
  paused = path
  log(`paused ${site.code}`)
}

async function restoreLive(path = paused) {
  if (!path || !existsSync(path)) return
  const saved = JSON.parse(readFileSync(path, 'utf8'))
  const bridge = bridgeOf(saved.code)
  if (!bridge) throw new Error(`${saved.code} 没有网桥端口`)
  const already = listeners(bridge)
  if (already.length === 1 && commandOf(already[0]).includes('sim-agent.mjs') && commandOf(already[0]).includes('--api http://127.0.0.1:4300/')) {
    if (saved.code === 'WALK-001') appendFileSync(join(EVIDENCE, 'NOTICE.txt'), `结束：${new Date().toISOString()}\n`)
    if (paused === path) paused = null
    log(`restored ${saved.code}（网桥已在听，不再另起）`)
    return
  }
  releaseStaleAgentLock(saved.simDir, bridge)
  const freeDeadline = Date.now() + 8_000
  while (listeners(bridge).length > 0 && Date.now() < freeDeadline) await sleep(200)
  const cwd = existsSync(saved.cwd) ? saved.cwd : ROOT
  if (cwd !== saved.cwd) log(`${saved.code} 原工作目录已不在，改在当前仓库恢复`)
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    LANG: process.env.LANG || 'C.UTF-8',
    SIM_AGENT_DIR: saved.simDir,
  }
  const argv = saved.argv[0] === 'node' || !existsSync(saved.argv[0])
    ? [process.execPath, ...saved.argv.slice(1)]
    : saved.argv
  saved.cwd = cwd
  const logPath = join(CACHE, 'logs', `sim-agent-restore-${saved.code}.log`)
  const spawnOnce = () => spawnDetached(argv, { cwd, env, logPath })
  let restoredPid = spawnOnce()
  const deadline = Date.now() + 25_000
  let up = false
  let retried = false
  while (Date.now() < deadline) {
    const listening = listeners(bridge)
    if (!pidAlive(restoredPid) && listening.length === 0) {
      if (!retried) {
        retried = true
        releaseStaleAgentLock(saved.simDir, bridge)
        await sleep(500)
        restoredPid = spawnOnce()
        continue
      }
      let tail = ''
      try { tail = readFileSync(logPath, 'utf8').slice(-400) } catch { /* 没有日志 */ }
      throw new Error(`${saved.code} 恢复进程马上退出 ${redact(tail).slice(0, 180)}`)
    }
    if (listening.length === 1 && commandOf(listening[0]).includes('sim-agent.mjs')) { up = true; break }
    await sleep(400)
  }
  if (!up) throw new Error(`${saved.code} 实时 Agent 没有按原命令恢复`)
  if (saved.code === 'WALK-001') {
    appendFileSync(join(EVIDENCE, 'NOTICE.txt'), `结束：${new Date().toISOString()}\n`)
  }
  if (paused === path) paused = null
  log(`restored ${saved.code}`)
}

async function stopTemp() {
  if (!tempPid) {
    const pids = listeners(TMP_BRIDGE)
    tempPid = pids[0] ? Number(pids[0]) : null
  }
  if (!tempPid) return
  let cmd = ''
  try { cmd = commandOf(tempPid) } catch { tempPid = null; return }
  if (!cmd.includes('sim-agent.mjs') || !cmd.includes(`--bridge-port ${TMP_BRIDGE}`)) {
    throw new Error(`拒绝停止临时 Agent pid ${tempPid}`)
  }
  try { process.kill(tempPid, 'SIGTERM') } catch { /* gone */ }
  await waitDead(tempPid)
  tempPid = null
}

async function startTemp(site) {
  await stopTemp()
  rmSync(TMP_AGENT, { recursive: true, force: true })
  mkdirSync(TMP_AGENT, { recursive: true })
  copyFileSync(join(site.dir, 'credential.json'), join(TMP_AGENT, 'credential.json'))
  chmodSync(join(TMP_AGENT, 'credential.json'), 0o600)
  if (existsSync(join(site.dir, 'device.json'))) copyFileSync(join(site.dir, 'device.json'), join(TMP_AGENT, 'device.json'))
  writeFileSync(join(TMP_AGENT, 'printer'), 'ready\n')
  const cred = JSON.parse(readFileSync(join(TMP_AGENT, 'credential.json'), 'utf8'))
  if (cred.terminalCode !== site.code) throw new Error(`凭证终端是 ${cred.terminalCode}，不是 ${site.code}`)
  const env = {
    PATH: process.env.PATH, HOME: process.env.HOME, LANG: process.env.LANG || 'C.UTF-8',
    SIM_AGENT_DIR: TMP_AGENT,
    SIM_AGENT_CLAIM_MS: '400',
    SIM_AGENT_PRINT_MS: '80',
    SIM_AGENT_UNCONFIRMED_MS: '600',
    SIM_AGENT_HEARTBEAT_MS: '2000',
    SIM_AGENT_OFFLINE_RETRY_MS: '1000',
  }
  tempPid = spawnDetached([
    process.execPath, join(ROOT, 'scripts/walkthrough/sim-agent.mjs'), 'run',
    '--api', `${API_4301}`, '--bridge-port', String(TMP_BRIDGE), '--kiosk-origin', 'http://127.0.0.1:4310',
  ], { cwd: ROOT, env, logPath: join(CACHE, 'logs/sim-agent-d4-tmp.log') })
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    if (listeners(TMP_BRIDGE).length === 1) {
      log(`temp agent ${site.code} up`)
      return cred
    }
    if (!pidAlive(tempPid)) throw new Error(`${site.code} 临时 Agent 马上退出`)
    await sleep(300)
  }
  throw new Error(`${site.code} 临时 Agent 没有监听 ${TMP_BRIDGE}`)
}

async function stopApi() {
  if (!apiPid) {
    const pids = listeners(4301)
    if (!pids[0]) return
    const cmd = commandOf(pids[0])
    if (!cmd.includes('clock-shift.cjs')) throw new Error(`4301 上的 pid ${pids[0]} 不是本回放的偏移实例，拒绝停止`)
    apiPid = Number(pids[0])
    apiPidOwned = true
  }
  if (!apiPidOwned) return
  try { process.kill(apiPid, 'SIGTERM') } catch { /* gone */ }
  await waitDead(apiPid, 12_000)
  apiPid = null
  apiPidOwned = false
}

async function startApi(date, wave) {
  await stopApi()
  memberTokens.clear()
  const target = Date.parse(`${date}T${WAVE_AT[wave]}+08:00`)
  const offset = target - Date.now()
  mkdirSync(dirname(LOG_4301), { recursive: true })
  const bash = [
    'unset NODE_OPTIONS',
    'set -a',
    'source "$HOME/.cache/walk0929/api.env.sh"',
    'set +a',
    'export PORT=4301',
    `export WALK_CLOCK_OFFSET_MS=${offset}`,
    `cd ${JSON.stringify(API_DIR)}`,
    `exec ${JSON.stringify(process.execPath)} --require ${JSON.stringify(CLOCK)} -r @swc-node/register src/main.ts`,
  ].join('\n')
  apiPidOwned = true
  apiPid = spawnDetached(['bash', '-c', bash], {
    cwd: API_DIR,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: process.env.LANG || 'C.UTF-8' },
    logPath: LOG_4301,
  })
  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) {
    if (!pidAlive(apiPid)) throw new Error(`4301 进程马上退出（${date} ${wave}）`)
    try {
      const res = await fetch(`${API_4301}/health`)
      if (res.ok) {
        const body = await res.json()
        const time = pick(body, 'time') ?? body.time
        const got = Date.parse(time)
        if (Number.isFinite(got) && Math.abs(got - target) < 180_000) {
          log(`4301 ${date} ${wave} health ${time}`)
          await sleep(5000)
          return time
        }
      }
    } catch { /* boot */ }
    await sleep(500)
  }
  throw new Error(`4301 没有在 ${date} ${wave} 就绪`)
}

function setPrinter(mode) {
  if (!printerDir || !existsSync(printerDir)) return
  writeFileSync(join(printerDir, 'printer'), `${mode}\n`)
}

async function bootTerminal(cred) {
  const boot = await api('/terminals/boot-ticket', {
    method: 'POST',
    headers: { authorization: `Bearer ${cred.terminalToken}`, 'x-terminal-id': cred.terminalId },
  })
  const session = await api('/terminals/session-token', { method: 'POST', body: { bootTicket: pick(boot, 'bootTicket') } })
  return {
    'x-terminal-id': cred.terminalId,
    'x-terminal-session-token': pick(session, 'sessionToken'),
  }
}

async function uploadFile(headers, file, purpose, bearer) {
  const form = new FormData()
  form.append('purpose', purpose)
  form.append('file', new Blob([file.bytes], { type: file.mime }), file.name)
  const extra = bearer ? { authorization: `Bearer ${bearer}` } : {}
  return dataOf(await api('/files/kiosk-upload', {
    method: 'POST', form, headers: { ...headers, ...extra }, paceKey: 'upload', paceLimit: 18,
  }))
}

async function clearPii(fileId, bearer) {
  const auth = bearer ? { authorization: `Bearer ${bearer}` } : {}
  let material = dataOf(await api('/materials/tasks', {
    method: 'POST', headers: auth, body: { kind: 'pii_scan', sourceFileId: fileId },
  }))
  const pending = (material.piiFindings ?? []).filter((item) => item.action === 'pending')
  if (pending.length > 0 && (material.accessToken || bearer)) {
    material = dataOf(await api(`/materials/tasks/${material.id}/pii-findings/decisions`, {
      method: 'POST',
      headers: { ...auth, ...(material.accessToken ? { 'x-material-task-token': material.accessToken } : {}) },
      body: { decisions: pending.map((item) => ({ findingId: item.id, action: 'keep' })) },
    }))
  }
  return material.id
}

async function readSms(phone, already) {
  for (let i = 0; i < 40; i += 1) {
    const found = smsMatches(phone)
    if (found.length > already) return found[found.length - 1]
    await sleep(400)
  }
  throw new Error(`日志里没有 ${maskPhone(phone)} 的新验证码`)
}

async function memberToken(persona, headers) {
  const phone = persona.phone
  const cached = memberTokens.get(phone)
  if (cached) return cached
  let sent = false
  let already = smsMatches(phone).length
  for (let attempt = 0; attempt < 3 && !sent; attempt += 1) {
    already = smsMatches(phone).length
    try {
      await api('/member/auth/sms-code', {
        method: 'POST',
        body: { phone, deviceId: `d4-${persona.id}` },
        paceKey: 'sms',
        paceLimit: 4,
      })
      sent = true
    } catch (error) {
      const limited = String(error.message).includes('SMS_TOO_FREQUENT') || error.status === 429
      if (!limited || attempt === 2) throw error
      await sleep(65_000)
    }
  }
  const code = await readSms(phone, already)
  const terms = pick(dataOf(await api('/kiosk/legal/terms_of_service')), 'version')
  const privacy = pick(dataOf(await api('/kiosk/legal/privacy_policy')), 'version')
  const login = dataOf(await api('/member/auth/login', {
    method: 'POST',
    body: { phone, code, termsVersion: terms, privacyVersion: privacy, deviceId: `d4-${persona.id}` },
    paceKey: 'login',
    paceLimit: 8,
  }))
  const token = login.token
  if (!token) throw new Error('登录没有返回 token')
  memberTokens.set(phone, token)
  return token
}

async function pollJob(taskId, headers, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let last = null
  while (Date.now() < deadline) {
    last = await api(`/print/jobs/${taskId}`, { headers, paceKey: 'jobget', paceLimit: 28 })
    const status = pick(last, 'status') ?? last?.status
    if (status === 'completed' || status === 'failed' || status === 'cancelled') return dataOf(last) ?? last
    await sleep(800)
  }
  return dataOf(last) ?? last
}

async function runVisit(ev, cred, headers, persona) {
  const rng = mulberry32(hashSeed(ev.key))
  const clientSessionId = randomUUID()
  const file = bytesFor(persona, rng)
  let uploaded = null
  let orderNo = null
  let taskId = null
  let fileId = null
  let outcome = ev.planned
  let result = 'ok'
  try {
    await api('/kiosk/session/start', {
      method: 'POST', headers, body: { clientSessionId, wokeAt: new Date().toISOString(), category: 'print' },
    })
    const bearer = persona.isMember ? await memberToken(persona, headers).catch((error) => {
      result = `login:${error.status || 'err'}`
      return null
    }) : null
    if (ev.planned === 'abandon' && ev.abandonAt === 'upload' && !file) {
      outcome = 'abandon'
      result = 'left-before-upload'
      return
    }
    uploaded = await uploadFile(headers, file, 'print_doc', bearer)
    fileId = uploaded.fileId
    if (ev.planned === 'abandon' && ev.abandonAt === 'upload') {
      outcome = 'abandon'
      result = 'uploaded-not-confirmed'
      return
    }
    await clearPii(fileId, bearer)
    const params = { ...PRINT_PARAMS, copies: ev.copies }
    const quote = await api('/orders/quote', {
      method: 'POST', body: { fileUrl: uploaded.signedUrl, terminalId: cred.terminalId, params },
    })
    if (ev.planned === 'abandon') {
      outcome = 'abandon'
      result = 'quoted-not-ordered'
      return
    }
    if (ev.action !== 'visit') {
      const token = bearer || await memberToken(persona, headers)
      const created = dataOf(await api('/me/print-orders', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'idempotency-key': randomUUID() },
        body: { fileId, terminalId: cred.terminalId, copies: ev.copies, colorMode: 'black_white', duplex: 'simplex' },
      }))
      orderNo = created.orderNo
      if (!created.pickupCode) {
        outcome = 'error'
        result = 'no-pickup-code'
        return
      }
      savePickup({
        purpose: ev.action, orderNo: created.orderNo, orderId: created.id ?? created.orderId,
        pickupCode: created.pickupCode, terminal: ev.site, date: ev.date, personaId: ev.personaId,
        name: ev.name,
      })
      outcome = ev.action === 'cloud-expire' ? 'expire' : 'success'
      result = 'pickup-held'
      return
    }
    if (ev.printer === 'network' && apiBase === API_4300) {
      const site = SITES.find((s) => s.code === ev.site)
      const pid = listeners(site.bridge)[0]
      if (!pid) throw new Error(`${ev.site} 断网演练时网桥不在听`)
      frozenPid = Number(pid)
      process.kill(frozenPid, 'SIGSTOP')
      log(`断网 SIGSTOP ${ev.site} pid ${frozenPid}`)
    }
    setPrinter(ev.printer === 'network' ? 'ready' : (ev.printer || 'ready'))
    const created = await api('/print/jobs', {
      method: 'POST',
      headers: bearer ? { ...headers, authorization: `Bearer ${bearer}` } : headers,
      paceKey: 'print',
      paceLimit: 9,
      body: {
        fileUrl: uploaded.signedUrl, fileMd5: uploaded.sha256, fileName: file.name, params,
        quotedAmountCents: pick(quote, 'amountCents'),
      },
    })
    taskId = pick(created, 'taskId')
    orderNo = pick(created, 'orderNo')
    const liveUnconfirmed = apiBase === API_4300 && ev.printer === 'unconfirmed'
    const timeout = ev.printer === 'network' ? 48_000 : (liveUnconfirmed ? 28_000 : (ev.printer === 'unconfirmed' ? 12_000 : 18_000))
    const finalStatus = await pollJob(taskId, headers, timeout)
    result = `${finalStatus?.status || 'timeout'}${finalStatus?.errorCode ? `:${finalStatus.errorCode}` : ''}`
    outcome = finalStatus?.status === 'completed' ? 'success' : 'fail'
    if (ev.feedback && finalStatus?.status === 'completed') {
      await api('/kiosk/feedback', {
        method: 'POST', headers,
        body: {
          terminalId: cred.terminalId,
          issueCode: ev.printer === 'paper_empty' ? 'device_out_of_paper' : 'other',
          satisfaction: 'good',
          content: '页边略有偏差，工作人员看过了。',
          relatedPrintTaskId: taskId,
        },
      }).catch((error) => { result += ` feedback:${error.status || 'err'}` })
    }
  } catch (error) {
    outcome = 'error'
    result = redact(error.message).slice(0, 240)
  } finally {
    thawFrozen()
    setPrinter('ready')
    await api('/kiosk/session/end', {
      method: 'POST', headers,
      body: { clientSessionId, endedAt: new Date().toISOString(), endReason: 'user_exit' },
    }).catch(() => {})
    ledger({
      key: ev.key, date: ev.date, wave: ev.wave, site: ev.site, personaId: ev.personaId, name: ev.name,
      action: ev.action, planned: ev.planned, printer: ev.printer, outcome, orderNo, taskId, fileId, result,
    })
    log(`${ev.date} ${ev.wave} ${ev.site} ${ev.name} ${ev.action} ${outcome} ${orderNo || ''} ${result}`)
  }
  if (outcome === 'success' && ev.ai && !aiClosed) await runAi(ev, headers, persona, file)
  if (ev.favorite && persona.isMember) await runFavorite(ev, headers, persona)
}

async function runAi(ev, headers, persona, file) {
  const kind = ev.ai.fault && ev.ai.kind !== 'chat' && ev.ai.kind !== 'interview' ? 'chat' : ev.ai.kind
  const marker = ev.ai.fault ? `【走查故障:${ev.ai.fault}】` : ''
  let result = kind
  let taskId = null
  let fileId = null
  try {
    writeFileSync(join(CACHE, 'fake-ocr/active-file.txt'), `${persona.id}\n`)
    const bearer = persona.isMember ? memberTokens.get(persona.phone) : null
    const auth = bearer ? { authorization: `Bearer ${bearer}` } : {}
    if (kind === 'chat') {
      const chat = await api('/assistant/chat', {
        method: 'POST', headers: { ...headers, ...DECL, ...auth },
        body: { message: `我想在青岛找一份能上手的工作。${marker}`.slice(0, 2000), channel: 'kiosk' },
      })
      result = pick(chat, 'reply') ? 'chat-ok' : 'chat-empty'
    } else if (kind === 'interview') {
      const created = dataOf(await api('/mock-interviews', {
        method: 'POST', headers: { ...headers, ...DECL, ...auth },
        body: {
          interviewerType: 'hr', industry: '制造', position: '装配工', experience: persona.age >= 40 ? 'gt5' : 'y1_3',
          difficulty: 'easy', durationMin: 3, interactionMode: 'text',
        },
      }))
      taskId = created.sessionId || created.id
      const access = created.accessToken ? { 'x-interview-access-token': created.accessToken } : {}
      await api(`/mock-interviews/${taskId}/start`, { method: 'POST', headers: { ...headers, ...access, ...auth } })
      await api(`/mock-interviews/${taskId}/answer`, {
        method: 'POST', headers: { ...headers, ...access, ...auth },
        body: { answer: `我以前在车间做一线，想继续找类似的活。${marker}`, inputMode: 'text', answerDurationSec: 25 },
      })
      result = 'interview-ok'
    } else {
      const purpose = /扫描|纸质/.test(file.name) ? 'resume_scan' : 'resume_upload'
      const uploaded = await uploadFile(headers, file, purpose, bearer)
      fileId = uploaded.fileId
      const parsed = await api('/resume/parse', {
        method: 'POST', headers: { ...headers, ...DECL, ...auth },
        body: { fileId, fileName: file.name, fileFormat: file.format || 'pdf', source: purpose === 'resume_scan' ? 'scan' : 'upload' },
      })
      taskId = pick(parsed, 'taskId')
      const access = pick(parsed, 'accessToken')
      const recordHeaders = { ...headers, ...(access ? { 'x-resume-access-token': access } : {}), ...auth }
      let record = null
      for (let i = 0; i < 20; i += 1) {
        record = dataOf(await api(`/resume/records/${taskId}`, { headers: recordHeaders })) ?? await api(`/resume/records/${taskId}`, { headers: recordHeaders })
        if (record?.status === 'succeeded' || record?.status === 'failed' || record?.status === 'completed') break
        await sleep(500)
      }
      result = `parse:${record?.status || 'timeout'}`
      if (kind === 'optimize' && /succeeded|completed/.test(String(record?.status || ''))) {
        await api(`/resume/records/${taskId}/optimize`, { headers: recordHeaders })
        result = 'optimize-ok'
      }
    }
  } catch (error) {
    const code = error.body?.error?.code || error.body?.message || ''
    if (/AI_PAUSED|AI_LOGIN_REQUIRED|MAINTENANCE/.test(String(code) + error.message)) aiClosed = String(code || error.status)
    result = redact(error.message).slice(0, 200)
  } finally {
    rmSync(join(CACHE, 'fake-ocr/active-file.txt'), { force: true })
    ledger({
      key: `${ev.key}|ai`, date: ev.date, wave: ev.wave, site: ev.site, personaId: ev.personaId, name: ev.name,
      action: `ai-${kind}`, outcome: /ok|succeeded|completed/.test(String(result)) && !/fail|error|timeout|AI_/.test(String(result)) ? 'success' : 'fail',
      taskId, fileId, result,
    })
    log(`ai ${ev.site} ${ev.name} ${kind} ${result}`)
  }
}

async function runFavorite(ev, headers, persona) {
  try {
    const token = memberTokens.get(persona.phone) || await memberToken(persona, headers)
    const listed = await api('/policies?pageSize=5', { headers })
    const items = dataOf(listed)?.items || dataOf(listed) || []
    const policy = (Array.isArray(items) ? items : [])[0]
    if (!policy?.id) {
      ledger({ key: `${ev.key}|fav`, date: ev.date, site: ev.site, personaId: persona.id, name: persona.name, action: 'favorite', outcome: 'skip', result: 'no-policy' })
      return
    }
    await api('/me/favorites', {
      method: 'POST', headers: { authorization: `Bearer ${token}` },
      body: { targetType: 'policy', targetId: policy.id },
    })
    ledger({ key: `${ev.key}|fav`, date: ev.date, site: ev.site, personaId: persona.id, name: persona.name, action: 'favorite', outcome: 'success', result: policy.id })
  } catch (error) {
    ledger({
      key: `${ev.key}|fav`, date: ev.date, site: ev.site, personaId: persona.id, name: persona.name,
      action: 'favorite', outcome: 'fail', result: redact(error.message).slice(0, 180),
    })
  }
}

async function ensureLive() {
  for (const site of SITES) {
    if (listeners(site.bridge).length === 1) {
      assertLiveAgent(site, '确认')
      continue
    }
    const path = secretPath(site.code)
    if (!existsSync(path)) throw new Error(`${site.code} 网桥 ${site.bridge} 没在听，也没有可恢复的命令`)
    log(`bridge ${site.bridge} down, restoring ${site.code}`)
    await restoreLive(path)
    assertLiveAgent(site, '恢复后')
  }
}

async function replay(from, to) {
  mkdirSync(EVIDENCE, { recursive: true })
  writeFileSync(join(EVIDENCE, 'limits.txt'), [
    'x-forwarded-for 不能区分四个网点出口。',
    'NODE_ENV=development 且未设置 TRUST_PROXY_HOPS 时，trust proxy 关闭，client-ip 只用 req.ip。',
    '回放流量都是 127.0.0.1。短信的 IP 小时桶按偏移后的日期小时分桶；Nest @Throttle 仍是真实 60 秒窗口。',
    '遇到 429 会等待，不改出口、不绕过。',
    '',
  ].join('\n'))
  const done = seenKeys()
  const events = buildSchedule(from, to).filter((ev) => !done.has(ev.key))
  log(`replay ${from}..${to} pending ${events.length}`)
  apiBase = API_4301
  if (listeners(4301).length) throw new Error('4301 已被占用，拒绝再起一个偏移实例')
  for (const site of SITES) {
    const mine = events.filter((ev) => ev.site === site.code)
    if (!mine.length) continue
    await pauseLive(site)
    printerDir = TMP_AGENT
    try {
      const cred = await startTemp(site)
      let headers = null
      let bootedAt = 0
      let waveKey = ''
      for (const ev of mine) {
        const nextWave = `${ev.date}|${ev.wave}`
        if (nextWave !== waveKey) {
          waveKey = nextWave
          apiBase = API_4301
          await startApi(ev.date, ev.wave)
          headers = await bootTerminal(cred)
          bootedAt = Date.now()
        } else if (Date.now() - bootedAt > 20 * 60 * 1000) {
          headers = await bootTerminal(cred)
          bootedAt = Date.now()
        }
        const persona = ev.personaId === 'family-zhoubo'
          ? { id: 'family-zhoubo', name: '周博', phone: '13800000061', isMember: true, features: ['扫码上传'], age: 40, siteId: 'community' }
          : personas.find((p) => p.id === ev.personaId)
        try {
          await runVisit(ev, cred, headers, persona)
        } catch (error) {
          if (error.status === 401) {
            headers = await bootTerminal(cred)
            await runVisit(ev, cred, headers, persona)
          } else throw error
        }
      }
    } finally {
      await stopApi()
      await stopTemp()
      await restoreLive()
    }
    assertLiveAgent(site, '回放后')
  }
  log(`replay done ${from}..${to}`)
}

function loadPickups() {
  if (!existsSync(PICKUPS)) return []
  return readFileSync(PICKUPS, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line))
}

async function claimOnLive(row, expect) {
  const site = SITES.find((s) => s.code === row.terminal)
  const cred = JSON.parse(readFileSync(join(site.dir, 'credential.json'), 'utf8'))
  apiBase = API_4300
  const headers = await bootTerminal(cred)
  try {
    const claimed = await api('/print/jobs/claim-pickup', {
      method: 'POST', headers, body: { code: row.pickupCode }, paceKey: 'claim', paceLimit: 15,
    })
    const view = dataOf(claimed) ?? claimed
    const taskId = view.taskId || view.printTaskId || null
    if (taskId) await pollJob(taskId, headers, 25_000)
    ledger({
      key: `today|claim|${row.purpose}|${row.orderNo}`, date: localDate(), site: row.terminal,
      personaId: row.personaId, name: row.name || row.purpose, action: `claim-${row.purpose}`,
      outcome: expect === 'invalid' ? 'unexpected-valid' : 'success', orderNo: row.orderNo, taskId, result: view.released ? 'released' : 'claimed',
    })
    log(`claim ${row.purpose} ${row.orderNo} released=${view.released}`)
  } catch (error) {
    const blob = redact(error.message)
    const invalid = /PICKUP_CODE_INVALID|过期/.test(blob)
    ledger({
      key: `today|claim|${row.purpose}|${row.orderNo}`, date: localDate(), site: row.terminal,
      personaId: row.personaId, name: row.name || row.purpose, action: `claim-${row.purpose}`,
      outcome: expect === 'invalid' && invalid ? 'expire' : 'fail', orderNo: row.orderNo, result: blob.slice(0, 180),
    })
    log(`claim ${row.purpose} ${row.orderNo} ${blob.slice(0, 160)}`)
  }
}

const PRINTER_LOCK = join(CACHE, 'locks/printer-fault')
const NOTICE = join(EVIDENCE, 'NOTICE.txt')
const FAULT_MODES = new Set(['paper_empty', 'jam', 'network'])

function noticeBusy() {
  if (!existsSync(NOTICE)) return false
  const text = readFileSync(NOTICE, 'utf8')
  return text.lastIndexOf('开始：') > text.lastIndexOf('结束：')
}

async function waitPrinterQuiet() {
  const start = Date.now()
  while (existsSync(PRINTER_LOCK) || noticeBusy()) {
    if (Date.now() - start > 10 * 60 * 1000) throw new Error('打印前等待故障窗口超过 10 分钟')
    log('等待打印机故障演练')
    await sleep(20_000)
  }
  if (existsSync(NOTICE)) log(`打印前 NOTICE：${readFileSync(NOTICE, 'utf8').replace(/\s+/g, ' ').slice(0, 140)}`)
}

function liveDir(site) {
  const pid = listeners(site.bridge)[0]
  if (!pid) throw new Error(`${site.code} 网桥不在听`)
  return simDirOf(pid, site.dir)
}

function beginFault(site, mode) {
  mkdirSync(dirname(PRINTER_LOCK), { recursive: true })
  writeFileSync(PRINTER_LOCK, `dataset-d4 ${site.code} ${mode}\n`)
  appendFileSync(NOTICE, `D4 今天故障演练 ${site.code} ${mode}\n开始：${new Date().toISOString()}\n`)
  if (!readFileSync(NOTICE, 'utf8').includes('开始：')) throw new Error('NOTICE 没有写上开始时间')
  log(`fault begin ${site.code} ${mode}`)
}

function endFault(dir) {
  thawFrozen()
  if (dir) writeFileSync(join(dir, 'printer'), 'ready\n')
  appendFileSync(NOTICE, `结束：${new Date().toISOString()}\n`)
  rmSync(PRINTER_LOCK, { force: true })
  log('fault end ready, lock cleared, NOTICE cleared')
}

function releaseOwnFault() {
  if (!existsSync(PRINTER_LOCK)) return
  if (!readFileSync(PRINTER_LOCK, 'utf8').includes('dataset-d4')) return
  thawFrozen()
  for (const site of SITES) {
    let dir = site.dir
    try {
      const pid = listeners(site.bridge)[0]
      if (pid) dir = simDirOf(pid, site.dir)
    } catch { /* 用网点默认目录 */ }
    try { writeFileSync(join(dir, 'printer'), 'ready\n') } catch { /* 目录不在 */ }
  }
  appendFileSync(NOTICE, `结束：${new Date().toISOString()}\n`)
  rmSync(PRINTER_LOCK, { force: true })
}

async function today() {
  mkdirSync(EVIDENCE, { recursive: true })
  apiBase = API_4300
  await ensureLive()
  const plan = [
    ['WALK-001', 'p601', 'success', 'ready'],
    ['WALK-001', 'p602', 'success', 'ready'],
    ['WALK-001', 'p603', 'success', 'ready'],
    ['WALK-001', 'p604', 'abandon', 'ready'],
    ['WALK-001', 'p605', 'success', 'ready'],
    ['WALK-001', 'p606', 'success', 'ready'],
    ['WALK-002', 'p608', 'success', 'ready'],
    ['WALK-002', 'p609', 'fail', 'paper_empty'],
    ['WALK-002', 'p610', 'success', 'ready'],
    ['WALK-002', 'p611', 'fail', 'jam'],
    ['WALK-002', 'p612', 'success', 'ready'],
    ['WALK-003', 'p615', 'success', 'ready'],
    ['WALK-003', 'p616', 'abandon', 'ready'],
    ['WALK-003', 'p617', 'success', 'ready'],
    ['WALK-003', 'p620', 'success', 'ready'],
    ['WALK-003', 'p621', 'success', 'ready'],
    ['WALK-004', 'p622', 'success', 'ready'],
    ['WALK-004', 'p623', 'success', 'ready'],
    ['WALK-004', 'p624', 'success', 'ready'],
    ['WALK-004', 'p625', 'fail', 'network'],
    ['WALK-004', 'p626', 'success', 'ready'],
    ['WALK-004', 'p628', 'success', 'ready'],
  ]
  let n = 0
  for (const [siteCode, personaId, planned, printer] of plan) {
    const prev = lastLedger(`today|${siteCode}|${n}`)
    // 实时 Agent 回写被 400 拒绝时订单停在 claimed，同一计划再打一单。
    if (prev && !(prev.outcome === 'fail' && prev.result === 'claimed')) { n += 1; continue }
    const site = SITES.find((s) => s.code === siteCode)
    assertLiveAgent(site, '今天打印前')
    await waitPrinterQuiet()
    const cred = JSON.parse(readFileSync(join(site.dir, 'credential.json'), 'utf8'))
    const headers = await bootTerminal(cred)
    const persona = personas.find((p) => p.id === personaId)
    const ev = {
      key: `today|${siteCode}|${n}`, date: localDate(), wave: 'live', site: siteCode,
      personaId, name: persona.name, action: 'visit', planned, printer,
      abandonAt: n % 2 ? 'quote' : 'upload', copies: personaId === 'p601' ? 3 : (personaId === 'p615' ? 5 : 1),
      ai: personaId === 'p615' ? { kind: 'diagnose', fault: 'timeout' } : (personaId === 'p621' ? { kind: 'chat', fault: null } : null),
      feedback: personaId === 'p601', favorite: personaId === 'p602',
    }
    const dir = liveDir(site)
    const fault = FAULT_MODES.has(printer)
    printerDir = dir
    if (fault) beginFault(site, printer)
    try {
      await runVisit(ev, cred, headers, persona)
    } finally {
      if (fault) endFault(dir)
      else writeFileSync(join(dir, 'printer'), 'ready\n')
      printerDir = TMP_AGENT
    }
    n += 1
  }
  const pickups = loadPickups()
  const nextday = pickups.find((row) => row.purpose === 'cloud-nextday')
  const family = pickups.find((row) => row.purpose === 'cloud-family')
  const expired = pickups.filter((row) => row.purpose === 'cloud-expire').sort((a, b) => a.date.localeCompare(b.date))[0]
  if (nextday) await claimOnLive({ ...nextday, name: '欧阳春梅' }, 'valid')
  else ledger({ key: 'today|claim|nextday|missing', date: localDate(), action: 'claim-nextday', outcome: 'skip', result: 'no 9/28 evening order' })
  if (family) await claimOnLive({ ...family, personaId: 'p624', name: '周桂芳' }, 'valid')
  else ledger({ key: 'today|claim|family|missing', date: localDate(), action: 'claim-family', outcome: 'skip', result: 'no family order' })
  if (expired) await claimOnLive({ ...expired, name: expired.name || '过期未取' }, 'invalid')
  else ledger({ key: 'today|claim|expired|missing', date: localDate(), action: 'claim-expired', outcome: 'skip', result: 'no historical unclaimed code' })
  for (const site of SITES) assertLiveAgent(site, '今天结束')
  log('today done')
}

async function shotPage(page, url, file, after) {
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1500)
  if (after) await after(page)
  await page.waitForTimeout(800)
  const png = join(EVIDENCE, file)
  await page.screenshot({ path: png, fullPage: true })
  const text = redact(await page.locator('body').innerText()).slice(0, 4000)
  writeFileSync(join(EVIDENCE, file.replace(/\.png$/, '.txt')), `${page.url()}\n${text}\n`)
  log(`shot ${file}`)
}

async function shots() {
  mkdirSync(EVIDENCE, { recursive: true })
  const { chromium } = await import('/Users/wanglei/AI求职打印服务终端/.claude/worktrees/youthful-jang-8df61d/node_modules/.pnpm/playwright@1.55.1/node_modules/playwright/index.mjs')
  const browser = await chromium.launch({ headless: true })
  try {
    const admin = await browser.newContext({
      storageState: join(SECRET, 'ui-state-admin.json'),
      viewport: { width: 1440, height: 900 },
    })
    const page = await admin.newPage()
    page.setDefaultTimeout(25_000)
    await shotPage(page, 'http://127.0.0.1:4320/screen/usage?range=30d', 'admin-screen-usage.png', async (p) => {
      const chip = p.getByRole('button', { name: '近 30 天' })
      if (await chip.count()) await chip.click()
    })
    await shotPage(page, 'http://127.0.0.1:4320/orders', 'admin-orders-page2.png', async (p) => {
      const search = p.locator('input[placeholder*="订单"]')
      if (await search.count()) {
        await search.fill('')
        await search.press('Enter')
        await p.waitForTimeout(800)
      }
      const next = p.getByRole('button', { name: '下一页' })
      if (await next.count() && await next.isEnabled()) await next.click()
      await p.waitForTimeout(1000)
    })
    await shotPage(page, 'http://127.0.0.1:4320/alerts', 'admin-alerts.png')
    await shotPage(page, 'http://127.0.0.1:4320/ai-services', 'admin-ai-services.png')
    await admin.close()

    const partners = [
      ['shinan', 'ui-state-d2-shinan.json'],
      ['laoshan', 'ui-state-d2-laoshan.json'],
      ['huangdao', 'ui-state-d2-huangdao.json'],
      ['chengyang', 'ui-state-d2-chengyang.json'],
    ]
    for (const [slug, stateName] of partners) {
      const state = join(SECRET, stateName)
      if (!existsSync(state)) {
        log(`shot skip ${slug} 没有登录态`)
        continue
      }
      const ctx = await browser.newContext({ storageState: state, viewport: { width: 1440, height: 900 } })
      const pp = await ctx.newPage()
      pp.setDefaultTimeout(25_000)
      await shotPage(pp, 'http://127.0.0.1:4330/', `partner-${slug}-home.png`)
      await shotPage(pp, 'http://127.0.0.1:4330/stats', `partner-${slug}-stats.png`, async (p) => {
        const month = p.getByRole('button', { name: '本月' })
        if (await month.count()) await month.click()
      })
      await ctx.close()
    }
  } finally {
    await browser.close()
  }
  log(`shots ${EVIDENCE}`)
}

async function shutdown(code) {
  try { thawFrozen() } catch (error) { log(`thaw: ${error.message}`) }
  try { releaseOwnFault() } catch (error) { log(`fault lock: ${error.message}`) }
  try { await stopApi() } catch (error) { log(`stop api: ${error.message}`) }
  try { await stopTemp() } catch (error) { log(`stop temp: ${error.message}`) }
  if (paused) {
    try { await restoreLive(paused) } catch (error) { log(`RESTORE FAILED ${error.message}`) }
  }
  process.exit(code)
}

process.on('SIGINT', () => { void shutdown(130) })
process.on('SIGTERM', () => { void shutdown(143) })

const cmd = process.argv[2] || 'plan'
const fromArg = process.argv.includes('--from') ? process.argv[process.argv.indexOf('--from') + 1] : null
const toArg = process.argv.includes('--to') ? process.argv[process.argv.indexOf('--to') + 1] : null

async function main() {
  mkdirSync(EVIDENCE, { recursive: true })
  if (cmd === 'plan') {
    const rows = summarize(buildSchedule(fromArg || '2026-09-16', toArg || '2026-09-28'))
    for (const row of rows) log(`${row.date} ${row.site} n=${row.n} success=${row.success} fail=${row.fail} abandon=${row.abandon} expire=${row.expire}`)
    return
  }
  await ensureLive()
  if (cmd === 'sample') {
    await replay(fromArg || '2026-09-16', toArg || '2026-09-17')
    await shots()
    return
  }
  if (cmd === 'rest') {
    await replay(fromArg || '2026-09-18', toArg || '2026-09-28')
    return
  }
  if (cmd === 'today') {
    await today()
    return
  }
  if (cmd === 'shots') {
    await shots()
    return
  }
  throw new Error(`未知命令 ${cmd}`)
}

main().catch(async (error) => {
  log(`FAILED ${redact(error.stack || error.message)}`)
  await shutdown(1)
})
