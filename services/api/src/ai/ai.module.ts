import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { FilesModule } from '../files/files.module'
import { AiController } from './ai.controller'
import { AiService } from './ai.service'
import { AiLogService } from './ai-log.service'
import { MockAiProvider } from './providers/mock.provider'
import { OpenAiProvider } from './providers/openai.provider.stub'
import { ClaudeProvider } from './providers/claude.provider.stub'
import { LocalAiProvider } from './providers/local.provider.stub'
import { QwenProvider } from './providers/qwen.provider.stub'
import { ZhipuProvider } from './providers/zhipu.provider.stub'
import { LlmConfigService } from './llm/llm-config.service'
import { LlmChatService } from './llm/llm-chat.service'
import { AiConfigController, AiConfigsController } from './llm/ai-config.controller'
import { AiResultCleanupTask } from './ai-result.cleanup.task'
import { ResumeExtractionService } from './resume/resume-extraction.service'
import { OcrService } from './resume/ocr/ocr.service'
import { DisabledOcrProvider } from './resume/ocr/disabled-ocr.provider'
import { TencentOcrProvider } from './resume/ocr/tencent-ocr.provider.stub'
import { LlmResumeService } from './resume/llm-resume.service'
import { LlmResumeGenerateService } from './resume/llm-resume-generate.service'
import { ResumePdfService } from './resume/resume-pdf.service'
import { LlmResumeProvider } from './providers/llm.provider'

@Module({
  // FilesModule：ResumeExtractionService 注入 FilesService.readContent 读简历 buffer（Phase 1A）。
  imports: [AuthModule, FilesModule],
  controllers: [AiController, AiConfigController, AiConfigsController],
  providers: [
    AiService,
    AiLogService,
    MockAiProvider,
    OpenAiProvider,
    ClaudeProvider,
    LocalAiProvider,
    QwenProvider,
    ZhipuProvider,
    LlmConfigService,
    LlmChatService,
    AiResultCleanupTask,
    // ── Phase 1A 简历文字提取 + OCR 底座 ──
    ResumeExtractionService,
    OcrService,
    DisabledOcrProvider,
    TencentOcrProvider,
    // ── Phase 1B 真实 LLM 简历诊断（AI_PROVIDER=llm）──
    LlmResumeService,
    LlmResumeProvider,
    // ── 阶段2A AI 简历生成(只润色不编造)+ PDF 导出 ──
    LlmResumeGenerateService,
    ResumePdfService,
  ],
  // 导出 ResumeExtractionService 供 Phase 1B 的 AiService / 诊断 provider 复用。
  exports: [AiService, AiLogService, ResumeExtractionService],
})
export class AiModule {}
