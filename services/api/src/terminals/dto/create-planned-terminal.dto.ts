import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator'

export class CreatePlannedTerminalDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, {
    message: 'terminalCode 只能包含字母、数字、下划线和连字符',
  })
  terminalCode!: string

  @IsOptional()
  @IsString()
  @MaxLength(120)
  displayName?: string

  @IsOptional()
  @IsString()
  @MaxLength(200)
  locationLabel?: string

  @IsOptional()
  @IsString()
  @MaxLength(128)
  orgId?: string
}
