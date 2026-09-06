import { Transform } from 'class-transformer'
import {
  IsArray,
  IsIn,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
} from 'class-validator'
import { JOB_WORK_TYPE_VALUES } from '../work-type'

/**
 * Partner 岗位/招聘会编辑 DTO(阶段1C)。
 *
 * 字段集 = 对应 Import DTO 的展示字段子集(全部可选,只改传入的字段);
 * externalId / sourceOrgId / sourceName 不可改 —— 来源可溯源是合规底线。
 *
 * 状态机(service 强制):编辑成功后 reviewStatus 重置 'pending'、publishStatus
 * 重置 'draft'、清空拒绝原因 —— 任何内容修订必须重新过管理员审核,
 * 防"先过审后改内容"绕过审核。
 *
 * 全局 forbidNonWhitelisted 生效:候选人 / 简历 / 报名等字段直接 400。
 */

const HTTP_URL = { protocols: ['http', 'https'], require_protocol: true }

function emptyToUndefined(value: unknown): unknown {
  return typeof value === 'string' && value.trim() === '' ? undefined : value
}

export class UpdatePartnerJobDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(200)
  title?: string

  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(200)
  company?: string

  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(100)
  city?: string

  @IsOptional() @Transform(({ value }) => emptyToUndefined(value))
  @IsUrl(HTTP_URL) @MaxLength(500)
  sourceUrl?: string

  @IsOptional() @IsString() @MaxLength(100)
  salary?: string

  @IsOptional() @IsArray() @IsString({ each: true }) @MaxLength(50, { each: true })
  tags?: string[]

  @IsOptional() @IsString() @MaxLength(5000)
  description?: string

  @IsOptional() @IsString() @MaxLength(5000)
  requirements?: string

  @IsOptional() @IsIn([...JOB_WORK_TYPE_VALUES])
  workType?: string

  @IsOptional() @IsString() @MaxLength(200)
  educationRequirement?: string

  @IsOptional() @IsString() @MaxLength(200)
  experienceRequirement?: string

  @IsOptional() @IsArray() @IsString({ each: true }) @MaxLength(50, { each: true })
  skills?: string[]

  @IsOptional() @IsArray() @IsString({ each: true }) @MaxLength(50, { each: true })
  benefits?: string[]

  @IsOptional() @IsNumber() @Min(0)
  salaryMin?: number

  @IsOptional() @IsNumber() @Min(0)
  salaryMax?: number

  @IsOptional() @IsString() @MaxLength(50)
  salaryUnit?: string

  @IsOptional() @Transform(({ value }) => emptyToUndefined(value)) @IsISO8601()
  validThrough?: string

  @IsOptional() @IsNumber() @Min(0)
  headcount?: number
}

export class UpdatePartnerFairDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(200)
  title?: string

  @IsOptional() @IsIn(['general', 'campus', 'campus_corp', 'industry'])
  theme?: string

  @IsOptional() @IsISO8601()
  startAt?: string

  @IsOptional() @IsISO8601()
  endAt?: string

  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(200)
  venue?: string

  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(100)
  city?: string

  @IsOptional() @IsString() @MaxLength(500)
  address?: string

  @IsOptional() @IsString() @MaxLength(5000)
  description?: string

  @IsOptional() @Transform(({ value }) => emptyToUndefined(value))
  @IsUrl(HTTP_URL) @IsNotEmpty() @MaxLength(500)
  sourceUrl?: string

  @IsOptional() @IsString() @MaxLength(500)
  @Transform(({ value }) => emptyToUndefined(value))
  @IsUrl(HTTP_URL)
  checkinUrl?: string
}
