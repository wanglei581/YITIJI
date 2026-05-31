import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator'
import { Type } from 'class-transformer'

/**
 * 企业 Webhook 推送岗位数据 DTO。
 *
 * 字段集与 ImportJobsDto 保持一致(同样的合规白名单约束)。
 * 严格 forbidNonWhitelisted 全局生效 — 企业塞"候选人邮箱""面试时间槽"
 * 等任何招聘闭环字段一律 400 拒收,从 DTO 层就守住红线。
 *
 * 与 ImportJobItemDto 差异:本 DTO 不限制 city/title 长度的下限(企业 ATS
 * 字段名/规约可能略不同),但保留长度上限防止 DoS。
 */
export class WebhookJobItemDto {
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

  @IsOptional() @IsString() @MaxLength(50)
  workType?: string

  @IsOptional() @IsString() @MaxLength(5000)
  description?: string

  @IsOptional() @IsString() @MaxLength(5000)
  requirements?: string

  @IsOptional() @IsArray() @IsString({ each: true })
  tags?: string[]

  @IsOptional() @IsInt() @Min(0)
  headcount?: number
}

export class WebhookPayloadDto {
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => WebhookJobItemDto)
  items!: WebhookJobItemDto[]
}
