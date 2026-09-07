#!/usr/bin/env node
// 生产只读巡检：health / 三前台 bundle / 公开列表 / 法务 / 终端会话 / 告警鉴权。
//
// 本机 DNS 把 *.sslip.io 劫持到 198.18.1.0（见
// docs/device/production-server-cleanup-2026-09-06.md §八「复验探针注意」），
// 按域名直连会打到黑洞。因此 TCP 连 --host（IP），并用 servername + Host 指定域名，
// 等价 curl --resolve <域名>:443:<IP>。不读环境变量、不读密钥、不登录服务器、不写数据。
//
// 公开列表路径来自 services/api/src：
//   JobsController @Get('jobs') / @Get('job-fairs')
//   PoliciesController @Get('policies')
// 信封为 { data, pagination.total }（缺 total 时退回 items.length / data.length）。
// 法务 GET /kiosk/legal/:type；未知类型 400（#835）。
// POST /terminals/session-token 空体 400（#833，存在而非 404）。
// GET /admin/alerts 无鉴权 401（#841）。

import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { parseArgs } from 'node:util'

const TIMEOUT_MS = 15_000
const SNIPPET_LEN = 200
const MAX_BODY = 512 * 1024
const DEFAULT_HOST = '120.48.13.190'
const DEFAULT_DOMAINS = 'zyidai.cn,admin.zyidai.cn,partner.zyidai.cn'
const PATH_HEALTH = '/api/v1/health'
const PATH_READY = '/api/v1/health/ready'
const PATH_JOBS = '/api/v1/jobs'
const PATH_FAIRS = '/api/v1/job-fairs'
const PATH_POLICIES = '/api/v1/policies'
const PATH_PRIVACY = '/api/v1/kiosk/legal/privacy_policy'
const PATH_TERMS = '/api/v1/kiosk/legal/terms_of_service'
const PATH_UNKNOWN_LEGAL = '/api/v1/kiosk/legal/unknown_type'
const PATH_SESSION_TOKEN = '/api/v1/terminals/session-token'
const PATH_ALERTS = '/api/v1/admin/alerts?limit=5'

const HELP = `生产只读巡检（不登录服务器、不读密钥、不写数据）

用法:
  node scripts/prod-readonly-probe.mjs [选项]

选项:
  --host <ip>            TCP 连接地址（默认 ${DEFAULT_HOST}）
  --domains <a,b,c>      SNI / Host 域名，逗号分隔（默认 ${DEFAULT_DOMAINS}）
  --expect-sha <前缀>    打印在报告头，供与服务器 DEPLOY_SOURCE.txt 人工核对
  --json                 只输出 JSON
  --scheme http|https    默认 https。http 仅供本地桩测试
  --port <n>             默认 https=443、http=80
  --help                 显示本说明

本机 DNS 把 *.sslip.io 劫持到 198.18.1.0，必须按 IP 建连并用 servername/Host
指定域名，等价 curl --resolve <域名>:443:<IP>。
`

function printHelp() {
  process.stdout.write(HELP)
}

function parseCli(argv) {
  let values
  try {
    ;({ values } = parseArgs({
      args: argv,
      options: {
        host: { type: 'string', default: DEFAULT_HOST },
        domains: { type: 'string', default: DEFAULT_DOMAINS },
        'expect-sha': { type: 'string' },
        json: { type: 'boolean', default: false },
        scheme: { type: 'string', default: 'https' },
        port: { type: 'string' },
        help: { type: 'boolean', default: false, short: 'h' },
      },
      allowPositionals: false,
      strict: true,
    }))
  } catch (err) {
    process.stderr.write(`${err.message}\n`)
    printHelp()
    process.exit(1)
  }
  if (values.help) return { help: true }

  const scheme = String(values.scheme || 'https').toLowerCase()
  if (scheme !== 'http' && scheme !== 'https') {
    process.stderr.write('--scheme 只能是 http 或 https（http 仅供本地桩测试）\n')
    process.exit(1)
  }
  const host = String(values.host || DEFAULT_HOST).trim()
  if (!host) {
    process.stderr.write('--host 不能为空\n')
    process.exit(1)
  }
  const domains = String(values.domains || DEFAULT_DOMAINS)
    .split(',')
    .map((d) => d.trim())
    .filter(Boolean)
  if (domains.length === 0) {
    process.stderr.write('--domains 不能为空\n')
    process.exit(1)
  }
  const portRaw = values.port
  const port = portRaw ? Number(portRaw) : scheme === 'https' ? 443 : 80
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    process.stderr.write('--port 必须是 1–65535 的整数\n')
    process.exit(1)
  }
  return {
    help: false,
    host,
    domains,
    expectSha: values['expect-sha'] ? String(values['expect-sha']).trim() : '',
    json: Boolean(values.json),
    scheme,
    port,
  }
}

