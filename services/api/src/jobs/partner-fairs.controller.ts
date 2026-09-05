import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { CurrentUser, type AuthedUser } from '../common/decorators/current-user.decorator'
import { Roles } from '../common/decorators/roles.decorator'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { PrismaService } from '../prisma/prisma.service'
import { FairCompanyZoneService } from './fair-company-zone.service'
import { FAIR_MATERIAL_MAX_BYTES, FairMaterialService } from './fair-material.service'
import { FairVenueGuideService } from './fair-venue-guide.service'
import { SaveFairZoneDto, UpdateFairMaterialDto, UploadFairMaterialDto } from './dto/admin-fair.dto'
import { SaveVenueGuideDto } from './dto/venue-guide.dto'

// 留出略高于业务上限的空间，让服务层返回稳定的 MATERIAL_TOO_LARGE 错误。
const UPLOAD_HARD_LIMIT = FAIR_MATERIAL_MAX_BYTES + 2 * 1024 * 1024

/**
 * 合作机构招聘会子资源。
 *
 * 不复用 AdminFairsController：Partner 的边界是“仅本机构招聘会”，而不是管理员的
 * 全局运营权限。所有写/读入口都先统一验证 fair.sourceOrgId，避免子资源 ID 探测。
 * 活动资料没有发布入口；上传后的默认 unpublished 状态只能由管理员改变。
 */
@Controller('partner/fairs')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('partner')
export class PartnerFairsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly zones: FairCompanyZoneService,
    private readonly materials: FairMaterialService,
    private readonly venueGuide: FairVenueGuideService
  ) {}

  @Get(':id/zones')
  async getZones(@Param('id') fairId: string, @CurrentUser() user: AuthedUser) {
    await this.assertPartnerOwnsFair(fairId, user)
    return { data: await this.zones.listZones(fairId) }
  }

  @Post(':id/zones')
  async createZone(
    @Param('id') fairId: string,
    @Body() dto: SaveFairZoneDto,
    @CurrentUser() user: AuthedUser
  ) {
    await this.assertPartnerOwnsFair(fairId, user)
    return this.zones.createZone(fairId, dto, user)
  }

  @Patch(':id/zones/:zoneId')
  async updateZone(
    @Param('id') fairId: string,
    @Param('zoneId') zoneId: string,
    @Body() dto: SaveFairZoneDto,
    @CurrentUser() user: AuthedUser
  ) {
    await this.assertPartnerOwnsFair(fairId, user)
    return this.zones.updateZone(fairId, zoneId, dto, user)
  }

  @Delete(':id/zones/:zoneId')
  async deleteZone(
    @Param('id') fairId: string,
    @Param('zoneId') zoneId: string,
    @CurrentUser() user: AuthedUser
  ) {
    await this.assertPartnerOwnsFair(fairId, user)
    return this.zones.deleteZone(fairId, zoneId, user)
  }

  @Get(':id/materials')
  async getMaterials(@Param('id') fairId: string, @CurrentUser() user: AuthedUser) {
    await this.assertPartnerOwnsFair(fairId, user)
    return { data: await this.materials.listMaterials(fairId) }
  }

  @Post(':id/materials')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: UPLOAD_HARD_LIMIT, fieldNestingDepth: 0 } as {
        fieldNestingDepth: number
        fileSize?: number
      },
    })
  )
  async uploadMaterial(
    @Param('id') fairId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: UploadFairMaterialDto,
    @CurrentUser() user: AuthedUser
  ) {
    await this.assertPartnerOwnsFair(fairId, user)
    if (!file) {
      throw new BadRequestException({
        error: { code: 'FILE_MISSING', message: '缺少上传文件字段(field name: file)' },
      })
    }
    const pageCount = dto.pageCount !== undefined ? Number(dto.pageCount) : undefined
    if (
      pageCount !== undefined &&
      (!Number.isInteger(pageCount) || pageCount < 0 || pageCount > 9999)
    ) {
      throw new BadRequestException({
        error: { code: 'INVALID_PAGE_COUNT', message: 'pageCount 必须是 0~9999 的整数' },
      })
    }
    return this.materials.uploadMaterial({
      fairId,
      buffer: file.buffer,
      declaredMime: file.mimetype,
      name: dto.name,
      type: dto.type,
      description: dto.description,
      pageCount,
      initialPublishStatus: 'unpublished',
      user,
    })
  }

  @Patch(':id/materials/:materialId')
  async updateMaterial(
    @Param('id') fairId: string,
    @Param('materialId') materialId: string,
    @Body() dto: UpdateFairMaterialDto,
    @CurrentUser() user: AuthedUser
  ) {
    await this.assertPartnerOwnsFair(fairId, user)
    return this.materials.updateMaterial(fairId, materialId, dto, user)
  }

  @Delete(':id/materials/:materialId')
  async deleteMaterial(
    @Param('id') fairId: string,
    @Param('materialId') materialId: string,
    @CurrentUser() user: AuthedUser
  ) {
    await this.assertPartnerOwnsFair(fairId, user)
    return this.materials.deleteMaterial(fairId, materialId, user)
  }

  @Get(':id/venue-guide')
  async getVenueGuide(@Param('id') fairId: string, @CurrentUser() user: AuthedUser) {
    await this.assertPartnerOwnsFair(fairId, user)
    return this.venueGuide.getVenueGuideAdmin(fairId)
  }

  @Put(':id/venue-guide')
  async saveVenueGuide(
    @Param('id') fairId: string,
    @Body() dto: SaveVenueGuideDto,
    @CurrentUser() user: AuthedUser
  ) {
    await this.assertPartnerOwnsFair(fairId, user)
    return this.venueGuide.saveVenueGuide(fairId, dto, user)
  }

  @Delete(':id/venue-guide')
  async deleteVenueGuide(@Param('id') fairId: string, @CurrentUser() user: AuthedUser) {
    await this.assertPartnerOwnsFair(fairId, user)
    return this.venueGuide.deleteVenueGuide(fairId, user)
  }

  private async assertPartnerOwnsFair(fairId: string, user: AuthedUser): Promise<void> {
    if (!user.orgId) {
      throw new BadRequestException({
        error: { code: 'ORG_REQUIRED', message: '合作机构账号未绑定机构' },
      })
    }
    const fair = await this.prisma.jobFair.findUnique({
      where: { id: fairId },
      select: { sourceOrgId: true },
    })
    if (!fair || fair.sourceOrgId !== user.orgId) {
      throw new NotFoundException({
        error: { code: 'FAIR_NOT_FOUND', message: `Fair ${fairId} not found` },
      })
    }
  }
}
