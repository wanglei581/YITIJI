import { IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator'

export const MEMBER_STEP_UP_ACTIONS = [
  'export_data_request',
  'export_data_download',
  'close_account',
] as const

export type MemberStepUpAction = (typeof MEMBER_STEP_UP_ACTIONS)[number]

export class SendMemberStepUpCodeDto {
  @IsIn([...MEMBER_STEP_UP_ACTIONS])
  action!: MemberStepUpAction

  @IsOptional()
  @IsString()
  @MaxLength(120)
  deviceId?: string
}

export class VerifyMemberStepUpDto {
  @IsUUID()
  challengeId!: string

  @Matches(/^\d{6}$/)
  code!: string

  @IsOptional()
  @IsString()
  @MaxLength(120)
  deviceId?: string
}
