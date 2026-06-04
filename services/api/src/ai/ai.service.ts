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
//   ⚠️ 合规待办：接入真实 AI provider 后，优化模块的 before/after 可能携带简历原文摘录，
//   届时必须给本表加 expiresAt + 纳入定期清理（CLAUDE.md §11「不长期保存简历」），
//   不可让简历派生文本长期留存。详见 docs/progress/next-tasks.md。
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
    try {
      await this.prisma.aiResumeResult.upsert({
        where: { taskId_kind: { taskId, kind } },
        create: { taskId, kind, status, payloadJson, provider },
        update: { status, payloadJson, provider },
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
