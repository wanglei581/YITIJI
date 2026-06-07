import { ArrayMaxSize, IsArray, IsIn, IsNotEmpty, IsString, ValidateNested } from 'class-validator'
import { Type } from 'class-transformer'

export const PII_DECISION_ACTIONS = ['keep', 'redact'] as const
export type PiiDecisionAction = typeof PII_DECISION_ACTIONS[number]

export class PiiFindingDecisionDto {
  @IsString()
  @IsNotEmpty()
  findingId!: string

  @IsIn(PII_DECISION_ACTIONS)
  action!: PiiDecisionAction
}

export class DecidePiiFindingsDto {
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => PiiFindingDecisionDto)
  decisions!: PiiFindingDecisionDto[]
}
