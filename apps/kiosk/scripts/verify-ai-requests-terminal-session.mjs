/**
 * 门禁：一体机的「按台计」请求（AI 调用、会员发码）必须带终端会话票。
 *
 * 为什么有这道门：服务端的 AI 每日额度、AI 用量台账、短信每台每日上限，只认
 * x-terminal-id + x-terminal-session-token **验签通过**的终端。一体机此前 AI 请求只带
 * X-Terminal-Id、发码什么终端头都不带 —— 于是单机每日上限对一体机不生效，后台把一体机的 AI
 * 用量记成「无已验签终端」。票只能由 services/terminalAuth.ts 取（它还负责 401 后换票重试），
 * 各封装自己拼 token 会各拼各的、也没有换票。
 *
 * 两段判据，都要过：
 *
 *   一、运行时：真把 terminalAuth.ts 编译出来调 terminalAttributedFetch（只替换 node 装不起来的
 *      依赖），看它实际发出的头 ——
 *        · 本机没有终端身份：一个终端头都不加（手机上的扫码确认页、桌面浏览器照旧能用）；
 *        · 有终端身份：x-terminal-id + x-terminal-session-token 都在，票是存储里的当前票；
 *        · 服务端回 401 TERMINAL_SESSION_INVALID：换一次票，用新票重发，最终拿到重发的结果；
 *        · 别的 401：不换票、不重发，原样交还。
 *
 *   二、接线（TypeScript AST，不按文本猜）：扫 apps/kiosk/src 全部源码，找出所有把 AI 路由 /
 *      发码路由交给「会发请求的函数」的调用点，逐个判定它最终走的是不是终端身份封装：
 *        · 直接调 terminalAttributedFetch / terminalProtectedFetch                 → 合格
 *        · 把这两个之一作为发送函数传进去（call(path, ..., terminalAttributedFetch)）→ 合格
 *        · 调本文件里的封装，封装（连同它调的本文件封装）只经这两个发、不碰裸 fetch → 合格
 *        · 直接 fetch / sendBeacon，或封装里仍有裸 fetch                           → 不合格
 *      带 ${API_BASE_URL} 前缀的 AI 地址哪怕没直接当参数（先放进变量、new URL 再发）也算请求点，
 *      同样要求它就在合格发送函数的参数位上，否则不合格。
 *      豁免只有下面 EXEMPT 一张表，每条写明理由。
 *
 * 纯本地：只读仓库源码、在内存里 import 编译产物，不连数据库 / 网络 / 硬件。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const kioskRoot = fileURLToPath(new URL('..', import.meta.url))
const srcRoot = join(kioskRoot, 'src')
const failures = []
const fail = (message) => failures.push(message)
const ok = (message) => console.log(`  ✓ ${message}`)

// ── 一、运行时 ────────────────────────────────────────────────────────────────

const toDataUrl = (code) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
const transpile = (relativePath) => ts.transpileModule(
  readFileSync(join(kioskRoot, relativePath), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }, fileName: relativePath },
).outputText

function memoryStorage() {
  const map = new Map()
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(String(key), String(value)) },
    removeItem: (key) => { map.delete(key) },
    clear: () => { map.clear() },
  }
}

const TOKEN_KEY = 'terminal_session_token_v1'
let seed = 0

/** 每个场景一份全新的模块实例（模块级 state / refreshInflight 不串场）。 */
async function loadTerminalAuth({ terminalId, respond }) {
  seed += 1
  const envName = `__aiTerminalEnv_${seed}`
  const idName = `__aiTerminalId_${seed}`
  globalThis[envName] = { VITE_TERMINAL_AGENT_LOCAL_URL: '', VITE_TERMINAL_AGENT_BRIDGE_TOKEN: '', VITE_E2E_MOCK_TERMINAL_SESSION_TOKEN: '' }
  globalThis[idName] = terminalId
  const session = memoryStorage()
  const calls = []
  globalThis.window = {
    sessionStorage: session,
    location: { href: 'http://127.0.0.1:5173/', origin: 'http://127.0.0.1:5173', pathname: '/', search: '', hash: '' },
    history: { state: null, replaceState() {} },
    setTimeout: (fn, ms) => { const id = setTimeout(fn, ms); id?.unref?.(); return id },
    clearTimeout: (id) => clearTimeout(id),
  }
  globalThis.fetch = async (input, init = {}) => {
    const headers = new Headers(init.headers)
    const call = { url: String(input), headers: Object.fromEntries(headers.entries()) }
    calls.push(call)
    const { status, body } = respond(call, calls.length)
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  }
  const stubs = {
    "from './api/client'": "export const API_BASE_URL = '/api/v1'\nexport const API_MODE = 'http'\n",
    "from './api/screensaver'": `export function getTerminalId() { return globalThis[${JSON.stringify(idName)}] }\n`,
    "from './api/httpAdapter'": 'export class ApiHttpError extends Error { constructor(code, message, status) { super(message); this.code = code; this.status = status } }\n',
    "from './api/throwHttpError'": 'export async function readHttpError(r) { const b = await r.json().catch(() => ({})); return { code: b?.error?.code ?? "UNKNOWN_ERROR", message: b?.error?.message ?? "" } }\n',
    "from '../auth/kioskSensitiveSession'": 'export function clearKioskSensitiveSession() {}\nexport function clearKioskSharedDeviceResidue() {}\n',
  }
  let code = `${transpile('src/services/terminalAuth.ts')}\n// ${seed}\n`.replaceAll('import.meta.env', `globalThis[${JSON.stringify(envName)}]`)
  for (const [from, stub] of Object.entries(stubs)) {
    if (!code.includes(from)) fail(`运行时：terminalAuth.ts 不再从 ${from.slice(5)} 引入，替身表需要同步（本段无法判定）`)
    code = code.replaceAll(from, `from '${toDataUrl(stub)}'`)
  }
  const mod = await import(toDataUrl(code))
  return { mod, session, calls }
}

