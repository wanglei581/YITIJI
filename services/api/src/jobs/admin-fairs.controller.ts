import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
  UnauthorizedException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import type { Response } from 'express'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { Roles } from '../common/decorators/roles.decorator'
import { CurrentUser, type AuthedUser } from '../common/decorators/current-user.decorator'
import { AdminFairsService, FAIR_MATERIAL_MAX_BYTES } from './admin-fairs.service'
import { verifyFairMaterialSignature } from './fair-material-signing'
import {
  SaveFairCompanyDto,
  SaveFairZoneDto,
  UpdateFairInfoDto,
  UpdateFairMaterialDto,
  UploadFairMaterialDto,
} from './dto/admin-fair.dto'
import { PublishActionDto } from './dto/publish.dto'
import { SaveVenueGuideDto } from './dto/venue-guide.dto'

// FileInterceptor 硬上限略高于业务上限,让"略微超限"的文件到 service 拿到友好错误。
const UPLOAD_HARD_LIMIT = FAIR_MATERIAL_MAX_BYTES + 2 * 1024 * 1024

/**
 * Admin 招聘会管理(阶段1A)。
 *
 * 路由表(全部含 /api/v1 前缀):
 *   管理员(Bearer + admin):
 *     GET    /admin/fairs                                    招聘会列表(含 companies/zones/materials 计数)
 *     GET    /admin/fairs/:id                                详情(fair + companies + zones + materials)
 *     PATCH  /admin/fairs/:id                                编辑基本信息(来源字段不可改)
 *     GET    /admin/fairs/:id/stats                          真实统计聚合
 *     POST   /admin/fairs/:id/companies                      新增参展企业
 *     PATCH  /admin/fairs/:id/companies/:companyId           编辑参展企业
 *     DELETE /admin/fairs/:id/companies/:companyId           删除参展企业
 *     POST   /admin/fairs/:id/zones                          新增展区
 *     PATCH  /admin/fairs/:id/zones/:zoneId                  编辑展区
 *     DELETE /admin/fairs/:id/zones/:zoneId                  删除展区
 *     POST   /admin/fairs/:id/materials                      上传活动资料(multipart)
 *     PATCH  /admin/fairs/:id/materials/:materialId          编辑资料元数据
 *     PATCH  /admin/fairs/:id/materials/:materialId/publish  发布/下架资料
 *     DELETE /admin/fairs/:id/materials/:materialId          删除资料(物理删对象+软删行)
 *   资料内容(无登录,HMAC 签名,Kiosk/Admin 预览共用):
 *     GET    /job-fairs/materials/:materialId/content?expires=&sig=
 *
 * 审核/发布(approve/reject/publish/unpublish 整场招聘会)仍走 /admin/fair-sources(JobsController)。
 */
@Controller()
export class AdminFairsController {
  constructor(private readonly fairs: AdminFairsService) {}

  // ── 列表 / 详情 / 基本信息 ─────────────────────────────────────────────────

  @Get('admin/fairs')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  listFairs() {
    return this.fairs.listFairs()
  }

  @Get('admin/fairs/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  getFairDetail(@Param('id') id: string) {
    return this.fairs.getFairDetail(id)
  }

  @Patch('admin/fairs/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  updateFair(@Param('id') id: string, @Body() dto: UpdateFairInfoDto, @CurrentUser() user: AuthedUser) {
    return this.fairs.updateFairInfo(id, dto, user)
  }

  @Get('admin/fairs/:id/stats')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  getStats(@Param('id') id: string) {
    return this.fairs.getAdminStats(id)
  }

  // ── 参展企业 ───────────────────────────────────────────────────────────────

  @Post('admin/fairs/:id/companies')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  createCompany(@Param('id') id: string, @Body() dto: SaveFairCompanyDto, @CurrentUser() user: AuthedUser) {
    return this.fairs.createCompany(id, dto, user)
  }

  @Patch('admin/fairs/:id/companies/:companyId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  updateCompany(
    @Param('id') id: string,
    @Param('companyId') companyId: string,
    @Body() dto: SaveFairCompanyDto,
    @CurrentUser() user: AuthedUser,
  ) {
    return this.fairs.updateCompany(id, companyId, dto, user)
  }

  @Delete('admin/fairs/:id/companies/:companyId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  deleteCompany(
    @Param('id') id: string,
    @Param('companyId') companyId: string,
    @CurrentUser() user: AuthedUser,
  ) {
    return this.fairs.deleteCompany(id, companyId, user)
  }

  // ── 展区 ───────────────────────────────────────────────────────────────────

  @Post('admin/fairs/:id/zones')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  createZone(@Param('id') id: string, @Body() dto: SaveFairZoneDto, @CurrentUser() user: AuthedUser) {
    return this.fairs.createZone(id, dto, user)
  }

