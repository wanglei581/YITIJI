import { Equals, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator'
import { ROTATE_CREDENTIAL_CONFIRMATION } from '../data-source-credential-policy'

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
   *
   * DTO 下限 8 是 API token 的地板。Webhook 自填密钥另有 32 位 + 熵检查，
   * 在 service 写路径执行（见 assertWebhookSecretStrength），不在这里一刀切——
   * 上游 API token 可能短于 32。
   */
  @IsOptional() @IsString() @MinLength(8) @MaxLength(5000)
  credential?: string
}

/**
 * `POST /partner/data-sources/:id/rotate-credential` 的请求体。
 *
 * 语义按 accessMode 分叉（服务端 rotatePartnerDataSourceCredential 强制）：
 *   - `webhook`：`credential` 可选。留空 = 由服务端用 CSPRNG 生成新密钥；
 *     传值 = 使用机构自带的密钥（对方系统已固定密钥时用）。
 *   - `api`：`credential` **必填**。上游 token 只能由机构从来源平台取得，
 *     平台不可能代为签发；这里只负责加密保存。
 *
 * 与 CreateDataSourceDto.credential 一样：只进不出，任何响应都不回显本字段原值。
 *
 * `confirmPhrase` 必填且必须等于 {@link ROTATE_CREDENTIAL_CONFIRMATION}。
 * 空 body 在 ValidationPipe 就会 400，不能再靠一次 POST 立刻作废线上密钥。
 */
export class RotateDataSourceCredentialDto {
  @IsOptional() @IsString() @MinLength(8) @MaxLength(5000)
  credential?: string

  @IsString()
  @Equals(ROTATE_CREDENTIAL_CONFIRMATION)
  confirmPhrase!: typeof ROTATE_CREDENTIAL_CONFIRMATION
}
