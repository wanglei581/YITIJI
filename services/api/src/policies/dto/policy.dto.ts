import { Transform, Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsISO8601,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  ValidateNested,
} from 'class-validator'
import {
  POLICY_ELIGIBILITY_QUESTION_KEYS,
  POLICY_RULE_MATCH_MODES,
} from '../policy-eligibility.types'

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

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? undefined : value))
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true }) @MaxLength(500)
  externalUrl?: string

  /** 来源方原始编号(如发文字号)。CLAUDE.md §10 的「外部ID」要素。 */
  @IsOptional() @IsString() @MaxLength(120)
  externalId?: string

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

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? undefined : value))
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true }) @MaxLength(500)
  externalUrl?: string

  @IsOptional() @IsString() @MaxLength(120)
  externalId?: string

  @IsOptional() @IsISO8601()
  publishedDate?: string
}

// ── P21 政策条件核对（S3-2）────────────────────────────────────────────────
//
// 与本文件其它 DTO 同处一个域，不另起文件（CLAUDE.md §8 反堆砌）。
// 判定语义与三态守卫在 policy-eligibility.engine.ts 里；这里只做
// class-validator 层的形状与白名单校验（全局 forbidNonWhitelisted 生效）。

export class PolicyEligibilityClauseDto {
  @IsIn([...POLICY_ELIGIBILITY_QUESTION_KEYS])
  questionKey!: string

  /** 命中即「相符」。'unsure' 由引擎层拒绝，不在这里放行/拦截。 */
  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(8) @IsString({ each: true })
  satisfiedValues!: string[]

  /** 命中即「不符」。可空 —— 没有明确不符取值时，其余取值一律「无法判定」。 */
  @IsOptional() @IsArray() @ArrayMaxSize(8) @IsString({ each: true })
  conflictValues?: string[]
}

export class PolicyEligibilityRuleDto {
  @IsString() @IsNotEmpty() @MaxLength(120)
  label!: string

  /** 政策原文摘录，一字不改 —— 判定唯一可追溯的依据，必填。 */
  @IsString() @IsNotEmpty() @MaxLength(2000)
  sourceText!: string

  /** 'all' / 'any' = 机械比对；'manual' = 只能人工核对（必须零子句）。 */
  @IsIn([...POLICY_RULE_MATCH_MODES])
  matchMode!: string

  /**
   * 机械比对模式下必填且非空；'manual' 模式必须为空/省略。
   *
   * 「非空」与「manual 零子句」两条都由引擎层的 validatePolicyEligibilityRules
   * 判定（POLICY_RULE_CLAUSES_REQUIRED / POLICY_RULE_MANUAL_CLAUSES_NOT_ALLOWED），
   * 不在这里用 @ValidateIf 表达 —— class-validator 的 @ValidateIf 为假时会跳过
   * 该属性**全部**校验（含 @IsArray / @ValidateNested），等于给 manual 开了一个
   * 不校验形状的口子。这里只留形状校验，语义交给一处判定。
   */
  @IsOptional() @IsArray() @ArrayMaxSize(4)
  @ValidateNested({ each: true })
  @Type(() => PolicyEligibilityClauseDto)
  clauses?: PolicyEligibilityClauseDto[]
}

/**
 * 录入面「试算」：拿一组假想作答预览判定结果。
 *
 * 只有 answers，没有 rules —— 预览的是**库里已保存**的条件。
 * 若允许预览未保存的条件，运营看到的绿灯与真正入库的条件可能不是同一份。
 */
export class PolicyEligibilityPreviewDto {
  @IsOptional() @IsObject()
  answers?: Record<string, unknown>
}

export class ReplacePolicyEligibilityRulesDto {
  /** 整组替换；传空数组表示撤下该政策的全部结构化条件。 */
  @IsArray() @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => PolicyEligibilityRuleDto)
  rules!: PolicyEligibilityRuleDto[]
}

export class PolicyEligibilityCheckDto {
  /**
   * 作答：{ questionKey: optionValue }。
   * 用 IsObject 而非嵌套 DTO —— 键集合由 policy-eligibility.types 的问项字典
   * 决定，服务端 sanitizeAnswers 会丢弃未登记的键与非法取值，
   * 因此这里不再重复一份白名单（重复一份必然会和字典漂移）。
   * 作答不落库，见 policy-eligibility.service.ts 的隐私口径。
   */
  @IsOptional() @IsObject()
  answers?: Record<string, unknown>

  /** 只核对指定政策；不传则核对全部已发布的政策扶持条目。 */
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true })
  policyIds?: string[]
}
