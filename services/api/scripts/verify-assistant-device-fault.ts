/**
 * 小青被问到设备故障（卡纸、缺纸、打不出来、机器坏了、冒烟、异响）时，写给模型的那一句约束。
 *
 * 起因是真机实操 F-04（2026-10-10）：一体机上问「打印机卡纸怎么办」，模型教人
 * 自己打开前盖和纸盒抽纸。现场无人值守，用户自己拆机可能受伤、也可能把机器弄坏。
 *
 * 这条门禁只管「这一句在不在、字对不对、真的发给了模型」：
 *   1. 字：和合规定稿逐字相同；句子里除了 119 没有别的数字（不许带电话号码）
 *   2. 拼装：小青文字、语音小青、下发给腾讯云的语音配置、作业面问答，四处提示词里都有；
 *      加这一句没有把提示词原有的各段挤掉或打乱
 *   3. 运行时：小青文字（一体机、小程序两个渠道，含带技能的）、作业面问答真正发给模型的系统提示词里，
 *      以及开语音会话时真正下发给腾讯云的配置里，都带着这一句
 *
 * 它不验证模型听不听这句话——那要接真模型问十种说法留样本，归走查。
 * 「卡住了怎么办」输入侧不拦，照样送模型，用来核对提示词里有这一句。
 * 「打印机卡纸怎么办」由输入侧拦下：不发请求，回固定的话。
 *
 * 不触网、不碰库（fetch 换成假实现）。
 * 运行：pnpm --filter @ai-job-print/api verify:assistant-device-fault
 */
import { DEVICE_FAULT_PROMPT_RULE, deviceFaultReply } from '../src/ai/safety/device-fault'
import { LlmChatService } from '../src/ai/llm/llm-chat.service'
import { buildGuardedSystemPrompt } from '../src/ai/llm/llm-guard'
import { ADVISOR_QA_SYSTEM_PROMPT, LlmAdvisorService } from '../src/advisor/llm-advisor.service'
import { guardTrtcLlmConfigJson } from '../src/trtc/trtc-llm-safety'
import { TrtcService } from '../src/trtc/trtc.service'
import { ANONYMOUS_AI_CALLER, lazyAiRequestContext, runWithAiRequestContext } from '../src/ai/usage/ai-usage-context'

// 招聘内容托管按线上口径关着跑（小青的跳转过滤读这个开关）；本脚本不验证招聘内容。
process.env['RECRUITMENT_CONTENT_HOSTING_ENABLED'] = 'false'

let passCount = 0
let failCount = 0
function pass(msg: string) { passCount += 1; console.log(`  PASS ${msg}`) }
function fail(msg: string) { failCount += 1; console.error(`  FAIL ${msg}`) }
function check(ok: boolean, msg: string) { if (ok) pass(msg); else fail(msg) }

/** 这些片段按先后顺序都出现在文本里（每个都从上一个的后面找起）。 */
function inOrder(text: string, parts: readonly string[]): boolean {
  let from = 0
  for (const part of parts) {
    const at = text.indexOf(part, from)
    if (at < 0) return false
    from = at + part.length
  }
  return true
}

// ─── 1. 字 ───────────────────────────────────────────────────────────────────

/**
 * 合规定稿全文（2026-10-10）。这里单独抄一份当对照，不引用源码里的常量：
 * 源码里的字被改动一个字，这条就红。要改字先过合规，再同时改源码和这里。
 */
const APPROVED_RULE =
  '设备故障：用户问到打印机或本机卡纸、缺纸、打不出来、损坏、冒烟、异响等故障时，不要教用户打开机器、取纸、按机身按键或拔插电源，' +
  '也不要说已经有人收到提醒或会来处理；不要自己说出任何电话号码，不要提退款或订单状态。' +
  '只提醒不要自行处理、可以稍后再来，并请用户查看帮助页上的联系方式；说到冒烟、焦味或明火时，先提醒离开机器，有明火或人身危险拨打 119。'

