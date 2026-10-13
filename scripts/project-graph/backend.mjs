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

const CONTROLLER_DECORATOR_PATTERN = /@Controller\s*\(\s*(?:['"`]([^'"`]*)['"`])?\s*\)/g
// TS 语法里装饰器和 class 之间只能隔着别的装饰器，所以 @Controller 后面第一个 class
// 声明就是它装饰的类。带不带 export 都认：控制器写成 `class X` 再 `export { X }` 时，
// 只认 `export class` 会落到后面别的类上 —— 正是 locateControllers 要修的那种错。
const CLASS_DECLARATION_PATTERN = /\b(?:export\s+(?:default\s+)?)?(?:abstract\s+)?class\s+([\w$]+)/g
const HTTP_DECORATOR_PATTERN =
  /@(Get|Post|Put|Patch|Delete|All|Head|Options)\s*\(\s*(?:['"`]([^'"`]*)['"`])?\s*\)/g

function rolesIn(text) {
  return sorted(
    [...text.matchAll(/@Roles\(([^)]*)\)/g)].flatMap((m) =>
      m[1].split(',').map((r) => r.trim().replace(/['"`]/g, '')),
    ),
  )
}

/**
 * 文件里每个 @Controller 各自定位它装饰的类：类名、路由前缀、构造器注入表、类级角色。
 *
 * 不能取「文件里第一个 export class / 第一个 constructor」。2026-10-13 实测三种错：
 *   - 入参 DTO 写在控制器前面（advisor、job-fit、mock-interview 等），端点全记在 DTO 名下；
 *   - 一个文件两个控制器（member-privacy、job-materials 等），第二个控制器的端点被记成
 *     第一个的路由前缀、类名和注入表 —— `GET /me/data-requests` 在图谱里成了
 *     `GET /me/ai-consents`，按真实路径反而查不到；
 *   - 类级角色原来取「@Controller 后 400 字」，类上没写 @Roles 时会吃进第一个方法的
 *     @Roles('admin')，同类里没写 @Roles 的终端接口于是被记成要 admin。
 *
 * 所以：到下一个 @Controller 之前都算本控制器的地盘；类名取装饰器后第一个 class 声明，
 * 构造器只在那个类体里找，类级角色只看类体开始之前的装饰器。类或类体找不到时保持原来的
 * 兜底：类名退回文件名，构造器在地盘里找，角色仍按「装饰器后 400 字」。
 */
function locateControllers(text, file) {
  const decorators = [...text.matchAll(CONTROLLER_DECORATOR_PATTERN)]
  const controllers = []

  decorators.forEach((decorator, k) => {
    const decoratorEnd = decorator.index + decorator[0].length
    const limit = k + 1 < decorators.length ? decorators[k + 1].index : text.length
    // @UseGuards / @Roles 也可能写在 @Controller 前面，所以从上一个控制器的类体结束处算起
    const regionStart = k === 0 ? 0 : controllers[k - 1].end

    CLASS_DECLARATION_PATTERN.lastIndex = decoratorEnd
    const declaration = CLASS_DECLARATION_PATTERN.exec(text)
    const declared = declaration !== null && declaration.index < limit
    const bodyOpen = declared ? text.indexOf('{', declaration.index + declaration[0].length) : -1
    const hasBody = bodyOpen !== -1 && bodyOpen < limit
    const bodyClose = hasBody ? Math.min(matchBrace(text, bodyOpen), limit - 1) : -1

    // 构造器注入：属性名 → 类名
    const injections = new Map()
    const ctorScope = hasBody
      ? text.slice(bodyOpen, bodyClose + 1)
      : text.slice(decoratorEnd, limit)
    const ctorMatch = /constructor\s*\(([\s\S]*?)\)\s*\{/.exec(ctorScope)
    if (ctorMatch) {
      for (const [, prop, type] of ctorMatch[1].matchAll(
        /(?:private|public|protected|readonly|\s)+([\w$]+)\s*:\s*([\w$]+)/g,
      )) {
        injections.set(prop, type)
      }
    }

    controllers.push({
      start: decorator.index,
      end: hasBody ? bodyClose + 1 : decoratorEnd,
      className: declared ? declaration[1] : path.posix.basename(file),
      prefix: decorator[1] ?? '',
      injections,
      // 类级守卫 / 角色
      roles: rolesIn(
        text.slice(regionStart, hasBody ? bodyOpen : Math.min(decorator.index + 400, limit)),
      ),
    })
  })

  return controllers
}

/** 端点归它前面最近的那个 @Controller。 */
function controllerAt(controllers, index) {
  let owner = controllers[0]
  for (const controller of controllers) {
    if (controller.start < index) owner = controller
  }
  return owner
}

/** 解析一个 controller 文件，返回 { file, controllers[], endpoints[], classFiles } */
export function parseController(file, fileSet) {
  return parseControllerSource(file, readText(file), fileSet)
}

/** 同 parseController，但源码由调用方给（解析器自检用夹具，不读盘）。 */
export function parseControllerSource(file, source, fileSet) {
  const text = stripComments(source)
  if (!text) return null

  const controllers = locateControllers(text, file)
  if (controllers.length === 0) return null

  const endpoints = []
  HTTP_DECORATOR_PATTERN.lastIndex = 0
  let match
  while ((match = HTTP_DECORATOR_PATTERN.exec(text)) !== null) {
    const method = match[1].toUpperCase()
    const subPath = match[2] ?? ''
    const owner = controllerAt(controllers, match.index)

    // 装饰器之后到方法体：跳过其余装饰器，抓方法名和方法体
    const after = text.slice(match.index + match[0].length)
    const sigMatch = /(?:@[\w$]+\s*\([\s\S]*?\)\s*)*?\s*(?:async\s+)?([\w$]+)\s*\(/.exec(after)
    const handler = sigMatch ? sigMatch[1] : '(unknown)'

    const bodyOpen = after.indexOf('{', sigMatch ? sigMatch.index + sigMatch[0].length : 0)
    const body = bodyOpen === -1 ? '' : after.slice(bodyOpen, matchBrace(after, bodyOpen) + 1)

    // 装饰器与方法之间的 @Roles（方法级）
    const between = sigMatch ? after.slice(0, sigMatch.index + sigMatch[0].length) : ''
    const methodRoles = rolesIn(between)

    const calledServices = sorted(
      [...body.matchAll(/this\.([\w$]+)\.[\w$]+\s*\(/g)]
        .map((m) => owner.injections.get(m[1]))
        .filter(Boolean),
    )

    endpoints.push({
      method,
      path: joinApiPath(API_GLOBAL_PREFIX.slice(1), owner.prefix, subPath),
      handler: `${owner.className}.${handler}`,
      roles: methodRoles.length > 0 ? methodRoles : owner.roles,
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
    controllers: controllers.map(({ className, prefix }) => ({ className, prefix })),
    endpoints: endpoints.sort((a, b) =>
      a.path === b.path ? a.method.localeCompare(b.method) : a.path < b.path ? -1 : 1,
    ),
    classFiles,
  }
}

// ---------------------------------------------------------------------------
// 解析器自检
// ---------------------------------------------------------------------------
// buildBackend 解析 controller 之前先跑一遍（与 verify-repository-integrity 的
// verifyConflictMarkerDetector 同一做法）：解析器一旦退回「取文件里第一个」，
// `pnpm graph` / `pnpm graph:check` 当场失败，错的归属不会悄悄写进 docs/graph/。
//
// 夹具只放源码、不写文件路径：本文件自己也在门禁路径抽取的范围里，带扩展名的路径
// 字面量会被记成「断言了一个不存在的文件」。

const CONTROLLER_PARSER_FIXTURES = [
  {
    // DTO 带构造器是刻意的：没有它，旧实现取「文件里第一个 constructor」也会碰巧取对，
    // 注入表这一半就测不出回退。
    name: '入参 DTO 写在控制器前面',
    source: `
export class GrantAiConsentDto {
  constructor(readonly scope: string, readonly version: string) {}
}

@Controller('me/ai-consents')
@UseGuards(EndUserAuthGuard)
export class MemberPrivacyController {
  constructor(private readonly privacy: MemberPrivacyService) {}

  @Post()
  grantConsent(@Body() body: GrantAiConsentDto) {
    return this.privacy.grantConsent(body)
  }
}
`,
    expected: [
      {
        method: 'POST',
        path: '/api/v1/me/ai-consents',
        handler: 'MemberPrivacyController.grantConsent',
        roles: [],
        services: ['MemberPrivacyService'],
      },
    ],
  },
  {
    // 第一个类上没写 @Roles、第一个方法写了：终端接口不能跟着变成 admin。
    // 第二个控制器的路由前缀、类名、注入表、类级角色都得是它自己的。
    name: '一个文件两个控制器',
    source: `
@Controller()
export class ContentController {
  constructor(private readonly content: ContentService) {}

  @Get('admin/ad-assets')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  listAssets() {
    return this.content.listAssets()
  }

  @Get('terminals/:terminalId/screensaver')
  getKioskPlaylist(@Param('terminalId') terminalId: string) {
    return this.content.getKioskPlaylist(terminalId)
  }
}

@Controller('partner/screen')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('partner')
export class PartnerScreenUsageController {
  constructor(private readonly usage: ConsoleScreenUsageService) {}

  @Get('usage')
  getPartnerUsage() {
    return this.usage.getPartnerUsage()
  }
}
`,
    expected: [
      {
        method: 'GET',
        path: '/api/v1/admin/ad-assets',
        handler: 'ContentController.listAssets',
        roles: ['admin'],
        services: ['ContentService'],
      },
      {
        method: 'GET',
        path: '/api/v1/partner/screen/usage',
        handler: 'PartnerScreenUsageController.getPartnerUsage',
        roles: ['partner'],
        services: ['ConsoleScreenUsageService'],
      },
      {
        method: 'GET',
        path: '/api/v1/terminals/:terminalId/screensaver',
        handler: 'ContentController.getKioskPlaylist',
        roles: [],
        services: ['ContentService'],
      },
    ],
  },
  {
    // 控制器自己没有构造器（仓库里真有这样的）时，不能去拿后面别的类的构造器：
    // 字段初始化的 logger 不是注入，后面那个类构造器里同名的 logger 也不是它的。
    name: '控制器没有构造器，后面的类有',
    source: `
@Controller('help')
export class HelpController {
  private readonly logger = new Logger(HelpController.name)

  @Get('topics')
  listTopics() {
    this.logger.log('list help topics')
    return HELP_TOPICS
  }
}

export class HelpTopicAuditor {
  constructor(private readonly logger: AuditLogService) {}
}
`,
    expected: [
      {
        method: 'GET',
        path: '/api/v1/help/topics',
        handler: 'HelpController.listTopics',
        roles: [],
        services: [],
      },
    ],
  },
]

/** 不通过就抛错（与 verifyConflictMarkerDetector 一致），调用方不必判返回值。 */
export function verifyControllerParser() {
  for (const fixture of CONTROLLER_PARSER_FIXTURES) {
    const parsed = parseControllerSource('selfcheck.controller.ts', fixture.source, new Set())
    const actual = (parsed?.endpoints ?? []).map(
      ({ method, path: endpointPath, handler, roles, services }) => ({
        method,
        path: endpointPath,
        handler,
        roles,
        services,
      }),
    )
    if (JSON.stringify(actual) !== JSON.stringify(fixture.expected)) {
      throw new Error(
        `controller 解析器自检失败（${fixture.name}）：\n` +
          `  期望 ${JSON.stringify(fixture.expected)}\n` +
          `  实际 ${JSON.stringify(actual)}`,
      )
    }
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
