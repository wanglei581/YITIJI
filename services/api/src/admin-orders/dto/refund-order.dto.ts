import { IsNotEmpty, IsString, MaxLength } from 'class-validator'

/**
 * Admin 退款。**仅置状态 + 原因，不发生真实资金流**（本阶段不接支付，CLAUDE.md §12）。
 * 仅当订单 payStatus='paid' 时允许退款；执行后 payStatus='refunded'。
 */
export class RefundOrderDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string
}
