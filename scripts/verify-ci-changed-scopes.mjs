#!/usr/bin/env node
// verify:ci-changed-scopes —— CI 改动范围判定的自测（N3 省 CI 分钟，2026-09-29）
//
// 判定跳过就等于那两个大作业这次不跑，所以断言按「该不该跑」的规格写，而不是照现有输出抄：
//   - 推送到 main、手动触发、拿不到改动清单、清单为空：两个作业都必须跑；
//   - 只要有一个文件不在可跳过范围，就必须跑；
//   - 稿件目录 docs/design/** 会被浏览器作业里的原型几何与基线门禁读到，改它必须跑浏览器作业；
//   - 浏览器作业会执行的门禁脚本（含它 import 的契约模块和几何基线）改了必须跑浏览器作业；
//   - 后台与机构后台的测试、playwright 配置、各应用 package.json、vite.config.ts、index.html、public 改了必须跑浏览器作业；
//   - 一体机、后台、机构后台根目录下的文件（tsconfig、vite 插件，以及以后的 tailwind / postcss）改了必须跑浏览器作业；
//   - 浏览器作业实际执行的 .mjs/.js/.ts/.json（含相对路径 import）由本脚本从 ci.yml 展开后逐个断言，漏了会点名文件；
//   - 两份被 PostgreSQL 作业门禁读到的文档，改它们必须跑 PostgreSQL 作业；
//   - 带 Prisma 查询的非 service 文件（含 $queryRawUnsafe / $executeRawUnsafe）、services/api/scripts、services/api/package.json 改了必须跑 PostgreSQL 作业；
//   - 这类文件被 PR 删掉、读不到时仍要跑 PostgreSQL 作业；
//   - 共享包、依赖锁、根目录 package.json、workflow、根 scripts 改了两个都必须跑。
// 另外钉住 ci.yml 接线：两个大作业依赖 changes 作业，changes 失败时照跑，取消时不跑。
// ci.yml 不监听 labeled；只有 ci-full-label.yml 在标签名为 full-ci 时调用 CI。
// 其它标签跳过该作业。full-ci 那次的并发组带 -full，不取消普通 CI。
// 只用 node 内置模块。

import { readFileSync, writeFileSync, mkdtempSync, rmSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, normalize, sep } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { classify, PRISMA_QUERY_RE } from './ci-changed-scopes.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
let failures = 0
const check = (ok, m, detail = '') => {
  if (ok) console.log(`  PASS ${m}`)
  else {
    failures += 1
    console.error(`  FAIL ${m}${detail ? `\n    ${detail}` : ''}`)
  }
}
const pr = (files) => classify({ event: 'pull_request', files })

// ── 一、判定规格 ──
const lane = (files, labels = []) => classify({ event: 'pull_request', files, baseRef: 'claude/some-lane', labels })
const integ = (files) => classify({ event: 'pull_request', files, baseRef: 'main' })
const both = (r) => r.browser && r.postgres
const none = (r) => !r.browser && !r.postgres
for (const event of ['push', 'workflow_dispatch', '']) {
  check(both(classify({ event, files: ['docs/a.md'] })), `事件 ${event || '(空)'}：两个作业都跑`)
}
check(both(lane([])) && both(lane(null)), '拿不到改动清单（空或 null）：两个作业都跑')
check(both(classify({ event: 'pull_request', files: ['docs/a.md'] })), '拿不到 base 分支名时按整合 PR 处理：两个都跑')
check(both(integ(['docs/progress/next-tasks.md'])) && both(integ(['apps/miniapp/app.js'])), '整合 PR（base = main）：不论改什么都全跑')
check(both(lane(['docs/a.md'], ['full-ci'])), '分路 PR 带 full-ci 标签：全跑')
check(none(lane(['docs/progress/next-tasks.md'], ['docs'])), '分路：其它标签不强制全跑')

