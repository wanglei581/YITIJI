// ============================================================================
// 本地演示包（P1-23）的全部配置：路径、端口、各服务的环境变量。
//
// 只用 node 内置模块：门禁 scripts/verify-demo-kit.mjs 直接 import 本文件，
// 在 pnpm install 之前的 CI 步骤里也要能跑。
//
// 三条底线（门禁逐条断言，改这里之前先看门禁）：
//   1. 演示库只在仓库内被 .gitignore 忽略的 .demo/ 目录，绝不是开发库
//      services/api/prisma/dev.db。
//   2. AI_PROVIDER=mock，且所有真实 AI / OCR / 语音 / 支付 / 云存储密钥一律置空，
//      即使销售电脑上 services/api/.env 里配了真密钥也不会被读到。
//   3. 招聘内容托管保持关闭（我们云上的默认口径，CLAUDE.md §1）。
// ============================================================================

import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

export const DEMO_DIR_NAME = '.demo'
export const DEMO_DB_FILE_NAME = 'demo.db'
export const DEMO_DATA_FILE = join(REPO_ROOT, 'scripts', 'demo', 'demo-data.json')
export const DEV_DB_FILE = join(REPO_ROOT, 'services', 'api', 'prisma', 'dev.db')

/** 默认端口。刻意避开 41xx（本机别的会话常驻）和各应用 dev 默认端口 3010 / 5173-5175。 */
export const DEFAULT_PORTS = Object.freeze({
  api: 3310,
  kiosk: 5373,
  admin: 5374,
  partner: 5375,
  bridge: 9537,
})

/** Redis：默认本机 6379 的 11 号库，与开发常用的 0 号库分开。可用 DEMO_REDIS_URL 覆盖。 */
export const DEFAULT_REDIS_URL = 'redis://127.0.0.1:6379/11'

export function demoPaths(repoRoot = REPO_ROOT) {
  const demoDir = join(repoRoot, DEMO_DIR_NAME)
  return {
    repoRoot,
    demoDir,
    dbFile: join(demoDir, DEMO_DB_FILE_NAME),
    storageDir: join(demoDir, 'storage'),
    logDir: join(demoDir, 'logs'),
    stateFile: join(demoDir, 'state.json'),
    accountsFile: join(demoDir, '演示账号.txt'),
    // 指给 dotenv 的空文件：让 services/api/.env（开发者的真实配置）在演示里完全不生效。
    dotenvFile: join(demoDir, 'api.env'),
    apiDir: join(repoRoot, 'services', 'api'),
    appDir: (app) => join(repoRoot, 'apps', app),
  }
}

export function loadDemoData(file = DEMO_DATA_FILE) {
  return JSON.parse(readFileSync(file, 'utf8'))
}

function isInside(parent, child) {
  const rel = relative(parent, child)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

/**
 * 演示库路径闸门：必须是 <仓库>/.demo/demo.db，且不是开发库。
 * 种子脚本 scripts/demo/seed-demo.ts 在写库前还会再独立校验一遍。
 */
export function assertDemoDatabaseFile(dbFile, repoRoot = REPO_ROOT) {
  const resolved = resolve(dbFile)
  const demoDir = join(repoRoot, DEMO_DIR_NAME)
  if (resolved === resolve(repoRoot, 'services', 'api', 'prisma', 'dev.db')) {
    throw new Error('DEMO_DB_IS_DEV_DB: 演示库不能是开发库 services/api/prisma/dev.db')
  }
  if (!isInside(demoDir, resolved) || resolved !== join(demoDir, DEMO_DB_FILE_NAME)) {
    throw new Error(`DEMO_DB_OUTSIDE_DEMO_DIR: 演示库必须是 ${join(DEMO_DIR_NAME, DEMO_DB_FILE_NAME)}，当前是 ${resolved}`)
  }
  return resolved
}

/** SQLite 连接串：统一用正斜杠，Windows 盘符路径写成 file:C:/... */
export function sqliteUrlFor(dbFile) {
  return `file:${resolve(dbFile).split(sep).join('/')}`
}

export function generateSecrets() {
  const hex = (n) => randomBytes(n).toString('hex')
  return {
    jwtSecret: hex(32),
    fileSigningSecret: hex(32),
    secretEncryptionKey: hex(32),
    paymentSessionSecret: hex(32),
    terminalAdminSecret: hex(32),
    terminalActionTokenSecret: hex(32),
    bridgeToken: randomBytes(24).toString('base64url'),
  }
}

/** 演示口令：12 位，去掉易混字符，便于销售照着屏幕输入。 */
export function generatePassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  const bytes = randomBytes(12)
  let out = ''
  for (const b of bytes) out += alphabet[b % alphabet.length]
  return `Demo-${out}`
}

