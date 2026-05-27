import { Injectable, NotImplementedException } from '@nestjs/common'
import type {
  AiProvider,
  AiProviderName,
  ParseResumeInput,
  ParseResumeOutput,
  ResumeReport,
  OptimizeResumeOutput,
  ChatInput,
  ChatOutput,
  ClassifyIntentOutput,
} from '../interfaces/ai-provider.interface'

/**
 * Claude (Anthropic) provider stub — Phase 7.6 占位实现
 *
 * 接入步骤（Phase 7.6+）：
 * 1. 在服务端 env 配置 ANTHROPIC_API_KEY（禁止传给前端）
 * 2. 安装 @anthropic-ai/sdk 包：pnpm add @anthropic-ai/sdk
 * 3. 替换下方每个方法为真实 Claude API 调用
 * 4. 将 AI_PROVIDER=claude 写入服务端 .env
 */
@Injectable()
export class ClaudeProvider implements AiProvider {
  readonly name: AiProviderName = 'claude'

  parseResume(_input: ParseResumeInput): Promise<ParseResumeOutput> {
    throw new NotImplementedException('Claude provider not yet configured — set AI_PROVIDER=mock or configure ANTHROPIC_API_KEY')
  }

  optimizeResume(_taskId: string, _report: ResumeReport): Promise<OptimizeResumeOutput> {
    throw new NotImplementedException('Claude provider not yet configured')
  }

  chatAssistant(_input: ChatInput): Promise<ChatOutput> {
    throw new NotImplementedException('Claude provider not yet configured')
  }

  classifyIntent(_message: string): Promise<ClassifyIntentOutput> {
    throw new NotImplementedException('Claude provider not yet configured')
  }
}
