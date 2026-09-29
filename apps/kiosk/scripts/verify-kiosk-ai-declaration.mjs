/**
 * 门禁：一体机 AI 使用声明（走查 W-16，合规 C6）。
 *
 * 开关打开后，生成类与语音类请求必须带年满 14 周岁声明，语音类还要带录音同意。
 * 声明只对这一次办理有效：清场函数清掉它，开着的确认也不能再把上一位的请求发出去。
 *
 * 三段都要过：
 *   一、版本与请求头常量逐字对照服务端源码（不 import 服务端）。
 *   二、前端路由表与控制器上的 @AiUse / @AiUseExempt 深比较（:param 归一成 :p）。
 *   三、把声明模块和 terminalAuth.ts 编译出来真跑：开关开时确认后带头、拒绝则不发请求、
 *      开关关时不弹也不带头、403 只重问一次、clearKioskSensitiveSession 之后声明失效。
 *
 * 纯本地：只读仓库源码、在内存里 import 编译产物，不连数据库 / 网络 / 硬件。
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const kioskRoot = fileURLToPath(new URL('..', import.meta.url))
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))
const apiSrc = join(repoRoot, 'services/api/src')
const failures = []
const fail = (message) => failures.push(message)
const ok = (message) => console.log(`  ✓ ${message}`)

function read(rel) {
  return readFileSync(join(kioskRoot, rel), 'utf8')
}

function repoRead(rel) {
  return readFileSync(join(repoRoot, rel), 'utf8')
}

function quotedConst(source, name) {
  const match = source.match(new RegExp(`export const ${name} = '([^']*)'`))
  if (!match) fail(`源码里找不到 ${name}`)
  return match?.[1] ?? ''
}

// ── 一、版本与请求头 ──────────────────────────────────────────────────────────

function versionChecks() {
  const privacy = repoRead('services/api/src/member-privacy/member-privacy.service.ts')
  const serverDecl = repoRead('services/api/src/common/privacy/client-declaration.ts')
  const client = read('src/ai/aiDeclarationVersions.ts')
  const pairs = [
    ['CURRENT_AGE_14_PLUS_CONSENT_VERSION', 'AGE_14_PLUS_CONSENT_VERSION'],
    ['CURRENT_VOICE_RECORDING_CONSENT_VERSION', 'VOICE_RECORDING_CONSENT_VERSION'],
  ]
  for (const [serverName, clientName] of pairs) {
    const server = quotedConst(privacy, serverName)
    const local = quotedConst(client, clientName)
    if (!server || server !== local) fail(`版本不一致：服务端 ${serverName}=${server}，一体机 ${clientName}=${local}`)
  }
  const headerPairs = [
    ['AGE_14_PLUS_HEADER', 'AGE_14_PLUS_HEADER'],
    ['AGE_14_PLUS_VERSION_HEADER', 'AGE_14_PLUS_VERSION_HEADER'],
    ['VOICE_RECORDING_HEADER', 'VOICE_RECORDING_HEADER'],
    ['VOICE_RECORDING_VERSION_HEADER', 'VOICE_RECORDING_VERSION_HEADER'],
  ]
  for (const [serverName, clientName] of headerPairs) {
    const server = quotedConst(serverDecl, serverName)
    const local = quotedConst(client, clientName)
    if (!server || server !== local) fail(`请求头不一致：服务端 ${serverName}=${server}，一体机 ${clientName}=${local}`)
  }
  if (quotedConst(client, 'AGE_14_PLUS_FLAG') !== 'declared') fail('年满 14 周岁的声明值必须是 declared')
  if (quotedConst(client, 'VOICE_RECORDING_FLAG') !== 'granted') fail('录音同意的声明值必须是 granted')
  if (failures.length === 0) ok('声明版本与请求头和服务端源码逐字一致')
}

// ── 二、@AiUse 对照 ───────────────────────────────────────────────────────────

const HTTP = new Set(['Get', 'Post', 'Put', 'Patch', 'Delete'])

function walkControllers(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name)
    if (statSync(abs).isDirectory()) out.push(...walkControllers(abs))
    else if (name.endsWith('.controller.ts')) out.push(abs)
  }
  return out
}

function decoratorsOf(node) {
  return ts.canHaveDecorators(node) ? (ts.getDecorators(node) ?? []) : []
}

function calleeName(expr) {
  if (ts.isIdentifier(expr)) return expr.text
  if (ts.isPropertyAccessExpression(expr)) return expr.name.text
  return null
}

function stringArg(call) {
  const arg = call.arguments[0]
  if (!arg) return ''
  if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) return arg.text
  return null
}

function joinPath(prefix, sub) {
  const parts = `${prefix}/${sub}`.split('/').filter(Boolean)
  return `/${parts.join('/')}`
}

function parseServerAiUse() {
  const routes = []
  const problems = []
  for (const file of walkControllers(apiSrc)) {
    const source = readFileSync(file, 'utf8')
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    const visit = (node) => {
      if (ts.isClassDeclaration(node)) {
        let prefix = null
        for (const deco of decoratorsOf(node)) {
          const expr = deco.expression
          if (!ts.isCallExpression(expr) || calleeName(expr.expression) !== 'Controller') continue
          const arg = stringArg(expr)
          if (arg === null) problems.push(`${file}: Controller 参数不是字符串`)
          else prefix = arg
        }
        if (prefix === null) {
          ts.forEachChild(node, visit)
          return
        }
        for (const member of node.members) {
          if (!ts.isMethodDeclaration(member)) continue
          let http = null
          let kind = null
          for (const deco of decoratorsOf(member)) {
            const expr = deco.expression
            if (!ts.isCallExpression(expr)) continue
            const name = calleeName(expr.expression)
            if (name && HTTP.has(name)) {
              const arg = stringArg(expr)
              if (arg === null) problems.push(`${file}: ${name} 参数不是字符串`)
              else http = { method: name.toUpperCase(), sub: arg }
            } else if (name === 'AiUse') {
              const arg = stringArg(expr)
              if (arg === null) problems.push(`${file}: AiUse 参数不是字符串`)
              else kind = arg
            } else if (name === 'AiUseExempt') {
              kind = 'exempt'
            }
          }
          if (http && kind) routes.push({ method: http.method, path: joinPath(prefix, http.sub), kind })
          else if (kind && !http) problems.push(`${file}: ${kind} 没有对应的 HTTP 方法`)
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }
  const seen = new Set()
  for (const route of routes) {
    const key = `${route.method} ${route.path}`
    if (seen.has(key)) problems.push(`重复路由 ${key}`)
    seen.add(key)
  }
  return { routes, problems }
}

function normPath(path) {
  return path.replace(/:[A-Za-z_][A-Za-z0-9_]*/g, ':p')
}

