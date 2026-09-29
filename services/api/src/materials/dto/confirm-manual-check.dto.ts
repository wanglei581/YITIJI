import { Equals } from 'class-validator'

/** 本人确认「文件里没有不想打印的个人信息」（A-04）。只接受明确的 true，不接受默认值。 */
export class ConfirmManualCheckDto {
  @Equals(true, { message: '请明确确认' })
  confirmed!: true
}
