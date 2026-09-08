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
 * 场景码兑换入参。长度上限 32 —— 微信 `getwxacodeunlimit` 的 scene 硬限制，
 * 超过这个长度的输入不可能是我们签发的码，在 DTO 层就挡掉。
 */
export class ResolveUploadSceneDto {
  @IsString()
  @MaxLength(32)
  scene!: string
}