function routeKey(route) {
  return `${route.method} ${normPath(route.path)} ${route.kind}`
}

const toDataUrl = (code) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
const transpile = (relativePath) => ts.transpileModule(
  read(relativePath),
  { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }, fileName: relativePath },
).outputText

async function kindTableChecks() {
  const parsed = parseServerAiUse()
  if (parsed.problems.length > 0) fail(`解析 @AiUse 失败：${parsed.problems.join(' | ')}`)
  if (parsed.routes.length < 40) fail(`@AiUse 路由少得不正常：${parsed.routes.length}`)
  const table = await import(toDataUrl(`${transpile('src/ai/aiUseKindTable.ts')}\n`))
  const local = table.AI_USE_ROUTES.map(routeKey).sort()
  const remote = parsed.routes.map(routeKey).sort()
  const missing = remote.filter((key) => !local.includes(key))
  const extra = local.filter((key) => !remote.includes(key))
  if (missing.length || extra.length || local.length !== remote.length) {
    fail(`种类表与服务端 @AiUse 不一致。缺 ${missing.slice(0, 8).join(', ') || '无'}；多 ${extra.slice(0, 8).join(', ') || '无'}`)
  } else ok(`种类表与服务端 ${remote.length} 条 @AiUse 一致`)

  const cases = [
    ['GET', '/mock-interviews/capabilities/voice', 'read'],
    ['GET', '/mock-interviews/abc', 'read'],
    ['POST', '/trtc/session', 'voice'],
    ['POST', '/trtc/session/stop', 'exempt'],
    ['POST', '/resume/job-fit', 'generate'],
    ['POST', '/resume/job-fit/consent', 'read'],
    ['POST', '/contract-reviews/abc/report', 'generate'],
    ['POST', '/contract-reviews/abc/report/keep', 'export'],
    ['GET', '/resume/records/abc/optimize', 'generate'],
    ['GET', '/contract-reviews/consent-scope', 'read'],
  ]
  for (const [method, path, kind] of cases) {
    const actual = table.lookupAiUseKind(method, path)
    if (actual !== kind) fail(`lookup ${method} ${path} 应为 ${kind}，实际 ${actual}`)
  }
  const tableSource = read('src/ai/aiUseKindTable.ts')
  if (!tableSource.includes('staticCount') || !tableSource.includes('score[0] > best.score[0]')) {
    fail('种类查找必须按静态段数量优先，不能按表顺序先匹配到的参数路由获胜')
  }
  for (const route of table.AI_USE_ROUTES) {
    const concrete = route.path.replace(/:[A-Za-z_][A-Za-z0-9_]*/g, 'abc')
    const actual = table.lookupAiUseKind(route.method, concrete)
    if (actual !== route.kind) fail(`具体路径 ${route.method} ${concrete} 应是 ${route.kind}，实际 ${actual}`)
  }
  if (!failures.some((item) => item.startsWith('lookup') || item.startsWith('具体路径') || item.includes('静态段'))) {
    ok('更具体的路径不会被参数路由盖住')
  }
}

// ── 三、接线（源码） ──────────────────────────────────────────────────────────

const NOTE_FILES = [
  'src/pages/resume/ResumeGeneratePage.tsx',
  'src/pages/resume/ResumeSourcePage.tsx',
  'src/pages/resume/JobFitPage.tsx',
  'src/pages/resume/SelfAssessmentFlow.tsx',
  'src/pages/resume/CareerPlanPage.tsx',
  'src/pages/resume/components/ResumeVoiceInputButton.tsx',
  'src/pages/contract-review/ContractReviewProcessingPage.tsx',
  'src/pages/interview/InterviewSetupPage.tsx',
  'src/pages/interview/session/InterviewAnswerDock.tsx',
  'src/pages/assistant/AssistantPage.tsx',
  'src/pages/assistant/AssistantCallPanel.tsx',
  'src/pages/contract-review/ContractReviewHomePage.tsx',
  'src/pages/job-fairs/FairVisitPlanPage.tsx',
  'src/pages/jobs/components/JobsQxChrome.tsx',
  'src/pages/jobs/components/JobDetailSections.tsx',
  'src/pages/resume/components/resume-deliver/OptimizeReadyBody.tsx',
]

