// ============================================================================
// 门禁：本地全栈演示包（P1-23，`pnpm demo`）的五条底线
//
//   1. 演示数据写入前有确认：种子沿用 seed-guard 的 DEMO_SEED_CONFIRM 机制，
//      且确认、库路径校验都排在第一次写库之前；确认口令只给种子步骤，不给常驻服务。
//   2. 演示库不是开发库：只能是 <仓库>/.demo/demo.db，.demo/ 被 git 忽略。
//   3. 演示数据都带「演示」标记：机构、账号、终端、政策、法务文档、价目说明逐条查；
//      终端编号以 DEMO- 开头；不含岗位、招聘会、企业（托管关闭）。
//   4. AI_PROVIDER=mock、招聘托管关闭、外部密钥全空 —— 即使父进程环境里
//      配了真实值也一样（用一份「敌意」环境实跑 buildApiEnv 验证）。
//   5. 入口脚本跨平台：没有 bash 专用写法、没有写死本机路径，子进程用当前 node 直接起。
//
// 另外实跑一次演示网桥：只认演示一体机的 Origin，启动票必须带网桥令牌。
// 以及可选的模拟打印机（--sim-printer）：默认关闭；打开后如实标注「演示」、不写真实型号，
// 并对着一个假服务端实跑一遍心跳 / 领任务 / 下载校验 / 回写 /print-tasks/:id/status / 模拟缺纸。
//
// 只用 node 内置模块，可在 pnpm install 之前运行（CI「Repository integrity gate」步）。
// ============================================================================

import { createHash } from 'node:crypto'
import http from 'node:http'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DEMO_DATA_FILE,
  DEV_DB_FILE,
  assertDemoDatabaseFile,
  buildApiEnv,
  buildSeedEnv,
  buildViteEnv,
  demoPaths,
  generateSecrets,
  loadDemoData,
  sqliteUrlFor,
} from './demo/lib/demo-config.mjs'
import { startDemoBridge } from './demo/lib/local-bridge.mjs'
import { allocatePorts } from './demo/lib/preflight.mjs'
import { SIM_AGENT_VERSION, SIM_PAPER_EMPTY_MARKER, SIM_PRINTER_NAME, simPrinterEnabled, startSimPrinter } from './demo/lib/sim-printer.mjs'

const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const failures = []
let passes = 0

