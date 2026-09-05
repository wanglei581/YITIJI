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
import type { Request, Response } from 'express'
import { CurrentUser, type AuthedUser } from '../common/decorators/current-user.decorator'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { Roles } from '../common/decorators/roles.decorator'
import { AuditService } from '../audit/audit.service'
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
    private readonly audit: AuditService,
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
    })
    await this.writeAudit(req, user, 'ad_asset.upload', 'ad_asset', asset.id, {
      type: asset.type,
      title: asset.title,
      sizeBytes: asset.sizeBytes,
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
    })
    await this.writeAudit(req, user, 'ad_asset.create_external', 'ad_asset', asset.id, {
      type: asset.type,
      title: asset.title,
      externalUrl: asset.externalUrl,
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
    const asset = await this.content.updateAsset(id, dto)
    await this.writeAudit(req, user, 'ad_asset.update', 'ad_asset', id, { ...dto })
    return asset
  }

  @Delete('admin/ad-assets/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async deleteAsset(@Param('id') id: string, @CurrentUser() user: AuthedUser, @Req() req: AuditReq) {
    const asset = await this.content.deleteAsset(id)
    await this.writeAudit(req, user, 'ad_asset.delete', 'ad_asset', id, { title: asset.title })
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
    })
    await this.writeAudit(req, user, 'ad_playlist.create', 'ad_playlist', playlist.id, {
      name: playlist.name,
      itemCount: playlist.itemCount,
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
    const playlist = await this.content.updatePlaylist(id, { name: dto.name, status: dto.status, items: dto.items })
    await this.writeAudit(req, user, 'ad_playlist.update', 'ad_playlist', id, {
      name: playlist.name,
      itemCount: playlist.itemCount,
    })
    return playlist
  }

  @Delete('admin/ad-playlists/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  async deletePlaylist(@Param('id') id: string, @CurrentUser() user: AuthedUser, @Req() req: AuditReq) {
    await this.content.deletePlaylist(id)
    await this.writeAudit(req, user, 'ad_playlist.delete', 'ad_playlist', id, {})
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
    )
    await this.writeAudit(req, user, 'screensaver_config.update', 'screensaver_config', terminalId, {
      enabled: config.enabled,
      idleTimeoutSec: config.idleTimeoutSec,
      playlistId: config.playlistId,
    })
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
    const { buffer, mimeType } = await this.content.readAssetContent(id)
    // Admin/Kiosk dev server 与 API 分端口运行,签名素材需要允许跨 origin 作为 <img>/<video> 嵌入。
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
    // 屏保素材可被 Kiosk 长缓存(内容不可变,内容变了会换新 id)
    res.setHeader('Cache-Control', 'public, max-age=3600')
    res.setHeader('Content-Type', mimeType)
    // 这个头此前就一直在发，但实现从不理会 Range —— 无论请求什么区间都回 200 + 全量。
    // 对 <video> 的后果是拖不动进度条（浏览器认为服务端支持 seek，实际拿不到区间），
    // 属 §9「不伪造能力」：宣称的能力必须真的有。下面把它兑现。
    res.setHeader('Accept-Ranges', 'bytes')

    const rangeHeader = req.headers.range
    const range = parseByteRange(typeof rangeHeader === 'string' ? rangeHeader : undefined, buffer.length)
    if (rangeHeader && !range) {
      // 带了 Range 但不可满足：必须 416 并回带真实总长，不能假装成功回全量。
      res.setHeader('Content-Range', `bytes */${buffer.length}`)
      res.status(HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
      res.end()
      return
    }
    if (range) {
      const slice = buffer.subarray(range.start, range.end + 1)
      res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${buffer.length}`)
      res.setHeader('Content-Length', slice.length)
      res.status(HttpStatus.PARTIAL_CONTENT)
      res.send(slice)
      return
    }
    res.setHeader('Content-Length', buffer.length)
    res.send(buffer)
  }

  // ── 审计 helper ──────────────────────────────────────────────────────────

  private async writeAudit(
    req: AuditReq,
    user: AuthedUser,
    action: string,
    targetType: string,
    targetId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.write({
      actorId: user.userId,
      actorRole: user.role,
      action,
      targetType,
      targetId,
      payload,
      ipAddress: extractIp(req),
      userAgent: extractUa(req),
      requestId: req.requestId ?? null,
    })
  }
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

/**
 * 解析 HTTP Range 请求头，返回闭区间 [start, end]（含端点），不可满足时返回 null。
 *
 * 只接受单区间的 `bytes=` 形式——多区间（`bytes=0-9,20-29`）需要 multipart/byteranges
 * 响应，我们不支持，按不可满足处理并回 416，而不是悄悄只给第一段。
 *
 * 三种写法：
 *   bytes=2-5   → [2,5]
 *   bytes=5-    → [5, size-1]
 *   bytes=-5    → 最后 5 字节
 */
export function parseByteRange(raw: string | undefined, size: number): { start: number; end: number } | null {
  if (!raw || size <= 0) return null
  const match = raw.match(/^bytes=(\d*)-(\d*)$/)
  if (!match) return null
  const startRaw = match[1]
  const endRaw = match[2]
  if (!startRaw && !endRaw) return null
  let start: number
  let end: number
  if (!startRaw) {
    // 后缀区间：bytes=-N 表示最后 N 字节。N 大于总长时收敛到整个文件，而不是报错。
    const suffix = Number(endRaw)
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(startRaw)
    if (!Number.isSafeInteger(start) || start < 0 || start >= size) return null
    end = endRaw ? Number(endRaw) : size - 1
    if (!Number.isSafeInteger(end) || end < start) return null
    if (end >= size) end = size - 1
  }
  return { start, end }
}