const RETHROW_FILES = [
  'src/services/api/throwHttpError.ts',
  'src/services/api/careerPlan.ts',
  'src/services/api/selfAssessment.ts',
  'src/services/api/interview.ts',
  'src/services/api/jobFit.ts',
  'src/services/api/fairVisitPlan.ts',
]

function sourceChecks() {
  const main = read('src/main.tsx')
  if (!main.includes("import './ai/aiDeclarationInstall'")) fail('main.tsx 必须在发请求前装上使用声明')
  const root = read('src/layouts/KioskRuntimeRoot.tsx')
  for (const needle of ['<KioskBusyProvider>', '<AiDeclarationHost />', '<KioskPrivacyGuard>', '<KioskHidScanGuard />', '<Outlet />']) {
    if (!root.includes(needle)) fail(`KioskRuntimeRoot 缺少 ${needle}`)
  }
  const auth = read('src/services/terminalAuth.ts')
  const imports = [...auth.matchAll(/^import .+$/gm)].map((match) => match[0])
  const expectedImports = [
    "import { clearKioskSensitiveSession, clearKioskSharedDeviceResidue } from '../auth/kioskSensitiveSession'",
    "import { API_BASE_URL, API_MODE } from './api/client'",
    "import { ApiHttpError } from './api/httpAdapter'",
    "import { getTerminalId } from './api/screensaver'",
    "import { readHttpError } from './api/throwHttpError'",
  ]
  if (imports.length !== expectedImports.length || expectedImports.some((line) => !imports.includes(line))) {
    fail(`terminalAuth.ts 的 import 必须仍是原来的五条，实际：${imports.join(' || ')}`)
  }
  if (!auth.includes('export function registerAiDeclarationBridge')) fail('terminalAuth.ts 必须导出 registerAiDeclarationBridge')
  if (!auth.includes('if (!sessionInvalid(error)) return response')) fail('terminalAuth.ts 丢掉了非会话 401 原样交还')
  const sensitive = read('src/auth/kioskSensitiveSession.ts')
  if (!sensitive.includes('AI_DECLARATION_SESSION_KEY')) fail('清场键清单必须包含使用声明')
  if (!sensitive.includes('clearAiDeclarationSession()')) fail('clearKioskSensitiveSession 必须调用 clearAiDeclarationSession')
  if (!sensitive.includes('outgoingMemberToken?: string | null')) fail('clearKioskSensitiveSession 的参数不能改')
  const install = read('src/ai/aiDeclarationInstall.ts')
  if (!install.includes('/me/ai-consents') || !install.includes('declarationEnforced')) {
    fail('启动安装必须读 declarationEnforced，并在登录后写入 /me/ai-consents')
  }
  const copy = read('src/ai/aiDeclarationCopy.ts')
  for (const sentence of [
    '你已年满 14 周岁吗？',
    '使用 AI 分析、语音转文字之前需要确认。未满 14 周岁的，需要监护人同意后才能使用，这台机器暂时办不了。',
    '已满',
    '未满',
    '录音单独同意',
    '同意录音',
    '改用手打',
    '使用 AI 即表示你已年满 14 周岁',
  ]) {
    if (!copy.includes(sentence)) fail(`文案常量缺少：${sentence}`)
  }
  const host = read('src/ai/AiDeclarationHost.tsx')
  if (!host.includes('data-ai-declaration-choice') || !host.includes('closeOnBackdrop={!explaining}')) {
    fail('确认弹层必须用现有弹层，拒绝先说明再结束')
  }
  for (const file of NOTE_FILES) {
    if (!read(file).includes('AiDeclarationNote')) fail(`${file} 缺少主按钮下的声明说明`)
  }
  const note = read('src/ai/AiDeclarationNote.tsx')
  if (!note.includes('AI_DECLARATION_NOTE') || !note.includes('qx-ai-declaration-note')) {
    fail('声明说明必须用集中文案和辅助字阶')
  }
  const css = read('src/styles/qingxu/primitives.css')
  const ctabar = css.match(/\.qx-ctabar\s*\{[^}]*\}/)
  if (!ctabar || /flex-wrap/.test(ctabar[0])) fail('不得把底部操作条改成换行')
  if (!css.includes('.qx-ai-declaration-note') || !css.includes('var(--qx-fs-aux)')) {
    fail('声明说明必须用 2.0 辅助字阶')
  }
  for (const file of RETHROW_FILES) {
    const source = read(file)
    const uses = (source.match(/rethrowAiDeclaration\(/g) ?? []).length
    const needed = file.endsWith('interview.ts') ? 2 : 1
    if (uses < needed) fail(`${file} 必须把拒绝声明原样抛回，不能改写成网络失败`)
  }
  const outage = read('src/ai/aiOutage.ts')
  const setStart = outage.indexOf('new Set([')
  const setEnd = outage.indexOf('])', setStart)
  const setBody = outage.slice(setStart, setEnd)
  if (setBody.includes('AI_DECLARATION')) fail('拒绝声明不是 AI 停用，不能写进 AI_OUTAGE_CODES')
  if (!outage.includes('return aiDeclarationDeclineMessage(error) ?? userMessageOf')) {
    fail('aiErrorMessageOf 必须先认出声明拒绝，再交给原来的码表')
  }
  const added = failures.filter((item) => item.includes('main.tsx') || item.includes('KioskRuntimeRoot') || item.includes('terminalAuth') || item.includes('清场') || item.includes('文案') || item.includes('声明') || item.includes('AI_OUTAGE') || item.includes('操作条') || item.includes('AiDeclaration'))
  if (added.length === 0) ok('声明从统一出口安装，清场会清掉，页面只加一行说明')
}

