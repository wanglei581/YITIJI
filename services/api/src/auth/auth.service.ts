import { Injectable, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import type { UserRole } from '../common/decorators/roles.decorator'

interface DevUser {
  userId:   string
  username: string
  password: string
  role:     UserRole
  orgId:    string | null
  name:     string
}

/**
 * 0a 阶段:登录账户用硬编码。
 * 0b 阶段会替换为 prisma.user.findUnique + bcrypt 比对,
 * 这里保持同样的 LoginResult 形状,前端 adapter 不用改。
 */
const DEV_USERS: DevUser[] = [
  { userId: 'u-admin',    username: 'admin',    password: 'admin',    role: 'admin',   orgId: null,          name: '系统管理员' },
  { userId: 'u-partner1', username: 'partner1', password: 'partner1', role: 'partner', orgId: 'org-uni-001', name: '高校就业指导中心' },
  { userId: 'u-partner2', username: 'partner2', password: 'partner2', role: 'partner', orgId: 'org-hr-002',  name: '市人才交流中心' },
]

export interface LoginResult {
  token: string
  user: {
    id:    string
    name:  string
    role:  UserRole
    orgId: string | null
  }
}

@Injectable()
export class AuthService {
  constructor(private readonly jwtService: JwtService) {}

  login(username: string, password: string): LoginResult {
    const user = DEV_USERS.find((u) => u.username === username && u.password === password)
    if (!user) {
      throw new UnauthorizedException({
        error: { code: 'AUTH_LOGIN_FAILED', message: '用户名或密码不正确' },
      })
    }

    const token = this.jwtService.sign({
      sub:   user.userId,
      role:  user.role,
      orgId: user.orgId,
    })

    return {
      token,
      user: {
        id:    user.userId,
        name:  user.name,
        role:  user.role,
        orgId: user.orgId,
      },
    }
  }
}
