// ============================================================================
// 门禁：AI 类出站端点白名单（全面商用收口评审 P1-3，feature-scope §七 #26）
//
// 守的是：简历、面试作答、语音、手机号这类个人信息，不能被送到未经核准或境外的端点。
// 被测对象：services/api/src/common/outbound/ai-endpoint-allowlist.ts 及其全部调用点。
//
// 断言分五组，全部**真跑**（不触网：fetch 一律替换成计数假实现）：
//   [A] 判定函数：默认单放行 DeepSeek / 千问 / 百度 / 腾讯云；拒绝境外与任意公网；
//       拒绝后缀伪装；IDN 与末尾点规范化；生产只许 https、不许本机；env 覆盖与追加；
//       写错的条目被忽略（只会让单变小）；拒绝日志只有主机名、没有路径与密钥。
//   [B] llmFetchJson：白名单外**一次 fetch 都不发**（注入计数 fetch），也不占并发槽位。
//   [C] 12 个 LLM 调用点：派生式静态扫描（每个都显式映射成 AI_ENDPOINT_NOT_ALLOWED），
//       再抽 3 个真跑：503 + 独立错误码、不发请求、不落假账（onLlmCall 不被调用）。
//   [D] 后台写配置：保存（显式地址 / 切厂商套预设 / http）被拒且不落盘、不写审计；
//       两个连通性测试端点对存量未核准地址同样拒绝，且不发请求。
//   [E] 非 LLM 出站点：OCR、语音识别（腾讯 / 百度）、语音合成、数字人（腾讯云主机 /
//       代调模型 / 代调语音合成）、短信、合同审查 —— 各自「白名单外被拒、未发出请求」，
//       并各配一条阳性对照（证明计数器真的数得到请求，读数 0 不是没测到）。
//
// 反向变异（本文件头只记口径，结果见交付报告）：把判定改成恒放行必须红；
// 删掉任一出站点的判定调用，对应那条必须红。
//
// 失败闭合：退出码默认 1，只有走到最后一行才置 0；全局看门狗防挂起静默退出。
// 运行：pnpm --filter @ai-job-print/api verify:ai-endpoint-allowlist
// ============================================================================

import 'reflect-metadata'
import { Logger } from '@nestjs/common'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'

process.exitCode = 1
const GLOBAL_WATCHDOG_MS = 120_000
const globalWatchdog = setTimeout(() => {
  console.log(`\n  FAIL  门禁自身超过 ${GLOBAL_WATCHDOG_MS / 1000} 秒未跑完 —— 存在挂起路径，按失败处理`)
  process.exit(1)
}, GLOBAL_WATCHDOG_MS)

// ── 与本门禁相关的 env 一律先清空，由各用例自己设置 ────────────────────────────
const TOUCHED_ENV = [
  'NODE_ENV', 'AI_ENDPOINT_ALLOWLIST', 'AI_ENDPOINT_ALLOWLIST_EXTRA',
  'AI_LLM_API_KEY', 'TRTC_LLM_API_KEY', 'TRTC_LLM_API_URL', 'TRTC_LLM_CONFIG_JSON', 'TRTC_TTS_CONFIG_JSON',
  'TRTC_TTS_TYPE', 'TRTC_SDK_APP_ID', 'TRTC_SDK_SECRET_KEY', 'TRTC_TTS_APP_ID', 'TENCENT_APP_ID',
  'TENCENT_SECRET_ID', 'TENCENT_SECRET_KEY', 'TENCENT_ASR_SECRET_ID', 'TENCENT_ASR_SECRET_KEY',
  'TENCENT_TTS_SECRET_ID', 'TENCENT_TTS_SECRET_KEY', 'TENCENT_ASR_HOST', 'TENCENT_TTS_HOST', 'TTS_PROVIDER',
  'ASR_PROVIDER', 'BAIDU_ASR_API_KEY', 'BAIDU_ASR_SECRET_KEY', 'BAIDU_ASR_BASE_URL', 'BAIDU_ASR_VOP_URL',
  'BAIDU_OCR_API_KEY', 'BAIDU_OCR_SECRET_KEY', 'BAIDU_OCR_BASE_URL',
]
for (const name of TOUCHED_ENV) delete process.env[name]
const DATA_DIR = mkdtempSync(join(tmpdir(), 'verify-ai-endpoint-'))
process.env['FILE_STORAGE_DIR'] = DATA_DIR
process.env['SECRET_ENCRYPTION_KEY'] ||= 'verify-ai-endpoint-secret-encryption-key-0123456789'
process.on('exit', () => rmSync(DATA_DIR, { recursive: true, force: true }))

// ── 日志捕获：既要安静，也要能断言「拒绝日志里没有路径与密钥」 ────────────────
const capturedLogs: string[] = []
class CapturingLogger {
  log(message: unknown) { capturedLogs.push(String(message)) }
  error(message: unknown) { capturedLogs.push(String(message)) }
  warn(message: unknown) { capturedLogs.push(String(message)) }
  debug(message: unknown) { capturedLogs.push(String(message)) }
  verbose(message: unknown) { capturedLogs.push(String(message)) }
}
Logger.overrideLogger(new CapturingLogger())

// ── 断言工具 ──────────────────────────────────────────────────────────────────
let passed = 0
const failures: string[] = []
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed += 1
    console.log(`  PASS  ${name}`)
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

