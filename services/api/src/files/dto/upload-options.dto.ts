import { IsEnum, IsOptional } from 'class-validator'

/**
 * 上传时除 multipart file 之外可选的 form fields。
 *
 * purpose 决定默认 sensitiveLevel 和 TTL:
 *   resume_upload / resume_scan / id_scan → highly_sensitive(1h)/ sensitive(6h)
 *   print_doc / fair_material / cover_letter → normal(24h)
 *
 * 如显式传 sensitiveLevel,会覆盖 purpose 默认值(更严的有效)。
 */
export class UploadOptionsDto {
  @IsEnum([
    'resume_upload',
    'resume_scan',
    'id_scan',
    'print_doc',
    'fair_material',
    'cover_letter',
  ])
  purpose!: string

  @IsOptional()
  @IsEnum(['normal', 'sensitive', 'highly_sensitive'])
  sensitiveLevel?: string
}
