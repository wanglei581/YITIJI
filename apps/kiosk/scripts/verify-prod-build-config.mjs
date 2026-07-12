/**
 * Kiosk 生产构建配置守卫。
 *
 * 目标：防止云端 rebuild 时漏掉数字人关键 Vite 构建变量，导致 `/assistant`
 * 从 TRTC 数字人回落为文字助手。该脚本应在 `pnpm --filter @ai-job-print/kiosk build`
 * 之后执行，因为它会同时检查环境变量和 dist 产物。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnv } from 'vite'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(ROOT, 'dist')
const ASSETS = join(DIST, 'assets')
const loadedEnv = loadEnv(process.env.MODE ?? 'production', ROOT, '')
const forbiddenDevSandboxPaymentLabels = ['[DEV] 沙箱模拟', '模拟支付成功']
const distTextExtensions = new Set(['.html', '.js', '.css', '.map', '.json', '.txt'])

let failed = 0
function pass(message) {
  console.log(`  PASS ${message}`)
}
function fail(message) {
  console.error(`  FAIL ${message}`)
  failed += 1
}

function env(name) {
  return (process.env[name] ?? loadedEnv[name] ?? '').trim()
}

function isPlaceholder(value) {
  return (
    !value ||
    value.includes('<') ||
    value.includes('>') ||
    /^(todo|placeholder|your_|example)/i.test(value) ||
    value.includes('注册后的') ||
    value.toLowerCase().includes('terminal id')
  )
}

function mustEqual(name, expected, label) {
  const actual = env(name)
  if (actual === expected) pass(label)
  else fail(`${label} — ${name} 应为 ${expected}, 当前为 ${actual || '未设置'}`)
}

function mustBeConfigured(name, label) {
  const actual = env(name)
  if (!isPlaceholder(actual)) pass(label)
  else fail(`${label} — ${name} 未配置或仍是占位符`)
  return actual
}

function readRequired(file, label) {
  if (!existsSync(file)) {
    fail(`${label} — 文件缺失: ${file}`)
    return ''
  }
  pass(label)
  return readFileSync(file, 'utf8')
}

function readDistTextFiles(directory) {
  if (!existsSync(directory)) return []

  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return readDistTextFiles(path)
    if (!entry.isFile()) return []
    if (!distTextExtensions.has(extname(entry.name))) return []
    return [{ path, src: readFileSync(path, 'utf8') }]
  })
}

console.log('\n=== Kiosk 生产构建配置 / 数字人产物验证 ===')

mustEqual('VITE_API_MODE', 'http', 'A1 生产构建使用真实 API 模式')
mustEqual('VITE_API_BASE_URL', '/api/v1', 'A2 生产构建使用同源 /api/v1')
const allowTextOnly = env('VITE_ALLOW_TEXT_ONLY_ASSISTANT') === 'true'
if (allowTextOnly) {
  pass('A3 生产构建显式允许文字助手模式，跳过 TRTC 数字人产物校验')
} else {
  mustEqual('VITE_USE_TRTC_CALL', 'true', 'A3 生产构建启用 TRTC 数字人入口')
}
// A4 终端 ID：打印/扫描任务创建强依赖 X-Terminal-Id（print-scan 首期 Task 11 门禁），
// 与是否启用数字人无关 —— 文字助手模式（VITE_ALLOW_TEXT_ONLY_ASSISTANT）不豁免本项。
const terminalId = mustBeConfigured('VITE_TERMINAL_ID', 'A4 生产构建注入真实终端 ID（print-scan 必需，文字助手模式不豁免）')

const indexHtml = readRequired(join(DIST, 'index.html'), 'B1 dist/index.html 已生成')
if (indexHtml.includes('assets/index-') && indexHtml.includes('.js')) {
  pass('B2 index.html 引用生产主 bundle')
} else {
  fail('B2 index.html 未引用生产主 bundle')
}

if (!existsSync(ASSETS)) {
  fail(`B3 assets 目录缺失: ${ASSETS}`)
} else {
  pass('B3 assets 目录已生成')
  const jsAssets = readdirSync(ASSETS)
    .filter((name) => name.endsWith('.js'))
    .map((name) => ({ name, src: readFileSync(join(ASSETS, name), 'utf8') }))

  if (allowTextOnly) {
    pass('C1 文字助手模式不要求数字人通话产物')
  } else {
    const aiAdvisorAsset = jsAssets.find(({ src }) =>
      src.includes('/trtc/session') && src.includes('X-Terminal-Id'),
    )
    const trtcAsset = jsAssets.find(({ src }) => {
      const sdkSignals = ['trtc-sdk', 'enterRoom', 'REMOTE_AUDIO_AVAILABLE']
        .filter((token) => src.includes(token))
      return src.includes('TRTC') && sdkSignals.length >= 2
    })

    if (aiAdvisorAsset) pass(`C1 数字人通话产物已生成 (${aiAdvisorAsset.name})`)
    else fail('C1 未找到包含 TRTC session API 与 X-Terminal-Id 的数字人产物，可能漏掉 VITE_USE_TRTC_CALL=true')

    if (trtcAsset) pass(`C2 TRTC SDK 产物已生成 (${trtcAsset.name})`)
    else fail('C2 未找到包含 TRTC SDK 核心信号的产物，数字人语音通话不会加载')

    if (aiAdvisorAsset) {
      if (aiAdvisorAsset.src.includes('/trtc/session')) pass('C3 数字人产物调用 TRTC session API 路径')
      else fail('C3 数字人产物未包含 /trtc/session 调用')

      if (aiAdvisorAsset.src.includes('X-Terminal-Id')) pass('C4 数字人产物携带 X-Terminal-Id header')
      else fail('C4 数字人产物未包含 X-Terminal-Id header')

      if (terminalId && aiAdvisorAsset.src.includes(terminalId)) pass('C5 终端 ID 已写入数字人产物')
      else fail('C5 数字人产物未包含当前 VITE_TERMINAL_ID，可能检查的不是本次构建产物')
    }
  }
}

if (existsSync(DIST)) {
  const exposedDevSandboxLabels = readDistTextFiles(DIST).flatMap(({ path, src }) =>
    forbiddenDevSandboxPaymentLabels
      .filter((label) => src.includes(label))
      .map((label) => `${path}: ${label}`),
  )

  if (exposedDevSandboxLabels.length === 0) {
    pass('D1 生产产物未暴露 DEV 沙箱支付按钮文案')
  } else {
    fail(
      `D1 production kiosk bundle must not expose DEV sandbox payment buttons — ${exposedDevSandboxLabels.join(', ')}`,
    )
  }
}

if (process.exitCode || failed > 0) {
  console.error(`\n❌ ${failed} 项失败 — Kiosk 生产构建配置未通过\n`)
  process.exit(1)
}

console.log('✅ ALL PASS — Kiosk 生产构建配置与数字人产物一致\n')
