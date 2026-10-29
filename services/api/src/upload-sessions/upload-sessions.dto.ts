import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator'
import type { FilePurpose } from '../files/file.types'

export type UploadSessionMode = 'temporary' | 'member'
export type UploadSessionStatus =
  | 'pending'
  | 'uploading'
  | 'uploaded'
  | 'confirmed'
  | 'expired'
  | 'cancelled'
export type UploadSessionChannel = 'phone_h5'
/**
 * 这份文件从哪来，只给一体机确认屏提示用（本人认出不是自己传的就点取消）：
 * miniapp_documents = 小程序「我的文档」递进（member-file），miniapp = 小程序直传
 * （Referer 是 https://servicewechat.com/ 开头），web = 其余手机直传。
 * Referer 谁都能伪造，**不作任何安全判断**。旧会话记录没有这个字段。
 */
export type UploadSessionFileSource = 'miniapp_documents' | 'miniapp' | 'web'

export class CreateUploadSessionDto {
  @IsIn(['resume_upload', 'print_doc', 'contract_upload'])
  purpose!: FilePurpose

  @IsIn(['temporary', 'member'])
  mode!: UploadSessionMode

  @IsIn(['phone_h5'])
  channel!: UploadSessionChannel

  @IsOptional()
  @IsString()
  @MaxLength(80)
  terminalId?: string | null
}

export class PhoneUploadSessionDto {
  @IsString()
  uploadToken!: string
}

/**
 * 小程序会员把本人文档递进上传会话。uploadToken 与 `:sessionId/files` 同一把
 * （现有令牌 43 字符 base64url）；fileId 是「我的文档」里的文件 id（今天是 32 位十六进制）。
 * 不收 endUserId 之类字段：身份只认会员登录态，白名单外字段一律 400。
 */
export class MemberFileUploadSessionDto {
  @IsString()
  @MaxLength(128)
  uploadToken!: string

  @IsString()
  @MaxLength(64)
  fileId!: string
}

/**
 * 场景码兑换入参。长度上限 32 —— 微信 `getwxacodeunlimit` 的 scene 硬限制，
 * 超过这个长度的输入不可能是我们签发的码，在 DTO 层就挡掉。
 */
export class ResolveUploadSceneDto {
  @IsString()
  @MaxLength(32)
  scene!: string
}
