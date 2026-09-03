import { IsIn, IsInt, IsString, Matches, MaxLength, Min, MinLength } from 'class-validator'

export class UpdateReleaseObservationPlanDto {
  @IsIn(['activate', 'pause', 'cancel'])
  action!: 'activate' | 'pause' | 'cancel'

  @IsInt()
  @Min(1)
  expectedVersion!: number

  @IsString()
  @MinLength(8)
  @MaxLength(500)
  @Matches(/\S/, { message: 'reason 不能为空白' })
  reason!: string
}
