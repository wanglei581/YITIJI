import { Injectable, NotImplementedException } from '@nestjs/common'
import type {
  AiProvider,
  AiProviderName,
  GenerateResumeOutput,
  ParseResumeInput,
  ParseResumeOutput,
  ResumeGenerateInput,
  ResumeReport,
  OptimizeResumeOutput,
  ChatInput,
  ChatOutput,
  ClassifyIntentOutput,
} from '../interfaces/ai-provider.interface'
import { LlmResumeService } from '../resume/llm-resume.service'
import { computeMissingHints, LlmResumeGenerateService } from '../resume/llm-resume-generate.service'

let taskCounter = 0
const nextTaskId = (): string => `llm-ai-${Date.now()}-${++taskCounter}`

/** 从 Nest 异常体里取 { error: { code } }，用于把诊断失败映射成诚实 failReason。 */
function errorCodeOf(err: unknown): string | undefined {
  const ex = err as { getResponse?: () => unknown; response?: unknown }
  const resp = (typeof ex.getResponse === 'function' ? ex.getResponse() : ex.response) as
    | { error?: { code?: string } }
    | undefined
  return resp?.error?.code
}

/**
 * 真实简历诊断 provider（AI_PROVIDER=llm）。
 *
 * parseResume：使用 AiService 注入的 extractedText 调 LlmResumeService 生成结构化报告；
 * 任何失败都返回 status:'failed' + 明确 failReason（**绝不伪造报告、绝不 fallback mock**）。
 * optimizeResume：真实优化留 Phase 1E，当前诚实返回 failed。
 * chatAssistant / classifyIntent：助手对话走 LlmChatService，不经本 provider。
 */
@Injectable()
export class LlmResumeProvider implements AiProvider {
  readonly name: AiProviderName = 'llm'

  constructor(
    private readonly resumeLlm: LlmResumeService,
    private readonly resumeGenerate: LlmResumeGenerateService,
  ) {}

  async parseResume(input: ParseResumeInput): Promise<ParseResumeOutput> {
    const text = input.extractedText
    if (!text || !text.trim()) {
      // 正常情况下 AiService 已先提取并在失败时直接返回；此处仅防御性兜底。
      return { taskId: nextTaskId(), status: 'failed', failReason: '未获取到简历文本，无法生成诊断报告' }
    }
    try {
      const report: ResumeReport = await this.resumeLlm.diagnose(text)
      return { taskId: nextTaskId(), status: 'completed', report }
    } catch (err) {
      return { taskId: nextTaskId(), status: 'failed', failReason: this.failReasonOf(err) }
    }
  }

  private failReasonOf(err: unknown): string {
    switch (errorCodeOf(err)) {
      case 'AI_PROVIDER_NOT_CONFIGURED':
        return 'AI 诊断模型尚未配置，请联系管理员后重试'
      case 'AI_DIAGNOSIS_INVALID_OUTPUT':
      case 'AI_DIAGNOSIS_UNAVAILABLE':
      default:
        return 'AI 诊断服务暂时不可用，请稍后重试'
    }
  }

  optimizeResume(taskId: string, _report: ResumeReport): Promise<OptimizeResumeOutput> {
    return Promise.resolve({
      taskId,
      status: 'failed',
      failReason: 'AI 简历优化的真实化将在后续阶段开放，当前可参考诊断报告中的改进建议',
    })
  }

  /**
   * 阶段2A 简历生成:只润色用户提供的信息(防编造契约在 LlmResumeGenerateService 强制)。
   * 任何失败都返回 status:'failed' + 明确 failReason,绝不 fallback mock。
   */
  async generateResume(input: ResumeGenerateInput): Promise<GenerateResumeOutput> {
    try {
      const resume = await this.resumeGenerate.generate(input)
      return {
        taskId: nextTaskId(),
        status: 'completed',
        resume,
        missingHints: computeMissingHints(input),
      }
    } catch (err) {
      const code = errorCodeOf(err)
      const failReason =
        code === 'AI_PROVIDER_NOT_CONFIGURED'
          ? 'AI 简历生成模型尚未配置，请联系管理员后重试'
          : 'AI 简历生成服务暂时不可用，请稍后重试'
      return { taskId: nextTaskId(), status: 'failed', failReason }
    }
  }

  chatAssistant(_input: ChatInput): Promise<ChatOutput> {
    throw new NotImplementedException('助手对话走 LlmChatService，不经 llm 简历诊断 provider')
  }

  classifyIntent(_message: string): Promise<ClassifyIntentOutput> {
    throw new NotImplementedException('not used by llm resume provider')
  }
}
