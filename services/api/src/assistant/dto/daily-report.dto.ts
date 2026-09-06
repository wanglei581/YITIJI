import { IsOptional, IsString, MaxLength } from 'class-validator'

export class DailyReportDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  city?: string
}
