#!/usr/bin/env node
// verify:prod-readonly-probe
// 静态检查 prod-readonly-probe.mjs（只 import node: 内置、不连生产、不读密钥），
// 再用本地 http 桩覆盖合规响应、health.degraded 非空、unknown_type 回 200 三条路径。

import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const probePath = join(repoRoot, 'scripts/prod-readonly-probe.mjs')
const src = readFileSync(probePath, 'utf8')

let failures = 0
const pass = (m) => console.log(`  PASS ${m}`)
const fail = (m) => {
  failures += 1
  console.error(`  FAIL ${m}`)
}

console.log('\n=== 静态：prod-readonly-probe.mjs ===')

const fromSpecs = [...src.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((m) => m[1])
const requireSpecs = [...src.matchAll(/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1])
const specs = [...fromSpecs, ...requireSpecs]
if (specs.length === 0) fail('没有任何 import')
for (const spec of specs) {
  if (spec.startsWith('node:')) pass(`import ${spec}`)
  else fail(`非 node: 内置模块：${spec}`)
}
if (!src.includes('node:http') || !src.includes('node:https')) {
  fail('必须 import node:http 与 node:https')
}
if (/\bchild_process\b/.test(src)) fail('不得引用 child_process')
else pass('不含 child_process')
if (/\bssh\b/i.test(src)) fail('不得出现 ssh（不登录服务器）')
else pass('不含 ssh')
if (/process\.env/.test(src) || /\bdotenv\b/.test(src)) fail('不得读取环境变量或 dotenv')
else pass('不读 process.env / dotenv')
if (!src.includes('sslip.io')) fail('必须注释说明 *.sslip.io 劫持，因此按 IP+servername 建连')
else pass('含 sslip.io 劫持说明')
if (!src.includes('servername') || !/\bHost\b/.test(src)) {
  fail('必须设置 servername / Host，等价 curl --resolve')
} else pass('按 IP + servername/Host 建连')
if (src.includes('--scheme') && src.includes('http') && /仅供/.test(src)) {
  pass('支持 --scheme http 仅供测试')
} else fail('必须支持 --scheme http 仅供测试')

for (const needle of [
  '/api/v1/health',
  '/api/v1/jobs',
  '/api/v1/job-fairs',
  '/api/v1/policies',
  '/api/v1/companies',
  '/api/v1/kiosk/offline-agencies',
  '/kiosk/legal/privacy_policy',
  '/kiosk/legal/terms_of_service',
  '/kiosk/legal/ai_disclaimer',
  '/kiosk/legal/unknown_type',
  '/terminals/session-token',
  '/admin/alerts',
]) {
  if (src.includes(needle)) pass(`检查项含 ${needle}`)
  else fail(`缺少真实端点 ${needle}`)
}

for (const path of [
  '/api/v1/jobs?pageSize=50',
  '/api/v1/job-fairs?pageSize=50',
  '/api/v1/policies?pageSize=50',
  '/api/v1/kiosk/offline-agencies?pageSize=50',
]) {
  if (src.includes(path)) pass(`第一页 ${path}`)
  else fail(`缺少 ${path}（后端接受 pageSize=50）`)
}
if (src.includes('（演示）')) pass('岗位/招聘会/政策/线下机构使用全角（演示）字面量')
else fail('缺少全角（演示）字面量')
if (src.includes('演示|示例|测试数据|demo|sample')) pass('企业宽正则仍在，未被收窄')
else fail('企业宽正则被收窄或删除')

if (!src.includes('15000') && !src.includes('15_000')) fail('每项超时必须是 15s')
else pass('每项超时 15s')

let mutation = 'ok'
const seenPaths = []

function send(res, status, body, contentType = 'application/json; charset=utf-8') {
  const raw = typeof body === 'string' ? body : JSON.stringify(body)
  res.writeHead(status, {
    'content-type': contentType,
    'content-length': Buffer.byteLength(raw),
    connection: 'close',
  })
  res.end(raw)
}

function pageEnvelope(data, total) {
  return { data, pagination: { page: 1, pageSize: 50, total, totalPages: 1 } }
}

function jobsPayload(mode) {
  // 这几种夹具要单独看企业条数或政策标记，岗位必须是 0，避免 --strict 被岗位条数带着 FAIL。
  if (
    mode === 'lists_empty'
    || mode === 'recruitment_zero'
    || mode === 'companies_one'
    || mode === 'companies_one_demo'
    || mode === 'policy_demo_only'
  ) return pageEnvelope([], 0)
  if (mode === 'demo_all') {
    return pageEnvelope([
      {
        id: 'job-id-不含标记',
        title: '仓库管理员（演示）',
        company: '正常企业股份有限公司',
        sourceName: '市人社公共就业平台',
      },
      { id: 'j2', title: '会计', company: '另一家正常企业', sourceName: '市人社公共就业平台' },
    ], 2)
  }
  // 阳性对照：id 里的「（演示）」不在白名单；sourceName 的 sample 只会被企业那条宽正则打中。
  return pageEnvelope([
    {
      id: 'id-（演示）-不该扫到',
      title: '仓储管理员',
      company: '正常企业股份有限公司',
      sourceName: 'sample 来源不应命中',
    },
    { id: 'j2', title: '会计', company: '另一家正常企业', sourceName: '市人社公共就业平台' },
  ], 2)
}

function fairsPayload(mode) {
  if (mode === 'fairs_clean') {
    return pageEnvelope([
      {
        id: 'fair-id-（演示）',
        name: '春季综合招聘会',
        organizer: '市人社',
        sourceName: 'sample 来源不应命中',
        venue: '市人才市场',
      },
    ], 1)
  }
  if (mode === 'demo_all') {
    // 标记只在 sourceName，不在 name：白名单必须扫来源名，不能只看标题。
    return pageEnvelope([
      {
        id: 'f1',
        name: '春季综合招聘会',
        organizer: '市人社',
        sourceName: '市人社招聘会来源（演示）',
        venue: '市人才市场',
      },
    ], 1)
  }
  return pageEnvelope([], 0)
}

function policiesPayload(mode) {
  if (mode === 'lists_empty' || mode === 'recruitment_zero') return pageEnvelope([], 0)
  if (mode === 'policy_demo_only') {
    // 只在政策摘要里放全角「（演示）」。岗位、招聘会、企业在这个夹具里是 0 条，
    // 所以 --strict 若把这一行判成 FAIL，只能是演示标记，不是条数。
    return pageEnvelope([
      { id: 'p1', title: '灵活就业补贴', summary: '灵活就业补贴说明（演示）', sourceName: '市人社' },
    ], 1)
  }
  if (mode === 'demo_all') {
    // 标记只在 summary：列表上看得见的摘要必须进白名单。
    return pageEnvelope([
      { id: 'p1', title: '灵活就业补贴', summary: '灵活就业补贴说明（演示）', sourceName: '市人社' },
      { id: 'p2', title: '档案转递', summary: '摘要', sourceName: '市人社' },
    ], 2)
  }
  return pageEnvelope([
    { id: 'p-（演示）', title: '灵活就业补贴', summary: '正常摘要', sourceName: 'sample 来源不应命中' },
    { id: 'p2', title: '档案转递', summary: '摘要', sourceName: '市人社' },
  ], 2)
}

function agenciesPayload(mode) {
  if (mode === 'lists_empty') return []
  if (mode === 'agencies_bare_demo') {
    return [{ id: 'a1', name: '槐荫街道职介（演示）', address: '经十路 1 号', district: '槐荫区' }]
  }
  if (mode === 'demo_all') {
    // 标记只在 address：机构名干净时仍要 WARN，并列出带标记的地址。
    return {
      data: [{
        id: 'a1',
        name: '槐荫街道职业介绍',
        address: '经十路（演示）1号',
        district: '槐荫区',
        description: '职业介绍',
        services: ['求职登记'],
      }],
      total: 1,
      page: 1,
      pageSize: 50,
    }
  }
  return {
    data: [{
      id: 'a-（演示）',
      name: '槐荫街道职业介绍',
      address: 'sample 路 1 号',
      district: '槐荫区',
      description: '职业介绍',
      services: ['求职登记'],
    }],
    total: 1,
    page: 1,
    pageSize: 50,
  }
}

function handle(req, res) {
  const url = new URL(req.url || '/', 'http://127.0.0.1')
  const path = url.pathname
  seenPaths.push(`${path}${url.search}`)
  const host = String(req.headers.host || '').split(':')[0]

  const hashes = {
    'zyidai.cn': 'KioskHash1',
    'admin.zyidai.cn': 'AdminHash2',
    'partner.zyidai.cn': 'PartnerHash3',
  }

  if (req.method === 'GET' && path === '/api/v1/health') {
    if (mutation === 'degraded') {
      send(res, 200, {
        success: true,
        data: {
          status: 'degraded',
          db: 'postgres',
          degraded: [{ subsystem: 'redis', status: 'degraded', code: 'REDIS_UNAVAILABLE', message: 'stub' }],
        },
      })
      return
    }
    send(res, 200, { success: true, data: { status: 'ok', db: 'postgres', degraded: [] } })
    return
  }
  if (req.method === 'GET' && path === '/api/v1/health/ready') {
    send(res, 200, { success: true, data: { status: 'ready', db: 'postgres' } })
    return
  }
  if (req.method === 'GET' && path === '/') {
    const hash = hashes[host] || hashes['zyidai.cn']
    send(
      res,
      200,
      `<!doctype html><html><head></head><body><script type="module" src="/assets/index-${hash}.js"></script></body></html>`,
      'text/html; charset=utf-8',
    )
    return
  }
  if (req.method === 'GET' && path === '/api/v1/jobs') {
    send(res, 200, jobsPayload(mutation))
    return
  }
  if (req.method === 'GET' && path === '/api/v1/job-fairs') {
    send(res, 200, fairsPayload(mutation))
    return
  }
  if (req.method === 'GET' && path === '/api/v1/policies') {
    send(res, 200, policiesPayload(mutation))
    return
  }
  if (req.method === 'GET' && path === '/api/v1/kiosk/offline-agencies') {
    send(res, 200, agenciesPayload(mutation))
    return
  }
  if (req.method === 'GET' && path === '/api/v1/companies') {
    if (mutation === 'recruitment_zero' || mutation === 'policy_demo_only') {
      send(res, 200, { data: { items: [] }, pagination: { page: 1, pageSize: 50, total: 0, totalPages: 0 } })
      return
    }
    const items = mutation === 'companies_demo' || mutation === 'companies_one_demo'
      ? [
          { id: 'c1', name: '未来智造科技有限公司（演示）', sourceName: '市人社公共就业平台（演示）' },
          ...(mutation === 'companies_one_demo'
            ? []
            : [{ id: 'c2', name: '正常企业股份有限公司', sourceName: '市人社公共就业平台' }]),
        ]
      : mutation === 'companies_one'
        ? [{ id: 'c1', name: '正常企业股份有限公司', sourceName: '市人社公共就业平台' }]
        : [
            { id: 'c1', name: '正常企业股份有限公司', sourceName: '市人社公共就业平台' },
            { id: 'c2', name: '另一家正常企业', sourceName: '市人社公共就业平台' },
          ]
    send(res, 200, { data: { items }, pagination: { page: 1, pageSize: 50, total: items.length, totalPages: 1 } })
    return
  }
  if (req.method === 'GET' && path === '/api/v1/kiosk/legal/privacy_policy') {
    send(res, 200, { success: true, data: { id: 'doc-pp', docType: 'privacy_policy', version: '1', title: '隐私政策', content: '正文' } })
    return
  }
  if (req.method === 'GET' && path === '/api/v1/kiosk/legal/terms_of_service') {
    send(res, 200, { success: true, data: { id: 'doc-tos', docType: 'terms_of_service', version: '1', title: '服务条款', content: '正文' } })
    return
  }
  if (req.method === 'GET' && path === '/api/v1/kiosk/legal/ai_disclaimer') {
    // 未激活：LegalService.getActive 返回 null，控制器仍 200 且 data 为 null（不是 404）。
    if (mutation === 'ai_disclaimer_off') {
      send(res, 200, { success: true, data: null })
      return
    }
    send(res, 200, {
      success: true,
      data: { id: 'doc-ai', docType: 'ai_disclaimer', version: '1', title: 'AI 服务说明', content: '正文' },
    })
    return
  }
  if (req.method === 'GET' && path === '/api/v1/kiosk/legal/unknown_type') {
    if (mutation === 'unknown_ok') {
      send(res, 200, { success: true, data: { id: 'wrong', content: '不应回落' } })
      return
    }
    send(res, 400, { error: { code: 'LEGAL_DOC_TYPE_INVALID', message: '法务文档类型不支持' } })
    return
  }
  if (req.method === 'POST' && path === '/api/v1/terminals/session-token') {
    send(res, 400, { error: { code: 'VALIDATION_FAILED', message: 'bootTicket 必填' } })
    return
  }
  if (req.method === 'GET' && path === '/api/v1/admin/alerts') {
    send(res, 401, { error: { code: 'UNAUTHORIZED', message: '未登录' } })
    return
  }
  send(res, 404, { error: { code: 'NOT_FOUND', message: path } })
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
  })
}

