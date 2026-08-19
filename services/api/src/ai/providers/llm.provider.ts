import { Injectable, NotImplementedException } from '@nestjs/common'
import type {
  AiProvider,
  AiProviderName,
  GenerateResumeOutput,
  ParseResumeInput,
  ParseResumeOutput,
  ResumeGenerateInput,
  ResumeReport,
  ResumeTargetContext,
  OptimizeResumeOutput,
  ChatInput,
  ChatOutput,
  ClassifyIntentOutput,
} from '../interfaces/ai-provider.interface'
import { LlmResumeService } from '../resume/llm-resume.service'
import { computeMissingHints, LlmResumeGenerateService } from '../resume/llm-resume-generate.service'
import { LlmResumeOptimizeService } from '../resume/llm-resume-optimize.service'
import { AiUsageAccumulator } from '../ai-log.service'

let taskCounter = 0
const nextTaskId = (): string => `llm-ai-${Date.now()}-${++taskCounter}`

/**
 * AI-COST-TRUTH：把累计器打包成用量回报。
 *
 * fallback 标签用 'llm'（AiProviderName）——它只在 callCount === 0 时才会被用到，
 * 那种情况下成本按 0 记，不参与单价匹配，所以不含厂商名也无害。
 * 真正要计费的调用一定已经带回 `llm:<vendor>:<model>`。
 */
const usageOf = (acc: AiUsageAccumulator) => acc.toReport('llm')

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
    private readonly resumeOptimize: LlmResumeOptimizeService,
  ) {}

  async parseResume(input: ParseResumeInput): Promise<ParseResumeOutput> {
    const text = input.extractedText
    if (!text || !text.trim()) {
      // 正常情况下 AiService 已先提取并在失败时直接返回；此处仅防御性兜底。
      // 一次都没打到模型 → callCount 0 → 成本确定为 0（不是「未采集」）。
      return {
        taskId: nextTaskId(), status: 'failed', failReason: '未获取到简历文本，无法生成诊断报告',
        usage: usageOf(new AiUsageAccumulator()),
      }
    }
    // AI-COST-TRUTH：诊断可能重试两次，每次都真实花钱，必须累计而不是只记最后一次。
    const usage = new AiUsageAccumulator()
    try {
      const report: ResumeReport = await this.resumeLlm.diagnose(text, {
        selectedDimensions: input.selectedDimensions,
        targetContext: input.targetContext,
        onLlmCall: usage.add,
      })
      return { taskId: nextTaskId(), status: 'completed', report, usage: usageOf(usage) }
    } catch (err) {
      // 失败也要回报：重试期间的调用照样计费，丢账就等于少算成本。
      return { taskId: nextTaskId(), status: 'failed', failReason: this.failReasonOf(err), usage: usageOf(usage) }
    }
  }

  private failReasonOf(err: unknown): string {
    switch (errorCodeOf(err)) {
      case 'AI_PROVIDER_NOT_CONFIGURED':
        return 'AI 诊断模型尚未配置，请联系管理员后重试'
      case 'AI_RATE_LIMITED':
        // 限流不是「服务不可用」：说清是排队，用户才知道该等一下而不是放弃。
        return 'AI 诊断当前排队较多，请稍后重试'
      case 'AI_PROVIDER_UNREACHABLE':
        return 'AI 诊断服务连接失败，请稍后重试'
      case 'AI_EMPTY_RESPONSE':
        return 'AI 诊断这次没有返回内容，请稍后重试'
      case 'AI_DIAGNOSIS_INVALID_OUTPUT':
      default:
        return 'AI 诊断服务暂时不可用，请稍后重试'
    }
  }

  /**
   * 阶段2B 真实简历优化:基于简历原文 + 诊断报告输出结构化优化版简历与新旧对比。
   * 防编造契约在 LlmResumeOptimizeService 强制(事实串必须出现在原文)。
   * 任何失败都返回 status:'failed' + 明确 failReason,绝不 fallback mock。
   */
  async optimizeResume(
    taskId: string,
    report: ResumeReport,
    extractedText?: string,
    targetContext?: ResumeTargetContext,
  ): Promise<OptimizeResumeOutput> {
    if (!extractedText || !extractedText.trim()) {
      return {
        taskId,
        status: 'failed',
        failReason: '简历原文已按隐私策略自动清理，请重新上传简历后再生成优化版',
        usage: usageOf(new AiUsageAccumulator()),
      }
    }
    // AI-COST-TRUTH：优化可能重试两次，每次都真实花钱，必须累计。
    const usage = new AiUsageAccumulator()
    try {
      const { optimizedResume, modules } = await this.resumeOptimize.optimize(extractedText, report, targetContext, usage.add)
      return { taskId, status: 'completed', modules, optimizedResume, usage: usageOf(usage) }
    } catch (err) {
      const code = errorCodeOf(err)
      let failReason: string
      if (code === 'AI_PROVIDER_NOT_CONFIGURED') {
        failReason = 'AI 简历优化模型尚未配置，请联系管理员后重试'
      } else if (code === 'AI_OPTIMIZE_INVALID_OUTPUT') {
        // 防编造校验拦截:两次输出均含无法从原文确认的信息,绝不放行
        failReason = '优化结果包含无法从原文确认的信息，系统已拦截，请重新生成或检查原文'
      } else {
        failReason = 'AI 简历优化服务暂时不可用，请稍后重试'
      }
      // 失败也要回报：重试期间的调用照样计费，丢账就等于少算成本。
      return { taskId, status: 'failed', failReason, usage: usageOf(usage) }
    }
  }

  /**
   * 阶段2A 简历生成:只润色用户提供的信息(防编造契约在 LlmResumeGenerateService 强制)。
   * 任何失败都返回 status:'failed' + 明确 failReason,绝不 fallback mock。
   */
  async generateResume(input: ResumeGenerateInput): Promise<GenerateResumeOutput> {
    // AI-COST-TRUTH：生成可能重试两次，每次都真实花钱，必须累计。
    const usage = new AiUsageAccumulator()
    try {
      const resume = await this.resumeGenerate.generate(input, usage.add)
      return {
        taskId: nextTaskId(),
        status: 'completed',
        resume,
        missingHints: computeMissingHints(input),
        usage: usageOf(usage),
      }
    } catch (err) {
      const code = errorCodeOf(err)
      const failReason =
        code === 'AI_PROVIDER_NOT_CONFIGURED'
          ? 'AI 简历生成模型尚未配置，请联系管理员后重试'
          : 'AI 简历生成服务暂时不可用，请稍后重试'
      // 失败也要回报：重试期间的调用照样计费，丢账就等于少算成本。
      return { taskId: nextTaskId(), status: 'failed', failReason, usage: usageOf(usage) }
    }
  }

  chatAssistant(_input: ChatInput): Promise<ChatOutput> {
    throw new NotImplementedException('助手对话走 LlmChatService，不经 llm 简历诊断 provider')
  }

  classifyIntent(_message: string): Promise<ClassifyIntentOutput> {
    throw new NotImplementedException('not used by llm resume provider')
  }
}
