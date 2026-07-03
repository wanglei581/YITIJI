import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common'
import type {
  GeneratedResume,
  ResumeOptimizeModule,
  ResumeLayoutSettings,
  ResumeReport,
  ResumeTargetContext,
} from '../interfaces/ai-provider.interface'
import { LlmConfigService } from '../llm/llm-config.service'
import { containsForbiddenWord } from '../llm/llm-guard'

// ============================================================
// LlmResumeOptimizeService — 阶段2B 真实简历优化(单轮、结构化 JSON,OpenAI 兼容)
//
// 输入 = 提取的简历原文 + 已有诊断报告 + 可选目标方向上下文(targetContext);
// 输出 = 结构化优化版简历 + 新旧对比模块。
//
// targetContext(Wave 1 Task 2,additive 可选):专业/学历/目标岗位/经验/场景仅用于引导
// 优化措辞重点(拼进 prompt 的「优化方向」段),不是事实来源——事实字段仍只能来自简历原文,
// 不得据 targetContext 新增或改写任何学校/公司/学历/证书/经历。字段值当作普通文本处理,
// 不作为可信 HTML/prompt 指令。
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
const MAX_WARNING_CHARS = 120
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
  '8. 若收到"优化方向"提示(专业/学历/目标岗位/经验级别/求职场景),只能用于调整措辞重点与用词方向;不得据此新增、替换或"纠正"任何学校、公司、学历、证书、时间段等事实字段——事实字段仍必须逐字来自简历原文。',
].join('\n')

const RETRY_HINT =
  '上一次输出不符合要求。请严格只输出 JSON;resume 中的学校/公司/证书/联系方式必须逐字来自简历原文;modules 的 before 必须是原文连续片段。'

const LAYOUT_ADJUST_SYSTEM_PROMPT = [
  '你是「AI 求职打印服务终端」的简历排版与内容微调引擎。你只在用户已确认的结构化简历基础上做表达密度调整。',
  '严格要求:',
  '1. 只输出一个 JSON 对象,不要解释、前后缀或代码块标记。',
  '2. JSON 形如:{"resume":{"basic":{"name":"","phone":"","email":"","city":""},"intention":{"position":"","city":""},"summary":"","education":[{"school":"","major":"","degree":"","period":"","description":""}],"experience":[{"company":"","role":"","period":"","description":""}],"projects":[{"name":"","role":"","description":""}],"skills":[""],"certificates":[""]},"warnings":[""]}。',
  '3. 不得新增任何学校、公司、岗位、项目、证书、联系方式、时间段或数字;所有事实必须来自原始简历文本或当前结构化简历的字段值。',
  '4. 不得增加 education/experience/projects/skills/certificates 条目数量;信息不足时保留原字段或精简描述。',
  '5. action=condense 时压缩 summary/description 字数,保留原数字;action=reformat 时按排版参数调整措辞密度。',
  '6. 不得输出任何录用、投递、面试邀约、Offer 或通过率类承诺。',
].join('\n')

const LAYOUT_ADJUST_RETRY_HINT =
  '上一次输出不符合要求。请只输出 JSON;不得新增条目、事实字段或数字;不得包含录用/投递/面试承诺。'

interface ChatMessage {
  role: 'system' | 'user'
  content: string
}

export interface OptimizeResult {
  optimizedResume: GeneratedResume
  modules: ResumeOptimizeModule[]
}

export type ResumeLayoutAdjustAction = 'reformat' | 'condense'

export interface LayoutAdjustInput {
  currentResume: GeneratedResume
  originalText: string
  action: ResumeLayoutAdjustAction
  layout?: ResumeLayoutSettings
}

export interface LayoutAdjustResult {
  resume: GeneratedResume
  warnings: string[]
}

/**
 * 清洗 targetContext 自由文本字段:去控制字符、折叠空白、截断长度。
 * 仅作为普通文本方向提示塞进 user prompt,不当作可信 HTML/prompt 指令解析。
 */
