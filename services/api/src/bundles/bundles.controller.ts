// bundles.controller.ts — GET/POST /api/v1/me/bundles
import { Body, Controller, Get, NotFoundException, Param, Post, UseGuards } from '@nestjs/common'
import { ApiResponse } from '../common/dto/api-response.dto'
import { CurrentEndUser, type AuthedEndUser } from '../common/decorators/current-end-user.decorator'
import { EndUserAuthGuard } from '../common/guards/end-user-auth.guard'
import { BundlesService } from './bundles.service'
import { CreateBundleDto } from './bundles.dto'

@Controller('me')
@UseGuards(EndUserAuthGuard)
export class BundlesController {
  constructor(private readonly bundles: BundlesService) {}

  /** POST /api/v1/me/bundles — 创建材料包，返回含 pickupCode */
  @Post('bundles')
  async create(
    @CurrentEndUser() user: AuthedEndUser,
    @Body() dto: CreateBundleDto,
  ) {
    const bundle = await this.bundles.create(user.endUserId, dto)
    return ApiResponse.ok(bundle)
  }

  /** GET /api/v1/me/bundles — 本人材料包列表（仅 24h 内未过期的） */
  @Get('bundles')
  async list(@CurrentEndUser() user: AuthedEndUser) {
    const result = await this.bundles.list(user.endUserId)
    return ApiResponse.ok(result)
  }

  /** GET /api/v1/me/bundles/:id — 材料包详情 */
  @Get('bundles/:id')
  async getOne(
    @CurrentEndUser() user: AuthedEndUser,
    @Param('id') id: string,
  ) {
    const bundle = await this.bundles.findOne(user.endUserId, id)
    if (!bundle) throw new NotFoundException('材料包不存在或已过期')
    return ApiResponse.ok(bundle)
  }
}
