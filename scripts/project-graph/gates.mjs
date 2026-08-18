// ============================================================================
// 项目图谱 · verify 门禁
//
// 回答两个今天反复付出代价的问题：
//
//   Q1「我改了这个文件，会红哪条门禁？」
//      → file → gates 反向索引。改文件前先查，不必等 CI 红了再猜。
//
//   Q2「这条门禁真的有人跑吗？」
//      → 门禁脚本文件存在 ≠ package.json 里有对应脚本名 ≠ 在 CI 执行闭包里。
//        这三层各自可能断。verify:ci-gate-coverage 守的是第二层到第三层
//        （已声明的脚本名有没有进 CI），守不住第一层到第二层 —— 一个 .mjs
//        文件躺在 scripts/ 下但没人在 package.json 里给它起名字，那条门禁
//        从写完那天起就没跑过，而且没有任何机制会说话。本文件补的就是这层。
// ============================================================================

import path from 'node:path'
import { importSpecifiers, readJson, readText, sorted, stripComments, trackedFiles } from './repo.mjs'

const GATE_DIR_PATTERN = /^(?:scripts\/|(?:apps|services|packages)\/[^/]+\/scripts\/)/
const GATE_EXT_PATTERN = /\.(mjs|cjs|js)$/

/** 仓库里全部「门禁脚本候选」文件（排除 docs/ 下的原型静态资源）。 */
export function gateScriptFiles() {
  return trackedFiles().filter(
    (file) =>
      GATE_DIR_PATTERN.test(file) &&
      GATE_EXT_PATTERN.test(file) &&
      !file.includes('/scripts/tests/') &&
      !file.includes('/scripts/lib/') &&
      !file.includes('/scripts/support/'),
  )
}

/** 找到某个文件所属的 workspace 包目录（含 package.json 的最近上级）。 */
export function owningPackage(file, packageDirs) {
  let best = null
  for (const dir of packageDirs) {
    if (file === dir || file.startsWith(`${dir}/`)) {
      if (!best || dir.length > best.length) best = dir
    }
  }
  return best ?? ''
}

export function workspacePackages() {
  const dirs = new Map()
  for (const file of trackedFiles()) {
    if (!file.endsWith('package.json')) continue
    const dir = path.posix.dirname(file) === '.' ? '' : path.posix.dirname(file)
    if (dir.includes('node_modules')) continue
    const pkg = readJson(file)
    if (!pkg) continue
    dirs.set(dir, { dir, name: pkg.name ?? (dir || 'root'), scripts: pkg.scripts ?? {} })
  }
  return dirs
}

// ---------------------------------------------------------------------------
// package.json 脚本名 → 门禁脚本文件
// ---------------------------------------------------------------------------

/** 从一条 npm script 命令里解析出它执行的脚本文件（相对包目录）。 */
function scriptFilesInCommand(command, packageDir, fileSet) {
  const found = new Set()
  for (const [, raw] of command.matchAll(/([\w./-]+\.(?:mjs|cjs|js))/g)) {
    const candidates = [
      path.posix.normalize(packageDir ? `${packageDir}/${raw}` : raw),
      path.posix.normalize(raw),
    ]
    for (const candidate of candidates) {
      if (fileSet.has(candidate)) {
        found.add(candidate)
        break
      }
    }
  }
  return found
}

/**
 * 建立门禁索引。
 * 返回 { gates: Map<gateFile, gateInfo>, byScriptName: Map<'pkg::script', gateFile[]> }
 */
export function buildGateIndex(fileSet) {
  const packages = workspacePackages()
  const gates = new Map()
  const scriptToFiles = new Map()

  for (const file of gateScriptFiles()) {
    gates.set(file, { file, scriptNames: [], packageName: null, inCiClosure: false })
  }

  for (const { dir, name, scripts } of packages.values()) {
    for (const [scriptName, command] of Object.entries(scripts)) {
      const key = `${name}::${scriptName}`
      const files = scriptFilesInCommand(String(command), dir, fileSet)
      scriptToFiles.set(key, sorted([...files]))
      for (const file of files) {
        const gate = gates.get(file)
        if (gate) {
          gate.scriptNames.push(key)
          gate.packageName = gate.packageName ?? name
        }
      }
    }
  }

  for (const gate of gates.values()) {
    gate.scriptNames = sorted(gate.scriptNames)
    gate.packageName = gate.packageName ?? owningPackage(gate.file, [...packages.keys()])
  }

  return { gates, packages, scriptToFiles }
}

