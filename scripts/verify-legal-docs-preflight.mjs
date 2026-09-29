#!/usr/bin/env node
// verify:legal-docs-preflight —— 真跑发布前法务文档预检（部署脚本 3d 步）
//
// 起一个本地 HTTP 服务模拟线上 API 的 GET /kiosk/legal/:type，按场景返回，逐个断言
// services/api/scripts/preflight-legal-docs.mjs 的退出码与输出：三份齐全才通过；缺一份、
// 没有发布时间、正文为空、HTTP 错误、不是 JSON、读不到、超时一律失败；日志里不出现正文。
// 场景编进 base-url 的路径里（/s/<场景>/api/v1），一个服务即可。
// 只用 node 内置模块，可在 pnpm install 之前跑（CI「Repository integrity gate」步）。
// 子进程必须用异步 execFile：同步调用会卡住同一进程里的本地服务，永远等不到响应。

import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT = join(repoRoot, 'services/api/scripts/preflight-legal-docs.mjs')
const SECRET_BODY = '正文不应出现在发布日志里'
const TYPES = ['terms_of_service', 'privacy_policy', 'ai_disclaimer']

let failures = 0
const pass = (m) => console.log(`  PASS ${m}`)
const fail = (m, detail = '') => {
  failures += 1
  console.error(`  FAIL ${m}${detail ? `\n    ${detail.replace(/\n/g, '\n    ')}` : ''}`)
}
const check = (ok, m, detail) => (ok ? pass(m) : fail(m, detail))

const good = (type) => ({ success: true, data: { content: `${SECRET_BODY}（${type}）`, version: '2026-10-pilot-1', publishedAt: '2026-10-10T00:00:00.000Z' } })

/** 场景 → 每个类型的响应。返回 { status, body }；body 为字符串时原样写出。 */
const SCENARIOS = {
  'all-ok': (type) => ({ status: 200, body: good(type) }),
  'privacy-null': (type) => ({ status: 200, body: type === 'privacy_policy' ? { success: true, data: null } : good(type) }),
  'ai-no-published': (type) => ({ status: 200, body: type === 'ai_disclaimer' ? { success: true, data: { ...good(type).data, publishedAt: null } } : good(type) }),
  'terms-empty': (type) => ({ status: 200, body: type === 'terms_of_service' ? { success: true, data: { ...good(type).data, content: '   ' } } : good(type) }),
  'terms-500': (type) => (type === 'terms_of_service' ? { status: 500, body: { success: false } } : { status: 200, body: good(type) }),
  'not-json': () => ({ status: 200, body: '<html>nginx</html>' }),
  'not-success': () => ({ status: 200, body: { success: false, data: null } }),
  slow: (type) => ({ status: 200, body: good(type), delayMs: 1500 }),
}

const requests = []
const server = createServer((req, res) => {
  const m = /^\/s\/([^/]+)\/api\/v1\/kiosk\/legal\/([a-z_]+)$/.exec(req.url ?? '')
  requests.push(req.url)
  const scenario = m && SCENARIOS[m[1]]
  if (!scenario) {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end('{"success":false}')
    return
  }
  const { status, body, delayMs = 0 } = scenario(m[2])
  setTimeout(() => {
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(typeof body === 'string' ? body : JSON.stringify(body))
  }, delayMs)
})

function run(args) {
  return new Promise((resolve) => {
    execFile(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', timeout: 20000 }, (error, stdout, stderr) => {
      resolve({ code: error ? (typeof error.code === 'number' ? error.code : -1) : 0, out: `${stdout}\n${stderr}` })
    })
  })
}

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
const base = (scenario) => `http://127.0.0.1:${port}/s/${scenario}/api/v1`

try {
  {
    requests.length = 0
    const r = await run(['--base-url', base('all-ok')])
    check(r.code === 0 && r.out.includes('LEGAL DOCS PREFLIGHT OK: 3 docs'), '三份都已激活时通过', r.out)
    check((r.out.match(/^OK {2}.+版本 2026-10-pilot-1/gm) ?? []).length === 3, '逐份打印三行 OK（含版本号）', r.out)
    check(!r.out.includes(SECRET_BODY), '日志里不出现文档正文', r.out)
    const asked = requests.map((url) => url.split('/').pop()).sort()
    check(JSON.stringify(asked) === JSON.stringify([...TYPES].sort()), '只请求三类文档各一次', requests.join(', '))
  }
  {
    const r = await run(['--base-url', `${base('all-ok')}/`])
    check(r.code === 0, 'base-url 带结尾斜杠也能用', r.out)
  }
  const failing = [
    ['privacy-null', '隐私政策', '没有已激活的版本', '隐私政策没有已激活版本时失败'],
    ['ai-no-published', 'AI 服务免责声明', '版本信息不完整', 'AI 服务免责声明没有发布时间时失败'],
    ['terms-empty', '用户服务协议', '版本信息不完整', '用户服务协议正文为空时失败'],
    ['terms-500', '用户服务协议', 'HTTP 500', '接口返回 HTTP 500 时失败'],
    ['not-json', '用户服务协议', '不是 JSON', '接口返回的不是 JSON 时失败'],
    ['not-success', '隐私政策', '没有返回成功', '接口没有返回成功时失败'],
  ]
  for (const [scenario, label, reason, title] of failing) {
    const r = await run(['--base-url', base(scenario)])
    check(r.code === 1 && r.out.includes(`缺  ${label}`) && r.out.includes(reason) && r.out.includes('LEGAL DOCS PREFLIGHT FAILED'), title, r.out)
  }
  {
    const r = await run(['--base-url', base('slow'), '--timeout-ms', '300'])
    check(r.code === 1 && r.out.includes('读不到线上 API') && r.out.includes('超时'), '接口超时时失败（不无限等待）', r.out)
  }
  {
    const closed = createServer()
    await new Promise((resolve) => closed.listen(0, '127.0.0.1', resolve))
    const closedPort = closed.address().port
    await new Promise((resolve) => closed.close(resolve))
    const r = await run(['--base-url', `http://127.0.0.1:${closedPort}/api/v1`])
    check(r.code === 1 && r.out.includes('读不到线上 API'), '线上 API 读不到时失败（不当作通过）', r.out)
  }
  {
    const noArgs = await run([])
    const badUrl = await run(['--base-url', 'ftp://example.invalid'])
    const badTimeout = await run(['--base-url', base('all-ok'), '--timeout-ms', '0'])
    check(noArgs.code === 64 && badUrl.code === 64 && badTimeout.code === 64, '参数缺失或不合法时退出 64', `${noArgs.code} ${badUrl.code} ${badTimeout.code}`)
  }
} catch (error) {
  fail(`演练无法运行：${error instanceof Error ? error.message : String(error)}`)
} finally {
  server.closeAllConnections?.()
  await new Promise((resolve) => server.close(resolve))
}

if (failures) {
  console.error(`\nverify:legal-docs-preflight：${failures} 项失败`)
  process.exit(1)
}
console.log('\nverify:legal-docs-preflight 通过')
