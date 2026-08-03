import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

function fail(message) {
  console.error(`FAIL ${message}`)
  process.exit(1)
}

function pass(message) {
  console.log(`PASS ${message}`)
}

function read(path) {
  const full = join(root, path)
  if (!existsSync(full)) fail(`missing ${path}`)
  return readFileSync(full, 'utf8')
}

function mustContain(path, tokens, message) {
  const text = read(path)
  const missing = tokens.filter((token) => !text.includes(token))
  if (missing.length) fail(`${message}; missing=${missing.join(', ')}`)
  pass(message)
}

function mustNotContain(path, tokens, message) {
  const text = read(path)
  const hit = tokens.find((token) => text.includes(token))
  if (hit) fail(`${message}; hit=${hit}`)
  pass(message)
}

/** 与 client.resolveApiUrl 同语义的纯函数，供门禁断言相对/绝对 base。 */
function resolveApiUrlPure(apiBaseUrl, path, searchParams, origin) {
  const url = new URL(`${apiBaseUrl}${path}`, origin)
  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      url.searchParams.set(key, value)
    }
  }
  return url.toString()
}

console.log('\n=== Partner 相对 API URL 解析门禁 ===')

mustContain('package.json', ['"verify:partner-relative-api-url"'], 'Partner package 注册相对 API URL 门禁')
mustContain('src/services/api/client.ts', [
  'export function resolveApiUrl',
  'new URL(`${API_BASE_URL}${path}`, fallback)',
  '禁止单参数',
], 'client 导出 resolveApiUrl 并用页面 origin 解析相对 base')
mustContain('src/services/api/partnerHttpAdapter.ts', [
  'resolveApiUrl',
  'resolveApiUrl(path, params)',
  "resolveApiUrl('/partner/excel/template', { dataType })",
], 'HTTP adapter GET/模板下载走 resolveApiUrl')
mustNotContain(
  'src/services/api/partnerHttpAdapter.ts',
  ['new URL(`${API_BASE_URL}${path}`)'],
  'HTTP adapter 不再使用单参数 new URL(相对地址)',
)

const relative = resolveApiUrlPure('/api/v1', '/partner/jobs', { q: '1' }, 'https://partner.zyidai.cn')
if (relative !== 'https://partner.zyidai.cn/api/v1/partner/jobs?q=1') {
  fail(`相对 base 解析错误: ${relative}`)
}
pass('相对 VITE_API_BASE_URL=/api/v1 解析到页面 origin')

const absolute = resolveApiUrlPure(
  'http://127.0.0.1:3010/api/v1',
  '/partner/jobs',
  undefined,
  'https://partner.zyidai.cn',
)
if (absolute !== 'http://127.0.0.1:3010/api/v1/partner/jobs') {
  fail(`绝对 base 解析错误: ${absolute}`)
}
pass('绝对 VITE_API_BASE_URL 保留 API host，不误用页面 origin')

let threw = false
try {
  // eslint-disable-next-line no-new
  new URL('/api/v1/partner/jobs')
} catch {
  threw = true
}
if (!threw) fail('预期单参数相对 URL 抛错，用于锁定缺陷回归')
pass('单参数 new URL(相对路径) 仍会抛错（缺陷对照）')

console.log('ALL PASS')
