// ============================================================================
// 元门禁：CI 门禁覆盖率
//
// 守两件事：
//
//   A. REQUIRED_COMMANDS 里的命令必须在 ci.yml 里被**逐字直接**执行。
//      （原有断言，本次未做任何放宽；只是从 requiredCommands 改名并补注释。）
//
//   B. 仓库里每一个 verify:* / ui:* 脚本，要么落在 CI 的**实际执行闭包**里，
//      要么在 scripts/ci-gate-exemptions.json 里带类别和原因显式登记。
//
// 为什么要有 B —— 这是 2026-08-16 门禁全量体检的结论：
//
//   A 是一份硬编码清单。它能证明「清单里的门禁在跑」，但证明不了
//   「门禁都在跑」。新增门禁的人如果忘了往清单里加一行，A 不会报错、
//   不会提示，只是不管。verify:self-assessment 写完之后长期无人执行，
//   就是这么发生的：门禁存在 ≠ 门禁在跑，而且它给人「已覆盖」的错觉，
//   比没有门禁更危险。
//
//   B 把默认值反过来：新门禁**默认必须进 CI**，不进就必须写明为什么。
//   于是「漏接」从「安静地什么都不发生」变成「CI 红」。
//
// 为什么算闭包而不是字面 grep：
//
//   ci.yml 里写的可能是聚合脚本 —— 例如根包 build:kiosk:production 内部
//   再调 kiosk 的 verify:prod-build-config。只按字面匹配会把这类间接跑到的
//   门禁误判成漏跑。所以要顺着各 package.json 的 scripts 递归展开。
//   同理，CI step 上的 working-directory 决定了不带 --filter 的 pnpm 落在
//   哪个包，必须一起解析，否则 apps/terminal-agent 那一整步会被全判成漏跑。
//
// 运行时机：本脚本在 `pnpm install` **之前**执行（见 ci.yml「Repository
// integrity gate」步），因此只能使用 node 内置模块，不得 import 任何依赖。
// ============================================================================

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const workflowPath = join(repoRoot, '.github/workflows/ci.yml')
const exemptionsPath = join(repoRoot, 'scripts/ci-gate-exemptions.json')

// ---------------------------------------------------------------------------
// A. 必须逐字直接执行的命令（原有断言，未放宽）
// ---------------------------------------------------------------------------
// 这些门禁不允许被藏在聚合脚本后面，必须在 ci.yml 里能一眼看到。
// 只增不减：删除任何一条都等于降低标准。
const REQUIRED_COMMANDS = [
  'node scripts/verify-deploy-authorization-gate.mjs',
  'pnpm --filter @ai-job-print/miniapp verify:static',
  'pnpm run verify:task-runner-wake',
  'pnpm --filter @ai-job-print/kiosk verify:service-entry-readiness',
  // 扫码输入安全（FIX-SCAN-SAFETY）：付款码不落屏 + 非授权页吞掉 HID 突发。
  // 钉进这里是因为本文件只做「不许被悄悄摘掉」的钉子，不会自动发现新门禁。
  'pnpm --filter @ai-job-print/kiosk verify:scan-input-safety',
  'pnpm --filter @ai-job-print/admin verify:refresh-safe',
  'pnpm --filter @ai-job-print/admin verify:admin-job-materials-ui',
  'pnpm --filter @ai-job-print/admin verify:toolbox-review-ui',
  'pnpm --filter @ai-job-print/admin verify:admin-terminal-bind-code-ui',
  'pnpm --filter @ai-job-print/admin verify:admin-account-settings-ui',
  'pnpm --filter @ai-job-print/partner verify:partner-refresh-safe',
  'pnpm --filter @ai-job-print/api verify:terminal-status-idempotency',
]

const workflowText = readFileSync(workflowPath, 'utf8')
const workflowLines = new Set(
  workflowText.split(/\r?\n/).map((line) => line.trim().replace(/^run:\s*/, ''))
)

