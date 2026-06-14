import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
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

/** 求职意向分布切片(标签 + 百分比),Kiosk 大屏展示用,机构录入的预计值。 */
export class SeekerIntentSliceDto {
  @IsString() @IsNotEmpty() @MaxLength(40)
  label!: string

  @IsNumber() @Min(0) @Max(100)
  percent!: number
}

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

  // ── P1-A① 招聘会大屏/地图字段 ──────────────────────────────────────────────
  // 经纬度 / 客流 / 求职意向均为"展示参考",非签到/报名真相;清空语义见 service。
  @IsOptional() @IsNumber() @Min(-90) @Max(90)
  latitude?: number | null

  @IsOptional() @IsNumber() @Min(-180) @Max(180)
  longitude?: number | null

  @IsOptional() @IsString() @MaxLength(500)
  trafficInfo?: string | null

  @IsOptional() @IsInt() @Min(0)
  expectedAttendance?: number | null

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => SeekerIntentSliceDto)
  seekerIntent?: SeekerIntentSliceDto[]
}

/**
 * 参展企业岗位明细(P1-A②;展示信息)。
 *
 * 合规:岗位仅作现场展示明细,不含任何投递/申请/收简历/候选人能力;
 * 用户跳走仍通过企业 sourceUrl 外链。position.sourceUrl 前台不展示,不在本编辑器范围。
 */
export class SaveFairCompanyPositionDto {
  @IsString() @IsNotEmpty() @MaxLength(200)
  title!: string

  @IsOptional() @IsIn(['full_time', 'part_time', 'intern'])
  positionType?: string

  @IsOptional() @IsString() @MaxLength(100)
  salary?: string

  @IsOptional() @IsInt() @Min(0)
  headcount?: number

  @IsOptional() @IsString() @MaxLength(100)
  education?: string

  @IsOptional() @IsString() @MaxLength(100)
  experience?: string

  @IsOptional() @IsString() @MaxLength(200)
  location?: string

  @IsOptional() @IsString() @MaxLength(100)
  department?: string

  @IsOptional() @IsString() @MaxLength(2000)
  requirements?: string
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

  /** 岗位明细(展示);保存即全量替换该企业岗位,[] 或全空标题行清空。 */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => SaveFairCompanyPositionDto)
  positions?: SaveFairCompanyPositionDto[]
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
