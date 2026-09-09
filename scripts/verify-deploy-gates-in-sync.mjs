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
import { existsSync, readFileSync } from 'node:fs'
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

  // 五、PM2 重启前每个键都要 export（--update-env 把 shell 环境带进进程；与 .env 持久化互为兜底）
  const restartAt = deploySource.indexOf('pm2 restart "$PM2_NAME" --update-env')
  if (restartAt < 0) fail(`${DEPLOY_SH} 里没找到 pm2 restart "$PM2_NAME" --update-env`)
  else {
    const beforeRestart = deploySource.slice(0, restartAt)
    const notExported = [...requiredByGates].filter((k) => !new RegExp(`^export ${k}=true$`, 'm').test(beforeRestart))
    if (notExported.length === 0) pass('PM2 重启前每个闸门键都已 export KEY=true')
    else fail(`PM2 重启前未 export：${notExported.join(', ')} —— 进程环境与 .env 持久化不一致`)
  }
}

// 六、备份前预检：用目标提交闸门代码检查服务器真实 .env（2026-09-06 事故根治）
//
// 3b 只能持久化 env.KEY !== 'true' 这一种形态。CJK 字体探测、取值集合、
// 将来别的闸门都不在那张清单里。预检调用目标提交 dist 里的
// assertProductionRuntimeGates()，失败必须发生在 pg_dump 之前，线上零影响。
const PREFLIGHT_SCRIPT = 'services/api/scripts/preflight-production-gates.mjs'
const preflightPath = join(repoRoot, PREFLIGHT_SCRIPT)
if (!existsSync(preflightPath)) {
  fail(`预检脚本 ${PREFLIGHT_SCRIPT} 不存在`)
} else {
  pass(`预检脚本存在：${PREFLIGHT_SCRIPT}`)
  const preflightSrc = readFileSync(preflightPath, 'utf8')
  if (preflightSrc.includes('console.log(process.env')) {
    fail('预检脚本不得 console.log(process.env…)，避免把 .env 打进公开 Actions 日志')
  } else {
    pass('预检脚本不打印 process.env')
  }
}

const preflightHeading = '=== 3c. 生产运行闸门预检（目标提交代码 × 服务器真实 .env）==='
if (deploySource.includes(preflightHeading)) pass('部署脚本含 3c 预检步骤')
else fail('部署脚本没有 3c 生产运行闸门预检步骤')

const preflightCmdAt = deploySource.indexOf('preflight-production-gates.mjs')
const pgDumpAt = deploySource.indexOf('pg_dump "$DBURL"')
if (preflightCmdAt < 0) fail('部署脚本没有调用 preflight-production-gates.mjs')
else if (pgDumpAt < 0) fail(`${DEPLOY_SH} 里没找到 pg_dump "$DBURL"`)
else if (preflightCmdAt < pgDumpAt) pass('3c 预检位于 pg_dump 之前（失败时线上未动）')
else fail('3c 预检必须位于 pg_dump 之前 —— 否则失败时备份可能已开始')

if (
  deploySource.includes('--force-true "$(IFS=,; echo "${REQUIRED_PRODUCTION_GATES[*]}")"')
) {
  pass('预检命令引用 REQUIRED_PRODUCTION_GATES（与 3b 同一份清单）')
} else {
  fail('预检命令必须引用 REQUIRED_PRODUCTION_GATES（与 3b 同一份清单）')
}

