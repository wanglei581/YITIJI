import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import type { Request } from 'express'
import { CurrentEndUser, type AuthedEndUser } from '../common/decorators/current-end-user.decorator'
import { EndUserAuthGuard } from '../common/guards/end-user-auth.guard'
import { ApiResponse } from '../common/dto/api-response.dto'
import { MemberLoginDto } from './dto/member-login.dto'
import { SendSmsCodeDto } from './dto/send-sms-code.dto'
import {
  MemberAuthService,
  type MemberAuthUser,
  type MemberLoginResult,
  type SendCodeResult,
} from './member-auth.service'

/** 取客户端 IP(一体机可能经反代,优先 X-Forwarded-For 首段)。 */
function clientIp(req: Request): string {
  const xff = req.headers['x-forwarded-for']
  const first = Array.isArray(xff) ? xff[0] : xff?.split(',')[0]
  return (first?.trim() || req.ip || req.socket.remoteAddress || 'unknown')
}

/**
 * C 端求职者账号接口(阶段 A)。路由前缀 /api/v1/member/*。
 * 与内部 /api/v1/auth/* 完全隔离;受 EndUserAuthGuard 保护的接口拒绝内部 token。
 */
@Controller('member')
export class MemberAuthController {
  constructor(private readonly service: MemberAuthService) {}

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

  /** 登出:删除 Redis 会话。前端空闲超时登出也调用此接口。 */
  @Post('auth/logout')
  @UseGuards(EndUserAuthGuard)
  async logout(@CurrentEndUser() user: AuthedEndUser): Promise<ApiResponse<{ loggedOut: true }>> {
    await this.service.logout(user.sessionId)
    return ApiResponse.ok({ loggedOut: true })
  }

  /** 当前登录用户(前端 boot / 刷新时校验会话)。 */
  @Get('me')
  @UseGuards(EndUserAuthGuard)
  async me(@CurrentEndUser() user: AuthedEndUser): Promise<ApiResponse<MemberAuthUser>> {
    return ApiResponse.ok(await this.service.me(user.endUserId))
  }
}
