import { IsIn, IsInt, IsNotEmpty, IsString, Max, Min } from 'class-validator'

/** 小程序 M2 第一片仅开放已经过 Windows 真机验证的 A4 黑白单面参数。 */
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

  @IsIn(['black_white'])
  colorMode!: 'black_white'

  @IsIn(['simplex'])
  duplex!: 'simplex'
}
