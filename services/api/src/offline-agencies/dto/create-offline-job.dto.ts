import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
} from 'class-validator'

export type JobType = 'fulltime' | 'parttime' | 'internship'
export const JOB_TYPES: JobType[] = ['fulltime', 'parttime', 'internship']

export type SalaryUnit = 'month' | 'day' | 'hour'
export const SALARY_UNITS: SalaryUnit[] = ['month', 'day', 'hour']

export class CreateOfflineJobDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(100)
  title!: string

  @IsOptional()
  @IsIn(JOB_TYPES)
  jobType?: JobType

  @IsOptional()
  @IsInt()
  @Min(0)
  salaryMin?: number

  @IsOptional()
  @IsInt()
  @Min(0)
  salaryMax?: number

  @IsOptional()
  @IsIn(SALARY_UNITS)
  salaryUnit?: SalaryUnit

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  requirements?: string

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string

  @IsOptional()
  @IsInt()
  @Min(1)
  headcount?: number

  @IsOptional()
  @IsString()
  @MaxLength(200)
  location?: string

  @IsOptional()
  @IsString()
  @MaxLength(100)
  education?: string

  @IsOptional()
  @IsString()
  @MaxLength(100)
  experience?: string

  @IsOptional()
  @IsUrl()
  @MaxLength(500)
  externalUrl?: string

  @IsOptional()
  @IsString()
  externalId?: string
}

export class UpdateOfflineJobDto extends CreateOfflineJobDto {
  @IsOptional()
  @IsIn(['active', 'inactive'])
  status?: string
}
