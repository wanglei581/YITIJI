import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Ip, Post, UseGuards } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { Throttle } from '@nestjs/throttler'
import { AuditService } from '../audit/audit.service'
import { revokeIssuedInternalSession } from '../common/auth/internal-session-revocation'
import { ApiResponse } from '../common/dto/api-response.dto'
import { CurrentUser, type AuthedUser } from '../common/decorators/current-user.decorator'
import { Roles } from '../common/decorators/roles.decorator'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { AdminInitialPhoneBindService } from './admin-initial-phone-bind.service'
import { AdminPhoneTransferService, type AdminPhoneTransferStartResult } from './admin-phone-transfer.service'
import { AuthService, type LoginResult } from './auth.service'
import { InitialPhoneBindService } from './initial-phone-bind.service'
import {
  AdminSecondFactorResendDto,
  AdminSecondFactorVerifyDto,
  ChangePasswordDto,
  FirstAdminPasswordChangeDto,
  InitialPhoneBindCancelDto,
  InitialPhoneBindStartDto,
  InitialPhoneBindVerifyDto,
  PasswordResetCompleteDto,
  PasswordResetStartDto,
  PasswordResetVerifyDto,
  SendInternalSmsCodeDto,
  SelfPhoneCodeDto,
  SelfPhoneVerifyDto,
  SmsLoginDto,
} from './dto/internal-auth.dto'
import { LoginDto } from './dto/login.dto'
import { PartnerAccountActionRedisService } from '../common/redis/partner-account-action-redis.service'
import { RedisService } from '../common/redis/redis.service'
import { PrismaService } from '../prisma/prisma.service'
import { partnerPhoneSelfVerifyReady } from './password-proof-state'

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly initialPhoneBindService: InitialPhoneBindService,
    private readonly adminInitialPhoneBindService: AdminInitialPhoneBindService,
    private readonly adminPhoneTransferService: AdminPhoneTransferService,
    private readonly partnerAccountActionRedis: PartnerAccountActionRedisService,
    private readonly redis: RedisService,
    private readonly jwtService: JwtService,
    private readonly audit: AuditService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * 登录限流:每 IP 60 秒内最多 5 次。
   * 防字典爆破 / 密码喷洒攻击。429 由 ThrottlerGuard 自动返回。
   */
  @Post('login')
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  async login(@Body() dto: LoginDto, @Ip() ip: string): Promise<ApiResponse<LoginResult>> {
    const loginId = dto.loginId ?? dto.username
    if (!loginId) {
      throw new BadRequestException({ error: { code: 'VALIDATION_FAILED', message: 'loginId 或 username 必填' } })
    }
    return ApiResponse.ok(await this.authService.login(loginId, dto.password, dto.portal, ip || null))
  }

  /**
   * 管理员登录第二步（P1-4，`ADMIN_LOGIN_SECOND_FACTOR=sms` 时启用）：
   * 密码通过后返回 `{ secondFactorRequired, challengeTicket, phoneMasked, codeSent, cooldownSeconds }`，
   * 前端再拿短信验证码调这里换登录凭证。验证码错误不作废凭证，错满 5 次由短信验证码锁定。
   */
  @Post('login/second-factor')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async completeSecondFactor(
    @Body() dto: AdminSecondFactorVerifyDto,
    @Ip() ip: string,
  ): Promise<ApiResponse<LoginResult>> {
    return ApiResponse.ok(await this.authService.completeAdminSecondFactor(dto.challengeTicket, dto.code, ip || null))
  }

  @Post('login/second-factor/resend')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 3 } })
  async resendSecondFactor(
    @Body() dto: AdminSecondFactorResendDto,
    @Ip() ip: string,
  ): Promise<ApiResponse<{ codeSent: boolean; cooldownSeconds: number }>> {
    return ApiResponse.ok(await this.authService.resendAdminSecondFactor(dto.challengeTicket, ip || null, dto.deviceId))
  }

  @Post('sms-code')
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  async sendSmsCode(
    @Body() dto: SendInternalSmsCodeDto,
    @Ip() ip: string,
  ): Promise<ApiResponse<{ sent: true; cooldownSeconds: number; expiresInSeconds: number }>> {
    return ApiResponse.ok(await this.authService.sendSmsCode(dto, ip))
  }

  @Post('login/sms')
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  async smsLogin(@Body() dto: SmsLoginDto, @Ip() ip: string): Promise<ApiResponse<LoginResult>> {
    return ApiResponse.ok(await this.authService.loginWithSms(dto.phone, dto.code, dto.portal, ip || null))
  }

  @Post('password/reset/start')
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  async startPasswordReset(
    @Body() dto: PasswordResetStartDto,
    @Ip() ip: string,
  ): Promise<ApiResponse<{ sent: true; cooldownSeconds: number; expiresInSeconds: number }>> {
    return ApiResponse.ok(await this.authService.startPasswordReset(dto.loginIdOrPhone, ip))
  }

  @Post('password/reset/verify')
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  async verifyPasswordReset(
    @Body() dto: PasswordResetVerifyDto,
    @Ip() ip: string,
  ): Promise<ApiResponse<{ resetTicket: string; expiresInSeconds: number }>> {
    return ApiResponse.ok(await this.authService.verifyPasswordReset(dto.loginIdOrPhone, dto.code, ip || null))
  }

  @Post('password/reset/complete')
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  async completePasswordReset(@Body() dto: PasswordResetCompleteDto, @Ip() ip: string): Promise<ApiResponse<{ success: true }>> {
    return ApiResponse.ok(await this.authService.completePasswordReset(dto.resetTicket, dto.newPassword, ip || null))
  }

  @Post('password/first-admin-change')
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  async completeFirstAdminPasswordChange(
    @Body() dto: FirstAdminPasswordChangeDto,
  ): Promise<ApiResponse<{ success: true }>> {
    return ApiResponse.ok(
      await this.authService.completeFirstAdminPasswordChange(dto.changeTicket, dto.newPassword),
    )
  }

  @Post('phone/code')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  async sendOwnPhoneCode(
    @CurrentUser() user: AuthedUser,
    @Body() dto: SelfPhoneCodeDto,
    @Ip() ip: string,
  ): Promise<ApiResponse<{ sent: true; cooldownSeconds: number; expiresInSeconds: number }>> {
    return ApiResponse.ok(await this.authService.sendOwnPhoneBindCode(user.userId, ip, dto.deviceId))
  }

  @Post('phone/verify')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  async verifyOwnPhone(
    @CurrentUser() user: AuthedUser,
    @Body() dto: SelfPhoneVerifyDto,
  ): Promise<ApiResponse<{ phoneMasked: string; phoneVerifiedAt: string }>> {
    return ApiResponse.ok(await this.authService.verifyOwnPhoneBindCode(user.userId, dto.code))
  }

  /**
   * 首次绑定专用于尚无 phoneEnc 的已登录内部账号；旧 phone/code 与 phone/verify
   * 仍只服务预录手机号的本人验证，防止候选手机号从旧入口写入。
   */
  @Post('phone/initial-bind/start')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'partner')
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  async startInitialPhoneBind(
    @CurrentUser() user: AuthedUser,
    @Body() dto: InitialPhoneBindStartDto,
    @Ip() ip: string,
  ): Promise<ApiResponse<{ bindTicket: string; cooldownSeconds: number; expiresInSeconds: number }>> {
    if (user.role === 'admin') {
      return ApiResponse.ok(
        await this.adminInitialPhoneBindService.start(user.userId, dto.currentPassword, dto.phone, ip, dto.deviceId),
      )
    }
    if (user.role === 'partner') {
      return ApiResponse.ok(
        await this.initialPhoneBindService.start(user.userId, dto.currentPassword, dto.phone, ip, dto.deviceId),
      )
    }
    throw this.initialPhoneBindUnavailable()
  }

  @Post('phone/initial-bind/verify')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'partner')
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  async verifyInitialPhoneBind(
    @CurrentUser() user: AuthedUser,
    @Body() dto: InitialPhoneBindVerifyDto,
  ): Promise<ApiResponse<{ phoneMasked: string; phoneVerifiedAt: string }>> {
    if (user.role === 'admin') {
      return ApiResponse.ok(await this.adminInitialPhoneBindService.verify(user.userId, dto.bindTicket, dto.code))
    }
    if (user.role === 'partner') {
      return ApiResponse.ok(await this.initialPhoneBindService.verify(user.userId, dto.bindTicket, dto.code))
    }
    throw this.initialPhoneBindUnavailable()
  }

  @Post('admin/phone/initial-bind/start')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  async startAdminInitialPhoneBind(
    @CurrentUser() user: AuthedUser,
    @Body() dto: InitialPhoneBindStartDto,
    @Ip() ip: string,
  ): Promise<ApiResponse<{ bindTicket: string; cooldownSeconds: number; expiresInSeconds: number }>> {
    return ApiResponse.ok(
      await this.adminInitialPhoneBindService.start(user.userId, dto.currentPassword, dto.phone, ip, dto.deviceId),
    )
  }

  @Post('admin/phone/initial-bind/verify')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  async verifyAdminInitialPhoneBind(
    @CurrentUser() user: AuthedUser,
    @Body() dto: InitialPhoneBindVerifyDto,
  ): Promise<ApiResponse<{ phoneMasked: string; phoneVerifiedAt: string }>> {
    return ApiResponse.ok(await this.adminInitialPhoneBindService.verify(user.userId, dto.bindTicket, dto.code))
  }

  @Post('admin/phone/initial-bind/cancel')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  async cancelAdminInitialPhoneBind(
    @CurrentUser() user: AuthedUser,
    @Body() dto: InitialPhoneBindCancelDto,
  ): Promise<ApiResponse<{ cancelled: true }>> {
    return ApiResponse.ok(await this.adminInitialPhoneBindService.cancel(user.userId, dto.bindTicket))
  }

  @Post('admin/phone/transfer/start')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  async startAdminPhoneTransfer(
    @CurrentUser() user: AuthedUser,
    @Body() dto: InitialPhoneBindStartDto,
    @Ip() ip: string,
  ): Promise<ApiResponse<AdminPhoneTransferStartResult>> {
    return ApiResponse.ok(
      await this.adminPhoneTransferService.start(user.userId, dto.currentPassword, dto.phone, ip, dto.deviceId),
    )
  }

  @Post('admin/phone/transfer/verify')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  async verifyAdminPhoneTransfer(
    @CurrentUser() user: AuthedUser,
    @Body() dto: InitialPhoneBindVerifyDto,
  ): Promise<ApiResponse<{ phoneMasked: string; phoneVerifiedAt: string }>> {
    return ApiResponse.ok(await this.adminPhoneTransferService.verify(user.userId, dto.bindTicket, dto.code))
  }

  @Post('admin/phone/transfer/cancel')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  async cancelAdminPhoneTransfer(
    @CurrentUser() user: AuthedUser,
    @Body() dto: InitialPhoneBindCancelDto,
  ): Promise<ApiResponse<{ cancelled: true }>> {
    return ApiResponse.ok(await this.adminPhoneTransferService.cancel(user.userId, dto.bindTicket))
  }

  /** 登录态自助改密:须提供当前密码校验身份,成功后旧 token 立即失效,需重新登录。 */
  @Post('password/change')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'partner')
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  async changePassword(
    @CurrentUser() user: AuthedUser,
    @Body() dto: ChangePasswordDto,
  ): Promise<ApiResponse<{ success: true }>> {
    return ApiResponse.ok(await this.authService.changePassword(user.userId, dto.currentPassword, dto.newPassword))
  }

  /** 校验 token 是否有效并回显当前用户(前端 boot 时常用) */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@CurrentUser() user: AuthedUser): Promise<ApiResponse<Omit<AuthedUser, 'sessionId'> & { phoneSelfVerifyReady: boolean }>> {
    const current = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.userId }, select: { role: true, passwordProofState: true },
    })
    return ApiResponse.ok({
      userId: user.userId, role: user.role, orgId: user.orgId,
      phoneSelfVerifyReady: partnerPhoneSelfVerifyReady(current.role, current.passwordProofState),
    })
  }

  /**
   * 撤销当前 jti。名单写入失败时不返回成功。
   * 管理员再清掉这份凭证上的近期高风险验证。客户端仍须清掉本地 token。
   * 没有 jti 的旧凭证撤不了名单，只受 tokenVersion 与过期时间约束。
   */
  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  async logout(
    @CurrentUser() user: AuthedUser,
    @Headers('authorization') authorization?: string,
  ): Promise<ApiResponse<{ loggedOut: true }>> {
    await revokeIssuedInternalSession(authorization, this.jwtService, this.redis)
    if (user.role === 'admin' && user.sessionId) {
      await this.partnerAccountActionRedis.clearAdminRecentVerification(user.userId, user.sessionId)
    }
    await this.audit.write({
      actorId: user.userId,
      actorRole: user.role,
      action: 'auth.logout',
      targetType: 'auth',
      targetId: user.userId,
      payload: { scope: 'current_session' },
    })
    return ApiResponse.ok({ loggedOut: true })
  }

  private initialPhoneBindUnavailable(): BadRequestException {
    return new BadRequestException({
      error: { code: 'AUTH_INITIAL_PHONE_BIND_UNAVAILABLE', message: '当前账号暂不可进行首次手机号绑定' },
    })
  }
}
