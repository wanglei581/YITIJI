#!/usr/bin/env node
// verify:ci-changed-scopes —— CI 改动范围判定的自测（N3 省 CI 分钟，2026-09-29）
//
// 判定跳过就等于那两个大作业这次不跑，所以断言按「该不该跑」的规格写，而不是照现有输出抄：
//   - 推送到 main、手动触发、拿不到改动清单、清单为空：两个作业都必须跑；
//   - 只要有一个文件不在可跳过范围，就必须跑；
//   - 稿件目录 docs/design/** 会被浏览器作业里的原型几何与基线门禁读到，改它必须跑浏览器作业；
//   - 两份被 PostgreSQL 作业门禁读到的文档，改它们必须跑 PostgreSQL 作业；
//   - 共享包、依赖锁、根目录配置、workflow、根 scripts 改了两个都必须跑。
// 另外钉住 ci.yml 接线：两个大作业依赖 changes 作业，changes 失败时照跑，取消时不跑。
// 只用 node 内置模块。

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { classify } from './ci-changed-scopes.mjs'

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
for (const event of ['push', 'workflow_dispatch', '']) {
  const r = classify({ event, files: ['docs/a.md'] })
  check(r.browser && r.postgres, `事件 ${event || '(空)'}：两个作业都跑`)
}
check(pr([]).browser && pr([]).postgres, '拿不到改动清单（空）：两个作业都跑')
check(pr(null).browser && pr(null).postgres, '拿不到改动清单（null）：两个作业都跑')

const docsOnly = pr(['docs/progress/next-tasks.md', 'docs/graph/graph.json'])
check(!docsOnly.browser && !docsOnly.postgres, '只改普通文档与图谱：两个作业都跳过')
check(pr(['docs/design/kiosk-redesign-2026-08-v2/10-print-hub.html']).browser, '改稿件目录：浏览器作业必须跑')
check(pr(['docs/compliance/member-personal-data-retention.md']).postgres, '改会员个人数据留存文档：PostgreSQL 作业必须跑')
check(pr(['docs/operations/price-config-production.md']).postgres, '改生产价目配置文档：PostgreSQL 作业必须跑')

const apiOnly = pr(['services/api/src/ai/ai.service.ts'])
check(!apiOnly.browser && apiOnly.postgres, '只改服务端：浏览器作业跳过、PostgreSQL 作业要跑')
const kioskOnly = pr(['apps/kiosk/src/pages/home/HomePage.tsx'])
check(kioskOnly.browser && !kioskOnly.postgres, '只改一体机：浏览器作业要跑、PostgreSQL 作业跳过')
check(pr(['apps/admin/src/routes/ai-services/index.tsx']).browser, '改管理员后台：浏览器作业要跑（该作业含后台浏览器用例）')
check(pr(['apps/partner/src/App.tsx']).browser, '改机构后台：浏览器作业要跑')
const miniOnly = pr(['apps/miniapp/pages/index/index.js'])
check(!miniOnly.browser && !miniOnly.postgres, '只改小程序：两个作业都跳过')

for (const f of ['packages/shared/src/types/device.ts', 'packages/ui/src/index.ts', 'pnpm-lock.yaml', 'package.json',
  '.github/workflows/ci.yml', 'scripts/verify-repository-integrity.mjs', 'tsconfig.base.json', 'CLAUDE.md']) {
  const r = pr([f])
  check(r.browser && r.postgres, `改 ${f}：两个作业都跑`)
}
const mixed = pr(['docs/progress/next-tasks.md', 'services/api/src/a.ts', 'apps/kiosk/src/b.tsx'])
check(mixed.browser && mixed.postgres, '混合改动：只要有一个文件需要，就跑')

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
    check(run(['--event', 'pull_request', '--base', base, '--head', head]) === 'browser=false\npostgres=false\n', '命令行：PR 只改文档时输出两个 false')
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
check(/\n  changes:\n[\s\S]*?fetch-depth: 0[\s\S]*?scripts\/ci-changed-scopes\.mjs --event "\$EVENT" --base "\$BASE_SHA" --head "\$HEAD_SHA" >> "\$GITHUB_OUTPUT"/.test(ci),
  'ci.yml 有 changes 作业：拉全量历史、调用判定脚本、写进作业输出')
for (const [job, key] of [['postgres-readiness', 'postgres'], ['kiosk-browser-smoke', 'browser']]) {
  const block = ci.slice(ci.indexOf(`\n  ${job}:\n`), ci.indexOf(`\n  ${job}:\n`) + 400)
  check(block.includes('needs: [changes]'), `${job} 依赖 changes`)
  check(block.includes(`if: \${{ !cancelled() && (needs.changes.result != 'success' || needs.changes.outputs.${key} == 'true') }}`),
    `${job}：changes 失败时照跑、取消时不跑、否则按 ${key} 输出`)
}
check(!/\n  build-and-verify:\n(?:(?!\n  [a-z-]+:\n)[\s\S])*?needs: \[changes\]/.test(ci), 'build-and-verify 不依赖 changes（每次都跑）')

if (failures) {
  console.error(`\nverify:ci-changed-scopes：${failures} 项失败`)
  process.exit(1)
}
console.log('\nverify:ci-changed-scopes 通过')
