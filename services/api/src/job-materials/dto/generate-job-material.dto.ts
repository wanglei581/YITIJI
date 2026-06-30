import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator'

export class GenerateJobMaterialDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  templateId!: string

  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  applicantName!: string

  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  targetRole!: string

  @IsOptional()
  @IsString()
  @MaxLength(80)
  targetOrganization?: string

  @IsOptional()
  @IsString()
  @MaxLength(280)
  keyStrengths?: string

  @IsOptional()
  @IsString()
  @MaxLength(220)
  notes?: string
}
