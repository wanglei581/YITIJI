// Order Quote Controller — P0-1 / C5
//
// Routes (global prefix /api/v1):
//   POST /orders/quote  — 打印计价预览（不落库；签名 fileUrl + 限流）
//
// 鉴权口径与 POST /print/jobs 一致：匿名 Kiosk + 签名 fileUrl 验签 + IP 限流。
import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { QuotePrintOrderDto } from './dto/quote-print-order.dto'
import { OrderQuoteService } from './order-quote.service'

@Controller('orders')
export class OrderQuoteController {
  constructor(private readonly orderQuote: OrderQuoteService) {}

  @Post('quote')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  quote(@Body() dto: QuotePrintOrderDto) {
    return this.orderQuote.quote(dto)
  }
}
