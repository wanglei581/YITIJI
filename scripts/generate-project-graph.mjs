#!/usr/bin/env node
// ============================================================================
// 项目图谱生成器
//
//   node scripts/generate-project-graph.mjs           写盘到 docs/graph/
//   node scripts/generate-project-graph.mjs --check   只比对，不写盘；不一致时 exit 1
//
// 存在的理由（产品负责人 2026-08-18 的原话，转成工程语言）：
// 「项目太大太乱，先做成图谱整理一下，多余没用的确定后再删。」
//
// 关键设计取舍：**从代码生成，不手写。**
// 手写的图谱会和 docs/ 里那 800 多份文档一样过期 —— 今天已经付过学费：
// CareerPlanPage.tsx 的注释写着「视觉真值 22-career-plan.html」而实际 import 的是
// 旧样式；四份文档里 11 处「某端点不存在」的结论是错的。所以这里一条边都不手抄，
// 全部从路由表、import 图、装饰器、schema、门禁断言里算出来。
//
// 只依赖 node 内置模块：图谱要能在 `pnpm install` 之前跑（和
// verify-repository-integrity / verify-ci-gate-coverage 同一规矩）。
//
// 跨平台（CLAUDE.md §17）：路径一律 path.join / posix 归一，无绝对路径，
// 无 rm -rf / cp -r 之类的 Unix 专用命令。
// ============================================================================

import fs from 'node:fs'
import path from 'node:path'
import { REPO_ROOT } from './project-graph/repo.mjs'
import { buildGraph } from './project-graph/build.mjs'
import { groupByRisk } from './project-graph/orphans.mjs'
import {
  renderApi,
  renderDataModel,
  renderGates,
  renderOrphans,
  renderReadme,
  renderRoutes,
} from './project-graph/render.mjs'

const OUTPUT_DIR = 'docs/graph'

/**
 * 稳定序列化：对象键按字典序输出。
 *
 * 这条是整份图谱可用性的地基 —— 只要产物里混进一个不稳定的遍历序、时间戳或
 * commit sha，「重跑一次，diff 就是这段时间的变化」这个承诺当场失效，
 * 图谱当天就会被人放弃。
 */
function stableStringify(value, indent = 2, depth = 0) {
  const pad = ' '.repeat(indent * depth)
  const padInner = ' '.repeat(indent * (depth + 1))

  if (value === null || typeof value !== 'object') return JSON.stringify(value)

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    const items = value.map((item) => padInner + stableStringify(item, indent, depth + 1))
    return `[\n${items.join(',\n')}\n${pad}]`
  }

  const keys = Object.keys(value).sort()
  if (keys.length === 0) return '{}'
  const entries = keys.map(
    (key) => `${padInner}${JSON.stringify(key)}: ${stableStringify(value[key], indent, depth + 1)}`,
  )
  return `{\n${entries.join(',\n')}\n${pad}}`
}

function normalizeNewlines(text) {
  // .gitattributes 统一 LF；产物也必须是 LF，否则 Windows 上生成会全文件 diff。
  return `${text.replace(/\r\n/g, '\n').replace(/\s+$/, '')}\n`
}

function main() {
  const checkOnly = process.argv.includes('--check')
  const graph = buildGraph()

  const artifacts = {
    'README.md': renderReadme(graph),
    'routes.md': renderRoutes(graph),
    'api.md': renderApi(graph),
    'data-model.md': renderDataModel(graph),
    'gates.md': renderGates(graph),
    'orphans.md': renderOrphans(graph),
    'graph.json': `${stableStringify(graph)}\n`,
  }

  const outDir = path.join(REPO_ROOT, ...OUTPUT_DIR.split('/'))
  const drift = []
  let written = 0

  if (!checkOnly) fs.mkdirSync(outDir, { recursive: true })

  for (const [name, raw] of Object.entries(artifacts)) {
    const content = normalizeNewlines(raw)
    const target = path.join(outDir, name)

    let existing = null
    try {
      existing = fs.readFileSync(target, 'utf8')
    } catch {
      existing = null
    }

    if (existing === content) continue

    if (checkOnly) {
      drift.push(existing === null ? `${OUTPUT_DIR}/${name}（缺失）` : `${OUTPUT_DIR}/${name}（内容不一致）`)
      continue
    }

    fs.writeFileSync(target, content, 'utf8')
    written += 1
  }

  const gateStats = {
    unwired: graph.gates.filter((g) => !g.wired && !g.helper).length,
    missingPaths: graph.gates.filter((g) => g.asserts.missing.length > 0).length,
  }

  console.log('\n=== 项目图谱 ===')
  for (const [key, app] of Object.entries(graph.apps)) {
    console.log(`  ${key.padEnd(8)} ${String(app.routes.length).padStart(4)} 路由`)
  }
  console.log(`  api      ${String(graph.api.endpointCount).padStart(4)} 端点`)
  console.log(`  prisma   ${String(graph.dataModel.modelCount).padStart(4)} 模型`)
  console.log(`  gates    ${String(graph.gates.length).padStart(4)} 脚本（${gateStats.unwired} 个无脚本名、${gateStats.missingPaths} 个断言了不存在的路径）`)
  const risk = groupByRisk(graph.orphans.entries)
  console.log(
    `  orphans  ${String(graph.orphans.entries.length).padStart(4)} 候选（low ${risk.low.length} / medium ${risk.medium.length} / high ${risk.high.length} / protected ${risk.protected.length}）`,
  )

  if (checkOnly) {
    if (drift.length > 0) {
      console.error(`\n  FAIL 图谱与代码不一致，请重跑 \`node scripts/generate-project-graph.mjs\`：`)
      for (const item of drift) console.error(`    - ${item}`)
      process.exit(1)
    }
    console.log(`\n  PASS ${OUTPUT_DIR}/ 与当前代码一致`)
    return
  }

  console.log(`\n  写入 ${OUTPUT_DIR}/（${written} 个文件有变化，共 ${Object.keys(artifacts).length} 个）`)
}

main()
