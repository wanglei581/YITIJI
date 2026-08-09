import { Type } from 'class-transformer'
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator'

class PageQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000)
  page = 1

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20
}

export class DirectoryListQueryDto extends PageQueryDto {
  @IsOptional()
  @IsIn(['pending', 'reviewing', 'approved', 'rejected'])
  reviewStatus?: string

  @IsOptional()
  @IsIn(['draft', 'published', 'unpublished', 'expired'])
  publishStatus?: string

  @IsOptional()
  @IsIn(['pending', 'valid', 'invalid', 'error'])
  linkCheckStatus?: string

  @IsOptional()
  @IsString()
  @MaxLength(64)
  organizationId?: string
}

export class AgencyProfileListQueryDto extends PageQueryDto {
  @IsOptional()
  @IsIn(['pending', 'reviewing', 'approved', 'rejected'])
  reviewStatus?: string

  @IsOptional()
  @IsIn(['draft', 'published', 'unpublished', 'expired'])
  publishStatus?: string

  @IsOptional()
  @IsString()
  @MaxLength(64)
  organizationId?: string
}

export class QualificationListQueryDto extends PageQueryDto {
  @IsOptional()
  @IsIn(['pending', 'valid', 'expired', 'revoked', 'rejected'])
  status?: string

  @IsOptional()
  @IsString()
  @MaxLength(64)
  qualificationType?: string
}
