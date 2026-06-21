/**
 * 招聘会列表页本校优先接线验证。
 *
 * /campus 已经会把 terminalId 传给 getJobFairs,但 /job-fairs 列表页曾保留
 * 无参调用,导致后端已验证的本校优先排序能力没有进入列表主入口。本脚本钉住
 * 列表页的最小接线形态,防止后续回退。
 *
 * 运行: node apps/kiosk/scripts/verify-jobfairs-terminal-priority.mjs
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const pagePath = join(ROOT, 'src/pages/job-fairs/JobFairsPage.tsx')
const src = readFileSync(pagePath, 'utf8')

let failed = 0
function pass(msg) { console.log(`  PASS ${msg}`) }
function fail(msg) { console.error(`  FAIL ${msg}`); failed++ }

console.log('\n=== 招聘会列表页本校优先接线验证 ===')

if (src.includes('getTerminalId')) {
  pass('1. JobFairsPage 引入/使用 getTerminalId')
} else {
  fail('1. JobFairsPage 未使用 getTerminalId')
}

if (/const\s+terminalId\s*=\s*getTerminalId\(\)/.test(src)) {
  pass('2. 页面请求前读取 terminalId')
} else {
  fail('2. 页面请求前未读取 terminalId')
}

if (/getJobFairs\(\s*terminalId\s*\?\s*\{\s*terminalId\s*\}\s*:\s*undefined\s*\)/.test(src)) {
  pass('3. getJobFairs 透传 terminalId 参数')
} else {
  fail('3. getJobFairs 未按 terminalId 透传参数')
}

if (/getJobFairs\(\s*\)/.test(src)) {
  fail('4. 仍存在无参 getJobFairs() 调用')
} else {
  pass('4. 不再保留无参 getJobFairs() 调用')
}

if (failed > 0) {
  console.error(`\n=== FAILED (${failed} 项) ===`)
  process.exit(1)
}

console.log('\n=== ALL PASS ===')