type EnvPatch = Record<string, string | undefined>
async function withEnv<T>(patch: EnvPatch, fn: () => Promise<T> | T): Promise<T> {
  const saved: EnvPatch = {}
  for (const [key, value] of Object.entries(patch)) {
    saved[key] = process.env[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  try {
    return await fn()
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

/** 取 Nest 异常的 HTTP 状态与业务码（没有就是 undefined）。 */
function httpErrorOf(error: unknown): { status?: number; code?: string; message?: string } {
  const ex = error as { getStatus?: () => number; getResponse?: () => unknown } | null
  if (!ex || typeof ex.getStatus !== 'function' || typeof ex.getResponse !== 'function') return {}
  const body = ex.getResponse() as { error?: { code?: string; message?: string } } | undefined
  return { status: ex.getStatus(), code: body?.error?.code, message: body?.error?.message }
}

async function caught(fn: () => Promise<unknown> | unknown): Promise<unknown> {
  try {
    await fn()
    return null
  } catch (error) {
    return error
  }
}

// ── 计数假 fetch：替换全局 fetch，按请求形态回包；记录主机名供断言 ───────────
const fetchedHosts: string[] = []
function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}
function fakeFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
  fetchedHosts.push(url.hostname)
  const headers = (init?.headers ?? {}) as Record<string, string>
  const action = headers['X-TC-Action'] ?? headers['x-tc-action']
  if (action === 'StartAIConversation') return Promise.resolve(jsonResponse({ Response: { TaskId: 'task-verify', RequestId: 'r' } }))
  if (action === 'StopAIConversation') return Promise.resolve(jsonResponse({ Response: { RequestId: 'r' } }))
  if (action === 'SentenceRecognition') return Promise.resolve(jsonResponse({ Response: { Result: '你好', RequestId: 'r' } }))
  if (action === 'TextToVoice') return Promise.resolve(jsonResponse({ Response: { Audio: Buffer.from('mp3').toString('base64') } }))
  if (action === 'SendSms') return Promise.resolve(jsonResponse({ Response: { SendStatusSet: [{ Code: 'Ok' }], RequestId: 'r' } }))
  if (url.pathname.includes('/oauth/2.0/token')) return Promise.resolve(jsonResponse({ access_token: 'stub-token', expires_in: 2_592_000 }))
  if (url.pathname.includes('/rest/2.0/ocr/')) return Promise.resolve(jsonResponse({ words_result: [{ words: '求职简历', probability: { average: 0.95 } }] }))
  if (url.pathname.includes('server_api')) return Promise.resolve(jsonResponse({ err_no: 0, result: ['你好'] }))
  return Promise.resolve(jsonResponse({
    choices: [{ message: { content: '{"question":"请做个自我介绍","qType":"intro","findings":[],"responsibilities":["负责接待"],"mustHaveRequirements":["沟通能力"]}' } }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  }))
}
const realFetch = globalThis.fetch
globalThis.fetch = fakeFetch as typeof fetch
function resetFetchCount(): void { fetchedHosts.length = 0 }

const DISALLOWED_LLM_BASE = 'https://api.openai.com/v1'

async function main(): Promise<void> {
  const allowlist = await import('../src/common/outbound/ai-endpoint-allowlist')
  const { evaluateAiEndpoint, AiEndpointNotAllowedError, DEFAULT_AI_ENDPOINT_ALLOWLIST, assertAiEndpointAllowed } = allowlist

  // ==========================================================================
  // [A] 判定函数
  // ==========================================================================
  console.log('\n[A] 判定函数本身')
  const DEV: EnvPatch = {}
  const PROD: EnvPatch = { NODE_ENV: 'production' }
  const allowedIn = (url: string, env: EnvPatch = DEV) => evaluateAiEndpoint(url, env).allowed
  const reasonIn = (url: string, env: EnvPatch = DEV) => evaluateAiEndpoint(url, env).reason

  const defaultHosts: Array<[string, string]> = [
    ['DeepSeek', 'https://api.deepseek.com/v1/chat/completions'],
    ['通义千问', 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'],
    ['百度 OCR / 换 token', 'https://aip.baidubce.com/oauth/2.0/token'],
    ['百度短语音识别', 'https://vop.baidu.com/server_api'],
    ['腾讯云 TRTC', 'https://trtc.tencentcloudapi.com'],
    ['腾讯云语音识别', 'https://asr.tencentcloudapi.com'],
    ['腾讯云语音合成', 'https://tts.tencentcloudapi.com'],
    ['腾讯云短信', 'https://sms.tencentcloudapi.com'],
  ]
  for (const [label, url] of defaultHosts) {
    check(`A1 默认单放行 ${label}（生产也放行）`, allowedIn(url) && allowedIn(url, PROD), url)
  }
  check('A1b 默认单全部是精确主机名（不含通配）', DEFAULT_AI_ENDPOINT_ALLOWLIST.every((entry) => !entry.includes('*')))

  const foreignOrArbitrary = [
    'https://api.openai.com/v1/chat/completions',
    'https://api.anthropic.com/v1/messages',
    'https://example.com/v1',
    'https://generativelanguage.googleapis.com/v1beta',
    // 代码里有预设、但产品文档写明不进生产白名单的两家
    'https://yurenapi.cn/v1',
    'https://api.minimax.chat/v1',
    // 同一厂商的境外接入点：通配 *.aliyuncs.com / *.tencentcloudapi.com 会把它们放进来
    'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    'https://asr.ap-singapore.tencentcloudapi.com',
    'https://sms.na-ashburn.tencentcloudapi.com',
  ]
  for (const url of foreignOrArbitrary) {
    check(`A2 拒绝境外 / 任意公网 / 未核准：${new URL(url).hostname}`, !allowedIn(url) && reasonIn(url) === 'host_not_allowed', String(reasonIn(url)))
  }

  const disguises = [
    'https://api.deepseek.com.evil.com/v1',
    'https://evildeepseek.com/v1',
    'https://api-deepseek.com/v1',
    'https://api.deepseek.com@evil.com/v1',
    'https://evil.com/api.deepseek.com/v1',
    'https://evil.com/?h=api.deepseek.com',
    'https://evil.com#api.deepseek.com',
    'https://api.deepseek.com%2eevil.com/v1',
    'https://evil.com\\@api.deepseek.com',
    'https://sms.tencentcloudapi.com.evil.cn',
  ]
  for (const url of disguises) {
    check(`A3 拒绝伪装：${url}`, !allowedIn(url))
  }
  // 通配条目的边界：*.x.com 只匹配子域，不匹配 x.com 本身、不匹配 evilx.com、不匹配 x.com.evil.com
  const wildcardEnv: EnvPatch = { AI_ENDPOINT_ALLOWLIST: '*.approved-vendor.cn' }
  check('A3b *.后缀 放行子域', allowedIn('https://api.approved-vendor.cn/v1', wildcardEnv))
  check('A3c *.后缀 放行多级子域', allowedIn('https://a.b.approved-vendor.cn/v1', wildcardEnv))
  check('A3d *.后缀 不匹配后缀本身', !allowedIn('https://approved-vendor.cn/v1', wildcardEnv))
  check('A3e *.后缀 不匹配拼接伪装（evilapproved-vendor.cn）', !allowedIn('https://evilapproved-vendor.cn/v1', wildcardEnv))
  check('A3f *.后缀 不匹配后缀当前缀（approved-vendor.cn.evil.com）', !allowedIn('https://api.approved-vendor.cn.evil.com/v1', wildcardEnv))

  check('A4 大写 + 末尾点规范化后放行', allowedIn('https://API.DeepSeek.COM./v1'))
  check('A4b 全角句点按 URL 规则规范化（与 fetch 实际连接的主机一致）', allowedIn('https://api。deepseek。com/v1'))
  const idnEnv: EnvPatch = { AI_ENDPOINT_ALLOWLIST_EXTRA: '模型.例子.cn' }
  check('A4c IDN 条目与 IDN 地址按 punycode 比对后放行', allowedIn('https://模型.例子.cn/v1', idnEnv))
  check('A4d punycode 写法的同一地址也放行', allowedIn('https://xn--xgs754b.xn--fsqu00a.cn/v1', idnEnv))
  check('A4e 形近的另一个 IDN 地址不放行', !allowedIn('https://模形.例子.cn/v1', idnEnv))
  check('A4f 条目写末尾点与大写也能生效', allowedIn('https://api.moonshot.cn/v1', { AI_ENDPOINT_ALLOWLIST_EXTRA: 'API.Moonshot.CN.' }))

  check('A5 非本机的 http 一律拒绝（开发环境也拒）', !allowedIn('http://api.deepseek.com/v1') && reasonIn('http://api.deepseek.com/v1') === 'insecure_protocol')
  check('A5b 生产拒绝 http', !allowedIn('http://api.deepseek.com/v1', PROD))
  check('A5c 非 http(s) 协议拒绝', !allowedIn('ftp://api.deepseek.com/x') && !allowedIn('file:///etc/passwd') && !allowedIn('data:text/plain,hi'))
  check('A5d 不是网址拒绝', !allowedIn('not a url') && reasonIn('not a url') === 'invalid_url' && !allowedIn(''))
  check('A6 非生产放行本机 stub（http / https / IPv6 / localhost）',
    allowedIn('http://127.0.0.1:18080/x') && allowedIn('https://localhost/x') && allowedIn('http://[::1]:3000/x') && allowedIn('http://127.1/x'))
  check('A6b 生产拒绝本机 stub', ['http://127.0.0.1:18080/x', 'https://localhost/x', 'http://[::1]:3000/x', 'http://LOCALHOST./x', 'http://0x7f.0.0.1/x']
    .every((url) => !allowedIn(url, PROD) && reasonIn(url, PROD) === 'loopback_in_production'))
  check('A6c 生产即使把 127.0.0.1 写进白名单也拒绝', !allowedIn('https://127.0.0.1/x', { ...PROD, AI_ENDPOINT_ALLOWLIST_EXTRA: '127.0.0.1' }))
  check('A6d 看起来像本机的公网名不算本机（localhost.evil.com / 127.0.0.1.nip.io）',
    !allowedIn('http://localhost.evil.com/x') && !allowedIn('https://127.0.0.1.nip.io/x'))

  const override: EnvPatch = { AI_ENDPOINT_ALLOWLIST: 'dashscope.aliyuncs.com' }
  check('A7 AI_ENDPOINT_ALLOWLIST 整张替换默认单', allowedIn('https://dashscope.aliyuncs.com/v1', override) && !allowedIn('https://api.deepseek.com/v1', override))
  const extra: EnvPatch = { AI_ENDPOINT_ALLOWLIST_EXTRA: 'api.moonshot.cn' }
  check('A7b AI_ENDPOINT_ALLOWLIST_EXTRA 在默认单上追加', allowedIn('https://api.moonshot.cn/v1', extra) && allowedIn('https://api.deepseek.com/v1', extra))
  check('A7c 空白的 AI_ENDPOINT_ALLOWLIST 视为未设置（回到默认单）', allowedIn('https://api.deepseek.com/v1', { AI_ENDPOINT_ALLOWLIST: '   ' }))
  const badEntries: EnvPatch = { AI_ENDPOINT_ALLOWLIST_EXTRA: '*, *.com, *.cn, https://evil.com, evil.com/v1, evil.com:443, user@evil.com' }
  check('A8 写错的条目一律忽略，不会把单放大', ['https://evil.com/v1', 'https://anything.com/v1', 'https://x.cn/v1']
    .every((url) => !allowedIn(url, badEntries)) && allowedIn('https://api.deepseek.com/v1', badEntries))
  check('A8b 替换单里一条有效的都没有 → 除本机外全拒（fail-closed）',
    !allowedIn('https://api.deepseek.com/v1', { AI_ENDPOINT_ALLOWLIST: 'https://api.deepseek.com/v1' }) &&
    allowedIn('http://127.0.0.1:9/x', { AI_ENDPOINT_ALLOWLIST: 'https://api.deepseek.com/v1' }))

  // 拒绝日志只含主机名：百度换 token 的查询串里就是密钥
  capturedLogs.length = 0
  const leakProbe = caughtSync(() => assertAiEndpointAllowed('https://token.evil.example/oauth/2.0/token?client_secret=SECRET-9f3a&client_id=ID-77', 'ocr'))
  const leakLog = capturedLogs.join('\n')
  check('A9 拒绝时抛 AiEndpointNotAllowedError（带规范化主机名与原因）',
    leakProbe instanceof AiEndpointNotAllowedError && leakProbe.host === 'token.evil.example' && leakProbe.reason === 'host_not_allowed' && leakProbe.message === 'AI_ENDPOINT_NOT_ALLOWED')
  check('A9b 拒绝日志只有服务类别、主机名与原因', /service=ocr host=token\.evil\.example reason=host_not_allowed/.test(leakLog), leakLog)
  check('A9c 拒绝日志不含路径、查询串与密钥', !/SECRET-9f3a|ID-77|oauth|client_secret/.test(leakLog), leakLog)

  // ==========================================================================
  // [B] llmFetchJson：白名单外一次 fetch 都不发
  // ==========================================================================
  console.log('\n[B] llmFetchJson 统一入口')
  const { llmFetchJson, LlmConcurrencyGate } = await import('../src/ai/llm/llm-http')
  const init = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: '你好' }] }) }
  let injectedCalls = 0
  const countingFetch = (async () => { injectedCalls += 1; return jsonResponse({ choices: [{ message: { content: '好的' } }] }) }) as unknown as typeof fetch

  const blockedUrls = [
    `${DISALLOWED_LLM_BASE}/chat/completions`,
    'https://api.deepseek.com.evil.com/chat/completions',
    'https://api.deepseek.com@evil.com/chat/completions',
    'http://api.deepseek.com/chat/completions',
  ]
  for (const url of blockedUrls) {
    const gate = new LlmConcurrencyGate(2)
    injectedCalls = 0
    const error = await caught(() => llmFetchJson(url, init, { timeoutMs: 5_000, gate, fetchImpl: countingFetch }))
    check(`B1 白名单外被拒且注入的 fetch 一次都没调：${url}`,
      error instanceof AiEndpointNotAllowedError && injectedCalls === 0 && gate.inFlightCount === 0,
      `error=${(error as Error | null)?.name} calls=${injectedCalls} inFlight=${gate.inFlightCount}`)
  }
  {
    const gate = new LlmConcurrencyGate(2)
    injectedCalls = 0
    const error = await withEnv(PROD, () => caught(() => llmFetchJson('http://127.0.0.1:9/chat/completions', init, { timeoutMs: 5_000, gate, fetchImpl: countingFetch })))
    check('B2 生产环境指向本机：被拒且一次都没调', error instanceof AiEndpointNotAllowedError && injectedCalls === 0)
  }
  {
    injectedCalls = 0
    const res = await llmFetchJson('https://api.deepseek.com/chat/completions', init, { timeoutMs: 5_000, gate: new LlmConcurrencyGate(2), fetchImpl: countingFetch })
    check('B3 阳性对照：白名单内的地址照常发出（计数器能数到请求）', res.ok && injectedCalls === 1, `calls=${injectedCalls}`)
  }

  // ==========================================================================
  // [C] 12 个 LLM 调用点
  // ==========================================================================
  console.log('\n[C] LLM 调用点：映射成 503 + AI_ENDPOINT_NOT_ALLOWED')
  const SRC_ROOT = join(__dirname, '..', 'src')
  const callSites = walk(SRC_ROOT).filter((file) => {
    if (file.endsWith(join('ai', 'llm', 'llm-http.ts'))) return false
    return /(?:^|[^\w$.])llmFetchJson\s*\(/.test(blankComments(readFileSync(file, 'utf8')))
  })
  check('C1 派生出的 llmFetchJson 调用点不少于 12 个（扫描规则有效）', callSites.length >= 12, `只找到 ${callSites.length} 个`)
  const BRANCH = /if\s*\(\s*error\s+instanceof\s+AiEndpointNotAllowedError\s*\)\s*throw\s+llmEndpointNotAllowedError\(\)/
  for (const file of callSites) {
    const code = blankComments(readFileSync(file, 'utf8'))
    check(`C1 ${relative(SRC_ROOT, file)} 显式把白名单拒绝映射成 AI_ENDPOINT_NOT_ALLOWED（注释里的不算）`, BRANCH.test(code))
  }

  const { AI_ENDPOINT_NOT_ALLOWED, AI_ENDPOINT_NOT_ALLOWED_MESSAGE } = await import('../src/ai/llm/llm-failure')
  const configFor = (baseURL: string) => ({
    isReady: () => true,
    getApiKey: () => 'verify-only-fake-key',
    getConfig: () => ({
      vendor: 'deepseek', model: 'deepseek-v4-flash', baseURL,
      systemPrompt: '你是就业服务助手', roleScope: '', forbiddenWords: [], temperature: 0.3, enabled: true,
    }),
  })
  const expectNotAllowed = (error: unknown) => {
    const http = httpErrorOf(error)
    return http.status === 503 && http.code === AI_ENDPOINT_NOT_ALLOWED
  }
  check('C2 用户文案如实：未发出请求、内容没发送、打印扫描不受影响',
    /未发出请求/.test(AI_ENDPOINT_NOT_ALLOWED_MESSAGE) && /没有被发送/.test(AI_ENDPOINT_NOT_ALLOWED_MESSAGE) && /打印、扫描/.test(AI_ENDPOINT_NOT_ALLOWED_MESSAGE))

  const { LlmChatService } = await import('../src/ai/llm/llm-chat.service')
  resetFetchCount()
  const chatError = await caught(() => new LlmChatService(configFor(DISALLOWED_LLM_BASE) as never).chat({ message: '帮我看看简历', channel: 'kiosk' } as never))
  check('C3 AI 助手：503 + AI_ENDPOINT_NOT_ALLOWED，未发出请求', expectNotAllowed(chatError) && fetchedHosts.length === 0,
    `${JSON.stringify(httpErrorOf(chatError))} fetched=${fetchedHosts.join(',')}`)
  resetFetchCount()
  const chatOk = await new LlmChatService(configFor('https://api.deepseek.com/v1') as never).chat({ message: '帮我看看简历', channel: 'kiosk' } as never)
  check('C3b 阳性对照：同一服务配核准地址照常发出一次', typeof chatOk.reply === 'string' && fetchedHosts.length === 1, `fetched=${fetchedHosts.join(',')}`)

  const { MockInterviewLlmService } = await import('../src/mock-interview/mock-interview-llm.service')
  resetFetchCount()
  let costRecords = 0
  const interviewError = await caught(() => new MockInterviewLlmService(configFor(DISALLOWED_LLM_BASE) as never).nextQuestion({
    interviewerType: 'hr', industry: '行政', position: '行政专员', experience: 'fresh', difficulty: 'standard',
    askedCount: 0, questionTarget: 5, transcript: [],
  } as never, () => { costRecords += 1 }))
  check('C4 模拟面试：503 + AI_ENDPOINT_NOT_ALLOWED，未发出请求，也不落假账（通用分支会记一次调用）',
    expectNotAllowed(interviewError) && fetchedHosts.length === 0 && costRecords === 0,
    `${JSON.stringify(httpErrorOf(interviewError))} fetched=${fetchedHosts.length} cost=${costRecords}`)

  const { JobAiLlmService } = await import('../src/job-ai/job-ai-llm.service')
  resetFetchCount()
  const jobError = await caught(() => new JobAiLlmService(configFor(DISALLOWED_LLM_BASE) as never).explain({
    jobId: 'j1', title: '行政专员', company: '某公司', sourceName: '来源', sourceUrl: 'https://example.com/j1',
    externalId: 'e1', skills: [], city: '青岛',
  }))
  check('C5 岗位解读：503 + AI_ENDPOINT_NOT_ALLOWED，未发出请求', expectNotAllowed(jobError) && fetchedHosts.length === 0,
    `${JSON.stringify(httpErrorOf(jobError))} fetched=${fetchedHosts.length}`)

  // ==========================================================================
  // [D] 后台写配置与连通性测试
  // ==========================================================================
  console.log('\n[D] 后台：保存与连通性测试')
  const { LlmConfigService } = await import('../src/ai/llm/llm-config.service')
  const { AiConfigController, AiConfigsController } = await import('../src/ai/llm/ai-config.controller')
  const configFile = join(DATA_DIR, 'ai-model-configs.json')
  const config = new LlmConfigService()
  const fileSnapshot = () => (existsSync(configFile) ? readFileSync(configFile, 'utf8') : '<none>')

  const beforeFile = fileSnapshot()
  const beforeBase = config.getConfig('assistant_chat').baseURL
  const saveCases: Array<[string, Parameters<typeof config.update>[0]]> = [
    ['显式境外地址', { baseURL: DISALLOWED_LLM_BASE }],
    ['只切厂商到鱼人（预设地址不在单内）', { vendor: 'yuren' }],
    ['只切厂商到 MiniMax（预设地址不在单内）', { vendor: 'minimax' }],
    ['核准主机但用 http', { baseURL: 'http://api.deepseek.com/v1' }],
    ['后缀伪装', { baseURL: 'https://api.deepseek.com.evil.com/v1' }],
  ]
  for (const [label, patch] of saveCases) {
    const error = caughtSync(() => config.update(patch, 'assistant_chat'))
    const http = httpErrorOf(error)
    check(`D1 保存被拒：${label} → 400 AI_BASE_URL_NOT_ALLOWED`, http.status === 400 && http.code === 'AI_BASE_URL_NOT_ALLOWED', JSON.stringify(http))
  }
  check('D1b 被拒的保存没有落盘、内存配置也没变', fileSnapshot() === beforeFile && config.getConfig('assistant_chat').baseURL === beforeBase)
  const saveMessage = httpErrorOf(caughtSync(() => config.update({ baseURL: DISALLOWED_LLM_BASE }, 'assistant_chat'))).message ?? ''
  check('D1c 保存被拒的文案说清原因与去向', saveMessage.includes('不在已核准的服务商名单里') && saveMessage.includes('未保存'), saveMessage)
  const switched = config.update({ vendor: 'qwen' }, 'assistant_chat')
  check('D1d 阳性对照：切到核准厂商（千问）可以保存', switched.vendor === 'qwen' && switched.baseURL.startsWith('https://dashscope.aliyuncs.com'))

  let auditWrites = 0
  let chatTests = 0
  const auditStub = { write: async () => { auditWrites += 1 } }
  const chatStub = { test: async () => { chatTests += 1; return { ok: true } } }
  const admin = { userId: 'admin-verify', role: 'admin', orgId: null } as never
  const req = { headers: {}, ip: '127.0.0.1' }
  const controller = new AiConfigsController(config as never, chatStub as never, auditStub as never)
  const legacyController = new AiConfigController(config as never, chatStub as never, auditStub as never)
  const putError = await caught(() => controller.updateOne('assistant_chat', { baseURL: DISALLOWED_LLM_BASE }, admin, req))
  check('D2 PUT /admin/ai-configs/:featureKey 境外地址 → 400 AI_BASE_URL_NOT_ALLOWED，不写审计',
    httpErrorOf(putError).code === 'AI_BASE_URL_NOT_ALLOWED' && auditWrites === 0, JSON.stringify(httpErrorOf(putError)))

  // 走查：非生产要能在后台把模型地址配到本机假大模型（两道校验都放行回环）；生产两道都拒。
  const loopbackBase = 'http://127.0.0.1:18080/v1'
  const baseBeforeLoopback = config.getConfig('assistant_chat').baseURL
  const prodPutError = await withEnv(PROD, () => caught(() => controller.updateOne('assistant_chat', { baseURL: loopbackBase }, admin, req)))
  check('D2b 生产 PUT 回环模型地址 → 400 AI_BASE_URL_PRIVATE，不写审计、不改配置',
    httpErrorOf(prodPutError).code === 'AI_BASE_URL_PRIVATE' && auditWrites === 0 && config.getConfig('assistant_chat').baseURL === baseBeforeLoopback,
    JSON.stringify(httpErrorOf(prodPutError)))
  await withEnv({ NODE_ENV: 'development' }, () => controller.updateOne('assistant_chat', { baseURL: loopbackBase }, admin, req))
  check('D2c 非生产 PUT 回环模型地址（本机假大模型）→ 保存成功并写审计',
    config.getConfig('assistant_chat').baseURL === loopbackBase && auditWrites === 1)
  chatTests = 0
  await withEnv({ NODE_ENV: 'development' }, () => controller.testOne('assistant_chat'))
  const prodTestError = await withEnv(PROD, () => caught(() => controller.testOne('assistant_chat')))
  check('D2d 回环地址的连通性测试：非生产进入测试，生产拒绝且不调用测试',
    chatTests === 1 && httpErrorOf(prodTestError).code === 'AI_BASE_URL_PRIVATE', `chatTests=${chatTests} ${JSON.stringify(httpErrorOf(prodTestError))}`)
  config.update({ baseURL: baseBeforeLoopback }, 'assistant_chat')
  auditWrites = 0

  // 存量地址：白名单收紧前存下的地址（先按追加单保存，再把追加撤掉）
  await withEnv({ AI_ENDPOINT_ALLOWLIST_EXTRA: 'api.moonshot.cn' }, () => {
    config.update({ baseURL: 'https://api.moonshot.cn/v1' }, 'career_plan')
  })
  check('D3 前置：存量地址已保存（追加单生效时）', config.getConfig('career_plan').baseURL === 'https://api.moonshot.cn/v1')
  resetFetchCount()
  chatTests = 0
  const testOneError = await caught(() => controller.testOne('career_plan'))
  check('D3b POST /admin/ai-configs/:featureKey/test 存量未核准地址 → 400，未调用测试、未发请求',
    httpErrorOf(testOneError).code === 'AI_BASE_URL_NOT_ALLOWED' && chatTests === 0 && fetchedHosts.length === 0,
    `${JSON.stringify(httpErrorOf(testOneError))} chatTests=${chatTests}`)
  const testMessage = httpErrorOf(testOneError).message ?? ''
  check('D3c 测试被拒的文案说明没有发出请求', testMessage.includes('未测试') && testMessage.includes('没有发出请求'), testMessage)
  chatTests = 0
  const legacyTestError = await caught(() => legacyController.test({ feature: 'career_plan' }))
  check('D3d POST /admin/ai-config/test（旧端点）同样拒绝且未调用测试',
    httpErrorOf(legacyTestError).code === 'AI_BASE_URL_NOT_ALLOWED' && chatTests === 0, JSON.stringify(httpErrorOf(legacyTestError)))
  chatTests = 0
  const okTest = await controller.testOne('assistant_chat')
  check('D3e 阳性对照：核准地址的连通性测试照常进入测试', (okTest as { ok?: boolean }).ok === true && chatTests === 1)
  resetFetchCount()
  const realTest = await new LlmChatService(config as never).test('career_plan')
  check('D3f 双保险：即使绕过控制器直接测试，运行时判定也不发请求（非判别性断言，只证明底座在）',
    realTest.ok === false && fetchedHosts.length === 0, `fetched=${fetchedHosts.join(',')}`)

  // ==========================================================================
  // [E] 非 LLM 出站点
  // ==========================================================================
  console.log('\n[E] OCR / 语音识别 / 语音合成 / 数字人 / 短信 / 合同审查')
  const png = Buffer.from('89504e470d0a1a0a', 'hex')

  // ── OCR ──
  const { BaiduOcrProvider } = await import('../src/ai/resume/ocr/baidu-ocr.provider')
  const ocrEnv: EnvPatch = { BAIDU_OCR_API_KEY: 'stub-api-key', BAIDU_OCR_SECRET_KEY: 'stub-secret-key' }
  resetFetchCount()
  const ocrBlocked = await withEnv({ ...ocrEnv, BAIDU_OCR_BASE_URL: 'https://ocr.not-approved.example' },
    () => new BaiduOcrProvider().recognize({ buffer: png, mimeType: 'image/png' }))
  check('E1 OCR：白名单外被拒（OCR_NOT_CONFIGURED + 如实文案），换 token 与识别都没发',
    !ocrBlocked.ok && ocrBlocked.errorCode === 'OCR_NOT_CONFIGURED' && /未通过核准/.test(ocrBlocked.errorMessage ?? '') && fetchedHosts.length === 0,
    `${JSON.stringify(ocrBlocked)} fetched=${fetchedHosts.join(',')}`)
  resetFetchCount()
  const ocrOk = await withEnv(ocrEnv, () => new BaiduOcrProvider().recognize({ buffer: png, mimeType: 'image/png' }))
  check('E1b OCR 阳性对照：默认地址照常换 token + 识别（2 个请求）', ocrOk.ok === true && fetchedHosts.length === 2, `fetched=${fetchedHosts.join(',')}`)

  // ── 语音识别：腾讯 ──
  const { AsrService } = await import('../src/asr/asr.service')
  const wav = Buffer.alloc(64, 1)
  const asrTencentEnv: EnvPatch = { ASR_PROVIDER: 'tencent', TENCENT_SECRET_ID: 'stub-id', TENCENT_SECRET_KEY: 'stub-key' }
  resetFetchCount()
  const asrBlocked = await withEnv({ ...asrTencentEnv, TENCENT_ASR_HOST: 'asr.not-approved.example' }, () => new AsrService().recognizeWav(wav))
  check('E2 语音识别（腾讯）：白名单外被拒（ASR_NOT_CONFIGURED，前端回退文字输入），未发出请求',
    !asrBlocked.ok && asrBlocked.errorCode === 'ASR_NOT_CONFIGURED' && fetchedHosts.length === 0, `${JSON.stringify(asrBlocked)} fetched=${fetchedHosts.length}`)
  resetFetchCount()
  const asrProdLoopback = await withEnv({ ...asrTencentEnv, ...PROD, TENCENT_ASR_HOST: '127.0.0.1:18080' }, () => new AsrService().recognizeWav(wav))
  check('E2b 语音识别（腾讯）：生产指向本机 stub 被拒，未发出请求', !asrProdLoopback.ok && fetchedHosts.length === 0)
  resetFetchCount()
  const asrOk = await withEnv(asrTencentEnv, () => new AsrService().recognizeWav(wav))
  check('E2c 语音识别（腾讯）阳性对照：默认地址照常发出', asrOk.ok === true && fetchedHosts.length === 1, `fetched=${fetchedHosts.join(',')}`)

  // ── 语音识别：百度 ──
  const asrBaiduEnv: EnvPatch = { ASR_PROVIDER: 'baidu', BAIDU_ASR_API_KEY: 'stub-api-key', BAIDU_ASR_SECRET_KEY: 'stub-secret-key' }
  resetFetchCount()
  const vopBlocked = await withEnv({ ...asrBaiduEnv, BAIDU_ASR_VOP_URL: 'https://vop.not-approved.example/server_api' }, () => new AsrService().recognizeWav(wav))
  check('E3 语音识别（百度）：识别地址不在单内 → 被拒，连换 token 都没发',
    !vopBlocked.ok && vopBlocked.errorCode === 'ASR_NOT_CONFIGURED' && fetchedHosts.length === 0, `fetched=${fetchedHosts.join(',')}`)
  resetFetchCount()
  const tokenBlocked = await withEnv({ ...asrBaiduEnv, BAIDU_ASR_BASE_URL: 'https://token.not-approved.example' }, () => new AsrService().recognizeWav(wav))
  check('E3b 语音识别（百度）：换 token 地址不在单内 → 被拒，未发出请求（查询串里是密钥）',
    !tokenBlocked.ok && tokenBlocked.errorCode === 'ASR_NOT_CONFIGURED' && fetchedHosts.length === 0, `fetched=${fetchedHosts.join(',')}`)
  resetFetchCount()
  const baiduOk = await withEnv(asrBaiduEnv, () => new AsrService().recognizeWav(wav))
  check('E3c 语音识别（百度）阳性对照：默认地址换 token + 识别（2 个请求）', baiduOk.ok === true && fetchedHosts.length === 2, `fetched=${fetchedHosts.join(',')}`)

  // ── 语音合成 ──
  const { TtsService } = await import('../src/mock-interview/asr/tts.service')
  const ttsEnv: EnvPatch = { TENCENT_SECRET_ID: 'stub-id', TENCENT_SECRET_KEY: 'stub-key' }
  resetFetchCount()
  const ttsBlocked = await withEnv({ ...ttsEnv, TENCENT_TTS_HOST: 'tts.not-approved.example' }, () => new TtsService().synthesize('请做个自我介绍。'))
  check('E4 语音合成：白名单外被拒（前端降级本地播报），一段都没发', !ttsBlocked.ok && /未通过核准/.test(ttsBlocked.errorMessage ?? '') && fetchedHosts.length === 0,
    `${JSON.stringify(ttsBlocked)} fetched=${fetchedHosts.length}`)
  resetFetchCount()
  const ttsOk = await withEnv(ttsEnv, () => new TtsService().synthesize('请做个自我介绍。'))
  check('E4b 语音合成阳性对照：默认地址照常发出', ttsOk.ok === true && fetchedHosts.length === 1, `fetched=${fetchedHosts.join(',')}`)

  // ── 数字人（TRTC）──
  const { TrtcService } = await import('../src/trtc/trtc.service')
  const { callTencentApi } = await import('../src/trtc/tencent-api.util')
  const trtcEnv: EnvPatch = {
    TRTC_SDK_APP_ID: '1400000000', TRTC_SDK_SECRET_KEY: 'stub-sdk-secret', TENCENT_SECRET_ID: 'stub-id',
    TENCENT_SECRET_KEY: 'stub-key', TRTC_LLM_API_KEY: 'stub-llm-key', TRTC_TTS_APP_ID: '1300000000',
  }
  const trtcCases: Array<[string, EnvPatch]> = [
    ['代调模型地址在境外（TRTC_LLM_API_URL）', { TRTC_LLM_API_URL: 'https://api.openai.com/v1/chat/completions' }],
    ['整段模型配置没写地址（落到厂商默认地址，核对不了）', { TRTC_LLM_CONFIG_JSON: '{"LLMType":"dify","APIKey":"x"}' }],
    ['整段模型配置不是 JSON', { TRTC_LLM_CONFIG_JSON: 'not-json' }],
    ['整段模型配置夹带第二个境外地址', { TRTC_LLM_CONFIG_JSON: '{"LLMType":"openai","APIUrl":"https://api.deepseek.com/v1/chat/completions","APIBaseUrl":"https://api.openai.com"}' }],
    ['语音合成换成境外厂商（无地址可核）', { TRTC_TTS_CONFIG_JSON: '{"TTSType":"elevenlabs","APIKey":"x","VoiceId":"v"}' }],
    ['语音合成自定义地址不在单内', { TRTC_TTS_CONFIG_JSON: '{"TTSType":"custom","APIUrl":"https://tts.example.com/v1"}' }],
    ['腾讯云主机被移出白名单', { AI_ENDPOINT_ALLOWLIST: 'api.deepseek.com' }],
  ]
  for (const [label, patch] of trtcCases) {
    resetFetchCount()
    const error = await withEnv({ ...trtcEnv, ...patch }, () => caught(() => new TrtcService().startSession('user-verify')))
    check(`E5 数字人建房被拒：${label} → 503 AI_ENDPOINT_NOT_ALLOWED，未调腾讯云`, expectNotAllowed(error) && fetchedHosts.length === 0,
      `${JSON.stringify(httpErrorOf(error))} fetched=${fetchedHosts.join(',')}`)
  }
  resetFetchCount()
  const stopError = await withEnv({ ...trtcEnv, AI_ENDPOINT_ALLOWLIST: 'api.deepseek.com' }, () => caught(() => new TrtcService().stopSession('task-1')))
  check('E5b 结束对话同样过白名单：503 AI_ENDPOINT_NOT_ALLOWED（不报成「请重试」），未发出请求',
    expectNotAllowed(stopError) && fetchedHosts.length === 0, JSON.stringify(httpErrorOf(stopError)))
  resetFetchCount()
  const directError = await withEnv({ AI_ENDPOINT_ALLOWLIST: 'api.deepseek.com' }, () => caught(() =>
    callTencentApi({ secretId: 'a', secretKey: 'b', region: 'ap-guangzhou', action: 'StopAIConversation', payload: { TaskId: 't' } })))
  check('E5c callTencentApi 本身（写死的主机）也过白名单', directError instanceof AiEndpointNotAllowedError && fetchedHosts.length === 0)
  resetFetchCount()
  const session = await withEnv(trtcEnv, () => new TrtcService().startSession('user-verify'))
  check('E5d 数字人阳性对照：默认配置照常建房（1 个请求）', session.taskId === 'task-verify' && fetchedHosts.length === 1, `fetched=${fetchedHosts.join(',')}`)
  resetFetchCount()
  const tencentTts = await withEnv({ ...trtcEnv, TRTC_TTS_CONFIG_JSON: '{"TTSType":"tencent","AppId":1300000000,"SecretId":"a","SecretKey":"b","VoiceType":1008}' },
    () => new TrtcService().startSession('user-verify'))
  check('E5e 阳性对照：整段语音合成配置用腾讯云自家类型时放行', tencentTts.taskId === 'task-verify' && fetchedHosts.length === 1)

  // ── 短信 ──
  const { TencentSmsSender, SmsSendError } = await import('../src/member-auth/sms/sms-sender')
  const smsConfig = (host: string) => ({
    secretId: 'stub-id', secretKey: 'stub-key', sdkAppId: '1400000000', signName: '签名', templateId: '123456', region: 'ap-guangzhou', host,
  })
  resetFetchCount()
  const smsError = await caught(() => new TencentSmsSender(smsConfig('sms.not-approved.example')).sendCode('13800000000', '123456'))
  check('E6 短信：白名单外被拒（SMS_SEND_FAILED 分类码 endpoint_not_allowed），手机号没有发出',
    smsError instanceof SmsSendError && smsError.providerCode === 'endpoint_not_allowed' && fetchedHosts.length === 0,
    `providerCode=${(smsError as { providerCode?: string } | null)?.providerCode} fetched=${fetchedHosts.length}`)
  resetFetchCount()
  const smsProdError = await withEnv(PROD, () => caught(() => new TencentSmsSender(smsConfig('127.0.0.1:18080')).sendCode('13800000000', '123456')))
  check('E6b 短信：生产指向本机 stub 被拒，未发出请求', smsProdError instanceof SmsSendError && fetchedHosts.length === 0)
  resetFetchCount()
  await new TencentSmsSender(smsConfig('sms.tencentcloudapi.com')).sendCode('13800000000', '123456')
  check('E6c 短信阳性对照：默认主机照常发出', fetchedHosts.length === 1)

  // ── 合同审查 ──
  const provider = await import('../src/contract-review/contract-review-provider.service')
  const failureReason = await import('../src/contract-review/contract-review-failure-reason')
  let contractCalls = 0
  const contractFetch = async () => {
    contractCalls += 1
    return jsonResponse({ choices: [{ message: { content: '{"findings":[]}' } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })
  }
  const transport = new provider.StrictFetchContractProviderTransport(contractFetch)
  const transportError = await caught(() => transport.send({
    url: 'https://api.openai.com/v1/chat/completions', apiKey: 'verify-only-key-0123456789',
    payload: { model: 'm', messages: [{ role: 'system', content: 's' }, { role: 'user', content: 'u' }], response_format: { type: 'json_object' }, temperature: 0 },
    timeoutMs: 5_000,
  }))
  check('E7 合同审查传输层：白名单外被拒（CONTRACT_PROVIDER_ENDPOINT_NOT_ALLOWED），一次都没调',
    (transportError as Error | null)?.message === 'CONTRACT_PROVIDER_ENDPOINT_NOT_ALLOWED' && contractCalls === 0,
    `${(transportError as Error | null)?.message} calls=${contractCalls}`)
  const contractEnv = {
    CONTRACT_REVIEW_PROVIDER: 'deepseek', CONTRACT_REVIEW_BASE_URL: 'https://api.deepseek.com/',
    CONTRACT_REVIEW_MODEL: 'deepseek-v4-pro', CONTRACT_REVIEW_API_KEY: 'verify-only-key-0123456789',
  }
  const reviewInput = {
    pages: [{ pageNumber: 1, text: '试用期为六个月。' }],
    partyFacts: { hasPartyA: true, hasPartyB: true, hasEmployer: true, hasWorker: true, hasUscc: false, hasBankAccount: false },
  }
  const service = new provider.ContractReviewProviderService({
    env: () => contractEnv,
    approvalGate: { assertApproved: () => undefined },
    transport,
  })
  contractCalls = 0
  const reviewError = await withEnv({ AI_ENDPOINT_ALLOWLIST: 'dashscope.aliyuncs.com' }, () => caught(() => service.reviewWithIdentity(reviewInput)))
  check('E7b 合同审查整链：DeepSeek 被移出白名单 → 报 ENDPOINT_NOT_ALLOWED（不塌成 TRANSPORT_FAILED），未发出请求',
    (reviewError as Error | null)?.message === 'CONTRACT_PROVIDER_ENDPOINT_NOT_ALLOWED' && contractCalls === 0,
    `${(reviewError as Error | null)?.message} calls=${contractCalls}`)
  contractCalls = 0
  const reviewed = await service.reviewWithIdentity(reviewInput)
  check('E7c 合同审查阳性对照：默认单下照常发出一次', Array.isArray(reviewed.draft.findings) && contractCalls === 1, `calls=${contractCalls}`)
  const reason = failureReason.contractReviewFailureReason('CONTRACT_PROVIDER_ENDPOINT_NOT_ALLOWED')
  check('E7d 合同审查失败原因已登记，文案如实且不漏机器码 / 厂商名',
    failureReason.isKnownContractReviewFailureCode('CONTRACT_PROVIDER_ENDPOINT_NOT_ALLOWED') && reason.includes('未发出请求') &&
      !/CONTRACT_|deepseek|qwen|DeepSeek|provider/.test(reason), reason)

  const leakedSecrets = capturedLogs.filter((line) => /stub-secret-key|stub-key|verify-only-key|client_secret|access_token=/.test(line))
  check('E8 全程日志不含密钥 / token', leakedSecrets.length === 0, leakedSecrets.slice(0, 3).join(' | '))
}

function caughtSync(fn: () => unknown): unknown {
  try {
    fn()
    return null
  } catch (error) {
    return error
  }
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === 'generated' || entry === 'node_modules') continue
      walk(full, out)
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts') && !entry.includes('.test.')) {
      out.push(full)
    }
  }
  return out
}

/** 把注释抹成等长空格：被注释掉的分支不能让静态断言变绿。`https://` 里的 `//` 不误伤。 */
function blankComments(source: string): string {
  let out = source.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  out = out.replace(/(^|[^:])\/\/[^\n]*/g, (m, prefix: string) => prefix + ' '.repeat(m.length - prefix.length))
  return out
}

main()
  .then(() => {
    globalThis.fetch = realFetch
    clearTimeout(globalWatchdog)
    console.log(`\n${failures.length === 0 ? 'PASSED' : 'FAILED'}  通过 ${passed} 条，失败 ${failures.length} 条`)
    for (const failure of failures) console.log(`  - ${failure}`)
    process.exitCode = failures.length === 0 ? 0 : 1
  })
  .catch((error: unknown) => {
    globalThis.fetch = realFetch
    clearTimeout(globalWatchdog)
    console.log(`\nFAILED  门禁异常中止：${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`)
    process.exitCode = 1
  })
