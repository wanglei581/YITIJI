import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common'
import type { GeneratedResume, ResumeGenerateInput } from '../interfaces/ai-provider.interface'
import { LlmConfigService } from '../llm/llm-config.service'
import { containsForbiddenWord } from '../llm/llm-guard'

// ============================================================
// LlmResumeGenerateService — 阶段2A 真实简历生成(单轮、结构化 JSON,OpenAI 兼容)
//
// 防编造契约(本服务的核心设计,优先级高于一切润色效果):
//   - LLM **只返回按 index 对齐的润色文本**:summary / educationDesc[] /
//     experienceDesc[] / projectDesc[] / skillsPolished[]。
//   - 最终简历由服务端组装:学校/专业/学位/公司/职务/项目名/证书/时间段等
//     事实字段从用户输入**逐字复制**——LLM 结构上不可能新增、删除或虚构经历条目。
//   - 数组长度与输入不一致 → 判非法,重试一次;仍失败 → 明确报错,不出半截结果。
//   - 用户没填的内容保持为空,由 missingHints(服务端确定性计算)提示用户补充,AI 不代填。
//
// 复用 LlmConfigService 的 resume_generate 功能级加密凭证;不引入 SDK,全局 fetch。
// 安全:出错只记状态码,绝不记 prompt / 用户资料 / 请求·响应正文(简历输入含 PII)。
// ============================================================

/** 单条润色文本上限(防超长撑爆版面;超限截断)。 */
const MAX_DESC_CHARS = 600
const MAX_SUMMARY_CHARS = 300
const MAX_SKILL_CHARS = 40
/** 生成求稳。 */
const GENERATE_TEMPERATURE = 0.3

/**
 * 生成专属合规拦截词(恒定生效,与管理员可配 forbiddenWords 叠加)。
 * 命中即丢弃该条润色、回退用户原文(宁可不润色,不让违规表述进简历)。
 */
const j = (...parts: string[]): string => parts.join('')
const GENERATE_GUARD_TERMS = [
  j('保', '录用'),
  j('保', '面试'),
  j('内', '推'),
  j('一键', '投递'),
  j('平台', '投递'),
]

const GENERATE_SYSTEM_PROMPT = [
  '你是「AI 求职打印服务终端」的简历润色引擎。用户提供了结构化的真实简历资料,你只负责润色表达,绝不编造。',
  '严格要求:',
  '1. 只输出一个 JSON 对象,不要任何解释、前后缀或代码块标记。',
  '2. JSON 形如:{"summary":"...","educationDesc":["..."],"experienceDesc":["..."],"projectDesc":["..."],"skillsPolished":["..."]}。',
  '3. educationDesc / experienceDesc / projectDesc 数组长度必须与输入的教育/经历/项目条目数完全一致,按原顺序逐条对应;某条没有可润色的描述就返回空字符串 ""。',
  '4. skillsPolished 数组长度必须与输入技能数完全一致,只做表达归一(如统一大小写、补全通用名称),不新增技能。',
  '5. summary 为 2~3 句个人简介,只能基于用户提供的资料概括;资料不足时基于已有内容写,绝不虚构。',
  '6. 红线:不得编造或暗示用户输入中不存在的学校、学历、专业、公司、职务、项目、证书、奖项、数据指标或时间段;不得把用户没写的数字写进润色文本。',
  '7. 润色方向:动词开头、表达具体、突出职责与成果;用户原文里有的数字必须原样保留。',
  '8. 不得输出任何录用、投递、面试邀约或求职结果类承诺。',
].join('\n')

const RETRY_HINT =
  '上一次输出不符合要求。请严格只输出 JSON 对象,且 educationDesc/experienceDesc/projectDesc/skillsPolished 数组长度必须与输入条目数一致。'

interface ChatMessage {
  role: 'system' | 'user'
  content: string
}

interface PolishPayload {
  summary: string
  educationDesc: string[]
  experienceDesc: string[]
  projectDesc: string[]
  skillsPolished: string[]
}

