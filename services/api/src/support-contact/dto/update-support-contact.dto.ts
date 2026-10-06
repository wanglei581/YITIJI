import { Transform } from 'class-transformer'
import { IsBoolean, IsOptional, IsString, Matches, MaxLength } from 'class-validator'

/** 大陆手机号，或带区号的固定电话（区号与号码之间的横线可有可无）。 */
export const SUPPORT_PHONE_PATTERN = /^(?:1[3-9]\d{9}|0\d{2,3}-?\d{7,8})$/

const PHONE_MESSAGE = '服务电话需为大陆手机号或带区号的固定电话'

function trimToNull({ value }: { value: unknown }): unknown {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

export class UpdateSupportContactDto {
  /** 省略表示不改。空串或纯空白表示清除。 */
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(20)
  @Matches(SUPPORT_PHONE_PATTERN, { message: PHONE_MESSAGE })
  servicePhone?: string | null

  /** 省略表示不改。空串或纯空白表示清除。清除后公开接口回到默认服务时间。 */
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(40)
  serviceHours?: string | null

  @IsOptional()
  @IsBoolean()
  miniappPublished?: boolean
}
