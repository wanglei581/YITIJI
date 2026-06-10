import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common'
import type { ResumeReport, ResumeSection } from '../interfaces/ai-provider.interface'
import { LlmConfigService } from '../llm/llm-config.service'
import { enforceForbiddenWords } from '../llm/llm-guard'

// ============================================================
// LlmResumeService — 真实简历诊断（单轮、结构化 JSON，OpenAI 兼容协议）
//
// - 复用 LlmConfigService 的加密凭证（与 AI 助手对话同源），不引入任何 SDK，用全局 fetch。
// - 单轮调用：固定 5 维度评分 + 可执行建议；严格 JSON 输出，非法重试一次。
// - 合规：低 temperature 求稳；禁止编造经历 / 录用·投递·面试结论；建议不回贴原文。
// - 安全：出错只记 status / 状态码，**绝不记 prompt / 提取文本 / 请求·响应正文**
//   （区别于 LlmChatService 出错时会记 body 片段）。
// ============================================================

/** 诊断输入文本上限（提取层已截断，这里再兜一道，防超长 + 控成本）。 */
const MAX_DIAGNOSIS_INPUT_CHARS = 12000
/** 诊断要稳定，用低 temperature。 */
const DIAGNOSIS_TEMPERATURE = 0.2

/** 固定 5 维度（key 与 mock 对齐，保证前端雷达图/总分口径一致）。 */
const DIAGNOSIS_DIMENSIONS = [
  { key: 'basic', label: '基础信息完整度' },
  { key: 'education', label: '教育经历完整度' },
  { key: 'experience', label: '实习/项目经历表达' },
  { key: 'skills', label: '技能关键词覆盖' },
  { key: 'layout', label: '排版可读性' },
] as const
const DIAGNOSIS_DIMENSION_KEYS = new Set<string>(DIAGNOSIS_DIMENSIONS.map((d) => d.key))

const DIAGNOSIS_SYSTEM_PROMPT = [
  '你是「AI 求职打印服务终端」的简历诊断引擎，只依据用户提供的简历文本做客观诊断。',
  '严格要求：',
  '1. 只输出一个 JSON 对象，不要任何解释、前后缀或代码块标记。',
  '2. JSON 形如：{"sections":[{"key":"basic","label":"基础信息完整度","score":8,"maxScore":10}],"suggestions":["...","..."]}。',
  `3. sections 必须且只能包含这 5 个维度（key 固定）：${DIAGNOSIS_DIMENSIONS.map((d) => `${d.key}(${d.label})`).join('、')}，每项 maxScore 固定为 10，score 为 0~10 的整数。`,
  '4. suggestions 给 3~6 条具体、可执行的中文改进建议，针对该简历的真实内容。',
  '5. 不得编造简历中不存在的经历、学历、技能或成果；信息不足时在建议中如实指出需补充。',
  '6. 不得输出任何录用、投递、面试邀约、Offer、企业匹配或“保过/保录用”类结论。',
  '7. 建议中不得整段回贴简历原文，只给改进方向与示例句式。',
].join('\n')

const RETRY_HINT =
  '上次输出不是合法 JSON。请只返回一个符合要求的 JSON 对象，不要任何多余文字、解释或代码块标记。'

function buildDiagnosisUserPrompt(text: string): string {
  return `以下是待诊断的简历文本（仅供本次诊断使用）：\n"""\n${text}\n"""\n请按系统要求输出 JSON 诊断结果。`
}

interface ChatMessage {
  role: 'system' | 'user'
  content: string
}

@Injectable()
export class LlmResumeService {
  private readonly logger = new Logger(LlmResumeService.name)

  constructor(private readonly config: LlmConfigService) {}

  /**
   * 基于提取文本生成结构化诊断报告。
   * - 未配置 / 未启用 → 抛 AI_PROVIDER_NOT_CONFIGURED（绝不 fallback mock）。
   * - 非法 JSON → 重试一次；仍失败 → 抛 AI_DIAGNOSIS_INVALID_OUTPUT。
   * - 连接 / HTTP 错误 → 抛 AI_DIAGNOSIS_UNAVAILABLE。
   */
  async diagnose(extractedText: string): Promise<ResumeReport> {
    const apiKey = this.config.getApiKey()
    const cfg = this.config.getConfig()
    if (!apiKey || !cfg.enabled) {
      throw new ServiceUnavailableException({
        error: { code: 'AI_PROVIDER_NOT_CONFIGURED', message: 'AI 诊断模型尚未配置或未启用，请联系管理员' },
      })
    }

    const text = (extractedText ?? '').slice(0, MAX_DIAGNOSIS_INPUT_CHARS)
    const baseMessages: ChatMessage[] = [
      { role: 'system', content: DIAGNOSIS_SYSTEM_PROMPT },
      { role: 'user', content: buildDiagnosisUserPrompt(text) },
    ]

    for (let attempt = 1; attempt <= 2; attempt++) {
      const messages =
        attempt === 1 ? baseMessages : [...baseMessages, { role: 'system' as const, content: RETRY_HINT }]
      const raw = await this.callLlm(cfg.baseURL, apiKey, cfg.model, DIAGNOSIS_TEMPERATURE, messages)
      const report = this.parseReport(raw, cfg.forbiddenWords)
      if (report) return report
      this.logger.warn(`resume diagnose: invalid JSON output (attempt ${attempt}/2)`)
    }

    throw new ServiceUnavailableException({
      error: { code: 'AI_DIAGNOSIS_INVALID_OUTPUT', message: 'AI 诊断服务暂时不可用，请稍后重试' },
    })
  }

