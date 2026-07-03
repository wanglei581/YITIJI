// Payment Controller — C5-2 线上扫码支付沙箱底座
//
// 端点（全局前缀 /api/v1）：
//   POST /orders/:id/pay          出码（建/复用支付尝试，返回屏上动态码内容）
//   GET  /orders/:id/pay-status   Kiosk 轮询支付状态（含惰性过期/关单）
//   POST /payment/callback/:channel   渠道回调（验签+防重放+幂等+金额一致性；需 rawBody）
//   POST /payment/sandbox/simulate    沙箱模拟支付（仅非生产 + sandbox Provider）
//
// 鉴权口径：与 print-jobs controller 一致（kiosk 匿名层，cuid 不可猜）；
// C5-3 收银 UI 波再按会话收紧。回调端点靠签名鉴权，不走登录态。
import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Post, Req } from '@nestjs/common'
import type { Request } from 'express'
import { SandboxSimulateDto } from './dto/online-payment.dto'
import { OnlinePaymentService } from './online-payment.service'

/** main.ts 的 express.json verify 钩子对 /api/v1/payment/callback/ 前缀写入 rawBody。 */
interface RawBodyRequest extends Request {
  rawBody?: Buffer
}

@Controller()
export class PaymentController {
  constructor(private readonly onlinePayment: OnlinePaymentService) {}

  @Post('orders/:id/pay')
  @HttpCode(HttpStatus.OK)
  async createPayAttempt(@Param('id') id: string) {
    return this.onlinePayment.createPayAttempt(id)
  }

  @Get('orders/:id/pay-status')
  async getPayStatus(@Param('id') id: string) {
    return this.onlinePayment.getPayStatus(id)
  }

  @Post('payment/callback/:channel')
  @HttpCode(HttpStatus.OK)
  async callback(
    @Param('channel') channel: string,
    @Req() req: RawBodyRequest,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.onlinePayment.processCallback(channel, req.rawBody, headers)
  }

  @Post('payment/sandbox/simulate')
  @HttpCode(HttpStatus.OK)
  async simulate(@Body() dto: SandboxSimulateDto) {
    return this.onlinePayment.simulateSandboxCallback({ attemptId: dto.attemptId, result: dto.result })
  }
}