function snippet(body) {
  const s = String(body ?? '').replace(/\s+/g, ' ').trim()
  return s.length <= SNIPPET_LEN ? s : `${s.slice(0, SNIPPET_LEN)}…`
}

function requestOnce({ scheme, ip, port, domain, method, path, body }) {
  const libRequest = scheme === 'http' ? httpRequest : httpsRequest
  const payload = body == null ? null : Buffer.from(String(body), 'utf8')
  const headers = {
    host: domain,
    accept: 'application/json, text/html;q=0.9, */*;q=0.8',
    'accept-encoding': 'identity',
    'user-agent': 'prod-readonly-probe',
    connection: 'close',
  }
  if (payload) {
    headers['content-type'] = 'application/json'
    headers['content-length'] = String(payload.length)
  } else if (method === 'POST') {
    headers['content-length'] = '0'
  }

  const options = {
    hostname: ip,
    port,
    path,
    method,
    headers,
    timeout: TIMEOUT_MS,
  }
  if (scheme === 'https') options.servername = domain

  return new Promise((resolve) => {
    let settled = false
    const finish = (result) => {
      if (settled) return
      settled = true
      resolve(result)
    }
    const req = libRequest(options, (res) => {
      const chunks = []
      let size = 0
      res.on('data', (chunk) => {
        if (size >= MAX_BODY) return
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        const room = MAX_BODY - size
        chunks.push(buf.length > room ? buf.subarray(0, room) : buf)
        size += Math.min(buf.length, room)
      })
      res.on('end', () => {
        finish({
          error: null,
          status: res.statusCode ?? 0,
          body: Buffer.concat(chunks).toString('utf8'),
        })
      })
    })
    req.on('error', (err) => finish({ error: err.message || String(err), status: 0, body: '' }))
    req.on('timeout', () => {
      req.destroy()
      finish({ error: `timeout ${TIMEOUT_MS / 1000}s`, status: 0, body: '' })
    })
    if (payload) req.write(payload)
    req.end()
  })
}

function parseJson(body) {
  try {
    return JSON.parse(body)
  } catch {
    return null
  }
}

function healthPayload(json) {
  if (!json || typeof json !== 'object') return null
  const inner = json.data
  if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
    if ('status' in inner || 'db' in inner || 'degraded' in inner) return inner
  }
  if ('status' in json || 'db' in json || 'degraded' in json) return json
  return null
}

function listTotal(json) {
  if (json == null) return null
  if (typeof json === 'object' && !Array.isArray(json)) {
    const layers = [json, json.data, json.data && typeof json.data === 'object' ? json.data.data : null]
    for (const layer of layers) {
      if (!layer || typeof layer !== 'object' || Array.isArray(layer)) continue
      if (typeof layer.pagination?.total === 'number') return layer.pagination.total
      if (typeof layer.total === 'number') return layer.total
    }
    for (const layer of layers) {
      if (!layer || typeof layer !== 'object') continue
      if (Array.isArray(layer.items)) return layer.items.length
      if (Array.isArray(layer.data)) return layer.data.length
    }
  }
  if (Array.isArray(json)) return json.length
  return null
}

function dataNonEmpty(json) {
  const data = json && typeof json === 'object' ? json.data : null
  if (data == null) return false
  if (typeof data === 'string') return data.trim().length > 0
  if (Array.isArray(data)) return data.length > 0
  if (typeof data === 'object') return Object.keys(data).length > 0
  return true
}

function extractIndexHash(html) {
  const match = String(html).match(/assets\/index-([A-Za-z0-9_-]+)\.js/)
  return match ? match[1] : null
}

function row(item, result, detail, extra = {}) {
  return { item, result, detail, ...extra }
}

