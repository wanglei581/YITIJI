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
//
// 只用 node 内置模块，可在 pnpm install 之前运行（CI「Repository integrity gate」步）。
// ============================================================================

import { readFileSync, readdirSync } from 'node:fs'
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
  check('demo* 脚本只调 node scripts/demo/demo.mjs', demoScripts.every(([, v]) => /^node scripts\/demo\/demo\.mjs (start|reset)$/.test(v)),
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
  } finally {
    await bridge.close()
  }
}

console.log(`\nverify-demo-kit: ${passes} PASS, ${failures.length} FAIL`)
if (failures.length > 0) {
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
}
