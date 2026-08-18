// ============================================================================
// 项目图谱 · 前端三端（kiosk / admin / partner）
//
// 产出三类边：
//   1. 路由 → 页面组件      —— 从各 app 的 createBrowserRouter 路由表结构化解析
//   2. 文件 → 文件          —— import 图，barrel 按具名符号解析（见下）
//   3. 页面 → API 端点      —— 页面 import 闭包里落到 services/api 层的端点字面量
//
// 为什么 barrel 要按具名符号解析：`services/api/index.ts` 是 `export * from`
// 汇总口。若照直传递，任何 `import { getJobs } from '../../services/api'` 的页面
// 都会被算成调用了全部 40 多个模块的端点，图谱立刻退化成「人人都调用一切」，
// 和没有一样。所以遇到 barrel 时只沿着真正导出该符号的模块往下走。
//
// apps/miniapp 不在本文件的解析范围内：它是原生微信小程序，结构与三端不同，
// 且归产品负责人所有。图谱只在门禁清单里只读地引用它的 package.json 脚本名。
// ============================================================================

import path from 'node:path'
import { importSpecifiers, readText, resolveModule, sorted, stripComments } from './repo.mjs'

export const FRONTEND_APPS = [
  { key: 'kiosk', root: 'apps/kiosk', router: 'apps/kiosk/src/routes/index.tsx' },
  { key: 'admin', root: 'apps/admin', router: 'apps/admin/src/routes/index.tsx' },
  { key: 'partner', root: 'apps/partner', router: 'apps/partner/src/routes/index.tsx' },
]

// ---------------------------------------------------------------------------
// 路由表解析
// ---------------------------------------------------------------------------
// 手写扫描器而不是正则：路由是嵌套结构（children 决定完整路径），正则拿不到
// 层级。扫描器在已剥注释的文本上跑，只需正确处理字符串与三种括号的配对。

function skipSpace(text, i) {
  while (i < text.length && /\s/.test(text[i])) i += 1
  return i
}

/** 跳过一个字符串字面量，返回结束位置之后的索引与原文。 */
function readStringLiteral(text, i) {
  const quote = text[i]
  let j = i + 1
  let value = ''
  while (j < text.length) {
    if (text[j] === '\\') {
      value += text[j + 1] ?? ''
      j += 2
      continue
    }
    if (text[j] === quote) break
    value += text[j]
    j += 1
  }
  return { value, next: j + 1 }
}

/** 从 i 起跳过一个值，直到当前层级的 `,` 或 `}`。返回该值原文与结束索引。 */
function skipValue(text, i) {
  const start = i
  let depth = 0
  while (i < text.length) {
    const ch = text[i]
    if (ch === '"' || ch === "'" || ch === '`') {
      i = readStringLiteral(text, i).next
      continue
    }
    if (ch === '{' || ch === '[' || ch === '(') depth += 1
    else if (ch === '}' || ch === ']' || ch === ')') {
      if (depth === 0) break
      depth -= 1
    } else if (ch === ',' && depth === 0) break
    i += 1
  }
  return { raw: text.slice(start, i), next: i }
}

function parseRouteArray(text, start) {
  const routes = []
  let i = start + 1
  while (i < text.length) {
    i = skipSpace(text, i)
    if (text[i] === ']') return { routes, next: i + 1 }
    if (text[i] === ',') {
      i += 1
      continue
    }
    if (text[i] === '{') {
      const parsed = parseRouteObject(text, i)
      routes.push(parsed.route)
      i = parsed.next
      continue
    }
    // 非对象元素（展开、变量引用）——跳过，图谱不猜。
    const skipped = skipValue(text, i)
    if (skipped.next === i) i += 1
    else i = skipped.next
  }
  return { routes, next: i }
}

function parseRouteObject(text, start) {
  const route = { path: null, index: false, elements: [], children: [] }
  let i = start + 1

  while (i < text.length) {
    i = skipSpace(text, i)
    if (text[i] === '}') return { route, next: i + 1 }
    if (text[i] === ',') {
      i += 1
      continue
    }

    const keyMatch = /^([A-Za-z_$][\w$]*)\s*:/.exec(text.slice(i, i + 64))
    if (!keyMatch) {
      const skipped = skipValue(text, i)
      i = skipped.next === i ? i + 1 : skipped.next
      continue
    }

    const key = keyMatch[1]
    i = skipSpace(text, i + keyMatch[0].length)

    if (key === 'children') {
      if (text[i] === '[') {
        const parsed = parseRouteArray(text, i)
        route.children = parsed.routes
        i = parsed.next
        continue
      }
    }

    if (key === 'path' && (text[i] === '"' || text[i] === "'" || text[i] === '`')) {
      const literal = readStringLiteral(text, i)
      route.path = literal.value
      i = literal.next
      continue
    }

    const value = skipValue(text, i)
    if (key === 'index') route.index = /true/.test(value.raw)
    if (key === 'element' || key === 'Component') {
      route.elements = [...value.raw.matchAll(/<([A-Z][\w.]*)/g)].map((m) => m[1])
    }
    i = value.next === i ? i + 1 : value.next
  }

  return { route, next: i }
}

