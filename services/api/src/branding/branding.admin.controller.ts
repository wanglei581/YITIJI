import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Put,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { CurrentUser, type AuthedUser } from '../common/decorators/current-user.decorator'
import { Roles } from '../common/decorators/roles.decorator'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { requestAuditContext } from '../common/request-audit-context'
import { BrandLogoService } from './brand-logo.service'
import { BrandingService } from './branding.service'
import { BRAND_LOGO_MAX_BYTES } from './branding.types'
import { UpdateBrandingDto } from './dto/update-branding.dto'

/** multer 的硬上限比业务上限（512KB）留出余量，让「略超」的文件走到 service 拿到友好的 BRAND_LOGO_TOO_LARGE。 */
const LOGO_UPLOAD_HARD_LIMIT = BRAND_LOGO_MAX_BYTES * 2

/**
 * 管理员：平台默认品牌与备案、Logo 上传。
 *   GET  /api/v1/admin/branding        读库存值（null = 没配、用默认）+ 默认值
 *   PUT  /api/v1/admin/branding        省略 = 不改；null 或纯空白 = 清除（回到默认）；写审计
 *   POST /api/v1/admin/branding/logo   multipart，字段名 file；只收 PNG（解压校验后重编码落盘）；返回 assetId，不自动启用
 * 一体机最迟 5 分钟内读到新值（客户端轮询，服务端不缓存）。
 */
@Controller('admin/branding')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class BrandingAdminController {
  constructor(
    private readonly branding: BrandingService,
    private readonly logos: BrandLogoService,
  ) {}

  @Get()
  async get() {
    return { success: true as const, data: await this.branding.getAdmin() }
  }

  @Put()
  async update(@Body() dto: UpdateBrandingDto, @CurrentUser() user: AuthedUser, @Req() req: unknown) {
    const data = await this.branding.updateAdmin(dto, {
      userId: user.userId,
      role: user.role,
      ...requestAuditContext(req),
    })
    return { success: true as const, data }
  }

  @Post('logo')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: LOGO_UPLOAD_HARD_LIMIT, fieldNestingDepth: 0 } as { fieldNestingDepth: number; fileSize?: number },
    }),
  )
  async uploadLogo(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthedUser,
    @Req() req: unknown,
  ) {
    if (!file) {
      throw new BadRequestException({ error: { code: 'FILE_MISSING', message: '缺少上传文件字段（field name: file）' } })
    }
    const data = await this.logos.upload(file.buffer, {
      actorId: user.userId,
      actorRole: user.role,
      ...requestAuditContext(req),
    })
    return { success: true as const, data }
  }
}
