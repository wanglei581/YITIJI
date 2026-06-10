import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common'
import type { ResumePriority, ResumeReport, ResumeSection } from '../interfaces/ai-provider.interface'
import { LlmConfigService } from '../llm/llm-config.service'
import { containsForbiddenWord } from '../llm/llm-guard'

// ============================================================
// LlmResumeService — 真实简历诊断（单轮、结构化 JSON，OpenAI 兼容协议）
//
// - 复用 LlmConfigService 的 resume_diagnosis 功能级加密凭证，不引入任何 SDK，用全局 fetch。
// - 单轮调用：固定 6 评分维度 + 可执行建议 + 风险表述提醒 + 修改优先级建议；严格 JSON，非法重试一次。
// - 合规：低 temperature 求稳；禁止编造经历 / 招聘结果·匹配程度·代投推荐·企业筛选类结论；
//   风险提醒只针对简历「文本表达」，严禁年龄/性别/婚育/地域/学历歧视等敏感判断；建议不回贴原文。
// - 安全：出错只记 status / 状态码，**绝不记 prompt / 提取文本 / 请求·响应正文**。
// ============================================================

/** 诊断输入文本上限（提取层已截断，这里再兜一道，防超长 + 控成本）。 */
const MAX_DIAGNOSIS_INPUT_CHARS = 12000
/** 诊断要稳定，用低 temperature。 */
const DIAGNOSIS_TEMPERATURE = 0.2

/** 列表数量上限（终端屏幕快速可读，避免长篇）。 */
const MAX_SUGGESTIONS = 6
const MAX_RISK_NOTES = 5
const MAX_PRIORITIES = 4
/** 单条文本长度上限（避免超长文本撑爆 Kiosk 卡片；超限截断）。 */
const MAX_ITEM_CHARS = 120
const MAX_PRIORITY_FOCUS_CHARS = 40

/** 固定 6 评分维度（key 与 mock 对齐，驱动前端雷达图/总分/分项）。 */
const DIAGNOSIS_DIMENSIONS = [
  { key: 'basic', label: '基础信息完整度' },
  { key: 'objective', label: '求职目标清晰度' },
  { key: 'experience', label: '经历表达清晰度' },
  { key: 'quantification', label: '成果量化程度' },
  { key: 'keyword', label: '岗位关键词覆盖' },
  { key: 'readability', label: '版式与可读性' },
] as const
const DIAGNOSIS_DIMENSION_KEYS = new Set<string>(DIAGNOSIS_DIMENSIONS.map((d) => d.key))

/**
 * 诊断专属合规拦截词（与管理员可配 forbiddenWords 叠加，恒定生效、不依赖后台配置）。
 * 用字符串拼接避免源码出现完整违禁词（对齐 llm-guard 的 joinWord 约定）。
 * 命中即丢弃该条 suggestions/riskNotes/priorities，绝不进入报告。
 */
const j = (...parts: string[]): string => parts.join('')
const DIAGNOSIS_GUARD_TERMS = [
  j('录用', '概率'),
  j('录用', '率'),
  j('录用', '结果'),
  j('企业', '匹配度'),
  j('岗位', '匹配度'),
  j('保', '录用'),
  j('保', '面试'),
  j('内', '推'),
  j('推荐', '给企业'),
  j('平台', '投递'),
  j('候选人', '筛选'),
]

