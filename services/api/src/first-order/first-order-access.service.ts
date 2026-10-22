import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import type { AuthedUser } from '../common/decorators/current-user.decorator'
import { PrismaService } from '../prisma/prisma.service'

export function firstOrderOrg(user: AuthedUser, orgId?: string): string {
  if (user.role === 'admin' && orgId?.trim()) return orgId.trim()
  if (user.role === 'partner' && user.orgId?.trim() && (!orgId || orgId === user.orgId)) return user.orgId
  throw new ForbiddenException({ error: { code: 'FIRST_ORDER_SCOPE_REQUIRED', message: '当前账号没有该机构的访问权限' } })
}

export function firstOrderMissing(): never {
  throw new NotFoundException({ error: { code: 'FIRST_ORDER_NOT_FOUND', message: '记录不存在或不在当前机构范围内' } })
}

@Injectable()
export class FirstOrderAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async project(user: AuthedUser, id: string) {
    const row = await this.prisma.serviceProject.findFirst({
      where: { id, ...(user.role === 'admin' ? {} : { orgId: firstOrderOrg(user) }) },
      include: { deployments: { orderBy: { startedAt: 'asc' } } },
    })
    if (!row) return firstOrderMissing()
    return row
  }

  async deployment(user: AuthedUser, id: string) {
    const row = await this.prisma.serviceDeployment.findFirst({
      where: { id, ...(user.role === 'admin' ? {} : { orgId: firstOrderOrg(user) }) },
      include: { project: true },
    })
    if (!row) return firstOrderMissing()
    return row
  }

  async report(user: AuthedUser, id: string) {
    const row = await this.prisma.serviceReport.findFirst({
      where: { id, ...(user.role === 'admin' ? {} : { orgId: firstOrderOrg(user) }) },
    })
    if (!row) return firstOrderMissing()
    return row
  }
}
