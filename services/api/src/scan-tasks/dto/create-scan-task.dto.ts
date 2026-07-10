import { IsIn, IsString, MaxLength, MinLength } from 'class-validator'

export class CreateScanTaskDto {
  @IsIn(['resume', 'id', 'document'])
  scanType!: 'resume' | 'id' | 'document'

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  terminalId!: string
}
