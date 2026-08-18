import { IsString, Matches } from 'class-validator'
import { PICKUP_CODE_ACCEPTED_PATTERN } from '../../common/pickup-code'

export class ClaimPickupDto {
  // 受理正则来自 common/pickup-code，**不许在这里内联长度**。
  // 内联的那一份就是第三份长度定义，也是「按 6 位发码、按 10 位收码」的事故来源。
  // 该正则同时收当前 6 位新码与 10 位存量码；存量分支的删除条件见 common/pickup-code.ts。
  @IsString()
  @Matches(PICKUP_CODE_ACCEPTED_PATTERN)
  code!: string
}
