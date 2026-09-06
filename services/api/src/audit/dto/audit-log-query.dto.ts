import { Type } from 'class-transformer'
import { IsDateString, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator'

export class AuditLogQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  action?: string

  @IsOptional()
  @IsString()
  @MaxLength(120)
  actorId?: string

  @IsOptional()
  @IsString()
  @MaxLength(120)
  targetType?: string

  @IsOptional()
  @IsString()
  @MaxLength(120)
  targetId?: string

  @IsOptional()
  @IsDateString({ strict: true })
  startAt?: string

  @IsOptional()
  @IsDateString({ strict: true })
  endAt?: string

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number
}
