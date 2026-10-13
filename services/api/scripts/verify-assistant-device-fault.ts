/**
 * 小青被问到设备故障（卡纸、缺纸、打不出来、机器坏了、冒烟、异响）时，写给模型的那一句约束。
 *
 * 起因是真机实操 F-04（2026-10-10）：一体机上问「打印机卡纸怎么办」，模型教人
 * 自己打开前盖和纸盒抽纸。现场无人值守，用户自己拆机可能受伤、也可能把机器弄坏。
 *
 * 这条门禁只管「这一句在不在、字对不对、真的发给了模型」：
 *   1. 字：合规定的每一个半句都在；句子里除了 119 没有别的数字（不许带电话号码）
 *   2. 拼装：小青文字、语音小青、下发给腾讯云的语音配置、作业面问答，四处提示词里都有
 *   3. 运行时：小青文字（一体机、小程序两个渠道）和作业面问答真正发给模型的系统提示词里带着这一句
 *
 * 它不验证模型听不听这句话——那要接真模型问十种说法留样本，归走查。
 * 「按关键词判成设备故障、不送模型、回固定的话」是另一条改动，不在这条门禁里。
 *
 * 不触网、不碰库（fetch 换成假实现）。
 * 运行：pnpm --filter @ai-job-print/api verify:assistant-device-fault
 */
import { DEVICE_FAULT_PROMPT_RULE } from '../src/ai/safety/device-fault'
import { LlmChatService } from '../src/ai/llm/llm-chat.service'
import { buildGuardedSystemPrompt } from '../src/ai/llm/llm-guard'
import { ADVISOR_QA_SYSTEM_PROMPT, LlmAdvisorService } from '../src/advisor/llm-advisor.service'
import { guardTrtcLlmConfigJson } from '../src/trtc/trtc-llm-safety'
import { ANONYMOUS_AI_CALLER, lazyAiRequestContext, runWithAiRequestContext } from '../src/ai/usage/ai-usage-context'

// 招聘内容托管按线上口径关着跑（小青的跳转过滤读这个开关）；本脚本不验证招聘内容。
process.env['RECRUITMENT_CONTENT_HOSTING_ENABLED'] = 'false'

let passCount = 0
let failCount = 0

/** 合规三 10/10 定字，前缀照系统约束其它行。门禁钉这句原文，不从实现里再 import。 */
const SALARY_PROMPT_RULE =
  '薪资：谈到薪资时，只讲怎么了解行情、怎么谈，不给出具体的行业或岗位薪资数字；用户自己说出的数字可以引用，但不评价它在这个行业或岗位里是高是低、合不合理。'

function pass(msg: string) { passCount += 1; console.log(`  PASS ${msg}`) }
function fail(msg: string) { failCount += 1; console.error(`  FAIL ${msg}`) }
function check(ok: boolean, msg: string) { if (ok) pass(msg); else fail(msg) }

// ─── 1. 字 ───────────────────────────────────────────────────────────────────

