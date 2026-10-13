// ============================================================================
// 大模型价目（元 / 百万 tokens）与按 token 折算金额 —— 全仓唯一一份
//
// 为什么独立成文件：原先价目写在 ai-log.service.ts 的私有函数里，只有 AiServiceLog
// 在用。P1-2a 的逐次计量账（AiUsageRecord）与每日金额上限也要按同一份价目折算；
// 复制一份价目表，两本账就会各算各的。所以把价目抽成纯函数，两边共用：
//   - ai-log.service.ts：AiServiceLog.estimatedCostCny（后台 AI 服务统计）
//   - ai-usage-meter.ts：AiUsageRecord.costCny（额度与将来收费的计量底座）
//
// 三态语义（与 AI-COST-TRUTH 一致，不许改成 0）：
//   - 返回数字：按实测 token 与下表价目折算的金额；
//   - 返回 0：只给 mock / stub（压根不打上游，没花钱是事实）；
//   - 返回 undefined：取不到用量、或定不了价 —— 调用方必须如实留空，绝不当 0。
//
// 价目核对（2026-09-29，官方页）：
//   DeepSeek  https://api-docs.deepseek.com/zh-cn/quick_start/pricing
//     deepseek-flash（旧名 deepseek-v4-flash 仍可调，按 Flash 计费）：
//       输入（缓存未命中）空闲 1 / 高峰 2，输出 空闲 4 / 高峰 8
//     deepseek-v4-pro：输入（缓存未命中）空闲 4.5 / 高峰 9，输出 空闲 13.5 / 高峰 27
//     输入缓存命中：Flash 空闲 0.02 / 高峰 0.04；V4-Pro 空闲 0.15 / 高峰 0.30（本表不用，见下一行）。
//     高峰 = 北京时间工作日 9:00-12:00、14:00-18:00；空闲时段半价。
//     **一律按高峰价、缓存未命中价计**：宁可多算，不能少算（额度是防超支的闸）。
//     思考模式：官方默认开启、effort 默认 high；本仓各调用点显式关闭（思考 tokens 按输出计费，且拉长等待）。
//   阿里云百炼（中国内地）https://help.aliyun.com/zh/model-studio/model-pricing
//     qwen-plus：输入 ≤128K 0.8 / ≤256K 2.4 / ≤1M 4.8；输出（非思考）2 / 20 / 48
//       （思考模式输出 8 / 24 / 64；本仓调用不开思考，qwen-plus 默认也不开）
//     qwen-max：输入 ≤32K 2.5 / ≤128K 4 / ≤256K 7；输出 10 / 16 / 28
//     qwen-flash：输入 ≤128K 0.15 / ≤256K 0.6 / ≤1M 1.2；输出 1.5 / 6 / 12
//     阶梯按单次请求的输入 token 数取档。
//   认不出型号的：DeepSeek 按 V4-Pro、千问按 qwen-max，即「同厂最贵的一档」，同样宁多勿少。
//
// 非 token 计费的 AI 相关服务（本期**不计量**，只作价目记录与估算依据；接入计量时从这里取，不另写）：
//   本期不计量 = 这四项（TRTC 数字人、语音识别 ASR、语音合成 TTS、OCR）不写 AiUsageRecord、不计入三档
//   每日金额，只靠入口额度兜底：当天任一档（多半是被大模型花费）触顶后，挂在 @AiUse('voice') /
//   @AiUse('generate') 入口上的它们一起被拦 —— TRTC 开会话 POST /trtc/session 是 voice 类，会被额度拦；
//   ASR（简历语音、小青语音、面试转写）与 TTS（面试问题播报）是 voice 类；OCR 随简历解析、合同审查的
//   generate 入口被拦。例外：打印前材料检查（@AiUseExempt，打印链路不许被 AI 额度卡住）里的 OCR 不受
//   额度拦，只受该入口自己的限流。数字人会话另受服务端总时长上限约束；已经发出的识别 / 合成不被中途掐断，
//   花多少也不进账。数字人对话里的大模型由腾讯云侧调用，不经本服务出站。
//   百度 OCR 通用文字识别（高精度版）https://cloud.baidu.com/product-price/ocr.html
//     按量后付费，按月成功调用量阶梯：≤5 万次 0.030 元/次，逐档降到 >100 万次 0.010 元/次。
//   腾讯云语音合成（通用，精品音色）https://cloud.tencent.com/document/product/1073/34112
//     0.3 元/万字符，无阶梯。
//   腾讯云实时语音识别 https://cloud.tencent.com/document/product/1093/35686
//     标准版按日时长阶梯：0–299 小时/日 3.20 元/小时起；大模型 2.0 版统一 1.0 元/小时。
//   腾讯云 TRTC AI 实时对话 https://cloud.tencent.com/document/product/647/115755
//     AI 对话服务费 0.01 元/分钟，另加音频通话时长 0.007 元/人/分钟（真人 + AI 两路即 0.014 元/分钟）。
//     2026-09-30 核对上方官方页：0.007 × 2 + 0.01 = 0.024 元/分钟；
//     默认 10 分钟对应这两项单次最高约 10 × 0.024 = 0.24 元（不含 ASR/TTS/LLM；停止故障可能超时）。
//     本期仍不计量，不写 AiUsageRecord，不计入每日金额。
//   以上四项均于 2026-09-29 核对官方页。
//   zhipu / openai 两行是旧值，未重新核对；它们不在默认出站白名单里，生产走不到。
//
// 价目改了要同步改这里的核对日期与链接；不要在别处再写一份。
// ============================================================================

