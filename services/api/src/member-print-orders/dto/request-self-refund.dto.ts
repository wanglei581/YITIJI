import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator'
import { SELF_REFUND_REASON_CODES, type SelfRefundReasonCode } from '../self-refund-policy'

/**
 * 会员自助退款请求体（A3-S3）。
 *
 * `reasonCode` 必填且只能取封闭词表里的值 —— 用户不能用自由文本描述「为什么该退给我」。
 * `note` 纯补充说明：进审计 payload，**不参与任何准入判定**，也不写进 Refund.reason。
 */
export class RequestSelfRefundDto {
  @IsString()
  @IsIn(SELF_REFUND_REASON_CODES as unknown as string[])
  reasonCode!: SelfRefundReasonCode

  /** 可选补充说明（≤120 字）。含手机号/身份证/邮箱等 PII 会被直接拒绝，不做脱敏。 */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  note?: string
}
