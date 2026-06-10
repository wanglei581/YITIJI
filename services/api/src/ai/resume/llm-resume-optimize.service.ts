import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common'
import type {
  GeneratedResume,
  ResumeOptimizeModule,
  ResumeReport,
} from '../interfaces/ai-provider.interface'
import { LlmConfigService } from '../llm/llm-config.service'
import { containsForbiddenWord } from '../llm/llm-guard'

// ============================================================
// LlmResumeOptimizeService — 阶段2B 真实简历优化(单轮、结构化 JSON,OpenAI 兼容)
//
// 输入 = 提取的简历原文 + 已有诊断报告;输出 = 结构化优化版简历 + 新旧对比模块。
//
// 防编造契约(与 2A 生成同级强度,但针对"从原文重组"场景):
//   - 事实串校验:优化版简历中的 学校 / 公司 / 证书 / 电话 / 邮箱 必须能在
//     简历原文中找到(空白归一后子串匹配)。任何事实串不在原文 → 判非法,
//     重试一次,仍坏 → 明确失败,绝不输出含虚构事实的简历。
//   - 对比模块的 before 必须是原文中真实存在的片段(归一后子串匹配),
//     不在原文的模块直接丢弃 —— "优化前"绝不允许是编出来的稻草人。
//   - 优化文本命中合规拦截词(录用/保面试/内推等承诺类) → 判非法重试,
//     仍坏 → 失败;绝不让承诺式表述进入简历或建议。
//
// 复用 LlmConfigService 的 resume_optimize 功能级加密凭证;全局 fetch,无 SDK。
// 安全:出错只记状态码,绝不记 prompt / 简历原文 / 请求·响应正文。
// ============================================================

const MAX_INPUT_CHARS = 12000
const OPTIMIZE_TEMPERATURE = 0.3
const MAX_SUMMARY_CHARS = 300
const MAX_DESC_CHARS = 600
const MAX_SKILL_CHARS = 40
const MAX_MODULES = 8
const MAX_MODULE_TEXT_CHARS = 600
/** before 片段至少这么长才有对比意义,过短串匹配也容易误判 */
const MIN_BEFORE_CHARS = 6

const j = (...parts: string[]): string => parts.join('')
/** 承诺类拦截词(恒定生效,叠加管理员 forbiddenWords)。 */
const OPTIMIZE_GUARD_TERMS = [
  j('保', '录用'),
  j('保', '面试'),
  j('录用', '概率'),
  j('内', '推'),
  j('一键', '投递'),
  j('平台', '投递'),
]

const OPTIMIZE_SYSTEM_PROMPT = [
  '你是「AI 求职打印服务终端」的简历优化引擎。基于用户的简历原文与诊断报告,重组一份表达更好的优化版简历,并给出新旧对比。',
  '严格要求:',
  '1. 只输出一个 JSON 对象,不要任何解释、前后缀或代码块标记。',
  '2. JSON 形如:{"resume":{"basic":{"name":"","phone":"","email":"","city":""},"intention":{"position":"","city":""},"summary":"","education":[{"school":"","major":"","degree":"","period":"","description":""}],"experience":[{"company":"","role":"","period":"","description":""}],"projects":[{"name":"","role":"","description":""}],"skills":[""],"certificates":[""]},"modules":[{"title":"","before":"","after":""}]}。',
  '3. 红线:resume 中的所有事实信息(姓名、学校、专业、学历、公司、职务、项目名、证书、电话、邮箱、时间段、数字)必须直接来自简历原文;原文没有的信息一律不写(留空字符串或空数组),绝不推测、绝不编造。',
  '4. 只优化"表达":把原文中的职责/成果描述改写得更具体、动词开头、突出成果;原文中的数字必须原样保留,不得新增原文没有的数字。',
  '5. modules 为 2~8 条新旧对比:before 必须是简历原文中真实存在的连续片段(逐字摘录,不要改写),after 是对应的优化表达。',
  '6. 不得输出任何录用、投递、面试邀约、Offer 或通过率类承诺;优化只是表达参考,由求职者本人决定是否采纳。',
  '7. 原文信息不足的部分,在对应字段留空即可,不要替用户补内容。',
].join('\n')

const RETRY_HINT =
  '上一次输出不符合要求。请严格只输出 JSON;resume 中的学校/公司/证书/联系方式必须逐字来自简历原文;modules 的 before 必须是原文连续片段。'

interface ChatMessage {
  role: 'system' | 'user'
  content: string
}

export interface OptimizeResult {
  optimizedResume: GeneratedResume
  modules: ResumeOptimizeModule[]
}

/** 空白/标点归一,用于"事实串是否出现在原文"的鲁棒匹配。 */
function normalizeForMatch(text: string): string {
  return text.replace(/[\s\u3000,，.。;；:：、·\-—()（）]/g, '').toLowerCase()
}

