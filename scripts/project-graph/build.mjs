// ============================================================================
// 项目图谱 · 装配
//
// 把 frontend / backend / gates / orphans 四个采集器的结果拼成一个对象。
// 这里只做拼装与排序，不做任何格式化输出（渲染在 render.mjs）。
//
// 稳定性约束：产物里不得出现时间戳、commit sha、随机序、Map 遍历序或
// 绝对路径。图谱的价值在于「两次生成的 diff 就是这段时间代码的真实变化」，
// 只要混进一个 new Date()，diff 就永远非空，这份图谱当天就会被人放弃。
// ============================================================================

import path from 'node:path'
import { readText, resolveModule, sorted, stripComments, trackedFiles } from './repo.mjs'
import {
  FRONTEND_APPS,
  buildImportGraph,
  extractEndpoints,
  parseRouterFile,
  reachableFiles,
} from './frontend.mjs'
import {
  API_ROOT,
  extractPrismaModels,
  parseController,
  parsePrismaSchema,
  prismaAccessorMap,
  serviceDataClosure,
} from './backend.mjs'
import {
  buildDirIndex,
  buildGateIndex,
  ciExecutionClosure,
  extractAssertedPaths,
  findContradictoryGates,
  gateHelperModules,
} from './gates.mjs'
import {
  buildMentionIndex,
  classifyRisk,
  findUnreachableAppFiles,
  findUnreferencedDocs,
  findUnwiredGates,
  mentionsOf,
} from './orphans.mjs'

const SERVICE_LAYER = /\/src\/services\//

function buildFrontend(fileSet) {
  const apps = {}

  for (const app of FRONTEND_APPS) {
    // CSS 一并进图：它们既是 import 的目标，本身也用 @import 串联下一层样式分片。
    const files = trackedFiles().filter(
      (file) => file.startsWith(`${app.root}/src/`) && /\.(tsx?|mts|css)$/.test(file),
    )
    const graph = buildImportGraph(files, fileSet, app.root)

    // service 层每个文件请求哪些端点
    const endpointsByFile = new Map()
    for (const file of files) {
      if (!SERVICE_LAYER.test(file)) continue
      const endpoints = extractEndpoints(graph.stripped.get(file) ?? '')
      if (endpoints.length > 0) endpointsByFile.set(file, endpoints)
    }

    // 路由 → 页面组件文件
    //
    // 三端两种写法都要认：kiosk 用具名导入 `import { HomePage } from '../pages/home/HomePage'`，
    // admin/partner 用默认导入 `import DashboardPage from './dashboard'`（目录 index）。
    const routerText = stripComments(readText(app.router))
    const componentFiles = new Map()
    const IMPORT_LINE =
      /import\s+(?:([A-Z][\w$]*)\s*,?\s*)?(?:\{([^}]*)\})?\s*from\s*['"]([^'"]+)['"]/g
    for (const [, defaultName, namedBlock, spec] of routerText.matchAll(IMPORT_LINE)) {
      const target = resolveModule(app.router, spec, fileSet, app.root)
      if (!target) continue
      if (defaultName) componentFiles.set(defaultName, target)
      for (const raw of (namedBlock ?? '').split(',')) {
        const name = raw.trim().split(/\s+as\s+/).pop()?.trim()
        if (name && /^[A-Z][\w$]*$/.test(name)) componentFiles.set(name, target)
      }
    }

    const routes = parseRouterFile(app.router).map((route) => {
      const pageName =
        route.elements.find((name) => {
          const file = componentFiles.get(name)
          return file && /\/(pages|routes)\//.test(file)
        }) ?? route.elements[0] ?? null
      const pageFile = pageName ? componentFiles.get(pageName) ?? null : null

      let endpoints = []
      const styles = []
      if (pageFile) {
        const closure = reachableFiles(pageFile, graph)
        closure.add(pageFile)
        const collected = new Map()
        for (const file of closure) {
          for (const endpoint of endpointsByFile.get(file) ?? []) {
            collected.set(`${endpoint.method} ${endpoint.path}`, endpoint)
          }
          if (file.endsWith('.css')) styles.push(file)
        }
        endpoints = [...collected.keys()].sort()
      }

      return {
        path: route.path,
        component: pageName,
        file: pageFile,
        wrappers: sorted(route.elements.filter((name) => name !== pageName)),
        layout: route.layout,
        endpoints,
        styles: sorted(styles),
      }
    })

    const entry = `${app.root}/src/main.tsx`
    const reachable = reachableFiles(entry, graph)
    reachable.add(entry)

    apps[app.key] = { root: app.root, router: app.router, entry, routes, reachable, graph, files }
  }

  return apps
}

