import { Controller, Get, Header, Headers, NotFoundException, Param, Req, Res } from '@nestjs/common'
import type { Request, Response } from 'express'
import { TerminalScopedThrottle } from '../common/throttler/terminal-throttle'
import { BrandLogoService } from './brand-logo.service'
import { BrandingService } from './branding.service'
import { KioskProfileService } from './kiosk-profile.service'

/**
 * 公开读取（不登录）：
 *   GET /api/v1/public/brand               平台默认品牌（不带终端），两个后台的登录页与标题用
 *   GET /api/v1/public/kiosk-profile       一体机：品牌、点位名、备案、授权状态；只认已验签终端（见 KioskProfileService）
 *   GET /api/v1/public/brand-logo/:assetId Logo 图片本体，只认 BrandLogo 表，别的素材读不到
 */
@Controller('public')
export class BrandingPublicController {
  constructor(
    private readonly branding: BrandingService,
    private readonly profiles: KioskProfileService,
    private readonly logos: BrandLogoService,
  ) {}

  @Get('brand')
  @Header('Cache-Control', 'public, max-age=60')
  async brand() {
    return { success: true as const, data: await this.branding.getPublicBrand() }
  }

  // 响应因终端而异，且含授权状态，绝不能被共享缓存。
  @Get('kiosk-profile')
  @TerminalScopedThrottle(30)
  @Header('Cache-Control', 'private, no-store')
  async kioskProfile(
    @Headers('x-terminal-id') terminalId?: string,
    @Headers('x-terminal-session-token') sessionToken?: string,
  ) {
    return { success: true as const, data: await this.profiles.get(terminalId, sessionToken) }
  }

  @Get('brand-logo/:assetId')
  async logo(@Param('assetId') assetId: string, @Req() req: Request, @Res() res: Response): Promise<void> {
    const logo = await this.logos.readPublic(assetId)
    if (!logo) throw new NotFoundException({ error: { code: 'BRAND_LOGO_NOT_FOUND', message: 'Logo 不存在' } })
    const etag = `"${logo.sha256}"`
    // 内容按编号不可变（换图 = 新编号）；浏览器 <img> 跨域嵌入要 cross-origin。
    res.setHeader('Content-Type', logo.mimeType)
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox")
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
    res.setHeader('Cache-Control', 'public, max-age=3600')
    res.setHeader('ETag', etag)
    if (req.headers['if-none-match'] === etag) {
      res.status(304).end()
      return
    }
    res.setHeader('Content-Length', logo.buffer.length)
    res.status(200).send(logo.buffer)
  }
}
