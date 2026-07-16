import { readFileSync } from 'fs'
import { resolve } from 'path'
import ts from 'typescript'
import { ensure, pass } from './internal-auth-verify-harness'

type ContractSources = {
  controller: string
  authModule: string
  localAudit: string
  sharedAudit: string
}

const routes = [
  {
    path: 'admin/phone/transfer/start',
    dto: 'InitialPhoneBindStartDto',
    method: 'start',
    args: ['user.userId', 'dto.currentPassword', 'dto.phone', 'ip', 'dto.deviceId'],
  },
  {
    path: 'admin/phone/transfer/verify',
    dto: 'InitialPhoneBindVerifyDto',
    method: 'verify',
    args: ['user.userId', 'dto.bindTicket', 'dto.code'],
  },
  {
    path: 'admin/phone/transfer/cancel',
    dto: 'InitialPhoneBindCancelDto',
    method: 'cancel',
    args: ['user.userId', 'dto.bindTicket'],
  },
] as const

const auditActions = [
  'auth.phone_transfer_start',
  'auth.phone_transfer_complete',
  'auth.phone_transfer_cancel',
  'auth.phone_released_by_admin',
] as const

function loadSources(): ContractSources {
  return {
    controller: readFileSync(resolve(__dirname, '../../src/auth/auth.controller.ts'), 'utf8'),
    authModule: readFileSync(resolve(__dirname, '../../src/auth/auth.module.ts'), 'utf8'),
    localAudit: readFileSync(resolve(__dirname, '../../src/audit/audit.types.ts'), 'utf8'),
    sharedAudit: readFileSync(resolve(__dirname, '../../../../packages/shared/src/types/audit.ts'), 'utf8'),
  }
}

function parseSource(fileName: string, source: string): ts.SourceFile {
  return ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
}

function classNamed(source: ts.SourceFile, name: string): ts.ClassDeclaration | undefined {
  return source.statements.find(
    (statement): statement is ts.ClassDeclaration =>
      ts.isClassDeclaration(statement) && statement.name?.text === name,
  )
}

function decoratorCall(node: ts.Node, name: string): ts.CallExpression | undefined {
  if (!ts.canHaveDecorators(node)) return undefined
  return ts.getDecorators(node)?.map((decorator) => decorator.expression).find(
    (expression): expression is ts.CallExpression =>
      ts.isCallExpression(expression) && ts.isIdentifier(expression.expression) && expression.expression.text === name,
  )
}

function expressionPath(expression: ts.Expression): string | null {
  if (expression.kind === ts.SyntaxKind.ThisKeyword) return 'this'
  if (ts.isIdentifier(expression)) return expression.text
  if (!ts.isPropertyAccessExpression(expression)) return null
  const parent = expressionPath(expression.expression)
  return parent ? `${parent}.${expression.name.text}` : null
}

function propertyName(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text
  return null
}

function propertyInitializer(object: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  const property = object.properties.find(
    (candidate): candidate is ts.PropertyAssignment =>
      ts.isPropertyAssignment(candidate) && propertyName(candidate.name) === name,
  )
  return property?.initializer
}

function numericLiteralValue(expression: ts.Expression | undefined): number | null {
  if (!expression || !ts.isNumericLiteral(expression)) return null
  return Number(expression.getText().replaceAll('_', ''))
}

function hasExactThrottle(method: ts.MethodDeclaration): boolean {
  const throttle = decoratorCall(method, 'Throttle')
  const options = throttle?.arguments[0]
  if (!options || !ts.isObjectLiteralExpression(options)) return false
  const defaults = propertyInitializer(options, 'default')
  if (!defaults || !ts.isObjectLiteralExpression(defaults)) return false
  return (
    numericLiteralValue(propertyInitializer(defaults, 'ttl')) === 60_000 &&
    numericLiteralValue(propertyInitializer(defaults, 'limit')) === 5
  )
}

function hasExactDecoratorArguments(method: ts.MethodDeclaration): boolean {
  const guards = decoratorCall(method, 'UseGuards')
  const roles = decoratorCall(method, 'Roles')
  return (
    guards?.arguments.map(expressionPath).join(',') === 'JwtAuthGuard,RolesGuard' &&
    roles?.arguments.length === 1 &&
    ts.isStringLiteral(roles.arguments[0]!) &&
    roles.arguments[0].text === 'admin' &&
    hasExactThrottle(method)
  )
}