@Injectable()
export class LlmResumeOptimizeService {
  private readonly logger = new Logger(LlmResumeOptimizeService.name)

  constructor(private readonly config: LlmConfigService) {}

  /**
   * 基于简历原文 + 诊断报告生成优化版简历与新旧对比。
   * - 未配置 / 未启用 → AI_PROVIDER_NOT_CONFIGURED(绝不 fallback mock)。
   * - 非法 JSON / 事实串不在原文 / 命中承诺类拦截词 → 重试一次;仍坏 → AI_OPTIMIZE_INVALID_OUTPUT。
   */
  async optimize(extractedText: string, report: ResumeReport): Promise<OptimizeResult> {
    const apiKey = this.config.getApiKey('resume_optimize')
    const cfg = this.config.getConfig('resume_optimize')
    if (!apiKey || !cfg.enabled) {
      throw new ServiceUnavailableException({
        error: { code: 'AI_PROVIDER_NOT_CONFIGURED', message: 'AI 简历优化模型尚未配置或未启用，请联系管理员' },
      })
    }

    const text = (extractedText ?? '').slice(0, MAX_INPUT_CHARS)
    const reportBrief = report.sections.map((s) => `${s.label}:${s.score}/${s.maxScore}`).join('、')
    const baseMessages: ChatMessage[] = [
      { role: 'system', content: OPTIMIZE_SYSTEM_PROMPT },
      { role: 'user', content: `诊断报告摘要:${reportBrief}\n改进建议:${(report.suggestions ?? []).join(';')}\n\n简历原文:\n${text}` },
    ]

    for (let attempt = 1; attempt <= 2; attempt++) {
      const messages =
        attempt === 1 ? baseMessages : [...baseMessages, { role: 'system' as const, content: RETRY_HINT }]
      const raw = await this.callLlm(cfg.baseURL, apiKey, cfg.model, OPTIMIZE_TEMPERATURE, messages)
      const result = this.parseAndValidate(raw, text, cfg.forbiddenWords)
      if (result) return result
      this.logger.warn(`resume optimize: invalid output (attempt ${attempt}/2)`)
    }

    throw new ServiceUnavailableException({
      error: { code: 'AI_OPTIMIZE_INVALID_OUTPUT', message: 'AI 简历优化服务暂时不可用，请稍后重试' },
    })
  }

