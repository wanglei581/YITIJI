import { IsIn, IsNotEmpty, IsString } from 'class-validator'

/**
 * 敏感列关键词列表（大小写不敏感、含子串匹配）。
 * 命中任意一个 → 400，不得导入。
 *
 * 规则：只展示公开岗位/招聘会信息，不得导入求职者个人信息。
 */
export const SENSITIVE_COLUMN_PATTERNS: string[] = [
  '手机', '手机号', '电话', 'tel', 'mobile', 'phone',
  '邮箱', 'email', 'mail',
  '简历', 'resume', 'cv',
  '候选人', 'candidate',
  '姓名',
  '报名', '投递', '面试', 'offer',
]

/** 检查列名是否命中敏感词（大小写不敏感，子串匹配） */
export function isSensitiveColumn(col: string): boolean {
  const lower = col.toLowerCase().replace(/\s+/g, '')
  return SENSITIVE_COLUMN_PATTERNS.some((p) => lower.includes(p.toLowerCase().replace(/\s+/g, '')))
}

/** POST /partner/excel/preview 的 JSON 字段（multipart 里的文本字段） */
export class ExcelPreviewDto {
  @IsString() @IsNotEmpty()
  sourceId!: string

  @IsIn(['job', 'fair'])
  dataType!: 'job' | 'fair'

  /** JSON 序列化的字段映射，例 '{"externalId":"外部ID","title":"职位名称",...}' */
  @IsString() @IsNotEmpty()
  fieldMapping!: string
}

/**
 * 岗位 Excel 白名单字段。
 * 任何超出此列表的字段（候选人/简历/面试/Offer）不允许导入。
 */
export const JOB_STANDARD_FIELDS = [
  'externalId', 'title', 'company', 'city', 'sourceUrl',
  'salary', 'description', 'requirements', 'industry', 'workType',
  'educationRequirement', 'experienceRequirement', 'skills', 'benefits',
  'salaryMin', 'salaryMax', 'salaryUnit', 'validThrough',
] as const
export type JobStandardField = typeof JOB_STANDARD_FIELDS[number]

export const JOB_REQUIRED_FIELDS: JobStandardField[] = ['externalId', 'title', 'company', 'city', 'sourceUrl']

/**
 * 招聘会 Excel 白名单字段。
 */
export const FAIR_STANDARD_FIELDS = [
  'externalId', 'title', 'startAt', 'endAt', 'venue', 'city', 'sourceUrl',
  'theme', 'address', 'description', 'companyCount', 'jobCount',
] as const
export type FairStandardField = typeof FAIR_STANDARD_FIELDS[number]

export const FAIR_REQUIRED_FIELDS: FairStandardField[] = ['externalId', 'title', 'startAt', 'endAt', 'venue', 'city', 'sourceUrl']

/** 字段映射：standardField → Excel 列名 */
export type FieldMapping = Record<string, string>

/** 单行解析结果 */
export interface ParsedRow {
  rowIndex: number
  rawData: Record<string, string>
  mapped: Record<string, string>
  status: 'ok' | 'invalid' | 'dup'
  errors: string[]
  externalId?: string
}
