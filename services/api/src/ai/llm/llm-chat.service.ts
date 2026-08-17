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
import {
  LLM_BUSY_MESSAGE,
  LLM_TIMEOUT_MS,
  LlmBusyError,
  LlmTimeoutError,
  llmFetchJson,
  llmTimeoutMessage,
} from './llm-http'
import { normalizeLlmUsage, type AiLlmCallSink, type RawLlmUsage } from '../ai-log.service'
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
    '当前处于百宝箱「AI 自我介绍生成」技能场景。',
    '请基于用户明确提供的目标岗位、学习、实习、项目经历和优势，分别整理约 1 分钟和 3 分钟的口语化文稿。',
    '不得编造用户未提供的学历、经历、成果、数据、证书或技能；信息不足时先提问确认。',
    '内容必须提示用户根据实际情况核对和修改，仅供求职准备参考，不构成录用承诺。',
  ].join('\n'),
  material_checklist: [
    '当前处于百宝箱「AI 材料准备清单」技能场景。',
    '请根据面试、招聘会或入职场景，以及岗位和单位类型，输出分组明确、可勾选的材料清单。',
    '不得把推测写成用人单位的确定要求；不确定的材料应标注“请向用人单位确认”。',
    '清单仅供准备参考，具体要求以用人单位或活动官方通知为准。',
  ].join('\n'),
  jd_analysis: [
    '当前处于百宝箱「AI 岗位 JD 解读」技能场景。',
    '请逐条解释用户提供的招聘要求，区分明确门槛、职责要求、加分项和需要进一步确认的信息。',
    '不得虚构招聘方未公开的筛选规则、面试题或录用标准，不得承诺求职结果。',
    '解读仅供个人准备参考，不代表招聘方评价标准；岗位申请只能引导用户前往信息来源平台。',
  ].join('\n'),
  interview_questions: [
    '当前处于百宝箱「AI 面试题预测」技能场景。',
    '请根据目标岗位、单位类型和用户真实背景，整理 8-10 道练习题，并给出回答结构或思路。',
    '不得声称掌握招聘方内部题库，不得编造用户经历，不得承诺命中真实题目或录用结果。',
    '题目仅供练习参考，实际面试问题和评价以招聘方为准。',
  ].join('\n'),
  career_explore: [
    '当前处于百宝箱「AI 求职方向探索」技能场景。',
    '请根据用户提供的专业、经历、兴趣、能力和现实约束，给出 2-4 个可探索方向及下一步验证行动。',
    '不得把兴趣测评或有限对话包装成心理诊断、人格定论或适岗保证，不得承诺就业结果。',
    '结果仅供个人探索参考，不构成职业、心理或医疗建议。',
  ].join('\n'),
  cover_letter_gen: [
    '当前处于百宝箱「AI 求职信生成」技能场景。',
    '请基于用户明确提供的目标单位、岗位、真实经历和优势，生成 300-500 字、语气专业克制的求职信。',
    '不得编造经历、成果、数据、荣誉或对目标单位的了解；信息不足时先提问确认。',
    '内容仅供参考，用户需按事实核对修改，不保证录用结果。',
  ].join('\n'),
  resume_jd_match: [
    '当前处于百宝箱「AI 简历 JD 匹配」技能场景。',
    '请只根据用户提供的 JD 与真实简历信息，列出有证据的匹配项、缺口项和可执行的准备建议。',
    '不得生成虚假经历补齐缺口，不得输出确定的录用概率、适配结论或招聘方内部评分。',
    '分析仅供个人求职准备参考，不代表招聘方实际评分标准或录用决定。',
  ].join('\n'),
  company_research: [
    '当前处于百宝箱「AI 企业面试速查」技能场景。',
    '请基于可确认的公开信息和行业常识，整理企业或行业概况、可能的考察方向和建议用户核实的问题。',
    '无法确认时必须明确说明，不得虚构企业内部流程、面试风格、薪酬、题库或招聘结论。',
    '速查仅供面试准备参考，不构成企业官方说明；岗位申请只能引导用户前往信息来源平台。',
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

  async chat(
    input: ChatInput,
    /**
     * AI-COST-TRUTH：每次真实 LLM 调用回调一次元数据，由调用方累计后落 AiServiceLog。
     * 只传 provider/token 元数据，不含任何对话正文。
     */
    onLlmCall?: AiLlmCallSink,
  ): Promise<ChatOutput> {
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

    const rawReply = await this.callLlm('assistant_chat', cfg.vendor, cfg.baseURL, apiKey, cfg.model, cfg.temperature, payloadMessages, onLlmCall)
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
    onLlmCall?: AiLlmCallSink,
  ): Promise<string> {
    // AI-COST-TRUTH：落账标签必须含厂商名，否则定价表匹配不到 → 永远算不出成本。
    // 只放 vendor/model，**不含** apiKey / baseURL。
    const providerLabel = `llm:${vendor}:${model}`
    const url = `${baseURL.replace(/\/$/, '')}/chat/completions`
    let res: Awaited<ReturnType<typeof llmFetchJson>>
    try {
      res = await llmFetchJson(
        url,
        {
          method: 'POST',
          headers: {
            'Content-Type':  'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify({ model, messages, temperature, stream: false, ...(model.startsWith('deepseek-v4') ? { thinking: { type: 'disabled' } } : {}) }),
        },
        { timeoutMs: LLM_TIMEOUT_MS },
      )
    } catch (error) {
      // 「AI 正忙」和「超时」都必须能和下面的 network_error 分开报：三者的处置完全不同
      // （加容量 / 查模型端 / 查网络）。糊成一个码就等于把根因抹掉。
      if (error instanceof LlmBusyError) {
        this.logger.warn(`LLM 请求被并发闸门拒绝: feature=${featureKey} limit=${error.limit}`)
        throw new ServiceUnavailableException({ error: { code: 'AI_BUSY', message: LLM_BUSY_MESSAGE } })
      }
      if (error instanceof LlmTimeoutError) {
        this.logger.warn(
          `LLM 请求超时: category=timeout feature=${featureKey} vendor=${safeLogValue(vendor)} model=${safeLogValue(model)} ms=${error.timeoutMs}`,
        )
        throw new ServiceUnavailableException({
          error: { code: 'AI_CHAT_TIMEOUT', message: llmTimeoutMessage('AI 助手', error.timeoutMs) },
        })
      }
      this.logger.error(
        `LLM 请求失败: category=network_error feature=${featureKey} vendor=${safeLogValue(vendor)} model=${safeLogValue(model)}`,
      )
      throw new ServiceUnavailableException('AI 模型连接失败')
    }

    if (!res.ok) {
      // 打到模型了但没拿到 usage：如实回报「调用发生过、token 未知」，不塞 tokenUsage。
      onLlmCall?.({ provider: providerLabel })
      this.logger.error(
        `LLM 上游错误: category=upstream_non_2xx status=${res.status} statusText=${safeLogValue(res.statusText)} feature=${featureKey} vendor=${safeLogValue(vendor)} model=${safeLogValue(model)}`,
      )
      throw new ServiceUnavailableException(`AI 模型返回错误 (${res.status})`)
    }

    const data = res.data as {
      choices?: Array<{ message?: { content?: string } }>
      usage?: RawLlmUsage
    } | null
    // 在「内容为空」判断之前回报：内容为空这次调用照样花钱，不能因为解析失败就丢账。
    onLlmCall?.({ provider: providerLabel, tokenUsage: normalizeLlmUsage(data?.usage) })
    const reply = data?.choices?.[0]?.message?.content?.trim()
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