async function runChecks(cli) {
  const apiDomain = cli.domains[0]
  const ctx = { scheme: cli.scheme, ip: cli.host, port: cli.port, domain: apiDomain }

  const get = (path, domain = apiDomain, method = 'GET', body) =>
    requestOnce({ ...ctx, domain, method, path, body })

  const tasks = []

  tasks.push(
    (async () => {
      const res = await get(PATH_HEALTH)
      if (res.error) return row('GET /api/v1/health', 'FAIL', res.error)
      const json = parseJson(res.body)
      const data = healthPayload(json)
      const degraded = data?.degraded
      const ok =
        res.status === 200 &&
        data &&
        data.status === 'ok' &&
        data.db === 'postgres' &&
        Array.isArray(degraded) &&
        degraded.length === 0
      if (ok) return row('GET /api/v1/health', 'PASS', 'status=ok db=postgres degraded=[]')
      const why = []
      if (res.status !== 200) why.push(`HTTP ${res.status}`)
      if (!data) why.push('无法解析 data')
      else {
        if (data.status !== 'ok') why.push(`status=${JSON.stringify(data.status)}`)
        if (data.db !== 'postgres') why.push(`db=${JSON.stringify(data.db)}`)
        if (!Array.isArray(degraded)) why.push('degraded 不是数组')
        else if (degraded.length > 0) why.push(`degraded.length=${degraded.length}`)
      }
      why.push(snippet(res.body))
      return row('GET /api/v1/health', 'FAIL', why.join('；'))
    })(),
  )

  tasks.push(
    (async () => {
      const res = await get(PATH_READY)
      if (res.error) return row('GET /api/v1/health/ready', 'FAIL', res.error)
      if (res.status === 200) return row('GET /api/v1/health/ready', 'PASS', '200')
      return row('GET /api/v1/health/ready', 'FAIL', `HTTP ${res.status} ${snippet(res.body)}`)
    })(),
  )

  for (const domain of cli.domains) {
    tasks.push(
      (async () => {
        const res = await get('/', domain)
        const label = `GET /  ${domain}`
        if (res.error) return row(label, 'FAIL', res.error, { kind: 'home', domain })
        if (res.status !== 200) {
          return row(label, 'FAIL', `HTTP ${res.status} ${snippet(res.body)}`, { kind: 'home', domain })
        }
        const hash = extractIndexHash(res.body)
        if (!hash) {
          return row(label, 'FAIL', '未找到 assets/index-*.js', { kind: 'home', domain })
        }
        return row(label, 'PASS', `assets/index-${hash}.js`, { kind: 'home', domain, hash })
      })(),
    )
  }

  const lists = [
    { label: '岗位', path: PATH_JOBS },
    { label: '招聘会', path: PATH_FAIRS },
    { label: '政策', path: PATH_POLICIES },
  ]
  for (const spec of lists) {
    tasks.push(
      (async () => {
        const item = `GET ${spec.path}（${spec.label}）`
        const res = await get(spec.path)
        if (res.error) return row(item, 'FAIL', res.error)
        if (res.status !== 200) return row(item, 'FAIL', `HTTP ${res.status} ${snippet(res.body)}`)
        const total = listTotal(parseJson(res.body))
        if (total == null) return row(item, 'FAIL', `无法读取 total / items.length；${snippet(res.body)}`)
        if (total === 0) return row(item, 'INFO', 'total=0（内容录入是负责人的事）')
        return row(item, 'PASS', `total=${total}`)
      })(),
    )
  }

  for (const path of [PATH_PRIVACY, PATH_TERMS]) {
    tasks.push(
      (async () => {
        const item = `GET ${path}`
        const res = await get(path)
        if (res.error) return row(item, 'FAIL', res.error)
        if (res.status !== 200) return row(item, 'FAIL', `HTTP ${res.status} ${snippet(res.body)}`)
        if (!dataNonEmpty(parseJson(res.body))) return row(item, 'FAIL', `data 为空；${snippet(res.body)}`)
        return row(item, 'PASS', '200 且 data 非空')
      })(),
    )
  }

  tasks.push(
    (async () => {
      const item = `GET ${PATH_UNKNOWN_LEGAL}`
      const res = await get(PATH_UNKNOWN_LEGAL)
      if (res.error) return row(item, 'FAIL', res.error)
      if (res.status === 400) return row(item, 'PASS', '400（#835 契约）')
      return row(item, 'FAIL', `期望 400，实际 HTTP ${res.status} ${snippet(res.body)}`)
    })(),
  )

  tasks.push(
    (async () => {
      const item = 'POST /api/v1/terminals/session-token 空体'
      const res = await get(PATH_SESSION_TOKEN, apiDomain, 'POST', '{}')
      if (res.error) return row(item, 'FAIL', res.error)
      if (res.status === 400) return row(item, 'PASS', '400（存在，非 404；#833 契约）')
      return row(item, 'FAIL', `期望 400，实际 HTTP ${res.status} ${snippet(res.body)}`)
    })(),
  )

  tasks.push(
    (async () => {
      const item = 'GET /api/v1/admin/alerts?limit=5 无鉴权'
      const res = await get(PATH_ALERTS)
      if (res.error) return row(item, 'FAIL', res.error)
      if (res.status === 401) return row(item, 'PASS', '401（#841 端点存在且受保护）')
      return row(item, 'FAIL', `期望 401，实际 HTTP ${res.status} ${snippet(res.body)}`)
    })(),
  )

  const items = await Promise.all(tasks)
  applyHomeHashWarn(items)
  return items
}

