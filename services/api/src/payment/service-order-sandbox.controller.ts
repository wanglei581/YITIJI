// 服务单沙箱「模拟付成 / 付失败」（只给开发与联调；生产直接 404）。
//
// POST /api/v1/payment/sandbox/simulate-service-order  { serviceOrderId, result: 'success' | 'failed' }
//
// 照 payment/sandbox/simulate（OnlinePaymentService.simulateSandboxCallback）的规矩：
//   · NODE_ENV=production 一律 404，连请求体都不看（守卫先于参数校验）；
//   · 只认沙箱通道：注册表里没有沙箱，或这张服务单不是沙箱单，都拒绝；
//   · 回调报文按库内这张服务单的真实数据构造并签名（attemptId=providerOrderNo、prepayId、orderId、金额），
//     调用方只能指定「哪一张单」和「成功 / 失败」，注入不了金额或单号；
//   · 走和真回调同一条路：OnlinePaymentService.processCallback 验签、防重放、对字段、入账；
//     重复调用由那条路的幂等兜住（同一单记过已付就原样返回 idempotent）。
import { randomBytes } from 'node:crypto'
import {
  BadRequestException,
  Body,
  CanActivate,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  Post,
  UseGuards,
} from '@nestjs/common'
import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator'
import { PrismaService } from '../prisma/prisma.service'
import { OnlinePaymentService } from './online-payment.service'
import { PAYMENT_PROVIDER_TOKEN, type PaymentProviderRegistry } from './payment-provider.factory'
import { buildPaymentCallbackPath } from './payment-provider.types'
import { SandboxPaymentProvider } from './providers/sandbox-payment.provider'

export class SimulateServiceOrderDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  serviceOrderId!: string

  @IsIn(['success', 'failed'])
  result!: 'success' | 'failed'
}

/** 生产环境这条路由不存在：守卫比参数校验先跑，乱写的请求体也只得到 404。 */
@Injectable()
export class NotInProductionGuard implements CanActivate {
  canActivate(): boolean {
    if (process.env['NODE_ENV'] === 'production') throw new NotFoundException()
    return true
  }
}

@Controller('payment/sandbox')
export class ServiceOrderSandboxController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly onlinePayment: OnlinePaymentService,
    @Inject(PAYMENT_PROVIDER_TOKEN) private readonly registry: PaymentProviderRegistry,
  ) {}

  @Post('simulate-service-order')
  @HttpCode(HttpStatus.OK)
  @UseGuards(NotInProductionGuard)
  async simulate(@Body() dto: SimulateServiceOrderDto): Promise<{ ok: true; idempotent?: boolean }> {
    const provider = this.registry.get('sandbox')
    if (!provider || !(provider instanceof SandboxPaymentProvider)) throw new BadRequestException('SANDBOX_ONLY')
    const row = await this.prisma.serviceOrder.findUnique({ where: { id: dto.serviceOrderId } })
    if (!row) throw new NotFoundException('SERVICE_ORDER_NOT_FOUND')
    if (row.provider !== provider.channel) throw new BadRequestException('SANDBOX_ONLY')

    const callback = provider.buildSimulatedCallback({
      path: buildPaymentCallbackPath(provider.channel),
      attemptId: row.providerOrderNo,
      prepayId: row.prepayId ?? row.providerOrderNo,
      orderId: row.id,
      amountCents: row.amountCents,
      result: dto.result,
      channelTxnNo: row.channelTxnNo ?? `sbx_txn_${randomBytes(8).toString('hex')}`,
      failReason: dto.result === 'failed' ? 'sandbox_simulated_failure' : undefined,
    })
    const result = await this.onlinePayment.processCallback(provider.channel, callback.rawBody, callback.headers)
    return { ok: result.ok, ...(result.idempotent !== undefined ? { idempotent: result.idempotent } : {}) }
  }
}
