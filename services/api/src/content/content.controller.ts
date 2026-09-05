import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
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
import type { Response } from 'express'
import type { Request } from 'express'
import { CurrentUser, type AuthedUser } from '../common/decorators/current-user.decorator'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { Roles } from '../common/decorators/roles.decorator'
import { ContentService } from './content.service'
import { getMediaLimits } from './media-validation'
import { verifyAdAssetSignature } from './content-signing'
import { UploadAdAssetDto } from './dto/upload-ad-asset.dto'
import { CreateExternalVideoDto } from './dto/create-external-video.dto'
import { UpdateAdAssetDto } from './dto/update-ad-asset.dto'
import { SavePlaylistDto } from './dto/save-playlist.dto'
import { SaveScreensaverConfigDto } from './dto/save-config.dto'

import { resolveClientIp } from '../common/client-ip'
// FileInterceptor 的 fileSize 是硬上限(防 OOM/DoS),比业务上限留出余量,
// 让"略微超限"的正常视频也能到达 service 拿到友好的 AD_ASSET_TOO_LARGE 提示。
const UPLOAD_HARD_LIMIT = getMediaLimits().maxVideoBytes + 4 * 1024 * 1024

/**
 * 待机宣传屏内容接口。
 *
 * 路由表(全部含 /api/v1 前缀):
 *   管理员(Bearer + admin):
 *     POST   /admin/ad-assets                              上传素材(multipart)
 *     POST   /admin/ad-assets/external-video               登记外部视频直链(JSON)
 *     GET    /admin/ad-assets                              素材列表
 *     PATCH  /admin/ad-assets/:id                          改标题/时长/启停
 *     DELETE /admin/ad-assets/:id                          删除素材(物理删 + 软删)
 *     GET    /admin/ad-playlists                           播放方案列表
 *     POST   /admin/ad-playlists                           新建方案
 *     PUT    /admin/ad-playlists/:id                       覆盖保存方案(含排序)
 *     DELETE /admin/ad-playlists/:id                       删除方案(解绑终端)
 *     GET    /admin/screensaver/terminals                 终端 + 屏保配置列表
 *     GET    /admin/terminals/:terminalId/screensaver-config
 *     PUT    /admin/terminals/:terminalId/screensaver-config
 *   Kiosk(无登录,只读):
 *     GET    /terminals/:terminalId/screensaver           拉取屏保配置 + 播放列表
 *   素材内容(无登录,HMAC 签名):
 *     GET    /ad-assets/:id/content?expires=&sig=          流式返回素材
 */
@Controller()
export class ContentController {
  constructor(
    private readonly content: ContentService,
  ) {}

  // ── 素材(admin)──────────────────────────────────────────────────────────

