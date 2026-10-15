/**
 * 会员本机领取：POST /api/v1/me/print-orders/:orderId/claim-here。
 *
 * 为什么是新文件：它只做「按 orderId + 本人找单」与「终端不一致时怎么答」这两件与到机码入口不同的事，
 * 找到单之后一律交给 PickupOrderService.settleClaim —— 退款、过期、已用与同机回放、文件就绪、
 * 能力、认领、付款/放行全部复用，不在这里复制一份判定（两份必漂移）。
 * 放进 pickup-order.service.ts 会把会员鉴权与「码入口防枚举」两种口径混进同一个文件，
 * 且那边的终端不一致必须对外说「码无效」，这里必须说实话，二者不能共用一段代码。
 */
import { ConflictException, HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common'
import { RedisService } from '../common/redis/redis.service'
import { consumePickupClaimRate } from '../print-jobs/pickup-claim-rate-limit'
import { PickupOrderService } from '../print-jobs/pickup-order.service'
import { PrismaService } from '../prisma/prisma.service'

@Injectable()
export class MemberOrderClaimHereService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly pickupOrders: PickupOrderService,
  ) {}

  async claimHere(endUserId: string, orderId: string, terminalRef: string | undefined, source: string | undefined) {
    const terminal = await this.pickupOrders.requireTerminal(terminalRef)
    // 与到机码入口共用同一组终端 / 来源配额：同一台机器上两种领取方式加起来仍受同一上限。
    if (await consumePickupClaimRate(this.redis, terminal.id, source)) {
      throw new HttpException(
        { error: { code: 'PICKUP_CLAIM_RATE_LIMITED', message: '尝试过于频繁，请稍后再试' } },
        HttpStatus.TOO_MANY_REQUESTS,
      )
    }
    // 不看到机码锁定：锁定防的是「猜码」，这里本人已登录、按自己的订单领取，不涉及任何码。
    // 所以本机被人恶意打错码锁住时，登录用户仍能从「我的打印订单」取到自己的单。
    const order = await this.prisma.order.findFirst({ where: { id: orderId, endUserId } })
    if (!order) {
      throw new NotFoundException({ error: { code: 'PRINT_ORDER_NOT_FOUND', message: '打印订单不存在' } })
    }
    if (order.terminalId !== terminal.id) {
      // 本人已证明身份：直接告诉他该去哪台机器，不计入锁机、不需要防枚举的同文案。
      const target = order.terminalId
        ? await this.prisma.terminal.findUnique({
            where: { id: order.terminalId },
            select: { id: true, displayName: true, locationLabel: true },
          })
        : null
      throw new ConflictException({
        error: {
          code: 'PICKUP_TERMINAL_MISMATCH',
          message: '这笔订单不在这台机器取件，请到下单时选的网点领取',
          terminal: target ?? null,
        },
      })
    }
    return this.pickupOrders.settleClaim(order, terminal, 'member_order')
  }
}