function joinRoutePath(parent, child) {
  if (child === null || child === undefined) return parent
  if (child.startsWith('/')) return child
  const base = parent === '/' ? '' : parent
  return `${base}/${child}`.replace(/\/{2,}/g, '/')
}

function flattenRoutes(routes, parentPath, layerElements, out) {
  for (const route of routes) {
    const fullPath = route.index ? parentPath : joinRoutePath(parentPath, route.path)
    const isLeaf = route.children.length === 0

    if (isLeaf && route.elements.length > 0) {
      out.push({
        path: fullPath || '/',
        index: route.index,
        elements: route.elements,
        layout: sorted(layerElements),
      })
    }

    if (route.children.length > 0) {
      flattenRoutes(route.children, fullPath || '', [...layerElements, ...route.elements], out)
    }
  }
}

export function parseRouterFile(routerFile) {
  const text = stripComments(readText(routerFile))
  if (!text) return []

  const anchor = text.indexOf('createBrowserRouter')
  if (anchor === -1) return []
  const bracket = text.indexOf('[', anchor)
  if (bracket === -1) return []

  const { routes } = parseRouteArray(text, bracket)
  const flat = []
  flattenRoutes(routes, '', [], flat)
  return flat.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

// ---------------------------------------------------------------------------
// import 图（barrel 按具名符号解析）
// ---------------------------------------------------------------------------

const NAMED_IMPORT_PATTERN =
  /(?:import|export)\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g
const STAR_IMPORT_PATTERN = /(?:import|export)\s+(?:type\s+)?\*(?:\s+as\s+[\w$]+)?\s+from\s*['"]([^'"]+)['"]/g

function namedImports(strippedText) {
  const map = new Map()
  NAMED_IMPORT_PATTERN.lastIndex = 0
  let match
  while ((match = NAMED_IMPORT_PATTERN.exec(strippedText)) !== null) {
    const names = match[1]
      .split(',')
      .map((part) => part.trim().split(/\s+as\s+/)[0].trim())
      .filter((name) => /^[\w$]+$/.test(name))
    const bucket = map.get(match[2]) ?? new Set()
    for (const name of names) bucket.add(name)
    map.set(match[2], bucket)
  }
  return map
}

function starImports(strippedText) {
  const specs = new Set()
  STAR_IMPORT_PATTERN.lastIndex = 0
  let match
  while ((match = STAR_IMPORT_PATTERN.exec(strippedText)) !== null) specs.add(match[1])
  return specs
}

const EXPORT_DECL_PATTERN =
  /export\s+(?:declare\s+)?(?:async\s+)?(?:const|let|var|function\*?|class|type|interface|enum)\s+([\w$]+)/g
const EXPORT_LIST_PATTERN = /export\s*\{([^}]*)\}(?!\s*from)/g

function declaredExports(strippedText) {
  const names = new Set()
  for (const pattern of [EXPORT_DECL_PATTERN]) {
    pattern.lastIndex = 0
    let match
    while ((match = pattern.exec(strippedText)) !== null) names.add(match[1])
  }
  EXPORT_LIST_PATTERN.lastIndex = 0
  let match
  while ((match = EXPORT_LIST_PATTERN.exec(strippedText)) !== null) {
    for (const part of match[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim()
      if (name && /^[\w$]+$/.test(name)) names.add(name)
    }
  }
  return names
}

/**
 * 建立一个应用的文件级 import 图。
 * 返回 { edges: Map<file, string[]>, reexports: Map<barrelFile, Map<symbol, file>> }
 */
export function buildImportGraph(files, fileSet, appRoot) {
  const stripped = new Map()
  const edges = new Map()
  const namedByFile = new Map()
  const starByFile = new Map()

  for (const file of files) {
    const text = stripComments(readText(file))
    stripped.set(file, text)
    namedByFile.set(file, namedImports(text))
    starByFile.set(file, starImports(text))
    const resolved = importSpecifiers(text)
      .map((spec) => resolveModule(file, spec, fileSet, appRoot))
      .filter(Boolean)
    edges.set(file, sorted(resolved))
  }

  // barrel 判定：文件里除了 re-export 之外几乎没有自己的实现
  const symbolOwner = new Map()
  for (const file of files) {
    const text = stripped.get(file) ?? ''
    const reexportSpecs = sorted([
      ...[...text.matchAll(/export\s+(?:type\s+)?\*(?:\s+as\s+[\w$]+)?\s+from\s*['"]([^'"]+)['"]/g)].map(
        (m) => m[1],
      ),
      ...[...text.matchAll(/export\s+(?:type\s+)?\{[^}]*\}\s*from\s*['"]([^'"]+)['"]/g)].map((m) => m[1]),
    ])
    if (reexportSpecs.length === 0) continue

    const owners = new Map()
    for (const spec of reexportSpecs) {
      const target = resolveModule(file, spec, fileSet, appRoot)
      if (!target) continue
      for (const name of declaredExports(stripped.get(target) ?? stripComments(readText(target)))) {
        if (!owners.has(name)) owners.set(name, target)
      }
    }
    if (owners.size > 0) symbolOwner.set(file, owners)
  }

  return { edges, stripped, symbolOwner, namedByFile, starByFile }
}

