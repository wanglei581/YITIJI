// ============================================================
// LlmChatService — 真实大模型对话（OpenAI 兼容协议）
//
// 适配 DeepSeek / 通义千问 / MiniMax（均兼容 OpenAI Chat Completions）。
//
// - 多轮记忆：按 sessionId 在内存保留最近若干轮（无 DB 依赖）
// - 合规动作注入：根据意图关键词附加站内白名单跳转按钮（确定性，不靠模型乱给链接）
// - apiKey 由 LlmConfigService 解密提供，绝不下发前端
// ============================================================

import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common'
import type {
  AssistantAction,
  AssistantIntent,
  AssistantSkill,
  ChatInput,
  ChatOutput,
} from '../interfaces/ai-provider.interface'
import { LlmConfigService } from './llm-config.service'
import type { AiModelFeatureKey } from './llm-config.service'
import { buildGuardedSystemPrompt, enforceForbiddenWords } from './llm-guard'

interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

// 每个会话保留的最大历史轮数（user+assistant 各算一条）
const MAX_HISTORY = 12
// 会话空闲过期时间
const SESSION_TTL_MS = 30 * 60 * 1000

interface SessionEntry {
  messages: ChatMessage[]
  updatedAt: number
}

// ── 意图 → 站内白名单跳转（确定性注入）────────────────────────
const INTENT_ROUTES: Record<AssistantIntent, AssistantAction[]> = {
  resume:  [{ label: '简历诊断', route: '/resume/report' }, { label: '上传简历', route: '/resume/source' }],
  print:   [{ label: '打印文件', route: '/print/upload' }, { label: '扫描材料', route: '/scan/start' }],
  job:     [{ label: '查看岗位', route: '/jobs' }],
  fair:    [{ label: '查看招聘会', route: '/job-fairs' }],
  policy:  [{ label: '人社专区', route: '/renshi' }],
  general: [],
}

const SKILL_ACTIONS: Record<AssistantSkill, AssistantAction[]> = {
  offer_compare: [
    { label: '查看岗位信息', route: '/jobs' },
    { label: '优化简历材料', route: '/resume/source' },
  ],
  salary_negotiation: [
    { label: '查看岗位信息', route: '/jobs' },
    { label: '优化简历材料', route: '/resume/source' },
  ],
  hr_qa: [
    { label: '人社专区', route: '/renshi' },
  ],
  self_intro_gen: [
    { label: '打印文件', route: '/print/upload' },
    { label: 'AI 简历服务', route: '/resume-service' },
  ],
  material_checklist: [
    { label: '打印清单', route: '/print/upload' },
    { label: '查看招聘会', route: '/job-fairs' },
  ],
  jd_analysis: [
    { label: '查看岗位信息', route: '/jobs' },
    { label: '去做模拟面试', route: '/interview/setup' },
  ],
  interview_questions: [
    { label: '打印题目', route: '/print/upload' },
    { label: 'AI 模拟面试', route: '/interview/setup' },
  ],
  career_explore: [
    { label: '查看岗位信息', route: '/jobs' },
    { label: '自我探索', route: '/resume/self-assessment/intro?from=assistant' },
  ],
  cover_letter_gen: [
    { label: '打印求职信', route: '/print/upload' },
    { label: '优化简历', route: '/resume-service' },
  ],
  resume_jd_match: [
    { label: '查看岗位信息', route: '/jobs' },
    { label: '去做简历诊断', route: '/resume/source' },
  ],
  company_research: [
    { label: '查看岗位信息', route: '/jobs' },
    { label: 'AI 模拟面试', route: '/interview/setup' },
  ],
}

const INTENT_RULES: [RegExp, AssistantIntent][] = [
  [/简历|履历|resume|cv/i,            'resume'],
  [/打印|复印|扫描|print|scan/i,       'print'],
  [/岗位|工作|职位|招工|求职|job/i,    'job'],
  [/招聘会|双选会|人才市场|fair/i,     'fair'],
  [/政策|补贴|社保|落户|人社/i,        'policy'],
]