function applyHomeHashWarn(items) {
  const homes = items.filter((i) => i.kind === 'home' && i.hash && i.result !== 'FAIL')
  const byHash = new Map()
  for (const home of homes) {
    const list = byHash.get(home.hash) || []
    list.push(home)
    byHash.set(home.hash, list)
  }
  for (const group of byHash.values()) {
    if (group.length < 2) continue
    const names = group.map((g) => g.domain).join('、')
    for (const home of group) {
      home.result = 'WARN'
      home.detail = `${home.detail}；与 ${names} 相同，可能按 IP 打到了默认 vhost`
    }
  }
}

function displayWidth(s) {
  let w = 0
  for (const ch of s) w += ch.codePointAt(0) > 0x7f ? 2 : 1
  return w
}

function padWidth(s, width) {
  const w = displayWidth(s)
  return w >= width ? s : s + ' '.repeat(width - w)
}

function countBy(items) {
  const summary = { pass: 0, warn: 0, fail: 0, info: 0 }
  for (const item of items) {
    if (item.result === 'PASS') summary.pass += 1
    else if (item.result === 'WARN') summary.warn += 1
    else if (item.result === 'FAIL') summary.fail += 1
    else if (item.result === 'INFO') summary.info += 1
  }
  return summary
}

function summaryLine(summary) {
  return `PASS ${summary.pass} / WARN ${summary.warn} / FAIL ${summary.fail}`
}

function printHuman(cli, items, summary) {
  const lines = []
  lines.push('# 生产只读巡检')
  lines.push(`host=${cli.host} scheme=${cli.scheme} port=${cli.port}`)
  lines.push(`domains=${cli.domains.join(',')}`)
  if (cli.expectSha) {
    lines.push(`expect-sha=${cli.expectSha}  （请与服务器 DEPLOY_SOURCE.txt 人工核对；本脚本不登录服务器）`)
  }
  lines.push('')
  const itemWidth = Math.max(8, ...items.map((i) => displayWidth(i.item)), displayWidth('项'))
  const resultWidth = Math.max(4, ...items.map((i) => displayWidth(i.result)), displayWidth('结果'))
  lines.push(`${padWidth('项', itemWidth)}  ${padWidth('结果', resultWidth)}  说明`)
  for (const item of items) {
    lines.push(`${padWidth(item.item, itemWidth)}  ${padWidth(item.result, resultWidth)}  ${item.detail}`)
  }
  lines.push('')
  lines.push(summaryLine(summary))
  process.stdout.write(`${lines.join('\n')}\n`)
}

function printJson(cli, items, summary) {
  const report = {
    host: cli.host,
    scheme: cli.scheme,
    port: cli.port,
    domains: cli.domains,
    expectSha: cli.expectSha || null,
    items: items.map(({ item, result, detail }) => ({ item, result, detail })),
    summary,
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
}

async function main() {
  const cli = parseCli(process.argv.slice(2))
  if (cli.help) {
    printHelp()
    process.exit(0)
  }
  const items = await runChecks(cli)
  const summary = countBy(items)
  if (cli.json) printJson(cli, items, summary)
  else printHuman(cli, items, summary)
  process.exit(summary.fail > 0 ? 1 : 0)
}

main()