// ---------------------------------------------------------------------------
// CI 执行闭包（尽力而为）
// ---------------------------------------------------------------------------
// 权威仍然是 scripts/verify-ci-gate-coverage.mjs —— 那条门禁会让 CI 红，本处
// 只是给图谱补一个「大概率在跑 / 大概率没跑」的标注，供人排查用，不做断言。

const PNPM_FILTER_PATTERN = /pnpm\s+(?:run\s+)?--filter\s+(\S+)\s+(?:run\s+)?([\w:.-]+)/g
const PNPM_PLAIN_PATTERN = /(?:^|\s|&&|\|\|)pnpm\s+(?:run\s+)?([\w:.-]+)/g

export function ciExecutionClosure(packages, workflowFile = '.github/workflows/ci.yml') {
  const text = readText(workflowFile)
  if (!text) return new Set()

  const byName = new Map()
  for (const pkg of packages.values()) byName.set(pkg.name, pkg)
  const rootPkg = [...packages.values()].find((p) => p.dir === '')

  const seeds = new Set()
  let workingDir = ''
  for (const rawLine of text.split(/\r?\n/)) {
    const wd = /^\s*working-directory:\s*(\S+)\s*$/.exec(rawLine)
    if (wd) {
      workingDir = wd[1].replace(/^\.\//, '')
      continue
    }
    if (/^\s*-\s+name:/.test(rawLine)) workingDir = ''

    const line = rawLine.trim()
    for (const [, filter, script] of line.matchAll(PNPM_FILTER_PATTERN)) {
      seeds.add(`${filter}::${script}`)
    }
    PNPM_PLAIN_PATTERN.lastIndex = 0
    for (const [, script] of line.matchAll(PNPM_PLAIN_PATTERN)) {
      if (['install', 'exec', 'dlx', 'run'].includes(script)) continue
      const pkg = workingDir
        ? [...packages.values()].find((p) => p.dir === workingDir)
        : rootPkg
      if (pkg) seeds.add(`${pkg.name}::${script}`)
    }
  }

  // 沿 package.json scripts 递归展开（根包的聚合脚本会再调子包门禁）
  const closure = new Set()
  const queue = [...seeds]
  while (queue.length > 0) {
    const key = queue.shift()
    if (closure.has(key)) continue
    closure.add(key)

    const [pkgName, scriptName] = key.split('::')
    const pkg = byName.get(pkgName)
    const command = pkg?.scripts?.[scriptName]
    if (!command) continue

    for (const [, filter, script] of String(command).matchAll(PNPM_FILTER_PATTERN)) {
      queue.push(`${filter}::${script}`)
    }
    PNPM_PLAIN_PATTERN.lastIndex = 0
    for (const [, script] of String(command).matchAll(PNPM_PLAIN_PATTERN)) {
      if (['install', 'exec', 'dlx', 'run'].includes(script)) continue
      queue.push(`${pkgName}::${script}`)
    }
  }

  return closure
}

// ---------------------------------------------------------------------------
// 门禁 → 它断言的文件
// ---------------------------------------------------------------------------

const PATH_LITERAL_PATTERN = /['"`]([\w@./-]*\/[\w@./-]+)['"`]/g
const ASSERTABLE_EXT = /\.(tsx?|mts|mjs|jsx?|css|html|json|prisma|md|ya?ml|sql)$/

// 构建产物不进 git，是设计如此，不是「引用了不存在的路径」。
const BUILD_ARTIFACT = /(^|\/)(dist|build|node_modules|coverage)\//

// 「断言它必须不存在」的上下文。这类断言引用一个不存在的路径**恰恰是它成立的
// 条件**，报成缺失就是把正确的门禁诬告成坏门禁 —— 本仓库里这类写法不少
// （verify-print-parameter-capability 守 PrintParamsPage 不得复活就是一例）。
const NEGATION_CONTEXT =
  /(!\s*existsSync|mustNotExist|mustNotContain|不得|已删除|已下线|必须移除|不再|不存在)/

/**
 * 抽出门禁脚本引用的仓库路径。
 *
 * 解析基准逐个试：仓库根、门禁所属包目录、包目录上级，最后是全部 workspace 包目录。
 * 最后那档是必需的 —— 门禁经常跨包断言（apps/admin 的门禁里
 * `mustContain(apiRoot, 'src/terminals/...')` 指的是 services/api 下的文件），
 * 只按自己包目录解析会把一批存在的文件误报成缺失。
 *
 * 返回：
 *   files   —— 真实存在、且能唯一定位的文件（用于 file → gates 反向索引）
 *   dirs    —— 命中的目录
 *   missing —— 正向引用了但仓库里找不到的路径（已排除构建产物与「必须不存在」断言）
 */
export function extractAssertedPaths(gateFile, fileSet, dirIndex, packageDirs = []) {
  const text = stripComments(readText(gateFile))
  const packageDir = path.posix.dirname(path.posix.dirname(gateFile))
  const primaryBases = ['', packageDir, path.posix.dirname(packageDir)].filter((b) => b !== '.')
  const fallbackBases = packageDirs.filter((dir) => dir && !primaryBases.includes(dir))

  const files = new Set()
  const dirs = new Set()
  const missing = new Set()
  const absent = new Set()

  for (const match of text.matchAll(PATH_LITERAL_PATTERN)) {
    const literal = match[1]
    if (literal.startsWith('node:') || literal.includes('://')) continue
    if (BUILD_ARTIFACT.test(literal)) continue

    const looksLikeFile = ASSERTABLE_EXT.test(literal)
    const looksLikeDir = !looksLikeFile && /^(src|scripts|prisma|public|docs)\//.test(literal)
    if (!looksLikeFile && !looksLikeDir) continue

    let hit = false
    for (const base of primaryBases) {
      const candidate = path.posix.normalize(base ? `${base}/${literal}` : literal)
      if (fileSet.has(candidate)) {
        files.add(candidate)
        hit = true
        break
      }
      if (dirIndex.has(candidate)) {
        dirs.add(candidate)
        hit = true
        break
      }
    }
    // 跨包断言：只用来判定「不算缺失」，不进 files —— 同名相对路径（src/index.css）
    // 在多个包下都存在，硬塞进反向索引会连出错误的边。
    if (!hit) {
      hit = fallbackBases.some((base) => {
        const candidate = path.posix.normalize(`${base}/${literal}`)
        return fileSet.has(candidate) || dirIndex.has(candidate)
      })
    }
    if (hit) continue

    if (!looksLikeFile) continue
    if (!/^(src|apps|services|packages|docs|scripts|prisma)\//.test(literal)) continue

    const context = text.slice(Math.max(0, match.index - 160), match.index)
    if (NEGATION_CONTEXT.test(context)) {
      // 「这个文件必须不存在」。单独看是正确的断言；但如果另一条门禁正在正向
      // 引用同一个路径，两条门禁就互相矛盾了 —— 这个集合是检测那种矛盾的另一半。
      absent.add(literal)
      continue
    }

    missing.add(literal)
  }

  return {
    files: sorted([...files]),
    dirs: sorted([...dirs]),
    missing: sorted([...missing]),
    absent: sorted([...absent]),
  }
}

/**
 * 找出互相矛盾的门禁对：同一个路径，A 断言它必须存在、B 断言它必须不存在。
 *
 * 这不只是「有条门禁该删」。它说明**两条门禁的作者互相不知道对方存在** ——
 * 是流程信号，不是代码信号。所以单独列出来，不混进普通的孤儿清单。
 */
export function findContradictoryGates(gateList) {
  const requires = new Map()
  const forbids = new Map()

  for (const gate of gateList) {
    for (const p of gate.asserts.missing) {
      if (!requires.has(p)) requires.set(p, [])
      requires.get(p).push(gate.file)
    }
    for (const p of gate.asserts.absent) {
      if (!forbids.has(p)) forbids.set(p, [])
      forbids.get(p).push(gate.file)
    }
  }

  const conflicts = []
  for (const [target, requiredBy] of requires) {
    const forbiddenBy = forbids.get(target)
    if (!forbiddenBy || forbiddenBy.length === 0) continue
    conflicts.push({
      target,
      requiredBy: sorted(requiredBy),
      forbiddenBy: sorted(forbiddenBy),
    })
  }

  return conflicts.sort((a, b) => (a.target < b.target ? -1 : 1))
}

/**
 * 被别的门禁脚本消费的辅助模块集合。
 *
 * 这类文件（services/api/scripts/d2-same-host/*.mjs 那一整族）没有自己的
 * package.json 脚本名是正常的 —— 它们是库或被检查的素材，不是门禁入口。
 * 不排掉的话会把 20 多个正常模块混进「从未被执行」清单，真正漏接的那几条就被淹了。
 *
 * 三种消费方式都算，缺一条就会误报：
 *
 *   a) import 说明符 —— 必须走 importSpecifiers()，不能自己写正则。
 *      d2-same-host/verify-governance.mjs:5 是裸副作用 import
 *      （`import './verify-governance-git.mjs'`，无 from、无括号），
 *      手写的 `/from\s*['"]/` 会整族漏掉。这与 CSS 副作用 import 是同一类坑。
 *   b) spawn / fork 的子进程路径。
 *   c) 被别的门禁 readFileSync 读源码做断言（d2-same-host/verify-contract.mjs
 *      就在逐字比对 drill.mjs 的源码）—— 这类文件同样不该有自己的脚本名。
 */
export function gateHelperModules(fileSet) {
  const gates = gateScriptFiles()
  const helpers = new Set()
  const basenameOwners = new Map()

  for (const gate of gates) {
    const base = path.posix.basename(gate)
    if (!basenameOwners.has(base)) basenameOwners.set(base, [])
    basenameOwners.get(base).push(gate)
  }

  for (const gate of gates) {
    const text = stripComments(readText(gate))
    const dir = path.posix.dirname(gate)

    // a) 真正的 import 图
    for (const spec of importSpecifiers(text)) {
      if (!spec.startsWith('.')) continue
      const resolved = path.posix.normalize(path.posix.join(dir, spec))
      if (fileSet.has(resolved)) helpers.add(resolved)
    }

    // b) + c) 字符串里提到的同族脚本文件名（spawn 路径 / 源码比对素材）
    for (const [, literal] of text.matchAll(/['"`]([\w./-]*[\w-]+\.(?:mjs|cjs|js))['"`]/g)) {
      const base = path.posix.basename(literal)
      for (const owner of basenameOwners.get(base) ?? []) {
        if (owner !== gate) helpers.add(owner)
      }
    }
  }

  // d) 被 shell / PowerShell 包装脚本拉起的。
  //    d2-docker-drill.mjs 就是这条：package.json 里叫 `drill:d2-docker`，
  //    命令是 `bash scripts/d2-docker/run.sh`，真正执行 .mjs 的是 run.sh 第 44 行。
  //    只看 package.json 会把它误判成「从未被执行」。
  for (const file of trackedFiles()) {
    if (!GATE_DIR_PATTERN.test(file) || !/\.(sh|ps1|cmd|bat)$/.test(file)) continue
    const text = readText(file)
    for (const [, literal] of text.matchAll(/([\w./-]*[\w-]+\.(?:mjs|cjs|js))/g)) {
      const base = path.posix.basename(literal)
      for (const owner of basenameOwners.get(base) ?? []) helpers.add(owner)
    }
  }

  return helpers
}

/** 目录索引：所有出现过的目录路径，便于判断字面量是不是目录。 */
export function buildDirIndex(files) {
  const dirs = new Set()
  for (const file of files) {
    let dir = path.posix.dirname(file)
    while (dir && dir !== '.' && !dirs.has(dir)) {
      dirs.add(dir)
      dir = path.posix.dirname(dir)
    }
  }
  return dirs
}
