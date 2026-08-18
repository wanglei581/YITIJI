#!/usr/bin/env node
// ============================================================================
// 项目图谱查询
//
//   node scripts/project-graph-query.mjs file     <路径片段>
//   node scripts/project-graph-query.mjs route    <路由片段>
//   node scripts/project-graph-query.mjs endpoint <端点片段>
//   node scripts/project-graph-query.mjs model    <模型名>
//   node scripts/project-graph-query.mjs gate     <门禁名片段>
//   node scripts/project-graph-query.mjs orphans  [low|medium|high|protected]
//
// 为什么要有这个而不是只出 markdown：
//
// 一份 markdown 想被用到，得先有人想起它存在、找到它、在里面搜。这三步任何一步
// 断了就等于没有 —— docs/ 里 800 多份文件已经证明过了。命令行查询把「查图谱」
// 变成一条能贴进任务描述、能写进 CLAUDE.md、能被下一个模型直接执行的指令。
//
// 直接读 docs/graph/graph.json，不重新解析代码（快）。图谱过期时会提示重跑。
// ============================================================================

import fs from 'node:fs'
import path from 'node:path'
import { REPO_ROOT } from './project-graph/repo.mjs'
import { groupByRisk } from './project-graph/orphans.mjs'

const GRAPH_PATH = path.join(REPO_ROOT, 'docs', 'graph', 'graph.json')

function loadGraph() {
  try {
    return JSON.parse(fs.readFileSync(GRAPH_PATH, 'utf8'))
  } catch {
    console.error('  找不到 docs/graph/graph.json，先跑：node scripts/generate-project-graph.mjs')
    process.exit(1)
  }
}

function heading(text) {
  console.log(`\n${text}\n${'─'.repeat(Math.min(72, text.length + 8))}`)
}

function bullet(text, indent = 2) {
  console.log(`${' '.repeat(indent)}${text}`)
}

const includes = (haystack, needle) => haystack.toLowerCase().includes(needle.toLowerCase())

// ---------------------------------------------------------------------------

function queryFile(graph, needle) {
  const matches = Object.keys(graph.fileToGates).filter((file) => includes(file, needle))

  heading(`文件 → 门禁：匹配 "${needle}"`)
  if (matches.length === 0) {
    bullet('没有任何门禁断言这个文件。')
    bullet('注意：这不代表可以随便改 —— typecheck / lint / build 仍然会看它。')
  }
  for (const file of matches.slice(0, 40)) {
    console.log(`\n  ${file}`)
    for (const gate of graph.fileToGates[file]) {
      const info = graph.gates.find((g) => g.file === gate)
      const state = !info?.wired ? '⚠ 无脚本名，不会执行' : info.inCi ? 'CI 会跑' : '有脚本名，CI 闭包外'
      bullet(`← ${gate}  [${state}]`, 4)
      for (const name of info?.scriptNames ?? []) bullet(`  运行：pnpm --filter ${name.replace('::', ' ')}`, 6)
    }
  }
  if (matches.length > 40) bullet(`\n  …另有 ${matches.length - 40} 个匹配，请把查询写得更具体。`)

  // 顺带告诉他这个文件在不在路由/孤儿清单里
  for (const [key, app] of Object.entries(graph.apps)) {
    const routes = app.routes.filter((route) => route.file && includes(route.file, needle))
    if (routes.length === 0) continue
    heading(`${key} 路由里用到它`)
    for (const route of routes) {
      bullet(`${route.path}  →  ${route.component}  （${route.endpoints.length} 个端点）`)
    }
  }

  const orphan = graph.orphans.entries.filter((entry) => includes(entry.file, needle))
  if (orphan.length > 0) {
    heading('在孤儿候选清单里')
    for (const entry of orphan) bullet(`[${entry.risk}] ${entry.file} — ${entry.why}`)
  }
}

function queryRoute(graph, needle) {
  for (const [key, app] of Object.entries(graph.apps)) {
    const routes = app.routes.filter((route) => includes(route.path, needle))
    if (routes.length === 0) continue
    heading(`${key}：匹配 "${needle}" 的路由`)
    for (const route of routes) {
      console.log(`\n  ${route.path}`)
      bullet(`组件   ${route.component ?? '—'}`, 4)
      bullet(`文件   ${route.file ?? '—（重定向，无页面文件）'}`, 4)
      if (route.layout.length > 0) bullet(`布局   ${route.layout.join(' › ')}`, 4)
      if (route.styles.length > 0) bullet(`样式   ${route.styles.join('\n           ')}`, 4)
      if (route.endpoints.length > 0) {
        bullet(`端点   ${route.endpoints.length} 个（import 可达性上界）`, 4)
        for (const endpoint of route.endpoints) bullet(endpoint, 11)
      }
      if (route.file) {
        const gates = graph.fileToGates[route.file] ?? []
        if (gates.length > 0) bullet(`门禁   ${gates.join('\n           ')}`, 4)
      }
    }
  }
}

