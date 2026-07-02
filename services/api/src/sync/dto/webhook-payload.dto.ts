import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator'
import { Transform, Type } from 'class-transformer'
import { JOB_WORK_TYPE_VALUES, normalizeJobWorkType } from '../../jobs/work-type'

function normalizeWebhookWorkType(value: unknown): unknown {
  return normalizeJobWorkType(value)
}

/**
 * 企业 Webhook 推送岗位数据 DTO。
 *
 * 字段集与 ImportJobsDto 保持一致(同样的合规白名单约束)。
 * 严格 forbidNonWhitelisted 全局生效 — 企业塞"候选人邮箱""面试时间槽"
 * 等任何招聘闭环字段一律 400 拒收,从 DTO 层就守住红线。
 *
 * 与 ImportJobItemDto 差异:本 DTO 保留 Webhook 容错入口,但字段白名单、
 * workType 枚举和 AI-ready 标准化字段必须对齐;否则真实客户 Webhook 样本
 * 会在全局 forbidNonWhitelisted 下被拒收。
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

  @IsOptional() @Transform(({ value }) => normalizeWebhookWorkType(value)) @IsIn([...JOB_WORK_TYPE_VALUES])
  workType?: string

  @IsOptional() @IsString() @MaxLength(5000)
  description?: string

  @IsOptional() @IsString() @MaxLength(5000)
  requirements?: string

  @IsOptional() @IsString() @MaxLength(100)
  industry?: string

  @IsOptional() @IsArray() @IsString({ each: true })
  tags?: string[]

  @IsOptional() @IsInt() @Min(0)
  headcount?: number

  @IsOptional() @IsString() @MaxLength(200)
  educationRequirement?: string

  @IsOptional() @IsString() @MaxLength(200)
  experienceRequirement?: string

  @IsOptional() @IsArray() @IsString({ each: true })
  skills?: string[]

  @IsOptional() @IsArray() @IsString({ each: true })
  benefits?: string[]

  @IsOptional() @IsNumber() @Min(0)
  salaryMin?: number

  @IsOptional() @IsNumber() @Min(0)
  salaryMax?: number

  @IsOptional() @IsString() @MaxLength(50)
  salaryUnit?: string

  @IsOptional() @IsDateString()
  validThrough?: string
}

export class WebhookPayloadDto {
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => WebhookJobItemDto)
  items!: WebhookJobItemDto[]
}
