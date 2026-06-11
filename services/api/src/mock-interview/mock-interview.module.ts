import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { AiModule } from '../ai/ai.module'
import { FilesModule } from '../files/files.module'
import { EndUserAuthGuard } from '../common/guards/end-user-auth.guard'
import { MemberMockInterviewController, MockInterviewController } from './mock-interview.controller'
import { MockInterviewService } from './mock-interview.service'
import { MockInterviewLlmService } from './mock-interview-llm.service'
import { InterviewReportPdfService } from './interview-report-pdf.service'
import { AsrService } from './asr/asr.service'
import { TtsService } from './asr/tts.service'

/**
 * 2C 模拟面试模块。
 *
 * 自带 enduser 专用 JwtModule（与 MemberAuthModule 同 JWT_SECRET + audience='enduser'），
 * 供匿名/会员双轨归属解析与 EndUserAuthGuard。依赖 AiModule 的 LlmConfigService
 * （mock_interview 功能位）与 ResumeExtractionService、FilesModule 的 FilesService。
 */
@Module({
  imports: [
    AiModule,
    FilesModule,
    JwtModule.registerAsync({
      useFactory: () => {
        const secret = process.env['JWT_SECRET']
        if (!secret || secret.length < 16) {
          throw new Error('JWT_SECRET 未配置或长度不足 16 字符。请在 services/api/.env 中设置一个强随机值。')
        }
        return { secret, signOptions: { expiresIn: '30m', audience: 'enduser' } }
      },
    }),
  ],
  controllers: [MockInterviewController, MemberMockInterviewController],
  providers: [MockInterviewService, MockInterviewLlmService, InterviewReportPdfService, AsrService, TtsService, EndUserAuthGuard],
})
export class MockInterviewModule {}
