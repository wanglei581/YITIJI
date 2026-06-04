import { Injectable, NotFoundException, InternalServerErrorException } from '@nestjs/common'
import type { AiProvider, AiProviderName, ParseResumeInput, ParseResumeOutput, OptimizeResumeOutput, ChatInput, ChatOutput } from './interfaces/ai-provider.interface'
import { MockAiProvider } from './providers/mock.provider'
import { OpenAiProvider } from './providers/openai.provider.stub'
import { ClaudeProvider } from './providers/claude.provider.stub'
import { LocalAiProvider } from './providers/local.provider.stub'
import { QwenProvider } from './providers/qwen.provider.stub'
import { ZhipuProvider } from './providers/zhipu.provider.stub'
import { AiLogService } from './ai-log.service'
import { LlmConfigService } from './llm/llm-config.service'
import { LlmChatService } from './llm/llm-chat.service'
import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'

// 简历派生结果留存窗口(CLAUDE.md §11「不长期保存简历」)。
// MockProvider 阶段 payload 仅诊断评分 / 通用建议文本;接真 provider 后
// before/after 可能含简历原文摘录,到期即清理,不让其长期留存。
// 可经 env AI_RESUME_RESULT_TTL_HOURS 覆盖,默认 24h(覆盖一次 kiosk 会话 + 当日返回)。
const AI_RESUME_RESULT_TTL_HOURS = ((): number => {
  const raw = Number(process.env['AI_RESUME_RESULT_TTL_HOURS'])
  return Number.isFinite(raw) && raw > 0 ? raw : 24
})()

// ============================================================
// AiService — 选择 provider 并统一处理日志
//
// 切换提供商：修改服务端 env AI_PROVIDER（默认 mock）
// - 未知值启动时立即抛出，不允许静默 fallback 到 mock
// - qwen/zhipu 未实现时走各自 stub（抛 NotImplementedException）
// - task 不存在时抛 NotFoundException(AI_TASK_NOT_FOUND)
//
// 结果持久化（HIGH-6）：
// - 解析 / 优化结果写入 AiResumeResult 表（taskId + kind 唯一），
//   替换原进程内 Map。API 重启 / 多实例后 GET /resume/records/:taskId 仍可读。
// - payloadJson 当前（MockAiProvider）只存诊断评分 / 通用优化建议文本，不含简历原文 / 候选人 PII。
//
// 留存治理（CLAUDE.md §11「不长期保存简历」，已落地）：
// - persistResult 写入 expiresAt = now + AI_RESUME_RESULT_TTL_HOURS（默认 24h）。
// - loadResult 把已过期行 + 无 expiresAt 的迁移前历史行都视为不存在（不返回简历派生内容，即便 cron 尚未清扫）。
// - cleanupExpiredResults + AiResultCleanupTask（每小时 cron）硬删过期行 + NULL 历史行并写 system 审计。
//   接入真实 AI provider（before/after 可能含简历摘录）后无需再改留存逻辑，仅按需调小 TTL。
// ============================================================

const KNOWN_PROVIDERS: readonly AiProviderName[] = [
  'mock', 'openai', 'claude', 'local', 'qwen', 'zhipu',
] as const

@Injectable()
export class AiService {
  private readonly provider: AiProvider