const SKILL_SCOPED_PROMPTS: Record<AssistantSkill, string> = {
  offer_compare: [
    '当前处于百宝箱「Offer 对比」技能场景。',
    '请帮助用户从薪酬结构、试用期、工作地点、成长空间、稳定性、通勤和风险点等维度做个人决策参考。',
    '不得承诺录用结果，不得替用户联系企业，不得保存或要求用户提供无关隐私。',
    '如用户粘贴含姓名、身份证、完整手机号、银行卡等信息，请提醒其打码后再比较。',
    '结论必须标明仅供个人参考，不构成录用、入职或法律意见。',
  ].join('\n'),
  salary_negotiation: [
    '当前处于百宝箱「薪资谈判话术」技能场景。',
    '请输出理性、可执行、尊重双方的沟通话术，可按温和版、直接版、补充材料版组织。',
    '不得承诺涨薪成功，不得鼓励威胁、骚扰、造假、夸大经历或制造虚假竞品 Offer。',
    '结论必须标明仅供个人沟通准备参考，不构成涨薪或录用承诺。',
  ].join('\n'),
  hr_qa: [
    '当前处于百宝箱「HR 知识问答」技能场景。',
    '请用通俗语言解释入职、试用期、社保、公积金、离职、请假等常见 HR 流程和劳动常识。',
    '不得对具体争议给出确定法律结论，不得承诺仲裁、赔偿或维权结果。',
    '涉及劳动争议、赔偿、合同解除、工伤、仲裁等高风险问题时，应提示咨询官方人社窗口、法律援助或专业律师。',
    '结论必须标明仅供常识参考，不构成正式法律意见或官方政策承诺。',
  ].join('\n'),
  self_intro_gen: [
    '当前处于「AI 自我介绍生成」技能场景。',
    '只使用用户明确提供的岗位、教育、实习、项目、技能和成果事实，分别生成约 1 分钟和 3 分钟版本。',
    '不得编造经历、奖项、技能、数据或雇主评价；信息不足时先列出需要补充的事实。',
    '结论必须提醒用户根据真实情况核对和修改后使用。',
  ].join('\n'),
  material_checklist: [
    '当前处于「AI 材料准备清单」技能场景。',
    '根据用户明确提供的面试、招聘会或入职场景生成分组清单，并区分必带、建议携带和待确认项目。',
    '不得把通用经验冒充具体单位要求，不得要求无关身份证号、银行卡号等高敏信息。',
    '结论必须提示具体材料要求以用人单位或活动官方通知为准。',
  ].join('\n'),
  jd_analysis: [
    '当前处于「AI 岗位 JD 解读」技能场景。',
    '只基于用户提供的招聘要求，逐项解释职责、明确要求、优先条件和需要确认的信息。',
    '不得虚构招聘方内部标准、面试题、录用概率或岗位事实，不得替用户投递。',
    '结论必须标明仅供个人准备参考，不代表招聘方评价或录用标准。',
  ].join('\n'),
  interview_questions: [
    '当前处于「AI 面试题预测」技能场景。',
    '根据用户提供的岗位、公司类型和本人背景，整理常见练习题与基于真实经历的回答框架。',
    '不得声称掌握招聘方内部题库，不得编造用户经历或承诺面试、录用结果。',
    '结论必须提示题目仅供练习，实际面试问题以招聘方为准。',
  ].join('\n'),
  career_explore: [
    '当前处于「AI 求职方向探索」技能场景。',
    '基于用户自述的专业、经历、兴趣和约束，给出可核对的方向假设、所需能力和下一步验证行动。',
    '不得推断敏感属性，不得输出录用概率、人格定论或替用户做职业决定。',
    '结论必须标明仅供个人探索参考。',
  ].join('\n'),
  cover_letter_gen: [
    '当前处于「AI 求职信生成」技能场景。',
    '只使用用户明确提供的公司、岗位、经历、技能和动机，生成可编辑的求职信草稿。',
    '不得编造项目、成果、关系、奖项或对公司的了解，不得承诺投递或录用结果。',
    '结论必须提醒用户核对事实并根据实际情况修改后使用。',
  ].join('\n'),
  resume_jd_match: [
    '当前处于「AI 简历 JD 匹配」技能场景。',
    '逐项对照用户提供的 JD 要求与本人明确提供的经历证据，分为匹配项、证据不足项和可改进表达。',
    '不得编造简历事实，不得输出百分比匹配度、录用概率或招聘方评价，不得替用户投递。',
    '结论必须标明仅供本人求职准备参考。',
  ].join('\n'),
  company_research: [
    '当前处于「AI 企业面试速查」技能场景。',
    '基于用户提供的信息和模型可确认的公开常识，整理行业背景、建议核对的官方信息和面试准备问题。',
    '无法确认时必须明确说明，不得虚构企业现状、内部流程、面试风格、题库或录用标准。',
    '结论必须提示以企业官网、招聘公告及来源平台的最新公开信息为准。',
  ].join('\n'),
}

function buildSkillScopedSystemPrompt(basePrompt: string, skill?: AssistantSkill): string {
  const scopedPrompt = skill ? SKILL_SCOPED_PROMPTS[skill] : undefined
  return scopedPrompt ? `${basePrompt}\n\n${scopedPrompt}` : basePrompt
}


