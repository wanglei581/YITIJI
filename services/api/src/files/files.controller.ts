import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  PayloadTooLargeException,
  Post,
  Put,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { JwtService } from '@nestjs/jwt'
import type { Response } from 'express'
import { ApiResponse } from '../common/dto/api-response.dto'
import { CurrentUser, type AuthedUser } from '../common/decorators/current-user.decorator'
import type { UserRole } from '../common/decorators/roles.decorator'
import { resolveOptionalEndUser } from '../common/auth/optional-end-user'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { Roles } from '../common/decorators/roles.decorator'
import { Throttle } from '@nestjs/throttler'
import { AuditService } from '../audit/audit.service'
import { RedisService } from '../common/redis/redis.service'
import { FilesService, type FileRequester } from './files.service'
import { UploadOptionsDto } from './dto/upload-options.dto'
import { KioskUploadOptionsDto } from './dto/kiosk-upload-options.dto'
import { CreateUploadIntentDto } from './dto/create-upload-intent.dto'
import { UpdateRetentionDto } from './dto/update-retention.dto'
import { verifyFileSignature, verifyRawUploadSignature } from './signing'
import type {
  FilePurpose,
  FileSensitiveLevel,
  FileUploadResponse,
  SignedUrlResponse,
  FileMetadata,
  FileCleanupResponse,
  FileAccessUrlResponse,
  UploadIntentResponse,
  CompleteUploadResponse,
  FileRetentionUpdateResponse,
  FileLifecycleSummaryResponse,
} from './file.types'

/** 本地代理直传单文件上限(防内存打爆;COS 直传不经此路径)。 */
const RAW_UPLOAD_MAX_BYTES = 200 * 1024 * 1024

/**
 * 路由表(全路径加 /api/v1 前缀):
 *
 *   POST   /files                       multipart 服务端代理上传(已登录 User)
 *   POST   /files/kiosk-upload          Kiosk 匿名 / 会员 multipart 上传
 *   POST   /files/upload-intent         创建直传意图(User / 会员)→ 预签名 PUT
 *   PUT    /files/:id/raw?expires&sig   本地后端直传写入(签名授权,无 JWT)
 *   POST   /files/:id/complete          直传完成确认(User / 会员)
 *   GET    /files/:id/url               重发签名 URL(已登录 User)
 *   GET    /files/:id/download-url      短期下载 URL(User / 会员;管理员访问用户文件写审计)
 *   GET    /files/:id/preview-url       短期预览 URL(同上)
 *   GET    /files/:id/content?...       签名校验后流式返回(/content 代理,兼容本地 & COS)
 *   GET    /files                       列表(admin)
 *   GET    /files/lifecycle-summary     文件生命周期全局统计(admin)
 *   PATCH  /files/:id/retention         会员本人修改文件保存期限
 *   DELETE /files/:id?reason=xxx        删除(owner / 会员本人 / admin)
 *   POST   /files/cleanup-expired       admin 立即清理所有已过期文件
 */
@Controller('files')
export class FilesController {
  constructor(
    private readonly files: FilesService,
    private readonly audit: AuditService,
    private readonly jwt: JwtService,
    private readonly redis: RedisService,
  ) {}

  // ── 服务端代理上传 ─────────────────────────────────────────────────────────

