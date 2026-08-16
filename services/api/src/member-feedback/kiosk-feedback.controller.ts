import { Body, Controller, Post } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { ApiResponse } from '../common/dto/api-response.dto'
import { CreateKioskFeedbackDto } from './dto/kiosk-feedback.dto'
import { KioskFeedbackService, type KioskFeedbackReceipt } from './kiosk-feedback.service'

/**
 * 一体机匿名反馈提交面（免登录）。
 *
 * 为什么不挂 EndUserAuthGuard：一体机是公共位设备，绝大多数用户不登录。
 * 唯一的提交端点 POST /me/feedback 挂了鉴权，等于把「缺纸 / 打印质量 / 费用」
 * 这类只有现场用户才提得出的问题挡在登录墙外 —— 那些按钮对匿名用户是死的。
 *
 * 只开「提交」一个动作：没有列表、没有详情、没有追加回复、没有关单。
 * 匿名调用方不应拿到任何可枚举的工单读能力，处置只能走 Admin 侧。
 *
 * 三层约束（详见 KioskFeedbackService）：
 *   - 按 IP：本装饰器的 6 次 / 60 秒（全局默认是 60 次 / 60 秒，这里收紧 10 倍）。
 *     IP 只进 ThrottlerGuard 的内存计数，**不落库** —— IP 本身是个人信息，
 *     匿名工单不该持久化它。
 *   - 按终端：落库计数的 5 条 / 10 分钟 + 20 条 / 60 分钟（跨实例、跨重启一致）。
 *   - 分类白名单 + 不收 PII + 关联任务归属校验 + 幂等。
 */
@Controller('kiosk/feedback')
export class KioskFeedbackController {
  constructor(private readonly feedback: KioskFeedbackService) {}

  @Post()
  @Throttle({ default: { ttl: 60_000, limit: 6 } })
  async submit(@Body() dto: CreateKioskFeedbackDto): Promise<ApiResponse<KioskFeedbackReceipt>> {
    return ApiResponse.ok(await this.feedback.submit(dto))
  }
}
