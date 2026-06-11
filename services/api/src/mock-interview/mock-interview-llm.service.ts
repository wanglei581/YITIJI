import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common'
import { LlmConfigService } from '../ai/llm/llm-config.service'

// ============================================================
// 2C 模拟面试 LLM 服务：面试官提问 + 练习报告生成。
//
// 合规（硬约束，双层防线）：
// - System Prompt 服务端强制：明确"求职者本人练习工具"，禁止任何录用承诺。
// - 输出侧禁词校验：问题文本命中禁词 → 重新生成一次 → 仍命中则诚实失败；
//   报告 JSON 全文扫描禁词 → 重试一次 → 仍命中拒绝输出（不清洗后照发）。
// - 对话内容 / 报告原文绝不写日志，只记元数据（sessionId/耗时/轮次）。
// ============================================================

/** 面试场景禁词（叠加在管理员 forbiddenWords 之上，不可配置移除）。 */
export const INTERVIEW_BANNED_TERMS = [
  '保过', '通过率', 'Offer 概率', 'Offer概率', '录用概率', '录用率', '精准命中',
  'HR 内部题库', 'HR内部题库', '保证拿 Offer', '保证拿Offer', '保录用', '保面试',
  '企业筛选', '候选人推荐', '内部渠道',
] as const

export function findBannedTerm(text: string): string | null {
  for (const term of INTERVIEW_BANNED_TERMS) {
    if (text.includes(term)) return term
  }
  return null
}

const INTERVIEWER_STYLE: Record<string, string> = {
  hr: 'HR 初筛面试官：关注自我介绍、求职动机、稳定性、薪资期望沟通方式。',
  manager: '业务主管：关注过往经历、岗位理解、协作能力、执行落地能力。',
  tech: '技术面试官：关注专业技能、项目细节、问题解决思路，会就细节追问。',
  campus: '校招面试官：关注校园经历、学习能力、职业规划，语气友善。',
  final: '终面负责人：关注价值观、长期发展意愿、综合判断，问题更宏观。',
}

const DIFFICULTY_NOTE: Record<string, string> = {
  easy: '难度=轻松练习：问题基础、节奏友好，不连续追问。',
  standard: '难度=标准面试：接近真实面试节奏，可适度追问。',
  pressure: '难度=压力面试：多就上一回答的细节与数据追问、验证一致性，但语气保持专业礼貌，绝不冒犯、贬低或人身攻击。',
}

const EXPERIENCE_LABEL: Record<string, string> = {
  fresh: '应届生', lt1: '1 年以内经验', y1_3: '1-3 年经验', y3_5: '3-5 年经验', gt5: '5 年以上经验', switch: '转行求职',
}

export interface NextQuestionInput {
  interviewerType: string
  industry: string
  position: string
  experience: string
  difficulty: string
  questionTarget: number
  askedCount: number
  resumeDigest: string | null
  transcript: Array<{ role: 'interviewer' | 'candidate'; content: string; skipped?: boolean }>
}

export interface NextQuestionOutput {
  greeting?: string
  question: string
  qType: string
}

export interface ReportInput {
  interviewerType: string
  industry: string
  position: string
  experience: string
  difficulty: string
  resumeDigest: string | null
  transcript: Array<{
    role: 'interviewer' | 'candidate'
    content: string
    skipped?: boolean
    /** 回答耗时(秒,2C+ 语音/计时回合) */
    durationSec?: number
    inputMode?: string
  }>
}

export interface InterviewReportPayload {
  overall: { level: 'needs_work' | 'pass' | 'good' | 'excellent'; summary: string }
  expression: string[]
  positionFit: string[]
  credibility: string[]
  professional: string[]
  adaptability: string[]
  risks: string[]
  predictedQuestions: Array<{ question: string; why: string; approach: string }>
  starAdvice: { s: string; t: string; a: string; r: string; reminder: string }
  checklist: string[]
}

const Q_TYPES = ['intro', 'position', 'experience', 'skill', 'behavior', 'plan', 'reverse', 'closing'] as const