/** 缺失提示:服务端确定性计算,与 LLM 无关(AI 不代填,提示用户补充)。 */
export function computeMissingHints(input: ResumeGenerateInput): string[] {
  const hints: string[] = []
  if (!input.basic.phone && !input.basic.email) hints.push('未填写联系方式(电话/邮箱),招聘方将无法联系你')
  if (input.education.length === 0) hints.push('未填写教育经历,建议补充学校与专业')
  if (input.experience.length === 0 && input.projects.length === 0) hints.push('未填写实习/工作或项目经历,简历说服力会偏弱')
  if (input.skills.length === 0) hints.push('未填写技能,建议补充与目标岗位相关的技能')
  const thinDesc = input.experience.filter((e) => e.description.trim().length < 20).length
  if (thinDesc > 0) hints.push(`${thinDesc} 段经历描述过于简短,建议补充具体职责与成果(如数字、规模)`)
  return hints
}

@Injectable()
export class LlmResumeGenerateService {
  private readonly logger = new Logger(LlmResumeGenerateService.name)

  constructor(private readonly config: LlmConfigService) {}

  /**
   * 基于用户结构化输入生成简历(只润色,不编造)。
   * - 未配置 / 未启用 → AI_PROVIDER_NOT_CONFIGURED(绝不 fallback mock)。
   * - 非法 JSON / 数组长度漂移 → 重试一次;仍失败 → AI_GENERATE_INVALID_OUTPUT。
   */
  async generate(input: ResumeGenerateInput): Promise<GeneratedResume> {
    const apiKey = this.config.getApiKey('resume_generate')
    const cfg = this.config.getConfig('resume_generate')
    if (!apiKey || !cfg.enabled) {
      throw new ServiceUnavailableException({
        error: { code: 'AI_PROVIDER_NOT_CONFIGURED', message: 'AI 简历生成模型尚未配置或未启用，请联系管理员' },
      })
    }

    const baseMessages: ChatMessage[] = [
      { role: 'system', content: GENERATE_SYSTEM_PROMPT },
      { role: 'user', content: buildGenerateUserPrompt(input) },
    ]

    for (let attempt = 1; attempt <= 2; attempt++) {
      const messages =
        attempt === 1 ? baseMessages : [...baseMessages, { role: 'system' as const, content: RETRY_HINT }]
      const raw = await this.callLlm(cfg.baseURL, apiKey, cfg.model, GENERATE_TEMPERATURE, messages)
      const polish = this.parsePolish(raw, input)
      if (polish) return assembleResume(input, polish, cfg.forbiddenWords)
      this.logger.warn(`resume generate: invalid output (attempt ${attempt}/2)`)
    }

    throw new ServiceUnavailableException({
      error: { code: 'AI_GENERATE_INVALID_OUTPUT', message: 'AI 简历生成服务暂时不可用，请稍后重试' },
    })
  }

  // ── OpenAI 兼容 Chat Completions(出错不记正文:输入含 PII)──────────────────

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
      throw new ServiceUnavailableException({
        error: { code: 'AI_GENERATE_UNAVAILABLE', message: 'AI 简历生成服务连接失败，请稍后重试' },
      })
    }

    if (!res.ok) {
      this.logger.error(`resume generate http ${res.status}`)
      throw new ServiceUnavailableException({
        error: { code: 'AI_GENERATE_UNAVAILABLE', message: `AI 简历生成服务返回错误 (${res.status})` },
      })
    }

    const data = (await res.json().catch(() => null)) as {
      choices?: Array<{ message?: { content?: string } }>
    } | null
    const content = data?.choices?.[0]?.message?.content?.trim()
    if (!content) {
      throw new ServiceUnavailableException({
        error: { code: 'AI_GENERATE_UNAVAILABLE', message: 'AI 简历生成服务未返回内容' },
      })
    }
    return content
  }

  // ── 解析 + 强校验润色载荷 ───────────────────────────────────────────────────

  /** 数组长度必须与输入条目数完全一致(防编造/丢条目),否则判非法触发重试。 */
  private parsePolish(raw: string, input: ResumeGenerateInput): PolishPayload | null {
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

    const summary = typeof obj['summary'] === 'string' ? obj['summary'].trim() : null
    const educationDesc = asStringArray(obj['educationDesc'])
    const experienceDesc = asStringArray(obj['experienceDesc'])
    const projectDesc = asStringArray(obj['projectDesc'])
    const skillsPolished = asStringArray(obj['skillsPolished'])
    if (summary === null || !educationDesc || !experienceDesc || !projectDesc || !skillsPolished) return null

    if (educationDesc.length !== input.education.length) return null
    if (experienceDesc.length !== input.experience.length) return null
    if (projectDesc.length !== input.projects.length) return null
    if (skillsPolished.length !== input.skills.length) return null

    return { summary, educationDesc, experienceDesc, projectDesc, skillsPolished }
  }
}

