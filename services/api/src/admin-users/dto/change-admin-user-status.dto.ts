import { Transform } from 'class-transformer'
import { IsString, MaxLength, MinLength } from 'class-validator'

/**
 * 停用 / 恢复终端用户的请求体。
 *
 * reason 必填且先 trim 再判长：纯空白串必须被拒。这是权限动作，
 * 事后追责只能靠这条原因 —— 允许空原因等于允许「查不出为什么停的」。
 */
export class ChangeAdminUserStatusDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  reason!: string
}
