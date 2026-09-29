/**
 * 内容管线门禁自签的内部令牌，必须和 auth.service.ts::issueLogin 的声明一致。
 *
 * 字段表从这两处源码读出来，不在这里再抄一份。抄一份的话，harness 和表一起改错也会绿。
 * 读失败、aud/iss 多出来或对不上、sub/role/orgId/ver/jti 少了或改名，都抛错，不许静默通过。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { JwtService } from '@nestjs/jwt'

/**
 * 自签令牌只活 15 分钟。
 *
 * 生产登录仍是 `auth.module.ts` 的 `JWT_TTL`（24h）。这里更短，是因为这张令牌
 * 能当内部账号用，而本门禁一次进程就结束：隔离 SQLite、进程内内存 Redis，
 * `verify-content-pipeline-e2e.ts` 里没有 sleep / 轮询。2026-09-29 本机整段实测 48 秒，
 * 15 分钟盖住整段还有余量。若以后实测超过 15 分钟，改成 `1h` 并在这里写明原因，不要改回 24h。
 */
export const HARNESS_INTERNAL_TOKEN_TTL = '15m'
const HARNESS_INTERNAL_TOKEN_TTL_SECONDS = 15 * 60

/** issueLogin 实际写进令牌的声明。audience/issuer 为 null 表示这个声明必须缺省。 */
export interface IssueLoginClaimContract {
  payloadKeys: string[]
  audience: string | null
  issuer: string | null
  /** 生产 signOptions 是否写了 expiresIn。本门禁的寿命单独用 15 分钟,不跟这个值对齐。 */
  hasExpiresIn: boolean
}

const FILLABLE_LOGIN_CLAIMS = new Set(['sub', 'role', 'orgId', 'ver', 'jti'])

/**
 * 从 issueLogin 和 AuthModule 的源码读出发签契约。
 * 不在这里再抄一份字段表:抄一份的话,harness 和表一起改错也会绿。
 * 读失败、字段对不上、出现本函数不会填的声明,都抛错,不许当成「没有 aud」。
 */
export function readIssueLoginClaimContract(): IssueLoginClaimContract {
  const service = readAuthSource('auth.service.ts')
  const moduleSource = readAuthSource('auth.module.ts')
  const body = extractFunctionBody(service.source, 'private async issueLogin(')
  const marker = 'this.jwtService.sign('
  const at = body.indexOf(marker)
  if (at < 0) throw new Error('issueLogin 里找不到 this.jwtService.sign(，无法核对签发结构，拒绝静默通过')
  if (body.indexOf(marker, at + marker.length) >= 0) {
    throw new Error('issueLogin 里有多处 this.jwtService.sign(，无法确定哪一处是登录令牌，拒绝静默通过')
  }
  const call = body.slice(at + marker.length - 1, matchingClose(body, at + marker.length - 1, '(', ')') + 1)
  const args = splitTopLevel(call.slice(1, -1), ',').map((part) => part.trim()).filter((part) => part.length > 0)
  const payloadLiteral = args[0]
  if (!payloadLiteral?.startsWith('{')) {
    throw new Error('issueLogin 的 sign() 第一个参数不是对象字面量，无法核对字段名，拒绝静默通过')
  }
  const payloadProps = parseObjectProps(payloadLiteral)
  const payloadKeys = payloadProps.map((prop) => prop.key)
  if (new Set(payloadKeys).size !== payloadKeys.length) {
    throw new Error('issueLogin 的 sign() 字段名重复，拒绝静默通过')
  }
  if (payloadKeys.length === 0) throw new Error('issueLogin 的 sign() 没有解析出任何字段，拒绝静默通过')

  const moduleOptions = readSignOptions(moduleSource.source, 'auth.module.ts')
  const callOptions = args[1] === undefined ? null : parseObjectProps(args[1])
  if (args.length > 2) throw new Error('issueLogin 的 sign() 参数超过两个，拒绝静默通过')

  const moduleClaims = signOptionClaims(moduleOptions, moduleSource.source, 'AuthModule signOptions')
  const callClaims = callOptions === null ? null : signOptionClaims(callOptions, service.source, 'issueLogin 的 sign() 选项')
  const callKeys = new Set((callOptions ?? []).map((prop) => prop.key))
  let audience = callKeys.has('audience') ? callClaims?.audience ?? null : moduleClaims.audience
  let issuer = callKeys.has('issuer') ? callClaims?.issuer ?? null : moduleClaims.issuer
  if (!callKeys.has('audience') && !moduleOptions.some((prop) => prop.key === 'audience')) {
    audience = registeredClaimFromPayload(payloadProps, 'aud', service.source) ?? audience
  }
  if (!callKeys.has('issuer') && !moduleOptions.some((prop) => prop.key === 'issuer')) {
    issuer = registeredClaimFromPayload(payloadProps, 'iss', service.source) ?? issuer
  }

  for (const key of payloadKeys) {
    if (key === 'aud' || key === 'iss') continue
    if (!FILLABLE_LOGIN_CLAIMS.has(key)) {
      throw new Error(`issueLogin 的 sign() 含有字段 ${key}，本门禁无法确认该怎么填才能与登录令牌一致，拒绝静默通过`)
    }
  }

  return {
    payloadKeys,
    audience,
    issuer,
    hasExpiresIn: moduleClaims.hasExpiresIn || (callClaims?.hasExpiresIn ?? false),
  }
}