const OK = { status: 200, body: { ok: true } }
const SESSION_INVALID = { status: 401, body: { error: { code: 'TERMINAL_SESSION_INVALID', message: '终端安全会话无效' } } }

async function runtimeChecks() {
  // 1. 没有终端身份：一个终端头都不加。
  {
    const { mod, calls } = await loadTerminalAuth({ terminalId: '', respond: () => OK })
    if (typeof mod.terminalAttributedFetch !== 'function') { fail('运行时：terminalAuth.ts 没有导出 terminalAttributedFetch'); return }
    await mod.terminalAttributedFetch('/api/v1/assistant/chat', { method: 'POST', headers: { Accept: 'application/json' } })
    const sent = calls[0]?.headers ?? {}
    if (calls.length !== 1 || 'x-terminal-id' in sent || 'x-terminal-session-token' in sent || sent.accept !== 'application/json') {
      fail(`运行时：无终端身份时应原样发出、不加终端头，实际 ${JSON.stringify(calls)}`)
    } else ok('无终端身份：原样发出，不加终端头')
  }
  // 2. 有终端身份 + 存量票：两个头都在，调用方自己的头保留。
  {
    const { mod, session, calls } = await loadTerminalAuth({ terminalId: 'KSK-T1', respond: () => OK })
    session.setItem(TOKEN_KEY, 'stored-ticket-1')
    await mod.terminalAttributedFetch('/api/v1/resume/parse', { method: 'POST', headers: { 'X-Resume-Parse-Intent': 'k' } })
    const sent = calls[0]?.headers ?? {}
    if (sent['x-terminal-id'] !== 'KSK-T1' || sent['x-terminal-session-token'] !== 'stored-ticket-1' || sent['x-resume-parse-intent'] !== 'k') {
      fail(`运行时：有终端身份时必须带 x-terminal-id + x-terminal-session-token 且保留调用方的头，实际 ${JSON.stringify(sent)}`)
    } else ok('有终端身份：带 x-terminal-id + x-terminal-session-token，调用方的头保留')
  }
  // 3. 401 TERMINAL_SESSION_INVALID：换一次票，用新票重发。
  {
    const { mod, session, calls } = await loadTerminalAuth({
      terminalId: 'KSK-T1',
      respond: (call, n) => {
        if (call.url.endsWith('/terminals/session-token/refresh')) return { status: 200, body: { sessionToken: 'fresh-ticket-2' } }
        return n === 1 ? SESSION_INVALID : OK
      },
    })
    session.setItem(TOKEN_KEY, 'expired-ticket-1')
    const response = await mod.terminalAttributedFetch('/api/v1/member/auth/sms-code', { method: 'POST' })
    const urls = calls.map((c) => c.url.replace('http://127.0.0.1:5173', ''))
    const retried = calls[2]?.headers ?? {}
    if (response.status !== 200 || urls.length !== 3 || !urls[1].endsWith('/terminals/session-token/refresh')
      || calls[0].headers['x-terminal-session-token'] !== 'expired-ticket-1' || retried['x-terminal-session-token'] !== 'fresh-ticket-2') {
      fail(`运行时：401 TERMINAL_SESSION_INVALID 后应换票并用新票重发一次，实际 status=${response.status} urls=${JSON.stringify(urls)} retry=${JSON.stringify(retried)}`)
    } else ok('401 TERMINAL_SESSION_INVALID：换一次票，用新票重发，拿到重发结果')
  }
  // 4. 别的 401（会员登录态失效等）：不换票、不重发。
  {
    const { mod, session, calls } = await loadTerminalAuth({
      terminalId: 'KSK-T1',
      respond: () => ({ status: 401, body: { error: { code: 'MEMBER_SESSION_INVALID', message: '请重新登录' } } }),
    })
    session.setItem(TOKEN_KEY, 'ticket-1')
    const response = await mod.terminalAttributedFetch('/api/v1/resume/generate', { method: 'POST' })
    if (response.status !== 401 || calls.length !== 1) fail(`运行时：非会话票的 401 不应换票重发，实际发了 ${calls.length} 次`)
    else ok('其它 401：不换票、不重发，原样交还')
  }
}

