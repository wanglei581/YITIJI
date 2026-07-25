import { Type } from 'class-transformer'
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator'

export class ListAdminUsersDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000)
  page = 1

  @IsOptional()
  @Type(() => Number)
  @IsIn([10, 20, 50, 100])
  pageSize: 10 | 20 | 50 | 100 = 20

  @IsOptional()
  @IsString()
  @MaxLength(50)
  keyword?: string

  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string

  @IsOptional()
  @IsIn(['true', 'false'])
  enabled?: 'true' | 'false'

  @IsOptional()
  @IsString()
  @MaxLength(64)
  registeredFrom?: string

  @IsOptional()
  @IsString()
  @MaxLength(64)
  registeredTo?: string
}
