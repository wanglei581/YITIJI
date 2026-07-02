import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const API_CLIENT = join(ROOT, 'src/services/api/client.ts')
const PACKAGE_JSON = join(ROOT, 'package.json')

let failed = 0
function pass(message) {
  console.log(`  PASS ${message}`)
}
function fail(message) {
  console.error(`  FAIL ${message}`)
  failed += 1
}
function mustContain(source, token, label) {
  if (source.includes(token)) pass(label)
  else fail(`${label} — 未找到: ${token}`)
}
function mustMatch(source, pattern, label) {
  if (pattern.test(source)) pass(label)
  else fail(`${label} — 未匹配: ${pattern}`)
}

console.log('\n=== Kiosk 生产真实服务门禁验证 ===')

const clientSource = readFileSync(API_CLIENT, 'utf8')
const packageJson = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8'))

mustContain(clientSource, 'import.meta.env.PROD', 'API Client 识别生产构建环境')
mustMatch(clientSource, /API_MODE\s*!==\s*['"]http['"]/, 'API Client 生产环境拒绝非 http 模式')
mustContain(clientSource, 'VITE_API_MODE=http', 'API Client 错误信息指向真实 API 模式')
mustContain(clientSource, '禁止使用 mock API 模式', 'API Client 明确禁止生产 mock API')

if (packageJson.scripts?.['verify:production-real-services']) {
  pass('package.json 暴露 verify:production-real-services')
} else {
  fail('package.json 缺少 verify:production-real-services')
}

if (failed > 0) {
  console.error(`\n❌ ${failed} 项失败 — Kiosk 生产真实服务门禁未通过\n`)
  process.exit(1)
}

console.log('✅ ALL PASS — Kiosk 生产真实服务门禁一致\n')
