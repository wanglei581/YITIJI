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
 * 阿里通义千问 provider stub — Phase 7.6 占位实现
 *
 * 接入步骤：
 * 1. 在服务端 env 配置 QWEN_API_KEY（禁止传给前端）
 * 2. 安装 openai 包（通义兼容 OpenAI 接口）：pnpm add openai
 * 3. baseURL 设为 https://dashscope.aliyuncs.com/compatible-mode/v1
 * 4. 将 AI_PROVIDER=qwen 写入服务端 .env
 */
@Injectable()
export class QwenProvider implements AiProvider {
  readonly name: AiProviderName = 'qwen'

  parseResume(_input: ParseResumeInput): Promise<ParseResumeOutput> {
    throw new NotImplementedException('Qwen provider not yet configured — set AI_PROVIDER=mock or configure QWEN_API_KEY')
  }

  optimizeResume(_taskId: string, _report: ResumeReport): Promise<OptimizeResumeOutput> {
    throw new NotImplementedException('Qwen provider not yet configured')
  }

  chatAssistant(_input: ChatInput): Promise<ChatOutput> {
    throw new NotImplementedException('Qwen provider not yet configured')
  }

  classifyIntent(_message: string): Promise<ClassifyIntentOutput> {
    throw new NotImplementedException('Qwen provider not yet configured')
  }
}
