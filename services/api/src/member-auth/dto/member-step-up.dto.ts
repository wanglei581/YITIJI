import { IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator'
import { MEMBER_STEP_UP_ACTIONS, type MemberStepUpAction } from '../member-step-up.types'

export class SendMemberStepUpCodeDto {
  @IsIn(MEMBER_STEP_UP_ACTIONS)
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
