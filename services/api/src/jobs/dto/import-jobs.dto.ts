import {
  IsArray,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
  ArrayMinSize,
  Min,
} from 'class-validator'
import { Type } from 'class-transformer'

export class ImportJobItemDto {
  @IsString() @IsNotEmpty() @MaxLength(200)
  externalId!: string

  @IsString() @IsNotEmpty() @MaxLength(200)
  title!: string

  @IsString() @IsNotEmpty() @MaxLength(200)
  company!: string

  @IsString() @IsNotEmpty() @MaxLength(100)
  city!: string

  @IsString() @IsNotEmpty() @MaxLength(500)
  sourceUrl!: string

  @IsOptional() @IsString() @MaxLength(100)
  salary?: string

  @IsOptional() @IsArray() @IsString({ each: true })
  tags?: string[]

  @IsOptional() @IsString() @MaxLength(5000)
  description?: string

  @IsOptional() @IsString() @MaxLength(5000)
  requirements?: string

  @IsOptional() @IsString() @MaxLength(100)
  industry?: string

  @IsOptional() @IsIn(['full_time', 'part_time', 'internship', 'contract'])
  workType?: string

  @IsOptional() @IsNumber() @Min(1)
  headcount?: number
}

/**
 * Phase #5 起:sourceOrgId 不再由前端传入,而是从 JWT 的 req.user.orgId
 * 强制取出;sourceName 由后端按 orgId 反查 Organization.name。
 *
 * 本 DTO 在 partner 导入接口上使用了 forbidNonWhitelisted:true,
 * body 出现任何额外字段(候选人姓名 / 邮箱 / 电话 / 简历 / Offer 等)
 * 会直接 400 拒绝,而不是静默剥离。合规红线。
 */
export class ImportJobsDto {
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => ImportJobItemDto)
  items!: ImportJobItemDto[]
}
