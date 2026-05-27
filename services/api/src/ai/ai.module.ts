import { Module } from '@nestjs/common'
import { AiController } from './ai.controller'
import { AiService } from './ai.service'
import { AiLogService } from './ai-log.service'
import { MockAiProvider } from './providers/mock.provider'
import { OpenAiProvider } from './providers/openai.provider.stub'
import { ClaudeProvider } from './providers/claude.provider.stub'
import { LocalAiProvider } from './providers/local.provider.stub'
import { QwenProvider } from './providers/qwen.provider.stub'
import { ZhipuProvider } from './providers/zhipu.provider.stub'

@Module({
  controllers: [AiController],
  providers: [
    AiService,
    AiLogService,
    MockAiProvider,
    OpenAiProvider,
    ClaudeProvider,
    LocalAiProvider,
    QwenProvider,
    ZhipuProvider,
  ],
  exports: [AiService, AiLogService],
})
export class AiModule {}
