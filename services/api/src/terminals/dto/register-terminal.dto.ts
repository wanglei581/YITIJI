import { IsNotEmpty, IsString } from 'class-validator'

export class RegisterTerminalDto {
  @IsString()
  @IsNotEmpty()
  terminalCode!: string

  @IsString()
  @IsNotEmpty()
  deviceFingerprint!: string

  @IsString()
  @IsNotEmpty()
  adminSecret!: string
}
