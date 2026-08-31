import { IsDateString, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator'

export class ReportReleaseObservationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  seenPlanId!: string

  @IsInt()
  @Min(1)
  seenPlanVersion!: number

  @IsOptional()
  @IsString()
  @MaxLength(64)
  runtimeVersion?: string | null

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  observationProtocolVersion!: string

  @IsDateString()
  observedAt!: string
}