const missingRequired = REQUIRED_COMMANDS.filter((command) => !workflowLines.has(command))

// ---------------------------------------------------------------------------
// B-1. 收集全仓 verify:* / ui:* 脚本
// ---------------------------------------------------------------------------
const packageFiles = ['package.json']
for (const group of ['apps', 'services', 'packages']) {
  const groupDir = join(repoRoot, group)
  if (!existsSync(groupDir)) continue
  for (const entry of readdirSync(groupDir)) {
    const rel = `${group}/${entry}/package.json`
    if (existsSync(join(repoRoot, rel))) packageFiles.push(rel)
  }
}

/** @type {Map<string, {name: string, dir: string, scripts: Record<string,string>}>} */
const packagesByName = new Map()
/** @type {Map<string, {name: string, dir: string, scripts: Record<string,string>}>} */
const packagesByDir = new Map()
for (const rel of packageFiles) {
  const json = JSON.parse(readFileSync(join(repoRoot, rel), 'utf8'))
  const dir = rel === 'package.json' ? '.' : rel.replace(/\/package\.json$/, '')
  const pkg = { name: json.name || '(root)', dir, scripts: json.scripts || {} }
  packagesByName.set(pkg.name, pkg)
  packagesByDir.set(dir, pkg)
}

// 本门禁强制覆盖的脚本前缀。
//
// ⚠ 这个前缀表本身就是一份硬编码清单 —— 也就是本门禁要消灭的那种东西。
//   之所以暂时只收 verify: / ui:，是因为 test:* 有一批正在被别的分支接线
//   （kiosk test:browser:truth），现在纳入会和它冲突。
//
//   截至 2026-08-16，以下 test:* / audit:* / typecheck:* 脚本同样没有任何
//   CI job 执行，属于**已知未纳管**，不是已覆盖：
//     @ai-job-print/kiosk::test:browser
//     @ai-job-print/kiosk::test:browser:fusion
//     @ai-job-print/kiosk::test:browser:p1-evidence
//     @ai-job-print/kiosk::test:browser:truth        ← 正由另一分支接线
//     @ai-job-print/kiosk::test:visual
//     @ai-job-print/api::audit:cloud-upload-capability-usage
//     (root)::typecheck:refresh
//
//   后续动作：等 test:browser:truth 接线落地后，把 'test' 加进本表，
//   再按同样规则给剩下几条登记豁免或接线。改这里请一并更新上面这段清单。
const ENFORCED_PREFIXES = ['verify', 'ui']
const isGate = (scriptName) =>
  ENFORCED_PREFIXES.some((prefix) => scriptName.startsWith(`${prefix}:`))

/** @type {Set<string>} key = `${packageName}::${scriptName}` */
const allGates = new Set()
for (const pkg of packagesByName.values()) {
  for (const scriptName of Object.keys(pkg.scripts)) {
    if (isGate(scriptName)) allGates.add(`${pkg.name}::${scriptName}`)
  }
}

// ---------------------------------------------------------------------------
// B-2. 解析 ci.yml 的 step（run 命令 + working-directory）
// ---------------------------------------------------------------------------
function parseWorkflowSteps(text) {
  const lines = text.split(/\r?\n/)
  const steps = []
  let current = null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^\s*- (name|uses):/.test(line)) {
      current = { workingDirectory: null, commands: [] }
      steps.push(current)
    }
    const wd = line.match(/^\s*working-directory:\s*(\S+)/)
    if (wd && current) current.workingDirectory = wd[1].replace(/['"]/g, '')

    const run = line.match(/^(\s*)(?:- )?run:\s*(\|-?|>-?)?\s*(.*)$/)
    if (!run) continue
    if (!current) {
      current = { workingDirectory: null, commands: [] }
      steps.push(current)
    }
    const indent = run[1].length
    if (run[2]) {
      // 块标量：吃掉后续缩进更深的行
      for (let j = i + 1; j < lines.length; j++) {
        const inner = lines[j]
        if (inner.trim() === '') continue
        if (inner.match(/^\s*/)[0].length <= indent) break
        current.commands.push(inner.trim())
        i = j
      }
    } else if (run[3]) {
      current.commands.push(run[3].trim())
    }
  }
  return steps
}

