#!/usr/bin/env node
/**
 * 生产运行闸门预检：用目标提交**构建产物**里的 assertProductionRuntimeGates()
 * 检查服务器真实 .env（可叠加 --force-true，对应 deploy 3b 将写入的键）。
 *
 * 为何加载 dist、不用 `node -r @swc-node/register` 跑 TS：
 *   线上启动入口是 `node dist/main.js`（package.json "start"）。tsc 的
 *   rootDir=src / outDir=dist，闸门编译后位于
 *   dist/config/production-runtime-gates.js。预检必须吃同一份产物，
 *   避免 src 与 dist 不一致时预检绿、PM2 启动红。发布脚本在本预检前
 *   已于源码检出内 pnpm build，该文件一定在。
 *
 * 字体探测走模块默认的真实 probeCjkFont()（不传假 fontProbe），因为要验的就是这台机器。
 *
 * 用法：
 *   node services/api/scripts/preflight-production-gates.mjs \
 *     --env-file /srv/ai-job-print/services/api/.env \
 *     --force-true PRINT_REQUIRE_PII_SCAN,PRINT_REQUIRE_PRINTER_ONLINE
 *
 * 不打印任何 .env 值；日志里只允许出现键名。失败只打印 Error.message，不打堆栈。
 */
import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const apiRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIST_GATES = join(apiRoot, 'dist', 'config', 'production-runtime-gates.js')

function fail(message) {
  console.error(message)
  process.exit(1)
}

function parseArgs(argv) {
  let envFile = ''
  let forceTrue = []
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--env-file') {
      envFile = argv[i + 1] ?? ''
      i += 1
      continue
    }
    if (arg.startsWith('--env-file=')) {
      envFile = arg.slice('--env-file='.length)
      continue
    }
    if (arg === '--force-true') {
      const raw = argv[i + 1] ?? ''
      i += 1
      forceTrue = parseForceTrue(raw)
      continue
    }
    if (arg.startsWith('--force-true=')) {
      forceTrue = parseForceTrue(arg.slice('--force-true='.length))
      continue
    }
    fail('PREFLIGHT_USAGE: unknown argument（只接受 --env-file / --force-true）')
  }
  return { envFile, forceTrue }
}

function parseForceTrue(raw) {
  return String(raw)
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean)
}

/**
 * 解析 dotenv 形态，不 eval、不展开 $VAR、不执行命令替换。
 * 支持 export KEY=...、单/双引号、# 注释、KEY = value。
 */
function parseEnvFile(text) {
  const env = Object.create(null)
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const exported = line.startsWith('export ') || line.startsWith('export\t')
      ? line.replace(/^export\s+/, '')
      : line
    const eq = exported.search(/\s*=\s*/)
    if (eq <= 0) continue
    const key = exported.slice(0, eq).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue
    const afterEq = exported.slice(eq).replace(/^\s*=\s*/, '')
    env[key] = unquoteEnvValue(afterEq)
  }
  return env
}

function unquoteEnvValue(raw) {
  if (!raw) return ''
  const first = raw[0]
  if (first === '"' || first === "'") {
    let i = 1
    let out = ''
    while (i < raw.length) {
      const ch = raw[i]
      if (ch === '\\' && first === '"' && i + 1 < raw.length) {
        const next = raw[i + 1]
        if (next === 'n') out += '\n'
        else if (next === 'r') out += '\r'
        else if (next === 't') out += '\t'
        else out += next
        i += 2
        continue
      }
      if (ch === first) {
        return out
      }
      out += ch
      i += 1
    }
    return out
  }
  const comment = raw.search(/\s+#/)
  return (comment >= 0 ? raw.slice(0, comment) : raw).trim()
}

function overlayProcessEnv(overlay) {
  const previous = new Map()
  for (const key of Object.keys(overlay)) {
    previous.set(key, Object.prototype.hasOwnProperty.call(process.env, key) ? process.env[key] : undefined)
    process.env[key] = overlay[key]
  }
  return () => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

function countGateCodes(source) {
  const codes = new Set()
  for (const match of source.matchAll(/\b(PRODUCTION_[A-Z0-9_]+|TRUST_PROXY_[A-Z0-9_]+)\b/g)) {
    codes.add(match[1])
  }
  return codes.size
}

function loadGates() {
  if (!existsSync(DIST_GATES)) {
    fail(
      'PREFLIGHT_GATES_MODULE_MISSING: dist/config/production-runtime-gates.js 不存在，必须先在源码检出内构建 API',
    )
  }
  const require = createRequire(import.meta.url)
  let mod
  try {
    mod = require(DIST_GATES)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    fail(`PREFLIGHT_GATES_MODULE_LOAD_FAILED: ${message}`)
  }
  const fn = mod?.assertProductionRuntimeGates
  if (typeof fn !== 'function') {
    fail('PREFLIGHT_GATES_EXPORT_MISSING: dist 模块未导出 assertProductionRuntimeGates')
  }
  return { assertProductionRuntimeGates: fn, source: readFileSync(DIST_GATES, 'utf8') }
}

function main() {
  const { envFile, forceTrue } = parseArgs(process.argv)
  if (!envFile) {
    fail('PREFLIGHT_ENV_FILE_REQUIRED: --env-file <path> 必填')
  }
  if (!existsSync(envFile)) {
    fail('PREFLIGHT_ENV_FILE_MISSING: --env-file 指向的文件不存在')
  }

  let fileText
  try {
    fileText = readFileSync(envFile, 'utf8')
  } catch {
    fail('PREFLIGHT_ENV_FILE_UNREADABLE: 无法读取 --env-file')
  }

  const parsed = parseEnvFile(fileText)
  for (const key of forceTrue) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) {
      fail(`PREFLIGHT_FORCE_TRUE_INVALID_KEY: ${key}`)
    }
    parsed[key] = 'true'
  }
  parsed.NODE_ENV = 'production'

  const { assertProductionRuntimeGates, source } = loadGates()
  const restore = overlayProcessEnv(parsed)
  try {
    // 不传第二参：字体探测用真实 probeCjkFont()（读本机字体 + 已 overlay 的 RESUME_PDF_FONT_PATH）。
    assertProductionRuntimeGates(parsed)
  } catch (error) {
    restore()
    const message = error instanceof Error ? error.message : String(error)
    fail(message)
  }
  restore()

  const n = countGateCodes(source)
  console.log(`PREFLIGHT OK: ${n > 0 ? n : 1} gates`)
}

main()
