import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator'
import type { FilePurpose } from '../files/file.types'

export type UploadSessionMode = 'temporary' | 'member'
export type UploadSessionStatus = 'pending' | 'uploading' | 'uploaded' | 'confirmed' | 'expired' | 'cancelled'
export type UploadSessionChannel = 'phone_h5'

export class CreateUploadSessionDto {
  @IsIn(['resume_upload'])
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
