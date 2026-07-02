import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator'
import { Type } from 'class-transformer'

/**
 * 简历导出格式(Wave 1 Task 6)。本地字面量联合,镜像
 * packages/shared/src/types/ai.ts 的 ResumeExportFormat——services/api 走
 * commonjs + node moduleResolution,与 ESM-only 的 shared 包直接互操作有兼容
 * 风险,本项目约定后端类型本地镜像(参见 files/file.types.ts 顶部说明)。
 * 改动需同步两处。
 */
export type ResumeExportFormat = 'pdf' | 'docx' | 'txt' | 'md'

/**
 * 阶段2A AI 简历生成 DTO。
 *
 * 全局 ValidationPipe whitelist + forbidNonWhitelisted 生效:任何超出白名单的字段
 * (身份证号 / 候选人评级 / 企业侧字段等)直接 400 拒绝。
 *
 * 上限设计:公共一体机触控录入场景,数量与长度都收紧(也控 LLM 成本与版面)。
 * 合规:输入只是求职者本人提供的简历资料;AI 只润色,不编造(契约在 service 层强制)。
 */

export class ResumeGenBasicDto {
  @IsString() @IsNotEmpty() @MaxLength(50)
  name!: string

  @IsOptional() @IsString() @MaxLength(30)
  phone?: string

  @IsOptional() @IsString() @MaxLength(100)
  email?: string

  @IsOptional() @IsString() @MaxLength(50)
  city?: string
}

export class ResumeGenIntentionDto {
  @IsString() @IsNotEmpty() @MaxLength(60)
  position!: string

  @IsOptional() @IsString() @MaxLength(50)
  city?: string

  @IsOptional() @IsString() @MaxLength(20)
  jobType?: string

  @IsOptional() @IsString() @MaxLength(40)
  salary?: string
}

export class ResumeGenEducationDto {
  @IsString() @IsNotEmpty() @MaxLength(100)
  school!: string

  @IsOptional() @IsString() @MaxLength(60)
  major?: string

  @IsOptional() @IsString() @MaxLength(20)
  degree?: string

  @IsOptional() @IsString() @MaxLength(40)
  period?: string

  @IsOptional() @IsString() @MaxLength(1000)
  description?: string
}

export class ResumeGenExperienceDto {
  @IsString() @IsNotEmpty() @MaxLength(100)
  company!: string

  @IsString() @IsNotEmpty() @MaxLength(60)
  role!: string

  @IsOptional() @IsString() @MaxLength(40)
  period?: string

  @IsString() @MaxLength(1000)
  description!: string
}

export class ResumeGenProjectDto {
  @IsString() @IsNotEmpty() @MaxLength(100)
  name!: string

  @IsOptional() @IsString() @MaxLength(60)
  role?: string

  @IsString() @MaxLength(1000)
  description!: string
}

export class ResumeGenerateRequestDto {
  @IsObject() @ValidateNested() @Type(() => ResumeGenBasicDto)
  basic!: ResumeGenBasicDto

  @IsObject() @ValidateNested() @Type(() => ResumeGenIntentionDto)
  intention!: ResumeGenIntentionDto

  @IsArray() @ArrayMaxSize(6) @ValidateNested({ each: true }) @Type(() => ResumeGenEducationDto)
  education!: ResumeGenEducationDto[]

  @IsArray() @ArrayMaxSize(8) @ValidateNested({ each: true }) @Type(() => ResumeGenExperienceDto)
  experience!: ResumeGenExperienceDto[]

  @IsArray() @ArrayMaxSize(6) @ValidateNested({ each: true }) @Type(() => ResumeGenProjectDto)
  projects!: ResumeGenProjectDto[]

  @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(40, { each: true })
  skills!: string[]

  @IsArray() @ArrayMaxSize(15) @IsString({ each: true }) @MaxLength(60, { each: true })
  certificates!: string[]

  @IsOptional() @IsString() @MaxLength(500)
  selfIntro?: string
}

/** 导出 PDF:内容 = 用户在预览页确认/编辑后的最终简历(summary 为已润色文本)。 */
export class ResumeGenerateExportDto {
  @IsObject() @ValidateNested() @Type(() => ResumeGenBasicDto)
  basic!: ResumeGenBasicDto

  @IsObject() @ValidateNested() @Type(() => ResumeGenIntentionDto)
  intention!: ResumeGenIntentionDto

  @IsString() @MaxLength(600)
  summary!: string

  @IsArray() @ArrayMaxSize(6) @ValidateNested({ each: true }) @Type(() => ResumeGenEducationDto)
  education!: ResumeGenEducationDto[]

  @IsArray() @ArrayMaxSize(8) @ValidateNested({ each: true }) @Type(() => ResumeGenExperienceDto)
  experience!: ResumeGenExperienceDto[]

  @IsArray() @ArrayMaxSize(6) @ValidateNested({ each: true }) @Type(() => ResumeGenProjectDto)
  projects!: ResumeGenProjectDto[]

  @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(40, { each: true })
  skills!: string[]

  @IsArray() @ArrayMaxSize(15) @IsString({ each: true }) @MaxLength(60, { each: true })
  certificates!: string[]

  /** 关联的生成任务(仅审计溯源用,可缺省) */
  @IsOptional() @IsString() @MaxLength(100)
  taskId?: string

  /** 导出格式,缺省 pdf。docx/txt/md 页数恒为 0。 */
  @IsOptional() @IsIn(['pdf', 'docx', 'txt', 'md'])
  format?: ResumeExportFormat
}