// 分路 PR：高风险路径自动跑（主执行窗口给的清单），其余走轻量
check(none(lane(['docs/progress/next-tasks.md', 'docs/graph/graph.json'])), '分路：只改文档与图谱 → 都不跑')
check(none(lane(['apps/terminal-agent/src/agent/task-runner.ts'])) && none(lane(['apps/miniapp/pages/index/index.js'])), '分路：只改 Agent 或小程序 → 都不跑')
check(none(lane(['apps/kiosk/scripts/verify-jobfair-ui.mjs'])), '分路：只改主作业里的一体机门禁脚本 → 都不跑')
for (const f of [
  'apps/kiosk/scripts/verify-fusion-w2-print-scan.mjs',
  'apps/kiosk/scripts/verify-fusion-w3.mjs',
  'apps/kiosk/scripts/verify-fusion-w4.mjs',
  'apps/kiosk/scripts/verify-fusion-w5.mjs',
  'apps/kiosk/scripts/verify-fusion-w6.mjs',
  'apps/kiosk/scripts/verify-fusion-shell.mjs',
  'apps/kiosk/scripts/verify-fusion-home.mjs',
  'apps/kiosk/scripts/verify-fusion-baseline.mjs',
  'apps/kiosk/scripts/verify-qingxu-proto-geometry.mjs',
  'apps/kiosk/scripts/verify-scan-input-safety.mjs',
  'apps/kiosk/scripts/verify-kiosk-feedback-entry.mjs',
  'apps/kiosk/scripts/tests/fusion-baseline-contract.test.mjs',
  'apps/kiosk/scripts/tests/fusion-w6-contract.test.mjs',
  'apps/kiosk/scripts/lib/fusion-baseline-contract.mjs',
  'apps/kiosk/scripts/lib/shell-chrome-contract.mjs',
  'apps/kiosk/scripts/fixtures/qingxu-proto-geometry-baseline.json',
  'apps/admin/scripts/run-e2e.mjs',
  'apps/partner/scripts/run-e2e.mjs',
]) {
  const r = lane([f]); check(r.browser && !r.postgres, `分路：改 ${f} → 自动跑浏览器作业`)
}
for (const f of [
  'apps/admin/tests/e2e/login.spec.ts',
  'apps/partner/tests/e2e/login.spec.ts',
  'apps/admin/playwright.config.ts',
  'apps/partner/playwright.screen.config.ts',
  'apps/kiosk/package.json',
  'apps/admin/package.json',
  'apps/miniapp/package.json',
  'apps/kiosk/vite.config.ts',
  'apps/partner/index.html',
  'apps/kiosk/public/assets/ai-advisor.png',
  'apps/kiosk/tsconfig.json',
  'apps/kiosk/tsconfig.node.json',
  'apps/admin/tsconfig.json',
  'apps/admin/tsconfig.node.json',
  'apps/partner/tsconfig.json',
  'apps/partner/tsconfig.node.json',
  'apps/kiosk/pdfjs-cmap-plugin.ts',
  'apps/kiosk/deploy-env-registry.json',
]) {
  const r = lane([f]); check(r.browser && !r.postgres, `分路：改 ${f} → 自动跑浏览器作业`)
}
for (const f of ['apps/kiosk/src/pages/home/HomePage.tsx', 'apps/kiosk/tests/visual/print-hub-qx.spec.ts', 'apps/kiosk/playwright.w2.config.ts',
  'apps/admin/src/routes/ai-services/index.tsx', 'apps/partner/src/App.tsx', 'docs/design/kiosk-redesign-2026-08-v2/10-print-hub.html']) {
  const r = lane([f]); check(r.browser && !r.postgres, `分路：改 ${f} → 自动跑浏览器作业`)
}
for (const f of ['services/api/prisma/postgres/schema.prisma', 'services/api/src/ai/ai.service.ts', 'services/api/src/console-screen/console-screen.usage.queries.ts',
  'docs/compliance/member-personal-data-retention.md', 'docs/operations/price-config-production.md',
  'services/api/src/admin-ops/derived-alerts.ts', 'services/api/src/ai/resume/resume-draft.store.ts',
  'services/api/src/common/auth/optional-end-user.ts', 'services/api/src/jobs/partner-fairs.controller.ts',
  'services/api/scripts/verify-recruitment-wave2-postgres-ci.sh', 'services/api/package.json']) {
  const r = lane([f]); check(!r.browser && r.postgres, `分路：改 ${f} → 自动跑 PostgreSQL 作业`)
}
check(none(lane(['services/api/src/ai/ai.controller.ts'])), '分路：只改服务端控制器（非 service / 查询）→ 都不跑，主作业覆盖')
{
  const removed = 'services/api/src/removed/deleted-prisma-caller.ts'
  const r = lane([removed])
  check(!r.browser && r.postgres, '分路：非 service 源码已被删除、读不到文件时仍跑 PostgreSQL 作业')
}
check(PRISMA_QUERY_RE.test('await prisma.$queryRawUnsafe`select 1`'), '$queryRawUnsafe 算 Prisma 查询')
check(PRISMA_QUERY_RE.test('this.prisma.$executeRawUnsafe("delete from t")'), '$executeRawUnsafe 算 Prisma 查询')
check(PRISMA_QUERY_RE.test('prisma.$queryRaw`select 1`'), '$queryRaw 仍算 Prisma 查询')
check(PRISMA_QUERY_RE.test('prisma.$executeRaw`delete from t`'), '$executeRaw 仍算 Prisma 查询')
check(!PRISMA_QUERY_RE.test('prisma.$queryRawUnsafeExtra`'), '多出来的后缀不算 $queryRawUnsafe')
for (const f of ['packages/shared/src/types/device.ts', '.github/workflows/ci.yml', 'pnpm-lock.yaml', 'package.json', 'scripts/ci/drop-unused-apt-sources.sh']) {
  check(both(lane([f])), `分路：改 ${f} → 两个都跑`)
}
{ const r = lane(['packages/ui/src/index.ts']); check(r.browser && !r.postgres, '分路：改 packages/ui → 跑浏览器作业') }
check(both(lane(['docs/a.md', 'apps/kiosk/src/b.tsx', 'services/api/src/c.service.ts'])), '分路：混合改动，只要有一个高风险文件就跑对应作业')