export function assertIssuedTokenMatchesIssueLogin(
  token: string,
  user: { id: string; role: string; orgId: string | null; tokenVersion: number },
  contract: IssueLoginClaimContract = readIssueLoginClaimContract(),
): void {
  logClaimContractOnce(contract)
  const secret = process.env['JWT_SECRET']
  if (!secret) throw new Error('JWT_SECRET 未配置，无法解码自签令牌')
  const decoded: unknown = new JwtService({ secret }).decode(token)
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) {
    throw new Error('FAIL 自签内部令牌无法解码，门禁拒绝继续')
  }
  const payload = decoded as Record<string, unknown>
  const problems: string[] = []

  const audProblem = registeredClaimProblem('aud', 'audience', payload, contract.audience)
  if (audProblem) problems.push(audProblem)
  const issProblem = registeredClaimProblem('iss', 'issuer', payload, contract.issuer)
  if (issProblem) problems.push(issProblem)

  const customKeys = contract.payloadKeys.filter((key) => key !== 'aud' && key !== 'iss')
  for (const key of customKeys) {
    if (!(key in payload)) problems.push(`缺少字段 ${key}（issueLogin 的 sign() 会写它）`)
  }
  for (const key of Object.keys(payload)) {
    if (key === 'iat' || key === 'exp' || key === 'aud' || key === 'iss') continue
    if (!customKeys.includes(key)) problems.push(`多出字段 ${key}（issueLogin 的 sign() 没有这个名字）`)
  }

  if (customKeys.includes('sub') && 'sub' in payload && payload.sub !== user.id) {
    problems.push(`sub 不一致：应为用户 id ${JSON.stringify(user.id)}，令牌里是 ${JSON.stringify(payload.sub)}`)
  }
  if (customKeys.includes('role') && 'role' in payload && payload.role !== user.role) {
    problems.push(`role 不一致：应为 ${JSON.stringify(user.role)}，令牌里是 ${JSON.stringify(payload.role)}`)
  }
  if (customKeys.includes('orgId') && 'orgId' in payload && payload.orgId !== user.orgId) {
    problems.push(`orgId 不一致：应为 ${JSON.stringify(user.orgId)}，令牌里是 ${JSON.stringify(payload.orgId)}`)
  }
  if (customKeys.includes('ver') && 'ver' in payload && payload.ver !== user.tokenVersion) {
    problems.push(`ver 不一致：应为 tokenVersion ${JSON.stringify(user.tokenVersion)}，令牌里是 ${JSON.stringify(payload.ver)}`)
  }
  if (customKeys.includes('jti') && 'jti' in payload && (typeof payload.jti !== 'string' || payload.jti.length === 0)) {
    problems.push(`jti 不一致：issueLogin 会签成非空字符串（randomUUID），令牌里是 ${JSON.stringify(payload.jti)}`)
  }

  const ttl = typeof payload.exp === 'number' && typeof payload.iat === 'number' ? payload.exp - payload.iat : null
  if (ttl !== HARNESS_INTERNAL_TOKEN_TTL_SECONDS) {
    problems.push(`自签令牌寿命应为 ${HARNESS_INTERNAL_TOKEN_TTL}（${HARNESS_INTERNAL_TOKEN_TTL_SECONDS} 秒），实际 exp-iat=${String(ttl)}`)
  }

  if (problems.length > 0) {
    throw new Error(
      ['FAIL 自签内部令牌与 auth.service.ts::issueLogin 的签发结构不一致，门禁拒绝继续。', ...problems.map((line) => `  - ${line}`)].join('\n'),
    )
  }
}

let claimContractLogged = false

function logClaimContractOnce(contract: IssueLoginClaimContract): void {
  if (claimContractLogged) return
  claimContractLogged = true
  const aud = contract.audience === null ? '缺省' : JSON.stringify(contract.audience)
  const iss = contract.issuer === null ? '缺省' : JSON.stringify(contract.issuer)
  console.log(`  签发契约（auth.service.ts issueLogin + auth.module.ts signOptions）：${contract.payloadKeys.join(', ')}；aud=${aud}；iss=${iss}；本门禁寿命 ${HARNESS_INTERNAL_TOKEN_TTL}`)
}