function dtoTypeName(method: ts.MethodDeclaration): string | null {
  const dto = method.parameters.find(
    (parameter) => ts.isIdentifier(parameter.name) && parameter.name.text === 'dto',
  )
  if (!dto?.type || !ts.isTypeReferenceNode(dto.type) || !ts.isIdentifier(dto.type.typeName)) return null
  return dto.type.typeName.text
}

function delegatesExactly(method: ts.MethodDeclaration, serviceMethod: string, args: readonly string[]): boolean {
  if (!method.body || method.body.statements.length !== 1) return false
  const statement = method.body.statements[0]
  if (!statement || !ts.isReturnStatement(statement) || !statement.expression) return false
  const responseCall = statement.expression
  if (
    !ts.isCallExpression(responseCall) ||
    expressionPath(responseCall.expression) !== 'ApiResponse.ok' ||
    responseCall.arguments.length !== 1
  ) {
    return false
  }
  const awaited = responseCall.arguments[0]
  if (!awaited || !ts.isAwaitExpression(awaited) || !ts.isCallExpression(awaited.expression)) return false
  const serviceCall = awaited.expression
  return (
    expressionPath(serviceCall.expression) === `this.adminPhoneTransferService.${serviceMethod}` &&
    serviceCall.arguments.map(expressionPath).join(',') === args.join(',')
  )
}

function postPath(method: ts.MethodDeclaration): string | null {
  const post = decoratorCall(method, 'Post')
  const path = post?.arguments[0]
  return path && ts.isStringLiteral(path) ? path.text : null
}

function validateRoutesAndConstructor(sourceText: string): string[] {
  const failures: string[] = []
  const source = parseSource('auth.controller.ts', sourceText)
  const controller = classNamed(source, 'AuthController')
  if (!controller) return ['AuthController AST 缺失']

  for (const route of routes) {
    const matches = controller.members.filter(
      (member): member is ts.MethodDeclaration => ts.isMethodDeclaration(member) && postPath(member) === route.path,
    )
    const method = matches[0]
    if (
      matches.length !== 1 ||
      !method ||
      !hasExactDecoratorArguments(method) ||
      dtoTypeName(method) !== route.dto ||
      !delegatesExactly(method, route.method, route.args)
    ) {
      failures.push(`${route.path} AST 未保持 path/Admin guards/限流/DTO/单一服务委派`)
    }
  }

  const constructor = controller.members.find(ts.isConstructorDeclaration)
  const injected = constructor?.parameters.find(
    (parameter) => ts.isIdentifier(parameter.name) && parameter.name.text === 'adminPhoneTransferService',
  )
  const modifiers = new Set(injected?.modifiers?.map((modifier) => modifier.kind) ?? [])
  if (
    !injected?.type ||
    !ts.isTypeReferenceNode(injected.type) ||
    !ts.isIdentifier(injected.type.typeName) ||
    injected.type.typeName.text !== 'AdminPhoneTransferService' ||
    !modifiers.has(ts.SyntaxKind.PrivateKeyword) ||
    !modifiers.has(ts.SyntaxKind.ReadonlyKeyword)
  ) {
    failures.push('AuthController constructor AST 缺少 private readonly AdminPhoneTransferService DI')
  }
  return failures
}

function validateModule(sourceText: string): string[] {
  const source = parseSource('auth.module.ts', sourceText)
  const authModule = classNamed(source, 'AuthModule')
  const metadata = authModule ? decoratorCall(authModule, 'Module')?.arguments[0] : undefined
  if (!metadata || !ts.isObjectLiteralExpression(metadata)) return ['AuthModule @Module AST 缺失']
  const providers = propertyInitializer(metadata, 'providers')
  if (!providers || !ts.isArrayLiteralExpression(providers)) return ['AuthModule providers AST 缺失']
  return providers.elements.some(
    (provider) => ts.isIdentifier(provider) && provider.text === 'AdminPhoneTransferService',
  )
    ? []
    : ['AuthModule providers AST 缺少 AdminPhoneTransferService']
}

