import { BadRequestException, Body, Controller, Get, Ip, Post, UseGuards } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { ApiResponse } from '../common/dto/api-response.dto'
import { CurrentUser, type AuthedUser } from '../common/decorators/current-user.decorator'
import { Roles } from '../common/decorators/roles.decorator'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { AuthService, type LoginResult } from './auth.service'
import {
  ChangePasswordDto,
  PasswordResetCompleteDto,
  PasswordResetStartDto,
  PasswordResetVerifyDto,
  SendInternalSmsCodeDto,
  SelfPhoneCodeDto,
  SelfPhoneVerifyDto,
  SmsLoginDto,
} from './dto/internal-auth.dto'
import { LoginDto } from './dto/login.dto'

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * 登录限流:每 IP 60 秒内最多 5 次。
   * 防字典爆破 / 密码喷洒攻击。429 由 ThrottlerGuard 自动返回。
   */
  @Post('login')
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  async login(@Body() dto: LoginDto): Promise<ApiResponse<LoginResult>> {
    const loginId = dto.loginId ?? dto.username
    if (!loginId) {
      throw new BadRequestException({ error: { code: 'VALIDATION_FAILED', message: 'loginId 或 username 必填' } })
    }
    return ApiResponse.ok(await this.authService.login(loginId, dto.password, dto.portal))
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
  async smsLogin(@Body() dto: SmsLoginDto): Promise<ApiResponse<LoginResult>> {
    return ApiResponse.ok(await this.authService.loginWithSms(dto.phone, dto.code, dto.portal))
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
  ): Promise<ApiResponse<{ resetTicket: string; expiresInSeconds: number }>> {
    return ApiResponse.ok(await this.authService.verifyPasswordReset(dto.loginIdOrPhone, dto.code))
  }

  @Post('password/reset/complete')
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  async completePasswordReset(@Body() dto: PasswordResetCompleteDto): Promise<ApiResponse<{ success: true }>> {
    return ApiResponse.ok(await this.authService.completePasswordReset(dto.resetTicket, dto.newPassword))
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
  me(@CurrentUser() user: AuthedUser): ApiResponse<AuthedUser> {
    return ApiResponse.ok(user)
  }
}
