import { IsIn, IsOptional } from 'class-validator'

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
  @IsIn([
    'resume_upload',
    'resume_scan',
    'id_scan',
    'print_doc',
    'fair_material',
    'cover_letter',
    // COS 接入新增(机构 / 管理员 / 屏保素材)
    'partner_profile',
    'partner_image',
    'partner_video',
    'job_fair_material',
    'screensaver_material',
    'admin_upload',
    'temp',
  ])
  purpose!: string

  @IsOptional()
  @IsIn(['normal', 'sensitive', 'highly_sensitive'])
  sensitiveLevel?: string
}
