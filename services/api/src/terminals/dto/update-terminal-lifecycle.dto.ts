import { IsIn, IsInt, IsString, Matches, MaxLength, Min, MinLength } from 'class-validator'

export class UpdateTerminalLifecycleDto {
  @IsIn(['active', 'maintenance'])
  targetStatus!: 'active' | 'maintenance'

  @IsIn(['active', 'maintenance'])
  expectedStatus!: 'active' | 'maintenance'

  @IsInt()
  @Min(0)
  expectedVersion!: number

  @IsString()
  @MinLength(8)
  @MaxLength(500)
  @Matches(/\S/, { message: 'reason 不能为空白' })
  reason!: string
}