function cleanTargetText(value: unknown, maxLen: number): string {
  if (typeof value !== 'string') return ''
  const text = [...value]
    .map((ch) => {
      const code = ch.charCodeAt(0)
      return code < 32 || code === 127 ? ' ' : ch
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
  return text.slice(0, maxLen)
}

/**
 * 把目标方向上下文拼成一段「优化方向」提示,仅用于引导措辞重点。
 * 红线:不产出任何事实字段,不替代原文;调用方仍必须走既有事实串/承诺词校验。
 */
function buildTargetContextPrompt(target?: ResumeTargetContext): string {
  if (!target || target.skipped) return ''
  const major = cleanTargetText(target.major, 40)
  const degree = cleanTargetText(target.degree, 20)
  const targetJob = cleanTargetText(target.targetJob, 80)
  const industry = cleanTargetText(target.industry, 40)
  const experience = cleanTargetText(target.experience, 20)
  const scene = cleanTargetText(target.scene, 20)
  const parts = [
    major ? `专业方向=${major}` : '',
    degree ? `学历层次=${degree}` : '',
    targetJob ? `目标岗位=${targetJob}` : '',
    industry ? `行业方向=${industry}` : '',
    experience ? `经验级别=${experience}` : '',
    scene ? `求职场景=${scene}` : '',
  ].filter(Boolean)
  if (parts.length === 0) return ''
  return `优化方向(仅用于调整措辞重点,不得据此新增或改写任何事实字段;事实仍须逐字来自简历原文):${parts.join('；')}\n`
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
   * targetContext(可选):仅拼进「优化方向」提示引导措辞重点,不改变防编造/承诺拦截校验。
   * - 未配置 / 未启用 → AI_PROVIDER_NOT_CONFIGURED(绝不 fallback mock)。
   * - 非法 JSON / 事实串不在原文 / 命中承诺类拦截词 → 重试一次;仍坏 → AI_OPTIMIZE_INVALID_OUTPUT。
   */
  async optimize(extractedText: string, report: ResumeReport, targetContext?: ResumeTargetContext): Promise<OptimizeResult> {
    const apiKey = this.config.getApiKey('resume_optimize')
    const cfg = this.config.getConfig('resume_optimize')
    if (!apiKey || !cfg.enabled) {
      throw new ServiceUnavailableException({
        error: { code: 'AI_PROVIDER_NOT_CONFIGURED', message: 'AI 简历优化模型尚未配置或未启用，请联系管理员' },
      })
    }

    const text = (extractedText ?? '').slice(0, MAX_INPUT_CHARS)
    const reportBrief = report.sections.map((s) => `${s.label}:${s.score}/${s.maxScore}`).join('、')
    const directionPrompt = buildTargetContextPrompt(targetContext)
    const baseMessages: ChatMessage[] = [
      { role: 'system', content: OPTIMIZE_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `${directionPrompt}诊断报告摘要:${reportBrief}\n改进建议:${(report.suggestions ?? []).join(';')}\n\n简历原文:\n${text}`,
      },
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

  /**
   * 基于当前结构化简历 + 原始简历文本做 AI 一键排版/精简。
   *
   * 安全边界:
   * - 仍复用 resume_optimize 功能级凭证;未配置/未启用时明确失败,不 fallback mock。
   * - 事实基线 = 原始简历文本 + 当前简历字段值;字段名(JSON key)不作为事实来源。
   * - 条目数量不得增加;学校/公司/项目/证书/联系方式/数字新增即判非法。
   */
  async adjustLayoutDraft(input: LayoutAdjustInput): Promise<LayoutAdjustResult> {
    const apiKey = this.config.getApiKey('resume_optimize')
    const cfg = this.config.getConfig('resume_optimize')
    if (!apiKey || !cfg.enabled) {
      throw new ServiceUnavailableException({
        error: { code: 'AI_PROVIDER_NOT_CONFIGURED', message: 'AI 简历优化模型尚未配置或未启用，请联系管理员' },
      })
    }

    const originalText = (input.originalText ?? '').slice(0, MAX_INPUT_CHARS)
    if (!originalText.trim()) {
      throw new ServiceUnavailableException({
        error: { code: 'AI_RESUME_SOURCE_UNAVAILABLE', message: '简历原文已按隐私策略自动清理，请重新上传简历后再调整排版' },
      })
    }
    const factSource = `${originalText}\n${extractResumeValueText(input.currentResume)}`
    const layoutHint = buildLayoutHint(input.layout)
    const actionHint =
      input.action === 'condense'
        ? 'action=condense:请精简 summary 与 description,让版面更紧凑,不得丢失原文数字。'
        : 'action=reformat:请按排版参数调整表达密度和条目措辞,不得新增事实。'
    const baseMessages: ChatMessage[] = [
      { role: 'system', content: LAYOUT_ADJUST_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `${actionHint}\n${layoutHint}\n当前结构化简历(JSON,字段名不是事实来源):\n${JSON.stringify(input.currentResume)}\n\n原始简历文本:\n${originalText}`,
      },
    ]

    for (let attempt = 1; attempt <= 2; attempt++) {
      const messages =
        attempt === 1 ? baseMessages : [...baseMessages, { role: 'system' as const, content: LAYOUT_ADJUST_RETRY_HINT }]
      const raw = await this.callLlm(cfg.baseURL, apiKey, cfg.model, OPTIMIZE_TEMPERATURE, messages)
      const result = this.parseLayoutAdjustAndValidate(raw, factSource, cfg.forbiddenWords, input.currentResume)
      if (result) return result
      this.logger.warn(`resume layout adjust: invalid output (attempt ${attempt}/2)`)
    }

    throw new ServiceUnavailableException({
      error: { code: 'AI_LAYOUT_ADJUST_INVALID_OUTPUT', message: 'AI 排版调整结果包含无法确认的信息，系统已拦截' },
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
      const major = strOf(item, 'major', 60)
      const degree = strOf(item, 'degree', 20)
      // 2B 收口补强:学历/专业同为高危篡改点(如 大专→本科),必须在原文中出现;
      // 原文没有时模型应留空(inText('') 合法),写了但不在原文 → 整体非法
      if (!inText(school) || !inText(major) || !inText(degree)) return null
      const description = clean(item['description'], MAX_DESC_CHARS)
      if (description === null) return null
      education.push({
        school,
        major: major || undefined,
        degree: degree || undefined,
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

  private parseLayoutAdjustAndValidate(
    raw: string,
    factSource: string,
    forbiddenWords: string[],
    currentResume: GeneratedResume,
  ): LayoutAdjustResult | null {
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
    const r = rawResume as Record<string, unknown>

    if (arrayLength(r['education']) > currentResume.education.length) return null
    if (arrayLength(r['experience']) > currentResume.experience.length) return null
    if (arrayLength(r['projects']) > currentResume.projects.length) return null
    if (arrayLength(r['skills']) > currentResume.skills.length) return null
    if (arrayLength(r['certificates']) > currentResume.certificates.length) return null

    const normFact = normalizeForMatch(factSource)
    const inFact = (value: string | undefined): boolean => {
      if (!value || !value.trim()) return true
      const needle = normalizeForMatch(value)
      return needle.length > 0 && normFact.includes(needle)
    }
    const hasNoNewNumbers = (value: string): boolean => {
      for (const token of value.match(/\d+(?:\.\d+)?%?/g) ?? []) {
        if (!normFact.includes(normalizeForMatch(token))) return false
      }
      return true
    }
    const blocked = [...OPTIMIZE_GUARD_TERMS, ...forbiddenWords]
    const clean = (value: unknown, maxLen: number): string | null => {
      if (typeof value !== 'string') return ''
      const text = value.trim().slice(0, maxLen)
      if (text && containsForbiddenWord(text, blocked)) return null
      if (text && !hasNoNewNumbers(text)) return null
      return text
    }
    const fact = (value: string | undefined): boolean => inFact(value) && hasNoNewNumbers(value ?? '')

    const basicRaw = (r['basic'] ?? {}) as Record<string, unknown>
    const intentionRaw = (r['intention'] ?? {}) as Record<string, unknown>
    const summary = clean(r['summary'], MAX_SUMMARY_CHARS)
    if (summary === null) return null

    const name = strOf(basicRaw, 'name', 50)
    const phone = strOf(basicRaw, 'phone', 30)
    const email = strOf(basicRaw, 'email', 100)
    const city = strOf(basicRaw, 'city', 50)
    const position = strOf(intentionRaw, 'position', 60)
    const intentionCity = strOf(intentionRaw, 'city', 50)
    if (!fact(name) || !fact(phone) || !fact(email) || !fact(city) || !fact(position) || !fact(intentionCity)) return null

    const education: GeneratedResume['education'] = []
    for (const item of asArray(r['education'], currentResume.education.length)) {
      const school = strOf(item, 'school', 100)
      if (!school) continue
      const major = strOf(item, 'major', 60)
      const degree = strOf(item, 'degree', 20)
      const period = strOf(item, 'period', 40)
      if (!fact(school) || !fact(major) || !fact(degree) || !fact(period)) return null
      const description = clean(item['description'], MAX_DESC_CHARS)
      if (description === null) return null
      education.push({ school, major: major || undefined, degree: degree || undefined, period: period || undefined, description: description || undefined })
    }

    const experience: GeneratedResume['experience'] = []
    for (const item of asArray(r['experience'], currentResume.experience.length)) {
      const company = strOf(item, 'company', 100)
      const role = strOf(item, 'role', 60)
      if (!company || !role) continue
      const period = strOf(item, 'period', 40)
      if (!fact(company) || !fact(role) || !fact(period)) return null
      const description = clean(item['description'], MAX_DESC_CHARS)
      if (description === null) return null
      experience.push({ company, role, period: period || undefined, description })
    }

    const projects: GeneratedResume['projects'] = []
    for (const item of asArray(r['projects'], currentResume.projects.length)) {
      const name = strOf(item, 'name', 100)
      if (!name) continue
      const role = strOf(item, 'role', 60)
      if (!fact(name) || !fact(role)) return null
      const description = clean(item['description'], MAX_DESC_CHARS)
      if (description === null) return null
      projects.push({ name, role: role || undefined, description })
    }

    const skills: string[] = []
    for (const skill of asStrArray(r['skills'], currentResume.skills.length)) {
      const cleaned = clean(skill, MAX_SKILL_CHARS)
      if (cleaned === null || !fact(cleaned)) return null
      if (cleaned) skills.push(cleaned)
    }

    const certificates: string[] = []
    for (const cert of asStrArray(r['certificates'], currentResume.certificates.length)) {
      const cleaned = clean(cert, 60)
      if (cleaned === null || !fact(cleaned)) return null
      if (cleaned) certificates.push(cleaned)
    }

    const warnings = asStrArray(obj['warnings'], 5)
      .map((value) => clean(value, MAX_WARNING_CHARS))
      .filter((value): value is string => typeof value === 'string' && value.length > 0)

    return {
      resume: {
        basic: {
          name,
          phone: phone || undefined,
          email: email || undefined,
          city: city || undefined,
        },
        intention: {
          position,
          city: intentionCity || undefined,
        },
        summary,
        education,
        experience,
        projects,
        skills,
        certificates,
      },
      warnings,
    }
  }
}

function buildLayoutHint(layout?: ResumeLayoutSettings): string {
  if (!layout) return '排版参数:默认。'
  const parts = [
    layout.fontScale ? `字号=${layout.fontScale}` : '',
    layout.lineSpacing ? `行距=${layout.lineSpacing}` : '',
    layout.margin ? `页边距=${layout.margin}` : '',
    layout.columns ? `栏数=${layout.columns}` : '',
    layout.accent ? `主色=${layout.accent}` : '',
  ].filter(Boolean)
  return `排版参数:${parts.join('；') || '默认'}。`
}

function extractResumeValueText(resume: GeneratedResume): string {
  const values: string[] = []
  const collect = (value: unknown) => {
    if (typeof value === 'string' || typeof value === 'number') {
      const text = String(value).trim()
      if (text) values.push(text)
      return
    }
    if (Array.isArray(value)) {
      for (const item of value) collect(item)
      return
    }
    if (value && typeof value === 'object') {
      for (const item of Object.values(value)) collect(item)
    }
  }
  collect(resume)
  return values.join('\n')
}

function arrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0
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
