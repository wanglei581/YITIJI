// ============================================================
// verify:deploy-gates-in-sync
//
// 生产运行闸门（production-runtime-gates.ts）与部署脚本（deploy-api-release.sh）
// 必须说同一句话：凡是 NODE_ENV=production 下要求 env 显式为 'true' 的键，
// 部署脚本 3b 步骤都必须持久化进运行目录的 .env；反之脚本里也不得多出闸门没要求的键。
//
// 为什么要机械比对（2026-09-06 实测代价）：
//   #790 给 production-runtime-gates.ts 加了 PRINT_REQUIRE_PRINTER_ONLINE 闸门，
//   deploy-api-release.sh 的 3b 仍只持久化 PRINT_REQUIRE_PII_SCAN。
//   35af2263b 发布走完 pg_dump 备份、运行目录备份、构建、迁移、PM2 重启全部步骤，
//   然后新 API 在启动期抛 PRODUCTION_PRINT_PRINTER_ONLINE_REQUIRED 拒绝启动，
//   pm2 崩溃循环 17 次，线上 API 中断到手工往 .env 补一行为止。
//   闸门本身是对的（打印机离线不得收款），错在两处清单各自维护、没人比对。
//
// 只比对 `env.KEY !== 'true'` 这一种形态：PAYMENT_PROVIDER / PRINT_SCAN_CAPABILITY_MODE
// 那类取值集合校验需要运维给出真实取值，部署脚本不能也不该盲设为 true。
// ============================================================
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const GATES_TS = 'services/api/src/config/production-runtime-gates.ts'
const DEPLOY_SH = '.github/scripts/deploy-api-release.sh'

const gatesSource = readFileSync(join(repoRoot, GATES_TS), 'utf8')
const deploySource = readFileSync(join(repoRoot, DEPLOY_SH), 'utf8')

let failures = 0
const pass = (m) => console.log(`  PASS ${m}`)
const fail = (m) => { failures += 1; console.error(`  FAIL ${m}`) }

console.log('\n=== 生产运行闸门 ↔ 部署脚本持久化清单 同步门禁 ===')

// 一、闸门源码里「必须显式为 true」的键
const requiredByGates = new Set(
  [...gatesSource.matchAll(/env\.([A-Z][A-Z0-9_]*)\s*!==\s*'true'/g)].map((m) => m[1]),
)
if (requiredByGates.size === 0) fail(`${GATES_TS} 里没找到任何 env.KEY !== 'true' 形态的闸门 —— 提取正则失效或文件被重构，本门禁需要跟着改`)
else pass(`${GATES_TS} 要求显式为 true 的键：${[...requiredByGates].sort().join(', ')}`)

// 二、部署脚本 3b 持久化的键（bash 数组 REQUIRED_PRODUCTION_GATES=( ... )）
const arrayMatch = deploySource.match(/REQUIRED_PRODUCTION_GATES=\(([\s\S]*?)\)/)
if (!arrayMatch) {
  fail(`${DEPLOY_SH} 里没找到 REQUIRED_PRODUCTION_GATES=( ... ) 数组 —— 3b 步骤被改成别的形状了，本门禁需要跟着改`)
} else {
  const persisted = new Set(
    arrayMatch[1]
      .split('\n')
      .map((line) => line.replace(/#.*$/, '').trim())
      .filter(Boolean),
  )
  pass(`${DEPLOY_SH} 3b 持久化的键：${[...persisted].sort().join(', ')}`)

  // 三、两边必须相等 —— 少一个线上起不来，多一个说明脚本在盲设一个闸门没要求的值
  const missingInScript = [...requiredByGates].filter((k) => !persisted.has(k))
  const extraInScript = [...persisted].filter((k) => !requiredByGates.has(k))
  if (missingInScript.length === 0) pass('闸门要求的键部署脚本都会持久化（发布后 API 不会因缺 env 拒绝启动）')
  else fail(`闸门要求但部署脚本不持久化：${missingInScript.join(', ')} —— 发布会在 PM2 重启后失败，而那时迁移已执行`)
  if (extraInScript.length === 0) pass('部署脚本没有多持久化闸门未要求的键')
  else fail(`部署脚本持久化了闸门并未要求的键：${extraInScript.join(', ')} —— 要么闸门被删了脚本没跟，要么脚本在盲设不该盲设的值`)

  // 四、每个键真的会写成 KEY=true（不是写成别的值）
  const writesTrue = /print key "=true"/.test(deploySource) || /print key"=true"/.test(deploySource)
  if (writesTrue) pass('3b 把每个键写成 KEY=true，与闸门的精确 === \'true\' 判定一致')
  else fail('3b 写入的值不是 "=true" —— 闸门用精确 === \'true\' 判定，带空格或大小写变体会通不过')
}

if (failures > 0) {
  console.error(`\n❌ ${failures} 项失败 — 生产闸门与部署脚本不同步，发布会在最坏时点失败\n`)
  process.exit(1)
}
console.log('\n✅ verify:deploy-gates-in-sync 通过\n')
