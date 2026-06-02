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

// ============================================================
// AiService — 选择 provider 并统一处理日志
//
// 切换提供商：修改服务端 env AI_PROVIDER（默认 mock）
// - 未知值启动时立即抛出，不允许静默 fallback 到 mock
// - qwen/zhipu 未实现时走各自 stub（抛 NotImplementedException）
// - task 不存在时抛 NotFoundException(AI_TASK_NOT_FOUND)
// ============================================================

const KNOWN_PROVIDERS: readonly AiProviderName[] = [
  'mock', 'openai', 'claude', 'local', 'qwen', 'zhipu',
] as const

// In-memory task store (Phase 7.6 — replace with DB in Phase 7.7+)
const parseStore = new Map<string, ParseResumeOutput>()
const optimizeStore = new Map<string, OptimizeResumeOutput>()

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

  async submitResumeParse(input: ParseResumeInput): Promise<ParseResumeOutput> {
    const t0 = Date.now()
    try {
      const result = await this.provider.parseResume(input)
      parseStore.set(result.taskId, result)
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

  async getResumeRecord(taskId: string): Promise<ParseResumeOutput> {
    const cached = parseStore.get(taskId)
    if (cached) return cached
    throw new NotFoundException({
      error: { code: 'AI_TASK_NOT_FOUND', message: '任务不存在，请重新提交简历' },
    })
  }

  async getResumeOptimize(taskId: string): Promise<OptimizeResumeOutput> {
    const cached = optimizeStore.get(taskId)
    if (cached) return cached

    const parseResult = parseStore.get(taskId)
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
      optimizeStore.set(taskId, result)
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