// ── 四、运行时 ────────────────────────────────────────────────────────────────

function memoryStorage() {
  const map = new Map()
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(String(key), String(value)) },
    removeItem: (key) => { map.delete(key) },
    clear: () => { map.clear() },
    key: (index) => [...map.keys()][index] ?? null,
    get length() { return map.size },
  }
}

let seed = 0

function installWindow(session, local = memoryStorage()) {
  globalThis.window = {
    sessionStorage: session,
    localStorage: local,
    location: { href: 'http://127.0.0.1:5173/', origin: 'http://127.0.0.1:5173', pathname: '/', search: '', hash: '' },
    history: { state: null, replaceState() {} },
    setTimeout: (fn, ms) => {
      const id = setTimeout(fn, ms)
      if (typeof id === 'object' && id && typeof id.unref === 'function') id.unref()
      return id
    },
    clearTimeout: (id) => clearTimeout(id),
    addEventListener() {},
    removeEventListener() {},
  }
  globalThis.sessionStorage = session
  globalThis.localStorage = local
}

async function loadRuntime({ terminalId = '', enforced = null, grantOk = false, sessionReady = false, respond }) {
  seed += 1
  const envName = `__aiDeclEnv_${seed}`
  globalThis[envName] = {
    VITE_TERMINAL_AGENT_LOCAL_URL: '',
    VITE_TERMINAL_AGENT_BRIDGE_TOKEN: '',
    VITE_E2E_MOCK_TERMINAL_SESSION_TOKEN: sessionReady ? 'runtime-ready-ticket' : '',
  }
  const session = memoryStorage()
  const calls = []
  const grants = []
  installWindow(session)
  globalThis.fetch = async (input, init = {}) => {
    const headers = new Headers(init.headers)
    const call = { url: String(input), headers: Object.fromEntries(headers.entries()), method: init.method ?? 'GET' }
    calls.push(call)
    const { status, body } = respond(call, calls.length)
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  }
  const tag = `\n// ${seed}\n`
  const versionsUrl = toDataUrl(`${transpile('src/ai/aiDeclarationVersions.ts')}${tag}`)
  const copyUrl = toDataUrl(`${transpile('src/ai/aiDeclarationCopy.ts')}${tag}`)
  const errorsUrl = toDataUrl(`${transpile('src/ai/aiDeclarationErrors.ts')}${tag}`.replaceAll("from './aiDeclarationCopy'", `from '${copyUrl}'`))
  const sessionUrl = toDataUrl(`${transpile('src/ai/aiDeclarationSession.ts')}${tag}`.replaceAll("from './aiDeclarationVersions'", `from '${versionsUrl}'`))
  const tableUrl = toDataUrl(`${transpile('src/ai/aiUseKindTable.ts')}${tag}`)
  const clientUrl = toDataUrl("export const API_BASE_URL = '/api/v1'\nexport const API_MODE = 'http'\n")
  const gateCode = `${transpile('src/ai/aiDeclarationGate.ts')}${tag}`
    .replaceAll("from '../services/api/client'", `from '${clientUrl}'`)
    .replaceAll("from './aiDeclarationErrors'", `from '${errorsUrl}'`)
    .replaceAll("from './aiDeclarationSession'", `from '${sessionUrl}'`)
    .replaceAll("from './aiDeclarationVersions'", `from '${versionsUrl}'`)
    .replaceAll("from './aiUseKindTable'", `from '${tableUrl}'`)
  const gate = await import(toDataUrl(gateCode))
  const declaration = await import(sessionUrl)
  const stubs = {
    "from './api/client'": clientUrl,
    "from './api/screensaver'": toDataUrl(`export function getTerminalId() { return ${JSON.stringify(terminalId)} }\n`),
    "from './api/httpAdapter'": toDataUrl('export class ApiHttpError extends Error { constructor(code, message, status) { super(message); this.name = "ApiHttpError"; this.code = code; this.status = status } }\n'),
    "from './api/throwHttpError'": toDataUrl('export async function readHttpError(r) { const b = await r.json().catch(() => ({})); return { code: b?.error?.code ?? "UNKNOWN_ERROR", message: b?.error?.message ?? "" } }\n'),
    "from '../auth/kioskSensitiveSession'": toDataUrl('export function clearKioskSensitiveSession() {}\nexport function clearKioskSharedDeviceResidue() {}\n'),
  }
  let authCode = `${transpile('src/services/terminalAuth.ts')}${tag}`.replaceAll('import.meta.env', `globalThis[${JSON.stringify(envName)}]`)
  for (const [from, url] of Object.entries(stubs)) {
    if (!authCode.includes(from)) throw new Error(`terminalAuth 不再引入 ${from}`)
    authCode = authCode.replaceAll(from, `from '${url}'`)
  }
  const auth = await import(toDataUrl(authCode))
  gate.configureAiDeclaration({
    readEnforced: async () => enforced,
    grantConsent: async (scope, bearer) => {
      grants.push({ scope, bearer })
      return grantOk
    },
  })
  auth.registerAiDeclarationBridge({ prepare: gate.prepareAiDeclaration, recover: gate.recoverAiDeclaration })
  return { auth, gate, declaration, session, calls, grants }
}

