import { IsNotEmpty, IsOptional, IsString } from 'class-validator'

export class RegisterTerminalDto {
  @IsString()
  @IsNotEmpty()
  terminalCode!: string

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
  @IsNotEmpty()
  adminSecret!: string
}
