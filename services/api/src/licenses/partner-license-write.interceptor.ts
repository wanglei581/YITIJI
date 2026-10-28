import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common'
import type { Request } from 'express'
import type { Observable } from 'rxjs'
import type { AuthedUser } from '../common/decorators/current-user.decorator'
import { PrismaService } from '../prisma/prisma.service'
import { assertOrgMayWrite } from './license-gate'
import { partnerWriteIsBlocked } from './partner-write-policy'

/**
 * 合作机构后台的写操作：机构需要授权且不可用时，服务端拒绝（403 ORG_LICENSE_INACTIVE）。
 *
 * 做成全局拦截器而不是逐个控制器挂守卫：拦截器在 JwtAuthGuard 之后运行，能读到登录身份；
 * 规则「/partner/ 下的写方法默认拒、逐条登记（方法 + 路由 + 处理函数）才放行」见 partner-write-policy.ts，新接口自动被管住。
 * 管理员操作、一体机、会员、公开接口都不经过这里；没设授权的机构一条查询就放行。
 */
@Injectable()
export class PartnerLicenseWriteInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    if (context.getType() !== 'http') return next.handle()
    const req = context.switchToHttp().getRequest<Request & { user?: AuthedUser }>()
    const user = req.user
    if (!user || user.role !== 'partner' || !user.orgId) return next.handle()
    const routePath = (req.route as { path?: unknown } | undefined)?.path
    const template = typeof routePath === 'string' ? routePath : req.path
    // 「控制器类名.处理函数名」：登记表按它核对，路由被改到别的处理函数上时豁免立刻失效。
    const handler = `${context.getClass().name}.${context.getHandler().name}`
    if (partnerWriteIsBlocked(req.method, template, handler)) {
      await assertOrgMayWrite(this.prisma, user.orgId)
    }
    return next.handle()
  }
}