function buildBackend(fileSet) {
  const schemaFile = `${API_ROOT}/prisma/schema.prisma`
  const models = parsePrismaSchema(schemaFile)
  const accessors = prismaAccessorMap(models)

  const apiFiles = trackedFiles().filter(
    (file) => file.startsWith(`${API_ROOT}/src/`) && file.endsWith('.ts') && !file.endsWith('.d.ts'),
  )

  const prismaByFile = new Map()
  const modelUsage = new Map()
  for (const file of apiFiles) {
    if (file.includes('/generated/')) continue
    const used = extractPrismaModels(stripComments(readText(file)), accessors)
    if (used.length === 0) continue
    prismaByFile.set(file, used)
    for (const model of used) {
      if (!modelUsage.has(model)) modelUsage.set(model, new Set())
      modelUsage.get(model).add(file)
    }
  }

  const controllerFiles = apiFiles.filter((file) => file.endsWith('.controller.ts'))
  const endpoints = []
  for (const file of controllerFiles.sort()) {
    const parsed = parseController(file, fileSet)
    if (!parsed) continue
    for (const endpoint of parsed.endpoints) {
      const serviceFiles = endpoint.services
        .map((className) => parsed.classFiles.get(className))
        .filter(Boolean)
      endpoints.push({
        method: endpoint.method,
        path: endpoint.path,
        handler: endpoint.handler,
        controller: file,
        roles: endpoint.roles,
        services: endpoint.services,
        serviceFiles: sorted(serviceFiles),
        models: serviceDataClosure(serviceFiles, fileSet, prismaByFile),
      })
    }
  }

  endpoints.sort((a, b) =>
    a.path === b.path ? a.method.localeCompare(b.method) : a.path < b.path ? -1 : 1,
  )

  const modelList = [...models.values()]
    .map((model) => ({
      name: model.name,
      fieldCount: model.fields.length,
      relations: model.relations,
      usedBy: sorted([...(modelUsage.get(model.name) ?? [])]),
    }))
    .sort((a, b) => (a.name < b.name ? -1 : 1))

  return { schemaFile, models: modelList, endpoints }
}

function buildGates(fileSet) {
  const dirIndex = buildDirIndex(trackedFiles())
  const { gates, packages } = buildGateIndex(fileSet)
  const ciClosure = ciExecutionClosure(packages)

  const helpers = gateHelperModules(fileSet)

  const list = []
  const fileToGates = new Map()

  const packageDirs = [...packages.keys()].filter(Boolean).sort()

  for (const gate of [...gates.values()].sort((a, b) => (a.file < b.file ? -1 : 1))) {
    const asserts = extractAssertedPaths(gate.file, fileSet, dirIndex, packageDirs)
    const inCi = gate.scriptNames.some((name) => ciClosure.has(name))
    list.push({
      file: gate.file,
      package: gate.packageName,
      scriptNames: gate.scriptNames,
      wired: gate.scriptNames.length > 0,
      helper: helpers.has(gate.file),
      inCi,
      asserts,
    })

    for (const target of asserts.files) {
      if (!fileToGates.has(target)) fileToGates.set(target, new Set())
      fileToGates.get(target).add(gate.file)
    }
  }

  return {
    gates: list,
    contradictions: findContradictoryGates(list),
    fileToGates: Object.fromEntries(
      [...fileToGates.entries()]
        .sort((a, b) => (a[0] < b[0] ? -1 : 1))
        .map(([file, set]) => [file, sorted([...set])]),
    ),
  }
}

function buildOrphans(frontend, gates) {
  const index = buildMentionIndex()
  const entries = []

  for (const [key, app] of Object.entries(frontend)) {
    const routedFiles = new Set(app.routes.map((route) => route.file).filter(Boolean))
    const unreachable = findUnreachableAppFiles(app.root, app.reachable, [
      app.entry,
      app.router,
      ...routedFiles,
    ])
    for (const file of unreachable) {
      const mentions = mentionsOf(file, index)
      const kind = /\.(test|spec)\.tsx?$/.test(file)
        ? 'test'
        : file.endsWith('.css')
          ? 'style'
          : 'component'
      entries.push({
        file,
        kind,
        scope: key,
        detail: `不在 ${app.entry} 的 import 闭包内，也不在路由表中`,
        ...classifyRisk(file, mentions),
      })
    }
  }

  for (const file of findUnwiredGates(new Map(gates.gates.map((g) => [g.file, g])))) {
    const mentions = mentionsOf(file, index)
    entries.push({
      file,
      kind: 'gate',
      scope: 'verify',
      detail: '文件存在，但没有任何 package.json 脚本名指向它 —— 从未被执行过',
      ...classifyRisk(file, mentions),
    })
  }

  for (const file of findUnreferencedDocs(index)) {
    entries.push({
      file,
      kind: 'doc',
      scope: 'docs',
      detail: '全仓没有任何其它文件提到这个路径或文件名',
      ...classifyRisk(file, []),
    })
  }

  // 只回 entries，不回 groups：groups 是 entries 的另一种切法，两份都序列化进
  // graph.json 会让同一批数据在产物里存两遍（约 43KB），而且天然有互相不一致的
  // 可能。分组交给渲染层和查询层按需算。
  return { entries: entries.sort((a, b) => (a.file < b.file ? -1 : 1)) }
}

export function buildGraph() {
  const files = trackedFiles()
  const fileSet = new Set(files)

  const frontend = buildFrontend(fileSet)
  const backend = buildBackend(fileSet)
  const gates = buildGates(fileSet)
  const orphans = buildOrphans(frontend, gates)

  const apps = {}
  for (const [key, app] of Object.entries(frontend)) {
    apps[key] = {
      root: app.root,
      router: app.router,
      entry: app.entry,
      sourceFileCount: app.files.length,
      // 只数应用自己目录下的可达文件：闭包里还有 packages/ui、packages/shared，
      // 混进来会出现「可达数 > 源文件数」这种一看就没法解释的表格。
      reachableFileCount: [...app.reachable].filter((file) => file.startsWith(`${app.root}/`)).length,
      routes: app.routes,
    }
  }

  return {
    apps,
    api: {
      root: API_ROOT,
      globalPrefix: '/api/v1',
      endpointCount: backend.endpoints.length,
      endpoints: backend.endpoints,
    },
    dataModel: { schema: backend.schemaFile, modelCount: backend.models.length, models: backend.models },
    gates: gates.gates,
    gateContradictions: gates.contradictions,
    fileToGates: gates.fileToGates,
    orphans,
  }
}
