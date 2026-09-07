import { IsIn } from 'class-validator'

export class ConvertDocumentDto {
  @IsIn(['pdf'])
  target!: 'pdf'
}
