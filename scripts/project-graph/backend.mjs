// ============================================================================
// 项目图谱 · 后端（services/api）
//
// 产出三类边：
//   1. HTTP 端点 → controller 方法   —— 解析 @Controller/@Get/@Post 装饰器
//   2. controller 方法 → service 类  —— 从构造器注入名反查 this.xxx 调用
//   3. service → Prisma 模型         —— this.prisma.<model>.<op> 调用
//   4. Prisma 模型 → Prisma 模型     —— schema.prisma 的关系字段
//
// 装饰器必须在**剥掉注释之后**解析：本仓库 controller 顶部普遍有一整块历史
// 路由清单注释（jobs.controller.ts 就有 20 多行），对原文 grep 会把注释里写的
// 端点当成真的 —— 这正是「按注释判断实现」那类事故的机器版本。
// ============================================================================

import path from 'node:path'
import { readText, resolveModule, sorted, stripComments } from './repo.mjs'

export const API_ROOT = 'services/api'
export const API_GLOBAL_PREFIX = '/api/v1'

// ---------------------------------------------------------------------------
// Prisma schema
// ---------------------------------------------------------------------------

const SCALARS = new Set([
  'String', 'Int', 'BigInt', 'Float', 'Decimal', 'Boolean', 'DateTime', 'Json', 'Bytes',
])

