// ============================================================================
// AI 类出站端点白名单：模型、OCR、语音识别 / 合成、数字人（TRTC）、短信
//
// 为什么要有这个文件 —— docs/product/feature-scope.md §七 #26（2026-09-27 四方评审，
// 全面商用收口评审 P1-3）：
//
//   模型地址管理员可以在后台随手改；OCR、语音、短信的主机和数字人交给腾讯云代调的
//   模型地址，都能用环境变量改成任意公网地址。原有的 llm-base-url.ts 只拦本机与内网，
//   于是简历、面试作答、语音转写、手机号这类个人信息，可能被送到未经核准（未备案）
//   或境外的端点。生成式 AI 只能调用境内已备案的模型；个人信息出境另有法定程序。
//
// 为什么是独立的新文件（不放进现有文件）：
//   - 这张单同时管 ai/llm、ai/resume/ocr、asr、mock-interview、trtc、member-auth/sms、
//     contract-review 七个模块的出站点。放进其中任何一个，其余模块都得反向依赖它。
//   - llm-base-url.ts 管的是「内网 / 本机」这另一件事，而且它的门禁
//     （verify:ai-config 7i）明确钉住「不做 DNS、字面公网名放行」。把白名单塞进去
//     会改掉它已被门禁固定的语义。
//   - 后续 P1-2（金额上限、主备切换）还要改 llm-http.ts；判定逻辑独立成文件，
//     llm-http.ts 里只留一行调用，方便叠加。
//
// 判定规则（一张单、一个判定函数 evaluateAiEndpoint）：
//   1. 按 WHATWG URL 解析 —— 与 Node 的 fetch 用的是同一套解析，所以这里判的主机名
//      就是 fetch 真正要连的主机名（`api.deepseek.com@evil.com`、`%2e`、全角句点这类
//      写法，解析后是什么就按什么判，不做字符串前缀比较）。
//   2. 本机（localhost / 127.0.0.0/8 / ::1）：非生产放行（门禁用本机 stub，http 也行）；
//      生产（NODE_ENV=production）一律拒绝 —— 写进白名单也不行。
//   3. 其余地址必须是 https。
//   4. 主机名规范化（小写、去末尾点、IDN 转 punycode）后与白名单逐条比：
//      精确主机名，或 `*.后缀`（只匹配子域，不匹配后缀本身）。
//   5. 不在单内 → 调用方拒绝发出，**一个请求都不发**；不静默换地址，不回退 mock。
//
// 白名单来源：
//   - 默认单（代码内置，不配 env 也安全）：只放代码里实际在用、且是境内厂商的**精确**
//     主机名。腾讯云刻意不用 `*.tencentcloudapi.com`：腾讯云按地域提供接入域名，
//     `*.ap-singapore.tencentcloudapi.com`、`*.na-ashburn.tencentcloudapi.com`、
//     `*.eu-frankfurt.tencentcloudapi.com` 等境外地域都在这个后缀下，通配等于把境外放行。
//     同理千问只放 dashscope.aliyuncs.com，不放 `*.aliyuncs.com`（国际站是
//     dashscope-intl.aliyuncs.com）。MiniMax、鱼人（llm-presets.ts 里有预设）不进默认单：
//     docs/product/ai-provider-integration.md 写明「不进生产白名单」。
//   - AI_ENDPOINT_ALLOWLIST：设置后**整张替换**默认单。
//   - AI_ENDPOINT_ALLOWLIST_EXTRA：在上面那张单的基础上**追加**。
//   写错的条目（带协议、端口、路径，`*`，或 `*.com` 这种一级后缀通配）一律忽略并告警 ——
//   忽略只会让单变小，不会变大（fail-closed）。
//
// 日志：只记服务类别、主机名与拒绝原因。绝不记路径与查询串（百度换 token 的查询串里
// 就是 API Key 与 Secret Key），也不记请求体。
// ============================================================================

import { Logger } from '@nestjs/common'
import { isIP } from 'node:net'
import { domainToASCII } from 'node:url'

/** 出站点类别：只用于日志与错误对象，便于运维一眼看出是哪条链被拦。 */
export type AiOutboundService =
  | 'llm'
  | 'contract_review'
  | 'ocr'
  | 'asr'
  | 'tts'
  | 'trtc'
  | 'trtc_llm'
  | 'trtc_tts'
  | 'sms'

export type AiEndpointRejectReason =
  /** 不是合法的 http(s) 地址，或主机名为空 / 有空标签。 */
  | 'invalid_url'
  /** 非本机地址却不是 https。 */
  | 'insecure_protocol'
  /** 生产环境指向本机。 */
  | 'loopback_in_production'
  /** 主机名不在白名单里。 */
  | 'host_not_allowed'
  /** 配置里看不出请求会发到哪里（例如交给腾讯云代调的配置没写地址）。 */
  | 'unverifiable'

export const AI_ENDPOINT_ALLOWLIST_ENV = 'AI_ENDPOINT_ALLOWLIST'
export const AI_ENDPOINT_ALLOWLIST_EXTRA_ENV = 'AI_ENDPOINT_ALLOWLIST_EXTRA'

