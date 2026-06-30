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
import { LlmJobFitService } from './resume/llm-job-fit.service'
import { JobFitService } from './resume/job-fit.service'
import { JobFitController } from './job-fit.controller'
import { LlmCareerPlanService } from './resume/llm-career-plan.service'
import { CareerPlanService } from './resume/career-plan.service'
import { CareerPlanPdfService } from './resume/career-plan-pdf.service'
import { CareerPlanController } from './career-plan.controller'
import { LlmFairVisitPlanService } from './resume/llm-fair-visit-plan.service'
import { FairVisitPlanService } from './resume/fair-visit-plan.service'
import { FairVisitPlanPdfService } from './resume/fair-visit-plan-pdf.service'
import { FairVisitPlanController } from './fair-visit-plan.controller'
import { LlmChatService } from './llm/llm-chat.service'
import { AiConfigController, AiConfigsController } from './llm/ai-config.controller'
import { AiResultCleanupTask } from './ai-result.cleanup.task'
import { ResumeExtractionService } from './resume/resume-extraction.service'
import { OcrService } from './resume/ocr/ocr.service'
import { DisabledOcrProvider } from './resume/ocr/disabled-ocr.provider'
import { TencentOcrProvider } from './resume/ocr/tencent-ocr.provider.stub'
import { BaiduOcrProvider } from './resume/ocr/baidu-ocr.provider'
import { LlmResumeService } from './resume/llm-resume.service'
import { LlmResumeGenerateService } from './resume/llm-resume-generate.service'
import { LlmResumeOptimizeService } from './resume/llm-resume-optimize.service'
import { ResumePdfService } from './resume/resume-pdf.service'
import { LlmResumeProvider } from './providers/llm.provider'

@Module({
  // FilesModule：ResumeExtractionService 注入 FilesService.readContent 读简历 buffer（Phase 1A）。
  imports: [AuthModule, FilesModule],
  controllers: [AiController, AiConfigController, AiConfigsController, JobFitController, CareerPlanController, FairVisitPlanController],
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
    LlmJobFitService,
    JobFitService,
    LlmCareerPlanService,
    CareerPlanService,
    CareerPlanPdfService,
    LlmFairVisitPlanService,
    FairVisitPlanService,
    FairVisitPlanPdfService,
    LlmChatService,
    AiResultCleanupTask,
    // ── Phase 1A 简历文字提取 + OCR 底座 ──
    ResumeExtractionService,
    OcrService,
    DisabledOcrProvider,
    TencentOcrProvider,
    BaiduOcrProvider,
    // ── Phase 1B 真实 LLM 简历诊断（AI_PROVIDER=llm）──
    LlmResumeService,
    LlmResumeProvider,
    // ── 阶段2A AI 简历生成(只润色不编造)+ PDF 导出 ──
    LlmResumeGenerateService,
    ResumePdfService,
    // ── 阶段2B AI 简历优化真实化(基于原文,防编造) ──
    LlmResumeOptimizeService,
  ],
  // 导出 ResumeExtractionService 供 Phase 1B 的 AiService / 诊断 provider 复用。
  exports: [AiService, AiLogService, ResumeExtractionService, LlmConfigService, JobFitService, LlmJobFitService],
})
export class AiModule {}
