import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator'

/**
 * Admin 招聘会管理 DTO(阶段1A)。
 *
 * 全局 ValidationPipe whitelist + forbidNonWhitelisted 生效:任何超出白名单的字段
 * (候选人 / 简历 / 报名数据等)直接 400 拒绝。
 *
 * 合规:只管理招聘会的"展示信息 + 现场服务资料",不含任何招聘闭环字段。
 * 来源字段(sourceOrgId / externalId / sourceName / sourceUrl)不可经本 DTO 修改,
 * 保持"第三方/官方来源"可溯源。
 */

export class UpdateFairInfoDto {
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

  @IsOptional() @IsString() @MaxLength(500)
  mapImageUrl?: string

  @IsOptional() @IsString() @MaxLength(500)
  coverImageUrl?: string
}

/** 参展企业新增/编辑(展示信息,不关联岗位投递)。 */
export class SaveFairCompanyDto {
  @IsString() @IsNotEmpty() @MaxLength(200)
  name!: string

  @IsOptional() @IsString() @MaxLength(100)
  industry?: string

  @IsOptional() @IsIn(['<50', '50-500', '500-2000', '>2000'])
  scale?: string

  @IsOptional() @IsString() @MaxLength(2000)
  description?: string

  @IsOptional() @IsString() @MaxLength(500)
  sourceUrl?: string

  @IsOptional() @IsString() @MaxLength(500)
  logoUrl?: string

  /** 招聘类型标签,逗号分隔(如 "校招,实习")。 */
  @IsOptional() @IsString() @MaxLength(200)
  hiringTags?: string

  @IsOptional() @IsInt() @Min(0)
  jobsCount?: number
}

/** 展区新增/编辑。 */
export class SaveFairZoneDto {
  @IsString() @IsNotEmpty() @MaxLength(100)
  name!: string

  @IsOptional() @IsIn(['innovation', 'service', 'campus_corp_topic'])
  category?: string

  @IsOptional() @IsString() @MaxLength(100)
  city?: string

  @IsOptional() @IsString() @MaxLength(1000)
  description?: string

  @IsOptional() @IsString() @MaxLength(500)
  coverImageUrl?: string

  @IsOptional() @IsInt() @Min(0)
  sortOrder?: number
}

/** 活动资料上传时的业务元数据(文件本体走 multipart file 字段)。 */
export class UploadFairMaterialDto {
  @IsString() @IsNotEmpty() @MaxLength(200)
  name!: string

  @IsOptional() @IsIn(['schedule', 'venue_map', 'company_list', 'position_list', 'brochure', 'other'])
  type?: string

  @IsOptional() @IsString() @MaxLength(1000)
  description?: string

  /** 页数由管理员录入(服务端不解析文档分页);缺省 0=未知。multipart 字段为字符串,服务端解析。 */
  @IsOptional() @IsString() @MaxLength(10)
  pageCount?: string
}

/** 活动资料编辑(名称/类型/描述/页数/是否允许打印)。发布状态走独立 publish 动作。 */
export class UpdateFairMaterialDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(200)
  name?: string

  @IsOptional() @IsIn(['schedule', 'venue_map', 'company_list', 'position_list', 'brochure', 'other'])
  type?: string

  @IsOptional() @IsString() @MaxLength(1000)
  description?: string

  @IsOptional() @IsInt() @Min(0)
  pageCount?: number

  @IsOptional() @IsBoolean()
  allowPrint?: boolean
}