function registeredClaimProblem(
  claim: 'aud' | 'iss',
  optionName: 'audience' | 'issuer',
  payload: Record<string, unknown>,
  expected: string | null,
): string | null {
  const present = claim in payload
  if (expected === null) {
    if (!present) return null
    return `${claim} 与 issueLogin 不一致：签发契约是缺省（signOptions 与 sign() 都没有 ${optionName}），令牌里却是 ${JSON.stringify(payload[claim])}`
  }
  if (!present) return `${claim} 与 issueLogin 不一致：签发契约是 ${JSON.stringify(expected)}，令牌里没有 ${claim}`
  if (payload[claim] !== expected) {
    return `${claim} 与 issueLogin 不一致：签发契约是 ${JSON.stringify(expected)}，令牌里是 ${JSON.stringify(payload[claim])}`
  }
  return null
}

function registeredClaimFromPayload(
  props: Array<{ key: string; value: string | null }>,
  claim: 'aud' | 'iss',
  source: string,
): string | null {
  const prop = props.find((item) => item.key === claim)
  if (!prop) return null
  if (prop.value === null) throw new Error(`issueLogin 的 ${claim} 是简写，无法确定取值，拒绝静默通过`)
  return resolveStringLiteral(prop.value, source, `issueLogin ${claim}`)
}

function readAuthSource(name: 'auth.service.ts' | 'auth.module.ts'): { path: string; source: string } {
  const path = join(__dirname, '..', '..', 'src', 'auth', name)
  try {
    return { path, source: readFileSync(path, 'utf8') }
  } catch (error) {
    throw new Error(`读不到 ${path}，无法核对自签令牌与 issueLogin 是否一致：${(error as Error).message}`)
  }
}

function readSignOptions(source: string, label: string): Array<{ key: string; value: string | null }> {
  const marker = 'signOptions:'
  const at = source.indexOf(marker)
  if (at < 0) throw new Error(`${label} 找不到 signOptions，无法核对 aud/iss，拒绝静默通过`)
  if (source.indexOf(marker, at + marker.length) >= 0) {
    throw new Error(`${label} 有多处 signOptions，无法确定 AuthService 用的是哪一个，拒绝静默通过`)
  }
  const brace = source.indexOf('{', at + marker.length)
  const between = source.slice(at + marker.length, brace < 0 ? source.length : brace).trim()
  if (brace < 0 || between !== '') {
    throw new Error(`${label} 的 signOptions 不是对象字面量，拒绝静默通过`)
  }
  return parseObjectProps(source.slice(brace, matchingClose(source, brace, '{', '}') + 1))
}

function signOptionClaims(
  props: Array<{ key: string; value: string | null }>,
  source: string,
  label: string,
): { audience: string | null; issuer: string | null; hasExpiresIn: boolean } {
  const seen = new Set<string>()
  for (const prop of props) {
    if (seen.has(prop.key)) throw new Error(`${label} 的 ${prop.key} 重复，拒绝静默通过`)
    seen.add(prop.key)
    if (prop.key !== 'expiresIn' && prop.key !== 'audience' && prop.key !== 'issuer') {
      throw new Error(`${label} 含有未建模字段 ${prop.key}，拒绝静默通过`)
    }
  }
  const expr = (key: 'audience' | 'issuer'): string | null => {
    const prop = props.find((item) => item.key === key)
    if (!prop) return null
    if (prop.value === null) throw new Error(`${label} 的 ${key} 是简写，无法确定取值，拒绝静默通过`)
    return resolveStringLiteral(prop.value, source, `${label} ${key}`)
  }
  return {
    hasExpiresIn: seen.has('expiresIn'),
    audience: expr('audience'),
    issuer: expr('issuer'),
  }
}

