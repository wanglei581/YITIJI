#!/usr/bin/env node
// ============================================================
// CI 改动范围判定（N3 省 CI 分钟，2026-09-29）
//
// 只在 pull_request 上用：按 PR 改了哪些文件，决定两个大作业要不要跑。
//   - browser（kiosk-browser-smoke，约 47 分钟）：一体机、后台、机构后台的浏览器用例，全用模拟数据；
//   - postgres（postgres-readiness，约 9 分钟）：服务端在 PostgreSQL 上的门禁。
// build-and-verify 不受影响，每次都跑。
//
// 判定是「白名单式跳过」：只有**每一个**改动文件都落在该作业的可跳过范围里，才输出 false；
// 其余一律 true。推送到 main、手动触发、拿不到改动清单、清单为空，全部输出 true（fail-open：
// 宁可多跑，不能漏跑）。
//
// 可跳过范围的依据（2026-09-29 逐条查过作业里的门禁读哪些文件）：
//   - browser 作业里读文档的只有稿件目录 docs/design/**；三套浏览器用例都不连真实服务端。
//   - postgres 作业里读文档的只有下面 POSTGRES_DOC_TRIGGERS 两个文件；它独有的门禁不读前端源码。
// 以后给这两个作业加门禁、而门禁要读新的目录时，必须同步改这里并补 verify:ci-changed-scopes 的用例。
//
// 用法：node scripts/ci-changed-scopes.mjs --event <事件> [--base <基线 SHA> --head <HEAD SHA>]
//       或 --files <换行分隔的文件清单文件>（门禁自测用）
// 输出（写进 $GITHUB_OUTPUT）：browser=true|false、postgres=true|false，外加一行中文说明到 stderr。
// ============================================================

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const POSTGRES_DOC_TRIGGERS = new Set([
  'docs/compliance/member-personal-data-retention.md',
  'docs/operations/price-config-production.md',
])

/** 改这个文件时浏览器作业可以不跑。 */
export function browserCanSkip(file) {
  if (file.startsWith('docs/')) return !file.startsWith('docs/design/')
  return ['services/', 'apps/miniapp/', 'apps/terminal-agent/'].some((prefix) => file.startsWith(prefix))
}

/** 改这个文件时 PostgreSQL 作业可以不跑。 */
export function postgresCanSkip(file) {
  if (file.startsWith('docs/')) return !POSTGRES_DOC_TRIGGERS.has(file)
  return ['apps/kiosk/', 'apps/admin/', 'apps/partner/', 'apps/miniapp/', 'apps/terminal-agent/'].some((prefix) => file.startsWith(prefix))
}

export function classify({ event, files }) {
  if (event !== 'pull_request') return { browser: true, postgres: true, reason: `事件 ${event || '未知'}：全跑` }
  if (!files || files.length === 0) return { browser: true, postgres: true, reason: '拿不到改动清单：全跑' }
  const browser = !files.every(browserCanSkip)
  const postgres = !files.every(postgresCanSkip)
  return { browser, postgres, reason: `改动 ${files.length} 个文件：浏览器作业${browser ? '要跑' : '跳过'}，PostgreSQL 作业${postgres ? '要跑' : '跳过'}` }
}

function arg(name) {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] ?? '' : ''
}

function changedFiles() {
  const listFile = arg('--files')
  if (listFile) return readFileSync(listFile, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean)
  const base = arg('--base')
  const head = arg('--head')
  if (!/^[0-9a-f]{7,40}$/.test(base) || !/^[0-9a-f]{7,40}$/.test(head)) return null
  try {
    return execFileSync('git', ['diff', '--name-only', `${base}...${head}`], { encoding: 'utf8' })
      .split('\n').map((s) => s.trim()).filter(Boolean)
  } catch {
    return null
  }
}

// 路径里有中文时 import.meta.url 是百分号编码的，必须同样转成 URL 再比
const isMain = Boolean(process.argv[1]) && pathToFileURL(process.argv[1]).href === import.meta.url
if (isMain) {
  const event = arg('--event')
  const files = event === 'pull_request' ? changedFiles() : []
  const result = classify({ event, files })
  console.log(`browser=${result.browser}`)
  console.log(`postgres=${result.postgres}`)
  console.error(result.reason)
}