function runChild(args, timeoutMs = 20_000) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd: repoRoot })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('close', (status, signal) => {
      clearTimeout(timer)
      resolve({ status: status ?? (signal ? 1 : 0), stdout, stderr })
    })
  })
}

function runProbe(port, extraArgs = []) {
  return runChild([
    probePath,
    '--scheme',
    'http',
    '--host',
    '127.0.0.1',
    '--port',
    String(port),
    '--domains',
    'zyidai.cn,admin.zyidai.cn,partner.zyidai.cn',
    '--expect-sha',
    'deadbeef',
    ...extraArgs,
  ])
}

function expectExit(result, expected, label) {
  const actual = result.status
  if (actual === expected) pass(`${label} 退出码 ${expected}`)
  else {
    fail(`${label} 期望退出码 ${expected}，实际 ${actual}`)
    if (result.stdout) process.stdout.write(result.stdout)
    if (result.stderr) process.stderr.write(result.stderr)
  }
  return actual === expected
}

function lineOf(stdout, needle) {
  return (stdout || '').split('\n').find((line) => line.includes(needle)) || ''
}

function expectLine(stdout, needle, result, label) {
  const line = lineOf(stdout, needle)
  if (new RegExp(`\\s${result}\\s`).test(line)) pass(label)
  else fail(`${label}，实际: ${line.trim() || '(该行未出现)'}`)
  return line
}

