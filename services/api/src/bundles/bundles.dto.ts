// bundles.dto.ts — 材料包 DTO（Redis 存储，24h TTL，无 DB migration）
import { IsArray, IsEnum, IsInt, IsOptional, IsString, Min, ValidateNested } from 'class-validator'
import { Type } from 'class-transformer'

export class BundleFileDto {
  @IsString() fileId!: string
  @IsString() fileType!: string   // 'resume' | 'document' | 'local'
  @IsInt() @Min(1) copies!: number
}

export class PrintParamsDto {
  @IsEnum(['bw', 'color']) color!: 'bw' | 'color'
  @IsEnum(['single', 'double']) duplex!: 'single' | 'double'
}

export class CreateBundleDto {
  @IsString() name!: string
  @IsArray() @ValidateNested({ each: true }) @Type(() => BundleFileDto)
  files!: BundleFileDto[]
  @ValidateNested() @Type(() => PrintParamsDto)
  printParams!: PrintParamsDto
}

export interface BundleItem {
  bundleId:    string
  endUserId:   string
  name:        string
  status:      'pending' | 'claimed' | 'printed' | 'expired'
  pickupCode:  string
  files:       BundleFileDto[]
  printParams: PrintParamsDto
  createdAt:   string
  expiresAt:   string
}

export interface BundleListResponse {
  items: BundleItem[]
  total: number
}