function wordingChecks(): void {
  check(DEVICE_FAULT_PROMPT_RULE === APPROVED_RULE, '约束句和合规定稿逐字相同')
  // 下面逐个半句再查一遍，只为了红的时候能一眼看出少的是哪一句。
  for (const must of [
    '用户问到打印机或本机卡纸、缺纸、打不出来、损坏、冒烟、异响等故障时',
    '不要教用户打开机器、取纸、按机身按键或拔插电源',
    '不要说已经有人收到提醒或会来处理',
    '不要自己说出任何电话号码',
    '不要提退款或订单状态',
    '只提醒不要自行处理、可以稍后再来',
    '请用户查看帮助页上的联系方式',
    '说到冒烟、焦味或明火时，先提醒离开机器',
    '有明火或人身危险拨打 119',
  ]) {
    check(DEVICE_FAULT_PROMPT_RULE.includes(must), `约束句有「${must}」`)
  }
  const digits = DEVICE_FAULT_PROMPT_RULE.match(/\d+/g) ?? []
  check(digits.length === 1 && digits[0] === '119', '约束句里唯一的数字是 119（不带任何电话号码）')
}

// ─── 2. 拼装 ─────────────────────────────────────────────────────────────────

function compositionChecks(): void {
  const text = buildGuardedSystemPrompt({ systemPrompt: '你是就业服务助手' })
  check(text.includes('你是就业服务助手'), '阳性对照：小青文字的系统约束确实是从配置拼出来的')
  check(text.includes(DEVICE_FAULT_PROMPT_RULE), '小青文字对话的系统约束里有这一句')
  // 加这一句不能把原有的几段挤掉或打乱：配置的提示词、角色范围、输出边界、（这一句）、禁用词规则、回答长度。
  check(inOrder(text, ['你是就业服务助手', '角色范围：', '输出边界：', DEVICE_FAULT_PROMPT_RULE, '禁用词规则：', '回答长度：']),
    '小青文字的系统约束：原有各段都在、顺序没变，这一句排在输出边界和禁用词规则之间')
  check(text.split(DEVICE_FAULT_PROMPT_RULE).length === 2, '小青文字的系统约束里这一句只出现一次')
  const voice = buildGuardedSystemPrompt({ systemPrompt: '你是小青' }, { policyVariant: 'voice' })
  check(voice.includes(DEVICE_FAULT_PROMPT_RULE), '语音小青的系统约束里有这一句')
  check(inOrder(voice, ['你是小青', '角色范围：', '输出边界：', DEVICE_FAULT_PROMPT_RULE, '禁用词规则：', '回答长度：']),
    '语音小青的系统约束：原有各段都在、顺序没变')

  // 语音小青的话由腾讯云直接调模型，不经过后端：下发给腾讯云的配置里必须带着这一句。
  const trtc = JSON.parse(guardTrtcLlmConfigJson(
    JSON.stringify({ LLMType: 'openai', SystemPrompt: '你是小青，说话简短' }), { systemPrompt: '兜底提示词' },
  )) as { SystemPrompt?: string }
  check(String(trtc.SystemPrompt).includes('你是小青，说话简短'), '阳性对照：下发给腾讯云的提示词确实是从配置拼出来的')
  check(String(trtc.SystemPrompt).includes(DEVICE_FAULT_PROMPT_RULE), '下发给腾讯云的语音小青提示词里有这一句')

  // 作业面问答：原有五条硬性要求和输出格式一样不少，这一句是第 6 条、排在格式要求前面。
  check(inOrder(ADVISOR_QA_SYSTEM_PROMPT, [
    '硬性要求：',
    '\n1. 你没有任何检索能力',
    '\n2. 不承诺录用',
    '\n3. 不替用户做投递或预约决定',
    '\n4. 没有依据时必须明说',
    '\n5. sourceNote 要如实写清',
    `\n6. ${DEVICE_FAULT_PROMPT_RULE}`,
    '\n只输出 JSON',
    '"answer"',
    '"evidenceLevel"',
    '"sourceNote"',
    'evidenceLevel 口径',
  ]), '作业面问答的提示词：原有五条和输出格式都在、顺序没变，这一句是第 6 条，排在「只输出 JSON」前面')
  check(!ADVISOR_QA_SYSTEM_PROMPT.includes('\n7. '), '作业面问答的硬性要求一共六条，没有多出别的')
  check(ADVISOR_QA_SYSTEM_PROMPT.split(DEVICE_FAULT_PROMPT_RULE).length === 2, '作业面问答的提示词里这一句只出现一次')
}

