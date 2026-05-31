import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator'

export const SOURCE_KINDS = [
  'job_platform',
  'hr_company',
  'school',
  'fair_organizer',
  'aggregator',
  'manual',
] as const

export const ACCESS_MODES = ['api', 'excel', 'csv', 'json', 'webhook', 'manual'] as const
export const SYNC_FREQS = ['manual', 'hourly', 'daily', 'weekly'] as const
export const AUTH_TYPES = ['bearer', 'oauth2', 'api_key', 'basic', 'custom'] as const

export class CreateDataSourceDto {
  @IsString() @IsNotEmpty() @MaxLength(100)
  name!: string

  @IsOptional() @IsIn(SOURCE_KINDS)
  sourceKind?: string

  @IsOptional() @IsIn(ACCESS_MODES)
  accessMode?: string

  @IsOptional() @IsIn(SYNC_FREQS)
  syncFreq?: string

  @IsOptional() @IsString() @MaxLength(500)
  description?: string

  @IsOptional() @IsString() @MaxLength(500)
  endpoint?: string

  @IsOptional() @IsIn(AUTH_TYPES)
  authType?: string

  /**
   * API 凭证或 Webhook 共享密钥。只允许进入服务端，写库前必须加密；
   * 任何响应都不得回显该字段。
   */
  @IsOptional() @IsString() @MinLength(8) @MaxLength(5000)
  credential?: string
}