// ── 二、接线 ──────────────────────────────────────────────────────────────────

/**
 * 服务端按台计的路由（去掉 ${API_BASE_URL} 前缀后匹配）。
 * AI 部分取自服务端 @AiUse 标注的控制器前缀；发码只有 POST /member/auth/sms-code
 * （二次验证发码 /member/auth/step-up/sms-code 服务端不按台计，不在此列）。
 * 注意 /resume/parse 等也是一体机页面路由 —— 所以只看「交给会发请求的函数」的调用点，
 * navigate('/resume/parse') 这类不算。
 */
const METERED_PATH = new RegExp([
  '^/resume/(?:parse|records|generate|voice|export|job-fit|career-plan|self-assessment)',
  '^/assistant/',
  '^/advisor/',
  '^/mock-interviews',
  '^/contract-reviews',
  '^/job-fairs/[^/]+/visit-plan',
  '^/jobs/(?:ai/|[^/]+/ai/)',
  '^/trtc/session',
  '^/kiosk/ai/',
  '^/member/auth/sms-code$',
].join('|'))

const TERMINAL_SENDERS = new Set(['terminalAttributedFetch', 'terminalProtectedFetch'])
const RAW_SENDERS = new Set(['fetch', 'sendBeacon'])
/**
 * 只拿地址判断 AI 种类、自己不发请求的函数（地址字面量出现在它的参数里不算一个请求点）。
 * prepareAiDeclaration：C6 使用声明，按地址查 aiUseKindTable 决定要不要先弹年龄 / 录音确认，
 * 真正的请求随后仍经 terminalAttributedFetch 发出（apps/kiosk/src/ai/aiDeclarationGate.ts）。
 */
const NON_REQUEST_CALLEES = new Set(['prepareAiDeclaration'])

