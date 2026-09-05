import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator'
import type {
  JobMaterialTemplateField,
  JobMaterialTemplateType,
  ResumeTemplateLayoutPreset,
} from '../job-materials.types'

/**
 * 后台新建 / 编辑求职材料模板的 DTO。
 *
 * - type 必须落在既有 JobMaterialTemplateType 五值内（服务端不新增类型，防客户端枚举漂移）。
 * - fields 逐项校验 key / label / required / maxLength 形状（multiline / placeholder 与种子常量一致）。
 * - tags / fields / resumeLayoutPreset 均为结构化 JSON；前端负责 JSON.parse，后端做形状校验兜底。
 * - resumeLayoutPreset 仅 type=resume_template 需要，是否必填由 service 按最终 type 判定。
 */
export const JOB_MATERIAL_TEMPLATE_TYPE_VALUES = [
  'resume_template',
  'cover_letter',
  'thank_you',
  'portfolio_cover',
  'materials_checklist',
] as const

export const JOB_MATERIAL_FIELD_KEY_VALUES = [
  'applicantName',
  'targetRole',
  'targetOrganization',
  'keyStrengths',
  'notes',
] as const

export class JobMaterialTemplateFieldDto {
  @IsIn(JOB_MATERIAL_FIELD_KEY_VALUES)
  key!: JobMaterialTemplateField['key']

  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  label!: string

  @IsBoolean()
  required!: boolean

  @IsInt()
  @Min(1)
  @Max(1000)
  maxLength!: number

  @IsOptional()
  @IsBoolean()
  multiline?: boolean

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  placeholder!: string
}

export class CreateJobMaterialTemplateDto {
  @IsIn(JOB_MATERIAL_TEMPLATE_TYPE_VALUES)
  type!: JobMaterialTemplateType

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  title!: string

  @IsString()
  @MaxLength(500)
  description!: string

  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(30, { each: true })
  tags!: string[]

  @IsString()
  @MaxLength(300)
  recommendedFor!: string

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  outputFilename!: string

  @IsInt()
  @Min(0)
  @Max(9999)
  sortOrder!: number

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => JobMaterialTemplateFieldDto)
  fields!: JobMaterialTemplateFieldDto[]

  @IsOptional()
  @IsObject()
  resumeLayoutPreset?: ResumeTemplateLayoutPreset
}

export class UpdateJobMaterialTemplateDto {
  @IsOptional()
  @IsIn(JOB_MATERIAL_TEMPLATE_TYPE_VALUES)
  type?: JobMaterialTemplateType

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  title?: string

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(30, { each: true })
  tags?: string[]

  @IsOptional()
  @IsString()
  @MaxLength(300)
  recommendedFor?: string

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  outputFilename?: string

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(9999)
  sortOrder?: number

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => JobMaterialTemplateFieldDto)
  fields?: JobMaterialTemplateFieldDto[]

  @IsOptional()
  @IsObject()
  resumeLayoutPreset?: ResumeTemplateLayoutPreset
}
