import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator'

/**
 * 创建上传意图 DTO(POST /files/upload-intent)。
 *
 * 用于"直传"模式:服务端返回 COS 预签名 PUT URL(或本地代理 PUT),
 * 客户端直传后再调 POST /files/:id/complete 确认。
 *
 * 校验:purpose / mimeType / filename 必填;sizeBytes 用于上限预校验
 * (最终以 complete 的 headObject 实测为准)。
 */
const ALL_PURPOSES = [
  'resume_upload',
  'resume_scan',
  'id_scan',
  'print_doc',
  'fair_material',
  'cover_letter',
  'partner_profile',
  'partner_image',
  'partner_video',
  'job_fair_material',
  'screensaver_material',
  'admin_upload',
  'temp',
]

export class CreateUploadIntentDto {
  @IsIn(ALL_PURPOSES)
  purpose!: string

  @IsString()
  @MaxLength(255)
  filename!: string

  @IsString()
  @MaxLength(127)
  mimeType!: string

  @IsOptional()
  @IsInt()
  @Min(1)
  sizeBytes?: number

  @IsOptional()
  @IsIn(['normal', 'sensitive', 'highly_sensitive'])
  sensitiveLevel?: string

  @IsOptional()
  @IsString()
  @MaxLength(64)
  sha256?: string
}