// 从父进程继承环境时要先剔掉的变量：凡是能把演示连到真实外部服务、真实数据或
// 真实密钥的前缀，一律不继承，再由下面显式写入安全值。
const SCRUBBED_ENV_PREFIXES = [
  'VITE_', 'DATABASE_', 'POSTGRES_', 'REDIS_', 'AI_', 'OCR_', 'ASR_', 'TRTC_', 'TENCENT_', 'BAIDU_',
  'WECHAT_', 'ALIPAY_', 'PAYMENT_', 'SANDBOX_', 'CONTRACT_REVIEW_', 'SMS_', 'FILE_', 'COS_',
  'RECRUITMENT_', 'TERMINAL_', 'JWT_', 'SECRET_', 'ALERT_', 'DEMO_SEED_', 'DOTENV_', 'CORS_',
  'PRINT_', 'SCAN_', 'CONVERSION_', 'GOTENBERG_', 'SOFFICE_', 'LEGAL_', 'RESUME_', 'POLICY_',
  'MEMBER_', 'DATA_DELETION_', 'MAINTENANCE_', 'ENABLE_TEST_',
]

export function inheritedEnv(parentEnv = process.env) {
  const env = {}
  for (const [key, value] of Object.entries(parentEnv)) {
    if (value === undefined) continue
    if (key === 'NODE_ENV' || key === 'PORT') continue
    if (SCRUBBED_ENV_PREFIXES.some((prefix) => key.toUpperCase().startsWith(prefix))) continue
    env[key] = value
  }
  return env
}

/**
 * 服务端（services/api）的完整环境。
 * 值为空字符串的键是刻意的：dotenv 只补「不存在」的键，空串也算存在，
 * 所以置空就能挡住任何 .env 文件里的真实配置。
 */
