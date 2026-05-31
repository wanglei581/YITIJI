import { IsEnum } from 'class-validator'

/**
 * Kiosk 匿名上传 DTO。
 *
 * 与 UploadOptionsDto 的区别:
 *   - purpose 白名单更严:只允许 Kiosk 业务场景
 *   - sensitiveLevel 不允许调用方传(全部由后端按 purpose 推断,
 *     防止恶意调用方传 'normal' 把简历 TTL 拉成 24h)
 */
export class KioskUploadOptionsDto {
  @IsEnum([
    'resume_upload',
    'resume_scan',
    'id_scan',
    'print_doc',
    'fair_material',
    'cover_letter',
  ])
  purpose!: string
}
