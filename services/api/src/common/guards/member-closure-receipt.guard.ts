import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import type { Request } from 'express'

interface ClosureReceiptJwtPayload {
  sub?: unknown
  jti?: unknown
}

interface ClosureReceiptSubject {
  endUserId: string
}

/**
 * 注销回执的窄授权验签层。
 *
 * 注销受理后普通会员 session 会被撤销，账户也会进入 closing/anonymized，
 * 因此这里只校验原 JWT 本身，不查询 Redis 或数据库。后续回执服务仍须用
 * sub + 原 Idempotency-Key + requestType=delete 精确匹配工单。
 */
@Injectable()
export class MemberClosureReceiptGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & {
      closureReceiptSubject?: ClosureReceiptSubject
    }>()
    const header = req.headers.authorization
    if (!header || !header.toLowerCase().startsWith('bearer ')) {
      throw this.unauthorized('MEMBER_MISSING_TOKEN', '缺少登录凭证')
    }

    const token = header.slice(7).trim()
    let payload: ClosureReceiptJwtPayload
    try {
      payload = this.jwtService.verify<ClosureReceiptJwtPayload>(token, {
        algorithms: ['HS256'],
        audience: 'enduser',
      })
    } catch {
      throw this.unauthorized('MEMBER_TOKEN_INVALID', '登录已失效,请重新登录')
    }

    if (
      typeof payload.sub !== 'string' ||
      payload.sub.length === 0 ||
      typeof payload.jti !== 'string' ||
      payload.jti.length === 0
    ) {
      throw this.unauthorized('MEMBER_TOKEN_INVALID', '登录已失效,请重新登录')
    }

    req.closureReceiptSubject = { endUserId: payload.sub }
    return true
  }

  private unauthorized(code: string, message: string): UnauthorizedException {
    return new UnauthorizedException({ error: { code, message } })
  }
}
