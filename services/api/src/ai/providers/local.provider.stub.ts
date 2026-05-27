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
 * 本地模型 provider stub — Phase 7.6 占位实现
 *
 * 适用场景：Ollama / vLLM / llama.cpp 等本地部署模型
 *
 * 接入步骤：
 * 1. 在服务端 env 配置 LOCAL_MODEL_BASE_URL（如 http://localhost:11434）
 * 2. 配置 LOCAL_MODEL_NAME（如 qwen2:7b）
 * 3. 替换下方方法为 Ollama API 或 OpenAI 兼容接口调用
 * 4. 将 AI_PROVIDER=local 写入服务端 .env
 *
 * 安全：本地模型无需外部 API Key，但仍需注意输入过滤（防 prompt injection）
 */
@Injectable()
export class LocalAiProvider implements AiProvider {
  readonly name: AiProviderName = 'local'

  parseResume(_input: ParseResumeInput): Promise<ParseResumeOutput> {
    throw new NotImplementedException('Local model provider not yet configured — set AI_PROVIDER=mock or LOCAL_MODEL_BASE_URL')
  }

  optimizeResume(_taskId: string, _report: ResumeReport): Promise<OptimizeResumeOutput> {
    throw new NotImplementedException('Local model provider not yet configured')
  }

  chatAssistant(_input: ChatInput): Promise<ChatOutput> {
    throw new NotImplementedException('Local model provider not yet configured')
  }

  classifyIntent(_message: string): Promise<ClassifyIntentOutput> {
    throw new NotImplementedException('Local model provider not yet configured')
  }
}