  // ── OpenAI 兼容 Chat Completions（出错不记正文）─────────────────────────────

  private async callLlm(
    baseURL: string,
    apiKey: string,
    model: string,
    temperature: number,
    messages: ChatMessage[],
  ): Promise<string> {
    const url = `${baseURL.replace(/\/$/, '')}/chat/completions`
    let res: Response
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model, messages, temperature, stream: false }),
      })
    } catch {
      // 不记请求/响应正文（可能回显简历文本），只抛明确错误
      throw new ServiceUnavailableException({
        error: { code: 'AI_DIAGNOSIS_UNAVAILABLE', message: 'AI 诊断服务连接失败，请稍后重试' },
      })
    }

    if (!res.ok) {
      // 仅记状态码，绝不记响应正文
      this.logger.error(`resume diagnose http ${res.status}`)
      throw new ServiceUnavailableException({
        error: { code: 'AI_DIAGNOSIS_UNAVAILABLE', message: `AI 诊断服务返回错误 (${res.status})` },
      })
    }

    const data = (await res.json().catch(() => null)) as {
      choices?: Array<{ message?: { content?: string } }>
    } | null
    const content = data?.choices?.[0]?.message?.content?.trim()
    if (!content) {
      throw new ServiceUnavailableException({
        error: { code: 'AI_DIAGNOSIS_UNAVAILABLE', message: 'AI 诊断服务未返回内容' },
      })
    }
    return content
  }

  // ── 解析 + 强校验结构化报告 ─────────────────────────────────────────────────

  private parseReport(raw: string, forbiddenWords: string[]): ResumeReport | null {
    const jsonStr = this.extractJson(raw)
    if (!jsonStr) return null
    let parsed: unknown
    try {
      parsed = JSON.parse(jsonStr)
    } catch {
      return null
    }
    if (!parsed || typeof parsed !== 'object') return null
    const obj = parsed as Record<string, unknown>
    const rawSections = obj['sections']
    const rawSuggestions = obj['suggestions']
    if (!Array.isArray(rawSections) || !Array.isArray(rawSuggestions)) return null
    if (rawSections.length !== DIAGNOSIS_DIMENSIONS.length) return null

    const sectionsByKey = new Map<string, Record<string, unknown>>()
    for (const item of rawSections) {
      if (!item || typeof item !== 'object') continue
      const sec = item as Record<string, unknown>
      const key = typeof sec['key'] === 'string' ? sec['key'] : ''
      if (!DIAGNOSIS_DIMENSION_KEYS.has(key)) return null
      sectionsByKey.set(key, sec)
    }

    const sections: ResumeSection[] = []
    for (const dimension of DIAGNOSIS_DIMENSIONS) {
      const sec = sectionsByKey.get(dimension.key)
      if (!sec) return null
      const maxScore = Number(sec['maxScore'])
      let score = Number(sec['score'])
      if (!Number.isFinite(maxScore) || Math.round(maxScore) !== 10 || !Number.isFinite(score)) return null
      score = Math.max(0, Math.min(Math.round(score), 10))
      // 使用服务端 canonical label/maxScore，避免模型输出的展示文案漂移影响前端口径。
      sections.push({ key: dimension.key, label: dimension.label, score, maxScore: 10 })
    }

    const suggestions = rawSuggestions
      .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      .map((x) => enforceForbiddenWords(x.trim(), forbiddenWords))
      .filter((x) => x.length > 0)

    if (sections.length === 0 || suggestions.length === 0) return null
    return { sections, suggestions }
  }

  /** 容忍模型偶尔包裹代码块或夹带说明：去掉 ``` 围栏后，抽取第一个 { 到最后一个 }。 */
  private extractJson(raw: string): string | null {
    const stripped = raw.replace(/```/g, '').trim()
    const start = stripped.indexOf('{')
    const end = stripped.lastIndexOf('}')
    if (start < 0 || end <= start) return null
    return stripped.slice(start, end + 1)
  }
}
