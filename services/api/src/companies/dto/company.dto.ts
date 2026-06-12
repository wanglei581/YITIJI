import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsISO8601, IsOptional,
  IsString, IsUrl, MaxLength, MinLength, ValidateNested,
} from 'class-validator'
import { Type } from 'class-transformer'
import { COMPANY_INDUSTRIES, COMPANY_TYPES } from '../companies.types'

// ============================================================
// 企业展示 DTO（全局 whitelist + forbidNonWhitelisted 生效：
// 任何候选人 / 简历 / 投递状态等超白名单字段直接 400 拒绝）。
// 媒体一律 URL 形式（http/https），由管理员审核后才对外展示。
// ============================================================

const URL_OPTS = { protocols: ['http', 'https'], require_protocol: true }

export class CompanyFieldsDto {
  @IsOptional() @IsString() @MaxLength(120)
  legalName?: string

  @IsOptional() @IsUrl(URL_OPTS) @MaxLength(500)
  logoUrl?: string

  @IsOptional() @IsUrl(URL_OPTS) @MaxLength(500)
  coverImageUrl?: string

  @IsOptional() @IsUrl(URL_OPTS) @MaxLength(500)
  promoVideoUrl?: string

  @IsOptional() @IsString() @MaxLength(2000)
  description?: string

  @IsOptional() @IsIn([...COMPANY_INDUSTRIES])
  industry?: string

  @IsOptional() @IsIn([...COMPANY_TYPES])
  companyType?: string

  @IsOptional() @IsString() @MaxLength(40)
  scale?: string

  @IsOptional() @IsISO8601()
  foundedAt?: string

  @IsOptional() @IsString() @MaxLength(40)
  province?: string

  @IsOptional() @IsString() @MaxLength(40)
  city?: string

  @IsOptional() @IsString() @MaxLength(40)
  district?: string

  @IsOptional() @IsString() @MaxLength(200)
  address?: string

  @IsOptional() @IsString() @MaxLength(40)
  boothNo?: string

  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) @MaxLength(30, { each: true })
  honorTags?: string[]

  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) @MaxLength(20, { each: true })
  tags?: string[]

  @IsOptional() @IsBoolean()
  fairParticipant?: boolean

  @IsOptional() @IsUrl(URL_OPTS) @MaxLength(500)
  sourceUrl?: string

  // 详情页右侧指标开关（关闭或数据为空都不展示）
  @IsOptional() @IsBoolean()
  showOpenJobCount?: boolean

  @IsOptional() @IsBoolean()
  showCity?: boolean

  @IsOptional() @IsBoolean()
  showEmployeeScale?: boolean

  @IsOptional() @IsBoolean()
  showBoothNo?: boolean
}

/** Admin 手工新增（必须挂在真实来源机构下，来源四要素齐全）。 */
export class AdminCreateCompanyDto extends CompanyFieldsDto {
  @IsString() @MinLength(1) @MaxLength(64)
  sourceOrgId!: string

  @IsString() @MinLength(1) @MaxLength(120)
  externalId!: string

  @IsString() @MinLength(2) @MaxLength(80)
  name!: string
}

export class AdminUpdateCompanyDto extends CompanyFieldsDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(80)
  name?: string
}

export class AdminReviewCompanyDto {
  @IsIn(['approve', 'reject'])
  action!: 'approve' | 'reject'

  @IsOptional() @IsString() @MaxLength(500)
  rejectReason?: string
}

export class AdminPublishCompanyDto {
  @IsBoolean()
  publish!: boolean
}

export class AdminLinkJobsDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @IsString({ each: true })
  jobIds!: string[]
}

/** Partner 导入单条（默认 pending+draft；可按外部 ID 关联本机构岗位）。 */
export class PartnerImportCompanyItemDto extends CompanyFieldsDto {
  @IsString() @MinLength(1) @MaxLength(120)
  externalId!: string

  @IsString() @MinLength(2) @MaxLength(80)
  name!: string

  @IsOptional() @IsArray() @ArrayMaxSize(100) @IsString({ each: true })
  jobExternalIds?: string[]
}

export class PartnerImportCompaniesDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => PartnerImportCompanyItemDto)
  items!: PartnerImportCompanyItemDto[]
}

export class PartnerUpdateCompanyDto extends CompanyFieldsDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(80)
  name?: string

  @IsOptional() @IsArray() @ArrayMaxSize(100) @IsString({ each: true })
  jobExternalIds?: string[]
}
