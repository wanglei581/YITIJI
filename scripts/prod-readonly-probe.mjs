#!/usr/bin/env node
// 生产只读巡检：health / 三前台 bundle / 公开列表 / 法务 / 终端会话 / 告警鉴权。
//
// 本机 DNS 把 *.sslip.io 劫持到 198.18.1.0（见
// docs/device/production-server-cleanup-2026-09-06.md §八「复验探针注意」），
// 按域名直连会打到黑洞。因此 TCP 连 --host（IP），并用 servername + Host 指定域名，
// 等价 curl --resolve <域名>:443:<IP>。不读环境变量、不读密钥、不登录服务器、不写数据。
//
// 公开列表路径来自 services/api/src（pageSize=50 均在后端上限内）：
//   JobsController @Get('jobs') / @Get('job-fairs')，safeInt 上限 100，信封 { data, pagination.total }
//   PoliciesController @Get('policies')，上限 200，信封同上
//   OfflineAgenciesController @Get() → /kiosk/offline-agencies，normalizePage 上限 100，
//     findAll 返回 { data, total, page, pageSize }（托管关闭时 data=[] 且 total=0）。
//     若得到的是裸数组而不是分页对象，listRows / listTotal 按数组本身计。
// 信封缺 total 时退回 items.length / data.length / 裸数组长度。
// 企业 GET /companies：除条数外，还看有没有开发期演示数据留在生产。宽正则不许收窄。
//   2026-09-10 实测生产只有 3 家，名字都带「（演示）」、sourceName 是「市人社公共就业平台（演示）」，
//   而一体机 CompaniesPage 与小程序 pages/companies 都把 name 原样渲染给用户看。
//   prisma/seed-guard.ts 的 assertDemoSeedAllowed 只拦「新写入」，拦不住已经躺在库里的行。
// 岗位、招聘会、政策、线下机构另做第一页检查：只在用户看得见的名称、标题、来源名、
//   机构名白名单里找全角「（演示）」字面量。命中 WARN 并列出前 3 个名字；
//   total=0 为 INFO；未命中 PASS，注明「无演示标记」。
// 不带 --strict 时上面几句就是全部口径，退出码只看 FAIL。
// 带 --strict（发布后核对，须在 #1115 下架演示企业之后跑）：
//   岗位、招聘会、企业条数非 0 → FAIL；这三项为 0 且无标记 → PASS（不再是 INFO）。
//   任一列表有演示标记 → FAIL（企业仍用上面的宽正则，其余四项仍只用全角「（演示）」）。
//   政策、线下机构条数不为 0 本身不 FAIL。有 FAIL 则退出码非 0。
// 法务 GET /kiosk/legal/:type。privacy_policy、terms_of_service、ai_disclaimer 都在
//   LEGAL_DOC_TYPES（services/api/src/legal/legal.service.ts）里。未激活时 getActive
//   返回 null，控制器仍 200 { success:true, data:null }（legal.controller.ts），不是 404。
//   三份同一判据：200 且 data 非空，否则 FAIL。未知类型 400（#835）。
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
const PATH_JOBS = '/api/v1/jobs?pageSize=50'
const PATH_FAIRS = '/api/v1/job-fairs?pageSize=50'
const PATH_POLICIES = '/api/v1/policies?pageSize=50'
const PATH_COMPANIES = '/api/v1/companies?pageSize=50'
const PATH_OFFLINE_AGENCIES = '/api/v1/kiosk/offline-agencies?pageSize=50'
const PATH_PRIVACY = '/api/v1/kiosk/legal/privacy_policy'
const PATH_TERMS = '/api/v1/kiosk/legal/terms_of_service'
const PATH_AI_DISCLAIMER = '/api/v1/kiosk/legal/ai_disclaimer'
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
  --strict               发布后核对（须在演示企业用 #1115 下架之后跑）。
                         岗位、招聘会、企业三个公开列表条数非 0 即 FAIL；
                         任一公开列表出现演示标记也 FAIL（企业用现有宽正则，
                         岗位、招聘会、政策、线下机构用全角「（演示）」）。
                         有 FAIL 时退出码非 0。不带本参数时，条数为 0 仍是 INFO、
                         演示标记仍是 WARN。
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
        strict: { type: 'boolean', default: false },
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
    strict: Boolean(values.strict),
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
  // 裸数组不是分页对象（线下机构若直接回 [] / [{...}]）：条数就是数组长度。
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

/** 企业列表用的宽匹配。刻意只匹配这几个词：判据要能被人一眼复核。不许收窄。 */
const DEMO_MARKER = /演示|示例|测试数据|demo|sample/i

/**
 * 岗位 / 招聘会 / 政策 / 线下机构只认这个全角字面量。
 * 不复用 DEMO_MARKER：那条宽正则会把「示例」「sample」也算进去，这四项不这么判。
 */
const PAREN_DEMO_MARKER = '（演示）'

/**
 * 用户看得见的文字字段白名单（按各接口实际返回，不扫 id / 整段 JSON）。
 * 岗位 JobListItemDto：title、company、sourceName 在列表和详情原样展示。
 * 招聘会 FairListItemDto：name（库里的 title）、organizer、sourceName、venue。
 * 政策 PolicyPostDto：title、summary、sourceName 在列表上。
 * 线下机构公开列表：name、address、district、description、openHours、services。
 */
