// ============================================================================
// 只读核对：DeepSeek 思考模式是否真的被关掉 + 小青音色是否还能合成
//
// 给产品负责人用**自己的密钥**在本机运行。不进 CI、不进 verify 前缀（CI 没有、
// 也不该有真实密钥）。本脚本：
//   - 不打印密钥（只打印用的是哪个环境变量名）；
//   - 不写任何文件、不连数据库；
//   - 只发极少量请求：DeepSeek 两次（同一个短问题，带 / 不带关闭思考各一次），
//     加 --tts 时再调一次腾讯云语音合成（两个字）。按官方价目，总花费不到 1 分钱。
//
// 用法（在 services/api 目录）：
//   DEEPSEEK_API_KEY=你的密钥 npx -y pnpm@11.2.2 run probe:llm-thinking-live
//   ……加 --model deepseek-v4-flash 可换模型名；加 --tts 顺带核对音色：
//   TENCENT_SECRET_ID=… TENCENT_SECRET_KEY=… npx -y pnpm@11.2.2 run probe:llm-thinking-live -- --tts
//   ……--voice 101001 可指定要核对的音色 ID（默认读 TRTC_TTS_VOICE，再默认 1008）。
//
// 怎么看结果：
//   「关闭思考」那一行 reasoning_tokens 应为 0 或没有、耗时明显更短；
//   「默认（不关）」那一行 reasoning_tokens > 0 就说明官方默认确实在思考、
//   而我们的关闭写法确实生效。
//   音色一行显示「可用」= 该音色 ID 能合成；显示错误码 = 该音色不可用或无权限。
// ============================================================================
import { randomUUID } from 'node:crypto'

import { deepseekThinkingOff } from '../src/ai/llm/deepseek-thinking'
import { tc3Sign } from '../src/common/tencent/tc3'

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const KEY_ENV_NAMES = ['DEEPSEEK_API_KEY', 'AI_LLM_API_KEY', 'TRTC_LLM_API_KEY'] as const
const QUESTION = '用一句话告诉我：打印一份简历前应该检查哪一项？'

interface ChatUsage {
  prompt_tokens?: number
  completion_tokens?: number
  completion_tokens_details?: { reasoning_tokens?: number }
}

async function askOnce(label: string, base: string, apiKey: string, body: Record<string, unknown>): Promise<void> {
  const t0 = Date.now()
  try {
    const res = await fetch(`${base.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90_000),
    })
    const ms = Date.now() - t0
    const data = (await res.json().catch(() => null)) as {
      choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>
      usage?: ChatUsage
      error?: { message?: string; code?: string }
    } | null
    if (!res.ok) {
      console.log(`  ${label}：HTTP ${res.status}，${data?.error?.code ?? ''} ${(data?.error?.message ?? '').slice(0, 120)}（${ms} ms）`)
      return
    }
    const msg = data?.choices?.[0]?.message
    const u = data?.usage
    console.log(
      `  ${label}：耗时 ${ms} ms | completion_tokens=${u?.completion_tokens ?? '无'}`
      + ` | reasoning_tokens=${u?.completion_tokens_details?.reasoning_tokens ?? '无'}`
      + ` | 有思考内容=${msg?.reasoning_content ? `是（${msg.reasoning_content.length} 字）` : '否'}`
      + ` | 回答字数=${(msg?.content ?? '').length}`,
    )
  } catch (error) {
    console.log(`  ${label}：请求失败 ${(error as Error).name}（${Date.now() - t0} ms）`)
  }
}

async function checkDeepseek(): Promise<void> {
  const keyEnv = KEY_ENV_NAMES.find((n) => process.env[n]?.trim())
  if (!keyEnv) {
    console.log(`跳过 DeepSeek：没有设置 ${KEY_ENV_NAMES.join(' / ')} 中任何一个。`)
    return
  }
  const apiKey = process.env[keyEnv]!.trim()
  const model = argValue('--model') ?? 'deepseek-flash'
  const base = process.env['DEEPSEEK_BASE_URL'] ?? 'https://api.deepseek.com'
  console.log(`DeepSeek 核对：模型 ${model}，密钥取自环境变量 ${keyEnv}（不显示内容），地址 ${base}`)
  const common = { model, messages: [{ role: 'user', content: QUESTION }], stream: false, max_tokens: 1024 }
  const off = deepseekThinkingOff(model)
  if (Object.keys(off).length === 0) console.log('  注意：这个模型名不以 deepseek 开头，共用函数不会加关闭思考字段。')
  await askOnce('默认（不关思考）', base, apiKey, common)
  await askOnce('关闭思考（代码实际发的）', base, apiKey, { ...common, ...off })
}

async function checkTtsVoice(): Promise<void> {
  const secretId = process.env['TENCENT_TTS_SECRET_ID'] || process.env['TENCENT_SECRET_ID']
  const secretKey = process.env['TENCENT_TTS_SECRET_KEY'] || process.env['TENCENT_SECRET_KEY']
  const voice = Number(argValue('--voice') ?? process.env['TRTC_TTS_VOICE'] ?? 1008)
  if (!secretId || !secretKey) {
    console.log('跳过音色核对：没有设置 TENCENT_SECRET_ID / TENCENT_SECRET_KEY。')
    return
  }
  const host = 'tts.tencentcloudapi.com'
  const payload = JSON.stringify({ Text: '你好', SessionId: randomUUID(), VoiceType: voice, Codec: 'mp3', ModelType: 1 })
  const ts = Math.floor(Date.now() / 1000)
  const t0 = Date.now()
  try {
    const res = await fetch(`https://${host}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: tc3Sign({ host, service: 'tts', payload, ts, secretId, secretKey }),
        'X-TC-Action': 'TextToVoice',
        'X-TC-Version': '2019-08-23',
        'X-TC-Timestamp': String(ts),
        'X-TC-Region': process.env['TENCENT_TTS_REGION'] ?? 'ap-guangzhou',
      },
      body: payload,
      signal: AbortSignal.timeout(20_000),
    })
    const data = (await res.json().catch(() => null)) as { Response?: { Audio?: string; Error?: { Code?: string; Message?: string } } } | null
    const err = data?.Response?.Error
    if (err) console.log(`音色 ${voice}：不可用 —— ${err.Code ?? ''} ${(err.Message ?? '').slice(0, 120)}（${Date.now() - t0} ms）`)
    else if (data?.Response?.Audio) console.log(`音色 ${voice}：可用，合成了 ${Buffer.from(data.Response.Audio, 'base64').length} 字节音频（${Date.now() - t0} ms）`)
    else console.log(`音色 ${voice}：HTTP ${res.status}，返回里既没有音频也没有错误码，请人工再试。`)
  } catch (error) {
    console.log(`音色 ${voice}：请求失败 ${(error as Error).name}`)
  }
}

async function main(): Promise<void> {
  await checkDeepseek()
  if (process.argv.includes('--tts')) await checkTtsVoice()
}

void main()