const DIAGNOSIS_SYSTEM_PROMPT = [
  '你是「AI 求职打印服务终端」的简历诊断引擎，只依据用户提供的简历文本做客观诊断。',
  '严格要求：',
  '1. 只输出一个 JSON 对象，不要任何解释、前后缀或代码块标记。',
  '2. JSON 形如：{"sections":[{"key":"basic","label":"基础信息完整度","score":8,"maxScore":10}],"suggestions":["..."],"riskNotes":["..."],"priorities":[{"focus":"...","reason":"..."}]}。',
  `3. sections 必须且只能包含这 6 个维度（key 固定）：${DIAGNOSIS_DIMENSIONS.map((d) => `${d.key}(${d.label})`).join('、')}；每项 maxScore 固定为 10，score 为 0~10 的整数。`,
  '4. suggestions：3~6 条具体、可执行的中文改进建议，针对该简历真实内容。',
  '5. riskNotes：0~5 条「简历文本表达风险」提醒，只针对文本表达问题（如经历时间线表述不连续、成果缺少量化描述、职责描述过于笼统、求职目标不够明确、联系方式缺失或格式不清）。严禁涉及年龄、性别、婚育、地域、学历歧视等敏感判断，严禁暗示录用或面试结果；无明显风险时给空数组 []。',
  '6. priorities：2~4 条「修改优先级建议」，按重要性从高到低排序，每条形如 {"focus":"要先改什么","reason":"为什么"}。',
  '7. 不得编造简历中不存在的经历、学历、技能或成果；信息不足时在 suggestions / riskNotes 中如实指出需补充。',
  '8. 「岗位关键词覆盖」只评估简历文本是否覆盖常见岗位表达，不做任何匹配程度类结论或代投 / 推荐类结论。',
  '9. 不得输出任何招聘结果类结论、匹配程度类结论、代投或推荐类结论、企业筛选类结论，也不得做“保过”类承诺。',
  '10. 所有内容只服务于求职者本人修改简历参考，不得整段回贴简历原文。',
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
   * - 非法 JSON / 维度漂移 → 重试一次；仍失败 → 抛 AI_DIAGNOSIS_INVALID_OUTPUT。
   * - 连接 / HTTP 错误 → 抛 AI_DIAGNOSIS_UNAVAILABLE。
   */
  async diagnose(extractedText: string): Promise<ResumeReport> {
    const apiKey = this.config.getApiKey('resume_diagnosis')
    const cfg = this.config.getConfig('resume_diagnosis')
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
    if (!Array.isArray(rawSections)) return null
    // 评分维度强校验：必须且只能是固定 6 维度，key 命中，maxScore=10（漂移即判非法、重试）。
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
      const maxScore = sec['maxScore']
      const score = sec['score']
      // 严格：maxScore 必须 === 10；score 必须是 0~10 的整数（小数/越界一律拒绝，不做四舍五入放行）。
      if (typeof maxScore !== 'number' || maxScore !== 10) return null
      if (typeof score !== 'number' || !Number.isInteger(score) || score < 0 || score > 10) return null
      // 使用服务端 canonical label，避免模型输出的展示文案漂移影响前端口径。
      sections.push({ key: dimension.key, label: dimension.label, score, maxScore: 10 })
    }

    // 合规拦截词 = 诊断专属恒定词 + 管理员可配 forbiddenWords；命中即丢弃该条。
    const blocked = [...DIAGNOSIS_GUARD_TERMS, ...forbiddenWords]
    const suggestions = this.sanitizeStringList(obj['suggestions'], blocked, MAX_SUGGESTIONS, MAX_ITEM_CHARS)
    if (suggestions.length === 0) return null // suggestions 至少 1 条，否则视为无效输出

    const riskNotes = this.sanitizeStringList(obj['riskNotes'], blocked, MAX_RISK_NOTES, MAX_ITEM_CHARS)
    const priorities = this.sanitizePriorities(obj['priorities'], blocked)
    // priorities 合法数量 2~4：清洗后恰好 1 条视为无效输出（触发重试）；0 条则不附带、由前端回退。
    if (priorities.length === 1) return null

    const report: ResumeReport = { sections, suggestions }
    // 风险/优先列表只在有内容时附带；缺失由前端兼容（隐藏风险卡 / 优先项回退按低分派生）。
    if (riskNotes.length > 0) report.riskNotes = riskNotes
    if (priorities.length >= 2) report.priorities = priorities
    return report
  }

  /** 过滤为干净字符串列表：去空、命中合规词即丢弃、单条超 maxLen 截断、总数截到 cap。 */
  private sanitizeStringList(value: unknown, blocked: string[], cap: number, maxLen: number): string[] {
    if (!Array.isArray(value)) return []
    const out: string[] = []
    for (const item of value) {
      if (typeof item !== 'string') continue
      let text = item.trim()
      if (!text || containsForbiddenWord(text, blocked)) continue
      if (text.length > maxLen) text = text.slice(0, maxLen)
      out.push(text)
      if (out.length >= cap) break
    }
    return out
  }

  /**
   * 过滤优先级列表：focus 与 reason **都必填**（非空字符串），命中合规词即丢弃；
   * focus 超 40 字、reason 超 120 字截断；总数截到 MAX_PRIORITIES。
   */
  private sanitizePriorities(value: unknown, blocked: string[]): ResumePriority[] {
    if (!Array.isArray(value)) return []
    const out: ResumePriority[] = []
    for (const item of value) {
      if (!item || typeof item !== 'object') continue
      const o = item as Record<string, unknown>
      if (typeof o['focus'] !== 'string' || typeof o['reason'] !== 'string') continue
      let focus = o['focus'].trim()
      let reason = o['reason'].trim()
      if (!focus || !reason) continue
      if (containsForbiddenWord(focus, blocked) || containsForbiddenWord(reason, blocked)) continue
      if (focus.length > MAX_PRIORITY_FOCUS_CHARS) focus = focus.slice(0, MAX_PRIORITY_FOCUS_CHARS)
      if (reason.length > MAX_ITEM_CHARS) reason = reason.slice(0, MAX_ITEM_CHARS)
      out.push({ focus, reason })
      if (out.length >= MAX_PRIORITIES) break
    }
    return out
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
