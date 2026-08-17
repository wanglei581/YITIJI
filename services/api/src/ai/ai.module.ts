import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { FilesModule } from '../files/files.module'
import { AsrModule } from '../asr/asr.module'
import { AiController } from './ai.controller'
import { AiService } from './ai.service'
import { AiLogService } from './ai-log.service'
import { AiPublicQuotaService } from './ai-public-quota.service'
import { MockAiProvider } from './providers/mock.provider'
import { OpenAiProvider } from './providers/openai.provider.stub'
import { ClaudeProvider } from './providers/claude.provider.stub'
import { LocalAiProvider } from './providers/local.provider.stub'
import { QwenProvider } from './providers/qwen.provider.stub'
import { ZhipuProvider } from './providers/zhipu.provider.stub'
import { LlmConfigService } from './llm/llm-config.service'
import { LlmJobFitService } from './resume/llm-job-fit.service'
import { JobFitService } from './resume/job-fit.service'
import { JobFitPdfService } from './resume/job-fit-pdf.service'
import { LlmCareerPlanService } from './resume/llm-career-plan.service'
import { CareerPlanService } from './resume/career-plan.service'
import { CareerPlanPdfService } from './resume/career-plan-pdf.service'
import { CareerPlanDegradedPdfService } from './resume/career-plan-degraded-pdf.service'
import { CareerPlanController } from './career-plan.controller'
import { LlmSelfAssessmentService } from './resume/llm-self-assessment.service'
import { SelfAssessmentService } from './resume/self-assessment.service'
import { SelfAssessmentPdfService } from './resume/self-assessment-pdf.service'
import { AppendedSelfAssessmentService } from './resume/appended-self-assessment.service'
import { SelfAssessmentController } from './self-assessment.controller'
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
import { ResumeDocxService } from './resume/resume-docx.service'
import { ResumeTextService } from './resume/resume-text.service'
import { LlmResumeProvider } from './providers/llm.provider'
import { BenefitRedemptionModule } from '../benefit-redemption/benefit-redemption.module'

@Module({
  // FilesModule：ResumeExtractionService 注入 FilesService.readContent 读简历 buffer（Phase 1A）。
  // BenefitRedemptionModule：AI 简历优化端点可选核销会员权益（P1 权益核销 SSOT）。
  imports: [AuthModule, FilesModule, AsrModule, BenefitRedemptionModule],
  controllers: [AiController, AiConfigController, AiConfigsController, CareerPlanController, FairVisitPlanController, SelfAssessmentController],
  providers: [
    AiService,
    AiLogService,
    // 匿名公网 AI 端点（/assistant/chat、/resume/parse）的日配额闸门。
    AiPublicQuotaService,
    MockAiProvider,
    OpenAiProvider,
    ClaudeProvider,
    LocalAiProvider,
    QwenProvider,
    ZhipuProvider,
    LlmConfigService,
    LlmJobFitService,
    JobFitService,
    JobFitPdfService,
    LlmCareerPlanService,
    CareerPlanService,
    CareerPlanPdfService,
    // 降级版式（AI 不可用时仍然出得了纸）。
    // ⚠️ 岗位要求计数端口 CAREER_PLAN_JOB_REQUIREMENT_STATS 在 PR #636 合入前**故意不注册**：
    //    CareerPlanService 用 @Optional() 注入，拿不到就在纸上如实印「本次未取到岗位要求计数」。
    //    #636 合入后接线就是下面一行，不需要适配层：
    //      { provide: CAREER_PLAN_JOB_REQUIREMENT_STATS, useExisting: JobRequirementStatsService },
    CareerPlanDegradedPdfService,
    LlmSelfAssessmentService,
    SelfAssessmentService,
    SelfAssessmentPdfService,
    AppendedSelfAssessmentService,
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
    ResumeDocxService,
    ResumeTextService,
    // ── 阶段2B AI 简历优化真实化(基于原文,防编造) ──
    LlmResumeOptimizeService,
  ],
  // 导出 ResumeExtractionService 供 Phase 1B 的 AiService / 诊断 provider 复用。
  // 导出 OcrService 供 MaterialsModule 复用做打印材料真实内容扫描（文件体检真实化）。
  exports: [AiService, AiLogService, ResumeExtractionService, LlmConfigService, JobFitService, LlmJobFitService, OcrService],
})
export class AiModule {}
