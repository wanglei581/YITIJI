import { IsIn, IsInt, IsNotEmpty, IsString, Max, Min, ValidateIf } from 'class-validator'

/**
 * 小程序 M2 打印下单参数（A4）。
 *
 * 彩色 / 双面取值在 DTO 放开，但准入仍由服务端两层门禁决定：本 DTO 带 terminalId，
 * 建单时由 TerminalCapabilitiesService.assertPrintParamsAllowed() 按该终端判定；
 * 未登记 color_print / duplex_print 的机器一律拒绝（fail-closed），
 * 避免「按彩色付费、拿到黑白纸」。
 */
export class CreateMemberPrintOrderDto {
  @IsString()
  @IsNotEmpty()
  fileId!: string

  @IsString()
  @IsNotEmpty()
  terminalId!: string

  @IsInt()
  @Min(1)
  @Max(99)
  copies!: number

  @IsIn(['black_white', 'color'])
  colorMode!: 'black_white' | 'color'

  @IsIn(['simplex', 'duplex_long_edge', 'duplex_short_edge'])
  duplex!: 'simplex' | 'duplex_long_edge' | 'duplex_short_edge'

  /**
   * 用户确认的应付金额（分）。只作一致性断言，绝不作为计价来源。
   * 缺省才是旧客户端；显式 null / 字符串 / 负数 / 小数必须 400，所以用 ValidateIf 而不是 IsOptional。
   */
  @ValidateIf((dto: CreateMemberPrintOrderDto) => dto.quotedAmountCents !== undefined)
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  quotedAmountCents?: number
}