export function parsePrismaSchema(schemaFile) {
  const text = stripComments(readText(schemaFile))
  const models = new Map()

  const modelPattern = /\bmodel\s+([A-Za-z_][\w]*)\s*\{([\s\S]*?)\n\}/g
  let match
  while ((match = modelPattern.exec(text)) !== null) {
    const [, name, body] = match
    const fields = []
    for (const line of body.split('\n')) {
      const fieldMatch = /^\s*([A-Za-z_][\w]*)\s+([A-Za-z_][\w]*)(\[\])?(\?)?/.exec(line)
      if (!fieldMatch) continue
      const [, fieldName, type, list, optional] = fieldMatch
      if (['@@index', '@@unique', '@@map', '@@id'].includes(fieldName)) continue
      fields.push({ name: fieldName, type, list: Boolean(list), optional: Boolean(optional) })
    }
    models.set(name, { name, fields })
  }

  const enums = new Set([...text.matchAll(/\benum\s+([A-Za-z_][\w]*)\s*\{/g)].map((m) => m[1]))

  // 关系边：字段类型指向另一个 model
  for (const model of models.values()) {
    model.relations = sorted(
      model.fields
        .filter((f) => !SCALARS.has(f.type) && !enums.has(f.type) && models.has(f.type))
        .map((f) => f.type),
    ).filter((target) => target !== model.name)
    model.scalarCount = model.fields.filter((f) => SCALARS.has(f.type)).length
  }

  return models
}

/** Prisma client 上的访问名（camelCase）→ model 名（PascalCase）。 */
export function prismaAccessorMap(models) {
  const map = new Map()
  for (const name of models.keys()) {
    map.set(name.charAt(0).toLowerCase() + name.slice(1), name)
  }
  return map
}

const PRISMA_OPS =
  'findMany|findUnique|findFirst|findUniqueOrThrow|findFirstOrThrow|create|createMany|createManyAndReturn|update|updateMany|upsert|delete|deleteMany|count|aggregate|groupBy'
const PRISMA_CALL_PATTERN = new RegExp(
  `\\b(?:this\\.)?(?:prisma|tx|db|client|prismaService)\\.([a-z][A-Za-z0-9]*)\\.(?:${PRISMA_OPS})\\b`,
  'g',
)

export function extractPrismaModels(strippedText, accessorMap) {
  const found = new Set()
  for (const [, accessor] of strippedText.matchAll(PRISMA_CALL_PATTERN)) {
    const model = accessorMap.get(accessor)
    if (model) found.add(model)
  }
  return sorted([...found])
}

// ---------------------------------------------------------------------------
// Controller 解析
// ---------------------------------------------------------------------------

function matchBrace(text, openIndex) {
  let depth = 0
  for (let i = openIndex; i < text.length; i += 1) {
    const ch = text[i]
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch
      i += 1
      while (i < text.length && text[i] !== quote) {
        if (text[i] === '\\') i += 1
        i += 1
      }
      continue
    }
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return text.length
}

function joinApiPath(...parts) {
  const joined = parts
    .filter((part) => part !== null && part !== undefined && part !== '')
    .join('/')
    .replace(/\/{2,}/g, '/')
  return `/${joined}`.replace(/\/{2,}/g, '/').replace(/(.)\/$/, '$1')
}

const HTTP_DECORATOR_PATTERN =
  /@(Get|Post|Put|Patch|Delete|All|Head|Options)\s*\(\s*(?:['"`]([^'"`]*)['"`])?\s*\)/g

/** 解析一个 controller 文件，返回 { className, prefix, endpoints[], injections } */
export function parseController(file, fileSet) {
  const text = stripComments(readText(file))
  if (!text) return null

  // 一个文件里可以有多个 @Controller（本仓 6 个文件是这样，例如
  // member-print-orders.controller.ts 同时声明 `me/print-orders` 与 `me/pending-tasks`）。
  // 只 exec 一次会把后面所有端点错挂到第一个前缀上 —— 2026-09-02 实测
  // `/me/pending-tasks` 因此整条从图谱消失。这里改成按位置切段。
  const controllerHits = [
    ...text.matchAll(/@Controller\s*\(\s*(?:['"`]([^'"`]*)['"`])?\s*\)/g),
  ].map((m) => ({ index: m.index, prefix: m[1] ?? '' }))
  if (controllerHits.length === 0) return null
  const controllerMatch = { index: controllerHits[0].index }
  const prefix = controllerHits[0].prefix

  const classHits = [...text.matchAll(/export\s+class\s+([\w$]+)/g)].map((m) => ({
    index: m.index,
    name: m[1],
  }))
  const className = classHits[0]?.name ?? path.posix.basename(file)

  // 某个位置归哪个 @Controller / 哪个 class：取它之前最近的一个。
  const ownerAt = (pos) => {
    let ctrl = controllerHits[0]
    for (const hit of controllerHits) if (hit.index <= pos) ctrl = hit
    let cls = classHits[0]?.name ?? className
    for (const hit of classHits) if (hit.index <= pos) cls = hit.name
    return { prefix: ctrl.prefix, className: cls }
  }

  // 构造器注入：属性名 → 类名
  const injections = new Map()
  const ctorMatch = /constructor\s*\(([\s\S]*?)\)\s*\{/.exec(text)
  if (ctorMatch) {
    for (const [, prop, type] of ctorMatch[1].matchAll(
      /(?:private|public|protected|readonly|\s)+([\w$]+)\s*:\s*([\w$]+)/g,
    )) {
      injections.set(prop, type)
    }
  }

  // 类级守卫 / 角色
  const classRoles = sorted(
    [...text.slice(0, controllerMatch.index + 400).matchAll(/@Roles\(([^)]*)\)/g)].flatMap((m) =>
      m[1].split(',').map((r) => r.trim().replace(/['"`]/g, '')),
    ),
  )

  const endpoints = []
  HTTP_DECORATOR_PATTERN.lastIndex = 0
  let match
  while ((match = HTTP_DECORATOR_PATTERN.exec(text)) !== null) {
    const method = match[1].toUpperCase()
    const subPath = match[2] ?? ''

    // 装饰器之后到方法体：跳过其余装饰器，抓方法名和方法体
    const after = text.slice(match.index + match[0].length)
    const sigMatch = /(?:@[\w$]+\s*\([\s\S]*?\)\s*)*?\s*(?:async\s+)?([\w$]+)\s*\(/.exec(after)
    const handler = sigMatch ? sigMatch[1] : '(unknown)'

    const bodyOpen = after.indexOf('{', sigMatch ? sigMatch.index + sigMatch[0].length : 0)
    const body = bodyOpen === -1 ? '' : after.slice(bodyOpen, matchBrace(after, bodyOpen) + 1)

    // 装饰器与方法之间的 @Roles（方法级）
    const between = sigMatch ? after.slice(0, sigMatch.index + sigMatch[0].length) : ''
    const methodRoles = sorted(
      [...between.matchAll(/@Roles\(([^)]*)\)/g)].flatMap((m) =>
        m[1].split(',').map((r) => r.trim().replace(/['"`]/g, '')),
      ),
    )

    const calledServices = sorted(
      [...body.matchAll(/this\.([\w$]+)\.[\w$]+\s*\(/g)]
        .map((m) => injections.get(m[1]))
        .filter(Boolean),
    )

    const owner = ownerAt(match.index)
    endpoints.push({
      method,
      path: joinApiPath(API_GLOBAL_PREFIX.slice(1), owner.prefix, subPath),
      handler: `${owner.className}.${handler}`,
      roles: methodRoles.length > 0 ? methodRoles : classRoles,
      services: calledServices,
    })
  }

  // 类名 → 定义文件（供 service 闭包用）
  const classFiles = new Map()
  for (const spec of [
    ...[...text.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)],
  ]) {
    const target = resolveModule(file, spec[2], fileSet, API_ROOT)
    if (!target) continue
    for (const raw of spec[1].split(',')) {
      const name = raw.trim().split(/\s+as\s+/).pop()?.trim()
      if (name && /^[A-Z][\w$]*$/.test(name)) classFiles.set(name, target)
    }
  }

  return {
    file,
    className,
    prefix,
    endpoints: endpoints.sort((a, b) =>
      a.path === b.path ? a.method.localeCompare(b.method) : a.path < b.path ? -1 : 1,
    ),
    classFiles,
  }
}

/**
 * service 文件的数据层闭包。
 *
 * 只沿 `.service.ts` 与同目录文件展开，深度上限 2。
 *
 * 深度是实测挑的，不是拍的（465 个端点上跑的分布）：
 *
 *   depth=1  零模型 136 个端点  中位 2  p90  5  最大  8   —— 漏太多，
 *            controller 注入的 service 常常只是转发壳，自己不碰 prisma
 *   depth=2  零模型  76        中位 4  p90 11  最大 14
 *   depth=3  零模型  76        中位 4  p90 15  最大 18
 *   depth=4  零模型  76        中位 4  p90 17  最大 18
 *
 * 2 以后覆盖率（零模型数）就不再改善，只是把噪声越堆越高。取 2。
 *
 * 不做全量传递闭包也是刻意的：services/api/src 里到处 import 公共工具，全量
 * 展开会把几乎所有端点都连到全部 91 个模型上，图谱就没有分辨力了。宁可少一
 * 条边，也不要一张「什么都连着什么」的网。
 */
export function serviceDataClosure(entryFiles, fileSet, prismaByFile, maxDepth = 2) {
  const models = new Set();
  const visited = new Set()
  let frontier = entryFiles.filter(Boolean)

  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth += 1) {
    const next = []
    for (const file of frontier) {
      if (visited.has(file)) continue
      visited.add(file)
      for (const model of prismaByFile.get(file) ?? []) models.add(model)

      const dir = path.posix.dirname(file)
      const text = stripComments(readText(file))
      for (const [, spec] of text.matchAll(/from\s*['"]([^'"]+)['"]/g)) {
        const target = resolveModule(file, spec, fileSet, API_ROOT)
        if (!target || visited.has(target)) continue
        if (target.endsWith('.service.ts') || path.posix.dirname(target) === dir) next.push(target)
      }
    }
    frontier = next
  }

  return sorted([...models])
}
