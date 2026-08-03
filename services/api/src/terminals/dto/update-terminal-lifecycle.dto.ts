import { IsIn, IsInt, IsOptional, IsString, Matches, MaxLength, Min, MinLength } from 'class-validator'

export class UpdateTerminalLifecycleDto {
  @IsIn(['active', 'maintenance', 'suspended', 'retired'])
  targetStatus!: 'active' | 'maintenance' | 'suspended' | 'retired'

  @IsIn(['commissioning', 'active', 'maintenance', 'suspended'])
  expectedStatus!: 'commissioning' | 'active' | 'maintenance' | 'suspended'

  @IsInt()
  @Min(0)
  expectedVersion!: number

  @IsString()
  @MinLength(8)
  @MaxLength(500)
  @Matches(/\S/, { message: 'reason 不能为空白' })
  reason!: string

  @IsOptional()
  @IsString()
  @MaxLength(128)
  confirmationText?: string
}
