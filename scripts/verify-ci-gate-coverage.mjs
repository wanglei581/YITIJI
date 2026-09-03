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
// C 段复用项目图谱的门禁解析（同样只依赖 node 内置模块，可在 pnpm install 之前跑）。
// 共用一套判定是刻意的：图谱和本门禁若各写一份「什么算门禁脚本」，迟早会给出
// 互相矛盾的答案，而那正是本门禁存在的理由。
import { buildGateIndex, gateHelperModules } from './project-graph/gates.mjs'
import { trackedFiles } from './project-graph/repo.mjs'

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
  // P21 申领条件录入面（#645）：该门禁自己的 10c 断言会反向读取本清单，确认
  // 自己被钉住。B 段的闭包检查也覆盖它，但那两条守的不是同一件事 —— B 段保证
  // 「在 CI 里跑」，本条保证「在 ci.yml 里逐字可见、不被藏进聚合脚本」。
  'pnpm --filter @ai-job-print/api verify:policy-eligibility-authoring',
  // 后台可用性与可运维性（FIX-CONSOLE-P0）：Redis 故障时后台曾全线 500 而
  // /health 宣称「管理端不受影响」；所有 500 在服务端零痕迹。这两条都被
  // 「摘掉门禁就悄悄回归」的类型，因此钉进本文件。
  'VERIFICATION_DATABASE_TARGET=isolated pnpm --filter @ai-job-print/api verify:redis-degradation-truth',
  'pnpm --filter @ai-job-print/api verify:error-observability',
  'VERIFICATION_DATABASE_TARGET=isolated pnpm --filter @ai-job-print/api verify:admin-order-filters',
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
//   收进来一个前缀，等于宣布「该前缀下的脚本默认必须进 CI」；因此每次放开都必须
//   先实测放开后会有哪些脚本掉出闭包，并在同一批里给它们接线或登记豁免。
//   单独改这一行会让它们立刻命中下面 B-4 段的「未登记豁免」而直接把 CI 打红。
//
//   ── 2026-09-02 复核（上一版这段清单写于 2026-08-16，已过期，本次全部重测）──
//
//   'typecheck' 与 'test' 的原阻塞点 —— kiosk test:browser:truth「正由另一分支接线」——
//   已消失：它已在 ci.yml 接线。但「阻塞点消失」不等于「可以放开」，实测如下。
//
//   放开 'test'：还剩 4 条会掉出闭包，**尚不能放开**。
//     @ai-job-print/kiosk::test:browser          body = `playwright test`（跑全量 spec），
//                                                与已分片接线的 :smoke/:w1..:w6 等重叠
//     @ai-job-print/kiosk::test:browser:fusion   纯聚合别名 = smoke && w1..w6，
//                                                7 个子门禁全部已在 CI → 适用 redundant-alias，
//                                                且该类别的前提由下面 B-5 段机器复核
//     @ai-job-print/kiosk::test:browser:p1-evidence
//     @ai-job-print/kiosk::test:visual
//   其余 test:*（smoke / w1..w6 / privacy / warning / contract-review / scan-safety /
//   mic-capability / truth）均已在 CI 闭包内。
//   卡在哪：后三条的正确归宿（接线 vs manual-acceptance）取决于 Playwright 在 CI runner
//   上的可用性、耗时、稳定性，以及与已分片接线部分的覆盖重叠程度 —— 需实跑评估，
//   未评估前不猜。这是一个待产品负责人拍板的排期项，不是本门禁的缺陷。
//
//   放开 'typecheck'：实测 **0 条掉出闭包**（本轮把 packages/refresh 的 typecheck
//   接进 ci.yml 之后；在此之前唯一掉出的是 ai-job-print-terminal::typecheck:refresh）。
//   也就是说这个前缀现在随时可以放开，放开还能顺带把「refresh typecheck 被人删掉」
//   变成 CI 红。未在本轮一并执行，是因为它超出本次授权范围，留作独立排期。
//
//   放开 'audit'：还剩 1 条 —— @ai-job-print/api::audit:cloud-upload-capability-usage。
//   它是「审计报告」还是「可门禁化的断言」未查证，未查证前不放开。
//
//   改这一行请一并重测并更新上面这段清单（重测方法：把新前缀加进本表跑一遍本脚本，
//   看 B-4 段报出哪些「未被任何 CI job 执行」）。
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

