import { IsDateString, IsInt, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator'

export class AdminFirstOrderQuery {
  @IsString() @IsNotEmpty() @MaxLength(100) orgId!: string
}
export class FirstOrderProjectDto {
  @IsString() @IsNotEmpty() @MaxLength(120) name!: string
  @IsString() @IsNotEmpty() @MaxLength(100) reference!: string
  @IsDateString() serviceStartAt!: string
  @IsDateString() serviceEndAt!: string
  @IsString() @IsNotEmpty() @MaxLength(1000) serviceScope!: string
  @IsString() @IsNotEmpty() @MaxLength(200) supportContact!: string
}
export class CreateFirstOrderProjectDto extends FirstOrderProjectDto {
  @IsString() @IsNotEmpty() @MaxLength(100) orgId!: string
}
export class UpdateFirstOrderProjectDto extends FirstOrderProjectDto {
  @IsInt() @Min(1) version!: number
}
export class FirstOrderDeploymentDto {
  @IsString() @IsNotEmpty() @MaxLength(100) terminalId!: string
  @IsString() @IsNotEmpty() @MaxLength(200) locationLabel!: string
}
export class FirstOrderMonthDto {
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/) month!: string
}
/** Deliberately rejects orgId and arbitrary client-supplied identity fields. */
export class FirstOrderEmptyDto {
  @IsOptional() @IsString() @MaxLength(0) _unused?: string
}