export function buildApiEnv({ paths, ports, redisUrl, secrets, parentEnv = process.env }) {
  const dbFile = assertDemoDatabaseFile(paths.dbFile, paths.repoRoot)
  return {
    ...inheritedEnv(parentEnv),
    NODE_ENV: 'development',
    PORT: String(ports.api),
    DOTENV_CONFIG_PATH: paths.dotenvFile,
    DATABASE_URL: sqliteUrlFor(dbFile),
    REDIS_URL: redisUrl,

    JWT_SECRET: secrets.jwtSecret,
    FILE_SIGNING_SECRET: secrets.fileSigningSecret,
    SECRET_ENCRYPTION_KEY: secrets.secretEncryptionKey,
    PAYMENT_SESSION_SECRET: secrets.paymentSessionSecret,
    TERMINAL_ADMIN_SECRET: secrets.terminalAdminSecret,
    TERMINAL_ACTION_TOKEN_SECRET: secrets.terminalActionTokenSecret,
    // 演示终端走服务端现成的注册接口（与 Agent 首次注册同一条路），仅限本机演示库。
    TERMINAL_LEGACY_REGISTER_ENABLED: 'true',
    TERMINAL_PLANNED_PROVISIONING_ENABLED: 'false',
    ENABLE_TEST_PRINT_TASK_SEED: 'false',

    FILE_STORAGE_DRIVER: 'local',
    FILE_STORAGE_DIR: paths.storageDir,
    TENCENT_COS_SECRET_ID: '',
    TENCENT_COS_SECRET_KEY: '',
    TENCENT_COS_BUCKET: '',

    // 招聘内容托管：我们云上的默认口径是关闭，演示同样关闭。
    RECRUITMENT_CONTENT_HOSTING_ENABLED: 'false',

    // AI：只用模拟结果，不连任何真实模型，不需要密钥、不产生费用。
    AI_PROVIDER: 'mock',
    AI_LLM_API_KEY: '',
    AI_IMAGE_PROVIDER: 'disabled',
    AI_IMAGE_API_KEY: '',
    OCR_PROVIDER: 'disabled',
    ASR_PROVIDER: 'disabled',
    BAIDU_OCR_API_KEY: '',
    BAIDU_OCR_SECRET_KEY: '',
    BAIDU_ASR_API_KEY: '',
    BAIDU_ASR_SECRET_KEY: '',
    TRTC_SDK_APP_ID: '',
    TRTC_SDK_SECRET_KEY: '',
    TRTC_LLM_API_KEY: '',
    TENCENT_SECRET_ID: '',
    TENCENT_SECRET_KEY: '',
    CONTRACT_REVIEW_PROVIDER: '',
    CONTRACT_REVIEW_API_KEY: '',
    CONVERSION_ENGINE: 'disabled',

    // 短信：只打印在服务端日志里（演示脚本会把验证码那一行转到终端上）。
    SMS_PROVIDER: 'log',
    // 线上支付关闭：演示不收款，也不会出现「支付成功」。
    PAYMENT_PROVIDER: '',
    WECHAT_MINIAPP_APPID: '',
    WECHAT_MINIAPP_APPSECRET: '',

    ALERT_WEBHOOK_URL: '',
  }
}

/** 三个前端的环境。演示终端身份经本机演示网桥下发，不写死在构建里。 */
export function buildViteEnv(app, { ports, secrets, parentEnv = process.env }) {
  const base = {
    ...inheritedEnv(parentEnv),
    VITE_API_MODE: 'http',
    // 只在 Playwright 夹具构建里出现；置空，防止开发者本地 .env 把一体机切成夹具模式。
    VITE_E2E_MOCK_TERMINAL_SESSION_TOKEN: '',
  }
  if (app === 'kiosk') {
    return {
      ...base,
      VITE_API_BASE_URL: '/api/v1',
      VITE_API_PROXY_TARGET: `http://127.0.0.1:${ports.api}`,
      VITE_TERMINAL_AGENT_LOCAL_URL: `http://127.0.0.1:${ports.bridge}`,
      VITE_TERMINAL_AGENT_BRIDGE_TOKEN: secrets.bridgeToken,
      VITE_TERMINAL_ID: '',
      // 数字人需要腾讯云凭证，演示不接；AI 助手用文字模式。
      VITE_USE_TRTC_CALL: 'false',
      VITE_ALLOW_TEXT_ONLY_ASSISTANT: 'true',
    }
  }
  return { ...base, VITE_API_BASE_URL: `http://127.0.0.1:${ports.api}/api/v1` }
}

/** 种子步骤的环境：唯一带 DEMO_SEED_CONFIRM 的地方，服务进程拿不到它。 */
export function buildSeedEnv({ apiEnv, passwords }) {
  return {
    ...apiEnv,
    DEMO_SEED_CONFIRM: 'I_UNDERSTAND_DEMO_DATA_WILL_BE_WRITTEN',
    DEMO_DB_FILE: apiEnv.DATABASE_URL.slice('file:'.length),
    DEMO_REPO_ROOT: REPO_ROOT,
    DEMO_ADMIN_PASSWORD: passwords.admin,
    DEMO_PARTNER_PASSWORD: passwords.partner,
  }
}

export function readJsonIfExists(file) {
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}