// ---------------------------------------------------------------------------
// C. scripts/ 下的门禁脚本文件必须有 package.json 脚本名
// ---------------------------------------------------------------------------
// A 段守「清单里的门禁在 ci.yml 里逐字可见」，B 段守「已声明的脚本名进 CI 闭包」。
// 两段都是从 **package.json 的脚本名** 出发的 —— 于是它们共享同一个盲区：
//
//   一个 .mjs 文件躺在 scripts/ 下，但没有任何 package.json 给它起过名字。
//
// 它连 allGates 的枚举入口都进不去，A、B 两段都不会看它一眼。这不是理论风险：
// 2026-08-18 的图谱扫描在本仓库找到 3 个这样的文件，**逐个跑起来，3 个全部 FAIL**。
// 也就是说「门禁存在 ≠ 门禁在跑」这句话在本仓库的实测命中率是 100%。
// 其中 verify-partner-account-delete-ui.mjs 更严重：它断言必须存在的
// PartnerAccountDeletionDialog.tsx 已被删除，而同目录的
// verify-partner-account-action-ui.mjs 断言的恰恰是该文件**必须不存在** ——
// 两条门禁互相矛盾，作者互相不知道对方存在，而只有被接线的那条在跑。
//
// 本段把默认值再反一次：scripts/ 下的门禁脚本**默认必须有脚本名**，没有就必须
// 在 ci-gate-exemptions.json 的 unwiredScripts 里写明为什么。于是「写完没接线」
// 从「安静地什么都不发生」变成「CI 红」。
//
// 判定复用 scripts/project-graph/gates.mjs（图谱同一套解析），保证图谱和本门禁
// 不可能给出互相矛盾的答案。被别的脚本 import / spawn / 读源码比对 / 被 shell
// 包装脚本拉起的辅助模块不算门禁入口，本来就不该有脚本名。
const trackedSet = new Set(trackedFiles())
const { gates: gateFileIndex } = buildGateIndex(trackedSet)
const helperScripts = gateHelperModules(trackedSet)

const unwiredScriptFiles = [...gateFileIndex.values()]
  .filter((gate) => gate.scriptNames.length === 0 && !helperScripts.has(gate.file))
  .map((gate) => gate.file)
  .sort()

const VALID_UNWIRED_CATEGORIES = new Set([
  // 断言对象已被删除，或与另一条门禁互相矛盾 —— 该删的是门禁本身，不是接线
  'broken-pending-deletion',
  // 门禁断言的功能确实没实现：现在接线会让 CI 红，须先修功能或改断言
  'broken-pending-fix',
  // 2026-09-03 新增：补 .ts 支持后第一次可见的存量未接线脚本。
  // 与上面两类的区别是**尚未判定** —— 还没逐条跑过，不知道是该接线还是该删。
  // 这个类别只允许在「图谱可见范围扩大」这种一次性事件后使用，且必须逐条还账。
  'newly-visible-pending-triage',
])

