import { Type } from 'class-transformer'
import { IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator'

/**
 * PUT /admin/branding 的请求体。省略 = 不改；null 或纯空白 = 清除（回到默认）。
 * 这里只管类型与不许多余字段（全局 ValidationPipe 开了 whitelist + forbidNonWhitelisted）和一个粗上限；
 * 真正的口径（品牌名 1–12 字、字标 1 字、备案链接只许官方域名……）在 branding.validation.ts，错误码按字段区分。
 */
export class UpdateBrandingFilingDto {
  @IsOptional() @IsString() @MaxLength(600)
  icp?: string | null

  @IsOptional() @IsString() @MaxLength(1200)
  icpUrl?: string | null

  @IsOptional() @IsString() @MaxLength(600)
  police?: string | null

  @IsOptional() @IsString() @MaxLength(1200)
  policeUrl?: string | null
}

export class UpdateBrandingDto {
  @IsOptional() @IsString() @MaxLength(200)
  brandName?: string | null

  @IsOptional() @IsString() @MaxLength(40)
  brandMark?: string | null

  @IsOptional() @IsString() @MaxLength(64)
  brandLogoAssetId?: string | null

  @IsOptional() @ValidateNested() @Type(() => UpdateBrandingFilingDto)
  filing?: UpdateBrandingFilingDto
}
