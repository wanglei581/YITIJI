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
 * OpenAI provider stub — Phase 7.6 占位实现
 *
 * 接入步骤（Phase 7.6+）：
 * 1. 在服务端 env 配置 OPENAI_API_KEY（禁止传给前端）
 * 2. 安装 openai 包：pnpm add openai
 * 3. 替换下方每个方法为真实 OpenAI API 调用
 * 4. 将 AI_PROVIDER=openai 写入服务端 .env
 *
 * 合规：不允许在响应中返回企业侧筛选或决策结果
 */
@Injectable()
export class OpenAiProvider implements AiProvider {
  readonly name: AiProviderName = 'openai'

  parseResume(_input: ParseResumeInput): Promise<ParseResumeOutput> {
    throw new NotImplementedException('OpenAI provider not yet configured — set AI_PROVIDER=mock or configure OPENAI_API_KEY')
  }

  optimizeResume(_taskId: string, _report: ResumeReport): Promise<OptimizeResumeOutput> {
    throw new NotImplementedException('OpenAI provider not yet configured')
  }

  chatAssistant(_input: ChatInput): Promise<ChatOutput> {
    throw new NotImplementedException('OpenAI provider not yet configured')
  }

  classifyIntent(_message: string): Promise<ClassifyIntentOutput> {
    throw new NotImplementedException('OpenAI provider not yet configured')
  }
}