function resolveStringLiteral(expr: string, source: string, label: string): string {
  const trimmed = expr.trim()
  const quoted = /^(['"])((?:\\.|[\s\S])*?)\1$/.exec(trimmed)
  if (quoted?.[2] !== undefined && quoted[1]) return unescapeQuoted(quoted[2])
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) {
    throw new Error(`${label} 的取值「${trimmed.slice(0, 80)}」不是字符串字面量，拒绝猜测`)
  }
  const decl = new RegExp(`(?:const|let)\\s+${trimmed}\\s*=\\s*(['"])((?:\\\\.|[\\s\\S])*?)\\1`).exec(source)
  if (decl?.[2] === undefined) {
    throw new Error(`${label} 引用了 ${trimmed}，但在同一文件里找不到它的字符串定义，拒绝猜测`)
  }
  return unescapeQuoted(decl[2])
}

function unescapeQuoted(value: string): string {
  return value.replace(/\\(['"\\nrt])/g, (_, ch: string) => {
    if (ch === 'n') return '\n'
    if (ch === 'r') return '\r'
    if (ch === 't') return '\t'
    return ch
  })
}

function extractFunctionBody(source: string, signature: string): string {
  const at = source.indexOf(signature)
  if (at < 0) throw new Error(`找不到 ${signature}，无法核对签发结构，拒绝静默通过`)
  if (source.indexOf(signature, at + signature.length) >= 0) {
    throw new Error(`找到多处 ${signature}，无法确定登录签发函数，拒绝静默通过`)
  }
  const brace = source.indexOf('{', at + signature.length)
  if (brace < 0) throw new Error(`${signature} 没有函数体，拒绝静默通过`)
  return source.slice(brace, matchingClose(source, brace, '{', '}') + 1)
}

function parseObjectProps(literal: string): Array<{ key: string; value: string | null }> {
  const text = literal.trim()
  if (!text.startsWith('{')) throw new Error(`期望对象字面量，实际是「${text.slice(0, 60)}」，拒绝静默通过`)
  const end = matchingClose(text, 0, '{', '}')
  const rest = text.slice(end + 1).trim()
  if (rest) throw new Error(`对象字面量后面还有「${rest.slice(0, 40)}」，拒绝静默通过`)
  const props: Array<{ key: string; value: string | null }> = []
  for (const part of splitTopLevel(text.slice(1, end), ',')) {
    const item = part.trim()
    if (!item) continue
    if (item.startsWith('...')) throw new Error('签发对象用了展开，无法核对字段名，拒绝静默通过')
    if (item.startsWith('[')) throw new Error('签发对象用了计算属性名，无法核对字段名，拒绝静默通过')
    const shorthand = /^([A-Za-z_][A-Za-z0-9_]*)$/.exec(item)
    if (shorthand?.[1]) {
      props.push({ key: shorthand[1], value: null })
      continue
    }
    const named = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([\s\S]+)$/.exec(item)
    if (!named?.[1] || named[2] === undefined) throw new Error(`无法解析签发字段「${item.slice(0, 80)}」，拒绝静默通过`)
    props.push({ key: named[1], value: named[2].trim() })
  }
  return props
}

function splitTopLevel(source: string, separator: string): string[] {
  const parts: string[] = []
  let start = 0
  let brace = 0
  let paren = 0
  let bracket = 0
  let quote: string | null = null
  let i = 0
  while (i < source.length) {
    const c = source[i]
    if (quote) {
      if (c === '\\') { i += 2; continue }
      if (c === quote) quote = null
      i += 1
      continue
    }
    if (c === '/' && source[i + 1] === '/') {
      const nl = source.indexOf('\n', i)
      i = nl < 0 ? source.length : nl + 1
      continue
    }
    if (c === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2)
      if (end < 0) throw new Error('签发源码有未闭合块注释，拒绝静默通过')
      i = end + 2
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c
      i += 1
      continue
    }
    if (c === '{') brace += 1
    else if (c === '}') brace -= 1
    else if (c === '(') paren += 1
    else if (c === ')') paren -= 1
    else if (c === '[') bracket += 1
    else if (c === ']') bracket -= 1
    else if (c === separator && brace === 0 && paren === 0 && bracket === 0) {
      parts.push(source.slice(start, i))
      start = i + 1
    }
    if (brace < 0 || paren < 0 || bracket < 0) throw new Error('签发源码括号不配对，拒绝静默通过')
    i += 1
  }
  parts.push(source.slice(start))
  return parts
}

function matchingClose(source: string, openIndex: number, open: string, close: string): number {
  if (source[openIndex] !== open) throw new Error(`内部错误：期望「${open}」`)
  let depth = 0
  let quote: string | null = null
  let i = openIndex
  while (i < source.length) {
    const c = source[i]
    if (quote) {
      if (c === '\\') { i += 2; continue }
      if (c === quote) quote = null
      i += 1
      continue
    }
    if (c === '/' && source[i + 1] === '/') {
      const nl = source.indexOf('\n', i)
      i = nl < 0 ? source.length : nl + 1
      continue
    }
    if (c === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2)
      if (end < 0) throw new Error('签发源码有未闭合块注释，拒绝静默通过')
      i = end + 2
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c
      i += 1
      continue
    }
    if (c === open) depth += 1
    else if (c === close) {
      depth -= 1
      if (depth === 0) return i
    }
    i += 1
  }
  throw new Error('签发源码括号未闭合，拒绝静默通过')
}
