import { IsISO8601, IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator'

/** Admin 受控关闭未付款打印任务。expectedUpdatedAt 是详情返回的任务版本戳。 */
export class CancelUnpaidPrintTaskDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(10)
  @MaxLength(500)
  reason!: string

  @IsString()
  @IsISO8601({ strict: true })
  expectedUpdatedAt!: string
}
