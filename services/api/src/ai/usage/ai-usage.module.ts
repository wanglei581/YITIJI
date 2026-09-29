import { Module } from '@nestjs/common'
import { AuthModule } from '../../auth/auth.module'
import { PrismaModule } from '../../prisma/prisma.module'
import { AdminAiUsageController } from './admin-ai-usage.controller'
import { AiBudgetService } from './ai-budget.service'

/**
 * P1-2a AI 逐次计量账与每日金额上限。
 *
 * AiBudgetService 在 onModuleInit 里把自己注册成 llmFetchJson 的计量落账去处；
 * 由 AiAccessModule 导入并在 enforce 里做额度检查。请求身份上下文由 app.module 上的
 * AiRequestContextMiddleware 提供（它要用 TerminalSessionService，放在这里会与
 * TerminalsModule → AiAccessModule 形成循环依赖）。
 */
@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [AdminAiUsageController],
  providers: [AiBudgetService],
  exports: [AiBudgetService],
})
export class AiUsageModule {}
