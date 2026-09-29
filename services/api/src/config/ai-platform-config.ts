/**
 * 生产环境「AI 开通状态」的唯一判定（F-11 / 步骤 3.6a）。
 *
 * 背景：此前 production-runtime-gates.ts 在生产环境下只要 OCR / AI_PROVIDER / 大模型密钥 /
 * AIGC_CONTENT_PRODUCER 任一缺失就 throw，整个 API 起不来 —— 一体机打印、扫描、支付、两个后台
 * 跟着一起停。产品原则是「AI 是加速器，不是前置条件」：缺 AI 配置时只降级 AI，其余照常。
 *
 * 判定条件与原启动闸门**等价**（同一套规范化：trim + 小写；密钥只看非空）：
 *   - llm ：AI_PROVIDER=llm，且 AI_LLM_API_KEY / TRTC_LLM_API_KEY 至少一个非空；
 *   - ocr ：OCR_PROVIDER=baidu，且 BAIDU_OCR_API_KEY、BAIDU_OCR_SECRET_KEY 都非空；
 *   - aigc：AIGC_CONTENT_PRODUCER 非空且不是产品名。
 * 所以今天能启动的生产配置在这里一律判为「全部开通」，行为零变化；只有过去起不来的配置，
 * 现在会以「AI 降级」的状态起来。
 *
 * 为什么单独成文件、不留在 production-runtime-gates.ts：
 *   1. 启动期（main.ts 登记降级）与请求期（AI 路由闸门、大模型配置、一体机能力接口、
 *      简历 provider 选择、OCR provider 选择）要用同一份判定，不能各写一份口径；
 *   2. production-runtime-gates.ts 只放「缺一即拒启动」的判定，且其源码会被
 *      verify:deploy-gates-in-sync 按 `env.KEY !== 'true'` 形态机械扫描，AI 判定混进去会误导那道门禁。
 *
 * 非生产（开发 / CI）一律视为开通：CI 用 AI_PROVIDER=mock 跑大量门禁，行为不变。
 * 本文件是纯函数，不依赖 Nest，部署预检（preflight-production-gates.mjs 加载的 dist）也能直接用。
 */
import { isCompliantAigcProducer } from '../common/pdf/aigc-label'

export interface AiPlatformEnv {
  NODE_ENV?: string
  AI_PROVIDER?: string
  AI_LLM_API_KEY?: string
  TRTC_LLM_API_KEY?: string
  OCR_PROVIDER?: string
  BAIDU_OCR_API_KEY?: string
  BAIDU_OCR_SECRET_KEY?: string
  AIGC_CONTENT_PRODUCER?: string
}

export type AiPlatformPart = 'llm' | 'ocr' | 'aigc'

export type AiPlatformIssueCode =
  | 'AI_PROVIDER_NOT_LLM'
  | 'AI_LLM_API_KEY_MISSING'
  | 'OCR_PROVIDER_NOT_BAIDU'
  | 'BAIDU_OCR_CONFIG_MISSING'
  | 'AIGC_CONTENT_PRODUCER_MISSING'

export interface AiPlatformIssue {
  code: AiPlatformIssueCode
  part: AiPlatformPart
  /** 运维可读：缺哪个键、当前是哪种取值。只写键名与已知枚举值，绝不回显密钥或未知取值。 */
  detail: string
}

export interface AiPlatformState {
  /** 只有 NODE_ENV=production 才执行「未开通即拒绝」；开发 / CI 恒为 false。 */
  enforced: boolean
  llmConfigured: boolean
  ocrConfigured: boolean
  aigcConfigured: boolean
  /**
   * 大模型生成类能力能否对外提供。
   * 缺内容制作方（aigc）也算不可用：多数 AI 能力在生成当下就落 PDF 进「我的文档」，
   * 缺它只能出「生产方写成产品名」的文件，取舍理由见 common/boot/ai-platform-degradation.ts。
   */
  generationAvailable: boolean
  issues: AiPlatformIssue[]
}

