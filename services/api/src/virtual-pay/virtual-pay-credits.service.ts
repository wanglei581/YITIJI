import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

/**
 * 会员查看自己仍可用的一次服务权益。
 * 不看收费开关：开关关掉之后，已经记下的权益还在。
 * 用掉和退款留给第二包，这里不返回。
 */
@Injectable()
export class VirtualPayCreditsService {
  constructor(private readonly prisma: PrismaService) {}

  async listAvailable(endUserId: string): Promise<{ items: { serviceKind: string; createdAt: Date }[] }> {
    const rows = await this.prisma.memberServiceCredit.findMany({
      where: { endUserId, status: 'available' },
      orderBy: { createdAt: 'desc' },
      select: { serviceKind: true, createdAt: true },
    })
    return { items: rows }
  }
}