function auditActionSet(sourceText: string, label: string): { actions: Set<string>; failures: string[] } {
  const source = parseSource(`${label}-audit.ts`, sourceText)
  const aliases = source.statements.filter(
    (statement): statement is ts.TypeAliasDeclaration =>
      ts.isTypeAliasDeclaration(statement) && statement.name.text === 'AuditAction',
  )
  if (aliases.length !== 1) return { actions: new Set(), failures: [`${label} AuditAction AST 数量不是 1`] }
  const alias = aliases[0]!
  const members = ts.isUnionTypeNode(alias.type) ? alias.type.types : [alias.type]
  const literals = members.filter(
    (member): member is ts.LiteralTypeNode =>
      ts.isLiteralTypeNode(member) && ts.isStringLiteral(member.literal),
  )
  if (literals.length !== members.length) {
    return { actions: new Set(), failures: [`${label} AuditAction 不是纯 string literal union`] }
  }
  return {
    actions: new Set(literals.map((member) => (member.literal as ts.StringLiteral).text)),
    failures: [],
  }
}

function validateAuditActions(localText: string, sharedText: string): string[] {
  const local = auditActionSet(localText, 'API')
  const shared = auditActionSet(sharedText, 'shared')
  const failures = [...local.failures, ...shared.failures]
  for (const [label, actions] of [['API', local.actions], ['shared', shared.actions]] as const) {
    const missing = auditActions.filter((action) => !actions.has(action))
    if (missing.length > 0) failures.push(`${label} AuditAction AST 缺少 ${missing.join(', ')}`)
  }
  const localOnly = [...local.actions].filter((action) => !shared.actions.has(action))
  const sharedOnly = [...shared.actions].filter((action) => !local.actions.has(action))
  if (localOnly.length > 0 || sharedOnly.length > 0) {
    failures.push(`API/shared AuditAction union 不一致：API-only=${localOnly.join(',')} shared-only=${sharedOnly.join(',')}`)
  }
  return failures
}

function validateSources(sources: ContractSources): string[] {
  return [
    ...validateRoutesAndConstructor(sources.controller),
    ...validateModule(sources.authModule),
    ...validateAuditActions(sources.localAudit, sources.sharedAudit),
  ]
}

function commentRouteFragment(source: string, path: string, fragment: string): string {
  const routeStart = source.indexOf(`@Post('${path}')`)
  ensure(routeStart >= 0, `20m. mutation fixture 缺少路由 ${path}`)
  const nextRoute = source.indexOf('\n  @Post(', routeStart + 1)
  const routeEnd = nextRoute < 0 ? source.length : nextRoute
  const block = source.slice(routeStart, routeEnd)
  ensure(block.includes(fragment), `20m. mutation fixture 缺少片段 ${fragment}`)
  return `${source.slice(0, routeStart)}${block.replace(fragment, `// ${fragment}`)}${source.slice(routeEnd)}`
}

function assertCommentMutationsRejected(sources: ContractSources): void {
  const cases: Array<[string, ContractSources]> = [
    ['Guard', { ...sources, controller: commentRouteFragment(sources.controller, routes[0].path, '@UseGuards(JwtAuthGuard, RolesGuard)') }],
    ['Roles', { ...sources, controller: commentRouteFragment(sources.controller, routes[1].path, "@Roles('admin')") }],
    ['Throttle', { ...sources, controller: commentRouteFragment(sources.controller, routes[2].path, '@Throttle({ default: { ttl: 60_000, limit: 5 } })') }],
    ['module provider', { ...sources, authModule: sources.authModule.replace('    AdminPhoneTransferService,', '    // AdminPhoneTransferService,') }],
    ['API AuditAction', { ...sources, localAudit: sources.localAudit.replace("  | 'auth.phone_transfer_start'", "  // | 'auth.phone_transfer_start'") }],
    ['shared AuditAction', { ...sources, sharedAudit: sources.sharedAudit.replace("  | 'auth.phone_transfer_start'", "  // | 'auth.phone_transfer_start'") }],
  ]
  for (const [label, mutated] of cases) {
    ensure(validateSources(mutated).length > 0, `20m. ${label} 仅注释 mutation 被静态门禁误放行`)
  }
  pass('20m. Guard/Roles/Throttle、provider 与双 AuditAction 注释 mutation 均被拒绝')
}

export function assertAdminPhoneTransferRouteDiAuditContract(): void {
  const sources = loadSources()
  const failures = validateSources(sources)
  ensure(failures.length === 0, `20. 路由/DI/审计静态契约失败：${failures.join('；')}`)
  assertCommentMutationsRejected(sources)
  pass('20. 三条 Admin 转移路由仅委派独立服务，DI 与四类审计动作同步登记')
}
