// Order Quote Controller — P0-1 / C5
//
// Routes (global prefix /api/v1):
//   POST /orders/quote  — 打印计价预览（不落库；签名 fileUrl + 限流）
//
// 鉴权口径与 POST /print/jobs 一致：匿名 Kiosk + 签名 fileUrl 验签，没有鉴权守卫。
// 限流按验签后的会员计数，其余按 IP（见 order-quote-throttle.ts）；身份只决定额度归属，不做鉴权。
import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common'
import { QuotePrintOrderDto } from './dto/quote-print-order.dto'
import { OrderQuoteThrottle } from './order-quote-throttle'
import { OrderQuoteService } from './order-quote.service'

@Controller('orders')
export class OrderQuoteController {
  constructor(private readonly orderQuote: OrderQuoteService) {}

  @Post('quote')
  @HttpCode(HttpStatus.OK)
  @OrderQuoteThrottle()
  quote(@Body() dto: QuotePrintOrderDto) {
    return this.orderQuote.quote(dto)
  }
}
