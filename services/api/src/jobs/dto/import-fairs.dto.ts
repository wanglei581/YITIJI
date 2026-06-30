import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator'
import { Type } from 'class-transformer'

/**
 * Partner 招聘会批量导入 DTO(BE-7)。
 *
 * 与 ImportJobsDto 模式完全一致:**只接 items[]**,sourceOrgId / sourceName 走 JWT 推断,
 * 严禁让 partner 自报机构身份。
 *
 * 严格 forbidNonWhitelisted 在 main.ts 已全局生效,任何超出本 DTO 字段的
 * 报名 / 候选人 / 简历相关内容 → 400 拒收。
 */
export class ImportFairItemDto {
  @IsString() @IsNotEmpty() @MaxLength(200)
  externalId!: string

  @IsString() @IsNotEmpty() @MaxLength(200)
  title!: string

  @IsOptional() @IsIn(['general', 'campus', 'campus_corp', 'industry'])
  theme?: string

  /** ISO 时间。建议 partner 端传 ISO 8601,例 2026-06-15T09:00:00+08:00 */
  @IsISO8601()
  startAt!: string

  @IsISO8601()
  endAt!: string

  @IsString() @IsNotEmpty() @MaxLength(200)
  venue!: string

  @IsString() @IsNotEmpty() @MaxLength(100)
  city!: string

  @IsOptional() @IsString() @MaxLength(500)
  address?: string

  @IsOptional() @IsString() @MaxLength(500)
  mapImageUrl?: string

  @IsOptional() @IsString() @MaxLength(500)
  coverImageUrl?: string

  @IsOptional() @IsString() @MaxLength(5000)
  description?: string

  @IsString() @IsNotEmpty() @MaxLength(500)
  sourceUrl!: string

  @IsOptional() @IsString() @MaxLength(500)
  checkinUrl?: string

  @IsOptional() @IsInt() @Min(0)
  companyCount?: number

  @IsOptional() @IsInt() @Min(0)
  jobCount?: number
}

export class ImportFairsDto {
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => ImportFairItemDto)
  items!: ImportFairItemDto[]
}
