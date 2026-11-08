import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsISO8601,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator'
import { Transform, Type } from 'class-transformer'
import { RESUME_DOC_LIMITS as L } from '../resume/resume-doc-limits'

/**
 * 简历导出格式(Wave 1 Task 6)。本地字面量联合,镜像
 * packages/shared/src/types/ai.ts 的 ResumeExportFormat——services/api 走
 * commonjs + node moduleResolution,与 ESM-only 的 shared 包直接互操作有兼容
 * 风险,本项目约定后端类型本地镜像(参见 files/file.types.ts 顶部说明)。
 * 改动需同步两处。
 */
export type ResumeExportFormat = 'pdf' | 'docx' | 'txt' | 'md'
export type ResumeLayoutFontScale = 'compact' | 'standard' | 'large'
export type ResumeLayoutLineSpacing = 'compact' | 'standard' | 'relaxed'
export type ResumeLayoutMargin = 'narrow' | 'normal' | 'wide'
export type ResumeLayoutColumns = 1 | 2
export type ResumeLayoutAccent = 'blue' | 'green' | 'slate'
export type ResumeLayoutAdjustAction = 'reformat' | 'condense'

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
  // 原简历可能没有求职意向；缺省归一为空，生成、调整、导出都不替用户编造岗位。
  @IsOptional() @IsString() @MaxLength(60)
  position = ''

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

  /**
   * 职务可以不填（10/6 总指挥定）：用户只写了公司、没写职务的经历也是真实经历，照样参与生成，职务保持为空。
   * null / 缺省一律规整成 ''，下游组装原样复制，润色里不许补出职务（见 llm-resume-generate.service.ts）。
   */
  @Transform(({ value }) => (typeof value === 'string' ? value : ''))
  @IsOptional() @IsString() @MaxLength(60)
  role: string = ''

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
  intention = new ResumeGenIntentionDto()

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

export class ResumeLayoutDto {
  @IsOptional() @IsIn(['compact', 'standard', 'large'])
  fontScale?: ResumeLayoutFontScale

  @IsOptional() @IsIn(['compact', 'standard', 'relaxed'])
  lineSpacing?: ResumeLayoutLineSpacing

  @IsOptional() @IsIn(['narrow', 'normal', 'wide'])
  margin?: ResumeLayoutMargin

  @IsOptional() @IsIn([1, 2])
  columns?: ResumeLayoutColumns

  @IsOptional() @IsIn(['blue', 'green', 'slate'])
  accent?: ResumeLayoutAccent
}

/**
 * 「优化稿」的条目校验：导出、排版调整、存草稿三处共用。
 *
 * 和上面给「AI 生成」用的录入校验分开：优化稿来自用户上传的原件，原件里只写了公司没写职务、
 * 或者一条经历只有一段话都很常见，标题类字段必须允许为空，否则优化接口吐出来的结果自己都导不出去。
 * 上限取自 RESUME_DOC_LIMITS，优化出口用同一份数字收口，两头不会再各说各的。
 */
export class ResumeDocBasicDto {
  @IsString() @MaxLength(L.name)
  name = ''

  @IsOptional() @IsString() @MaxLength(30)
  phone?: string

  @IsOptional() @IsString() @MaxLength(100)
  email?: string

  @IsOptional() @IsString() @MaxLength(50)
  city?: string
}

export class ResumeDocEducationDto {
  @IsString() @MaxLength(L.title)
  school = ''

  @IsOptional() @IsString() @MaxLength(L.major)
  major?: string

  @IsOptional() @IsString() @MaxLength(L.degree)
  degree?: string

  @IsOptional() @IsString() @MaxLength(L.period)
  period?: string

  @IsOptional() @IsString() @MaxLength(L.description)
  description?: string
}

export class ResumeDocExperienceDto {
  @IsString() @MaxLength(L.title)
  company = ''

  // 原件只写公司没写职务时如实留空；模板在职务为空时不印空标题。
  @IsString() @MaxLength(L.role)
  role = ''

  @IsOptional() @IsString() @MaxLength(L.period)
  period?: string

  @IsString() @MaxLength(L.description)
  description = ''
}

export class ResumeDocProjectDto {
  @IsString() @MaxLength(L.title)
  name = ''