function basePersona(input: { interviewerType: string; industry: string; position: string; experience: string; difficulty: string }): string {
  return (
    `你是一位${INTERVIEWER_STYLE[input.interviewerType] ?? INTERVIEWER_STYLE['hr']}\n` +
    `场景：求职者目标岗位「${input.position}」（${input.industry} 行业），${EXPERIENCE_LABEL[input.experience] ?? input.experience}。\n` +
    `${DIFFICULTY_NOTE[input.difficulty] ?? DIFFICULTY_NOTE['standard']}\n` +
    '这是求职者本人的面试练习工具，不是真实招聘。绝对禁止出现以下内容：任何录用/通过承诺、' +
    '通过率、Offer 概率、保过、内部题库、企业筛选、候选人推荐等表述；不评价用户人格；不索要身份证号等敏感证件信息。'
  )
}

@Injectable()
export class MockInterviewLlmService {
  private readonly logger = new Logger(MockInterviewLlmService.name)

  constructor(private readonly config: LlmConfigService) {}

  /** 生成下一道面试问题（首题附问候语）。命中禁词自动重生成一次。 */
  async nextQuestion(input: NextQuestionInput): Promise<NextQuestionOutput> {
    const isFirst = input.askedCount === 0
    const isLast = input.askedCount >= input.questionTarget - 1
    const sys =
      basePersona(input) +
      '\n你的任务：基于已进行的对话提出下一道面试问题。' +
      `共 ${input.questionTarget} 题，当前是第 ${input.askedCount + 1} 题。` +
      (isFirst ? '这是开场：先用一句话礼貌问候并自我介绍身份，再提第一题（通常是自我介绍）。' : '') +
      (isLast ? '这是最后一题：用收尾性问题（如让求职者反问你 1-2 个问题，或补充想强调的内容）。' : '') +
      '\n只输出 JSON（不要 markdown 代码块）：{"greeting":"仅首题给一句问候，否则省略","question":"问题文本（一次只问一个问题，不超过 80 字）","qType":"intro|position|experience|skill|behavior|plan|reverse|closing 之一"}'

    const userParts: string[] = []
    if (input.resumeDigest) userParts.push(`【求职者简历摘要（仅练习用）】\n${input.resumeDigest.slice(0, 3000)}`)
    if (input.transcript.length > 0) {
      const recent = input.transcript.slice(-10)
        .map((t) => `${t.role === 'interviewer' ? '面试官' : '求职者'}：${t.skipped ? '（跳过了这个问题）' : t.content.slice(0, 500)}`)
        .join('\n')
      userParts.push(`【已进行的对话】\n${recent}`)
    }
    if (userParts.length === 0) userParts.push('（首题，尚无对话）')

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const raw = await this.callLlm(sys, userParts.join('\n\n'))
      const parsed = this.parseJson<Partial<NextQuestionOutput>>(raw)
      const question = typeof parsed?.question === 'string' ? parsed.question.trim().slice(0, 200) : ''
      if (!question) continue
      const qType = (Q_TYPES as readonly string[]).includes(parsed?.qType ?? '') ? (parsed!.qType as string) : (isFirst ? 'intro' : isLast ? 'closing' : 'experience')
      const greeting = isFirst && typeof parsed?.greeting === 'string' ? parsed.greeting.trim().slice(0, 120) : undefined
      const banned = findBannedTerm(`${greeting ?? ''}${question}`)
      if (banned) {
        this.logger.warn(`interview.question_banned attempt=${attempt}`)
        continue
      }
      return { question, qType, ...(greeting ? { greeting } : {}) }
    }
    throw new ServiceUnavailableException({ error: { code: 'AI_INTERVIEW_QUESTION_FAILED', message: '面试问题生成失败，请稍后重试' } })
  }

  /** 生成练习报告（10 模块 JSON 契约）。结构不符 / 命中禁词 → 重试一次 → 诚实失败。 */
  async buildReport(input: ReportInput): Promise<InterviewReportPayload> {
    const sys =
      basePersona(input) +
      '\n你的任务：基于完整对话，生成一份「模拟面试练习报告」。这是练习反馈，不是录用评估。' +
      '\n要求：所有判断必须基于对话中真实出现的内容；用户没有回答到的方面如实写"本次练习未充分覆盖"；' +
      '不编造用户没有说过的经历；overall.level 是练习表现等级（needs_work=需要加强 / pass=基础达标 / good=表现良好 / excellent=表现突出），不是通过率。' +
      '\n对话中部分回答带有耗时元数据（秒），可据此在 expression/adaptability 模块中评价回答完整度、表达结构、追问应对与时间控制（过短可能不充分、过长可能不聚焦）。' +
      '【禁止】评价语速、语调、情绪稳定性——你只有文字转写，没有任何音频特征分析，不得编造此类判断。' +
      '\n只输出 JSON（不要 markdown 代码块），结构：' +
      '{"overall":{"level":"needs_work|pass|good|excellent","summary":"2-3 句总评"},' +
      '"expression":["表达清晰度要点 2-4 条：结构性/是否绕圈/重点突出/职责成果是否讲清"],' +
      '"positionFit":["岗位匹配度参考 2-4 条：回答与目标岗位的贴近度、经历支撑度（只能称为参考）"],' +
      '"credibility":["经历可信度与细节 2-4 条：背景/职责/量化结果/经得起追问"],' +
      '"professional":["专业能力表现 2-4 条：按目标岗位类型评价"],' +
      '"adaptability":["沟通与应变 2-3 条：追问应对/承认不确定/表达稳定性"],' +
      '"risks":["风险点与改进建议 3-5 条，具体可执行"],' +
      '"predictedQuestions":[{"question":"建议继续准备的问题","why":"考察点","approach":"回答思路"}](3-5 个),' +
      '"starAdvice":{"s":"情境建议","t":"任务建议","a":"行动建议","r":"结果建议","reminder":"量化提醒"},' +
      '"checklist":["面试前准备清单 5-8 条：公司岗位调研/自我介绍/代表性经历/反问问题/材料/设备路线"]}'

    const transcript = input.transcript
      .map((t) => {
        const meta = t.role === 'candidate' && typeof t.durationSec === 'number' ? `（回答耗时 ${t.durationSec} 秒）` : ''
        return `${t.role === 'interviewer' ? '面试官' : '求职者'}：${t.skipped ? '（跳过）' : t.content.slice(0, 800)}${meta}`
      })
      .join('\n')
    const user =
      (input.resumeDigest ? `【简历摘要】\n${input.resumeDigest.slice(0, 3000)}\n\n` : '') +
      `【完整对话】\n${transcript || '（用户未回答任何问题）'}`

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const t0 = Date.now()
      const raw = await this.callLlm(sys, user)
      const parsed = this.parseJson<Partial<InterviewReportPayload>>(raw)
      const report = this.validateReport(parsed)
      if (!report) {
        this.logger.warn(`interview.report_invalid attempt=${attempt} ms=${Date.now() - t0}`)
        continue
      }
      const banned = findBannedTerm(JSON.stringify(report))
      if (banned) {
        this.logger.warn(`interview.report_banned attempt=${attempt}`)
        continue
      }
      // 2C+:无音频特征分析,报告不得出现语速/语调/情绪稳定类评价(命中按无效输出重试)
      if (/语速|语调|音调|情绪稳定/.test(JSON.stringify(report))) {
        this.logger.warn(`interview.report_audio_claim attempt=${attempt}`)
        continue
      }
      this.logger.log(`interview.report_ok ms=${Date.now() - t0}`)
      return report
    }
    throw new ServiceUnavailableException({ error: { code: 'AI_INTERVIEW_REPORT_FAILED', message: '练习报告生成失败，请稍后重试或重新练习' } })
  }

  // ── 校验 / 工具 ───────────────────────────────────────────────────────────

  private validateReport(p: Partial<InterviewReportPayload> | null): InterviewReportPayload | null {
    if (!p) return null
    const strArr = (v: unknown, min: number, max: number): string[] | null => {
      if (!Array.isArray(v)) return null
      const arr = v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim().slice(0, 300))
      return arr.length >= min ? arr.slice(0, max) : null
    }
    const levels = ['needs_work', 'pass', 'good', 'excellent']
    const overallRaw = p.overall
    if (!overallRaw || !levels.includes(overallRaw.level ?? '') || typeof overallRaw.summary !== 'string' || !overallRaw.summary.trim()) return null
    const expression = strArr(p.expression, 1, 4)
    const positionFit = strArr(p.positionFit, 1, 4)
    const credibility = strArr(p.credibility, 1, 4)
    const professional = strArr(p.professional, 1, 4)
    const adaptability = strArr(p.adaptability, 1, 4)
    const risks = strArr(p.risks, 1, 6)
    const checklist = strArr(p.checklist, 3, 10)
    if (!expression || !positionFit || !credibility || !professional || !adaptability || !risks || !checklist) return null
    if (!Array.isArray(p.predictedQuestions)) return null
    const predictedQuestions = p.predictedQuestions
      .filter((q): q is { question: string; why: string; approach: string } =>
        !!q && typeof q.question === 'string' && typeof q.why === 'string' && typeof q.approach === 'string')
      .map((q) => ({ question: q.question.trim().slice(0, 200), why: q.why.trim().slice(0, 200), approach: q.approach.trim().slice(0, 400) }))
      .filter((q) => q.question.length > 0)
      .slice(0, 6)
    if (predictedQuestions.length < 1) return null
    const sa = p.starAdvice
    if (!sa || [sa.s, sa.t, sa.a, sa.r, sa.reminder].some((x) => typeof x !== 'string' || !x.trim())) return null
    return {
      overall: { level: overallRaw.level as InterviewReportPayload['overall']['level'], summary: overallRaw.summary.trim().slice(0, 500) },
      expression, positionFit, credibility, professional, adaptability, risks,
      predictedQuestions,
      starAdvice: { s: sa.s!.trim().slice(0, 300), t: sa.t!.trim().slice(0, 300), a: sa.a!.trim().slice(0, 300), r: sa.r!.trim().slice(0, 300), reminder: sa.reminder!.trim().slice(0, 300) },
      checklist,
    }
  }

  private parseJson<T>(raw: string): T | null {
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
    try {
      return JSON.parse(cleaned) as T
    } catch {
      const start = cleaned.indexOf('{')
      const end = cleaned.lastIndexOf('}')
      if (start >= 0 && end > start) {
        try { return JSON.parse(cleaned.slice(start, end + 1)) as T } catch { return null }
      }
      return null
    }
  }

  /** OpenAI 兼容调用（mock_interview 功能位；密钥仅服务端，输出/输入不写日志）。 */
  private async callLlm(system: string, user: string): Promise<string> {
    const apiKey = this.config.getApiKey('mock_interview')
    const cfg = this.config.getConfig('mock_interview')
    if (!apiKey || !cfg.enabled) {
      throw new ServiceUnavailableException({ error: { code: 'AI_NOT_CONFIGURED', message: 'AI 模拟面试暂未启用，请联系管理员配置' } })
    }
    const url = `${cfg.baseURL.replace(/\/$/, '')}/chat/completions`
    let res: Response
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: cfg.model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          temperature: cfg.temperature,
          stream: false,
        }),
      })
    } catch {
      this.logger.error('interview.llm network_error')
      throw new ServiceUnavailableException({ error: { code: 'AI_UNAVAILABLE', message: 'AI 模型连接失败，请稍后重试' } })
    }
    if (!res.ok) {
      this.logger.error(`interview.llm upstream_non_2xx status=${res.status}`)
      throw new ServiceUnavailableException({ error: { code: 'AI_UNAVAILABLE', message: `AI 模型返回错误 (${res.status})` } })
    }
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
    const reply = data.choices?.[0]?.message?.content?.trim()
    if (!reply) {
      throw new ServiceUnavailableException({ error: { code: 'AI_UNAVAILABLE', message: 'AI 模型未返回内容' } })
    }
    return reply
  }
}
