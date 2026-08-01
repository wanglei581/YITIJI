import { IsIn, IsString, MaxLength, MinLength } from 'class-validator'

export class CreateScanTaskDto {
  @IsIn(['resume', 'id', 'document', 'contract'])
  scanType!: 'resume' | 'id' | 'document' | 'contract'

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  terminalId!: string
}
