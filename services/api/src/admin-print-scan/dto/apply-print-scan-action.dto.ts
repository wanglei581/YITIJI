import { IsIn } from 'class-validator'

export class ApplyPrintScanActionDto {
  @IsIn(['retry', 'cancel'])
  action!: string
}