/** 与原启动闸门同一套规范化：去空白 + 小写。 */
export function normalizeProviderSetting(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

export function aiPlatformEnforced(env: { NODE_ENV?: string } = process.env): boolean {
  return env.NODE_ENV === 'production'
}

// 只用于在 detail 里安全回显「当前是哪种取值」。不在表里的值一律不回显，
// 免得有人把密钥误填进 AI_PROVIDER / OCR_PROVIDER 时被写进日志与 /health。
const ECHOABLE_AI_PROVIDERS = new Set(['mock', 'openai', 'claude', 'local', 'qwen', 'zhipu', 'llm'])
const ECHOABLE_OCR_PROVIDERS = new Set(['disabled', 'tencent', 'baidu'])

function describeSetting(value: string, echoable: ReadonlySet<string>): string {
  if (!value) return '未设置'
  return echoable.has(value) ? value : '无法识别的取值（已隐去）'
}

function hasValue(value: string | undefined): boolean {
  return Boolean(value?.trim())
}

const ALL_OPEN: Omit<AiPlatformState, 'enforced'> = {
  llmConfigured: true,
  ocrConfigured: true,
  aigcConfigured: true,
  generationAvailable: true,
  issues: [],
}

export function evaluateAiPlatform(env: AiPlatformEnv = process.env): AiPlatformState {
  if (!aiPlatformEnforced(env)) return { enforced: false, ...ALL_OPEN, issues: [] }

  const issues: AiPlatformIssue[] = []

  const aiProvider = normalizeProviderSetting(env.AI_PROVIDER)
  if (aiProvider !== 'llm') {
    issues.push({
      code: 'AI_PROVIDER_NOT_LLM',
      part: 'llm',
      detail: `AI_PROVIDER 当前为 ${describeSetting(aiProvider, ECHOABLE_AI_PROVIDERS)}；生产只接受 llm，mock / stub 不得冒充结果`,
    })
  }
  if (!hasValue(env.AI_LLM_API_KEY) && !hasValue(env.TRTC_LLM_API_KEY)) {
    issues.push({
      code: 'AI_LLM_API_KEY_MISSING',
      part: 'llm',
      detail: 'AI_LLM_API_KEY 与 TRTC_LLM_API_KEY 都未配置',
    })
  }

  const ocrProvider = normalizeProviderSetting(env.OCR_PROVIDER)
  if (ocrProvider !== 'baidu') {
    issues.push({
      code: 'OCR_PROVIDER_NOT_BAIDU',
      part: 'ocr',
      detail: `OCR_PROVIDER 当前为 ${describeSetting(ocrProvider, ECHOABLE_OCR_PROVIDERS)}；生产只接受 baidu`,
    })
  } else {
    const missing = (['BAIDU_OCR_API_KEY', 'BAIDU_OCR_SECRET_KEY'] as const).filter((key) => !hasValue(env[key]))
    if (missing.length > 0) {
      issues.push({ code: 'BAIDU_OCR_CONFIG_MISSING', part: 'ocr', detail: `缺 ${missing.join('、')}` })
    }
  }

  if (!isCompliantAigcProducer(env.AIGC_CONTENT_PRODUCER)) {
    issues.push({
      code: 'AIGC_CONTENT_PRODUCER_MISSING',
      part: 'aigc',
      detail: 'AIGC_CONTENT_PRODUCER 未设置或填成了产品名，需要填公司全称或统一社会信用代码',
    })
  }

  const llmConfigured = !issues.some((issue) => issue.part === 'llm')
  const ocrConfigured = !issues.some((issue) => issue.part === 'ocr')
  const aigcConfigured = !issues.some((issue) => issue.part === 'aigc')
  return {
    enforced: true,
    llmConfigured,
    ocrConfigured,
    aigcConfigured,
    generationAvailable: llmConfigured && aigcConfigured,
    issues,
  }
}

/** 日志 / 部署预检用的一行摘要：只含问题码，逗号分隔。 */
export function aiPlatformIssueCodes(state: AiPlatformState): string {
  return state.issues.map((issue) => issue.code).join(',')
}