function watchPrompts(declaration, decide) {
  const asked = []
  const stop = declaration.subscribeDeclarationPrompt(() => {
    const current = declaration.currentDeclarationPrompt()
    if (!current) return
    asked.push(current.scope)
    if (decide) decide(current.scope, asked.length)
  })
  return { asked, stop }
}

function withTimeout(promise, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      const timer = setTimeout(() => reject(new Error(`超时：${label}`)), 2000)
      if (typeof timer === 'object' && timer && typeof timer.unref === 'function') timer.unref()
    }),
  ])
}

const OK = { status: 200, body: { ok: true } }
const REQUIRED = {
  status: 403,
  body: { success: false, error: { code: 'AI_DECLARATION_REQUIRED', message: '使用 AI 前请先完成必要声明' } },
}

function headerOf(call, name) {
  return call?.headers?.[name]
}

function assertAge(call, present) {
  const flag = headerOf(call, 'x-age-14-plus')
  const version = headerOf(call, 'x-age-14-plus-version')
  if (present) {
    assert.equal(flag, 'declared')
    assert.equal(version, 'age-14-plus-v1')
  } else {
    assert.equal(flag, undefined)
    assert.equal(version, undefined)
  }
}

function assertVoice(call, present) {
  const flag = headerOf(call, 'x-voice-recording')
  const version = headerOf(call, 'x-voice-recording-version')
  if (present) {
    assert.equal(flag, 'granted')
    assert.equal(version, 'voice-recording-v1')
  } else {
    assert.equal(flag, undefined)
    assert.equal(version, undefined)
  }
}