const PAREN_DEMO_LISTS = [
  {
    label: '岗位',
    path: PATH_JOBS,
    fields: ['title', 'company', 'sourceName'],
    nameField: 'title',
    countMustBeZero: true,
  },
  {
    label: '招聘会',
    path: PATH_FAIRS,
    fields: ['name', 'organizer', 'sourceName', 'venue'],
    nameField: 'name',
    countMustBeZero: true,
  },
  {
    label: '政策',
    path: PATH_POLICIES,
    fields: ['title', 'summary', 'sourceName'],
    nameField: 'title',
    countMustBeZero: false,
  },
  {
    label: '线下机构',
    path: PATH_OFFLINE_AGENCIES,
    fields: ['name', 'address', 'district', 'description', 'openHours', 'services'],
    nameField: 'name',
    countMustBeZero: false,
  },
]

/** 从常见信封里取出列表行。裸数组也算；缺失时回空数组而不是抛。 */
function listRows(parsed) {
  if (Array.isArray(parsed)) return parsed
  for (const layer of [parsed, parsed?.data]) {
    if (Array.isArray(layer)) return layer
    if (Array.isArray(layer?.items)) return layer.items
    if (Array.isArray(layer?.data)) return layer.data
  }
  return []
}

function fieldText(value) {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.filter((item) => typeof item === 'string').join('\n')
  return ''
}

function rowHaystack(entry, fields) {
  if (!entry || typeof entry !== 'object') return ''
  return fields.map((field) => fieldText(entry[field])).join('\n')
}

function hitLabel(entry, spec) {
  const primary = fieldText(entry?.[spec.nameField]).trim()
  if (primary.includes(PAREN_DEMO_MARKER)) return primary
  for (const field of spec.fields) {
    const line = fieldText(entry?.[field])
      .split('\n')
      .map((part) => part.trim())
      .find((part) => part.includes(PAREN_DEMO_MARKER))
    if (line) return line
  }
  return primary || '?'
}

/**
 * 公开列表的最终一档。不带 strict 时，INFO / WARN / PASS 三句与原来逐字相同。
 * strict 只加严：要清零的列表条数非 0 改 FAIL，演示标记从 WARN 改 FAIL，条数 0 改 PASS。
 */
function judgePublicList({ item, total, markerDetail, countMustBeZero, strict }) {
  if (total === 0) {
    if (strict && countMustBeZero) return row(item, 'PASS', 'total=0，无演示标记')
    return row(item, 'INFO', 'total=0（内容录入是负责人的事）')
  }
  if (markerDetail) return row(item, strict ? 'FAIL' : 'WARN', markerDetail)
  if (strict && countMustBeZero) {
    return row(item, 'FAIL', `total=${total}；--strict 要求岗位、招聘会、企业公开列表为 0`)
  }
  return row(item, 'PASS', `total=${total}，无演示标记`)
}

function judgeParenDemoList(spec, res, strict) {
  const item = `GET ${spec.path}（${spec.label}）`
  if (res.error) return row(item, 'FAIL', res.error)
  if (res.status !== 200) return row(item, 'FAIL', `HTTP ${res.status} ${snippet(res.body)}`)
  const parsed = parseJson(res.body)
  const total = listTotal(parsed)
  if (total == null) return row(item, 'FAIL', `无法读取 total / items.length；${snippet(res.body)}`)
  let markerDetail = null
  if (total !== 0) {
    const hits = listRows(parsed).filter((entry) => rowHaystack(entry, spec.fields).includes(PAREN_DEMO_MARKER))
    if (hits.length > 0) {
      const names = hits.slice(0, 3).map((entry) => hitLabel(entry, spec)).join('、')
      markerDetail = `total=${total}，其中 ${hits.length} 条带「（演示）」（${names}${hits.length > 3 ? '…' : ''}）`
        + '；这些名字会原样显示给终端用户，上线前需替换或下架'
    }
  }
  return judgePublicList({
    item,
    total,
    markerDetail,
    countMustBeZero: Boolean(spec.countMustBeZero),
    strict,
  })
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

  for (const spec of PAREN_DEMO_LISTS) {
    tasks.push((async () => judgeParenDemoList(spec, await get(spec.path), cli.strict))())
  }

  tasks.push(
    (async () => {
      const item = 'GET /api/v1/companies（企业 · 含演示数据检查）'
      const res = await get(PATH_COMPANIES)
      if (res.error) return row(item, 'FAIL', res.error)
      if (res.status !== 200) return row(item, 'FAIL', `HTTP ${res.status} ${snippet(res.body)}`)
      const parsed = parseJson(res.body)
      const total = listTotal(parsed)
      if (total == null) return row(item, 'FAIL', `无法读取 total / items.length；${snippet(res.body)}`)
      const rows = listRows(parsed)
      // 只认「摆在用户眼前的那几个字段」：name / sourceName。
      // 不猜 id 前缀、不按 createdAt 推断 —— 那些用户看不到，判错了也没人能复核。
      let markerDetail = null
      if (total !== 0) {
        const demo = rows.filter((r) => DEMO_MARKER.test(String(r?.name ?? '') + String(r?.sourceName ?? '')))
        if (demo.length > 0) {
          const names = demo.slice(0, 3).map((r) => String(r?.name ?? '?')).join('、')
          markerDetail = `total=${total}，其中 ${demo.length} 条带演示标记（${names}${demo.length > 3 ? '…' : ''}）`
            + '；这些名字会原样显示给终端用户，上线前需替换或下架'
        }
      }
      return judgePublicList({
        item,
        total,
        markerDetail,
        countMustBeZero: true,
        strict: cli.strict,
      })
    })(),
  )

  for (const path of [PATH_PRIVACY, PATH_TERMS, PATH_AI_DISCLAIMER]) {
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
  if (cli.strict) {
    lines.push('strict=on（岗位/招聘会/企业条数非 0，或任一列表有演示标记，即 FAIL）')
  }
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