function resolvePackage(token) {
  if (!token) return null
  if (packagesByName.has(token)) return packagesByName.get(token)
  const normalized = token.replace(/^\.\//, '').replace(/\/$/, '')
  return packagesByDir.get(normalized) || null
}

/** 从一条 shell 命令里解析出它调用了哪些 pnpm/npm 脚本。 */
function parseScriptInvocations(commandLine, cwdPackage) {
  const found = []
  for (const segment of commandLine.split(/&&|\|\||;|\n/)) {
    const tokens = segment.trim().split(/\s+/).filter(Boolean)
    const runnerIndex = tokens.findIndex((t) => t === 'pnpm' || t === 'npm' || t === 'pnpm.cmd')
    if (runnerIndex === -1) continue

    let rest = tokens.slice(runnerIndex + 1)
    let pkg = cwdPackage || packagesByDir.get('.')
    let recursive = false

    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === '--filter' || rest[i] === '-F') {
        pkg = resolvePackage(rest[i + 1]) || pkg
        rest.splice(i, 2)
        i -= 1
      } else if (rest[i].startsWith('--filter=')) {
        pkg = resolvePackage(rest[i].slice('--filter='.length)) || pkg
        rest.splice(i, 1)
        i -= 1
      } else if (rest[i] === '--prefix' || rest[i] === '-C' || rest[i] === '--dir') {
        pkg = resolvePackage(rest[i + 1]) || pkg
        rest.splice(i, 2)
        i -= 1
      } else if (rest[i] === '-r' || rest[i] === '--recursive') {
        recursive = true
        rest.splice(i, 1)
        i -= 1
      }
    }

    rest = rest.filter((t) => !t.startsWith('-'))
    if (rest[0] === 'run' || rest[0] === 'run-script') rest = rest.slice(1)
    const scriptName = rest[0]
    if (!scriptName) continue

    if (recursive) {
      for (const candidate of packagesByName.values()) {
        if (candidate.scripts[scriptName] !== undefined) {
          found.push({ pkg: candidate, scriptName })
        }
      }
    } else if (pkg && pkg.scripts[scriptName] !== undefined) {
      found.push({ pkg, scriptName })
    }
  }
  return found
}

// ---------------------------------------------------------------------------
// B-3. 展开执行闭包
// ---------------------------------------------------------------------------
/** @type {Map<string,string>} gateKey -> 覆盖原因 */
const executed = new Map()

function expand(pkg, scriptName, reason) {
  const key = `${pkg.name}::${scriptName}`
  if (executed.has(key)) return
  executed.set(key, reason)
  const body = pkg.scripts[scriptName]
  if (!body) return
  for (const invocation of parseScriptInvocations(body, pkg)) {
    expand(invocation.pkg, invocation.scriptName, `间接经由 ${key}`)
  }
}

const steps = parseWorkflowSteps(workflowText)
for (const step of steps) {
  const cwdPackage = step.workingDirectory
    ? resolvePackage(step.workingDirectory)
    : packagesByDir.get('.')
  for (const command of step.commands) {
    for (const invocation of parseScriptInvocations(command, cwdPackage)) {
      expand(invocation.pkg, invocation.scriptName, `ci.yml 直接执行`)
    }
  }
}

