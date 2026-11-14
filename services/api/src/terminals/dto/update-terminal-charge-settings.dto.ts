import { Type } from 'class-transformer'
import { IsIn, IsInt, Max, Min, ValidateNested } from 'class-validator'
import { TERMINAL_CHARGE_MAX_UNIT_CENTS } from '../../payment/terminal-charge.contract'

export class TerminalChargePricesDto {
  @IsInt()
  @Min(0)
  @Max(TERMINAL_CHARGE_MAX_UNIT_CENTS)
  resume_optimize!: number

  @IsInt()
  @Min(0)
  @Max(TERMINAL_CHARGE_MAX_UNIT_CENTS)
  mock_interview!: number

  @IsInt()
  @Min(0)
  @Max(TERMINAL_CHARGE_MAX_UNIT_CENTS)
  print_bw_page!: number

  @IsInt()
  @Min(0)
  @Max(TERMINAL_CHARGE_MAX_UNIT_CENTS)
  print_color_page!: number

  @IsInt()
  @Min(0)
  @Max(TERMINAL_CHARGE_MAX_UNIT_CENTS)
  scan!: number
}

export class UpdateTerminalChargeSettingsDto {
  @IsIn(['org_pays', 'user_pays'])
  userChargeMode!: 'org_pays' | 'user_pays'

  @ValidateNested()
  @Type(() => TerminalChargePricesDto)
  prices!: TerminalChargePricesDto
}
