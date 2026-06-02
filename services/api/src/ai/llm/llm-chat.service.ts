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
  ChatInput,
  ChatOutput,
} from '../interfaces/ai-provider.interface'
import { LlmConfigService } from './llm-config.service'

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

const INTENT_RULES: [RegExp, AssistantIntent][] = [
  [/简历|履历|resume|cv/i,            'resume'],
  [/打印|复印|扫描|print|scan/i,       'print'],
  [/岗位|工作|职位|招工|求职|job/i,    'job'],
  [/招聘会|双选会|人才市场|fair/i,     'fair'],
  [/政策|补贴|社保|落户|人社/i,        'policy'],
]

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
    const apiKey = this.config.getApiKey()
    const cfg = this.config.getConfig()

    if (!apiKey || !cfg.enabled) {
      throw new ServiceUnavailableException('AI 模型未配置或未启用')
    }

    const now = Date.now()
    this.pruneSessions(now)

    // 取/建会话历史
    const session = this.sessions.get(sessionId) ?? { messages: [], updatedAt: now }
    session.messages.push({ role: 'user', content: input.message })

    const payloadMessages: ChatMessage[] = [
      { role: 'system', content: cfg.systemPrompt },
      ...session.messages.slice(-MAX_HISTORY),
    ]

    const reply = await this.callLlm(cfg.baseURL, apiKey, cfg.model, cfg.temperature, payloadMessages)

    session.messages.push({ role: 'assistant', content: reply })
    session.updatedAt = now
    // 截断历史
    if (session.messages.length > MAX_HISTORY) {
      session.messages = session.messages.slice(-MAX_HISTORY)
    }
    this.sessions.set(sessionId, session)

    const intent = classifyIntent(input.message)
    const actions = INTENT_ROUTES[intent]

    return {
      sessionId,
      reply,
      intent,
      actions: actions.length ? actions : undefined,
    }
  }

  // ── 调用 OpenAI 兼容 Chat Completions ─────────────────────
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
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model, messages, temperature, stream: false }),
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.logger.error(`LLM 请求失败: ${msg}`)
      throw new ServiceUnavailableException('AI 模型连接失败')
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      this.logger.error(`LLM 返回 ${res.status}: ${body.slice(0, 300)}`)
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
  async test(): Promise<{ ok: boolean; reply?: string; error?: string }> {
    try {
      const out = await this.chat({ message: '你好，请用一句话自我介绍。', sessionId: `test-${Date.now()}` })
      return { ok: true, reply: out.reply }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }
}