// 有些门禁 CI 不走脚本名、直接跑同一条命令体（例如根包
// verify:deploy-authorization-gate 在 ci.yml 里写成 node scripts/...mjs）。
// 这类同样算已覆盖，否则会产生假漏报。
const normalize = (s) => s.trim().replace(/\s+/g, ' ')
const directBodies = new Set()
for (const step of steps) {
  const cwd = step.workingDirectory ? step.workingDirectory.replace(/^\.\//, '') : '.'
  for (const command of step.commands) directBodies.add(`${cwd}|${normalize(command)}`)
}
for (const gateKey of allGates) {
  if (executed.has(gateKey)) continue
  const [pkgName, scriptName] = gateKey.split('::')
  const pkg = packagesByName.get(pkgName)
  if (directBodies.has(`${pkg.dir}|${normalize(pkg.scripts[scriptName])}`)) {
    executed.set(gateKey, 'ci.yml 直接执行命令体（未经脚本名）')
  }
}

// ---------------------------------------------------------------------------
// B-4. 豁免登记表
// ---------------------------------------------------------------------------
const VALID_CATEGORIES = new Set([
  'live-credentials', // 需要真实外部服务密钥 / 会消耗真实额度
  'real-hardware', // 需要 Windows 真机、打印机、扫描仪等物理设备
  'running-server', // 需要本机已经起好 API 服务，CI 内无此前置
  'manual-acceptance', // 人工验收 / 演练用，不是自动回归
  // 纯聚合别名：body 只是把若干子门禁串起来，自己没有独有断言。
  // 子门禁全部已在 CI 时，别名再挂一遍只是把同一批断言跑第二遍。
  // ⚠ 这个类别的前提由下面的 B-5 机器复核，不接受口头声明。
  'redundant-alias',
  'pending-ci-wiring', // 真遗漏，尚未接线；reason 必须写明当前阻塞
])

// pending-ci-wiring 是「欠账」而不是「结论」。这个上限只允许调低，不允许调高：
// 想加新的 pending，先还掉一条旧的。防止豁免表退化成垃圾桶。
//
// 12 → 1（2026-08-16，GATE-WIRE）：#641 登记的 11 条欠账本批全部还清 ——
// 10 条实跑绿后接进 ci.yml，1 条（member-login-data-closure）复核为纯聚合别名、
// 改判 redundant-alias。当时上限 12 / 实际 11，留有 1 格余量；还清 11 条后
// 按「还几条降几条」降到 1，保持同样的 1 格余量。
// 不降到 0 是刻意的：留一格是为了让下一个确实接不进去的门禁能如实登记成欠账，
// 而不是被迫塞进一个不准确的类别——那会把这张表从「账本」变回「遮羞布」。
const MAX_PENDING = 1

const exemptionsFile = JSON.parse(readFileSync(exemptionsPath, 'utf8'))
const exemptions = exemptionsFile.exemptions || []

const problems = []

/** @type {Map<string, object>} */
const exemptionByGate = new Map()
for (const item of exemptions) {
  if (!item.gate || !item.category || !item.reason) {
    problems.push(`豁免条目字段不全（需 gate / category / reason）：${JSON.stringify(item)}`)
    continue
  }
  if (!VALID_CATEGORIES.has(item.category)) {
    problems.push(
      `豁免类别非法：${item.gate} → "${item.category}"（合法值：${[...VALID_CATEGORIES].join(', ')}）`
    )
  }
  if (item.reason.trim().length < 12) {
    problems.push(`豁免原因过短，说不清为什么不进 CI：${item.gate} → "${item.reason}"`)
  }
  if (exemptionByGate.has(item.gate)) {
    problems.push(`豁免条目重复：${item.gate}`)
  }
  exemptionByGate.set(item.gate, item)
}

// 陈旧豁免：门禁已经不存在了，条目却还留着
for (const gate of exemptionByGate.keys()) {
  if (!allGates.has(gate)) {
    problems.push(`豁免条目已陈旧（该门禁脚本已不存在，请删除本条）：${gate}`)
  }
}

// 陈旧豁免：门禁其实已经进 CI 了，条目却还留着 —— 留着会让下一个人以为它没在跑
for (const gate of exemptionByGate.keys()) {
  if (allGates.has(gate) && executed.has(gate)) {
    problems.push(`豁免条目已陈旧（该门禁已被 CI 执行，请删除本条）：${gate}`)
  }
}

// ---------------------------------------------------------------------------
// B-5. redundant-alias 的前提必须由机器复核
// ---------------------------------------------------------------------------
// 「这个别名的子门禁已经全在 CI 了，所以别名本身不用挂」是一个**会过期**的结论：
// 只要有人把其中一个子门禁从 ci.yml 里删掉，这句话就变成假话，而豁免条目还留在表里，
// 下一个人读到的仍是「已覆盖」。所以不接受 reason 里的口头声明 —— 直接解析别名 body，
// 把每个子门禁拿去和执行闭包比对。
for (const item of exemptions) {
  if (item.category !== 'redundant-alias') continue
  const [pkgName, scriptName] = item.gate.split('::')
  const pkg = packagesByName.get(pkgName)
  if (!pkg || pkg.scripts[scriptName] === undefined) continue // 陈旧条目已在别处报过

  const subGates = parseScriptInvocations(pkg.scripts[scriptName], pkg).map(
    (invocation) => `${invocation.pkg.name}::${invocation.scriptName}`
  )
  if (subGates.length === 0) {
    problems.push(
      `redundant-alias 用错了：${item.gate} 的 body 里解析不出任何子门禁调用，` +
        `它不是聚合别名。请改用其它类别。`
    )
    continue
  }
  const uncovered = [...new Set(subGates)].filter((sub) => !executed.has(sub))
  if (uncovered.length > 0) {
    problems.push(
      `redundant-alias 的前提已不成立：${item.gate} 的 ${uncovered.length} 条子门禁不在 CI 闭包内 ——` +
        ` ${uncovered.join(', ')}。` +
        `要么把这些子门禁接回 ci.yml，要么这条豁免改用其它类别（别名此时是有独有覆盖的）。`
    )
  }
}

// 真漏跑：既不在 CI 闭包里，也没登记豁免
const unexplained = [...allGates].filter((g) => !executed.has(g) && !exemptionByGate.has(g)).sort()
for (const gate of unexplained) {
  problems.push(`门禁未被任何 CI job 执行，且未登记豁免原因：${gate}`)
}

// pending 欠账棘轮
const pendingCount = exemptions.filter((e) => e.category === 'pending-ci-wiring').length
if (pendingCount > MAX_PENDING) {
  problems.push(
    `pending-ci-wiring 欠账 ${pendingCount} 条，超过上限 ${MAX_PENDING}。` +
      `该上限只允许调低：请先把已有欠账接进 CI，而不是调高上限。`
  )
}

// ---------------------------------------------------------------------------
// 输出
// ---------------------------------------------------------------------------
let failed = false

if (missingRequired.length > 0) {
  failed = true
  console.error('ERROR: required deterministic CI gates are not directly executed:')
  for (const command of missingRequired) console.error(`  ${command}`)
}

if (problems.length > 0) {
  failed = true
  console.error('ERROR: CI 门禁覆盖率检查未通过：')
  for (const problem of problems) console.error(`  - ${problem}`)
  console.error('')
  console.error('  修法二选一：')
  console.error('    1) 把门禁挂进 .github/workflows/ci.yml（注意步骤位置：')
  console.error('       import services/api/src 的门禁必须放在「Prepare fresh SQLite db」之后，')
  console.error("       否则会报 Cannot find module '../generated/prisma/client'）；")
  console.error('    2) 确实不该进 CI 的，在 scripts/ci-gate-exemptions.json 登记类别与原因。')
}

if (failed) process.exit(1)

const coveredCount = [...allGates].filter((gate) => executed.has(gate)).length
console.log(
  `OK: ${REQUIRED_COMMANDS.length} deterministic CI gates are directly executed; ` +
    `${coveredCount}/${allGates.size} verify/ui 门禁在 CI 执行闭包内，` +
    `${exemptionByGate.size} 条已登记豁免（其中 ${pendingCount} 条待接线，上限 ${MAX_PENDING}）`
)
