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

// 接受两种等价的接线形态。原来只认第一种逐字形式,而 #652(6210efa07)为了同时
// 下推 status/keyword/pageSize,把调用改成了对象字面量 + 展开——功能没坏,是这条
// 正则过期了,却被登记成「功能缺口」,险些诱导后来人把展开式改回三元式、连带毁掉
// #652 的筛选下推。
//   形态一(campus / home 仍在用): getJobFairs(terminalId ? { terminalId } : undefined)
//   形态二(本页):                 getJobFairs({ ...(terminalId ? { terminalId } : {}), ... })
// 形态二里的 [^;]{0,200}? 是必需的界:不加界用 [\s\S]*? 会跨过闭合花括号和后续语句,
// 于是「调用里删掉 terminalId、但文件别处还有同形展开」这种真实回退会被判成通过——
// 那正是本门禁唯一要防的事。已对该负例实测:加界版拦得住,无界版假绿。
if (
  /getJobFairs\(\s*(?:terminalId\s*\?\s*\{\s*terminalId\s*\}\s*:\s*undefined|\{[^;]{0,200}?\.\.\.\(\s*terminalId\s*\?\s*\{\s*terminalId\s*\}\s*:\s*\{\}\s*\))/.test(src)
) {
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