// ── 前端版的同一形态：部署脚本传 VITE_API_MODE=http，前端必须在没传时炸掉 ──────
//
// admin / partner / kiosk 的 `API_MODE` 都是「只有精确等于 'http' 才走真接口，
// 否则一律 mock」。少传或写错这个变量，构建**不会报错**，会静默打包 mock 适配器 ——
// 后台照样渲染出一整套假数据（假机构、假岗位、假价目、假法务文本），
// 运营人员照着它决策，而且外观上完全看不出来。
//
// kiosk 早就装了 `import.meta.env.PROD && API_MODE !== 'http'` 的 fail-closed 断言；
// 2026-09-09 实测 admin / partner **各 0 处**，两边只有 `import.meta.env.DEV` 下的
// console.warn —— 生产构建里那句话根本不执行。
//
// 与本门禁开头那次事故同形态：两处清单各自维护、没人比对。
// 所以两边都断言：部署脚本必须传，前端必须在没传时 fail-closed。
{
  const FRONTENDS = [
    { app: 'kiosk', client: 'apps/kiosk/src/services/api/client.ts' },
    { app: 'admin', client: 'apps/admin/src/services/api/client.ts' },
    { app: 'partner', client: 'apps/partner/src/services/api/client.ts' },
  ]
  const deployYml = readFileSync(join(repoRoot, '.github/workflows/deploy.yml'), 'utf8')

  for (const { app, client } of FRONTENDS) {
    const src = readFileSync(join(repoRoot, client), 'utf8')
    // 判据只看「PROD 且非 http 就抛」这一条，不看注释里怎么解释。
    const failsClosed =
      /import\.meta\.env\.PROD\s*&&\s*API_MODE\s*!==\s*'http'/.test(src) &&
      /throw new Error\(/.test(src.slice(src.search(/import\.meta\.env\.PROD\s*&&\s*API_MODE\s*!==\s*'http'/)))
    if (failsClosed) pass(`${app} 运行时也对 mock 模式 fail-closed（与 kiosk 对齐的纵深防御，主闸门在 vite.config）`)
    else fail(`${app} 生产构建未对 mock 模式 fail-closed —— 漏传 VITE_API_MODE 会静默发布假数据后台（${client}）`)
  }

  // ── 真正把关的是 vite.config 的构建期闸门，它必须存在 ──────────────────
  //
  // 2026-09-09 实测更正：本节最初写的是「漏传 VITE_API_MODE → 构建不报错 → 静默
  // 打包 mock」。**那是错的，我没真的构建一次就下了结论。** 实际不传时：
  //
  //   $ VITE_API_BASE_URL=/api/v1 vite build        （admin / partner 均如此）
  //   Error: [admin] 生产构建被拒绝：VITE_API_MODE 必须为 "http"（当前 "未设置"）。
  //          默认 mock 会把内存假数据打进产物，造成上线即假数据。
  //   at assertProdApiMode (apps/admin/vite.config.ts)   → exit 1，无 dist 产出
  //
  // 三个 app 的 vite.config.ts 都有 `assertProdApiMode`，在**配置加载阶段**就拒绝，
  // 比运行时抛错更早、更硬。所以「静默发布假数据后台」这个失效模式不成立。
  //
  // 但它**没有任何门禁保护**（全仓 grep：scripts/ 与各 app scripts/ 下 0 命中）——
  // 谁从某个 config 里删掉它，那个失效模式当场成立，而且没人会发现。
  // 这才是真缺口，所以钉的是它。
  for (const { app } of FRONTENDS) {
    const cfg = readFileSync(join(repoRoot, `apps/${app}/vite.config.ts`), 'utf8')
    const hasGuard =
      /function\s+assertProdApiMode|const\s+assertProdApiMode/.test(cfg) &&
      /assertProdApiMode\s*\(/.test(cfg.replace(/function\s+assertProdApiMode|const\s+assertProdApiMode/g, ''))
    if (hasGuard) pass(`${app}/vite.config.ts 有构建期闸门 assertProdApiMode 且被调用`)
    else fail(`${app}/vite.config.ts 缺少构建期闸门 assertProdApiMode（或定义了没调用）—— 漏传 VITE_API_MODE 会静默产出 mock 版本`)
  }

  // 另一半：部署脚本必须真的传。三个构建各出现一次，别只传其中一两个。
  const modeCount = (deployYml.match(/VITE_API_MODE=http/g) ?? []).length
  if (modeCount >= FRONTENDS.length) {
    pass(`deploy.yml 为 ${FRONTENDS.length} 个前端都传了 VITE_API_MODE=http（实测 ${modeCount} 处）`)
  } else {
    fail(`deploy.yml 只有 ${modeCount} 处 VITE_API_MODE=http，少于前端个数 ${FRONTENDS.length}`)
  }
}

if (failures > 0) {
  console.error(`\n❌ ${failures} 项失败 — 生产闸门与部署脚本不同步，发布会在最坏时点失败\n`)
  process.exit(1)
}
console.log('\n✅ verify:deploy-gates-in-sync 通过\n')
