import { Injectable, Optional } from '@nestjs/common'
import { resumeTripCover } from './service-order.intercept'
import { ServiceOrderService } from './service-order.service'

type Headers = Record<string, string | string[] | undefined> | undefined

/**
 * 只回答「这一趟已付的简历优化还盖不盖得住」。
 * 岗位匹配因此不必自己拿订单或支付服务。
 */
@Injectable()
export class TripCoverService {
  constructor(@Optional() private readonly orders?: ServiceOrderService) {}

  cover(headers: Headers): Promise<{ orderId: string | null; skipDailyQuota: boolean }> {
    return resumeTripCover(this.orders, headers)
  }
}
