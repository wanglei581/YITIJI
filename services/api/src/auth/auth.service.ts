import { Injectable, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import * as bcrypt from 'bcryptjs'
import { PrismaService } from '../prisma/prisma.service'
import type { UserRole } from '../common/decorators/roles.decorator'

export interface LoginResult {
  token: string
  user: {
    id:    string
    name:  string
    role:  UserRole
    orgId: string | null
  }
}

/**
 * 0b 起改为 prisma.user.findUnique + bcryptjs.compare。
 * 失败原因(用户不存在 / 密码错 / 账号停用 / role 非法)对外统一返回同一个错误码,
 * 避免攻击者通过错误信息探测账号是否存在。
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async login(username: string, password: string): Promise<LoginResult> {
    const user = await this.prisma.user.findUnique({ where: { username } })
    if (!user || !user.enabled) {
      throw this.loginFailed()
    }

    const ok = await bcrypt.compare(password, user.passwordHash)
    if (!ok) {
      throw this.loginFailed()
    }

    const role = user.role as UserRole
    if (role !== 'admin' && role !== 'partner' && role !== 'kiosk') {
      throw this.loginFailed()
    }

    // 阶段1B:机构授权停用 → 该机构 partner 账号一并禁止登录
    // (与 jobs.service 导入路径的 org.enabled 校验形成登录 + 写入双闸)。
    if (role === 'partner') {
      if (!user.orgId) throw this.loginFailed()
      const org = await this.prisma.organization.findUnique({ where: { id: user.orgId } })
      if (!org || !org.enabled) throw this.loginFailed()
    }

    const token = this.jwtService.sign({
      sub:   user.id,
      role,
      orgId: user.orgId,
    })

    return {
      token,
      user: {
        id:    user.id,
        name:  user.name,
        role,
        orgId: user.orgId,
      },
    }
  }

  private loginFailed(): UnauthorizedException {
    return new UnauthorizedException({
      error: { code: 'AUTH_LOGIN_FAILED', message: '用户名或密码不正确' },
    })
  }
}
