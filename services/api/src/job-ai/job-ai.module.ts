import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { AiModule } from '../ai/ai.module'
import { EndUserAuthGuard } from '../common/guards/end-user-auth.guard'
import { MemberPrivacyModule } from '../member-privacy/member-privacy.module'
import { JobFitController } from '../ai/job-fit.controller'
import { JobAiController, MemberJobAiSessionsController } from './job-ai.controller'
import { GovernedJobFitService } from './governed-job-fit.service'
import { JobAiService } from './job-ai.service'
import { JobAiLlmService } from './job-ai-llm.service'
import { JobContextService } from './job-context.service'
import { JobAiQuotaService } from './job-ai-quota.service'

/**
 * 岗位 AI 后端模块。
 *
 * JobFitService 由 AiModule 导出后在 JobAiService 中复用，避免绕过现有简历
 * 归属校验、输出防百分比 / 防录用概率 / 防平台投递文案的安全链路。
 */
@Module({
  imports: [
    AiModule,
    MemberPrivacyModule,
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
  controllers: [JobAiController, MemberJobAiSessionsController, JobFitController],
  providers: [JobAiService, JobAiLlmService, JobContextService, JobAiQuotaService, GovernedJobFitService, EndUserAuthGuard],
})
export class JobAiModule {}
