import { Body, Controller, Get, Header, Headers, Param, Post, Req, UseGuards } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import type { Request } from 'express'
import { CurrentEndUser, type AuthedEndUser } from '../common/decorators/current-end-user.decorator'
import { EndUserAuthGuard } from '../common/guards/end-user-auth.guard'
import { ApiResponse } from '../common/dto/api-response.dto'
import { MemberLoginDto } from './dto/member-login.dto'
import { PhoneRebindDto } from './dto/phone-rebind.dto'
import { SendMemberStepUpCodeDto, VerifyMemberStepUpDto } from './dto/member-step-up.dto'
import { ClaimQrLoginDto, ConfirmQrLoginDto, CreateQrLoginDto } from './dto/qr-login.dto'
import { SendSmsCodeDto } from './dto/send-sms-code.dto'
import {
  MemberAuthService,
  type MemberAuthUser,
  type MemberLoginResult,
  type SendCodeResult,
} from './member-auth.service'
import { MemberPhoneRebindService, type PhoneRebindResult } from './member-phone-rebind.service'
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

/**
 * 只使用 Express 解析后的客户端 IP。
 * 默认不信任客户端直传的 X-Forwarded-For；若生产经反代，必须在应用入口显式配置可信代理后，
 * 由 Express 根据可信链路填充 req.ip，控制器不得自行解析未受信请求头。
 */
function clientIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown'
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
  ) {}

  /** 发送验证码。IP 维度再加一层粗限流(细粒度多维频控在 service 内走 Redis)。 */
  @Post('auth/sms-code')
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  async sendSmsCode(@Body() dto: SendSmsCodeDto, @Req() req: Request): Promise<ApiResponse<SendCodeResult>> {
    return ApiResponse.ok(await this.service.sendSmsCode(dto.phone, dto.deviceId, clientIp(req)))
  }

  /** 手机号 + 验证码登录。 */
  @Post('auth/login')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async login(@Body() dto: MemberLoginDto, @Req() req: Request): Promise<ApiResponse<MemberLoginResult>> {
    return ApiResponse.ok(await this.service.login(dto.phone, dto.code, dto.deviceId, clientIp(req)))
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
