import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import type { Response } from 'express'
import { CurrentUser, type AuthedUser } from '../common/decorators/current-user.decorator'
import { Roles } from '../common/decorators/roles.decorator'
import { ApiResponse } from '../common/dto/api-response.dto'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { MiniappOrgEntryService } from './miniapp-org-entry.service'
import type {
  PartnerMiniappEntryCodeResult,
  PartnerMiniappEntryInfo,
  PublicMiniappOrgEntry,
} from './miniapp-org-entry.types'

/**
 * 「一机构一码」官方采购联名小程序入口：
 * - GET  /api/v1/public/miniapp-org-entry?orgId=   公开只读，严格 private/no-store，按 IP 限流
 * - GET  /api/v1/partner/miniapp-entry             合作机构后台查看本机构专属小程序路径与状态
 * - POST /api/v1/partner/miniapp-entry-code        合作机构后台生成本机构专属无限制小程序码
 */
@Controller()
export class MiniappOrgEntryController {
  constructor(private readonly entry: MiniappOrgEntryService) {}

  @Get('public/miniapp-org-entry')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  async getPublicEntry(
    @Query('orgId') orgId: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ApiResponse<PublicMiniappOrgEntry>> {
    // 成功与 404 错误响应均禁止共享或本地持久化缓存，确保机构停用/停服后立即失效
    res.setHeader('Cache-Control', 'private, no-store')
    return ApiResponse.ok(await this.entry.getPublicEntry(orgId))
  }

  @Get('partner/miniapp-entry')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('partner')
  async getPartnerEntry(
    @CurrentUser() user: AuthedUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ApiResponse<PartnerMiniappEntryInfo>> {
    res.setHeader('Cache-Control', 'private, no-store')
    return ApiResponse.ok(await this.entry.getPartnerEntry(user))
  }

  // 不加入 PARTNER_WRITE_EXEMPTIONS：机构授权不可用时由全局拦截器自动拒绝生成新推广码
  @Post('partner/miniapp-entry-code')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('partner')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async generatePartnerEntryCode(
    @CurrentUser() user: AuthedUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ApiResponse<PartnerMiniappEntryCodeResult>> {
    res.setHeader('Cache-Control', 'private, no-store')
    return ApiResponse.ok(await this.entry.generatePartnerEntryCode(user))
  }
}
