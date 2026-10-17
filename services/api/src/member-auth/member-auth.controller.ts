import { Body, Controller, Get, Header, Headers, Param, Post, Req, UnauthorizedException, UseGuards } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import type { Request } from 'express'
import { CurrentEndUser, type AuthedEndUser } from '../common/decorators/current-end-user.decorator'
import { EndUserAuthGuard } from '../common/guards/end-user-auth.guard'
import { ApiResponse } from '../common/dto/api-response.dto'
import { MemberLoginDto } from './dto/member-login.dto'
import { MemberRestoreDto } from './dto/member-restore.dto'
import { PhoneRebindDto } from './dto/phone-rebind.dto'
import { SendMemberStepUpCodeDto, VerifyMemberStepUpDto } from './dto/member-step-up.dto'
import { ClaimQrLoginDto, ConfirmQrLoginDto, CreateQrLoginDto } from './dto/qr-login.dto'
import { SendSmsCodeDto } from './dto/send-sms-code.dto'
import { WxMiniappLoginDto } from './dto/wx-miniapp-login.dto'
import { WxMiniappResigninDto } from './dto/wx-miniapp-resignin.dto'
import {
  MemberAuthService,
  type MemberAuthUser,
  type MemberLoginResult,
  type SendCodeResult,
} from './member-auth.service'
import { MemberPhoneRebindService, type PhoneRebindResult } from './member-phone-rebind.service'
import { MemberRestoreService, type MemberRestoreResult } from './member-restore.service'
import {
  MemberQrLoginService,
  type ConfirmQrLoginResult,
  type CreateQrLoginResult,
  type QrLoginStatusResult,
} from './member-qr-login.service'
import {
  MemberStepUpService,
  type SendStepUpChallengeResult,
  type VerifyStepUpChallengeResult,
} from './member-step-up.service'

import { resolveClientIpOrUnknown } from '../common/client-ip'
import { TerminalSessionService } from '../terminals/terminal-session.service'
import { SmsCodeThrottle } from './sms/sms-code-throttle'
/**
 * 只使用 Express 解析后的客户端 IP。
 * 默认不信任客户端直传的 X-Forwarded-For；若生产经反代，必须在应用入口显式配置可信代理后，
 * 由 Express 根据可信链路填充 req.ip，控制器不得自行解析未受信请求头。
 */
function clientIp(req: Request): string {
  return resolveClientIpOrUnknown(req)
}

/**
 * 请求是不是来自本小程序（FLOW1c 签发恢复凭证的前提之一）。微信官方文档：小程序网络请求的 referer
 * 不可设置，格式固定为 https://servicewechat.com/{appid}/{version}/page-frame.html。浏览器里的页面脚本
 * 也不能把 Referer 设成别的站点，所以一体机拿不到。没配 WECHAT_MINIAPP_APPID 时一律不认。
 */
function isOwnMiniappReferer(referer: string | undefined): boolean {
  const appid = process.env['WECHAT_MINIAPP_APPID']?.trim()
  if (!appid || !referer) return false
  const escaped = appid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^https://servicewechat\\.com/${escaped}/[^/]+/page-frame\\.html$`).test(referer)
}

/**
 * C 端求职者账号接口(阶段 A)。路由前缀 /api/v1/member/*。
 * 与内部 /api/v1/auth/* 完全隔离;受 EndUserAuthGuard 保护的接口拒绝内部 token。
 */
@Controller('member')
export class MemberAuthController {
  constructor(
    private readonly service: MemberAuthService,
    private readonly qrLogin: MemberQrLoginService,
    private readonly stepUp: MemberStepUpService,
    private readonly phoneRebind: MemberPhoneRebindService,
    private readonly terminalSessions: TerminalSessionService,
    private readonly restore: MemberRestoreService,
  ) {}

  /**
   * 显式登录时是否同时签发同设备恢复凭证（FLOW1c）。三条同时成立才签：
   * 客户端要（x-member-keep-signed-in: 1）、不是一体机终端请求（不带 x-terminal-id）、Referer 是本小程序。
   * 意愿用请求头而不是请求体字段：旧版 API 会忽略不认识的请求头，不会因为白名单校验回 400。
   */
  private wantsRestore(req: Request): boolean {
    if (req.header('x-member-keep-signed-in') !== '1') return false
    if (req.header('x-terminal-id')) return false
    return isOwnMiniappReferer(req.header('referer'))
  }

  /** 登录成功后按需附上恢复凭证。签发失败不影响这次登录：只是这台手机 30 分钟后要再登录一次。 */
  private async withRestore(req: Request, result: MemberLoginResult): Promise<MemberLoginResult & { restoreToken?: string }> {
    if (!this.wantsRestore(req)) return result
    try {
      return { ...result, restoreToken: await this.restore.issue(result.user.id) }
    } catch {
      return result
    }
  }

