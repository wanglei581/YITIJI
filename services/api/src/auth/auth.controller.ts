import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common'
import { ApiResponse } from '../common/dto/api-response.dto'
import { CurrentUser, type AuthedUser } from '../common/decorators/current-user.decorator'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { AuthService, type LoginResult } from './auth.service'
import { LoginDto } from './dto/login.dto'

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  async login(@Body() dto: LoginDto): Promise<ApiResponse<LoginResult>> {
    return ApiResponse.ok(await this.authService.login(dto.username, dto.password))
  }

  /** 校验 token 是否有效并回显当前用户(前端 boot 时常用) */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthedUser): ApiResponse<AuthedUser> {
    return ApiResponse.ok(user)
  }
}
