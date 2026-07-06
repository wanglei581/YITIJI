// Payment Controller — C5-2 线上扫码支付底座 + C5-6 真实渠道（wechat / alipay）
//
// 端点（全局前缀 /api/v1）：
//   GET  /payment/channels        当前启用的支付通道（无密钥信息；Kiosk 渲染通道选择用）
//   POST /orders/:id/pay          出码（建/复用支付尝试，返回屏上动态码内容；body 可选 channel）
//   GET  /orders/:id/pay-status   Kiosk 轮询支付状态（含惰性过期/关单）
//   POST /orders/:id/pay/reconcile  主动查单兜底（回调丢失时按渠道账本核实；同幂等入账路径）
//   POST /payment/callback/:channel   渠道回调（验签+防重放+幂等+金额一致性；需 rawBody；
//                                     应答按渠道要求渲染：alipay 纯文本 success / wechat JSON）
//   POST /payment/sandbox/simulate    沙箱模拟支付（仅非生产 + sandbox Provider）
//
// 鉴权口径：与 print-jobs controller 一致（kiosk 匿名层，cuid 不可猜）；
// 出码/轮询/查单必须携带打印建单返回的 x-payment-session-token。回调端点靠签名鉴权，不走登录态。
import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Post, Req, Res } from '@nestjs/common'
import type { Request, Response } from 'express'
import { CreatePayAttemptDto, SandboxSimulateDto } from './dto/online-payment.dto'
import { OnlinePaymentService } from './online-payment.service'

/** main.ts 的 express.json verify 钩子对 /api/v1/payment/callback/ 前缀写入 rawBody。 */
interface RawBodyRequest extends Request {
  rawBody?: Buffer
}

@Controller()
export class PaymentController {
  constructor(private readonly onlinePayment: OnlinePaymentService) {}

  @Get('payment/channels')
  getChannels() {
    return { channels: this.onlinePayment.availableChannels() }
  }

  @Post('orders/:id/pay')
  @HttpCode(HttpStatus.OK)
  async createPayAttempt(
    @Param('id') id: string,
    @Headers('x-payment-session-token') paymentSessionToken: string | undefined,
    @Body() dto: CreatePayAttemptDto,
  ) {
    return this.onlinePayment.createPayAttempt(id, paymentSessionToken, dto?.channel)
  }

  @Get('orders/:id/pay-status')
  async getPayStatus(@Param('id') id: string, @Headers('x-payment-session-token') paymentSessionToken: string | undefined) {
    return this.onlinePayment.getPayStatus(id, paymentSessionToken)
  }

  @Post('orders/:id/pay/reconcile')
  @HttpCode(HttpStatus.OK)
  async reconcile(@Param('id') id: string, @Headers('x-payment-session-token') paymentSessionToken: string | undefined) {
    return this.onlinePayment.reconcilePayment(id, paymentSessionToken)
  }

  @Post('payment/callback/:channel')
  @HttpCode(HttpStatus.OK)
  async callback(
    @Param('channel') channel: string,
    @Req() req: RawBodyRequest,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.onlinePayment.processCallback(channel, req.rawBody, headers)
    // 成功应答按渠道要求渲染（alipay 要求纯文本 success，否则会按失败重试）；
    // 无 ack 的通道（sandbox）保持既有 JSON 响应。失败路径由异常 → 4xx，渠道自行重试。
    if (result.ack) {
      res.setHeader('Content-Type', result.ack.contentType)
      return result.ack.body
    }
    return { ok: result.ok, ...(result.idempotent !== undefined ? { idempotent: result.idempotent } : {}) }
  }

  @Post('payment/sandbox/simulate')
  @HttpCode(HttpStatus.OK)
  async simulate(@Body() dto: SandboxSimulateDto) {
    const result = await this.onlinePayment.simulateSandboxCallback({ attemptId: dto.attemptId, result: dto.result })
    return { ok: result.ok, ...(result.idempotent !== undefined ? { idempotent: result.idempotent } : {}) }
  }
}
