import {
  BadRequestException,
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
import { Throttle } from '@nestjs/throttler'
import { AuditService } from '../audit/audit.service'
import { FilesService } from './files.service'
import { UploadOptionsDto } from './dto/upload-options.dto'
import { KioskUploadOptionsDto } from './dto/kiosk-upload-options.dto'
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
  constructor(
    private readonly files: FilesService,
    private readonly audit: AuditService,
  ) {}

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
      throw new BadRequestException({
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

  /**
   * Kiosk 一体机匿名上传(无登录态)。
   *
   * 设计理由(CLAUDE.md §9 Kiosk 无登录 + §11 文件安全):
   *   - 求职者在公共终端不应被强制注册
   *   - 但匿名上传必须靠时效兜底:purpose 严格白名单 + 强制由后端按 purpose
   *     推断 sensitiveLevel(简历类 1h 过期)
   *   - 限流比默认更严:20 次 / 60 秒 / 每 IP,防滥用
   *   - uploaderId 落 null;ip + ua 写 audit 留痕
   */
  @Post('kiosk-upload')
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @UseInterceptors(FileInterceptor('file'))
  async kioskUpload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() options: KioskUploadOptionsDto,
    @Req() req: Express.Request & { requestId?: string; headers: Record<string, string | string[] | undefined> },
  ): Promise<ApiResponse<FileUploadResponse>> {
    if (!file) {
      throw new BadRequestException({
        error: { code: 'FILE_MISSING', message: '缺少上传文件字段(field name: file)' },
      })
    }
    const res = await this.files.upload({
      buffer: file.buffer,
      filename: file.originalname,
      mimeType: file.mimetype,
      purpose: options.purpose as FilePurpose,
      uploaderId: null,
    })
    await this.audit.write({
      actorId: null,
      actorRole: 'kiosk',
      action: 'file.upload',
      targetType: 'file',
      targetId: res.fileId,
      payload: { purpose: options.purpose, filename: res.filename, sizeBytes: res.sizeBytes, source: 'kiosk_anonymous' },
      ipAddress: extractIp(req),
      userAgent: extractUa(req),
      requestId: req.requestId ?? null,
    })
    return ApiResponse.ok(res)
  }

  /**
   * 重发签名 URL。
   *
   * 访问控制(CLAUDE.md §11 文件安全):
   *   - admin 可访问任意文件
   *   - partner / kiosk 只能访问自己上传的文件(uploaderId === user.userId)
   *   - 匿名 Kiosk 上传(uploaderId = null)无法通过此端点二次签名;
   *     应在上传响应的 signedUrl 有效期内直接使用
   *
   * 每次调用均写访问审计日志,满足 CLAUDE.md §11"管理员访问文件必须记录日志"要求。
   */
  @Get(':id/url')
  @UseGuards(JwtAuthGuard)
  async signedUrl(
    @Param('id') id: string,
    @CurrentUser() user: AuthedUser,
    @Req() req: Express.Request & { requestId?: string; headers: Record<string, string | string[] | undefined> },
  ): Promise<ApiResponse<SignedUrlResponse>> {
    const result = await this.files.getSignedUrl(id, user)
    await this.audit.write({
      actorId: user.userId,
      actorRole: user.role,
      action: 'file.get_signed_url',
      targetType: 'file',
      targetId: id,
      payload: { purpose: result.purpose },
      ipAddress: extractIp(req),
      userAgent: extractUa(req),
      requestId: req.requestId ?? null,
    })
    return ApiResponse.ok(result)
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
    @Req() req: Express.Request & { requestId?: string; headers: Record<string, string | string[] | undefined> },
  ): Promise<ApiResponse<FileMetadata>> {
    const finalReason = reason || 'admin manual delete'
    const result = await this.files.forceDelete(id, user.userId, finalReason)
    await this.audit.write({
      actorId: user.userId,
      actorRole: 'admin',
      action: 'file.force_delete',
      targetType: 'file',
      targetId: id,
      payload: { reason: finalReason, filename: result.filename, sensitiveLevel: result.sensitiveLevel },
      ipAddress: extractIp(req),
      userAgent: extractUa(req),
      requestId: req.requestId ?? null,
    })
    return ApiResponse.ok(result)
  }

  /** 立即清理所有已过期文件(admin 手动触发,等价于 cron 提前跑一次)。 */
  @Post('cleanup-expired')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async cleanupExpired(
    @CurrentUser() user: AuthedUser,
    @Req() req: Express.Request & { requestId?: string; headers: Record<string, string | string[] | undefined> },
  ): Promise<ApiResponse<FileCleanupResponse>> {
    const result = await this.files.cleanupExpired('manual')
    await this.audit.write({
      actorId: user.userId,
      actorRole: 'admin',
      action: 'file.cleanup_expired',
      targetType: 'system',
      targetId: null,
      payload: { deletedCount: result.deletedCount, fileIds: result.deletedFileIds.slice(0, 50) },
      ipAddress: extractIp(req),
      userAgent: extractUa(req),
      requestId: req.requestId ?? null,
    })
    return ApiResponse.ok(result)
  }
}

/** Helper:从请求里取 IP(支持 X-Forwarded-For,生产应配 trust proxy)。 */
function extractIp(req: { headers: Record<string, string | string[] | undefined>; ip?: string; socket?: { remoteAddress?: string } }): string | null {
  const fwd = req.headers['x-forwarded-for']
  if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0]?.trim() ?? null
  if (Array.isArray(fwd) && fwd.length > 0) return fwd[0] ?? null
  return req.ip ?? req.socket?.remoteAddress ?? null
}

function extractUa(req: { headers: Record<string, string | string[] | undefined> }): string | null {
  const ua = req.headers['user-agent']
  if (typeof ua === 'string') return ua.slice(0, 256)
  if (Array.isArray(ua) && ua[0]) return ua[0].slice(0, 256)
  return null
}