// ─── 3. 运行时：真正发出去的系统提示词 ───────────────────────────────────────

interface SentBody { messages: Array<{ role: string; content: string }> }

async function runtimeChecks(): Promise<void> {
  const llmConfig = {
    vendor: 'openai', model: 'm', baseURL: 'http://127.0.0.1/v1', systemPrompt: '你是就业服务助手',
    roleScope: '', forbiddenWords: [] as string[], temperature: 0, enabled: true,
  }
  const configStub = { getApiKey: () => 'verify-key', getConfig: () => llmConfig, isReady: () => true }
  const chat = new LlmChatService(configStub as never)
  const advisor = new LlmAdvisorService(configStub as never)
  const sent: SentBody[] = []
  const tencentPayloads: Array<Record<string, unknown>> = []
  let modelReply = '模型的回答'
  const savedFetch = globalThis.fetch
  ;(globalThis as { fetch: unknown }).fetch = async (url: string, init: RequestInit) => {
    if (String(url).includes('tencentcloudapi.com')) {
      tencentPayloads.push(JSON.parse(String(init.body)) as Record<string, unknown>)
      const body = { Response: { TaskId: 'task_verify', RequestId: 'req_verify' } }
      return { ok: true, status: 200, statusText: 'OK', json: async () => body, text: async () => JSON.stringify(body) } as Response
    }
    sent.push(JSON.parse(String(init.body)) as SentBody)
    const body = { choices: [{ message: { content: modelReply } }] }
    return { ok: true, status: 200, statusText: 'OK', json: async () => body, text: async () => JSON.stringify(body) } as Response
  }
  const inRequest = <T>(fn: () => Promise<T>) =>
    runWithAiRequestContext(lazyAiRequestContext(async () => ({ ...ANONYMOUS_AI_CALLER })), fn)
  const systemOf = (body: SentBody | undefined) => body?.messages.find((message) => message.role === 'system')?.content ?? ''
  const userOf = (body: SentBody | undefined) => (body?.messages ?? []).filter((message) => message.role === 'user').map((message) => message.content).join('\n')

  try {
    // 「卡住了怎么办」输入侧不拦，照样送模型，只是系统提示词里多了那一句。
    for (const channel of ['kiosk', 'miniapp'] as const) {
      const label = channel === 'kiosk' ? '一体机' : '小程序'
      const before = sent.length
      const result = await inRequest(() => chat.chat({ message: '卡住了怎么办', channel } as never))
      const body = sent[before]
      check(sent.length === before + 1 && result.reply === '模型的回答', `${label}小青文字：这一问照常送给了模型（阳性对照）`)
      check(userOf(body).includes('卡住了怎么办'), `${label}小青文字：发出去的就是这一问（阳性对照）`)
      check(systemOf(body).includes('你是就业服务助手'), `${label}小青文字：系统提示词来自配置（阳性对照）`)
      check(systemOf(body).includes(DEVICE_FAULT_PROMPT_RULE), `${label}小青文字：真正发给模型的系统提示词里带着这一句`)
    }

    // 带技能的对话在公共约束后面再接一段技能说明，这一句不能因此丢掉。
    {
      const before = sent.length
      await inRequest(() => chat.chat({ message: '卡住了怎么办', channel: 'kiosk', skill: 'company_research' } as never))
      const system = systemOf(sent[before])
      check(sent.length === before + 1 && system.includes('AI 企业面试速查'), '带技能的小青文字：技能说明确实接进了系统提示词（阳性对照）')
      check(system.includes(DEVICE_FAULT_PROMPT_RULE), '带技能的小青文字：真正发给模型的系统提示词里带着这一句')
    }

    for (const channel of ['kiosk', 'miniapp'] as const) {
      const label = channel === 'kiosk' ? '一体机' : '小程序'
      const before = sent.length
      const result = await inRequest(() => chat.chat({ message: '打印机卡纸怎么办', channel } as never))
      check(sent.length === before && result.reply === deviceFaultReply(channel) && result.fixedNotice === true,
        `${label}小青文字：问「打印机卡纸怎么办」没有发请求，回的是固定的话，fixedNotice`)
    }

    modelReply = JSON.stringify({ answer: '先别自己动机器，可以稍后再来。', evidenceLevel: 'E3', sourceNote: '这是通行做法，算参考。' })
    {
      const before = sent.length
      const answer = await inRequest(() => advisor.answer('打印机卡纸了我该怎么办', []))
      const body = sent[before]
      check(sent.length === before + 1 && answer.answer === '先别自己动机器，可以稍后再来。', '作业面问答：这一问照常送给了模型并拿到回答（阳性对照）')
      check(userOf(body).includes('打印机卡纸了我该怎么办'), '作业面问答：发出去的就是这一问（阳性对照）')
      check(systemOf(body).includes(`6. ${DEVICE_FAULT_PROMPT_RULE}`), '作业面问答：真正发给模型的系统提示词里带着这一句')
    }

    // 开语音会话：走真实的 TrtcService.startSession，接住它发给腾讯云的那一次请求。
    // 用户说的话不经过后端，这一句只能靠这份下发的配置带过去。
    await withEnv({
      TRTC_SDK_APP_ID: '1400000001', TRTC_SDK_SECRET_KEY: 'verify-sdk-secret', TENCENT_SECRET_ID: 'verify-secret-id',
      TENCENT_SECRET_KEY: 'verify-secret-key', TRTC_REGION: 'ap-guangzhou', TRTC_LLM_API_KEY: 'verify-llm-key',
      TRTC_LLM_CONFIG_JSON: undefined, TRTC_TTS_CONFIG_JSON: undefined, TRTC_TTS_TYPE: undefined, TRTC_TTS_APP_ID: '1300000001',
      TRTC_SYSTEM_PROMPT: '你是语音顾问小青',
    }, async () => {
      const reserved: unknown[] = []
      const registry = { reserve: async (record: unknown) => { reserved.push(record) }, activate: async () => undefined }
      const trtcService = new TrtcService(registry as never)
      const before = tencentPayloads.length
      const session = await trtcService.startSession('verify_user')
      const payload = tencentPayloads[before]
      const llm = payload ? JSON.parse(String(payload['LLMConfig'])) as { SystemPrompt?: string } : {}
      check(tencentPayloads.length === before + 1 && session.taskId === 'task_verify' && reserved.length === 1,
        '开语音会话：确实向腾讯云发了一次开会话的请求（阳性对照）')
      check(String(llm.SystemPrompt).includes('你是语音顾问小青'), '开语音会话：下发的提示词来自配置（阳性对照）')
      check(String(llm.SystemPrompt).includes(DEVICE_FAULT_PROMPT_RULE), '开语音会话：真正下发给腾讯云的提示词里带着这一句')
    })
  } finally {
    ;(globalThis as { fetch: unknown }).fetch = savedFetch
  }
}

/** 临时设置环境变量跑一段，跑完原样恢复（undefined 表示这段时间里没有这个变量）。 */
async function withEnv(vars: Record<string, string | undefined>, fn: () => Promise<void>): Promise<void> {
  const saved = new Map<string, string | undefined>()
  for (const [key, value] of Object.entries(vars)) {
    saved.set(key, process.env[key])
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  try {
    await fn()
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

async function main(): Promise<void> {
  console.log('\n=== 小青设备故障：写给模型的约束句 ===')
  wordingChecks()
  compositionChecks()
  await runtimeChecks()
  console.log(`\nverify:assistant-device-fault ${failCount === 0 ? '通过' : '未通过'}：PASS ${passCount} / FAIL ${failCount}`)
  if (failCount > 0) process.exitCode = 1
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