async function runtimeChecks() {
  await check('开关打开：未声明的生成请求先确认，选已满后只带年满 14 周岁', async () => {
    const { auth, declaration, calls } = await loadRuntime({
      enforced: true,
      respond: () => OK,
    })
    const { asked, stop } = watchPrompts(declaration, () => declaration.settleDeclarationPrompt('yes'))
    const response = await withTimeout(
      auth.terminalAttributedFetch('/api/v1/assistant/chat', { method: 'POST', headers: { Accept: 'application/json' } }),
      '生成确认',
    )
    stop()
    assert.equal(response.status, 200)
    assert.deepEqual(asked, ['age_14_plus'])
    assert.equal(calls.length, 1)
    assertAge(calls[0], true)
    assertVoice(calls[0], false)
    assert.equal(calls[0].headers.accept, 'application/json')
  })

  await check('开关打开：语音两项都问，生成请求不再带录音头', async () => {
    const { auth, declaration, calls } = await loadRuntime({ enforced: true, respond: () => OK })
    const { asked, stop } = watchPrompts(declaration, () => declaration.settleDeclarationPrompt('yes'))
    const voice = await withTimeout(
      auth.terminalAttributedFetch('/api/v1/assistant/voice', { method: 'POST' }),
      '语音确认',
    )
    const generate = await withTimeout(
      auth.terminalAttributedFetch('/api/v1/resume/parse', { method: 'POST' }),
      '随后的生成',
    )
    stop()
    assert.equal(voice.status, 200)
    assert.equal(generate.status, 200)
    assert.deepEqual(asked, ['age_14_plus', 'voice_recording'])
    assertAge(calls[0], true)
    assertVoice(calls[0], true)
    assertAge(calls[1], true)
    assertVoice(calls[1], false)
  })

  await check('选未满：不发请求', async () => {
    const { auth, declaration, calls } = await loadRuntime({ enforced: true, respond: () => OK })
    const { stop } = watchPrompts(declaration, () => declaration.settleDeclarationPrompt('no'))
    await assert.rejects(
      withTimeout(auth.terminalAttributedFetch('/api/v1/assistant/chat', { method: 'POST' }), '未满'),
      (error) => error?.code === 'AI_DECLARATION_DECLINED' && error.message.includes('未满 14 周岁'),
    )
    stop()
    assert.equal(calls.length, 0)
    assert.equal(declaration.isScopeDeclared('age_14_plus'), false)
  })

  await check('语音第二项改用手打：不发请求', async () => {
    const { auth, declaration, calls } = await loadRuntime({ enforced: true, respond: () => OK })
    const decisions = ['yes', 'no']
    const { stop } = watchPrompts(declaration, () => {
      declaration.settleDeclarationPrompt(decisions.shift())
    })
    await assert.rejects(
      withTimeout(auth.terminalAttributedFetch('/api/v1/mock-interviews/abc/transcribe', { method: 'POST' }), '改用手打'),
      (error) => error?.code === 'AI_DECLARATION_DECLINED' && error.message.includes('不录音'),
    )
    stop()
    assert.equal(calls.length, 0)
  })

  await check('开关关闭：不弹框、不带声明头', async () => {
    const { auth, declaration, calls } = await loadRuntime({ enforced: false, respond: () => OK })
    declaration.markScopeDeclared('age_14_plus')
    const { asked, stop } = watchPrompts(declaration, () => declaration.settleDeclarationPrompt('yes'))
    const response = await withTimeout(
      auth.terminalAttributedFetch('/api/v1/assistant/chat', { method: 'POST', headers: { 'X-Track': 'keep' } }),
      '开关关',
    )
    stop()
    assert.equal(response.status, 200)
    assert.deepEqual(asked, [])
    assert.equal(calls.length, 1)
    assertAge(calls[0], false)
    assertVoice(calls[0], false)
    assert.equal(calls[0].headers['x-track'], 'keep')
  })

  await check('读不到开关：不预先问；403 且没有 missing 时按种类重问一次', async () => {
    const { auth, declaration, calls } = await loadRuntime({
      enforced: null,
      respond: (_call, n) => (n === 1 ? REQUIRED : OK),
    })
    const { asked, stop } = watchPrompts(declaration, () => declaration.settleDeclarationPrompt('yes'))
    const response = await withTimeout(
      auth.terminalAttributedFetch('/api/v1/assistant/chat', { method: 'POST' }),
      '403 兜底',
    )
    stop()
    assert.equal(response.status, 200)
    assert.deepEqual(asked, ['age_14_plus'])
    assert.equal(calls.length, 2)
    assertAge(calls[0], false)
    assertAge(calls[1], true)
    assertVoice(calls[1], false)
  })

  await check('连续两次 403 只重发一次', async () => {
    const { auth, declaration, calls } = await loadRuntime({
      enforced: null,
      respond: () => REQUIRED,
    })
    const { stop } = watchPrompts(declaration, () => declaration.settleDeclarationPrompt('yes'))
    const response = await withTimeout(
      auth.terminalAttributedFetch('/api/v1/assistant/chat', { method: 'POST' }),
      '二次 403',
    )
    stop()
    assert.equal(response.status, 403)
    assert.equal(calls.length, 2)
  })

  await check('details 里的缺失项也会重问（过滤层不转发 missing）', async () => {
    const { auth, declaration, calls } = await loadRuntime({
      enforced: null,
      respond: (_call, n) => (n === 1
        ? { status: 403, body: { error: { code: 'AI_DECLARATION_REQUIRED', details: ['voice_recording'] } } }
        : OK),
    })
    const { asked, stop } = watchPrompts(declaration, () => declaration.settleDeclarationPrompt('yes'))
    declaration.markScopeDeclared('age_14_plus')
    const response = await withTimeout(
      auth.terminalAttributedFetch('/api/v1/assistant/voice', { method: 'POST' }),
      'details 兜底',
    )
    stop()
    assert.equal(response.status, 200)
    assert.deepEqual(asked, ['voice_recording'])
    assertVoice(calls[1], true)
  })

  await check('登录会员写入成功后这一次不再带头；写入失败仍带头', async () => {
    const granted = await loadRuntime({
      enforced: true,
      grantOk: true,
      respond: () => OK,
    })
    const yes = watchPrompts(granted.declaration, () => granted.declaration.settleDeclarationPrompt('yes'))
    await withTimeout(
      granted.auth.terminalAttributedFetch('/api/v1/assistant/chat', {
        method: 'POST',
        headers: { Authorization: 'Bearer member-token-1' },
      }),
      '写入成功',
    )
    yes.stop()
    assert.deepEqual(granted.grants.map((item) => item.scope), ['age_14_plus'])
    assertAge(granted.calls[0], false)

    const failed = await loadRuntime({ enforced: true, grantOk: false, respond: () => OK })
    const no = watchPrompts(failed.declaration, () => failed.declaration.settleDeclarationPrompt('yes'))
    await withTimeout(
      failed.auth.terminalAttributedFetch('/api/v1/assistant/chat', {
        method: 'POST',
        headers: { Authorization: 'Bearer member-token-1' },
      }),
      '写入失败',
    )
    no.stop()
    assert.equal(failed.grants.length, 1)
    assertAge(failed.calls[0], true)

    const anon = await loadRuntime({ enforced: true, grantOk: true, respond: () => OK })
    const guest = watchPrompts(anon.declaration, () => anon.declaration.settleDeclarationPrompt('yes'))
    await withTimeout(anon.auth.terminalAttributedFetch('/api/v1/assistant/chat', { method: 'POST' }), '未登录')
    guest.stop()
    assert.equal(anon.grants.length, 0)
    assertAge(anon.calls[0], true)
  })

  await check('已带声明头后服务端仍说缺声明，会清掉再问一次', async () => {
    const { auth, declaration, calls } = await loadRuntime({
      enforced: true,
      respond: (_call, n) => (n === 1 ? OK : n === 2 ? REQUIRED : OK),
    })
    const { asked, stop } = watchPrompts(declaration, () => declaration.settleDeclarationPrompt('yes'))
    await withTimeout(auth.terminalAttributedFetch('/api/v1/assistant/chat', { method: 'POST' }), '第一次')
    await withTimeout(auth.terminalAttributedFetch('/api/v1/assistant/chat', { method: 'POST' }), '失效后')
    stop()
    assert.deepEqual(asked, ['age_14_plus', 'age_14_plus'])
    assert.equal(calls.length, 3)
    assertAge(calls[2], true)
  })

  await check('阅读、导出、无关请求不弹框', async () => {
    const { auth, declaration, calls } = await loadRuntime({ enforced: true, respond: () => OK })
    const { asked, stop } = watchPrompts(declaration, () => declaration.settleDeclarationPrompt('yes'))
    await withTimeout(auth.terminalAttributedFetch('/api/v1/kiosk/ai/capabilities', { method: 'GET' }), '阅读')
    await withTimeout(auth.terminalAttributedFetch('/api/v1/resume/generate/export', { method: 'POST' }), '导出')
    await withTimeout(auth.terminalAttributedFetch('/api/v1/member/auth/sms-code', { method: 'POST' }), '发码')
    stop()
    assert.deepEqual(asked, [])
    assert.equal(calls.length, 3)
    for (const call of calls) {
      assertAge(call, false)
      assertVoice(call, false)
    }
  })

  await check('数字人建会走受保护出口，两项都带；停止不再问', async () => {
    const { auth, declaration, calls } = await loadRuntime({
      terminalId: 'KSK-001',
      enforced: true,
      sessionReady: true,
      respond: () => OK,
    })
    const { asked, stop } = watchPrompts(declaration, () => declaration.settleDeclarationPrompt('yes'))
    const started = await withTimeout(auth.terminalProtectedFetch('/api/v1/trtc/session', { method: 'POST' }), '建会')
    const stopped = await withTimeout(auth.terminalProtectedFetch('/api/v1/trtc/session/stop', { method: 'POST' }), '停止')
    stop()
    assert.equal(started.status, 200)
    assert.equal(stopped.status, 200)
    assert.deepEqual(asked, ['age_14_plus', 'voice_recording'])
    assertAge(calls[0], true)
    assertVoice(calls[0], true)
    assertAge(calls[1], false)
    assertVoice(calls[1], false)
  })

  await check('终端会话 401 仍只换一次票，声明钩子不插嘴', async () => {
    const { auth, declaration, calls, session } = await loadRuntime({
      terminalId: 'KSK-T1',
      enforced: null,
      respond: (call, n) => {
        if (call.url.endsWith('/terminals/session-token/refresh')) return { status: 200, body: { sessionToken: 'fresh-ticket-2' } }
        return n === 1
          ? { status: 401, body: { error: { code: 'TERMINAL_SESSION_INVALID', message: '终端安全会话无效' } } }
          : OK
      },
    })
    session.setItem('terminal_session_token_v1', 'expired-ticket-1')
    const { asked, stop } = watchPrompts(declaration, () => declaration.settleDeclarationPrompt('yes'))
    const response = await withTimeout(
      auth.terminalAttributedFetch('/api/v1/member/auth/sms-code', { method: 'POST' }),
      '换票',
    )
    stop()
    assert.equal(response.status, 200)
    assert.equal(calls.length, 3)
    assert.deepEqual(asked, [])
    assert.equal(calls[0].headers['x-terminal-session-token'], 'expired-ticket-1')
    assert.equal(calls[2].headers['x-terminal-session-token'], 'fresh-ticket-2')
  })

  await check('确认过程中清场：请求发不出去', async () => {
    const { auth, declaration, calls } = await loadRuntime({ enforced: true, respond: () => OK })
    const { stop } = watchPrompts(declaration, () => declaration.clearAiDeclarationSession())
    await assert.rejects(
      withTimeout(auth.terminalAttributedFetch('/api/v1/assistant/chat', { method: 'POST' }), '清场中'),
      (error) => error?.code === 'AI_DECLARATION_CLEARED',
    )
    stop()
    assert.equal(calls.length, 0)
  })

  const direct = await loadRuntime({ enforced: true, respond: () => OK })
  direct.declaration.markScopeDeclared('age_14_plus')
  const built = direct.gate.declarationHeadersFor(['age_14_plus'], null)
  if (built['x-age-14-plus'] !== 'declared' || built['x-age-14-plus-version'] !== 'age-14-plus-v1' || built['x-voice-recording']) {
    fail(`声明头构造不对：${JSON.stringify(built)}`)
  } else ok('已声明的年满 14 周岁时构造出对应请求头')
}

