import { Module } from '@nestjs/common'
import { PrismaModule } from '../prisma/prisma.module'
import { AuthModule } from '../auth/auth.module'
import { CompaniesController } from './companies.controller'
import { CompaniesService } from './companies.service'

/**
 * 企业展示模块（CompanyProfile，来源企业与岗位导览）。
 *
 * 合规定位（长期红线）：企业展示不是招聘平台。只展示来源机构提供并经管理员
 * 审核发布的企业信息；不收简历、无平台内投递、无候选人/筛选/面试/Offer 能力。
 * AuthModule 提供 JwtAuthGuard / RolesGuard（admin / partner 端点）。
 */
@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [CompaniesController],
  providers: [CompaniesService],
  exports: [CompaniesService],
})
export class CompaniesModule {}
