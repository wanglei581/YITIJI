import { IsIn, IsOptional } from 'class-validator'

/**
 * 上传时除 multipart file 之外可选的 form fields。
 *
 * purpose 决定默认 sensitiveLevel；实际 expiresAt 由 retention-policy 仲裁：
 *   - 未登录 / 匿名 / 证件 / 系统文件走 system_short，按 normal 24h / sensitive 6h / highly_sensitive 1h。
 *   - 登录会员简历/求职材料走 months_3 / months_6 / long_term 的账号资产策略。
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
