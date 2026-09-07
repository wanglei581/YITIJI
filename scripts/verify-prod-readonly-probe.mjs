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
  '/kiosk/legal/privacy_policy',
  '/kiosk/legal/terms_of_service',
  '/kiosk/legal/unknown_type',
  '/terminals/session-token',
  '/admin/alerts',
]) {
  if (src.includes(needle)) pass(`检查项含 ${needle}`)
  else fail(`缺少真实端点 ${needle}`)
}

if (!src.includes('15000') && !src.includes('15_000')) fail('每项超时必须是 15s')
else pass('每项超时 15s')

let mutation = 'ok'

function send(res, status, body, contentType = 'application/json; charset=utf-8') {
  const raw = typeof body === 'string' ? body : JSON.stringify(body)
  res.writeHead(status, {
    'content-type': contentType,
    'content-length': Buffer.byteLength(raw),
    connection: 'close',
  })
  res.end(raw)
}

function handle(req, res) {
  const url = new URL(req.url || '/', 'http://127.0.0.1')
  const path = url.pathname
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
    send(res, 200, { data: [{ id: 'j1' }, { id: 'j2' }, { id: 'j3' }], pagination: { page: 1, pageSize: 20, total: 3, totalPages: 1 } })
    return
  }
  if (req.method === 'GET' && path === '/api/v1/job-fairs') {
    send(res, 200, { data: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 } })
    return
  }
  if (req.method === 'GET' && path === '/api/v1/policies') {
    send(res, 200, { data: [{ id: 'p1' }, { id: 'p2' }], pagination: { page: 1, pageSize: 200, total: 2, totalPages: 1 } })
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

  console.log('\n=== 本地桩：合规响应 ===')
  mutation = 'ok'
  const happyTable = await runProbe(port)
  process.stdout.write(happyTable.stdout || '')
  expectExit(happyTable, 0, '合规桩')
  if (!/PASS \d+ \/ WARN \d+ \/ FAIL \d+/.test(happyTable.stdout || '')) fail('合规桩未打印 PASS/WARN/FAIL 汇总行')
  else pass('合规桩打印汇总行')
  if (!/total=0（内容录入是负责人的事）/.test(happyTable.stdout || '')) fail('total=0 应标 INFO 而不是 FAIL')
  else pass('招聘会 total=0 为 INFO')
  if (!/expect-sha=deadbeef/.test(happyTable.stdout || '')) fail('未打印 --expect-sha')
  else pass('报告头含 expect-sha')

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