function check(name, ok, detail = '') {
  if (ok) {
    passes += 1
    console.log(`  PASS ${name}`)
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

function throwsWith(fn, code) {
  try {
    fn()
    return false
  } catch (error) {
    return String(error?.message ?? error).includes(code)
  }
}

/** 去掉块注释与整行 // 注释，只看真正执行的代码。 */
function codeOnly(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n')
}

const read = (rel) => readFileSync(join(repoRoot, rel), 'utf8')
const paths = demoPaths(repoRoot)
const ports = { api: 3310, kiosk: 5373, admin: 5374, partner: 5375, bridge: 9537 }
const secrets = generateSecrets()

// ── 1. 写入前确认 ───────────────────────────────────────────────────────────
console.log('1. 演示数据写入前有确认')
{
  const seed = codeOnly(read('scripts/demo/seed-demo.ts'))
  const guardImport = /import\s*\{\s*assertDemoSeedAllowed\s*\}\s*from\s*'\.\.\/\.\.\/services\/api\/prisma\/seed-guard'/.test(seed)
  check('种子沿用 services/api/prisma/seed-guard 的确认机制', guardImport)
  const iGuard = seed.search(/\n\s*assertDemoSeedAllowed\(\{\s*NODE_ENV: process\.env\['NODE_ENV'\], DEMO_SEED_CONFIRM: process\.env\['DEMO_SEED_CONFIRM'\] \}\)/)
  const iDb = seed.indexOf('= assertDemoDatabase()')
  const iMarkers = seed.indexOf('assertDemoMarkers(data)')
  const iClient = seed.indexOf('createPrismaClient(')
  const iWrite = seed.search(/\.(upsert|create|createMany|update|updateMany)\(/)
  check('确认 → 库路径校验 → 标记校验 → 连库 → 写库，顺序不可颠倒',
    iGuard >= 0 && iDb > iGuard && iMarkers > iDb && iClient > iMarkers && iWrite > iClient,
    `guard=${iGuard} db=${iDb} markers=${iMarkers} client=${iClient} write=${iWrite}`)
  const apiEnv = buildApiEnv({ paths, ports, redisUrl: 'redis://127.0.0.1:6379/11', secrets, parentEnv: {} })
  const seedEnv = buildSeedEnv({ apiEnv, passwords: { admin: 'x'.repeat(12), partner: 'y'.repeat(12) } })
  check('确认口令只给种子步骤', seedEnv.DEMO_SEED_CONFIRM === 'I_UNDERSTAND_DEMO_DATA_WILL_BE_WRITTEN' && seedEnv.NODE_ENV === 'development')
  check('常驻服务拿不到确认口令', !('DEMO_SEED_CONFIRM' in apiEnv)
    && !('DEMO_SEED_CONFIRM' in buildViteEnv('kiosk', { ports, secrets, parentEnv: { DEMO_SEED_CONFIRM: 'I_UNDERSTAND_DEMO_DATA_WILL_BE_WRITTEN' } }))
    && !('DEMO_SEED_CONFIRM' in buildApiEnv({ paths, ports, redisUrl: 'redis://127.0.0.1:6379/11', secrets, parentEnv: { DEMO_SEED_CONFIRM: 'I_UNDERSTAND_DEMO_DATA_WILL_BE_WRITTEN' } })))
}

// ── 2. 演示库不是开发库 ─────────────────────────────────────────────────────
console.log('2. 演示库路径')
{
  check('开发库被拒绝', throwsWith(() => assertDemoDatabaseFile(DEV_DB_FILE, repoRoot), 'DEMO_DB_IS_DEV_DB'))
  check('.demo/ 以外的库被拒绝', throwsWith(() => assertDemoDatabaseFile(join(repoRoot, 'services', 'api', 'prisma', 'demo.db'), repoRoot), 'DEMO_DB_OUTSIDE_DEMO_DIR'))
  check('.demo/demo.db 放行', !throwsWith(() => assertDemoDatabaseFile(join(repoRoot, '.demo', 'demo.db'), repoRoot), 'DEMO_DB'))
  const apiEnv = buildApiEnv({ paths, ports, redisUrl: 'redis://127.0.0.1:6379/11', secrets, parentEnv: { DATABASE_URL: 'file:./prisma/dev.db' } })
  const expected = sqliteUrlFor(join(repoRoot, '.demo', 'demo.db'))
  check('服务端 DATABASE_URL 指向 .demo/demo.db（父环境的开发库地址被覆盖）', apiEnv.DATABASE_URL === expected && !apiEnv.DATABASE_URL.includes('dev.db'), apiEnv.DATABASE_URL)
  const inDemo = (p) => !relative(paths.demoDir, p).startsWith('..')
  check('上传目录与 dotenv 文件都在 .demo/ 内', inDemo(apiEnv.FILE_STORAGE_DIR) && inDemo(apiEnv.DOTENV_CONFIG_PATH))
  // 不设时二维码会指向服务端自己的 /upload/phone（那里是 404），手机上传整条走不通。
  check('手机上传二维码指向演示一体机前端', apiEnv.KIOSK_PUBLIC_BASE_URL === `http://127.0.0.1:${ports.kiosk}`, apiEnv.KIOSK_PUBLIC_BASE_URL)
  const ignored = read('.gitignore').split(/\r?\n/).map((l) => l.trim())
  check('.gitignore 忽略 /.demo/', ignored.includes('/.demo/'))
  const seed = codeOnly(read('scripts/demo/seed-demo.ts'))
  check('种子自己也拒绝 dev.db', seed.includes("basename(file) === 'dev.db'") && seed.includes('DEMO_DB_IS_DEV_DB'))
}

// ── 3. 演示标记 ─────────────────────────────────────────────────────────────
console.log('3. 演示数据都带「演示」标记')
{
  const data = loadDemoData(DEMO_DATA_FILE)
  const visible = []
  for (const o of data.organizations ?? []) visible.push([`机构 ${o.id}`, o.name])
  for (const u of data.users ?? []) visible.push([`账号 ${u.username}`, u.name])
  for (const t of data.terminals ?? []) visible.push([`终端 ${t.terminalCode} 名称`, t.displayName], [`终端 ${t.terminalCode} 位置`, t.locationLabel])
  for (const p of data.policies ?? []) {
    visible.push([`政策 ${p.id} 标题`, p.title], [`政策 ${p.id} 来源`, p.sourceName], [`政策 ${p.id} 摘要`, p.summary], [`政策 ${p.id} 正文`, p.content])
  }
  for (const d of data.legalDocs ?? []) visible.push([`法务 ${d.docType} 标题`, d.title], [`法务 ${d.docType} 正文`, d.content])
  visible.push(['价目说明前缀', data.priceDescriptionPrefix])
  const missing = visible.filter(([, v]) => typeof v !== 'string' || !v.includes('演示')).map(([k]) => k)
  check(`${visible.length} 个对外可见字段都带「演示」`, visible.length >= 20 && missing.length === 0, missing.join('、'))
  const codes = (data.terminals ?? []).map((t) => t.terminalCode)
  check('终端编号都以 DEMO- 开头', codes.length > 0 && codes.every((c) => /^DEMO-[A-Z0-9-]+$/.test(c)), codes.join(','))
  const forbiddenKeys = Object.keys(data).filter((k) => /job|fair|compan|campus|recruit/i.test(k))
  check('不含岗位、招聘会、企业、校招数据（托管关闭）', forbiddenKeys.length === 0, forbiddenKeys.join(','))
  check('政策不用招聘分类', (data.policies ?? []).every((p) => p.category !== 'recruitment'))
  const seed = codeOnly(read('scripts/demo/seed-demo.ts'))
  check('种子运行时再校验一次标记', seed.includes("const DEMO_MARK = '演示'") && seed.includes('assertDemoMarkers(data)'))
  // 试点免费（9/29 拍板）：演示价目一律 0 元，否则打印会停在付款前，且和试点口径不一致。
  const priceLoop = seed.slice(seed.indexOf('for (const price of DEV_DEFAULT_PRICE_CONFIG)'))
  check('演示价目写 0 元（试点免费）', /unitCents:\s*0,/.test(priceLoop.slice(0, 400)) && !/unitCents:\s*price\.unitCents/.test(seed))
  check('价目说明写明免费试运营', String(data.priceDescriptionPrefix).includes('免费试运营'))
}

// ── 4. AI 模拟、托管关闭、外部密钥全空 ─────────────────────────────────────
console.log('4. AI_PROVIDER=mock、招聘托管关闭、外部密钥不继承')
{
  const hostile = {
    PATH: '/usr/bin',
    NODE_ENV: 'production',
    AI_PROVIDER: 'llm',
    AI_LLM_API_KEY: 'sk-real-key',
    TRTC_LLM_API_KEY: 'sk-real-trtc',
    RECRUITMENT_CONTENT_HOSTING_ENABLED: 'true',
    PAYMENT_PROVIDER: 'wechat',
    WECHAT_PAY_MCHID: '1234567890',
    ALIPAY_APP_ID: '2021000000',
    TENCENT_COS_SECRET_KEY: 'real-cos',
    OCR_PROVIDER: 'baidu',
    FILE_STORAGE_DRIVER: 'cos',
    VITE_E2E_MOCK_TERMINAL_SESSION_TOKEN: 'fixture',
    VITE_USE_TRTC_CALL: 'true',
  }
  const api = buildApiEnv({ paths, ports, redisUrl: 'redis://127.0.0.1:6379/11', secrets, parentEnv: hostile })
  check('AI_PROVIDER=mock', api.AI_PROVIDER === 'mock', api.AI_PROVIDER)
  check('招聘内容托管关闭', !['true', '1'].includes(String(api.RECRUITMENT_CONTENT_HOSTING_ENABLED).trim().toLowerCase()), api.RECRUITMENT_CONTENT_HOSTING_ENABLED)
  check('NODE_ENV=development', api.NODE_ENV === 'development')
  const mustBeEmpty = ['AI_LLM_API_KEY', 'TRTC_LLM_API_KEY', 'PAYMENT_PROVIDER', 'TENCENT_COS_SECRET_KEY', 'TENCENT_SECRET_KEY', 'BAIDU_OCR_API_KEY', 'CONTRACT_REVIEW_API_KEY', 'WECHAT_MINIAPP_APPSECRET']
  const leaked = mustBeEmpty.filter((k) => api[k] !== '')
  check('外部服务密钥与支付通道显式置空（挡住 .env 里的真实值）', leaked.length === 0, leaked.join(','))
  check('真实支付商户号不被继承', !('WECHAT_PAY_MCHID' in api) && !('ALIPAY_APP_ID' in api))
  check('OCR / 语音 / 文生图关闭，文件落本机', api.OCR_PROVIDER === 'disabled' && api.ASR_PROVIDER === 'disabled' && api.AI_IMAGE_PROVIDER === 'disabled' && api.FILE_STORAGE_DRIVER === 'local')
  check('短信只打日志', api.SMS_PROVIDER === 'log')
  const kiosk = buildViteEnv('kiosk', { ports, secrets, parentEnv: hostile })
  check('一体机连本地服务端（http 模式、非夹具构建、不开数字人）',
    kiosk.VITE_API_MODE === 'http' && kiosk.VITE_E2E_MOCK_TERMINAL_SESSION_TOKEN === '' && kiosk.VITE_USE_TRTC_CALL === 'false'
      && kiosk.VITE_API_PROXY_TARGET === `http://127.0.0.1:${ports.api}`)
}

// ── 5. 入口跨平台 ───────────────────────────────────────────────────────────
console.log('5. 入口脚本跨平台')
{
  const pkg = JSON.parse(read('package.json'))
  const demoScripts = Object.entries(pkg.scripts).filter(([k]) => k === 'demo' || k.startsWith('demo:'))
  check('根 package.json 有 demo / demo:start / demo:reset', ['demo', 'demo:start', 'demo:reset'].every((k) => k in pkg.scripts))
  check('demo* 脚本只调 node scripts/demo/demo.mjs', demoScripts.every(([, v]) => /^node scripts\/demo\/demo\.mjs (start( --sim-printer)?|reset)$/.test(v)),
    demoScripts.map(([k, v]) => `${k}=${v}`).join('; '))
  const dir = join(repoRoot, 'scripts', 'demo')
  const files = []
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.(mjs|ts)$/.test(entry.name)) files.push(full)
    }
  }
  walk(dir)
  const banned = [
    [/\brm\s+-rf\b/, 'rm -rf'],
    [/\bcp\s+-r\b/, 'cp -r'],
    [/(^|[\s;&|"'`])export\s+[A-Z_][A-Z0-9_]*=/m, 'export VAR='],
    [/\bbash\b|\/bin\/sh\b|\bsh\s+-c\b/, 'bash / sh'],
    [/shell\s*:\s*true/, 'shell: true'],
    [/['"`]\/Users\/|['"`][A-Za-z]:\\\\/, '写死的本机绝对路径'],
    [/\bexecSync\(|\bexec\(/, 'exec 走 shell'],
  ]
  const hits = []
  for (const file of files) {
    const code = codeOnly(readFileSync(file, 'utf8'))
    for (const [re, label] of banned) if (re.test(code)) hits.push(`${relative(repoRoot, file)}: ${label}`)
  }
  for (const [k, v] of demoScripts) for (const [re, label] of banned) if (re.test(v)) hits.push(`package.json ${k}: ${label}`)
  check(`scripts/demo 下 ${files.length} 个文件没有 bash 专用写法`, files.length >= 4 && hits.length === 0, hits.join('；'))
  const entry = codeOnly(read('scripts/demo/demo.mjs'))
  check('子进程一律用当前 node 直接起', entry.includes('spawn(process.execPath') && entry.includes('spawnSync(process.execPath')
    && !/spawn\(\s*['"](pnpm|npm|npx|node)['"]/.test(entry))
  check('Windows 停止走 taskkill 结束进程树', entry.includes("process.platform === 'win32'") && entry.includes("'taskkill'") && entry.includes("'/T'"))
  const moved = await allocatePorts({ a: 4100, b: 5373 }, { isFree: async (p) => p !== 5373 })
  check('端口被占会顺延且跳过 41xx', moved.ports.a !== 4100 && !(moved.ports.a >= 4100 && moved.ports.a <= 4199) && moved.ports.b === 5383,
    JSON.stringify(moved.ports))
}

// ── 6. 演示网桥实跑 ─────────────────────────────────────────────────────────
console.log('6. 演示网桥只认演示一体机')
{
  const bridgeSource = codeOnly(read('scripts/demo/lib/local-bridge.mjs'))
  check('只监听 127.0.0.1', /listen\(port,\s*'127\.0\.0\.1'/.test(bridgeSource))
  const origin = 'http://127.0.0.1:5373'
  const bridge = await startDemoBridge({
    port: 0,
    allowedOrigins: [origin],
    bridgeToken: 'bridge-token-for-gate',
    apiBaseUrl: 'http://127.0.0.1:9/api/v1',
    terminalId: 't_demo_gate',
    terminalCode: 'DEMO-001',
    agentToken: 'agent-token-never-leaves',
  })
  const base = `http://127.0.0.1:${bridge.server.address().port}`
  try {
    const foreign = await fetch(`${base}/local/terminal-identity`, { headers: { Origin: 'http://evil.example' } })
    check('外来 Origin 拿不到终端身份', foreign.status === 403)
    const ok = await fetch(`${base}/local/terminal-identity`, { headers: { Origin: origin } })
    const body = await ok.json()
    check('演示一体机拿到终端身份，且不含终端凭证', ok.status === 200 && body.data?.terminalCode === 'DEMO-001' && !JSON.stringify(body).includes('agent-token-never-leaves'))
    const noToken = await fetch(`${base}/local/terminal-boot-ticket`, { method: 'POST', headers: { Origin: origin } })
    check('启动票必须带网桥令牌', noToken.status === 403)
    const usb = await fetch(`${base}/local/usb/status`, { headers: { Origin: origin } })
    check('硬件接口如实回「不可用」', usb.status === 503)
    const wake = await fetch(`${base}/local/print/wake`, { method: 'POST', headers: { Origin: origin, 'X-Local-Bridge-Token': 'bridge-token-for-gate' } })
    check('没开模拟打印机时打印唤醒如实回「不可用」', wake.status === 503)
  } finally {
    await bridge.close()
  }
}

// ── 7. 模拟打印机（可选）─────────────────────────────────────────────────────
console.log('7. 模拟打印机：默认关闭、如实标注、照抄终端程序协议')
{
  const pkg = JSON.parse(read('package.json'))
  check('默认关闭：不带参数、不设环境变量时不开', simPrinterEnabled([], {}) === false && simPrinterEnabled([], { DEMO_SIM_PRINTER: '0' }) === false
    && !pkg.scripts.demo.includes('--sim-printer') && !pkg.scripts['demo:start'].includes('--sim-printer'))
  check('--sim-printer / DEMO_SIM_PRINTER=1 才打开，另有 demo:sim', simPrinterEnabled(['--sim-printer'], {}) && simPrinterEnabled([], { DEMO_SIM_PRINTER: '1' })
    && pkg.scripts['demo:sim'] === 'node scripts/demo/demo.mjs start --sim-printer')
  const entry = codeOnly(read('scripts/demo/demo.mjs'))
  check('入口只在开关打开时启动模拟打印机', /if \(options\.simPrinter\) \{\s*\/\/[^\n]*\n\s*simPrinter = startSimPrinter\(/.test(read('scripts/demo/demo.mjs'))
    && entry.includes('simPrinter: simPrinterEnabled(flags)'))
  check('打印机名与心跳版本号都标「演示」', SIM_PRINTER_NAME.includes('演示') && SIM_AGENT_VERSION.includes('演示'), `${SIM_PRINTER_NAME} / ${SIM_AGENT_VERSION}`)
  const demoFiles = []
  const walkAll = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, e.name)
      if (e.isDirectory()) walkAll(full)
      else demoFiles.push(full)
    }
  }
  walkAll(join(repoRoot, 'scripts', 'demo'))
  const modelHits = demoFiles.filter((f) => /pantum|奔图|CM28\d\d/i.test(readFileSync(f, 'utf8'))).map((f) => relative(repoRoot, f))
  check('演示包里不出现任何真实打印机型号（CLAUDE.md §3）', modelHits.length === 0, modelHits.join('、'))

  // 假服务端：只认终端程序的三条接口，记下每一次请求。
  const TOKEN = 'sim-gate-agent-token'
  const pdf = Buffer.from('%PDF-1.4\n% demo gate file\n')
  const sha = createHash('sha256').update(pdf).digest('hex')
  const queue = []
  const seen = { heartbeats: [], claims: 0, patches: [], other: [], badAuth: 0 }
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      const url = new URL(req.url, 'http://x')
      const json = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)) }
      if (url.pathname === '/files/f1/content') { res.writeHead(200); res.end(pdf); return }
      if (req.headers.authorization !== `Bearer ${TOKEN}` || req.headers['x-terminal-id'] !== 't_gate') { seen.badAuth += 1; json(401, {}); return }
      if (req.method === 'PUT' && url.pathname === '/api/v1/terminals/t_gate/heartbeat') { seen.heartbeats.push(JSON.parse(body)); json(200, { acknowledged: true }); return }
      if (req.method === 'POST' && url.pathname === '/api/v1/terminals/t_gate/tasks/claim') { seen.claims += 1; json(200, queue.splice(0, 1)); return }
      const m = url.pathname.match(/^\/api\/v1\/print-tasks\/([^/]+)\/status$/)
      if (req.method === 'PATCH' && m) { seen.patches.push({ taskId: m[1], ...JSON.parse(body) }); json(200, { acknowledged: true }); return }
      seen.other.push(`${req.method} ${url.pathname}`)
      json(404, {})
    })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const apiOrigin = `http://127.0.0.1:${server.address().port}`
  const task = (taskId, fileMd5) => ({ taskId, type: 'print', fileUrl: '/files/f1/content', fileMd5, fileName: 'a.pdf', mimeType: 'application/pdf', params: { copies: 1 } })
  queue.push(task('T_OK', sha), task('T_BAD', 'f'.repeat(64)))
  const workDir = mkdtempSync(join(tmpdir(), 'demo-sim-gate-'))
  const lines = []
  const until = async (fn, ms = 8_000) => {
    const end = Date.now() + ms
    while (Date.now() < end) {
      if (fn()) return true
      await new Promise((r) => setTimeout(r, 25))
    }
    return false
  }
  const sim = startSimPrinter({ apiBaseUrl: `${apiOrigin}/api/v1`, terminalId: 't_gate', agentToken: TOKEN, workDir,
    log: (l) => lines.push(l), heartbeatIntervalMs: 60_000, claimIntervalMs: 80, markerPollMs: 40, simulatedPrintMs: 10 })
  const bridge = await startDemoBridge({ port: 0, allowedOrigins: ['http://127.0.0.1:5373'], bridgeToken: 'gate-bridge', apiBaseUrl: `${apiOrigin}/api/v1`,
    terminalId: 't_gate', terminalCode: 'DEMO-001', agentToken: TOKEN, wakePrintQueue: () => sim.wake() })
  try {
    const statuses = (id) => seen.patches.filter((p) => p.taskId === id).map((p) => p.status)
    await until(() => statuses('T_OK').includes('completed') && statuses('T_BAD').includes('failed'))
    const hb = seen.heartbeats[0] ?? {}
    check('心跳走 PUT /terminals/:id/heartbeat，带终端凭证，报「演示」版本号与 ready', hb.status === 'online' && hb.printerStatus === 'ready' && hb.agentVersion === SIM_AGENT_VERSION && seen.badAuth === 0,
      JSON.stringify(hb))
    check('领任务走 POST /terminals/:id/tasks/claim', seen.claims >= 2)
    check('回写走 PATCH /print-tasks/:id/status：printing → completed', JSON.stringify(statuses('T_OK')) === '["printing","completed"]', JSON.stringify(statuses('T_OK')))
    check('只调用终端程序的三条接口，没有别的写入', seen.other.length === 0, seen.other.join(','))
    const outLine = `${SIM_PRINTER_NAME}：任务 T_OK 已模拟出纸，未真实打印`
    check('每次「出纸」打印一行如实说明', lines.includes(outLine), lines.join(' / '))
    const bad = seen.patches.find((p) => p.taskId === 'T_BAD') ?? {}
    check('文件真的下载并做 SHA-256 校验：哈希不符回写 failed 且不「出纸」', bad.status === 'failed' && bad.errorCode === 'DOWNLOAD_HASH_MISMATCH'
      && !statuses('T_BAD').includes('printing') && !lines.some((l) => l.includes('T_BAD 已模拟出纸')))
    check('终端凭证不出现在输出里', !lines.some((l) => l.includes(TOKEN)))

    writeFileSync(join(workDir, SIM_PAPER_EMPTY_MARKER), '')
    const paperEmptyBeat = await until(() => seen.heartbeats.some((h) => h.printerStatus === 'paper_empty'))
    check('放缺纸标记后立刻补一次心跳，printerStatus=paper_empty', paperEmptyBeat)
    queue.push(task('T_PAPER', sha))
    const wake = await fetch(`http://127.0.0.1:${bridge.server.address().port}/local/print/wake`, { method: 'POST', headers: { Origin: 'http://127.0.0.1:5373', 'X-Local-Bridge-Token': 'gate-bridge' } })
    check('打开模拟打印机后，网桥的打印唤醒回 202', wake.status === 202)
    await until(() => statuses('T_PAPER').includes('failed'))
    const paper = seen.patches.find((p) => p.taskId === 'T_PAPER') ?? {}
    check('缺纸时领到的任务回写 failed + PAPER_EMPTY，不「出纸」', paper.errorCode === 'PAPER_EMPTY' && !statuses('T_PAPER').includes('printing'), JSON.stringify(paper))
    rmSync(join(workDir, SIM_PAPER_EMPTY_MARKER))
    const n = seen.heartbeats.length
    check('删掉标记即恢复，心跳回到 ready', await until(() => seen.heartbeats.slice(n).some((h) => h.printerStatus === 'ready')))
  } finally {
    await sim.close()
    await bridge.close()
    await new Promise((r) => server.close(r))
    rmSync(workDir, { recursive: true, force: true })
  }
}

console.log(`\nverify-demo-kit: ${passes} PASS, ${failures.length} FAIL`)
if (failures.length > 0) {
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
}
