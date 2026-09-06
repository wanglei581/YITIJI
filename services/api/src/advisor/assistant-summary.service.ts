import {
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import {
  AiLogService,
  AiUsageAccumulator,
  aiErrorCodeOf,
  normalizeLlmUsage,
  type AiLlmCallSink,
  type RawLlmUsage,
} from '../ai/ai-log.service'
import { LlmConfigService } from '../ai/llm/llm-config.service'
import {
  LLM_BUSY_MESSAGE,
  LLM_TIMEOUT_MS,
  LlmBusyError,
  LlmTimeoutError,
  llmFetchJson,
  llmTimeoutMessage,
} from '../ai/llm/llm-http'
import { LlmChatService, assistantOwnerKey } from '../ai/llm/llm-chat.service'
import { maskUserTextForLlmText } from '../common/pii/llm-input-mask'
import { AdvisorArtifactService } from './advisor-artifact.service'
import { ADVISOR_DISCLAIMER } from './advisor-skills'
import type { QaPinsPayload } from './advisor-artifact.types'

// ============================================================
// 小青助手「本次要点」：把内存中的 assistant 会话浓缩成可打印 qa_pins。
//
// 不改 Prisma 模型：AdvisorSession.slotsJson.source = 'assistant' 标记来源。
// 匿名一律 404，不泄露「需要登录」。产物走既有 AdvisorArtifact.print。
// 日志 / 审计只写元数据，不含对话正文或转写文本。
// ============================================================

const SESSION_TTL_HOURS = (() => {
  const raw = Number(process.env['ADVISOR_SESSION_TTL_HOURS'])
  return Number.isFinite(raw) && raw > 0 ? raw : 24
})()

const MAX_HIGHLIGHTS = 8
const MAX_TODOS = 5
const MAX_PIN_CHARS = 240
const BANNED = [
  '保过', '通过率', '录用概率', '录用率', 'Offer 概率', 'Offer概率', '保录用', '保面试',
  '一键投递', '立即投递', '平台投递', '推荐给企业', '帮你投递', '替你投递',
] as const

export interface AssistantSessionSummaryView {
  advisorSessionId: string
  artifactId: string
  highlights: string[]
  todos: string[]
  disclaimer: string
  savedToDocuments: boolean
  document: {
    fileId: string
    filename: string
    mimeType: 'application/pdf'
    sizeBytes: number
    pageCount: number
    signedUrl: string
    expiresAt: string
    printFileUrl: string
  } | null
  printUnavailableReason?: string
}

@Injectable()
export class AssistantSummaryService {
  private readonly logger = new Logger(AssistantSummaryService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly llmChat: LlmChatService,
    private readonly llmConfig: LlmConfigService,
    private readonly artifacts: AdvisorArtifactService,
    private readonly audit: AuditService,
    private readonly aiLog: AiLogService,
  ) {}

  async summarize(
    assistantSessionId: string,
    endUserId: string,
    ip: string | null,
  ): Promise<AssistantSessionSummaryView> {
    const sessionId = assistantSessionId.trim()
    if (!sessionId) {
      throw new NotFoundException({
        error: { code: 'ASSISTANT_SESSION_NOT_FOUND', message: '会话不存在或已过期' },
      })
    }

    const ownerKey = assistantOwnerKey(endUserId, ip)
    const turns = this.llmChat.getOwnedTranscript(sessionId, ownerKey)
    if (!turns || turns.length === 0) {
      throw new NotFoundException({
        error: { code: 'ASSISTANT_SESSION_NOT_FOUND', message: '会话不存在或已过期' },
      })
    }
    const userTurns = turns.filter((turn) => turn.role === 'user' && turn.content.trim())
    if (userTurns.length === 0) {
      throw new NotFoundException({
        error: { code: 'ASSISTANT_SESSION_NOT_FOUND', message: '会话不存在或已过期' },
      })
    }

    const usage = new AiUsageAccumulator()
    const startedAt = Date.now()
    let parsed: { highlights: string[]; todos: string[] }
    try {
      parsed = await this.condense(turns, usage.add)
      this.recordLog(usage, startedAt, 'success', endUserId)
    } catch (error) {
      this.recordLog(usage, startedAt, 'failed', endUserId, aiErrorCodeOf(error))
      throw error
    }

    const firstUser = userTurns[0]!.content.trim().slice(0, 600)
    const nowIso = new Date().toISOString()
    const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000)
    const row = await this.prisma.advisorSession.create({
      data: {
        endUserId,
        accessTokenHash: null,
        skill: 'qa',
        status: 'completed',
        topic: firstUser || '小青对话要点',
        skillReason: '由小青助手本次对话浓缩',
        skillSource: 'llm',
        slotsJson: JSON.stringify({
          source: { value: 'assistant', filledAt: nowIso },
          question: { value: firstUser, filledAt: nowIso },
        }),
        expiresAt,
      },
    })

    const payload: QaPinsPayload = {
      kind: 'qa_pins',
      title: '小青本次要点',
      pins: [
        ...parsed.highlights.map((content) => ({
          content,
          evidenceLevel: 'E3' as const,
          sourceNote: '由本次对话浓缩，仅供参考',
        })),
        ...parsed.todos.map((content) => ({
          content: `待办：${content}`,
          evidenceLevel: 'E3' as const,
          sourceNote: '待办（请自行核对后执行）',
        })),
      ],
    }
    const providerLabel = this.llmConfig.isReady('assistant_chat')
      ? `llm:${this.llmConfig.getConfig('assistant_chat').vendor}`
      : 'llm'
    const saved = await this.artifacts.save(row.id, payload, providerLabel)

    await this.audit.write({
      actorId: null,
      actorRole: 'enduser',
      action: 'assistant.session_summary',
      targetType: 'advisor_session',
      targetId: row.id,
      payload: {
        artifactId: saved.artifactId,
        highlightCount: parsed.highlights.length,
        todoCount: parsed.todos.length,
        assistantSessionPresent: true,
      },
      ipAddress: null,
      userAgent: null,
      requestId: null,
    })

    let document: AssistantSessionSummaryView['document'] = null
    let printUnavailableReason: string | undefined
    try {
      const printed = await this.artifacts.print(saved.artifactId, row.id, { endUserId })
      document = {
        fileId: printed.fileId,
        filename: printed.filename,
        mimeType: 'application/pdf',
        sizeBytes: printed.sizeBytes,
        pageCount: printed.pageCount,
        signedUrl: printed.signedUrl,
        expiresAt: printed.expiresAt,
        printFileUrl: printed.printFileUrl,
      }
    } catch (error) {
      const code = (error as { getResponse?: () => { error?: { code?: string; message?: string } } })
        .getResponse?.()?.error?.code
      printUnavailableReason = code === 'ADVISOR_PDF_FONT_NOT_FOUND'
        ? '服务器缺少中文字体，要点已保存但暂时无法生成打印稿'
        : '打印稿暂时无法生成，要点已保存，请稍后再试'
      this.logger.warn(`assistant.summary_print_failed code=${code ?? 'unknown'}`)
    }

    return {
      advisorSessionId: row.id,
      artifactId: saved.artifactId,
      highlights: parsed.highlights,
      todos: parsed.todos,
      disclaimer: ADVISOR_DISCLAIMER,
      savedToDocuments: true,
      document,
      printUnavailableReason,
    }
  }

  private async condense(
    turns: Array<{ role: 'user' | 'assistant'; content: string }>,
    onLlmCall?: AiLlmCallSink,
  ): Promise<{ highlights: string[]; todos: string[] }> {
    const apiKey = this.llmConfig.getApiKey('assistant_chat')
    const cfg = this.llmConfig.getConfig('assistant_chat')
    if (!apiKey || !cfg.enabled) {
      throw new ServiceUnavailableException({
        error: { code: 'AI_NOT_CONFIGURED', message: 'AI 顾问暂未启用，无法生成本次要点' },
      })
    }

    const transcript = turns
      .slice(-16)
      .map((turn) => {
        const masked = turn.role === 'user'
          ? maskUserTextForLlmText(turn.content.slice(0, 800), 'assistant_summary')
          : turn.content.slice(0, 800)
        return `${turn.role === 'user' ? '用户' : '小青'}：${masked}`
      })
      .join('\n')
      .slice(0, 6000)

    const system = [
      '你把求职者与小青的本次对话浓缩成要点和待办。',
      '硬性要求：',
      '1. 只依据对话里已经出现的信息，不得编造学校、公司、时间、证书、薪资数字。',
      '2. 不承诺录用、Offer、通过率；不输出任何百分比或录用概率。',
      '3. 不出现一键投递 / 立即投递 / 平台投递；岗位申请只能提醒用户去来源平台。',
      '4. 要点 ≤8 条，待办 ≤5 条；每条不超过 80 字，口语、可执行。',
      '5. 没有待办就返回空数组，不要编「下一步」。',
      '只输出 JSON（不要 markdown 代码块）：{"highlights":["要点"],"todos":["待办"]}',
    ].join('\n')

    const url = `${cfg.baseURL.replace(/\/$/, '')}/chat/completions`
    let res: Awaited<ReturnType<typeof llmFetchJson>>
    try {
      res = await llmFetchJson(
        url,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model: cfg.model,
            temperature: Math.min(cfg.temperature, 0.4),
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: `【本次对话】\n${transcript}` },
            ],
            stream: false,
          }),
        },
        { timeoutMs: LLM_TIMEOUT_MS },
      )
    } catch (error) {
      if (error instanceof LlmBusyError) {
        throw new ServiceUnavailableException({ error: { code: 'AI_BUSY', message: LLM_BUSY_MESSAGE } })
      }
      if (error instanceof LlmTimeoutError) {
        throw new ServiceUnavailableException({
          error: { code: 'AI_CHAT_TIMEOUT', message: llmTimeoutMessage('本次要点', error.timeoutMs) },
        })
      }
      throw new ServiceUnavailableException({
        error: { code: 'AI_PROVIDER_UNREACHABLE', message: 'AI 服务暂时连不上，请稍后重试' },
      })
    }

    const data = res.data as {
      choices?: Array<{ message?: { content?: string } }>
      usage?: RawLlmUsage
    } | null
    onLlmCall?.({
      provider: `llm:${cfg.vendor}:${cfg.model}`,
      tokenUsage: normalizeLlmUsage(data?.usage),
    })
    if (!res.ok) {
      throw new ServiceUnavailableException({
        error: { code: 'AI_PROVIDER_ERROR', message: '生成本次要点失败，请稍后重试' },
      })
    }
    const raw = data?.choices?.[0]?.message?.content?.trim()
    if (!raw) {
      throw new ServiceUnavailableException({
        error: { code: 'AI_EMPTY_RESPONSE', message: '生成本次要点失败，请稍后重试' },
      })
    }

    const parsed = parseSummaryJson(raw)
    const highlights = sanitizeLines(parsed?.highlights, MAX_HIGHLIGHTS)
    const todos = sanitizeLines(parsed?.todos, MAX_TODOS)
    if (highlights.length === 0) {
      throw new ServiceUnavailableException({
        error: { code: 'ASSISTANT_SUMMARY_FAILED', message: '这一轮对话暂时总结不了，请再问几句后再试' },
      })
    }
    const joined = [...highlights, ...todos].join('\n')
    for (const term of BANNED) {
      if (joined.includes(term)) {
        throw new ServiceUnavailableException({
          error: { code: 'ASSISTANT_SUMMARY_FAILED', message: '这一轮对话暂时总结不了，请再问几句后再试' },
        })
      }
    }
    return { highlights, todos }
  }

  private recordLog(
    usage: AiUsageAccumulator,
    startedAt: number,
    status: 'success' | 'failed',
    endUserId: string,
    errorCode?: string,
  ): void {
    if (usage.callCount === 0 && status === 'failed') {
      this.aiLog.record({
        taskId: null,
        operation: 'chatAssistant',
        provider: 'llm',
        status,
        latencyMs: Math.max(0, Date.now() - startedAt),
        errorCode,
        endUserId,
        terminalId: null,
      })
      return
    }
    if (usage.callCount === 0) return
    this.aiLog.record({
      taskId: null,
      operation: 'chatAssistant',
      provider: usage.provider ?? 'llm',
      status,
      latencyMs: Math.max(0, Date.now() - startedAt),
      tokenUsage: usage.tokenUsage,
      errorCode,
      endUserId,
      terminalId: null,
    })
  }
}

function parseSummaryJson(raw: string): { highlights?: unknown; todos?: unknown } | null {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  try {
    return JSON.parse(cleaned) as { highlights?: unknown; todos?: unknown }
  } catch {
    const start = cleaned.indexOf('{')
    const end = cleaned.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1)) as { highlights?: unknown; todos?: unknown }
      } catch {
        return null
      }
    }
    return null
  }
}

function sanitizeLines(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const text = item.replace(/\s+/g, ' ').trim().slice(0, MAX_PIN_CHARS)
    if (!text) continue
    out.push(text)
    if (out.length >= limit) break
  }
  return out
}
