import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => readFileSync(join(root, relativePath), 'utf8')

let failures = 0
function pass(message) {
  console.log(`  PASS ${message}`)
}
function fail(message) {
  failures += 1
  console.error(`  FAIL ${message}`)
}
function expectMatches(source, pattern, message) {
  if (pattern.test(source)) pass(message)
  else fail(`${message} — pattern ${pattern} not found`)
}

console.log('\n=== Kiosk 壳层底部导航 active 守卫 ===')

const rootLayout = read('src/layouts/KioskRoot.tsx')
const packageJson = read('package.json')

expectMatches(
  rootLayout,
  /function\s+getActiveTab\s*\(\s*pathname:\s*string\s*\):\s*KioskTab\s*\{/,
  'KioskRoot 保留 getActiveTab(pathname) 壳层 active 入口',
)
expectMatches(
  rootLayout,
  /pathname\.startsWith\('\/assistant'\)[\s\S]{0,80}return\s+'assistant'/,
  '/assistant 继续高亮 AI助手',
)
expectMatches(
  rootLayout,
  /pathname\.startsWith\('\/profile'\)[\s\S]{0,160}return\s+'profile'/,
  '/profile 继续高亮 我的',
)
expectMatches(
  rootLayout,
  /pathname\s*===\s*'\/me'[\s\S]{0,120}return\s+'profile'/,
  '/me 归属 我的，不回退首页',
)
expectMatches(
  rootLayout,
  /pathname\.startsWith\('\/me\/'\)[\s\S]{0,120}return\s+'profile'/,
  '/me/* 归属 我的，不回退首页',
)
expectMatches(rootLayout, /return\s+'home'/, '其他路径默认仍高亮首页')
expectMatches(rootLayout, /if\s*\(\s*tab\s*===\s*'profile'\s*\)\s*return\s+'\/profile'/, '点击 我的 仍跳转 /profile 主入口')
expectMatches(packageJson, /"verify:kiosk-shell-active-nav":\s*"node scripts\/verify-kiosk-shell-active-nav\.mjs"/, 'package.json 注册 verify:kiosk-shell-active-nav')

if (failures > 0) {
  console.error(`\n❌ ${failures} 项失败 — Kiosk 壳层底部导航 active 守卫未通过\n`)
  process.exit(1)
}

console.log('✅ ALL PASS — Kiosk 壳层底部导航 active 规则符合预期\n')
