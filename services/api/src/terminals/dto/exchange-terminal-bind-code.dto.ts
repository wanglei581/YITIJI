import { IsNotEmpty, IsOptional, IsString } from 'class-validator'

export class ExchangeTerminalBindCodeDto {
  @IsString()
  @IsNotEmpty()
  bindCode!: string

  @IsString()
  @IsNotEmpty()
  deviceFingerprint!: string

  @IsString()
  @IsOptional()
  displayName?: string

  @IsString()
  @IsOptional()
  macAddress?: string

  @IsString()
  @IsOptional()
  locationLabel?: string

  @IsString()
  @IsOptional()
  agentVersion?: string
}
