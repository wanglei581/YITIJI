import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { AiModule } from '../ai/ai.module'
import { FilesModule } from '../files/files.module'
import { AdvisorController } from './advisor.controller'
import { AdvisorService } from './advisor.service'
import { AdvisorArtifactService } from './advisor-artifact.service'
import { AdvisorPdfService } from './advisor-pdf.service'
import { AdvisorRetentionTask } from './advisor-retention.task'
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
  providers: [
    AdvisorService,
    AdvisorArtifactService,
    AdvisorPdfService,
    LlmAdvisorService,
    // 留存清理：三张 advisor 表落的是用户原话，过期后必须物理删除而不是只在
    // 读路径挡掉（详见 advisor-retention.task.ts 顶部注释）。cron 由 AppModule
    // 顶层的 ScheduleModule.forRoot() 驱动。
    AdvisorRetentionTask,
  ],
})
export class AdvisorModule {}
