import { Module } from '@nestjs/common'
import { BenefitRedemptionService } from './benefit-redemption.service'

// 权益核销模块（P1 核销 SSOT）。PrismaModule / AuditModule 均为 @Global，无需在此 import。
// 只导出 service 供服务点位（本批：AI 简历优化）内部调用；本批不暴露用户端核销端点。
@Module({
  providers: [BenefitRedemptionService],
  exports: [BenefitRedemptionService],
})
export class BenefitRedemptionModule {}