async function check(name, fn) {
  try {
    await fn()
    ok(name)
  } catch (error) {
    fail(`${name}：${error instanceof Error ? error.message : String(error)}`)
  }
}

async function loadClearance() {
  seed += 1
  const session = memoryStorage()
  const local = memoryStorage()
  installWindow(session, local)
  const tag = `\n// clear-${seed}\n`
  const leaf = (relativePath) => toDataUrl(`${transpile(relativePath)}${tag}`)
  const questionsStub = toDataUrl('export const SELF_ASSESSMENT_QUESTIONS_V1 = { dimensions: [] }\n')
  const scanTypeStub = toDataUrl("export function isScanType(value) { return value === 'resume' || value === 'id' || value === 'document' }\n")
  const cleanupStub = toDataUrl('export function beginScanSessionCleanup() {}\n')
  const interviewModelUrl = leaf('src/pages/interview/interviewWorkbenchModel.ts')
  const scanModelUrl = leaf('src/pages/scan/scanWorkbenchModel.ts')
  const selfAssessmentCode = `${transpile('src/pages/resume/selfAssessmentSession.ts')}${tag}`
    .replaceAll("from '@ai-job-print/shared'", `from '${questionsStub}'`)
  const scanSessionCode = `${transpile('src/pages/scan/scanWorkbenchSession.ts')}${tag}`
    .replaceAll("from './scanWorkbench'", `from '${scanTypeStub}'`)
    .replaceAll("from './scanWorkbenchModel'", `from '${scanModelUrl}'`)
  const interviewCode = `${transpile('src/pages/interview/interviewWorkbenchSession.ts')}${tag}`
    .replaceAll("from './interviewWorkbenchModel'", `from '${interviewModelUrl}'`)
  const assistantDraftCode = transpile('src/services/assistantDraft.ts').replaceAll("from 'react'", `from '${import.meta.resolve('react')}'`)
  const versionsUrl = toDataUrl(`${transpile('src/ai/aiDeclarationVersions.ts')}${tag}`)
  const sessionCode = `${transpile('src/ai/aiDeclarationSession.ts')}${tag}`.replaceAll("from './aiDeclarationVersions'", `from '${versionsUrl}'`)
  const sessionUrl = toDataUrl(sessionCode)
  const sensitiveCode = `${transpile('src/auth/kioskSensitiveSession.ts')}${tag}`
    .replaceAll("from '../ai/aiDeclarationSession'", `from '${sessionUrl}'`)
    .replaceAll("from '../ai/aiDeclarationVersions'", `from '${versionsUrl}'`)
    .replaceAll("from '../pages/print/printMaterialSession'", `from '${leaf('src/pages/print/printMaterialSession.ts')}'`)
    .replaceAll("from '../pages/resume/aiResumeSession'", `from '${leaf('src/pages/resume/aiResumeSession.ts')}'`)
    .replaceAll("from '../services/resumeParseIntent'", `from '${leaf('src/services/resumeParseIntent.ts')}'`)
    .replaceAll("from '../services/assistantDraft'", `from '${toDataUrl(assistantDraftCode)}'`)
    .replaceAll("from '../pages/resume/jobMaterialDraft'", `from '${leaf('src/pages/resume/jobMaterialDraft.ts')}'`)
    .replaceAll("from '../pages/resume/selfAssessmentSession'", `from '${toDataUrl(selfAssessmentCode)}'`)
    .replaceAll("from '../pages/interview/interviewWorkbenchSession'", `from '${toDataUrl(interviewCode)}'`)
    .replaceAll("from '../pages/scan/scanWorkbenchSession'", `from '${toDataUrl(scanSessionCode)}'`)
    .replaceAll("from '../pages/scan/scanCleanupGate'", `from '${cleanupStub}'`)
    .replaceAll("from '../favorites/localFavorites'", `from '${leaf('src/favorites/localFavorites.ts')}'`)
    .replaceAll("from '../pages/contract-review/contractReviewSession'", `from '${leaf('src/pages/contract-review/contractReviewSession.ts')}'`)
  const sensitive = await import(toDataUrl(sensitiveCode))
  const declaration = await import(sessionUrl)
  return { sensitive, declaration, session }
}