  @Patch('admin/fairs/:id/zones/:zoneId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  updateZone(
    @Param('id') id: string,
    @Param('zoneId') zoneId: string,
    @Body() dto: SaveFairZoneDto,
    @CurrentUser() user: AuthedUser,
  ) {
    return this.fairs.updateZone(id, zoneId, dto, user)
  }

  @Delete('admin/fairs/:id/zones/:zoneId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  deleteZone(@Param('id') id: string, @Param('zoneId') zoneId: string, @CurrentUser() user: AuthedUser) {
    return this.fairs.deleteZone(id, zoneId, user)
  }

  // ── 活动资料 ───────────────────────────────────────────────────────────────

  @Post('admin/fairs/:id/materials')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: UPLOAD_HARD_LIMIT, fieldNestingDepth: 0 } as { fieldNestingDepth: number; fileSize?: number } }))
  uploadMaterial(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: UploadFairMaterialDto,
    @CurrentUser() user: AuthedUser,
  ) {
    if (!file) {
      throw new BadRequestException({ error: { code: 'FILE_MISSING', message: '缺少上传文件字段(field name: file)' } })
    }
    const pageCount = dto.pageCount !== undefined ? Number(dto.pageCount) : undefined
    if (pageCount !== undefined && (!Number.isInteger(pageCount) || pageCount < 0 || pageCount > 9999)) {
      throw new BadRequestException({ error: { code: 'INVALID_PAGE_COUNT', message: 'pageCount 必须是 0~9999 的整数' } })
    }
    return this.fairs.uploadMaterial({
      fairId: id,
      buffer: file.buffer,
      declaredMime: file.mimetype,
      name: dto.name,
      type: dto.type,
      description: dto.description,
      pageCount,
      user,
    })
  }

  @Patch('admin/fairs/:id/materials/:materialId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  updateMaterial(
    @Param('id') id: string,
    @Param('materialId') materialId: string,
    @Body() dto: UpdateFairMaterialDto,
    @CurrentUser() user: AuthedUser,
  ) {
    return this.fairs.updateMaterial(id, materialId, dto, user)
  }

  @Patch('admin/fairs/:id/materials/:materialId/publish')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  publishMaterial(
    @Param('id') id: string,
    @Param('materialId') materialId: string,
    @Body() dto: PublishActionDto,
    @CurrentUser() user: AuthedUser,
  ) {
    return this.fairs.publishMaterial(id, materialId, dto.action, user)
  }

  @Delete('admin/fairs/:id/materials/:materialId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  deleteMaterial(
    @Param('id') id: string,
    @Param('materialId') materialId: string,
    @CurrentUser() user: AuthedUser,
  ) {
    return this.fairs.deleteMaterial(id, materialId, user)
  }

  // ── 场馆导览(Admin 配置)────────────────────────────────────────────────────
  //   GET    /admin/fairs/:id/venue-guide   读取配置(未配置 → data null)
  //   PUT    /admin/fairs/:id/venue-guide   整体保存(事务性替换;绑定企业须属于本会)
  //   DELETE /admin/fairs/:id/venue-guide   删除配置(级联清理 halls/facilities)

  @Get('admin/fairs/:id/venue-guide')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  getVenueGuide(@Param('id') id: string) {
    return this.fairs.getVenueGuideAdmin(id)
  }

  @Put('admin/fairs/:id/venue-guide')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  saveVenueGuide(@Param('id') id: string, @Body() dto: SaveVenueGuideDto, @CurrentUser() user: AuthedUser) {
    return this.fairs.saveVenueGuide(id, dto, user)
  }

  @Delete('admin/fairs/:id/venue-guide')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  deleteVenueGuide(@Param('id') id: string, @CurrentUser() user: AuthedUser) {
    return this.fairs.deleteVenueGuide(id, user)
  }

  // ── 资料内容(无登录,HMAC 签名)────────────────────────────────────────────
  // 与 ad-assets /content 同口径:浏览器 <img>/<iframe> 不带 Authorization,
  // 安全完全依赖签名 + TTL。签名失败一律 401,不区分原因(防探测)。

  @Get('job-fairs/materials/:materialId/content')
  async serveMaterialContent(
    @Param('materialId') materialId: string,
    @Query('expires') expires: string,
    @Query('sig') sig: string,
    @Res() res: Response,
  ): Promise<void> {
    if (!expires || !sig || !verifyFairMaterialSignature(materialId, expires, sig)) {
      throw new UnauthorizedException({ error: { code: 'MATERIAL_SIGNATURE_INVALID', message: '签名无效或已过期' } })
    }
    const { buffer, mimeType } = await this.fairs.readMaterialContent(materialId)
    res.setHeader('Content-Type', mimeType)
    res.setHeader('Content-Length', buffer.length)
    // Admin/Kiosk dev server 与 API 分端口运行,签名资料需要允许跨 origin 嵌入预览。
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
    res.setHeader('Cache-Control', 'private, max-age=600')
    res.send(buffer)
  }
}