  @Post('admin/ad-assets')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: UPLOAD_HARD_LIMIT, fieldNestingDepth: 0 } as { fieldNestingDepth: number; fileSize?: number } }))
  async uploadAsset(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: UploadAdAssetDto,
    @CurrentUser() user: AuthedUser,
    @Req() req: AuditReq,
  ) {
    if (!file) {
      throw new BadRequestException({ error: { code: 'FILE_MISSING', message: '缺少上传文件字段(field name: file)' } })
    }
    const asset = await this.content.createAsset({
      buffer: file.buffer,
      mimeType: file.mimetype,
      title: dto.title,
      durationSec: dto.durationSec,
      createdBy: user.userId,
      auditContext: toAuditContext(req, user),
    })
    return asset
  }

  @Post('admin/ad-assets/external-video')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async createExternalAsset(
    @Body() dto: CreateExternalVideoDto,
    @CurrentUser() user: AuthedUser,
    @Req() req: AuditReq,
  ) {
    const asset = await this.content.createExternalAsset({
      url: dto.url,
      title: dto.title,
      durationSec: dto.durationSec,
      createdBy: user.userId,
      auditContext: toAuditContext(req, user),
    })
    return asset
  }

  @Get('admin/ad-assets')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  listAssets(
    @Query('includeDeleted') includeDeleted?: string,
    @Query('status') status?: string,
    @Query('type') type?: string,
  ) {
    return this.content.listAssets({
      includeDeleted: includeDeleted === 'true' || includeDeleted === '1',
      status,
      type,
    })
  }

  @Patch('admin/ad-assets/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async updateAsset(
    @Param('id') id: string,
    @Body() dto: UpdateAdAssetDto,
    @CurrentUser() user: AuthedUser,
    @Req() req: AuditReq,
  ) {
    const asset = await this.content.updateAsset(id, dto, toAuditContext(req, user))
    return asset
  }

  @Delete('admin/ad-assets/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async deleteAsset(@Param('id') id: string, @CurrentUser() user: AuthedUser, @Req() req: AuditReq) {
    const asset = await this.content.deleteAsset(id, toAuditContext(req, user))
    return asset
  }

  // ── 播放方案(admin)─────────────────────────────────────────────────────

  @Get('admin/ad-playlists')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  listPlaylists() {
    return this.content.listPlaylists()
  }

  @Post('admin/ad-playlists')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async createPlaylist(@Body() dto: SavePlaylistDto, @CurrentUser() user: AuthedUser, @Req() req: AuditReq) {
    const playlist = await this.content.createPlaylist({
      name: dto.name,
      status: dto.status,
      items: dto.items,
      createdBy: user.userId,
      auditContext: toAuditContext(req, user),
    })
    return playlist
  }

  @Put('admin/ad-playlists/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async updatePlaylist(
    @Param('id') id: string,
    @Body() dto: SavePlaylistDto,
    @CurrentUser() user: AuthedUser,
    @Req() req: AuditReq,
  ) {
    const playlist = await this.content.updatePlaylist(
      id,
      { name: dto.name, status: dto.status, items: dto.items },
      toAuditContext(req, user),
    )
    return playlist
  }

  @Delete('admin/ad-playlists/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  async deletePlaylist(@Param('id') id: string, @CurrentUser() user: AuthedUser, @Req() req: AuditReq) {
    await this.content.deletePlaylist(id, toAuditContext(req, user))
    return { success: true }
  }

  // ── 终端配置(admin)─────────────────────────────────────────────────────

  @Get('admin/screensaver/terminals')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  listScreensaverTerminals() {
    return this.content.listScreensaverTerminals()
  }

  @Get('admin/terminals/:terminalId/screensaver-config')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  getTerminalConfig(@Param('terminalId') terminalId: string) {
    return this.content.getTerminalConfig(terminalId)
  }

  @Put('admin/terminals/:terminalId/screensaver-config')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async saveTerminalConfig(
    @Param('terminalId') terminalId: string,
    @Body() dto: SaveScreensaverConfigDto,
    @CurrentUser() user: AuthedUser,
    @Req() req: AuditReq,
  ) {
    const config = await this.content.saveTerminalConfig(
      terminalId,
      { enabled: dto.enabled, idleTimeoutSec: dto.idleTimeoutSec, playlistId: dto.playlistId ?? null },
      user.userId,
      toAuditContext(req, user),
    )
    return config
  }

  // ── Kiosk 拉取(无登录,只读)────────────────────────────────────────────

  @Get('terminals/:terminalId/screensaver')
  @HttpCode(HttpStatus.OK)
  getKioskPlaylist(@Param('terminalId') terminalId: string) {
    return this.content.getKioskPlaylist(terminalId)
  }

  // ── 素材内容(无登录,HMAC 签名)──────────────────────────────────────────
  // 与 files /content 同口径:不挂 JwtAuthGuard,浏览器 <img>/<video> 不带 Authorization,
  // 安全完全依赖签名 + TTL。签名失败一律 401,不区分原因(防探测)。

  @Get('ad-assets/:id/content')
  async serveAssetContent(
    @Param('id') id: string,
    @Query('expires') expires: string,
    @Query('sig') sig: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    if (!expires || !sig || !verifyAdAssetSignature(id, expires, sig)) {
      throw new UnauthorizedException({ error: { code: 'AD_ASSET_SIGNATURE_INVALID', message: '签名无效或已过期' } })
    }
    const rangeHeader = req.headers.range
    const info = await this.content.getAssetContentInfo(id)
    const range = parseByteRange(rangeHeader, info.sizeBytes)
    if (rangeHeader && !range) {
      res.status(HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
      res.setHeader('Content-Range', `bytes */${info.sizeBytes}`)
      res.end()
      return
    }
    const content = await this.content.streamAssetContent(id, range ?? undefined)
    res.setHeader('Content-Type', content.mimeType)
    res.setHeader('Content-Length', content.contentLength)
    // Admin/Kiosk dev server 与 API 分端口运行,签名素材需要允许跨 origin 作为 <img>/<video> 嵌入。
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
    // 屏保素材可被 Kiosk 长缓存(内容不可变,内容变了会换新 id)
    res.setHeader('Cache-Control', 'public, max-age=3600')
    res.setHeader('Accept-Ranges', 'bytes')
    if (range) {
      res.status(HttpStatus.PARTIAL_CONTENT)
      res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${content.sizeBytes}`)
    }
    content.stream.on('error', () => res.destroy())
    content.stream.pipe(res)
  }

}

export function parseByteRange(raw: string | undefined, size: number): { start: number; end: number } | null {
  if (!raw) return null
  const match = raw.match(/^bytes=(\d*)-(\d*)$/)
  if (!match || size <= 0) return null
  const startRaw = match[1]
  const endRaw = match[2]
  if (!startRaw && !endRaw) return null
  if (!startRaw) {
    const suffix = Number(endRaw)
    if (!Number.isInteger(suffix) || suffix <= 0) return null
    return { start: Math.max(0, size - suffix), end: size - 1 }
  }
  const start = Number(startRaw)
  const requestedEnd = endRaw ? Number(endRaw) : size - 1
  if (!Number.isInteger(start) || !Number.isInteger(requestedEnd) || start < 0 || start >= size || requestedEnd < start) return null
  return { start, end: Math.min(requestedEnd, size - 1) }
}

interface AuditReq {
  headers: Record<string, string | string[] | undefined>
  requestId?: string
  ip?: string
  socket?: { remoteAddress?: string }
}

function extractIp(req: unknown): string | null {
  return resolveClientIp(req)
}

function extractUa(req: AuditReq): string | null {
  const ua = req.headers['user-agent']
  if (typeof ua === 'string') return ua.slice(0, 256)
  if (Array.isArray(ua) && ua[0]) return ua[0].slice(0, 256)
  return null
}

function toAuditContext(req: AuditReq, user: AuthedUser) {
  return {
    actorId: user.userId,
    actorRole: user.role,
    ipAddress: extractIp(req),
    userAgent: extractUa(req),
    requestId: req.requestId ?? null,
  }
}
