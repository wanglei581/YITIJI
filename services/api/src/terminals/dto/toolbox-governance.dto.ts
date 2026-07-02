import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator'

const APP_CATEGORIES = ['print', 'exam', 'career', 'legal', 'hr', 'campus', 'life'] as const
const APP_PRIORITIES = ['high', 'medium', 'low'] as const
const RISK_LEVELS = ['low', 'medium', 'high', 'restricted'] as const
const HOST_PURPOSES = ['web_app', 'qr_target', 'asset'] as const

export class CreateToolboxAppDto {
  @IsString()
  @MaxLength(64)
  appKey!: string

  @IsString()
  @MaxLength(32)
  title!: string

  @IsString()
  @MaxLength(80)
  shortDescription!: string

  @IsIn(APP_CATEGORIES)
  category!: string

  @IsIn(APP_PRIORITIES)
  priority!: string

  @IsIn(RISK_LEVELS)
  riskLevel!: string
}

export class CreateToolboxAppVersionDto {
  @IsObject()
  snapshot!: Record<string, unknown>
}

export class RejectToolboxAppVersionDto {
  @IsString()
  @MaxLength(200)
  reason!: string
}

export class PublishToolboxAppVersionDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MaxLength(128, { each: true })
  terminalIds?: string[]
}

export class UpsertToolboxAllowedHostDto {
  @IsString()
  @MaxLength(128)
  host!: string

  @IsIn(HOST_PURPOSES)
  purpose!: 'web_app' | 'qr_target' | 'asset'

  @IsString()
  @MaxLength(80)
  owner!: string

  @IsString()
  @MaxLength(200)
  reason!: string

  @IsOptional()
  @IsString()
  @MaxLength(40)
  expiresAt?: string
}

export class ReviewToolboxAllowedHostDto {
  @IsIn(['active', 'suspended', 'expired', 'archived'])
  status!: 'active' | 'suspended' | 'expired' | 'archived'

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string

  @IsOptional()
  @IsString()
  @MaxLength(40)
  expiresAt?: string
}