  @IsOptional() @IsString() @MaxLength(L.role)
  role?: string

  @IsString() @MaxLength(L.description)
  description = ''
}

/** 优化稿正文：导出与排版调整 / 存草稿都从这里继承，字段只写一遍。 */
export class ResumeDocBodyDto {
  @IsObject() @ValidateNested() @Type(() => ResumeDocBasicDto)
  basic!: ResumeDocBasicDto

  @IsObject() @ValidateNested() @Type(() => ResumeGenIntentionDto)
  intention = new ResumeGenIntentionDto()

  @IsString() @MaxLength(L.summary)
  summary!: string

  @IsArray() @ArrayMaxSize(L.education) @ValidateNested({ each: true }) @Type(() => ResumeDocEducationDto)
  education!: ResumeDocEducationDto[]

  @IsArray() @ArrayMaxSize(L.experience) @ValidateNested({ each: true }) @Type(() => ResumeDocExperienceDto)
  experience!: ResumeDocExperienceDto[]

  @IsArray() @ArrayMaxSize(L.projects) @ValidateNested({ each: true }) @Type(() => ResumeDocProjectDto)
  projects!: ResumeDocProjectDto[]

  @IsArray() @ArrayMaxSize(L.skills) @IsString({ each: true }) @MaxLength(L.skill, { each: true })
  skills!: string[]

  @IsArray() @ArrayMaxSize(L.certificates) @IsString({ each: true }) @MaxLength(L.certificate, { each: true })
  certificates!: string[]
}

/** 导出 PDF:内容 = 用户在预览页确认/编辑后的最终简历(summary 为已润色文本)。 */
export class ResumeGenerateExportDto extends ResumeDocBodyDto {
  /** 关联的生成任务(仅审计溯源用,可缺省) */
  @IsOptional() @IsString() @MaxLength(100)
  taskId?: string

  /**
   * 原样草稿导出：内容逐字来自用户填写，**未经模型润色**。
   *
   * AI 生成失败时前端仍允许把已填内容导出成 PDF 打印带走（不然用户在一台打印终端上
   * 一张纸也拿不走）。这个标记只影响**元数据诚实性**：为 true 时 PDF 写
   * AIGenerated='false'，不把一份一个字都不是 AI 写的文件标成 AI 产物。
   * 排版与既有导出逐字一致，不引入第二套版式。
   */
  @IsOptional() @IsBoolean()
  draft?: boolean

  /** 开关开启时可申请不带页脚显式标识的版本；隐式标识仍保留。 */
  @IsOptional() @IsBoolean()
  unlabeled?: boolean

  /** 导出格式,缺省 pdf。docx/txt/md 页数恒为 0。 */
  @IsOptional() @IsIn(['pdf', 'docx', 'txt', 'md'])
  format?: ResumeExportFormat

  /** Resume template id(Wave 3): only PDF applies template layout; other formats ignore it. */
  @IsOptional() @IsString() @MaxLength(80)
  templateId?: string

  /** PDF 排版参数(Wave 2):仅 PDF 消费;docx/txt/md 忽略该字段且不伪造排版效果。 */
  @IsOptional() @IsObject() @ValidateNested() @Type(() => ResumeLayoutDto)
  layout?: ResumeLayoutDto

  /** 收费导出时核销的本人权益 id；免费模式忽略。 */
  @IsOptional() @IsString() @MaxLength(80)
  benefitGrantId?: string

  /**
   * 事实核对确认时间（ISO 8601）。登录用户导出优化稿必填；
   * 缺失或无效 → 400 RESUME_FACTS_NOT_CONFIRMED。匿名由前端弹窗后传入。
   */
  @IsOptional() @IsISO8601({ strict: true })
  factsConfirmedAt?: string
}

export class ResumeLayoutAdjustResumeDto extends ResumeDocBodyDto {}

export class ResumeLayoutAdjustDto {
  @IsObject() @ValidateNested() @Type(() => ResumeLayoutAdjustResumeDto)
  resume!: ResumeLayoutAdjustResumeDto

  @IsIn(['reformat', 'condense'])
  action!: ResumeLayoutAdjustAction

  @IsOptional() @IsObject() @ValidateNested() @Type(() => ResumeLayoutDto)
  layout?: ResumeLayoutDto
}
