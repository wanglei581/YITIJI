import {
  IsIn,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator'

/**
 * 政策服务 DTO(阶段1D)。
 *
 * 合规:info-only —— 只收政策说明 / 官方入口字段;
 * 不存在"申请代办 / 补贴发放 / 到账"等承诺性字段。
 * 全局 forbidNonWhitelisted 生效。
 */

export const POLICY_KINDS = ['policy_guide', 'notice'] as const
export const POLICY_AUDIENCES = ['graduate', 'flexible', 'migrant', 'hardship', 'startup', 'general'] as const
export const POLICY_CATEGORIES = ['policy', 'announcement', 'notice', 'recruitment'] as const

export class CreatePolicyPostDto {
  @IsIn([...POLICY_KINDS])
  kind!: string

  @IsString() @IsNotEmpty() @MaxLength(200)
  title!: string

  @IsOptional() @IsString() @MaxLength(500)
  summary?: string

  @IsOptional() @IsString() @MaxLength(10000)
  content?: string

  @IsOptional() @IsIn([...POLICY_AUDIENCES])
  audience?: string

  @IsOptional() @IsIn([...POLICY_CATEGORIES])
  category?: string

  @IsOptional() @IsString() @MaxLength(500)
  externalUrl?: string

  @IsOptional() @IsISO8601()
  publishedDate?: string
}

export class UpdatePolicyPostDto {
  @IsOptional() @IsIn([...POLICY_KINDS])
  kind?: string

  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(200)
  title?: string

  @IsOptional() @IsString() @MaxLength(500)
  summary?: string

  @IsOptional() @IsString() @MaxLength(10000)
  content?: string

  @IsOptional() @IsIn([...POLICY_AUDIENCES])
  audience?: string

  @IsOptional() @IsIn([...POLICY_CATEGORIES])
  category?: string

  @IsOptional() @IsString() @MaxLength(500)
  externalUrl?: string

  @IsOptional() @IsISO8601()
  publishedDate?: string
}
