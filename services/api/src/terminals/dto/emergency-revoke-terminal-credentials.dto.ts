import { IsIn, IsInt, IsString, Matches, MaxLength, Min, MinLength } from 'class-validator'

export class EmergencyRevokeTerminalCredentialsDto {
  @IsIn(['commissioning', 'active', 'maintenance', 'suspended'])
  expectedStatus!: 'commissioning' | 'active' | 'maintenance' | 'suspended'

  @IsInt()
  @Min(0)
  expectedVersion!: number

  @IsInt()
  @Min(0)
  expectedCredentialGeneration!: number

  @IsString()
  @MinLength(8)
  @MaxLength(500)
  @Matches(/\S/, { message: 'reason 不能为空白' })
  reason!: string

  @IsString()
  @MaxLength(128)
  confirmationText!: string
}
