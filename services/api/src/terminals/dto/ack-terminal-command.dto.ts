import { IsIn, IsString } from 'class-validator'

const ACK_RESULTS = ['accepted', 'rejected_busy', 'expired'] as const

export class AckTerminalCommandDto {
  @IsString()
  @IsIn(ACK_RESULTS)
  result!: (typeof ACK_RESULTS)[number]
}