/**
 * 默认白名单。每一条都要能说出「代码哪里在用」—— 不在用的厂商不放。
 */
export const DEFAULT_AI_ENDPOINT_ALLOWLIST: readonly string[] = Object.freeze([
  // DeepSeek：llm-presets 的 deepseek 预设、合同审查、数字人 TRTC_LLM_API_URL 默认值
  'api.deepseek.com',
  // 通义千问：llm-presets 的 qwen 预设、合同审查
  'dashscope.aliyuncs.com',
  // 百度智能云：OCR（BAIDU_OCR_BASE_URL）与短语音识别换 token（BAIDU_ASR_BASE_URL）
  'aip.baidubce.com',
  // 百度短语音识别（BAIDU_ASR_VOP_URL）
  'vop.baidu.com',
  // 腾讯云：数字人对话（trtc/tencent-api.util.ts 写死的主机）
  'trtc.tencentcloudapi.com',
  // 腾讯云：一句话识别（TENCENT_ASR_HOST 默认值）
  'asr.tencentcloudapi.com',
  // 腾讯云：语音合成（TENCENT_TTS_HOST 默认值）
  'tts.tencentcloudapi.com',
  // 腾讯云：短信（TENCENT_SMS_HOST 默认值）
  'sms.tencentcloudapi.com',
])

/** 被拒时抛出。与 LlmBusyError / LlmTimeoutError 分开：它是配置级问题，重试没有用。 */
export class AiEndpointNotAllowedError extends Error {
  constructor(
    readonly service: AiOutboundService,
    /** 规范化后的主机名；解析失败时为空串。只有主机名，没有路径与查询串。 */
    readonly host: string,
    readonly reason: AiEndpointRejectReason,
  ) {
    // message 是固定码：调用方若把 message 打进日志或拼进响应，也带不出地址细节。
    super('AI_ENDPOINT_NOT_ALLOWED')
    this.name = 'AiEndpointNotAllowedError'
  }
}

export interface AiEndpointVerdict {
  allowed: boolean
  /** 规范化后的主机名（没有端口、没有方括号）；解析失败时为空串。 */
  host: string
  reason?: AiEndpointRejectReason
}

export type EnvLike = Readonly<Record<string, string | undefined>>

const logger = new Logger('AiEndpointAllowlist')

// ---------------------------------------------------------------------------
// 主机名规范化
// ---------------------------------------------------------------------------

const HOST_CHARS = /^[a-z0-9.-]+$/u

/** 非 IP 主机名不许有空标签（`a..b.com`），每段 1–63 个字符。 */
function hasValidLabels(host: string): boolean {
  return host.split('.').every((label) => label.length > 0 && label.length <= 63)
}

/**
 * URL.hostname → 比对用的主机名。
 * URL 解析已经做过小写与 IDN→punycode；这里只去掉 IPv6 方括号和末尾点。
 * 返回空串表示不合法。
 */
function normalizeUrlHost(hostname: string): string {
  if (hostname.startsWith('[') && hostname.endsWith(']')) return hostname.slice(1, -1)
  const host = hostname.replace(/\.+$/u, '')
  if (!host || !HOST_CHARS.test(host) || !hasValidLabels(host)) return ''
  return host
}

/**
 * 白名单条目 → 规范形式（`host` 或 `*.suffix`）；写法不对返回 null。
 *
 * 必须先挡掉 `/ : @ ? #` 等字符再交给 domainToASCII：实测它会把 `x.com/v1` 截成
 * `x.com`、把 `*.x.com` 原样放过，不先挡就等于替写错的条目「猜意思」。
 */
