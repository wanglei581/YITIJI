/**
 * Stage 2A 匿名 parse 岗位匹配授权门禁（RED-first）。
 *
 * 覆盖：
 * 1. 双 Prisma schema、JobFitController 路由/令牌边界、MemberPrivacyController 隔离；
 * 2. JobFitService 的匿名 parse 归属裁决（无 payload）与 consent API 调用契约。
 *
 * 运行：pnpm --filter @ai-job-print/api verify:job-fit-governance
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { JobFitController } from '../src/ai/job-fit.controller'
import { JobFitService } from '../src/ai/resume/job-fit.service'

const API_ROOT = join(__dirname, '..')
const PAYLOAD_SENTINEL = 'RESUME_PAYLOAD_MUST_NOT_LEAK'

let failed = 0
let passed = 0

function pass(message: string): void {
  passed += 1
  console.log(`  PASS ${message}`)
}

function fail(message: string): void {
  failed += 1
  console.error(`  FAIL ${message}`)
}

function check(condition: unknown, message: string): void {
  if (condition) pass(message)
  else fail(message)
}

function read(rel: string): string {
  const absolute = join(API_ROOT, rel)
  if (!existsSync(absolute)) {
    fail(`缺少受检文件: ${rel}`)
    return ''
  }
  return readFileSync(absolute, 'utf8')
}

function prismaModel(source: string, modelName: string): string {
  const start = source.indexOf(`model ${modelName} {`)
  if (start < 0) return ''
  const end = source.indexOf('\n}', start)
  return end < 0 ? '' : source.slice(start, end + 2)
}

function indexOfRequired(source: string, marker: string, label: string): number {
  const index = source.indexOf(marker)
  check(index >= 0, label)
  return index
}

function blockFromOpenBrace(source: string, openBrace: number): string {
  let depth = 0
  for (let index = openBrace; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    if (source[index] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(openBrace, index + 1)
    }
  }
  return ''
}

function decoratedHandler(source: string, decorator: string): string {
  const decoratorIndex = source.indexOf(decorator)
  if (decoratorIndex < 0) return ''
  const methodMatch = /\n\s*(?:async\s+)?[A-Za-z_$][\w$]*\s*\(/g
  methodMatch.lastIndex = decoratorIndex + decorator.length
  const match = methodMatch.exec(source)
  if (!match) return ''
  const openBrace = source.indexOf('{', match.index + match[0].length)
  return openBrace < 0 ? '' : source.slice(match.index, openBrace) + blockFromOpenBrace(source, openBrace)
}

function decoratedHandlerName(source: string, decorator: string): string | null {
  const handler = decoratedHandler(source, decorator)
  const match = handler.match(/\n\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(/)
  return match?.[1] ?? null
}

function anonymousConsentGuardNames(source: string, marker: string): string[] {
  const method = /(?:function\s+|(?:private|protected|public)\s+)(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::[^\n{]+)?\{/g
  const names: string[] = []
  for (const match of source.matchAll(method)) {
    const openBrace = match.index + match[0].lastIndexOf('{')
    const body = blockFromOpenBrace(source, openBrace)
    if (body.includes(marker) && /\bauthorization\b/i.test(body) && body.includes('x-resume-access-token')) {
      names.push(match[1])
    }
  }
  return names
}

function firstIndexOfAny(source: string, patterns: RegExp[]): number {
  const indexes = patterns.map((pattern) => source.search(pattern)).filter((index) => index >= 0)
  return indexes.length > 0 ? Math.min(...indexes) : -1
}

function assertConsentHandlerGuard(
  controller: string,
  decorator: string,
  label: string,
  guardNames: string[],
): void {
  const handler = decoratedHandler(controller, decorator)
  check(handler.length > 0, `${label}: handler 存在`)
  check(handler.length > 0 && !/\bauthorization\b/i.test(handler), `${label}: handler 不直接读取 Authorization`)
  const protectedCall = firstIndexOfAny(handler, [/this\.service\./, /(?:this\.)?authorizeParseForJobFit\s*\(/])
  check(protectedCall >= 0, `${label}: handler 调用 JobFitService / authorizer`)
  const guardCall = firstIndexOfAny(handler, guardNames.flatMap((name) => [new RegExp(`this\\.${name}\\s*\\(`), new RegExp(`\\b${name}\\s*\\(`)]))
  check(guardCall >= 0 && protectedCall > guardCall,
    `${label}: 固定 Bearer 拒绝在任一 service / authorizer 调用前执行`)
}

function assertSchema(source: string, label: string): void {
  const model = prismaModel(source, 'AiResumeResult')
  check(model.length > 0, `${label}: AiResumeResult model 存在`)
  check(/\bjobAiConsentVersion\s+String\?/.test(model), `${label}: jobAiConsentVersion String?`)
  check(/\bjobAiConsentGrantedAt\s+DateTime\?/.test(model), `${label}: jobAiConsentGrantedAt DateTime?`)
  check(/\bjobAiConsentRevokedAt\s+DateTime\?/.test(model), `${label}: jobAiConsentRevokedAt DateTime?`)
}

function migrationSqlFiles(directory: string): string[] {
  const root = join(API_ROOT, directory)
  if (!existsSync(root)) {
    fail(`缺少 migration 目录: ${directory}`)
    return []
  }
  const visit = (current: string): string[] => readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
    const absolute = join(current, entry.name)
    if (entry.isDirectory()) return visit(absolute)
    return entry.isFile() && entry.name.endsWith('.sql') ? [absolute] : []
  })
  return visit(root)
}

function addsAiResumeResultColumn(sql: string, column: string): boolean {
  const table = '(?:"AiResumeResult"|`AiResumeResult`|AiResumeResult)'
  const name = `(?:"${column}"|\`${column}\`|${column}\\b)`
  return new RegExp(`ALTER\\s+TABLE\\s+${table}\\s+ADD\\s+COLUMN\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${name}`, 'i').test(sql)
}

function assertConsentMigration(directory: string, label: string): void {
  const sqlFiles = migrationSqlFiles(directory)
  check(sqlFiles.length > 0, `${label}: migration SQL 文件存在`)
  const columns = ['jobAiConsentVersion', 'jobAiConsentGrantedAt', 'jobAiConsentRevokedAt']
  const migration = sqlFiles.find((file) => {
    const sql = readFileSync(file, 'utf8')
    return columns.every((column) => addsAiResumeResultColumn(sql, column))
  })
  check(!!migration, `${label}: 单个 migration SQL 为 AiResumeResult 添加三个精确 consent 列`)
}

function assertStaticContract(): void {
  const sqliteSchema = read('prisma/schema.prisma')
  const postgresSchema = read('prisma/postgres/schema.prisma')
  const controller = read('src/ai/job-fit.controller.ts')
  const service = read('src/ai/resume/job-fit.service.ts')
  const memberPrivacy = read('src/member-privacy/member-privacy.controller.ts')

  assertSchema(sqliteSchema, 'SQLite schema')
  assertSchema(postgresSchema, 'PostgreSQL schema')
  assertConsentMigration('prisma/migrations', 'SQLite migrations')
  assertConsentMigration('prisma/postgres/migrations', 'PostgreSQL migrations')

  check(controller.includes("@Controller('resume/job-fit')"), 'JobFitController 归属 /resume/job-fit')
  const grantIndex = indexOfRequired(controller, "@Post('consent')", 'POST /resume/job-fit/consent 存在')
  const statusIndex = indexOfRequired(controller, "@Get('consent/:taskId')", 'GET /resume/job-fit/consent/:taskId 存在')
  const revokeIndex = indexOfRequired(controller, "@Delete('consent/:taskId')", 'DELETE /resume/job-fit/consent/:taskId 存在')
  const latestIndex = indexOfRequired(controller, "@Get(':taskId')", '原 GET /resume/job-fit/:taskId 存在')
  check([grantIndex, statusIndex, revokeIndex].every((index) => index >= 0 && index < latestIndex),
    '三个 consent 路由均在 GET /resume/job-fit/:taskId 前（内部顺序不限）')

  const anonymousTokenMarker = 'ANONYMOUS_CONSENT_TOKEN_REQUIRED'
  indexOfRequired(controller, anonymousTokenMarker, 'Bearer 前置拒绝固定错误码存在')
  const guardNames = anonymousConsentGuardNames(controller, anonymousTokenMarker)
  check(guardNames.length > 0, '存在只接受 x-resume-access-token 的匿名 consent token guard')
  assertConsentHandlerGuard(controller, "@Post('consent')", 'POST consent', guardNames)
  assertConsentHandlerGuard(controller, "@Get('consent/:taskId')", 'GET consent status', guardNames)
  assertConsentHandlerGuard(controller, "@Delete('consent/:taskId')", 'DELETE consent', guardNames)

  check(/\bauthorizeParseForJobFit\s*\(/.test(service), 'JobFitService 提供 authorizeParseForJobFit(taskId, requester)')
  check(/\b(?:grant|accept)[A-Za-z]*Consent\s*\(/.test(service), 'JobFitService 提供 grant consent API')
  check(/\b(?:get|status|read)[A-Za-z]*Consent[A-Za-z]*\s*\(/.test(service), 'JobFitService 提供 consent status API')
  check(/\b(?:revoke|withdraw)[A-Za-z]*Consent\s*\(/.test(service), 'JobFitService 提供 revoke consent API')

  check(memberPrivacy.includes("@Controller('me/ai-consents')") && memberPrivacy.includes('@UseGuards(EndUserAuthGuard)'),
    'MemberPrivacyController 仍保持登录态 me/ai-consents guard')
  check(memberPrivacy.includes("@Post(':scope/revoke')"), 'MemberPrivacyController 原会员撤回 API 保持不变')
  check(!memberPrivacy.includes('resume/job-fit') && !memberPrivacy.includes('ANONYMOUS_CONSENT_TOKEN_REQUIRED') && !memberPrivacy.includes('x-resume-access-token'),
    'MemberPrivacyController 未吸收匿名 JobFit consent 路由或 token')
}

interface FakeParseRow {
  endUserId: string | null
  accessTokenHash: string | null
  expiresAt: Date | null
  payloadJson: string
  jobAiConsentVersion?: string | null
  jobAiConsentGrantedAt?: Date | null
  jobAiConsentRevokedAt?: Date | null
}

interface Requester {
  endUserId: string | null
  accessToken: string | null
}

type Authorizer = (taskId: string, requester: Requester) => Promise<Record<string, unknown>>
type ConsentApi = (taskId: string, requester: Requester) => Promise<unknown>

function hash(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

function errorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null
  const response = typeof (error as { getResponse?: unknown }).getResponse === 'function'
    ? (error as { getResponse: () => unknown }).getResponse()
    : null
  if (!response || typeof response !== 'object') return null
  const nested = (response as { error?: unknown }).error
  return nested && typeof nested === 'object' && typeof (nested as { code?: unknown }).code === 'string'
    ? (nested as { code: string }).code
    : null
}

function errorStatus(error: unknown): number | null {
  return error && typeof error === 'object' && typeof (error as { getStatus?: unknown }).getStatus === 'function'
    ? (error as { getStatus: () => number }).getStatus()
    : null
}

async function expectAiTaskNotFound(label: string, action: () => Promise<unknown>): Promise<void> {
  try {
    await action()
    fail(`${label}: 必须拒绝为 AI_TASK_NOT_FOUND 404，实际未抛错`)
  } catch (error) {
    check(errorCode(error) === 'AI_TASK_NOT_FOUND' && errorStatus(error) === 404,
      `${label}: 拒绝统一为 AI_TASK_NOT_FOUND 404`)
  }
}

function findConsentApi(service: object, operation: 'grant' | 'status' | 'revoke'): ConsentApi | null {
  const proto = Object.getPrototypeOf(service) as Record<string, unknown>
  const names = Object.getOwnPropertyNames(proto)
  const verb = operation === 'grant' ? /grant|accept/i : operation === 'status' ? /get|status|read/i : /revoke|withdraw/i
  const name = names.find((candidate) => candidate !== 'constructor' && /consent/i.test(candidate) && verb.test(candidate))
  return name && typeof proto[name] === 'function' ? (proto[name] as ConsentApi).bind(service) : null
}

async function assertControllerBearerRejection(): Promise<void> {
  const controllerSource = read('src/ai/job-fit.controller.ts')
  const serviceCalls: string[] = []
  const serviceSpy = new Proxy({}, {
    get(_target, property) {
      if (typeof property !== 'string') return undefined
      return async () => {
        serviceCalls.push(property)
        throw new Error(`Bearer rejection leaked into JobFitService.${property}`)
      }
    },
  })
  const controller = new JobFitController(serviceSpy as never, {} as never, {} as never) as unknown as Record<string, unknown>
  const bearerRequest = { headers: { authorization: 'Bearer forbidden-for-anonymous-consent' } }
  const handlers: Array<{ decorator: string; label: string; args: unknown[] }> = [
    { decorator: "@Post('consent')", label: 'POST grant', args: [{ taskId: 'bearer-task' }, bearerRequest] },
    { decorator: "@Get('consent/:taskId')", label: 'GET status', args: ['bearer-task', bearerRequest] },
    { decorator: "@Delete('consent/:taskId')", label: 'DELETE revoke', args: ['bearer-task', bearerRequest] },
  ]
  for (const handler of handlers) {
    const methodName = decoratedHandlerName(controllerSource, handler.decorator)
    check(typeof methodName === 'string', `${handler.label}: 可定位 controller handler 以执行 Bearer 门禁`)
    const method = methodName ? controller[methodName] : null
    check(typeof method === 'function', `${handler.label}: runtime controller handler 存在`)
    if (typeof method !== 'function') continue

    serviceCalls.length = 0
    try {
      await (method as (...args: unknown[]) => Promise<unknown>).apply(controller, handler.args)
      fail(`${handler.label}: Bearer 必须抛 ANONYMOUS_CONSENT_TOKEN_REQUIRED，实际未抛错`)
    } catch (error) {
      check(errorCode(error) === 'ANONYMOUS_CONSENT_TOKEN_REQUIRED',
        `${handler.label}: Bearer 抛固定 ANONYMOUS_CONSENT_TOKEN_REQUIRED`)
    }
    check(serviceCalls.length === 0,
      `${handler.label}: Bearer 拒绝时 JobFitService（authorizer/grant/status/revoke）0 次调用`)
  }
}

async function assertRuntimeContract(): Promise<void> {
  await assertControllerBearerRejection()
  const state: { row: FakeParseRow | null } = { row: null }
  const mutate = (data: Record<string, unknown>) => {
    if (!state.row) throw new Error('fake parse row is missing')
    Object.assign(state.row, data)
    return state.row
  }
  const fakePrisma = {
    aiResumeResult: {
      findUnique: async () => state.row,
      findFirst: async () => state.row,
      update: async ({ data }: { data: Record<string, unknown> }) => mutate(data),
      updateMany: async ({ data }: { data: Record<string, unknown> }) => ({ count: mutate(data) ? 1 : 0 }),
    },
  }
  const service = new JobFitService(fakePrisma as never, {} as never, {} as never, {} as never)
  const governed = service as unknown as { authorizeParseForJobFit?: Authorizer }

  check(typeof governed.authorizeParseForJobFit === 'function', '运行时 JobFitService 存在 authorizeParseForJobFit')
  const grant = findConsentApi(service, 'grant')
  const status = findConsentApi(service, 'status')
  const revoke = findConsentApi(service, 'revoke')
  check(typeof grant === 'function', '运行时 consent grant API 存在')
  check(typeof status === 'function', '运行时 consent status API 存在')
  check(typeof revoke === 'function', '运行时 consent revoke API 存在')
  if (typeof governed.authorizeParseForJobFit !== 'function') return
  const authorize = governed.authorizeParseForJobFit.bind(service)
  const validToken = 'anonymous-consent-token'
  const anonymousRequester: Requester = { endUserId: null, accessToken: validToken }
  const future = () => new Date(Date.now() + 60_000)

  state.row = null
  await expectAiTaskNotFound('parse 行不存在', () => authorize('missing-task', anonymousRequester))

  state.row = { endUserId: null, accessTokenHash: hash(validToken), expiresAt: new Date(Date.now() - 1), payloadJson: '{}' }
  await expectAiTaskNotFound('parse TTL 已过期', () => authorize('expired-task', anonymousRequester))

  state.row = { endUserId: null, accessTokenHash: hash(validToken), expiresAt: future(), payloadJson: '{}' }
  await expectAiTaskNotFound('匿名 token 错误', () => authorize('wrong-token-task', { endUserId: null, accessToken: 'wrong-token' }))

  state.row = { endUserId: 'member-a', accessTokenHash: null, expiresAt: future(), payloadJson: '{}' }
  await expectAiTaskNotFound('其他会员归属', () => authorize('other-member-task', { endUserId: 'member-b', accessToken: null }))

  state.row = { endUserId: 'member-a', accessTokenHash: hash(validToken), expiresAt: future(), payloadJson: '{}' }
  await expectAiTaskNotFound('会员 parse 禁止匿名 requester 即使携带 access token', () =>
    authorize('member-anonymous-task', { endUserId: null, accessToken: validToken }))

  state.row = {
    endUserId: null,
    accessTokenHash: hash(validToken),
    expiresAt: future(),
    payloadJson: JSON.stringify({ resumeText: PAYLOAD_SENTINEL }),
    jobAiConsentVersion: null,
    jobAiConsentGrantedAt: null,
    jobAiConsentRevokedAt: null,
  }
  const metadata = await authorize('valid-task', anonymousRequester)
  check(!('payloadJson' in metadata) && !JSON.stringify(metadata).includes(PAYLOAD_SENTINEL),
    'authorizer 成功只返回已校验 parse 元数据，不返回 payload')

  if (!grant || !status || !revoke || !state.row) return

  let authorizerCalls = 0
  governed.authorizeParseForJobFit = async (taskId, requester) => {
    authorizerCalls += 1
    return authorize(taskId, requester)
  }
  const invalidAnonymousCases: Array<{ label: string; row: FakeParseRow | null; requester: Requester }> = [
    {
      label: '无 x-resume-access-token',
      row: { endUserId: null, accessTokenHash: hash(validToken), expiresAt: future(), payloadJson: '{}' },
      requester: { endUserId: null, accessToken: null },
    },
    {
      label: '匿名 parse TTL 已过期',
      row: { endUserId: null, accessTokenHash: hash(validToken), expiresAt: new Date(Date.now() - 1), payloadJson: '{}' },
      requester: anonymousRequester,
    },
    {
      label: '错误 x-resume-access-token',
      row: { endUserId: null, accessTokenHash: hash(validToken), expiresAt: future(), payloadJson: '{}' },
      requester: { endUserId: null, accessToken: 'wrong-token' },
    },
    {
      label: '其他匿名 parse 的 x-resume-access-token',
      row: { endUserId: null, accessTokenHash: hash('other-anonymous-token'), expiresAt: future(), payloadJson: '{}' },
      requester: anonymousRequester,
    },
    {
      label: '会员 parse 禁止匿名 requester 即使携带 access token',
      row: { endUserId: 'member-a', accessTokenHash: hash(validToken), expiresAt: future(), payloadJson: '{}' },
      requester: anonymousRequester,
    },
    { label: '不存在的 task', row: null, requester: anonymousRequester },
  ]
  for (const [name, operation] of [['grant', grant], ['status', status], ['revoke', revoke]] as const) {
    const callsBefore = authorizerCalls
    for (const invalid of invalidAnonymousCases) {
      state.row = invalid.row
      await expectAiTaskNotFound(`${name}: ${invalid.label}`, () => operation('invalid-task', invalid.requester))
    }
    check(authorizerCalls > callsBefore, `${name} 通过 authorizeParseForJobFit 裁决匿名归属`)
  }

  state.row = {
    endUserId: null,
    accessTokenHash: hash(validToken),
    expiresAt: future(),
    payloadJson: JSON.stringify({ resumeText: PAYLOAD_SENTINEL }),
    jobAiConsentVersion: null,
    jobAiConsentGrantedAt: null,
    jobAiConsentRevokedAt: null,
  }

  await grant('valid-task', anonymousRequester)
  check(typeof state.row.jobAiConsentVersion === 'string' && state.row.jobAiConsentVersion.length > 0,
    'grant 为 parse 行写入 consent version')
  check(state.row.jobAiConsentGrantedAt instanceof Date && state.row.jobAiConsentRevokedAt === null,
    'grant 写入 grantedAt 并清除 revokedAt')
  check((await status('valid-task', anonymousRequester)) !== undefined, 'status API 可读取当前 consent 状态')

  await revoke('valid-task', anonymousRequester)
  check(state.row.jobAiConsentRevokedAt instanceof Date, 'revoke 为 parse 行写入 revokedAt')

  await grant('valid-task', anonymousRequester)
  check(state.row.jobAiConsentRevokedAt === null, 'revoke 后 grant 可恢复授权状态')
  const idempotentGrantedAt = state.row.jobAiConsentGrantedAt
  await grant('valid-task', anonymousRequester)
  check(state.row.jobAiConsentGrantedAt === idempotentGrantedAt, '重复 grant 幂等，不重写 grantedAt')
}

async function main(): Promise<void> {
  console.log('\n=== Stage 2A 匿名 JobFit consent 治理门禁 ===')
  assertStaticContract()
  await assertRuntimeContract()

  if (failed > 0) {
    console.error(`\nverify:job-fit-governance RED — ${failed} 个门禁尚未满足（${passed} 个已满足）`)
    process.exitCode = 1
    return
  }
  console.log(`\nverify:job-fit-governance passed — ${passed} checks`)
}

main().catch((error) => {
  console.error('verify:job-fit-governance 环境/脚本错误', error)
  process.exitCode = 1
})
