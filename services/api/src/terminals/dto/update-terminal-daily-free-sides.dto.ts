import { IsInt, Max, Min, ValidateIf } from 'class-validator'

/** null = 用全站默认。字段必须出现；缺省由校验拒绝，避免静默不改。 */
export class UpdateTerminalDailyFreeSidesDto {
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(1)
  @Max(10000)
  dailyFreePrintSides!: number | null
}