  /**
   * 发送验证码。细粒度多维频控在 service 内走 Redis。
   * 带已验签终端时：每分钟 5 次、每小时 30 条都按这台终端计，不占 IP 桶。
   * 不带终端，或终端验签失败：仍按 IP 计。验签失败的请求在这里直接拒绝。
   * 带了终端编号却验不过签的一律拒绝——否则谁都能冒用某台一体机的编号把它当天的额度刷光。
   */
  @Post('auth/sms-code')
  @SmsCodeThrottle()
  async sendSmsCode(@Body() dto: SendSmsCodeDto, @Req() req: Request): Promise<ApiResponse<SendCodeResult>> {
    const terminalId = await this.verifiedTerminalId(req)
    return ApiResponse.ok(await this.service.sendSmsCode(dto.phone, dto.deviceId, clientIp(req), terminalId))
  }

  private async verifiedTerminalId(req: Request): Promise<string | null> {
    const terminalId = req.header('x-terminal-id')?.trim()
    if (!terminalId) return null
    await this.terminalSessions.validate(terminalId, req.header('x-terminal-session-token'))
    return terminalId
  }

  /** 手机号 + 验证码登录。 */
  @Post('auth/login')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async login(@Body() dto: MemberLoginDto, @Req() req: Request): Promise<ApiResponse<MemberLoginResult>> {
    const result = await this.service.login(dto.phone, dto.code, dto.deviceId, clientIp(req), {
      termsVersion: dto.termsVersion,
      privacyVersion: dto.privacyVersion,
    })
    return ApiResponse.ok(await this.withRestore(req, result))
  }

  /** 微信小程序一键登录（getPhoneNumber 授权）。appSecret 全程服务端持有，不经前端。 */
  @Post('auth/wx-login')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async wxLogin(@Body() dto: WxMiniappLoginDto, @Req() req: Request): Promise<ApiResponse<MemberLoginResult>> {
    const result = await this.service.wxLogin(
      dto.code,
      dto.phoneCode,
      { termsVersion: dto.termsVersion, privacyVersion: dto.privacyVersion },
      clientIp(req),
    )
    return ApiResponse.ok(await this.withRestore(req, result))
  }

  /**
   * 已绑定微信的会员凭 wx.login code 静默续签。
   * 不建号、不绑手机；未绑定走 401 MEMBER_NOT_BOUND，让小程序进正常登录。
   */
  /**
   * 同设备恢复（FLOW1c）：访问令牌失效后，凭恢复凭证换一枚新的（同一位会员），并换新恢复凭证。
   * 只认本小程序发来的请求；无效、过期、重放、账号不可用都要重新登录。
   */
  @Post('auth/restore')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async restoreSession(@Body() dto: MemberRestoreDto, @Req() req: Request): Promise<ApiResponse<MemberRestoreResult>> {
    if (!isOwnMiniappReferer(req.header('referer'))) {
      throw new UnauthorizedException({ error: { code: 'MEMBER_RESTORE_INVALID', message: '登录已过期，请重新登录' } })
    }
    return ApiResponse.ok(await this.restore.restore(dto.restoreToken))
  }

  /** 主动退出时作废这台手机的恢复凭证。不要求访问令牌：退出时它可能已经过期。凭证不存在也回成功。 */
  @Post('auth/restore/revoke')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async revokeRestore(@Body() dto: MemberRestoreDto): Promise<ApiResponse<{ revoked: true }>> {
    await this.restore.revokeByToken(dto.restoreToken)
    return ApiResponse.ok({ revoked: true })
  }

  @Post('auth/wx-resignin')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async wxResignin(@Body() dto: WxMiniappResigninDto): Promise<ApiResponse<MemberLoginResult>> {
    return ApiResponse.ok(await this.service.wxResignin(dto.code))
  }

  /** 已登录会员为数据导出/账号注销等敏感动作发送二次验证短信。 */
  @Post('auth/step-up/sms-code')
  @UseGuards(EndUserAuthGuard)
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Header('Cache-Control', 'no-store')
  async sendStepUpCode(
    @CurrentEndUser() user: AuthedEndUser,
    @Body() dto: SendMemberStepUpCodeDto,
    @Req() req: Request,
  ): Promise<ApiResponse<SendStepUpChallengeResult>> {
    return ApiResponse.ok(await this.stepUp.sendChallenge(user.endUserId, {
      action: dto.action,
      deviceId: dto.deviceId,
      ip: clientIp(req),
    }))
  }