  // ── OpenAI 兼容 Chat Completions(出错不记正文:输入含简历原文)────────────

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
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages, temperature, stream: false }),
      })
    } catch {
      throw new ServiceUnavailableException({
        error: { code: 'AI_OPTIMIZE_UNAVAILABLE', message: 'AI 简历优化服务连接失败，请稍后重试' },
      })
    }
    if (!res.ok) {
      this.logger.error(`resume optimize http ${res.status}`)
      throw new ServiceUnavailableException({
        error: { code: 'AI_OPTIMIZE_UNAVAILABLE', message: `AI 简历优化服务返回错误 (${res.status})` },
      })
    }
    const data = (await res.json().catch(() => null)) as {
      choices?: Array<{ message?: { content?: string } }>
    } | null
    const content = data?.choices?.[0]?.message?.content?.trim()
    if (!content) {
      throw new ServiceUnavailableException({
        error: { code: 'AI_OPTIMIZE_UNAVAILABLE', message: 'AI 简历优化服务未返回内容' },
      })
    }
    return content
  }

  // ── 解析 + 防编造校验 ───────────────────────────────────────────────────────

  private parseAndValidate(raw: string, originalText: string, forbiddenWords: string[]): OptimizeResult | null {
    const jsonStr = extractJson(raw)
    if (!jsonStr) return null
    let parsed: unknown
    try {
      parsed = JSON.parse(jsonStr)
    } catch {
      return null
    }
    if (!parsed || typeof parsed !== 'object') return null
    const obj = parsed as Record<string, unknown>
    const rawResume = obj['resume']
    if (!rawResume || typeof rawResume !== 'object') return null

    const normText = normalizeForMatch(originalText)
    const inText = (value: string | undefined): boolean => {
      if (!value || !value.trim()) return true // 留空合法(原文没有就不写)
      const needle = normalizeForMatch(value)
      return needle.length > 0 && normText.includes(needle)
    }
    const blocked = [...OPTIMIZE_GUARD_TERMS, ...forbiddenWords]
    const clean = (value: unknown, maxLen: number): string | null => {
      if (typeof value !== 'string') return ''
      const text = value.trim().slice(0, maxLen)
      // 承诺类表述出现在任何输出文本 → 整体判非法(重试;绝不带承诺出简历)
      if (text && containsForbiddenWord(text, blocked)) return null
      return text
    }

    const r = rawResume as Record<string, unknown>
    const basicRaw = (r['basic'] ?? {}) as Record<string, unknown>
    const intentionRaw = (r['intention'] ?? {}) as Record<string, unknown>

    const summary = clean(r['summary'], MAX_SUMMARY_CHARS)
    if (summary === null) return null

    // basic:姓名/电话/邮箱必须出现在原文(电话邮箱被改一个数字都不行),否则置空
    const name = typeof basicRaw['name'] === 'string' ? basicRaw['name'].trim().slice(0, 50) : ''
    const phone = typeof basicRaw['phone'] === 'string' ? basicRaw['phone'].trim().slice(0, 30) : ''
    const email = typeof basicRaw['email'] === 'string' ? basicRaw['email'].trim().slice(0, 100) : ''
    const basic = {
      name: inText(name) ? name : '',
      phone: inText(phone) ? phone : undefined,
      email: inText(email) ? email : undefined,
      city: typeof basicRaw['city'] === 'string' ? basicRaw['city'].trim().slice(0, 50) || undefined : undefined,
    }

    const intention = {
      position: typeof intentionRaw['position'] === 'string' ? intentionRaw['position'].trim().slice(0, 60) : '',
      city: typeof intentionRaw['city'] === 'string' ? intentionRaw['city'].trim().slice(0, 50) || undefined : undefined,
    }

    // 列表段:事实串(学校/公司/项目名/证书)必须在原文;任何一条不在 → 整体非法
    const education: GeneratedResume['education'] = []
    for (const item of asArray(r['education'], 6)) {
      const school = strOf(item, 'school', 100)
      if (!school) continue
      if (!inText(school)) return null
      const description = clean(item['description'], MAX_DESC_CHARS)
      if (description === null) return null
      education.push({
        school,
        major: strOf(item, 'major', 60) || undefined,
        degree: strOf(item, 'degree', 20) || undefined,
        period: strOf(item, 'period', 40) || undefined,
        description: description || undefined,
      })
    }

    const experience: GeneratedResume['experience'] = []
    for (const item of asArray(r['experience'], 8)) {
      const company = strOf(item, 'company', 100)
      const role = strOf(item, 'role', 60)
      if (!company || !role) continue
      if (!inText(company)) return null
      const description = clean(item['description'], MAX_DESC_CHARS)
      if (description === null) return null
      experience.push({ company, role, period: strOf(item, 'period', 40) || undefined, description })
    }

    const projects: GeneratedResume['projects'] = []
    for (const item of asArray(r['projects'], 6)) {
      const projectName = strOf(item, 'name', 100)
      if (!projectName) continue
      if (!inText(projectName)) return null
      const description = clean(item['description'], MAX_DESC_CHARS)
      if (description === null) return null
      projects.push({ name: projectName, role: strOf(item, 'role', 60) || undefined, description })
    }

    const skills: string[] = []
    for (const skill of asStrArray(r['skills'], 20)) {
      const cleaned = clean(skill, MAX_SKILL_CHARS)
      if (cleaned === null) return null
      if (cleaned) skills.push(cleaned)
    }

    const certificates: string[] = []
    for (const cert of asStrArray(r['certificates'], 15)) {
      const trimmed = cert.trim().slice(0, 60)
      if (!trimmed) continue
      if (!inText(trimmed)) return null // 证书是高风险编造点:不在原文即整体非法
      certificates.push(trimmed)
    }

    // 对比模块:before 必须真实摘自原文,否则丢弃该条(不因稻草人对比废整单)
    const modules: ResumeOptimizeModule[] = []
    for (const item of asArray(obj['modules'], MAX_MODULES)) {
      const title = strOf(item, 'title', 60)
      const before = strOf(item, 'before', MAX_MODULE_TEXT_CHARS)
      const after = clean(item['after'], MAX_MODULE_TEXT_CHARS)
      if (after === null) return null
      if (!title || !before || !after) continue
      if (before.length < MIN_BEFORE_CHARS) continue
      if (!normText.includes(normalizeForMatch(before))) continue
      modules.push({ title, before, after })
    }

    const optimizedResume: GeneratedResume = {
      basic, intention, summary, education, experience, projects, skills, certificates,
    }
    return { optimizedResume, modules }
  }
}

function asArray(value: unknown, cap: number): Record<string, unknown>[] {
  if (!Array.isArray(value)) return []
  return value.filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === 'object').slice(0, cap)
}

function asStrArray(value: unknown, cap: number): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((x): x is string => typeof x === 'string').slice(0, cap)
}

function strOf(obj: Record<string, unknown>, key: string, maxLen: number): string {
  const v = obj[key]
  return typeof v === 'string' ? v.trim().slice(0, maxLen) : ''
}

/** 容忍模型偶尔包裹代码块:去 ``` 围栏后取首 { 到末 }。 */
function extractJson(raw: string): string | null {
  const cleaned = raw.replace(/```(?:json)?/g, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  return cleaned.slice(start, end + 1)
}
