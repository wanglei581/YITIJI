import { Type } from 'class-transformer'
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, Min, ValidateNested } from 'class-validator'

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
}