  /** 校验二次验证码并签发短时、单次、动作绑定的 opaque grant。 */
  @Post('auth/step-up/verify')
  @UseGuards(EndUserAuthGuard)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Header('Cache-Control', 'no-store')
  async verifyStepUp(
    @CurrentEndUser() user: AuthedEndUser,
    @Body() dto: VerifyMemberStepUpDto,
  ): Promise<ApiResponse<VerifyStepUpChallengeResult>> {
    return ApiResponse.ok(await this.stepUp.verifyChallenge(user.endUserId, dto))
  }

  /** Kiosk 创建 QR 登录票据。claimToken 只返回给一体机,不进入二维码 URL。 */
  @Post('auth/qr/create')
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  async createQrLogin(
    @Body() dto: CreateQrLoginDto,
    @Headers('authorization') auth: string | undefined,
    @Headers('x-terminal-id') terminalId: string | undefined,
  ): Promise<ApiResponse<CreateQrLoginResult>> {
    return ApiResponse.ok(await this.qrLogin.create(dto, terminalId, auth))
  }

  /** 手机端扫码后读取票据状态与设备展示信息。 */
  @Get('auth/qr/:ticketId/status')
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  async qrLoginStatus(@Param('ticketId') ticketId: string): Promise<ApiResponse<QrLoginStatusResult>> {
    return ApiResponse.ok(await this.qrLogin.status(ticketId))
  }

  /** 手机端用短信验证码确认票据,但不直接把会员 token 暴露给手机确认页。 */
  @Post('auth/qr/:ticketId/confirm')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async confirmQrLogin(
    @Param('ticketId') ticketId: string,
    @Body() dto: ConfirmQrLoginDto,
  ): Promise<ApiResponse<ConfirmQrLoginResult>> {
    return ApiResponse.ok(await this.qrLogin.confirm(ticketId, dto))
  }

  /** 小程序已登录用户扫码后直接凭 JWT 确认票据，无需再发短信验证码。 */
  @Post('auth/qr/:ticketId/confirm-by-token')
  @UseGuards(EndUserAuthGuard)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async confirmQrLoginByToken(
    @Param('ticketId') ticketId: string,
    @CurrentEndUser() user: AuthedEndUser,
  ): Promise<ApiResponse<ConfirmQrLoginResult>> {
    return ApiResponse.ok(await this.qrLogin.confirmByToken(ticketId, user.endUserId))
  }

  /** Kiosk 使用私有 claimToken 一次性领取会员 token。 */
  @Post('auth/qr/:ticketId/claim')
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  async claimQrLogin(
    @Param('ticketId') ticketId: string,
    @Body() dto: ClaimQrLoginDto,
    @Headers('authorization') auth: string | undefined,
    @Headers('x-terminal-id') terminalId: string | undefined,
  ): Promise<ApiResponse<MemberLoginResult>> {
    return ApiResponse.ok(await this.qrLogin.claim(ticketId, dto.claimToken, terminalId, auth))
  }

  /** 登出:删除 Redis 会话。前端空闲超时登出也调用此接口。 */
  @Post('auth/logout')
  @UseGuards(EndUserAuthGuard)
  async logout(@CurrentEndUser() user: AuthedEndUser): Promise<ApiResponse<{ loggedOut: true }>> {
    await this.service.logout(user.endUserId, user.sessionId)
    return ApiResponse.ok({ loggedOut: true })
  }

  /**
   * 手机号换绑（Wave 2）。
   *
   * 前置：
   *   1. 旧号 step-up: POST /member/auth/step-up/sms-code { action: "phone_rebind" }
   *   2. 旧号验证:      POST /member/auth/step-up/verify → stepUpToken
   *   3. 新号验证码:    POST /member/auth/sms-code { phone: newPhone }
   * 本接口：POST /member/phone/rebind { stepUpToken, newPhone, newPhoneCode }
   *
   * 成功后所有旧会话立即失效，前端应清除内存 token 并提示用新号重新登录。
   */
  @Post('phone/rebind')
  @UseGuards(EndUserAuthGuard)
  @Throttle({ default: { ttl: 60_000, limit: 3 } })
  @Header('Cache-Control', 'no-store')
  async rebindPhone(
    @CurrentEndUser() user: AuthedEndUser,
    @Body() dto: PhoneRebindDto,
  ): Promise<ApiResponse<PhoneRebindResult>> {
    return ApiResponse.ok(
      await this.phoneRebind.rebind(
        user.endUserId,
        dto.stepUpToken,
        dto.newPhone,
        dto.newPhoneCode,
        dto.deviceId,
      ),
    )
  }

  /** 当前登录用户(前端 boot / 刷新时校验会话)。 */
  @Get('me')
  @UseGuards(EndUserAuthGuard)
  async me(@CurrentEndUser() user: AuthedEndUser): Promise<ApiResponse<MemberAuthUser>> {
    return ApiResponse.ok(await this.service.me(user.endUserId))
  }
}