  constructor(
    private readonly mockProvider: MockAiProvider,
    private readonly openAiProvider: OpenAiProvider,
    private readonly claudeProvider: ClaudeProvider,
    private readonly localProvider: LocalAiProvider,
    private readonly qwenProvider: QwenProvider,
    private readonly zhipuProvider: ZhipuProvider,
    private readonly logService: AiLogService,
    private readonly llmConfig: LlmConfigService,
    private readonly llmChat: LlmChatService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {
    const rawName = process.env['AI_PROVIDER'] ?? 'mock'
    if (!(KNOWN_PROVIDERS as readonly string[]).includes(rawName)) {
      throw new InternalServerErrorException({
        error: {
          code: 'AI_PROVIDER_INVALID',
          message: `Unknown AI_PROVIDER "${rawName}". Must be one of: ${KNOWN_PROVIDERS.join(', ')}`,
        },
      })
    }
    const name = rawName as AiProviderName
    const providerMap: Record<AiProviderName, AiProvider> = {
      mock:   this.mockProvider,
      openai: this.openAiProvider,
      claude: this.claudeProvider,
      local:  this.localProvider,
      qwen:   this.qwenProvider,
      zhipu:  this.zhipuProvider,
    }
    this.provider = providerMap[name]
  }

  /** 持久化 AI 结果（parse / optimize）。taskId+kind upsert，失败只记日志不阻塞业务。 */
  private async persistResult(
    taskId: string,
    kind: 'parse' | 'optimize',
    status: string,
    payload: ParseResumeOutput | OptimizeResumeOutput,
  ): Promise<void> {
    const payloadJson = JSON.stringify(payload)
    const provider = this.provider.name
    // 每次写入(含 update)都刷新留存窗口,避免活跃任务被提前清理。
    const expiresAt = new Date(Date.now() + AI_RESUME_RESULT_TTL_HOURS * 60 * 60 * 1000)
    try {
      await this.prisma.aiResumeResult.upsert({
        where: { taskId_kind: { taskId, kind } },
        create: { taskId, kind, status, payloadJson, provider, expiresAt },
        update: { status, payloadJson, provider, expiresAt },
      })
    } catch {
      // 持久化失败不应让用户的解析/优化动作失败（结果仍在本次响应里返回）
    }
  }

  async submitResumeParse(input: ParseResumeInput): Promise<ParseResumeOutput> {
    const t0 = Date.now()
    try {
      const result = await this.provider.parseResume(input)
      await this.persistResult(result.taskId, 'parse', result.status, result)
      this.logService.record({
        taskId:    result.taskId,
        provider:  this.provider.name,
        operation: 'parseResume',
        latencyMs: Date.now() - t0,
        status:    result.status === 'failed' ? 'failed' : 'success',
      })
      return result
    } catch (err) {
      this.logService.record({
        taskId:    `err-${Date.now()}`,
        provider:  this.provider.name,
        operation: 'parseResume',
        latencyMs: Date.now() - t0,
        status:    'failed',
        errorCode: err instanceof Error ? err.constructor.name : 'UNKNOWN',
      })
      throw err
    }
  }

  /** 读取已落库的结果，按 kind 反序列化为对应的 Output 形状。 */
  private async loadResult<T>(taskId: string, kind: 'parse' | 'optimize'): Promise<T | null> {
    const row = await this.prisma.aiResumeResult.findUnique({
      where: { taskId_kind: { taskId, kind } },
    })
    if (!row) return null
    // 留存治理:已过期 或 无 expiresAt（迁移前写入的历史行）一律视为不存在。
    // 读取路径不得在到期后 / 对无留存窗口的历史行返回简历派生内容（cron 清扫前也不行）。
    if (!row.expiresAt || row.expiresAt.getTime() < Date.now()) return null
    try {
      return JSON.parse(row.payloadJson) as T
    } catch {
      return null
    }
  }

  async getResumeRecord(taskId: string): Promise<ParseResumeOutput> {
    const stored = await this.loadResult<ParseResumeOutput>(taskId, 'parse')
    if (stored) return stored
    throw new NotFoundException({
      error: { code: 'AI_TASK_NOT_FOUND', message: '任务不存在，请重新提交简历' },
    })
  }

  async getResumeOptimize(taskId: string): Promise<OptimizeResumeOutput> {
    const cached = await this.loadResult<OptimizeResumeOutput>(taskId, 'optimize')
    if (cached) return cached

    const parseResult = await this.loadResult<ParseResumeOutput>(taskId, 'parse')
    if (!parseResult) {
      throw new NotFoundException({
        error: { code: 'AI_TASK_NOT_FOUND', message: '任务不存在，请先提交简历解析' },
      })
    }
    if (!parseResult.report) {
      // Parse failed earlier — cannot optimize
      return { taskId, status: 'failed', failReason: '简历解析未成功，无法生成优化建议' }
    }

    const t0 = Date.now()
    try {
      const result = await this.provider.optimizeResume(taskId, parseResult.report)
      await this.persistResult(taskId, 'optimize', result.status, result)
      this.logService.record({
        taskId,
        provider:  this.provider.name,
        operation: 'optimizeResume',
        latencyMs: Date.now() - t0,
        status:    result.status === 'failed' ? 'failed' : 'success',
      })
      return result
    } catch (err) {
      this.logService.record({
        taskId,
        provider:  this.provider.name,
        operation: 'optimizeResume',
        latencyMs: Date.now() - t0,
        status:    'failed',
        errorCode: err instanceof Error ? err.constructor.name : 'UNKNOWN',
      })
      throw err
    }
  }

  getProviderName(): string {
    return this.provider.name
  }

  /**
   * 清理已过期的简历派生结果（CLAUDE.md §11）。
   * 硬删 expiresAt < now 或 expiresAt 为空(迁移前历史行)的行，并写 system 审计
   * （只放数量 / 按 kind 摘要，不含 taskId / payload）。
   * 由 AiResultCleanupTask 每小时触发；亦可手动调用。
   */
  async cleanupExpiredResults(triggeredBy: 'manual' | 'cron'): Promise<{ deletedCount: number }> {
    const now = new Date()
    // 清理对象:已过期行 + 无 expiresAt 的迁移前历史行（后者按过期处理，不长期留存简历派生数据）。
    // 统计与删除使用同一过期谓词:groupBy 取 byKind 快照在前,deleteMany 直接按谓词原子删除——
    // 避免"先 findMany 取 id、再 deleteMany(id in ...)"的 TOCTOU 窗口与 SQLite IN 列表上限。
    const expiredWhere = { OR: [{ expiresAt: null }, { expiresAt: { lt: now } }] }

    const grouped = await this.prisma.aiResumeResult.groupBy({
      by: ['kind'],
      where: expiredWhere,
      _count: { _all: true },
    })
    if (grouped.length === 0) return { deletedCount: 0 }

    const byKind: Record<string, number> = {}
    for (const g of grouped) byKind[g.kind] = g._count._all

    const { count: deletedCount } = await this.prisma.aiResumeResult.deleteMany({
      where: expiredWhere,
    })
    if (deletedCount === 0) return { deletedCount: 0 }

    await this.audit.write({
      actorId: null,
      actorRole: 'system',
      action: 'ai_resume_result.cleanup_expired',
      targetType: 'ai_resume_result',
      targetId: null,
      payload: { triggeredBy, deletedCount, byKind },
    })

    return { deletedCount }
  }

  async chatWithAssistant(input: ChatInput): Promise<ChatOutput> {
    const t0 = Date.now()
    const sessionId = input.sessionId ?? `session-${Date.now()}`
    // 配置就绪时走真实大模型（DeepSeek/通义/MiniMax），否则降级到默认 provider
    const useLlm = this.llmConfig.isReady()
    const providerLabel = useLlm ? `llm:${this.llmConfig.getConfig().vendor}` : this.provider.name
    try {
      const result = useLlm
        ? await this.llmChat.chat({ ...input, sessionId })
        : await this.provider.chatAssistant({ ...input, sessionId })
      this.logService.record({
        taskId:    sessionId,
        provider:  providerLabel,
        operation: 'chatAssistant',
        latencyMs: Date.now() - t0,
        status:    'success',
      })
      return result
    } catch (err) {
      this.logService.record({
        taskId:    sessionId,
        provider:  providerLabel,
        operation: 'chatAssistant',
        latencyMs: Date.now() - t0,
        status:    'failed',
        errorCode: err instanceof Error ? err.constructor.name : 'UNKNOWN',
      })
      throw err
    }
  }
}
