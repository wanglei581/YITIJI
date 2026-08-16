import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { AiModule } from '../ai/ai.module'
import { FilesModule } from '../files/files.module'
import { AdvisorController } from './advisor.controller'
import { AdvisorService } from './advisor.service'
import { AdvisorArtifactService } from './advisor-artifact.service'
import { AdvisorPdfService } from './advisor-pdf.service'
import { LlmAdvisorService } from './llm-advisor.service'

/**
 * S3-3 · P26 顾问作业面（/ai/plan）后端模块。
 *
 * 依赖：
 * - AiModule：LlmConfigService（advisor_work 功能位，未单独配置时继承 assistant_chat）
 *             + AiLogService（A-6 观测口径）
 * - FilesModule：产物 PDF → FileObject（我的文档 / 打印订单）
 * - 自带 enduser 专用 JwtModule（与 MockInterviewModule / MemberAuthModule 同口径），
 *   供匿名 + 会员双轨归属解析。
 *
 * 刻意不改 ai.module.ts：本能力是独立作业面而不是助手对话的一部分，
 * 单独成模块可以让它的开关、限流与产物治理独立演进。
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
  controllers: [AdvisorController],
  providers: [AdvisorService, AdvisorArtifactService, AdvisorPdfService, LlmAdvisorService],
})
export class AdvisorModule {}