/** 从入口出发的可达文件集合；穿过 barrel 时只跟随实际用到的符号。 */
export function reachableFiles(entry, graph) {
  const seen = new Set()
  const queue = [entry]

  while (queue.length > 0) {
    const current = queue.shift()
    if (seen.has(current)) continue
    seen.add(current)

    const named = graph.namedByFile.get(current) ?? new Map()
    const stars = graph.starByFile.get(current) ?? new Set()

    for (const target of graph.edges.get(current) ?? []) {
      const owners = graph.symbolOwner.get(target)
      if (!owners) {
        queue.push(target)
        continue
      }

      // target 是 barrel：只沿真正被引用的符号展开
      let usedStar = false
      for (const spec of stars) {
        if (spec.includes(path.posix.basename(target, path.posix.extname(target)))) usedStar = true
      }
      const wanted = new Set()
      for (const [, names] of named) for (const name of names) wanted.add(name)

      if (usedStar || wanted.size === 0) {
        queue.push(target)
        for (const owner of owners.values()) queue.push(owner)
        continue
      }

      queue.push(target)
      for (const name of wanted) {
        const owner = owners.get(name)
        if (owner) queue.push(owner)
      }
    }
  }

  seen.delete(entry)
  return seen
}

// ---------------------------------------------------------------------------
// API 端点字面量
// ---------------------------------------------------------------------------

/** `${...}` → `:param`（跟在 `/` 后）或直接丢弃（查询串拼接）。 */
function normalizeEndpointPath(raw) {
  let out = ''
  let i = 0
  while (i < raw.length) {
    if (raw[i] === '$' && raw[i + 1] === '{') {
      let depth = 1
      let j = i + 2
      while (j < raw.length && depth > 0) {
        if (raw[j] === '{') depth += 1
        else if (raw[j] === '}') depth -= 1
        j += 1
      }
      out += out.endsWith('/') ? ':param' : ''
      i = j
      continue
    }
    out += raw[i]
    i += 1
  }
  return out.replace(/\?.*$/, '').replace(/\/+$/, '') || '/'
}

const METHOD_CALL_PATTERN =
  /\breq(?:uest)?\s*(?:<[^()]*?>)?\s*\(\s*['"`](GET|POST|PATCH|PUT|DELETE)['"`]\s*,\s*['"`](\/[^'"`]*)/gi
const VERB_CALL_PATTERN =
  /\b(get|post|patch|put|del|delete)\s*(?:<[^()]*?>)?\s*\(\s*['"`](\/[^'"`]*)/g
const INLINE_METHOD_PATTERN = /['"`](\/[^'"`\s]*)['"`][^;\n]{0,120}?method:\s*['"`](GET|POST|PATCH|PUT|DELETE)['"`]/gi

const VERB_TO_METHOD = {
  get: 'GET',
  post: 'POST',
  patch: 'PATCH',
  put: 'PUT',
  del: 'DELETE',
  delete: 'DELETE',
}

/** 从一个前端 service 层文件里抽出它请求的端点。 */
export function extractEndpoints(strippedText) {
  const found = new Map()

  const record = (method, rawPath) => {
    const normalized = normalizeEndpointPath(rawPath)
    if (normalized.length < 2) return
    const key = `${method} ${normalized}`
    if (!found.has(key)) found.set(key, { method, path: normalized })
  }

  for (const [, method, rawPath] of strippedText.matchAll(METHOD_CALL_PATTERN)) {
    record(method.toUpperCase(), rawPath)
  }
  for (const [, verb, rawPath] of strippedText.matchAll(VERB_CALL_PATTERN)) {
    record(VERB_TO_METHOD[verb.toLowerCase()], rawPath)
  }
  for (const [, rawPath, method] of strippedText.matchAll(INLINE_METHOD_PATTERN)) {
    record(method.toUpperCase(), rawPath)
  }

  return [...found.values()].sort((a, b) =>
    a.path === b.path ? a.method.localeCompare(b.method) : a.path < b.path ? -1 : 1,
  )
}