// 这个上限同样只允许调低。想加新的未接线脚本，先还掉一条旧的。
// 3（2026-08-18，图谱首次扫描）：全部为「跑起来就红」的存量欠账，逐条登记在案。
// 3 → 1（2026-09-02）：本批还掉两条，按「还几条降几格」降两格。
//   ① verify-jobfairs-terminal-priority.mjs —— 复核发现豁免理由把因果写反了：
//      功能（terminalId 透传）端到端完整，坏的是门禁自己的正则（#652 重构后没跟着改）。
//      修正则后 4/4 PASS，已起脚本名并接进 ci.yml。
//   ② verify-self-assessment-r3-pick.mjs —— 一次性 cherry-pick 守卫，服务对象 PR #486
//      已 squash 合入 main（03c30bdcd）。它按 merge-base(HEAD, origin/main)..HEAD 取增量提交，
//      在 main 上该 range 恒为空、在任何新分支上都不含 #486 的 commit，因此恒抛
//      ERR_ASSERTION，结构上不可能接线。已删除脚本文件本身。
// 13（2026-09-03，**分母变了，不是新增欠账**）：此前 gates.mjs 的 GATE_EXT_PATTERN 是
//   /\.(mjs|cjs|js)$/ —— 不含 .ts。于是 services/api/scripts/ 下 261 条 .ts 门禁
//   **一条都没进过图谱**（旧图谱收录 167 条，全是 .mjs）。CLAUDE.md §14 让人「改文件前
//   查图谱看被哪些门禁断言」，而它对 58% 的门禁系统性失明，且不声明自己看不见。
//   本次补上 .ts 之后，这 13 条一直存在、一直没接线的脚本才第一次可见。
//   **它们不是本次新增的欠账，是本次第一次被看见的欠账。**
//   其中约 3 条根本不是门禁（fixture / 维护脚本：change-password-verify-target.ts、
//   clear-import-rawdata.ts、release-provenance-fixture.ts），其余是写完没接线的真门禁。
//   逐条接线或登记是独立任务（接上去很可能直接红），不在本刀范围。
//   从这个新基线起，「只允许调低」照旧生效。
// 13 → 10（2026-09-03）：terminal-agent 三条从未跑过的门禁实跑全绿后接线，
//   按「还几条降几格」降三格。断言对象都在，注入桩/临时 SQLite/loopback HTTP，
//   不依赖 Windows 真机；已起 verify:* 脚本名并改 ci.yml 为 pnpm run。
// 10 → 1（2026-09-03，triage 收口）：api 侧两条（wave2 账号重绑 23 断言、wave3 打印善后
//   7 断言）实跑全绿后接线；verify-change-password.ts 是**误判出账** —— 它早经
//   run-verify-change-password.mjs launcher 在 CI 一直跑着，图谱看不见是 gates.mjs 的
//   字面量正则不认 .ts（本批已修），修好后回归 helper 分类。至此 newly-visible 六条
//   全部还清。剩下的 1 = verify-partner-account-delete-ui.mjs（断言互相矛盾的存量，
//   登记为 broken-pending-deletion）。
const MAX_UNWIRED = 1

const unwiredRegistry = exemptionsFile.unwiredScripts || []
/** @type {Map<string, object>} */
const unwiredByScript = new Map()
for (const item of unwiredRegistry) {
  if (!item.script || !item.category || !item.reason) {
    problems.push(`unwiredScripts 条目字段不全（需 script / category / reason）：${JSON.stringify(item)}`)
    continue
  }
  if (!VALID_UNWIRED_CATEGORIES.has(item.category)) {
    problems.push(
      `unwiredScripts 类别非法：${item.script} → "${item.category}"` +
        `（合法值：${[...VALID_UNWIRED_CATEGORIES].join(', ')}）`
    )
  }
  if (item.reason.trim().length < 12) {
    problems.push(`unwiredScripts 原因过短：${item.script} → "${item.reason}"`)
  }
  if (unwiredByScript.has(item.script)) {
    problems.push(`unwiredScripts 条目重复：${item.script}`)
  }
  unwiredByScript.set(item.script, item)
}

for (const script of unwiredScriptFiles) {
  if (unwiredByScript.has(script)) continue
  problems.push(
    `门禁脚本存在，但没有任何 package.json 脚本名指向它 —— 它从写完那天起就没跑过：${script}。` +
      `修法：给它加一个 verify:* 脚本名并接进 CI；确实不该跑的，在 ` +
      `scripts/ci-gate-exemptions.json 的 unwiredScripts 里登记类别与原因。`
  )
}

// 陈旧登记：文件没了，或者已经被接线了
for (const [script, item] of unwiredByScript) {
  if (!trackedSet.has(script)) {
    problems.push(`unwiredScripts 条目已陈旧（脚本文件已不存在，请删除本条）：${script}`)
    continue
  }
  if (!unwiredScriptFiles.includes(script)) {
    problems.push(
      `unwiredScripts 条目已陈旧（该脚本已有 package.json 脚本名，请删除本条）：${script}` +
        `（登记类别 ${item.category}）`
    )
  }
}

if (unwiredScriptFiles.length > MAX_UNWIRED) {
  problems.push(
    `未接线门禁脚本 ${unwiredScriptFiles.length} 个，超过上限 ${MAX_UNWIRED}。` +
      `该上限只允许调低：请先还掉已有欠账，而不是调高上限。`
  )
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
    `${exemptionByGate.size} 条已登记豁免（其中 ${pendingCount} 条待接线，上限 ${MAX_PENDING}）；` +
    `${gateFileIndex.size} 个门禁脚本文件中 ${unwiredScriptFiles.length} 个无脚本名` +
    `（全部已登记，上限 ${MAX_UNWIRED}）`
)
