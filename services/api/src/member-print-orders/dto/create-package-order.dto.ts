import { Type } from 'class-transformer'
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, Min, ValidateIf, ValidateNested } from 'class-validator'

export class PackagePrintParamsDto {
  @IsIn(['bw', 'black_white', 'color'])
  colorMode!: 'bw' | 'black_white' | 'color'

  @IsIn(['single', 'simplex', 'duplex_long_edge', 'duplex_short_edge'])
  duplex!: 'single' | 'simplex' | 'duplex_long_edge' | 'duplex_short_edge'

  @IsInt()
  @Min(1)
  @Max(99)
  copies!: number
}

export class PackageOrderFileDto {
  @IsString()
  @IsNotEmpty()
  fileId!: string

  @IsOptional()
  @IsString()
  pageRange?: string
}

/** 小程序材料包建单。页数、金额与文件名全部由服务端查证，前端传值不作为事实。 */
export class CreatePackageOrderDto {
  @IsString()
  @IsNotEmpty()
  terminalId!: string

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => PackageOrderFileDto)
  files!: PackageOrderFileDto[]

  @ValidateNested()
  @Type(() => PackagePrintParamsDto)
  params!: PackagePrintParamsDto

  /**
   * 用户确认的材料包应付总额（分）。只作一致性断言，绝不作为计价来源。
   * 缺省才是旧客户端；显式 null / 字符串 / 负数 / 小数必须 400，所以用 ValidateIf 而不是 IsOptional。
   * 不要加 @Type(() => Number)，否则字符串会被强转后放过。
   */
  @ValidateIf((dto: CreatePackageOrderDto) => dto.quotedAmountCents !== undefined)
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  quotedAmountCents?: number
}
