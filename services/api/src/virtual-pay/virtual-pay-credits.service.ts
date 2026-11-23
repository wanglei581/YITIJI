import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { readVirtualPaySettings } from './virtual-pay-settings'

/**
 * 会员查看自己仍可用的一次服务权益。
 * 不看收费开关：开关关掉之后，已经记下的权益还在；
 * 同时透传 purchaseEnabled（服务端总开关 + 虚拟支付开关 + 至少一项商品已配置），
 * 让小程序首屏直接诚实隐藏不可用的购买按钮，而不是等用户点出 403。
 */
@Injectable()
export class VirtualPayCreditsService {
  constructor(private readonly prisma: PrismaService) {}

  async listAvailable(endUserId: string): Promise<{
    items: { serviceKind: string; createdAt: Date }[]
    purchaseEnabled: boolean
  }> {
    const [rows, settings] = await Promise.all([
      this.prisma.memberServiceCredit.findMany({
        where: { endUserId, status: 'available' },
        orderBy: { createdAt: 'desc' },
        select: { serviceKind: true, createdAt: true },
      }),
      readVirtualPaySettings(this.prisma),
    ])
    const hasConfiguredGoods = Object.values(settings.goods).some((g) => g.configured)
    return { items: rows, purchaseEnabled: settings.canSell && hasConfiguredGoods }
  }
}
