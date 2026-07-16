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
    parameters: [
      { name: 'user', type: 'AuthedUser', decorator: 'CurrentUser', decoratorArgs: [] },
      { name: 'dto', type: 'InitialPhoneBindStartDto', decorator: 'Body', decoratorArgs: [] },
      { name: 'ip', type: 'string', decorator: 'Ip', decoratorArgs: [] },
    ],
    returnType: 'Promise<ApiResponse<AdminPhoneTransferStartResult>>',
  },
  {
    path: 'admin/phone/transfer/verify',
    dto: 'InitialPhoneBindVerifyDto',
    method: 'verify',
    args: ['user.userId', 'dto.bindTicket', 'dto.code'],
    parameters: [
      { name: 'user', type: 'AuthedUser', decorator: 'CurrentUser', decoratorArgs: [] },
      { name: 'dto', type: 'InitialPhoneBindVerifyDto', decorator: 'Body', decoratorArgs: [] },
    ],
    returnType: 'Promise<ApiResponse<{phoneMasked:string;phoneVerifiedAt:string}>>',
  },
  {
    path: 'admin/phone/transfer/cancel',
    dto: 'InitialPhoneBindCancelDto',
    method: 'cancel',
    args: ['user.userId', 'dto.bindTicket'],
    parameters: [
      { name: 'user', type: 'AuthedUser', decorator: 'CurrentUser', decoratorArgs: [] },
      { name: 'dto', type: 'InitialPhoneBindCancelDto', decorator: 'Body', decoratorArgs: [] },
    ],
    returnType: 'Promise<ApiResponse<{cancelled:true}>>',
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

function decoratorNode(node: ts.Node, name: string): ts.Decorator | undefined {
  if (!ts.canHaveDecorators(node)) return undefined
  return ts.getDecorators(node)?.find(
    (decorator) =>
      ts.isCallExpression(decorator.expression) &&
      ts.isIdentifier(decorator.expression.expression) &&
      decorator.expression.expression.text === name,
  )
}

function decoratorCall(node: ts.Node, name: string): ts.CallExpression | undefined {
  const decorator = decoratorNode(node, name)
  return decorator && ts.isCallExpression(decorator.expression) ? decorator.expression : undefined
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

function entityNamePath(name: ts.EntityName): string {
  return ts.isIdentifier(name) ? name.text : `${entityNamePath(name.left)}.${name.right.text}`
}

function typeFingerprint(type: ts.TypeNode | undefined): string | null {
  if (!type) return null
  if (ts.isTypeReferenceNode(type)) {
    const args = type.typeArguments?.map(typeFingerprint) ?? []
    if (args.some((argument) => argument === null)) return null
    return `${entityNamePath(type.typeName)}${args.length > 0 ? `<${args.join(',')}>` : ''}`
  }
  if (ts.isTypeLiteralNode(type)) {
    const members = type.members.map((member) => {
      if (!ts.isPropertySignature(member) || !member.name) return null
      const name = propertyName(member.name)
      const value = typeFingerprint(member.type)
      return name && value && !member.questionToken ? `${name}:${value}` : null
    })
    return members.some((member) => member === null) ? null : `{${members.join(';')}}`
  }
  if (ts.isLiteralTypeNode(type)) {
    if (type.literal.kind === ts.SyntaxKind.TrueKeyword) return 'true'
    if (type.literal.kind === ts.SyntaxKind.FalseKeyword) return 'false'
    if (ts.isStringLiteral(type.literal)) return JSON.stringify(type.literal.text)
    return null
  }
  const keywordTypes = new Map<ts.SyntaxKind, string>([
    [ts.SyntaxKind.StringKeyword, 'string'],
    [ts.SyntaxKind.NumberKeyword, 'number'],
    [ts.SyntaxKind.BooleanKeyword, 'boolean'],
    [ts.SyntaxKind.UnknownKeyword, 'unknown'],
  ])
  return keywordTypes.get(type.kind) ?? null
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

function decoratorArgument(expression: ts.Expression): string | null {
  if (ts.isStringLiteral(expression)) return JSON.stringify(expression.text)
  return expressionPath(expression)
}

function parametersMatch(
  method: ts.MethodDeclaration,
  expected: readonly {
    name: string
    type: string
    decorator: string
    decoratorArgs: readonly string[]
  }[],
): boolean {
  if (method.parameters.length !== expected.length) return false
  return expected.every((contract, index) => {
    const parameter = method.parameters[index]
    if (!parameter || !ts.isIdentifier(parameter.name) || parameter.name.text !== contract.name) return false
    const decorators = ts.canHaveDecorators(parameter) ? ts.getDecorators(parameter) ?? [] : []
    const call = decoratorCall(parameter, contract.decorator)
    return (
      decorators.length === 1 &&
      typeFingerprint(parameter.type) === contract.type &&
      call?.arguments.map(decoratorArgument).join(',') === contract.decoratorArgs.join(',')
    )
  })
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
      !delegatesExactly(method, route.method, route.args) ||
      !parametersMatch(method, route.parameters) ||
      typeFingerprint(method.type) !== route.returnType
    ) {
      failures.push(`${route.path} AST 未保持 path/guards/参数 decorators/DTO/返回类型/单一服务委派`)
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
  const failures: string[] = []
  const source = parseSource('auth.module.ts', sourceText)
  const authModule = classNamed(source, 'AuthModule')
  const metadata = authModule ? decoratorCall(authModule, 'Module')?.arguments[0] : undefined
  if (!metadata || !ts.isObjectLiteralExpression(metadata)) return ['AuthModule @Module AST 缺失']
  const imports = propertyInitializer(metadata, 'imports')
  const providers = propertyInitializer(metadata, 'providers')
  if (!imports || !ts.isArrayLiteralExpression(imports)) failures.push('AuthModule imports AST 缺失')
  if (!providers || !ts.isArrayLiteralExpression(providers)) failures.push('AuthModule providers AST 缺失')
  if (failures.length > 0) return failures

  const imported = new Set(
    (imports as ts.ArrayLiteralExpression).elements
      .filter((element): element is ts.Identifier => ts.isIdentifier(element))
      .map((element) => element.text),
  )
  const provided = new Set(
    (providers as ts.ArrayLiteralExpression).elements
      .filter((element): element is ts.Identifier => ts.isIdentifier(element))
      .map((element) => element.text),
  )
  const missingImports = ['PrismaModule', 'RedisModule', 'AuditModule'].filter((name) => !imported.has(name))
  const missingProviders = ['InternalOtpService', 'AdminPhoneTransferService'].filter((name) => !provided.has(name))
  if (missingImports.length > 0) failures.push(`AuthModule imports AST 缺少 ${missingImports.join(', ')}`)
  if (missingProviders.length > 0) failures.push(`AuthModule providers AST 缺少 ${missingProviders.join(', ')}`)
  return failures
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

function replaceNodeSpan(sourceText: string, source: ts.SourceFile, node: ts.Node, replacement: string): string {
  const start = node.getStart(source)
  return `${sourceText.slice(0, start)}${replacement}${sourceText.slice(node.end)}`
}

function routeMethod(source: ts.SourceFile, path: string): ts.MethodDeclaration | undefined {
  return classNamed(source, 'AuthController')?.members.find(
    (member): member is ts.MethodDeclaration => ts.isMethodDeclaration(member) && postPath(member) === path,
  )
}

function commentDecorator(sourceText: string, path: string, decoratorName: string, parameterName?: string): string {
  const source = parseSource('auth.controller.mutation.ts', sourceText)
  const method = routeMethod(source, path)
  const target = parameterName
    ? method?.parameters.find(
        (parameter) => ts.isIdentifier(parameter.name) && parameter.name.text === parameterName,
      )
    : method
  const decorator = target ? decoratorNode(target, decoratorName) : undefined
  ensure(decorator, `20m. mutation fixture 缺少 ${path} ${parameterName ?? 'method'} @${decoratorName}`)
  const original = decorator.getText(source)
  return replaceNodeSpan(sourceText, source, decorator, `/* ${original} */`)
}

function mutateModuleArrayIdentifier(sourceText: string, property: string, identifier: string): string {
  const source = parseSource('auth.module.mutation.ts', sourceText)
  const authModule = classNamed(source, 'AuthModule')
  const metadata = authModule ? decoratorCall(authModule, 'Module')?.arguments[0] : undefined
  ensure(metadata && ts.isObjectLiteralExpression(metadata), '20m. mutation fixture 缺少 AuthModule metadata')
  const array = propertyInitializer(metadata, property)
  ensure(array && ts.isArrayLiteralExpression(array), `20m. mutation fixture 缺少 AuthModule ${property}`)
  const element = array.elements.find((candidate) => ts.isIdentifier(candidate) && candidate.text === identifier)
  ensure(element, `20m. mutation fixture 缺少 AuthModule ${property}.${identifier}`)
  return replaceNodeSpan(sourceText, source, element, `/* removed ${identifier} */`)
}

function mutateReturnType(sourceText: string, path: string): string {
  const source = parseSource('auth.controller.return-mutation.ts', sourceText)
  const type = routeMethod(source, path)?.type
  ensure(type, `20m. mutation fixture 缺少 ${path} return type`)
  return replaceNodeSpan(sourceText, source, type, 'unknown')
}

function auditActionLiteralNode(
  sourceText: string,
  fileName: string,
  action: string,
): { source: ts.SourceFile; node: ts.LiteralTypeNode } {
  const source = parseSource(fileName, sourceText)
  const alias = source.statements.find(
    (statement): statement is ts.TypeAliasDeclaration =>
      ts.isTypeAliasDeclaration(statement) && statement.name.text === 'AuditAction',
  )
  ensure(alias && ts.isUnionTypeNode(alias.type), `20q. ${fileName} mutation fixture 缺少 AuditAction union`)
  const node = alias.type.types.find(
    (member): member is ts.LiteralTypeNode =>
      ts.isLiteralTypeNode(member) && ts.isStringLiteral(member.literal) && member.literal.text === action,
  )
  ensure(node, `20q. ${fileName} mutation fixture 缺少 ${action}`)
  return { source, node }
}

function formatAuditActionWithDoubleQuotes(sourceText: string, fileName: string, action: string): string {
  const { source, node } = auditActionLiteralNode(sourceText, fileName, action)
  return replaceNodeSpan(sourceText, source, node, `\n    "${action}"`)
}

function mutateAuditAction(sourceText: string, action: string): string {
  const { source, node } = auditActionLiteralNode(sourceText, 'audit-action-mutation.ts', action)
  return replaceNodeSpan(sourceText, source, node, `/* removed ${action} */ never`)
}

function assertCommentMutationsRejected(sources: ContractSources): void {
  const cases: Array<[string, ContractSources]> = [
    ['Guard', { ...sources, controller: commentDecorator(sources.controller, routes[0].path, 'UseGuards') }],
    ['Roles', { ...sources, controller: commentDecorator(sources.controller, routes[1].path, 'Roles') }],
    ['Throttle', { ...sources, controller: commentDecorator(sources.controller, routes[2].path, 'Throttle') }],
    ['AdminPhoneTransferService provider', { ...sources, authModule: mutateModuleArrayIdentifier(sources.authModule, 'providers', 'AdminPhoneTransferService') }],
    ['PrismaModule import', { ...sources, authModule: mutateModuleArrayIdentifier(sources.authModule, 'imports', 'PrismaModule') }],
    ['RedisModule import', { ...sources, authModule: mutateModuleArrayIdentifier(sources.authModule, 'imports', 'RedisModule') }],
    ['AuditModule import', { ...sources, authModule: mutateModuleArrayIdentifier(sources.authModule, 'imports', 'AuditModule') }],
    ['InternalOtpService provider', { ...sources, authModule: mutateModuleArrayIdentifier(sources.authModule, 'providers', 'InternalOtpService') }],
    ['start CurrentUser', { ...sources, controller: commentDecorator(sources.controller, routes[0].path, 'CurrentUser', 'user') }],
    ['start Body', { ...sources, controller: commentDecorator(sources.controller, routes[0].path, 'Body', 'dto') }],
    ['start Ip', { ...sources, controller: commentDecorator(sources.controller, routes[0].path, 'Ip', 'ip') }],
    ['verify CurrentUser', { ...sources, controller: commentDecorator(sources.controller, routes[1].path, 'CurrentUser', 'user') }],
    ['verify Body', { ...sources, controller: commentDecorator(sources.controller, routes[1].path, 'Body', 'dto') }],
    ['cancel CurrentUser', { ...sources, controller: commentDecorator(sources.controller, routes[2].path, 'CurrentUser', 'user') }],
    ['cancel Body', { ...sources, controller: commentDecorator(sources.controller, routes[2].path, 'Body', 'dto') }],
    ['start return type', { ...sources, controller: mutateReturnType(sources.controller, routes[0].path) }],
    ['verify return type', { ...sources, controller: mutateReturnType(sources.controller, routes[1].path) }],
    ['cancel return type', { ...sources, controller: mutateReturnType(sources.controller, routes[2].path) }],
    ['API AuditAction', { ...sources, localAudit: mutateAuditAction(sources.localAudit, auditActions[0]) }],
    ['shared AuditAction', { ...sources, sharedAudit: mutateAuditAction(sources.sharedAudit, auditActions[0]) }],
  ]
  for (const [label, mutated] of cases) {
    ensure(validateSources(mutated).length > 0, `20m. ${label} mutation 被静态门禁误放行`)
  }
  pass('20m. 路由/参数 decorators、DI imports/providers、返回类型与双 AuditAction mutation 均被拒绝')
}

function assertAuditFormattingMutationSelfCheck(sources: ContractSources): void {
  const formatted = {
    ...sources,
    localAudit: formatAuditActionWithDoubleQuotes(sources.localAudit, 'API-audit-format.ts', auditActions[0]),
    sharedAudit: formatAuditActionWithDoubleQuotes(sources.sharedAudit, 'shared-audit-format.ts', auditActions[0]),
  }
  ensure(validateSources(formatted).length === 0, '20q. 等价双引号 AuditAction 主契约被错误拒绝')
  ensure(
    validateSources({ ...formatted, localAudit: mutateAuditAction(formatted.localAudit, auditActions[0]) }).length > 0,
    '20q. API 双引号 AuditAction mutation 被误放行',
  )
  ensure(
    validateSources({ ...formatted, sharedAudit: mutateAuditAction(formatted.sharedAudit, auditActions[0]) }).length > 0,
    '20q. shared 双引号 AuditAction mutation 被误放行',
  )
  pass('20q. API/shared AuditAction 等价双引号格式有效且 mutation 仍被拒绝')
}

export function assertAdminPhoneTransferRouteDiAuditContract(): void {
  const sources = loadSources()
  const failures = validateSources(sources)
  ensure(failures.length === 0, `20. 路由/DI/审计静态契约失败：${failures.join('；')}`)
  assertCommentMutationsRejected(sources)
  assertAuditFormattingMutationSelfCheck(sources)
  pass('20. 三条 Admin 转移路由仅委派独立服务，DI 与四类审计动作同步登记')
}