function normalizeEntry(raw: string): string | null {
  let body = raw.trim()
  if (!body) return null
  const wildcard = body.startsWith('*.')
  if (wildcard) body = body.slice(2)
  if (!body || /[\s/\\:@?#*%[\]]/u.test(body)) return null
  const ascii = domainToASCII(body)
  if (!ascii) return null
  const host = ascii.toLowerCase().replace(/\.+$/u, '')
  if (!host || !HOST_CHARS.test(host) || !hasValidLabels(host)) return null
  if (wildcard) {
    // `*.com`、`*.cn` 这种一级后缀通配等于没有白名单；IP 也不能做后缀通配。
    if (isIP(host) !== 0 || host.split('.').length < 2) return null
    return `*.${host}`
  }
  return host
}

function parseEntries(raw: string): { entries: string[]; invalidCount: number } {
  const entries: string[] = []
  let invalidCount = 0
  for (const piece of raw.split(/[\s,，;；]+/u)) {
    if (!piece) continue
    const entry = normalizeEntry(piece)
    if (entry) entries.push(entry)
    else invalidCount += 1
  }
  return { entries, invalidCount }
}

// ---------------------------------------------------------------------------
// 白名单解析（按 env 原文记忆化：env 不变就不重复解析、不重复告警）
// ---------------------------------------------------------------------------

let memo: { key: string; list: readonly string[] } | null = null

export function resolveAiEndpointAllowlist(env: EnvLike = process.env): readonly string[] {
  const override = env[AI_ENDPOINT_ALLOWLIST_ENV]
  const extra = env[AI_ENDPOINT_ALLOWLIST_EXTRA_ENV]
  const key = `${override ?? '\u0000'}\u0001${extra ?? ''}`
  if (memo && memo.key === key) return memo.list

  const useOverride = typeof override === 'string' && override.trim() !== ''
  const base = useOverride ? parseEntries(override) : { entries: [...DEFAULT_AI_ENDPOINT_ALLOWLIST], invalidCount: 0 }
  const added = extra ? parseEntries(extra) : { entries: [], invalidCount: 0 }
  // 只报条数、不回显条目原文：有人把带密钥的整条 URL 误填进来时，日志里也不会出现密钥。
  if (base.invalidCount > 0) {
    logger.warn(`${AI_ENDPOINT_ALLOWLIST_ENV} 里有 ${base.invalidCount} 条写法不对，已忽略（只认精确主机名或 *.后缀，不带协议、端口、路径）`)
  }
  if (added.invalidCount > 0) {
    logger.warn(`${AI_ENDPOINT_ALLOWLIST_EXTRA_ENV} 里有 ${added.invalidCount} 条写法不对，已忽略（只认精确主机名或 *.后缀，不带协议、端口、路径）`)
  }
  if (useOverride && base.entries.length === 0) {
    logger.warn(`${AI_ENDPOINT_ALLOWLIST_ENV} 已设置但没有一条有效：除本机调试外，模型、OCR、语音、数字人、短信的出站请求都会被拒绝`)
  }
  const list = Object.freeze([...new Set([...base.entries, ...added.entries])])
  memo = { key, list }
  return list
}

export function hostMatchesAllowlist(host: string, allowlist: readonly string[]): boolean {
  return allowlist.some((entry) =>
    entry.startsWith('*.') ? host.endsWith(entry.slice(1)) : host === entry,
  )
}

/** 回环地址（本机）。后台模型地址校验（llm-base-url.ts）也用它，两处口径必须一致。 */
export function isLoopbackHost(host: string): boolean {
  if (host === 'localhost') return true
  const family = isIP(host)
  if (family === 4) return host.startsWith('127.')
  if (family === 6) return host === '::1'
  return false
}

// ---------------------------------------------------------------------------
// 判定
// ---------------------------------------------------------------------------

/** 唯一的判定函数。纯函数（除了读 env），不发请求、不做 DNS。 */
export function evaluateAiEndpoint(url: string, env: EnvLike = process.env): AiEndpointVerdict {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { allowed: false, host: '', reason: 'invalid_url' }
  }
  const host = normalizeUrlHost(parsed.hostname)
  if (!host) return { allowed: false, host: '', reason: 'invalid_url' }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { allowed: false, host, reason: 'insecure_protocol' }
  }
  if (isLoopbackHost(host)) {
    return env['NODE_ENV'] === 'production'
      ? { allowed: false, host, reason: 'loopback_in_production' }
      : { allowed: true, host }
  }
  if (parsed.protocol !== 'https:') return { allowed: false, host, reason: 'insecure_protocol' }
  return hostMatchesAllowlist(host, resolveAiEndpointAllowlist(env))
    ? { allowed: true, host }
    : { allowed: false, host, reason: 'host_not_allowed' }
}

function logRejection(service: AiOutboundService, host: string, reason: AiEndpointRejectReason): void {
  logger.warn(`outbound.endpoint_not_allowed service=${service} host=${host || '(unparseable)'} reason=${reason}`)
}

/**
 * 发请求前调用：不在单内就抛 AiEndpointNotAllowedError（并记一行只含主机名的日志）。
 * 给「失败走异常」的调用点用（LLM、合同审查、数字人）。
 */
export function assertAiEndpointAllowed(url: string, service: AiOutboundService): void {
  const verdict = evaluateAiEndpoint(url)
  if (verdict.allowed) return
  const reason = verdict.reason ?? 'host_not_allowed'
  logRejection(service, verdict.host, reason)
  throw new AiEndpointNotAllowedError(service, verdict.host, reason)
}

/**
 * 发请求前调用：返回是否放行（拒绝时同样记日志）。
 * 给「失败走结果对象」的调用点用（OCR、语音识别、语音合成、短信）。
 */
export function isAiEndpointAllowed(url: string, service: AiOutboundService): boolean {
  const verdict = evaluateAiEndpoint(url)
  if (verdict.allowed) return true
  logRejection(service, verdict.host, verdict.reason ?? 'host_not_allowed')
  return false
}

/**
 * 交给第三方代调、只能从配置里读出目的地的场景（数字人把模型地址交给腾讯云）：
 * 目的地读不出来时，同样按「不放行」处理，并记 unverifiable。
 */
export function rejectUnverifiableAiEndpoint(service: AiOutboundService): never {
  logRejection(service, '', 'unverifiable')
  throw new AiEndpointNotAllowedError(service, '', 'unverifiable')
}
