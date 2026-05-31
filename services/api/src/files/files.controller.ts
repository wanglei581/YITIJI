import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import type { Response } from 'express'
import { ApiResponse } from '../common/dto/api-response.dto'
import { CurrentUser, type AuthedUser } from '../common/decorators/current-user.decorator'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { Roles } from '../common/decorators/roles.decorator'
import { FilesService } from './files.service'
import { UploadOptionsDto } from './dto/upload-options.dto'
import { verifyFileSignature } from './signing'
import type {
  FilePurpose,
  FileSensitiveLevel,
  FileUploadResponse,
  SignedUrlResponse,
  FileMetadata,
  FileCleanupResponse,
} from './file.types'

/**
 * 路由表(全路径加 /api/v1 前缀):
 *
 *   POST   /files                       multipart 上传(任意已登录用户)
 *   GET    /files/:id/url               重发签名 URL(任意已登录用户)
 *   GET    /files/:id/content?expires=...&sig=...  签名校验后流式返回内容(无登录)
 *   GET    /files                       列表(admin)
 *   DELETE /files/:id?reason=xxx        admin 强制删除单文件
 *   POST   /files/cleanup-expired       admin 立即清理所有已过期文件
 *
 * 注意:GET /files/:id/content 故意不挂 JwtAuthGuard,
 * 因为 <img src> / <iframe src> 浏览器不会带 Authorization 头,
 * 安全完全依赖 HMAC 签名 + 短 TTL(5 分钟)。
 */
@Controller('files')
export class FilesController {
  constructor(private readonly files: FilesService) {}

  /** Kiosk / Partner / Admin 均可上传,文件归属由 uploaderId 标记。 */
  @Post()
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() options: UploadOptionsDto,
    @CurrentUser() user: AuthedUser,
  ): Promise<ApiResponse<FileUploadResponse>> {
    if (!file) {
      throw new UnauthorizedException({
        error: { code: 'FILE_MISSING', message: '缺少上传文件字段(field name: file)' },
      })
    }
    const res = await this.files.upload({
      buffer: file.buffer,
      filename: file.originalname,
      mimeType: file.mimetype,
      purpose: options.purpose as FilePurpose,
      sensitiveLevel: options.sensitiveLevel as FileSensitiveLevel | undefined,
      uploaderId: user.userId,
    })
    return ApiResponse.ok(res)
  }

  @Get(':id/url')
  @UseGuards(JwtAuthGuard)
  async signedUrl(@Param('id') id: string): Promise<ApiResponse<SignedUrlResponse>> {
    return ApiResponse.ok(await this.files.getSignedUrl(id))
  }

  /**
   * 流式读取文件。签名失败一律返回 401,不区分原因(防探测)。
   * 不挂 JwtAuthGuard:浏览器 <img>/<iframe> 不带 Authorization,只能靠签名。
   */
  @Get(':id/content')
  async content(
    @Param('id') id: string,
    @Query('expires') expires: string,
    @Query('sig') sig: string,
    @Res() res: Response,
  ): Promise<void> {
    if (!expires || !sig || !verifyFileSignature(id, expires, sig)) {
      throw new UnauthorizedException({
        error: { code: 'FILE_SIGNATURE_INVALID', message: '签名无效或已过期' },
      })
    }
    const { buffer, mimeType, filename } = await this.files.readContent(id)
    res.setHeader('Content-Type', mimeType)
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(filename)}"`)
    res.setHeader('Cache-Control', 'private, max-age=300')
    res.send(buffer)
  }

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async list(
    @Query('includeDeleted') includeDeleted?: string,
    @Query('purpose') purpose?: string,
    @Query('limit') limit?: string,
  ): Promise<ApiResponse<FileMetadata[]>> {
    return ApiResponse.ok(
      await this.files.list({
        includeDeleted: includeDeleted === 'true' || includeDeleted === '1',
        purpose,
        limit: limit ? Number(limit) : undefined,
      }),
    )
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async forceDelete(
    @Param('id') id: string,
    @Query('reason') reason: string,
    @CurrentUser() user: AuthedUser,
    @Req() req: Express.Request & { requestId?: string },
  ): Promise<ApiResponse<FileMetadata>> {
    const result = await this.files.forceDelete(id, user.userId, reason || 'admin manual delete')
    // TODO(BE-2 W2):写 AuditLog
    //   action='file.force_delete', targetType='file', targetId=id,
    //   actorId=user.userId, actorRole='admin', payloadJson={reason}, requestId
    void req
    return ApiResponse.ok(result)
  }

  /** 立即清理所有已过期文件(admin 手动触发,等价于 cron 提前跑一次)。 */
  @Post('cleanup-expired')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async cleanupExpired(
    @CurrentUser() _user: AuthedUser,
    @Req() req: Express.Request & { requestId?: string },
  ): Promise<ApiResponse<FileCleanupResponse>> {
    const result = await this.files.cleanupExpired('manual')
    // TODO(BE-2 W2):写 AuditLog
    //   action='file.cleanup_expired', targetType='system', targetId=null,
    //   payloadJson={deletedCount, fileIds}, requestId
    void req
    return ApiResponse.ok(result)
  }
}