export interface PricedTokenUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export interface TokenRate {
  /** 元 / 百万输入 tokens */
  input: number
  /** 元 / 百万输出 tokens */
  output: number
}

interface Tier extends TokenRate {
  /** 本档适用的单次输入 token 上限（含）。 */
  maxPromptTokens: number
}

const K = 1_000

const DEEPSEEK_FLASH_PEAK: TokenRate = { input: 2, output: 8 }

/** 非 token 计费的 AI 相关服务单价（元），本期不计量，见文件头来源。 */
export const NON_TOKEN_AI_PRICES = Object.freeze({
  /** 百度 OCR 高精度版，首档（≤5 万次/月），元/次 */
  baiduOcrAccurateFirstTierPerCall: 0.03,
  /** 腾讯云语音合成精品音色，元/万字符 */
  tencentTtsPremiumPer10kChars: 0.3,
  /** 腾讯云实时语音识别标准版首档，元/小时 */
  tencentAsrRealtimeStandardFirstTierPerHour: 3.2,
  /** 腾讯云实时语音识别大模型 2.0 版，元/小时 */
  tencentAsrRealtimeBigModelV2PerHour: 1.0,
  /** TRTC AI 实时对话服务费，元/分钟 */
  trtcAiConversationPerMinute: 0.01,
  /** TRTC 音频通话时长，元/人/分钟 */
  trtcAudioPerUserMinute: 0.007,
})
const DEEPSEEK_PRO_PEAK: TokenRate = { input: 9, output: 27 }

const QWEN_PLUS: Tier[] = [
  { maxPromptTokens: 128 * K, input: 0.8, output: 2 },
  { maxPromptTokens: 256 * K, input: 2.4, output: 20 },
  { maxPromptTokens: Infinity, input: 4.8, output: 48 },
]
const QWEN_MAX: Tier[] = [
  { maxPromptTokens: 32 * K, input: 2.5, output: 10 },
  { maxPromptTokens: 128 * K, input: 4, output: 16 },
  { maxPromptTokens: Infinity, input: 7, output: 28 },
]
const QWEN_FLASH: Tier[] = [
  { maxPromptTokens: 128 * K, input: 0.15, output: 1.5 },
  { maxPromptTokens: 256 * K, input: 0.6, output: 6 },
  { maxPromptTokens: Infinity, input: 1.2, output: 12 },
]

function tierFor(tiers: Tier[], promptTokens: number): TokenRate {
  return tiers.find((tier) => promptTokens <= tier.maxPromptTokens) ?? tiers[tiers.length - 1]!
}

/**
 * 从厂商 + 型号标签定价。标签可以是 AiServiceLog 的 provider（`llm:deepseek:deepseek-v4-flash`），
 * 也可以是计量账的 `deepseek:deepseek-v4-flash`；按子串匹配，大小写不敏感。
 */
export function rateFor(label: string, promptTokens: number): TokenRate | null {
  const normalized = label.toLowerCase()
  // 腾讯云广州价格（2026-10-10 访问）：https://cloud.tencent.com/document/product/1823/130055
  // Hy3 每百万 token 输入 1 元、输出 4 元；缓存未单独采集，按普通输入估算。
  // TokenHub 托管的其它模型没有本表已核价格，必须留空，不能套 DeepSeek 官方价。
  const hunyuan = normalized.match(/^(?:llm:)?hunyuan:(.+)$/)
  if (hunyuan) return hunyuan[1] === 'hy3' ? { input: 1, output: 4 } : null
  if (normalized.includes('deepseek')) {
    return normalized.includes('flash') ? DEEPSEEK_FLASH_PEAK : DEEPSEEK_PRO_PEAK
  }
  if (normalized.includes('qwen')) {
    if (normalized.includes('qwen-flash')) return tierFor(QWEN_FLASH, promptTokens)
    if (normalized.includes('qwen-plus')) return tierFor(QWEN_PLUS, promptTokens)
    return tierFor(QWEN_MAX, promptTokens)
  }
  if (normalized.includes('zhipu')) return { input: 5, output: 5 }
  if (normalized.includes('openai')) return { input: 18, output: 54 }
  return null
}

/**
 * 按标签里的厂商 / 型号 + token 估算金额（元）。
 *
 * 返回 undefined = **未采集/无法定价**，调用方必须如实留空，绝不回落成 0。
 * mock / stub 判定必须在「有没有 token」之前 —— 它们压根不打上游，0 是实测。
 */
export function estimateCostCny(label: string, usage: PricedTokenUsage | undefined): number | undefined {
  const normalized = label.toLowerCase()
  if (normalized.includes('mock') || normalized.includes('stub')) return 0
  return priceTokens(normalized, usage)
}

/**
 * 只按 token 定价，**没有** mock / stub 短路。
 *
 * 给逐次计量账用：走到计量的调用都是真的发出了 HTTP 请求，主机名里碰巧含 mock
 * 也不能记成免费。取不到用量或定不了价返回 undefined。
 */
export function priceTokens(label: string, usage: PricedTokenUsage | undefined): number | undefined {
  if (!usage || usage.totalTokens <= 0) return undefined
  const rate = rateFor(label, usage.promptTokens)
  if (!rate) return undefined
  return roundMoney(((usage.promptTokens * rate.input) + (usage.completionTokens * rate.output)) / 1_000_000)
}

/** 金额保留 4 位小数（0.0001 元）。 */
export function roundMoney(value: number): number {
  return Math.round(value * 10_000) / 10_000
}