/** 豁免：file（相对 apps/kiosk）+ 路由前缀 + 理由。 */
const EXEMPT = [
  {
    file: 'src/hooks/useAiAdvisorCallSession.ts',
    path: '/trtc/session/stop',
    reason: '结束语音会话止损：服务端 @AiUseExempt 且不挂终端守卫，凭停止能力令牌；页面卸载时要能用 keepalive 发出，不能等换票',
  },
]

/** 这些文件里必须找到合格请求点：防止解析失效、改名后本门禁空转成全绿。 */
const REQUIRED_FILES = [
  'src/services/api/aiHttpAdapter.ts',
  'src/services/api/advisor.ts',
  'src/services/api/careerPlan.ts',
  'src/services/api/contractReview.ts',
  'src/services/api/fairVisitPlan.ts',
  'src/services/api/interview.ts',
  'src/services/api/jobAiHttpAdapter.ts',
  'src/services/api/jobFit.ts',
  'src/services/api/selfAssessment.ts',
  'src/hooks/useAiAdvisorCallSession.ts',
  'src/services/auth/memberAuthApi.ts',
]

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name)
    if (statSync(abs).isDirectory()) out.push(...walk(abs))
    else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name) && !name.endsWith('.d.ts')) out.push(abs)
  }
  return out
}

/** 字面量的「路径文本」：模板插值写成 ${...}，再剥掉 ${API_BASE_URL} 前缀。 */
function literalPath(node) {
  let text = null
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) text = node.text
  else if (ts.isTemplateExpression(node)) {
    text = node.head.text + node.templateSpans.map((span) => `\${${span.expression.getText()}}${span.literal.text}`).join('')
  }
  if (text === null) return null
  const prefixed = text.startsWith('${API_BASE_URL}')
  return { path: prefixed ? text.slice('${API_BASE_URL}'.length) : text, prefixed }
}

function calleeName(expr) {
  if (ts.isIdentifier(expr)) return expr.text
  if (ts.isPropertyAccessExpression(expr)) return expr.name.text
  return null
}

function analyzeFile(abs) {
  const rel = relative(kioskRoot, abs).split('\\').join('/')
  const source = readFileSync(abs, 'utf8')
  const sf = ts.createSourceFile(abs, source, ts.ScriptTarget.ES2022, true, abs.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)

  // 1) 本文件的具名函数 → 它直接用到的发送者（调用或引用）与它调的本文件函数。
  const fns = new Map()
  const record = (name, node) => { if (name && !fns.has(name)) fns.set(name, node) }
  const collect = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name) record(node.name.text, node)
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer
      && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) record(node.name.text, node.initializer)
    ts.forEachChild(node, collect)
  }
  collect(sf)

  const direct = new Map()
  for (const [name, node] of fns) {
    const info = { terminal: false, raw: false, calls: new Set() }
    const visit = (n) => {
      if (ts.isCallExpression(n)) {
        const callee = calleeName(n.expression)
        if (callee && RAW_SENDERS.has(callee)) info.raw = true
        if (callee && TERMINAL_SENDERS.has(callee)) info.terminal = true
        if (callee && fns.has(callee) && callee !== name) info.calls.add(callee)
      }
      // 作为值被引用（默认参数 send = fetch、把 terminalAttributedFetch 传给下一层）也算用到。
      if (ts.isIdentifier(n) && !(ts.isCallExpression(n.parent) && n.parent.expression === n)) {
        if (TERMINAL_SENDERS.has(n.text)) info.terminal = true
        if (n.text === 'fetch' && !ts.isPropertyAccessExpression(n.parent)) info.raw = true
      }
      ts.forEachChild(n, visit)
    }
    ts.forEachChild(node, visit)
    direct.set(name, info)
  }
  const closure = (name, seen = new Set()) => {
    if (seen.has(name)) return { terminal: false, raw: false }
    seen.add(name)
    const info = direct.get(name)
    let terminal = info.terminal
    let raw = info.raw
    for (const next of info.calls) {
      const sub = closure(next, seen)
      terminal ||= sub.terminal
      raw ||= sub.raw
    }
    return { terminal, raw }
  }

  // 2) 调用点。
  const points = []
  const judged = new Set()
  const visitCalls = (node) => {
    if (ts.isCallExpression(node)) {
      const callee = calleeName(node.expression)
      if (callee && NON_REQUEST_CALLEES.has(callee)) {
        // 这里的地址只用来查种类，不是请求点；记为已判定，免得被下面的「漏网地址」扫描当成绕过封装。
        for (const arg of node.arguments) if (literalPath(arg)) judged.add(arg)
        ts.forEachChild(node, visitCalls)
        return
      }
      const passesTerminalSender = node.arguments.some((a) => ts.isIdentifier(a) && TERMINAL_SENDERS.has(a.text))
      for (const arg of node.arguments) {
        const lit = literalPath(arg)
        if (!lit || !METERED_PATH.test(lit.path)) continue
        let verdict = null
        if (callee && TERMINAL_SENDERS.has(callee)) verdict = 'ok'
        else if (passesTerminalSender) verdict = 'ok'
        else if (callee && RAW_SENDERS.has(callee)) verdict = 'raw'
        else if (callee && fns.has(callee)) {
          const c = closure(callee)
          if (c.terminal && !c.raw) verdict = 'ok'
          else if (c.terminal || c.raw) verdict = 'raw'
        }
        if (verdict === null) continue // 不会发请求的函数（navigate、go、startsWith…）
        judged.add(arg)
        points.push({ rel, path: lit.path, via: callee, verdict, line: sf.getLineAndCharacterOfPosition(arg.getStart()).line + 1 })
      }
    }
    ts.forEachChild(node, visitCalls)
  }
  visitCalls(sf)

  // 3) 带 ${API_BASE_URL} 前缀、却没落在合格发送函数参数位上的 AI 地址（先进变量 / new URL 再发）。
  const visitStray = (node) => {
    const lit = literalPath(node)
    if (lit && lit.prefixed && METERED_PATH.test(lit.path) && !judged.has(node)) {
      points.push({ rel, path: lit.path, via: null, verdict: 'stray', line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1 })
    }
    ts.forEachChild(node, visitStray)
  }
  visitStray(sf)
  return points
}