function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  if (!value.every((x): x is string => typeof x === 'string')) return null
  return value.map((x) => x.trim())
}

/** 容忍模型偶尔包裹代码块或夹带说明:去掉 ``` 围栏后,抽取第一个 { 到最后一个 }。 */
function extractJson(raw: string): string | null {
  const cleaned = raw.replace(/```(?:json)?/g, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  return cleaned.slice(start, end + 1)
}

function buildGenerateUserPrompt(input: ResumeGenerateInput): string {
  // 只传润色需要的内容;姓名/电话/邮箱等身份字段不进 prompt(服务端直接复制,降低 PII 外发面)。
  return JSON.stringify({
    求职意向: input.intention,
    教育经历: input.education.map((e) => ({ 学校: e.school, 专业: e.major ?? '', 学历: e.degree ?? '', 描述: e.description ?? '' })),
    实习工作经历: input.experience.map((e) => ({ 公司: e.company, 职务: e.role, 描述: e.description })),
    项目经历: input.projects.map((p) => ({ 项目: p.name, 角色: p.role ?? '', 描述: p.description })),
    技能: input.skills,
    证书: input.certificates,
    自我评价草稿: input.selfIntro ?? '',
  })
}

/**
 * 服务端组装最终简历:事实字段逐字复制自用户输入,仅描述文本采用润色产物。
 * 润色文本命中合规拦截词 → 丢弃该条润色,回退用户原文。
 */
export function assembleResume(
  input: ResumeGenerateInput,
  polish: PolishPayload,
  forbiddenWords: readonly string[],
): GeneratedResume {
  const blocked = [...GENERATE_GUARD_TERMS, ...forbiddenWords]
  const safe = (polished: string, fallback: string, maxLen: number): string => {
    let text = polished.trim()
    if (!text || containsForbiddenWord(text, blocked)) text = fallback.trim()
    return text.slice(0, maxLen)
  }

  return {
    basic: { ...input.basic },
    intention: { ...input.intention },
    summary: safe(polish.summary, input.selfIntro ?? '', MAX_SUMMARY_CHARS),
    education: input.education.map((e, i) => ({
      school: e.school,
      major: e.major,
      degree: e.degree,
      period: e.period,
      description: safe(polish.educationDesc[i] ?? '', e.description ?? '', MAX_DESC_CHARS) || undefined,
    })),
    experience: input.experience.map((e, i) => ({
      company: e.company,
      role: e.role,
      period: e.period,
      description: safe(polish.experienceDesc[i] ?? '', e.description, MAX_DESC_CHARS),
    })),
    projects: input.projects.map((p, i) => ({
      name: p.name,
      role: p.role,
      description: safe(polish.projectDesc[i] ?? '', p.description, MAX_DESC_CHARS),
    })),
    skills: input.skills.map((s, i) => safe(polish.skillsPolished[i] ?? '', s, MAX_SKILL_CHARS)),
    certificates: [...input.certificates],
  }
}
