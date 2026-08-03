import {
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
} from 'class-validator'

export type OrgType = 'recruitment' | 'headhunting' | 'staffing' | 'hr_consulting'
export const ORG_TYPES: OrgType[] = ['recruitment', 'headhunting', 'staffing', 'hr_consulting']

export class CreateOfflineAgencyDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(100)
  name!: string

  @IsOptional()
  @IsIn(ORG_TYPES)
  orgType?: OrgType

  @IsNotEmpty()
  @IsString()
  @MaxLength(200)
  address!: string

  @IsOptional()
  @IsString()
  @MaxLength(50)
  district?: string

  @IsOptional()
  @IsNumber()
  lat?: number

  @IsOptional()
  @IsNumber()
  lng?: number

  @IsOptional()
  @IsString()
  @MaxLength(200)
  openHours?: string

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string

  @IsOptional()
  @IsString()
  @MaxLength(100)
  contactEmail?: string

  @IsOptional()
  @IsUrl()
  @MaxLength(500)
  website?: string

  /** JSON array of service tag strings */
  @IsOptional()
  @IsString()
  services?: string

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string

  @IsOptional()
  @IsUrl()
  @MaxLength(500)
  logoUrl?: string

  @IsOptional()
  @IsString()
  sourceOrgId?: string

  @IsOptional()
  @IsString()
  externalId?: string
}

export class UpdateOfflineAgencyDto extends CreateOfflineAgencyDto {
  @IsOptional()
  @IsIn(['active', 'inactive', 'suspended'])
  status?: string
}
