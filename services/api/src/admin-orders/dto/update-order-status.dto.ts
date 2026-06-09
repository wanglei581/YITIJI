import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator'

/**
 * Admin 改订单状态。payStatus / taskStatus 至少提供其一（空请求由 service 拒绝）。
 *
 * payStatus（订单支付状态）：'paid' | 'failed' | 'unpaid'（'refunded' 只能经退款端点产生）。
 *   线下运营标记，**不接真实支付**，不调用任何支付网关。
 *
 * taskStatus（订单「运营视图」任务状态）：仅更新 Order.taskStatus 列，
 *   **不反向修改 PrintTask.status**。PrintTask.status 仍是真实打印任务的状态源；
 *   Order.taskStatus 是运营视图，可能在关联任务后续流转时被设备状态镜像覆盖（已知取舍）。
 */
export class UpdateOrderStatusDto {
  @IsOptional()
  @IsIn(['paid', 'failed', 'unpaid'])
  payStatus?: 'paid' | 'failed' | 'unpaid'

  @IsOptional()
  @IsIn(['pending', 'claimed', 'printing', 'completed', 'failed', 'cancelled'])
  taskStatus?: 'pending' | 'claimed' | 'printing' | 'completed' | 'failed' | 'cancelled'

  /** 操作备注（可选，落审计 payload）。 */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string
}
