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
 * 智谱 GLM provider stub — Phase 7.6 占位实现
 *
 * 接入步骤：
 * 1. 在服务端 env 配置 ZHIPU_API_KEY（禁止传给前端）
 * 2. 安装 zhipuai 包：pnpm add zhipuai
 * 3. 将 AI_PROVIDER=zhipu 写入服务端 .env
 */
@Injectable()
export class ZhipuProvider implements AiProvider {
  readonly name: AiProviderName = 'zhipu'

  parseResume(_input: ParseResumeInput): Promise<ParseResumeOutput> {
    throw new NotImplementedException('Zhipu provider not yet configured — set AI_PROVIDER=mock or configure ZHIPU_API_KEY')
  }

  optimizeResume(_taskId: string, _report: ResumeReport): Promise<OptimizeResumeOutput> {
    throw new NotImplementedException('Zhipu provider not yet configured')
  }

  chatAssistant(_input: ChatInput): Promise<ChatOutput> {
    throw new NotImplementedException('Zhipu provider not yet configured')
  }

  classifyIntent(_message: string): Promise<ClassifyIntentOutput> {
    throw new NotImplementedException('Zhipu provider not yet configured')
  }
}