async function clearanceChecks() {
  await check('clearKioskSensitiveSession 让这一次的声明失效，开着的确认也作废', async () => {
    const { sensitive, declaration, session } = await loadClearance()
    declaration.markScopeDeclared('age_14_plus')
    declaration.markScopeDeclared('voice_recording')
    assert.equal(declaration.isScopeDeclared('age_14_plus'), true)
    assert.equal(sensitive.hasKioskSensitiveSession(), true)
    const epoch = declaration.aiDeclarationEpoch()
    const pending = declaration.askDeclaration('voice_recording')
    sensitive.clearKioskSensitiveSession()
    assert.equal(await pending, 'cleared')
    assert.equal(declaration.isScopeDeclared('age_14_plus'), false)
    assert.equal(declaration.isScopeDeclared('voice_recording'), false)
    assert.equal(session.getItem('ai-job-print:ai-declaration:v1'), null)
    assert.equal(declaration.aiDeclarationEpoch(), epoch + 1)
    assert.equal(sensitive.hasKioskSensitiveSession(), false)
  })
}

versionChecks()
await kindTableChecks()
sourceChecks()
await runtimeChecks()
await clearanceChecks()

if (failures.length > 0) {
  console.error(`\nFAIL: 一体机 AI 使用声明 ${failures.length} 项`)
  for (const item of failures) console.error(`  - ${item}`)
  process.exit(1)
}
console.log('\nOK: 一体机 AI 使用声明')