function safeLogValue(value: unknown, maxChars = 80): string {
  return String(value ?? '')
    .replace(/[^a-zA-Z0-9_.:/() -]/g, '')
    .slice(0, maxChars)
}

function classifyIntent(message: string): AssistantIntent {
  for (const [re, intent] of INTENT_RULES) {
    if (re.test(message)) return intent
  }
  return 'general'
}

@Injectable()
export class LlmChatService {
  private readonly logger = new Logger(LlmChatService.name)
  private readonly sessions = new Map<string, SessionEntry>()

  constructor(private readonly config: LlmConfigService) {}

  private pruneSessions(now: number): void {
    for (const [id, s] of this.sessions) {
      if (now - s.updatedAt > SESSION_TTL_MS) this.sessions.delete(id)
    }
  }

  async chat(input: ChatInput): Promise<ChatOutput> {
    const sessionId = input.sessionId ?? `session-${Date.now()}`
    const apiKey = this.config.getApiKey('assistant_chat')
    const cfg = this.config.getConfig('assistant_chat')

    if (!apiKey || !cfg.enabled) {
      throw new ServiceUnavailableException('AI 模型未配置或未启用')
    }

    const now = Date.now()
    this.pruneSessions(now)

    // 取/建会话历史
    const session = this.sessions.get(sessionId) ?? { messages: [], updatedAt: now }
    session.messages.push({ role: 'user', content: input.message })
    const skill = input.skill

    const payloadMessages: ChatMessage[] = [
      { role: 'system', content: buildSkillScopedSystemPrompt(buildGuardedSystemPrompt(cfg), skill) },
      ...session.messages.slice(-MAX_HISTORY),
    ]

    const rawReply = await this.callLlm('assistant_chat', cfg.vendor, cfg.baseURL, apiKey, cfg.model, cfg.temperature, payloadMessages)
    const reply = enforceForbiddenWords(rawReply, cfg.forbiddenWords)
    if (reply !== rawReply) {
      this.logger.warn('LLM 回复命中禁用词，已替换为范围内兜底回复')
    }

    session.messages.push({ role: 'assistant', content: reply })
    session.updatedAt = now
    // 截断历史
    if (session.messages.length > MAX_HISTORY) {
      session.messages = session.messages.slice(-MAX_HISTORY)
    }
    this.sessions.set(sessionId, session)

    const intent = classifyIntent(input.message)
    const actions = skill ? SKILL_ACTIONS[skill] : INTENT_ROUTES[intent]

    return {
      sessionId,
      reply,
      intent,
      actions: actions.length ? actions : undefined,
    }
  }

  // ── 调用 OpenAI 兼容 Chat Completions ─────────────────────
  private async callLlm(
    featureKey: AiModelFeatureKey,
    vendor: string,
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
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model, messages, temperature, stream: false, ...(model.startsWith('deepseek-v4') ? { thinking: { type: 'disabled' } } : {}) }),
      })
    } catch {
      this.logger.error(
        `LLM 请求失败: category=network_error feature=${featureKey} vendor=${safeLogValue(vendor)} model=${safeLogValue(model)}`,
      )
      throw new ServiceUnavailableException('AI 模型连接失败')
    }

    if (!res.ok) {
      this.logger.error(
        `LLM 上游错误: category=upstream_non_2xx status=${res.status} statusText=${safeLogValue(res.statusText)} feature=${featureKey} vendor=${safeLogValue(vendor)} model=${safeLogValue(model)}`,
      )
      throw new ServiceUnavailableException(`AI 模型返回错误 (${res.status})`)
    }

    const data = await res.json() as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const reply = data.choices?.[0]?.message?.content?.trim()
    if (!reply) {
      throw new ServiceUnavailableException('AI 模型未返回内容')
    }
    return reply
  }

  /** 连通性测试：发一条简短消息，返回成功与否 + 样例回复/错误 */
  async test(feature: AiModelFeatureKey = 'assistant_chat'): Promise<{ ok: boolean; reply?: string; error?: string }> {
    try {
      const apiKey = this.config.getApiKey(feature)
      const cfg = this.config.getConfig(feature)
      if (!apiKey || !cfg.enabled) {
        throw new ServiceUnavailableException('AI 模型未配置或未启用')
      }
      const messages: ChatMessage[] = [
        { role: 'system', content: buildGuardedSystemPrompt(cfg) },
        { role: 'user', content: '你好，请用一句话自我介绍。' },
      ]
      const rawReply = await this.callLlm(feature, cfg.vendor, cfg.baseURL, apiKey, cfg.model, cfg.temperature, messages)
      return { ok: true, reply: enforceForbiddenWords(rawReply, cfg.forbiddenWords) }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }
}
