import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator'
import type { FileRetentionPolicy } from '../file.types'

export class UpdateRetentionDto {
  @IsIn(['months_3', 'months_6', 'long_term'])
  retentionPolicy!: FileRetentionPolicy

  /** 选择 6 个月或长期保存时必填；具体版本白名单由服务层校验。 */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  consentVersion?: string
}