function queryEndpoint(graph, needle) {
  const matches = graph.api.endpoints.filter(
    (endpoint) => includes(endpoint.path, needle) || includes(endpoint.handler, needle),
  )
  heading(`API 端点：匹配 "${needle}"（${matches.length}）`)
  for (const endpoint of matches.slice(0, 40)) {
    console.log(`\n  ${endpoint.method} ${endpoint.path}`)
    bullet(`handler    ${endpoint.handler}`, 4)
    bullet(`controller ${endpoint.controller}`, 4)
    if (endpoint.roles.length > 0) bullet(`角色       ${endpoint.roles.join(' / ')}`, 4)
    if (endpoint.services.length > 0) bullet(`service    ${endpoint.services.join(', ')}`, 4)
    if (endpoint.models.length > 0) bullet(`模型       ${endpoint.models.join(', ')}`, 4)
  }
  if (matches.length > 40) bullet(`\n  …另有 ${matches.length - 40} 个匹配。`)

  // 哪些前端页面会走到它
  const callers = []
  for (const [key, app] of Object.entries(graph.apps)) {
    for (const route of app.routes) {
      for (const endpoint of route.endpoints) {
        if (includes(endpoint, needle)) callers.push(`${key} ${route.path}`)
      }
    }
  }
  if (callers.length > 0) {
    heading(`可能调用它的前端路由（${callers.length}）`)
    for (const caller of [...new Set(callers)].sort()) bullet(caller)
  }
}

function queryModel(graph, needle) {
  const matches = graph.dataModel.models.filter((model) => includes(model.name, needle))
  heading(`Prisma 模型：匹配 "${needle}"（${matches.length}）`)
  for (const model of matches) {
    console.log(`\n  ${model.name}  （${model.fieldCount} 字段）`)
    if (model.relations.length > 0) bullet(`关联   ${model.relations.join(', ')}`, 4)
    bullet(`读写   ${model.usedBy.length} 个文件`, 4)
    for (const file of model.usedBy.slice(0, 12)) bullet(file, 11)
    if (model.usedBy.length > 12) bullet(`…另有 ${model.usedBy.length - 12} 个`, 11)

    const endpoints = graph.api.endpoints.filter((endpoint) => endpoint.models.includes(model.name))
    if (endpoints.length > 0) {
      bullet(`端点   ${endpoints.length} 个`, 4)
      for (const endpoint of endpoints.slice(0, 12)) bullet(`${endpoint.method} ${endpoint.path}`, 11)
      if (endpoints.length > 12) bullet(`…另有 ${endpoints.length - 12} 个`, 11)
    }
  }
}

function queryGate(graph, needle) {
  const matches = graph.gates.filter((gate) => includes(gate.file, needle))
  heading(`门禁：匹配 "${needle}"（${matches.length}）`)
  for (const gate of matches.slice(0, 25)) {
    console.log(`\n  ${gate.file}`)
    bullet(gate.helper ? '类型   辅助库（被别的门禁 import，无需脚本名）' : '类型   门禁入口', 4)
    bullet(`脚本名 ${gate.scriptNames.length > 0 ? gate.scriptNames.join(', ') : '⚠ 无 —— 从未被执行过'}`, 4)
    bullet(`CI     ${gate.inCi ? '在执行闭包内' : '不在执行闭包内（推断，权威见 verify:ci-gate-coverage）'}`, 4)
    bullet(`断言   ${gate.asserts.files.length} 个文件、${gate.asserts.dirs.length} 个目录`, 4)
    for (const file of gate.asserts.files.slice(0, 12)) bullet(file, 11)
    if (gate.asserts.files.length > 12) bullet(`…另有 ${gate.asserts.files.length - 12} 个`, 11)
    if (gate.asserts.missing.length > 0) {
      bullet(`⚠ 断言了不存在的路径：${gate.asserts.missing.join(', ')}`, 4)
    }
  }
}

function queryOrphans(graph, risk) {
  const groups = groupByRisk(graph.orphans.entries)
  const risks = risk ? [risk] : ['low', 'medium', 'high', 'protected']
  for (const level of risks) {
    const entries = groups[level] ?? []
    heading(`孤儿候选 · ${level}（${entries.length}）`)
    for (const entry of entries) {
      console.log(`  [${entry.kind}] ${entry.file}`)
      bullet(entry.why, 6)
    }
  }
  console.log('\n  提醒：本清单只是候选，删除需产品负责人逐条确认后另开 PR。\n')
}

// ---------------------------------------------------------------------------

const USAGE = `
项目图谱查询

  node scripts/project-graph-query.mjs file     <路径片段>   改这个文件会红哪条门禁
  node scripts/project-graph-query.mjs route    <路由片段>   路由背后的页面/端点/门禁
  node scripts/project-graph-query.mjs endpoint <端点片段>   端点的实现与数据模型
  node scripts/project-graph-query.mjs model    <模型名>     模型被谁读写
  node scripts/project-graph-query.mjs gate     <门禁片段>   门禁断言了什么
  node scripts/project-graph-query.mjs orphans  [风险等级]   零引用候选清单

数据来自 docs/graph/graph.json；代码变了先跑 node scripts/generate-project-graph.mjs
`

function main() {
  const [command, ...rest] = process.argv.slice(2)
  const needle = rest.join(' ').trim()

  if (!command || command === '--help' || command === '-h') {
    console.log(USAGE)
    return
  }

  const graph = loadGraph()

  switch (command) {
    case 'file':
      if (!needle) return console.log(USAGE)
      return queryFile(graph, needle)
    case 'route':
      if (!needle) return console.log(USAGE)
      return queryRoute(graph, needle)
    case 'endpoint':
      if (!needle) return console.log(USAGE)
      return queryEndpoint(graph, needle)
    case 'model':
      if (!needle) return console.log(USAGE)
      return queryModel(graph, needle)
    case 'gate':
      if (!needle) return console.log(USAGE)
      return queryGate(graph, needle)
    case 'orphans':
      return queryOrphans(graph, needle || null)
    default:
      console.log(USAGE)
      process.exitCode = 1
  }
}

main()