// ── 二、命令行在真实 git 仓库里取改动（含中文路径下的入口判定） ──
{
  const dir = mkdtempSync(join(tmpdir(), 'ci-scopes-'))
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim()
  try {
    git('init', '-q')
    writeFileSync(join(dir, 'a.txt'), 'a\n')
    git('-c', 'user.email=d@x.invalid', '-c', 'user.name=d', 'add', '.')
    git('-c', 'user.email=d@x.invalid', '-c', 'user.name=d', 'commit', '-qm', 'base')
    const base = git('rev-parse', 'HEAD')
    execFileSync('mkdir', ['-p', join(dir, 'docs/progress')])
    writeFileSync(join(dir, 'docs/progress/x.md'), 'x\n')
    git('-c', 'user.email=d@x.invalid', '-c', 'user.name=d', 'add', '.')
    git('-c', 'user.email=d@x.invalid', '-c', 'user.name=d', 'commit', '-qm', 'docs')
    const head = git('rev-parse', 'HEAD')
    const run = (args) => execFileSync(process.execPath, [join(repoRoot, 'scripts/ci-changed-scopes.mjs'), ...args], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    check(run(['--event', 'pull_request', '--base', base, '--head', head, '--base-ref', 'claude/lane', '--labels', '[]']) === 'browser=false\npostgres=false\n', '命令行：分路 PR 只改文档时输出两个 false')
    check(run(['--event', 'pull_request', '--base', base, '--head', head, '--base-ref', 'claude/lane', '--labels', '["full-ci"]']) === 'browser=true\npostgres=true\n', '命令行：带 full-ci 标签时两个都跑')
    check(run(['--event', 'pull_request', '--base', base, '--head', head, '--base-ref', 'main']) === 'browser=true\npostgres=true\n', '命令行：整合 PR 两个都跑')
    check(run(['--event', 'pull_request', '--base', 'not-a-sha', '--head', head]) === 'browser=true\npostgres=true\n', '命令行：基线不合法时两个都跑')
    check(run(['--event', 'pull_request', '--base', '0000000', '--head', head]) === 'browser=true\npostgres=true\n', '命令行：git diff 失败时两个都跑')
    check(run(['--event', 'push']) === 'browser=true\npostgres=true\n', '命令行：推送时两个都跑')
  } catch (error) {
    check(false, '命令行自测无法运行', error instanceof Error ? error.message : String(error))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// ── 三、ci.yml 接线 ──
const ci = readFileSync(join(repoRoot, '.github/workflows/ci.yml'), 'utf8')
check(/\n  changes:\n[\s\S]*?fetch-depth: 0[\s\S]*?BASE_REF: \$\{\{ github\.base_ref \}\}[\s\S]*?LABELS: \$\{\{ toJSON\(github\.event\.pull_request\.labels\.\*\.name\) \}\}[\s\S]*?scripts\/ci-changed-scopes\.mjs --event "\$EVENT" --base "\$BASE_SHA" --head "\$HEAD_SHA" --base-ref "\$BASE_REF" --labels "\$LABELS" >> "\$GITHUB_OUTPUT"/.test(ci),
  'ci.yml 有 changes 作业：拉全量历史、传 base 分支与标签、调用判定脚本、写进作业输出')
check(/  pull_request:\n(?:\s*#[^\n]*\n)*\s*types: \[opened, synchronize, reopened\]\n/.test(ci) && !/\n\s*types:\s*\[[^\]]*labeled/.test(ci),
  'ci.yml 的 pull_request 不监听 labeled：其它标签不新开运行')
{
  const groupLine = ci.split('\n').find((line) => line.includes('group: ci-${{ github.ref }}'))
  check(Boolean(groupLine && groupLine.includes("github.event.action == 'labeled' && '-full'")),
    'ci.yml 的 concurrency.group 在 labeled 时加 -full，full-ci 不取消普通 CI')
}
check(/\n  workflow_call:\n/.test(ci), 'ci.yml 可被 full-ci 标签工作流调用')
const labelWf = readFileSync(join(repoRoot, '.github/workflows/ci-full-label.yml'), 'utf8')
check(/pull_request:\n(?:\s*#[^\n]*\n)*\s*types: \[labeled\]/.test(labelWf), '标签工作流只监听 labeled')
check(/if:\s*github\.event\.label\.name == 'full-ci'/.test(labelWf), '只有 full-ci 标签才往下走')
check(/uses:\s*\.\/\.github\/workflows\/ci\.yml/.test(labelWf), 'full-ci 标签调用 CI 工作流')
check(!/cancel-in-progress:/.test(labelWf), '标签工作流自身不设 cancel-in-progress；取消只发生在 ci.yml 的同组运行里')
for (const [job, key] of [['postgres-readiness', 'postgres'], ['kiosk-browser-smoke', 'browser']]) {
  const block = ci.slice(ci.indexOf(`\n  ${job}:\n`), ci.indexOf(`\n  ${job}:\n`) + 400)
  check(block.includes('needs: [changes]'), `${job} 依赖 changes`)
  check(block.includes(`if: \${{ !cancelled() && (needs.changes.result != 'success' || needs.changes.outputs.${key} == 'true') }}`),
    `${job}：changes 失败时照跑、取消时不跑、否则按 ${key} 输出`)
}
check(!/\n  build-and-verify:\n(?:(?!\n  [a-z-]+:\n)[\s\S])*?needs: \[changes\]/.test(ci), 'build-and-verify 不依赖 changes（每次都跑）')

// ── 四、浏览器作业实际执行的文件必须都能触发该作业 ──
// 从 kiosk-browser-smoke 的 run 行取出脚本路径，并把 pnpm 脚本按 package.json 递归展开
// （&& 串起来的每条、以及脚本里再调的 pnpm run）。再沿相对路径 import / import() 收集
// .mjs/.js/.ts/.json。readFileSync 里写死的路径不跟。清单漏了就点名那个文件。
const ASSERT_EXT = new Set(['.mjs', '.js', '.ts', '.json'])
const WALK_EXT = new Set(['.mjs', '.js', '.cjs', '.ts', '.tsx', '.jsx', '.mts', '.json'])

function isRepoFile(rel) {
  if (!rel || rel.startsWith('..') || rel.includes('node_modules')) return false
  const abs = normalize(join(repoRoot, rel))
  const root = normalize(repoRoot)
  if (abs !== root && !abs.startsWith(root + sep)) return false
  try { return statSync(abs).isFile() } catch { return false }
}

function loadPackages() {
  const byName = new Map()
  const dirs = [repoRoot]
  for (const bucket of ['apps', 'packages', 'services']) {
    for (const name of readdirSync(join(repoRoot, bucket))) dirs.push(join(repoRoot, bucket, name))
  }
  for (const abs of dirs) {
    const pkgPath = join(abs, 'package.json')
    if (!isRepoFile(pkgPath.slice(repoRoot.length + 1))) continue
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
    const dir = abs === repoRoot ? '.' : abs.slice(repoRoot.length + 1)
    byName.set(pkg.name, { name: pkg.name, dir, scripts: pkg.scripts || {} })
  }
  return byName
}

function packageAt(byName, cwdRel) {
  for (const pkg of byName.values()) if (pkg.dir === (cwdRel || '.')) return pkg
  return null
}

function resolveToken(token, cwdRel) {
  const cleaned = token.replace(/\\$/, '')
  if (!cleaned || cleaned.startsWith('/') || cleaned.includes('://')) return null
  const candidates = []
  if (cwdRel && cwdRel !== '.') candidates.push(normalize(join(cwdRel, cleaned)))
  candidates.push(normalize(cleaned))
  for (const rel of candidates) if (isRepoFile(rel)) return rel.split(sep).join('/')
  return null
}

const PATH_RE = /(?:^|[\s="'"`])((?:\.\.?\/|[A-Za-z0-9_@])[A-Za-z0-9_@./-]*\.(?:json|mjs|cjs|jsx|tsx|mts|js|ts))(?![A-Za-z0-9_])/g

function pathTokens(command, cwdRel) {
  const found = []
  const stripped = command.replace(/\\$/, '').trim()
  if (!stripped || stripped.startsWith('#')) return found
  PATH_RE.lastIndex = 0
  for (const match of stripped.matchAll(PATH_RE)) {
    const rel = resolveToken(match[1], cwdRel)
    if (rel) found.push(rel)
  }
  return found
}

function pnpmScripts(command, cwdRel, byName) {
  const found = []
  for (const segment of command.split(/&&|\|\||;/)) {
    const tokens = segment.trim().split(/\s+/).filter(Boolean)
    const runner = tokens.findIndex((token) => token === 'pnpm' || token === 'npm')
    if (runner < 0) continue
    let rest = tokens.slice(runner + 1)
    let pkg = packageAt(byName, cwdRel)
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === '--filter' || rest[i] === '-F') {
        pkg = byName.get(rest[i + 1]) || pkg
        rest.splice(i, 2)
        i -= 1
      } else if (rest[i].startsWith('--filter=')) {
        pkg = byName.get(rest[i].slice('--filter='.length)) || pkg
        rest.splice(i, 1)
        i -= 1
      }
    }
    rest = rest.filter((token) => !token.startsWith('-'))
    if (rest[0] === 'run' || rest[0] === 'run-script') rest = rest.slice(1)
    const scriptName = rest[0]
    if (!scriptName || !pkg || pkg.scripts[scriptName] === undefined) continue
    found.push({ pkg, scriptName })
  }
  return found
}

function jobLines(text, jobName) {
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex((line) => line === `  ${jobName}:`)
  if (start < 0) return []
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (/^  [A-Za-z0-9-]+:\s*$/.test(lines[i])) { end = i; break }
  }
  return lines.slice(start + 1, end)
}

function stepCommands(lines) {
  const steps = []
  let current = null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^\s*- (name|uses):/.test(line)) {
      current = { cwd: '.', commands: [] }
      steps.push(current)
    }
    const wd = line.match(/^\s*working-directory:\s*(\S+)/)
    if (wd && current) current.cwd = wd[1].replace(/['"]/g, '')
    const run = line.match(/^(\s*)(?:- )?run:\s*(\|-?|>-?)?\s*(.*)$/)
    if (!run || !current) continue
    const indent = run[1].length
    if (run[2]) {
      for (let j = i + 1; j < lines.length; j++) {
        const inner = lines[j]
        if (inner.trim() === '') continue
        if (inner.match(/^\s*/)[0].length <= indent) break
        current.commands.push(inner.trim())
        i = j
      }
    } else if (run[3]) current.commands.push(run[3].trim())
  }
  return steps
}

function expandedFiles(text) {
  const byName = loadPackages()
  const direct = new Set()
  const seenScripts = new Set()
  const expand = (pkg, scriptName) => {
    const key = `${pkg.name}::${scriptName}`
    if (seenScripts.has(key)) return
    seenScripts.add(key)
    const body = pkg.scripts[scriptName]
    if (!body) return
    for (const segment of body.split(/&&|\|\||;/)) {
      for (const rel of pathTokens(segment, pkg.dir)) direct.add(rel)
      for (const call of pnpmScripts(segment, pkg.dir, byName)) expand(call.pkg, call.scriptName)
    }
  }
  for (const step of stepCommands(jobLines(text, 'kiosk-browser-smoke'))) {
    for (const command of step.commands) {
      for (const rel of pathTokens(command, step.cwd)) direct.add(rel)
      for (const call of pnpmScripts(command, step.cwd, byName)) expand(call.pkg, call.scriptName)
    }
  }
  return direct
}

function resolveImport(fromRel, spec) {
  if (!spec.startsWith('.')) return null
  const raw = normalize(join(dirname(fromRel), spec))
  if (raw.startsWith('..') || raw.includes('node_modules')) return null
  const ext = raw.match(/(\.[A-Za-z0-9]+)$/)?.[1] ?? ''
  const candidates = ext ? [raw] : []
  if (!ext) {
    for (const suffix of ['.mjs', '.js', '.cjs', '.ts', '.tsx', '.jsx', '.mts', '.json']) candidates.push(raw + suffix)
    for (const index of ['index.mjs', 'index.js', 'index.ts', 'index.tsx', 'index.json']) candidates.push(join(raw, index))
  }
  for (const rel of candidates) {
    const posix = rel.split(sep).join('/')
    if (isRepoFile(posix)) return posix
  }
  return null
}

function importedFiles(roots) {
  const asserted = new Set()
  const seen = new Set()
  const queue = [...roots]
  const patterns = [
    /\bfrom\s+['"](\.[^'"]+)['"]/g,
    /\bimport\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g,
    /\bimport\s+['"](\.[^'"]+)['"]/g,
  ]
  while (queue.length) {
    const rel = queue.pop()
    if (seen.has(rel)) continue
    seen.add(rel)
    const ext = rel.match(/(\.[A-Za-z0-9]+)$/)?.[1] ?? ''
    if (ASSERT_EXT.has(ext)) asserted.add(rel)
    if (!WALK_EXT.has(ext)) continue
    let text
    try { text = readFileSync(join(repoRoot, rel), 'utf8') } catch { continue }
    for (const pattern of patterns) {
      pattern.lastIndex = 0
      for (const match of text.matchAll(pattern)) {
        const next = resolveImport(rel, match[1])
        if (next) queue.push(next)
      }
    }
  }
  return asserted
}

const browserFiles = importedFiles(expandedFiles(ci))
check(browserFiles.size >= 40, `从 kiosk-browser-smoke 展开出 ${browserFiles.size} 个 .mjs/.js/.ts/.json 文件`)
for (const anchor of [
  'apps/kiosk/scripts/verify-fusion-w3.mjs',
  'apps/kiosk/scripts/lib/sweep-copy-guards.mjs',
  'apps/admin/scripts/run-e2e.mjs',
  'apps/partner/scripts/run-e2e.mjs',
  'packages/ui/scripts/verify-fusion-youth-foundation.mjs',
]) {
  check(browserFiles.has(anchor), `展开结果包含 ${anchor}`)
}
{
  const missed = [...browserFiles].filter((file) => !lane([file]).browser).sort()
  check(missed.length === 0, '展开出的每个文件，分路 PR 只改它时都要跑浏览器作业', missed.join('\n    '))
}

if (failures) {
  console.error(`\nverify:ci-changed-scopes：${failures} 项失败`)
  process.exit(1)
}
console.log('\nverify:ci-changed-scopes 通过')
