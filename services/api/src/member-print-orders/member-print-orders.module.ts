import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { EndUserAuthGuard } from '../common/guards/end-user-auth.guard'
import { MemberPendingTasksController, MemberPrintOrdersController } from './member-print-orders.controller'
import { MemberPrintOrdersService } from './member-print-orders.service'
import { MemberPrintOrderCreateService } from './member-print-order-create.service'
import { MemberSelfRefundService } from './member-self-refund.service'
import { PrintJobsModule } from '../print-jobs/print-jobs.module'
import { PaymentModule } from '../payment/payment.module'
import { TerminalsModule } from '../terminals/terminals.module'

/**
 * 会员「我的打印订单」模块：历史任务只读 + M2 Order-only 预提交。
 *
 * 自带 enduser 专用 JwtModule（与 MemberAuthModule 同 JWT_SECRET + audience='enduser'），
 * 并本地 provide EndUserAuthGuard，使 @UseGuards(EndUserAuthGuard) 能在本模块注入上下文里
 * 解析 JwtService。PrismaService / RedisService 均为 @Global，直接注入。
 */
@Module({
  imports: [
    PrintJobsModule,
    PaymentModule,
    TerminalsModule,
    JwtModule.registerAsync({
      useFactory: () => {
        const secret = process.env['JWT_SECRET']
        if (!secret || secret.length < 16) {
          throw new Error('JWT_SECRET 未配置或长度不足 16 字符。请在 services/api/.env 中设置一个强随机值。')
        }
        return {
          secret,
          signOptions: { expiresIn: '30m', audience: 'enduser' },
        }
      },
    }),
  ],
  controllers: [MemberPrintOrdersController, MemberPendingTasksController],
  // MemberSelfRefundService 只是 RefundService 的门禁层：RefundService 由已 import 的
  // PaymentModule 导出（canonical 退款唯一实现），本模块绝不自建第二个退款 provider。
  providers: [MemberPrintOrdersService, MemberPrintOrderCreateService, MemberSelfRefundService, EndUserAuthGuard],
})
export class MemberPrintOrdersModule {}
