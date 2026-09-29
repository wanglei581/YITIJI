#!/usr/bin/env node
// verify:legal-docs-preflight —— 真跑发布前法务文档预检（部署脚本 3d 步）
//
// 起一个本地 HTTP 服务模拟线上 API 的 GET /kiosk/legal/:type，按场景返回，逐个断言
// services/api/scripts/preflight-legal-docs.mjs 的退出码与输出：三份齐全才通过；缺一份、
// 没有发布时间、正文为空、HTTP 错误、不是 JSON、读不到、超时一律失败；日志里不出现正文。
// 隐私政策还要有单独成行的「未满十四周岁」专章标题：缺了、改了一个字、或这串字只夹在
// 段落里，都要失败；带「六、」「第六章」或 Markdown `#` 的标题行要通过。
// 场景编进 base-url 的路径里（/s/<场景>/api/v1），一个服务即可。
// 只用 node 内置模块，可在 pnpm install 之前跑（CI「Repository integrity gate」步）。
// 子进程必须用异步 execFile：同步调用会卡住同一进程里的本地服务，永远等不到响应。

import { execFile } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MINOR_PRIVACY_SECTION_TITLE } from '../services/api/scripts/preflight-legal-docs.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT = join(repoRoot, 'services/api/scripts/preflight-legal-docs.mjs')
const SECRET_BODY = '正文不应出现在发布日志里'
const TYPES = ['terms_of_service', 'privacy_policy', 'ai_disclaimer']
// 样本里的标题钉住预检脚本导出的那一处常量。改常量而不同时改这里，下面的通过场景会红。
const MINORS_TITLE = '未满十四周岁未成年人个人信息处理规则'
const MINORS_MISSING = `隐私政策里缺少『${MINORS_TITLE}』这一章（或标题被改了字），自我探索同意页会链接不到。请在后台发布带这一章的新版本隐私政策后再发布。`

let failures = 0
const pass = (m) => console.log(`  PASS ${m}`)
const fail = (m, detail = '') => {
  failures += 1
  console.error(`  FAIL ${m}${detail ? `\n    ${detail.replace(/\n/g, '\n    ')}` : ''}`)
}
const check = (ok, m, detail) => (ok ? pass(m) : fail(m, detail))

/** services/api/src 里 sectionTitle 的字符串字面量。注释不算。没有则返回空数组。 */
function sectionTitleLiterals(dir) {
  const found = []
  const re = /\bsectionTitle\b\s*[:=]\s*(['"])([^'"]*)\1/g
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist') continue
        walk(path)
        continue
      }
      if (!/\.(ts|tsx|mts|js|mjs|cjs)$/.test(entry.name)) continue
      const code = readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
      re.lastIndex = 0
      let match = re.exec(code)
      while (match) {
        found.push({ file: path, value: match[2] })
        match = re.exec(code)
      }
    }
  }
  walk(dir)
  return found
}

const published = (content) => ({ success: true, data: { content, version: '2026-10-pilot-1', publishedAt: '2026-10-10T00:00:00.000Z' } })
const good = (type) => published(type === 'privacy_policy' ? privacyContent(MINORS_TITLE) : `${SECRET_BODY}（${type}）`)

/** 专章标题独占一段。middle 可以是多行，用来把标题夹进段落。 */
function privacyContent(middle) {
  return [
    `${SECRET_BODY}（privacy_policy）`,
    '',
    '一、我们如何收集信息',
    '',
    middle,
    '',
    '二、联系我们',
    '',
    '请发邮件。',
  ].join('\n')
}

const privacyDoc = (middle) => (type) => ({ status: 200, body: type === 'privacy_policy' ? published(privacyContent(middle)) : good(type) })

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
  'privacy-no-minors': privacyDoc('我们收集账号与联系方式，用于完成打印。'),
  'privacy-minors-typo': privacyDoc('未满十四周岁未成年人个人信息处理规定'),
  'privacy-minors-inline': privacyDoc([
    '我们按照未满十四周岁未成年人个人信息处理规则处理相关信息，请监护人阅读本段。',
    MINORS_TITLE,
    '上面这一行夹在段落里，不是单独成行的标题。',
  ].join('\n')),
  'privacy-minors-enum': privacyDoc(`六、${MINORS_TITLE}`),
  'privacy-minors-chapter': privacyDoc(`第六章${MINORS_TITLE}`),
  'privacy-minors-markdown': privacyDoc(`# ${MINORS_TITLE}`),
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
    check(r.code === 0 && !r.out.includes(MINORS_TITLE), '隐私政策含这一章时通过，且日志不打印该标题', r.out)
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
  {
    const preflightSrc = readFileSync(SCRIPT, 'utf8')
    const occurrences = preflightSrc.split(MINORS_TITLE).length - 1
    check(MINOR_PRIVACY_SECTION_TITLE === MINORS_TITLE && occurrences === 1, '专章标题只在预检脚本里定义一处，且与样本逐字相同', `常量=${MINOR_PRIVACY_SECTION_TITLE} 出现 ${occurrences} 次`)
  }
  {
    const r = await run(['--base-url', base('privacy-no-minors')])
    check(r.code === 1 && r.out.includes(MINORS_MISSING) && r.out.includes('未满十四周岁') && !r.out.includes(SECRET_BODY), '隐私政策缺少这一章时失败，并说明同意页会链接不到', r.out)
  }
  {
    const r = await run(['--base-url', base('privacy-minors-typo')])
    check(r.code === 1 && r.out.includes('未满十四周岁') && !r.out.includes(SECRET_BODY), '标题改了一个字时失败', r.out)
  }
  {
    const r = await run(['--base-url', base('privacy-minors-inline')])
    check(r.code === 1 && r.out.includes('未满十四周岁') && !r.out.includes(SECRET_BODY), '这串字只出现在正文句子里、不是单独成行的标题时失败', r.out)
  }
  {
    const r = await run(['--base-url', base('privacy-minors-enum')])
    check(r.code === 0 && !r.out.includes(SECRET_BODY), '带「六、」前缀的标题行通过', r.out)
  }
  {
    const r = await run(['--base-url', base('privacy-minors-chapter')])
    check(r.code === 0 && !r.out.includes(SECRET_BODY), '带「第六章」前缀的标题行通过', r.out)
  }
  {
    const r = await run(['--base-url', base('privacy-minors-markdown')])
    check(r.code === 0 && !r.out.includes(SECRET_BODY), 'Markdown # 标题通过', r.out)
  }
  {
    const literals = sectionTitleLiterals(join(repoRoot, 'services/api/src'))
    if (literals.length === 0) {
      console.log('后端常量尚未合入，跳过对齐检查')
    } else {
      const bad = literals.filter((item) => item.value !== MINOR_PRIVACY_SECTION_TITLE)
      check(bad.length === 0, 'services/api/src 的 sectionTitle 与预检常量逐字相同', bad.map((item) => `${item.file} = ${item.value}`).join('\n'))
    }
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
