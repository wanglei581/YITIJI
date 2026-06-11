import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator'
import { Type } from 'class-transformer'

/**
 * 招聘会场馆导览保存 DTO(整体 PUT,服务端事务性替换)。
 *
 * 契约源:packages/shared/src/types/fairDto.ts(SaveFairVenueGuideInput),
 * services/api 为 CJS 本地副本,改动须两处同步。
 *
 * 全局 forbidNonWhitelisted 生效:任何超出白名单的字段(候选人/简历/报名等)直接 400。
 * 合规:只承载会场布局与展位信息,不含任何招聘闭环字段。
 */

export const VENUE_FACILITY_TYPES = ['entrance', 'serviceDesk', 'printPoint', 'consulting'] as const

export class SaveVenueHallCompanyDto {
  @IsString() @IsNotEmpty() @MaxLength(64)
  fairCompanyId!: string

  @IsOptional() @IsString() @MaxLength(20)
  boothNo?: string

  @IsOptional() @IsInt() @Min(0)
  sortOrder?: number
}

export class SaveVenueHallDto {
  /** 展厅编码,如 A / B / C / A1 */
  @IsString() @IsNotEmpty() @MaxLength(4)
  @Matches(/^[A-Za-z0-9]+$/, { message: 'hallCode 只允许字母数字' })
  hallCode!: string

  @IsString() @IsNotEmpty() @MaxLength(50)
  hallName!: string

  @IsOptional() @IsString() @MaxLength(60)
  industryCategory?: string

  @IsOptional() @IsString() @MaxLength(500)
  description?: string

  @IsOptional() @IsString() @MaxLength(40)
  boothRange?: string

  @IsOptional() @IsInt() @Min(0)
  sortOrder?: number

  @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => SaveVenueHallCompanyDto)
  companies!: SaveVenueHallCompanyDto[]
}

export class SaveVenueFacilityDto {
  @IsIn([...VENUE_FACILITY_TYPES])
  type!: string

  @IsString() @IsNotEmpty() @MaxLength(50)
  name!: string

  @IsOptional() @IsString() @MaxLength(100)
  locationLabel?: string

  @IsOptional() @IsString() @MaxLength(4)
  relatedHallCode?: string

  @IsOptional() @IsInt() @Min(0)
  sortOrder?: number
}

export class SaveVenueGuideDto {
  @IsString() @IsNotEmpty() @MaxLength(100)
  venueName!: string

  @IsArray() @ArrayMaxSize(12) @ValidateNested({ each: true }) @Type(() => SaveVenueHallDto)
  halls!: SaveVenueHallDto[]

  @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => SaveVenueFacilityDto)
  facilities!: SaveVenueFacilityDto[]
}