function wordingChecks(): void {
  // 字是合规定的（2026-10-10）。这里钉住每一个半句，改字要先过合规再来改这张表。
  for (const must of [
    '用户问到打印机或本机卡纸、缺纸、打不出来、损坏、冒烟、异响等故障时',
    '不要教用户打开机器、取纸、按机身按键或拔插电源',
    '不要说已经有人收到提醒或会来处理',
    '不要自己说出任何电话号码',
    '不要提退款或订单状态',
    '只提醒不要自行处理、可以稍后再来',
    '请用户查看帮助页上的联系方式',
    '先提醒离开机器',
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
  check(text.includes(SALARY_PROMPT_RULE), '小青文字对话的系统约束里有薪资这一句')
  const voice = buildGuardedSystemPrompt({ systemPrompt: '你是小青' }, { policyVariant: 'voice' })
  check(voice.includes(DEVICE_FAULT_PROMPT_RULE), '语音小青的系统约束里有这一句')
  check(voice.includes(SALARY_PROMPT_RULE), '语音小青的系统约束里有薪资这一句')

  // 语音小青的话由腾讯云直接调模型，不经过后端：下发给腾讯云的配置里必须带着这一句。
  const trtc = JSON.parse(guardTrtcLlmConfigJson(
    JSON.stringify({ LLMType: 'openai', SystemPrompt: '你是小青，说话简短' }), { systemPrompt: '兜底提示词' },
  )) as { SystemPrompt?: string }
  check(String(trtc.SystemPrompt).includes('你是小青，说话简短'), '阳性对照：下发给腾讯云的提示词确实是从配置拼出来的')
  check(String(trtc.SystemPrompt).includes(DEVICE_FAULT_PROMPT_RULE), '下发给腾讯云的语音小青提示词里有这一句')
  check(String(trtc.SystemPrompt).includes(SALARY_PROMPT_RULE), '下发给腾讯云的语音小青提示词里有薪资这一句')

  // 作业面问答也是小青，有自己单独的系统提示词（不经过 buildGuardedSystemPrompt）：设备故障那条两处都加了，薪资这句同样两处都要有
  check(ADVISOR_QA_SYSTEM_PROMPT.includes(`\n7. ${SALARY_PROMPT_RULE.replace(/^薪资：/, '')}`), '作业面问答的系统提示词里有薪资这一句（第 7 条）')
  const ruleAt = ADVISOR_QA_SYSTEM_PROMPT.indexOf(`\n6. ${DEVICE_FAULT_PROMPT_RULE}`)
  const formatAt = ADVISOR_QA_SYSTEM_PROMPT.indexOf('只输出 JSON')
  check(ruleAt > 0, '作业面问答的提示词第 6 条是这一句')
  check(ADVISOR_QA_SYSTEM_PROMPT.indexOf('\n5. ') > 0 && ADVISOR_QA_SYSTEM_PROMPT.indexOf('\n5. ') < ruleAt, '作业面问答：第 6 条排在第 5 条后面')
  check(formatAt > ruleAt && ruleAt > 0, '作业面问答：这一句排在「只输出 JSON」的格式要求前面，没有把格式要求挤掉')
}

// ─── 3. 运行时：真正发给模型的系统提示词 ─────────────────────────────────────

const response = (body: unknown) => ({ ok: true, status: 200, statusText: 'OK', json: async () => body }) as Response

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
  let modelReply = '模型的回答'
  const savedFetch = globalThis.fetch
  ;(globalThis as { fetch: unknown }).fetch = async (_url: string, init: RequestInit) => {
    sent.push(JSON.parse(String(init.body)) as SentBody)
    return response({ choices: [{ message: { content: modelReply } }] })
  }
  const inRequest = <T>(fn: () => Promise<T>) =>
    runWithAiRequestContext(lazyAiRequestContext(async () => ({ ...ANONYMOUS_AI_CALLER })), fn)
  const systemOf = (body: SentBody | undefined) => body?.messages.find((message) => message.role === 'system')?.content ?? ''
  const userOf = (body: SentBody | undefined) => (body?.messages ?? []).filter((message) => message.role === 'user').map((message) => message.content).join('\n')

  try {
    // 这条改动不拦任何问法：问卡纸照样送模型，只是系统提示词里多了那一句。
    for (const channel of ['kiosk', 'miniapp'] as const) {
      const label = channel === 'kiosk' ? '一体机' : '小程序'
      const before = sent.length
      const result = await inRequest(() => chat.chat({ message: '打印机卡纸怎么办', channel } as never))
      const body = sent[before]
      check(sent.length === before + 1 && result.reply === '模型的回答', `${label}小青文字：这一问照常送给了模型（阳性对照）`)
      check(userOf(body).includes('打印机卡纸怎么办'), `${label}小青文字：发出去的就是这一问（阳性对照）`)
      check(systemOf(body).includes('你是就业服务助手'), `${label}小青文字：系统提示词来自配置（阳性对照）`)
      check(systemOf(body).includes(DEVICE_FAULT_PROMPT_RULE), `${label}小青文字：真正发给模型的系统提示词里带着这一句`)
    }

    modelReply = JSON.stringify({ answer: '先别自己动机器，可以稍后再来。', evidenceLevel: 'E3', sourceNote: '这是通行做法，算参考。' })
    const before = sent.length
    const answer = await inRequest(() => advisor.answer('打印机卡纸了我该怎么办', []))
    const body = sent[before]
    check(sent.length === before + 1 && answer.answer === '先别自己动机器，可以稍后再来。', '作业面问答：这一问照常送给了模型并拿到回答（阳性对照）')
    check(userOf(body).includes('打印机卡纸了我该怎么办'), '作业面问答：发出去的就是这一问（阳性对照）')
    check(systemOf(body).includes(`6. ${DEVICE_FAULT_PROMPT_RULE}`), '作业面问答：真正发给模型的系统提示词里带着这一句')
  } finally {
    ;(globalThis as { fetch: unknown }).fetch = savedFetch
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