const server = createServer((req, res) => {
  const done = () => handle(req, res)
  req.on('data', () => {})
  if (req.readableEnded) done()
  else req.on('end', done)
})

const port = await listen(server)
try {
  console.log('\n=== --help ===')
  const help = await runChild([probePath, '--help'], 5_000)
  if (help.status === 0 && /--host/.test(help.stdout) && /--domains/.test(help.stdout) && /sslip\.io/.test(help.stdout)) {
    pass('--help 退出 0 且含用法')
  } else {
    fail('--help 不可用')
    if (help.stdout) process.stdout.write(help.stdout)
    if (help.stderr) process.stderr.write(help.stderr)
  }
  if (/--strict/.test(help.stdout) && /非 0/.test(help.stdout) && /演示/.test(help.stdout)) {
    pass('--help 写明 --strict：条数非 0 与演示标记')
  } else fail('--help 未写明 --strict（岗位/招聘会/企业条数非 0，以及演示标记，都要 FAIL）')

  console.log('\n=== 本地桩：合规响应 ===')
  mutation = 'ok'
  seenPaths.length = 0
  const happyTable = await runProbe(port)
  process.stdout.write(happyTable.stdout || '')
  expectExit(happyTable, 0, '合规桩')
  if (!/PASS \d+ \/ WARN \d+ \/ FAIL \d+/.test(happyTable.stdout || '')) fail('合规桩未打印 PASS/WARN/FAIL 汇总行')
  else pass('合规桩打印汇总行')
  const fairLine = expectLine(happyTable.stdout, '/api/v1/job-fairs', 'INFO', '招聘会 total=0 为 INFO')
  if (fairLine.includes('total=0（内容录入是负责人的事）')) pass('招聘会 INFO 说明是内容录入')
  else fail(`招聘会空列表说明不对: ${fairLine.trim() || '(该行未出现)'}`)
  const jobsClean = expectLine(happyTable.stdout, '/api/v1/jobs?', 'PASS', '岗位无「（演示）」为 PASS')
  if (jobsClean.includes('无演示标记')) pass('岗位 PASS 注明无演示标记')
  else fail(`岗位 PASS 必须注明无演示标记: ${jobsClean.trim()}`)
  const policyClean = expectLine(happyTable.stdout, '/api/v1/policies', 'PASS', '政策无「（演示）」为 PASS')
  if (policyClean.includes('无演示标记')) pass('政策 PASS 注明无演示标记')
  else fail(`政策 PASS 必须注明无演示标记: ${policyClean.trim()}`)
  const agencyClean = expectLine(happyTable.stdout, '/kiosk/offline-agencies', 'PASS', '线下机构无「（演示）」为 PASS')
  if (agencyClean.includes('无演示标记')) pass('线下机构 PASS 注明无演示标记')
  else fail(`线下机构 PASS 必须注明无演示标记: ${agencyClean.trim()}`)
  for (const path of [
    '/api/v1/jobs?pageSize=50',
    '/api/v1/job-fairs?pageSize=50',
    '/api/v1/policies?pageSize=50',
    '/api/v1/kiosk/offline-agencies?pageSize=50',
  ]) {
    if (seenPaths.includes(path)) pass(`实际请求了 ${path}`)
    else fail(`未请求 ${path}`)
  }
  if (!/expect-sha=deadbeef/.test(happyTable.stdout || '')) fail('未打印 --expect-sha')
  else pass('报告头含 expect-sha')
  const aiLine = expectLine(happyTable.stdout, '/kiosk/legal/ai_disclaimer', 'PASS', '已激活的 ai_disclaimer 为 PASS')
  if (aiLine.includes('200 且 data 非空')) pass('ai_disclaimer PASS 说明与另外两份相同')
  else fail(`ai_disclaimer 通过说明必须与另外两份相同: ${aiLine.trim() || '(该行未出现)'}`)
  if (seenPaths.includes('/api/v1/kiosk/legal/ai_disclaimer')) pass('实际请求了 /api/v1/kiosk/legal/ai_disclaimer')
  else fail('未请求 /api/v1/kiosk/legal/ai_disclaimer')

  const happyJson = await runProbe(port, ['--json'])
  expectExit(happyJson, 0, '合规桩 --json')
  let report
  try {
    report = JSON.parse(happyJson.stdout)
  } catch (err) {
    fail(`--json 不是合法 JSON：${err.message}`)
    report = null
  }
  if (report) {
    if (report.summary.fail === 0) pass('--json summary.fail=0')
    else fail(`--json summary.fail=${report.summary.fail}`)
    if (report.expectSha === 'deadbeef') pass('--json 含 expectSha')
    else fail('--json 缺少 expectSha')
  }

  console.log('\n=== 变异：/health degraded 非空 ===')
  mutation = 'degraded'
  const degraded = await runProbe(port)
  process.stdout.write(degraded.stdout || '')
  expectExit(degraded, 1, 'degraded 非空')
  if (/GET \/api\/v1\/health\s+FAIL/.test(degraded.stdout || '')) pass('表中 health 为 FAIL')
  else fail('degraded 非空时表中 health 应为 FAIL')

  console.log('\n=== 恢复后合规桩 ===')
  mutation = 'ok'
  expectExit(await runProbe(port, ['--json']), 0, 'degraded 恢复')

  console.log('\n=== 变异：/kiosk/legal/unknown_type 回 200 ===')
  mutation = 'unknown_ok'
  const unknown = await runProbe(port)
  process.stdout.write(unknown.stdout || '')
  expectExit(unknown, 1, 'unknown_type 回 200')
  if (/GET \/api\/v1\/kiosk\/legal\/unknown_type\s+FAIL/.test(unknown.stdout || '')) {
    pass('表中 unknown_type 为 FAIL')
  } else fail('unknown_type 回 200 时表中该项应为 FAIL')

  console.log('\n=== 变异：/companies 里留着开发期演示数据 ===')
  // 这一条断的是「判得对」，不是「判得响」：演示数据是内容问题不是缺陷，
  // 所以必须 WARN —— 判成 FAIL 会让巡检退出码变红、把内容问题混进故障里；
  // 判成 PASS 则等于默许演示公司挂在生产上给用户看。
  mutation = 'companies_demo'
  const demo = await runProbe(port)
  process.stdout.write(demo.stdout || '')
  expectExit(demo, 0, '演示数据只 WARN 不改变退出码')
  const demoLine = (demo.stdout || '').split('\n').find((l) => l.includes('/api/v1/companies')) || ''
  if (/\sWARN\s/.test(demoLine)) pass('表中 companies 为 WARN')
  else fail(`留着演示数据时 companies 应为 WARN,实际: ${demoLine.trim() || '(该行未出现)'}`)
  // 锚在**桩里那家公司的名字**上,不是锚在「演示」两个字上——
  // 「其中 N 条带演示标记」这句里本来就有「演示」,拿它当判据的话,
  // 把名字整段删掉断言照样过(反向变异 M3 实测:退出码 0,漏了)。
  if (demoLine.includes('未来智造科技有限公司')) pass('WARN 说明里点名了是哪几家')
  else fail(`WARN 说明必须点名是哪几家,否则负责人不知道去删哪条。实际: ${demoLine.trim()}`)

  console.log('\n=== 反向：企业干净时必须 PASS,不能一律 WARN ===')
  mutation = 'ok'
  const clean = await runProbe(port)
  const cleanLine = (clean.stdout || '').split('\n').find((l) => l.includes('/api/v1/companies')) || ''
  if (/\sPASS\s/.test(cleanLine)) pass('表中 companies 干净时为 PASS')
  else fail(`企业干净时应为 PASS,实际: ${cleanLine.trim() || '(该行未出现)'}`)

  console.log('\n=== 四项公开列表带「（演示）」必须 WARN，并点名 ===')
  // 与企业那条一样：内容问题不是故障，退出码保持 0。
  // 锚在夹具名字上，不锚在说明文字里的「演示」。
  mutation = 'demo_all'
  const marked = await runProbe(port)
  process.stdout.write(marked.stdout || '')
  expectExit(marked, 0, '四项演示标记只 WARN 不改变退出码')
  const markedCases = [
    ['/api/v1/jobs?', '仓库管理员（演示）', '岗位'],
    ['/api/v1/job-fairs', '市人社招聘会来源（演示）', '招聘会'],
    ['/api/v1/policies', '灵活就业补贴说明（演示）', '政策'],
    ['/kiosk/offline-agencies', '经十路（演示）1号', '线下机构'],
  ]
  for (const [needle, name, label] of markedCases) {
    const line = expectLine(marked.stdout, needle, 'WARN', `表中 ${label} 为 WARN`)
    if (line.includes(name)) pass(`${label} WARN 点名了 ${name}`)
    else fail(`${label} WARN 必须点名。实际: ${line.trim() || '(该行未出现)'}`)
  }

  console.log('\n=== 招聘会不带「（演示）」必须 PASS（阳性对照） ===')
  mutation = 'fairs_clean'
  const fairCleanRun = await runProbe(port)
  const fairCleanLine = expectLine(fairCleanRun.stdout, '/api/v1/job-fairs', 'PASS', '招聘会干净时为 PASS')
  if (fairCleanLine.includes('无演示标记')) pass('招聘会 PASS 注明无演示标记')
  else fail(`招聘会 PASS 必须注明无演示标记: ${fairCleanLine.trim()}`)
  expectExit(fairCleanRun, 0, '招聘会干净不改变退出码')

  console.log('\n=== 四项空列表为 INFO；线下机构裸数组 [] 也算空 ===')
  mutation = 'lists_empty'
  const emptyRun = await runProbe(port)
  expectExit(emptyRun, 0, '空列表不改变退出码')
  for (const [needle, label] of [
    ['/api/v1/jobs?', '岗位'],
    ['/api/v1/job-fairs', '招聘会'],
    ['/api/v1/policies', '政策'],
    ['/kiosk/offline-agencies', '线下机构'],
  ]) {
    const line = expectLine(emptyRun.stdout, needle, 'INFO', `${label} 空列表为 INFO`)
    if (line.includes('total=0（内容录入是负责人的事）')) pass(`${label} INFO 说明是内容录入`)
    else fail(`${label} 空列表说明不对: ${line.trim() || '(该行未出现)'}`)
  }

  console.log('\n=== 线下机构裸数组（非空）里的「（演示）」必须 WARN ===')
  mutation = 'agencies_bare_demo'
  const bare = await runProbe(port)
  expectExit(bare, 0, '裸数组演示标记只 WARN')
  const bareLine = expectLine(bare.stdout, '/kiosk/offline-agencies', 'WARN', '裸数组线下机构为 WARN')
  if (bareLine.includes('槐荫街道职介（演示）')) pass('裸数组 WARN 点名了机构')
  else fail(`裸数组 WARN 必须点名。实际: ${bareLine.trim() || '(该行未出现)'}`)

  console.log('\n=== ai_disclaimer 未激活（200 且 data=null）必须 FAIL ===')
  // LegalController 对合法类型一律 200，未激活时 data 为 null，不是 404。
  // 判据与 privacy_policy / terms_of_service 相同：200 且 data 非空，否则 FAIL。
  mutation = 'ai_disclaimer_off'
  const aiOff = await runProbe(port)
  process.stdout.write(aiOff.stdout || '')
  expectExit(aiOff, 1, 'ai_disclaimer 未激活')
  const aiOffLine = expectLine(aiOff.stdout, '/kiosk/legal/ai_disclaimer', 'FAIL', '表中 ai_disclaimer 未激活为 FAIL')
  if (aiOffLine.includes('data 为空')) pass('未激活时按 data 为空 FAIL（不是把 200 当成通过）')
  else fail(`未激活必须因 data 为空 FAIL。实际: ${aiOffLine.trim() || '(该行未出现)'}`)

  console.log('\n=== --strict：企业 1 条且无演示标记必须 FAIL，退出码非 0 ===')
  // 岗位、招聘会在这个夹具里是 0。企业这一行若被改成 PASS，退出码会回到 0。
  mutation = 'companies_one'
  const strictOne = await runProbe(port, ['--strict'])
  process.stdout.write(strictOne.stdout || '')
  expectExit(strictOne, 1, '--strict 企业数为 1')
  const strictOneLine = expectLine(strictOne.stdout, '/api/v1/companies', 'FAIL', '--strict 下企业数为 1 为 FAIL')
  if (/\sFAIL\s/.test(strictOneLine) && strictOneLine.includes('total=1')) pass('--strict 企业 FAIL 写明 total=1')
  else fail(`--strict 企业 FAIL 必须写明条数。实际: ${strictOneLine.trim() || '(该行未出现)'}`)
  if (/FAIL 1\b/.test(strictOne.stdout || '')) pass('--strict 企业数为 1 时只有这一条 FAIL')
  else fail('企业数为 1 的 FAIL 必须是唯一失败项，否则退出码不是被这一条拉红的')

  console.log('\n=== --strict：岗位、招聘会、企业都是 0 且没有演示标记时 PASS ===')
  mutation = 'recruitment_zero'
  const strictZero = await runProbe(port, ['--strict'])
  process.stdout.write(strictZero.stdout || '')
  expectExit(strictZero, 0, '--strict 三项为 0')
  for (const [needle, label] of [
    ['/api/v1/jobs?', '岗位'],
    ['/api/v1/job-fairs', '招聘会'],
    ['/api/v1/companies', '企业'],
  ]) {
    const line = expectLine(strictZero.stdout, needle, 'PASS', `--strict 下${label} total=0 为 PASS`)
    if (line.includes('total=0') && line.includes('无演示标记')) pass(`--strict ${label} PASS 写明 total=0 且无演示标记`)
    else fail(`--strict ${label} PASS 说明不对: ${line.trim() || '(该行未出现)'}`)
  }
  if (/FAIL 0\b/.test(strictZero.stdout || '')) pass('--strict 三项为 0 时 FAIL 计数为 0')
  else fail('--strict 三项为 0 且无演示标记时不得有 FAIL')

  console.log('\n=== --strict：政策里的全角「（演示）」必须 FAIL（条数规则不管政策） ===')
  mutation = 'policy_demo_only'
  const strictPolicy = await runProbe(port, ['--strict'])
  process.stdout.write(strictPolicy.stdout || '')
  expectExit(strictPolicy, 1, '--strict 政策演示标记')
  const strictPolicyLine = expectLine(strictPolicy.stdout, '/api/v1/policies', 'FAIL', '--strict 下政策演示标记为 FAIL')
  if (strictPolicyLine.includes('灵活就业补贴说明（演示）')) pass('--strict 政策 FAIL 点名了摘要')
  else fail(`--strict 政策 FAIL 必须点名。实际: ${strictPolicyLine.trim() || '(该行未出现)'}`)

  console.log('\n=== 不带 --strict：企业数为 1 仍是原来的 PASS / WARN，退出码 0 ===')
  // 无标记的 1 条原来就是 PASS「无演示标记」（条数本身不报）。
  // 带演示标记的 1 条原来就是 WARN，退出码仍是 0。total=0 才是 INFO，见上面的空列表用例。
  mutation = 'companies_one'
  const looseOne = await runProbe(port)
  expectExit(looseOne, 0, '不带 --strict 企业数为 1 不改变退出码')
  const looseOneLine = expectLine(looseOne.stdout, '/api/v1/companies', 'PASS', '不带 --strict 企业 1 条无标记仍为 PASS')
  if (looseOneLine.includes('total=1，无演示标记')) pass('不带 --strict 的企业 PASS 说明与原来逐字一致')
  else fail(`不带 --strict 时企业 1 条无标记必须仍是「total=1，无演示标记」。实际: ${looseOneLine.trim() || '(该行未出现)'}`)

  mutation = 'companies_one_demo'
  const looseDemo = await runProbe(port)
  process.stdout.write(looseDemo.stdout || '')
  expectExit(looseDemo, 0, '不带 --strict 企业 1 条带标记不改变退出码')
  const looseDemoLine = expectLine(looseDemo.stdout, '/api/v1/companies', 'WARN', '不带 --strict 企业 1 条带标记仍为 WARN')
  if (looseDemoLine.includes('未来智造科技有限公司')) pass('不带 --strict 的 WARN 仍点名企业')
  else fail(`不带 --strict 时带标记的企业必须仍 WARN 并点名。实际: ${looseDemoLine.trim() || '(该行未出现)'}`)

  console.log('\n=== 恢复后合规桩 ===')
  mutation = 'ok'
  expectExit(await runProbe(port, ['--json']), 0, 'unknown_type 恢复')
} finally {
  await new Promise((resolve) => server.close(resolve))
}

if (failures > 0) {
  console.error(`\nverify-prod-readonly-probe: ${failures} FAIL`)
  process.exit(1)
}
console.log('\nverify-prod-readonly-probe: ALL PASS')
process.exit(0)