function wiringChecks() {
  const points = walk(srcRoot).flatMap(analyzeFile)
  const exempt = (p) => EXEMPT.find((e) => e.file === p.rel && p.path.startsWith(e.path))
  let good = 0
  for (const p of points) {
    if (p.verdict === 'ok') { good += 1; continue }
    const e = exempt(p)
    if (e) { ok(`豁免 ${p.rel}:${p.line} ${p.path}（${e.reason}）`); continue }
    fail(p.verdict === 'stray'
      ? `${p.rel}:${p.line} 按台计的请求地址 ${p.path} 没有直接交给终端身份封装（先放进变量 / new URL 再发的，门禁认不出最终是谁发的，请直接作为 terminalAttributedFetch 的参数）`
      : `${p.rel}:${p.line} ${p.path} 经 ${p.via ?? '?'} 发出，最终走的是裸 fetch —— 必须经 services/terminalAuth.ts 的 terminalAttributedFetch（或 terminalProtectedFetch）带终端会话票`)
  }
  for (const file of REQUIRED_FILES) {
    const hits = points.filter((p) => p.rel === file && p.verdict === 'ok').length
    if (hits === 0) fail(`${file} 里没找到任何合格的按台计请求点 —— 是改名 / 搬家了，还是这里的请求不再经终端身份封装？（本门禁不接受空转）`)
    else ok(`${file}：${hits} 个请求点经终端身份封装`)
  }
  for (const e of EXEMPT) {
    if (!points.some((p) => p.rel === e.file && p.path.startsWith(e.path))) fail(`豁免表里的 ${e.file} ${e.path} 已不存在，请删掉这条豁免`)
  }
  console.log(`  合计 ${good} 个按台计请求点经终端身份封装`)
}

console.log('verify-ai-requests-terminal-session')
await runtimeChecks()
wiringChecks()

if (failures.length > 0) {
  console.error('\nverify-ai-requests-terminal-session failed:')
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('verify-ai-requests-terminal-session passed')