  @Post()
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() options: UploadOptionsDto,
    @CurrentUser() user: AuthedUser,
  ): Promise<ApiResponse<FileUploadResponse>> {
    if (!file) {
      throw new BadRequestException({ error: { code: 'FILE_MISSING', message: '缺少上传文件字段(field name: file)' } })
    }
    const res = await this.files.upload({
      buffer: file.buffer,
      filename: file.originalname,
      mimeType: file.mimetype,
      purpose: options.purpose as FilePurpose,
      sensitiveLevel: options.sensitiveLevel as FileSensitiveLevel | undefined,
      uploaderId: user.userId,
      actorRole: user.role,
      actorOrgId: user.orgId,
      createdBy: user.userId,
    })
    return ApiResponse.ok(res)
  }

  /** Kiosk 一体机匿名 / 会员上传(无 User 登录态;有会员 token 则绑定 endUserId)。 */
  @Post('kiosk-upload')
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @UseInterceptors(FileInterceptor('file'))
  async kioskUpload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() options: KioskUploadOptionsDto,
    @Req() req: Express.Request & { requestId?: string; headers: Record<string, string | string[] | undefined> },
  ): Promise<ApiResponse<FileUploadResponse>> {
    if (!file) {
      throw new BadRequestException({ error: { code: 'FILE_MISSING', message: '缺少上传文件字段(field name: file)' } })
    }
    const endUser = await resolveOptionalEndUser(extractAuth(req), this.jwt, this.redis)
    const res = await this.files.upload({
      buffer: file.buffer,
      filename: file.originalname,
      mimeType: file.mimetype,
      purpose: options.purpose as FilePurpose,
      uploaderId: null,
      endUserId: endUser?.endUserId ?? null,
    })
    await this.audit.write({
      actorId: null,
      actorRole: 'kiosk',
      action: 'file.upload',
      targetType: 'file',
      targetId: res.fileId,
      payload: {
        purpose: options.purpose,
        filename: res.filename,
        sizeBytes: res.sizeBytes,
        source: endUser ? 'kiosk_member' : 'kiosk_anonymous',
        hasEndUser: Boolean(endUser),
      },
      ipAddress: extractIp(req),
      userAgent: extractUa(req),
      requestId: req.requestId ?? null,
    })
    return ApiResponse.ok(res)
  }

  // ── 直传意图 + 完成 ──────────────────────────────────────────────────────

  /** 创建上传意图(需 User 或会员身份;匿名走 kiosk-upload)。 */
  @Post('upload-intent')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  async uploadIntent(
    @Body() body: CreateUploadIntentDto,
    @Req() req: ReqLike,
  ): Promise<ApiResponse<UploadIntentResponse>> {
    const requester = await this.resolveRequester(req)
    if (!requester) {
      throw new UnauthorizedException({ error: { code: 'AUTH_REQUIRED', message: '需登录后创建上传意图' } })
    }
    const res = await this.files.createUploadIntent({
      body,
      uploaderId: requester.kind === 'user' ? requester.userId : null,
      endUserId: requester.kind === 'member' ? requester.endUserId : null,
      actorRole: requester.kind === 'user' ? requester.role : null,
      actorOrgId: requester.kind === 'user' ? requester.orgId : null,
      createdBy: requester.kind === 'user' ? requester.userId : null,
    })
    return ApiResponse.ok(res)
  }

  /** 本地后端直传写入(签名 URL 即授权,内容类型非 application/json 时 body 为原始字节)。 */
  @Put(':id/raw')
  async rawUpload(
    @Param('id') id: string,
    @Query('expires') expires: string,
    @Query('sig') sig: string,
    @Req() req: ReqLike & AsyncIterable<Buffer>,
  ): Promise<ApiResponse<{ ok: true }>> {
    if (!expires || !sig || !verifyRawUploadSignature(id, expires, sig)) {
      throw new UnauthorizedException({ error: { code: 'FILE_SIGNATURE_INVALID', message: '签名无效或已过期' } })
    }
    const chunks: Buffer[] = []
    let total = 0
    for await (const chunk of req) {
      total += chunk.length
      if (total > RAW_UPLOAD_MAX_BYTES) {
        throw new PayloadTooLargeException({ error: { code: 'FILE_TOO_LARGE', message: '上传体积超出代理上限' } })
      }
      chunks.push(chunk)
    }
    await this.files.writeRawUpload(id, Buffer.concat(chunks))
    return ApiResponse.ok({ ok: true })
  }

  /** 直传完成确认(headObject 复核;User / 会员本人)。 */
  @Post(':id/complete')
  async complete(@Param('id') id: string, @Req() req: ReqLike): Promise<ApiResponse<CompleteUploadResponse>> {
    const requester = await this.resolveRequester(req)
    if (!requester) {
      throw new UnauthorizedException({ error: { code: 'AUTH_REQUIRED', message: '需登录后确认上传' } })
    }
    return ApiResponse.ok(await this.files.completeUpload(id, requester))
  }

  // ── 下载 / 预览短期 URL ──────────────────────────────────────────────────

  @Get(':id/download-url')
  async downloadUrl(@Param('id') id: string, @Req() req: ReqLike): Promise<ApiResponse<FileAccessUrlResponse>> {
    return this.accessUrl(id, req, 'attachment')
  }

  @Get(':id/preview-url')
  async previewUrl(@Param('id') id: string, @Req() req: ReqLike): Promise<ApiResponse<FileAccessUrlResponse>> {
    return this.accessUrl(id, req, 'inline')
  }

  private async accessUrl(
    id: string,
    req: ReqLike,
    disposition: 'inline' | 'attachment',
  ): Promise<ApiResponse<FileAccessUrlResponse>> {
    const requester = await this.resolveRequester(req)
    if (!requester) {
      throw new UnauthorizedException({ error: { code: 'AUTH_REQUIRED', message: '需登录后访问文件' } })
    }
    const { response, record, needsAdminAudit } = await this.files.getAccessUrl(id, requester, disposition)
    // 合规(CLAUDE.md §11):管理员访问用户文件必须记录审计日志。
    if (needsAdminAudit && requester.kind === 'user') {
      await this.audit.write({
        actorId: requester.userId,
        actorRole: 'admin',
        action: 'file.admin_access',
        targetType: 'file',
        targetId: id,
        payload: { purpose: record.purpose, ownerType: record.ownerType, disposition },
        ipAddress: extractIp(req),
        userAgent: extractUa(req),
        requestId: req.requestId ?? null,
      })
    }
    return ApiResponse.ok(response)
  }

  /** Admin 文件生命周期全局只读统计。 */
  @Get('lifecycle-summary')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async lifecycleSummary(): Promise<ApiResponse<FileLifecycleSummaryResponse>> {
    return ApiResponse.ok(await this.files.lifecycleSummary())
  }

  /** 旧端点:重发签名 URL(已登录 User)。 */
  @Get(':id/url')
  @UseGuards(JwtAuthGuard)
  async signedUrl(
    @Param('id') id: string,
    @CurrentUser() user: AuthedUser,
    @Req() req: ReqLike,
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
   * 流式读取文件(/content 代理,兼容本地 & COS 后端)。
   * 签名失败一律 401,不区分原因(防探测)。不挂 JwtAuthGuard:浏览器
   * <img>/<iframe> 不带 Authorization,只能靠签名。
   */
  @Get(':id/content')
  async content(
    @Param('id') id: string,
    @Query('expires') expires: string,
    @Query('sig') sig: string,
    @Query('disposition') disposition: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    if (!expires || !sig || !verifyFileSignature(id, expires, sig)) {
      throw new UnauthorizedException({ error: { code: 'FILE_SIGNATURE_INVALID', message: '签名无效或已过期' } })
    }
    const { buffer, mimeType, filename } = await this.files.readContent(id)
    const dispType = disposition === 'attachment' ? 'attachment' : 'inline'
    res.setHeader('Content-Type', mimeType)
    res.setHeader('Content-Disposition', `${dispType}; filename="${encodeURIComponent(filename)}"`)
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

  /** 会员本人修改文件保存期限。管理员代改不走此用户同意端点。 */
  @Patch(':id/retention')
  async updateRetention(
    @Param('id') id: string,
    @Body() body: UpdateRetentionDto,
    @Req() req: ReqLike,
  ): Promise<ApiResponse<FileRetentionUpdateResponse>> {
    const requester = await this.resolveRequester(req)
    if (!requester) {
      throw new UnauthorizedException({ error: { code: 'AUTH_REQUIRED', message: '需登录后修改文件保存期限' } })
    }
    const result = await this.files.updateRetention(id, requester, {
      retentionPolicy: body.retentionPolicy,
      consentVersion: body.consentVersion,
    })
    await this.audit.write({
      actorId: null,
      actorRole: 'enduser',
      action: 'file.retention_update',
      targetType: 'file',
      targetId: id,
      payload: {
        endUserId: requester.kind === 'member' ? requester.endUserId : null,
        retentionPolicy: result.file.retentionPolicy,
        expiresAt: result.file.expiresAt,
        consentVersion: result.file.retentionConsentVersion,
      },
      ipAddress: extractIp(req),
      userAgent: extractUa(req),
      requestId: req.requestId ?? null,
    })
    return ApiResponse.ok(result)
  }

  /**
   * 删除文件(软删数据库 + 物理删 COS / 本地对象)。
   * 授权:admin 任意;owner(uploader / 本机构 partner)/ 会员本人(endUserId)删自己的。
   */
  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @Query('reason') reason: string,
    @Req() req: ReqLike,
  ): Promise<ApiResponse<FileMetadata>> {
    const requester = await this.resolveRequester(req)
    if (!requester) {
      throw new UnauthorizedException({ error: { code: 'AUTH_REQUIRED', message: '需登录后删除文件' } })
    }
    const finalReason = reason || 'manual delete'
    const result = await this.files.ownerDelete(id, requester, finalReason)
    await this.audit.write({
      // AuditLog.actorId 外键指向运营 User 表：会员删除 actorId 必须写 null，
      // endUserId 放 payload（否则 FK 失败、审计行被静默吞掉 = 会员删除从未留痕）。
      actorId: requester.kind === 'user' ? requester.userId : null,
      actorRole: requester.kind === 'user' ? requester.role : 'enduser',
      action: 'file.delete',
      targetType: 'file',
      targetId: id,
      payload: {
        reason: finalReason,
        filename: result.filename,
        sensitiveLevel: result.sensitiveLevel,
        ...(requester.kind === 'member' ? { endUserId: requester.endUserId } : {}),
      },
      ipAddress: extractIp(req),
      userAgent: extractUa(req),
      requestId: req.requestId ?? null,
    })
    return ApiResponse.ok(result)
  }

  /** 立即清理所有已过期文件(admin 手动触发)。 */
  @Post('cleanup-expired')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async cleanupExpired(@CurrentUser() user: AuthedUser, @Req() req: ReqLike): Promise<ApiResponse<FileCleanupResponse>> {
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

  // ── 内部:解析请求者(会员优先,其次 User)───────────────────────────────

  private async resolveRequester(req: ReqLike): Promise<FileRequester | null> {
    const auth = extractAuth(req)
    const member = await resolveOptionalEndUser(auth, this.jwt, this.redis)
    if (member) return { kind: 'member', endUserId: member.endUserId }
    if (auth && auth.toLowerCase().startsWith('bearer ')) {
      const token = auth.slice(7).trim()
      try {
        const payload = this.jwt.verify<{ sub: string; role: UserRole; orgId: string | null; aud?: string }>(token)
        if (payload.aud !== 'enduser') {
          return { kind: 'user', userId: payload.sub, role: payload.role, orgId: payload.orgId }
        }
      } catch {
        // 无效 User token → 视为未登录
      }
    }
    return null
  }
}

type ReqLike = Express.Request & {
  requestId?: string
  headers: Record<string, string | string[] | undefined>
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

function extractAuth(req: { headers: Record<string, string | string[] | undefined> }): string | undefined {
  const auth = req.headers.authorization
  if (typeof auth === 'string') return auth
  if (Array.isArray(auth)) return auth[0]
  return undefined
}
